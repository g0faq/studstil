#!/usr/bin/env bash
# Первичная настройка чистого Ubuntu 22.04/24.04 VPS (запускать от root).
# Использование: bash setup-vps.sh api.ВАШ-ДОМЕН.ru
set -euo pipefail
DOMAIN="${1:?Укажите домен API, например api.example.ru}"
APP=/opt/beauty-case

apt-get update
apt-get install -y curl git build-essential debian-keyring debian-archive-keyring apt-transport-https
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
# Caddy
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

id bot >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin bot
mkdir -p "$APP" && chown bot:bot "$APP"
echo ">>> Скопируйте проект в $APP (git clone или rsync), затем:"
echo "    cd $APP && sudo -u bot npm ci --omit=dev && cp .env.example .env && nano .env"

sed "s/api.example.ru/$DOMAIN/" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
cp "$(dirname "$0")/beauty-case.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable beauty-case caddy
systemctl restart caddy
echo ">>> После заполнения .env: systemctl restart beauty-case && curl https://$DOMAIN/api/health"
