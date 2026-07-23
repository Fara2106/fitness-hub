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
      <div style={{ padding: "8px 0" }}>
        <UISkeleton h={180} r={14} />
      </div>
    );
  }

  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } = window.Recharts;

  if (!data || data.length === 0) {
    return (
      <UIEmpty icon="trend-up" title={t("Ancora nessun peso")} sub={t("Nessun dato peso — aggiorna il peso dalla Dashboard")} />
    );
  }

  const vals  = data.map(d => d.weight);
  const minW  = Math.floor(Math.min(...vals) - 1);
  const maxW  = Math.ceil(Math.max(...vals) + 1);
  const last  = data[data.length - 1]?.weight;
  const first = data[0]?.weight;
  const trend = last - first;

  // Media mobile 7 giorni: smussa il rumore giorno-per-giorno (acqua, sale…)
  // e mostra il trend vero. Linea tratteggiata ambra sopra i punti reali.
  const maMap = window.Insights
    ? window.Insights.movingAverage(data, 7).reduce((m, p) => { m[p.date] = p.ma; return m; }, {})
    : {};
  const formatted = data.map(d => ({
    ...d,
    ma: maMap[d.date],
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
          <span className="tnum">{trend > 0 ? "+" : ""}{trend.toFixed(1)} kg</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={isDesktop ? 200 : 160}>
        <LineChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
          <Line
            type="monotone" dataKey="ma"
            stroke="#FF9F0A" strokeWidth={1.6} strokeDasharray="5 3"
            dot={false} activeDot={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 4, display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
        <span style={{ display: "inline-block", width: 16, borderTop: "2px dashed #FF9F0A" }} />
        {t("Media 7 giorni")}
      </div>
    </div>
  );
};

// ── Obiettivo peso + proiezione al ritmo attuale ────────────────────────────
const GoalRow = ({ weightLog }) => {
  const t = useT();
  const [goal, setGoal] = React.useState(() => {
    const g = window.storage ? window.storage.get("weightGoal", "") : "";
    return g ? String(g) : "";
  });

  const save = (v) => {
    setGoal(v);
    const n = parseFloat(String(v).replace(",", "."));
    if (window.storage) window.storage.set("weightGoal", n > 0 ? n : "");
    if (window._saveSettingRetry && n > 0) window._saveSettingRetry("weightGoal", n);
  };

  const proj = (window.Insights && weightLog && weightLog.length >= 2)
    ? window.Insights.weightProjection(weightLog, goal || null)
    : null;

  const fmtEta = (iso) => {
    try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }); }
    catch (_) { return iso; }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-2)", flex: 1 }}>🎯 {t("Obiettivo")}</div>
        <input
          inputMode="decimal"
          value={goal}
          onChange={(e) => save(e.target.value.replace(/[^0-9.,]/g, ""))}
          placeholder="kg"
          className="input input-mono"
          style={{ width: 76, padding: "8px 10px", fontSize: 14, textAlign: "center" }}
        />
        <span className="muted" style={{ fontSize: 12 }}>kg</span>
      </div>
      {proj && (
        <div className="tnum" style={{ fontSize: 12, color: "var(--text-2)", marginTop: 8, lineHeight: 1.5 }}>
          {t("Ritmo attuale")}: <strong style={{ color: proj.ratePerWeek <= 0 ? "var(--success)" : "#FF9F0A" }}>
            {proj.ratePerWeek > 0 ? "+" : ""}{proj.ratePerWeek} {t("kg/sett")}
          </strong>
          {proj.reached
            ? <> · {t("Obiettivo raggiunto 🎉")}</>
            : proj.etaDate
              ? <> · {t("a questo ritmo arrivi a")} <strong style={{ color: "var(--text)" }}>{proj.target} kg</strong> ~{fmtEta(proj.etaDate)}</>
              : (proj.target ? <> · {t("il trend attuale si allontana dall'obiettivo")}</> : null)}
        </div>
      )}
    </div>
  );
};

