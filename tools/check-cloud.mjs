// Sauvegarde en ligne dans une vraie fenêtre de Sol, contre une branche Neon jetable :
// node tools/check-cloud.mjs <Sol.exe> <fichier .env de la branche>. Refuse la production.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readCloudEnv,verifyCloudTestEnv} from './cloud-test-guard.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {sidebarHost} from './sidebar-check-host.mjs';

const exe=process.argv[2]??'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe';
const env=readCloudEnv(process.argv[3]??'.env.local');
const {auth,api}=await verifyCloudTestEnv(env);
process.env.NAVIGATEUR_CLOUD_AUTH=auth;
process.env.NAVIGATEUR_CLOUD_API=api;
const ok=label=>console.log(`ok - ${label}`);
const host=await sidebarHost(exe);
let diagnostics;
try{
  let ui=await host.launch(850,1200);
  const command=c=>ui.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(c))})`);
  await command({type:'settings.open',x:900,y:60});
  let popup=await host.connect('#popup');
  await host.wait(()=>popup.evaluate(`document.readyState==='complete'&&!!document.querySelector('.settings-popup')`).catch(()=>false),'first settings paint',60000);
  await popup.evaluate(`chrome.webview.addEventListener('message',e=>{if(e.data.popup)window.__popup=e.data})`);
  diagnostics=()=>popup.evaluate(`window.__popup && ({popup:window.__popup.popup,title:window.__popup.title,hint:window.__popup.hint,error:window.__popup.cloud?.error,busy:window.__popup.cloud?.busy})`);
  const openSettings=async()=>{
    await command({type:'popup.close'});await delay(600);
    await popup.evaluate('window.__popup=null');
    await command({type:'settings.open',x:900,y:60});
    await host.wait(()=>popup.evaluate(`!!document.querySelector('.settings-popup')`),'settings rendered',30000);
    await command({type:'cloud.refresh'});
    await host.wait(()=>popup.evaluate(`window.__popup?.popup==='settings'`),'settings state received',30000);
  };
  await openSettings();
  const cloud=()=>popup.evaluate('window.__popup?.cloud');
  const refreshCloud=async()=>{
    await command({type:'cloud.refresh'});
    await host.wait(async()=>(await cloud())?.busy===true,'cloud refresh starts');
    await host.wait(async()=>(await cloud())?.busy===false,'cloud refresh finishes');
  };
  const email=`sol-e2e-app-${Date.now()}@example.com`,password=randomBytes(18).toString('base64url'),key=randomBytes(18).toString('base64url');
  await command({type:'cloud.sign',id:'in',query:email,input:password});
  await host.wait(async()=>(await cloud())?.error==='credentials','wrong account reported',30000);ok('compte inconnu : erreur claire');
  await command({type:'cloud.sign',id:'up',query:email,input:password});
  await host.wait(async()=>(await cloud())?.email===email,'account created',30000);ok('compte créé depuis Sol');
  assert.deepEqual((await cloud()).backups,[]);
  // Le mot de passe du compte est refusé comme clé.
  await command({type:'cloud.backup'});await delay(300);
  await command({type:'cloud.backup.key',title:password});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/différente|differ/.test(window.__popup.hint)`),'account password refused as key');ok('mot de passe du compte refusé comme clé');
  await command({type:'cloud.backup'});await delay(300);
  await command({type:'cloud.backup.key',title:key});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/envoyée|sent/.test(window.__popup.title)`),'backup sent',40000);ok('profil scellé et envoyé');
  await openSettings();
  await refreshCloud();
  const list=await host.wait(async()=>{const c=await cloud();return c?.backups?.length===1&&c.backups;},'backup listed',30000);
  assert(list[0].bytes>10);ok(`sauvegarde listée (${list[0].bytes} octets)`);
  const originalId=list[0].id;
  await host.wait(async()=>(await cloud())?.busy===false,'cloud idle before manual update');
  for(let attempt=0;attempt<2;attempt++){
    await popup.evaluate('window.__popup=null');
    await command({type:'cloud.backup'});
    await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/envoyée|sent/.test(window.__popup.title)`),'manual backup reuses the saved key',60000);
    await openSettings();await refreshCloud();
    await host.wait(async()=>{const c=await cloud();return !c.busy&&c.backups.length===1;},'updated backup listed');
    assert.equal((await cloud()).backups[0].id,originalId,'manual updates keep the backup identity');
  }
  assert(!(await readFile(resolve(host.profile,'cloud-session.bin'))).includes(Buffer.from(key)),'the saved key must be protected on disk');
  const evidence=resolve('bin/memory-evidence');await mkdir(evidence,{recursive:true});
  await popup.evaluate(`document.querySelector('.settings-nav [data-tabs-value="data"]').click()`);
  await host.wait(()=>popup.evaluate(`document.querySelector('.sol-cloud')?.hidden===false`),'backup settings are visible');
  await refreshCloud();
  await popup.evaluate(`document.querySelector('.sol-cloud').scrollIntoView({block:'start'})`);
  await delay(300);
  await writeFile(resolve(evidence,'backup-settings.png'),Buffer.from((await popup.call('Page.captureScreenshot')).data,'base64'));
  await command({type:'cloud.auto',index:1});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/envoyée|sent/.test(window.__popup.title)`),'automatic mode reuses the same key',60000);
  await openSettings();await refreshCloud();
  await host.wait(async()=>{const c=await cloud();return !c.busy&&c.auto&&c.backups.length===1;},'automatic backup enabled');
  assert.equal((await cloud()).backups[0].id,originalId);
  await command({type:'cloud.auto',index:0});
  await host.wait(async()=>(await cloud())?.auto===false,'automatic mode disabled');
  await host.close(ui);
  const closedBy=Date.now()+30000;
  while((await host.targets()).length&&Date.now()<closedBy)await delay(100);
  assert.equal((await host.targets()).length,0,'previous WebView runtime has closed');
  ui=await host.launch(850,1200);
  await command({type:'settings.open',x:900,y:60});popup=await host.connect('#popup');
  await host.wait(()=>popup.evaluate(`document.readyState==='complete'&&!!document.querySelector('.settings-popup')`).catch(()=>false),'restarted settings paint',60000);
  await popup.evaluate(`chrome.webview.addEventListener('message',e=>{if(e.data.popup)window.__popup=e.data})`);
  await openSettings();await refreshCloud();
  await popup.evaluate('window.__popup=null');await command({type:'cloud.backup'});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/envoyée|sent/.test(window.__popup.title)`),'saved key survives restart with automatic mode disabled',60000);
  await openSettings();await refreshCloud();
  await host.wait(async()=>{const c=await cloud();return !c.busy&&c.backups.length===1;},'backup still unique after restart');
  assert.equal((await cloud()).backups[0].id,originalId);
  assert.equal((await cloud()).auto,false);
  ok('même clé après redémarrage, automatique désactivé, même sauvegarde mise à jour');
  await delay(3000);await host.wait(async()=>(await cloud())?.busy===false,'cloud idle');
  await command({type:'cloud.restore',id:list[0].id});
  await delay(4000);
  await command({type:'backup.restore',title:'mauvaise-cle-de-test'});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/incorrecte|wrong/.test(window.__popup.hint)`),'wrong key refused',25000);ok('mauvaise clé refusée');
  await command({type:'backup.restore',title:key});
  await host.wait(()=>popup.evaluate(`window.__popup?.popup==='notice'&&/prête|ready/.test(window.__popup.title)`),'restore staged',60000);ok('restauration prête au prochain démarrage');
  await host.close(ui);
  console.log('PASS cloud in Sol');
}catch(error){
  if(diagnostics)console.error('Cloud UI state:',await diagnostics().catch(()=>null));
  const log=await readFile(resolve(host.profile,'debug.log'),'utf8').catch(()=>'');
  console.error(log.split(/\r?\n/).filter(line=>/cloud\.|popup\.|ui.rest|commande settings/.test(line)).slice(-20).join('\n'));
  throw error;
}finally{await host.dispose();}
