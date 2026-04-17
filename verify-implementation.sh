#!/bin/bash
set -e

echo "Verification Report for VideoWithTitle Timing Parameters"
echo "=========================================================="
echo ""

echo "1. Schema Extension Check:"
grep -q "fadeInStartSec: z.number().default(0.5)" src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeInStartSec in schema" || echo "   ✗ fadeInStartSec missing"
grep -q "fadeInEndSec: z.number().default(1.5)" src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeInEndSec in schema" || echo "   ✗ fadeInEndSec missing"
grep -q "lineGrowStartSec: z.number().default(0.8)" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrowStartSec in schema" || echo "   ✗ lineGrowStartSec missing"
grep -q "lineGrowEndSec: z.number().default(1.8)" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrowEndSec in schema" || echo "   ✗ lineGrowEndSec missing"
grep -q "lineGrowWidth: z.number().default(80)" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrowWidth in schema" || echo "   ✗ lineGrowWidth missing"
grep -q "titleScaleAmount: z.number().default(0.14)" src/compositions/VideoWithTitle.tsx && echo "   ✓ titleScaleAmount in schema" || echo "   ✗ titleScaleAmount missing"
grep -q "videoOpacityBase: z.number().default(0.08)" src/compositions/VideoWithTitle.tsx && echo "   ✓ videoOpacityBase in schema" || echo "   ✗ videoOpacityBase missing"
grep -q "videoScaleAmount: z.number().default(0.08)" src/compositions/VideoWithTitle.tsx && echo "   ✓ videoScaleAmount in schema" || echo "   ✗ videoScaleAmount missing"
grep -q "sonarRing1ScaleMax: z.number().default(1.8)" src/compositions/VideoWithTitle.tsx && echo "   ✓ sonarRing1ScaleMax in schema" || echo "   ✗ sonarRing1ScaleMax missing"
grep -q "sonarRing2ScaleMax: z.number().default(2.6)" src/compositions/VideoWithTitle.tsx && echo "   ✓ sonarRing2ScaleMax in schema" || echo "   ✗ sonarRing2ScaleMax missing"
grep -q "sonarCoreSizeBase: z.number().default(14)" src/compositions/VideoWithTitle.tsx && echo "   ✓ sonarCoreSizeBase in schema" || echo "   ✗ sonarCoreSizeBase missing"
grep -q "sonarCoreSizePulse: z.number().default(6)" src/compositions/VideoWithTitle.tsx && echo "   ✓ sonarCoreSizePulse in schema" || echo "   ✗ sonarCoreSizePulse missing"

echo ""
echo "2. Component Props Destructuring Check:"
grep -q "fadeInStartSec," src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeInStartSec destructured" || echo "   ✗ fadeInStartSec not destructured"
grep -q "fadeInEndSec," src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeInEndSec destructured" || echo "   ✗ fadeInEndSec not destructured"
grep -q "lineGrowStartSec," src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrowStartSec destructured" || echo "   ✗ lineGrowStartSec not destructured"
grep -q "sonarRing1ScaleMax," src/compositions/VideoWithTitle.tsx && echo "   ✓ sonarRing1ScaleMax destructured" || echo "   ✗ sonarRing1ScaleMax not destructured"

echo ""
echo "3. Interpolation Updates Check:"
grep -q "fps \* fadeInStartSec" src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeIn uses fadeInStartSec" || echo "   ✗ fadeIn still hardcoded"
grep -q "fps \* fadeInEndSec" src/compositions/VideoWithTitle.tsx && echo "   ✓ fadeIn uses fadeInEndSec" || echo "   ✗ fadeIn still hardcoded"
grep -q "fps \* lineGrowStartSec" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrow uses lineGrowStartSec" || echo "   ✗ lineGrow still hardcoded"
grep -q "fps \* lineGrowEndSec" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrow uses lineGrowEndSec" || echo "   ✗ lineGrow still hardcoded"
grep -q "\[0, lineGrowWidth\]" src/compositions/VideoWithTitle.tsx && echo "   ✓ lineGrow uses lineGrowWidth" || echo "   ✗ lineGrowWidth not used"

