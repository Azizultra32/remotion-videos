#!/usr/bin/env bash
#
# scripts/smoke-test.sh
#
# Fast regression guard (<15s). Asserts the invariants that previous
# AI sessions broke and then fixed.
#
# Usage:
#   bash scripts/smoke-test.sh          # fast checks only
#   bash scripts/smoke-test.sh --full   # includes tsc + verify-element
#   npm run smoke

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
FULL=false
if [ "${1:-}" = "--full" ]; then FULL=true; fi

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf "  ${GREEN}OK${NC}   %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  ${RED}FAIL${NC} %s\n" "$1"; }

echo "smoke-test: checking invariants..."
echo ""

# 1. No Math.random() in src/ render paths
RANDOM_COUNT=$(grep -rn 'Math\.random()' src/ 2>/dev/null | grep -v 'node_modules' | grep -v '.test.' | wc -l | tr -d ' ')
if [ "$RANDOM_COUNT" = "0" ]; then ok "no Math.random() in src/ render paths"; else fail "Math.random() found in src/ ($RANDOM_COUNT)"; fi

# 2-6. Batch TSX checks
TMPFILE=.smoke-check.tmp.ts
trap "rm -f $TMPFILE" EXIT
cat > "$TMPFILE" <<'TS'
import { generateAssetId } from "./editor/src/types/assetRecord";
import { resolveStatic } from "./src/compositions/elements/_helpers";
const sf = (s: string) => "/static/" + s;
const results: [boolean, string][] = [];
const a = generateAssetId("assets/logo.png");
const b = generateAssetId("assets/logo.png");
results.push([a === b, "determinism"]);
results.push([/^ast_[0-9a-f]{16}$/.test(a), "format"]);
const reg = [{ id: "ast_deadbeef12345678", path: "assets/img.png" }];
results.push([resolveStatic("ast_deadbeef12345678", sf, reg) === "/static/assets/img.png", "resolve_id"]);
results.push([resolveStatic("https://example.com/img.png", sf) === "https://example.com/img.png", "resolve_http"]);
const regAlias = [{ id: "ast_aabbccdd11223344", path: "assets/new.png", aliases: ["ast_deadbeef12345678"] }];
results.push([resolveStatic("ast_deadbeef12345678", sf, regAlias) === "/static/assets/new.png", "resolve_alias"]);
for (const [ok, label] of results) {
  process.stdout.write(ok ? "1 " + label + "\n" : "0 " + label + "\n");
}
TS

RESULTFILE=.smoke-results.tmp.txt
npx tsx "$TMPFILE" > "$RESULTFILE" 2>/dev/null

while IFS=' ' read -r status name; do
  if [ "$status" = "1" ]; then ok "$name"; else fail "$name"; fi
done < "$RESULTFILE"
rm -f "$RESULTFILE"
rm -f "$TMPFILE"

# --- Full checks (optional, ~60s) ---
if $FULL; then
  echo "  ...running tsc --noEmit"
  if npx tsc --noEmit; then ok "tsc --noEmit passes"; else fail "tsc --noEmit has errors"; fi

  echo "  ...running mv:verify-element"
  if npm run mv:verify-element >/dev/null 2>&1; then ok "mv:verify-element 5/5 checks pass"; else fail "mv:verify-element failed"; fi
fi

echo ""
echo "smoke-test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
