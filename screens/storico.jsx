// storico.jsx — History screen: weight trend, sessions, check-in heatmap
// Requires window.Recharts (loaded via unpkg in index.html)

const _ACTIVITY_ICONS = {
  corsa: "🏃", bike: "🚴", hiit: "⚡", camminata: "🚶", ellittica: "🔄",
};
const _ACTIVITY_COLORS = {
  corsa: "#FF453A", bike: "#FF9F0A", hiit: "#BF5AF2", camminata: "#30D158", ellittica: "#5AC8FA",
};

// ── Weight trend chart ─────────────────────────────────────────────────────
const WeightChart = ({ data, isDesktop }) => {
  const t = useT();

  // Poll per window.Recharts nel caso il CDN carichi dopo il primo render
  const [rechartsReady, setRechartsReady] = React.useState(!!window.Recharts);
  React.useEffect(() => {
    if (window.Recharts) { setRechartsReady(true); return; }
    const id = setInterval(() => {
      if (window.Recharts) { setRechartsReady(true); clearInterval(id); }
    }, 300);
    return () => clearInterval(id);
  }, []);

  if (!rechartsReady) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <div className="muted" style={{ fontSize: 13 }}>{t("Caricamento grafico…")}</div>
      </div>
    );
  }

  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } = window.Recharts;

  if (!data || data.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📉</div>
        <div className="muted" style={{ fontSize: 13 }}>{t("Nessun dato peso — aggiorna il peso dalla Dashboard")}</div>
      </div>
    );
  }

  const vals  = data.map(d => d.weight);
  const minW  = Math.floor(Math.min(...vals) - 1);
  const maxW  = Math.ceil(Math.max(...vals) + 1);
  const last  = data[data.length - 1]?.weight;
  const first = data[0]?.weight;
  const trend = last - first;

  const formatted = data.map(d => ({
    ...d,
    label: d.date ? d.date.slice(5) : d.date,  // "MM-DD"
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
        padding: "8px 12px", fontSize: 12.5,
      }}>
        <div className="num" style={{ fontWeight: 700, fontSize: 15 }}>{payload[0].value} kg</div>
        <div className="muted">{payload[0].payload.date}</div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <div className="num" style={{ fontSize: isDesktop ? 32 : 28, fontWeight: 600, letterSpacing: -0.03 }}>
            {last} kg
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {data.length} {t("misurazioni")} · {t("da")} {data[0]?.date}
          </div>
        </div>
        <div style={{
          padding: "6px 12px", borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: trend <= 0 ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.12)",
          color: trend <= 0 ? "var(--success)" : "var(--danger)",
        }}>
          {trend > 0 ? "+" : ""}{trend.toFixed(1)} kg
        </div>
      </div>
      <ResponsiveContainer width="100%" height={isDesktop ? 200 : 160}>
        <LineChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--text-3)", fontSize: 10 }}
            tickLine={false} axisLine={false}
          />
          <YAxis
            domain={[minW, maxW]}
            tick={{ fill: "var(--text-3)", fontSize: 10 }}
            tickLine={false} axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone" dataKey="weight"
            stroke="var(--accent)" strokeWidth={2}
            dot={{ fill: "var(--accent)", strokeWidth: 0, r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// ── Check-in trend ─────────────────────────────────────────────────────────
const CheckInTrend = ({ isDesktop }) => {
  const t = useT();

  // refreshKey cambia dopo il fetch da Sheets, forzando il ricalcolo dei dati
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Sync check-in da Sheets → storage locale (ultimi 30 giorni)
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.storage) return;
    window.sheetsAPI.getCheckIn()
      .then(rows => {
        if (!Array.isArray(rows) || !rows.length) return;
        rows.forEach(r => {
          if (r.date && (r.sleep || r.energy)) {
            window.storage.set(`checkIn_${r.date}`, {
              sleep:    r.sleep   || 0,
              energy:   r.energy  || 0,
              ailments: r.ailments || "",
            });
          }
        });
        setRefreshKey(k => k + 1);
      })
      .catch(() => {});
  }, []);

  // Read last 14 days of check-in data (si aggiorna dopo il sync da Sheets)
  const data = React.useMemo(() => {
    if (!window.storage) return [];
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const ci = window.storage.get(`checkIn_${key}`, null);
      days.push({
        date: key,
        label: `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`,
        sleep: ci?.sleep || null,
        energy: ci?.energy || null,
      });
    }
    return days;
  }, [refreshKey]);

  const filled = data.filter(d => d.sleep !== null);
  if (!filled.length) return (
    <div style={{ padding: "20px 0", textAlign: "center" }}>
      <div className="muted" style={{ fontSize: 13 }}>{t("Nessun check-in disponibile")}</div>
    </div>
  );

  const avgSleep  = (filled.reduce((s, d) => s + d.sleep, 0) / filled.length).toFixed(1);
  const avgEnergy = (filled.reduce((s, d) => s + d.energy, 0) / filled.length).toFixed(1);
  const lvlColor  = (v) => v >= 4 ? "var(--success)" : v >= 3 ? "#FF9F0A" : "var(--danger)";

  return (
    <div>
      <div style={{ display: "flex", gap: isDesktop ? 24 : 16, marginBottom: 14 }}>
        {[
          { label: t("Media sonno"), value: avgSleep, icon: "🌙", color: lvlColor(parseFloat(avgSleep)) },
          { label: t("Media energia"), value: avgEnergy, icon: "⚡", color: lvlColor(parseFloat(avgEnergy)) },
          { label: t("Giorni log"), value: `${filled.length}/14`, icon: "📋", color: "var(--text)" },
        ].map(stat => (
          <div key={stat.label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{stat.icon}</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 600, color: stat.color }}>{stat.value}</div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Heatmap strip */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end" }}>
        {data.map((d, i) => {
          const hasData = d.sleep !== null;
          const score = hasData ? ((d.sleep + d.energy) / 2) : 0;
          const bg = !hasData ? "var(--card-2)"
            : score >= 4 ? "rgba(48,209,88,0.8)"
            : score >= 3 ? "rgba(255,159,10,0.7)"
            : "rgba(255,69,58,0.6)";
          return (
            <div key={d.date} title={`${d.date}${hasData ? ` · Sonno ${d.sleep}/5 · Energia ${d.energy}/5` : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                height: 28, width: "100%", borderRadius: 5,
                background: bg, transition: "background 0.2s",
              }} />
              {i % 4 === 0 && (
                <div className="num" style={{ fontSize: 8.5, color: "var(--text-3)", textAlign: "center" }}>
                  {d.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, justifyContent: "flex-end" }}>
        {[
          { color: "rgba(48,209,88,0.8)", label: "4-5" },
          { color: "rgba(255,159,10,0.7)", label: "3" },
          { color: "rgba(255,69,58,0.6)", label: "1-2" },
          { color: "var(--card-2)", label: t("no data") },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
            <span className="muted">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Activity row ───────────────────────────────────────────────────────────
const ActivityRow = ({ act, isDesktop }) => {
  const t = useT();
  const icon  = _ACTIVITY_ICONS[act.type] || "🏃";
  const color = _ACTIVITY_COLORS[act.type] || "var(--accent)";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "11px 0", borderTop: "1px solid var(--border)",
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: `${color}22`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, fontSize: 18,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.01 }}>
          {act.type ? (act.type.charAt(0).toUpperCase() + act.type.slice(1)) : "Attività"}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
          <span className="num">{act.min}</span> min
          {act.km ? <> · <span className="num">{act.km}</span> km</> : ""}
          {act.note ? ` · ${act.note}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="num muted" style={{ fontSize: 12 }}>{act.when}</div>
        {act.km && (
          <div className="num" style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>
            {(act.km / act.min * 60).toFixed(1)} km/h
          </div>
        )}
      </div>
    </div>
  );
};

// ── Storico screen ─────────────────────────────────────────────────────────
const Storico = ({ device, onNav }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [tab, setTab] = React.useState("peso");

  const [weightLog, setWeightLog] = React.useState(() => {
    if (!window.storage) return [];
    return window.storage.get("weightLog", []).slice(-60);
  });

  // Sync peso corporeo da Sheets → storage locale
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.storage) return;
    window.sheetsAPI.getPesoCorporeo()
      .then(rows => {
        if (!Array.isArray(rows) || !rows.length) return;
        // Merge: mappa per data, Sheets ha priorità
        const local = window.storage.get("weightLog", []);
        const map = {};
        local.forEach(e => { if (e.date) map[e.date] = e; });
        rows.forEach(e => { if (e.date) map[e.date] = e; });
        const merged = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
        window.storage.set("weightLog", merged);
        setWeightLog(merged.slice(-60));
      })
      .catch(() => {});
  }, []);

  const activities = React.useMemo(() => {
    if (!window.storage) return [];
    return window.storage.get("activities", []).slice(0, 30);
  }, []);

  const weekSummary = React.useMemo(() => {
    if (!window.storage || !activities.length) return null;
    const totalMin = activities.reduce((s, a) => s + (a.min || 0), 0);
    const totalKm  = activities.reduce((s, a) => s + (a.km || 0), 0);
    const byType   = {};
    activities.forEach(a => { byType[a.type] = (byType[a.type] || 0) + 1; });
    return { totalMin, totalKm, byType, count: activities.length };
  }, [activities]);

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 18 : 14 }}>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Progressi")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Storico")}</h1>
      </div>

      {/* Summary stats */}
      {weekSummary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[
            { label: t("Attività"), value: weekSummary.count, unit: "", color: "var(--accent)" },
            { label: t("Minuti"), value: weekSummary.totalMin, unit: "'", color: "#FF9F0A" },
            { label: t("km totali"), value: weekSummary.totalKm.toFixed(1), unit: "", color: "var(--success)" },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: "12px 14px", textAlign: "center" }}>
              <div className="num" style={{ fontSize: 22, fontWeight: 600, color: s.color }}>{s.value}{s.unit}</div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab selector */}
      <div className="tab-pills" style={{ alignSelf: "flex-start" }}>
        {[
          { id: "peso",     label: `⚖️ ${t("Peso")}` },
          { id: "cardio",   label: `🏃 ${t("Cardio")}` },
          { id: "checkin",  label: `📋 ${t("Check-in")}` },
        ].map(tb => (
          <button key={tb.id} className={tab === tb.id ? "on" : ""} onClick={() => setTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* Peso tab */}
      {tab === "peso" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
            {t("Trend peso corporeo")}
          </div>
          <WeightChart data={weightLog} isDesktop={isDesktop} />

          {weightLog.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>{t("Ultime misurazioni")}</div>
              {weightLog.slice(-7).reverse().map((entry, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "7px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ fontSize: 13, color: "var(--text-2)" }}>{entry.date}</div>
                  <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{entry.weight} kg</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cardio tab */}
      {tab === "cardio" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
            {t("Attività recenti")} ({activities.length})
          </div>
          {activities.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🏃</div>
              <div className="muted" style={{ fontSize: 13 }}>{t("Nessuna attività registrata")}</div>
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => onNav && onNav("dashboard")}>
                {t("Vai alla Dashboard")}
              </button>
            </div>
          ) : (
            <div>
              {activities.map((act, i) => (
                <ActivityRow key={act.id || i} act={act} isDesktop={isDesktop} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Check-in tab */}
      {tab === "checkin" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
            {t("Ultimi 14 giorni")}
          </div>
          <CheckInTrend isDesktop={isDesktop} />
        </div>
      )}

      {/* Quick navigation */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", paddingTop: 4 }}>
        <button className="btn" style={{ flex: 1, padding: "11px", fontSize: 13 }} onClick={() => onNav && onNav("dashboard")}>
          <Icon name="home" size={14} /> {t("Dashboard")}
        </button>
        <button className="btn" style={{ flex: 1, padding: "11px", fontSize: 13 }} onClick={() => onNav && onNav("scheda")}>
          <Icon name="dumbbell" size={14} /> {t("Allenamento")}
        </button>
      </div>

    </div>
  );
};

window.Storico = Storico;
