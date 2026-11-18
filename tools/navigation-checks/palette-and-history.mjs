import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runPalette(ctx) {
  const { argv, base, origin, waitFor, connect, targets, command, state, hotkey, pageAt, stop } = ctx;
  if (argv.includes('--small')) assert.ok(await ctx.ui.evaluate('innerWidth<=400 && innerHeight<=400'), 'test window is actually small');
  const first = (await state()).activeId;
  await pageAt('/a');
  assert.equal(
    await ctx.ui.evaluate("Array.from(document.querySelectorAll('button')).filter(b=>/Palette de commandes|Command palette/.test(b.getAttribute('aria-label'))).length"),
    0,
    'commands belong in settings',
  );

  const open = async () => {
    await command({ type: 'popup.close' });
    await delay(400);
    await command({ type: 'settings.open', x: 500, y: 70 });
    const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'palette popup'));
    await waitFor(() => popup.evaluate("!!document.querySelector('.settings-nav')"), 'settings visible');
    await popup.evaluate("Array.from(document.querySelectorAll('.settings-nav button')).find(b=>/Général|General/.test(b.textContent)).click()");
    assert.ok(await popup.evaluate("Array.from(document.querySelectorAll('.shortcuts-list kbd')).some(k=>k.textContent==='Ctrl+H')"), 'history shortcut shown in settings');
    await popup.evaluate("document.querySelector('.shortcuts-heading button').click()");
    await waitFor(() => popup.evaluate("!!document.querySelector('.palette-search input')"), 'palette visible');
    await popup.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await popup.evaluate("document.querySelector('.palette-search input').focus()");
    return popup;
  };

  const query = async (popup, text) => {
    await popup.evaluate("document.querySelector('.palette-search input').select()");
    await popup.call('Input.insertText', { text });
    await waitFor(() => popup.evaluate(`document.querySelector('.palette-search input').value === ${JSON.stringify(text)}`), 'palette query');
  };

  const key = async (popup, keyName, code) => {
    await popup.call('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: code });
    await popup.call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: code });
  };

  for (const [action, title] of [['history.open', 'Historique|History'], ['downloads.open', 'Téléchargements|Downloads']]) {
    await hotkey(action);
    const view = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'shortcut popup'));
    await waitFor(
      () => view.evaluate(`new RegExp(${JSON.stringify(title)}).test((document.querySelector('.popup-header-title')||document.querySelector('[aria-selected=true]'))?.textContent||'')`),
      'shortcut opens expected action',
    );
  }

  await hotkey('settings.open');
  const settings = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'settings shortcut popup'));
  await waitFor(() => settings.evaluate("!!document.querySelector('.settings-nav')"), 'settings shortcut');
  await settings.evaluate("document.querySelector('.shortcuts-settings details').open=true");
  assert.ok(await settings.evaluate("document.querySelector('.shortcuts-list').clientHeight>100"), 'shortcut list is visible');

  let popup = await open();
  const initialList = await popup.evaluate("(()=>{const r=document.querySelector('.palette-results');return {height:r.clientHeight,scroll:r.scrollHeight};})()");
  assert.ok(initialList.height > (argv.includes('--small') ? 80 : 250), 'palette uses available window height');
  assert.ok(initialList.scroll >= initialList.height);
  const stale = await popup.evaluate("document.querySelector('[role=option]').id.replace('palette-result-','')");

  await query(popup, 'telechargements');
  await waitFor(() => popup.evaluate("document.querySelectorAll('[role=option]').length===1"), 'accent insensitive action search');
  await key(popup, 'Enter', 13);
  await waitFor(() => popup.evaluate("!document.querySelector('.palette-search') && /Téléchargements|Downloads/.test(document.querySelector('.popup-header-title')?.textContent || '')"), 'downloads opened');

  popup = await open();
  const before = (await state()).tabs.length;
  await command({ type: 'palette.pick', id: stale });
  await command({ type: 'palette.pick', id: 'window.close' });
  assert.equal((await state()).tabs.length, before);
  assert.ok(await popup.evaluate("!!document.querySelector('.palette-search')"));

  await query(popup, 'no-such-command-zzz');
  await waitFor(() => popup.evaluate("!!document.querySelector('.palette-empty')"), 'empty search');
  await key(popup, 'Enter', 13);
  assert.equal((await state()).tabs.length, before);
  await key(popup, 'Escape', 27);

  await command({ type: 'tab.open', url: `${origin}/b` });
  await pageAt('/b');
  await hotkey('tab.1');
  await waitFor(async () => (await state()).activeId === first, 'Ctrl+1 selects first tab');
  await hotkey('tab.9');
  await waitFor(async () => {
    const s = await state();
    return s.activeId === s.tabs.at(-1).id;
  }, 'Ctrl+9 selects last tab');

  popup = await open();
  await query(popup, '/a');
  await waitFor(() => popup.evaluate("document.querySelectorAll('[role=option]').length===1"), 'tab URL search');
  await key(popup, 'Enter', 13);
  await waitFor(async () => (await state()).activeId === first, 'switch to matching tab');

  popup = await open();
  await query(popup, 'notes');
  await waitFor(() => popup.evaluate("document.querySelectorAll('[role=option]').length===2"), 'notes actions');
  await key(popup, 'ArrowDown', 40);
  assert.equal(await popup.evaluate("document.querySelector('[aria-selected=true]').dataset.paletteIndex"), '1');
  await key(popup, 'ArrowUp', 38);
  await key(popup, 'Enter', 13);
  await waitFor(async () => {
    const s = await state();
    return s.tabs.find(t => t.id === s.activeId)?.url === 'https://start.sol/index.html#notes';
  }, 'notes opened from palette');

  popup = await open();
  assert.ok(
    await popup.evaluate("!Array.from(document.querySelectorAll('[role=option]')).some(b=>/Mode lecteur|Reader mode|Traduire la page|Translate page/.test(b.textContent))"),
    'reader/translation excluded on internal notes page',
  );

  for (const [index, color] of [[1, 'light'], [2, 'dark']]) {
    await command({ type: 'settings.set', id: 'theme', index });
    await waitFor(() => popup.evaluate(`document.documentElement.dataset.theme === '${color}'`), 'palette theme');
    for (const scale of [0, 1, 2]) {
      await command({ type: 'settings.set', id: 'uiScale', index: scale });
      await waitFor(() => popup.evaluate(`document.body.style.zoom === '${[0.92, 0.89, 0.86][scale]}'`), 'palette scale');
      assert.ok(await popup.evaluate("document.querySelector('.palette-search input').getBoundingClientRect().width>100"));
      assert.ok(await popup.evaluate("document.querySelector('.palette-footer').getBoundingClientRect().bottom <= innerHeight + 2"), 'footer is visible without outer scrolling');
    }
    const shot = await popup.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(base, `palette-${color}.png`), Buffer.from(shot.data, 'base64'));
  }

  await query(popup, 'preferences');
  await command({ type: 'settings.set', id: 'uiScale', index: 0 });
  assert.equal(await popup.evaluate("document.querySelector('.palette-search input').value"), 'preferences');
  await command({ type: 'popup.close' });
  await stop();
  console.log('PASS palette actions, tabs, accents, keyboard, stale choices, context, themes and 100/90/80 scale');
}

