import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runStartRefresh(ctx) {
  const { base, profile, origin, serverPort, waitFor, connect, targets, command, state, pageAt, stop } = ctx;
  await pageAt('/a');
  await command({ type: 'tab.open', url: 'https://start.sol/index.html#start' });
  const start = await connect(await waitFor(async () => (await targets()).find(t => t.url === 'https://start.sol/index.html#start'), 'start page'));
  await waitFor(() => start.evaluate('document.readyState==="complete" && !!document.querySelector(".start-history")'), 'start interface ready');
  await start.evaluate("chrome.webview.addEventListener('message',e=>{if(e.data.event==='start')window.__home=e.data});chrome.webview.postMessage(JSON.stringify({type:'start.ready'}))");
  await waitFor(() => start.evaluate('window.__home?.history.length>0'), 'initial history');

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolve(profile, 'browser.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT count FROM visits WHERE url=?').get(`${origin}/a`).count, 1, 'one record per load');

  const url = `http://localhost:${serverPort}/visited`;
  await command({ type: 'tab.open', url });
  const visited = await connect(await waitFor(async () => (await targets()).find(t => t.url === url), 'visited site'));
  await waitFor(() => visited.evaluate('document.readyState==="complete"'), 'visited loaded');
  await waitFor(() => start.evaluate(`window.__home.history.some(v=>v.url===${JSON.stringify(url)})`), 'history updates without reloading start');

  const id = (await waitFor(async () => (await state()).tabs.find(t => t.url === url), 'visited tab')).id;
  await command({ type: 'nav.reload', id });
  await waitFor(() => db.prepare('SELECT count FROM visits WHERE url=?').get(url)?.count === 2, 'revisit recorded once');
  await waitFor(() => start.evaluate(`window.__home.frequent[0].url===${JSON.stringify(url)}`), 'frequent ranking updates');
  await waitFor(
    () =>
      start.evaluate(
        `(()=>{const img=[...document.querySelectorAll('.start-history button')].find(b=>b.title===${JSON.stringify(url)})?.querySelector('img');return img?.complete&&img.naturalWidth===192})()`,
      ),
    'original high resolution site favicon',
  );
  await delay(200);
  assert.equal(await start.evaluate('getComputedStyle(document.querySelector(".start-history img")).filter'), 'none', 'colored favicon keeps its original colors');
  await command({ type: 'tab.activate', id: (await state()).tabs.find(t => t.url === 'https://start.sol/index.html#start').id });
  const shot = await start.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(base, 'start-refresh.png'), Buffer.from(shot.data, 'base64'));
  db.close();
  await stop();
  console.log('PASS live start history/frequent ranking, single visit counting and high resolution site favicons');
}

