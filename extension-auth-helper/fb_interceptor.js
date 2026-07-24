// fb_interceptor.js — Runs in MAIN world (page context)
// Intercepts Facebook's own fetch() responses to capture likes, comments, shares
// Zero extra API calls — just captures what Facebook already loads

(function() {
  'use strict';
  
  const CHANNEL = '__FBAUTO_INTERCEPTED__';
  const DEBUG = true; // Enable console logging for debugging
  
  function log(...args) {
    if (DEBUG) console.log('[fbAUTO Interceptor]', ...args);
  }
  
  log('🚀 Interceptor loaded on', window.location.href);
  
  // Store original fetch
  const _originalFetch = window.fetch;
  let _requestCount = 0;
  let _matchCount = 0;
  
  // Override fetch
  window.fetch = function(...args) {
    const request = args[0];
    const url = typeof request === 'string' ? request : (request?.url || '');
    
    // Only intercept Facebook GraphQL API calls
    if (!url.includes('/api/graphql')) {
      return _originalFetch.apply(this, args);
    }
    
    _requestCount++;
    
    return _originalFetch.apply(this, args).then(async response => {
      try {
        // Clone response so original consumer still works
        const cloned = response.clone();
        const text = await cloned.text();
        
        if (text && text.length > 100) {
          // Process in microtask to not block UI
          queueMicrotask(() => _processGraphQLResponse(text));
        }
      } catch(e) {
        log('⚠️ Clone error:', e.message);
      }
      
      return response;
    });
  };
  
  // Debounce: batch data before sending
  let _pendingData = [];
  let _flushTimer = null;
  const FLUSH_INTERVAL = 3000; // Send every 3s
  
  function _flushData() {
    if (_pendingData.length === 0) return;
    const batch = _pendingData.splice(0);
    
    // Deduplicate by postId — keep latest
    const map = new Map();
    for (const item of batch) {
      const key = item.postId;
      if (key) {
        const existing = map.get(key);
        if (!existing || (item.metrics.likes || 0) >= (existing.metrics?.likes || 0)) {
          map.set(key, item);
        }
      }
    }
    
    const deduped = Array.from(map.values());
    if (deduped.length > 0) {
      log(`📤 Sending ${deduped.length} posts to bridge`);
      window.postMessage({ type: CHANNEL, payload: deduped }, '*');
    }
  }
  
  function _queueData(item) {
    _pendingData.push(item);
    if (!_flushTimer) {
      _flushTimer = setTimeout(() => {
        _flushTimer = null;
        _flushData();
      }, FLUSH_INTERVAL);
    }
  }
  
  // Process GraphQL response text
  function _processGraphQLResponse(text) {
    if (!text || text.length < 50) return;
    
    // Remove Facebook's security prefix (multiple formats)
    let cleaned = text;
    if (cleaned.startsWith('for (;;);')) cleaned = cleaned.substring(9);
    if (cleaned.startsWith('/**/ ')) cleaned = cleaned.substring(5);
    
    // Try parsing as single JSON first
    try {
      const json = JSON.parse(cleaned);
      _searchForFeedback(json, 0);
      return;
    } catch(e) { /* not single JSON, try multi-line */ }
    
    // Facebook often returns multiple JSON objects, one per line
    const lines = cleaned.split('\n').filter(l => l.trim().startsWith('{'));
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        _searchForFeedback(json, 0);
      } catch(e) { /* skip */ }
    }
  }
  
  // Deep search for any feedback/engagement data in a JSON tree
  function _searchForFeedback(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 20) return;
    
    // Pattern 1: Object has reaction_count (most common)
    if (obj.reaction_count && typeof obj.reaction_count === 'object') {
      const data = _tryExtractFeedback(obj);
      if (data) {
        _matchCount++;
        log(`✅ Found feedback #${_matchCount}: postId=${data.postId}, 👍${data.metrics.likes} 💬${data.metrics.comments} 🔁${data.metrics.shares}`);
        _queueData(data);
        return; // Don't recurse deeper from this node
      }
    }
    
    // Pattern 2: Object has reactors.count
    if (obj.reactors && typeof obj.reactors === 'object' && obj.reactors.count !== undefined) {
      const data = _tryExtractFeedback(obj);
      if (data) {
        _matchCount++;
        log(`✅ Found feedback #${_matchCount}: postId=${data.postId}, 👍${data.metrics.likes}`);
        _queueData(data);
        return;
      }
    }
    
    // Pattern 3: Object has i18n_reaction_count (string like "5")
    if (obj.i18n_reaction_count && obj.comment_count) {
      const data = _tryExtractFeedback(obj);
      if (data) {
        _matchCount++;
        _queueData(data);
        return;
      }
    }
    
    // Recurse
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length && i < 200; i++) {
        if (obj[i] && typeof obj[i] === 'object') _searchForFeedback(obj[i], depth + 1);
      }
    } else {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length && i < 100; i++) {
        const val = obj[keys[i]];
        if (val && typeof val === 'object') _searchForFeedback(val, depth + 1);
      }
    }
  }
  
  // Try to extract feedback data from a node
  function _tryExtractFeedback(fb) {
    // Get post ID — try multiple approaches
    let postId = _extractPostId(fb);
    if (!postId) return null;
    
    // Extract metrics
    const likes = _getCount(fb.reaction_count) || _getCount(fb.reactors) || parseInt(fb.i18n_reaction_count) || 0;
    const comments = _getCount(fb.comment_count) || fb.total_comment_count || 0;
    const shares = _getCount(fb.share_count) || _getCount(fb.reshare_count) || 0;
    
    // At least one metric should be > 0 or it's not useful
    // Actually, 0 is valid too — maybe a new post
    
    // Extract top comments
    const topComments = [];
    const edges = fb.display_comments?.edges || fb.comments?.edges || [];
    for (const edge of edges.slice(0, 15)) {
      const n = edge?.node;
      if (n && (n.body?.text || n.text?.text)) {
        topComments.push({
          id: n.legacy_fbid || n.id || '',
          author: n.author?.name || n.author?.short_name || '',
          text: n.body?.text || n.text?.text || '',
          timestamp: n.created_time ? n.created_time * 1000 : 0,
          likes: _getCount(n.feedback?.reaction_count) || _getCount(n.comment_reaction_count) || 0
        });
      }
    }
    
    return {
      postId,
      feedbackId: fb.id || '',
      metrics: { likes, comments, shares },
      topComments,
      capturedAt: Date.now()
    };
  }
  
  // Extract post ID from various sources
  function _extractPostId(fb) {
    // Method 1: Decode feedback ID (base64: "feedback:POST_ID")
    if (fb.id && typeof fb.id === 'string') {
      try {
        const decoded = atob(fb.id);
        const m = decoded.match(/feedback:(\d+)/);
        if (m) return m[1];
        // Also try other patterns like "story:POST_ID"
        const m2 = decoded.match(/:(\d{10,})/);
        if (m2) return m2[1];
      } catch(e) { /* not base64 */ }
      // If id is numeric directly
      if (/^\d{10,}$/.test(fb.id)) return fb.id;
    }
    
    // Method 2: From subscription_target_id
    if (fb.subscription_target_id && /^\d{10,}$/.test(fb.subscription_target_id)) {
      return fb.subscription_target_id;
    }
    
    // Method 3: From URL
    if (fb.url && typeof fb.url === 'string') {
      const m = fb.url.match(/\/(\d{10,})/);
      if (m) return m[1];
    }
    
    // Method 4: From associated objects
    if (fb.owning_profile?.id) {
      // This is the profile, not the post — skip
    }
    
    // Method 5: From legacy_token
    if (fb.legacy_token && typeof fb.legacy_token === 'string') {
      const m = fb.legacy_token.match(/(\d{10,})/);
      if (m) return m[1];
    }

    return null;
  }
  
  // Safely get count from various formats
  function _getCount(obj) {
    if (!obj) return 0;
    if (typeof obj === 'number') return obj;
    if (typeof obj === 'object' && obj.count !== undefined) return obj.count;
    if (typeof obj === 'object' && obj.total_count !== undefined) return obj.total_count;
    return 0;
  }
  
  // Status log every 30s
  setInterval(() => {
    if (_requestCount > 0) {
      log(`📊 Status: ${_requestCount} GraphQL requests intercepted, ${_matchCount} feedback nodes found, ${_pendingData.length} pending`);
    }
  }, 30000);
  
})();
