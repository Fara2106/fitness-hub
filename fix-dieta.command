#!/bin/bash
# Fix: rinomina c.txt → dieta.txt e pusha su GitHub

APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"
cd "$APP_DIR" || exit 1

echo "🔧 Rinomino c.txt → dieta.txt..."
mv "c.txt" "dieta.txt"

echo "📦 Commit e push..."
git add -A
git commit -m "fix: rename c.txt back to dieta.txt"
git push origin main

echo ""
echo "✅ Fatto! dieta.txt è di nuovo al suo posto."
read -p "  Premi INVIO per chiudere..."