export async function runPlayerWindow(ctx) {
  const { exe, base, profile, origin, port, waitFor, command, state, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  const id = (await state()).activeId;
  console.log('WebView2 PiP APIs', await page.evaluate('JSON.stringify({video:document.pictureInPictureEnabled,document:typeof window.documentPictureInPicture})'));
  await page.evaluate(
    `(async()=>{const video=document.createElement('video');video.muted=true;video.style.cssText='width:640px;height:360px';const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');window.__draw=setInterval(()=>{ctx.fillStyle='green';ctx.fillRect(0,0,640,360)},50);video.srcObject=canvas.captureStream(20);document.body.append(video);await video.play()})()`,
  );
  await command({ type: 'tab.open', url: `${origin}/b` });
  await pageAt('/b');
  const otherId = (await state()).activeId;
  await waitFor(async () => (await readFile(resolve(profile, 'debug.log'), 'utf8')).includes(`pip.enter ${id}`), 'PiP opens');
  assert.equal(await page.evaluate('document.pictureInPictureElement===document.querySelector("video")'), true, 'native engine PiP uses original video');

  const run = async mode => {
    const file = resolve(base, 'external.html');
    await writeFile(file, '<title>External file</title>Opened from Windows');
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tools/check-player-window.ps1'), '-SolProcessId', String(ctx.appPid), '-Exe', exe, '-DataDir', base, '-Mode', mode, '-Url', `${origin}/external`, '-File', file],
      { windowsHide: true, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    proc.stdout.on('data', b => { output += b; });
    proc.stderr.on('data', b => { output += b; });
    const code = (await once(proc, 'exit'))[0];
    assert.equal(code, 0, output);
    console.log(output.trim());
  };

  for (const scale of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index: scale });
    await delay(300);
    await run('resize');
  }
  await run('return');
  await waitFor(async () => (await state()).activeId === id, 'native back button selects source tab');
  await command({ type: 'tab.activate', id: otherId });
  await waitFor(() => page.evaluate('!!document.pictureInPictureElement'), 'PiP reopened');
  await run('close');
  await waitFor(async () => (await state()).activeId === id, 'native close returns source tab');
  await page.evaluate('document.querySelector("video").pause();clearInterval(__draw)');
  await command({ type: 'tab.activate', id });
  await delay(400);
  assert.equal(await page.evaluate('document.pictureInPictureElement'), null, 'return exits native PiP');
  await command({ type: 'tab.activate', id: otherId });
  await delay(500);
  assert.equal(await page.evaluate('document.pictureInPictureElement'), null, 'paused video stays in its tab');

  await command({ type: 'tab.activate', id });
  await page.evaluate(
    `document.querySelector('video').remove();const f=document.createElement('iframe');f.id='video-frame';f.allow='picture-in-picture';f.src='${origin}/video-child';f.style.cssText='width:320px;height:360px';document.body.append(f)`,
  );
  await waitFor(() => page.evaluate(`(()=>{const d=document.querySelector('iframe').contentDocument;return d?.location.pathname==='/video-child' && d.readyState==='complete' && !!d.body})()`), 'embedded page');
  await page.evaluate(
    `(async()=>{const d=document.querySelector('iframe').contentDocument,c=d.createElement('canvas');c.width=160;c.height=280;d.defaultView.__draw=setInterval(()=>c.getContext('2d').fillRect(0,0,160,280),50);const v=d.createElement('video');v.muted=true;v.style.cssText='width:160px;height:280px';v.srcObject=c.captureStream(20);d.body.append(v);await v.play()})()`,
  );
  await command({ type: 'tab.activate', id: otherId });
  await waitFor(() => page.evaluate("!!document.querySelector('iframe').contentDocument.pictureInPictureElement"), 'embedded portrait native PiP');
  await command({ type: 'tab.activate', id });
  await waitFor(() => page.evaluate("!document.querySelector('iframe').contentDocument.pictureInPictureElement"), 'embedded PiP returned');
  await page.evaluate("const d=document.querySelector('iframe').contentDocument;d.querySelector('video').pause();clearInterval(d.defaultView.__draw);document.querySelector('iframe').remove()");
  await run('activation');
  await pageAt('/external');
  assert.ok((await state()).tabs.some(t => t.url.startsWith('file:///') && t.url.endsWith('/external.html')), 'external file reaches existing browser');
  await stop();
  console.log(`PASS native engine PiP, edge resize at 100/90/80, return and external activation; ${base}`);
}

