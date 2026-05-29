#!/bin/bash
# ─────────────────────────────────────────────────────
#  Lorenzo Fitness Hub — Deploy su GitHub Pages
#  Doppio click da Finder per deployare
# ─────────────────────────────────────────────────────

APP_DIR="/Users/lorenzofaraoni/Documents/Web Apps/Fitness App"

# ── Configurazione ─────────────────────────────────
# Inserisci qui il tuo username GitHub e il nome del repo
GITHUB_USER="Fara2106"
GITHUB_REPO="fitness-hub"
BRANCH="main"
# ──────────────────────────────────────────────────

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

clear
echo ""
echo "  🏋️  Lorenzo Fitness Hub — Deploy GitHub Pages"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$APP_DIR" || { echo "❌ Cartella non trovata: $APP_DIR"; read -p "Premi INVIO..."; exit 1; }

# Controlla git
if ! command -v git &>/dev/null; then
  echo "❌ Git non trovato. Installa Xcode Command Line Tools:"
  echo "   xcode-select --install"
  read -p "  Premi INVIO per chiudere..."
  exit 1
fi

# Init repo se non esiste
if [ ! -d ".git" ]; then
  echo "🔧 Inizializzo repository Git..."
  git init -b main
  git remote add origin "https://github.com/$GITHUB_USER/$GITHUB_REPO.git"
  echo ""
fi

# Verifica che il remote sia corretto
REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REMOTE" ]; then
  git remote add origin "https://github.com/$GITHUB_USER/$GITHUB_REPO.git"
fi

# Crea .gitignore se non esiste
if [ ! -f ".gitignore" ]; then
  cat > .gitignore << 'EOF'
.netlify/
node_modules/
.DS_Store
*.log
EOF
fi

# ── Auto-bump Service Worker cache (cache busting) ─
echo "🔄 Aggiorno cache SW..."
SW_HASH=$(date '+%Y%m%d%H%M%S')
sed -i '' "s/const CACHE_NAME = \"fitness-hub-[^\"]*\"/const CACHE_NAME = \"fitness-hub-v3-${SW_HASH}\"/" sw.js
echo "   CACHE_NAME → fitness-hub-v3-${SW_HASH}"
echo ""

# ── Commit e push ────────────────────────────────
# Rimuove eventuali lock rimasti da un processo git interrotto
echo "🔓 Rimuovo eventuali lock git residui..."
rm -f .git/index.lock .git/HEAD.lock .git/config.lock 2>/dev/null
rm -f .git/refs/heads/*.lock 2>/dev/null

echo "📦 Aggiungo i file..."
git add -A

# Controlla se c'è qualcosa da committare
if git diff --cached --quiet; then
  echo ""
  echo "  ℹ️  Nessuna modifica da deployare."
else
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
  git commit -m "🏋️ Deploy $TIMESTAMP"
  echo ""
  echo "🚀 Upload su GitHub..."
  echo ""

  if git push -u origin "$BRANCH"; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ✅ Deploy completato!"
    echo ""
    echo "  🌐 URL: https://$GITHUB_USER.github.io/$GITHUB_REPO"
    echo "  📱 Aprilo da iPhone per installare la PWA"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ❌ Push fallito."
    echo "  Controlla:"
    echo "  1. Che il repo esista su GitHub"
    echo "  2. Che GITHUB_USER e GITHUB_REPO siano corretti"
    echo "  3. Di essere autenticato con git"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  fi
fi

echo ""
read -p "  Premi INVIO per chiudere..."
