// anatomy.jsx — Stylized anatomical silhouette with muscle group highlights
// Used in: Dashboard weekly summary, Scheda exercise targeting

// Muscle groups: petto, schiena, spalle, bicipiti, tricipiti, addome,
// quadricipiti, femorali, polpacci, glutei

const MUSCLES = {
  petto:        { label: "Petto",        kind: "front" },
  spalle:       { label: "Spalle",       kind: "front" },
  bicipiti:     { label: "Bicipiti",     kind: "front" },
  addome:       { label: "Addome",       kind: "front" },
  quadricipiti: { label: "Quadricipiti", kind: "front" },
  schiena:      { label: "Schiena",      kind: "back" },
  tricipiti:    { label: "Tricipiti",    kind: "back" },
  femorali:     { label: "Femorali",     kind: "back" },
  polpacci:     { label: "Polpacci",     kind: "back" },
  glutei:       { label: "Glutei",       kind: "back" },
  trapezi:      { label: "Trapezi",      kind: "back" },
};

// SVG path data for each muscle (in 100×220 viewBox; left front body)
const FRONT_PATHS = {
  petto:
    "M50 50 C 56 50 62 52 64 58 C 66 64 64 70 60 73 C 56 74 52 74 50 73 C 48 74 44 74 40 73 C 36 70 34 64 36 58 C 38 52 44 50 50 50 Z",
  spalle:
    "M32 47 C 28 47 24 51 24 56 C 24 61 28 63 32 62 C 36 60 38 56 38 52 Z M68 47 C 72 47 76 51 76 56 C 76 61 72 63 68 62 C 64 60 62 56 62 52 Z",
  bicipiti:
    "M24 58 C 21 58 19 62 19 70 C 18 78 19 84 22 84 C 25 84 27 80 27 74 C 27 68 26 62 24 58 Z M76 58 C 79 58 81 62 81 70 C 82 78 81 84 78 84 C 75 84 73 80 73 74 C 73 68 74 62 76 58 Z",
  addome:
    "M42 74 L 58 74 L 58 110 C 58 113 55 115 50 115 C 45 115 42 113 42 110 Z",
  quadricipiti:
    "M40 118 C 36 118 33 122 33 130 L 35 165 C 36 170 40 172 44 170 L 47 130 C 47 122 44 118 40 118 Z M60 118 C 64 118 67 122 67 130 L 65 165 C 64 170 60 172 56 170 L 53 130 C 53 122 56 118 60 118 Z",
};

const BACK_PATHS = {
  trapezi:
    "M50 42 C 44 44 38 48 36 54 C 40 56 46 57 50 57 C 54 57 60 56 64 54 C 62 48 56 44 50 42 Z",
  schiena:
    "M38 58 C 36 64 36 76 38 92 C 42 100 50 102 50 102 C 50 102 58 100 62 92 C 64 76 64 64 62 58 C 58 60 54 60 50 60 C 46 60 42 60 38 58 Z",
  tricipiti:
    "M24 58 C 21 58 19 62 19 70 C 18 78 19 84 22 84 C 25 84 27 80 27 74 C 27 68 26 62 24 58 Z M76 58 C 79 58 81 62 81 70 C 82 78 81 84 78 84 C 75 84 73 80 73 74 C 73 68 74 62 76 58 Z",
  glutei:
    "M38 104 C 36 110 36 116 42 120 C 46 121 50 121 50 121 C 50 121 54 121 58 120 C 64 116 64 110 62 104 C 58 106 54 106 50 106 C 46 106 42 106 38 104 Z",
  femorali:
    "M40 124 C 36 124 33 128 33 136 L 35 165 C 36 170 40 172 44 170 L 47 136 C 47 128 44 124 40 124 Z M60 124 C 64 124 67 128 67 136 L 65 165 C 64 170 60 172 56 170 L 53 136 C 53 128 56 124 60 124 Z",
  polpacci:
    "M40 175 C 37 175 35 180 36 190 L 38 205 C 40 207 43 207 44 205 L 45 188 C 45 180 43 175 40 175 Z M60 175 C 63 175 65 180 64 190 L 62 205 C 60 207 57 207 56 205 L 55 188 C 55 180 57 175 60 175 Z",
};

