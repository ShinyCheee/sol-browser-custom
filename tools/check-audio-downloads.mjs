import assert from 'node:assert/strict';
import {cp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {basename,extname,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sidebarHost} from './sidebar-check-host.mjs';

const cache=resolve(process.env.NAVIGATEUR_AUDIO_ENGINE_CACHE??'E:/dev/tmp/sol-audio-engine-cache');
const receipt=JSON.parse(await readFile(resolve(cache,'ffmpeg.json'),'utf8'));
const ffmpeg=resolve(cache,'ffmpeg',receipt.find(entry=>basename(entry.File)==='ffmpeg.exe').File),ffprobe=resolve(ffmpeg,'../ffprobe.exe');
const evidence=resolve('bin/audio-evidence');await mkdir(evidence,{recursive:true});
// Fixtures are created inside the disposable native harness, never from real user media.
let bytes,slow=false;const requests=[];
const host=await sidebarHost(process.argv[2]??'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe',{downloads:true,serve(req,res){
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/clip.mp4') {
    if(!(req.headers.cookie??'').includes('audio_session=ok')){res.writeHead(403);res.end();return true;}
    const start=Number(/^bytes=(\d+)-/.exec(req.headers.range??'')?.[1]??0);requests.push({start,referer:req.headers.referer});
    res.writeHead(start?206:200,{'Content-Type':'video/mp4','Content-Length':bytes.length-start,'Accept-Ranges':'bytes','ETag':'"audio-fixture"',
      ...(start?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
    if(req.method==='HEAD'){res.end();return true;}
    if(slow){let offset=start;const timer=setInterval(()=>{const end=Math.min(offset+1024,bytes.length);res.write(bytes.subarray(offset,end));offset=end;if(offset===bytes.length){clearInterval(timer);res.end();}},40);res.on('close',()=>clearInterval(timer));}
    else res.end(bytes.subarray(start));return true;
  }
  if(path==='/video') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Set-Cookie':'audio_session=ok; HttpOnly; Path=/; SameSite=Lax'});
    res.end('<html><head><title>Audio · Démonstration Sol</title></head><body><video controls preload="metadata" src="/clip.mp4?one"></video><video controls preload="none" src="/clip.mp4?two"></video></body></html>');return true;
  }
  return false;
}});
let ui,popup,dock,page;
const cmd=command=>ui.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(command))})`);
const state=()=>ui.evaluate('window.__sidebarState');
const jobs=()=>dock.evaluate('Object.values(window.__allDownloads??{})');
async function inspect(id) {
  await popup.evaluate('window.__video=null');await cmd({type:'video.open',id});
  let view=await host.wait(()=>popup.evaluate('window.__video&&(window.__video.phase==="ready"||window.__video.items.length)&&window.__video'),'video sources');
  if(view.phase!=='ready')await cmd({type:'video.inspect',id,query:view.items.find(item=>item.kind==='file').id});
  view=await host.wait(()=>popup.evaluate('window.__video?.phase==="ready"&&window.__video'),'ready');
  await host.wait(()=>popup.evaluate('!!document.querySelector(".video-output-modes")'),'mode switch');return view;
}
async function audio(format) {
  await host.wait(()=>popup.evaluate('!!document.querySelector(".video-output-modes")'),'output modes rendered');
  await popup.evaluate(`Array.from(document.querySelectorAll('.video-output-modes button')).find(button=>button.textContent==='Audio').click()`);
  await host.wait(()=>popup.evaluate(`Array.from(document.querySelectorAll('.video-qualities label')).some(label=>label.textContent.startsWith('${format.toUpperCase()}'))`),'audio formats rendered');
  await popup.evaluate(`Array.from(document.querySelectorAll('.video-qualities label')).find(label=>label.textContent.startsWith('${format.toUpperCase()}')).querySelector('[role=radio]').click()`);
}
function probe(path) {
  const result=spawnSync(ffprobe,['-v','error','-show_streams','-of','json',path],{windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout).streams;
}
try {
  const file=resolve(host.base,'fixture.mp4');
  const fixture=spawnSync(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-f','lavfi','-i','sine=frequency=880:sample_rate=48000',
    '-t','3','-c:v','mpeg4','-q:v','5','-c:a','aac',file],{windowsHide:true,encoding:'utf8'});
  assert.equal(fixture.status,0,fixture.stderr);bytes=await readFile(file);
  await mkdir(resolve(host.base,'tools'),{recursive:true});await cp(cache,resolve(host.base,'tools/video'),{recursive:true});
  ui=await host.launch();popup=await host.connect('#popup');
  await popup.evaluate(`chrome.webview.addEventListener('message',e=>{if(e.data.popup==='videos')window.__video=e.data})`);
  const id=(await state()).activeId;await cmd({type:'nav.go',id,input:host.origin+'/video'});page=await host.connect(host.origin+'/video');
  await host.wait(async()=>(await state()).tabs.find(tab=>tab.id===id)?.videos>0,'video detection');
  for(const format of ['flac','wav','mp3']) {
    console.log('Checking native audio:',format);
    const view=await inspect(id);await audio(format);
    assert.equal(await popup.evaluate('document.querySelector(".video-download-btn").textContent.includes("'+format.toUpperCase()+'")'),true);
    if(format==='flac') {
      assert.match(await popup.evaluate('document.body.innerText'),/sans restaurer/);
      await writeFile(resolve(evidence,'audio-picker.png'),Buffer.from((await popup.call('Page.captureScreenshot')).data,'base64'));
      await popup.call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:false});
      assert(await popup.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Audio layout fits 320px');
      await writeFile(resolve(evidence,'audio-picker-320.png'),Buffer.from((await popup.call('Page.captureScreenshot')).data,'base64'));await popup.call('Emulation.clearDeviceMetricsOverride');
      const before=(await readdir(resolve(host.base,'downloads'))).length;await cmd({type:'video.download',id,query:view.sourceId,index:view.selected,output:'--exec bad'});
      assert.equal((await readdir(resolve(host.base,'downloads'))).length,before,'Untrusted format rejected');
    }
    await popup.evaluate('document.querySelector(".video-download-btn").click()');
    if(!dock) {
      dock=await host.connect('#dock');
  await dock.evaluate(`window.__allDownloads={};chrome.webview.addEventListener('message',e=>{if(e.data.popup==='downloads')for(const item of e.data.items??[])window.__allDownloads[item.id]=item});chrome.webview.postMessage('{"type":"dock.ready"}')`);
    }
    await host.wait(async()=>(await jobs()).some(job=>job.state==='Completed'&&extname(job.name)==='.'+format),'audio '+format,60000);
    const job=(await jobs()).find(job=>job.state==='Completed'&&extname(job.name)==='.'+format),streams=probe(resolve(host.base,'downloads',job.name));
    assert.equal(streams.length,1);assert.equal(streams[0].codec_name,{flac:'flac',wav:'pcm_f32le',mp3:'mp3'}[format]);
    if(format==='mp3')assert.equal(streams[0].bit_rate,'320000');
  }
  // Collection uses the same explicit output mode and validates its cached selection token.
  await cmd({type:'video.open',id});await cmd({type:'video.collection',id,query:'page',index:1});
  await host.wait(()=>popup.evaluate('window.__video?.collection&&window.__video.phase==="ready"'),'collection');
  await audio('flac');await popup.evaluate('document.querySelector(".video-collection-entry [role=checkbox]").click()');
  await writeFile(resolve(evidence,'audio-collection-picker.png'),Buffer.from((await popup.call('Page.captureScreenshot')).data,'base64'));
  await popup.evaluate('document.querySelector(".video-download-btn").click()');
  await host.wait(async()=>(await jobs()).filter(job=>job.state==='Completed').length===4,'batch audio conversion',60000);
  slow=true;await inspect(id);await audio('mp3');await popup.evaluate('document.querySelector(".video-download-btn").click()');
  const paused=await host.wait(async()=>(await jobs()).find(job=>job.state==='InProgress'&&job.received>0),'audio transfer progresses');
  await cmd({type:'download.pause',id:paused.id});await host.wait(async()=>{const job=(await jobs()).find(job=>job.id===paused.id);return job?.paused&&job.canResume;},'audio paused and resumable');
  await cmd({type:'download.resume',id:paused.id});await host.wait(async()=>{const job=(await jobs()).find(job=>job.id===paused.id);return job?.state==='InProgress'&&!job.paused;},'audio resumed');
  await cmd({type:'download.cancel',id:paused.id});await host.wait(async()=>(await jobs()).find(job=>job.id===paused.id)?.canceled,'audio canceled');
  await host.wait(async()=>(await readdir(resolve(host.base,'downloads'))).length===4,'canceled audio removes intermediates');
  await page.evaluate(`document.querySelector('video').dispatchEvent(new Event('encrypted',{bubbles:true}))`);
  await host.wait(async()=>(await state()).tabs.find(tab=>tab.id===id)?.videoProtected,'DRM detected');await cmd({type:'video.open',id});
  await host.wait(()=>popup.evaluate('window.__video?.protectedMedia'),'DRM blocked');assert.equal(await popup.evaluate('document.querySelector(".video-output-modes")===null'),true);
  assert(requests.every(request=>request.referer===host.origin+'/video'));
  assert.equal((await readdir(resolve(host.base,'tools/video'))).filter(name=>name.startsWith('cookies-')).length,0);
  await writeFile(resolve(evidence,'native-verification.json'),JSON.stringify({formats:['flac','wav','mp3'],mp3Bitrate:320000,
    checks:['beUI mode and format controls','320px','source quality text','invalid output rejected','audio-only files','collection audio',
      'progress','pause','resume','cancel','DRM blocked','scoped cookies and referer','cookie cleanup']},null,2));
  console.log('Native audio checks passed');await host.close(ui);
} finally {
  await host.dispose();assert.match(relative(resolve('bin'),host.base),/^sidebar-check-\d+$/);
  await rm(resolve(host.base,'tools'),{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
