#!/bin/bash
APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"
cd "$APP_DIR" || exit 1

echo "🔧 Rimuovo lock git..."
rm -f ".git/index.lock"

echo "📦 Aggiungo file e commit..."
git add -A
git diff --cached --quiet || git commit -m "🏋️ Deploy $(date '+%Y-%m-%d %H:%M')"

echo "🚀 Push su GitHub..."
git push -u origin main

echo ""
echo "✅ Fatto! Premi INVIO per chiudere."
read
