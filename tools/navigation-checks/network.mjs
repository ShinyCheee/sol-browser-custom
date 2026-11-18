import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runNetworkLot(ctx) {
  const { argv, base, origin, echoRequests, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  if (argv.includes('--private-check')) assert.equal((await state()).privateMode, true);
  const page = await pageAt('/a');
  const id = (await state()).activeId;
  await command({ type: 'network.toggle' });
  const panel = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#panel')), 'network panel'));
  await waitFor(() => panel.evaluate("document.readyState==='complete'&&!!document.querySelector('.net')"), 'panel ready');
  await panel.evaluate("chrome.webview.addEventListener('message',e=>{if(e.data.panel==='network')window.__tools=e.data})");
  await command({ type: 'network.ready' });
  const tools = () => panel.evaluate('window.__tools');
  await waitFor(async () => (await tools())?.tabId === id, 'network tab');

  await page.evaluate("document.cookie='session=fixture-cookie';console.warn('password=fixture-secret');fetch('/api-real')");
  await waitFor(async () => (await tools()).console.some(line => line.text.includes('[masqué]')), 'console capture with redaction');
  assert.ok(!(await tools()).console.some(line => line.text.includes('fixture-secret')));

  const draft = {
    Url: `${origin}/echo`,
    Method: 'POST',
    Headers: { 'Content-Type': 'text/plain' },
    Body: 'explicit payload',
    Status: 200,
    Delay: 0,
    Mode: 'response',
  };
  await command({ type: 'network.replay', id, input: JSON.stringify(draft) });
  await waitFor(async () => (await tools()).result?.status === 200 && !(await tools()).busy, 'replay result');
  assert.equal(echoRequests.at(-1).body, 'explicit payload');
  assert.equal(echoRequests.at(-1).headers.cookie, undefined, 'replay has no site cookie');
  assert.ok(!(await tools()).result.body.includes('fixture-secret'), 'response secret redacted');

  const before = echoRequests.length;
  await command({ type: 'network.replay', id, input: JSON.stringify({ ...draft, Url: `${origin}/redirect-once` }) });
  await waitFor(async () => (await tools()).result?.status === 307 && !(await tools()).busy, 'redirect response');
  assert.equal(echoRequests.length, before, 'redirect not followed');

  const mock = {
    ...draft,
    Url: `${origin}/api-real`,
    Method: 'GET',
    Headers: { 'Content-Type': 'application/json' },
    Body: '{"mock":true}',
    Status: 503,
  };
  const activate = async options => {
    await command({ type: 'network.mock', id, input: JSON.stringify(options) });
    await waitFor(async () => (await tools()).mock?.Mode === options.Mode && !(await tools()).mockBusy, 'mock ready');
  };
  const fetchResult = () => page.evaluate("fetch('/api-real').then(async r=>({status:r.status,body:await r.text()})).catch(()=>({error:true}))");

  await activate(mock);
  assert.deepEqual(await fetchResult(), { status: 503, body: '{"mock":true}' }, 'real Fetch interception');
  assert.equal(
    await page.evaluate("new Promise(resolve=>{const r=new XMLHttpRequest();r.onload=()=>resolve(r.status);r.open('GET','/api-real');r.send()})"),
    503,
    'XHR interception',
  );

  await activate({ ...mock, Mode: 'invalid' });
  assert.equal((await fetchResult()).body, '{');
  await activate({ ...mock, Mode: 'empty' });
  assert.equal((await fetchResult()).body, '');
  await activate({ ...mock, Mode: 'timeout' });
  assert.equal((await fetchResult()).error, true);

  await activate({ ...mock, Mode: 'response', Delay: 180 });
  const start = Date.now();
  await fetchResult();
  assert.ok(Date.now() - start >= 150, 'mock delay');

  await command({ type: 'network.unmock', id });
  await waitFor(async () => !(await tools()).mock, 'mock disabled');
  assert.equal((await fetchResult()).body, '{"real":true}', 'normal request after disable');

  await activate({ ...mock, Mode: 'response', Delay: 5000 });
  await page.evaluate("window.__delayed=fetch('/api-real').then(r=>r.text()).catch(()=> 'failed');true");
  await delay(150);
  await command({ type: 'network.unmock', id });
  await waitFor(async () => !(await tools()).mock, 'cancel delayed mock');
  assert.equal(await page.evaluate('window.__delayed'), '{"real":true}', 'disable resumes paused request');

  const crossUrl = `${origin.replace('127.0.0.1', 'localhost')}/api-real`;
  await activate({ ...mock, Url: crossUrl, Mode: 'response' });
  assert.equal(await page.evaluate(`fetch(${JSON.stringify(crossUrl)}).then(()=>true).catch(()=>false)`), false, 'CORS remains enforced');
  await command({ type: 'network.unmock', id });
  await waitFor(async () => !(await tools()).mock, 'cross mock disabled');

  await page.evaluate("fetch('/api-real')");
  await waitFor(async () => (await tools()).items.some(r => r.url.endsWith('/api-real')), 'request row');
  const row = (await tools()).items.find(r => r.url.endsWith('/api-real'));
  await command({ type: 'network.detail', id: row.id });
  await waitFor(() => panel.evaluate("!!document.querySelector('.net-edit')"), 'edit request');
  await panel.evaluate("document.querySelector('.net-edit').click()");
  await waitFor(() => panel.evaluate("!!document.querySelector('.net-composer')"), 'composer shown');
  await panel.evaluate("document.querySelector('.net-compose-url input').focus();document.querySelector('.net-compose-url input').select()");
  await panel.call('Input.insertText', { text: `${origin}/echo` });
  const uiBefore = echoRequests.length;
  await panel.evaluate("document.querySelector('.net-compose-actions button').click()");
  await waitFor(async () => echoRequests.length > uiBefore && (await tools()).result?.status === 200 && !(await tools()).busy, 'composer sends request');
  assert.ok(await panel.evaluate("document.querySelector('.net-composer .net-body').textContent.includes('received')"), 'reply visible in composer');

  await command({ type: 'network.replay', id, input: JSON.stringify({ ...draft, Url: `${origin}/slow` }) });
  await waitFor(async () => (await tools()).busy, 'cancelable replay started');
  await panel.evaluate("Array.from(document.querySelectorAll('.net-compose-actions button')).find(b=>b.textContent==='Annuler').click()");
  await waitFor(async () => (await tools()).result?.error === 'canceled' && !(await tools()).busy, 'replay canceled');

  for (const theme of [1, 2]) {
    for (const scale of [0, 1, 2]) {
      await command({ type: 'settings.set', id: 'theme', index: theme });
      await command({ type: 'settings.set', id: 'uiScale', index: scale });
      await delay(100);
      assert.ok(await panel.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'network fits all scales');
    }
  }
  await panel.call('Page.captureScreenshot', { format: 'png' }).then(r => writeFile(resolve(base, 'network-composer.png'), Buffer.from(r.data, 'base64')));

  await activate(mock);
  await command({ type: 'network.toggle' });
  assert.equal((await fetchResult()).body, '{"real":true}', 'closing tools disables mock');
  await command({ type: 'network.toggle' });
  await waitFor(async () => (await tools()).tabId === id, 'reopen tools');

  await page.evaluate("navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready)");
  await waitFor(() => page.evaluate('!!navigator.serviceWorker.controller'), 'service worker controls page');
  await activate(mock);
  const swResult = await fetchResult();
  assert.ok(['{"serviceworker":true}', '{"mock":true}'].includes(swResult.body), 'service worker response or supported interception');
  console.log(`PASS service worker: ${swResult.body}`);
  await command({ type: 'network.unmock', id });
  await waitFor(async () => !(await tools()).mock, 'stop service worker mock');

  await activate(mock);
  await command({ type: 'tab.open', url: `${origin}/b` });
  const other = await pageAt('/b');
  await waitFor(async () => (await tools()).tabId !== id, 'tools follow second tab');
  assert.equal(await other.evaluate("fetch('/api-real').then(r=>r.text())"), '{"serviceworker":true}', 'mock does not leak into another tab');
  await command({ type: 'tab.activate', id });
  await waitFor(async () => (await tools()).tabId === id, 'return to original tab');
  await command({ type: 'network.unmock', id });
  await stop();
  console.log('PASS network replay isolation, redirects, Fetch/XHR mocks, delay/timeout/invalid/empty, CORS, console, redaction and UI');
}
