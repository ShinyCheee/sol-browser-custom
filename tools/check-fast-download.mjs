// Téléchargements accélérés dans le vrai Sol : un gros fichier dont le serveur accepte les plages part sur plusieurs
// connexions, arrive identique, et l'encart n'affiche que la progression et la vitesse. Un serveur sans plages reste au moteur.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sidebarHost} from './sidebar-check-host.mjs';

const big=randomBytes(48<<20), plain=randomBytes(6<<20);
let active=0,peak=0,ranged=0;
const host=await sidebarHost(process.argv[2]??'src/Browser.App/bin/x64/Release/net10.0-windows10.0.19041.0/win-x64/Sol.exe',{downloads:true,serve(req,res){
  const file=req.url==='/files/parallel.bin'?big:req.url==='/files/plain.bin'?plain:null;
  if(!file)return false;
  const ranges=file===big;
  const match=ranges?/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??''):null;
  const from=match?Number(match[1]):0,to=match?.[2]?Math.min(Number(match[2]),file.length-1):file.length-1;
  if(match)ranged++;
  res.writeHead(match?206:200,{'Content-Type':'application/octet-stream','Content-Length':to-from+1,'ETag':'"v1"',...(ranges?{'Accept-Ranges':'bytes'}:{}),
    ...(match?{'Content-Range':`bytes ${from}-${to}/${file.length}`}:{}),'Content-Disposition':`attachment; filename="${req.url.split('/').pop()}"`});
  // Débit limité par connexion, comme beaucoup de serveurs : c'est ce que le parallélisme contourne.
  active++;peak=Math.max(peak,active);
  let offset=from;const timer=setInterval(()=>{if(offset>to){clearInterval(timer);res.end();return;}const end=Math.min(to+1,offset+(32<<10));res.write(file.subarray(offset,end));offset=end;},20);
  res.on('close',()=>{clearInterval(timer);active--;});
  return true;
}});
const downloads=resolve(host.base,'downloads');
// Le moteur écrit directement sous le nom final : le fichier n'est complet qu'à sa taille finale.
const arrived=(name,size)=>readdir(downloads).then(n=>n.includes(name)?stat(resolve(downloads,name)).then(s=>s.size===size):false);
const same=async(name,data)=>Buffer.compare(await readFile(resolve(downloads,name)),data)===0;
let sidebar;
try{
  sidebar=await host.launch(380);
  const source=(await sidebar.evaluate('window.__sidebarState')).tabs.find(t=>t.url===host.origin+'/2');
  const page=await host.connect(source.url);
  const started=Date.now();
  await page.evaluate(`void window.open(${JSON.stringify(host.origin+'/files/parallel.bin')})`);
  // L'encart montre la vitesse ; les connexions parallèles restent invisibles pour l'utilisateur.
  let dock=null,shown='';
  await host.wait(async()=>{
    try{dock??=await host.connect('#dock',null,3000);shown=await dock.evaluate('document.body.innerText');}catch{dock=null;return false;}
    return /\/s/.test(shown);
  },'dock shows the download speed',30000);
  assert(!/connexions|connections/.test(shown),'the dock does not mention connections');
  console.log('ok - encart : '+shown.split('\n').find(l=>/\/s/.test(l)));
  await host.wait(()=>arrived('parallel.bin',big.length),'parallel download finished',90000);
  const seconds=(Date.now()-started)/1000;
  assert(await same('parallel.bin',big),'parallel file is byte for byte identical');
  assert(peak>=4,`expected parallel connections, saw ${peak}`);
  assert(ranged>=4,`expected range requests, saw ${ranged}`);
  assert(!(await readdir(downloads)).some(n=>n.endsWith('.part')||n.endsWith('.sol-plan')),'no leftover part files');
  // Une connexion seule plafonne ici à 1,6 Mo/s : 48 Mo lui prendraient environ 30 s.
  const single=big.length/(1.6*1024*1024);
  assert(seconds<single/3,`parallel download took ${seconds.toFixed(1)} s, a single connection needs ~${single.toFixed(0)} s`);
  console.log(`ok - 48 Mo en ${seconds.toFixed(1)} s sur ${peak} connexions, contre ~${single.toFixed(0)} s sur une seule (${(big.length/1048576/seconds).toFixed(1)} Mo/s)`);

  peak=0;
  await page.evaluate(`void window.open(${JSON.stringify(host.origin+'/files/plain.bin')})`);
  await host.wait(()=>arrived('plain.bin',plain.length),'engine download finished',60000);
  assert(await same('plain.bin',plain),'engine file is identical');
  // Le moteur, plus la petite sonde d'un octet qui a vérifié que le découpage était impossible.
  assert(peak<=2,`a server without ranges is not split (${peak} connections)`);
  console.log('ok - serveur sans plages : le moteur du navigateur télécharge seul, comme avant');
  console.log('PASS accelerated downloads');
  await host.close(sidebar);
}finally{await host.dispose();}
