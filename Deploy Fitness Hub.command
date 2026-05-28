#!/bin/bash
# ─────────────────────────────────────────────
#  Lorenzo Fitness Hub — Deploy su Netlify
# ─────────────────────────────────────────────

APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"

# Carica PATH completo (nvm, homebrew, node installer ufficiale)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
[ -f "$HOME/.zshrc" ]       && source "$HOME/.zshrc" 2>/dev/null
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" 2>/dev/null

clear
echo ""
echo "  🏋️  Lorenzo Fitness Hub — Deploy Netlify"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$APP_DIR" || { echo "❌ Cartella non trovata: $APP_DIR"; read -p "Premi INVIO..."; exit 1; }

# ── Controlla Node/npm ───────────────────────
if ! command -v npx &>/dev/null; then
  echo "❌ Node.js non trovato — installa da https://nodejs.org"
  echo ""
  open "https://nodejs.org"
  read -p "  Premi INVIO per chiudere..."
  exit 1
fi

# ── Login / link alla prima esecuzione ───────
if [ ! -f ".netlify/state.json" ]; then
  echo "🔗 Prima esecuzione: collego il sito Netlify..."
  echo "   (si aprirà il browser per il login)"
  echo ""
  npx netlify-cli link
  echo ""
fi

# ── Deploy ───────────────────────────────────
echo "🚀 Upload in corso..."
echo ""
npx netlify-cli deploy --prod --dir "."

STATUS=$?
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $STATUS -eq 0 ]; then
  echo "  ✅ Deploy completato!"
else
  echo "  ❌ Deploy fallito (codice $STATUS)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "  Premi INVIO per chiudere..."
