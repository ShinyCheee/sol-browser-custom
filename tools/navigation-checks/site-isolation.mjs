import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runSiteReset(ctx) {
  const { base, profile, origin, serverPort, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  const first = (await state()).activeId;
  const page = await pageAt('/a');
  let popup = null;
  await page.call('Network.setCookie', { name: 'http-only', value: 'secret', url: origin, httpOnly: true });
  await page.evaluate(
    `document.cookie='account=main;path=/';document.cookie='deep=keep-until-reset;path=/deep';localStorage.account='main';sessionStorage.account='main';` +
      `(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('site-reset',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();await (await caches.open('site-reset')).put('/cached',new Response('cached'));await navigator.serviceWorker.register('/sw.js');})()`,
  );

  const other = `http://localhost:${serverPort}/b`;
  await command({ type: 'tab.open', url: other });
  const otherPage = await connect(await waitFor(async () => (await targets()).find(t => t.url === other), 'other site'));
  await waitFor(() => otherPage.evaluate(`document.readyState==='complete' && location.href===${JSON.stringify(other)}`), 'other site ready');
  await otherPage.evaluate("document.cookie='account=other;path=/';localStorage.account='other'");

  await command({ type: 'tab.open', url: `${origin}/isolated` });
  await pageAt('/isolated');
  const isolatedId = await waitFor(async () => (await state()).tabs.find(t => t.url === `${origin}/isolated`)?.id, 'isolated tab state');
  const admin = JSON.parse(await readFile(resolve(profile, 'tab-sessions.json'), 'utf8')).find(s => s.Name === 'Admin').Id;
  const old = (await targets()).map(t => t.id);
  await command({ type: 'session.set', id: isolatedId, query: admin });
  const isolated = await connect(await waitFor(async () => (await targets()).find(t => t.url === `${origin}/isolated` && !old.includes(t.id)), 'other session'));
  await waitFor(() => isolated.evaluate(`document.readyState==='complete' && location.href===${JSON.stringify(`${origin}/isolated`)}`), 'other session ready');
  await isolated.evaluate("document.cookie='account=isolated;path=/';localStorage.account='isolated'");

  await command({ type: 'tab.activate', id: first });
  const menu = async () => {
    await page.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.call('Input.dispatchMouseEvent', { type, button: 'right', clickCount: 1, x: 100, y: 150 });
    }
    if (!popup) {
      popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'site menu'));
      await popup.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
    await waitFor(() => popup.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).some(b=>b.textContent.includes('Vider la session'))"), 'right-click clear action');
    await popup.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).find(b=>b.textContent.includes('Vider la session')).click()");
    await waitFor(() => popup.evaluate("document.body.textContent.includes('Vider et recharger')"), 'site confirmation');
  };

  await menu();
  await command({ type: 'popup.close' });
  assert.equal(await page.evaluate('localStorage.account'), 'main', 'cancel preserves data');
  await command({ type: 'site.reset' });
  await delay(150);
  assert.equal(await page.evaluate('localStorage.account'), 'main', 'closed confirmation cannot clear data');

  await menu();
  await delay(450);
  await writeFile(resolve(base, 'site-reset.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const beforeReload = await page.evaluate('performance.timeOrigin');
  await popup.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Vider et recharger').click()");
  await waitFor(
    () => page.evaluate(`performance.timeOrigin>${beforeReload} && document.readyState==='complete' && localStorage.account===undefined && sessionStorage.account===undefined && document.cookie===''`),
    'current site cleared and reloaded',
  );
  assert.deepEqual(
    await page.evaluate('(async()=>({db:(await indexedDB.databases()).length,cache:(await caches.keys()).length,workers:(await navigator.serviceWorker.getRegistrations()).length}))()'),
    { db: 0, cache: 0, workers: 0 },
  );
  assert.equal((await page.call('Network.getCookies', { urls: [`${origin}/deep`] })).cookies.length, 0, 'cookies at other paths cleared');

  const permissions = JSON.parse(await readFile(resolve(profile, 'permissions.json'), 'utf8'));
  assert.equal(permissions[`${origin} Camera`], undefined, 'site permissions forgotten');
  assert.equal(permissions[`http://localhost:${serverPort} Camera`], true, 'other site permissions kept');
  assert.equal(await otherPage.evaluate('document.cookie'), 'account=other', 'other site cookie preserved');
  assert.equal(await otherPage.evaluate('localStorage.account'), 'other', 'other site storage preserved');
  assert.equal(await isolated.evaluate('document.cookie'), 'account=isolated', 'same site in another session preserved');
  assert.equal(await isolated.evaluate('localStorage.account'), 'isolated', 'isolated storage preserved');

  await command({ type: 'session.set', id: first, query: admin });
  await delay(300);
  const before = (await targets()).map(t => t.id);
  await command({ type: 'session.set', id: first, query: '' });
  const returned = await connect(await waitFor(async () => (await targets()).find(t => t.url === `${origin}/a` && !before.includes(t.id)), 'reset session reopened'));
  assert.equal(await returned.evaluate('document.cookie'), '', 'old session cookies do not return');
  await stop();
  console.log('PASS site reset confirmation, cancellation, cookies/all paths, local/session storage, IndexedDB, CacheStorage, service workers, session and site isolation');
  console.log(`Evidence: ${base}`);
}

export async function runSiteSessions(ctx) {
  const { profile, origin, serverPort, siteRequests, waitFor, connect, targets, command, state, launch, stop } = ctx;
  const activeTab = async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId);
  };
  const other = `http://localhost:${serverPort}`;
  const first = (await state()).activeId;
  const catalog = JSON.parse(await readFile(resolve(profile, 'tab-sessions.json'), 'utf8'));
  const admin = catalog.find(s => s.Name === 'Admin').Id;
  const user = catalog.find(s => s.Name === 'User').Id;

  const documentAt = async (url, exclude = []) =>
    waitFor(async () => {
      for (const target of (await targets()).filter(t => t.url === url && !exclude.includes(t.id))) {
        const page = await connect(target);
        if (await page.evaluate(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&!!window.__navBlurHost&&!!document.querySelector('h1')`)) {
          return page;
        }
      }
    }, `site document ${url}`);

  const switched = async (id, session, url) => {
    const old = (await targets()).map(t => t.id);
    await command({ type: 'session.set', id, query: session });
    return documentAt(url, old);
  };

  let page = await documentAt(`${origin}/a`);
  page = await switched(first, admin, `${origin}/a`);
  await page.evaluate("document.cookie='account=admin;path=/';localStorage.account='admin'");
  await command({ type: 'tab.open', url: 'https://start.sol/index.html#start' });
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === 'https://start.sol/index.html#start';
  }, 'new start');
  assert.equal((await activeTab())?.sessionId, '');
  await command({ type: 'tab.close', id: (await state()).activeId });

  await command({ type: 'tab.open', url: `${other}/b` });
  page = await documentAt(`${other}/b`);
  let id = (await state()).activeId;
  assert.equal((await state()).tabs.find(t => t.id === id).sessionId, '', 'unselected site defaults to current session');
  assert.equal(await page.evaluate('document.cookie'), '', 'new site does not inherit account');

  page = await switched(id, user, `${other}/b`);
  await page.evaluate("document.cookie='account=user;path=/';localStorage.account='user'");
  assert.equal(await page.evaluate('document.cookie'), 'account=user');

  await command({ type: 'nav.go', id, input: `${origin}/address-return` });
  page = await documentAt(`${origin}/address-return`);
  assert.equal((await state()).tabs.find(t => t.id === id).sessionId, admin, 'address navigation restores this site choice');
  assert.equal(await page.evaluate('localStorage.account'), 'admin');
  await page.evaluate("sessionStorage.authState='kept'");

  const authUrl = `${other}/__/auth/handler?client_id=fixture&redirect_uri=${encodeURIComponent(`${origin}/oauth-return`)}`;
  await page.evaluate(`location.href=${JSON.stringify(authUrl)}`);
  page = await documentAt(authUrl);
  assert.equal((await activeTab()).sessionId, admin, 'authentication keeps initiating profile');

  const callbackUrl = `${origin}/address-return?state=fixture&code=fixture`;
  await page.evaluate(`location.href=${JSON.stringify(callbackUrl)}`);
  page = await documentAt(callbackUrl);
  assert.equal(await page.evaluate('sessionStorage.authState'), 'kept', 'redirect retains sessionStorage');

  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await delay(200);
  await page.evaluate(`document.querySelector('main').innerHTML='<a href="${other}/clicked#section">Other site</a>'`);
  const point = await page.evaluate("(()=>{const r=document.querySelector('a').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }).catch(e => {
    if (e.message !== 'CDP timeout: Input.dispatchMouseEvent') throw e;
  });

  page = await documentAt(`${other}/clicked#section`);
  assert.equal((await state()).tabs.find(t => t.id === id).sessionId, user, 'page link with fragment restores destination session');
  assert.equal(await page.evaluate('localStorage.account'), 'user');
  assert.equal(await page.evaluate('document.cookie'), 'account=user', 'session cookies survive switching away and back');
  assert.equal(siteRequests.find(r => r.host === new URL(other).host && r.url === '/clicked')?.cookie, 'account=user', 'first link request uses destination session');

  await page.evaluate(`void window.open('${origin}/new-window','_blank')`);
  let child = await documentAt(`${origin}/new-window`);
  let childId = (await state()).tabs.find(t => t.url === `${origin}/new-window`).id;
  assert.equal((await state()).tabs.find(t => t.id === childId).sessionId, user, 'popup retains initiating session');
  assert.equal(await child.evaluate('!!window.opener'), true, 'popup retains window.opener');
  await page.evaluate("window.addEventListener('message',e=>{if(e.data==='auth-complete')window.popupResult=true})");
  await child.evaluate("window.opener.postMessage('auth-complete','*')");
  await waitFor(() => page.evaluate('window.popupResult===true'), 'popup communicates with opener');
  assert.equal(await child.evaluate('document.cookie'), '', 'popup cannot inherit another profile cookies');
  await child.evaluate('window.close()');
  await waitFor(async () => !(await state()).tabs.some(t => t.id === childId), 'script closes its popup');

  await command({ type: 'tab.activate', id: first });
  await command({ type: 'tab.open', url: `${other}/remembered` });
  page = await documentAt(`${other}/remembered`);
  assert.equal((await activeTab()).sessionId, user, 'new tabs use remembered site');

  await command({ type: 'tab.open', url: `${origin}/site-redirect` });
  child = await documentAt(`${other}/signed-in`);
  childId = (await waitFor(async () => (await state()).tabs.find(t => t.url === `${other}/signed-in`), 'redirect tab')).id;
  assert.equal((await state()).tabs.find(t => t.id === childId).sessionId, admin, 'authentication redirects retain initiating session');

  await command({ type: 'nav.go', id: childId, input: `${origin}/back-to-site` });
  child = await documentAt(`${origin}/back-to-site`);
  await child.evaluate(`document.querySelector('main').insertAdjacentHTML('beforeend','<iframe src="${other}/embedded"></iframe>')`);
  await waitFor(() => siteRequests.some(r => r.host === new URL(other).host && r.url === '/embedded'), 'embedded frame request');
  await delay(350);
  assert.equal((await state()).tabs.find(t => t.id === childId).sessionId, admin, 'embedded sites do not switch the parent session');

  await child.evaluate(`document.querySelector('main').innerHTML='<form method="post" action="${other}/form-result"><input name="value" value="test"></form>';document.querySelector('form').requestSubmit()`);
  await documentAt(`${other}/form-result`);
  assert.equal((await state()).tabs.find(t => t.id === childId).sessionId, admin, 'form posts retain their initiating session');
  await command({ type: 'tab.close', id: childId });

  await command({ type: 'tab.activate', id: first });
  page = await documentAt(`${origin}/a`);
  await page.evaluate("sessionStorage.pending='preserve';document.querySelector('main').innerHTML='<input value=initial>';document.querySelector('input').value='unsaved'");
  await command({ type: 'tab.open', url: `${origin}/idle` });
  await delay(23000);
  assert.equal((await state()).tabs.find(t => t.id === first).asleep, false, 'stateful tab is retained');
  await command({ type: 'tab.activate', id: first });
  assert.equal(await page.evaluate('sessionStorage.pending'), 'preserve', 'wake retains storage');
  assert.equal(await page.evaluate("document.querySelector('input').value"), 'unsaved', 'wake retains form');
  await page.evaluate("document.querySelector('input').click();document.querySelector('input').value='interactive'");
  assert.equal(await page.evaluate("document.querySelector('input').value"), 'interactive', 'resumed page responds');

  await delay(2300);
  await stop();
  await launch();
  await command({ type: 'tab.open', url: `${other}/restart` });
  page = await documentAt(`${other}/restart`);
  id = (await state()).activeId;
  assert.equal((await state()).tabs.find(t => t.id === id).sessionId, user, 'site choice persists after restart');
  page = await switched(id, '', `${other}/restart`);
  await command({ type: 'tab.open', url: `${other}/default-again` });
  await documentAt(`${other}/default-again`);
  assert.equal((await activeTab()).sessionId, '', 'explicit current session removes site override');

  const requested = (host, url) => siteRequests.find(r => r.host === new URL(host).host && r.url === url);
  assert.equal(requested(origin, '/address-return').cookie, 'account=admin', 'first destination request sends only its chosen account');
  assert.equal(requested(other, '/clicked').cookie, 'account=user', 'link destination request sends only its chosen account');
  assert.equal(requested(origin, '/new-window').cookie, undefined, 'popup does not leak the destination profile cookies');

  const guest = catalog.find(s => s.Name === 'Invité').Id;
  const rapid = (await state()).activeId;
  await command({ type: 'session.set', id: rapid, query: guest });
  await delay(450);
  await switched(rapid, '', `${other}/default-again`);
  await switched(rapid, guest, `${other}/default-again`);
  assert.equal((await activeTab()).sessionId, guest, 'session remains usable after closing during initialization');
  await stop();
  console.log('PASS per-site session defaults, remembered choices, links/new windows, cookies, redirects, restart and reset');
}
