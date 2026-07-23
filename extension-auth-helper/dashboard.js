// Dashboard Script v3.0 — Media Upload Support

document.addEventListener('DOMContentLoaded', () => {
  initFormDefaultTime();
  loadScheduledPosts();
  setupEventListeners();
  startAutoRefresh();
});

let currentFilter = 'all';
let autoRefreshInterval = null;
let countdownInterval = null;
let countdownValue = 5;

function initFormDefaultTime() {
  const dateTimeInput = document.getElementById('scheduledDateTime');
  if (dateTimeInput) {
    const now = new Date();
    // Default to 5 minutes from now
    now.setMinutes(now.getMinutes() + 5);
    // Format to YYYY-MM-THH:mm for datetime-local input
    const localIso = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    dateTimeInput.value = localIso;
  }
}

// Auto-refresh every 5 seconds
function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  countdownValue = 5;
  const countdownEl = document.getElementById('refreshCountdown');

  countdownInterval = setInterval(() => {
    countdownValue--;
    if (countdownEl) countdownEl.textContent = `${countdownValue}s`;
    if (countdownValue <= 0) countdownValue = 5;
  }, 1000);

  autoRefreshInterval = setInterval(() => {
    loadScheduledPosts();
    countdownValue = 5;
  }, 5000);
}

function setupEventListeners() {
  const form = document.getElementById('scheduleForm');
  if (form) {
    form.addEventListener('submit', handleSaveSchedule);
  }

  const btnRefresh = document.getElementById('btnRefreshQueue');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadScheduledPosts();
      countdownValue = 5;
    });
  }

  const btnTrigger = document.getElementById('btnTriggerNow');
  if (btnTrigger) {
    btnTrigger.addEventListener('click', handleTriggerNow);
  }

  // Filter tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');
      loadScheduledPosts();
    });
  });

  // Target URL presets
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      const targetInput = document.getElementById('targetUrl');
      if (targetInput) targetInput.value = url;
    });
  });

  // ====== MEDIA FILE PICKER & DRAG-DROP ======
  setupMediaUpload();
}

function handleSaveSchedule(e) {
  e.preventDefault();
  const postType = document.getElementById('postType') ? document.getElementById('postType').value : 'post';
  const content = document.getElementById('postContent').value.trim();
  const mediaUrl = document.getElementById('mediaUrl') ? document.getElementById('mediaUrl').value.trim() : '';
  const targetUrl = document.getElementById('targetUrl').value.trim();
  const dateTimeVal = document.getElementById('scheduledDateTime').value;
  const repeatInterval = parseInt(document.getElementById('repeatInterval').value, 10) || 0;

  if (!content && !mediaUrl) {
    showToast('⚠️ Vui lòng nhập nội dung hoặc URL Media!');
    return;
  }

  if (!dateTimeVal) {
    showToast('⚠️ Vui lòng chọn thời gian đăng!');
    return;
  }

  const scheduledTime = new Date(dateTimeVal).getTime();
  if (isNaN(scheduledTime)) {
    showToast('⚠️ Thời gian không hợp lệ!');
    return;
  }

  const newPost = {
    id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    postType: postType,
    content: content,
    mediaUrl: mediaUrl,
    targetUrl: targetUrl || '',
    scheduledTime: scheduledTime,
    repeatIntervalMinutes: repeatInterval,
    status: 'pending',
    retryCount: 0,
    maxRetries: 3,
    lastError: null,
    createdTime: Date.now(),
    mediaData: _selectedMediaData || null
  };

  // Also sync to Python Backend
  fetch('http://127.0.0.1:18923/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newPost)
  }).catch(() => {});

  chrome.storage.local.get(['scheduled_posts'], (res) => {
    const posts = res.scheduled_posts || [];
    posts.push(newPost);

    chrome.storage.local.set({ scheduled_posts: posts }, () => {
      showToast('✅ Đã lưu lịch đăng thành công!');
      document.getElementById('postContent').value = '';
      if (document.getElementById('mediaUrl')) document.getElementById('mediaUrl').value = '';
      clearMediaSelection();
      initFormDefaultTime();
      loadScheduledPosts();

      // Notify background to recalculate alarm schedule
      chrome.runtime.sendMessage({ type: 'SCHEDULE_UPDATE' });
    });
  });
}

async function loadScheduledPosts() {
  let localPosts = [];
  try {
    const res = await new Promise(r => chrome.storage.local.get(['scheduled_posts'], r));
    localPosts = res.scheduled_posts || [];
  } catch (e) {}

  let backendPosts = [];
  try {
    const res = await fetch('http://127.0.0.1:18923/api/posts');
    if (res.ok) {
      const data = await res.json();
      backendPosts = data.posts || [];
    }
  } catch (e) {}

  // Get progress data
  let progressData = {};
  try {
    const pRes = await new Promise(r => chrome.storage.local.get(['post_progress'], r));
    progressData = pRes.post_progress || {};
  } catch (e) {}

  // Merge unique by ID
  const map = new Map();
  for (const p of [...localPosts, ...backendPosts]) {
    map.set(p.id, p);
  }

  renderPosts(Array.from(map.values()), progressData);
}

