import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runMarkdown(ctx) {
  const { base, profile, origin, getMarkdownImageRequests, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  await pageAt('/a');
  const text =
    `# Titre\n\n## Section\n\n### Sous-section\n\n#### Niveau 4\n\n##### Niveau 5\n\n###### Niveau 6\n\n` +
    `**Gras**, *italique*, ~~barré~~ et \`code\`.\n\n> Citation\n\n- Élément\n  - Sous-élément\n\n` +
    `1. Première étape\n2. Seconde étape\n\n- [x] Fait\n- [ ] À faire\n\n` +
    `| Colonne | Valeur |\n| --- | --- |\n| Sol | Clair |\n\n\`\`\`js\nconst greeting = "Bonjour";\n\`\`\`\n\n` +
    `Formule $x^2$\n\n$$\n\\frac{1}{2}\n$$\n\n[Page locale](${origin}/a)\n\n![Aperçu](${origin}/markdown-image.svg)\n\n` +
    `Référence[^1]\n\n[^1]: Note de bas de page.\n\n---\n\n` +
    `<b>HTML nettoyé</b><script>window.__markdownInjected=true</script><img src="javascript:alert(1)" onerror="window.__markdownInjected=true">\n\n[Interdit](javascript:alert(1))`;

  await command({ type: 'notes.draft', id: '', title: 'Markdown', input: text });
  await command({ type: 'notes.open', x: 500, y: 70 });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'markdown note'));
  await popup.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  const preview = () => popup.evaluate("Array.from(document.querySelectorAll('button')).find(b=>/^Aperçu$|^Preview$/.test(b.textContent)).click()");
  await waitFor(() => popup.evaluate("!!document.querySelector('.notes-text')"), 'markdown editor');
  await preview();
  await waitFor(() => popup.evaluate("!!document.querySelector('.sol-markdown .katex')"), 'math rendering');

  const rendered = await popup.evaluate(
    `(()=>{const m=document.querySelector('.sol-markdown');return {headings:Array.from(m.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h=>!h.closest('.footnotes')).length,strong:!!m.querySelector('strong'),em:!!m.querySelector('em'),del:!!m.querySelector('del'),table:!!m.querySelector('table'),quote:!!m.querySelector('blockquote'),code:!!m.querySelector('pre code .hljs-keyword'),checks:m.querySelectorAll('input[disabled],[role="checkbox"][disabled]').length,footnote:!!m.querySelector('[data-footnote-ref]'),unsafe:m.querySelectorAll('script,iframe,[onerror],a[href^="javascript:"]').length,injected:!!window.__markdownInjected,images:m.querySelectorAll('img[src]').length};})()`,
  );
  assert.equal(rendered.headings, 6);
  for (const key of ['strong', 'em', 'del', 'table', 'quote', 'code', 'footnote']) assert.equal(rendered[key], true, key);
  assert.equal(rendered.checks, 2);
  assert.equal(rendered.unsafe, 0);
  assert.equal(rendered.injected, false);
  assert.equal(getMarkdownImageRequests(), 0);
  assert.equal(rendered.images, 0);

  await popup.evaluate("Array.from(document.querySelectorAll('.sol-markdown button')).find(b=>/Afficher|Show/.test(b.textContent)).click()");
  await waitFor(() => popup.evaluate("document.querySelector('.sol-markdown img')?.naturalWidth===160"), 'explicit image loading');
  assert.equal(getMarkdownImageRequests(), 1);

  for (const scale of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index: scale });
    await delay(200);
    assert.ok(await popup.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'markdown fits every scale');
  }
  await writeFile(resolve(base, 'markdown.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  assert.ok(!(await readFile(resolve(profile, 'notes.json'), 'utf8').catch(() => '')).includes('Markdown'), 'preview does not save draft');

  await command({ type: 'notes.manage' });
  const notePage = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#notes'), 'notes workspace'));
  await waitFor(() => notePage.evaluate("!!document.querySelector('.notes-document .notes-title,.notes-writing')"), 'note workspace editor');
  await notePage.evaluate("Array.from(document.querySelectorAll('button')).find(b=>/^Aperçu$|^Preview$/.test(b.textContent)).click()");
  await waitFor(() => notePage.evaluate("!!document.querySelector('.sol-markdown table')"), 'workspace markdown');
  const before = (await state()).tabs.length;
  await notePage.evaluate("Array.from(document.querySelectorAll('.sol-markdown a')).find(a=>a.textContent==='Page locale').click()");
  await waitFor(async () => (await state()).tabs.length === before + 1, 'safe markdown link opens a tab');
  await stop();
  console.log(`PASS native Markdown, headings, nested lists, tasks, tables, code, math, footnotes, safe HTML/links/images, notes and 100/90/80; ${base}`);
}

export async function runUsability(ctx) {
  const { profile, waitFor, connect, targets, command, state, launch, stop } = ctx;
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'settings popup'));
  const settings = async () => {
    await command({ type: 'settings.open', x: 900, y: 52 });
    await waitFor(() => popup.evaluate("!!document.querySelector('.settings-popup')"), 'settings shown');
    await popup.evaluate("document.querySelector('.settings-nav button').click();document.querySelector('#root').scrollTop=0");
    await delay(250);
  };
  const resize = async (width, height) => {
    const script =
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class SizeCheck{[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f);}';` +
      `$p=Get-Process -Id ${ctx.appPid};if(-not [SizeCheck]::SetWindowPos($p.MainWindowHandle,[IntPtr]::Zero,-9000,-9000,${width},${height},0x14)){exit 2}`;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    assert.equal((await once(proc, 'exit'))[0], 0);
    await delay(400);
  };

  for (const scale of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index: scale });
    await resize(640, 440);
    await settings();
    const before = await popup.evaluate("document.querySelector('#root').scrollTop");
    await popup.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 180, deltaX: 0, deltaY: 300 });
    await delay(250);
    assert.ok(await popup.evaluate(`document.querySelector('#root').scrollTop>${before}+20`), 'settings mouse wheel');
    await popup.evaluate("document.querySelector('#root').scrollTop=1e6");
    assert.ok(await popup.evaluate("(()=>{const r=document.querySelector('#root');return r.scrollHeight-r.clientHeight-r.scrollTop<2})()"), 'last settings reachable');
    const short = await popup.evaluate('innerHeight');
    await resize(1100, 950);
    await waitFor(async () => (await popup.evaluate('innerHeight')) > short + 150, 'menu regrows after window resize');
    await popup.evaluate("document.querySelector('#root').scrollTop=0");
    for (const section of ['Général', 'Apparence', 'Sécurité', 'Données', 'Sol']) {
      await popup.evaluate(`Array.from(document.querySelectorAll('.settings-nav button')).find(b=>b.textContent===${JSON.stringify(section)}).click()`);
      await delay(120);
      assert.ok(await popup.evaluate("document.querySelector('.settings-nav').scrollWidth<=document.querySelector('.settings-nav').clientWidth+1"), 'settings sections fit');
    }
    await command({ type: 'popup.close' });
  }

  await resize(400, 400);
  assert.ok(await ctx.ui.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'small toolbar fits');
  const closeBox = await ctx.ui.evaluate("document.querySelector('.light.close').getBoundingClientRect().toJSON()");
  await ctx.ui.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 10 });
  await ctx.ui.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 });
  await delay(650);
  await waitFor(async () => /ui.tooltip shown/.test(await readFile(resolve(profile, 'debug.log'), 'utf8')), 'native tooltip opened');

  await command({ type: 'settings.set', id: 'fullscreen', index: 0 });
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'settings.json'), 'utf8')).FullScreen === false, 'fullscreen preference saved');
  await command({ type: 'window.maximize' });
  await waitFor(async () => !(await state()).maximized, 'normal restore');
  await command({ type: 'window.maximize' });
  await waitFor(async () => (await state()).maximized, 'normal maximize');
  await stop();
  await launch();
  await command({ type: 'window.maximize' });
  await waitFor(async () => (await state()).maximized, 'fullscreen preference used after restart');
  await command({ type: 'settings.set', id: 'fullscreen', index: 1 });
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'settings.json'), 'utf8')).FullScreen === true, 'fullscreen reenabled');
  await stop();
  console.log('PASS settings mouse wheel, small/resized menus, native tooltips, 100/90/80%, fullscreen setting and restart');
}

