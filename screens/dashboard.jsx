// dashboard.jsx — Home (Redesign Fase 2 2026-07)
// 4 blocchi spec in cima (Hero Oggi · Prossimo pasto · Check-in · StatTile Peso)
// + card secondarie retained sotto (Idratazione · Movimento · Muscoli settimana).

// ── Helpers ────────────────────────────────────────────────────────────────
// Chiave giornaliera in ora LOCALE (toISOString è UTC: tra mezzanotte e le 2
// di notte italiane produrrebbe la data del giorno prima → dot/gym sbagliati)
const _dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const ACTIVITY_META = {
  corsa:     { label: "Corsa",     emoji: "🏃", c: "#FF453A" },
  bike:      { label: "Bike",      emoji: "🚴", c: "#FF9F0A" },
  hiit:      { label: "HIIT",      emoji: "⚡", c: "#BF5AF2" },
  camminata: { label: "Camminata", emoji: "🚶", c: "#30D158" },
  ellittica: { label: "Ellittica", emoji: "🔄", c: "#5AC8FA" },
};

// Prossimo pasto dai dati dieta reali (nessun dato inventato: null se manca dieta).
// Variante giorno: se oggi c'è sessione → "ore17" (default della schermata Dieta), altrimenti "riposo".
function _homeDieta() {
  if (!window.parseDieta || !window.storage) return null;
  const text = window.storage.get("dietaData", null);
  if (!text) return null;
  try { return window.parseDieta(text); } catch (_) { return null; }
}
function _nextMealHome() {
  const dieta = _homeDieta();
  if (!dieta) return null;
  const sess = window.getTodaySession ? window.getTodaySession() : null;
  const section = (sess ? dieta.ore17 : dieta.riposo) || dieta.riposo;
  if (!section || !section.meals || !section.meals.length) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm) => { const [h, m] = (hhmm || "00:00").split(":").map(Number); return h * 60 + (m || 0); };
  const meals = section.meals.slice().sort((a, b) => toMins(a.time) - toMins(b.time));
  const upcoming = meals.find(ml => toMins(ml.time) >= nowMins);
  let current = null;
  for (const ml of meals) { if (toMins(ml.time) <= nowMins && nowMins - toMins(ml.time) <= 90) current = ml; }
  const pick = current || upcoming || meals[0];
  const first = (pick.primary && pick.primary[0]) ? pick.primary[0].food : "";
  return { title: pick.title, time: pick.time, food: first, upcoming: !current };
}

// ── Mini sparkline chart ───────────────────────────────────────────────────
const Sparkline = ({ data, width = 160, height = 56, color = "var(--accent)" }) => {
  if (!data || data.length < 2) return null;
  const vals = data.map(d => d.weight);
  const min   = Math.min(...vals) - 0.2;
  const max   = Math.max(...vals) + 0.2;
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.weight - min) / range) * (height - 6) - 3;
    return [x, y];
  });
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block", width: "100%" }} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-grad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-grad2)" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

// ── Check-in: scala 1..5 (bersagli ≥ 44pt, attivo = gradiente di marca) ──────
const CheckScale = ({ label, value, onChange }) => (
  <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      <span className="tnum" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)" }}>{value || "—"}/5</span>
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => {
        const on = value >= n;
        return (
          <button key={n} onClick={() => onChange(n)} aria-label={`${label} ${n}`} style={{
            flex: 1, minHeight: 44, border: 0, borderRadius: 10, cursor: "pointer",
            background: on ? "var(--brand-grad)" : "var(--card-2)",
            color: on ? "#fff" : "var(--text-3)", fontSize: 13, fontWeight: 600,
            transition: "background 0.15s",
          }}>{n}</button>
        );
      })}
    </div>
  </div>
);

