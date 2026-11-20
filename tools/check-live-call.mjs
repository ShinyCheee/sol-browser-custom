import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { sidebarHost } from './sidebar-check-host.mjs';

const signals = [];
const track = new EventTarget();
track.readyState = 'live';
let poll, finishPicker;
const selection = new Promise(resolve => { finishPicker = resolve; });
const devices = { getDisplayMedia: () => selection };
runInNewContext(await readFile('src/Browser.App/inject/realtime-media.js', 'utf8'), {
  location: new URL('https://fixture.invalid/call'),
  window: { chrome: { webview: { postMessage: value => signals.push(value) } } },
  navigator: { mediaDevices: devices },
  addEventListener() {},
  setInterval: callback => { poll = callback; return 1; },
  clearInterval: () => { poll = undefined; },
});
const capture = devices.getDisplayMedia();
assert.deepEqual(signals, ['sol.media.active'], 'protect while the screen picker is open');
finishPicker({ getTracks: () => [track] });
await capture;
assert.deepEqual(signals, ['sol.media.active'], 'capture is still active after selecting a screen');
track.readyState = 'ended'; // stop() changes state without dispatching ended
poll();
assert.deepEqual(signals, ['sol.media.active', 'sol.media.idle'], 'release protection when the screen stops');
const host = await sidebarHost(process.argv[2], { saverTest: true, performance: true });
const log = () => readFile(resolve(host.profile, 'debug.log'), 'utf8');
let sidebar;
try {
  sidebar = await host.launch();
  const tab = (await sidebar.evaluate('window.__sidebarState')).tabs.find(t => t.url === host.origin + '/2');
  const page = await host.connect(tab.url);
  const send = command => sidebar.evaluate(`chrome.webview.postMessage(${JSON.stringify(JSON.stringify(command))})`);

  // A silent WebRTC peer sends packets in the background without any audible HTML media element.
  await page.evaluate(`(async () => {
    const caller = new RTCPeerConnection(), peer = new RTCPeerConnection();
    window.peers = [caller, peer];
    const audio = new AudioContext();
    window.testAudio = audio;
    await audio.resume();
    const tone = audio.createOscillator(), output = audio.createMediaStreamDestination();
    tone.connect(output); tone.start();
    caller.addTrack(output.stream.getAudioTracks()[0], output.stream);
    window.audioPackets = async () => [...(await peer.getStats()).values()]
      .filter(stat => stat.type === 'inbound-rtp' && stat.kind === 'audio')
      .reduce((total, stat) => total + stat.packetsReceived, 0);
    const channel = caller.createDataChannel('keepalive');
    caller.onicecandidate = e => { if (e.candidate) peer.addIceCandidate(e.candidate).catch(() => {}); };
    peer.onicecandidate = e => { if (e.candidate) caller.addIceCandidate(e.candidate).catch(() => {}); };
    peer.ondatachannel = e => { e.channel.onmessage = () => { window.received = (window.received ?? 0) + 1; }; };
    channel.onopen = () => setInterval(() => { if (channel.readyState === 'open') channel.send('ping'); }, 200);
    await caller.setLocalDescription(await caller.createOffer());
    await peer.setRemoteDescription(caller.localDescription);
    await peer.setLocalDescription(await peer.createAnswer());
    await caller.setRemoteDescription(peer.localDescription);
  })()`);
  await host.wait(() => page.evaluate('window.received > 1'), 'silent WebRTC connected');
  const firstAudio = await host.wait(() => page.evaluate('window.audioPackets()'), 'remote audio packets arrive without playing audio');
  await send({ type: 'tab.open', url: host.origin + '/background-check' });
  await host.connect(host.origin + '/background-check');
  await delay(22000); // Cross both accelerated thresholds, including the discard probe.
  const rest = new RegExp(`memory\\.(?:low|suspend|discard) ${tab.id}(?: |\\r?$)`, 'm');
  assert.doesNotMatch(await log(), rest, 'a silent connection must remain awake');
  const before = await page.evaluate('window.received');
  await host.wait(() => page.evaluate(`window.received > ${before}`), 'background WebRTC packets still arrive');
  assert.ok(await page.evaluate('window.audioPackets()') > firstAudio, 'remote audio also continues across the timeout');
  await page.evaluate('window.peers.forEach(peer => peer.close()); window.testAudio.close()');
  await host.wait(async () => rest.test(await log()), 'memory saver resumes after the call', 23000);
  console.log('PASS silent WebRTC survives the native memory saver and releases its protection on close');
} finally {
  if (sidebar) await host.close(sidebar).catch(() => {});
  await host.dispose();
}
