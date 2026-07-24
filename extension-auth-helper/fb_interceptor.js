// fb_interceptor.js — Runs in MAIN world (page context)
// Intercepts Facebook's own fetch() responses to capture likes, comments, shares
// Zero extra API calls — just captures what Facebook already loads

(function() {
  'use strict';
  
  const CHANNEL = '__FBAUTO_INTERCEPTED__';
  
  // Store original fetch
  const _originalFetch = window.fetch;
  
  // Override fetch
  window.fetch = function(...args) {
    const request = args[0];
    const url = typeof request === 'string' ? request : (request?.url || '');
    
    // Only intercept Facebook GraphQL API calls
    if (!url.includes('/api/graphql')) {
      return _originalFetch.apply(this, args);
    }
    
    return _originalFetch.apply(this, args).then(async response => {
      try {
        // Clone response so original consumer still works
        const cloned = response.clone();
        const text = await cloned.text();
        
        // Process in background to not block UI
        setTimeout(() => _processGraphQLResponse(text, url), 0);
      } catch(e) { /* ignore */ }
      
      return response;
    });
  };
  
  // Also intercept XMLHttpRequest for older Facebook code paths
  const _origXHROpen = XMLHttpRequest.prototype.open;
  const _origXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._fbAutoUrl = url;
    return _origXHROpen.call(this, method, url, ...rest);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._fbAutoUrl && this._fbAutoUrl.includes('/api/graphql')) {
      this.addEventListener('load', function() {
        try {
          setTimeout(() => _processGraphQLResponse(this.responseText, this._fbAutoUrl), 0);
        } catch(e) { /* ignore */ }
      });
    }
    return _origXHRSend.apply(this, args);
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
      const key = item.postId || item.feedbackId;
      if (key) {
        const existing = map.get(key);
        if (!existing || (item.metrics && (item.metrics.likes || 0) >= (existing.metrics?.likes || 0))) {
          map.set(key, item);
        }
      }
    }
    
    const deduped = Array.from(map.values());
    if (deduped.length > 0) {
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
  function _processGraphQLResponse(text, url) {
    if (!text || text.length < 50) return;
    
    // Facebook returns multi-line JSON (each line is a separate JSON object)
    const lines = text.replace(/^for \(;;\);/, '').split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        _extractFeedbackData(json);
      } catch(e) { /* not JSON, skip */ }
    }
  }
  
  // Recursively extract feedback/engagement data from any JSON structure
  function _extractFeedbackData(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 15) return;
    const d = (depth || 0) + 1;
    
    // Check if this object looks like a Feedback node
    if (_isFeedbackNode(obj)) {
      const data = _parseFeedbackNode(obj);
      if (data) _queueData(data);
    }
    
    // Check for comment nodes
    if (obj.__typename === 'Comment' && obj.body?.text) {
      // Individual comment — will be captured as part of feedback
    }
    
    // Recurse into arrays and objects
    if (Array.isArray(obj)) {
      for (const item of obj) _extractFeedbackData(item, d);
    } else {
      for (const key of Object.keys(obj)) {
        if (key.startsWith('__')) continue; // Skip meta keys
        const val = obj[key];
        if (val && typeof val === 'object') {
          _extractFeedbackData(val, d);
        }
      }
    }
  }
  
  // Check if an object is a Facebook Feedback node
  function _isFeedbackNode(obj) {
    // Feedback nodes typically have reaction_count or reactors, and an id
    return (
      obj.id && 
      (obj.reaction_count || obj.reactors || obj.comment_count || obj.i18n_reaction_count) &&
      typeof obj.id === 'string'
    );
  }
  
  // Parse a Feedback node into our format
  function _parseFeedbackNode(fb) {
    // Extract post ID from feedback ID (base64 encoded: "feedback:POST_ID")
    let postId = '';
    try {
      if (fb.id) {
        const decoded = atob(fb.id);
        const match = decoded.match(/feedback:(\d+)/);
        if (match) postId = match[1];
      }
    } catch(e) { /* not base64 */ }
    
    // If no post ID from feedback, try other fields
    if (!postId) {
      if (fb.associated_story?.id) {
        try {
          const decoded = atob(fb.associated_story.id);
          const m = decoded.match(/:(\d+)$/);
          if (m) postId = m[1];
        } catch(e) {}
      }
      if (!postId && fb.url) {
        const m = fb.url.match(/\/(\d{10,})/);
        if (m) postId = m[1];
      }
      if (!postId && fb.subscription_target_id) {
        postId = fb.subscription_target_id;
      }
    }
    
    if (!postId) return null;
    
    const likes = fb.reaction_count?.count ?? fb.reactors?.count ?? fb.i18n_reaction_count ?? 0;
    const comments = fb.comment_count?.total_count ?? fb.total_comment_count ?? 0;
    const shares = fb.share_count?.count ?? fb.reshare_count?.count ?? 0;
    
    // Extract top comments if available
    const topComments = [];
    const commentEdges = fb.display_comments?.edges || [];
    for (const edge of commentEdges) {
      const node = edge?.node;
      if (node) {
        topComments.push({
          id: node.legacy_fbid || node.id || '',
          author: node.author?.name || node.author?.short_name || '',
          text: node.body?.text || '',
          timestamp: node.created_time ? node.created_time * 1000 : 0,
          likes: node.feedback?.reaction_count?.count || 0,
          authorId: node.author?.id || ''
        });
      }
    }
    
    // Extract reaction breakdown if available
    const reactionTypes = {};
    const rEdges = fb.top_reactions?.edges || [];
    for (const re of rEdges) {
      if (re.node?.reaction_type) {
        reactionTypes[re.node.reaction_type] = re.reaction_count || 0;
      }
    }
    
    return {
      postId,
      feedbackId: fb.id,
      metrics: { likes, comments, shares },
      topComments: topComments.slice(0, 15),
      reactionTypes: Object.keys(reactionTypes).length > 0 ? reactionTypes : undefined,
      viewerReaction: fb.viewer_current_reaction_key || null,
      capturedAt: Date.now()
    };
  }
  
})();
