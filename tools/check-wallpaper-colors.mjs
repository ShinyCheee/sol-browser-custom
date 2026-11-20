import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sidebarHost } from './sidebar-check-host.mjs';

const evidence = resolve('bin/appearance-review');
await mkdir(evidence, { recursive: true });
const url = 'https://start.sol/index.html#start';

for (const [asset, theme] of [['start-background.jpg', 'light'], ['start-background-dark.jpg', 'dark']]) {
  const host = await sidebarHost(process.argv[2]);
  let sidebar;
  try {
    const file = resolve(host.profile, 'settings.json');
    await writeFile(file, JSON.stringify({
      ...JSON.parse(await readFile(file, 'utf8')), Theme: 'page', HomePage: url,
      StartWallpaper: true, StartWallpaperCustom: true, Shortcuts: [],
    }));
    await writeFile(resolve(host.profile, 'session.json'), JSON.stringify({ Urls: [url], ActiveIndex: 0 }));
    await copyFile(resolve('ui/src/assets', asset), resolve(host.profile, 'wallpaper.jpg'));
    sidebar = await host.launch(700, 1140);
    const page = await host.connect(url);
    const send = command => sidebar.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(command))})`);
    const wallpaperTint = await host.wait(() => page.evaluate(`(() => {
      const photo = document.body.style.backgroundImage.includes('data:image/jpeg');
      const root = document.documentElement;
      return photo && root.dataset.theme === '${theme}' && root.style.getPropertyValue('--tab-accent');
    })()`), `sampled ${theme} wallpaper tint`);
    const colors = wallpaperTint.match(/\d+/g).map(Number);
    assert.equal(colors.length, 3);
    assert.ok(Math.max(...colors) - Math.min(...colors) < 12, 'the sampled silver wallpaper does not become blue');
    assert.ok(theme === 'light' ? colors[0] > 180 : colors[0] < 105, 'the chrome takes the actual photo tone');
    await host.wait(() => page.evaluate(`(() => {
      const ink = Number(getComputedStyle(document.body).color.match(/[0-9]+/)[0]);
      return ${theme === 'light' ? 'ink < 80' : 'ink > 200'};
    })()`), 'foreground is readable against the photo and theme');
    await host.wait(() => sidebar.evaluate(`document.documentElement.style.getPropertyValue('--tab-accent') === '${wallpaperTint}'`), 'sidebar uses the same photo tint');
    const capture = await page.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(evidence, `wallpaper-${theme}.png`), Buffer.from(capture.data, 'base64'));
    await send({ type: 'settings.set', id: 'theme', index: theme === 'light' ? 2 : 1 });
    await host.wait(() => page.evaluate(`document.documentElement.dataset.theme === '${theme === 'light' ? 'dark' : 'light'}'`), 'explicit theme still wins');
    await send({ type: 'settings.set', id: 'startWallpaper', index: 0 });
    await host.wait(() => page.evaluate('!document.body.style.backgroundImage && !document.documentElement.style.getPropertyValue("--tab-accent")'), 'photo and tint are cleared together');
  } finally {
    if (sidebar) await host.close(sidebar).catch(() => {});
    await host.dispose();
  }
}
console.log('PASS a personal photo tints the new tab and its chrome, Default resolves its light/dark tone, explicit overrides and removal work');
