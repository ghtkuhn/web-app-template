#!/bin/sh
set -eu

mode="${1:-}"
installation_id="${2:-}"
node_version="${3:-}"
npm_range="${4:-}"
infrastructure_schema="${5:-}"
backend_launcher="${6:-}"
maintenance_launcher="${7:-}"
app_user="${8:-}"
staging_directory="${9:-}"

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

test "$#" -eq 9 || fail "Usage: bootstrap-existing-lxc.sh <bootstrap|upgrade> <installation-id> <node-version> <npm-range> <schema> <backend-launcher> <maintenance-launcher> <deployment-user> <staging-directory>"
test "$mode" = "bootstrap" || test "$mode" = "upgrade" \
    || fail "mode must be bootstrap or upgrade."
printf '%s' "$installation_id" | grep -Eq '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' \
    || fail "installation-id must be kebab-case."
printf '%s' "$node_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
    || fail "node-version is invalid."
test "$npm_range" = ">=11 <12" || fail "npm-range is unsupported."
printf '%s' "$infrastructure_schema" | grep -Eq '^[1-9][0-9]*$' \
    || fail "infrastructure schema is invalid."
test "$backend_launcher" = "start-backend.mjs" \
    || fail "backend launcher is invalid."
test "$maintenance_launcher" = "run-database-maintenance.mjs" \
    || fail "maintenance launcher is invalid."
printf '%s' "$app_user" | grep -Eq '^[a-z_][a-z0-9_-]*$' \
    || fail "deployment-user is invalid."
test "$app_user" != "root" || fail "deployment-user must not be root."
printf '%s' "$staging_directory" \
    | grep -Eq "^/tmp/${installation_id}-bootstrap\\.[A-Za-z0-9]+$" \
    || fail "staging-directory is invalid."
test -d "$staging_directory" && test ! -L "$staging_directory" \
    || fail "staging-directory must be a real directory."
test "$(id -u)" -eq 0 || fail "Bootstrap must run with sudo/root privileges."
. /etc/os-release
test "${ID:-}" = "debian" && test "${VERSION_ID:-}" = "13" \
    || fail "Bootstrap requires Debian 13."
test "$(uname -m)" = "x86_64" || fail "Bootstrap requires x86_64."

for target in "/opt/${installation_id}" "/var/lib/${installation_id}" "/etc/${installation_id}"; do
    test ! -L "$target" || fail "$target must not be a symlink."
done

infrastructure_file="/etc/${installation_id}/infrastructure.json"
if [ "$mode" = "bootstrap" ] && [ -e "$infrastructure_file" ]; then
    fail "Existing-LXC infrastructure already exists; use infrastructure:upgrade."
fi
backend_root="/opt/${installation_id}/backend"
unit_file="/etc/systemd/system/${installation_id}-backend.service"
config_helper="/usr/local/sbin/${installation_id}-install-config"
service_helper="/usr/local/sbin/${installation_id}-service-control"
site="/etc/nginx/sites-available/${installation_id}"
enabled_site="/etc/nginx/sites-enabled/${installation_id}"
default_enabled="/etc/nginx/sites-enabled/default"
default_disabled="/etc/nginx/sites-available/default.disabled"
sudoers="/etc/sudoers.d/${installation_id}-deployment"
if [ "$mode" = "bootstrap" ] && {
    [ -L "${backend_root}/current" ] ||
    [ -e "$unit_file" ] ||
    [ -e "$config_helper" ] ||
    [ -e "$service_helper" ];
}; then
    fail "Unversioned Existing-LXC infrastructure exists; use infrastructure:upgrade."
fi

rollback_directory="$(mktemp -d)"
completed=0
legacy_current=""

backup_path() {
    target="$1"
    label="$2"
    if [ -e "$target" ] || [ -L "$target" ]; then
        cp -a "$target" "${rollback_directory}/${label}"
    else
        : > "${rollback_directory}/${label}.absent"
    fi
}

restore_path() {
    target="$1"
    label="$2"
    rm -f "$target"
    if [ ! -e "${rollback_directory}/${label}.absent" ]; then
        mkdir -p "$(dirname "$target")"
        cp -a "${rollback_directory}/${label}" "$target"
    fi
}

cleanup() {
    if [ "$completed" -ne 1 ]; then
        restore_path /usr/local/bin/node node
        restore_path /usr/local/bin/npm npm
        restore_path "$config_helper" config-helper
        restore_path "$service_helper" service-helper
        restore_path "$unit_file" backend-unit
        restore_path "$site" nginx-site
        restore_path "$enabled_site" nginx-enabled-site
        restore_path "$default_enabled" nginx-default-enabled
        restore_path "$default_disabled" nginx-default-disabled
        restore_path "$sudoers" sudoers
        restore_path "$infrastructure_file" infrastructure
        if [ -n "$legacy_current" ]; then
            restore_path "${legacy_current}/${backend_launcher}" legacy-launcher
            restore_path "${legacy_current}/${maintenance_launcher}" legacy-maintenance-launcher
            restore_path "${legacy_current}/release.contract.json" legacy-contract
        fi
        systemctl daemon-reload >/dev/null 2>&1 || true
    fi
    rm -rf "$rollback_directory"
}

backup_path /usr/local/bin/node node
backup_path /usr/local/bin/npm npm
backup_path "$config_helper" config-helper
backup_path "$service_helper" service-helper
backup_path "$unit_file" backend-unit
backup_path "$site" nginx-site
backup_path "$enabled_site" nginx-enabled-site
backup_path "$default_enabled" nginx-default-enabled
backup_path "$default_disabled" nginx-default-disabled
backup_path "$sudoers" sudoers
backup_path "$infrastructure_file" infrastructure
trap cleanup EXIT HUP INT TERM

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
test "$(/usr/local/bin/node --version)" = "v${node_version}" \
    || fail "Installed Node.js version does not match the requested runtime."
