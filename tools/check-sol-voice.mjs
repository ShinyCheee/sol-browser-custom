import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access,mkdir,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {sidebarHost} from './sidebar-check-host.mjs';

const modelDirectory=resolve('bin/voice-check-models-'+Date.now());
process.env.SOL_VOICE_MODELS=modelDirectory;
const host=await sidebarHost(process.argv[2]||'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe');
const evidence=resolve('bin/voice-evidence');await mkdir(evidence,{recursive:true});
const shortcuts=(await readFile('src/Browser.Core/BrowserShortcuts.cs','utf8')).split(/\r?\n/).filter(line=>line.trim().startsWith('new('));
const voiceIndex=shortcuts.findIndex(line=>line.includes('"voice.toggle"'));
assert(voiceIndex>=0);assert.match(shortcuts[voiceIndex],/0x4D,2,/,'one Ctrl+M binding');
const tokens={ClientId:'oaiapp_test',Subject:'fixture',Email:'voice@example.invalid',IdToken:'fixture',AccessToken:'fixture-no-inference',RefreshToken:'fixture',Expires:new Date(Date.now()+3600000).toISOString(),Scopes:'openid chatgpt.tokens.use.direct'};
const bytes=Buffer.from(JSON.stringify(tokens)).toString('base64');
const protect='Add-Type -AssemblyName System.Security;[IO.File]::WriteAllBytes(\''+resolve(host.profile,'chatgpt.bin')+'\',[Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String(\''+bytes+'\'),[Text.Encoding]::UTF8.GetBytes(\'Sol.ChatGPT\'),[Security.Cryptography.DataProtectionScope]::CurrentUser))';
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',protect],{windowsHide:true});
let ui,chat;
const command=c=>ui.evaluate('chrome.webview.postMessage('+JSON.stringify(JSON.stringify(c))+')');
const inject=voice=>chat.evaluate('chrome.webview.dispatchEvent(new MessageEvent("message",{data:{voice:'+JSON.stringify(voice)+'}}))');
function hotkey(count=1) {
  const script='Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class VoiceKey { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l); }\';$h=(Get-Process -Id '+host.pid+').MainWindowHandle;if($h -eq 0){throw "Missing test window"};for($i=0;$i -lt '+count+';$i++){if(-not [VoiceKey]::PostMessage($h,0x312,[IntPtr]'+voiceIndex+',[IntPtr]0)){throw "Hotkey dispatch failed"}}';
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true});
}
try {
  ui=await host.launch(900,1250,60000);
  hotkey(2);await delay(700);
  await host.wait(()=>ui.evaluate('!window.__sidebarState.chatOpen'),'second press cancels voice startup');
  hotkey();
  const popup=await host.connect('#popup');
  await host.wait(()=>popup.evaluate('!!document.querySelector(".voice-install")'),'setup moved to settings');
  assert(await popup.evaluate('document.querySelector(".voice-settings").textContent.includes("Ctrl+M")'),'shortcut discoverable in settings');
  assert.match(await popup.evaluate('document.querySelector(".settings-nav [aria-selected=true]")?.textContent'),/^Sol(?:Sol)*$/,'voice setup opens Sol section');
  chat=await host.connect('#chat');
  await host.wait(()=>chat.evaluate('!!document.querySelector(".sol-chat-input textarea")'),'normal chat remains available before setup');
  assert.equal(await chat.evaluate('document.querySelectorAll(".sol-voice").length'),0,'no voice view before installation');
  await popup.evaluate('document.querySelector(".voice-install").click()');
  await host.wait(()=>popup.evaluate('!!document.querySelector(".voice-progress")'),'real installer starts from settings');
  await popup.evaluate('document.querySelector(".voice-settings .pill-action").click()');
  await host.wait(()=>popup.evaluate('!!document.querySelector(".voice-install")'),'installer cancelled');
  assert(!(await readdir(modelDirectory)).some(name=>name.endsWith('.part')||name.endsWith('.gguf')),'cancel leaves no model');
  hotkey();await host.wait(()=>ui.evaluate('!window.__sidebarState.chatOpen'),'same key closes setup and voice-owned chat');
  await command({type:'chat.toggle'});await host.wait(()=>chat.evaluate('!!document.querySelector(".sol-chat-input textarea")'),'normal chat');
  assert.equal(await chat.evaluate('document.querySelectorAll("[aria-label=\\"Mode vocal\\"],[aria-label=\\"Voice mode\\"]").length'),0,'no extra voice button');
  const fixture={available:true,supported:true,open:true,ready:true,provider:'parakeet',mode:'listening',level:.5,text:'This transcript must not be displayed',error:null,conversation:true,readAloud:true,progress:0,device:-1,devices:[],downloadMiB:767};
  await popup.evaluate('chrome.webview.addEventListener("message",e=>{const d=typeof e.data==="string"?JSON.parse(e.data):e.data;if(d.popup==="settings")window.__voiceSettingsSnapshot=d})');
  await command({type:'settings.open',x:500,y:58});
  await host.wait(()=>popup.evaluate('!!window.__voiceSettingsSnapshot'),'settings voice snapshot');
  await popup.evaluate('chrome.webview.addEventListener("message",e=>{});chrome.webview.dispatchEvent(new MessageEvent("message",{data:{...window.__voiceSettingsSnapshot,ai:{...window.__voiceSettingsSnapshot.ai,voice:'+JSON.stringify({...fixture,mode:'thinking'})+'}}}))');
  await host.wait(()=>popup.evaluate('!!document.querySelector(".voice-read-aloud")'),'active voice settings');
  assert.equal(await popup.evaluate('document.querySelectorAll(".voice-modes").length'),0,'no manual instruction/conversation selector');
  assert.equal(await popup.evaluate('document.querySelector(".voice-read-aloud button").disabled'),false,'spoken responses remain adjustable during a request');
  await command({type:'popup.close'});
  for(const theme of ['light','dark']) {
    await command({type:'settings.set',id:'theme',index:theme==='light'?1:2});
    for(const width of [220,380,520]) {
      await chat.call('Emulation.setDeviceMetricsOverride',{width,height:600,deviceScaleFactor:1,mobile:false});
      await chat.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:width===220?'reduce':'no-preference'}]});
      for(const mode of ['idle','checking','installing','listening','transcribing','thinking','speaking','paused','error']) {
        await inject({...fixture,mode,error:null});
        await host.wait(()=>chat.evaluate('document.querySelector(".sol-voice")?.dataset.voiceMode==='+JSON.stringify(mode)),'voice state');
        assert.equal(await chat.evaluate('document.body.innerText.trim()'),'','only the orb, no visible text');
        assert.equal(await chat.evaluate('document.querySelectorAll("button,input,select,textarea,progress").length'),1,'only the orb itself is interactive');
        if(mode==='thinking'||mode==='transcribing')assert(await chat.evaluate('document.querySelector(".voice-phase-ring")?.dataset.processing==="true"'),'processing remains visibly animated with no microphone level');
        assert(await chat.evaluate('document.querySelectorAll(".sol-voice-orb").length===1'),'one orb');
        assert(await chat.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'fits narrow view');
        if(theme==='dark'&&width===380&&['listening','transcribing','thinking','speaking'].includes(mode))
          await writeFile(resolve(evidence,'voice-state-'+mode+'.png'),Buffer.from((await chat.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
      await inject(fixture);await delay(100);
      if(width===380)await writeFile(resolve(evidence,'voice-orb-only-'+theme+'.png'),Buffer.from((await chat.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
  }
  await inject({...fixture,readAloud:false});
  await host.wait(()=>chat.evaluate('!!document.querySelector(".sol-chat-input textarea")'),'muted voice uses the readable chat');
  await inject({...fixture,error:'microphone',mode:'error'});
  await host.wait(()=>chat.evaluate('!!document.querySelector("[role=alert]")'),'microphone error is visible instead of a silent orb');
  await inject(fixture);
  const approval={chat:true,ready:true,account:'fixture',busy:true,error:null,messages:[],voice:fixture,agent:{steps:[],approval:{id:'fixture',label:'Confirmer la demande de test',detail:'Action de test explicite'}}};
  await chat.evaluate('chrome.webview.dispatchEvent(new MessageEvent("message",{data:'+JSON.stringify(approval)+'}))');
  await host.wait(()=>chat.evaluate('document.body.textContent.includes("Confirmer la demande de test")'),'explicit approval remains readable');
  await command({type:'chat.ready'});await command({type:'voice.open'});
  await host.wait(()=>chat.evaluate('!!document.querySelector(".sol-voice")'),'native voice open');
  hotkey();await host.wait(()=>chat.evaluate('!!document.querySelector(".sol-chat-input textarea")'),'Ctrl+M exits voice to existing chat');
  assert.equal(await chat.evaluate('document.querySelectorAll(".sol-voice").length'),0);
  await command({type:'window.private'});
  await host.wait(()=>ui.evaluate('window.__sidebarState.privateMode&&!window.__sidebarState.chatOpen'),'private transition closes voice');
  hotkey();await delay(200);
  assert(await ui.evaluate('window.__sidebarState.privateMode&&!window.__sidebarState.chatOpen'),'private mode cannot activate voice');
  await host.close(ui);
  console.log('PASS Ctrl+M native hotkey start/stop/startup-cancel/private; setup in settings; orb-only all states/themes/widths/reduced motion; explicit approval retained; no microphone or inference used');
} catch(error) {
  if(chat)await writeFile(resolve(evidence,'minimal-failure.txt'),await chat.evaluate('document.body.innerText')).catch(()=>{});
  if(ui)await writeFile(resolve(evidence,'automatic-failure-state.json'),JSON.stringify(await ui.evaluate('window.__sidebarState'))).catch(()=>{});
  await writeFile(resolve(evidence,'automatic-failure-native.log'),await readFile(resolve(host.profile,'debug.log'))).catch(()=>{});
  throw error;
} finally {
  await host.dispose();await assert.rejects(access(host.profile));
  assert(modelDirectory.startsWith(resolve('bin/voice-check-models-')));
  await rm(modelDirectory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
