import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runLanguages(ctx) {
  const { base, profile, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  await command({ type: 'settings.open', x: 1000, y: 50 });
  const settingsPopup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'language settings'));
  await waitFor(() => settingsPopup.evaluate('/Orthographe|Spelling/.test(document.body?.textContent || "")'), 'spelling settings');
  console.log(
    'Windows dictionaries:',
    await settingsPopup.evaluate("Array.from(document.querySelectorAll('.row-hint')).find(p=>/dictionnaires Windows|Windows dictionaries/.test(p.textContent))?.textContent"),
  );
  await command({ type: 'popup.close' });

  const page = await pageAt('/a');
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.evaluate(
    `document.querySelector('main').innerHTML = '<h1>Orthographe locale</h1><textarea id="writing" style="font:24px/1.5 system-ui;width:600px;height:150px;padding:16px">Bonjour hello bonjourr helooo</textarea><p contenteditable="true" style="font:24px system-ui">Bonjour hello bonjourr</p>'`,
  );
  await page.evaluate("document.querySelector('#writing').focus()");
  await waitFor(() => page.evaluate("document.querySelector('[data-sol-spelling]')?.dataset.solSpelling === '2'"), 'bilingual local spelling only flags errors');
  await writeFile(resolve(base, 'spelling.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  const wordPoint = await page.evaluate(
    "(() => {const el=document.querySelector('#writing'),box=el.getBoundingClientRect(),g=document.createElement('canvas').getContext('2d');g.font=getComputedStyle(el).font;return {x:box.left+18+g.measureText('Bonjour hello bon').width,y:box.top+35};})()",
  );
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', clickCount: 1, ...wordPoint });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', clickCount: 1, ...wordPoint });

  const corrections = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'correction menu'));
  await waitFor(() => corrections.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).some(r=>/^bonjour$/i.test(r.textContent.trim()))"), 'right click suggests the corrected word');
  await writeFile(resolve(base, 'spelling-menu.png'), Buffer.from((await corrections.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await corrections.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).find(r=>/^bonjour$/i.test(r.textContent.trim())).click()");
  await waitFor(() => page.evaluate("!document.querySelector('#writing').value.includes('bonjourr')"), 'suggestion replaces only the misspelled word');

  await page.evaluate("document.querySelector('#writing').focus();document.execCommand('undo')");
  await waitFor(() => page.evaluate("document.querySelector('#writing').value === 'Bonjour hello bonjourr helooo'"), 'correction can be undone');

  await command({ type: 'settings.set', id: 'spelling', index: 0 });
  await waitFor(() => page.evaluate("!document.querySelector('[data-sol-spelling]') && document.querySelector('#writing').getAttribute('spellcheck') === null"), 'off restores page attributes');
  await command({ type: 'settings.set', id: 'spelling', index: 1 });
  await waitFor(() => page.evaluate("document.querySelector('[data-sol-spelling]')?.dataset.solSpelling === '2'"), 'French dictionary selection');
  await command({ type: 'settings.set', id: 'spelling', index: 3 });
  await page.evaluate("document.querySelector('p[contenteditable]').focus()");
  await waitFor(() => page.evaluate("document.querySelector('[data-sol-spelling]')?.dataset.solSpelling === '1'"), 'contenteditable spelling');

  const paragraphHtml =
    '<div id="editor" contenteditable="true" style="font:18px system-ui;width:560px">' +
    '<p><span contenteditable="false" style="display:inline-block">Adrienn</span></p>' +
    '<p>Vos messages sont chiffrés de bout en bout. La phrase revient dans WhatsApp.</p>' +
    '<p>Commençons par ce que le chiffrement n’est pas.</p>' +
    '<p>Beaucoup de services annoncent que vos données sont protégées, voire piratées.<br>Chaque utilisateur possède deux clés.</p>' +
    '<p>Voir exemple.com ou écrire à steven@sol.dev pour la version v2, une <b>autr</b>e fois. Une vraie fautte ici.</p></div>';
  await page.evaluate(`document.querySelector('main').innerHTML = ${JSON.stringify(paragraphHtml)}; document.querySelector('#editor').focus()`);
  await delay(1500);
  assert.equal(await page.evaluate("document.querySelector('[data-sol-spelling]')?.dataset.solSpelling"), '1', 'paragraph editor: only the real mistake is flagged');
  await writeFile(resolve(base, 'spelling-paragraphs.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('PASS paragraph editor spelling without false underlines');
  await writeFile(resolve(base, 'spelling-editor.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await page.evaluate('window.__solSpelling.read = () => ({unexpected:true})');
  await delay(600);
  assert.ok((await state()).activeId, 'untrusted page response cannot crash Sol');

  const id = (await state()).activeId;
  await command({ type: 'translation.open', id, x: 1000, y: 45 });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'translation pill'));
  await waitFor(() => popup.evaluate("!!document.querySelector('.translation-popup .popup-seg-btn')"), 'translation language');

  for (const [language, browser, expected] of [['fr-FR', 1, 'anglais'], ['en-US', 1, 'français'], ['es', 2, 'English'], ['ja', 1, 'français']]) {
    await command({ type: 'popup.close' });
    await page.evaluate(`document.documentElement.lang=${JSON.stringify(language)}`);
    await command({ type: 'settings.set', id: 'language', index: browser });
    await command({ type: 'translation.open', id, x: 1000, y: 45 });
    await waitFor(() => popup.evaluate(`document.querySelector('.translation-popup .popup-seg-btn')?.textContent.includes(${JSON.stringify(expected)})`), `single target for ${language}`);
    assert.equal(await popup.evaluate("document.querySelectorAll('.translation-popup .popup-seg-btn').length"), 1, 'only the appropriate language is offered');
  }
  assert.ok(await popup.evaluate("Array.from(document.querySelectorAll('.translation-popup .popup-seg-btn')).every(b=>b.disabled)"), 'local pages cannot be sent to Google');
  await writeFile(resolve(base, 'translation.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command({ type: 'popup.close' });

  await command({ type: 'nav.go', id, input: 'https://example.com/' });
  await waitFor(async () => (await state()).tabs.find(t => t.id === id)?.url === 'https://example.com/', 'public page address');
  await ctx.ui.evaluate('document.querySelector(\'button[aria-label="Traduire la page"],button[aria-label="Translate page"]\').click()');
  await waitFor(() => popup.evaluate("document.querySelector('.translation-popup .popup-seg-btn')?.disabled === false"), 'public page translation enabled');
  await delay(300);
  await writeFile(resolve(base, 'translation-public.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await popup.evaluate("document.querySelector('.translation-popup .popup-seg-btn').click()");
  await waitFor(async () => (await state()).tabs.find(t => t.id === id)?.translated, 'Google translation stays in the same tab');
  assert.equal((await state()).activeId, id, 'translation retains the active tab');
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'session.json'), 'utf8').catch(() => '{}')).TranslationOriginals?.includes('https://example.com/'), 'original page retained in the session');

  await command({ type: 'translation.open', id, x: 1000, y: 45 });
  await waitFor(() => popup.evaluate("/Voir l.original|View original/.test(document.querySelector('.translation-popup')?.textContent)"), 'return to original action');
  await delay(300);
  await writeFile(resolve(base, 'translation-original.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await popup.evaluate("Array.from(document.querySelectorAll('.translation-popup .pill-action')).find(b=>/Voir l.original|View original/.test(b.textContent)).click()");
  await waitFor(async () => (await state()).tabs.find(t => t.id === id)?.url === 'https://example.com/', 'original restored in the same tab');
  assert.equal((await state()).activeId, id, 'return to original retains the active tab');
  console.log('PASS local dictionary, correction menu, undo, contenteditable and Google translation flow');
  await stop();
  console.log(`Evidence: ${base}`);
}
