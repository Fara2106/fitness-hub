// app.jsx — AppFrame: shell con routing, storage, theme, stato globale

// ── Detect PWA standalone mode ────────────────────────────────────────────
const _isStandalone = window.navigator.standalone === true
  || window.matchMedia("(display-mode: standalone)").matches;

// ── Status bar (mobile) ───────────────────────────────────────────────────
// In PWA installata non mostriamo il finto orario, ma riempiamo comunque
// l'area del notch (safe-area-inset-top) con --statusbar-bg: in dark = --bg,
// in light = tono scuro (l'orologio iOS con black-translucent è SEMPRE bianco
// e non è cambiabile a runtime → serve uno sfondo scuro per leggerlo).
const StatusBar = () => _isStandalone ? (
  <div style={{ height: "env(safe-area-inset-top)", flexShrink: 0, background: "var(--statusbar-bg, var(--bg))" }} />
) : (
  <div className="lfh-status" style={{ paddingTop: "env(safe-area-inset-top)", boxSizing: "content-box" }}>

    <span className="num">9:41</span>
    <span className="sig">
      <svg width="17" height="11" viewBox="0 0 17 11" fill="none">
        <rect x="0" y="6"  width="3" height="5"  rx="0.7" fill="currentColor" />
        <rect x="5" y="4"  width="3" height="7"  rx="0.7" fill="currentColor" />
        <rect x="10" y="2" width="3" height="9"  rx="0.7" fill="currentColor" />
        <rect x="15" y="0" width="2" height="11" rx="0.7" fill="currentColor" opacity="0.4" />
      </svg>
      <svg width="15" height="10" viewBox="0 0 15 10" fill="none">
        <path d="M7.5 1.7C5 1.7 2.7 2.5 1 3.9l1 1.3C3.4 4 5.4 3.3 7.5 3.3s4.1.7 5.5 1.9l1-1.3C12.3 2.5 10 1.7 7.5 1.7Zm0 3.3c-1.5 0-3 .5-4 1.4l1 1.3c.7-.6 1.8-1 3-1s2.3.4 3 1l1-1.3c-1-.9-2.5-1.4-4-1.4Zm0 3.4c-.7 0-1.4.2-1.9.7l1.9 2 1.9-2c-.5-.4-1.2-.7-1.9-.7Z" fill="currentColor" />
      </svg>
      <svg width="25" height="11" viewBox="0 0 25 11" fill="none">
        <rect x="0.5" y="0.5" width="21" height="10" rx="2.5" stroke="currentColor" strokeOpacity="0.5" />
        <rect x="22.5" y="3.5" width="1.5" height="4" rx="0.6" fill="currentColor" opacity="0.5" />
        <rect x="2" y="2" width="17" height="7" rx="1.5" fill="currentColor" />
      </svg>
    </span>
  </div>
);

// ── Screen renderer ────────────────────────────────────────────────────────
const Screen = ({ which, device, state, set, globalCtx }) => {
  const onNav = (s) => set(st => ({ ...st, screen: s }));
  const pass  = { device, onNav, globalCtx };

  switch (which) {
    case "dashboard":
      return <Dashboard
        {...pass}
        activities={state.activities} addActivity={(a) => set(st => ({ ...st, activities: [{ ...a, id: Date.now(), when: "Oggi" }, ...st.activities] }))}
        checkIn={state.checkIn} setCheckIn={(v) => set(st => ({ ...st, checkIn: v }))}
        hydration={state.hydration} setHydration={(v) => set(st => ({ ...st, hydration: v }))}
        weekNum={state.weekNum}
        setWeekNum={(v) => set(st => ({ ...st, weekNum: v }))}
        bodyWeight={state.bodyWeight}
        setBodyWeight={(v) => set(st => ({ ...st, bodyWeight: v }))}
      />;
    case "scheda":
      return <Scheda
        {...pass}
        scheda={state.scheda} setScheda={(s) => set(st => ({ ...st, scheda: s }))}
        checkIn={state.checkIn}
        weekNum={state.weekNum}
      />;
    case "dieta":
      return <Dieta {...pass} />;
    case "spesa":
      return <Spesa {...pass}
        spesaChecked={state.spesaChecked}
        setSpesaChecked={(v) => set(st => ({ ...st, spesaChecked: v }))}
        spesaFreq={state.spesaFreq}
        setSpesaFreq={(v) => set(st => ({ ...st, spesaFreq: v }))}
      />;
    case "coach":
      return <Coach {...pass} activities={state.activities} checkIn={state.checkIn} hydration={state.hydration} weekNum={state.weekNum} bodyWeight={state.bodyWeight} />;
    case "storico":
      return <Storico {...pass} />;
    case "impostazioni":
      return <Impostazioni
        {...pass}
        theme={state.theme} setTheme={(v) => set(st => ({ ...st, theme: v }))}
        weekNum={state.weekNum} setWeekNum={(v) => set(st => ({ ...st, weekNum: v }))}
        bodyWeight={state.bodyWeight} setBodyWeight={(v) => set(st => ({ ...st, bodyWeight: v }))}
        onResetAll={() => {
          window.storage.clear();
          window.location.reload();
        }}
      />;
    case "onboarding":
      return <Onboarding {...pass} onDone={() => set(st => ({ ...st, screen: "dashboard" }))} />;
    default:
      return null;
  }
};

