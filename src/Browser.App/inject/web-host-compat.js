(() => {
  // Mode fenêtre unique : empêcher les applications de visioconférence (ex. Google Meet) d'ouvrir
  // automatiquement une seconde fenêtre HTML Document Picture-in-Picture au changement d'onglet,
  // tout en conservant le lecteur vidéo flottant standard (<video>.requestPictureInPicture).
  try {
    if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
      Object.defineProperty(window.documentPictureInPicture, 'requestWindow', {
        value: () => Promise.reject(new DOMException('Document Picture-in-Picture is disabled in single-window mode.', 'NotAllowedError')),
        configurable: true,
      });
    }
    const mediaSessionProto = window.MediaSession?.prototype;
    if (mediaSessionProto && typeof mediaSessionProto.setActionHandler === 'function') {
      const originalSetActionHandler = mediaSessionProto.setActionHandler;
      Object.defineProperty(mediaSessionProto, 'setActionHandler', {
        value(action, handler) {
          if (action === 'enterpictureinpicture') return;
          return Reflect.apply(originalSetActionHandler, this, [action, handler]);
        },
        configurable: true,
        writable: true,
      });
    }
  } catch {}

  // Amazon's shared web/app bundle probes hostObjects.sync.PrimeVideoWinRTComponent
  // without a try/catch. WebView2 exposes a proxy even with AreHostObjectsAllowed=false;
  // reading that missing component then throws 0x80070005 and aborts the whole web app.
  // Sol has no Prime Video WinRT host. Advertise absence, without granting native access.
  if (!/(^|\.)primevideo\.com$|(^|\.)amazon\.[a-z.]+$/i.test(location.hostname)) return;
  const bridge = window.chrome?.webview;
  if (!bridge) return;
  const absent = Object.freeze(Object.create(null));
  Object.defineProperty(bridge, 'hostObjects', {
    value: Object.freeze({ sync: absent, async: absent }),
    writable: false,
    configurable: false,
    enumerable: true,
  });
  // postMessage and message listeners stay intact for Sol's own filtered commands.
})();