// ── Movimento / Cardio log (retained) ──────────────────────────────────────
const MovimentoCard = ({ activities, addActivity, isDesktop }) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const totalMin = activities.reduce((s, a) => s + (a.min || 0), 0);
  const totalKm  = activities.reduce((s, a) => s + (a.km  || 0), 0);
  const recent   = activities.slice(0, 3);

  return (
    <div className="ui-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span className="ui-cap">{t("Movimento")}</span>
        <button onClick={() => setOpen(true)} style={{
          background: "var(--card-2)", border: "1px solid var(--border)", cursor: "pointer",
          color: "var(--text)", fontSize: 12, fontWeight: 600,
          padding: "0 12px", minHeight: 44, borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Icon name="plus" size={12} strokeWidth={2.4} /> {t("Log")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: recent.length ? 12 : 0 }}>
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{totalMin}<span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}> min</span></div>
          <div className="ui-cap">{t("questa sett")}</div>
        </div>
        <div style={{ width: 1, background: "var(--border)" }} />
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{totalKm.toFixed(1)}<span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}> km</span></div>
          <div className="ui-cap">{t("percorsi")}</div>
        </div>
        <div style={{ width: 1, background: "var(--border)" }} />
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{activities.length}</div>
          <div className="ui-cap">{t("sessioni")}</div>
        </div>
      </div>

      {recent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {recent.map(a => {
            const meta = ACTIVITY_META[a.type] || ACTIVITY_META.corsa;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{meta.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t(meta.label)}{a.note ? <span style={{ color: "var(--text-2)", fontWeight: 500, fontSize: 11.5 }}> · {a.note}</span> : null}</div>
                  <div style={{ color: "var(--text-2)", fontSize: 11, marginTop: 1 }}>{t(a.when)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>{a.min}<span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 500 }}>min</span></div>
                  {a.km > 0 && <div className="tnum" style={{ fontSize: 11, color: "var(--text-2)", marginTop: 1 }}>{a.km.toFixed(1)} km</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <ActivityLogger isDesktop={isDesktop} onClose={() => setOpen(false)} onSave={(a) => {
          addActivity && addActivity(a);
          if (window.sheetsAPI) {
            const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
            window.sheetsAPI.saveMovimento({ date: today, type: a.type, min: a.min, km: a.km || 0, note: a.note || "" }).catch(() => {});
          }
          setOpen(false);
        }} />
      )}
    </div>
  );
};

