// spesa.jsx — Shopping list with frequency-aware quantities

// qty1 = quantità per 1 spesa/settimana (tutta la settimana in una volta)
// qty2 = quantità per 1 delle 2 spese/settimana (metà settimana per trip)
const CATEGORIES = [
  {
    id: "proteine",
    title: "Proteine",
    color: "#FF453A",
    icon: "flame",
    items: [
      { name: "Petto di pollo",          qty1: "900 g",    qty2: "500 g" },
      { name: "Salmone fresco",           qty1: "400 g",    qty2: "300 g",  note: "🧊 compra fresco" },
      { name: "Uova di gallina",          qty1: "18",       qty2: "10" },
      { name: "Bresaola",                 qty1: "200 g",    qty2: "150 g" },
      { name: "Tonno al naturale",        qty1: "4 sc.",    qty2: "2 sc." },
      { name: "Merluzzo surgelato",       qty1: "800 g",    qty2: "500 g" },
      { name: "Orata surgelata",          qty1: "600 g",    qty2: "400 g" },
      { name: "Hamburger di chianina",    qty1: "280 g",    qty2: "150 g" },
      { name: "Petto di tacchino",        qty1: "400 g",    qty2: "250 g" },
    ],
  },
  {
    id: "carbo",
    title: "Carboidrati",
    color: "#FF9F0A",
    icon: "bolt",
    items: [
      { name: "Riso basmati",             qty1: "1 kg",     qty2: "500 g" },
      { name: "Riso rosso integrale",     qty1: "500 g",    qty2: "250 g" },
      { name: "Pasta di farro integrale", qty1: "500 g",    qty2: "250 g" },
      { name: "Gallette grano saraceno",  qty1: "2 conf.",  qty2: "1 conf." },
      { name: "Pane di segale",           qty1: "2 pani",   qty2: "1 pane",  note: "🧊 congela il 2°" },
      { name: "Pane integrale",           qty1: "1 filone", qty2: "1 filone" },
      { name: "Muesli viviverde coop",    qty1: "500 g",    qty2: "250 g" },
    ],
  },
  {
    id: "verdura",
    title: "Verdura & Frutta",
    color: "#30D158",
    icon: "leaf",
    items: [
      { name: "Spinaci freschi",          qty1: "300 g",    qty2: "200 g",  note: "🥗 durano 3-4 gg" },
      { name: "Zucchine",                 qty1: "600 g",    qty2: "400 g" },
      { name: "Verdure di stagione",      qty1: "500 g",    qty2: "300 g" },
      { name: "Insalata mista",           qty1: "1 busta",  qty2: "1 busta" },
      { name: "Mele",                     qty1: "6",        qty2: "4" },
      { name: "Banane",                   qty1: "5",        qty2: "3" },
      { name: "Frutti di bosco",          qty1: "300 g",    qty2: "200 g" },
    ],
  },
  {
    id: "latticini",
    title: "Latticini",
    color: "#0A84FF",
    icon: "scale",
    items: [
      { name: "Yogurt greco Fage 0%",     qty1: "700 g",    qty2: "400 g" },
      { name: "Ricotta",                  qty1: "250 g",    qty2: "150 g",  note: "🥛 deperibile" },
      { name: "Parmigiano reggiano",      qty1: "150 g",    qty2: "100 g" },
      { name: "Feta",                     qty1: "150 g",    qty2: "100 g" },
      { name: "Burro chiarificato",       qty1: "1 vasetto",qty2: "—",      note: "⏳ se esaurito" },
    ],
  },
  {
    id: "integratori",
    title: "Integratori",
    color: "#BF5AF2",
    icon: "pill",
    items: [
      { name: "Vita C+ Slow Release",          qty1: "se esaurito", qty2: "se esaurito" },
      { name: "Vita B+",                        qty1: "se esaurito", qty2: "se esaurito" },
      { name: "Extra Omega+ Concentrated",      qty1: "se esaurito", qty2: "se esaurito" },
      { name: "PS+",                            qty1: "se esaurito", qty2: "se esaurito" },
      { name: "Gluta+",                         qty1: "se esaurito", qty2: "se esaurito" },
      { name: "MGK+ Liquid",                    qty1: "se esaurito", qty2: "se esaurito" },
      { name: "Fuel+",                          qty1: "se esaurito", qty2: "se esaurito" },
      { name: "OMNIA+",                         qty1: "se esaurito", qty2: "se esaurito" },
      { name: "Barretta 4Plus 45g",             qty1: "3 pz.",       qty2: "2 pz." },
    ],
  },
  {
    id: "dispensa",
    title: "Dispensa",
    color: "#5AC8FA",
    icon: "spark",
    items: [
      { name: "Olio extravergine di oliva",     qty1: "1 bott.",    qty2: "—",        note: "⏳ se esaurito" },
      { name: "Marmellata ridotto zucchero",    qty1: "1 vasetto",  qty2: "1 vasetto" },
      { name: "Miele",                           qty1: "1 vasetto",  qty2: "—",        note: "⏳ se esaurito" },
      { name: "Noci",                            qty1: "200 g",      qty2: "150 g" },
      { name: "Mandorle",                        qty1: "200 g",      qty2: "150 g" },
      { name: "Caffè",                           qty1: "1 conf.",    qty2: "—",        note: "⏳ se esaurito" },
    ],
  },
];

