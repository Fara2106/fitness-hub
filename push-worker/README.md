# fitness-hub-push

Cloudflare Worker per le notifiche push. Deploy: vedi Task 3 del piano
`docs/superpowers/plans/2026-07-14-notifiche-push.md`.

Comandi rapidi:
- `npm install`
- `npx wrangler kv namespace create PUSH_KV` → copia l'id in wrangler.toml
- genera VAPID: `node -e "import('webpush-webcrypto').then(async m => { const k = await m.ApplicationServerKeys.generate(); console.log(await k.toJSON()); })"`
- `npx wrangler secret put VAPID_PRIVATE` (incolla la privata JWK/base64)
- `npx wrangler deploy`
- verifica: `curl https://fitness-hub-push.<account>.workers.dev/health`
