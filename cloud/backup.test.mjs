import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {backupStorage, MAX_BYTES, objectKey} from './backup-storage.ts';
import {createBackupApp} from './backup-api.ts';
import {fakeServices} from './test-fakes.mjs';

globalThis.fetch = () => { throw new Error('network forbidden in local tests'); };
const sealed = Buffer.from('SOLBACKUP1encrypted');
const fixture = () => {
  const f = fakeServices();
  f.app = createBackupApp({
    ...f,
    verify: async token => ({sub: token}),
    sign: async command => `https://signed.invalid/${command.input.Key}`,
  });
  f.call = (path, body, method = 'POST', user = 'alice') => f.app.request(path, {
    method,
    headers: {authorization: `Bearer ${user}`, 'content-type': 'application/json'},
    ...(method === 'GET' ? {} : {body: Buffer.isBuffer(body) ? body : JSON.stringify(body ?? {})}),
  });
  return f;
};

test('quota is reserved before signing; concurrent abandoned uploads cannot exceed five', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({length: 12}, () => f.call('/backups/uploads', {bytes: 4096})));
  assert.equal(responses.filter(r => r.status === 201).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 7);
  assert.equal(f.uploads.size, 5);
  assert.equal(f.objects.size, 0);
});

test('pending byte quota also blocks legacy route and isolates accounts', async () => {
  const f = fixture();
  assert.equal((await f.call('/backups/uploads', {bytes: MAX_BYTES})).status, 201);
  assert.equal((await f.call('/backups/uploads', {bytes: 20})).status, 429);
  assert.equal((await f.call('/backups', sealed)).status, 429);
  assert.equal((await f.call('/backups/uploads', {bytes: 20}, 'POST', 'bob')).status, 201);
  assert.equal(f.events.filter(e => e.name === 'PutObjectCommand').length, 0);
});

test('legacy uploads/download/delete and retention remain compatible', async () => {
  const f = fixture();
  let first;
  for (let i = 0; i < 7; i++) {
    const response = await f.call('/backups?device=OldSol', sealed);
    assert.equal(response.status, 201);
    first ??= (await response.json()).id;
  }
  assert.equal(f.backups.size, 5);
  assert.equal(f.objects.size, 5);
  assert.equal(f.uploads.size, 0);
  assert.equal((await f.call(`/backups/${first}`, null, 'GET')).status, 404);
  const id = [...f.backups.keys()][0];
  assert.equal((await f.call(`/backups/${id}`, null, 'GET', 'bob')).status, 404);
  f.setStreamGet(true);
  assert(Buffer.from(await (await f.call(`/backups/${id}`, null, 'GET')).arrayBuffer()).equals(sealed));
  f.setStreamGet(false);
  assert(Buffer.from(await (await f.call(`/backups/${id}`, null, 'GET')).arrayBuffer()).equals(sealed));
  assert.equal((await f.call(`/backups/${id}`, {}, 'DELETE')).status, 204);
});