function renderPosts(posts, progressData) {
  const container = document.getElementById('postList');
  const countBadge = document.getElementById('totalCount');
  if (!container) return;

  // Filter posts
  let filtered = posts;
  if (currentFilter !== 'all') {
    filtered = posts.filter(p => p.status === currentFilter);
  }

  // Sort by scheduledTime ascending
  filtered.sort((a, b) => a.scheduledTime - b.scheduledTime);

  countBadge.textContent = `${filtered.length} / ${posts.length} bài`;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Không có bài đăng nào (${currentFilter}).</div>`;
    return;
  }

  const getTypeLabel = (type) => ({
    post: '📝 Bài viết',
    video: '🎥 Video',
    reel: '🎬 Thước phim',
    story: '📲 Bản tin'
  }[type] || '📝 Bài viết');

  container.innerHTML = filtered.map(post => {
    const dateStr = new Date(post.scheduledTime).toLocaleString('vi-VN');
    const statusClass = `status-${post.status}`;
    const statusLabel = {
      pending: 'Đang chờ',
      in_progress: 'Đang đăng',
      completed: 'Thành công',
      failed: 'Thất bại'
    }[post.status] || post.status;

    // Progress detail
    const progress = progressData[post.id];
    const progressHtml = progress ? `
      <div class="post-progress">
        <div class="progress-dot"></div>
        <span>${escapeHtml(progress.detail)}</span>
        <span style="color: var(--text-dim); margin-left: auto;">${_timeSince(progress.timestamp)}</span>
      </div>
    ` : '';

    return `
      <div class="post-item" data-id="${post.id}">
        <div class="post-header">
          <div class="post-time">
            <span style="background:rgba(59,130,246,0.2); color:#60a5fa; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:600;">${getTypeLabel(post.postType)}</span>
            <span>⏰ ${dateStr}</span>
            ${post.repeatIntervalMinutes > 0 ? `<span style="color:#60a5fa; font-size:11px;">🔄 Lặp mỗi ${post.repeatIntervalMinutes}p</span>` : ''}
          </div>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="post-content">${escapeHtml(post.content)}</div>
        ${post.mediaData ? `<div style="font-size:11px; color:#a78bfa; display:flex; align-items:center; gap:4px;">📎 File đính kèm: ${escapeHtml(post.mediaData.fileName)} (${(post.mediaData.size / (1024*1024)).toFixed(1)} MB)</div>` : ''}
        ${post.mediaUrl && !post.mediaData ? `<div style="font-size:11px; color:#60a5fa; word-break:break-all;">🖼️ Media: ${escapeHtml(post.mediaUrl)}</div>` : ''}
        ${post.targetUrl ? `<div class="post-target">🎯 ${escapeHtml(post.targetUrl)}</div>` : ''}
        ${progressHtml}
        ${post.lastError ? `<div style="font-size:11px; color:#f87171;">⚠️ Lỗi: ${escapeHtml(post.lastError)}</div>` : ''}
        <div class="post-footer">
          <span style="font-size:11px; color:var(--text-dim);">Thử lại: ${post.retryCount || 0}/${post.maxRetries || 3}</span>
          <div class="post-actions">
            <button class="btn btn-xs btn-purple btn-duplicate" data-id="${post.id}" title="Nhân bản bài đăng">📋 Nhân bản</button>
            ${post.status === 'pending' || post.status === 'failed' ? `<button class="btn btn-xs btn-primary btn-run-now" data-id="${post.id}">⚡ Đăng Ngay</button>` : ''}
            <button class="btn btn-xs btn-danger btn-delete" data-id="${post.id}">🗑️ Xóa</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add event handlers to dynamic buttons
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const postId = e.target.getAttribute('data-id');
      deletePost(postId);
    });
  });

  container.querySelectorAll('.btn-run-now').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const postId = e.target.getAttribute('data-id');
      runPostNow(postId);
    });
  });

  container.querySelectorAll('.btn-duplicate').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const postId = e.target.getAttribute('data-id');
      duplicatePost(postId, posts);
    });
  });
}

function deletePost(id) {
  chrome.storage.local.get(['scheduled_posts'], (res) => {
    let posts = res.scheduled_posts || [];
    posts = posts.filter(p => p.id !== id);
    chrome.storage.local.set({ scheduled_posts: posts }, () => {
      showToast('🗑️ Đã xóa bài đăng khỏi lịch!');
      loadScheduledPosts();
      chrome.runtime.sendMessage({ type: 'SCHEDULE_UPDATE' });
    });
  });

  // Also delete from backend
  fetch(`http://127.0.0.1:18923/api/posts/${id}`, { method: 'DELETE' }).catch(() => {});
}

function runPostNow(id) {
  fetch(`http://127.0.0.1:18923/api/posts/${id}/run-now`, { method: 'POST' }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'TRIGGER_POST_NOW', postId: id }, (response) => {
    showToast('⚡ Đã phát lệnh đăng ngay!');
    setTimeout(loadScheduledPosts, 1000);
  });
}

