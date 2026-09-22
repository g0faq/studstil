#!/usr/bin/env bash
# Публикует docs/ в публичный репозиторий сайта (GitHub Pages). В нём только статика — без сценариев и ключей.
set -euo pipefail
REPO="${SITE_REPO:-g0faq/studstil-site}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --depth 1 "https://github.com/$REPO.git" "$TMP" 2>/dev/null || { mkdir -p "$TMP"; git -C "$TMP" init -b main; git -C "$TMP" remote add origin "https://github.com/$REPO.git"; }
rsync -a --delete --exclude .git --exclude '*.png' docs/ "$TMP/"
cd "$TMP"
git add -A
if git diff --cached --quiet; then echo "Сайт без изменений"; exit 0; fi
git commit -m "Обновление сайта $(date '+%Y-%m-%d %H:%M')" >/dev/null
git push -u origin main
echo "Опубликовано: https://github.com/$REPO"
