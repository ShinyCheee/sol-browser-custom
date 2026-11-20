import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {sidebarHost} from './sidebar-check-host.mjs';
const payload=Buffer.alloc(2*1024*1024,7);
const completing=new Set();
const names=['notes-du-projet-version-complete-avec-un-nom-long.txt','archive-du-projet-avec-un-nom-long.zip','document.pdf','file-3.bin'];
const host=await sidebarHost(process.argv[2]??'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe',{downloads:true,serve(req,res){
  if(!req.url.startsWith('/stack/'))return false;
  const start=Number(/^bytes=(\d+)-/.exec(req.headers.range??'')?.[1]??0);
  if(start>=payload.length){res.writeHead(416,{'Content-Range':`bytes */${payload.length}`});res.end();return true;}
  res.writeHead(start?206:200,{'Content-Type':'application/octet-stream','Content-Length':payload.length-start,'Accept-Ranges':'bytes',...(start?{'Content-Range':`bytes ${start}-${payload.length-1}/${payload.length}`}:{}) ,'Content-Disposition':`attachment; filename="${req.url.split('/').at(-1)}"`});
  let offset=start;const timer=setInterval(()=>{if(offset===payload.length){clearInterval(timer);res.end();return;}if(offset>=payload.length-16384&&!completing.has(req.url))return;const end=Math.min(payload.length,offset+16384);res.write(payload.subarray(offset,end));offset=end;},100);res.on('close',()=>clearInterval(timer));return true;
}});
let sidebar,dock;
const cmd=c=>sidebar.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
const latest=()=>dock.evaluate('window.__downloads?.items??[]');
const expanded=()=>dock.evaluate('document.querySelector(".sol-download-stack").getAttribute("aria-expanded")==="true"');
const point=selector=>dock.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const clickFooter=async()=>{
  const pos=await point('.sol-download-stack-footer');
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await dock.call('Input.dispatchMouseEvent',{type,...pos,...(type==='mouseMoved'?{}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})});
};
const key=async(key,code,virtual)=>{for(const type of ['keyDown','keyUp'])await dock.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtual,...(type==='keyDown'?{text:key==='Enter'?'\r':key,unmodifiedText:key==='Enter'?'\r':key}:{})});};
try{
  sidebar=await host.launch(380);const source=(await sidebar.evaluate('window.__sidebarState')).tabs.find(t=>t.url===host.origin+'/2');
  for(let i=0;i<4;i++){
    await cmd({type:'tab.activate',id:source.id});const page=await host.connect(source.url);
    await page.evaluate(`void window.open(${JSON.stringify(host.origin+'/stack/'+names[i])})`);
    if(!dock){dock=await host.connect('#dock');await host.wait(()=>dock.evaluate('!!document.querySelector(".sol-download-stack")').catch(()=>false),'stack ready');await dock.evaluate(`chrome.webview.addEventListener('message',e=>{if(e.data.popup==='downloads')window.__downloads=e.data});chrome.webview.postMessage('{"type":"dock.ready"}')`);}
    await host.wait(()=>latest().then(items=>items.some(d=>d.name===names[i])),'queued download '+i);
  }
  const evidence=resolve('bin/appearance-review');
  await mkdir(evidence,{recursive:true});
  const save=async name=>writeFile(resolve(evidence,name),Buffer.from((await dock.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await host.wait(()=>dock.evaluate('document.querySelector(".sol-download-stack-footer")?.textContent.includes("4 téléchargements en cours")'),'four active downloads are summarized');
  assert.equal(await dock.evaluate('document.querySelectorAll(".download-card").length'),0,'collapsed dock has no download cards');
  await save('downloads-compact.png');
  for(const [width,zoom] of [[320,1],[240,1],[180,1],[320,2]]){
    await dock.call('Emulation.setDeviceMetricsOverride',{width,height:200,deviceScaleFactor:1,mobile:false});
    for(const dir of ['ltr','rtl']){
      const layout=await dock.evaluate(`(()=>{
        document.documentElement.dir='${dir}';
        document.querySelector('.dock-downloads').style.zoom='${zoom}';
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const footer=rect('.sol-download-stack-footer'), close=rect('.dock-hide-downloads');
        const label=rect('.dock-download-summary > span'), arrow=rect('.dock-download-summary > svg');
        const range=document.createRange();
        range.selectNodeContents(document.querySelector('.dock-download-summary > span'));
        return {
          fits:document.documentElement.scrollWidth<=innerWidth+1,
          separates:${dir==='ltr'?'footer.right<close.left&&label.right<arrow.left':'close.right<footer.left&&arrow.right<label.left'},
          aligns:Math.abs(footer.top+footer.height/2-close.top-close.height/2)<1,
          insets:footer.left>0&&close.left>0&&footer.right<innerWidth&&close.right<innerWidth,
          grows:footer.height>=label.height,
          readable:${zoom}===2||new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size<=2,
        };
      })()`);
      assert.deepEqual(layout,{fits:true,separates:true,aligns:true,insets:true,grows:true,readable:true},`compact controls at ${width}px in ${dir} at ${zoom*100}%`);
      if(width===180&&dir==='ltr'){
        const clip=await dock.evaluate('({x:0,y:0,width:innerWidth,height:Math.ceil(document.querySelector(".download-stack-dock").getBoundingClientRect().bottom),scale:1})');
        const shot=await dock.call('Page.captureScreenshot',{format:'png',clip});
        await writeFile(resolve(evidence,'downloads-narrow.png'),Buffer.from(shot.data,'base64'));
      }
    }
  }
  await dock.evaluate('document.documentElement.dir="ltr";document.querySelector(".dock-downloads").style.zoom=""');
  await dock.call('Emulation.clearDeviceMetricsOverride');
  await clickFooter();
  assert(await dock.evaluate('!!document.querySelector(".sol-surface-card.download-stack-dock[data-slot=card]")'),'one outer beUI Card contains the download stack');
  await host.wait(()=>dock.evaluate('document.querySelectorAll(".download-card").length===4'),'expanded stack includes all downloads');
  assert.equal(await dock.evaluate('document.querySelectorAll("button button").length'),0,'actions are independent controls');
  await delay(400);
  assert(await dock.evaluate('innerHeight<340'),'native stack stays inside short window');
  assert(await dock.evaluate('document.querySelector(".sol-download-stack-footer").getBoundingClientRect().bottom<=innerHeight+1'),'footer visible without scrolling the whole panel');
  await dock.evaluate('document.querySelector(".sol-download-stack-footer").scrollIntoView({block:"end"})');
  assert(await dock.evaluate('document.querySelector(".sol-download-stack-footer").getBoundingClientRect().bottom<=innerHeight+1'),'footer reachable by scrolling');
  const shot=await dock.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(host.base,'download-stack-expanded.png'),Buffer.from(shot.data,'base64'));
  await save('downloads-expanded.png');
  const pause=(await latest()).find(d=>d.name===names[0]);await cmd({type:'download.pause',id:pause.id});await host.wait(()=>latest().then(items=>items.find(d=>d.id===pause.id)?.paused),'paused card');
  const openHeight=await dock.evaluate('innerHeight');
  for(let i=0;i<3;i++){
    await clickFooter();await host.wait(async()=>!(await expanded()),'mouse collapse');await delay(650);
    assert.equal(await expanded(),false,'native resizing must not reopen the stack under the cursor');
    assert(await dock.evaluate('innerHeight')<openHeight,'native download window shrinks');
    await clickFooter();await host.wait(expanded,'mouse expands again');await delay(350);
  }
  await dock.evaluate('document.querySelector(".sol-download-stack-footer").focus()');
  await key('Enter','Enter',13);await host.wait(async()=>!(await expanded()),'keyboard collapse');await delay(650);assert.equal(await expanded(),false,'keyboard collapse persists');
  await key(' ','Space',32);await host.wait(expanded,'keyboard expands again');await delay(350);
  const iconSelector='.download-card [data-icon="play"]',signature=()=>dock.evaluate(`(()=>{const s=document.querySelector('${iconSelector} svg');return s.innerHTML+getComputedStyle(s).transform})()`);
  assert(await dock.evaluate(`!!document.querySelector('${iconSelector}')`),'resume uses lucide-animated PlayIcon');
  assert(await dock.evaluate(`!document.querySelector('${iconSelector}').closest('button').disabled`),'paused fixture can resume');
  await dock.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await dock.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await delay(600);const before=await signature();
  await dock.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(iconSelector)});
  await host.wait(()=>dock.evaluate(`document.querySelector('${iconSelector}').dataset.animating==='true'`),'resume hover animation starts');
  await host.wait(async()=>(await signature())!==before,'the SVG actually animates');
  await dock.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await delay(600);
  await dock.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(200);const still=await signature();
  await dock.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(iconSelector)});await delay(250);
  assert.notEqual(await dock.evaluate(`document.querySelector('${iconSelector}').dataset.animating`),'true','reduced motion disables decorative animation');assert.equal(await signature(),still,'reduced motion leaves the SVG still');
  await dock.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const index of [0,1,2]){
    await cmd({type:'settings.set',id:'uiScale',index});
    for(const width of [360,240,180]){
      await dock.call('Emulation.setDeviceMetricsOverride',{width,height:300,deviceScaleFactor:1,mobile:false});await delay(250);
      const layout=await dock.evaluate('(()=>{const cards=[...document.querySelectorAll(".download-card")].filter(el=>!el.closest("[inert]"));return {viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,cards:cards.map(el=>({card:el.getBoundingClientRect().right,buttons:[...el.querySelectorAll("button")].map(b=>({text:b.textContent,right:b.getBoundingClientRect().right,left:b.getBoundingClientRect().left}))}))}})()');
      assert(!layout.overflow,JSON.stringify(layout));
      assert(layout.cards.every(card=>card.card<=layout.viewport+1&&card.buttons.every(button=>button.left>=0&&button.right<=layout.viewport+1)),JSON.stringify(layout));
      if(index===0&&width===240){const image=await dock.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(host.base,'downloads-small.png'),Buffer.from(image.data,'base64'));}
    }
  }
  await cmd({type:'settings.set',id:'theme',index:2});
  await dock.call('Emulation.setDeviceMetricsOverride',{width:240,height:300,deviceScaleFactor:1,mobile:false});await delay(250);
  const darkShot=await dock.call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(host.base,'downloads-small-dark.png'),Buffer.from(darkShot.data,'base64'));
  await dock.call('Emulation.clearDeviceMetricsOverride');
  await clickFooter();
  completing.add('/stack/'+names[1]);
  await host.wait(()=>latest().then(items=>items.find(d=>d.name===names[1])?.state==='Completed'),'one download completes');
  await delay(7000);
  await host.wait(()=>dock.evaluate('document.querySelector(".sol-download-stack-footer")?.textContent.includes("1 sur 4 terminé")'),'completed count survives during the active batch');
  await save('downloads-mixed.png');
  await dock.evaluate('document.querySelector(".dock-hide-downloads").click()');
  await host.wait(()=>dock.evaluate('!document.querySelector(".download-stack-dock")'),'dock hidden by its own button');
  await cmd({type:'downloads.open',x:650,y:350});
  const menu=await host.connect('#popup');
  await host.wait(()=>menu.evaluate('document.querySelector(".download-popup-display button")?.getAttribute("aria-pressed")==="false"'),'download panel offers restoration');
  await menu.evaluate('document.querySelector(".download-popup-display button").click()');
  await host.wait(()=>dock.evaluate('!!document.querySelector(".sol-download-stack-footer")'),'restored from downloads panel');
  for(const name of names)completing.add('/stack/'+name);
  await cmd({type:'download.resume',id:pause.id});
  await host.wait(()=>dock.evaluate('document.querySelector(".sol-download-stack-footer")?.textContent.includes("4 téléchargements terminés")'),'all four completions are summarized');
  await save('downloads-done.png');
  console.log(JSON.stringify({passed:'four native downloads; mouse/keyboard collapse persists after native resizing and can reopen; lucide-animated resume SVG animates on hover and respects reduced motion; long filenames; paused card; actions fit 360/240/180px at three UI scales; independent actions; native bounds and reachable footer',evidence:host.base}));
}catch(error){if(dock)console.error('STACK',await dock.evaluate('({text:document.body.innerText,height:innerHeight,scroll:document.querySelector("#root").scrollHeight,client:document.querySelector("#root").clientHeight,items:window.__downloads?.items,buttons:[...document.querySelectorAll("button")].map(b=>({text:b.textContent,disabled:b.disabled,hover:b.matches(":hover"),y:b.getBoundingClientRect().y})),reduce:matchMedia("(prefers-reduced-motion: reduce)").matches})').catch(()=>null));throw error;}
finally{if(sidebar)await host.close(sidebar).catch(()=>{});await host.dispose();}
