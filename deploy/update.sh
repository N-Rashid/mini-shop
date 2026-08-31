#!/bin/bash
# Run on the server: bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p db/backups
cp db/shop.db "db/backups/shop-$(date +%Y%m%d-%H%M%S).db"

git pull

if [[ ! -f deploy/minishop.env ]]; then
  echo "Creating deploy/minishop.env from example..."
  cp deploy/minishop.env.example deploy/minishop.env
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  sed -i "s/replace-with-random-secret/$SECRET/" deploy/minishop.env
  echo "Generated MINISHOP_SECRET_KEY in deploy/minishop.env"
fi

source venv/bin/activate
pip install -r requirements.txt -q

cp deploy/minishop.service /etc/systemd/system/minishop.service
systemctl daemon-reload
systemctl enable minishop.service

systemctl restart minishop.service
sleep 1
systemctl status minishop.service --no-pager

curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8000/ || {
  echo "Site check failed — see: journalctl -u minishop -n 30 --no-pager"
  exit 1
}

echo "Update complete."
