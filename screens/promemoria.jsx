// screens/promemoria.jsx — impostazioni notifiche push
// PromemoriaOverrides: stub temporaneo, sostituito nel Task 9.
const _DT_LABELS = { riposo:"Riposo", mattina:"Mattina", ore17:"Ore 17", ore21:"Ore 21", ore22:"Ore 22" };
const _WD_ORDER = [["mon","Lun"],["tue","Mar"],["wed","Mer"],["thu","Gio"],["fri","Ven"],["sat","Sab"],["sun","Dom"]];

const PromemoriaEditor = ({ config, persist, selDay, setSelDay, t }) => {
  const setWeekly = (wd, dt) => persist({ ...config, weekly: { ...config.weekly, [wd]: dt } });

  const setReminder = (idx, patch) => {
    const list = (config.daytypes[selDay] || []).map((r, i) => i === idx ? { ...r, ...patch } : r);
    persist({ ...config, daytypes: { ...config.daytypes, [selDay]: list } });
  };

  const list = config.daytypes[selDay] || [];
  const catLabel = { pasto: t("Pasti"), integratore: t("Integratori"), allenamento: t("Allenamento") };

  return (
    <div className="card" style={{ padding:16, display:"flex", flexDirection:"column", gap:14 }}>
      {/* Baseline settimanale */}
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", textTransform:"uppercase", marginBottom:8 }}>{t("Orari per giorno")}</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {_WD_ORDER.map(([wd, lbl]) => (
            <div key={wd} style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:44, fontSize:13, fontWeight:600 }}>{lbl}</div>
              <select value={config.weekly[wd] || "riposo"} onChange={e => setWeekly(wd, e.target.value)}
                style={{ flex:1, padding:"7px 10px", borderRadius:9, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }}>
                {Object.keys(_DT_LABELS).map(dt => <option key={dt} value={dt}>{t(_DT_LABELS[dt])}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Selettore tipo giornata da editare */}
      <div className="hscroll" style={{ marginLeft:0, marginRight:0 }}>
        {Object.keys(_DT_LABELS).map(dt => {
          const on = selDay === dt;
          return (
            <button key={dt} onClick={() => setSelDay(dt)} style={{
              padding:"7px 12px", border:0, borderRadius:999, marginRight:4, whiteSpace:"nowrap",
              background: on ? "var(--accent)" : "var(--card-2)", color: on ? "#fff" : "var(--text)",
              fontSize:12.5, fontWeight: on ? 600 : 500, cursor:"pointer",
            }}>{t(_DT_LABELS[dt])}</button>
          );
        })}
      </div>

      {/* Reminder del tipo giornata selezionato */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {list.map((r, i) => (
          <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderTop: i>0 ? "1px solid var(--border)" : "0" }}>
            <span style={{ fontSize:15 }}>{r.cat === "pasto" ? "🍽️" : r.cat === "integratore" ? "💊" : "🏋️"}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.label}</div>
              <div className="muted" style={{ fontSize:11 }}>{catLabel[r.cat]}</div>
            </div>
            <input type="time" value={r.time} onChange={e => setReminder(i, { time: e.target.value })}
              style={{ padding:"5px 8px", borderRadius:8, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }} />
            <div className={`ios-toggle blue ${r.on ? "on" : ""}`} onClick={() => setReminder(i, { on: !r.on })} />
          </div>
        ))}
        {!list.length && <div className="muted" style={{ fontSize:12 }}>—</div>}
      </div>
    </div>
  );
};
// Helper: YYYY-MM-DD locale + weekday key da una Date
function _ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const _WD_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
const _TRAINING = ["mattina","ore17","ore21","ore22"];

