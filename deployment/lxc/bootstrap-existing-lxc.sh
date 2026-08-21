#!/bin/sh
set -eu

installation_id="${1:-}"
node_version="${2:-}"
app_user="app"

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

test "$#" -eq 2 || fail "Usage: bootstrap-existing-lxc.sh <installation-id> <node-version>"
printf '%s' "$installation_id" | grep -Eq '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' \
    || fail "installation-id must be kebab-case."
printf '%s' "$node_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || fail "node-version is invalid."
test "$(id -u)" -eq 0 || fail "Bootstrap must run as root."
. /etc/os-release
test "${ID:-}" = "debian" && test "${VERSION_ID:-}" = "13" \
    || fail "Bootstrap requires Debian 13."
test "$(uname -m)" = "x86_64" || fail "Bootstrap requires x86_64."

for target in "/opt/${installation_id}" "/var/lib/${installation_id}" "/etc/${installation_id}"; do
    test ! -L "$target" || fail "$target must not be a symlink."
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl nginx sudo xz-utils
id -u "$app_user" >/dev/null 2>&1 \
    || useradd --create-home --shell /bin/bash "$app_user"

node_distribution="node-v${node_version}-linux-x64"
if [ ! -x "/opt/${node_distribution}/bin/node" ]; then
    cache="/var/cache/${installation_id}-bootstrap"
    mkdir -p "$cache"
    curl --fail --location --silent --show-error \
        "https://nodejs.org/dist/v${node_version}/${node_distribution}.tar.xz" \
        --output "${cache}/${node_distribution}.tar.xz"
    curl --fail --location --silent --show-error \
        "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" \
        --output "${cache}/SHASUMS256.txt"
    (
        cd "$cache"
        grep " ${node_distribution}.tar.xz$" SHASUMS256.txt \
            | sha256sum --check -
    )
    tar --extract --xz --file "${cache}/${node_distribution}.tar.xz" \
        --directory /opt
fi
ln -sfn "/opt/${node_distribution}/bin/node" /usr/local/bin/node
ln -sfn "/opt/${node_distribution}/bin/npm" /usr/local/bin/npm

mkdir -p \
    "/opt/${installation_id}/backend/releases" \
    "/opt/${installation_id}/frontend/releases" \
    "/var/lib/${installation_id}/backups" \
    "/etc/${installation_id}"
chown -R "$app_user:$app_user" "/opt/${installation_id}" "/var/lib/${installation_id}"
chown root:"$app_user" "/etc/${installation_id}"
chmod 0750 "/var/lib/${installation_id}" "/etc/${installation_id}"

config_helper="/usr/local/sbin/${installation_id}-install-config"
cat > "$config_helper" <<EOF
#!/bin/sh
set -eu
test "\$#" -eq 2 || exit 64
case "\$1:\$2" in
    backend:/tmp/backend.env) install -o root -g ${app_user} -m 0640 "\$2" /etc/${installation_id}/backend.env ;;
    frontend:/tmp/runtime-config.js) install -o root -g ${app_user} -m 0644 "\$2" /etc/${installation_id}/runtime-config.js ;;
    *) exit 64 ;;
esac
EOF
chmod 0755 "$config_helper"

service_helper="/usr/local/sbin/${installation_id}-service-control"
cat > "$service_helper" <<EOF
#!/bin/sh
set -eu
test "\$#" -eq 2 || exit 64
case "\$1:\$2" in
    status:backend) systemctl is-active ${installation_id}-backend ;;
    stop:backend) systemctl stop ${installation_id}-backend ;;
    activate:backend) systemctl enable --now ${installation_id}-backend && systemctl restart ${installation_id}-backend ;;
    status:frontend) systemctl is-active nginx ;;
    stop:frontend) systemctl stop nginx ;;
    activate:frontend) nginx -t && systemctl enable --now nginx && systemctl reload nginx ;;
    *) exit 64 ;;
esac
EOF
chmod 0755 "$service_helper"

cat > "/etc/systemd/system/${installation_id}-backend.service" <<EOF
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=${app_user}
Group=${app_user}
WorkingDirectory=/opt/${installation_id}/backend/current
EnvironmentFile=/etc/${installation_id}/backend.env
ExecStart=/usr/local/bin/node --experimental-transform-types src/index.ts
Restart=on-failure
UMask=0027
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/${installation_id}
[Install]
WantedBy=multi-user.target
EOF

site="/etc/nginx/sites-available/${installation_id}"
cat > "$site" <<EOF
server {
    listen 80 default_server;
    root /opt/${installation_id}/frontend/current;
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

sudoers="/etc/sudoers.d/${installation_id}-deployment"
cat > "$sudoers" <<EOF
${app_user} ALL=(root) NOPASSWD: ${config_helper} backend /tmp/backend.env
${app_user} ALL=(root) NOPASSWD: ${config_helper} frontend /tmp/runtime-config.js
${app_user} ALL=(root) NOPASSWD: ${service_helper} status backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} stop backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} activate backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} status frontend
${app_user} ALL=(root) NOPASSWD: ${service_helper} stop frontend
${app_user} ALL=(root) NOPASSWD: ${service_helper} activate frontend
EOF
chmod 0440 "$sudoers"
visudo -cf "$sudoers"
systemctl daemon-reload
systemctl disable --now nginx || true