export async function runAnchors(ctx) {
  const { waitFor, connect, targets, command, hotkey, pageAt, stop } = ctx;
  await pageAt('/a');
  const sidebar = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'), 'sidebar'));
  for (const view of [ctx.ui, sidebar]) {
    await view.evaluate(
      'window.__originalPost=chrome.webview.postMessage.bind(chrome.webview);chrome.webview.postMessage=m=>{try{window.__buttonCommand=JSON.parse(m)}catch{}window.__originalPost(m)}',
    );
  }
  const checks = [
    ['history.open', 'history.open', sidebar],
    ['downloads.open', 'downloads.open', sidebar],
    ['settings.open', 'settings.open', ctx.ui],
    ['profile.menu', 'profile.menu', ctx.ui],
    ['translation.open', 'translation.open', ctx.ui],
    ['extensions.open', 'extensions.menu', ctx.ui],
  ];
  for (const scale of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index: scale });
    await delay(200);
    for (const [action, button, view] of checks) {
      await waitFor(() => view.evaluate(`!!document.querySelector('[data-action="${button}"]')`), 'action button ready');
      await view.evaluate(`document.querySelector('[data-action="${button}"]').click()`);
      const clicked = await view.evaluate('window.__buttonCommand');
      assert.equal(clicked.type, button);
      await command({ type: 'popup.close' });
      await delay(250);
      await view.evaluate('window.__buttonCommand=null');
      await hotkey(action);
      const keyboard = await waitFor(() => view.evaluate(`window.__buttonCommand?.type==='${button}' && window.__buttonCommand`), 'shortcut invokes actual button');
      assert.deepEqual(keyboard, clicked, `same anchor and action: ${action}, scale ${scale}`);
      await command({ type: 'popup.close' });
      await delay(250);
    }
  }
  await stop();
  console.log('PASS keyboard menus use their button positions and actions at 100/90/80 scale');
}

