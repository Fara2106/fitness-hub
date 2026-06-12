// dashboard.jsx — "Buongiorno Lorenzo" home screen — full functional version

// ── Helpers ────────────────────────────────────────────────────────────────
const ACTIVITY_META = {
  corsa:     { label: "Corsa",     emoji: "🏃", c: "#FF453A" },
  bike:      { label: "Bike",      emoji: "🚴", c: "#FF9F0A" },
  hiit:      { label: "HIIT",      emoji: "⚡", c: "#BF5AF2" },
  camminata: { label: "Camminata", emoji: "🚶", c: "#30D158" },
  ellittica: { label: "Ellittica", emoji: "🔄", c: "#5AC8FA" },
};

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
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id="spark-grad2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-grad2)" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => i === points.length - 1 ? (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={color} stroke="var(--card)" strokeWidth="2" />
      ) : null)}
    </svg>
  );
};

const Stat = ({ value, label }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
    <div className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.03 }}>{value}</div>
    <div style={{ fontSize: 11, color: "var(--text-2)", letterSpacing: 0.3, textTransform: "uppercase", fontWeight: 500 }}>{label}</div>
  </div>
);

// ── Check-in ───────────────────────────────────────────────────────────────
const CheckInCard = ({ checkIn, setCheckIn, isDesktop }) => {
  const t = useT();
  const sleepLabel  = ["","💀","😩","😐","🙂","😎"][checkIn.sleep]  || "—";
  const energyLabel = ["","🪫","🔋","⚡","⚡⚡","🔥"][checkIn.energy] || "—";

  return (
    <div className="card lift" style={{ padding: isDesktop ? 22 : 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="wave" size={16} color="var(--accent-2)" />
          <h3>{t("Come stai oggi?")}</h3>
        </div>
        <span className="muted" style={{ fontSize: 11.5 }}>{t("il coach lo legge")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ScaleRow label={t("Sonno")}   icon="moon" color="#5e5ce6" value={checkIn.sleep}  onChange={(v) => setCheckIn({ ...checkIn, sleep: v })}  emoji={sleepLabel}  />
        <ScaleRow label={t("Energia")} icon="bolt" color="#FF9F0A" value={checkIn.energy} onChange={(v) => setCheckIn({ ...checkIn, energy: v })} emoji={energyLabel} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{t("Fastidi")}</span>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("opzionale")}</span>
          </div>
          <input
            placeholder={t("es. spalla destra, ginocchio sinistro…")}
            value={checkIn.ailments}
            onChange={(e) => setCheckIn({ ...checkIn, ailments: e.target.value })}
            className="input"
            style={{ background: "var(--card-2)", padding: "10px 12px", fontSize: 13 }}
          />
        </div>
      </div>
    </div>
  );
};

const ScaleRow = ({ label, icon, color, value, onChange, emoji }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={13} color={color} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{label}</span>
      </div>
      <span style={{ fontSize: 16 }}>{emoji}</span>
    </div>
    <div style={{ display: "flex", gap: 6 }}>
      {[1,2,3,4,5].map(n => {
        const on = value >= n;
        return (
          <button key={n} onClick={() => onChange(n)} style={{
            flex: 1, height: 30, border: 0,
            background: on ? color : "var(--card-2)",
            opacity: on ? (n / value) * 0.7 + 0.3 : 1,
            borderRadius: 8, cursor: "pointer", transition: "all 0.16s",
            fontSize: 11, fontWeight: 600, color: on ? "#fff" : "var(--text-3)",
          }}>{n}</button>
        );
      })}
    </div>
  </div>
);

// ── Hydration card ─────────────────────────────────────────────────────────
const HydrationCard = ({ hydration, setHydration, isDesktop }) => {
  const t = useT();
  const target = 12; // 3L / 0.25L = 12 drops
  return (
    <div className="card lift" style={{ padding: isDesktop ? 18 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>💧</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("Idratazione")}</span>
        </div>
        <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>
          {hydration}<span className="muted" style={{ fontWeight: 500 }}>/{target}</span>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}> · {(hydration * 0.25).toFixed(2)}L</span>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {Array.from({ length: target }).map((_, i) => {
          const filled = i < hydration;
          return (
            <button key={i} onClick={() => setHydration(i < hydration ? i : i + 1)} style={{
              width: `calc(${100/6}% - 4px)`, aspectRatio: "1 / 1.2",
              background: "transparent", border: 0, padding: 0, cursor: "pointer", transition: "transform 0.14s",
            }}>
              <svg viewBox="0 0 24 28" width="100%" height="100%">
                <path d="M12 2 C 6 10, 3 14, 3 19 a 9 9 0 0 0 18 0 c 0 -5 -3 -9 -9 -17 Z"
                  fill={filled ? "#0A84FF" : "transparent"}
                  stroke={filled ? "#0A84FF" : "var(--card-3)"}
                  strokeWidth="1.4"
                  style={{ transition: "fill 0.16s, stroke 0.16s" }}
                />
                {filled && <path d="M8 17 c 0 2 1.5 4 4 4 s 4 -2 4 -4" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" strokeLinecap="round" />}
              </svg>
            </button>
          );
        })}
      </div>
      <div className="bar" style={{ marginTop: 8, height: 4 }}>
        <i style={{ width: `${(hydration / target) * 100}%`, background: "#0A84FF" }} />
      </div>
    </div>
  );
};

// ── Gym attendance card ────────────────────────────────────────────────────
const GymCard = ({ isDesktop }) => {
  const t = useT();
  const { lang } = useLang();
  const locale = lang === "en" ? "en-US" : "it-IT";
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const storageKey = `gym_${today}`;

  const [wentToday, setWentToday] = React.useState(() =>
    window.storage ? window.storage.get(storageKey, false) : false
  );

  // Count week gym days (last 7 days)
  const weekCount = React.useMemo(() => {
    if (!window.storage) return 0;
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = `gym_${d.toISOString().slice(0, 10)}`;
      if (window.storage.get(k, false)) count++;
    }
    return count;
  }, [wentToday]);

  const toggle = () => {
    const next = !wentToday;
    setWentToday(next);
    if (window.storage) window.storage.set(storageKey, next);
    if (navigator.vibrate) navigator.vibrate(next ? [60, 40, 60] : [40]);
  };

  return (
    <div className="card lift" style={{
      padding: isDesktop ? 20 : 16,
      background: wentToday
        ? "linear-gradient(135deg, rgba(10,132,255,0.12), rgba(94,92,230,0.08)), var(--card)"
        : "var(--card)",
      border: wentToday ? "1px solid rgba(10,132,255,0.3)" : "1px solid var(--border)",
      transition: "all 0.22s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14, flexShrink: 0,
          background: wentToday ? "rgba(10,132,255,0.18)" : "var(--card-2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, transition: "background 0.2s",
        }}>
          {wentToday ? "🏋️" : "🏋️"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {wentToday ? t("Oggi sei andato in palestra") : t("Sei andato in palestra oggi?")}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {weekCount > 0
              ? <><span className="num" style={{ color: "var(--accent)", fontWeight: 700 }}>{weekCount}</span> {weekCount === 1 ? t("volta") : t("volte")} {t("questa settimana")}</>
              : t("Nessuna sessione ancora questa settimana")}
          </div>
        </div>
        <div className={`ios-toggle blue ${wentToday ? "on" : ""}`} onClick={toggle} />
      </div>

      {/* Mini week dots */}
      <div style={{ display: "flex", gap: 5, marginTop: 12, justifyContent: "center" }}>
        {(() => {
          const dots = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const k = `gym_${d.toISOString().slice(0, 10)}`;
            const went = window.storage ? window.storage.get(k, false) : false;
            const isToday = i === 0;
            const dayName = d.toLocaleDateString(locale, { weekday: "short" }).slice(0, 2);
            dots.push(
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{
                  width: isToday ? 10 : 8, height: isToday ? 10 : 8, borderRadius: 999,
                  background: went ? "var(--accent)" : "var(--card-3)",
                  border: isToday ? "2px solid var(--accent)" : "none",
                  transition: "background 0.2s",
                }} />
                <span style={{ fontSize: 9, color: isToday ? "var(--accent)" : "var(--text-3)", fontWeight: isToday ? 700 : 400 }}>{dayName}</span>
              </div>
            );
          }
          return dots;
        })()}
      </div>
    </div>
  );
};

// ── Movimento / Cardio log card ────────────────────────────────────────────
const MovimentoCard = ({ activities, addActivity, isDesktop }) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const totalMin = activities.reduce((s, a) => s + (a.min || 0), 0);
  const totalKm  = activities.reduce((s, a) => s + (a.km  || 0), 0);
  const recent   = activities.slice(0, 3);

  return (
    <div className="card lift" style={{ padding: isDesktop ? 22 : 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="flame" size={16} color="#FF9F0A" />
          <h3>{t("Movimento")}</h3>
        </div>
        <button onClick={() => setOpen(true)} style={{
          background: "rgba(10,132,255,0.14)", border: 0, cursor: "pointer",
          color: "var(--accent)", fontSize: 12, fontWeight: 600,
          padding: "5px 10px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Icon name="plus" size={12} strokeWidth={2.4} /> {t("Log")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
        <div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.02 }}>{totalMin}<span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}> min</span></div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", letterSpacing: 0.3, textTransform: "uppercase", fontWeight: 500 }}>{t("questa sett")}</div>
        </div>
        <div style={{ width: 1, background: "var(--border)" }} />
        <div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.02 }}>{totalKm.toFixed(1)}<span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}> km</span></div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", letterSpacing: 0.3, textTransform: "uppercase", fontWeight: 500 }}>{t("percorsi")}</div>
        </div>
        <div style={{ width: 1, background: "var(--border)" }} />
        <div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.02 }}>{activities.length}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-3)", letterSpacing: 0.3, textTransform: "uppercase", fontWeight: 500 }}>{t("sessioni")}</div>
        </div>
      </div>

      {recent.length === 0 ? (
        <div style={{ padding: "14px 12px", background: "var(--card-2)", borderRadius: 11, color: "var(--text-2)", fontSize: 13, textAlign: "center" }}>
          {t("Nessuna attività ancora — tocca Log per aggiungere.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recent.map(a => {
            const meta = ACTIVITY_META[a.type] || ACTIVITY_META.corsa;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: `${meta.c}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{meta.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", gap: 6, alignItems: "baseline" }}>
                    {t(meta.label)}
                    {a.note && <span className="muted" style={{ fontWeight: 500, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {a.note}</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{t(a.when)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>{a.min}<span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 500 }}>min</span></div>
                  {a.km > 0 && <div className="num" style={{ fontSize: 11, color: "var(--text-2)", marginTop: 1 }}>{a.km.toFixed(1)} km</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <ActivityLogger isDesktop={isDesktop} onClose={() => setOpen(false)} onSave={(a) => {
          addActivity && addActivity(a);
          // Save to Google Sheets async (fire-and-forget)
          if (window.sheetsAPI) {
            const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0,10);
            window.sheetsAPI.saveMovimento({ date: today, type: a.type, min: a.min, km: a.km || 0, note: a.note || "" }).catch(() => {});
          }
          setOpen(false);
        }} />
      )}
    </div>
  );
};

// ── Activity logger modal ──────────────────────────────────────────────────
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
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: isDesktop ? "center" : "flex-end", justifyContent: "center", animation: "fadeUp 0.18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="pop-in" style={{ width: isDesktop ? 440 : "100%", maxHeight: "92%", background: "var(--card)", borderRadius: isDesktop ? 18 : "22px 22px 0 0", border: "1px solid var(--border)", padding: 22, display: "flex", flexDirection: "column", gap: 16, overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        {!isDesktop && <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--card-3)", margin: "-8px auto 0" }} />}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: -0.02 }}>{t("Logga attività")}</h2>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 999, background: "var(--card-2)", border: 0, color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="x" size={14} strokeWidth={2.4} />
          </button>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{t("Tipo")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {Object.entries(ACTIVITY_META).map(([k, m]) => {
              const on = type === k;
              return (
                <button key={k} onClick={() => setType(k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: 0, background: on ? `${m.c}22` : "var(--card-2)", borderRadius: 12, cursor: "pointer", boxShadow: on ? `inset 0 0 0 1px ${m.c}` : "none", transition: "all 0.16s" }}>
                  <span style={{ fontSize: 20 }}>{m.emoji}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: on ? m.c : "var(--text)" }}>{t(m.label)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Durata")}</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{min}<span className="muted" style={{ fontWeight: 500 }}> min</span></div>
          </div>
          <input type="range" min="5" max="120" step="5" value={min} onChange={(e) => setMin(parseInt(e.target.value))} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-3)" }}>
            <span>5</span><span>30</span><span>60</span><span>90</span><span>120</span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{t("Distanza")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--card-2)", borderRadius: 11, padding: "10px 12px", border: "1px solid var(--border)" }}>
              <input inputMode="decimal" placeholder={t("opz.")} value={km} onChange={(e) => setKm(e.target.value.replace(/[^0-9.,]/g,"").replace(",","."))} className="input-mono" style={{ flex: 1, background: "transparent", border: 0, outline: "none", color: "var(--text)", fontSize: 14, fontWeight: 600, minWidth: 0, width: "100%" }} />
              <span className="muted" style={{ fontSize: 12 }}>km</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>{t("Note")}</div>
            <input placeholder={t("Z2, BPM 145, sensazione…")} value={note} onChange={(e) => setNote(e.target.value)} className="input" style={{ background: "var(--card-2)", padding: "10px 12px", fontSize: 13 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>{t("Annulla")}</button>
          <button className="btn primary" style={{ flex: 2 }} onClick={() => onSave({ type, min, km: parseFloat(km) || 0, note })}>
            {t("Salva sessione")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Dashboard component ───────────────────────────────────────────────
const Dashboard = ({ device, onNav, activities, addActivity, checkIn, setCheckIn, weekNum, setWeekNum, bodyWeight, setBodyWeight }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const { lang } = useLang();

  // Real current date
  const now       = new Date();
  const dateStr   = now.toLocaleDateString(lang === "en" ? "en-US" : "it-IT", { weekday: "long", day: "numeric", month: "long" });

  // Saluto in base all'ora del giorno
  const _h = now.getHours();
  const greetKey = _h < 13 ? "Buongiorno Lorenzo" : _h < 18 ? "Buon pomeriggio Lorenzo" : "Buonasera Lorenzo";

  // Detect today's session
  const todaySession = window.getTodaySession ? window.getTodaySession() : null;

  // Weight log from storage — useState così la sparkline si aggiorna dopo saveWeight()
  const [weightLog, setWeightLog] = React.useState(() =>
    window.storage ? window.storage.get("weightLog", []) : []
  );
  const sparkData = weightLog.slice(-7).length >= 2
    ? weightLog.slice(-7)
    : [
        { date: "lun", weight: bodyWeight - 0.5 },
        { date: "mar", weight: bodyWeight - 0.3 },
        { date: "mer", weight: bodyWeight - 0.2 },
        { date: "gio", weight: bodyWeight - 0.1 },
        { date: "ven", weight: bodyWeight      },
      ];

  const latestWeight = sparkData[sparkData.length - 1]?.weight || bodyWeight;
  const weightDelta  = sparkData.length >= 2 ? (sparkData[sparkData.length - 1].weight - sparkData[0].weight) : 0;
  const [newWeight, setNewWeight] = React.useState("");

  const saveWeight = () => {
    const val = parseFloat(newWeight);
    if (isNaN(val) || val <= 0) return;
    setBodyWeight(val);
    const log  = window.storage ? window.storage.get("weightLog", []) : [];
    const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
    const idx   = log.findIndex(e => e.date === today);
    if (idx >= 0) log[idx] = { date: today, weight: val };
    else          log.push({ date: today, weight: val });
    const trimmed = log.slice(-90);
    if (window.storage) window.storage.set("weightLog", trimmed);
    setWeightLog(trimmed); // aggiorna sparkline immediatamente
    // Also push to Sheets
    if (window.sheetsAPI) {
      window.sheetsAPI.savePesoCorporeo({ date: today, weight: val }).catch(() => {});
    }
    setNewWeight("");
  };

  // Week progress
  const safeWeek = Math.max(1, Math.min(8, weekNum));
  const isWeek7Plus = safeWeek >= 7;

  // Ring data — calcolati da dati reali
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);

  // Count gym days this week (last 7 days)
  const weekGymDays = React.useMemo(() => {
    if (!window.storage) return 0;
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = `gym_${d.toISOString().slice(0, 10)}`;
      if (window.storage.get(k, false)) count++;
    }
    return count;
  }, [today]);

  // Conteggio sessioni completate questa settimana
  const weekSessions = window.storage ? (window.storage.get("weekSessions", 0)) : 0;

  // Week muscle summary
  const weekMuscles = (window.storage && window.storage.get("weekMuscleSets")) || {
    Petto: 12, Schiena: 14, Gambe: 16, Spalle: 6,
  };

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "12px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 20 : 14 }}>

      {/* Header */}
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: isDesktop ? 4 : 2 }}>
        <div>
          <h1 style={{ fontSize: isDesktop ? 32 : 26, fontWeight: 600 }}>
            {t(greetKey)} <span style={{ display: "inline-block", transformOrigin: "70% 70%" }}>👋</span>
          </h1>
          <div style={{ marginTop: 4, color: "var(--text-2)", fontSize: 13, textTransform: "capitalize" }}>{dateStr}</div>
        </div>
        {!isDesktop && (
          <div style={{ width: 38, height: 38, borderRadius: 999, background: "linear-gradient(135deg, #FF9F0A 0%, #FF453A 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#1a0a04" }}>L</div>
        )}
      </header>

      <div style={{ display: isDesktop ? "grid" : "flex", gridTemplateColumns: isDesktop ? "1.4fr 1fr" : undefined, flexDirection: "column", gap: isDesktop ? 20 : 14 }}>

        {/* LEFT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: isDesktop ? 20 : 14 }}>

          <CheckInCard checkIn={checkIn} setCheckIn={setCheckIn} isDesktop={isDesktop} />

          {/* Today's session card */}
          {todaySession ? (
            <div className="card glow-blue lift" style={{ padding: isDesktop ? 26 : 20, cursor: "pointer", overflow: "hidden" }} onClick={() => onNav("scheda")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-2)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Sessione di oggi")}</div>
                  <h2 style={{ fontSize: isDesktop ? 30 : 26, fontWeight: 600, letterSpacing: -0.025 }}>{todaySession.label}</h2>
                </div>
                <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon name="bolt" size={20} color="#fff" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                {todaySession.muscles.map(m => <span key={m} className="pill tinted-blue">{t(m)}</span>)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
                <Icon name="chevron" size={14} strokeWidth={2} /> {t("Vai alla scheda")}
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: isDesktop ? 26 : 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Sessione di oggi")}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 28 }}>😴</span>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 600 }}>{t("Giorno di riposo")}</h2>
                  <div className="muted" style={{ fontSize: 13 }}>{t("Recupero attivo, mobilità e idratazione.")}</div>
                </div>
              </div>
            </div>
          )}

          {/* Week progress */}
          <div className="card lift" style={{ padding: isDesktop ? 22 : 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3>{t("Programma")}</h3>
              {isWeek7Plus && (
                <span className="pill tinted-orange" style={{ fontSize: 11 }}>⚠ {t("Cambia scheda")}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                {t("Settimana")} <span className="num" style={{ fontWeight: 600 }}>{safeWeek}</span> {t("di")} <span className="num" style={{ fontWeight: 600 }}>8</span>
              </div>
              <div className="num muted" style={{ fontSize: 12 }}>{Math.round((safeWeek / 8) * 100)}%</div>
            </div>
            <div className="bar" style={{ height: 8 }}>
              <i style={{ width: `${(safeWeek / 8) * 100}%`, background: isWeek7Plus ? "var(--warning)" : "linear-gradient(90deg, #0A84FF 0%, #5e5ce6 100%)" }} />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < safeWeek - 1 ? "var(--accent)" : i === safeWeek - 1 ? "var(--accent-2)" : "var(--track)" }} />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT column */}
        <div style={{ display: "flex", flexDirection: "column", gap: isDesktop ? 20 : 14 }}>

          {/* Body weight */}
          <div className="card lift" style={{ padding: isDesktop ? 22 : 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Peso corporeo")}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="num" style={{ fontSize: isDesktop ? 36 : 30, fontWeight: 600, letterSpacing: -0.04 }}>{latestWeight.toFixed(1)}</span>
                  <span className="muted" style={{ fontSize: 14 }}>kg</span>
                </div>
              </div>
              {weightDelta !== 0 && (
                <span className={`pill ${weightDelta < 0 ? "tinted-green" : "tinted-orange"}`}>
                  <Icon name="trend-up" size={11} /> {weightDelta > 0 ? "+" : ""}{weightDelta.toFixed(1)} kg
                </span>
              )}
            </div>
            <Sparkline data={sparkData} width={isDesktop ? 320 : 280} height={48} color="#30D158" />
            {/* Quick update */}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                type="number"
                placeholder={t("Aggiorna…")}
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                className="input input-mono"
                style={{ padding: "8px 10px", fontSize: 13, flex: 1 }}
                onKeyDown={(e) => { if (e.key === "Enter") saveWeight(); }}
              />
              <button className="btn primary" style={{ padding: "8px 14px", fontSize: 13 }} onClick={saveWeight}>
                <Icon name="check" size={14} strokeWidth={2.4} />
              </button>
            </div>
          </div>

          <GymCard isDesktop={isDesktop} />
          <MovimentoCard activities={activities} addActivity={addActivity} isDesktop={isDesktop} />

          {/* Week summary with anatomy */}
          <div className="card lift" style={{ padding: isDesktop ? 22 : 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <h3>{t("Settimana")}</h3>
              <span className="num muted" style={{ fontSize: 12 }}>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{weekGymDays}</span> / 3 {t("sessioni")}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: isDesktop ? 22 : 16 }}>
              <Anatomy active={["petto","spalle","bicipiti","quadricipiti","schiena","femorali"]} height={isDesktop ? 200 : 160} color="#0A84FF" />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { k: "Petto",   v: weekMuscles.Petto,   c: "#0A84FF" },
                  { k: "Schiena", v: weekMuscles.Schiena, c: "#5AC8FA" },
                  { k: "Gambe",   v: weekMuscles.Gambe,   c: "#30D158" },
                  { k: "Spalle",  v: weekMuscles.Spalle,  c: "#FF9F0A" },
                ].map(m => (
                  <div key={m.k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                      <span className="muted">{t(m.k)}</span>
                      <span className="num" style={{ fontWeight: 600 }}>{m.v}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "var(--track)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, m.v * 6)}%`, height: "100%", background: m.c, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