const PromemoriaOverrides = ({ config, persist, t }) => {
  const [pick, setPick] = React.useState(() => _ymd(new Date()));

  // daytype effettivo di una data (override → weekly)
  const daytypeOf = (ymd) => {
    if (config.overrides && config.overrides[ymd]) return config.overrides[ymd];
    const wd = _WD_KEYS[new Date(ymd + "T12:00:00").getDay()];
    return (config.weekly && config.weekly[wd]) || "riposo";
  };

  const move = (dir) => {
    const src = pick;
    const srcType = daytypeOf(src);
    if (!_TRAINING.includes(srcType)) return; // niente da spostare se è riposo
    const d = new Date(src + "T12:00:00");
    d.setDate(d.getDate() + (dir === "after" ? 1 : -1));
    const dst = _ymd(d);
    persist({ ...config, overrides: { ...config.overrides, [src]: "riposo", [dst]: srcType } });
  };

  const clearOverride = (ymd) => {
    const next = { ...config.overrides }; delete next[ymd];
    persist({ ...config, overrides: next });
  };

  const todayYmd = _ymd(new Date());
  const active = Object.keys(config.overrides || {}).filter(k => k >= todayYmd).sort();

  return (
    <div className="card" style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", textTransform:"uppercase" }}>{t("Sposta allenamento")}</div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <input type="date" value={pick} min={todayYmd} onChange={e => setPick(e.target.value)}
          style={{ flex:1, padding:"7px 10px", borderRadius:9, background:"var(--card-2)", color:"var(--text)", border:"1px solid var(--border)", fontSize:13 }} />
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => move("before")} style={{ flex:1, border:0, borderRadius:10, padding:"10px", background:"var(--card-2)", color:"var(--text)", fontSize:13, fontWeight:600, cursor:"pointer" }}>← {t("Giorno prima")}</button>
        <button onClick={() => move("after")} style={{ flex:1, border:0, borderRadius:10, padding:"10px", background:"var(--card-2)", color:"var(--text)", fontSize:13, fontWeight:600, cursor:"pointer" }}>{t("Giorno dopo")} →</button>
      </div>
      {active.length > 0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {active.map(k => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5 }}>
              <span className="num" style={{ flex:1 }}>{k} → {t(_DT_LABELS[config.overrides[k]] || config.overrides[k])}</span>
              <button onClick={() => clearOverride(k)} style={{ border:0, background:"transparent", color:"var(--danger)", fontSize:12, cursor:"pointer" }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Promemoria = ({ device, onNav }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [config, setConfig] = React.useState(() => {
    const saved = window.storage ? window.storage.get("notifConfig", null) : null;
    return saved || (window.buildDefaultNotifConfig ? window.buildDefaultNotifConfig() : { weekly:{}, daytypes:{}, overrides:{} });
  });
  const [enabled, setEnabled] = React.useState(() => window.storage ? window.storage.get("notifEnabled", false) : false);
  const [status, setStatus] = React.useState("");   // messaggio diagnostico
  const [selDay, setSelDay] = React.useState("ore17");

  const persist = (next) => {
    setConfig(next);
    if (window.storage) window.storage.set("notifConfig", next);
    if (window.pushAPI) window.pushAPI.syncConfig(next);
  };

  const onToggleMaster = async () => {
    if (!window.pushAPI) return;
    if (enabled) {
      try { await window.pushAPI.disable(); }
      catch (e) { setStatus(t("Errore attivazione notifiche")); return; }
      setEnabled(false); setStatus("");
      return;
    }
    let res;
    try { res = await window.pushAPI.enable(config); }
    catch (e) { setStatus(t("Errore attivazione notifiche")); return; }
    if (res.ok) { setEnabled(true); setStatus(t("Notifiche attive")); }
    else {
      const map = {
        "unsupported": t("Notifiche non supportate su questo dispositivo"),
        "not-installed": t("Le notifiche richiedono l'app installata sulla Home"),
        "not-configured": t("Configurazione push mancante"),
        "denied": t("Permesso negato — riattiva da Impostazioni iOS"),
        "subscribe-failed": t("Errore attivazione notifiche"),
        "save-failed": t("Errore attivazione notifiche"),
      };
      setStatus(map[res.error] || ("Errore: " + res.error));
    }
  };

  const regen = () => { if (window.buildDefaultNotifConfig) persist(window.buildDefaultNotifConfig()); };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", letterSpacing:0.5, textTransform:"uppercase" }}>{t("Impostazioni")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight:600 }}>{t("Promemoria")}</h1>
      </div>

      {/* Master toggle */}
      <div className="card" style={{ padding:16, display:"flex", alignItems:"center", gap:12 }}>
        <Icon name="pill" size={20} color="var(--accent)" />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{t("Attiva notifiche")}</div>
          {status && <div className="muted" style={{ fontSize:12, marginTop:2 }}>{status}</div>}
        </div>
        <div className={`ios-toggle blue ${enabled ? "on" : ""}`} onClick={onToggleMaster} />
      </div>

      {/* placeholder: editor per giorno (Task 8) e sposta allenamento (Task 9) montati qui */}
      <PromemoriaEditor config={config} persist={persist} selDay={selDay} setSelDay={setSelDay} t={t} />
      <PromemoriaOverrides config={config} persist={persist} t={t} />

      <button onClick={regen} style={{ border:"1px solid var(--border)", background:"var(--card)", color:"var(--text)", borderRadius:14, padding:13, fontSize:14, fontWeight:600, cursor:"pointer" }}>
        {t("Rigenera orari dal piano")}
      </button>
    </div>
  );
};
window.Promemoria = Promemoria;
