// fitness-hub-push — Cloudflare Worker (Web Push per Lorenzo Fitness Hub)
// Endpoint: POST /save, POST /unsubscribe, GET /health. Cron: send (Task 2).

const KV_KEY = "config";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

async function readConfig(env) {
  const raw = await env.PUSH_KV.get(KV_KEY);
  if (!raw) return { subscriptions: [], weekly: {}, daytypes: {}, overrides: {}, tz: "Europe/Rome", updatedAt: 0 };
  try { return JSON.parse(raw); } catch (_) {
    return { subscriptions: [], weekly: {}, daytypes: {}, overrides: {}, tz: "Europe/Rome", updatedAt: 0 };
  }
}

async function writeConfig(env, cfg) {
  await env.PUSH_KV.put(KV_KEY, JSON.stringify(cfg));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      const cfg = await readConfig(env);
      return json({ ok: true, subs: cfg.subscriptions.length, updatedAt: cfg.updatedAt });
    }

    if (request.method === "POST" && url.pathname === "/save") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      const { subscription, config } = body || {};
      if (!subscription || !subscription.endpoint) return json({ ok: false, error: "no subscription" }, 400);
      const cfg = await readConfig(env);
      // upsert subscription per endpoint
      const others = cfg.subscriptions.filter(s => s.endpoint !== subscription.endpoint);
      cfg.subscriptions = [...others, subscription];
      if (config) {
        cfg.weekly = config.weekly || cfg.weekly;
        cfg.daytypes = config.daytypes || cfg.daytypes;
        cfg.overrides = config.overrides || cfg.overrides;
      }
      cfg.tz = "Europe/Rome";
      cfg.updatedAt = Date.now();
      await writeConfig(env, cfg);
      return json({ ok: true, subs: cfg.subscriptions.length });
    }

    if (request.method === "POST" && url.pathname === "/unsubscribe") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      const endpoint = body && body.endpoint;
      if (!endpoint) return json({ ok: false, error: "no endpoint" }, 400);
      const cfg = await readConfig(env);
      cfg.subscriptions = cfg.subscriptions.filter(s => s.endpoint !== endpoint);
      await writeConfig(env, cfg);
      return json({ ok: true, subs: cfg.subscriptions.length });
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
