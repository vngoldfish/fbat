

(() => {
    
    if (document.getElementById("glabs-fab")) return;

    let iconUrl, popupUrl;
    try {
        iconUrl = chrome.runtime.getURL("icon48.png");
        popupUrl = chrome.runtime.getURL("popup.html");
    } catch (e) {
        return; 
    }

    // --- Helpers ---
    function isAlive() {
        try { return !!chrome.runtime?.id; } catch (e) { return false; }
    }

    const isFacebookPage = /^https?:\/\/(www\.)?(facebook|fb)\.com/i.test(window.location.href);

    // --- Styles ---
    const styles = document.createElement("style");
    styles.textContent = `
        /* Floating Action Button */
        #glabs-fab {
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
            width: 48px; height: 48px; border-radius: 14px;
            background: rgba(15,17,24,0.85);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.03) inset;
            display: flex; align-items: center; justify-content: center;
            cursor: grab; user-select: none;
            transition: box-shadow 0.3s ease, transform 0.2s ease, opacity 0.3s ease;
        }
        #glabs-fab:hover {
            box-shadow: 0 8px 32px rgba(59,130,246,0.25), 0 0 0 1px rgba(59,130,246,0.15) inset;
            transform: scale(1.08);
        }
        #glabs-fab.glabs-hidden {
            opacity: 0; pointer-events: none;
        }

        /* Badge */
        #glabs-fab-badge {
            position: absolute; top: -5px; right: -5px;
            min-width: 18px; height: 18px; line-height: 18px; text-align: center;
            font-size: 10px; font-weight: 800; font-family: 'Inter', system-ui, sans-serif;
            color: #fff; background: linear-gradient(135deg, #3b82f6, #6366f1);
            border-radius: 9px; padding: 0 5px;
            box-shadow: 0 2px 8px rgba(59,130,246,0.5);
            transition: background 0.3s, box-shadow 0.3s;
        }
        
        #glabs-fab.connected #glabs-fab-badge {
            background: linear-gradient(135deg, #22c55e, #10b981);
            box-shadow: 0 2px 8px rgba(34,197,94,0.5);
        }
        
        #glabs-fab.disconnected #glabs-fab-badge {
            background: linear-gradient(135deg, #ef4444, #f43f5e);
            box-shadow: 0 2px 8px rgba(239,68,68,0.5);
        }

        /* Popup Wrapper — max z-index */
        #glabs-iframe-wrap {
            position: fixed; z-index: 2147483647;
            border-radius: 16px; overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset;
            border: 1px solid rgba(255,255,255,0.08);
            animation: glabsSlideIn 0.2s ease-out;
        }
        #glabs-iframe-wrap iframe {
            width: 360px; height: 384px; border: none;
            border-radius: 16px; display: block;
        }
        @keyframes glabsSlideIn {
            from { opacity: 0; transform: translateY(8px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* Overlay — mini notification bar at bottom-left (NOT fullscreen) */
        #glabs-overlay {
            position: fixed; bottom: 80px; left: 20px; z-index: 2147483640;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.5s ease;
            font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        }
        #glabs-overlay.visible { opacity: 1; }

        #glabs-overlay-card {
            width: 260px; padding: 14px 16px;
            background: rgba(15, 17, 28, 0.85);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border-radius: 14px;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset;
            color: #e2e8f0;
            display: flex; align-items: center; gap: 12px;
        }

        #glabs-overlay-icon {
            width: 32px; height: 32px; border-radius: 8px;
            box-shadow: 0 2px 10px rgba(59,130,246,0.3);
            flex-shrink: 0;
        }
        #glabs-overlay-info {
            flex: 1; min-width: 0;
        }
        #glabs-overlay-title {
            font-size: 12px; font-weight: 700; color: #f1f5f9;
            letter-spacing: -0.2px; margin: 0 0 2px;
        }
        #glabs-overlay-status {
            display: flex; align-items: center; gap: 6px;
        }
        #glabs-overlay-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: #22c55e;
            box-shadow: 0 0 6px rgba(34,197,94,0.6);
            animation: glabsPulse 1.5s ease-in-out infinite;
        }
        @keyframes glabsPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.85); }
        }
        #glabs-overlay-status-text {
            font-size: 11px; font-weight: 600; color: #4ade80;
        }
        #glabs-overlay-counter {
            font-size: 11px; font-weight: 500; color: #94a3b8; margin-top: 2px;
        }
    `;
    document.head.appendChild(styles);

    // --- Popup Height Sync ---
    window.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d.__glabsPopupHeight !== "number") return;
        const ifr = document.querySelector("#glabs-iframe-wrap iframe");
        if (ifr) ifr.style.height = Math.max(120, Math.min(560, Math.ceil(d.__glabsPopupHeight))) + "px";
    });

    // --- FAB (Floating Action Button) ---
    const fab = document.createElement("div");
    fab.id = "glabs-fab";
    fab.title = "FB Auto Post & Schedule";
    fab.innerHTML = `<img src="${iconUrl}" width="26" height="26" style="border-radius:7px;opacity:0.9;" /><span id="glabs-fab-badge">—</span>`;
    document.body.appendChild(fab);

    // Drag logic
    let isDragging = false, startX, startY, fabX, fabY, rafId = null;
    const _FAB_BOX = 48;

    fab.addEventListener("mousedown", (e) => {
        isDragging = false;
        startX = e.clientX; startY = e.clientY;
        const rect = fab.getBoundingClientRect();
        fabX = rect.left; fabY = rect.top;
        fab.style.cursor = "grabbing";
        fab.style.transition = "none";
        e.preventDefault();

        const onMouseMove = (e) => {
            const dx = e.clientX - startX, dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
            if (isDragging) {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    const x = Math.max(0, Math.min(window.innerWidth - _FAB_BOX, fabX + dx));
                    const y = Math.max(0, Math.min(window.innerHeight - _FAB_BOX, fabY + dy));
                    fab.style.left = `${x}px`;
                    fab.style.top = `${y}px`;
                    fab.style.right = "auto";
                    fab.style.bottom = "auto";
                });
            }
        };
        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            fab.style.cursor = "grab";
            fab.style.transition = "box-shadow 0.3s ease, transform 0.2s ease, opacity 0.3s ease";
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    fab.addEventListener("click", () => {
        if (!isDragging && isAlive()) togglePanel();
    });

    // --- Popup Panel ---
    let panel = null;

    function togglePanel() {
        if (!isAlive()) return;
        if (panel) { panel.remove(); panel = null; return; }

        panel = document.createElement("div");
        panel.id = "glabs-iframe-wrap";

        const iframe = document.createElement("iframe");
        iframe.src = popupUrl;
        panel.appendChild(iframe);

        // Position relative to FAB
        const fabRect = fab.getBoundingClientRect();
        if (fabRect.top > 480) {
            panel.style.bottom = `${window.innerHeight - fabRect.top + 10}px`;
        } else {
            panel.style.top = `${fabRect.bottom + 10}px`;
        }
        const rightPos = window.innerWidth - fabRect.right;
        panel.style.right = `${Math.max(8, rightPos)}px`;

        document.body.appendChild(panel);
        setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 100);
    }

    function closeOnOutsideClick(e) {
        if (panel && !panel.contains(e.target) && !fab.contains(e.target)) {
            panel.remove(); panel = null;
            document.removeEventListener("click", closeOnOutsideClick);
        }
    }

    // --- Overlay (mini bar at bottom-left, only on NON-Facebook pages) ---
    const overlay = document.createElement("div");
    overlay.id = "glabs-overlay";
    overlay.innerHTML = `
        <div id="glabs-overlay-card">
            <img id="glabs-overlay-icon" src="${iconUrl}" alt="Bawui" />
            <div id="glabs-overlay-info">
                <div id="glabs-overlay-title">Bawui Automation</div>
                <div id="glabs-overlay-status">
                    <div id="glabs-overlay-dot"></div>
                    <span id="glabs-overlay-status-text">Processing...</span>
                </div>
                <div id="glabs-overlay-counter">Session #0</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    let overlayVisible = false;

    function showOverlay(data) {
        // BUG 3 FIX: Never show auth overlay on Facebook pages
        if (isFacebookPage) return;

        if (!overlayVisible) {
            overlay.classList.add("visible");
            overlayVisible = true;
        }
        updateOverlayData(data);
    }

    function hideOverlay() {
        if (overlayVisible) {
            overlay.classList.remove("visible");
            overlayVisible = false;
        }
    }

    function updateOverlayData(data) {
        if (!data) return;
        const counter = document.getElementById("glabs-overlay-counter");
        if (counter) {
            counter.textContent = `Session #${data.sessionCount || data.tokenCount || 0}`;
        }
    }

    // --- Layout Changed Message Handler ---
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "LAYOUT_CHANGED") {
            if (message.active) showOverlay(message);
            else hideOverlay();
        }
    });

    // --- Badge Update (BUG 2 FIX: No permanent removal) ---
    let badgeTimer = null;

    function updateBadge() {
        if (!isAlive()) {
            // BUG 2 FIX: Instead of removing the FAB permanently,
            // just hide it temporarily. It will be shown again when SW wakes up.
            fab.classList.add("glabs-hidden");
            // DO NOT clear interval — keep checking so we can recover
            return;
        }

        // Recovery: if FAB was hidden, show it again
        if (fab.classList.contains("glabs-hidden")) {
            fab.classList.remove("glabs-hidden");
        }

        try {
            chrome.runtime.sendMessage({ type: "GET_METRICS" }, (response) => {
                if (chrome.runtime.lastError) return;
                const badge = document.getElementById("glabs-fab-badge");
                if (!badge) return;
                if (response) {
                    badge.textContent = response.tokenCount || "0";
                    fab.className = response.connected ? "connected" : "disconnected";
                    // Restore FAB ID after className override
                    fab.id = "glabs-fab";
                    if (response.active && !overlayVisible) showOverlay(response);
                    else if (!response.active && overlayVisible) hideOverlay();
                    else if (response.active && overlayVisible) updateOverlayData(response);
                } else {
                    badge.textContent = "!";
                    fab.className = "disconnected";
                    fab.id = "glabs-fab";
                    if (overlayVisible) hideOverlay();
                }
            });
        } catch (e) { /* Service worker temporarily unavailable */ }
    }

    updateBadge();
    badgeTimer = setInterval(updateBadge, 3000);

    // --- Media Throttling (existing feature, preserved) ---
    function* _scanNodes(root) {
        let els;
        try { els = root.querySelectorAll("*"); } catch (e) { return; }
        for (const el of els) {
            yield el;
            if (el.shadowRoot) yield* _scanNodes(el.shadowRoot);   
        }
    }
    function _throttleMedia() {
        let paused = 0;
        for (const el of _scanNodes(document)) {
            if (el.tagName === "VIDEO" && !el.paused && !el.ended) {
                try { el.pause(); paused++; } catch (e) { /* skip */ }
            }
        }
        if (paused) void 0;
    }
    
    document.addEventListener("play", (e) => {
        const t = e.target;
        if (t && t.tagName === "VIDEO") {
            try { t.pause(); } catch (err) { /* skip */ }
        }
    }, true);
    _throttleMedia();   
    setInterval(() => { try { _throttleMedia(); } catch (e) { /* skip */ } }, 2000);

    // -----------------------------------------------------------------
    // Facebook Auto Posting Engine v5.0 (Simplified)
    // All posting logic runs from background.js via chrome.scripting.executeScript
    // Content script only handles visual feedback (banners + progress)
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    // Live Execution HUD Banner for Facebook Web Page
    // Renders high-visibility floating status banner during automation
    // -----------------------------------------------------------------

    function showOnScreenBanner(msg, isError = false, isSuccess = false) {
        try {
            let banner = document.getElementById("fb-auto-post-banner");
            if (!banner) {
                banner = document.createElement("div");
                banner.id = "fb-auto-post-banner";
                banner.style.cssText = `
                    position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
                    padding: 12px 22px; border-radius: 14px; font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    font-size: 13px; font-weight: 700; color: #ffffff;
                    background: rgba(15, 23, 42, 0.95);
                    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(59, 130, 246, 0.3);
                    display: flex; align-items: center; gap: 12px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    text-align: left; max-width: 90vw; pointer-events: auto;
                `;
                (document.body || document.documentElement).appendChild(banner);
            }

            let bgGradient = "linear-gradient(135deg, rgba(37, 99, 235, 0.95), rgba(124, 58, 237, 0.95))";
            let borderColor = "rgba(59, 130, 246, 0.5)";
            let dotColor = "#60a5fa";

            if (isError || msg.includes("⚠️") || msg.includes("❌") || msg.includes("thất bại") || msg.includes("Lỗi")) {
                bgGradient = "linear-gradient(135deg, rgba(220, 38, 38, 0.95), rgba(153, 27, 27, 0.95))";
                borderColor = "rgba(239, 68, 68, 0.6)";
                dotColor = "#f87171";
            } else if (isSuccess || msg.includes("🎉") || msg.includes("✅") || msg.includes("thành công")) {
                bgGradient = "linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))";
                borderColor = "rgba(34, 197, 94, 0.6)";
                dotColor = "#4ade80";
            }

            banner.style.background = bgGradient;
            banner.style.borderColor = borderColor;

            banner.innerHTML = `
                <div style="width:10px; height:10px; border-radius:50%; background:${dotColor}; box-shadow:0 0 10px ${dotColor}; animation: fbPulse 1.2s infinite; flex-shrink:0;"></div>
                <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;">
                    <div style="font-size:10px; letter-spacing:1px; text-transform:uppercase; opacity:0.8; font-weight:800;">🤖 FB AUTO BOT ENGINE</div>
                    <div style="font-size:13px; font-weight:700;">${msg}</div>
                </div>
                <div id="fb-banner-close" style="cursor:pointer; opacity:0.7; font-size:16px; font-weight:700; padding:2px 6px; border-radius:6px; background:rgba(255,255,255,0.15);" title="Đóng">✕</div>
            `;

            const closeBtn = banner.querySelector("#fb-banner-close");
            if (closeBtn) {
                closeBtn.onclick = () => {
                    banner.style.opacity = "0";
                    banner.style.transform = "translateX(-50%) translateY(-20px)";
                };
            }

            banner.style.display = "flex";
            banner.style.opacity = "1";
            banner.style.transform = "translateX(-50%) translateY(0)";

            if (window._fbBannerTimer) clearTimeout(window._fbBannerTimer);

            // Auto dismiss progress steps after 5s, success/error after 7s
            const dismissMs = (isSuccess || isError) ? 7000 : 5000;
            window._fbBannerTimer = setTimeout(() => {
                if (banner) {
                    banner.style.opacity = "0";
                    banner.style.transform = "translateX(-50%) translateY(-20px)";
                }
            }, dismissMs);
        } catch (e) {}
    }

    // Add CSS pulse animation
    const bannerStyle = document.createElement("style");
    bannerStyle.textContent = `
        @keyframes fbPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.8); }
        }
    `;
    document.head.appendChild(bannerStyle);

    // Listen for progress/result messages from background to show visual feedback
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && (msg.type === "POST_STATUS_UPDATE" || msg.action === "SHOW_HUD")) {
            showOnScreenBanner(msg.message || msg.step || "FB AUTO: Processing...");
            sendResponse({ ok: true });
            return true;
        }
    });
})();