// ── Apply theme to document ────────────────────────────────────────────────
function _applyTheme(theme) {
  const root = document.documentElement;
  let light;
  if      (theme === "light") light = true;
  else if (theme === "dark")  light = false;
  else {
    // "system" (Auto): segue prefers-color-scheme di macOS / iOS / Windows
    light = !(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  root.classList.toggle("theme-light", light);
  // theme-color: iOS lo usa per la striscia della home-indicator (che la pagina non può
  // dipingere). iOS standalone ONORA i meta media-scoped statici ma IGNORA questi update JS;
  // aggiorniamo comunque entrambi i meta per i browser che li onorano + override tema manuale.
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach(m => m.setAttribute("content", light ? "#f7f7fa" : "#0b0b0f"));
}

// ── Sync state (osservabile dalla UI: SyncBadge in nav.jsx, riga in Impostazioni) ──
window._syncState = { status: "idle", last: null };
function _setSyncState(status) {
  const prev = window._syncState || {};
  window._syncState = {
    status,
    last: status === "ok" ? Date.now() : prev.last || null,
  };
  try { window.dispatchEvent(new Event("lfh-sync")); } catch (_) {}
}

// ── Cloud sync (pull settings + peso from Sheets on startup) ─────────────
//
// ARCHITETTURA: ogni chiamata ha il suo timeout individuale via _safe().
// Promise.all aspetta entrambe, ma ognuna risolve a {ok,value/err} senza
// mai rigettare → nessun blocco se una delle due è lenta.
function _safe(p, ms) {
  return Promise.race([
    p.then(v  => ({ ok: true,  value: v    }))
     .catch(e => ({ ok: false, err: String(e) })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false, err: "timeout" }), ms)),
  ]);
}

// Salva una setting con un retry (le push erano fire-and-forget: un singolo
// errore di rete faceva sparire per sempre il dato dal cloud).
function _saveSettingRetry(key, value, tries = 2) {
  if (!window.sheetsAPI) return Promise.resolve(false);
  const attempt = (n) =>
    window.sheetsAPI.saveSettings({ key, value: String(value) })
      .then(() => { console.log("[sync push]", key, "✓"); return true; })
      .catch(e => {
        if (n > 0) return new Promise(r => setTimeout(r, 800)).then(() => attempt(n - 1));
        console.warn("[sync push err]", key, e);
        return false;
      });
  return attempt(tries);
}
window._saveSettingRetry = _saveSettingRetry;

// ── Sorgente di verità: i file scheda.txt / dieta.txt del repo ────────────
// L'app leggeva schedaData/dietaData SOLO da storage (import manuale o cloud):
// modificare i .txt del repo e ridistribuire non aggiornava mai la scheda/dieta.
// Ora, all'avvio, si confronta il .txt del repo con l'ultima versione applicata
// (schedaData_src): se è cambiato, il .txt VINCE → sovrascrive lo storage locale
// e viene pushato al cloud (Settings sheet). _repoOverride segna le chiavi che il
// repo ha già vinto in questa sessione, così il pull cloud (che è cloud-wins e
// avrebbe ancora il valore vecchio finché il push non propaga) non le riscrive.
const _repoOverride = {};

