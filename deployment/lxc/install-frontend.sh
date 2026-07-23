#!/bin/sh
set -eu

release_root="$1"
apt-get update
apt-get install -y curl nginx
test -f /etc/web-app/runtime-config.js || {
    echo "Missing /etc/web-app/runtime-config.js" >&2
    exit 1
}
cp /etc/web-app/runtime-config.js "$release_root/current/runtime-config.js"
cat > /etc/nginx/sites-available/web-app <<EOF
server {
    listen 80 default_server;
    root $release_root/current;
    location = /healthz { return 200 "ok\n"; }
    location = /runtime-config.js { add_header Cache-Control "no-store"; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
ln -sfn /etc/nginx/sites-available/web-app /etc/nginx/sites-enabled/web-app
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
