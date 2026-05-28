// netlify/functions/sheets.js — Node 18, usa fetch nativo

const SHEETS_URL = "https://script.google.com/macros/s/AKfycbz7dHQg8Q3HOZ37vx-QLRT8jqHCSHXFPODKhU1uyoS8wyezgFV292MlnH8gRcOdRhQN/exec";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS });
  }

  try {
    let url  = SHEETS_URL;
    let opts = { redirect: "follow" };

    if (req.method === "GET") {
      const incoming = new URL(req.url);
      const qs = incoming.searchParams.toString();
      if (qs) url += "?" + qs;
    } else {
      const body = await req.text();
      opts.method = "POST";
      opts.body   = body;
    }

    const res  = await fetch(url, opts);
    const text = await res.text();

    return new Response(text, { status: 200, headers: CORS });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: CORS }
    );
  }
};