// SpesaItem must be defined BEFORE CategorySection (no hoisting for const)
const SpesaItem = ({ item, checked, onToggle, freq }) => {
  const t = useT();
  const qty = freq === 2 ? item.qty2 : item.qty1;
  return (
    <div
      onClick={(ev) => {
        if (!checked && window.Motion) window.Motion.pop(ev.currentTarget);
        onToggle();
      }}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px",
        borderTop: "1px solid var(--border)",
        cursor: "pointer",
        transition: "background 0.16s, opacity 0.18s",
        opacity: checked ? 0.5 : 1,
      }}
    >
      <div className={`check ${checked ? "on" : ""}`} style={{ width: 22, height: 22 }}>
        <Icon name="check" size={12} color="#062810" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14.5, fontWeight: 500,
          textDecoration: checked ? "line-through" : "none",
          color: checked ? "var(--text-2)" : "var(--text)",
          transition: "color 0.16s",
        }}>{item.name}</div>
        {item.note && !checked && (
          <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>{item.note}</div>
        )}
      </div>
      {qty && qty !== "—" && (
        <span className="num pill" style={{
          fontSize: 11.5, padding: "3px 9px",
          background: qty === "se esaurito" ? "rgba(191,90,242,0.12)" : "var(--card-2)",
          color: qty === "se esaurito" ? "#BF5AF2" : "var(--text-2)",
          fontWeight: 600, whiteSpace: "nowrap",
        }}>{qty === "se esaurito" ? t("se esaurito") : qty}</span>
      )}
      {qty === "—" && (
        <span style={{ fontSize: 11.5, color: "var(--text-3)", fontStyle: "italic" }}>—</span>
      )}
    </div>
  );
};

const CategorySection = ({ cat, checked, onToggle, isDesktop, freq }) => {
  const t = useT();
  const total = cat.items.length;
  const done = cat.items.filter((_, i) => checked[`${cat.id}-${i}`]).length;
  return (
    <div className="card lift" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px",
        background: `linear-gradient(90deg, ${cat.color}22 0%, transparent 100%)`,
        borderLeft: `3px solid ${cat.color}`,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${cat.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={cat.icon} size={16} color={cat.color} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.01 }}>{t(cat.title)}</div>
          <div className="num muted" style={{ fontSize: 11.5 }}>{done} / {total}</div>
        </div>
        <div style={{ width: 60, height: 4, borderRadius: 2, background: "var(--track)", overflow: "hidden" }}>
          <div style={{ width: `${(done / total) * 100}%`, height: "100%", background: cat.color, transition: "width 0.3s" }} />
        </div>
      </div>
      {cat.items.map((it, i) => (
        <SpesaItem
          key={i}
          item={it}
          freq={freq}
          checked={!!checked[`${cat.id}-${i}`]}
          onToggle={() => onToggle(`${cat.id}-${i}`)}
        />
      ))}
    </div>
  );
};