async function _reconcileRepoFiles() {
  if (!window.storage) return;
  const st = window.storage;
  const files = [
    { file: "scheda.txt", key: "schedaData", parse: window.parseScheda, valid: (p) =>
        !!p && Array.isArray(p.days) && p.days.some(d => d && Array.isArray(d.exercises) && d.exercises.length) },
    { file: "dieta.txt",  key: "dietaData",  parse: window.parseDieta,  valid: (p) =>
        !!p && Object.keys(p || {}).some(k => p[k] && Array.isArray(p[k].meals) && p[k].meals.length) },
  ];
  await Promise.all(files.map(async ({ file, key, parse, valid }) => {
    try {
      // cache-bust + no-store: prendi sempre la versione fresca del repo
      // (il service worker è comunque network-first sui file same-origin).
      const url = new URL(file, document.baseURI).href + "?_cb=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;                     // offline / 404 → non toccare nulla
      const text = await res.text();
      if (!text || !text.trim()) return;
      // Non applicare un file rotto: deve almeno parsare in modo valido.
      if (parse) { try { if (!valid(parse(text))) return; } catch (_) { return; } }
      if (text === st.get(key + "_src", null)) return;  // invariato dall'ultima volta
      st.set(key, text);
      st.set(key + "_src", text);
      st.set(key + "_name", file);             // mostrato in Impostazioni → File di testo
      st.set(key + "_at", new Date().toISOString());
      _repoOverride[key] = true;               // il repo vince per tutta la sessione
      _saveSettingRetry(key, text);            // → cloud (Settings sheet)
      console.log("[repo-file] " + key + " aggiornato da " + file + " → storage + cloud");
    } catch (e) { console.warn("[repo-file]", file, e); }
  }));
}
window._reconcileRepoFiles = _reconcileRepoFiles;