/usr/local/bin/npm --version | grep -Eq '^11\.[0-9]+\.[0-9]+$' \
    || fail "Installed npm does not satisfy >=11 <12."

mkdir -p \
    "/opt/${installation_id}/backend/releases" \
    "/opt/${installation_id}/frontend/releases" \
    "/var/lib/${installation_id}/backups" \
    "/etc/${installation_id}"
chown -R "$app_user:$app_user" "/opt/${installation_id}" "/var/lib/${installation_id}"
chown root:"$app_user" "/etc/${installation_id}"
chmod 0750 "/var/lib/${installation_id}" "/etc/${installation_id}"

if [ "$mode" = "upgrade" ] && [ -L "${backend_root}/current" ]; then
    current="$(readlink -f "${backend_root}/current")"
    case "${current}/" in
        "${backend_root}/releases/"*) ;;
        *) fail "Current backend release escapes the managed release directory." ;;
    esac
    test -d "$current" && test ! -L "$current" \
        || fail "Current backend release is unsafe."
    legacy_current="$current"
    backup_path "${current}/${backend_launcher}" legacy-launcher
    backup_path "${current}/${maintenance_launcher}" legacy-maintenance-launcher
    backup_path "${current}/release.contract.json" legacy-contract
    if [ ! -f "${current}/${backend_launcher}" ] || \
       [ ! -f "${current}/${maintenance_launcher}" ] || \
       [ ! -f "${current}/release.contract.json" ]; then
        workspace_entry="${current}/code/backend/src/index.ts"
        flat_entry="${current}/src/index.ts"
        workspace=0
        flat=0
        test -f "$workspace_entry" && test ! -L "$workspace_entry" && workspace=1
        test -f "$flat_entry" && test ! -L "$flat_entry" && flat=1
        test "$((workspace + flat))" -eq 1 \
            || fail "Legacy backend release layout is missing or ambiguous."
        if [ "$workspace" -eq 1 ]; then
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-workspace-launcher.mjs" \
                "${current}/${backend_launcher}"
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-workspace-maintenance-launcher.mjs" \
                "${current}/${maintenance_launcher}"
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-workspace-contract.json" \
                "${current}/release.contract.json"
        else
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-flat-launcher.mjs" \
                "${current}/${backend_launcher}"
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-flat-maintenance-launcher.mjs" \
                "${current}/${maintenance_launcher}"
            install -o "$app_user" -g "$app_user" -m 0644 \
                "${staging_directory}/legacy-flat-contract.json" \
                "${current}/release.contract.json"
        fi
    fi
    /usr/local/bin/node "${staging_directory}/lxc-release-validator.mjs" \
        "$current" \
        "$(cat "${staging_directory}/accepted-backend-contracts.json")" \
        "$(cat "${staging_directory}/replacement-backend-contracts.json")"
    /usr/local/bin/node "${staging_directory}/lxc-release-validator.mjs" \
        "$current" \
        "$(cat "${staging_directory}/replacement-backend-contracts.json")"
fi

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

cat > "$unit_file" <<EOF
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=${app_user}
Group=${app_user}
WorkingDirectory=/opt/${installation_id}/backend/current
EnvironmentFile=/etc/${installation_id}/backend.env
ExecStart=/usr/local/bin/node --experimental-transform-types ${backend_launcher}
Restart=on-failure
UMask=0027
NoNewPrivileges=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/${installation_id}
[Install]
WantedBy=multi-user.target
EOF

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
ln -sfn "$site" "$enabled_site"
if [ "$mode" = "bootstrap" ] && {
   [ -e "$default_enabled" ] ||
   [ -L "$default_enabled" ];
}; then
    rm -f "$default_disabled"
    mv "$default_enabled" "$default_disabled"
fi

sudoers_temporary="${rollback_directory}/sudoers.new"
cat > "$sudoers_temporary" <<EOF
${app_user} ALL=(root) NOPASSWD: ${config_helper} backend /tmp/backend.env
${app_user} ALL=(root) NOPASSWD: ${config_helper} frontend /tmp/runtime-config.js
${app_user} ALL=(root) NOPASSWD: ${service_helper} status backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} stop backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} activate backend
${app_user} ALL=(root) NOPASSWD: ${service_helper} status frontend
${app_user} ALL=(root) NOPASSWD: ${service_helper} stop frontend
${app_user} ALL=(root) NOPASSWD: ${service_helper} activate frontend
EOF
chmod 0440 "$sudoers_temporary"
visudo -cf "$sudoers_temporary"
install -m 0440 "$sudoers_temporary" "$sudoers"
systemctl daemon-reload
if [ "$mode" = "bootstrap" ]; then
    systemctl disable --now nginx || true
fi

infrastructure_temporary="${infrastructure_file}.new"
cat > "$infrastructure_temporary" <<EOF
{
    "schemaVersion": ${infrastructure_schema},
    "nodeVersion": "${node_version}",
    "npmRange": "${npm_range}",
    "deploymentUser": "${app_user}",
    "backendLauncher": "${backend_launcher}",
    "maintenanceLauncher": "${maintenance_launcher}"
}
EOF
chmod 0644 "$infrastructure_temporary"
mv "$infrastructure_temporary" "$infrastructure_file"
completed=1