test('finalization requires an owned, live reservation and the exact declared size', async () => {
  const f = fixture();
  const slot = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', slot.id), {body: sealed, modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${slot.id}`, {}, 'POST', 'bob')).status, 404);
  assert.equal((await f.call(`/backups/uploads/${slot.id}`, {device: 'PC'})).status, 201);
  assert.equal(f.uploads.size, 0);
  assert.equal(f.backups.size, 1);
  assert.equal((await f.call(`/backups/uploads/${slot.id}`, {})).status, 201);
  const fake = await (await f.call('/backups/uploads', {bytes: 4096})).json();
  f.objects.set(objectKey('alice', fake.id), {body: sealed, modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${fake.id}`, {})).status, 400);
  assert(!f.objects.has(objectKey('alice', fake.id)));
  assert.equal(f.uploads.size, 0);
  assert.equal((await f.call(`/backups/uploads/${randomUUID()}`, {})).status, 404);
});

test('scheduled cleanup reclaims abandoned uploads without any successful finalization', async () => {
  const f = fixture();
  const {id} = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.uploads.get(id).expires_at = Date.now() - 1;
  f.objects.set(objectKey('alice', id), {body: sealed, modified: Date.now() - 7200000});
  assert.equal((await f.app.request('/internal/cleanup', {method: 'POST', body: '{}'})).status, 401);
  const delivery = {
    version: 1,
    invocation_id: 'local',
    trigger: {type: 'schedule', id: 'trigger-local', name: 'backup-cleanup'},
    data: {scheduled_at: new Date().toISOString()},
  };
  const response = await f.app.request('/internal/cleanup', {
    method: 'POST',
    headers: {'x-neon-trigger-invocation-id': 'local'},
    body: JSON.stringify(delivery),
  });
  assert.equal(response.status, 204);
  assert.equal(f.uploads.size, 0);
  assert.equal(f.objects.size, 0);
});

test('cleanup walks every storage page, skips concurrent runs and preserves active UUID objects', async () => {
  const f = fakeServices(), storage = backupStorage(f.pool, f.s3);
  const old = Date.now() - 7200000;
  const keptId = '00000000-0000-4000-8000-000000000001';
  const activeId = '00000000-0000-4000-8000-000000000002';
  for (let i = 0; i < 2101; i++) f.objects.set(`orphan/${String(i).padStart(4, '0')}`, {modified: old});
  f.backups.set(keptId, {id: keptId, user_id: 'alice'});
  f.uploads.set(activeId, {id: activeId, user_id: 'alice', expires_at: Date.now() + 3600000});
  f.objects.set(objectKey('alice', keptId), {modified: old});
  f.objects.set(objectKey('alice', activeId), {modified: old});
  f.objects.set(`bob/${keptId}.solbackup`, {modified: old});
  f.objects.set('recent', {modified: Date.now()});
  const [firstRun, secondRun] = await Promise.all([storage.cleanup(), storage.cleanup()]);
  assert.deepEqual([firstRun, secondRun].sort(), [false, true]);
  assert.deepEqual([...f.objects.keys()].sort(), [objectKey('alice', keptId), objectKey('alice', activeId), 'recent']);
  assert.equal(f.events.filter(e => e.name === 'ListObjectsV2Command').length, 3);
});

test('storage failure never releases quota for an expired upload', async () => {
  const f = fakeServices(), storage = backupStorage(f.pool, f.s3), id = randomUUID();
  await storage.reserve('alice', id, MAX_BYTES);
  f.uploads.get(id).expires_at = Date.now() - 1;
  f.setFailDelete(true);
  await assert.rejects(storage.cleanup(), /storage unavailable/);
  assert.equal(await storage.reserve('alice', randomUUID(), 20), false);
  f.setFailDelete(false);
  await storage.cleanup();
  assert.equal(await storage.reserve('alice', randomUUID(), 20), true);
});

test('replace updates the existing device backup in place without creating duplicates', async () => {
  const f = fixture();
  const first = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', first.id), {body: sealed, modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${first.id}`, {device: 'PC', replace: true, stableId: true})).status, 201);
  const second = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  const newer = Buffer.from('SOLBACKUP1newcipher');
  assert.equal(newer.length, sealed.length);
  f.objects.set(objectKey('alice', second.id), {body: newer, modified: Date.now()});
  const updated = await f.call(`/backups/uploads/${second.id}`, {device: 'PC', replace: true, stableId: true});
  assert.equal(updated.status, 201);
  assert.equal((await updated.json()).id, first.id, 'the backup keeps its identity when updated');
  assert.equal(f.backups.size, 1);
  assert.ok(f.backups.has(first.id));
  assert.ok(f.objects.has(objectKey('alice', first.id)), 'previous object stays readable until cleanup window');
  const listed = await (await f.call('/backups', null, 'GET')).json();
  assert.equal(listed.backups[0].id, first.id);
  assert(Buffer.from(await (await f.call(`/backups/${first.id}`, null, 'GET')).arrayBuffer()).equals(newer));
  assert.equal((await (await f.call(`/backups/uploads/${second.id}`, {device: 'PC', replace: true, stableId: true})).json()).id, first.id);
});