echo ""
echo "4. Component Calculations Check:"
grep -q "1 + beatPulse \* titleScaleAmount" src/compositions/VideoWithTitle.tsx && echo "   ✓ titleScale uses titleScaleAmount" || echo "   ✗ titleScale still hardcoded"
grep -q "videoOpacityBase + beatPulse \* 0.92" src/compositions/VideoWithTitle.tsx && echo "   ✓ video opacity uses videoOpacityBase" || echo "   ✗ video opacity still hardcoded"
grep -q "1 + beatPulse \* videoScaleAmount" src/compositions/VideoWithTitle.tsx && echo "   ✓ video scale uses videoScaleAmount" || echo "   ✗ video scale still hardcoded"

echo ""
echo "5. SonarLogo Props Check:"
grep -q "ring1ScaleMax," src/compositions/VideoWithTitle.tsx && echo "   ✓ ring1ScaleMax passed to SonarLogo" || echo "   ✗ ring1ScaleMax not passed"
grep -q "ring2ScaleMax," src/compositions/VideoWithTitle.tsx && echo "   ✓ ring2ScaleMax passed to SonarLogo" || echo "   ✗ ring2ScaleMax not passed"
grep -q "coreSizeBase," src/compositions/VideoWithTitle.tsx && echo "   ✓ coreSizeBase passed to SonarLogo" || echo "   ✗ coreSizeBase not passed"
grep -q "coreSizePulse," src/compositions/VideoWithTitle.tsx && echo "   ✓ coreSizePulse passed to SonarLogo" || echo "   ✗ coreSizePulse not passed"

echo ""
echo "6. SonarLogo Internal Calculations Check:"
grep -q "1 + beatPulse \* ring1ScaleMax" src/compositions/VideoWithTitle.tsx && echo "   ✓ ring1Scale uses ring1ScaleMax" || echo "   ✗ ring1Scale still hardcoded"
grep -q "1 + downbeatFlash \* ring2ScaleMax" src/compositions/VideoWithTitle.tsx && echo "   ✓ ring2Scale uses ring2ScaleMax" || echo "   ✗ ring2Scale still hardcoded"
grep -q "coreSizeBase + beatPulse \* coreSizePulse" src/compositions/VideoWithTitle.tsx && echo "   ✓ coreSize uses coreSizeBase and coreSizePulse" || echo "   ✗ coreSize still hardcoded"

echo ""
echo "7. Default Props Check:"
# Extract the defaultVideoWithTitleProps block and check each prop individually.
# This is more robust than counting occurrences of a single prop across the file.
DEFAULTS_BLOCK=$(awk '/defaultVideoWithTitleProps.*=.*{/,/^};/' src/compositions/VideoWithTitle.tsx)
check_default() {
  local prop="$1"
  if echo "$DEFAULTS_BLOCK" | grep -q "^[[:space:]]*${prop}:"; then
    echo "   ✓ ${prop} in defaults"
  else
    echo "   ✗ ${prop} missing from defaults"
  fi
}
check_default fadeInStartSec
check_default fadeInEndSec
check_default lineGrowStartSec
check_default lineGrowEndSec
check_default lineGrowWidth
check_default titleScaleAmount
check_default videoOpacityBase
check_default videoScaleAmount
check_default sonarRing1ScaleMax
check_default sonarRing2ScaleMax
check_default sonarCoreSizeBase
check_default sonarCoreSizePulse

echo ""
echo "8. TypeScript Compilation:"
npx tsc --noEmit 2>&1 && echo "   ✓ TypeScript compilation successful" || echo "   ✗ TypeScript compilation failed"

echo ""
echo "9. Composition Registration:"
npx remotion compositions src/index.ts 2>&1 | grep -q "VideoWithTitle" && echo "   ✓ VideoWithTitle composition loads" || echo "   ✗ VideoWithTitle composition failed to load"

echo ""
echo "=========================================================="
echo "Implementation verification complete!"
