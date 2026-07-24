// fb_bridge.js — Runs in ISOLATED world (has access to chrome.runtime)
// Receives intercepted data from fb_interceptor.js via window.postMessage
// Forwards to background.js via chrome.runtime.sendMessage

(function() {
  'use strict';
  
  const CHANNEL = '__FBAUTO_INTERCEPTED__';
  
  window.addEventListener('message', (event) => {
    // Only accept messages from the same page
    if (event.source !== window) return;
    if (!event.data || event.data.type !== CHANNEL) return;
    
    const payload = event.data.payload;
    if (!Array.isArray(payload) || payload.length === 0) return;
    
    // Forward to background.js
    try {
      chrome.runtime.sendMessage({
        action: 'FB_DATA_CAPTURED',
        data: payload,
        url: window.location.href,
        timestamp: Date.now()
      }).catch(() => {});
    } catch(e) {
      // Extension context invalidated, ignore
    }
  });
  
  // Also detect page URL to know which profile/page we're on
  let _lastUrl = '';
  function _checkUrlChange() {
    if (window.location.href !== _lastUrl) {
      _lastUrl = window.location.href;
      try {
        chrome.runtime.sendMessage({
          action: 'FB_PAGE_CHANGED',
          url: _lastUrl,
          timestamp: Date.now()
        }).catch(() => {});
      } catch(e) {}
    }
  }
  
  // Check URL changes (Facebook is SPA)
  setInterval(_checkUrlChange, 2000);
  _checkUrlChange();
  
})();
