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
// Ogni schermata dentro un error boundary (key = schermata → reset al cambio
// tab): un errore di render non porta più giù tutta l'app.
const Screen = (props) => (
  <UIErrorBoundary
    key={props.which}
    where={props.which}
    onHome={props.which === "dashboard" ? null : () => props.set(st => ({ ...st, screen: "dashboard" }))}
  >
    <ScreenInner {...props} />
  </UIErrorBoundary>
);

const ScreenInner = ({ which, device, state, set, globalCtx }) => {
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

// ── Sync v2 (Worker fitness-hub-api + D1, motore in syncv2.jsx) ───────────
// Il motore pubblica lo stato in window._syncState + evento "lfh-sync" (SyncBadge in
// nav.jsx, riga in Impostazioni) e, dopo aver applicato record in arrivo, l'evento
// "lfh-data" { keys } con le chiavi locali riscritte: le schermate ricaricano da lì.
// Le schermate scrivono SOLO lo storage locale: il ponte (storage.onChange →
// RecordMap → coda) porta le modifiche al server, offline compreso.
// init dentro onReady: l'indice della cache record si costruisce da storage.keys().
// Registrato qui (al caricamento del bundle) → gira prima dell'onReady di AppFrame.
if (window.storage) {
  window.storage.onReady(() => {
    _cleanupOldDailyKeys();
    try { if (window.SyncV2) window.SyncV2.init({ storage: window.storage }); }
    catch (e) { if (window._logError) window._logError(e); else console.warn("[sync] init:", e); }
    // (Task 9C) Il collegamento passa dall'account (Impostazioni → Account): il vecchio link con il token
    // nell'hash dell'URL non collega più nulla.
  });
}

// Sync completo (push coda + pull). Mai rigetta: senza token → "unlinked".
function _syncNow() {
  if (!window.SyncV2) return Promise.resolve({ ok: false, error: "assente" });
  return window.SyncV2.syncNow().catch(() => ({ ok: false }));
}

// Onboarding saltato in automatico se i dati dicono che l'app è già in uso
// (peso arrivato dal sync o chiave Groq presente), come faceva il vecchio motore.
function _autoSkipOnboarding() {
  const st = window.storage;
  if (!st || st.get("onboardingDone", false)) return;
  if (parseFloat(st.get("bodyWeight", 0)) > 0 || !!st.get("groqApiKey", "")) st.set("onboardingDone", true);
}

// ── Pulizia chiavi giornaliere vecchie (>90 giorni) ────────────────────────
// checkIn_/hydration_/notes_/gym_/integ_/coachChat_/schedaProg_ si accumulano
// una per giorno: senza sweep IndexedDB cresce per sempre. Rimozioni SILENZIOSE:
// sul server i record restano per sempre, lo sweep non deve generare push.
function _cleanupOldDailyKeys() {
  if (!window.storage || !window.storage.keys) return;
  try {
    const cut = new Date();
    cut.setDate(cut.getDate() - 90);
    const cutKey = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
    const re = /^(checkIn_|hydration_|notes_|gym_|integ_|coachChat_|schedaProg_|muscleSets_|dietaCheck_|dietaVariant_|gymStart_|gymSaved_|restDay_|nudgeDismissed_)(\d{4}-\d{2}-\d{2})$/;
    window.storage.keys().forEach(k => {
      const m = k.match(re);
      if (m && m[2] < cutKey) window.storage.remove(k, { silent: true });
    });
  } catch (_) {}
}

// ── AppFrame ───────────────────────────────────────────────────────────────
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
  const syncNowRef = React.useRef(null);

  // Riallinea lo stato React condiviso a quanto il sync ha scritto in storage.
  // keys = chiavi riscritte (evento "lfh-data"); senza keys → tutto. Le modifiche
  // locali in coda non tornano mai indietro: il motore le sovrappone ai record in arrivo.
  const applySynced = (keys) => {
    const s = initState();
    const has = (k) => !keys || keys.indexOf(k) !== -1;
    setStateRaw(prev => {
      const next = { ...prev };
      if (has("bodyWeight"))       next.bodyWeight   = s.bodyWeight;
      if (has(`checkIn_${today}`)) next.checkIn      = s.checkIn;
      if (has("spesaChecked"))     next.spesaChecked = s.spesaChecked;
      if (has("spesaFreq"))        next.spesaFreq    = s.spesaFreq;
      // activities: senza riallineo, il prossimo "Log" riscriverebbe la lista
      // vecchia e cancellerebbe le attività arrivate dall'altro device.
      if (has("activities"))       next.activities   = s.activities;
      if (has("theme"))            next.theme        = s.theme;
      return next;
    });
    if (has("lang") && window.storage) setLang(window.storage.get("lang", "it"));
  };

  React.useEffect(() => {
    const onData = (e) => {
      if (!window.storage || !window.storage.isReady()) return;
      const keys = (e && e.detail && Array.isArray(e.detail.keys)) ? e.detail.keys : null;
      applySynced(keys);
    };
    window.addEventListener("lfh-data", onData);
    return () => window.removeEventListener("lfh-data", onData);
  }, []);

  React.useEffect(() => {
    if (!storageReady || initialized) return;
    const finish = () => {
      setStateRaw(initState());
      setLang(window.storage ? window.storage.get("lang", "it") : "it");
      setInitialized(true);
    };
    const bootSync = _syncNow().then(_autoSkipOnboarding);
    if (window.storage && window.storage.get("onboardingDone", false)) {
      // Avvio "a regime": UI subito dai dati locali, sync in background
      // (i dati in arrivo riallineano le schermate via "lfh-data").
      finish();
    } else {
      // Primo avvio: si aspetta il sync (se il device è collegato può far saltare
      // l'onboarding), ma mai più di 10 s — senza token risponde subito.
      Promise.race([bootSync, new Promise(r => setTimeout(r, 10000))]).finally(finish);
    }
  }, [storageReady]);

  // Persiste i cambi di stato in storage: il ponte di SyncV2 li porta al server.
  const setState = React.useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!window.storage) return next;
      const t = window.todayKey ? window.todayKey() : today;
      if (next.activities   !== prev.activities)   window.storage.set("activities", next.activities.slice(0, 50));
      if (next.checkIn      !== prev.checkIn)      window.storage.set(`checkIn_${t}`, next.checkIn);
      if (next.bodyWeight   !== prev.bodyWeight)   window.storage.set("bodyWeight", next.bodyWeight);
      if (next.spesaChecked !== prev.spesaChecked) window.storage.set("spesaChecked", next.spesaChecked);
      if (next.spesaFreq    !== prev.spesaFreq)    window.storage.set("spesaFreq", next.spesaFreq);
      if (next.theme        !== prev.theme)        { window.storage.set("theme", next.theme); _applyTheme(next.theme); }
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
    // Il contenitore di scroll è condiviso fra le schermate: senza reset una
    // tab si apriva già scrollata alla posizione della precedente.
    if (el) el.scrollTop = 0;
    if (el && window.Motion) window.Motion.screenEnter(el);
  }, [state.screen, initialized]);

  // Re-sync: foreground (Page Visibility), ritorno della rete e polling ogni 45 s
  // mentre l'app è visibile, così le modifiche fatte su un altro device compaiono da sole.
  React.useEffect(() => {
    if (!initialized) return;

    const syncIfVisible = () => {
      if (document.visibilityState !== "visible") return Promise.resolve();
      return _syncNow();
    };
    syncNowRef.current = syncIfVisible;

    const handleVisibility = () => { if (document.visibilityState === "visible") syncIfVisible(); };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", syncIfVisible);

    const POLL_MS = 45000;
    const interval = setInterval(syncIfVisible, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", syncIfVisible);
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
            <div style={{
              maxWidth: 960, width: "100%", margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column",
              // Coach = chat a tutta altezza con scroll interno: con il solo
              // min-height il suo height:100% collassava (input a metà schermo).
              height: state.screen === "coach" ? "100%" : undefined,
            }}>
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