// Body silhouette outline (stylized, two views side-by-side)
const BodyOutline = ({ view = "front" }) => (
  <g>
    {/* head */}
    <ellipse cx="50" cy="20" rx="11" ry="13" />
    {/* neck */}
    <path d="M44 31 L44 38 C 44 40 56 40 56 38 L 56 31 Z" />
    {/* torso + arms + legs */}
    {view === "front" ? (
      <path d="M30 44 C 32 42 38 40 50 40 C 62 40 68 42 70 44 L 78 56 C 82 68 82 80 80 86 C 78 88 76 86 75 82 L 68 74 L 68 110 C 68 116 66 122 67 130 L 70 170 C 71 180 70 188 68 195 L 62 210 C 60 212 56 212 55 208 L 54 175 L 52 130 L 50 128 L 48 130 L 46 175 L 45 208 C 44 212 40 212 38 210 L 32 195 C 30 188 29 180 30 170 L 33 130 C 34 122 32 116 32 110 L 32 74 L 25 82 C 24 86 22 88 20 86 C 18 80 18 68 22 56 Z" />
    ) : (
      <path d="M30 44 C 32 42 38 40 50 40 C 62 40 68 42 70 44 L 78 56 C 82 68 82 80 80 86 C 78 88 76 86 75 82 L 68 74 L 68 110 C 68 116 66 122 67 130 L 70 170 C 71 180 70 188 68 195 L 62 210 C 60 212 56 212 55 208 L 54 175 L 52 130 L 50 128 L 48 130 L 46 175 L 45 208 C 44 212 40 212 38 210 L 32 195 C 30 188 29 180 30 170 L 33 130 C 34 122 32 116 32 110 L 32 74 L 25 82 C 24 86 22 88 20 86 C 18 80 18 68 22 56 Z" />
    )}
  </g>
);

// Helper to render highlighted muscle paths
const MusclePaths = ({ view, active, color }) => {
  const paths = view === "front" ? FRONT_PATHS : BACK_PATHS;
  return (
    <g>
      {Object.entries(paths).map(([key, d]) => {
        const isActive = active.includes(key);
        return (
          <path
            key={key}
            d={d}
            fill={isActive ? color : "transparent"}
            stroke={isActive ? color : "none"}
            strokeOpacity={isActive ? 0.6 : 0}
            strokeWidth="0.6"
            style={{ transition: "fill 0.3s, stroke-opacity 0.3s" }}
          />
        );
      })}
    </g>
  );
};

// Main Anatomy component
//  active: array of muscle keys to highlight
//  view: "front" | "back" | "both"
//  height: SVG height in px (width auto)
//  color: highlight color
const Anatomy = ({ active = [], view = "both", height = 260, color = "var(--accent)" }) => {
  const showBoth = view === "both";
  const w = showBoth ? 220 : 110;
  return (
    <svg
      viewBox={`0 0 ${w} 220`}
      width="auto"
      height={height}
      style={{ display: "block" }}
    >
      <g stroke="rgba(255,255,255,0.16)" strokeWidth="0.6" fill="rgba(255,255,255,0.04)">
        {(view === "front" || showBoth) && (
          <g>
            <BodyOutline view="front" />
            <MusclePaths view="front" active={active} color={color} />
          </g>
        )}
        {(view === "back" || showBoth) && (
          <g transform={showBoth ? "translate(110 0)" : ""}>
            <BodyOutline view="back" />
            <MusclePaths view="back" active={active} color={color} />
          </g>
        )}
      </g>
      {showBoth && (
        <g fill="rgba(142,142,147,0.65)" fontFamily="var(--display)" fontSize="7" fontWeight="500" textAnchor="middle">
          <text x="50" y="218">FRONT</text>
          <text x="160" y="218">BACK</text>
        </g>
      )}
    </svg>
  );
};

window.Anatomy = Anatomy;
window.MUSCLES = MUSCLES;