// ── Activity logger modal (retained) ───────────────────────────────────────
const ActivityLogger = ({ onClose, onSave, isDesktop }) => {
  const t = useT();
  const [type, setType] = React.useState("corsa");
  const [min,  setMin]  = React.useState(30);
  const [km,   setKm]   = React.useState("");
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div onClick={onClose} className="ui-sheet-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="ui-sheet" style={{ maxWidth: isDesktop ? 440 : 560 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>{t("Logga attività")}</span>
          <button onClick={onClose} aria-label="Chiudi" style={{ minWidth: 44, minHeight: 44, borderRadius: 999, background: "transparent", border: 0, color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="ui-cap" style={{ marginBottom: 8 }}>{t("Tipo")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {Object.entries(ACTIVITY_META).map(([k, m]) => {
              const on = type === k;
              return (
                <button key={k} onClick={() => setType(k)} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 14px", border: on ? 0 : "1px solid var(--border)", background: on ? "var(--brand-grad)" : "var(--card-2)", borderRadius: 12, cursor: "pointer" }}>
                  <span style={{ fontSize: 18 }}>{m.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: on ? "#fff" : "var(--text)" }}>{t(m.label)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div className="ui-cap">{t("Durata")}</div>
            <div className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>{min}<span style={{ color: "var(--text-2)", fontWeight: 500 }}> min</span></div>
          </div>
          <input type="range" min="5" max="120" step="5" value={min} onChange={(e) => setMin(parseInt(e.target.value))} style={{ width: "100%" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 10, marginBottom: 16 }}>
          <div>
            <div className="ui-cap" style={{ marginBottom: 8 }}>{t("Distanza")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--card-2)", borderRadius: 11, padding: "10px 12px", border: "1px solid var(--border)" }}>
              <input inputMode="decimal" placeholder={t("opz.")} value={km} onChange={(e) => setKm(e.target.value.replace(/[^0-9.,]/g, "").replace(",", "."))} style={{ flex: 1, background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 14, fontWeight: 600, minWidth: 0, width: "100%" }} />
              <span style={{ color: "var(--text-2)", fontSize: 12 }}>km</span>
            </div>
          </div>
          <div>
            <div className="ui-cap" style={{ marginBottom: 8 }}>{t("Note")}</div>
            <input placeholder={t("Z2, BPM 145, sensazione…")} value={note} onChange={(e) => setNote(e.target.value)} className="input" style={{ background: "var(--card-2)", padding: "10px 12px", fontSize: 13 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <UIButton variant="quiet" style={{ flex: 1 }} onClick={onClose}>{t("Annulla")}</UIButton>
          <UIButton style={{ flex: 2 }} onClick={() => onSave({ type, min, km: parseFloat(km) || 0, note })}>{t("Salva sessione")}</UIButton>
        </div>
      </div>
    </div>
  );
};

// ── Report settimanale (visibile domenica e lunedì, dismissabile a settimana) ─
const WeeklyReportCard = ({ onNav }) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : _dayKey(new Date());
  const dow = new Date().getDay();               // 0 = domenica, 1 = lunedì
  const show = dow === 0 || dow === 1;
  // La settimana è identificata dalla sua domenica → il dismiss vale per
  // domenica E lunedì della stessa finestra, poi la card torna la settimana dopo.
  const weekKey = (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return _dayKey(d); })();
  const [dismissed, setDismissed] = React.useState(
    () => (window.storage ? window.storage.get("weeklyReportDismissed", "") : "")
  );

  const rep = React.useMemo(() => {
    if (!show || !window.Insights || !window.storage) return null;
    const st = window.storage;
    const gymFlags = {}, muscleHist = [], checkinDates = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = _dayKey(d);
      if (st.get(`gym_${k}`, false)) gymFlags[k] = true;
      const ms = st.get(`muscleSets_${k}`, null);
      if (ms && Object.keys(ms).length) muscleHist.push({ date: k, muscleSets: ms });
      if (st.get(`checkIn_${k}`, null)) checkinDates.push(k);
    }
    return window.Insights.weeklyReport({
      today,
      weightLog: st.get("weightLog", []),
      gymFlags, muscleHist,
      prMap: st.get("prMap", {}),
      checkinDates,
      plannedSessions: (window.getSchedule ? (window.getSchedule().days || []).length : 3) || 3,
    });
  }, [show, today]);

  if (!show || !rep || dismissed === weekKey) return null;
  if (!rep.sessions && !rep.totalSets && rep.avgWeight == null) return null; // niente da raccontare

  const dismiss = () => {
    setDismissed(weekKey);
    if (window.storage) window.storage.set("weeklyReportDismissed", weekKey);
  };

  return (
    <UICard>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span className="ui-cap">📅 {t("La tua settimana")}</span>
        <button onClick={dismiss} aria-label={t("Ignora")} style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: 999, background: "transparent", border: 0, color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="x" size={13} strokeWidth={2.4} />
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: rep.prs.length || rep.order.length ? 12 : 0 }}>
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{rep.sessions}<span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>/{rep.planned}</span></div>
          <div className="ui-cap">{t("sessioni")}</div>
        </div>
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700 }}>{rep.totalSets}</div>
          <div className="ui-cap">{t("serie")}</div>
        </div>
        <div>
          <div className="tnum" style={{ fontSize: 20, fontWeight: 700, color: rep.weightDelta == null ? "var(--text)" : rep.weightDelta <= 0 ? "var(--success)" : "#FF9F0A" }}>
            {rep.weightDelta == null ? "—" : `${rep.weightDelta > 0 ? "+" : ""}${rep.weightDelta}`}
          </div>
          <div className="ui-cap">{t("kg vs prec.")}</div>
        </div>
      </div>
      {rep.prs.length > 0 && (
        <div className="tnum" style={{ fontSize: 12.5, color: "var(--success)", fontWeight: 600, marginBottom: rep.order.length ? 8 : 0 }}>
          🏆 {rep.prs.length} {rep.prs.length === 1 ? t("record battuto") : t("record battuti")}: {rep.prs.slice(0, 2).map(p => `${p.esercizio} ${p.peso}kg`).join(" · ")}
        </div>
      )}
      {rep.order.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-2)" }}>
          {t("Volume")}: {rep.order.slice(0, 3).map(g => `${t(g)} ${rep.byGroup[g]}`).join(" · ")}
        </div>
      )}
    </UICard>
  );
};