async function _cloudSync(opts) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const { pesiMs = 8000, settingsMs = 15000 } = opts || {};

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    _setSyncState("offline");
    return;
  }
  _setSyncState("syncing");

  try {
    const [pesiRes, settingsRes] = await Promise.all([
      _safe(window.sheetsAPI.getPesoCorporeo(), pesiMs),
      _safe(window.sheetsAPI.getSettings(),     settingsMs),
    ]);

    // 1. Peso corporeo (foglio PesoCorporeo)
    if (pesiRes.ok) {
      const pesi = pesiRes.value;
      if (Array.isArray(pesi) && pesi.length > 0) {
        st.set("bodyWeight", pesi[pesi.length - 1].weight);
        console.log("[sync] bodyWeight →", pesi[pesi.length - 1].weight);
      }
    } else {
      console.warn("[sync] getPesoCorporeo:", pesiRes.err);
    }

    // 2. Settings cross-device (cloud → local)
    // cloudKeys = null finché NON abbiamo letto con successo dal cloud.
    // Fondamentale: se il pull fallisce non dobbiamo pushare nulla, altrimenti
    // i dati locali (magari stale) sovrascriverebbero quelli buoni nel cloud.
    let cloudKeys = null;
    if (settingsRes.ok && settingsRes.value && typeof settingsRes.value === "object") {
      const s = settingsRes.value;
      cloudKeys = s;
      ["schedaData", "dietaData"].forEach(k => {
        // Se il .txt del repo ha già vinto in questa sessione, non lasciare che
        // il valore (ancora vecchio) del cloud lo riscriva prima che il push propaghi.
        if (_repoOverride[k]) return;
        if (s[k]) { st.set(k, s[k]); console.log("[sync pull]", k, "✓"); }
      });
      // spesaChecked2: chiave cloud "pulita" (la vecchia "spesaChecked" aveva
      // righe duplicate nel foglio → lettura sempre stale). Pull retro-compatibile.
      const spesaCloud = s.spesaChecked2 || s.spesaChecked;
      if (spesaCloud) {
        try { st.set("spesaChecked", JSON.parse(spesaCloud)); console.log("[sync pull] spesaChecked ✓"); } catch(_) {}
      }
      if (s.spesaFreq)  st.set("spesaFreq", Number(s.spesaFreq) || 1);
      // groqApiKey: cloud wins sempre
      if (s.groqApiKey) { st.set("groqApiKey", s.groqApiKey); console.log("[sync pull] groqApiKey ✓"); }
      // clamp 1..8: un valore corrotto nel foglio non deve rompere la UI
      if (s.weekNum)    st.set("weekNum", Math.max(1, Math.min(8, Number(s.weekNum) || 1)));
      if (s.bodyWeight && parseFloat(s.bodyWeight) > 0) {
        st.set("bodyWeight", parseFloat(s.bodyWeight));
        console.log("[sync pull] bodyWeight (settings) →", s.bodyWeight);
      }
      if (s.onboardingDone === "true") st.set("onboardingDone", true);
    } else {
      console.warn("[sync] getSettings:", settingsRes.err);
    }

    // 3. Auto-skip onboarding
    const hasBW   = parseFloat(st.get("bodyWeight", 0)) > 0;
    const hasGroq = !!st.get("groqApiKey", "");
    if (hasGroq || hasBW) {
      st.set("onboardingDone", true);
      // pusha onboardingDone solo se il pull è riuscito e il cloud non l'ha
      if (cloudKeys && cloudKeys.onboardingDone !== "true") {
        window.sheetsAPI.saveSettings({ key: "onboardingDone", value: "true" }).catch(() => {});
      }
      console.log("[sync] onboardingDone → true");
    }

    // 4. Push locale → cloud SOLO per chiavi mancanti, e SOLO se il pull è
    //    riuscito (cloudKeys != null). Se il pull è fallito non sappiamo cosa
    //    c'è nel cloud → non pushare, per non sovrascrivere dati buoni.
    if (cloudKeys) _cloudPushMissing(cloudKeys);
    else console.warn("[sync] pull settings fallito → push saltato (anti-clobber)");

    _setSyncState(settingsRes.ok || pesiRes.ok ? "ok" : "error");

  } catch (e) { console.warn("[sync] error:", e); _setSyncState("error"); }
}

// ── Cloud push: pusha al cloud tutto ciò che manca ────────────────────────
function _cloudPushMissing(cloudKeys) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const save = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      _saveSettingRetry(key, value);
    }
  };

  // Chiavi semplici (string/number)
  const KEYS = ["groqApiKey", "bodyWeight", "weekNum", "onboardingDone", "spesaFreq"];
  KEYS.forEach(k => {
    const local = st.get(k, "");
    if (local && !cloudKeys[k]) {
      save(k, k === "onboardingDone" ? "true" : local);
    }
  });

  // Chiavi grandi (text files)
  ["schedaData", "dietaData"].forEach(k => {
    const local = st.get(k, null);
    if (local && !cloudKeys[k]) {
      save(k, local);
    }
  });

  // spesaChecked (JSON)
  const sc = st.get("spesaChecked", null);
  if (sc && Object.keys(sc).length > 0 && !cloudKeys.spesaChecked2) {
    save("spesaChecked2", JSON.stringify(sc));
  }
}

// ── Push forzato di TUTTO al cloud (per bottone "Sincronizza ora") ────────
window._cloudPushAll = function() {
  if (!window.sheetsAPI || !window.storage) return Promise.resolve();
  const st = window.storage;
  const saves = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      saves.push(_saveSettingRetry(key, value));
    }
  };

  // Tutte le chiavi sincronizzabili
  push("groqApiKey",    st.get("groqApiKey", ""));
  push("bodyWeight",    st.get("bodyWeight", ""));
  push("weekNum",       st.get("weekNum", ""));
  push("spesaFreq",     st.get("spesaFreq", ""));
  push("onboardingDone", st.get("onboardingDone", false) ? "true" : "");

  const sc = st.get("spesaChecked", null);
  if (sc && Object.keys(sc).length > 0) push("spesaChecked2", JSON.stringify(sc));

  const scheda = st.get("schedaData", null);
  if (scheda) push("schedaData", scheda);

  const dieta = st.get("dietaData", null);
  if (dieta) push("dietaData", dieta);

  return Promise.all(saves);
};

