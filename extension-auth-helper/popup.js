

let _syncPort = 18923;
let _syncUrl = `http://127.0.0.1:${_syncPort}`;

function _updateSyncPort(port) {
    if (port && typeof port === "number" && port >= 1 && port <= 65535) {
        _syncPort = port;
        _syncUrl = `http://127.0.0.1:${_syncPort}`;
    }
}
const _RENDER_URL = "https://labs.google/fx/tools/flow";

const dotBridge = document.getElementById("dotBridge");
const valBridge = document.getElementById("valBridge");
const dotTab = document.getElementById("dotTab");
const valTab = document.getElementById("valTab");
const dotCaptcha = document.getElementById("dotRecaptcha");
const valCaptcha = document.getElementById("valRecaptcha");

const btnCheck = document.getElementById("btnTest");
const btnVerify = document.getElementById("btnTestCaptcha");
const btnRefresh = document.getElementById("btnRefresh");
const btnOpenTab = document.getElementById("btnOpenTab");

// Guard: check Facebook session tab instead of Labs tab for FB Auto Post
// Elements may be null if popup.html doesn't include them
const resultBox = document.getElementById("resultBox");

const statTokens = document.getElementById("statTokens");
const statStatus = document.getElementById("statStatus");
const statLast = document.getElementById("statLast");

let currentTabId = null;

function init() {
    chrome.storage.local.get(["syncPort"], (data) => {
        if (data && data.syncPort) {
            _updateSyncPort(data.syncPort);
        }
        _pullSnapshot();
        _pingTheme().catch(() => {});
        _pingCanvas().catch(() => {});

        setInterval(() => {
            _pingTheme().catch(() => {});
            _pullSnapshot();
        }, 3000);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.syncPort) {
            _updateSyncPort(changes.syncPort.newValue);
            _pullSnapshot();
            _pingTheme().catch(() => {});
        }
    });
}

function _pullSnapshot() {
    
    try {
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(["tokenCount", "lastSuccess"], (data) => {
                if (chrome.runtime.lastError) return;
                statTokens.textContent = data.tokenCount || 0;
                statLast.textContent = data.lastSuccess ? _humanizeAt(data.lastSuccess) : "—";
            });
        }
    } catch (e) {  }

    
    try {
        chrome.runtime.sendMessage({ type: "GET_METRICS" }, (response) => {
            if (chrome.runtime.lastError) return;
            if (response) {
                statTokens.textContent = response.tokenCount || 0;
                statStatus.textContent = response.connected ? "🟢" : "🔴";
                statStatus.style.color = response.connected ? "#22c55e" : "#ef4444";
                if (response.lastSuccess) statLast.textContent = _humanizeAt(response.lastSuccess);
            }
        });
    } catch (e) {  }
}

