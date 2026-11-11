import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {sidebarHost} from './sidebar-check-host.mjs';

const baseline=process.argv.includes('--baseline');
const evidence=resolve('bin/memory-evidence');
await mkdir(evidence,{recursive:true});
if(!baseline)await rm(resolve(evidence,'idle-panels-after.json'),{force:true});
const host=await sidebarHost(process.argv[2]??'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe',{performance:true});
let ui;
const command=c=>ui.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
async function checkPanel(name,open,close){
  await command(open);
  let panel=await host.connect('#'+name,null,60000);
  await host.wait(()=>panel.evaluate('document.readyState==="complete" && !!document.getElementById("root")?.firstElementChild').catch(()=>false),'panel ready');
  await panel.evaluate(`window.__idleDocument=${JSON.stringify(crypto.randomUUID())};window.__idleDraft=document.createElement('input');window.__idleDraft.value='Keep my draft';document.body.append(window.__idleDraft);window.__idleTicks=0;window.__idleTimes=[];window.__idleProbe=setInterval(()=>{window.__idleTicks++;window.__idleTimes.push(Date.now())},100)`);
  const documentId=await panel.evaluate('window.__idleDocument');
  await host.wait(()=>panel.evaluate('window.__idleTicks>=2'),'visible panel executes timers');
  await panel.disconnect();
  await command(close);
  if(name==='chat')await host.wait(()=>ui.evaluate('!window.__sidebarState.chatOpen'),'chat hidden');
  if(!baseline && name==='popup')await host.wait(async()=> (await readFile(resolve(host.profile,'debug.log'),'utf8')).includes(`ui.rest ${name} True`),name+' native suspension',15000);
  if(!baseline && name==='chat'){
    const hidden=await host.connect('#chat');
    await host.wait(()=>hidden.evaluate('document.querySelector(".sol-chat")?.style.display==="none"').catch(()=>false),'closed chat deactivates its React subtree');
    await hidden.disconnect();
  }
  const hiddenFrom=Date.now();await delay(2400);const hiddenUntil=Date.now();
  await command(open);
  panel=await host.connect('#'+name,null,60000);
  await host.wait(()=>panel.evaluate('document.readyState==="complete"').catch(()=>false),'panel resumed');
  const hiddenTicks=await panel.evaluate(`window.__idleTimes.filter(time=>time>${hiddenFrom+100}&&time<${hiddenUntil-100}).length`);
  assert.equal(await panel.evaluate('window.__idleDocument'),documentId,'reopening must preserve the document');
  assert.equal(await panel.evaluate('window.__idleDraft.value'),'Keep my draft','reopening must preserve drafts');
  const resumed=await panel.evaluate('window.__idleTicks');await host.wait(()=>panel.evaluate(`window.__idleTicks>${resumed}`),'reopened panel resumes timers');
  await panel.evaluate('clearInterval(window.__idleProbe);window.__idleDraft.remove()');await panel.disconnect();
  await command(close);
  return {hiddenTicks,preservedDocument:true,preservedDraft:true,resumed:true};
}
try{
  ui=await host.launch(760,1000,60000);
  await delay(1000);
  const startupTargets=(await host.targets()).map(target=>target.url);
  if(!baseline)assert(!startupTargets.includes('https://ui.navigateur/index.html#popup'),'popup renderer must remain unloaded before first use');
  const chat=await checkPanel('chat',{type:'chat.toggle'},{type:'chat.toggle'});
  const popup=await checkPanel('popup',{type:'settings.open',x:500,y:58},{type:'popup.close'});
  // Opening immediately after hiding must not be caught by an older suspension completion.
  for(let cycle=0;cycle<4;cycle++){
    await command({type:'chat.toggle'});await command({type:'chat.toggle'});await command({type:'chat.toggle'});
    const panel=await host.connect('#chat');
    assert(await panel.evaluate('!!document.querySelector(".sol-chat")'),'rapid reopen keeps chat usable');
    await panel.disconnect();await command({type:'chat.toggle'});
  }
  const log=await readFile(resolve(host.profile,'debug.log'),'utf8');
  const report={baseline,startupTargets,chat,popup,nativeRest:log.split(/\r?\n/).filter(line=>line.includes('ui.rest '))};
  await writeFile(resolve(evidence,baseline?'idle-panels-before.json':'idle-panels-after.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!baseline)assert(popup.hiddenTicks<=1,'closed popup must stop background timers');
  await host.close(ui);
}catch(error){
  await writeFile(resolve(evidence,'idle-native-debug.log'),await readFile(resolve(host.profile,'debug.log'),'utf8').catch(()=>''));throw error;
}finally{await host.dispose();}
