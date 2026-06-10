#!/bin/sh
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.js"

js_string() {
  value="${1:-}"
  if [ -z "$value" ]; then
    printf 'undefined'
    return
  fi

  escaped=$(printf '%s' "$value" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '"%s"' "$escaped"
}

js_number() {
  value="${1:-}"
  case "$value" in
    ''|*[!0-9]*) printf 'undefined' ;;
    *) printf '%s' "$value" ;;
  esac
}

cat > "$CONFIG_PATH" <<EOF
// Generated at container startup. Do not cache this file.
window.__CRAPS_CONFIG__ = {
  baseSepoliaGameAddressV3: $(js_string "${CRAPS_BASE_SEPOLIA_GAME_ADDRESS_V3:-}"),
  baseMainnetGameAddressV3: $(js_string "${CRAPS_BASE_MAINNET_GAME_ADDRESS_V3:-}"),
  baseSepoliaTokenAddress: $(js_string "${CRAPS_BASE_SEPOLIA_TOKEN_ADDRESS:-}"),
  baseMainnetTokenAddress: $(js_string "${CRAPS_BASE_MAINNET_TOKEN_ADDRESS:-}"),
  baseSepoliaRpcUrl: $(js_string "${CRAPS_BASE_SEPOLIA_RPC_URL:-}"),
  baseMainnetRpcUrl: $(js_string "${CRAPS_BASE_MAINNET_RPC_URL:-}"),
  walletConnectProjectId: $(js_string "${CRAPS_WALLETCONNECT_PROJECT_ID:-}"),
  defaultChainId: $(js_number "${CRAPS_DEFAULT_CHAIN_ID:-}")
};
EOF
