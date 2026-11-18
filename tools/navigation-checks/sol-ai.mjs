import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runSolAi(ctx) {
  const { base, origin, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  await pageAt('/a');
  assert.equal((await state()).tabs.find(t => t.url === `${origin}/a`)?.ai, false, 'no AI button without ChatGPT');

  await command({ type: 'settings.open', x: 900, y: 58 });
  const popup = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'settings popup'));
  await waitFor(() => popup.evaluate('!!document.querySelector(".settings-nav")'), 'settings sections');
  await popup.evaluate('Array.from(document.querySelectorAll(".settings-nav [role=tab]")).at(-1).click()');
  await waitFor(
    () => popup.evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Continuer avec ChatGPT" && b.getBoundingClientRect().height>0)'),
    'ChatGPT sign-in button',
  );
  assert.doesNotMatch(await popup.evaluate('document.body.innerText'), /Installer Sol AI|Télécharger|Think/, 'no local model controls');
  await writeFile(resolve(base, 'sol-ai-settings.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await command({ type: 'ai.open', id: (await state()).activeId });
  await delay(400);
  assert.equal(await popup.evaluate('!!document.querySelector(".ai-action")'), false, 'Sol AI view stays closed without ChatGPT');

  const dispatchPopup = payload =>
    popup.evaluate(`chrome.webview.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(payload)}}))`);

  await dispatchPopup({
    popup: 'ai-action',
    action: 'summary',
    text: 'Texte de la page',
    source: 'Page A',
    editable: false,
    truncated: false,
    language: 'fr',
    target: 'en',
    ready: true,
    account: 'test@example.com',
    request: { action: 'summary', language: 'fr', input: '' },
    agent: null,
    busy: false,
    error: null,
    result: null,
    scope: 'page',
  });
  await waitFor(() => popup.evaluate('!!document.querySelector(".ai-action")'), 'Sol AI view');
  await popup.evaluate('document.querySelector(".ai-run-btn").click()');

  await dispatchPopup({
    popup: 'ai-action',
    action: 'summary',
    text: 'Texte de la page',
    source: 'Page A',
    editable: false,
    truncated: false,
    language: 'fr',
    target: 'en',
    ready: true,
    account: 'test@example.com',
    scope: 'page',
    request: { action: 'summary', language: 'fr', input: '' },
    agent: null,
    busy: true,
    error: null,
    result: '- Premier point\n- Second',
  });
  await waitFor(() => popup.evaluate('document.querySelector(".ai-result li") && !!document.querySelector(".ai-progress")'), 'streamed answer');
  await writeFile(resolve(base, 'sol-ai-streaming.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await dispatchPopup({
    popup: 'ai-action',
    action: 'summary',
    text: 'Texte de la page',
    source: 'Page A',
    scope: 'page',
    editable: false,
    truncated: false,
    language: 'fr',
    target: 'en',
    ready: true,
    account: 'test@example.com',
    request: { action: 'summary', language: 'fr', input: '' },
    agent: null,
    busy: false,
    error: null,
    result: '- Premier point\n- Second',
  });
  await waitFor(() => popup.evaluate('!!document.querySelector(".ai-actions")'), 'answer actions');
  await writeFile(resolve(base, 'sol-ai-done.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await popup.evaluate('document.querySelector("[role=tab][aria-label=Question]").click()');
  await dispatchPopup({
    popup: 'ai-action',
    action: 'ask',
    text: '',
    source: 'Guide',
    scope: 'page',
    editable: false,
    truncated: false,
    language: 'fr',
    target: 'en',
    ready: true,
    account: 'test@example.com',
    request: { action: 'ask', language: 'fr', input: '' },
    busy: true,
    error: null,
    result: '',
    agent: {
      steps: [
        { id: '1', kind: 'read', label: 'Lecture de la page', detail: '', status: 'complete' },
        { id: '2', kind: 'search', label: 'Recherche dans la page', detail: 'connect', status: 'complete' },
        { id: '3', kind: 'run', label: 'Cliquer sur la page', detail: 'Ouvrir la référence API', status: 'active' },
      ],
      approval: { id: '3', label: 'Cliquer sur la page', detail: 'Ouvrir la référence API' },
    },
  });
  await waitFor(() => popup.evaluate('document.body?.innerText.includes("Autoriser")'), 'approval card');
  await writeFile(resolve(base, 'sol-ai-agent.png'), Buffer.from((await popup.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command({ type: 'popup.close' });

  await command({ type: 'chat.toggle' });
  await waitFor(async () => (await state()).chatOpen === true, 'chat panel open');
  const chat = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#chat')), 'chat view'));
  await waitFor(() => chat.evaluate('document.body?.innerText.includes("Continuer avec ChatGPT")'), 'chat sign-in prompt');
  await chat.evaluate(
    `chrome.webview.dispatchEvent(new MessageEvent('message',{data:{chat:true,ready:true,account:'test@example.com',request:{action:'summary',language:'fr',input:''},agent:null,busy:true,error:null,messages:[{from:'user',text:'Capitale du Bénin ?'},{from:'assistant',text:'**Porto-Novo** est la capitale officielle.'}]}}))`,
  );
  await waitFor(() => chat.evaluate('!!document.querySelector(".sol-chat-log strong") && !!document.querySelector(".sol-chat-input textarea")'), 'chat conversation');
  await writeFile(resolve(base, 'sol-ai-chat.png'), Buffer.from((await chat.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command({ type: 'chat.toggle' });
  await waitFor(async () => (await state()).chatOpen === false, 'chat panel closed');

  await command({ type: 'tab.open', url: `${origin}/agent-doc` });
  const doc = await pageAt('/agent-doc');
  const agent = await readFile(resolve('src/Browser.App/inject/agent.js'), 'utf8');
  const run = async expression => JSON.parse(await doc.evaluate(`(async()=>{const A=${agent};return JSON.stringify(await ${expression});})()`));
  const snap = await run('A.snapshot()');
  assert.deepEqual(snap.headings, ['Installation']);
  assert.ok(snap.text.includes('setup'), 'main text read');
  assert.equal(snap.links.length, 2, 'links listed with refs');
  assert.ok(snap.controls.some(c => c.label === 'Envoyer') && !snap.controls.some(c => c.kind.includes('password')), 'password field hidden from the agent');
  assert.equal((await run('A.find("commande")')).matches.length, 1, 'find in page');
  const api = snap.links.find(l => l.text === 'Référence API');
  assert.ok((await run(`A.readLink(${JSON.stringify(api.ref)})`)).text.includes('connect'), 'same-site link read');
  assert.equal((await run(`A.readLink(${JSON.stringify(snap.links.find(l => l.text === 'Externe').ref)})`)).external, 'https://example.com/ext', 'other sites go through Sol');
  assert.equal((await run('A.show("e99")')).ok, false, 'unknown ref rejected');

  const para = await doc.evaluate('(()=>{const r=document.querySelector("main p").getBoundingClientRect();return {x:r.left+2,y:r.top+r.height/2,w:r.width}})()');
  await doc.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: para.x, y: para.y, button: 'left', clickCount: 1 });
  await doc.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: para.x + Math.min(para.w, 160), y: para.y, button: 'left' });
  await doc.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: para.x + Math.min(para.w, 160), y: para.y, button: 'left', clickCount: 1 });
  await waitFor(() => doc.evaluate('!!document.querySelector("sol-fan")'), 'selection fan attached');
  await delay(700);
  await writeFile(resolve(base, 'sol-ai-selection.png'), Buffer.from((await doc.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await doc.evaluate('getSelection().removeAllRanges()');
  await delay(500);

  const pre = await doc.evaluate('(()=>{const r=document.querySelector("pre").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await doc.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pre.x - 5, y: pre.y });
  await doc.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pre.x, y: pre.y });
  await delay(900);
  await writeFile(resolve(base, 'sol-ai-page-fan.png'), Buffer.from((await doc.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await command({ type: 'bookmark.toggle', id: (await state()).tabs.find(t => t.url === `${origin}/a`).id });
  await command({ type: 'tab.open', url: 'https://start.sol/index.html#start' });
  const start = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#start'), 'start page'));
  await waitFor(
    () => start.evaluate('document.querySelectorAll(".start-category").length===1 && document.querySelector(".start-category h3").textContent.startsWith("Développement") && document.querySelectorAll(".start-category button").length>=2'),
    'AI categories on start page',
  );
  await writeFile(resolve(base, 'sol-ai-start.png'), Buffer.from((await start.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await waitFor(() => start.evaluate('!!document.querySelector(".start-favorites .nod .start-site")'), 'favorite with corner actions');
  const tile = await start.evaluate('(()=>{const r=document.querySelector(".start-favorites .nod .start-site").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await start.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y });
  await waitFor(() => start.evaluate('[...document.querySelectorAll(".start-favorites .nod-act")].filter(b=>b.tabIndex===0).length===3'), 'corner actions open');
  await delay(500);
  await writeFile(resolve(base, 'sol-ai-fan.png'), Buffer.from((await start.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  const grouped = (await state()).tabs.find(t => t.url === `${origin}/a`).id;
  await command({ type: 'group.create', id: grouped, title: 'Test', query: '#3478f6' });
  const groupId = await waitFor(async () => (await state()).groups?.[0]?.id, 'group created');
  await command({ type: 'group.edit', id: groupId });
  const editor = await connect(await waitFor(async () => (await targets()).find(t => t.url.endsWith('#popup')), 'group editor'));
  await waitFor(() => editor.evaluate('!!document.querySelector(".group-color")'), 'beUI color picker');
  await delay(400);
  await writeFile(resolve(base, 'sol-ai-group-color.png'), Buffer.from((await editor.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command({ type: 'popup.close' });

  await command({ type: 'tab.open', url: 'https://start.sol/index.html#notes' });
  const notes = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#notes'), 'notes page'));
  await waitFor(() => notes.evaluate('!!document.querySelector(".notes-browser")'), 'notes sidebar');
  await writeFile(resolve(base, 'sol-ai-notes.png'), Buffer.from((await notes.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('PASS Sol AI offers ChatGPT sign-in, stays closed until connected, renders a streamed answer and the chat panel');
  await stop();
  console.log(`Evidence: ${base}`);
}
