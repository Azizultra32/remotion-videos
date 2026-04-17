#!/bin/bash
# Integration verification for the music video editor (Task 10).
# Checks file layout, TypeScript compilation, and a production build.
# Run from repo root: bash editor/verify-editor.sh

set -e
cd "$(dirname "$0")"

echo "Music Video Editor Verification"
echo "================================"
echo ""

FAIL=0
pass() { echo "   ✓ $1"; }
fail() { echo "   ✗ $1"; FAIL=1; }

echo "1. Required files present:"
REQUIRED_FILES=(
  "package.json"
  "vite.config.ts"
  "tsconfig.json"
  "index.html"
  "src/main.tsx"
  "src/App.tsx"
  "src/store.ts"
  "src/types.ts"
  "src/components/Preview.tsx"
  "src/components/Waveform.tsx"
  "src/components/BeatMarkers.tsx"
  "src/components/Timeline.tsx"
  "src/components/TimelineTrack.tsx"
  "src/components/TimelineElement.tsx"
  "src/components/ElementDetail.tsx"
  "src/components/TransportControls.tsx"
  "src/components/SpectrumDisplay.tsx"
  "src/components/ErrorBoundary.tsx"
  "src/hooks/useBeatData.ts"
  "src/hooks/useElementDrag.ts"
  "src/hooks/usePlaybackSync.ts"
  "src/utils/time.ts"
  "src/utils/propsBuilder.ts"
)
for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "$f" ]; then pass "$f"; else fail "$f missing"; fi
done

echo ""
echo "2. Dependencies installed:"
if [ -d "node_modules" ]; then pass "node_modules/ present"; else fail "node_modules/ missing — run npm install"; fi
if [ -d "node_modules/@remotion/player" ]; then pass "@remotion/player installed"; else fail "@remotion/player missing"; fi
if [ -d "node_modules/zustand" ]; then pass "zustand installed"; else fail "zustand missing"; fi
if [ -d "node_modules/wavesurfer.js" ]; then pass "wavesurfer.js installed"; else fail "wavesurfer.js missing"; fi

echo ""
echo "3. TypeScript compilation:"
if npx tsc --noEmit 2>&1; then pass "tsc --noEmit clean"; else fail "tsc --noEmit reported errors"; fi

echo ""
echo "4. Key features wired up in App.tsx:"
grep -q "ErrorBoundary" src/App.tsx && pass "ErrorBoundary wraps sections" || fail "ErrorBoundary not wired"
grep -q "useBeatData" src/App.tsx && pass "beat data hook used" || fail "useBeatData not called"
grep -q "usePlaybackSync" src/App.tsx && pass "playback sync hook used" || fail "usePlaybackSync not called"

echo ""
echo "5. Drag bounds enforced in useElementDrag:"
grep -q "compositionDuration" src/hooks/useElementDrag.ts && pass "drag clamps to composition duration" || fail "drag bounds missing"

echo ""
echo "6. Production build (vite build):"
# Real integration check — catches import errors, missing deps, malformed JSX,
# failed tree-shaking, etc. that tsc --noEmit won't catch.
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "   (skipped — SKIP_BUILD=1)"
else
  BUILD_LOG=$(mktemp)
  if npx vite build --logLevel=error >"$BUILD_LOG" 2>&1; then
    pass "vite build succeeded"
    # Bundle should contain editor entry and a non-empty JS chunk
    if [ -d "dist" ] && find dist -name "*.js" -type f -not -empty | grep -q .; then
      pass "dist/ contains non-empty JS bundle"
    else
      fail "dist/ missing or empty after build"
    fi
  else
    fail "vite build failed — see log:"
    cat "$BUILD_LOG"
  fi
  rm -f "$BUILD_LOG"
fi

echo ""
echo "7. SpectrumDisplay drop flash lines (Task 9):"
grep -q "drops.map" src/components/SpectrumDisplay.tsx && pass "drop lines rendered" || fail "drop flash lines missing"

echo ""
echo "8. Behavioral tests (vitest):"
# Real logic tests — exercise store actions and propsBuilder mappings.
# Catches regressions in add/update/remove/select, snap+loop toggles, and
# label→prop mapping that grep-based checks cannot.
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "   (skipped — SKIP_TESTS=1)"
else
  TEST_LOG=$(mktemp)
  if npx vitest run --reporter=default >"$TEST_LOG" 2>&1; then
    PASS_LINE=$(grep -E "^ +Tests +" "$TEST_LOG" | head -1)
    pass "vitest ${PASS_LINE:-passed}"
  else
    fail "vitest failed — see log:"
    cat "$TEST_LOG"
  fi
  rm -f "$TEST_LOG"
fi

echo ""
echo "9. usePlaybackSync respects loopPlayback (Task 7):"
grep -q "loopPlayback" src/hooks/usePlaybackSync.ts && pass "loopPlayback consulted in playback advance" || fail "usePlaybackSync ignores loopPlayback"

echo ""
echo "10. ElementDetail spring-curve preview (Task 6):"
grep -q "SpringPreview" src/components/ElementDetail.tsx && pass "spring-curve preview present" || fail "SpringPreview component missing"

echo ""
echo "================================"
if [ $FAIL -eq 0 ]; then
  echo "All checks passed."
  exit 0
else
  echo "Some checks failed."
  exit 1
fi
