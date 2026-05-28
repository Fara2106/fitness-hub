#!/bin/bash
APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"
cd "$APP_DIR" || exit 1

echo "🗑  Resetto git (repo GitHub è ancora vuoto)..."
rm -rf .git

echo "🔧 Nuovo repo git pulito..."
git init -b main
git remote add origin https://github.com/Fara2106/fitness-hub.git

echo "📦 Aggiungo tutti i file..."
git add -A

echo "💾 Commit iniziale..."
git commit -m "🏋️ Lorenzo Fitness Hub — deploy iniziale"

echo "🚀 Push su GitHub..."
git push -u origin main

echo ""
if [ $? -eq 0 ]; then
  echo "✅ Deploy riuscito!"
  echo "🌐 URL: https://fara2106.github.io/fitness-hub"
else
  echo "❌ Push fallito — controlla le credenziali GitHub"
fi
echo ""
echo "Premi INVIO per chiudere."
read
