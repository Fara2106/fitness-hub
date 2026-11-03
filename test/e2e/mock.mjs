// test/e2e/mock.mjs — backend finto per i test e2e: intercetta il Worker
// (fitness-hub-proxy) con page.route. Settings/pesi in memoria, POST con
// ritardo configurabile (per riprodurre le race), /groq finto in SSE.
// `state` può essere condiviso fra più context = più device sullo stesso cloud.

export const PROXY = "https://fitness-hub-proxy.lorefara97.workers.dev";

export function newState(settings = {}) {
  return { settings: { ...settings }, pesi: [], log: [] };
}

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

// Risposta finta del Coach: SSE come Groq, con markdown da rendere.
const GROQ_SSE = [
  { delta: { content: "**Post-allenamento:** " } },
  { delta: { content: "riso e pollo.\n- Idratati" } },
].map(c => "data: " + JSON.stringify({ choices: [c] }) + "\n\n").join("") + "data: [DONE]\n\n";

export async function installMock(ctx, state, { postDelay = 0, getDelay = 0 } = {}) {
  await ctx.route(PROXY + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: H });
    const url = new URL(req.url());
    if (req.method() === "GET") {
      const a = url.searchParams.get("action");
      state.log.push("GET " + (a || url.pathname));
      if (getDelay) await new Promise(r => setTimeout(r, getDelay));
      let body = {};
      if (url.pathname === "/groq") body = { groq: true };
      else if (a === "getAll") body = { success: true, pesoCorporeo: state.pesi, settings: { ...state.settings } };
      else if (a === "getSettings") body = { ...state.settings };
      else if (a === "getPesoCorporeo") body = state.pesi;
      return route.fulfill({ status: 200, headers: H, body: JSON.stringify(body) });
    }
    if (url.pathname === "/groq") {
      const g = JSON.parse(req.postData() || "{}");
      state.log.push("POST /groq");
      if (g.stream) return route.fulfill({ status: 200, headers: { ...H, "Content-Type": "text/event-stream" }, body: GROQ_SSE });
      // Come Groq coi modelli che "ragionano": con un tetto di token piccolo
      // il ragionamento lo esaurisce e il testo arriva vuoto.
      const content = (g.max_tokens || 0) >= 256 ? "OK" : "";
      return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ choices: [{ message: { content }, finish_reason: content ? "stop" : "length" }] }) });
    }
    const b = JSON.parse(req.postData() || "{}");
    state.log.push("POST " + b.action + (b.key ? ":" + b.key : "") +
      (b.esercizio ? ":" + b.esercizio + "#" + b.setN + "=" + b.peso : ""));
    if (postDelay) await new Promise(r => setTimeout(r, postDelay));
    if (b.action === "saveSettings") state.settings[b.key] = b.value;
    return route.fulfill({ status: 200, headers: H, body: JSON.stringify({ success: true }) });
  });
  return state;
}
