import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sidebarHost } from './sidebar-check-host.mjs';

const exe = process.argv[2] ?? 'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe';
const host = await sidebarHost(exe);
const cmd = (ui, c) => ui.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
const getState = ui => ui.evaluate('window.__sidebarState');

const psInspect = pid => {
  const script = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices; using System.Collections.Generic; using System.Text;',
    'public static class WCheck {',
    '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);',
    '  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);',
    '  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);',
    '  [DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);',
    '  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, R2, B; }',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '  public static object[] Inspect(int[] pids) {',
    '    var list = new List<object>();',
    '    EnumWindows((h, _) => {',
    '      int p; GetWindowThreadProcessId(h, out p);',
    '      if (Array.IndexOf(pids, p) < 0 || !IsWindowVisible(h)) return true;',
    '      var cls = new StringBuilder(128); GetClassName(h, cls, 128);',
    '      var txt = new StringBuilder(256); GetWindowText(h, txt, 256);',
    '      int ex = GetWindowLong(h, -20);',
    '      IntPtr owner = GetWindow(h, 4);',
    '      bool ownerVisible = owner != IntPtr.Zero && IsWindowVisible(owner);',
    '      bool inTaskbar = (ex & 0x40000) != 0 || ((ex & 0x80) == 0 && owner == IntPtr.Zero);',
    '      bool inAltTab = (ex & 0x40000) != 0 || ((ex & 0x80) == 0 && (owner == IntPtr.Zero || ownerVisible));',
    '      R r; GetWindowRect(h, out r);',
    '      IntPtr lp = (IntPtr)((((r.T + r.B) / 2) << 16) | ((r.L + 2) & 0xFFFF));',
    '      int htLeft = (ex & 8) != 0 ? (int)SendMessageW(h, 0x84, IntPtr.Zero, lp) : 0;',
    '      int cloaked; bool onScreen = MonitorFromWindow(h, 0) != IntPtr.Zero && DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked == 0;',
    '      list.Add(new { hwnd = h.ToInt64(), pid = p, cls = cls.ToString(), title = txt.ToString(), inTaskbar, inAltTab, app = (ex & 0x40000) != 0, topMost = (ex & 8) != 0, htLeft, onScreen, minimized = IsIconic(h) });',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return list.ToArray();',
    '  }',
    '}',
    '"@',
    `$procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId); $ids = @(${pid})`,
    'do { $kids = @($procs | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { [int]$_.ProcessId }); $ids += $kids } while ($kids.Count)',
    'ConvertTo-Json @([WCheck]::Inspect([int[]]$ids)) -Compress',
  ].join('\n');
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
};

