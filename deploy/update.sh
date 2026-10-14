#!/usr/bin/env bash
# JW Deck · pull the latest code from GitHub and restart (run as root). Data is kept.
set -euo pipefail
APP_USER=jwdeck
HOME_DIR=/home/$APP_USER
APP_DIR=$HOME_DIR/jwdeck
BRANCH="${BRANCH:-main}"

sudo -u "$APP_USER" -H bash -lc "
  set -e
  export PATH=$HOME_DIR/node/bin:\$PATH
  cd $APP_DIR
  git fetch origin $BRANCH
  git reset --hard origin/$BRANCH
  npm --prefix server ci --omit=dev --no-audit --no-fund
  npm --prefix client ci --no-audit --no-fund
  npm --prefix client run build
"
systemctl stop jwdeck
B=$HOME_DIR/data/backup-$(date +%Y%m%d-%H%M); mkdir -p "$B"; cp $HOME_DIR/data/jw_dash.db* "$B"/ 2>/dev/null || true; chown -R $APP_USER: "$B"
systemctl start jwdeck
sleep 2
systemctl is-active --quiet jwdeck && echo "Updated and running." || { echo "Service failed. journalctl -u jwdeck -n 50"; exit 1; }
