import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {basename,extname,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';

const dotnet=resolve(process.env.DOTNET_ROOT??'E:/dev/dotnet','dotnet.exe');
const project=resolve('tools/audio-check-engine/AudioCheck.csproj');
const runner=resolve('bin/audio-check-engine/Debug/net10.0/AudioCheck.dll');
const cache=resolve(process.env.NAVIGATEUR_AUDIO_ENGINE_CACHE??'E:/dev/tmp/sol-audio-engine-cache');
const root=resolve(tmpdir(),`sol-audio-engine-${process.pid}`),evidence=resolve('bin/audio-evidence');
await mkdir(root,{recursive:true});await mkdir(evidence,{recursive:true});
async function run(file,args) {
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='';
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const [code]=await once(child,'exit');assert.equal(code,0,`${basename(file)} failed: ${output}\n${errors}`);return output;
}
await run(dotnet,['build',project,'--nologo','-v:q']);
await run(dotnet,[runner,cache]);
const receipt=JSON.parse(await readFile(resolve(cache,'ffmpeg.json'),'utf8'));
const ffmpeg=resolve(cache,'ffmpeg',receipt.find(entry=>basename(entry.File)==='ffmpeg.exe').File),ffprobe=resolve(ffmpeg,'../ffprobe.exe');
function ff(args,encoding='utf8') {
  const result=spawnSync(ffmpeg,['-v','error','-y',...args],{windowsHide:true,encoding,cwd:root});
  assert.equal(result.status,0,String(result.stderr));return result.stdout;
}
ff(['-f','lavfi','-i','testsrc2=size=320x180:rate=12','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','3',
  '-c:v','mpeg4','-q:v','5','-c:a','aac',resolve(root,'clip.mp4')]);
ff(['-i',resolve(root,'clip.mp4'),'-map','0:a:0','-c','copy',resolve(root,'track.m4a')]);
ff(['-i',resolve(root,'clip.mp4'),'-map','0:v:0','-c','copy',resolve(root,'silent.mp4')]);
ff(['-i',resolve(root,'clip.mp4'),'-c:v','mpeg2video','-c:a','aac','-f','hls','-hls_time','1','-hls_list_size','0',resolve(root,'stream.m3u8')]);
ff(['-i',resolve(root,'clip.mp4'),'-map','0:v','-map','0:a','-map','0:a','-c:v','copy','-c:a','aac','-b:a:0','64k','-b:a:1','192k',
  '-f','dash','-adaptation_sets','id=0,streams=v id=1,streams=a',resolve(root,'best.mpd')]);
const focused=process.argv.includes('--focused');
const requests=[],files=new Map(await Promise.all((await readdir(root)).map(async name=>[name,await readFile(resolve(root,name))])));
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://local').pathname,name=path.slice(1);
  if(!files.has(name)){console.error('Missing synthetic fixture:',name);res.writeHead(404);res.end();return;}
  if(!(req.headers.cookie??'').includes('audio_session=ok')){res.writeHead(403);res.end();return;}
  requests.push({name,referer:req.headers.referer});const bytes=files.get(name),start=Number(/^bytes=(\d+)-/.exec(req.headers.range??'')?.[1]??0);
  res.writeHead(start?206:200,{'Content-Type':{'.mp4':'video/mp4','.m4a':'audio/mp4','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.mpd':'application/dash+xml','.m4s':'video/mp4'}[extname(name)]??'application/octet-stream',
    'Content-Length':bytes.length-start,'Accept-Ranges':'bytes','ETag':'"audio-fixture"',...(start?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});
  if(req.method==='HEAD'){res.end();return;}
  if(req.url.includes('slow')){let offset=start;const timer=setInterval(()=>{const end=Math.min(offset+1024,bytes.length);res.write(bytes.subarray(offset,end));offset=end;if(offset===bytes.length){clearInterval(timer);res.end();}},30);res.on('close',()=>clearInterval(timer));}
  else res.end(bytes.subarray(start));
}).listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`,summary=[];
async function download(mode,format,file='clip.mp4',extra=[]) {
  console.log(`Checking audio engine: ${mode} ${format} ${file} ${extra.join(' ')}`);
  const dir=resolve(root,`${mode}-${format}-${summary.length}`);await mkdir(dir,{recursive:true});
  let output;
  try {output=await run(dotnet,[runner,cache,`${origin}/${file}`,`${origin}/player`,dir,mode,format,...extra]);}
  catch(error) {
    if(file==='best.mpd') {
      const downloader=resolve(cache,'yt-dlp/yt-dlp.exe');
      try {console.log((await run(downloader,['--ignore-config','--no-plugin-dirs','--no-playlist','--format','ba/b','--match-filters','!is_live & !is_upcoming & !has_drm','--output',resolve(root,'diagnostic.%(ext)s'),'--ffmpeg-location',resolve(ffmpeg,'..'),'--add-header','Cookie:audio_session=ok','--referer',`${origin}/player`,`${origin}/${file}`])).slice(-5000));}
      catch(diagnostic){console.error(String(diagnostic));}
    }
    throw error;
  }
  const result=JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7));return {result,dir,log:output};
}
function probe(path) {
  const output=spawnSync(ffprobe,['-v','error','-show_streams','-of','json',path],{windowsHide:true,encoding:'utf8'});
  assert.equal(output.status,0,output.stderr);return JSON.parse(output.stdout).streams;
}
try {
  for(const mode of focused?[]:['direct','resolver'])for(const format of ['flac','wav','mp3']) {
    const {result,dir,log}=await download(mode,format);assert.equal(result.State,'Completed');assert.equal(result.Phase,'done');
    const streams=probe(result.ResultFilePath);assert.equal(streams.length,1);assert.equal(streams[0].codec_type,'audio');
    assert.equal(streams[0].codec_name,{flac:'flac',wav:'pcm_f32le',mp3:'mp3'}[format]);assert.equal(streams[0].sample_rate,'48000');
    if(format==='mp3')assert.equal(streams[0].bit_rate,'320000');
    else {
      const codec=format==='wav'?'pcm_f32le':'pcm_s24le';
      const decode=path=>ff(['-i',path,'-map','0:a:0','-c:a',codec,'-f',format==='wav'?'f32le':'s24le','pipe:1'],null);
      assert.deepEqual(decode(result.ResultFilePath),decode(resolve(root,'clip.mp4')),'Decoded samples preserved');
    }
    assert.match(log,/"Phase":"encode"/);assert.equal((await readdir(dir)).length,1,'No intermediate media');
    summary.push({mode,format,codec:streams[0].codec_name,sampleRate:streams[0].sample_rate,bitrate:streams[0].bit_rate,samplesPreserved:format!=='mp3'});
  }
  for(const mode of focused?[]:['direct','resolver']) {
    const video=await download(mode,'video');const streams=probe(video.result.ResultFilePath);
    assert(streams.some(stream=>stream.codec_type==='video'));assert(streams.some(stream=>stream.codec_type==='audio'));summary.push({check:mode+'-video-regression'});
  }
  if(!process.argv.includes('--dash-only')) {
  const missing=await download('direct','wav','silent.mp4',['-','--expect-no-audio']);
  assert.equal(missing.result.Phase,'audioMissing');assert.equal(missing.result.State,'Interrupted');summary.push({check:'missing-audio-explicit'});
  const before=requests.length;
  const split=await download('direct','flac','silent.mp4',[`${origin}/track.m4a`]);assert.equal(split.result.State,'Completed');
  assert.deepEqual(requests.slice(before).map(r=>r.name),['track.m4a'],'Separate audio never transfers video');summary.push({check:'separate-audio-only'});
  const hls=await download('resolver','wav','stream.m3u8');assert.equal(hls.result.State,'Completed');assert.equal(probe(hls.result.ResultFilePath).length,1);summary.push({check:'HLS-audio-only'});
  }
  const dashStart=requests.length;const dash=await download('resolver','wav','best.mpd');assert.equal(dash.result.State,'Completed');
  const dashRequests=requests.slice(dashStart).map(request=>request.name);
  assert(dashRequests.some(name=>name.startsWith('chunk-stream2-')),'Best audio rendition selected');
  assert(!dashRequests.some(name=>/^chunk-stream[01]-/.test(name)),'Lower audio and video streams not transferred');summary.push({check:'best-DASH-audio-192k'});
  const pauseStart=requests.length;const resumed=await download('direct','wav','clip.mp4',['-','--pause-encode']);
  assert.equal(resumed.result.State,'Completed');assert.equal(requests.length-pauseStart,1,'Paused encoding reuses downloaded source');
  assert.equal((await readdir(resumed.dir)).length,1,'Completed-source marker removed');summary.push({check:'pause-encoding-reuses-complete-source'});
  const encodeCancel=await download('direct','mp3','clip.mp4',['-','--cancel-encode']);
  assert.equal(encodeCancel.result.Canceled,true);assert.equal((await readdir(encodeCancel.dir)).length,0);summary.push({check:'cancel-encoding-removes-partials'});
  const cancellation=await download('direct','mp3','clip.mp4?slow',['-','--cancel']);assert.equal(cancellation.result.Canceled,true);assert.equal((await readdir(cancellation.dir)).length,0);summary.push({check:'cancel-removes-partials'});
  assert(requests.every(r=>r.referer===`${origin}/player`),'Scoped referer carried to HTTP requests');
  assert.equal((await readdir(cache)).filter(name=>name.startsWith('cookies-')).length,0,'Cookie jars removed');
  await writeFile(resolve(evidence,focused?'engine-focused-verification.json':'engine-verification.json'),JSON.stringify(summary,null,2));
  console.log(`Audio engine checks passed: ${summary.length}; ${resolve(evidence,focused?'engine-focused-verification.json':'engine-verification.json')}`);
} finally {
  server.closeAllConnections();await new Promise(done=>server.close(done));
  assert.match(relative(tmpdir(),root),/^sol-audio-engine-\d+$/);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
