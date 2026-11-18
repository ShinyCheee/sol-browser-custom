import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFixtureServer } from './server.mjs';

export async function createNavigationHarness(argv = process.argv) {
  const exeArg = argv.slice(2).find(arg => !arg.startsWith('--'));
  const exe = resolve(exeArg ?? 'src/Browser.App/bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Sol.exe');
  const base = resolve(`bin/navigation-check-${Date.now()}`);
  const profile = resolve(base, 'profiles/robustness');

  await mkdir(profile, { recursive: true });
  await mkdir(resolve(base, 'downloads'), { recursive: true });
  await mkdir(resolve(base, 'captures'), { recursive: true });

  const fixture = await startFixtureServer(argv);
  const { server, serverPort, origin, echoRequests, sessionRequests, siteRequests, getMarkdownImageRequests } = fixture;

  const debugPort = createServer();
  debugPort.listen(0, '127.0.0.1');
  await once(debugPort, 'listening');
  const port = debugPort.address().port;
  await new Promise(r => debugPort.close(r));

  await writeFile(
    resolve(profile, 'settings.json'),
    JSON.stringify({
      Onboarded: true,
      Theme: 'dark',
      HomePage: `${origin}/a`,
      OnlineSuggestions: false,
      LiveColor: false,
      ...(argv.includes('--start-refresh') ? { Shortcuts: [], StartWallpaper: false } : {}),
      ...(argv.includes('--sol-ai') ? { SolAiCategories: true, StartWallpaper: false } : {}),
    }),
  );

  if (argv.includes('--sol-ai')) {
    await writeFile(
      resolve(profile, 'ai-categories.json'),
      JSON.stringify({ UpdatedAt: new Date().toISOString(), Names: ['Développement', 'Actualités'], Sites: { '127.0.0.1': 'Développement' } }),
    );
  }
  if (argv.includes('--sessions') || argv.includes('--site-reset') || argv.includes('--site-sessions')) {
    const id = () => crypto.randomUUID().replaceAll('-', '');
    const site = new URL(origin).host;
    await writeFile(
      resolve(profile, 'tab-sessions.json'),
      JSON.stringify(['Admin', 'User', 'Invité'].map(Name => ({ Id: id(), Name, Site: site }))),
    );
  }
  if (argv.includes('--site-reset')) {
    await writeFile(
      resolve(profile, 'permissions.json'),
      JSON.stringify({ [`${origin} Camera`]: true, [`http://localhost:${serverPort} Camera`]: true }),
    );
  }
  if (argv.includes('--history')) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(resolve(profile, 'browser.db'));
    db.exec(
      'CREATE TABLE visits (url TEXT PRIMARY KEY, title TEXT NOT NULL, count INTEGER NOT NULL, last INTEGER NOT NULL); ' +
        'CREATE TABLE bookmarks (url TEXT PRIMARY KEY, title TEXT NOT NULL, added INTEGER NOT NULL)',
    );
    const insert = db.prepare('INSERT INTO visits VALUES (?, ?, 1, ?)');
    for (let i = 0; i < 125; i++) {
      insert.run(`https://import.test/${i}`, i === 0 ? 'Older imported target' : `Imported ${i}`, Date.now() - 30 * 86400000 + i * 60000);
    }
    db.prepare('INSERT INTO bookmarks VALUES (?, ?, ?)').run('https://import.test/favorite', 'Older imported target favorite', Date.now());
    db.close();
  }

  let app = null;
  let uiConn = null;
  const connections = [];

  const waitFor = async (get, description, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        const value = await get();
        if (value) return value;
      } catch (e) {
        if (e.code !== 'EBUSY' && !/Cannot find default execution context|Execution context was destroyed|CDP target unavailable/.test(e.message)) {
          throw e;
        }
      }
      await delay(100);
    }
    throw new Error(`Timed out: ${description}`);
  };

  async function connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    try {
      await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    } catch {
      ws.close();
      throw new Error('CDP target unavailable');
    }
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { resolve: ok, reject: fail, timer } = pending.get(m.id);
        clearTimeout(timer);
        pending.delete(m.id);
        if (m.error) fail(new Error(m.error.message));
        else ok(m.result);
      }
    });
    const call = (method, params = {}) =>
      new Promise((ok, fail) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(id, { resolve: ok, reject: fail, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async expression => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    connections.push(ws);
    await waitFor(() => evaluate('typeof document === "undefined" || !!document.body'), 'document.body', 5000);
    return { call, evaluate };
  }

  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => []);
  const command = c => uiConn.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
  const state = () => uiConn.evaluate('window.__checkState');

  async function hotkey(action, withoutAlt = false) {
    const registry = await readFile(resolve('src/Browser.Core/BrowserShortcuts.cs'), 'utf8');
    const actions = [...registry.matchAll(/new\(0x[0-9A-F]+,(\d+),"([^"]+)"/g)].map(m => ({ modifiers: Number(m[1]), action: m[2] }));
    const index = actions.findIndex(s => s.action === action && (!withoutAlt || !(s.modifiers & 1)));
    assert.ok(index >= 0, `registered shortcut: ${action}`);
    const script =
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class SolCheck{[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}';` +
      `$p=Get-Process -Id ${app.pid};if($p.MainWindowHandle -eq 0){exit 2};if(-not [SolCheck]::PostMessage($p.MainWindowHandle,0x312,[IntPtr]${index},[IntPtr]::Zero)){exit 3}`;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    assert.equal((await once(proc, 'exit'))[0], 0, 'native shortcut dispatch');
  }

  async function launch(extra = []) {
    const bounds = argv.includes('--small') ? '--bounds=-9000,-9000,400,400' : '--bounds=-9000,-9000,1100,800';
    app = spawn(exe, ['--profile=robustness', bounds, ...extra], {
      windowsHide: true,
      env: {
        ...process.env,
        NAVIGATEUR_DATA_DIR: base,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`,
        NAVIGATEUR_DEBUG: '1',
        NAVIGATEUR_TEST_DOWNLOAD_DIR: resolve(base, 'downloads'),
        NAVIGATEUR_CAPTURE_DIR: resolve(base, 'captures'),
        NAVIGATEUR_SAVER_TEST: '1',
      },
    });
    const target = await waitFor(async () => (await targets()).find(t => t.url === 'https://ui.navigateur/index.html'), 'toolbar');
    uiConn = await connect(target);
    await waitFor(
      async () => {
        await uiConn.evaluate(`if (!window.__checkListening) {
          window.__checkListening = true;
          chrome.webview.addEventListener('message', e => { window.__checkLastMessage = e.data; if (e.data.tabs) window.__checkState = e.data; });
        } chrome.webview.postMessage(JSON.stringify({type:'ui.ready'}));`);
        return (await state())?.tabs?.length;
      },
      'browser state',
      40000,
    );
  }

  async function pageAt(path) {
    return waitFor(async () => {
      const target = (await targets()).find(t => t.url === `${origin}${path}`);
      if (!target) return;
      const page = await connect(target);
      if (await page.evaluate(`document.readyState === "complete" && location.href === ${JSON.stringify(`${origin}${path}`)}`)) return page;
    }, `page ${path}`);
  }

  async function stop() {
    if (!app || app.exitCode !== null) return;
    const exited = once(app, 'exit');
    await command({ type: 'window.close' });
    await exited;
  }

  async function dumpDiagnostics() {
    if (argv.includes('--site-sessions') && uiConn) {
      console.error('SITE STATE', JSON.stringify((await state()).tabs.map(({ id, url, sessionId, loading, asleep }) => ({ id, url, sessionId, loading, asleep }))));
      console.error('SITE REQUESTS', JSON.stringify(siteRequests.filter(r => r.url === '/clicked')));
    }
    const manager = (await targets()).find(t => t.url.endsWith('#popup'));
    if (manager) {
      console.error('MANAGER', await (await connect(manager)).evaluate('JSON.stringify(window.__extensions,(key,value)=>key === "icon" ? undefined : value)'));
    }
    if (uiConn) {
      console.error(await uiConn.evaluate('JSON.stringify({ready:document.readyState,listening:window.__checkListening,lastEvent:window.__checkLastMessage?.event,text:document.body?.innerText.slice(0,300)})').catch(() => 'UI unavailable'));
    }
    console.error(await readFile(resolve(profile, 'debug.log'), 'utf8').catch(() => 'No diagnostic log'));
  }

  function cleanup() {
    for (const ws of connections) ws.close();
    if (app && app.exitCode === null) app.kill();
    server.close();
  }

  return {
    argv,
    exe,
    base,
    profile,
    origin,
    serverPort,
    port,
    echoRequests,
    sessionRequests,
    siteRequests,
    getMarkdownImageRequests,
    get ui() { return uiConn; },
    get appPid() { return app?.pid; },
    waitFor,
    connect,
    targets,
    command,
    state,
    hotkey,
    launch,
    pageAt,
    stop,
    dumpDiagnostics,
    cleanup,
  };
}
