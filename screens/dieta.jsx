// dieta.jsx — Meal plan with chronological timeline + supplements + time slider

const _DAY_TYPES = [
  { id: "mattina", label: "Mattina",  emoji: "🌅", hint: "07–10" },
  { id: "ore17",   label: "Ore 17",   emoji: "🌇", hint: "pomeriggio" },
  { id: "ore21",   label: "Ore 21",   emoji: "🌙", hint: "sera" },
  { id: "ore22",   label: "Ore 22",   emoji: "🌃", hint: "tardi" },
];

const _CARDIO_TYPES = [
  { id: "corsa",     label: "Corsa",     emoji: "🏃", kcalMin: 8 },
  { id: "bike",      label: "Bike",      emoji: "🚴", kcalMin: 6 },
  { id: "hiit",      label: "HIIT",      emoji: "⚡", kcalMin: 10 },
  { id: "camminata", label: "Camminata", emoji: "🚶", kcalMin: 4 },
  { id: "ellittica", label: "Ellittica", emoji: "🔄", kcalMin: 7 },
];

// Full supplement definitions (daily + workout-specific), sortTime drives ordering
const _SUPPS_RIPOSO = [
  { name: "Vita C+ Slow Release", time: "Colazione (mattina)",  sortTime: "08:00", color: "#FF9F0A", type: "vitac"  },
  { name: "Vita B+",              time: "Colazione (mattina)",  sortTime: "08:00", color: "#FFD60A", type: "vitab"  },
  { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1" },
  { name: "PS+",                  time: "Dopo merenda",         sortTime: "17:00", color: "#BF5AF2", type: "ps"     },
  { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "21:00", color: "#5AC8FA", type: "omega2" },
  { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:00", color: "#30D158", type: "gluta"  },
];

const _SUPPS_MATTINA = [
  { name: "Vita C+ Slow Release", time: "Colazione",            sortTime: "06:30", color: "#FF9F0A", type: "vitac"    },
  { name: "Vita B+",              time: "Colazione",            sortTime: "06:30", color: "#FFD60A", type: "vitab"    },
  { name: "MGK+ Liquid",          time: "Pre-WO (45min prima)", sortTime: "07:15", color: "#0A84FF", type: "mgk"      },
  { name: "Fuel+",                time: "Pre-WO (45min prima)", sortTime: "07:15", color: "#0A84FF", type: "fuel"     },
  { name: "Barretta 4plus 45g",   time: "Pre-WO (45min prima)", sortTime: "07:15", color: "#FF9F0A", type: "barretta" },
  { name: "OMNIA+ 500ml",         time: "Intra-WO (borraccia)", sortTime: "08:00", color: "#5AC8FA", type: "omnia"    },
  { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "11:30", color: "#5AC8FA", type: "omega1"   },
  { name: "PS+",                  time: "Dopo merenda",         sortTime: "16:30", color: "#BF5AF2", type: "ps"       },
  { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "21:00", color: "#5AC8FA", type: "omega2"   },
  { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:00", color: "#30D158", type: "gluta"    },
];

const _SUPPS_ORE17 = [
  { name: "Vita C+ Slow Release", time: "Colazione",            sortTime: "08:00", color: "#FF9F0A", type: "vitac"    },
  { name: "Vita B+",              time: "Colazione",            sortTime: "08:00", color: "#FFD60A", type: "vitab"    },
  { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1"   },
  { name: "MGK+ Liquid",          time: "Pre-WO ore 16:15",     sortTime: "16:15", color: "#0A84FF", type: "mgk"      },
  { name: "Fuel+",                time: "Pre-WO ore 16:15",     sortTime: "16:15", color: "#0A84FF", type: "fuel"     },
  { name: "Barretta 4plus 45g",   time: "Pre-WO ore 16:15",     sortTime: "16:15", color: "#FF9F0A", type: "barretta" },
  { name: "PS+",                  time: "Dopo merenda",         sortTime: "16:30", color: "#BF5AF2", type: "ps"       },
  { name: "OMNIA+ 500ml",         time: "Intra-WO (borraccia)", sortTime: "17:00", color: "#5AC8FA", type: "omnia"    },
  { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "21:00", color: "#5AC8FA", type: "omega2"   },
  { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:00", color: "#30D158", type: "gluta"    },
];

const _SUPPS_ORE21 = [
  { name: "Vita C+ Slow Release", time: "Colazione",            sortTime: "08:00", color: "#FF9F0A", type: "vitac"    },
  { name: "Vita B+",              time: "Colazione",            sortTime: "08:00", color: "#FFD60A", type: "vitab"    },
  { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1"   },
  { name: "PS+",                  time: "Dopo merenda · entro 17:00", sortTime: "16:30", color: "#BF5AF2", type: "ps" },
  { name: "MGK+ Liquid",          time: "Pre-WO ore 20:15",     sortTime: "20:15", color: "#0A84FF", type: "mgk"      },
  { name: "Fuel+",                time: "Pre-WO ore 20:15",     sortTime: "20:15", color: "#0A84FF", type: "fuel"     },
  { name: "Barretta 4plus 45g",   time: "Pre-WO ore 20:15",     sortTime: "20:15", color: "#FF9F0A", type: "barretta" },
  { name: "OMNIA+ 500ml",         time: "Intra-WO (borraccia)", sortTime: "21:00", color: "#5AC8FA", type: "omnia"    },
  { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "22:30", color: "#5AC8FA", type: "omega2"   },
  { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:30", color: "#30D158", type: "gluta"    },
];

const _SUPPS_ORE22 = [
  { name: "Vita C+ Slow Release", time: "Colazione",            sortTime: "08:00", color: "#FF9F0A", type: "vitac"    },
  { name: "Vita B+",              time: "Colazione",            sortTime: "08:00", color: "#FFD60A", type: "vitab"    },
  { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1"   },
  { name: "MGK+ Liquid",          time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#0A84FF", type: "mgk"      },
  { name: "Fuel+",                time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#0A84FF", type: "fuel"     },
  { name: "Barretta 4plus 45g",   time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#FF9F0A", type: "barretta" },
  { name: "OMNIA+ 500ml",         time: "Intra-WO (borraccia)", sortTime: "22:00", color: "#5AC8FA", type: "omnia"    },
  { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "23:30", color: "#5AC8FA", type: "omega2"   },
  { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:55", color: "#30D158", type: "gluta"    },
];

const _SUPPS_MAP = {
  riposo: _SUPPS_RIPOSO,
  mattina: _SUPPS_MATTINA,
  ore17: _SUPPS_ORE17,
  ore21: _SUPPS_ORE21,
  ore22: _SUPPS_ORE22,
};

// ── Static fallback meal plan ─────────────────────────────────────────────
const _FALLBACK = {
  riposo: {
    integratori: _SUPPS_RIPOSO,
    meals: [
      { time:"08:00", sortTime:"08:00", emoji:"🌅", title:"Colazione", kcal:520,
        primary:[{food:"Gallette grano saraceno (4) + marmellata ridotto zucchero + burro chiarificato",qty:"40g + 50g + 10g"},{food:"Pane di segale + prosciutto crudo o bresaola",qty:"80g + 100g"}],
        others:[{food:"Yogurt greco Fage 0% + miele + muesli viviverde",qty:"150g+20g+50g"},{food:"Uova (2) + pane di segale",qty:"160g+100g"}] },
      { time:"10:30", sortTime:"10:30", emoji:"🍎", title:"Spuntino", kcal:190,
        primary:[{food:"Frutta fresca (no macedonie)",qty:"200g"},{food:"Noci o mandorle",qty:"30g"}],
        others:[] },
      { time:"13:00", sortTime:"13:00", emoji:"🍝", title:"Pranzo", kcal:680,
        primary:[{food:"Carboidrato: pasta farro integrale | riso rosso | riso basmati | pane integrale",qty:"80–100g"},{food:"Verdure o ortaggi",qty:"300g"},{food:"Olio EVO",qty:"20g"},{food:"Proteina: tonno | orata | pollo | salmone | manzo | tacchino | merluzzo",qty:"a scelta"}],
        others:[{food:"Primo sale 110g | Ricotta 160g | Parmigiano 60g | Feta 100g",qty:""}] },
      { time:"16:30", sortTime:"16:30", emoji:"🥛", title:"Merenda", kcal:200,
        primary:[{food:"Yogurt greco Fage 0% (o yoeggs)",qty:"200g"},{food:"Frutta fresca",qty:"100g"}],
        others:[] },
      { time:"20:00", sortTime:"20:00", emoji:"🌙", title:"Cena", kcal:520,
        primary:[{food:"Verdure o ortaggi",qty:"200g"},{food:"Olio EVO",qty:"10g"},{food:"Proteina: merluzzo | pollo | salmone | uova | bistecca | vitello",qty:"a scelta"}],
        others:[{food:"Con legumi: 90g verdure + 20g legumi secchi misto",qty:""}] },
    ],
  },
  mattina: {
    integratori: _SUPPS_MATTINA,
    meals: [
      { time:"06:30", sortTime:"06:30", emoji:"💪", title:"Pre-allenamento", kcal:290,
        primary:[{food:"Gallette grano saraceno (4) + marmellata o miele",qty:"40g+50g"},{food:"Pane tipo 1 + marmellata o miele",qty:"50g+50g"}],
        others:[{food:"Caffè ok, acqua abbondante",qty:""}] },
      { time:"10:30", sortTime:"10:30", emoji:"🥤", title:"Pranzo post-WO", kcal:720,
        primary:[{food:"Carboidrato: pasta farro integrale | riso rosso | riso basmati | pane di segale",qty:"80–100g"},{food:"Verdure o ortaggi",qty:"300g"},{food:"Olio EVO",qty:"20g"},{food:"Proteina aumentata: pollo | tacchino | manzo | salmone | orata | merluzzo",qty:"a scelta"}],
        others:[{food:"Tonno 180g | Platessa 340g | Uova 220g | Hamburger chianina 140g",qty:""}] },
      { time:"16:30", sortTime:"16:30", emoji:"🥛", title:"Merenda", kcal:210,
        primary:[{food:"Yogurt greco Fage 0% (o yoeggs)",qty:"200g"},{food:"Frutta fresca",qty:"100g"},{food:"Noci",qty:"30g"}],
        others:[] },
      { time:"20:00", sortTime:"20:00", emoji:"🌙", title:"Cena", kcal:480,
        primary:[{food:"Verdure o ortaggi",qty:"100g"},{food:"Olio EVO",qty:"10g"},{food:"Proteina: pollo | salmone | uova | merluzzo | bistecca | vitello",qty:"a scelta"},{food:"Pane di segale",qty:"50g"}],
        others:[] },
    ],
  },
  ore17: {
    integratori: _SUPPS_ORE17,
    meals: [
      { time:"08:00", sortTime:"08:00", emoji:"🌅", title:"Colazione", kcal:500,
        primary:[{food:"Gallette grano saraceno (4) + marmellata + burro chiarificato",qty:"40g+50g+10g"},{food:"Pane di segale + pane integrale + prosciutto/bresaola",qty:"80g+70g+100g"}],
        others:[{food:"Yogurt greco 0% + miele + muesli",qty:"150g+20g+50g"},{food:"Uova (2) + pane",qty:"160g+100g"}] },
      { time:"10:30", sortTime:"10:30", emoji:"🍎", title:"Spuntino mattina", kcal:230,
        primary:[{food:"Frutta fresca (no macedonie)",qty:"200g"},{food:"Noci o mandorle",qty:"30g"},{food:"Yogurt greco Fage 0% (o yoeggs)",qty:"150g"}],
        others:[] },
      { time:"13:00", sortTime:"13:00", emoji:"🍝", title:"Pranzo", kcal:640,
        primary:[{food:"Carboidrato: pasta farro | riso rosso | riso basmati | pane integrale",qty:"70–80g"},{food:"Verdure",qty:"300g"},{food:"Olio EVO",qty:"20g"},{food:"Proteina: pollo | salmone | orata | manzo | merluzzo | tacchino",qty:"a scelta"}],
        others:[{food:"Tonno 150g | Ricotta 160g | Feta 100g | Uova 190g",qty:""}] },
      { time:"16:00", sortTime:"16:00", emoji:"⚡", title:"Pre-WO · spuntino", kcal:180,
        primary:[{food:"Barretta Endurance 4Plus",qty:"45g"},{food:"(+ MGK+ Liquid + Fuel+ — vedi integratori)",qty:""}],
        others:[] },
      { time:"18:30", sortTime:"18:30", emoji:"🥤", title:"Post-WO (cena)", kcal:460,
        primary:[{food:"Carboidrato: riso basmati | riso parboiled | riso arborio",qty:"80g"},{food:"Proteina: pollo | manzo | salmone | uova | merluzzo",qty:"a scelta"},{food:"Verdure",qty:"200g"}],
        others:[] },
    ],
  },
};
_FALLBACK.ore21 = {
  integratori: _SUPPS_ORE21,
  meals: [
    _FALLBACK.ore17.meals[0], // colazione
    _FALLBACK.ore17.meals[1], // spuntino mattina
    _FALLBACK.ore17.meals[2], // pranzo
    { time:"16:30", sortTime:"16:30", emoji:"🥛", title:"Merenda", kcal:200,
      primary:[{food:"Yogurt greco Fage 0% (o yoeggs)",qty:"200g"},{food:"Frutta fresca",qty:"100g"}], others:[] },
    { time:"20:00", sortTime:"20:00", emoji:"⚡", title:"Pre-WO · spuntino", kcal:180,
      primary:[{food:"Barretta Endurance 4Plus",qty:"45g"},{food:"(+ MGK+ Liquid + Fuel+ — vedi integratori)",qty:""}], others:[] },
    { time:"22:00", sortTime:"22:00", emoji:"🌙", title:"Post-WO (cena leggera)", kcal:420,
      primary:[{food:"Carboidrato: riso basmati | parboiled | arborio",qty:"80g"},{food:"Proteina: pollo | salmone | uova | merluzzo",qty:"a scelta"},{food:"Verdure",qty:"100g"}],
      others:[] },
  ],
};
_FALLBACK.ore22 = {
  integratori: _SUPPS_ORE22,
  meals: [
    _FALLBACK.ore17.meals[0], // colazione
    _FALLBACK.ore17.meals[1], // spuntino mattina
    _FALLBACK.ore17.meals[2], // pranzo
    { time:"18:00", sortTime:"18:00", emoji:"🍽️", title:"Merenda ore 18", kcal:480,
      primary:[{food:"Verdure",qty:"100g"},{food:"Olio EVO",qty:"10g"},{food:"Proteina: pollo | salmone | manzo | merluzzo",qty:"a scelta"},{food:"Carboidrato: riso basmati | pane grano duro",qty:"50–60g"}],
      others:[] },
    { time:"21:00", sortTime:"21:00", emoji:"⚡", title:"Pre-WO · spuntino", kcal:180,
      primary:[{food:"Barretta Endurance 4Plus",qty:"45g"},{food:"(+ MGK+ Liquid + Fuel+ — vedi integratori)",qty:""}], others:[] },
  ],
};

// Load parsed dieta or fallback
function _getDieta() {
  if (!window.parseDieta || !window.storage) return _FALLBACK;
  const text = window.storage.get("dietaData", null);
  if (!text) return _FALLBACK;
  try {
    const parsed = window.parseDieta(text);
    if (!parsed) return _FALLBACK;
    ["riposo","mattina","ore17","ore21","ore22"].forEach(k => {
      if (!parsed[k] || !parsed[k].meals || !parsed[k].meals.length) {
        parsed[k] = _FALLBACK[k];
      } else {
        // Always override integratori from our canonical list (parser may be incomplete)
        parsed[k].integratori = _SUPPS_MAP[k];
        // Ensure sortTime on meals
        parsed[k].meals.forEach(m => { if (!m.sortTime) m.sortTime = m.time; });
      }
    });
    return parsed;
  } catch (_) {
    return _FALLBACK;
  }
}

// ── Build chronological timeline (meals + supplements) ────────────────────
function _buildTimeline(meals, integratori) {
  const parseMinutes = (t) => {
    if (!t) return 9999;
    const [h, m] = String(t).split(":").map(Number);
    return (isNaN(h) ? 9999 : h * 60 + (isNaN(m) ? 0 : m));
  };

  const mealItems = (meals || []).map(m => ({
    ...m,
    kind: "meal",
    _mins: parseMinutes(m.sortTime || m.time),
  }));

  const suppItems = (integratori || []).map(s => ({
    ...s,
    kind: "supplement",
    _mins: parseMinutes(s.sortTime),
  }));

  return [...mealItems, ...suppItems].sort((a, b) => a._mins - b._mins);
}

// ── Day Time Slider ────────────────────────────────────────────────────────
const DayTimeSlider = ({ timeline }) => {
  const t = useT();
  const [nowMins, setNowMins] = React.useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  React.useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMins(d.getHours() * 60 + d.getMinutes());
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const START = 6 * 60;   // 06:00
  const END   = 24 * 60;  // 24:00
  const RANGE = END - START;

  const toP = (m) => Math.max(0, Math.min(100, ((m - START) / RANGE) * 100));
  const nowP = toP(Math.min(nowMins, END));

  const fmt = (m) => {
    if (m >= 24 * 60) return "00:00";
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}:${String(min).padStart(2, "0")}`;
  };

  const dots = (timeline || []).filter(item => item._mins < 9999 && item._mins >= START - 30);

  // Is current time past last item?
  const lastMins = dots.length ? Math.max(...dots.map(d => d._mins)) : END;
  const isAllDone = nowMins > lastMins;

  return (
    <div style={{
      background: "var(--card-2)", borderRadius: 14,
      padding: "16px 14px 12px",
      border: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{t("Orario della giornata")}</div>
        <div className="num" style={{
          fontSize: 12, fontWeight: 700,
          color: isAllDone ? "var(--success)" : "var(--accent)",
          background: isAllDone ? "rgba(48,209,88,0.12)" : "rgba(10,132,255,0.12)",
          padding: "3px 9px", borderRadius: 999,
        }}>
          {isAllDone ? "✓ " + t("Giornata completata") : fmt(nowMins)}
        </div>
      </div>

      {/* Track */}
      <div style={{ position: "relative", height: 32, userSelect: "none" }}>
        {/* Background bar */}
        <div style={{
          position: "absolute", top: "50%", left: 0, right: 0,
          height: 6, background: "var(--card-3)", borderRadius: 3,
          transform: "translateY(-50%)",
        }} />
        {/* Progress fill up to now */}
        <div style={{
          position: "absolute", top: "50%", left: 0,
          width: `${nowP}%`, height: 6,
          background: "linear-gradient(90deg, var(--accent) 0%, #5e5ce6 100%)",
          borderRadius: 3, transform: "translateY(-50%)",
          transition: "width 0.5s ease",
        }} />

        {/* Dots for each item */}
        {dots.map((item, i) => {
          const p = toP(item._mins);
          const isMeal = item.kind === "meal";
          const isPast = item._mins <= nowMins;
          return (
            <div key={i} title={`${fmt(item._mins)} · ${item.name || item.title}`} style={{
              position: "absolute",
              left: `${p}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: isMeal ? 12 : 8,
              height: isMeal ? 12 : 8,
              borderRadius: 999,
              background: isPast ? (isMeal ? "var(--accent)" : (item.color || "#FF9F0A")) : "var(--card-3)",
              border: `2px solid ${isMeal ? "var(--accent)" : (item.color || "#FF9F0A")}`,
              zIndex: 2,
              boxShadow: isPast && isMeal ? `0 0 6px ${item.color || "var(--accent)"}55` : "none",
              transition: "background 0.3s",
            }} />
          );
        })}

        {/* Current time needle (theme-aware: bianco su dark, nero su light) */}
        <div style={{
          position: "absolute",
          left: `${nowP}%`,
          top: 0, bottom: 0,
          width: 2,
          background: "var(--text)",
          transform: "translateX(-50%)",
          borderRadius: 1,
          zIndex: 4,
          boxShadow: "0 0 5px rgba(127,127,127,0.6)",
        }} />
      </div>

      {/* Hour labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {["06", "10", "14", "18", "22", "24"].map(h => (
          <span key={h} style={{ fontSize: 9.5, color: "var(--text-3)", fontWeight: 500 }}>{h}:00</span>
        ))}
      </div>

      {/* Current phase + next item */}
      {(() => {
        const prev = [...dots].reverse().find(d => d._mins <= nowMins);
        const next = dots.find(d => d._mins > nowMins);
        const prevLabel = prev
          ? (prev.kind === "meal" ? (prev.emoji || "🍽️") + " " + t(prev.title) : "💊 " + prev.name)
          : null;
        const nextLabel = next
          ? (next.kind === "meal" ? (next.emoji || "🍽️") + " " + t(next.title) : "💊 " + next.name)
          : null;

        if (isAllDone) {
          return (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(48,209,88,0.08)", borderRadius: 10, fontSize: 12 }}>
              <span>✅</span>
              <span style={{ color: "var(--success)", fontWeight: 600 }}>{t("Tutti i pasti completati per oggi!")}</span>
            </div>
          );
        }

        return (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {/* "Between" context chip */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", background: "var(--card-3)", borderRadius: 9, fontSize: 12 }}>
              <span style={{ fontSize: 13 }}>📍</span>
              <span style={{ color: "var(--text-2)" }}>
                {!prevLabel && nextLabel && (
                  <>{t("Prima di")} <strong style={{ color: "var(--text)" }}>{nextLabel}</strong></>
                )}
                {prevLabel && nextLabel && (
                  <><strong style={{ color: "var(--text-2)" }}>{prevLabel}</strong>
                  <span style={{ color: "var(--text-3)", margin: "0 5px" }}>→</span>
                  <strong style={{ color: "var(--accent)" }}>{nextLabel}</strong></>
                )}
                {prevLabel && !nextLabel && (
                  <>{t("Dopo")} <strong style={{ color: "var(--text)" }}>{prevLabel}</strong></>
                )}
              </span>
            </div>
            {/* Next item countdown */}
            {next && (() => {
              const diffMins = next._mins - nowMins;
              const diffStr = diffMins < 60
                ? `${diffMins} min`
                : `${Math.floor(diffMins / 60)}h${diffMins % 60 > 0 ? " " + (diffMins % 60) + "m" : ""}`;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(10,132,255,0.08)", borderRadius: 10, fontSize: 12 }}>
                  <span style={{ fontSize: 14 }}>⏱</span>
                  <span style={{ flex: 1, color: "var(--text-2)" }}>
                    <strong style={{ color: "var(--text)" }}>{nextLabel}</strong>
                  </span>
                  <span className="num" style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 600 }}>
                    {fmt(next._mins)} · {t("tra")} {diffStr}
                  </span>
                </div>
              );
            })()}
          </div>
        );
      })()}
    </div>
  );
};

// ── Supplement row (inline in timeline) ───────────────────────────────────
const SupplementRow = ({ supp, checked, onToggle }) => {
  const t = useT();
  const done = !!checked[supp.type];
  return (
    <button
      onClick={() => onToggle(supp.type)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", borderRadius: 12, border: 0,
        background: done ? "rgba(48,209,88,0.08)" : "var(--card)",
        boxShadow: done ? "none" : "inset 0 0 0 1px var(--border)",
        cursor: "pointer", textAlign: "left", width: "100%",
        transition: "all 0.15s",
      }}
    >
      {/* Color pill */}
      <div style={{
        width: 4, height: 28, borderRadius: 2,
        background: supp.color, opacity: done ? 0.4 : 1, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, fontWeight: 600, lineHeight: 1.2,
          color: done ? "var(--text-2)" : "var(--text)",
          textDecoration: done ? "line-through" : "none",
        }}>💊 {supp.name}</div>
        <div className="num" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t(supp.time)}</div>
      </div>
      <div style={{
        width: 22, height: 22, borderRadius: 999, flexShrink: 0,
        background: done ? "var(--success)" : "var(--card-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.15s",
      }}>
        {done && <Icon name="check" size={12} color="#062810" />}
      </div>
    </button>
  );
};

// ── Meal card ──────────────────────────────────────────────────────────────
const MealCard = ({ meal, isDesktop }) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="card lift" style={{ padding: isDesktop ? 20 : 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>{meal.emoji}</span>
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: -0.015 }}>{t(meal.title)}</div>
            <div className="num muted" style={{ fontSize: 12 }}>{meal.time}</div>
          </div>
        </div>
        {meal.kcal > 0 && (
          <span className="pill" style={{ fontSize: 11, padding: "3px 8px" }}>
            <span className="num" style={{ fontWeight: 700 }}>{meal.kcal}</span>
            <span style={{ color: "var(--text-3)", fontWeight: 500 }}> kcal</span>
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {meal.primary.map((f, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            padding: "7px 0", borderTop: i > 0 ? "1px solid var(--border)" : "0", gap: 8,
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.35 }}>{f.food}</div>
            {f.qty && (
              <div className="num" style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{f.qty}</div>
            )}
          </div>
        ))}
      </div>

      {meal.others && meal.others.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", padding: "10px 0 0", border: 0, background: "transparent",
              color: "var(--accent)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              borderTop: "1px solid var(--border)", marginTop: 8,
            }}
          >
            <span>{open ? t("Nascondi") : t("Altre opzioni")} ({meal.others.length})</span>
            <span style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "flex" }}>
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          {open && (
            <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {meal.others.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 10px", background: "var(--card-2)", borderRadius: 9,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", flexShrink: 0, marginTop: 4 }} />
                  <span style={{ fontSize: 13 }}>{f.food}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Main Dieta screen ──────────────────────────────────────────────────────
const Dieta = ({ device }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  const [dieta]       = React.useState(() => _getDieta());
  const [training, setTraining] = React.useState(() => {
    const sess = window.getTodaySession ? window.getTodaySession() : null;
    return !!sess;
  });
  const [trainTime, setTrainTime] = React.useState("ore17");
  const [cardio, setCardio]       = React.useState(false);
  const [cardioType, setCardioType] = React.useState("camminata");
  const [cardioMin, setCardioMin]   = React.useState(30);

  // Supplement check state — keyed by today
  const today = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  const [checked, setChecked] = React.useState(() =>
    window.storage ? window.storage.get(`integ_${today}`, {}) : {}
  );

  const toggleSupp = (type) => {
    setChecked(c => {
      const next = { ...c, [type]: !c[type] };
      if (window.storage) window.storage.set(`integ_${today}`, next);
      if (navigator.vibrate) navigator.vibrate([40]);
      return next;
    });
  };

  const dayType    = training ? trainTime : "riposo";
  const section    = dieta[dayType] || dieta.riposo;
  const meals      = section.meals || [];
  const supps      = _SUPPS_MAP[dayType] || _SUPPS_RIPOSO;

  const baseKcal   = meals.reduce((s, m) => s + (m.kcal || 0), 0);
  const ct         = _CARDIO_TYPES.find(c => c.id === cardioType) || _CARDIO_TYPES[0];
  const cardioBurn = cardio ? Math.round(cardioMin * ct.kcalMin) : 0;
  const netKcal    = baseKcal + (cardio ? Math.round(cardioBurn * 0.6) : 0);

  // Build unified timeline
  const timeline = _buildTimeline(meals, supps);

  // Supplement summary for header badge
  const doneCount = supps.filter(s => checked[s.type]).length;
  const allSuppsDone = doneCount === supps.length;

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 18 : 14 }}>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Piano alimentare")}</div>
        <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Dieta")}</h1>
      </div>

      {/* Activity card */}
      <div className="card" style={{ padding: isDesktop ? 18 : 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Attività di oggi")}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {!training && !cardio && "💤 " + t("Riposo")}
            {training && !cardio && "💪 " + t("Solo pesi")}
            {!training && cardio && "🔥 " + t("Solo cardio")}
            {training && cardio && "🔥 " + t("Pesi + cardio")}
          </div>
        </div>

        {/* Allenamento row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: training ? "rgba(10,132,255,0.2)" : "var(--card-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.18s" }}>
            <Icon name="dumbbell" size={17} color={training ? "var(--accent)" : "var(--text-2)"} strokeWidth={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Allenamento pesi")}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
              {window.getTodaySession
                ? (window.getTodaySession()?.label || t("Giorno di riposo"))
                : t("Seleziona orario")}
            </div>
          </div>
          <div className={`ios-toggle blue ${training ? "on" : ""}`} onClick={() => setTraining(v => !v)} />
        </div>

        {training && (
          <div className="fade-up" style={{ paddingLeft: 46, paddingTop: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Orario sessione")}</div>
            <div className="hscroll" style={{ marginLeft: 0, marginRight: 0, paddingLeft: 0, paddingRight: 0 }}>
              {_DAY_TYPES.map(d => {
                const on = trainTime === d.id;
                return (
                  <button key={d.id} onClick={() => setTrainTime(d.id)} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "7px 12px", border: 0,
                    background: on ? "var(--accent)" : "var(--card-2)",
                    color: on ? "#fff" : "var(--text)",
                    borderRadius: 999, fontSize: 12.5, fontWeight: on ? 600 : 500,
                    cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.16s", marginRight: 4,
                  }}>
                    <span>{d.emoji}</span>{t(d.label)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />

        {/* Cardio row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: cardio ? "rgba(255,69,58,0.2)" : "var(--card-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.18s" }}>
            <Icon name="flame" size={17} color={cardio ? "#FF453A" : "var(--text-2)"} strokeWidth={1.8} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Cardio")}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
              {cardio
                ? <>{ct.emoji} {t(ct.label)} · <span className="num">{cardioMin}</span>′ · ~<span className="num" style={{ color: "#FF9F0A", fontWeight: 600 }}>{cardioBurn}</span> kcal</>
                : t("Corsa, bike, ellittica, camminata…")}
            </div>
          </div>
          <div className={`ios-toggle ${cardio ? "on" : ""}`} style={{ background: cardio ? "#FF453A" : undefined }} onClick={() => setCardio(v => !v)} />
        </div>

        {cardio && (
          <div className="fade-up" style={{ paddingLeft: 46, paddingTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>{t("Tipo")}</div>
              <div className="hscroll" style={{ marginLeft: 0, marginRight: 0, paddingLeft: 0, paddingRight: 0 }}>
                {_CARDIO_TYPES.map(ct2 => {
                  const on = cardioType === ct2.id;
                  return (
                    <button key={ct2.id} onClick={() => setCardioType(ct2.id)} style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "7px 12px", border: 0,
                      background: on ? "#FF453A" : "var(--card-2)",
                      color: on ? "#fff" : "var(--text)",
                      borderRadius: 999, fontSize: 12.5, fontWeight: on ? 600 : 500,
                      cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.16s", marginRight: 4,
                    }}>
                      <span>{ct2.emoji}</span>{t(ct2.label)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Durata")}</div>
                <div className="num" style={{ fontSize: 12, fontWeight: 600 }}>{cardioMin} min</div>
              </div>
              <input type="range" min="10" max="120" step="5" value={cardioMin}
                onChange={(e) => setCardioMin(parseInt(e.target.value))}
                style={{ width: "100%" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 10, color: "var(--text-3)" }}>
                <span>10</span><span>30</span><span>60</span><span>90</span><span>120</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Daily macros */}
      <div className="card" style={{ padding: isDesktop ? 18 : 14, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
        {[
          { label: t("kcal"), value: netKcal > 0 ? netKcal : "—", c: "var(--text)" },
          { label: t("proteine"), value: "180g", c: "#0A84FF" },
          { label: t("carbo"),    value: "240g", c: "#FF9F0A" },
          { label: t("grassi"),   value: "70g",  c: "#30D158" },
        ].map(m => (
          <div key={m.label}>
            <div className="num" style={{ fontSize: isDesktop ? 22 : 19, fontWeight: 600, color: m.c, letterSpacing: -0.02 }}>{m.value}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", letterSpacing: 0.4, textTransform: "uppercase", fontWeight: 500, marginTop: 1 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {/* Chronological timeline */}
      <div style={{ position: "relative" }}>
        {/* Slider + supplement badge as sticky header above list */}
        <div style={{ marginBottom: isDesktop ? 14 : 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <DayTimeSlider timeline={timeline} />
          {/* Supplement summary badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 14px", borderRadius: 12,
            background: allSuppsDone ? "rgba(48,209,88,0.1)" : "rgba(255,159,10,0.08)",
            border: `1px solid ${allSuppsDone ? "rgba(48,209,88,0.25)" : "rgba(255,159,10,0.2)"}`,
          }}>
            <Icon name="pill" size={16} color={allSuppsDone ? "var(--success)" : "#FF9F0A"} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
              {allSuppsDone ? "✓ " + t("Tutti gli integratori assunti") : t("Integratori oggi")}
            </div>
            <span className="num" style={{
              fontSize: 12.5, fontWeight: 700,
              color: allSuppsDone ? "var(--success)" : "#FF9F0A",
            }}>
              {doneCount}/{supps.length}
            </span>
          </div>
        </div>
        {/* Vertical guide line */}
        <div style={{
          position: "absolute", top: 16, bottom: 16,
          left: isDesktop ? 22 : 18, width: 2,
          background: "linear-gradient(to bottom, var(--accent) 0%, transparent 100%)",
          opacity: 0.25,
        }} />

        <div style={{ display: "flex", flexDirection: "column", gap: isDesktop ? 10 : 8, paddingLeft: isDesktop ? 52 : 42 }}>
          {timeline.map((item, i) => {
            const isPast = item._mins <= ((() => {
              const d = new Date();
              return d.getHours() * 60 + d.getMinutes();
            })());
            return (
              <div key={`${item.kind}-${i}`} style={{ position: "relative" }}>
                {/* Timeline dot */}
                <div style={{
                  position: "absolute",
                  left: isDesktop ? -38 : -30,
                  top: item.kind === "meal" ? 20 : 14,
                  width: item.kind === "meal" ? 14 : 10,
                  height: item.kind === "meal" ? 14 : 10,
                  borderRadius: 999,
                  background: isPast
                    ? (item.kind === "meal" ? "var(--accent)" : (item.color || "#FF9F0A"))
                    : "var(--card-2)",
                  border: `2px solid ${item.kind === "meal" ? "var(--accent)" : (item.color || "#FF9F0A")}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isPast && item.kind === "meal" && (
                    <div style={{ width: 5, height: 5, borderRadius: 999, background: "#fff", opacity: 0.9 }} />
                  )}
                </div>

                {/* Time label to the left */}
                <div style={{
                  position: "absolute",
                  left: isDesktop ? -94 : -40,
                  top: item.kind === "meal" ? 18 : 12,
                  fontSize: 10, fontWeight: 600,
                  color: isPast ? "var(--text-2)" : "var(--text-3)",
                  whiteSpace: "nowrap",
                  display: isDesktop ? "block" : "none",
                }}>
                  {item.kind === "meal" ? item.time : item.sortTime}
                </div>

                {item.kind === "meal" ? (
                  <MealCard meal={item} isDesktop={isDesktop} />
                ) : (
                  <SupplementRow supp={item} checked={checked} onToggle={toggleSupp} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {timeline.length === 0 && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🍽️</div>
          <div className="muted">{t("Nessun pasto in questa configurazione")}</div>
        </div>
      )}

      {/* Excluded foods reminder */}
      <div className="card" style={{ padding: 12, border: "1px solid rgba(255,69,58,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🚫</span>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--danger)" }}>{t("Escludere sempre")}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              Pasta di ceci · Pasta di lenticchie · Pasta di piselli · Bevanda di mandorla
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

window.Dieta = Dieta;
