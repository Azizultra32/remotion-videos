#!/bin/bash
# Render a branded video with custom props
# Usage: ./scripts/render-brand.sh <brand-name> [composition-id] [output-name]

set -e
cd "$(dirname "$0")/.."

BRAND="$1"
COMP="${2:-BrandedDemo}"
OUTPUT="${3:-out/${BRAND}-${COMP}.mp4}"

if [ -z "$BRAND" ]; then
  echo "Usage: $0 <brand-name> [composition-id] [output-name]"
  exit 1
fi

BRAND_CONFIG="brands/$BRAND/brand-config.json"
if [ ! -f "$BRAND_CONFIG" ]; then
  echo "Error: Brand config not found at $BRAND_CONFIG"
  exit 1
fi

# Wrap the raw brand-config.json into the BrandedDemo props shape
PROPS=$(jq -n \
  --arg brandName "$BRAND" \
  --slurpfile config "$BRAND_CONFIG" \
  '{
    brandName: $brandName,
    brandConfig: $config[0],
    features: [
      {title: "Feature 1", description: "Description here", icon: "⚡"},
      {title: "Feature 2", description: "Description here", icon: "🛡️"},
      {title: "Feature 3", description: "Description here", icon: "✨"}
    ],
    ctaText: "Get Started Today",
    showLogo: false
  }')

echo "Rendering $COMP for brand: $BRAND"
npx remotion render src/index.ts "$COMP" "$OUTPUT" --props "$PROPS" 2>&1
echo "✓ Output: $OUTPUT"
