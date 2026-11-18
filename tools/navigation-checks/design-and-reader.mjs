import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runDesign(ctx) {
  const { argv, base, waitFor, connect, targets, command, state, hotkey, pageAt, stop } = ctx;
  if (argv.includes('--private-check')) assert.equal((await state()).privateMode, true);
  const page = await pageAt('/a');
  const id = (await state()).activeId;

  await page.evaluate(
    `document.body.style.cssText='background:rgb(255,255,255);color:rgb(0,0,0);margin:0';` +
      `document.body.innerHTML='<h1 id="target" style="font:24px/36px Arial;padding:12px;margin:8px;color:rgb(0,0,0)">Design check</h1><button id="ordinary">Click</button><div id="gradient" style="height:80px;background:linear-gradient(red,blue)">Gradient</div>';` +
      `window.__clicks=0;document.querySelector('#ordinary').onclick=()=>window.__clicks++;window.__css='';navigator.clipboard.writeText=async text=>{window.__css=text}`,
  );
  await hotkey('design.toggle');
  await waitFor(() => page.evaluate("!!document.getElementById('sol-design-view')"), 'design activated');

  const hover = async selector => {
    const r = await page.evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`);
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, modifiers: 1 });
    await delay(100);
  };

  await hover('#target');
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('dl').textContent.includes('21.00:1')"), 'known black/white contrast');
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('dl').textContent.includes('24px')"), 'computed font size');

  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, modifiers: 0 });
  const gradientPoint = await page.evaluate("(()=>{const r=document.querySelector('#gradient').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()");
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...gradientPoint, modifiers: 8 });
  await delay(100);
  assert.equal(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.target').textContent"), 'div', 'Shift hover works without Alt');

  await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.hover').click()");
  const titlePoint = await page.evaluate("(()=>{const r=document.querySelector('#target').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()");
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...titlePoint, modifiers: 0 });
  await delay(100);
  assert.equal(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.target').textContent"), 'h1', 'mouse-only inspection works');

  await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.hover').click()");
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...gradientPoint, modifiers: 0 });
  await delay(100);
  assert.equal(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.target').textContent"), 'h1', 'disabling free hover freezes selection');

  await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.copy').click()");
  assert.ok(await page.evaluate("window.__css.includes('font-size: 24px;') && !window.__css.includes('Design check')"), 'CSS only copied on request');

  const button = await page.evaluate("(()=>{const r=document.querySelector('#ordinary').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()");
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.call('Input.dispatchMouseEvent', { type, x: button.x, y: button.y, button: 'left', clickCount: 1 });
  }
  assert.equal(await page.evaluate('window.__clicks'), 1, 'normal page clicks remain functional');

  await hover('#gradient');
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('dl').textContent.match(/Unknown|Indéterminé/)"), 'gradient contrast is unknown');

  const shadowPoint = await page.evaluate(
    `(()=>{const h=document.createElement('sol-check');h.id='shadow-check';document.body.append(h);const s=h.attachShadow({mode:'open'});s.innerHTML='<h2 style="font-size:28px;margin:0">Shadow</h2>';const r=s.querySelector('h2').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()`,
  );
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...shadowPoint, modifiers: 1 });
  await delay(100);
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('dl').textContent.includes('28px')"), 'open shadow DOM styles');

  for (const theme of [1, 2]) {
    await command({ type: 'settings.set', id: 'theme', index: theme });
    for (const scale of [0, 1, 2]) {
      await command({ type: 'settings.set', id: 'uiScale', index: scale });
      await delay(150);
      assert.ok(
        await page.evaluate("(()=>{const r=document.getElementById('sol-design-view').shadowRoot.querySelector('.panel').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),
        'inspector fits at all scales',
      );
    }
  }

  const panelWidth = await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.panel').getBoundingClientRect().width");
  await command({ type: 'zoom.in', id });
  await delay(200);
  const zoomWidth = await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.panel').getBoundingClientRect().width");
  assert.ok(Math.abs(zoomWidth * 1.1 - panelWidth) < 2, 'inspector keeps its physical size when page zoom changes');
  await command({ type: 'zoom.reset', id });
  await delay(150);

  await command({ type: 'split.open', id });
  await delay(300);
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.panel').getBoundingClientRect().left>=0"), 'actual split pane');
  await command({ type: 'split.close' });
  await delay(150);

  await page.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 400, deviceScaleFactor: 1, mobile: false });
  assert.ok(await page.evaluate("document.getElementById('sol-design-view').shadowRoot.querySelector('.panel').getBoundingClientRect().left>=0"), 'narrow split pane');
  await page.call('Emulation.clearDeviceMetricsOverride');

  await page.call('Page.captureScreenshot', { format: 'png' }).then(r => writeFile(resolve(base, 'design.png'), Buffer.from(r.data, 'base64')));
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(() => page.evaluate("!document.getElementById('sol-design-view')"), 'Escape closes inspector');

  await hotkey('design.toggle');
  await waitFor(() => page.evaluate("!!document.getElementById('sol-design-view')"), 'reopen inspector');
  await page.evaluate("history.pushState({},'',location.href+'#new')");
  await waitFor(() => page.evaluate("!document.getElementById('sol-design-view')"), 'SPA navigation removes inspector');

  await hotkey('nav.back', true);
  await waitFor(() => page.evaluate('!location.hash'), 'back without Alt');
  await hotkey('nav.forward', true);
  await waitFor(() => page.evaluate("location.hash==='#new'"), 'forward without Alt');
  await hotkey('notes.manage', true);
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === 'https://start.sol/index.html#notes';
  }, 'notes without Alt');
  await hotkey('notes.open', true);
  const quick = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'quick note popup'));
  await waitFor(() => quick.evaluate("!!document.querySelector('.notes-text')"), 'quick note without Alt');
  await stop();
  console.log('PASS design Alt hover, CSS, contrast, ordinary clicks, close/navigation, themes and 100/90/80 scale');
}

export async function runReader(ctx) {
  const { base, waitFor, connect, targets, command, state, hotkey, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  const id = (await state()).activeId;
  const originalUrl = await page.evaluate('location.href');
  await page.evaluate(
    `document.body.innerHTML='<nav>Navigation sans intérêt</nav><input value="conservé"><article><h1>Article de test Sol</h1><p rel="author">Auteur Sol</p>'+Array.from({length:20},(_,i)=>'<p>Paragraphe '+i+' : '+('Ce texte décrit le fonctionnement du mode lecture et garde les paragraphes de cet article. '.repeat(8)))+'</article>';document.querySelector('input').focus();window.scrollTo(0,300)`,
  );
  const scroll = await page.evaluate('scrollY');
  await command({ type: 'reader.toggle', id });
  await waitFor(() => page.evaluate("!!document.getElementById('sol-reader-view')?.shadowRoot.querySelector('main')"), 'reader shown');
  assert.equal((await state()).activeId, id);

  const readerPill = await page.evaluate("(()=>{const r=document.getElementById('sol-reader-view').shadowRoot.querySelector('nav').getBoundingClientRect();return {bottom:innerHeight-r.bottom,center:r.left+r.width/2,width:innerWidth};})()");
  assert.ok(Math.abs(readerPill.center - readerPill.width / 2) < 2);
  assert.ok(readerPill.bottom >= 16 && readerPill.bottom <= 20);
  assert.equal(await page.evaluate('location.href'), originalUrl);
  assert.ok(await page.evaluate("document.getElementById('sol-reader-view').solArticle.blocks.length >= 20"));

  await delay(1200);
  const voiceCount = await page.evaluate('speechSynthesis.getVoices().filter(v=>v.localService).length');
  if (voiceCount) {
    await page.evaluate("(()=>{const r=document.getElementById('sol-reader-view').shadowRoot,s=r.querySelector('select');s.value=s.options[1].value;s.dispatchEvent(new Event('change'));r.querySelectorAll('button')[2].click();})()");
    await waitFor(() => page.evaluate('speechSynthesis.speaking || speechSynthesis.pending'), 'native speech started');
    await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[2].click()");
    assert.equal(await page.evaluate("document.getElementById('sol-reader-view').dataset.speech"), 'paused');
    await waitFor(() => page.evaluate('speechSynthesis.paused'), 'native speech paused');
    await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[2].click()");
    assert.equal(await page.evaluate("document.getElementById('sol-reader-view').dataset.speech"), 'playing');
    await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[3].click()");
    await waitFor(() => page.evaluate('!speechSynthesis.speaking && !speechSynthesis.pending'), 'speech stopped');
    await hotkey('reader.listen');
    await waitFor(() => page.evaluate('speechSynthesis.speaking || speechSynthesis.pending'), 'shortcut starts speech');
    await hotkey('reader.listen');
    await waitFor(() => page.evaluate("document.getElementById('sol-reader-view').dataset.speech==='paused'"), 'shortcut pauses speech');
    await hotkey('reader.stop');
    await waitFor(() => page.evaluate('!speechSynthesis.speaking && !speechSynthesis.pending'), 'shortcut stops speech');
    console.log('PASS installed local voices, native speech start/pause/resume/stop');
  } else {
    assert.ok(await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[2].disabled"));
    console.log('PASS missing local voices: listening disabled with useful message');
  }

  assert.equal(await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('script,iframe,img').length"), 0);
  await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[1].click()");
  assert.equal(await page.evaluate("getComputedStyle(document.getElementById('sol-reader-view').shadowRoot.querySelector('.view')).fontSize"), '22px');
  for (const index of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index });
    await delay(150);
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('sol-reader-view').shadowRoot.querySelector('.view')).fontSize"), '22px');
  }
  for (const [index, color] of [[1, 'rgb(238, 240, 226)'], [2, 'rgb(18, 18, 20)']]) {
    await command({ type: 'settings.set', id: 'theme', index });
    await waitFor(() => page.evaluate(`getComputedStyle(document.getElementById('sol-reader-view').shadowRoot.querySelector('.view')).backgroundColor === '${color}'`), 'reader theme');
  }
  await page.call('Page.captureScreenshot', { format: 'png' }).then(r => writeFile(resolve(base, 'reader.png'), Buffer.from(r.data, 'base64')));

  if (voiceCount) {
    await page.evaluate("document.getElementById('sol-reader-view').shadowRoot.querySelectorAll('button')[2].click()");
    await waitFor(() => page.evaluate('speechSynthesis.speaking || speechSynthesis.pending'), 'speech restarted before exit');
  }
  await command({ type: 'reader.toggle', id });
  await waitFor(() => page.evaluate("!document.getElementById('sol-reader-view')"), 'reader removed');
  assert.equal(await page.evaluate('speechSynthesis.pending || speechSynthesis.speaking'), false);
  assert.equal(await page.evaluate("document.querySelector('input').value"), 'conservé');
  assert.equal(await page.evaluate('scrollY'), scroll);

  await page.evaluate('window.__installedVoices=speechSynthesis.getVoices.bind(speechSynthesis);speechSynthesis.getVoices=()=>[]');
  await command({ type: 'reader.toggle', id });
  await waitFor(() => page.evaluate("document.getElementById('sol-reader-view')?.shadowRoot.querySelectorAll('button')[2].disabled"), 'missing voices disables listening');
  assert.ok(
    await page.evaluate(
      "document.getElementById('sol-reader-view').shadowRoot.querySelector('[role=status]').textContent.includes('No local voice') || document.getElementById('sol-reader-view').shadowRoot.querySelector('[role=status]').textContent.includes('Aucune voix')",
    ),
  );
  await page.evaluate("speechSynthesis.getVoices=window.__installedVoices;history.pushState({},'',location.href+'#navigation')");
  await waitFor(() => page.evaluate("!document.getElementById('sol-reader-view') && !document.body.inert"), 'SPA navigation exits reader and restores page');
  assert.equal(await page.evaluate('speechSynthesis.pending || speechSynthesis.speaking'), false);

  await page.evaluate("document.body.innerHTML='<h1>Connexion</h1><input>'");
  await command({ type: 'reader.toggle', id });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'reader notice'));
  await waitFor(() => popup.evaluate("document.body.textContent.includes('Reader mode unavailable') || document.body.textContent.includes('Mode lecteur indisponible')"), 'unsupported page notice');
  assert.equal(await page.evaluate("!!document.getElementById('sol-reader-view')"), false);
  await stop();
  console.log('PASS reader in same tab, safe article text, text sizing, original form/scroll preserved and unsupported pages');
}
