import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runBaseStartAndPrivate } from './base-start-and-private.mjs';

export async function runBaseNavigation(ctx) {
  const { base, profile, origin, waitFor, connect, targets, command, state, launch, pageAt, stop } = ctx;
  let s = await state();
  const first = s.activeId;
  const page = await pageAt('/a');
  const iconSidebar = await connect((await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'));
  await waitFor(() => iconSidebar.evaluate('Array.from(document.querySelectorAll("img.favicon")).some(i=>i.naturalWidth === 192)'), 'high resolution icon also used in sidebar');

  const initialWidth = await page.evaluate('innerWidth');
  await command({ type: 'zoom.out' });
  await waitFor(async () => (await state()).tabs.find(t => t.id === first)?.zoom === 90, '90% zoom');
  await waitFor(async () => (await page.evaluate('innerWidth')) > initialWidth * 1.08, 'zoom changes layout');

  await command({ type: 'tab.open' });
  await waitFor(async () => (await state()).tabs.length === 2, 'new tab');
  s = await state();
  assert.equal(s.tabs.find(t => t.id === s.activeId).zoom, 90, 'new pages must inherit the profile zoom');
  await waitFor(() => ctx.ui.evaluate('document.activeElement?.matches(".address-pill input")'), 'new tab search focus');
  await waitFor(() => ctx.ui.evaluate('document.documentElement.classList.contains("painted")'), 'first painted toolbar');
  assert.equal(await ctx.ui.evaluate('document.documentElement.dataset.theme'), 'dark', 'startup uses configured theme');
  await waitFor(() => ctx.ui.evaluate('document.activeElement.selectionEnd === document.activeElement.value.length && document.activeElement.selectionStart === 0'), 'typing replaces the new tab address');
  console.log('PASS zoom applies to existing and new tabs');

  const second = s.activeId;
  const sidebarTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'), 'sidebar');
  const sidebar = await connect(sidebarTarget);
  for (const index of [1, 2, 0]) {
    await command({ type: 'settings.set', id: 'uiScale', index });
    await waitFor(() => sidebar.evaluate(`document.body.style.zoom === '${[0.92, 0.828, 0.736][index]}'`), 'sidebar interface scale');
    await delay(150);
    assert.ok(
      await sidebar.evaluate('Array.from(document.querySelectorAll(".sidebar-quick-actions button")).every(b => b.getBoundingClientRect().top >= 0 && b.getBoundingClientRect().bottom <= innerHeight)'),
      'bottom shortcuts remain visible at every interface scale',
    );
  }

  await sidebar.evaluate('document.querySelector(".sidebar-url-pill").click()');
  assert.equal(await sidebar.evaluate('document.activeElement?.matches(".sidebar-url-form input")'), true, 'sidebar pill focuses search');
  await sidebar.evaluate(
    `const field = document.querySelector('.sidebar-url-form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(`${origin}/b`)}); field.dispatchEvent(new Event('input', {bubbles:true}));`,
  );
  await sidebar.evaluate('document.querySelector(".sidebar-url-form").requestSubmit()');
  const other = await pageAt('/b');
  console.log('PASS new tab focus and sidebar search');

  await ctx.ui.evaluate('chrome.webview.postMessage(JSON.stringify({type:"sidebar.toggle"}))');
  await waitFor(() => sidebar.evaluate('document.body.classList.contains("floating") && getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)"'), 'transparent sidebar transition');
  await delay(200);
  await ctx.ui.evaluate('chrome.webview.postMessage(JSON.stringify({type:"sidebar.toggle"}))');
  await waitFor(() => sidebar.evaluate('!document.body.classList.contains("floating")'), 'sidebar docked');
  await waitFor(async () => (await other.evaluate('innerWidth')) > initialWidth * 1.08, 'zoom after navigation');

  await command({ type: 'nav.reload', id: second });
  await waitFor(async () => !(await state()).tabs.find(t => t.id === second).loading, 'reload');
  assert.ok((await other.evaluate('innerWidth')) > initialWidth * 1.08, 'reload must preserve zoom');

  await command({ type: 'split.open', id: first });
  await command({ type: 'split.resize', ratio: 0.2 });
  await waitFor(() => ctx.ui.evaluate('document.querySelectorAll(".split-addresses .address-pill").length === 2'), 'two independent split addresses');
  await sidebar.evaluate("document.querySelector('.split-proportions').click()");
  const splitPopup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'split layout popup'));
  await waitFor(() => splitPopup.evaluate('document.querySelectorAll(".split-layout-choice").length===3'), 'three visual layout choices');
  await writeFile(resolve(base, 'split-layout-menu.png'), Buffer.from((await splitPopup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await splitPopup.evaluate('document.querySelectorAll(".split-layout-choice")[2].click()');
  await waitFor(async () => Math.abs((await state()).split.ratio - 2 / 3) < 0.001, 'two-thirds preset');
  await sidebar.evaluate("document.querySelector('.split-proportions').click()");
  await waitFor(() => splitPopup.evaluate('document.querySelectorAll(".split-layout-choice").length===3'), 'layout menu reopened');
  await splitPopup.evaluate('document.querySelectorAll(".split-layout-choice")[1].click()');
  await waitFor(async () => (await state()).split.ratio === 0.5, 'equal-width preset');

  await ctx.ui.call('Emulation.setDeviceMetricsOverride', { width: 850, height: 52, deviceScaleFactor: 1, mobile: false });
  await ctx.ui.evaluate(`document.querySelector('[data-tab-id="${first}"] input').focus()`);
  await waitFor(async () => (await state()).activeId === first, 'editing the second address activates its own page');
  assert.ok(
    await ctx.ui.evaluate(`(() => {const pill=document.querySelector('[data-tab-id="${first}"]');return pill.querySelector('input').getBoundingClientRect().right <= pill.querySelector('.address-trail').getBoundingClientRect().left + 1;})()`),
    'address text does not overlap action buttons',
  );
  assert.ok(await ctx.ui.evaluate('document.querySelector(".topbar-center").getBoundingClientRect().right <= document.querySelector(".topbar-right").getBoundingClientRect().left'), 'split addresses stay inside the toolbar');
  await ctx.ui.evaluate('document.activeElement.blur()');
  await ctx.ui.call('Emulation.clearDeviceMetricsOverride');
  await command({ type: 'tab.activate', id: second });
  console.log('PASS split address focus, compact toolbar and text/button separation');

  await command({ type: 'split.close' });
  await command({ type: 'nav.go', id: second, input: `${origin}/missing` });
  await pageAt('/missing');
  await waitFor(() => other.evaluate('!!document.body && document.body.innerText.includes("Server page /missing")'), 'keep the server 404 page');
  await command({ type: 'nav.go', id: second, input: `${origin}/slow` });
  await command({ type: 'nav.go', id: second, input: `${origin}/b` });
  await pageAt('/b');
  assert.equal(await other.evaluate('!!document.querySelector("[data-nav-error]")'), false, 'replaced navigation must not show an error');
  await command({ type: 'nav.go', id: second, input: `${origin}/download` });
  await waitFor(async () => {
    try {
      return (await readFile(resolve(base, 'downloads/sol-check.txt'), 'utf8')).includes('regression');
    } catch {
      return false;
    }
  }, 'download');
  assert.equal(await other.evaluate('!!document.querySelector("[data-nav-error]")'), false, 'downloads must not become error pages');
  console.log('PASS navigation replacement, HTTP 404 and downloads');

  await command({ type: 'tab.activate', id: second });
  await command({ type: 'nav.go', id: second, input: `${origin}/reset` });
  await waitFor(() => other.evaluate('!!document.querySelector("[data-nav-error]")'), 'connection reset error');
  assert.equal(await other.evaluate('document.querySelector("h1").textContent'), 'Connexion interrompue');
  const errorShot = await other.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'error.png'), Buffer.from(errorShot.data, 'base64'));
  await command({ type: 'nav.go', id: second, input: `${origin}/b` });
  await pageAt('/b');
  console.log('PASS download does not suppress the following real error');

  await command({ type: 'settings.set', id: 'theme', index: 0 });
  await other.evaluate("document.body.style.cssText='background:#121212;min-height:100vh;color:white'; document.body.firstElementChild.style.background='transparent';");
  await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.theme === "dark" && document.documentElement.style.getPropertyValue("--page-real") === "rgb(18, 18, 18)"'), 'dark page theme');
  await other.evaluate('document.body.style.backgroundColor = "#fafafa"');
  await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.theme === "light"'), 'site switches to light without navigation');
  await other.evaluate('document.body.style.backgroundColor = "#121212"');
  await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.theme === "dark"'), 'site switches back to dark');
  console.log('PASS default theme follows dark content and live site theme changes');

  await other.evaluate("document.body.style.backgroundColor='oklch(0.2 0 0)'; const accent=document.createElement('button');accent.textContent='Accent';accent.style.cssText='background:oklch(0.65 0.2 140);color:white;width:160px;height:48px';document.body.append(accent);");
  await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.theme === "dark" && document.documentElement.style.getPropertyValue("--site-accent").startsWith("rgb(")'), 'modern CSS background and accent');
  let forcedDarkBackground;
  for (const [index, theme] of [[1, 'light'], [2, 'dark'], [3, 'dark'], [0, 'dark']]) {
    await command({ type: 'settings.set', id: 'theme', index });
    await waitFor(
      () => ctx.ui.evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.style.getPropertyValue('--site-accent').startsWith('rgb(') && document.documentElement.style.getPropertyValue('--site-chrome-accent').startsWith('rgb(')`),
      `dynamic accent in theme ${index}`,
    );
    if (index !== 3) {
      await delay(300);
      const background = await ctx.ui.evaluate('document.documentElement.style.getPropertyValue("--page-bg")');
      if (index === 2) forcedDarkBackground = background;
      if (index === 0) assert.equal(background, forcedDarkBackground, 'default and dark themes share the dark site background');
      const shot = await sidebar.call('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(base, `colors-${index === 0 ? 'default' : theme}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
  await other.evaluate('document.body.style.backgroundColor = "color(display-p3 0.035 0.035 0.035)"');
  await waitFor(() => ctx.ui.evaluate('document.documentElement.style.getPropertyValue("--page-real") === "rgb(9, 9, 9)"'), 'display-p3 dark background');
  console.log('PASS modern CSS colors and dynamic accents in all browser themes');

  if (process.env.SOL_CHECK_DEVBENIN === '1') {
    await command({ type: 'nav.go', id: second, input: 'https://www.devbenin.bj' });
    await waitFor(() => other.evaluate('location.hostname.endsWith("devbenin.bj") && document.readyState === "complete"'), 'DevBenin loaded', 40000);
    await delay(1500);
    await other.evaluate('localStorage.setItem("theme","dark");location.reload()');
    await waitFor(() => other.evaluate('document.documentElement?.classList.contains("dark") && document.readyState === "complete"'), 'DevBenin dark mode', 40000);
    await delay(2000);
    const colors = await other.evaluate('JSON.stringify({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,classes:document.documentElement.className,stack:document.elementsFromPoint(innerWidth/2,12).map(el=>({tag:el.tagName,class:el.className,bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}))})');
    console.log(`DevBenin colors: ${colors}`);
    console.log(`Sol theme: ${await ctx.ui.evaluate('JSON.stringify({theme:document.documentElement.dataset.theme,bg:document.documentElement.style.getPropertyValue("--page-bg")})')}`);
    await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.theme === "dark"'), 'DevBenin drives dark browser theme');
    console.log('PASS DevBenin dark mode drives the default browser theme');
    const screenshot = await sidebar.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(base, 'devbenin-sidebar.png'), Buffer.from(screenshot.data, 'base64'));
    await command({ type: 'nav.go', id: second, input: `${origin}/b` });
    await pageAt('/b');
  }

  await other.evaluate("document.body.style.cursor = 'none'; window.__pointer = null; document.addEventListener('pointermove', e => window.__pointer = {x:e.clientX,y:e.clientY});");
  await other.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 100 });
  await waitFor(() => other.evaluate('window.__pointer !== null'), 'custom pointer movement at zoom');
  assert.equal(await other.evaluate('getComputedStyle(document.body).cursor'), 'none', 'site controls its own cursor');
  await other.evaluate('document.body.style.cursor = \'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2224%22 height=%2224%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%228%22 fill=%22red%22/%3E%3C/svg%3E") 12 12, auto\';');
  assert.match(await other.evaluate('getComputedStyle(document.body).cursor'), /url\(/, 'CSS image cursor preserved');
  console.log('PASS site cursor styles and pointer events at zoom');

  await other.evaluate(
    `(async () => { const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 280; const ctx = canvas.getContext('2d'); function draw(){ctx.fillStyle='green';ctx.fillRect(0,0,160,280);window.__videoDraw=requestAnimationFrame(draw)} draw(); const video = document.createElement('video'); video.muted=true; video.style.cssText='width:160px;height:280px'; video.srcObject=canvas.captureStream(20); document.body.append(video); await video.play(); })()`,
  );
  await command({ type: 'tab.activate', id: first });
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).includes(`pip.enter ${second}`), 'portrait video PiP');
  await command({ type: 'tab.activate', id: second });
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).includes(`pip.exit ${second}`), 'PiP returns to tab');
  await other.evaluate('document.querySelector("video").pause(); cancelAnimationFrame(window.__videoDraw)');
  const pipEntries = (await readFile(resolve(profile, 'debug.log'), 'utf8')).split(`pip.enter ${second}`).length;
  await command({ type: 'tab.activate', id: first });
  await delay(500);
  assert.equal((await readFile(resolve(profile, 'debug.log'), 'utf8')).split(`pip.enter ${second}`).length, pipEntries, 'paused video must not reopen stale PiP');
  console.log('PASS portrait PiP, return to tab and paused video');

  await command({ type: 'network.toggle' });
  const panelTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('#panel')), 'network panel');
  const panel = await connect(panelTarget);
  await page.evaluate(`fetch(${JSON.stringify(`${origin}/before-sleep`)})`);
  await waitFor(() => panel.evaluate('document.body.innerText.includes("before-sleep")'), 'network events before discard');
  await command({ type: 'tab.activate', id: second });
  await waitFor(async () => (await state()).tabs.find(t => t.id === first)?.asleep, 'inactive tab discarded', 25000);
  await command({ type: 'tab.activate', id: first });
  const awake = await pageAt('/a');
  await waitFor(async () => (await awake.evaluate('innerWidth')) > initialWidth * 1.08, 'waking a discarded tab preserves zoom after the engine restores it');
  await awake.evaluate(`fetch(${JSON.stringify(`${origin}/after-sleep`)})`);
  await waitFor(() => panel.evaluate('document.body.innerText.includes("after-sleep")'), 'network events after discard');
  await command({ type: 'network.toggle' });
  console.log('PASS zoom survives memory discard and wake');
  console.log('PASS network inspector reconnects after memory discard');

  await waitFor(async () => {
    const saved = JSON.parse(await readFile(resolve(profile, 'session.json'), 'utf8').catch(() => '{}'));
    return saved.Urls?.[saved.ActiveIndex] === `${origin}/a`;
  }, 'session autosaved before closing');
  console.log('PASS session autosaved while the browser is running');
  await stop();

  await runBaseStartAndPrivate(ctx, launch);
}