test('an invalid replacement never modifies the current backup; old clients keep their upload identity', async () => {
  const f = fixture();
  const first = await (await f.call('/backups?device=PC', sealed)).json();
  const invalid = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', invalid.id), {body: Buffer.alloc(sealed.length), modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${invalid.id}`, {device: 'PC', replace: true, stableId: true})).status, 400);
  assert(Buffer.from(await (await f.call(`/backups/${first.id}`, null, 'GET')).arrayBuffer()).equals(sealed));
  const legacy = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', legacy.id), {body: sealed, modified: Date.now()});
  assert.equal((await (await f.call(`/backups/uploads/${legacy.id}`, {device: 'PC', replace: true})).json()).id, legacy.id);
  assert.equal((await f.call(`/backups/${first.id}`, null, 'GET')).status, 404);
  assert.equal((await f.call(`/backups/${legacy.id}`, null, 'GET')).status, 200);
});

test('a backup created before object pointers can be updated while deferred storage cleanup fails', async () => {
  const f = fixture();
  const older = await (await f.call('/backups?device=PC', sealed)).json();
  const first = await (await f.call('/backups?device=PC', sealed)).json();
  f.backups.get(first.id).object_id = null; // A real pre-migration metadata row.
  const second = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', second.id), {body: sealed, modified: Date.now()});
  f.setFailDelete(true);
  const response = await f.call(`/backups/uploads/${second.id}`, {device: 'pc', replace: true, stableId: true});
  assert.equal(response.status, 201, 'successful publication must not report an upload failure after commit');
  assert.equal((await response.json()).id, first.id);
  assert.equal(f.backups.size, 1);
  assert(Buffer.from(await (await f.call(`/backups/${first.id}`, null, 'GET')).arrayBuffer()).equals(sealed));
  f.setFailDelete(false);
  f.objects.get(objectKey('alice', older.id)).modified = Date.now() - 7200000;
  f.objects.get(objectKey('alice', first.id)).modified = Date.now() - 7200000;
  await backupStorage(f.pool, f.s3).cleanup();
  assert(!f.objects.has(objectKey('alice', older.id)));
  assert(!f.objects.has(objectKey('alice', first.id)));
  assert(f.objects.has(objectKey('alice', second.id)));
});

