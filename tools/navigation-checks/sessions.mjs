import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runSessions(ctx) {
  const { argv, base, profile, origin, sessionRequests, waitFor, connect, targets, command, state, hotkey, launch, pageAt, stop } = ctx;
  let popup = null;
  if (argv.includes('--private-check')) assert.equal((await state()).privateMode, true);
  const first = (await state()).activeId;
  const catalog = JSON.parse(await readFile(resolve(profile, 'tab-sessions.json'), 'utf8'));
  const admin = catalog.find(s => s.Name === 'Admin').Id;
  const user = catalog.find(s => s.Name === 'User').Id;
  const guest = catalog.find(s => s.Name === 'Invité').Id;

  const switchSession = async (id, session, suffix) => {
    const old = (await targets()).map(t => t.id);
    await command({ type: 'session.set', id, query: session });
    const target = await waitFor(async () => (await targets()).find(t => t.url === origin + suffix && !old.includes(t.id)), 'new session view');
    const connection = await connect(target);
    await waitFor(() => connection.evaluate(`location.href===${JSON.stringify(origin + suffix)}&&document.readyState==='complete'&&!!document.querySelector('h1')`), 'session document');
    return connection;
  };

  let page = await pageAt('/a');
  await page.evaluate("document.cookie='account=main;path=/';localStorage.account='main'");
  assert.ok((await page.call('Network.getCookies', { urls: [origin] })).cookies.some(c => c.name === 'account' && c.value === 'main'), 'main cookie accepted before switch');

  page = await switchSession(first, admin, '/a');
  assert.equal(await page.evaluate('document.cookie'), '', 'admin cookies isolated from main');
  assert.equal(await page.evaluate('localStorage.account'), undefined, 'admin storage isolated from main');
  await page.evaluate("document.cookie='account=admin;path=/';localStorage.account='admin'");

  await command({ type: 'tab.open', url: `${origin}/admin-child` });
  await waitFor(async () => (await state()).tabs.some(t => t.url === `${origin}/admin-child`), 'child tab');
  const child = (await state()).activeId;
  let childPage = await pageAt('/admin-child');
  assert.equal((await state()).tabs.find(t => t.id === child).sessionId, admin, 'new tab uses this site choice');
  assert.equal(await childPage.evaluate('localStorage.account'), 'admin');

  await childPage.evaluate("void window.open('/popup-child','_blank')");
  await waitFor(async () => (await state()).tabs.some(t => t.url === `${origin}/popup-child`), 'popup opens in Sol');
  const popupTab = (await state()).tabs.find(t => t.url === `${origin}/popup-child`);
  assert.equal(popupTab.sessionId, admin, 'popup session inherited');
  await command({ type: 'tab.activate', id: child });
  await command({ type: 'tab.close', id: popupTab.id });

  await command({ type: 'tab.open', url: `${origin}/user-page` });
  await waitFor(async () => (await state()).tabs.some(t => t.url === `${origin}/user-page`), 'user tab');
  const second = (await state()).activeId;
  await pageAt('/user-page');
  let userPage = await switchSession(second, user, '/user-page');
  await waitFor(() => userPage.evaluate("document.readyState==='complete'"), 'user loaded');
  assert.equal(await userPage.evaluate('document.cookie'), '', 'user cookie isolation');
  assert.equal(await userPage.evaluate('localStorage.account'), undefined);
  await userPage.evaluate("document.cookie='account=user;path=/';localStorage.account='user'");

  for (const [id, connection, session] of [[second, userPage, user], [child, childPage, admin]]) {
    if ((await state()).activeId !== id) {
      await command({ type: 'tab.activate', id });
      await waitFor(async () => (await state()).activeId === id, 'permission tab active');
    }
    await connection.evaluate('window.__geoDenied=false;navigator.geolocation.getCurrentPosition(()=>{},e=>window.__geoDenied=e.code===1)');
    if (!popup) {
      popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'session popup'));
      await popup.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    await waitFor(() => popup.evaluate("document.body.innerText.includes('connaître votre position')"), 'session permission prompt');
    await command({ type: 'permission.answer', index: 0 });
    await waitFor(() => connection.evaluate('window.__geoDenied'), 'session permission denial');
    const permissions = await waitFor(async () => {
      try {
        return JSON.parse(await readFile(resolve(profile, 'session-permissions', `${session}.json`), 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    }, 'session permission saved');
    assert.equal(permissions[`${origin} Geolocation`], false);
  }

  const workers = [];
  for (const target of (await targets()).filter(t => t.type === 'service_worker' && t.url.includes('joongffhgagcehjmlaeopoemilgmiabe'))) {
    const connection = await connect(target);
    const urls = await connection.evaluate('chrome.tabs.query({}).then(t=>t.map(t=>t.url))');
    workers.push({ connection, urls });
  }
  const adminWorker = workers.find(w => w.urls.includes(`${origin}/admin-child`))?.connection;
  const userWorker = workers.find(w => w.urls.includes(`${origin}/user-page`))?.connection;
  assert.ok(adminWorker && userWorker, 'separate extension contexts exist');
  await adminWorker.evaluate("chrome.storage.local.set({sessionCheck:'admin'})");
  assert.equal(await userWorker.evaluate("chrome.storage.local.get('sessionCheck').then(x=>x.sessionCheck)"), undefined, 'extension storage isolation');

  await command({ type: 'device.compare', id: child, query: 'iPhone SE|iPad mini' });
  const mirrored = await waitFor(async () => {
    const list = (await targets()).filter(t => t.url === `${origin}/admin-child`);
    return list.length >= 2 && list;
  }, 'session mirror');
  for (const target of mirrored) {
    const mirror = await connect(target);
    await waitFor(() => mirror.evaluate("localStorage.account==='admin'"), 'mirror inherits account');
  }
  await command({ type: 'device.set', id: child, query: '' });
  await command({ type: 'tab.activate', id: child });
  childPage = await pageAt('/admin-child');
  assert.equal(await childPage.evaluate('document.cookie'), 'account=admin');

  await command({ type: 'split.open', id: second });
  await delay(200);
  assert.equal(await userPage.evaluate('localStorage.account'), 'user', 'split sessions remain separate');
  await command({ type: 'split.close' });

  await childPage.evaluate(
    `(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=280;const ctx=canvas.getContext('2d');function draw(){ctx.fillStyle='green';ctx.fillRect(0,0,160,280);window.__videoDraw=requestAnimationFrame(draw)}draw();const video=document.createElement('video');video.muted=true;video.srcObject=canvas.captureStream(20);document.body.append(video);await video.play()})()`,
  );
  await command({ type: 'tab.activate', id: second });
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).includes(`pip.enter ${child}`), 'session PiP');
  assert.equal(await childPage.evaluate('localStorage.account'), 'admin', 'PiP keeps source session');
  await command({ type: 'tab.activate', id: child });
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).includes(`pip.exit ${child}`), 'session PiP returns');
  await childPage.evaluate("document.querySelector('video').pause();cancelAnimationFrame(window.__videoDraw)");

  await command({ type: 'tab.activate', id: second });
  await command({ type: 'tab.close', id: child });
  await command({ type: 'tab.reopen' });
  await waitFor(async () => (await state()).tabs.some(t => t.id !== child && t.url === `${origin}/admin-child`), 'tab reopened');
  const reopened = (await state()).tabs.find(t => t.url === `${origin}/admin-child`).id;
  await waitFor(async () => (await state()).tabs.find(t => t.id === reopened)?.sessionId === admin, 'closed tab session preserved');
  childPage = await pageAt('/admin-child');
  assert.equal(await childPage.evaluate('document.cookie'), 'account=admin');

  await command({ type: 'nav.go', id: reopened, input: `${origin}/document` });
  await waitFor(() => sessionRequests.some(r => r.url === '/document'), 'PDF request');
  assert.equal(sessionRequests.find(r => r.url === '/document').cookie, 'account=admin', 'PDF uses session');
  await command({ type: 'nav.go', id: reopened, input: `${origin}/download` });
  await waitFor(() => sessionRequests.some(r => r.url === '/download'), 'download request');
  assert.equal(sessionRequests.find(r => r.url === '/download').cookie, 'account=admin', 'download uses session');
  await waitFor(async () => (await readdir(resolve(base, 'downloads'))).length > 0, 'download completes');
  await waitFor(async () => (await state()).downloads.active === 0, 'download finished before session switch');

  await command({ type: 'nav.go', id: reopened, input: `${origin}/admin-child` });
  childPage = await pageAt('/admin-child');
  childPage = await switchSession(reopened, '', '/admin-child');
  await waitFor(() => childPage.evaluate("document.readyState==='complete'"), 'main recreated');
  assert.equal(await childPage.evaluate('localStorage.account'), 'main', 'main profile storage retained');
  assert.equal(await childPage.evaluate('document.cookie'), 'account=main', 'change recreates view with main data');
  childPage = await switchSession(reopened, admin, '/admin-child');
  await waitFor(() => childPage.evaluate("document.readyState==='complete'"), 'admin restored');
  assert.equal(await childPage.evaluate('localStorage.account'), 'admin');

  await command({ type: 'tab.activate', id: second });
  await waitFor(async () => (await state()).tabs.find(t => t.id === reopened)?.asleep, 'session memory discard', 25000);
  assert.equal((await state()).tabs.find(t => t.id === reopened).sessionId, admin, 'discard keeps session identity');
  await command({ type: 'tab.activate', id: reopened });
  childPage = await pageAt('/admin-child');
  assert.equal(await childPage.evaluate('document.cookie'), 'account=admin', 'wake preserves session cookies');

  await command({ type: 'tab.activate', id: second });
  userPage = await pageAt('/user-page');
  await command({ type: 'settings.open', x: 900, y: 58 });
  await waitFor(() => popup.evaluate("!!document.querySelector('.settings-nav')"), 'settings opened for session data clear');
  await command({ type: 'site-data.clear' });
  await waitFor(() => userPage.evaluate("document.cookie===''"), 'session cookies cleared');
  await command({ type: 'nav.reload', id: second });
  await waitFor(() => userPage.evaluate("document.cookie===''&&localStorage.account===undefined"), 'active session cleared');
  assert.equal(await childPage.evaluate('localStorage.account'), 'admin', 'other session data preserved');
  await command({ type: 'popup.close' });

  await command({ type: 'tab.activate', id: reopened });
  await popup.evaluate("window.__sessionOpenCount=0;chrome.webview.addEventListener('message',e=>{if(e.data.popup==='sessions')window.__sessionOpenCount++})");
  await hotkey('session.menu');
  await waitFor(() => popup.evaluate("!!document.querySelector('.sessions-popup')"), 'session shortcut');
  const opened = await popup.evaluate('window.__sessionOpenCount');
  await hotkey('session.menu');
  await delay(400);
  assert.equal(await popup.evaluate('window.__sessionOpenCount'), opened, 'second click closes instead of reopening');
  await hotkey('session.menu');
  await waitFor(() => popup.evaluate(`window.__sessionOpenCount===${opened + 1}`), 'closed session menu can reopen');

  for (const theme of [1, 2]) {
    for (const scale of [0, 1, 2]) {
      await command({ type: 'popup.close' });
      await command({ type: 'settings.set', id: 'theme', index: theme });
      await command({ type: 'settings.set', id: 'uiScale', index: scale });
      await hotkey('session.menu');
      await waitFor(() => popup.evaluate("!!document.querySelector('.sessions-popup')"), 'session UI');
      assert.ok(await popup.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'session menu fits');
    }
  }
  await delay(350);
  await popup.call('Page.captureScreenshot', { format: 'png' }).then(r => writeFile(resolve(base, 'sessions.png'), Buffer.from(r.data, 'base64')));

  await command({ type: 'session.delete', id: admin });
  assert.ok(JSON.parse(await readFile(resolve(profile, 'tab-sessions.json'), 'utf8')).some(s => s.Id === admin), 'used session cannot be deleted');
  childPage = await switchSession(reopened, guest, '/admin-child');
  await childPage.evaluate("localStorage.account='guest';document.cookie='account=guest;path=/'");
  childPage = await switchSession(reopened, admin, '/admin-child');
  assert.equal(await childPage.evaluate('localStorage.account'), 'admin');
  await command({ type: 'session.delete', id: guest });
  await waitFor(async () => !JSON.parse(await readFile(resolve(profile, 'tab-sessions.json'), 'utf8')).some(s => s.Id === guest), 'unused profile deleted');

  await command({ type: 'popup.close' });
  await command({ type: 'session.create', id: reopened, title: 'Test account' });
  await waitFor(async () => (await state()).tabs.find(t => t.id === reopened).sessionName === 'Test account', 'custom session selected');
  const custom = (await state()).tabs.find(t => t.id === reopened).sessionId;
  await command({ type: 'session.rename', id: custom, title: 'Compte perso' });
  await waitFor(async () => (await state()).tabs.find(t => t.id === reopened).sessionName === 'Compte perso', 'session renamed');

  await command({ type: 'notes.manage' });
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === 'https://start.sol/index.html#notes';
  }, 'notes opened');
  await waitFor(() => ctx.ui.evaluate('document.querySelector(\'input[aria-label="Adresse ou recherche"]\')?.value===\'sol://notes\''), 'notes address alias');
  await ctx.ui.evaluate('document.querySelector(\'input[aria-label="Adresse ou recherche"]\').focus()');
  assert.equal(await ctx.ui.evaluate('document.querySelector(\'input[aria-label="Adresse ou recherche"]\').value'), 'sol://notes', 'editing notes address preserves alias');
  await ctx.ui.evaluate('document.querySelector(\'input[aria-label="Adresse ou recherche"]\').closest(\'form\').requestSubmit()');
  const sidebar = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'), 'notes sidebar'));
  assert.ok(await sidebar.evaluate('!!document.querySelector(\'input[value="sol://notes"]\')'), 'notes sidebar alias');
  await command({ type: 'tab.activate', id: reopened });

  if (!argv.includes('--private-check')) {
    await stop();
    await launch();
    await waitFor(async () => (await state()).tabs.some(t => t.sessionId === custom), 'session restored');
    assert.ok((await state()).tabs.some(t => t.sessionId === admin), 'sleeping tabs retain session');
    const engine = resolve(profile, 'webview2/EBWebView');
    const deleted = `WV2Profile_sol-${guest}`;
    const registered = JSON.parse(await readFile(resolve(engine, 'Local State'), 'utf8')).profile.info_cache;
    assert.ok(!Object.hasOwn(registered, deleted), 'deleted session unregistered by engine');
    const remaining = await readdir(resolve(engine, deleted)).catch(e => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    assert.ok(!remaining.some(name => ['Network', 'Cookies', 'Local Storage', 'IndexedDB', 'Web Data', 'Login Data'].includes(name)), 'deleted cookies, storage and passwords removed by engine');
  }
  await stop();
  console.log('PASS session isolation, inheritance, popups, split, mirror, permissions, extension storage, PiP, reopen, PDF/download, switch, custom names, deletion, scales, notes address and persistence');
}