export async function runVideoCursorNative(ctx) {
  const { exe, base, waitFor, command, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  await page.evaluate(
    `(async()=>{document.body.innerHTML='<div id="player" style="width:100vw;height:100vh"><video muted style="width:100%;height:100%;cursor:crosshair"></video></div>';const c=document.createElement('canvas');c.width=640;c.height=360;window.__draw=setInterval(()=>c.getContext('2d').fillRect(0,0,640,360),50);document.querySelector('video').srcObject=c.captureStream(20);await document.querySelector('video').play();await document.querySelector('#player').requestFullscreen()})()`,
  );
  await waitFor(() => page.evaluate('!!document.fullscreenElement'), 'real fullscreen player');

  const run = async mode => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tools/check-player-window.ps1'), '-SolProcessId', String(ctx.appPid), '-Exe', exe, '-DataDir', base, '-Mode', mode],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    proc.stdout.on('data', b => { output += b; });
    proc.stderr.on('data', b => { output += b; });
    const code = (await once(proc, 'exit'))[0];
    assert.equal(code, 0, output);
    console.log(output.trim());
  };

  await run('cursor');
  await page.evaluate('document.exitFullscreen()');
  await waitFor(() => page.evaluate('!document.fullscreenElement'), 'normal video');
  for (const scale of [0, 1, 2]) {
    await command({ type: 'settings.set', id: 'uiScale', index: scale });
    await delay(300);
    await run('cursor');
  }
  await run('cursor-sidebar');
  await page.evaluate('document.querySelector("video").pause()');
  await run('cursor-visible');
  await page.evaluate(
    `document.querySelector('video').play();const b=document.createElement('button');b.id='controls';b.style.cssText='position:absolute;left:0;top:0;width:55vw;height:80vh;cursor:pointer';b.textContent='Player controls';document.body.append(b)`,
  );
  await run('cursor-visible');
  await page.evaluate(
    `document.querySelector('#controls').remove();window.__clicks=0;document.querySelector('video').addEventListener('click',()=>{if(++__clicks===2)document.querySelector('video').pause()})`,
  );
  await run('cursor-click');
  assert.equal(await page.evaluate('__clicks'), 2, 'first click while hidden reaches player');
  assert.equal(await page.evaluate('document.querySelector("video").paused'), true, 'first click pauses playback');
  await page.evaluate('clearInterval(__draw)');
  await stop();
  console.log(`PASS real Windows cursor: fullscreen, normal 100/90/80, sidebar, pause, controls and first click; ${base}`);
}

export async function runVideoCursor(ctx) {
  const { base, waitFor, pageAt, stop } = ctx;
  const page = await pageAt('/a');
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.evaluate(
    `(async()=>{document.body.innerHTML='<video muted style="position:absolute;left:20px;top:20px;width:320px;height:180px;cursor:crosshair"></video><button style="position:absolute;left:40px;top:40px">Pause</button>';const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');window.__draw=setInterval(()=>{ctx.fillStyle='green';ctx.fillRect(0,0,320,180)},50);window.__video=document.querySelector('video');__video.srcObject=canvas.captureStream(20);await __video.play();})()`,
  );
  const move = (x, y) => page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const cursor = () => page.evaluate('getComputedStyle(__video).cursor');
  await page.evaluate(`const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="style-src 'none'";document.head.append(policy)`);
  await move(200, 100);
  assert.equal(await cursor(), 'crosshair');
  await waitFor(async () => (await cursor()) === 'none', 'playing video hides pointer', 6000);
  await move(201, 100);
  assert.equal(await cursor(), 'crosshair');
  await waitFor(async () => (await cursor()) === 'none', 'idle hides again', 6000);
  await page.evaluate('__video.pause()');
  assert.equal(await cursor(), 'crosshair');
  await page.evaluate('__video.play()');
  await waitFor(async () => (await cursor()) === 'none', 'resume with stationary pointer', 6000);
  await move(202, 100);
  assert.equal(await cursor(), 'crosshair');

  await page.evaluate(
    `const overlay=document.createElement('div');overlay.id='player-layer';overlay.setAttribute('role','button');overlay.style.cssText='position:absolute;left:20px;top:20px;width:320px;height:180px;cursor:pointer';document.body.append(overlay)`,
  );
  await move(203, 100);
  await waitFor(async () => (await page.evaluate('getComputedStyle(document.querySelector("#player-layer")).cursor')) === 'none', 'streaming player clickable overlay hides', 6000);
  await page.evaluate("const next=document.querySelector('#player-layer').cloneNode();next.style.cursor='pointer';document.querySelector('#player-layer').replaceWith(next)");
  await waitFor(async () => (await page.evaluate('getComputedStyle(document.querySelector("#player-layer")).cursor')) === 'none', 'replacement overlay stays hidden', 3000);
  await move(204, 100);
  assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#player-layer")).cursor'), 'pointer', 'site overlay cursor restored');
  await page.evaluate("document.querySelector('#player-layer').remove()");

  await move(60, 50);
  await delay(3300);
  assert.equal(await cursor(), 'crosshair', 'controls stay visible');
  await move(500, 300);
  await delay(3300);
  assert.equal(await cursor(), 'crosshair', 'outside player stays visible');
  await page.evaluate('clearInterval(__draw)');
  await stop();
  console.log(`PASS native video cursor idle, movement, pause, controls and site custom cursor; ${base}`);
}