export async function runHistory(ctx) {
  const { base, waitFor, connect, targets, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  await waitFor(() => page.evaluate('document.readyState === "complete" && document.body.textContent.includes("Server page")'), 'initial visit recorded');
  const sidebar = await connect((await targets()).find(t => t.url.endsWith('#sidebar') || t.url === 'https://ui.navigateur/index.html'));
  await waitFor(() => sidebar.evaluate('!!document.querySelector("button[aria-label=Historique]")'), 'history shortcut');
  await sidebar.evaluate('document.querySelector("button[aria-label=Historique]").click()');
  const library = await connect((await targets()).find(t => t.url.endsWith('#popup')));
  await waitFor(() => library.evaluate('document.querySelectorAll(".popup-list .row").length === 100'), 'first 100 history pages');
  await library.evaluate('document.querySelector("button[aria-label=\\"Page suivante\\"]").click()');
  await waitFor(() => library.evaluate('document.querySelector(".library-pages")?.textContent.includes("101–126")'), 'older imported history page');
  assert.ok(await library.evaluate('document.querySelector(".popup-list").textContent.includes("Older imported target")'));

  await library.evaluate('document.querySelector(".library-search").focus()');
  await library.call('Input.insertText', { text: 'Older imported target' });
  await waitFor(() => library.evaluate('document.querySelectorAll(".popup-list .row").length === 1 && !document.querySelector(".library-pages")'), 'search includes old imports');
  assert.ok(await library.evaluate('document.querySelector("[role=tab][aria-selected=true]").textContent.includes("Historique")'), 'search keeps the history tab selected');

  await library.evaluate('document.querySelector("[role=tab]").dispatchEvent(new MouseEvent("mousedown", { bubbles:true }))');
  await waitFor(() => library.evaluate('document.querySelector(".popup-list").textContent.includes("Older imported target favorite")'), 'imported favorite accessible');
  await writeFile(resolve(base, 'imported-library.png'), Buffer.from((await library.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('PASS older imported history pagination, search, active tab and bookmarks');
  await stop();
}
