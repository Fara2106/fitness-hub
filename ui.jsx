// ui.jsx — componenti condivisi del design system (Redesign 2026-07)
// Regole: colori SOLO via token CSS; --brand-grad è l'unico colore di marca;
// bersagli touch ≥ 44pt; niente <form>; ogni componente esposto su window.

const UIAvatarLF = ({ size = 34, onClick }) => (
  <button
    onClick={onClick}
    aria-label="Profilo"
    style={{
      width: size, height: size,
      minWidth: 44, minHeight: 44,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "transparent", border: 0, padding: 0, cursor: "pointer",
    }}
  >
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.29),
      background: "var(--brand-grad)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: Math.round(size * 0.44), letterSpacing: "-0.03em",
      color: "#fff",
    }}>LF</span>
  </button>
);

const UIHeader = ({ eyebrow, title, right, onProfile }) => (
  <div style={{
    display: "flex", alignItems: "flex-end", justifyContent: "space-between",
    gap: 10, padding: "4px 4px 0",
  }}>
    <div style={{ minWidth: 0 }}>
      {eyebrow ? <div className="ui-cap" style={{ marginBottom: 2 }}>{eyebrow}</div> : null}
      <div style={{
        fontFamily: "var(--display)", fontSize: 24, fontWeight: 700,
        letterSpacing: "-0.02em", lineHeight: 1.1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{title}</div>
    </div>
    {right != null ? right : (onProfile ? <UIAvatarLF onClick={onProfile} /> : null)}
  </div>
);

const UICard = ({ hero, style, onClick, children }) => (
  <div
    className={"ui-card" + (hero ? " ui-card--hero" : "") + (onClick ? " pressable" : "")}
    onClick={onClick}
    style={onClick ? Object.assign({ cursor: "pointer" }, style) : style}
  >
    {children}
  </div>
);

const UIRow = ({ icon, title, sub, value, chevron, onClick, children }) => (
  <div
    onClick={onClick}
    className={onClick ? "pressable" : undefined}
    style={{
      display: "flex", alignItems: "center", gap: 10,
      minHeight: 44, padding: "4px 0",
      cursor: onClick ? "pointer" : "default",
    }}
  >
    {icon ? (
      <span style={{
        width: 30, height: 30, borderRadius: 9, flexShrink: 0,
        background: "var(--card-2)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-2)",
      }}>
        <Icon name={icon} size={15} strokeWidth={1.8} />
      </span>
    ) : null}
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
      {sub ? <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{sub}</span> : null}
    </span>
    {children}
    {value != null ? (
      <span className="tnum" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{value}</span>
    ) : null}
    {chevron ? <span style={{ color: "var(--text-3)", fontSize: 16, fontWeight: 600 }}>›</span> : null}
  </div>
);

const UISegmented = ({ options, value, onChange, mini }) => (
  <div style={{
    display: "flex", gap: 3, padding: 3,
    background: "var(--card)", border: "1px solid var(--border)",
    borderRadius: 11, flex: mini ? "0 0 auto" : 1,
  }}>
    {options.map(op => {
      const on = op.id === value;
      return (
        <button
          key={op.id}
          onClick={() => onChange(op.id)}
          style={{
            flex: mini ? "0 0 auto" : 1,
            minHeight: mini ? 30 : 38,
            padding: mini ? "4px 10px" : "7px 8px",
            textAlign: "center",
            fontSize: mini ? 11.5 : 12.5, fontWeight: 600,
            color: on ? "#fff" : "var(--text-2)",
            background: on ? "var(--brand-grad)" : "transparent",
            border: 0, borderRadius: 8, cursor: "pointer",
            transition: "color 0.15s",
          }}
        >{op.label}</button>
      );
    })}
  </div>
);

const UIChip = ({ active, onClick, children }) => (
  <span
    onClick={onClick}
    style={{
      fontSize: 11, fontWeight: 500,
      color: active ? "#fff" : "var(--text-2)",
      background: active ? "var(--brand-grad)" : "var(--card-2)",
      border: "1px solid " + (active ? "transparent" : "var(--border)"),
      borderRadius: 999, padding: "3px 9px",
      cursor: onClick ? "pointer" : "default",
      whiteSpace: "nowrap",
    }}
  >{children}</span>
);

const UIProgress = ({ value, height = 4 }) => (
  <div style={{ height, borderRadius: 999, background: "var(--track)", overflow: "hidden" }}>
    <div style={{
      height: "100%", borderRadius: 999,
      width: Math.max(0, Math.min(1, value || 0)) * 100 + "%",
      background: "var(--brand-grad)",
      transition: "width 0.25s",
    }} />
  </div>
);

const UIButton = ({ variant = "primary", disabled, onClick, style, children }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className="pressable"
    style={Object.assign({
      minHeight: 44, borderRadius: 12, border: 0,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      width: "100%", padding: "0 16px",
      fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em",
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.5 : 1,
      background: variant === "primary" ? "var(--brand-grad)" : "var(--card-2)",
      color: variant === "primary" ? "#fff" : "var(--text)",
      ...(variant === "quiet" ? { border: "1px solid var(--border)" } : {}),
    }, style)}
  >{children}</button>
);

const UIStatTile = ({ cap, value, unit, onClick, children }) => (
  <UICard onClick={onClick} style={{ flex: 1, minWidth: 0 }}>
    <div className="ui-cap" style={{ marginBottom: 4 }}>{cap}</div>
    <div className="tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
      {value}{unit ? <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginLeft: 3 }}>{unit}</span> : null}
    </div>
    {children}
  </UICard>
);

