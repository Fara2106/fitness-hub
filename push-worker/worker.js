// fitness-hub-push — Cloudflare Worker (Web Push per Lorenzo Fitness Hub)
// Endpoint: POST /save, POST /unsubscribe, GET /health. Cron: send (Task 2).

import { generatePushHTTPRequest, ApplicationServerKeys } from "webpush-webcrypto";

const KV_KEY = "config";

// Ritorna { ymd:"YYYY-MM-DD", weekday:"mon".., hhmm:"HH:MM" } in ora di Roma.
function romeNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false, hourCycle: "h23",
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  const wdMap = { Sun:"sun",Mon:"mon",Tue:"tue",Wed:"wed",Thu:"thu",Fri:"fri",Sat:"sat" };
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: wdMap[parts.weekday],
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

function resolveDaytype(cfg, ymd, weekday) {
  return (cfg.overrides && cfg.overrides[ymd]) || (cfg.weekly && cfg.weekly[weekday]) || null;
}

function dueReminders(cfg, ymd, weekday, hhmm) {
  const dt = resolveDaytype(cfg, ymd, weekday);
  if (!dt) return [];
  const list = (cfg.daytypes && cfg.daytypes[dt]) || [];
  return list.filter(r => r.on && r.time === hhmm);
}

function notifText(r) {
  const byCat = { pasto: "🍽️", integratore: "💊", allenamento: "🏋️" };
  return { title: "Lorenzo Fitness Hub", body: `${byCat[r.cat] || "⏰"} ${r.label}`, tag: r.id };
}

// Invia una push a una subscription. Ritorna lo status HTTP del push service.
async function sendPush(subscription, payloadObj, env) {
  const keys = await ApplicationServerKeys.fromJSON(JSON.parse(env.VAPID_PRIVATE));
  const { headers, body, endpoint } = await generatePushHTTPRequest({
    applicationServerKeys: keys,
    payload: JSON.stringify(payloadObj),
    target: subscription,
    adminContact: env.VAPID_SUBJECT,
    ttl: 60,
  });
  const res = await fetch(endpoint, { method: "POST", headers, body });
  return res.status;
}

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
      cfg.updatedAt = Date.now();
      await writeConfig(env, cfg);
      return json({ ok: true, subs: cfg.subscriptions.length });
    }

    if (request.method === "GET" && url.pathname === "/healthdata") {
      const raw = await env.PUSH_KV.get("healthdata");
      return json(raw ? JSON.parse(raw) : {});
    }

    if (request.method === "POST" && url.pathname === "/healthdata") {
      let body; try { body = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
      if (!body || body.token !== env.HEALTH_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);
      const rec = {
        date: String(body.date || "").slice(0, 10),
        waterMl: Math.max(0, Math.round(Number(body.waterMl) || 0)),
        kcal: Math.max(0, Math.round(Number(body.kcal) || 0)),
        updatedAt: Date.now(),
      };
      await env.PUSH_KV.put("healthdata", JSON.stringify(rec));
      return json({ ok: true, ...rec });
    }

    return json({ ok: false, error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    const cfg = await readConfig(env);
    const { ymd, weekday, hhmm } = romeNow(new Date(event.scheduledTime || Date.now()));

    // GC override passati (data < oggi) — sempre, anche senza subscription
    let changed = false;
    for (const k of Object.keys(cfg.overrides || {})) {
      if (k < ymd) { delete cfg.overrides[k]; changed = true; }
    }

    if (cfg.subscriptions.length) {
      const due = dueReminders(cfg, ymd, weekday, hhmm);

      if (due.length) {
        const deadEndpoints = new Set();
        for (const r of due) {
          const payload = notifText(r);
          for (const sub of cfg.subscriptions) {
            try {
              const status = await sendPush(sub, payload, env);
              if (status === 404 || status === 410) deadEndpoints.add(sub.endpoint);
            } catch (_) { /* ignora singolo invio fallito */ }
          }
        }
        if (deadEndpoints.size) {
          cfg.subscriptions = cfg.subscriptions.filter(s => !deadEndpoints.has(s.endpoint));
          changed = true;
        }
      }
    }

    if (changed) { cfg.updatedAt = Date.now(); ctx.waitUntil(writeConfig(env, cfg)); }
  },
};