export async function runScale(ctx) {
  const { base, waitFor, connect, targets, command, pageAt, stop } = ctx;
  const sidebar = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'), 'sidebar'));
  const page = await pageAt('/a');
  const pageZoom = await page.evaluate('devicePixelRatio');
  for (const [index, factor] of [[0, 0.92], [1, 0.89], [2, 0.86], [0, 0.92]]) {
    await command({ type: 'settings.set', id: 'uiScale', index });
    await waitFor(() => ctx.ui.evaluate(`document.body.style.zoom === '${factor}'`), 'toolbar scale');
    await waitFor(() => sidebar.evaluate(`document.body.style.zoom === '${factor}'`), 'sidebar scale');
    assert.ok(
      await sidebar.evaluate(
        "Array.from(document.querySelectorAll('.sidebar-quick-actions button')).length > 0 && Array.from(document.querySelectorAll('.sidebar-quick-actions button')).every(b=>{const r=b.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.right<=innerWidth;})",
      ),
      'sidebar shortcuts remain visible',
    );
    assert.equal(await page.evaluate('devicePixelRatio'), pageZoom, 'website zoom stays independent');
    await writeFile(resolve(base, `sidebar-scale-${index}.png`), Buffer.from((await sidebar.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  console.log('PASS 100/90/80 interface sizes, visible sidebar shortcuts and independent website zoom');
  await stop();
  console.log(`Evidence: ${base}`);
}
