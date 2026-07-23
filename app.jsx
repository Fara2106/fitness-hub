// app.jsx — AppFrame: shell con routing, storage, theme, stato globale

// ── Status bar (mobile) ───────────────────────────────────────────────────
// Riempie solo l'area del notch/Dynamic Island (safe-area-inset-top) con
// --statusbar-bg (dark = --bg, light = tono scuro → l'orologio iOS bianco resta
// leggibile). Niente finto orario/wifi/batteria: si mostra sempre e solo la
// barra di sistema reale (in browser, dove non c'è, l'inset è 0 → spacer nullo).
const StatusBar = () => (
  <div style={{ height: "env(safe-area-inset-top)", flexShrink: 0, background: "var(--statusbar-bg, var(--bg))" }} />
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
        bodyWeight={state.bodyWeight}
        setBodyWeight={(v) => set(st => ({ ...st, bodyWeight: v }))}
      />;
    case "scheda":
      return <Scheda
        {...pass}
        scheda={state.scheda} setScheda={(s) => set(st => ({ ...st, scheda: s }))}
        checkIn={state.checkIn}
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
      return <Coach {...pass} activities={state.activities} checkIn={state.checkIn} bodyWeight={state.bodyWeight} />;
    case "storico":
      return <Storico {...pass} />;
    case "impostazioni":
      return <Impostazioni
        {...pass}
        theme={state.theme} setTheme={(v) => set(st => ({ ...st, theme: v }))}
        bodyWeight={state.bodyWeight} setBodyWeight={(v) => set(st => ({ ...st, bodyWeight: v }))}
        onResetAll={() => {
          window.storage.clear();
          window.location.reload();
        }}
      />;
    case "promemoria":
      return <Promemoria {...pass} />;
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

// getAll non supportato dal backend? Rilevato alla prima sync della sessione:
// da lì in poi si usano direttamente le due chiamate legacy (zero retry inutili).
let _getAllUnsupported = false;

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
    // Percorso preferito: getAll = peso + settings in UNA chiamata (metà
    // latenza e metà quota Apps Script). Feature-detect: il backend vecchio
    // risponde al GET con il messaggio info di default (senza .settings) →
    // fallback alle due chiamate separate per il resto della sessione.
    let pesiRes = null, settingsRes = null;
    if (_getAllUnsupported === false && window.sheetsAPI.getAll) {
      const allRes = await _safe(window.sheetsAPI.getAll(), Math.max(pesiMs, settingsMs));
      const v = allRes.ok ? allRes.value : null;
      if (v && Array.isArray(v.pesoCorporeo) && v.settings && typeof v.settings === "object") {
        pesiRes     = { ok: true, value: v.pesoCorporeo };
        settingsRes = { ok: true, value: v.settings };
      } else if (allRes.ok) {
        _getAllUnsupported = true;
        console.log("[sync] getAll non supportato dal backend → fallback 2 chiamate");
      } else {
        // Errore di rete/timeout: inutile insistere subito con altre due
        // chiamate (stessa rete) — questo giro fallisce, riprova il prossimo.
        pesiRes = settingsRes = { ok: false, err: allRes.err };
      }
    }
    if (!settingsRes) {
      [pesiRes, settingsRes] = await Promise.all([
        _safe(window.sheetsAPI.getPesoCorporeo(), pesiMs),
        _safe(window.sheetsAPI.getSettings(),     settingsMs),
      ]);
    }

    // 1. Peso corporeo (foglio PesoCorporeo)
    // Robustezza: fondi lo storico cloud nel weightLog locale (dedup per data,
    // merge canonico e testato) invece di scrivere solo l'ultimo peso. Così i
    // grafici/volume hanno i dati completi anche senza aprire lo Storico, e non
    // si perde nulla per data mancante da un lato.
    if (pesiRes.ok) {
      const pesi = pesiRes.value;
      if (Array.isArray(pesi) && pesi.length > 0) {
        if (window.WorkoutProgress) {
          const merged = window.WorkoutProgress.mergeWeightLog(st.get("weightLog", []), pesi, "cloud");
          st.set("weightLog", merged);
          if (merged.length) st.set("bodyWeight", merged[merged.length - 1].weight);
        } else {
          st.set("bodyWeight", pesi[pesi.length - 1].weight);
        }
        console.log("[sync] weightLog merge ←", pesi.length, "cloud rows");
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
      // groqApiKey: NON sincronizzata (sicurezza) — la chiave resta solo sul device,
      // così non finisce nel foglio Settings esposto dal backend pubblico.
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

  // Chiavi semplici (string/number). groqApiKey ESCLUSA di proposito: è un
  // segreto → resta device-local, non va nel foglio Settings esposto.
  const KEYS = ["bodyWeight", "onboardingDone", "spesaFreq"];
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

  // Tutte le chiavi sincronizzabili (groqApiKey ESCLUSA: segreto device-local)
  push("bodyWeight",    st.get("bodyWeight", ""));
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
    const re = /^(checkIn_|hydration_|notes_|gym_|integ_|coachChat_|schedaProg_|muscleSets_|dietaCheck_|gymStart_|restDay_|nudgeDismissed_)(\d{4}-\d{2}-\d{2})$/;
    window.storage.keys().forEach(k => {
      const m = k.match(re);
      if (m && m[2] < cutKey) window.storage.remove(k);
    });
  } catch (_) {}
}

// ── AppFrame ───────────────────────────────────────────────────────────────
// ── Banner "Aggiorna": persistente in alto quando c'è un nuovo SW in attesa ──
const UpdateBanner = ({ onApply }) => {
  const t = useT();
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9995,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      padding: "calc(env(safe-area-inset-top) + 9px) 16px 9px",
      background: "var(--accent)", color: "#fff",
      fontSize: 13.5, fontWeight: 600,
      boxShadow: "0 2px 12px rgba(0,0,0,0.28)",
    }}>
      <span>🔄 {t("Nuova versione disponibile")}</span>
      <button
        onClick={onApply}
        style={{
          background: "rgba(255,255,255,0.22)", color: "#fff", border: 0,
          borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}
      >{t("Aggiorna")}</button>
    </div>
  );
};

