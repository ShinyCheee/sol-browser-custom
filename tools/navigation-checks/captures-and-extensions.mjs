import assert from 'node:assert/strict';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runCapturesAndExtensions(ctx) {
  const { argv, base, profile, origin, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  const initialWidth = await page.evaluate('innerWidth');
  await command({ type: 'zoom.out' });
  await waitFor(async () => (await page.evaluate('innerWidth')) > initialWidth * 1.08, 'page zoom');
  const id = (await state()).activeId;

  await command({ type: 'nav.go', id, input: `${origin}/document` });
  const pdf = await pageAt('/document');
  await waitFor(async () => (await state()).tabs.find(t => t.id === id).zoom === 100, 'PDF independent zoom');
  await delay(800);
  await writeFile(resolve(base, 'pdf.png'), Buffer.from((await pdf.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command({ type: 'zoom.out' });
  await command({ type: 'nav.go', id, input: `${origin}/a` });
  await pageAt('/a');
  assert.equal((await state()).tabs.find(t => t.id === id).zoom, 90, 'PDF leaves website zoom unchanged');
  console.log('PASS native PDF served without .pdf extension, independent from website zoom');

  await command({ type: 'capture.menu', x: 900, y: 50 });
  await delay(300);
  const captureUi = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#capture')), 'capture controls'));
  await captureUi.evaluate("chrome.webview.addEventListener('message',e=>{if(e.data.event==='capture-state')window.__captureResult=e.data;});");
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-action")'), 'screenshot options');

  const saveCapture = async label => {
    await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-review img")?.naturalWidth'), `${label} preview`, 40000);
    await captureUi.evaluate('document.querySelector(".capture-bar .capture-action").click()');
    await waitFor(() => captureUi.evaluate('window.__captureResult?.kind === "done"'), `${label} saved`, 40000);
    return readFile(resolve(base, 'captures/capture.png'));
  };

  await captureUi.evaluate('window.__captureResult=null;document.querySelector(".capture-action").click()');
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-review img")?.naturalWidth'), 'screenshot preview', 40000);
  assert.equal(await readFile(resolve(base, 'captures/capture.png')).catch(() => null), null, 'nothing is written before the preview is accepted');
  const capture = await saveCapture('page');
  const shown = await (await pageAt('/a')).evaluate('[visualViewport.width*devicePixelRatio,visualViewport.height*devicePixelRatio]');
  assert.ok(
    Math.abs(capture.readUInt32BE(16) - shown[0]) <= 1.5 && Math.abs(capture.readUInt32BE(20) - shown[1]) <= 1.5,
    `screenshot has the pixels shown on screen (${capture.readUInt32BE(16)}x${capture.readUInt32BE(20)} for ${shown})`,
  );
  await readFile(resolve(base, 'captures/capture.pdf'));
  console.log('PASS screenshot at screen size, previewed before saving, as PNG and PDF');

  await command({ type: 'capture.menu' });
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-action")'), 'capture options before cancel');
  await captureUi.evaluate('window.__captureResult=null;document.querySelector(".capture-action").click()');
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-review img")?.naturalWidth'), 'preview to cancel', 40000);
  await rm(resolve(base, 'captures/capture.png'));
  await captureUi.evaluate('document.querySelector(".capture-bar button").click()');
  await waitFor(() => captureUi.evaluate('window.__captureResult?.kind === "done"'), 'preview cancelled');
  assert.equal(await readFile(resolve(base, 'captures/capture.png')).catch(() => null), null, 'a cancelled preview saves nothing');
  console.log('PASS cancelled preview writes no file');

  await command({ type: 'device.set', id, query: 'iPhone 18 Pro Max' });
  await waitFor(async () => !!(await state()).tabs.find(t => t.id === id).device, 'simulated device');
  await delay(2500);
  await command({ type: 'capture.run', query: 'visible', index: 0 });
  const framed = await saveCapture('simulated device');
  assert.ok(framed.readUInt32BE(16) < 1100 && framed.readUInt32BE(20) <= 800, `simulated device captured with its frame (${framed.readUInt32BE(16)}x${framed.readUInt32BE(20)})`);
  await writeFile(resolve(base, 'device-capture.png'), framed);
  await command({ type: 'device.set', id, query: '' });
  await delay(1500);
  console.log('PASS simulated device captured with its frame');

  await command({ type: 'capture.menu' });
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-action")'), 'capture options reopened');
  await captureUi.evaluate('document.querySelector(".capture-browser").click()');
  assert.match(await captureUi.evaluate('document.body.innerText'), /Fenêtre entière|Entire window/);
  await captureUi.evaluate('window.__captureResult=null;document.querySelector(".capture-action").click()');
  const fullBrowser = await saveCapture('whole browser');
  assert.ok(fullBrowser.readUInt32BE(16) > 1000 && fullBrowser.readUInt32BE(16) <= 1100 && fullBrowser.readUInt32BE(20) > 700 && fullBrowser.readUInt32BE(20) <= 800, 'whole browser capture has the window pixels');
  assert.ok(!fullBrowser.equals(capture), 'window capture differs from page-only capture');
  await writeFile(resolve(base, 'whole-browser.png'), fullBrowser);
  console.log('PASS native whole browser screenshot including toolbar and sidebar, without screen sharing');

  await command({ type: 'capture.menu' });
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-action")'), 'whole browser area options');
  await captureUi.evaluate('document.querySelector(".capture-modes button").click()');
  await captureUi.evaluate('window.__captureResult=null;document.querySelector(".capture-action").click()');
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-selection img")?.naturalWidth'), 'window region preview', 40000);
  const dimensions = await captureUi.evaluate('({w:innerWidth,h:innerHeight})');
  await captureUi.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: dimensions.w * 0.1, y: dimensions.h * 0.2, button: 'left', clickCount: 1 });
  await captureUi.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dimensions.w * 0.6, y: dimensions.h * 0.7, button: 'left', buttons: 1 });
  await captureUi.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dimensions.w * 0.6, y: dimensions.h * 0.7, button: 'left', clickCount: 1 });
  const selectedArea = await saveCapture('whole browser selected area');
  assert.ok(Math.abs(selectedArea.readUInt32BE(16) - fullBrowser.readUInt32BE(16) * 0.5) <= 2);
  assert.ok(Math.abs(selectedArea.readUInt32BE(20) - fullBrowser.readUInt32BE(20) * 0.5) <= 2);
  console.log('PASS full interface region selection and cropped screenshot');

  await command({ type: 'settings.set', id: 'uiScale', index: 2 });
  await command({ type: 'capture.menu' });
  await waitFor(() => captureUi.evaluate('!!document.querySelector(".capture-action")'), 'capture options at 80%');
  await captureUi.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 160, deviceScaleFactor: 1, mobile: false });
  assert.ok(
    await captureUi.evaluate('document.querySelector(".capture-action").getBoundingClientRect().right <= innerWidth && document.querySelector(".capture-close").getBoundingClientRect().bottom <= innerHeight'),
    'capture controls fit narrow window at 80%',
  );
  await captureUi.call('Emulation.clearDeviceMetricsOverride');

  const sizesBefore = (await readFile(resolve(profile, 'debug.log'), 'utf8')).split('commande capture.size').length;
  await command({ type: 'capture.menu' });
  await delay(150);
  await command({ type: 'capture.menu' });
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).split('commande capture.size').length > sizesBefore, 'capture controls reappear after toolbar toggle');
  await captureUi.evaluate('document.querySelector(".capture-close").click()');
  await command({ type: 'settings.set', id: 'uiScale', index: 0 });
  console.log('PASS responsive capture controls at 80% interface scale');

  if (!argv.includes('--extensions')) {
    await stop();
    console.log(`Evidence: ${base}`);
    return;
  }

  const extId = 'pejdijmoenmkgeppbflobdenhhabjlaj';
  await command({ type: 'extensions.open' });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'extensions manager'));
  await popup.evaluate('chrome.webview.addEventListener("message",e=>{ if(e.data.popup) window.__extensions=e.data; })');
  await command({ type: 'extension.store' });
  await waitFor(async () => (await state()).tabs.some(t => t.url.startsWith('https://chromewebstore.google.com/')), 'store opens in a browser tab');
  const storeTab = (await state()).activeId;
  await command({ type: 'nav.go', id: storeTab, input: `https://chromewebstore.google.com/detail/icloud-passwords/${extId}` });
  await waitFor(() => ctx.ui.evaluate('!!document.querySelector(".store-install")'), 'native Add to Sol action');
  await ctx.ui.evaluate('document.querySelector(".store-install").click()');
  await waitFor(
    () => popup.evaluate('window.__extensions?.popup === "extension-confirm" && window.__extensions.access.some(a => /applications|apps/.test(a))'),
    'extension permissions review',
    90000,
  );
  await command({ type: 'extension.confirm', id: extId });
  await waitFor(
    () => popup.evaluate(`window.__extensions?.installed?.some(e=>e.id === "${extId}" && e.enabled)`),
    'signed iCloud extension installation',
    90000,
  );
  console.log('PASS signed Chrome Web Store package installs with original iCloud identity');

  await command({ type: 'extension.pin', id: extId });
  await waitFor(async () => (await state()).extensions?.some(e => e.id === extId), 'extension pinned');
  assert.ok(await ctx.ui.evaluate('document.querySelector(".pinned-extension img")?.naturalWidth >= 32'));
  assert.ok(JSON.parse(await readFile(resolve(profile, 'settings.json'), 'utf8')).PinnedExtensions.includes(extId), 'pin is persisted in profile settings');

  await command({ type: 'extension.show', id: extId });
  const extension = await connect(
    await waitFor(async () => (await targets()).find(t => t.url.startsWith(`chrome-extension://${extId}/`) && t.type === 'page'), 'iCloud popup'),
  );
  await waitFor(() => extension.evaluate('document.readyState === "complete"').catch(() => false), 'iCloud popup ready');
  await waitFor(() => extension.evaluate('innerWidth >= document.body.getBoundingClientRect().right && innerHeight >= document.body.getBoundingClientRect().bottom'), 'extension content fits its popup');

  for (const [width, height] of [[240, 160], [520, 320], [280, 180]]) {
    await extension.evaluate(
      `document.body.className=''; document.body.style.cssText='width:${width}px;height:${height}px;min-height:0;margin:0;padding:0'; document.body.innerHTML='<div style="width:100%;height:100%">Popup size check</div>'`,
    );
    await waitFor(() => extension.evaluate(`Math.abs(innerWidth-${width}) <= 1 && Math.abs(innerHeight-${height}) <= 1`), `popup resizes to ${width}x${height}`);
  }
  console.log('PASS extension popup content fits, grows and shrinks to its own dimensions');
  await extension.evaluate("document.documentElement.style.cssText='width:460px;height:240px'");
  await waitFor(() => extension.evaluate('innerWidth === 460 && innerHeight === 240'), 'extension explicit root dimensions preserved');
  console.log('PASS iCloud popup opens (no passwords inspected; real autofill remains a manual check)');

  await command({ type: 'extension.reload', id: extId });
  await command({ type: 'extension.toggle', id: extId });
  await waitFor(async () => !(await state()).extensions?.some(e => e.id === extId), 'disabled extension leaves quick access');
  await command({ type: 'extensions.open' });
  await waitFor(() => popup.evaluate('window.__extensions?.installed?.some(e=>!e.enabled)'), 'disable extension');
  await waitFor(async () => (await state()).extensions?.length === 0, 'disabled extension hidden from quick access');

  await command({ type: 'extension.remove', id: extId });
  await waitFor(async () => !(await readdir(resolve(profile, 'extensions'))).includes(extId), 'extension files removed');
  await popup.evaluate('window.__extensions = null');
  await command({ type: 'extensions.open' });
  await waitFor(() => popup.evaluate('window.__extensions?.installed?.length === 0'), 'remove extension');
  console.log('PASS extension reload, disable and removal');
  await stop();
}
