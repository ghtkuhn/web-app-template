#!/bin/sh
set -eu

release_root="$1"
installation_id="$2"
privilege_mode="$3"

if [ "$privilege_mode" = "root" ]; then
    apt-get update
    apt-get install -y curl nginx
    site="/etc/nginx/sites-available/${installation_id}"
    cat > "$site" <<EOF
server {
    listen 80 default_server;
    root ${release_root}/current;
    location = /healthz { return 200 "ok\n"; }
    location = /runtime-config.js { add_header Cache-Control "no-store" always; }
    location = /index.html { add_header Cache-Control "no-cache" always; }
    location = /manifest.webmanifest { add_header Cache-Control "no-cache" always; }
    location = /sw.js { add_header Cache-Control "no-cache" always; }
    location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable" always; }
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
    ln -sfn "$site" "/etc/nginx/sites-enabled/${installation_id}"
    if [ -e /etc/nginx/sites-enabled/default ] || [ -L /etc/nginx/sites-enabled/default ]; then
        mv /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default.disabled
    fi
fi

test -f "/etc/${installation_id}/runtime-config.js"
cp "/etc/${installation_id}/runtime-config.js" \
    "$release_root/current/runtime-config.js"
if [ "$privilege_mode" = "managed" ]; then
    sudo -n "/usr/local/sbin/${installation_id}-service-control" activate frontend
else
    nginx -t
    systemctl enable --now nginx
    systemctl reload nginx
fi