// ── Main Dashboard ─────────────────────────────────────────────────────────
const Dashboard = ({ device, onNav, activities, addActivity, checkIn, setCheckIn, bodyWeight, setBodyWeight }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const { lang } = useLang();

  const now     = new Date();
  const dateStr = now.toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { weekday: "long", day: "numeric", month: "long" });
  const _h = now.getHours();
  const greetKey = _h < 13 ? "Buongiorno Lorenzo" : _h < 18 ? "Buon pomeriggio Lorenzo" : "Buonasera Lorenzo";

  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [restDay, setRestDay] = React.useState(() => window.storage ? window.storage.get("restDay_" + today, false) : false);
  const toggleRest = () => {
    const next = !restDay;
    if (window.storage) window.storage.set("restDay_" + today, next);
    setRestDay(next);
  };
  const daysCount = (window.getSchedule ? (window.getSchedule().days || []).length : 0) || 3;
  const _rawSession = window.getTodaySession ? window.getTodaySession() : null;
  const todaySession = restDay ? null : _rawSession;

  // Peso
  const [weightLog, setWeightLog] = React.useState(() => window.storage ? window.storage.get("weightLog", []) : []);
  const sparkData    = weightLog.slice(-14);
  const latestWeight = sparkData[sparkData.length - 1]?.weight || bodyWeight;
  const weightDelta  = sparkData.length >= 2 ? (sparkData[sparkData.length - 1].weight - sparkData[0].weight) : 0;
  const [newWeight, setNewWeight] = React.useState("");
  const saveWeight = () => {
    const val = parseFloat(newWeight);
    if (isNaN(val) || val <= 0) return;
    setBodyWeight(val);
    const log   = window.storage ? window.storage.get("weightLog", []) : [];
    const idx   = log.findIndex(e => e.date === today);
    if (idx >= 0) log[idx] = { date: today, weight: val };
    else          log.push({ date: today, weight: val });
    const trimmed = log.slice(-90);
    if (window.storage) window.storage.set("weightLog", trimmed);
    setWeightLog(trimmed);
    if (window.sheetsAPI) window.sheetsAPI.savePesoCorporeo({ date: today, weight: val }).catch(() => {});
    setNewWeight("");
  };

  // Riepilogo settimana (retained): sessioni + muscoli reali dagli ultimi 7 giorni
  const weekGymDays = React.useMemo(() => {
    if (!window.storage) return 0;
    let count = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); if (window.storage.get(`gym_${_dayKey(d)}`, false)) count++; }
    return count;
  }, [today]);
  const weekMuscles = React.useMemo(() => {
    if (!window.storage) return {};
    const agg = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = window.storage.get(`muscleSets_${_dayKey(d)}`, null);
      if (day) Object.keys(day).forEach(g => { agg[g] = (agg[g] || 0) + (day[g] || 0); });
    }
    return agg;
  }, [today]);
  const hasWeekMuscles = Object.keys(weekMuscles).length > 0;

  const nextMeal = React.useMemo(() => _nextMealHome(), [today, restDay]);

  const [ailOpen, setAilOpen]   = React.useState(!!(checkIn && checkIn.ailments));
  const [pesoOpen, setPesoOpen] = React.useState(false);

  const startWorkout = () => { window._schedaIntent = "player"; onNav("scheda"); };

  // ── Nudge in-app (NON push OS): un solo suggerimento contestuale, dismissabile ──
  const [nudgeDismissed, setNudgeDismissed] = React.useState(
    () => (window.storage ? window.storage.get(`nudgeDismissed_${today}`, []) : [])
  );
  const nudge = window.WorkoutProgress ? window.WorkoutProgress.nextNudge({
    isWorkoutDay: !!todaySession,
    gymDone: window.storage ? !!window.storage.get(`gym_${today}`, false) : false,
    checkInDone: window.storage ? window.storage.get(`checkIn_${today}`, null) != null : false,
    hydration: window.storage ? Number(window.storage.get(`hydration_${today}`, 0)) : 0,
    hydrationTarget: 8,
    hour: new Date().getHours(),
    dismissed: nudgeDismissed,
  }) : null;
  const dismissNudge = (id) => {
    const nextD = nudgeDismissed.concat([id]);
    setNudgeDismissed(nextD);
    if (window.storage) window.storage.set(`nudgeDismissed_${today}`, nextD);
  };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "28px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 640, margin: "0 auto", width: "100%" }}>

      {/* Header compatto */}
      <UIHeader
        eyebrow={dateStr}
        title={t(greetKey)}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {window.SyncBadge ? <SyncBadge /> : null}
            <UIAvatarLF onClick={() => onNav("impostazioni")} />
          </div>
        }
      />

      {/* Nudge contestuale (idratazione / check-in / allenamento) */}
      {nudge && (
        <div className="fade-up" style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(10,132,255,0.12)", border: "1px solid rgba(10,132,255,0.25)",
          borderRadius: 14, padding: "11px 12px 11px 14px",
        }}>
          <span style={{ fontSize: 17 }}>{nudge.kind === "workout" ? "🏋️" : nudge.kind === "checkin" ? "🌙" : "💧"}</span>
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>{t(nudge.text)}</div>
          {nudge.kind === "workout" && (
            <button onClick={startWorkout} style={{ flexShrink: 0, background: "var(--accent)", color: "#fff", border: 0, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {t("Inizia")}
            </button>
          )}
          <button onClick={() => dismissNudge(nudge.id)} aria-label={t("Ignora")} style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, background: "transparent", border: 0, color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={13} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Hero "Oggi" */}
      <UICard hero>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="ui-cap">{t("Oggi")}</div>
          <button
            onClick={toggleRest}
            style={{ background: restDay ? "var(--accent)" : "transparent", color: restDay ? "#fff" : "var(--text-2)", border: "1px solid var(--border)", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 32 }}
          >
            {t("Oggi riposo")}
          </button>
        </div>
        <div style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.05, margin: "3px 0 12px" }}>
          {todaySession ? todaySession.label : t("Giorno di riposo")}
        </div>
        {todaySession ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {todaySession.muscles.map(m => <UIChip key={m}>{t(m)}</UIChip>)}
            </div>
            <UIButton onClick={startWorkout}>
              <Icon name="dumbbell" size={17} strokeWidth={1.9} /> {t("Inizia allenamento")}
            </UIButton>
          </>
        ) : (
          <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.45 }}>
            {t("Recupero attivo, mobilità e idratazione.")}
          </div>
        )}
      </UICard>

      {/* Report settimanale (solo domenica/lunedì, dati reali della settimana) */}
      <WeeklyReportCard onNav={onNav} />

      {/* Prossimo pasto */}
      {nextMeal ? (
        <UICard onClick={() => onNav("dieta")}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)" }}>
              <Icon name="fork" size={17} strokeWidth={1.8} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ui-cap" style={{ marginBottom: 2 }}>{nextMeal.upcoming ? t("Prossimo pasto") : t("Adesso")}</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{nextMeal.title}</div>
              {nextMeal.food ? <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nextMeal.food}</div> : null}
            </div>
            <span className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>{nextMeal.time}</span>
            <span style={{ color: "var(--text-3)", fontSize: 16, fontWeight: 600, marginLeft: 4 }}>›</span>
          </div>
        </UICard>
      ) : null}

      {/* Check-in compresso */}
      <UICard>
        <div className="ui-cap" style={{ marginBottom: 12 }}>{t("Check-in")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CheckScale label={t("Sonno")}   value={checkIn.sleep}  onChange={(v) => setCheckIn({ ...checkIn, sleep: v })} />
          <CheckScale label={t("Energia")} value={checkIn.energy} onChange={(v) => setCheckIn({ ...checkIn, energy: v })} />
        </div>
        <div style={{ marginTop: 12 }}>
          {ailOpen ? (
            <input
              placeholder={t("es. spalla destra, ginocchio sinistro…")}
              value={checkIn.ailments}
              onChange={(e) => setCheckIn({ ...checkIn, ailments: e.target.value })}
              className="input"
              style={{ background: "var(--card-2)", padding: "10px 12px", fontSize: 13, width: "100%" }}
            />
          ) : (
            <button onClick={() => setAilOpen(true)} style={{ background: "transparent", border: 0, color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44, padding: 0 }}>
              <Icon name="plus" size={13} strokeWidth={2.2} /> {t("Fastidi")}
            </button>
          )}
        </div>
      </UICard>

      {/* StatTile: Peso */}
      <div style={{ display: "flex", gap: 12 }}>
        <UIStatTile cap={t("Peso")} value={<UIAnimatedNumber value={latestWeight} decimals={1} />} unit="kg" onClick={() => setPesoOpen(true)}>
          {sparkData.length >= 2
            ? <div style={{ marginTop: 8 }}><Sparkline data={sparkData} width={140} height={40} color="var(--accent)" /></div>
            : <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)" }}>{t("Registra il peso per almeno 2 giorni per vedere il trend.")}</div>}
        </UIStatTile>
      </div>

      {/* Secondarie */}
      <MovimentoCard activities={activities} addActivity={addActivity} isDesktop={isDesktop} />

      {/* Riepilogo muscoli settimana (retained) */}
      <div className="ui-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span className="ui-cap">{t("Settimana")}</span>
          <span className="tnum" style={{ fontSize: 12, color: "var(--text-2)" }}>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{weekGymDays}</span> / {daysCount} {t("sessioni")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Anatomy active={["petto", "spalle", "bicipiti", "quadricipiti", "schiena", "femorali"]} height={isDesktop ? 200 : 160} color="var(--accent)" />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            {hasWeekMuscles ? [
              { k: "Petto" }, { k: "Schiena" }, { k: "Gambe" }, { k: "Spalle" }, { k: "Braccia" }, { k: "Core" },
            ].filter(m => weekMuscles[m.k] > 0).map(m => (
              <div key={m.k}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                  <span style={{ color: "var(--text-2)" }}>{t(m.k)}</span>
                  <span className="tnum" style={{ fontWeight: 700 }}>{weekMuscles[m.k]}</span>
                </div>
                <UIProgress value={Math.min(1, weekMuscles[m.k] / 16)} />
              </div>
            )) : (
              <div style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.45 }}>
                {t("Nessuna serie registrata questa settimana")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sheet: log peso rapido */}
      <UISheet open={pesoOpen} onClose={() => setPesoOpen(false)} title={t("Aggiorna peso")}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="number" inputMode="decimal" placeholder={t("Aggiorna…")}
            value={newWeight} onChange={(e) => setNewWeight(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { saveWeight(); setPesoOpen(false); } }}
            className="input input-mono" style={{ flex: 1, padding: "12px 14px", fontSize: 16 }}
          />
          <UIButton style={{ width: "auto", padding: "0 22px" }} onClick={() => { saveWeight(); setPesoOpen(false); }}>{t("Salva")}</UIButton>
        </div>
        {weightDelta !== 0 ? (
          <div className="tnum" style={{ marginTop: 10, fontSize: 12, color: "var(--text-2)" }}>
            {weightDelta > 0 ? "+" : ""}{weightDelta.toFixed(1)} kg {t("negli ultimi 14 giorni")}
          </div>
        ) : null}
      </UISheet>
    </div>
  );
};

window.Dashboard = Dashboard;
