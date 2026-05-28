// app.jsx — AppFrame: shell con routing, storage, theme, stato globale

// ── Detect PWA standalone mode ────────────────────────────────────────────
const _isStandalone = window.navigator.standalone === true
  || window.matchMedia("(display-mode: standalone)").matches;

// ── Status bar (mobile only, nascosta se PWA installata) ──────────────────
const StatusBar = () => _isStandalone ? null : (
  <div className="lfh-status">
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
      return <Spesa {...pass} />;
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
  if (theme === "light") {
    root.classList.add("theme-light");
  } else if (theme === "dark") {
    root.classList.remove("theme-light");
  } else {
    // system
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (prefersDark) root.classList.remove("theme-light");
    else             root.classList.add("theme-light");
  }
}

// ── Cloud sync (pull settings + peso from Sheets on startup) ─────────────
async function _cloudSync() {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  try {
    await Promise.race([
      (async () => {
        // 1. Body weight — prendi l'ultimo dal foglio PesoCorporeo
        if (!st.get("bodyWeight", "") || parseFloat(st.get("bodyWeight", 0)) <= 0) {
          try {
            const pesi = await window.sheetsAPI.getPesoCorporeo();
            if (Array.isArray(pesi) && pesi.length > 0) {
              st.set("bodyWeight", pesi[pesi.length - 1].weight);
            }
          } catch (_) {}
        }
        // 2. Settings — il cloud fa sempre testo (così gli aggiornamenti si propagano)
        try {
          const settings = await window.sheetsAPI.getSettings();
          if (settings && typeof settings === "object") {
            // scheda/dieta: sovrascrivi sempre se il cloud ha un valore
            ["schedaData", "dietaData"].forEach(k => {
              if (settings[k]) st.set(k, settings[k]);
            });
            // groqApiKey: sovrascrivi solo se locale è vuoto (evita di perdere chiavi)
            if (!st.get("groqApiKey", "") && settings.groqApiKey)
              st.set("groqApiKey", settings.groqApiKey);
          }
        } catch (_) {}
      })(),
      new Promise(resolve => setTimeout(resolve, 2500)), // timeout 2.5s
    ]);
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
      screen:      initialScreen || (st.get("onboardingDone", false) ? "dashboard" : "onboarding"),
      scheda:      "Upper A",
      isHome:      false,
      activities:  st.get("activities", []),
      checkIn:     st.get(`checkIn_${today}`, { sleep: 4, energy: 4, ailments: "" }),
      hydration:   st.get(`hydration_${today}`, 3),
      weekNum:     st.get("weekNum", 1),
      bodyWeight:  st.get("bodyWeight", 100),
      theme:       st.get("theme", "dark"),
    };
  }

  const [state, setStateRaw] = React.useState({ screen: initialScreen, scheda: "Upper A", isHome: false, activities: [], checkIn: { sleep: 4, energy: 4, ailments: "" }, hydration: 3, weekNum: 1, bodyWeight: 100, theme: "dark" });
  const [lang, setLang] = React.useState(window.storage ? window.storage.get("lang", "it") : "it");
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (!storageReady || initialized) return;
    _cloudSync().finally(() => {
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
      if (next.weekNum    !== prev.weekNum)     window.storage.set("weekNum", next.weekNum);
      if (next.bodyWeight !== prev.bodyWeight)  window.storage.set("bodyWeight", next.bodyWeight);
      if (next.theme      !== prev.theme)       { window.storage.set("theme", next.theme); _applyTheme(next.theme); }
      return next;
    });
  }, [today]);

  // Apply theme on mount + when theme changes
  React.useEffect(() => { _applyTheme(state.theme); }, [state.theme]);

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