const UISheet = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="ui-sheet-backdrop" onClick={onClose}>
      <div className="ui-sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Chiudi"
            style={{
              minWidth: 44, minHeight: 44, border: 0, background: "transparent",
              color: "var(--text-2)", fontSize: 17, cursor: "pointer",
            }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// — Empty state disegnato (icona + titolo + sottotesto + azione opzionale) —
const UIEmpty = ({ icon = "spark", title, sub, action, style }) => (
  <div style={Object.assign({
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 10, padding: "36px 28px", textAlign: "center",
  }, style)}>
    <span style={{
      width: 58, height: 58, borderRadius: 18,
      background: "var(--card)", border: "1px solid var(--border)",
      boxShadow: "var(--shadow-1), inset 0 1px 0 var(--hair-top)",
      display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)",
    }}>
      <Icon name={icon} size={26} strokeWidth={1.7} />
    </span>
    <span style={{ fontSize: 16, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</span>
    {sub ? <span className="muted" style={{ fontSize: 13, maxWidth: 260, lineHeight: 1.5 }}>{sub}</span> : null}
    {action || null}
  </div>
);

// — Skeleton shimmer (placeholder di caricamento) —
const UISkeleton = ({ h = 14, w = "100%", r = 8, style }) => (
  <span className="skeleton" style={Object.assign({ display: "block", height: h, width: w, borderRadius: r }, style)} />
);

// — Numero animato: al cambio di `value` conta dal valore precedente (Motion.countTo) —
const UIAnimatedNumber = ({ value, decimals = 1 }) => {
  const ref = React.useRef(null);
  const prev = React.useRef(value);
  React.useEffect(() => {
    if (prev.current !== value && ref.current && window.Motion) {
      window.Motion.countTo(ref.current, prev.current, value, { decimals });
    }
    prev.current = value;
  }, [value, decimals]);
  return <span ref={ref} className="tnum">{Number(value).toFixed(decimals)}</span>;
};

window.UIAvatarLF = UIAvatarLF;
window.UIHeader   = UIHeader;
window.UICard     = UICard;
window.UIRow      = UIRow;
window.UISegmented = UISegmented;
window.UIChip     = UIChip;
window.UIProgress = UIProgress;
window.UIButton   = UIButton;
window.UIStatTile = UIStatTile;
window.UISheet    = UISheet;
window.UIEmpty    = UIEmpty;
window.UISkeleton = UISkeleton;
window.UIAnimatedNumber = UIAnimatedNumber;

// ── Recharts on-demand ──────────────────────────────────────────────────────
// ~500 KB usati solo da Storico: iniettati al primo ingresso invece che a ogni
// avvio (index.html non li carica più). prop-types DEVE precedere Recharts
// (l'UMD legge il globale window.PropTypes — senza, crash "oneOfType of
// undefined"). Stessi SRI che stavano in index.html; jsdelivr è già in CSP.
window.ensureRecharts = (() => {
  let promise = null;
  const inject = (src, integrity) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("CDN non raggiungibile: " + src));
    document.head.appendChild(s);
  });
  return function ensureRecharts() {
    if (window.Recharts) return Promise.resolve(window.Recharts);
    if (promise) return promise;
    promise = inject(
      "https://cdn.jsdelivr.net/npm/prop-types@15.8.1/prop-types.min.js",
      "sha384-/AfDwVDXNopzPvhxMPQ11y1OCpR6mVkWx47qzSwIiquvxkcMkZddEzDNtIOtfCpk"
    ).then(() => inject(
      "https://cdn.jsdelivr.net/npm/recharts@2.12.7/umd/Recharts.js",
      "sha384-d1XH4LhwLW8j0l6VXMP8yJabdGY9ZqtZk7k7PaPk5NoUCcZ/hDkL5aaKioKQbcZg"
    )).then(() => window.Recharts)
      .catch(e => { promise = null; throw e; });
    return promise;
  };
})();
