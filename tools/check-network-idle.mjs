import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { sidebarHost } from './sidebar-check-host.mjs';

const host = await sidebarHost(process.argv[2] ?? 'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe', { performance: true });
try {
  const ui = await host.launch(760, 1000, 60000);
  const command = c => ui.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
  const page = await host.connect(host.origin + '/2');
  await command({ type: 'network.toggle' });
  const panel = await host.connect('#panel');
  await panel.evaluate(`chrome.webview.addEventListener('message', e => { if(e.data.panel === 'network') window.__network = e.data; })`);
  await page.evaluate(`console.log('before-close-marker'); fetch('/before-close-marker')`);
  await host.wait(() => panel.evaluate(`window.__network?.console.some(e => e.text.includes('before-close-marker'))`), 'network captures while open');
  await command({ type: 'network.toggle' });
  await delay(500);
  await page.evaluate(`console.log('closed-panel-marker'); fetch('/closed-panel-marker')`);
  await delay(600);
  await command({ type: 'network.toggle' });
  await page.evaluate(`console.log('after-reopen-marker'); fetch('/after-reopen-marker')`);
  await host.wait(() => panel.evaluate(`window.__network?.console.some(e => e.text.includes('after-reopen-marker'))`), 'capture resumes on reopening');
  const state = await panel.evaluate('window.__network');
  assert(state.console.some(e => e.text.includes('before-close-marker')), 'existing history is preserved');
  assert(!state.console.some(e => e.text.includes('closed-panel-marker')), 'closed inspector must stop console collection');
  assert(!state.items.some(e => e.url.includes('/closed-panel-marker')), 'closed inspector must stop request collection');
  await host.close(ui);
  console.log('PASS: inspector stops collection while closed, keeps history and resumes on reopening');
} finally { await host.dispose(); }
