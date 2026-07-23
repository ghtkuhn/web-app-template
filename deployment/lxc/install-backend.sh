#!/bin/sh
set -eu

release_root="$1"
node_version="22.23.1"
case "$(uname -m)" in
    x86_64)
        node_architecture="x64"
        ;;
    aarch64|arm64)
        node_architecture="arm64"
        ;;
    *)
        echo "Unsupported Node architecture: $(uname -m)" >&2
        exit 1
        ;;
esac
node_distribution="node-v${node_version}-linux-${node_architecture}"

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
ln -sfn "/opt/${node_distribution}/bin/npx" /usr/local/bin/npx
cd "$release_root/current"
npm install --omit=dev
mkdir -p /etc/web-app /var/lib/web-app
test -f /etc/web-app/backend.env || {
    echo "Missing /etc/web-app/backend.env" >&2
    exit 1
}
cat > /etc/systemd/system/web-app-backend.service <<EOF
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$release_root/current
EnvironmentFile=/etc/web-app/backend.env
ExecStart=/usr/local/bin/node --experimental-transform-types src/index.ts
Restart=on-failure
User=root
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now web-app-backend
systemctl restart web-app-backend
