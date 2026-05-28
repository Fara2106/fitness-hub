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

async function _cloudSync(opts) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const { pesiMs = 8000, settingsMs = 15000 } = opts || {};

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
    let cloudKeys = {};
    if (settingsRes.ok && settingsRes.value && typeof settingsRes.value === "object") {
      const s = settingsRes.value;
      cloudKeys = s;
      ["schedaData", "dietaData"].forEach(k => {
        if (s[k]) { st.set(k, s[k]); console.log("[sync pull]", k, "✓"); }
      });
      if (s.spesaChecked) {
        try { st.set("spesaChecked", JSON.parse(s.spesaChecked)); console.log("[sync pull] spesaChecked ✓"); } catch(_) {}
      }
      if (s.spesaFreq)  st.set("spesaFreq", Number(s.spesaFreq) || 1);
      // groqApiKey: cloud wins sempre
      if (s.groqApiKey) { st.set("groqApiKey", s.groqApiKey); console.log("[sync pull] groqApiKey ✓"); }
      if (s.weekNum)    st.set("weekNum", Number(s.weekNum) || 1);
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
      if (cloudKeys.onboardingDone !== "true") {
        window.sheetsAPI.saveSettings({ key: "onboardingDone", value: "true" }).catch(() => {});
      }
      console.log("[sync] onboardingDone → true");
    }

    // 4. Push locale → cloud per chiavi mancanti nel cloud
    //    Questo risolve il caso in cui dati esistono localmente ma non sono
    //    mai stati pushati (codice precedente, errore silenzioso, ecc.)
    _cloudPushMissing(cloudKeys);

  } catch (e) { console.warn("[sync] error:", e); }
}

// ── Cloud push: pusha al cloud tutto ciò che manca ────────────────────────
function _cloudPushMissing(cloudKeys) {
  if (!window.sheetsAPI || !window.storage) return;
  const st = window.storage;
  const save = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      console.log("[sync push]", key, "→ cloud");
      window.sheetsAPI.saveSettings({ key, value: String(value) }).catch(e => console.warn("[sync push err]", key, e));
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
  if (sc && Object.keys(sc).length > 0 && !cloudKeys.spesaChecked) {
    save("spesaChecked", JSON.stringify(sc));
  }
}

// ── Push forzato di TUTTO al cloud (per bottone "Sincronizza ora") ────────
window._cloudPushAll = function() {
  if (!window.sheetsAPI || !window.storage) return Promise.resolve();
  const st = window.storage;
  const saves = [];
  const push = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      saves.push(
        window.sheetsAPI.saveSettings({ key, value: String(value) })
          .then(() => console.log("[push all]", key, "✓"))
          .catch(e => console.warn("[push all err]", key, e))
      );
    }
  };

  // Tutte le chiavi sincronizzabili
  push("groqApiKey",    st.get("groqApiKey", ""));
  push("bodyWeight",    st.get("bodyWeight", ""));
  push("weekNum",       st.get("weekNum", ""));
  push("spesaFreq",     st.get("spesaFreq", ""));
  push("onboardingDone", st.get("onboardingDone", false) ? "true" : "");

  const sc = st.get("spesaChecked", null);
  if (sc && Object.keys(sc).length > 0) push("spesaChecked", JSON.stringify(sc));

  const scheda = st.get("schedaData", null);
  if (scheda) push("schedaData", scheda);

  const dieta = st.get("dietaData", null);
  if (dieta) push("dietaData", dieta);

  return Promise.all(saves);
};

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
      theme:        st.get("theme", "dark"),
      spesaChecked: st.get("spesaChecked", {}),
      spesaFreq:    st.get("spesaFreq", 1),
    };
  }

  const [state, setStateRaw] = React.useState({ screen: initialScreen, scheda: "Upper A", isHome: false, activities: [], checkIn: { sleep: 4, energy: 4, ailments: "" }, hydration: 3, weekNum: 1, bodyWeight: 100, theme: "dark", spesaChecked: {}, spesaFreq: 1 });
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
      if (next.weekNum    !== prev.weekNum) {
        window.storage.set("weekNum", next.weekNum);
        if (window.sheetsAPI) window.sheetsAPI.saveSettings({ key: "weekNum", value: String(next.weekNum) }).catch(() => {});
      }
      if (next.bodyWeight !== prev.bodyWeight) {
        window.storage.set("bodyWeight", next.bodyWeight);
        if (window.sheetsAPI) {
          window.sheetsAPI.saveSettings({ key: "bodyWeight", value: String(next.bodyWeight) }).catch(() => {});
          window.sheetsAPI.savePesoCorporeo({ date: t, weight: next.bodyWeight }).catch(() => {});
        }
      }
      if (next.spesaChecked !== prev.spesaChecked) {
        window.storage.set("spesaChecked", next.spesaChecked);
        if (window.sheetsAPI) window.sheetsAPI.saveSettings({ key: "spesaChecked", value: JSON.stringify(next.spesaChecked) }).catch(() => {});
      }
      if (next.spesaFreq !== prev.spesaFreq) {
        window.storage.set("spesaFreq", next.spesaFreq);
        if (window.sheetsAPI) window.sheetsAPI.saveSettings({ key: "spesaFreq", value: String(next.spesaFreq) }).catch(() => {});
      }
      if (next.theme      !== prev.theme)       { window.storage.set("theme", next.theme); _applyTheme(next.theme); }
      return next;
    });
  }, [today]);

  // Apply theme on mount + when theme changes
  React.useEffect(() => { _applyTheme(state.theme); }, [state.theme]);

  // Re-sync when app comes to foreground (Page Visibility API)
  React.useEffect(() => {
    if (!initialized) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Foreground re-sync: timeout più corti (UI già visibile)
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
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
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
