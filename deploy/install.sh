#!/usr/bin/env bash
# JW Deck · one-time install on a Linux VPS (run as root).
# Runs as its own user "jwdeck" with its own Node, its own port and its own systemd service.
# Nothing shared with Frappe/bench: no system packages, no nginx, no global Node changes.
#
#   curl -fsSL https://raw.githubusercontent.com/soulreaper767/jwdeck/main/deploy/install.sh | bash
#   (or) bash install.sh            # options: PORT=8095  DEMO=1  REPO=...  BRANCH=main
set -euo pipefail

PORT="${PORT:-8095}"
REPO="${REPO:-https://github.com/soulreaper767/jwdeck.git}"
BRANCH="${BRANCH:-main}"
NODE_VER="${NODE_VER:-v24.18.0}"
APP_USER=jwdeck
HOME_DIR=/home/$APP_USER
APP_DIR=$HOME_DIR/jwdeck
DATA_DIR=$HOME_DIR/data
NODE_DIR=$HOME_DIR/node
ENV_FILE=$HOME_DIR/jwdeck.env

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

if ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
  if ! systemctl is-active --quiet jwdeck; then echo "Port $PORT is already used by something else. Re-run with PORT=<free port>."; exit 1; fi
fi

# 1. user
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$DATA_DIR"

# 2. private Node (only for this user)
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;; esac
if [ ! -x "$NODE_DIR/bin/node" ] || [ "$("$NODE_DIR/bin/node" -v)" != "$NODE_VER" ]; then
  echo "Installing Node $NODE_VER for $APP_USER ..."
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$ARCH.tar.xz" -o "$tmp/node.tar.xz"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$tmp/node.tar.xz" -C "$NODE_DIR" --strip-components=1
  rm -rf "$tmp"
fi

# 3. code
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

# 4. settings (secret generated once, kept across updates)
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
JW_DB=$DATA_DIR/jw_dash.db
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
NODE_ENV=production
EOF
fi
sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown -R "$APP_USER:$APP_USER" "$HOME_DIR"

# 5. build (as jwdeck)
sudo -u "$APP_USER" -H bash -lc "
  set -e
  export PATH=$NODE_DIR/bin:\$PATH
  set -a; . $ENV_FILE; set +a
  cd $APP_DIR
  npm --prefix server ci --omit=dev --no-audit --no-fund
  npm --prefix client ci --no-audit --no-fund
  npm --prefix client run build
  if [ ! -f \"\$JW_DB\" ]; then
    if [ '${DEMO:-0}' = 1 ]; then npm --prefix server run seed:demo; else npm --prefix server run seed; fi
  fi
"

# 6. service
cat > /etc/systemd/system/jwdeck.service <<EOF
[Unit]
Description=JW Deck (JW Group reporting)
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_DIR/bin/node --no-warnings=ExperimentalWarning src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now jwdeck
systemctl restart jwdeck

# 7. firewall (only if ufw is active; just opens this one port)
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT/tcp" >/dev/null; fi

sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo; echo "JW Deck is running:  http://$IP:$PORT"
  [ -f "$DATA_DIR/.shown" ] || { echo "First sign-in: admin@jwdash.local / admin123  (change it in Setup > Users)"; touch "$DATA_DIR/.shown"; chown $APP_USER: "$DATA_DIR/.shown"; }
else
  echo "Service did not start. See: journalctl -u jwdeck -n 50"; exit 1
fi
