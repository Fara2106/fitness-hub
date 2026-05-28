#!/bin/bash
APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"
cd "$APP_DIR" || exit 1

echo "🔧 Rimuovo lock git..."
rm -f ".git/index.lock"

echo "📦 Amend commit (rimuovo chiave API)..."
git add api.jsx push-now.command fix-and-push.command
git commit --amend --no-edit

echo "🚀 Force push su GitHub..."
git push --force-with-lease origin main

echo ""
echo "✅ Fatto! Premi INVIO per chiudere."
read
