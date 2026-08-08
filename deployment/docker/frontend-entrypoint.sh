#!/bin/sh
set -eu

api_base_url="${FRONTEND_API_BASE_URL:-http://localhost:3000}"
websocket_url="${FRONTEND_WEBSOCKET_URL:-ws://localhost:3001}"
presentation_lock="${FRONTEND_PRESENTATION_LOCK:-null}"
auth_enabled="${FRONTEND_AUTH_ENABLED:-false}"
registration_enabled="${FRONTEND_REGISTRATION_ENABLED:-false}"

case "$presentation_lock" in
    null|desktop|tablet|mobile) ;;
    *)
        echo "Invalid FRONTEND_PRESENTATION_LOCK." >&2
        exit 1
        ;;
esac

if [ "$presentation_lock" = "null" ]; then
    presentation_json="null"
else
    presentation_json="$(jq -Rn --arg value "$presentation_lock" '$value')"
fi

runtime_json="$(jq -n \
    --arg apiBaseUrl "$api_base_url" \
    --arg webSocketUrl "$websocket_url" \
    --argjson presentationLock "$presentation_json" \
    --argjson authEnabled "$auth_enabled" \
    --argjson registrationEnabled "$registration_enabled" \
    '{apiBaseUrl: $apiBaseUrl, webSocketUrl: $webSocketUrl, presentationLock: $presentationLock, authEnabled: $authEnabled, registrationEnabled: $registrationEnabled}')"
printf 'window.__APP_CONFIG__ = %s;\n' "$runtime_json" \
    > /usr/share/nginx/html/runtime-config.js
