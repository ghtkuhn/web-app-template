#!/bin/sh
set -eu

release_root="$1"
installation_id="$2"
privilege_mode="$3"
node_version="$4"
action="$5"
backend_launcher="$6"

test "$#" -eq 6
test "$backend_launcher" = "start-backend.mjs"
node_distribution="node-v${node_version}-linux-x64"

if [ "$privilege_mode" = "root" ]; then
    apt-get update
    apt-get install -y ca-certificates curl xz-utils
    if [ ! -x "/opt/${node_distribution}/bin/node" ]; then
        temporary_directory="$(mktemp -d)"
        trap 'rm -rf "$temporary_directory"' EXIT
        curl --fail --location --silent --show-error \
            "https://nodejs.org/dist/v${node_version}/${node_distribution}.tar.xz" \
            --output "${temporary_directory}/${node_distribution}.tar.xz"
        curl --fail --location --silent --show-error \
            "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" \
            --output "${temporary_directory}/SHASUMS256.txt"
        (
            cd "$temporary_directory"
            grep " ${node_distribution}.tar.xz$" SHASUMS256.txt \
                | sha256sum --check -
        )
        tar --extract --xz --file \
            "${temporary_directory}/${node_distribution}.tar.xz" \
            --directory /opt
    fi
    ln -sfn "/opt/${node_distribution}/bin/node" /usr/local/bin/node
    ln -sfn "/opt/${node_distribution}/bin/npm" /usr/local/bin/npm
    mkdir -p "/etc/${installation_id}" "/var/lib/${installation_id}"
    cat > "/etc/systemd/system/${installation_id}-backend.service" <<EOF
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=${release_root}/current
EnvironmentFile=/etc/${installation_id}/backend.env
ExecStart=/usr/local/bin/node --experimental-transform-types ${backend_launcher}
Restart=on-failure
User=root
[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
fi

test "$action" = "prepare" || test "$action" = "activate"
if [ "$action" = "prepare" ]; then
    exit 0
fi

if [ "$privilege_mode" = "managed" ]; then
    sudo -n "/usr/local/sbin/${installation_id}-service-control" activate backend
else
    systemctl enable --now "${installation_id}-backend"
    systemctl restart "${installation_id}-backend"
fi