// ── Pulizia chiavi giornaliere vecchie (>90 giorni) ────────────────────────
// checkIn_/hydration_/notes_/gym_/integ_/coachChat_/schedaProg_ si accumulano
// una per giorno: senza sweep IndexedDB cresce per sempre.
function _cleanupOldDailyKeys() {
  if (!window.storage || !window.storage.keys) return;
  try {
    const cut = new Date();
    cut.setDate(cut.getDate() - 90);
    const cutKey = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
    const re = /^(checkIn_|hydration_|notes_|gym_|integ_|coachChat_|schedaProg_|muscleSets_)(\d{4}-\d{2}-\d{2})$/;
    window.storage.keys().forEach(k => {
      const m = k.match(re);
      if (m && m[2] < cutKey) window.storage.remove(k);
    });
  } catch (_) {}
}

// ── AppFrame ───────────────────────────────────────────────────────────────
const AppFrame = ({ device, initialScreen, chromeless }) => {
  const [storageReady, setStorageReady] = React.useState(window.storage ? window.storage.isReady() : false);

  React.useEffect(() => {
    if (!window.storage) { setStorageReady(true); return; }
    window.storage.onReady(() => setStorageReady(true));
  }, []);

  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);

  // Lazily read initial state from storage when ready
  function initState() {
    const st = window.storage || { get: (k, d) => d };
    return {
      screen:       initialScreen || (st.get("onboardingDone", false) ? "dashboard" : "onboarding"),
      scheda:       "Upper A",
      isHome:       false,
      activities:   st.get("activities", []),
      checkIn:      st.get(`checkIn_${today}`, { sleep: 4, energy: 4, ailments: "" }),
      hydration:    st.get(`hydration_${today}`, 3),
      weekNum:      st.get("weekNum", 1),
      bodyWeight:   st.get("bodyWeight", 100),
      theme:        st.get("theme", "system"), // default: segue il sistema (Mac/iOS)
      spesaChecked: st.get("spesaChecked", {}),
      spesaFreq:    st.get("spesaFreq", 1),
    };
  }

  const [state, setStateRaw] = React.useState({ screen: initialScreen, scheda: "Upper A", isHome: false, activities: [], checkIn: { sleep: 4, energy: 4, ailments: "" }, hydration: 3, weekNum: 1, bodyWeight: 100, theme: "system", spesaChecked: {}, spesaFreq: 1 });
  const [lang, setLang] = React.useState(window.storage ? window.storage.get("lang", "it") : "it");
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (!storageReady || initialized) return;
    _cleanupOldDailyKeys();
    _reconcileRepoFiles().finally(() => _cloudSync()).finally(() => {
      const s = initState();
      setStateRaw(s);
      setLang(window.storage ? window.storage.get("lang", "it") : "it");
      setInitialized(true);
    });
  }, [storageReady]);

  // Persist state changes to storage
  const setState = React.useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!window.storage) return next;
      // Persist relevant keys
      const t = window.todayKey ? window.todayKey() : today;
      if (next.activities !== prev.activities) window.storage.set("activities", next.activities.slice(0, 50));
      if (next.checkIn    !== prev.checkIn) {
        window.storage.set(`checkIn_${t}`, next.checkIn);
        if (window.sheetsAPI) window.sheetsAPI.saveCheckIn({ date: t, sleep: next.checkIn.sleep, energy: next.checkIn.energy, ailments: next.checkIn.ailments || "" }).catch(() => {});
      }
      if (next.hydration  !== prev.hydration)  window.storage.set(`hydration_${t}`, next.hydration);
      // Push settings con retry (_saveSettingRetry): il fire-and-forget singolo
      // perdeva il dato al primo errore di rete (stessa ragione per cui esiste
      // _saveSettingRetry — ora usato coerentemente anche qui).
      if (next.weekNum    !== prev.weekNum) {
        window.storage.set("weekNum", next.weekNum);
        _saveSettingRetry("weekNum", next.weekNum);
      }
      if (next.bodyWeight !== prev.bodyWeight) {
        window.storage.set("bodyWeight", next.bodyWeight);
        _saveSettingRetry("bodyWeight", next.bodyWeight);
        if (window.sheetsAPI) window.sheetsAPI.savePesoCorporeo({ date: t, weight: next.bodyWeight }).catch(() => {});
      }
      if (next.spesaChecked !== prev.spesaChecked) {
        window.storage.set("spesaChecked", next.spesaChecked);
        _saveSettingRetry("spesaChecked2", JSON.stringify(next.spesaChecked));
      }
      if (next.spesaFreq !== prev.spesaFreq) {
        window.storage.set("spesaFreq", next.spesaFreq);
        _saveSettingRetry("spesaFreq", next.spesaFreq);
      }
      if (next.theme      !== prev.theme)       { window.storage.set("theme", next.theme); _applyTheme(next.theme); }
      return next;
    });
  }, [today]);

  // Apply theme on mount + when theme changes.
  // In modalità "system" resta in ascolto dei cambi di tema del sistema
  // operativo (es. macOS/iOS che passano a scuro la sera) e si riallinea live.
  React.useEffect(() => {
    _applyTheme(state.theme);
    if (state.theme === "light" || state.theme === "dark") return;
    const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => _applyTheme("system");
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange); // Safari < 14
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, [state.theme]);

  // Re-sync: foreground (Page Visibility) + polling periodico mentre l'app è
  // aperta, così le modifiche fatte su un altro device compaiono da sole.
  React.useEffect(() => {
    if (!initialized) return;

    // Pull dal cloud + riallinea lo stato React condiviso
    const pullAndApply = () => {
      if (document.visibilityState !== "visible") return;
      _cloudSync({ pesiMs: 6000, settingsMs: 8000 }).finally(() => {
        const s = initState();
        setStateRaw(prev => ({
          ...prev,
          bodyWeight:   s.bodyWeight,
          weekNum:      s.weekNum,
          checkIn:      s.checkIn,
          hydration:    s.hydration,
          spesaChecked: s.spesaChecked,
          spesaFreq:    s.spesaFreq,
        }));
      });
    };

    const handleVisibility = () => { if (document.visibilityState === "visible") pullAndApply(); };
    document.addEventListener("visibilitychange", handleVisibility);

    // Polling ogni 45s (solo quando visibile, per non sprecare quota Apps Script)
    const POLL_MS = 45000;
    const interval = setInterval(pullAndApply, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [initialized]);

  const globalCtx = { lang, setLang: (l) => { setLang(l); window.storage && window.storage.set("lang", l); } };

  const isDesktop    = device === "desktop";
  const isOnboarding = state.screen === "onboarding";

  const wrap = (content) => (
    <LangContext.Provider value={{ lang, setLang: globalCtx.setLang }}>
      {content}
    </LangContext.Provider>
  );

  if (!storageReady || !initialized) {
    return wrap(
      <div className={`lfh ${isDesktop ? "desktop" : "mobile"}`} style={{ alignItems: "center", justifyContent: "center" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (isOnboarding || chromeless) {
    return wrap(
      <div className={`lfh ${isDesktop ? "desktop" : "mobile"}`}>
        {!isDesktop && <StatusBar />}
        <div className="lfh-scroll" style={{ flex: 1 }}>
          <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
        </div>
      </div>
    );
  }

  if (isDesktop) {
    return wrap(
      <div className="lfh desktop" style={{ flexDirection: "row" }}>
        <Sidebar screen={state.screen} onNav={(s) => setState(st => ({ ...st, screen: s }))} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="lfh-scroll" style={{ flex: 1 }}>
            <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
          </div>
        </div>
      </div>
    );
  }

  // Mobile
  return wrap(
    <div className="lfh mobile">
      <StatusBar />
      {state.screen === "coach" ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
        </div>
      ) : (
        <div className="lfh-scroll" style={{ flex: 1 }}>
          <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
        </div>
      )}
      <TabBar screen={state.screen} onNav={(s) => setState(st => ({ ...st, screen: s }))} />
    </div>
  );
};

window.AppFrame = AppFrame;
