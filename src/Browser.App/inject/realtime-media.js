(() => {
  if (!/^https?:$/.test(location.protocol) || ['start.sol', 'ui.navigateur'].includes(location.hostname)) return;
  const bridge = window.chrome?.webview;
  if (!bridge) return;

  const post = bridge.postMessage.bind(bridge);
  const tracks = new Set();
  const peers = new Set();
  let pending = 0, reported = false, timer = 0;

  function anyLive(references, live) {
    let active = false;
    for (const ref of references) {
      const value = ref.deref();
      if (!value || !live(value)) references.delete(ref);
      else active = true;
    }
    return active;
  }

  function report(active) {
    if (active === reported) return;
    reported = active;
    try { post(active ? 'sol.media.active' : 'sol.media.idle'); } catch {}
  }

  function refresh() {
    const captured = anyLive(tracks, track => track.readyState === 'live');
    const connected = anyLive(peers, peer => !['closed', 'failed'].includes(peer.connectionState));
    report(pending > 0 || captured || connected);
    // Calling MediaStreamTrack.stop() does not fire the ended event.
    if (captured && !timer) timer = setInterval(refresh, 2000);
    if (!captured && timer) { clearInterval(timer); timer = 0; }
  }

  const devices = navigator.mediaDevices;
  for (const name of ['getDisplayMedia', 'getUserMedia']) {
    if (typeof devices?.[name] !== 'function') continue;
    const original = devices[name];
    devices[name] = new Proxy(original, {
      async apply(method, receiver, args) {
        pending++;
        refresh();
        try {
          const stream = await Reflect.apply(method, receiver, args);
          for (const track of stream.getTracks()) {
            tracks.add(new WeakRef(track));
            track.addEventListener('ended', refresh, { once: true });
          }
          return stream;
        } finally {
          pending--;
          refresh();
        }
      }
    });
  }

  const NativePeer = window.RTCPeerConnection;
  if (typeof NativePeer === 'function') {
    const wrapped = new Proxy(NativePeer, {
      construct(constructor, args, newTarget) {
        const peer = Reflect.construct(constructor, args, newTarget);
        const ref = new WeakRef(peer);
        peer.addEventListener('connectionstatechange', () => {
          if (['connecting', 'connected', 'disconnected'].includes(peer.connectionState)) peers.add(ref);
          else peers.delete(ref);
          refresh();
        });
        return peer;
      }
    });
    window.RTCPeerConnection = wrapped;
    if (window.webkitRTCPeerConnection === NativePeer) window.webkitRTCPeerConnection = wrapped;
    // RTCPeerConnection.close() may change the state without dispatching connectionstatechange.
    const close = NativePeer.prototype.close;
    NativePeer.prototype.close = new Proxy(close, {
      apply(method, receiver, args) {
        const result = Reflect.apply(method, receiver, args);
        refresh();
        return result;
      }
    });
  }

  addEventListener('pagehide', () => report(false));
  addEventListener('pageshow', refresh);
})();
