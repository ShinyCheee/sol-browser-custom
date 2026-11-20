import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runNotes(ctx) {
  const { base, profile, origin, waitFor, connect, targets, command, state, launch, pageAt, stop } = ctx;
  await command({ type: 'notes.open', x: 900, y: 60 });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'notes popup'));
  await popup.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await waitFor(() => popup.evaluate("!!document.querySelector('.notes-text')"), 'notes editor');
  await delay(1200);

  await command({ type: 'capture.run', query: 'visible', index: 1 });
  const notesCapture = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#capture')), 'capture controls'));
  await waitFor(() => notesCapture.evaluate('!!document.querySelector(".capture-review img")?.naturalWidth'), 'notes capture preview', 40000);
  await notesCapture.evaluate('document.querySelector(".capture-bar .capture-action").click()');
  await waitFor(() => readFile(resolve(base, 'captures/capture.png')).then(b => b.length > 10000).catch(() => false), 'centered notes native capture');

  await popup.evaluate("document.querySelector('.notes-text').focus()");
  await popup.call('Input.insertText', { text: 'Une note conservée dans Sol.' });
  await popup.evaluate("Array.from(document.querySelectorAll('button')).find(b=>/^Enregistrer$|^Save$/.test(b.textContent)).click()");
  await waitFor(() => popup.evaluate("document.querySelector('.notes-text').value === ''"), 'note saved');
  const saved = JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8'));
  assert.equal(saved[0].Text, 'Une note conservée dans Sol.');
  const id = saved[0].Id;

  await command({ type: 'notes.draft', id: '', title: '', input: 'Brouillon non enregistré' });
  await command({ type: 'popup.close' });
  await command({ type: 'notes.open', x: 900, y: 60 });
  await waitFor(() => popup.evaluate("document.querySelector('.notes-text')?.value === 'Brouillon non enregistré'"), 'draft restored');
  await command({ type: 'notes.edit', id });
  await waitFor(() => popup.evaluate("!!document.querySelector('[role=alert]')"), 'unsaved draft protected');
  await command({ type: 'notes.discard' });

  await command({ type: 'nav.go', id: (await state()).activeId, input: `${origin}/a` });
  const page = await pageAt('/a');
  await command({ type: 'popup.close' });
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true });

  const select = async () => {
    const point = await page.evaluate(
      '(() => {const el=document.querySelector("h1"),r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);const b=el.getBoundingClientRect();return {x:b.left+40,y:b.top+15};})()',
    );
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'right', clickCount: 1, ...point });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'right', clickCount: 1, ...point });
    await waitFor(() => popup.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).some(b=>/Ajouter à une note|Add to a note/.test(b.textContent))"), 'selection notes action');
    await popup.evaluate("Array.from(document.querySelectorAll('.sol-menu-item,.row')).find(b=>/Ajouter à une note|Add to a note/.test(b.textContent)).click()");
    await waitFor(() => popup.evaluate("document.body.textContent.includes('Une nouvelle note') || document.body.textContent.includes('A new note')"), 'choose note');
  };

  await select();
  await popup.evaluate("document.querySelector('.popup-list .row').click()");
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8'))[0].Text.includes('Server page /a'), 'selection appended to existing note');
  assert.ok(JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8'))[0].Text.includes(`${origin}/a`));

  await command({ type: 'popup.close' });
  await select();
  await popup.evaluate("document.querySelector('.row').click()");
  await waitFor(() => popup.evaluate("document.querySelector('.notes-text')?.value === 'Server page /a'"), 'selection in new note');
  await popup.evaluate("Array.from(document.querySelectorAll('button')).find(b=>/^Enregistrer$|^Save$/.test(b.textContent)).click()");
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8')).length === 2, 'second note saved');

  await command({ type: 'notes.manage' });
  const notes = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#notes'), 'notes workspace'));
  await notes.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await waitFor(() => notes.evaluate("document.querySelectorAll('.notes-preview').length === 2"), 'notes workspace list');
  assert.ok(await notes.evaluate('!window.__navBlurHost'), 'notes footer controls are never blurred');
  await notes.evaluate("chrome.webview.postMessage(JSON.stringify({type:'window.close'}))");
  await delay(200);
  assert.ok((await state()).activeId, 'notes page accepts only its own commands');

  await notes.evaluate("document.querySelector('.notes-preview').click()");
  await waitFor(() => notes.evaluate("!!document.querySelector('.notes-writing')"), 'document editor');
  await command({ type: 'tab.activate', id: (await state()).tabs.find(t => t.url === `${origin}/a`).id });
  await select();
  await popup.evaluate("document.querySelector('.row').click()");
  await waitFor(() => popup.evaluate("document.querySelector('.notes-text')?.value === 'Server page /a'"), 'saved note does not block a new selection note');
  await command({ type: 'notes.discard' });
  await command({ type: 'notes.manage' });
  await notes.evaluate("document.querySelector('.notes-preview').click()");
  await waitFor(() => notes.evaluate("!!document.querySelector('.notes-writing')"), 'document editor returns');

  for (const index of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index });
    await waitFor(() => notes.evaluate(`document.body.style.zoom === '${[0.92, 0.828, 0.736][index]}'`), 'notes interface scale');
    const geometry = await notes.evaluate("(() => {const r=document.querySelector('.notes-document').getBoundingClientRect(); return {right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()");
    assert.ok(geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1, `notes workspace fits: ${JSON.stringify(geometry)}`);
    await delay(300);
    await writeFile(resolve(base, `notes-scale-${index}.png`), Buffer.from((await notes.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }

  const notesRatio = await notes.evaluate('devicePixelRatio');
  await command({ type: 'zoom.out' });
  assert.equal(await notes.evaluate('devicePixelRatio'), notesRatio, 'website zoom never changes the notes interface');
  await command({ type: 'settings.set', id: 'theme', index: 1 });
  await delay(300);
  await writeFile(resolve(base, 'notes-light.png'), Buffer.from((await notes.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await command({ type: 'split.open' });
  await delay(300);
  assert.ok(await notes.evaluate("document.querySelector('.notes-document').getBoundingClientRect().right <= innerWidth+1"), 'notes fit split view');
  await command({ type: 'split.close' });

  await stop();
  await launch();
  await command({ type: 'notes.manage' });
  const reopened = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#notes'), 'reopened notes'));
  await waitFor(() => reopened.evaluate("document.querySelectorAll('.notes-preview').length === 2"), 'notes persist after restart');
  await reopened.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await reopened.evaluate("document.querySelector('input[type=search]').focus()");
  await reopened.call('Input.insertText', { text: 'Une note conservée' });
  await waitFor(() => reopened.evaluate("document.querySelectorAll('.notes-preview').length === 1"), 'notes search');
  await reopened.evaluate("document.querySelector('.notes-preview').click()");
  await waitFor(() => reopened.evaluate("document.querySelector('.notes-writing')?.value.includes('Source :')"), 'edit note with source');

  await command({ type: 'notes.draft', id, title: 'Texte modifié', input: 'Edition vérifiée' });
  await command({ type: 'notes.save' });
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8')).find(n => n.Id === id)?.Title === 'Texte modifié', 'edited note persisted');
  await command({ type: 'notes.delete', id });
  await waitFor(async () => JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8')).length === 1, 'note deleted');

  await stop();
  await launch(['--private']);
  await command({ type: 'notes.open', x: 900, y: 60 });
  const privatePopup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'private notes'));
  await waitFor(() => privatePopup.evaluate("!!document.querySelector('.notes-text')"), 'private notes ready');
  await command({ type: 'notes.manage' });
  const privateNotes = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#notes'), 'private workspace'));
  await waitFor(() => privateNotes.evaluate("!!document.querySelector('.notes-browser')"), 'private workspace ready');
  assert.equal(await privateNotes.evaluate("document.querySelectorAll('.notes-preview').length"), 0);
  await command({ type: 'notes.draft', id: '', title: '', input: 'Privé uniquement' });
  await command({ type: 'notes.save' });
  await waitFor(() => privateNotes.evaluate("document.querySelectorAll('.notes-preview').length === 1"), 'private note saved in memory');
  assert.equal(JSON.parse(await readFile(resolve(profile, 'notes.json'), 'utf8')).length, 1, 'private notes never overwrite normal notes');
  await stop();
  console.log('PASS notes UI, draft safety, new/existing selection, source URLs, scales, persistence and private isolation');
  console.log(`Evidence: ${base}`);
}