// ── Registro sessioni: dal foglio Sessioni (o fallback locale gym_/muscleSets_) ─
const RegistroView = ({ isDesktop }) => {
  const t = useT();
  const [rows, setRows] = React.useState(null); // null = caricamento

  const localFallback = () => {
    if (!window.storage || !window.storage.keys) return [];
    return window.storage.keys()
      .filter(k => /^gym_\d{4}-\d{2}-\d{2}$/.test(k) && window.storage.get(k, false))
      .map(k => k.slice(4)).sort().reverse().slice(0, 30)
      .map(date => {
        const ms = window.storage.get(`muscleSets_${date}`, null) || {};
        const sets = Object.values(ms).reduce((s, n) => s + (Number(n) || 0), 0);
        return {
          date, type: "", setsCompleted: sets, totalSets: 0,
          notes: window.storage.get(`notes_${date}`, ""), local: true,
          groups: Object.keys(ms).join(" · "),
        };
      });
  };

  React.useEffect(() => {
    if (!window.sheetsAPI || !window.sheetsAPI.getSessioni) { setRows(localFallback()); return; }
    window.sheetsAPI.getSessioni()
      .then(r => setRows(Array.isArray(r) && r.length ? r.slice().reverse() : localFallback()))
      .catch(() => setRows(localFallback()));
  }, []);

  if (rows === null) return <UISkeleton h={140} r={14} />;
  if (!rows.length) {
    return <UIEmpty icon="calendar" title={t("Nessuna sessione registrata")} sub={t("Chiudi una sessione dalla Scheda per vederla qui")} style={{ padding: "20px 16px" }} />;
  }

  const fmtDay = (iso) => {
    try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" }); }
    catch (_) { return iso; }
  };

  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.date + "-" + i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: i > 0 ? "1px solid var(--border)" : 0 }}>
          <div style={{ width: 86, flexShrink: 0 }}>
            <div className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtDay(r.date)}</div>
            {r.ora && <div className="num muted" style={{ fontSize: 10.5, marginTop: 1 }}>{r.ora}</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {r.type ? <span className="pill" style={{ fontSize: 10.5, padding: "2px 8px", fontWeight: 600 }}>{r.type}</span> : null}
              <span className="tnum" style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                {r.setsCompleted}{r.totalSets ? `/${r.totalSets}` : ""} {t("serie")}
              </span>
            </div>
            {(r.groups || r.notes) && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.groups || r.notes}
              </div>
            )}
          </div>
        </div>
      ))}
      {rows[0] && rows[0].local && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 8, textAlign: "center" }}>
          {t("Solo dati locali — aggiorna il backend per lo storico completo")}
        </div>
      )}
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
    <UIEmpty icon="spark" title={t("Nessun check-in")} sub={t("Nessun check-in disponibile")} style={{ padding: "20px 16px" }} />
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
          {act.type ? t(act.type.charAt(0).toUpperCase() + act.type.slice(1)) : t("Attività")}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
          <span className="num">{act.min}</span> min
          {act.km ? <> · <span className="num">{act.km}</span> km</> : ""}
          {act.note ? ` · ${act.note}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="num muted" style={{ fontSize: 12 }}>{t(act.when)}</div>
        {act.km > 0 && act.min > 0 && (
          <div className="num" style={{ fontSize: 11, color, fontWeight: 600, marginTop: 2 }}>
            {(act.km / act.min * 60).toFixed(1)} km/h
          </div>
        )}
      </div>
    </div>
  );
};

// ── Volume per gruppo muscolare (ultimi 7 giorni) ──────────────────────────
const _GROUP_COLORS = {
  Petto: "var(--accent)", Schiena: "#5AC8FA", Gambe: "#30D158",
  Spalle: "#FF9F0A", Braccia: "#BF5AF2", Core: "#FF453A", Altro: "var(--text-3)",
};
const VolumeView = ({ isDesktop }) => {
  const t = useT();
  const data = React.useMemo(() => {
    if (!window.storage || !window.WorkoutProgress) return { byGroup: {}, total: 0, order: [], days: 0 };
    const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
    const dates = window.WorkoutProgress.lastNDates(today, 7);
    const hist = dates
      .map(d => ({ date: d, muscleSets: window.storage.get(`muscleSets_${d}`, null) }))
      .filter(h => h.muscleSets && Object.keys(h.muscleSets).length);
    const agg = window.WorkoutProgress.aggregateVolume(hist);
    return Object.assign({}, agg, { days: hist.length });
  }, []);

  if (!data.total) {
    return (
      <div style={{ padding: "24px 0", textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>💪</div>
        <div className="muted" style={{ fontSize: 13 }}>{t("Nessun allenamento negli ultimi 7 giorni")}</div>
      </div>
    );
  }
  const max = Math.max.apply(null, data.order.map(g => data.byGroup[g]));
  return (
    <div>
      {data.order.map(g => {
        const v = data.byGroup[g];
        const col = _GROUP_COLORS[g] || "var(--text-3)";
        return (
          <div key={g} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ width: 62, fontSize: 13, color: "var(--text-2)", flexShrink: 0 }}>{t(g)}</div>
            <div style={{ flex: 1, height: 10, borderRadius: 999, background: "var(--track)", overflow: "hidden" }}>
              <div style={{ width: `${max ? (v / max) * 100 : 0}%`, height: "100%", borderRadius: 999, background: col, transition: "width 0.4s" }} />
            </div>
            <div className="num" style={{ width: 26, textAlign: "right", fontSize: 14, fontWeight: 600 }}>{v}</div>
          </div>
        );
      })}
      <div className="muted tnum" style={{ fontSize: 11.5, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", textAlign: "center" }}>
        {data.total} {t("serie")} · {data.days} {t("sessioni")}
      </div>
    </div>
  );
};

// ── Forza: e1RM stimato (Epley) per esercizio, dai dati SerieAllenamento ────
const ForzaView = ({ isDesktop }) => {
  const t = useT();
  const [pesiMap, setPesiMap] = React.useState(null); // null = caricamento
  const [selected, setSelected] = React.useState(null);

  React.useEffect(() => {
    if (!window.sheetsAPI) { setPesiMap({}); return; }
    window.sheetsAPI.getPesi()
      .then(d => setPesiMap(d && typeof d === "object" ? d : {}))
      .catch(() => setPesiMap({}));
  }, []);

  // Recharts arriva on-demand (ensureRecharts): poll finché non è pronto,
  // così il grafico del trend appare appena caricato (come in WeightChart).
  const [chartReady, setChartReady] = React.useState(!!window.Recharts);
  React.useEffect(() => {
    if (chartReady) return;
    const id = setInterval(() => {
      if (window.Recharts) { setChartReady(true); clearInterval(id); }
    }, 300);
    return () => clearInterval(id);
  }, []);

  // Per esercizio: e1RM migliore per sessione (asc) → ultimo valore + delta.
  const list = React.useMemo(() => {
    if (!pesiMap || !window.Insights) return [];
    return Object.keys(pesiMap).map(name => {
      const sessions = window.Insights.exerciseSessions(pesiMap, name, 12).slice().reverse();
      const points = sessions.map(s => {
        let best = null;
        s.sets.forEach(x => {
          const v = window.Insights.e1rm(x.peso, x.rip);
          if (v != null && (best == null || v > best)) best = v;
        });
        return { date: s.date, label: s.date.slice(5), e1rm: best };
      }).filter(p => p.e1rm != null);
      if (!points.length) return null;
      const latest = points[points.length - 1].e1rm;
      const delta = Math.round((latest - points[0].e1rm) * 10) / 10;
      return { name, points, latest, delta };
    }).filter(Boolean).sort((a, b) => b.latest - a.latest).slice(0, 10);
  }, [pesiMap]);

  if (pesiMap === null) return <UISkeleton h={160} r={14} />;
  if (!list.length) {
    return <UIEmpty icon="dumbbell" title={t("Ancora nessun dato forza")} sub={t("Chiudi qualche sessione con i pesi segnati per vedere l'e1RM stimato")} style={{ padding: "20px 16px" }} />;
  }

  const sel = list.find(e => e.name === selected) || null;
  const R = chartReady ? window.Recharts : null;

  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        {t("e1RM = massimale stimato (formula di Epley). Tocca un esercizio per il trend.")}
      </div>
      {list.map(e => {
        const on = selected === e.name;
        return (
          <div key={e.name}>
            <div
              className="pressable"
              onClick={() => setSelected(on ? null : e.name)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 2px", borderTop: "1px solid var(--border)", cursor: "pointer" }}
            >
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: on ? 700 : 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: on ? "var(--accent)" : "var(--text)" }}>
                {e.name}
              </div>
              <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>{e.latest} <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 500 }}>kg</span></div>
              {e.points.length > 1 && (
                <span className="tnum" style={{
                  fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px", flexShrink: 0,
                  background: e.delta > 0 ? "rgba(48,209,88,0.15)" : e.delta < 0 ? "rgba(255,159,10,0.15)" : "var(--card-2)",
                  color: e.delta > 0 ? "var(--success)" : e.delta < 0 ? "#FF9F0A" : "var(--text-3)",
                }}>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
              )}
            </div>
            {on && sel && sel.points.length > 1 && R && (
              <div className="fade-up" style={{ padding: "6px 0 12px" }}>
                <R.ResponsiveContainer width="100%" height={140}>
                  <R.LineChart data={sel.points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <R.CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <R.XAxis dataKey="label" tick={{ fill: "var(--text-3)", fontSize: 9.5 }} tickLine={false} axisLine={false} />
                    <R.YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: "var(--text-3)", fontSize: 9.5 }} tickLine={false} axisLine={false} />
                    <R.Line type="monotone" dataKey="e1rm" stroke="var(--accent)" strokeWidth={2} dot={{ fill: "var(--accent)", strokeWidth: 0, r: 3 }} />
                  </R.LineChart>
                </R.ResponsiveContainer>
              </div>
            )}
            {on && sel && (sel.points.length <= 1 || !R) && (
              <div className="muted fade-up" style={{ fontSize: 12, padding: "2px 2px 10px" }}>
                {sel.points.length <= 1 ? t("Serve più di una sessione per il trend") : t("Grafico non disponibile")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Misure corporee (cm): local-first + sync best-effort col foglio Misure ──
const _MEASURE_FIELDS = [
  { id: "vita",    label: "Vita" },
  { id: "fianchi", label: "Fianchi" },
  { id: "torace",  label: "Torace" },
  { id: "braccio", label: "Braccio" },
  { id: "coscia",  label: "Coscia" },
];

const MisureView = ({ isDesktop }) => {
  const t = useT();
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [log, setLog] = React.useState(() => window.storage ? window.storage.get("bodyMeasures", []) : []);
  const [editing, setEditing] = React.useState(false);
  const [vals, setVals] = React.useState({});
  const [savedMsg, setSavedMsg] = React.useState("");

  // Pull dal foglio Misure (merge per data, cloud vince). Finché il .gs non è
  // rideployato la chiamata fallisce → si resta local-only, senza errori.
  React.useEffect(() => {
    if (!window.sheetsAPI || !window.sheetsAPI.getMisure || !window.storage) return;
    window.sheetsAPI.getMisure().then(rows => {
      if (!Array.isArray(rows) || !rows.length) return;
      const map = {};
      window.storage.get("bodyMeasures", []).forEach(e => { if (e && e.date) map[e.date] = e; });
      rows.forEach(e => { if (e && e.date) map[e.date] = Object.assign({}, map[e.date], e); });
      const merged = Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
      window.storage.set("bodyMeasures", merged);
      setLog(merged);
    }).catch(() => {});
  }, []);

  const latest = log.length ? log[log.length - 1] : {};
  const firstVal = (id) => { for (const e of log) { if (e[id] > 0) return e[id]; } return null; };

  const openEdit = () => {
    const v = {};
    _MEASURE_FIELDS.forEach(f => { v[f.id] = latest[f.id] ? String(latest[f.id]) : ""; });
    setVals(v);
    setEditing(true);
  };

  const save = () => {
    const entry = { date: today };
    let any = false;
    _MEASURE_FIELDS.forEach(f => {
      const n = parseFloat(String(vals[f.id] || "").replace(",", "."));
      if (n > 0) { entry[f.id] = Math.round(n * 10) / 10; any = true; }
    });
    if (!any) { setEditing(false); return; }
    const next = log.filter(e => e.date !== today).concat([Object.assign({}, log.find(e => e.date === today), entry)]);
    next.sort((a, b) => a.date.localeCompare(b.date));
    if (window.storage) window.storage.set("bodyMeasures", next.slice(-120));
    setLog(next.slice(-120));
    setEditing(false);
    setSavedMsg("✓ " + t("Misure salvate"));
    setTimeout(() => setSavedMsg(""), 2500);
    if (window.sheetsAPI && window.sheetsAPI.saveMisure) window.sheetsAPI.saveMisure(entry).catch(() => {});
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(5, 1fr)" : "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        {_MEASURE_FIELDS.map(f => {
          const cur = latest[f.id];
          const first = firstVal(f.id);
          const delta = (cur > 0 && first > 0 && cur !== first) ? Math.round((cur - first) * 10) / 10 : null;
          return (
            <div key={f.id} className="card" style={{ padding: "10px 8px", textAlign: "center" }}>
              <div className="num" style={{ fontSize: 17, fontWeight: 700 }}>{cur > 0 ? cur : "—"}</div>
              <div className="muted" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>{t(f.label)}</div>
              {delta != null && (
                <div className="tnum" style={{ fontSize: 10, fontWeight: 600, marginTop: 2, color: delta < 0 ? "var(--success)" : "#FF9F0A" }}>
                  {delta > 0 ? "+" : ""}{delta}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing ? (
        <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(5, 1fr)" : "repeat(3, 1fr)", gap: 8 }}>
            {_MEASURE_FIELDS.map(f => (
              <div key={f.id}>
                <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{t(f.label)}</div>
                <input
                  inputMode="decimal"
                  value={vals[f.id] || ""}
                  onChange={(e) => setVals(v => Object.assign({}, v, { [f.id]: e.target.value.replace(/[^0-9.,]/g, "") }))}
                  placeholder="cm"
                  className="input input-mono"
                  style={{ width: "100%", padding: "9px 8px", fontSize: 14, textAlign: "center" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setEditing(false)}>{t("Annulla")}</button>
            <button className="btn primary" style={{ flex: 2 }} onClick={save}>{t("Salva misure")}</button>
          </div>
        </div>
      ) : (
        <button className="btn" style={{ width: "100%", padding: 12, fontSize: 14 }} onClick={openEdit}>
          <Icon name="plus" size={14} /> {log.length ? t("Aggiorna misure") : t("Registra le prime misure")}
        </button>
      )}
      {savedMsg && <div className="fade-up" style={{ textAlign: "center", fontSize: 12.5, color: "var(--success)", marginTop: 8 }}>{savedMsg}</div>}

      {log.length > 1 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Ultime rilevazioni")}</div>
          {log.slice(-5).reverse().map((e, i) => (
            <div key={e.date} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: i > 0 ? "1px solid var(--border)" : 0, fontSize: 12 }}>
              <span className="num muted" style={{ width: 76, flexShrink: 0 }}>{e.date}</span>
              <span className="tnum" style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {_MEASURE_FIELDS.filter(f => e[f.id] > 0).map(f => `${t(f.label)} ${e[f.id]}`).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Storico screen ─────────────────────────────────────────────────────────
const Storico = ({ device, onNav }) => {
  const isDesktop = device === "desktop";
  const t = useT();
  const [tab, setTab] = React.useState("peso");

  // Recharts è lazy (non più in index.html): parte il fetch all'ingresso in
  // Storico; WeightChart/ForzaView hanno già il poll su window.Recharts.
  React.useEffect(() => {
    if (window.ensureRecharts) window.ensureRecharts().catch(() => {});
  }, []);

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
        // Merge canonico (dedup per data, Sheets ha priorità) — stessa logica
        // testata usata dalla sync in app.jsx.
        const local = window.storage.get("weightLog", []);
        const merged = window.WorkoutProgress
          ? window.WorkoutProgress.mergeWeightLog(local, rows, "cloud")
          : (() => {
              const map = {};
              local.forEach(e => { if (e.date) map[e.date] = e; });
              rows.forEach(e => { if (e.date) map[e.date] = e; });
              return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
            })();
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

      {/* Tab selector — segmented control iOS; con 6 tab scorre in orizzontale */}
      <div className="segmented" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {[
          { id: "peso",     label: `⚖️ ${t("Peso")}` },
          { id: "forza",    label: `🏆 ${t("Forza")}` },
          { id: "volume",   label: `💪 ${t("Volume")}` },
          { id: "misure",   label: `📏 ${t("Misure")}` },
          { id: "registro", label: `📖 ${t("Registro")}` },
          { id: "cardio",   label: `🏃 ${t("Cardio")}` },
          { id: "checkin",  label: `📋 ${t("Check-in")}` },
        ].map(tb => (
          <button key={tb.id} className={tab === tb.id ? "on" : ""} onClick={() => setTab(tb.id)}
            style={{ whiteSpace: "nowrap", flex: "1 0 auto", minWidth: 76 }}>
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

          {weightLog.length >= 2 && <GoalRow weightLog={weightLog} />}

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

      {/* Forza tab */}
      {tab === "forza" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
            {t("Massimale stimato per esercizio")}
          </div>
          <ForzaView isDesktop={isDesktop} />
        </div>
      )}

      {/* Misure tab */}
      {tab === "misure" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
            {t("Misure corporee")} (cm)
          </div>
          <MisureView isDesktop={isDesktop} />
        </div>
      )}

      {/* Registro tab */}
      {tab === "registro" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
            {t("Registro sessioni")}
          </div>
          <RegistroView isDesktop={isDesktop} />
        </div>
      )}

      {/* Volume tab */}
      {tab === "volume" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
            {t("Serie per gruppo")} · {t("ultimi 7 giorni")}
          </div>
          <VolumeView isDesktop={isDesktop} />
        </div>
      )}

      {/* Cardio tab */}
      {tab === "cardio" && (
        <div className="card" style={{ padding: isDesktop ? 22 : 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
            {t("Attività recenti")} ({activities.length})
          </div>
          {activities.length === 0 ? (
            <UIEmpty
              icon="wave"
              title={t("Nessuna attività")}
              sub={t("Nessuna attività registrata")}
              style={{ padding: "20px 16px" }}
              action={
                <button className="btn primary" style={{ marginTop: 4 }} onClick={() => onNav && onNav("dashboard")}>
                  {t("Vai alla Dashboard")}
                </button>
              }
            />
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