function duplicatePost(id, allPosts) {
  const original = allPosts.find(p => p.id === id);
  if (!original) {
    showToast('⚠️ Không tìm thấy bài đăng gốc!');
    return;
  }

  const newPost = {
    ...original,
    id: 'post_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    scheduledTime: Date.now() + 300000, // 5 minutes from now
    createdTime: Date.now()
  };

  // Save to local storage
  chrome.storage.local.get(['scheduled_posts'], (res) => {
    const posts = res.scheduled_posts || [];
    posts.push(newPost);
    chrome.storage.local.set({ scheduled_posts: posts }, () => {
      showToast('📋 Đã nhân bản bài đăng!');
      loadScheduledPosts();
      chrome.runtime.sendMessage({ type: 'SCHEDULE_UPDATE' });
    });
  });

  // Sync to backend
  fetch('http://127.0.0.1:18923/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newPost)
  }).catch(() => {});
}

function handleTriggerNow() {
  chrome.runtime.sendMessage({ type: 'CHECK_SCHEDULED_POSTS' }, (response) => {
    showToast('⚡ Đang kiểm tra và đăng các bài đăng tới hạn...');
    setTimeout(loadScheduledPosts, 1500);
  });
}

function _timeSince(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'vừa xong';
  if (seconds < 60) return `${seconds}s trước`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m trước`;
  return `${Math.floor(seconds / 3600)}h trước`;
}

function showToast(msg) {
  const toast = document.getElementById('toastMsg');
  if (toast) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}

// ====================================================================
// MEDIA UPLOAD: File picker, Drag & Drop, Preview, Base64 encoding
// ====================================================================

let _selectedMediaData = null; // { base64, fileName, mimeType, size }

function setupMediaUpload() {
  const dropZone = document.getElementById('mediaDropZone');
  const fileInput = document.getElementById('mediaFileInput');
  const removeBtn = document.getElementById('mediaRemoveBtn');

  if (!dropZone || !fileInput) return;

  // Click to open file picker
  dropZone.addEventListener('click', (e) => {
    if (e.target.id === 'mediaRemoveBtn') return;
    fileInput.click();
  });

  // File selected via input
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleMediaFile(file);
  });

  // Drag & Drop events
  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleMediaFile(file);
  });

  // Remove button
  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearMediaSelection();
    });
  }
}

function handleMediaFile(file) {
  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowedTypes.includes(file.type) && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    showToast('⚠️ Chỉ hỗ trợ file ảnh (JPG, PNG, GIF) hoặc video (MP4, MOV)!');
    return;
  }

  // Validate file size (25MB max)
  const maxSize = 25 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast('⚠️ File quá lớn! Tối đa 25MB.');
    return;
  }

  // Show preview
  renderMediaPreview(file);

  // Show file info
  const fileInfo = document.getElementById('mediaFileInfo');
  const fileName = document.getElementById('mediaFileName');
  if (fileInfo && fileName) {
    const sizeStr = file.size < 1024 * 1024
      ? (file.size / 1024).toFixed(1) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    fileName.textContent = `📎 ${file.name} (${sizeStr})`;
    fileInfo.style.display = 'flex';
  }

  // Read as base64
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64Full = e.target.result; // "data:image/jpeg;base64,xxxx..."
    const base64Data = base64Full.split(',')[1]; // just the base64 part

    _selectedMediaData = {
      base64: base64Data,
      fileName: file.name,
      mimeType: file.type,
      size: file.size
    };

    showToast(`✅ File "${file.name}" đã sẵn sàng!`);
  };
  reader.onerror = () => {
    showToast('⚠️ Lỗi đọc file!');
  };
  reader.readAsDataURL(file);
}

function renderMediaPreview(file) {
  const preview = document.getElementById('mediaPreview');
  const dropText = document.getElementById('mediaDropText');
  if (!preview) return;

  preview.innerHTML = '';

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.style.cssText = 'max-width:100%; max-height:180px; border-radius:8px; object-fit:cover;';
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    preview.appendChild(img);
  } else if (file.type.startsWith('video/')) {
    const video = document.createElement('video');
    video.style.cssText = 'max-width:100%; max-height:180px; border-radius:8px;';
    video.src = URL.createObjectURL(file);
    video.controls = true;
    video.muted = true;
    preview.appendChild(video);
  }

  preview.style.display = 'block';
  if (dropText) dropText.style.display = 'none';
}

function clearMediaSelection() {
  _selectedMediaData = null;

  const preview = document.getElementById('mediaPreview');
  const dropText = document.getElementById('mediaDropText');
  const fileInfo = document.getElementById('mediaFileInfo');
  const fileInput = document.getElementById('mediaFileInput');
  const uploadProgress = document.getElementById('uploadProgress');

  if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
  if (dropText) dropText.style.display = 'block';
  if (fileInfo) fileInfo.style.display = 'none';
  if (fileInput) fileInput.value = '';
  if (uploadProgress) uploadProgress.style.display = 'none';
}
