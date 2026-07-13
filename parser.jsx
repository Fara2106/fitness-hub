// parser.jsx — Parse scheda.txt  +  dieta.txt
// window.parseScheda(text)  →  { days: [ {num,key,name,focus,exercises,altMap} ] }  (N giorni dinamici)
// window.getSchedule() / window.getSelectedSession()  — unica fonte di verità sui giorni
// window.parseDieta(text)   →  { riposo, mattina, ore17, ore21, ore22 }  each = { meals, integratori }

// ── MUSCLE DETECTION ───────────────────────────────────────────────────────
const _MUSCLE_MAP = [
  [["pettorale","gran pettorale","petto","pettorale superiore","pettorale basso","pettorale medio"], "petto"],
  [["dorsale","gran dorsale","romboidi","teres","latissimus"], "schiena"],
  [["deltoide","spalle","deltoide anteriore","deltoide posteriore","deltoide mediale"], "spalle"],
  [["bicipite","bicipiti"], "bicipiti"],
  [["tricipite","tricipiti"], "tricipiti"],
  [["addome","retto addominale","core","obliqui","trasverso"], "addome"],
  [["quadricipiti","quadricipite"], "quadricipiti"],
  [["femorali","ischiocrurali","ischiocrural"], "femorali"],
  [["polpacci","gastrocnemio","soleo"], "polpacci"],
  [["glutei","gluteo","gluteo grande"], "glutei"],
  [["trapezio","trapezi"], "trapezi"],
  [["erettori","lombare"], "schiena"],
  [["serrante"], "petto"],
];

function _detectMuscles(notes) {
  const found = [];
  const lower = notes.toLowerCase();
  const muscMatch = lower.match(/muscoli:\s*([^.]+)/);
  const str = muscMatch ? muscMatch[1].toLowerCase() : lower;
  _MUSCLE_MAP.forEach(([keys, val]) => {
    if (!found.includes(val) && keys.some(k => str.includes(k))) found.push(val);
  });
  return found.length ? found : ["schiena"]; // fallback
}

