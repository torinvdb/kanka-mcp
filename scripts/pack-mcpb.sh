#!/usr/bin/env bash
# Build a Claude Desktop extension bundle (.mcpb) from this repo.
#
# Strategy: copy the production-only file tree into a staging directory,
# install runtime deps there, and run mcpb against the staged copy. The
# repo's own node_modules is left untouched so dev tooling stays available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

VERSION=$(node -p "require('./package.json').version")
OUT="$REPO_DIR/kanka-mcp-${VERSION}.mcpb"

echo "==> Validating manifest.json"
npx mcpb validate manifest.json

echo "==> Building TypeScript"
npm run build --silent

echo "==> Staging production tree"
STAGING=$(mktemp -d -t kanka-mcp-pack-XXXXXX)
trap 'rm -rf "$STAGING"' EXIT

cp manifest.json package.json package-lock.json "$STAGING/"
cp -r dist "$STAGING/dist"
# Copy .mcpbignore so the staged tree carries the same exclusion rules.
cp .mcpbignore "$STAGING/.mcpbignore" 2>/dev/null || true

echo "==> Installing production dependencies in staging"
(cd "$STAGING" && npm ci --omit=dev --silent)

echo "==> Packing bundle"
rm -f "$OUT"
npx mcpb pack "$STAGING" "$OUT"

# Defense in depth: if the user has any Kanka secret in their environment when
# packing (likely — they probably ran the smoke test in the same shell), scan
# the resulting archive for that literal value. If anything matches, refuse to
# ship the bundle. This protects against future build-step regressions where
# tooling might accidentally embed env values into output files.
echo "==> Scanning bundle for leaked secrets"
check_no_leak() {
  local name="$1"
  local val="${2:-}"
  if [ -z "$val" ]; then return 0; fi
  if unzip -p "$OUT" 2>/dev/null | grep -qF -- "$val"; then
    echo "ERROR: bundle contains the literal value of \$$name." >&2
    echo "Refusing to ship a bundle with embedded secrets." >&2
    rm -f "$OUT"
    exit 2
  fi
}
check_no_leak KANKA_TOKEN "${KANKA_TOKEN:-}"
check_no_leak KANKA_OAUTH_CLIENT_SECRET "${KANKA_OAUTH_CLIENT_SECRET:-}"
echo "✓ No secret values from \$KANKA_TOKEN or \$KANKA_OAUTH_CLIENT_SECRET found"

echo ""
echo "✓ Built $(basename "$OUT")"
ls -lh "$OUT"
echo ""
echo "Install via Claude Desktop:"
echo "  Settings → Extensions → Advanced settings → Install Extension… → select"
echo "  $OUT"
