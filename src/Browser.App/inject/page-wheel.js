(() => {
  const post = chrome.webview.postMessage.bind(chrome.webview);
  if ('__SOL_WHEEL_DEBUG__' === '1') {
    let last = 0;
    addEventListener('wheel', event => {
      const now = performance.now();
      if (now - last < 150) return;
      last = now;
      post('sol.wheeldbg:__SOL_WHEEL_KEY__:' + (event.isTrusted ? 't' : 'u') + ':' + location.host);
    }, { capture: true, passive: true });
  }
  addEventListener('wheel', event => {
    if (!event.isTrusted || !event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    // Wait for canvas/editor handlers, including handlers registered on window, to cancel the gesture.
    setTimeout(() => {
      if (!event.defaultPrevented) post('sol.wheel:__SOL_WHEEL_KEY__:' + (event.deltaY < 0 ? 'in' : 'out'));
    }, 0);
  }, { capture: true, passive: true });
})();
