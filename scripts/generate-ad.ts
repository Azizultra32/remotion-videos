#!/usr/bin/env npx tsx

/**
 * AI-Generated Ad Pipeline
 *
 * Usage:
 *   npx tsx scripts/generate-ad.ts --brand <name> [options]
 *   npx tsx scripts/generate-ad.ts --text "ad script" [options]
 *
 * Options:
 *   --brand <name>       Load brand config from brands/<name>/brand-config.json
 *   --text <script>      Voiceover script text
 *   --voice <id>         ElevenLabs voice ID
 *   --product-prompt <p> Generate product image with AI (requires NANOBANANAPRO_API_KEY)
 *   --lipsync-image <p>  Generate lip-sync video from this face image URL (requires WAVESPEED_API_KEY)
 *   --composition <id>   Composition to render (default: AdCreative)
 *   --output <path>      Output file path (default: out/ad-generated.mp4)
 *   --skip-render        Generate assets only, don't render video
 *   --dry-run            Show what would happen without doing it
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { generateVoiceover } from "../src/lib/elevenlabs";
import { generateProductImage } from "../src/lib/nanobananapro";
import { generateLipSync } from "../src/lib/wavespeed";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const brandName = getArg("brand");
const text = getArg("text");
const voiceId = getArg("voice");
const productPrompt = getArg("product-prompt");
const lipsyncImage = getArg("lipsync-image");
const composition = getArg("composition") || "AdCreative";
const outputPath = getArg("output") || "out/ad-generated.mp4";
const skipRender = hasFlag("skip-render");
const dryRun = hasFlag("dry-run");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(step: string, msg: string) {
  console.log(`\n[${"=".repeat(3)} ${step} ${"=".repeat(3)}] ${msg}`);
}

function warn(msg: string) {
  console.log(`  [SKIP] ${msg}`);
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(60));
  console.log("  AI-Generated Ad Pipeline");
  console.log("=".repeat(60));

  const summary: string[] = [];

  // ------------------------------------------------------------------
  // Step 1: Load brand config (if --brand)
  // ------------------------------------------------------------------
  let brandConfig: Record<string, any> | undefined;

  if (brandName) {
    log("BRAND", `Loading brand config for "${brandName}"...`);
    const configPath = path.join(process.cwd(), "brands", brandName, "brand-config.json");

    if (!fs.existsSync(configPath)) {
      console.error(`Brand config not found: ${configPath}`);
      process.exit(1);
    }

    brandConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log(`  Brand: ${brandConfig!.name}`);
    console.log(`  Colors: ${JSON.stringify(brandConfig!.colors)}`);
    summary.push(`Brand: ${brandConfig!.name}`);
  }

  // ------------------------------------------------------------------
  // Step 2: Generate voiceover (if --text)
  // ------------------------------------------------------------------
  let voiceoverUrl: string | undefined;

  if (text) {
    log("VOICEOVER", `Generating voiceover...`);
    console.log(`  Text: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);

    if (!process.env.ELEVENLABS_API_KEY) {
      warn("ELEVENLABS_API_KEY not set, skipping voiceover generation");
    } else if (dryRun) {
      console.log("  [DRY RUN] Would generate voiceover with ElevenLabs");
      voiceoverUrl = "audio/dry-run-placeholder.mp3";
    } else {
      voiceoverUrl = await generateVoiceover({
        text,
        voiceId: voiceId || undefined,
      });
      console.log(`  Generated: ${voiceoverUrl}`);
      summary.push(`Voiceover: ${voiceoverUrl}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Generate product image (if --product-prompt)
  // ------------------------------------------------------------------
  let productImagePath: string | undefined;

  if (productPrompt) {
    log("PRODUCT IMAGE", `Generating product image...`);
    console.log(
      `  Prompt: "${productPrompt.slice(0, 80)}${productPrompt.length > 80 ? "..." : ""}"`,
    );

    if (!process.env.NANOBANANAPRO_API_KEY) {
      warn("NANOBANANAPRO_API_KEY not set, skipping product image generation");
    } else if (dryRun) {
      console.log("  [DRY RUN] Would generate product image with Nano Banana Pro");
      productImagePath = "images/dry-run-placeholder.png";
    } else {
      productImagePath = await generateProductImage(productPrompt);
      console.log(`  Generated: ${productImagePath}`);
      summary.push(`Product image: ${productImagePath}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Generate lip-sync video (if --lipsync-image AND voiceover exists)
  // ------------------------------------------------------------------
  let lipSyncVideoUrl: string | undefined;

  if (lipsyncImage) {
    log("LIP-SYNC", `Generating lip-sync video...`);

    if (!voiceoverUrl) {
      warn("No voiceover generated (need --text + ELEVENLABS_API_KEY), skipping lip-sync");
    } else if (!process.env.WAVESPEED_API_KEY) {
      warn("WAVESPEED_API_KEY not set, skipping lip-sync generation");
    } else if (dryRun) {
      console.log("  [DRY RUN] Would generate lip-sync video with WaveSpeed");
      lipSyncVideoUrl = "video/dry-run-placeholder.mp4";
    } else {
      const audioAbsPath = path.join(process.cwd(), "public", voiceoverUrl);
      lipSyncVideoUrl = await generateLipSync(lipsyncImage, audioAbsPath);
      console.log(`  Generated: ${lipSyncVideoUrl}`);
      summary.push(`Lip-sync video: ${lipSyncVideoUrl}`);
    }
  }

  // ------------------------------------------------------------------
  // Step 5: Assemble props
  // ------------------------------------------------------------------
  log("PROPS", "Assembling composition props...");

  const props: Record<string, any> = {
    productName: brandConfig?.name || "Product",
    productImage: productImagePath || "",
    price: "$99",
    features: ["Feature 1", "Feature 2", "Feature 3"],
    ctaText: "Shop Now",
    backgroundColor: brandConfig?.colors?.background || "#0a0a1a",
    accentColor: brandConfig?.colors?.accent || brandConfig?.colors?.primary || "#ff4757",
    orientation: "horizontal",
  };

  if (voiceoverUrl) {
    props.voiceoverUrl = voiceoverUrl;
  }

  if (lipSyncVideoUrl) {
    props.lipSyncVideoUrl = lipSyncVideoUrl;
  }

  console.log(`  Props: ${JSON.stringify(props, null, 2)}`);

  // ------------------------------------------------------------------
  // Step 6: Render (unless --skip-render)
  // ------------------------------------------------------------------
  if (skipRender) {
    log("RENDER", "Skipping render (--skip-render flag set)");
    summary.push("Render: skipped");
  } else if (dryRun) {
    log("RENDER", "[DRY RUN] Would execute:");
    console.log(`  npx remotion render src/index.ts ${composition} ${outputPath} --props '<json>'`);
    summary.push("Render: dry run");
  } else {
    log("RENDER", `Rendering ${composition} to ${outputPath}...`);

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const propsJson = JSON.stringify(props);
    const args = [
      "remotion",
      "render",
      "src/index.ts",
      composition,
      outputPath,
      "--props",
      propsJson,
    ];

    console.log(`  Command: npx ${args.join(" ")}`);

    try {
      execFileSync("npx", args, {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      console.log(`\n  Rendered successfully: ${outputPath}`);
      summary.push(`Rendered: ${outputPath}`);
    } catch (err) {
      console.error(`\n  Render failed!`);
      console.error(err);
      process.exit(1);
    }
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("  Pipeline Summary");
  console.log("=".repeat(60));
  if (summary.length === 0) {
    console.log("  Nothing was generated (no options provided)");
  } else {
    summary.forEach((s) => console.log(`  - ${s}`));
  }
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\nPipeline failed:", err);
  process.exit(1);
});