// ── SCHEDA PARSER ──────────────────────────────────────────────────────────
// Restituisce { days: [ { num, key, name, focus[], exercises[], altMap } ] } — lista ordinata,
// N dinamico letto dagli header "- Giorno N". Fallback legacy Upper/Lower se non ci sono header numerati.
window.parseScheda = function (text) {
  if (!text || typeof text !== "string") return { days: [] };
  const lines = text.split("\n");
  const days = [];       // lista ordinata
  let cur = null;        // giorno corrente
  let inTable = false;

  // Un header di giorno finisce con "- Giorno N" (evita falsi positivi come
  // "# Riducibile a 4 giorni: salta il Giorno 5 …" che contiene "Giorno 5" a metà frase).
  const DAY_RE = /-\s*giorno\s+(\d+)\s*$/i;
  // Se il file non ha nessun "- Giorno N", si usa il riconoscimento legacy Upper/Lower.
  const hasNumbered = lines.some(l => DAY_RE.test(l.trim().replace(/^#\s*/, "")));

  // Firma (num, key, name): key = chiave stabile ("Giorno N"), name = etichetta descrittiva.
  const startDay = (num, key, name) => {
    cur = { num, key, name, focus: [], exercises: [], altMap: {} };
    days.push(cur);
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line === "---") { cur = null; inTable = false; continue; }

    if (line.startsWith("# ")) {
      const body = line.slice(2).trim();

      if (hasNumbered) {
        const m = body.match(DAY_RE);
        if (m) {
          const num = parseInt(m[1], 10);
          const name = body.replace(DAY_RE, "").replace(/[-–·|]+\s*$/, "").trim() || ("Giorno " + num);
          startDay(num, "Giorno " + num, name);
          continue;
        }
      } else {
        const up = body.toUpperCase();
        if (up.includes("UPPER A")) { startDay(days.length + 1, "Upper A", "Upper A"); continue; }
        if (up.includes("UPPER B")) { startDay(days.length + 1, "Upper B", "Upper B"); continue; }
        if (up.includes("LOWER"))   { startDay(days.length + 1, "Lower",   "Lower");   continue; }
      }

      // Riga Focus del giorno corrente (solo la prima: le righe Focus successive non la sovrascrivono)
      const fm = body.match(/^focus:\s*(.+)$/i);
      if (fm && cur) { if (!cur.focus.length) cur.focus = fm[1].split(/[·,|]/).map(s => s.trim()).filter(Boolean); continue; }

      // Commento alternative: "# Panca → Push-up / Dip"
      if (body.includes("→") && cur) {
        const [exPart, altPart] = body.split("→").map(s => s.trim());
        if (exPart && altPart) {
          cur.altMap[exPart.toLowerCase()] = altPart.split("/").map(s => s.trim()).filter(Boolean);
        }
        continue;
      }
      continue; // altri commenti "# …" ignorati
    }

    if (!cur) continue;

    if (line.startsWith("Esercizio |")) { inTable = true; continue; }

    if (inTable && line.includes("|")) {
      const parts = line.split("|").map(s => s.trim());
      if (parts.length < 4) continue;
      const [name, setsStr, ripStr, restStr, notes = ""] = parts;
      if (!name || name.toLowerCase().includes("esercizio")) continue;

      const setsCount = parseInt(setsStr) || 3;
      const rest = parseInt(restStr) || 90;
      const muscles = _detectMuscles(notes);
      const ripMatch = ripStr.match(/(\d+)[-–](\d+)/);
      const ripVal = ripMatch ? parseInt(ripMatch[1]) : (parseInt(ripStr) || 10);
      const ripRange = ripStr;
      const sets = Array.from({ length: setsCount }, (_, si) => ({
        peso: 0, rip: ripVal, rpe: Math.min(10, 7 + si),
      }));

      cur.exercises.push({ name, muscles, sets, rest, notes, ripRange, history: [], alternatives: [] });
    }
  }

  // Aggancia le alternative per giorno
  days.forEach(d => {
    d.exercises.forEach(ex => {
      const k = Object.keys(d.altMap).find(key =>
        ex.name.toLowerCase().includes(key) || key.includes(ex.name.toLowerCase().slice(0, 8)));
      if (k) ex.alternatives = d.altMap[k];
    });
  });

  return { days };
};

// Muscoli unici aggregati dagli esercizi (fallback quando manca il Focus del giorno).
function _musclesFromExercises(exercises) {
  const seen = [];
  (exercises || []).forEach(ex => (ex.muscles || []).forEach(m => {
    const c = m.charAt(0).toUpperCase() + m.slice(1);
    if (!seen.includes(c)) seen.push(c);
  }));
  return seen.slice(0, 6);
}
window._musclesFromExercises = _musclesFromExercises;

// Schedule corrente dal file salvato (unica fonte di verità per tutti i consumer).
window.getSchedule = function () {
  const st = window.storage;
  const text = st ? st.get("schedaData", null) : null;
  if (!text) return { days: [] };
  try { return window.parseScheda(text); } catch (_) { return { days: [] }; }
};

// Sessione selezionata manualmente (o null se oggi è riposo / nessun giorno).
window.getSelectedSession = function () {
  const st = window.storage;
  const todayK = window.todayKey ? window.todayKey() : new Date().toISOString().slice(0, 10);
  if (st && st.get("restDay_" + todayK, false)) return null;
  const days = (window.getSchedule().days) || [];
  if (!days.length) return null;
  const selKey = st ? st.get("schedaSelectedDay", null) : null;
  return days.find(d => d.key === selKey) || days[0];
};

// ── DIETA PARSER ───────────────────────────────────────────────────────────
const _SECTION_KEYS = {
  "GIORNO SENZA ALLENAMENTO": "riposo",
  "ALLENAMENTO MATTINA": "mattina",
  "ALLENAMENTO ORE 17": "ore17",
  "ALLENAMENTO ORE 21": "ore21",
  "ALLENAMENTO ORE 22": "ore22",
};

const _MEAL_META = {
  "COLAZIONE":             { time: "08:00", emoji: "🌅", title: "Colazione" },
  "SPUNTINO":              { time: "10:30", emoji: "🍎", title: "Spuntino" },
  "PRANZO":                { time: "13:00", emoji: "🍝", title: "Pranzo" },
  "MERENDA ALLE 18:00":    { time: "18:00", emoji: "🍎", title: "Merenda" },
  "MERENDA":               { time: "16:30", emoji: "🍎", title: "Merenda" },
  "PRE-WORKOUT":           { time: "07:30", emoji: "💪", title: "Pre-workout" },
  "POST-WORKOUT":          { time: "10:30", emoji: "🥤", title: "Post-workout" },
  "PRE WO":                { time: "07:30", emoji: "💪", title: "Pre-WO" },
  "POST WO":               { time: "18:30", emoji: "🥤", title: "Post-WO" },
  "PRE-WO":                { time: "07:30", emoji: "💪", title: "Pre-WO" },
  "POST-WO":               { time: "18:30", emoji: "🥤", title: "Post-WO" },
  "POST ALLENAMENTO":      { time: "19:30", emoji: "🥤", title: "Post-workout" },
  "CENA":                  { time: "20:00", emoji: "🌙", title: "Cena" },
};

const _EXCLUDED = [
  "pasta di ceci", "pasta di lenticchie", "pasta di piselli", "bevanda di mandorla"
];

function _isExcluded(text) {
  return _EXCLUDED.some(e => text.toLowerCase().includes(e));
}

const _INTEGRATORI = {
  riposo: [
    { name: "Vita C+ Slow Release", time: "Colazione (mattina)",  sortTime: "08:00", color: "#FF9F0A", type: "vitac"  },
    { name: "Vita B+",              time: "Colazione (mattina)",  sortTime: "08:00", color: "#FFD60A", type: "vitab"  },
    { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1" },
    { name: "PS+",                  time: "Dopo merenda",         sortTime: "17:00", color: "#BF5AF2", type: "ps"     },
    { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "21:00", color: "#5AC8FA", type: "omega2" },
    { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:00", color: "#30D158", type: "gluta"  },
  ],
  mattina: [
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
  ],
  ore17: [
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
  ],
  ore21: [
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
  ],
  ore22: [
    { name: "Vita C+ Slow Release", time: "Colazione",            sortTime: "08:00", color: "#FF9F0A", type: "vitac"    },
    { name: "Vita B+",              time: "Colazione",            sortTime: "08:00", color: "#FFD60A", type: "vitab"    },
    { name: "Extra Omega+ (1ª)",    time: "Dopo pranzo",          sortTime: "14:00", color: "#5AC8FA", type: "omega1"   },
    { name: "MGK+ Liquid",          time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#0A84FF", type: "mgk"      },
    { name: "Fuel+",                time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#0A84FF", type: "fuel"     },
    { name: "Barretta 4plus 45g",   time: "Pre-WO ore 21:15",     sortTime: "21:15", color: "#FF9F0A", type: "barretta" },
    { name: "OMNIA+ 500ml",         time: "Intra-WO (borraccia)", sortTime: "22:00", color: "#5AC8FA", type: "omnia"    },
    { name: "Extra Omega+ (2ª)",    time: "Dopocena",             sortTime: "23:30", color: "#5AC8FA", type: "omega2"   },
    { name: "Gluta+ · 1 mis. 250ml", time: "Prima di dormire",   sortTime: "23:55", color: "#30D158", type: "gluta"    },
  ],
};

window.parseDieta = function (text) {
  if (!text || typeof text !== "string") return null;

  const lines = text.split("\n");
  const result = {};
  let currentSection = null;
  let currentMeal    = null;

  // Helper: find meal key from line
  function _findMealKey(line) {
    const up = line.toUpperCase();
    // Longer keys first to avoid partial matches
    const keys = Object.keys(_MEAL_META).sort((a, b) => b.length - a.length);
    return keys.find(k => up.startsWith(k)) || null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;
    if (line === "---") { currentSection = null; currentMeal = null; continue; }

    // Skip all INTEGRATORI lines (handled via static map)
    if (line.toUpperCase().startsWith("INTEGRATORI")) continue;

    // Skip generic note comments
    if (line.startsWith("# NOTE") || /^# (Acqua|Caff|Frutta|Integr|Alimenti|PIANO|Dr\.|IMPORT)/i.test(line)) continue;

    // Section header: # GIORNO SENZA ALLENAMENTO etc
    const secKey = Object.keys(_SECTION_KEYS).find(k => line === `# ${k}`);
    if (secKey) {
      currentSection = _SECTION_KEYS[secKey];
      result[currentSection] = {
        meals: [],
        integratori: JSON.parse(JSON.stringify(_INTEGRATORI[currentSection] || [])),
      };
      currentMeal = null;
      continue;
    }

    if (!currentSection) continue;

    // Meal header
    const mealKey = _findMealKey(line);
    if (mealKey) {
      const meta = _MEAL_META[mealKey];
      currentMeal = {
        time:    meta.time,
        emoji:   meta.emoji,
        title:   meta.title,
        kcal:    0,
        primary: [],
        others:  [],
      };
      result[currentSection].meals.push(currentMeal);
      continue;
    }

    if (!currentMeal) continue;

    // Opzione lines: "- Opzione 1: ..."
    if (/^- Opzione \d+:/.test(line)) {
      const content = line.replace(/^- Opzione \d+:\s*/, "").trim();
      if (_isExcluded(content)) continue;
      if (currentMeal.primary.length === 0) {
        currentMeal.primary.push({ food: content, qty: "" });
      } else {
        currentMeal.others.push({ food: content, qty: "" });
      }
      continue;
    }

    // "- item" lines
    if (line.startsWith("- ")) {
      const content = line.slice(2).trim();
      if (!content || content.toLowerCase().startsWith("note:")) continue;
      if (_isExcluded(content)) continue;
      currentMeal.primary.push({ food: content, qty: "" });
      continue;
    }

    // "Note:" lines
    if (/^Note:/i.test(line)) continue;

    // "Nessun pasto" etc
    if (/^Nessun/i.test(line)) {
      currentMeal.primary.push({ food: line, qty: "" });
      continue;
    }

    // Pipe-separated options: "Carboidrato (scegli 1): x | y | z"
    if (line.includes(":") && line.includes("|")) {
      const colonIdx = line.indexOf(":");
      const label    = line.slice(0, colonIdx).trim();
      const options  = line.slice(colonIdx + 1).split("|").map(s => s.trim()).filter(Boolean).filter(s => !_isExcluded(s));
      if (!options.length) continue;

      const top  = options.slice(0, 4);
      const rest = options.slice(4);

      currentMeal.primary.push({ food: `${label}: ${top.join(" | ")}`, qty: "" });
      if (rest.length > 0) {
        currentMeal.others.push({ food: `Altre opzioni: ${rest.join(" | ")}`, qty: "" });
      }
      continue;
    }

    // Single-value line like "Carboidrato: 80g riso basmati"
    if (line.includes(":") && !line.startsWith("#")) {
      const colonIdx = line.indexOf(":");
      const label    = line.slice(0, colonIdx).trim();
      const value    = line.slice(colonIdx + 1).trim();
      if (value && !_isExcluded(value)) {
        currentMeal.primary.push({ food: `${label}: ${value}`, qty: "" });
      }
    }
  }

  // Fallback: ensure all sections exist
  ["riposo","mattina","ore17","ore21","ore22"].forEach(k => {
    if (!result[k]) result[k] = { meals: [], integratori: JSON.parse(JSON.stringify(_INTEGRATORI[k] || [])) };
  });

  return result;
};