let ui;
try {
  ui = await host.launch();
  const s0 = await getState(ui);
  const activeGroupTab = s0.tabs[2];
  const siblingGroupTab = s0.tabs[3];
  const sleepingFreeTab = s0.tabs[6];

  // A. Closing an inactive/sleeping tab never changes activeId or wakes anything.
  await cmd(ui, { type: 'tab.close', id: sleepingFreeTab.id });
  await host.wait(async () => !(await getState(ui)).tabs.some(t => t.id === sleepingFreeTab.id), 'sleeping tab closed');
  const sA = await getState(ui);
  assert.equal(sA.activeId, activeGroupTab.id, 'closing sleeping tab keeps activeId');
  assert.equal(sA.tabs.filter(t => !t.asleep).length, 1, 'closing sleeping tab wakes nothing');
  console.log('PASS A: closing background/sleeping tab never switches or wakes tabs');

  // B. Closing a tab in an expanded group stays on an awake tab of that same group.
  await cmd(ui, { type: 'tab.activate', id: siblingGroupTab.id });
  const sibPage = await host.connect(siblingGroupTab.url);
  await host.wait(() => sibPage.evaluate('document.readyState === "complete"').catch(() => false), 'sibling awake');
  await cmd(ui, { type: 'tab.activate', id: activeGroupTab.id });
  await host.wait(async () => (await getState(ui)).activeId === activeGroupTab.id, 'back on first group tab');
  await cmd(ui, { type: 'tab.close', id: activeGroupTab.id });
  await host.wait(async () => (await getState(ui)).activeId === siblingGroupTab.id, 'stays on awake tab in same expanded group');
  assert.equal((await getState(ui)).tabs.find(t => t.id === activeGroupTab.id)?.asleep, true, 'closed group tab put to sleep');
  console.log('PASS B: closing tab in open group stays on awake tab of that same group');

  // C. Closing the last awake tab in the group opens a new HomePage tab without waking sleeping/pinned/other-group tabs.
  const beforeIds = new Set((await getState(ui)).tabs.map(t => t.id));
  await cmd(ui, { type: 'tab.close', id: siblingGroupTab.id });
  await host.wait(async () => !beforeIds.has((await getState(ui)).activeId), 'new tab opened');
  const sC = await getState(ui);
  const newTab = sC.tabs.find(t => t.id === sC.activeId);
  assert.equal(newTab.url, `${host.origin}/home`, 'new HomePage tab opened');
  assert.equal(newTab.groupId, null, 'new tab is ungrouped');
  assert.equal(newTab.pinned, false, 'new tab is unpinned');
  assert.equal(sC.tabs.filter(t => !t.asleep).length, 1, 'only the new tab is awake; zero sleeping tabs woken');
  console.log('PASS C: closing last awake group tab opens new tab without waking sleeping/pinned/other-group tabs');

  // D. Document PiP auto-popout blocked + native video PiP hidden from Taskbar & Alt-Tab + MRU free tab return.
  const free1Page = await host.connect(`${host.origin}/home`);
  await host.wait(() => free1Page.evaluate('document.readyState === "complete"').catch(() => false), 'free1 loaded');
  const docPipRejected = await free1Page.evaluate(
    'window.documentPictureInPicture ? window.documentPictureInPicture.requestWindow().then(() => false, e => e.name === "NotAllowedError") : true',
  );
  assert.equal(docPipRejected, true, 'Document Picture-in-Picture auto-popout blocked');

  await free1Page.evaluate(`(async () => {
    const v = document.createElement('video'); v.muted = true; v.style.cssText = 'width:480px;height:270px';
    const c = document.createElement('canvas'); c.width = 480; c.height = 270;
    const g = c.getContext('2d'); setInterval(() => { g.fillStyle = 'teal'; g.fillRect(0, 0, 480, 270); }, 50);
    v.srcObject = c.captureStream(20); document.body.append(v); await v.play();
  })()`);

  // Hold the isolated-world promise after the native window appears to make the race deterministic.
  const tree = await free1Page.call('Page.getFrameTree');
  const { executionContextId: contextId } = await free1Page.call('Page.createIsolatedWorld', {
    frameId: tree.frameTree.frame.id, worldName: 'Sol PiP',
  });
  const instrument = await free1Page.call('Runtime.evaluate', { contextId, expression: `(() => {
    const open = HTMLVideoElement.prototype.requestPictureInPicture;
    HTMLVideoElement.prototype.requestPictureInPicture = async function () {
      const release = new Promise(resolve => addEventListener('sol-test-player-ready', resolve, { once: true }));
      const window = await open.call(this);
      await release;
      return window;
    };
  })()` });
  assert.equal(instrument.exceptionDetails, undefined, 'isolated-world player instrument installed');
  await cmd(ui, { type: 'tab.open', url: `${host.origin}/free2` });
  await host.wait(async () => (await getState(ui)).tabs.some(t => t.url === `${host.origin}/free2`), 'free2 opened');
  const free2Id = (await getState(ui)).activeId;
  await host.wait(() => free1Page.evaluate('!!document.pictureInPictureElement'), 'native PiP appears during opening');
  await cmd(ui, { type: 'tab.open', url: `${host.origin}/free3` });
  const free3Id = await host.wait(async () => (await getState(ui)).tabs.find(t => t.url === `${host.origin}/free3`)?.id, 'free3 opened');
  await free1Page.evaluate(`dispatchEvent(new Event('sol-test-player-ready'))`);
  assert.equal(await host.wait(async () => {
    const log = await readFile(resolve(host.profile, 'debug.log'), 'utf8');
    if (log.includes(`pip.enter ${newTab.id}`)) return 'open';
    return (await free1Page.evaluate('!!document.pictureInPictureElement')) ? null : 'closed';
  }, 'player opening settles'), 'open', 'another tab switch must not cancel the opening player');

  const winCheck = psInspect(host.pid);
  console.log('Visible windows in Sol tree:', JSON.stringify(winCheck));
  const pipWin = winCheck.find(w => w.cls === 'Chrome_WidgetWin_1' && w.topMost);
  assert(pipWin, 'PiP window exists');
  assert.equal(pipWin.inTaskbar, false, 'PiP window hidden from Windows Taskbar');
  assert.equal(pipWin.inAltTab, false, 'PiP window hidden from Alt+Tab');
  assert.equal(pipWin.app, false, 'PiP window does not have WS_EX_APPWINDOW');
  assert.equal(pipWin.htLeft, 10, 'PiP native resize border intact (HTLEFT=10)');
  assert.equal(pipWin.onScreen, true, 'PiP is on screen and not cloaked');
  const taskbarEligible = winCheck.filter(w => w.inTaskbar);
  const altTabEligible = winCheck.filter(w => w.inAltTab);
  assert.equal(taskbarEligible.length, 1, `Expected strictly 1 taskbar window (MainWindow), saw ${JSON.stringify(taskbarEligible)}`);
  assert.equal(altTabEligible.length, 1, `Expected strictly 1 Alt+Tab window (MainWindow), saw ${JSON.stringify(altTabEligible)}`);
  console.log('PASS D1: strictly 1 taskbar/Alt+Tab window (PiP hidden from Taskbar & Alt-Tab)');

  await cmd(ui, { type: 'window.minimize' });
  await delay(350);
  const minimized = psInspect(host.pid);
  assert.ok(minimized.some(w => w.pid === host.pid && w.minimized), 'the main window is minimized');
  assert.ok(minimized.some(w => w.hwnd === pipWin.hwnd && w.onScreen && w.topMost), 'PiP remains visible when Sol is minimized');
  assert.equal(await free1Page.evaluate('!!document.pictureInPictureElement'), true, 'the video stays in native PiP');
  console.log('PASS native player stays on screen during fast navigation and when Sol is minimized');

  await cmd(ui, { type: 'tab.close', id: free3Id });
  await host.wait(async () => (await getState(ui)).activeId === free2Id, 'closing Free3 returns to Free2');
  await cmd(ui, { type: 'tab.close', id: free2Id });
  await host.wait(async () => (await getState(ui)).activeId === newTab.id, 'closing Free2 returns to previous free awake tab Free1');
  console.log('PASS D2: closing Free2 returns to most recent free awake tab');
} finally {
  if (ui) await host.close(ui).catch(() => {});
  await host.dispose();
}