function _humanizeAt(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;

    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function _pingAll() {
    await Promise.all([_pingTheme(), _pingCanvas()]);
    _pullSnapshot();
}

async function _pingTheme() {
    try {
        const response = await fetch(`${_syncUrl}/sync/status`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
            _setIndicator(dotBridge, "ok");
            valBridge.textContent = "Connected";
        } else {
            _setIndicator(dotBridge, "err");
            valBridge.textContent = `Error (${response.status})`;
        }
    } catch (e) {
        _setIndicator(dotBridge, "err");
        valBridge.textContent = "Not running";
    }
}

async function _pingCanvas() {
    try {
        const tabs = await chrome.tabs.query({});
        // Check for Facebook session tabs (primary for FB Auto Post)
        const fbTabs = tabs.filter(t => t.url && (t.url.includes("facebook.com") || t.url.includes("fb.com")));
        const labsTabs = tabs.filter(t => t.url && t.url.includes("labs.google"));

        if (fbTabs.length > 0) {
            currentTabId = fbTabs[0].id;
            _setIndicator(dotTab, "ok");
            valTab.textContent = `FB Active (${fbTabs.length})`;
        } else if (labsTabs.length > 0) {
            currentTabId = labsTabs[0].id;
            _setIndicator(dotTab, "ok");
            valTab.textContent = `Labs (${labsTabs.length})`;
        } else {
            currentTabId = null;
            _setIndicator(dotTab, "warn"); valTab.textContent = "No session";
            if (dotCaptcha) _setIndicator(dotCaptcha, "warn");
            if (valCaptcha) valCaptcha.textContent = "—";
        }
    } catch (e) {
        _setIndicator(dotTab, "err"); valTab.textContent = "Error";
    }
}

async function _pingWidget(tabId) {
    try {
        const result = await Promise.race([
            chrome.runtime.sendMessage({ type: "CHECK_V", tabId }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
        ]);
        if (result && result.available) {
            _setIndicator(dotCaptcha, "ok");
            valCaptcha.textContent = "Ready";
        } else {
            _setIndicator(dotCaptcha, "warn");
            valCaptcha.textContent = result?.error || "Not ready";
        }
    } catch (e) {
        _setIndicator(dotCaptcha, "warn");
        valCaptcha.textContent = "Checking…";
    }
}

function _setIndicator(element, status) {
    if (!element) return;
    element.className = "status-dot";
    if (status === "ok") element.classList.add("dot-ok");
    else if (status === "warn") element.classList.add("dot-warn");
    else if (status === "err") element.classList.add("dot-err");
    else element.classList.add("dot-loading");
}

function _displayMessage(text, type) {
    resultBox.textContent = text;
    resultBox.className = "result-box show " + type;
}

if (btnCheck) {
  btnCheck.addEventListener("click", async () => {
    btnCheck.disabled = true;
    btnCheck.textContent = "⏳ ...";
    _setIndicator(dotBridge, "loading"); _setIndicator(dotTab, "loading");
    _setIndicator(dotCaptcha, "loading");
    if (valBridge) valBridge.textContent = "...";
    if (valTab) valTab.textContent = "...";
    if (valCaptcha) valCaptcha.textContent = "...";
    await _pingAll();
    btnCheck.disabled = false;
    btnCheck.textContent = "🔍 Kiểm Tra";
  });
}

if (btnVerify) {
  btnVerify.addEventListener("click", async () => {
    btnVerify.disabled = true;
    btnVerify.textContent = "⏳ ...";
    if (resultBox) resultBox.className = "result-box";

    try {
        let siteKey = "", action = "";
        try {
            let extId = "";
            try { extId = (await chrome.storage.local.get(["instanceId"])).instanceId || ""; } catch (e) {}
            const response = await fetch(`${_syncUrl}/sync/config`, {
                signal: AbortSignal.timeout(3000),
                headers: extId ? { "X-Ext-Id": extId } : {},
            });
            if (response.ok) {
                const config = await response.json();
                siteKey = config.recaptcha_ent_key || config.site_key || "";
                action = config.recaptcha_action || "";
            }
        } catch (e) {}

        const result = await chrome.runtime.sendMessage({
            type: "TEST_V",
            site_key: siteKey,
            action: action,
        });

        if (result && result.token) {
            _displayMessage(`✅ Verified (${result.token.length} chars)`, "success");
            _pullSnapshot();
        } else {
            _displayMessage(`❌ ${result ? result.error || "Failed" : "No response"}`, "error");
        }
    } catch (e) {
        _displayMessage(`❌ ${e.message}`, "error");
    } finally {
        btnVerify.disabled = false;
        btnVerify.textContent = "⚡ Verify";
    }
  });
}

if (btnRefresh) {
  btnRefresh.addEventListener("click", async () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = "⏳ ...";

    try {
        // Re-check all connections
        await _pingAll();
        _displayMessage("✅ Đã làm mới trạng thái!", "success");
    } catch (e) {
        _displayMessage(`❌ ${e.message}`, "error");
    } finally {
        btnRefresh.disabled = false;
        btnRefresh.textContent = "🔄 Làm Mới";
    }
  });
}

if (btnOpenTab) {
  btnOpenTab.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({});
    const flowTabs = tabs.filter(t =>
        t.url && t.url.includes("labs.google") && t.url.includes("tools/flow")
    );
    if (flowTabs.length > 0) {
        chrome.tabs.update(flowTabs[0].id, { active: true });
        chrome.windows.update(flowTabs[0].windowId, { focused: true });
    } else {
        chrome.tabs.create({ url: _RENDER_URL });
    }
  });
}

const btnOpenDashboard = document.getElementById("btnOpenDashboard");
if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener("click", () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
}

const btnExtractToken = document.getElementById("btnExtractToken");
if (btnExtractToken) {
    btnExtractToken.addEventListener("click", async () => {
        btnExtractToken.disabled = true;
        btnExtractToken.textContent = "⏳ Đang trích xuất Token...";
        resultBox.className = "result-box";

        try {
            const res = await chrome.runtime.sendMessage({ type: "FETCH_FB_TOKEN" });
            if (res && res.success && res.token) {
                _displayMessage(`✅ Token: ${res.token.substring(0, 25)}... (Đã tự động lưu vào Python Backend!)`, "success");
            } else {
                _displayMessage(`❌ ${res?.error || "Không lấy được token. Hãy mở tab Facebook và thử lại!"}`, "error");
            }
        } catch (e) {
            _displayMessage(`❌ Lỗi: ${e.message}`, "error");
        } finally {
            btnExtractToken.disabled = false;
            btnExtractToken.textContent = "🔑 Tự Động Lấy Access Token FB";
        }
    });
}

init();

function reportPopupHeight() {
    try { parent.postMessage({ __glabsPopupHeight: document.body.getBoundingClientRect().height }, "*"); } catch (e) {  }
}
try { new ResizeObserver(reportPopupHeight).observe(document.body); } catch (e) {  }
window.addEventListener("load", reportPopupHeight);
reportPopupHeight();