// ── Pull-to-refresh (solo Home) ─────────────────────────────────────────────
// Sfrutta il rubber-band nativo iOS: durante l'overscroll in alto scrollTop è
// negativo. Nessun preventDefault → il gesto resta 100% nativo. L'indicatore
// sta a top:-48 dentro il contenuto: si vede solo durante il bounce.
const PullToRefresh = ({ scrollEl, onRefresh }) => {
  const t = useT();
  const [phase, setPhase] = React.useState("idle"); // idle | sync
  const armedRef = React.useRef(false);
  const iconRef = React.useRef(null);
  const THRESHOLD = 70;

  React.useEffect(() => {
    const el = scrollEl && scrollEl.current;
    if (!el || !(window.Motion && window.Motion.enabled())) return;

    const onScroll = () => {
      const y = -el.scrollTop; // > 0 durante il rubber-band in alto
      if (iconRef.current) {
        const p = Math.max(0, Math.min(1, y / THRESHOLD));
        iconRef.current.style.opacity = String(p);
        iconRef.current.style.transform = `rotate(${p * 270}deg) scale(${0.6 + p * 0.4})`;
      }
      if (y >= THRESHOLD) armedRef.current = true;
    };
    const onTouchEnd = () => {
      if (!armedRef.current) return;
      armedRef.current = false;
      setPhase("sync");
      Promise.resolve(onRefresh && onRefresh()).finally(() => setPhase("idle"));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scrollEl, onRefresh]);

  return (
    <React.Fragment>
      <div style={{
        position: "absolute", top: -48, left: 0, right: 0, height: 40,
        display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
      }}>
        <span ref={iconRef} style={{ opacity: 0, color: "var(--text-2)", display: "flex" }}>
          <Icon name="refresh" size={20} strokeWidth={2} />
        </span>
      </div>
      {phase === "sync" && (
        <div className="pill" style={{
          position: "fixed", top: "calc(env(safe-area-inset-top) + 10px)",
          left: "50%", transform: "translateX(-50%)", zIndex: 40,
          background: "var(--glass)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          boxShadow: "var(--shadow-2)",
        }}>
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
          {t("Aggiornamento…")}
        </div>
      )}
    </React.Fragment>
  );
};

const AppFrame = ({ device: _deviceProp, initialScreen, chromeless }) => {
  // Device EFFETTIVO ricalcolato dal viewport (non solo al mount): così iPad —
  // che in standalone Safari si presenta come "Macintosh" — e le rotazioni /
  // il resize del browser passano correttamente tra layout mobile e Sidebar.
  // Tablet/desktop quando il lato corto ≥ 600 e il lato lungo ≥ 820 (esclude
  // i telefoni anche in orizzontale, dove il lato corto resta < 600).
  const _computeDevice = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const short = Math.min(w, h), long = Math.max(w, h);
    return (short >= 600 && long >= 820) ? "desktop" : "mobile";
  };
  const [device, setDevice] = React.useState(_computeDevice);
  React.useEffect(() => {
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setDevice(_computeDevice())); };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("orientationchange", onResize); cancelAnimationFrame(raf); };
  }, []);

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
      bodyWeight:   st.get("bodyWeight", 100),
      theme:        st.get("theme", "system"), // default: segue il sistema (Mac/iOS)
      spesaChecked: st.get("spesaChecked", {}),
      spesaFreq:    st.get("spesaFreq", 1),
    };
  }

  const [state, setStateRaw] = React.useState({ screen: initialScreen, scheda: "Upper A", isHome: false, activities: [], checkIn: { sleep: 4, energy: 4, ailments: "" }, bodyWeight: 100, theme: "system", spesaChecked: {}, spesaFreq: 1 });
  const [lang, setLang] = React.useState(window.storage ? window.storage.get("lang", "it") : "it");
  const [initialized, setInitialized] = React.useState(false);
  const [updateReady, setUpdateReady] = React.useState(() => !!window._swUpdateReady);
  React.useEffect(() => {
    const onUpd = () => setUpdateReady(true);
    window.addEventListener("lfh-sw-update", onUpd);
    return () => window.removeEventListener("lfh-sw-update", onUpd);
  }, []);
  const syncNowRef = React.useRef(null);

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
      // Push settings con retry (_saveSettingRetry): il fire-and-forget singolo
      // perdeva il dato al primo errore di rete (stessa ragione per cui esiste
      // _saveSettingRetry — ora usato coerentemente anche qui).
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

  // Motion d'ingresso schermata: stagger delle card dentro il container di
  // scroll a ogni cambio route. Centralizzato qui: le schermate non sanno nulla.
  React.useEffect(() => {
    if (!initialized) return;
    const el = document.querySelector(".lfh-scroll");
    if (el && window.Motion) window.Motion.screenEnter(el);
  }, [state.screen, initialized]);

  // Re-sync: foreground (Page Visibility) + polling periodico mentre l'app è
  // aperta, così le modifiche fatte su un altro device compaiono da sole.
  React.useEffect(() => {
    if (!initialized) return;

    // Pull dal cloud + riallinea lo stato React condiviso
    const pullAndApply = () => {
      if (document.visibilityState !== "visible") return Promise.resolve();
      return _cloudSync({ pesiMs: 6000, settingsMs: 8000 }).finally(() => {
        const s = initState();
        setStateRaw(prev => ({
          ...prev,
          bodyWeight:   s.bodyWeight,
          checkIn:      s.checkIn,
          spesaChecked: s.spesaChecked,
          spesaFreq:    s.spesaFreq,
        }));
      });
    };
    syncNowRef.current = pullAndApply;

    const handleVisibility = () => { if (document.visibilityState === "visible") pullAndApply(); };
    document.addEventListener("visibilitychange", handleVisibility);

    // Polling ogni 45s (solo quando visibile, per non sprecare quota Apps Script)
    const POLL_MS = 45000;
    const interval = setInterval(pullAndApply, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
      syncNowRef.current = null;
    };
  }, [initialized]);

  const scrollRef = React.useRef(null);

  const globalCtx = { lang, setLang: (l) => { setLang(l); window.storage && window.storage.set("lang", l); } };

  const isDesktop    = device === "desktop";
  const isOnboarding = state.screen === "onboarding";

  const wrap = (content) => (
    <LangContext.Provider value={{ lang, setLang: globalCtx.setLang }}>
      {updateReady && <UpdateBanner onApply={() => window._swApplyUpdate && window._swApplyUpdate()} />}
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
            {/* Contenuto centrato con max-width: sfrutta lo spazio iPad/desktop
                senza stirare le schermate a tutta larghezza. */}
            <div style={{ maxWidth: 960, width: "100%", margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column" }}>
              <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
            </div>
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
        <div className="lfh-scroll" ref={scrollRef} style={{ flex: 1, position: "relative" }}>
          <Screen which={state.screen} device={device} state={state} set={setState} globalCtx={globalCtx} />
          {state.screen === "dashboard" && (
            <PullToRefresh
              scrollEl={scrollRef}
              onRefresh={() => (syncNowRef.current ? syncNowRef.current() : Promise.resolve())}
            />
          )}
        </div>
      )}
      <TabBar screen={state.screen} onNav={(s) => setState(st => ({ ...st, screen: s }))} />
    </div>
  );
};

window.AppFrame = AppFrame;