test('backup_uploads quota is released immediately after 400 not-a-backup or failed PutObject', async () => {
  const f = fixture();
  const slots = await Promise.all(Array.from({length: 5}, async () => (await f.call('/backups/uploads', {bytes: sealed.length})).json()));
  assert.equal((await f.call('/backups/uploads', {bytes: sealed.length})).status, 429);
  f.objects.set(objectKey('alice', slots[0].id), {body: Buffer.alloc(sealed.length), modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${slots[0].id}`, {})).status, 400);
  assert.equal(f.uploads.size, 4);
  assert.equal((await f.call('/backups/uploads', {bytes: sealed.length})).status, 201);

  const f2 = fixture();
  f2.setFailPut(true);
  const failed = await f2.call('/backups', sealed);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {error: 'server'});
  assert.equal(f2.uploads.size, 0);
  f2.setFailPut(false);
  assert.equal((await f2.call('/backups', sealed)).status, 201);
});

test('DELETE and register(replace: true, stableId: true) serialize cleanly in both orders', async () => {
  const newer = Buffer.from('SOLBACKUP1newcipher');

  // Order 1: DELETE enters lock before register -> replacement falls back cleanly to a fresh backup row.
  const f1 = fixture();
  const base1 = await (await f1.call('/backups?device=PC', sealed)).json();
  const rep1 = await (await f1.call('/backups/uploads', {bytes: newer.length})).json();
  f1.objects.set(objectKey('alice', rep1.id), {body: newer, modified: Date.now()});
  const [del1, pub1] = await Promise.all([
    f1.call(`/backups/${base1.id}`, {}, 'DELETE'),
    f1.call(`/backups/uploads/${rep1.id}`, {device: 'PC', replace: true, stableId: true}),
  ]);
  assert.equal(del1.status, 204);
  assert.equal(pub1.status, 201);
  assert.equal((await pub1.json()).id, rep1.id);
  assert.equal(f1.backups.size, 1);
  assert(Buffer.from(await (await f1.call(`/backups/${rep1.id}`, null, 'GET')).arrayBuffer()).equals(newer));

  // Order 2: register enters lock before DELETE -> DELETE waits on user lock, then removes updated backup & new object.
  const f2 = fixture(), s2 = backupStorage(f2.pool, f2.s3);
  const base2 = await (await f2.call('/backups?device=PC', sealed)).json();
  const rep2 = await (await f2.call('/backups/uploads', {bytes: newer.length})).json();
  f2.objects.set(objectKey('alice', rep2.id), {body: newer, modified: Date.now()});
  const [pubId2, removed2] = await Promise.all([
    s2.register('alice', rep2.id, 'PC', newer.length, true, true),
    s2.remove('alice', base2.id),
  ]);
  assert.equal(pubId2, base2.id);
  assert.equal(removed2, true);
  assert.equal(f2.backups.size, 0);
  assert(!f2.objects.has(objectKey('alice', rep2.id)));
});

test('in-place replacement preserves previous S3 object for in-flight reads until >1h cleanup', async () => {
  const f = fixture(), storage = backupStorage(f.pool, f.s3);
  const newer = Buffer.from('SOLBACKUP1newcipher');
  const first = await (await f.call('/backups?device=PC', sealed)).json();
  const {url} = await (await f.call(`/backups/${first.id}/url`, null, 'GET')).json();
  const signedKey = url.replace('https://signed.invalid/', '');
  const second = await (await f.call('/backups/uploads', {bytes: newer.length})).json();
  f.objects.set(objectKey('alice', second.id), {body: newer, modified: Date.now()});
  assert.equal((await f.call(`/backups/uploads/${second.id}`, {device: 'PC', replace: true, stableId: true})).status, 201);

  // In-flight reader using the previously signed URL still finds the original ciphertext even if cleanup runs <1h.
  await storage.cleanup();
  assert(f.objects.get(signedKey)?.body.equals(sealed));
  assert(Buffer.from(await (await f.call(`/backups/${first.id}`, null, 'GET')).arrayBuffer()).equals(newer));

  // Once >1h has elapsed, cleanup purges the superseded object while keeping the active one.
  f.objects.get(signedKey).modified = Date.now() - 3600001;
  f.objects.get(objectKey('alice', second.id)).modified = Date.now() - 3600001;
  await storage.cleanup();
  assert(!f.objects.has(signedKey));
  assert(f.objects.has(objectKey('alice', second.id)));
});

test('initialize retries after transient cold-start error and subject/reservation errors are sanitized', async () => {
  const f = fixture();
  f.setFailInit(true);
  const cold = await f.call('/backups', null, 'GET');
  assert.equal(cold.status, 500);
  assert.deepEqual(await cold.json(), {error: 'server'});
  f.setFailInit(false);
  const warm = await f.call('/backups', null, 'GET');
  assert.equal(warm.status, 200);
  assert.deepEqual(await warm.json(), {backups: []});

  for (const badUser of ['../alice', 'alice/bob', 'alice..bob', '']) {
    assert.equal((await f.call('/backups', null, 'GET', badUser)).status, 401);
  }
  const slot = await (await f.call('/backups/uploads', {bytes: sealed.length})).json();
  f.objects.set(objectKey('alice', slot.id), {body: sealed, modified: Date.now()});
  const origPending = f.uploads.get(slot.id);
  // Expire right when register() runs by hooking HeadObjectCommand -> expired reservation returns 410.
  const origSend = f.s3.send;
  f.s3.send = async cmd => {
    const res = await origSend(cmd);
    if (cmd.constructor.name === 'GetObjectCommand') origPending.expires_at = Date.now() - 1;
    return res;
  };
  const expired = await f.call(`/backups/uploads/${slot.id}`, {});
  assert.equal(expired.status, 410);
  assert.deepEqual(await expired.json(), {error: 'expired'});
});
