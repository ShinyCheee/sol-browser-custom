import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runBaseStartAndPrivate(ctx, launch) {
  const { base, profile, origin, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  const saved = JSON.parse(await readFile(resolve(profile, 'session.json'), 'utf8'));
  const expectedUrl = saved.Urls[saved.ActiveIndex];
  await launch();
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === expectedUrl;
  }, 'last active tab restored');
  assert.equal((await state()).tabs.filter(t => !t.asleep).length, 1, 'restart loads only the last active tab');

  await command({ type: 'tab.close', id: (await state()).activeId });
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === `${origin}/a`;
  }, 'new tab after closing last loaded tab');
  assert.equal((await state()).tabs.filter(t => t.asleep).length, 1, 'closing does not wake the remaining inactive tab');
  console.log('PASS restore and close never wake inactive tabs');

  await waitFor(async () => (await state()).tabs.every(t => t.zoom === 90), 'zoom after restart');
  await command({ type: 'zoom.reset' });
  await waitFor(async () => (await state()).tabs.every(t => t.zoom === 100), 'reset all pages');

  await command({ type: 'settings.open', x: 900, y: 58 });
  const popupTarget = await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'settings popup');
  const popup = await connect(popupTarget);
  await waitFor(() => popup.evaluate('document.body.innerText.includes("Conservé pour toutes les pages")'), 'profile zoom label');
  assert.equal(await popup.evaluate('document.querySelectorAll(".settings-nav button").length'), 5);
  await popup.evaluate('Array.from(document.querySelectorAll(".settings-nav button")).find(b=>b.textContent === "Apparence").click()');
  assert.ok(
    await popup.evaluate('Array.from(document.querySelectorAll("[role=radio]")).some(b=>b.textContent === "80 %" && b.getBoundingClientRect().height > 0)'),
    'interface size controls visible',
  );

  const cookiePage = await pageAt('/a');
  await command({ type: 'popup.close' });
  await cookiePage.evaluate('window.__geoDenied = false; navigator.geolocation.getCurrentPosition(() => {}, e => window.__geoDenied = e.code === 1)');
  await waitFor(() => popup.evaluate('document.body.innerText.includes("connaître votre position")'), 'native site permission prompt');
  await command({ type: 'permission.answer', index: 0 });
  await waitFor(() => cookiePage.evaluate('window.__geoDenied'), 'geolocation denied');
  const permissions = await waitFor(async () => {
    try {
      return JSON.parse(await readFile(resolve(profile, 'permissions.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }, 'permission denial persisted');
  assert.equal(permissions[`${origin} Geolocation`], false);
  console.log('PASS native permission prompt and persisted denial');

  await delay(650);
  await command({ type: 'settings.open', x: 900, y: 58 });
  await waitFor(() => popup.evaluate('!!document.querySelector(".settings-nav")'), 'settings sections');
  await popup.evaluate('Array.from(document.querySelectorAll(".settings-nav button")).find(b => b.textContent === "Sécurité").click()');
  await waitFor(() => popup.evaluate('document.body.innerText.includes("Cookies et données des sites")'), 'cookie settings reopened');

  await cookiePage.call('Network.setCookie', { name: 'sol-check', value: 'test', url: origin, httpOnly: true, sameSite: 'Lax' });
  await cookiePage.evaluate('localStorage.setItem("sol-check", "test")');
  assert.ok((await cookiePage.call('Network.getCookies', { urls: [origin] })).cookies.some(c => c.name === 'sol-check'));
  await command({ type: 'site-data.clear' });
  await waitFor(() => popup.evaluate('document.body.innerText.includes("Données effacées")'), 'site data cleared');
  assert.equal((await cookiePage.call('Network.getCookies', { urls: [origin] })).cookies.some(c => c.name === 'sol-check'), false);
  assert.equal(await cookiePage.evaluate('localStorage.getItem("sol-check")'), null);
  console.log('PASS profile cookie and site-storage deletion, including HttpOnly cookies');

  const settingsShot = await popup.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'settings.png'), Buffer.from(settingsShot.data, 'base64'));
  await command({ type: 'popup.close' });
  console.log('PASS zoom survives restart and resets across all tabs');

  await delay(650);
  const designSidebar = await connect((await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'));
  await waitFor(() => designSidebar.evaluate('document.querySelectorAll(".sidebar-quick-actions button").length === 4 && document.querySelector(".sidebar-brand img").naturalWidth > 0'), 'sidebar branding and quick actions');
  assert.equal(await ctx.ui.evaluate('!!document.querySelector("button[aria-label=Téléchargements],button[aria-label=\\"Favoris et historique\\"]")'), false, 'no duplicate toolbar shortcuts');
  await designSidebar.evaluate('document.querySelector("button[aria-label=Historique]").click()');
  await waitFor(() => popup.evaluate('document.querySelector("[role=tab][aria-selected=true]")?.textContent.includes("Historique")'), 'history shortcut selects history directly');
  await command({ type: 'popup.close' });
  const sidebarShot = await designSidebar.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'sidebar-design.png'), Buffer.from(sidebarShot.data, 'base64'));

  await ctx.ui.call('Emulation.setDeviceMetricsOverride', { width: 850, height: 52, deviceScaleFactor: 1, mobile: false });
  assert.ok(
    await ctx.ui.evaluate('document.querySelector(".navigation-actions").getBoundingClientRect().right < document.querySelector(".topbar-center").getBoundingClientRect().left && document.querySelector(".topbar-center").getBoundingClientRect().right <= document.querySelector(".topbar-right").getBoundingClientRect().left'),
    'toolbar groups do not overlap at 850px',
  );
  await ctx.ui.call('Emulation.clearDeviceMetricsOverride');
  console.log('PASS sidebar branding, quick history action and toolbar layout');

  await command({ type: 'tab.open', url: `${origin}/preview-check` });
  await pageAt('/preview-check');
  const previewTab = (await state()).activeId;
  await command({ type: 'tab.close', id: previewTab });
  await waitFor(async () => !(await state()).tabs.some(t => t.id === previewTab), 'preview source tab closed');

  await command({ type: 'bookmark.add', url: `${origin}/b`, title: 'Favorite check' });
  await command({ type: 'group.create', id: (await state()).activeId, title: 'Start group' });
  await command({ type: 'settings.text', id: 'home', input: '' });
  await command({ type: 'tab.open' });

  const startUrl = 'https://start.sol/index.html#start';
  const startTarget = await waitFor(async () => (await targets()).find(t => t.url === startUrl), 'local start target');
  const startPage = await connect(startTarget);
  await waitFor(
    () => startPage.evaluate('document.querySelector(".start-favorites")?.textContent.includes("Favorite check") && document.querySelector(".start-groups")?.textContent.includes("Start group") && document.querySelectorAll(".start-history button").length > 0'),
    'real profile data on start page',
  );
  await waitFor(() => startPage.evaluate('document.querySelector(".start-favorites img")?.naturalWidth > 0 && document.querySelector(".start-preview-image > img")?.naturalWidth > 0'), 'real favicon and page preview');
  await waitFor(() => startPage.evaluate('document.querySelector(".start-favorites img")?.naturalWidth === 192'), 'high resolution declared icon preferred');
  assert.equal(await startPage.evaluate('document.documentElement.dataset.wallpaper'), 'false');
  assert.equal(await startPage.evaluate('getComputedStyle(document.body).backgroundImage'), 'none');

  await command({ type: 'settings.set', id: 'startWallpaper', index: 1 });
  await waitFor(() => startPage.evaluate('document.documentElement.dataset.wallpaper === "true" && getComputedStyle(document.body).backgroundImage.includes("start-background-")'), 'optional start wallpaper enabled');
  assert.equal(await startPage.evaluate('getComputedStyle(document.body).backgroundSize'), 'cover');
  assert.equal(await startPage.evaluate('document.querySelectorAll(".start-preview-placeholder img").length'), 0);
  assert.equal(await startPage.evaluate('document.documentElement.dataset.theme'), await ctx.ui.evaluate('document.documentElement.dataset.theme'));

  const startWidth = await startPage.evaluate('innerWidth');
  await command({ type: 'zoom.out' });
  await delay(200);
  assert.equal(await startPage.evaluate('innerWidth'), startWidth, 'start ignores page zoom');
  const startState = await state();
  assert.equal(startState.tabs.find(t => t.id === startState.activeId)?.zoom, 100);

  await command({ type: 'settings.set', id: 'uiScale', index: 2 });
  await waitFor(() => ctx.ui.evaluate('document.body.style.zoom === "0.736"'), '80% interface scale');
  assert.ok(await designSidebar.evaluate('document.body.style.zoom === "0.736"'));
  assert.ok(await startPage.evaluate('!document.body.style.zoom || document.body.style.zoom === "1"'), 'start remains at 100%');
  assert.equal(JSON.parse(await readFile(resolve(profile, 'settings.json'), 'utf8')).UiScale, 0.8);
  await command({ type: 'settings.set', id: 'uiScale', index: 0 });
  await waitFor(() => ctx.ui.evaluate('document.body.style.zoom === "0.92"'), 'restore interface scale');

  const tabCount = (await state()).tabs.length;
  await command({ type: 'split.open' });
  await waitFor(async () => (await state()).tabs.length === tabCount + 1, 'new split start tab');
  await waitFor(async () => (await targets()).filter(t => t.url === startUrl).length === 2, 'both split panes show start');
  await command({ type: 'split.close' });
  await waitFor(async () => (await state()).tabs.length === tabCount, 'untouched split start cleaned up');
  console.log('PASS start zoom isolation, interface scaling and new split start page');

  const savedPreviews = await readdir(resolve(profile, 'start-previews'));
  assert.ok(savedPreviews.some(file => file.endsWith('.png')), 'URL previews persist in the profile');
  assert.equal(await ctx.ui.evaluate('document.querySelector(".address-pill input").value'), '');
  assert.equal(await startPage.evaluate('document.querySelector(".start-history").textContent.includes("start.sol")'), false);
  const startShot = await startPage.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'start-page.png'), Buffer.from(startShot.data, 'base64'));

  await command({ type: 'settings.set', id: 'theme', index: 1 });
  await waitFor(() => startPage.evaluate('document.documentElement.dataset.theme === "light"'), 'start page follows light browser theme');
  await startPage.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 650, deviceScaleFactor: 1, mobile: false });
  assert.ok(await startPage.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'start page fits a narrow split pane');
  assert.equal(await startPage.evaluate('getComputedStyle(document.body).backgroundSize'), 'cover');
  await startPage.call('Emulation.clearDeviceMetricsOverride');
  await command({ type: 'settings.set', id: 'startWallpaper', index: 0 });
  await command({ type: 'settings.set', id: 'theme', index: 2 });

  await startPage.evaluate('Array.from(document.querySelectorAll(".start-favorites button")).find(b=>b.textContent.includes("Favorite check")).click()');
  const navigated = await connect(await waitFor(async () => (await targets()).find(t => t.id === startTarget.id && t.url === `${origin}/b`), 'favorite navigation'));
  await waitFor(() => navigated.evaluate('document.readyState === "complete" && document.body.textContent.includes("Server page")'), 'favorite page loaded');
  await navigated.evaluate('try { window.chrome?.webview?.postMessage(JSON.stringify({type:"start.navigate",input:"https://example.com"})); } catch {}');
  await delay(300);
  assert.equal(await navigated.evaluate('location.href'), `${origin}/b`, 'websites cannot control the start bridge');
  console.log('PASS custom start page, real profile data, favorite navigation and bridge isolation');

  await stop();
  await launch(['--private']);
  await waitFor(() => ctx.ui.evaluate('document.documentElement.dataset.private === "true" && document.documentElement.style.getPropertyValue("--tab-accent") === "#8b5cf6"'), 'native private window purple identity');
  const privateSidebar = await connect((await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'));
  await waitFor(() => privateSidebar.evaluate('document.querySelector(".sidebar-profile")?.textContent.includes("Privé")'), 'private profile label');
  const privateShot = await privateSidebar.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'sidebar-private.png'), Buffer.from(privateShot.data, 'base64'));

  await command({ type: 'tab.open' });
  const privateStart = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#start'), 'private start page'));
  await waitFor(() => privateStart.evaluate('document.documentElement?.dataset.private === "true"'), 'private start data');
  assert.equal(await privateStart.evaluate('document.querySelectorAll(".start-history button,.start-frequent button").length'), 0);
  console.log('PASS private window purple theme and no visits on private start page');
  await stop();
}