const Spesa = ({ device, spesaChecked, setSpesaChecked, spesaFreq, setSpesaFreq }) => {
  const isDesktop = device === "desktop";
  const t = useT();

  // Stato locale di fallback (usato solo se i props non vengono passati)
  const [_localChecked, _setLocalChecked] = React.useState(() =>
    window.storage ? window.storage.get("spesaChecked", {}) : {}
  );
  const [_localFreq, _setLocalFreq] = React.useState(() =>
    window.storage ? window.storage.get("spesaFreq", 1) : 1
  );

  // Usa i props se disponibili (modalità controllata da AppFrame), altrimenti locale
  const checked = spesaChecked !== undefined ? spesaChecked : _localChecked;
  const freq    = spesaFreq    !== undefined ? spesaFreq    : _localFreq;

  const setChecked = (next) => {
    if (setSpesaChecked) {
      setSpesaChecked(next); // AppFrame gestisce storage + cloud sync
    } else {
      _setLocalChecked(next);
      if (window.storage) window.storage.set("spesaChecked", next);
      if (window.sheetsAPI) window.sheetsAPI.saveSettings({ key: "spesaChecked2", value: JSON.stringify(next) }).catch(() => {});
    }
  };

  const setFreq = (f) => {
    if (setSpesaFreq) {
      setSpesaFreq(f); // AppFrame gestisce storage + cloud sync
    } else {
      _setLocalFreq(f);
      if (window.storage) window.storage.set("spesaFreq", f);
      if (window.sheetsAPI) window.sheetsAPI.saveSettings({ key: "spesaFreq", value: String(f) }).catch(() => {});
    }
  };

  const toggle = (k) => {
    if (navigator.vibrate) navigator.vibrate([50]);
    setChecked({ ...checked, [k]: !checked[k] });
  };

  // Articoli extra manuali (oltre a quelli generati dalla dieta). Id stabile
  // (timestamp) → le spunte non si spostano quando rimuovi un articolo.
  // Sincati come chiave Settings "spesaExtra" (pull in _cloudSync).
  const [extra, setExtra] = React.useState(() =>
    window.storage ? window.storage.get("spesaExtra", []) : []
  );
  const [newItem, setNewItem] = React.useState("");
  const saveExtra = (next) => {
    setExtra(next);
    if (window.storage) window.storage.set("spesaExtra", next);
    if (window._saveSettingRetry) window._saveSettingRetry("spesaExtra", JSON.stringify(next));
  };
  const addExtra = () => {
    const name = newItem.trim();
    if (!name) return;
    saveExtra([...extra, { id: Date.now(), name }]);
    setNewItem("");
  };
  const removeExtra = (id) => {
    saveExtra(extra.filter(e => e.id !== id));
    const k = `extra-${id}`;
    if (checked[k]) {
      const c = { ...checked };
      delete c[k];
      setChecked(c);
    }
  };

  const changeFreq = (f) => {
    setFreq(f);
    setChecked({}); // reset lista quando cambia frequenza
  };

  const reset = () => {
    setChecked({});
  };

  const totalItems = CATEGORIES.reduce((n, c) => n + c.items.length, 0) + extra.length;
  const totalDone = Object.values(checked).filter(Boolean).length;

  return (
    <div className="fade-up" style={{ padding: isDesktop ? "32px 40px" : "10px 16px 24px", display: "flex", flexDirection: "column", gap: isDesktop ? 18 : 14 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", letterSpacing: 0.5, textTransform: "uppercase" }}>{t("Settimanale")}</div>
          <h1 style={{ fontSize: isDesktop ? 28 : 24, fontWeight: 600 }}>{t("Lista spesa")}</h1>
        </div>
        <button className="btn ghost" style={{ padding: "8px 12px", fontSize: 13, color: "var(--accent)" }} onClick={reset}>
          <Icon name="refresh" size={14} /> {t("Reset")}
        </button>
      </div>

      {/* Frequency picker */}
      <div className="card" style={{ padding: isDesktop ? 16 : 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 10 }}>
          🛒 {t("Quante volte fai la spesa a settimana?")}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { v: 1, label: "1 volta",  sub: "tutto in una botta" },
            { v: 2, label: "2 volte",  sub: "metà + metà settimana" },
          ].map(opt => {
            const on = freq === opt.v;
            return (
              <button
                key={opt.v}
                onClick={() => changeFreq(opt.v)}
                style={{
                  flex: 1, padding: "12px 10px", border: 0, borderRadius: 12, cursor: "pointer",
                  background: on ? "var(--accent)" : "var(--card-2)",
                  boxShadow: on ? "none" : "inset 0 0 0 1px var(--border)",
                  transition: "all 0.16s", textAlign: "left",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: on ? "#fff" : "var(--text)", marginBottom: 2 }}>
                  {t(opt.label)}
                </div>
                <div style={{ fontSize: 11, color: on ? "rgba(255,255,255,0.75)" : "var(--text-3)" }}>
                  {t(opt.sub)}
                </div>
              </button>
            );
          })}
        </div>
        {freq === 2 && (
          <div className="fade-up" style={{ marginTop: 10, fontSize: 12, color: "var(--text-3)", padding: "7px 10px", background: "rgba(10,132,255,0.06)", borderRadius: 9 }}>
            💡 {t("Le quantità mostrate sono per")} <strong style={{ color: "var(--text-2)" }}>{t("una singola uscita")}</strong> {t("(metà settimana). Ripeti all'altra metà.")}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontSize: 13.5 }}>
            <span className="num" style={{ fontSize: 18, fontWeight: 600 }}>{totalDone}</span>
            <span className="muted"> / {totalItems} {t("articoli")}</span>
          </div>
          <div className="num muted" style={{ fontSize: 12 }}>{Math.round((totalDone / totalItems) * 100)}%</div>
        </div>
        <div className="bar" style={{ height: 6 }}>
          <i style={{ width: `${(totalDone / totalItems) * 100}%`, background: "linear-gradient(90deg, #30D158 0%, #5AC8FA 100%)" }} />
        </div>
      </div>

      {totalDone > 0 && totalDone === totalItems && (
        <UIEmpty icon="check" title={t("Spesa completata")} sub={t("Hai preso tutto — ottimo!")} style={{ padding: "18px 16px 6px" }} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: isDesktop ? 16 : 12 }}>
        {CATEGORIES.map(cat => (
          <CategorySection key={cat.id} cat={cat} checked={checked} onToggle={toggle} isDesktop={isDesktop} freq={freq} />
        ))}
      </div>

      {/* Articoli extra manuali */}
      <div className="card lift" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
          background: "linear-gradient(90deg, rgba(191,90,242,0.13) 0%, transparent 100%)",
          borderLeft: "3px solid #BF5AF2",
        }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(191,90,242,0.13)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name="plus" size={16} color="#BF5AF2" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.01 }}>{t("Extra")}</div>
            <div className="num muted" style={{ fontSize: 11.5 }}>
              {extra.filter(e => checked[`extra-${e.id}`]).length} / {extra.length}
            </div>
          </div>
        </div>
        {extra.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--border)", opacity: checked[`extra-${e.id}`] ? 0.5 : 1 }}>
            <div
              onClick={(ev) => {
                if (!checked[`extra-${e.id}`] && window.Motion) window.Motion.pop(ev.currentTarget);
                toggle(`extra-${e.id}`);
              }}
              className={`check ${checked[`extra-${e.id}`] ? "on" : ""}`}
              style={{ width: 22, height: 22, cursor: "pointer", flexShrink: 0 }}
            >
              <Icon name="check" size={12} color="#062810" />
            </div>
            <div
              onClick={() => toggle(`extra-${e.id}`)}
              style={{
                flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 500, cursor: "pointer",
                textDecoration: checked[`extra-${e.id}`] ? "line-through" : "none",
                color: checked[`extra-${e.id}`] ? "var(--text-2)" : "var(--text)",
              }}
            >{e.name}</div>
            <button
              onClick={() => removeExtra(e.id)}
              aria-label={t("Rimuovi")}
              style={{ width: 28, height: 28, borderRadius: 999, background: "transparent", border: 0, color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <Icon name="x" size={13} strokeWidth={2.2} />
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: extra.length ? "1px solid var(--border)" : 0 }}>
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addExtra(); }}
            placeholder={t("Aggiungi articolo…")}
            className="input"
            style={{ flex: 1, fontSize: 14, padding: "10px 12px" }}
          />
          <button className="btn" style={{ padding: "0 16px", fontSize: 13, fontWeight: 600 }} onClick={addExtra} disabled={!newItem.trim()}>
            <Icon name="plus" size={14} /> {t("Aggiungi")}
          </button>
        </div>
      </div>
    </div>
  );
};

window.Spesa = Spesa;
