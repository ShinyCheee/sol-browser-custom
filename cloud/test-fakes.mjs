// Doubles locaux : toute requête non prévue échoue ; aucun socket ni accès distant.
import assert from 'node:assert/strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fakeServices() {
  const uploads = new Map(), backups = new Map(), objects = new Map(), events = [], advisoryLocks = new Set();
  let tail = Promise.resolve(), failDelete = false, failPut = false, failInit = false, streamGet = false;
  const result = rows => ({rows, rowCount: rows.length});

  async function query(sql, p = []) {
    sql = sql.replace(/\s+/g, ' ').trim();
    events.push({sql, p});
    const [id, userId, bytes] = p;
    if (/^(CREATE|ALTER) /.test(sql)) {
      if (failInit) throw new Error('database unavailable');
      return result([]);
    }
    if (sql.startsWith('SELECT count(*)')) {
      const rows = [...uploads.values()].filter(r => r.user_id === id);
      return result([{count: rows.length, bytes: rows.reduce((s, r) => s + r.bytes, 0)}]);
    }
    if (sql.startsWith('INSERT INTO backup_uploads')) {
      assert(!uploads.has(id));
      uploads.set(id, {id, user_id: userId, bytes, expires_at: Date.now() + 3600000});
      return result([]);
    }
    if (sql.startsWith('SELECT bytes FROM backup_uploads')) {
      const r = uploads.get(id);
      return result(r?.user_id === userId && r.expires_at > Date.now() ? [r] : []);
    }
    if (sql.startsWith('SELECT id, user_id FROM backup_uploads')) {
      return result([...uploads.values()].filter(r => r.expires_at <= Date.now()).slice(0, 100));
    }
    if (sql.startsWith('DELETE FROM backup_uploads')) {
      const r = uploads.get(id);
      const match = r && (
        sql === 'DELETE FROM backup_uploads WHERE id = $1 AND user_id = $2'
          ? r.user_id === userId
          : sql.includes('RETURNING')
            ? r.user_id === userId && r.bytes === bytes && r.expires_at > Date.now()
            : r.expires_at <= Date.now()
      );
      if (match) uploads.delete(id);
      return result(match ? [r] : []);
    }
    if (sql.startsWith('INSERT INTO backups')) {
      assert(!backups.has(id));
      backups.set(id, {id, object_id: id, user_id: userId, device: p[2], bytes: p[3], created_at: Date.now()});
      return result([]);
    }
    if (sql.startsWith('SELECT id, coalesce(object_id, id)')) {
      const rows = [...backups.values()].filter(r => r.user_id === id && r.device.toLowerCase() === userId.toLowerCase());
      return result(rows.reverse().slice(0, 1).map(r => ({...r, object_id: r.object_id ?? r.id})));
    }
    if (sql.startsWith('SELECT id, bytes FROM backups')) {
      return result([...backups.values()].filter(r => r.user_id === userId && (r.id === id || r.object_id === id)));
    }
    if (sql.startsWith('UPDATE backups SET object_id')) {
      const r = backups.get(id);
      if (!r || r.user_id !== p[4]) return result([]);
      Object.assign(r, {object_id: p[1], bytes: p[2], device: p[3], created_at: Date.now()});
      return result([r]);
    }
    if (sql.startsWith('DELETE FROM backups WHERE user_id = $1 AND lower(device)')) {
      const replaced = [...backups.values()].filter(r => r.user_id === id && r.device.toLowerCase() === userId.toLowerCase() && r.id !== bytes);
      for (const r of replaced) backups.delete(r.id);
      return result(replaced);
    }
    if (sql.startsWith('DELETE FROM backups') && sql.includes('NOT IN')) {
      const stale = [...backups.values()].filter(r => r.user_id === id).reverse().slice(5);
      for (const r of stale) backups.delete(r.id);
      return result(stale);
    }
    if (sql.startsWith('SELECT user_id, coalesce(object_id, id) AS object_id FROM backups WHERE object_id = ANY')) {
      const ids = new Set(id.map(x => {
        assert.match(x, UUID_RE);
        return x.toLowerCase();
      }));
      const bRows = [...backups.values()]
        .filter(r => ids.has(String(r.object_id ?? '').toLowerCase()) || ids.has(String(r.id).toLowerCase()))
        .map(r => ({user_id: r.user_id, object_id: r.object_id ?? r.id}));
      const uRows = [...uploads.values()]
        .filter(r => ids.has(String(r.id).toLowerCase()))
        .map(r => ({user_id: r.user_id, object_id: r.id}));
      return result([...bRows, ...uRows]);
    }
    if (/^SELECT (1|bytes|coalesce\(object_id, id\))/.test(sql) || sql.startsWith('DELETE FROM backups')) {
      const r = backups.get(id), found = r?.user_id === userId;
      if (found && sql.startsWith('DELETE')) backups.delete(id);
      return result(found ? [{...r, object_id: r.object_id ?? r.id}] : []);
    }
    if (sql.startsWith('SELECT id, device, bytes::text')) {
      return result([...backups.values()].filter(r => r.user_id === id));
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }

  const pool = {
    query,
    async connect() {
      let unlock, snapshot, heldAdvisory = null;
      return {
        async query(sql, p) {
          sql = sql.replace(/\s+/g, ' ').trim();
          if (sql === 'BEGIN') return result([]);
          if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
            const previous = tail;
            tail = new Promise(r => { unlock = r; });
            await previous;
            snapshot = [structuredClone(uploads), structuredClone(backups)];
            return result([]);
          }
          if (sql.startsWith('SELECT pg_try_advisory_lock')) {
            if (advisoryLocks.has(sql)) return result([{locked: false}]);
            advisoryLocks.add(sql);
            heldAdvisory = sql;
            return result([{locked: true}]);
          }
          if (sql.startsWith('SELECT pg_advisory_unlock')) {
            if (heldAdvisory) {
              advisoryLocks.delete(heldAdvisory);
              heldAdvisory = null;
            }
            return result([{pg_advisory_unlock: true}]);
          }
          if (sql === 'ROLLBACK') {
            if (snapshot) {
              uploads.clear();
              backups.clear();
              for (const [k, v] of snapshot[0]) uploads.set(k, v);
              for (const [k, v] of snapshot[1]) backups.set(k, v);
            }
            return result([]);
          }
          if (sql === 'COMMIT') return result([]);
          return query(sql, p);
        },
        release() {
          unlock?.();
        },
      };
    },
  };

  const s3 = {
    async send(command) {
      const name = command.constructor.name, {Key, ContinuationToken, Body, Range} = command.input;
      events.push({name, Key, ContinuationToken});
      if (name === 'DeleteObjectCommand') {
        if (failDelete) throw new Error('storage unavailable');
        objects.delete(Key);
        return {};
      }
      if (name === 'ListObjectsV2Command') {
        const all = [...objects.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([k]) => !ContinuationToken || k > ContinuationToken);
        const page = all.slice(0, 1000), truncated = all.length > page.length;
        return {
          Contents: page.map(([Key, o]) => ({Key, LastModified: new Date(o.modified)})),
          IsTruncated: truncated,
          NextContinuationToken: truncated ? page.at(-1)[0] : undefined,
        };
      }
      if (name === 'PutObjectCommand') {
        if (failPut) throw new Error('storage write failed');
        objects.set(Key, {body: Body, modified: Date.now()});
        return {};
      }
      const obj = objects.get(Key);
      if (!obj) throw new Error('not found');
      if (name === 'HeadObjectCommand') return {ContentLength: obj.body.length};
      if (name === 'GetObjectCommand') {
        if (streamGet && !Range) {
          return {Body: new ReadableStream({start(c) { c.enqueue(obj.body); c.close(); }})};
        }
        return {Body: {async transformToByteArray() { return Range ? obj.body.subarray(0, 10) : obj.body; }}};
      }
      throw new Error(`unexpected S3: ${name}`);
    },
  };

  return {
    pool, s3, uploads, backups, objects, events,
    setFailDelete(v) { failDelete = v; },
    setFailPut(v) { failPut = v; },
    setFailInit(v) { failInit = v; },
    setStreamGet(v) { streamGet = v; },
  };
}
