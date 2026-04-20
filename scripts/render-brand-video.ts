#!/usr/bin/env npx tsx

/**
 * Render a complete branded video
 * Usage: npx tsx scripts/render-brand-video.ts <brand-name> [options]
 *
 * Options:
 *   --composition <id>  Which composition (default: BrandedDemo)
 *   --with-voiceover    Generate voiceover from tagline + feature descriptions
 *   --output <path>     Output path (default: out/<brand>-<composition>.mp4)
 *   --still <frame>     Render a single frame instead of full video
 *   --codec <codec>     Video codec (default: h264)
 *   --crf <number>      CRF quality value (default: 18)
 *   --help              Show this help message
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandConfig {
  name: string;
  tagline: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: {
    heading: string;
    body: string;
  };
  social?: {
    website?: string;
    twitter?: string;
  };
  features?: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
  ctaText?: string;
}

interface CliOptions {
  brandSlug: string;
  composition: string;
  withVoiceover: boolean;
  outputPath: string | null;
  stillFrame: number | null;
  codec: string;
  crf: number;
}

// ---------------------------------------------------------------------------
// Default features (used when brand-config.json has no features array)
// ---------------------------------------------------------------------------

const DEFAULT_FEATURES = [
  { title: "Feature 1", description: "Description here", icon: "\u26A1" },
  { title: "Feature 2", description: "Description here", icon: "\uD83D\uDEE1\uFE0F" },
  { title: "Feature 3", description: "Description here", icon: "\u2728" },
];

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/render-brand-video.ts <brand-name> [options]

Options:
  --composition <id>  Which composition to render (default: BrandedDemo)
  --with-voiceover    Generate voiceover from tagline + feature descriptions
  --output <path>     Output file path (default: out/<brand>-<composition>.mp4)
  --still <frame>     Render a single frame as PNG instead of full video
  --codec <codec>     Video codec: h264, h265, vp8, vp9 (default: h264)
  --crf <number>      CRF quality value, lower = better (default: 18)
  --help              Show this help message

Examples:
  npx tsx scripts/render-brand-video.ts example-brand
  npx tsx scripts/render-brand-video.ts acme-corp --composition BrandedDemo
  npx tsx scripts/render-brand-video.ts acme-corp --still 45 --output preview.png
  npx tsx scripts/render-brand-video.ts acme-corp --with-voiceover
`);
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    brandSlug: "",
    composition: "BrandedDemo",
    withVoiceover: false,
    outputPath: null,
    stillFrame: null,
    codec: "h264",
    crf: 18,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--composition":
        opts.composition = args[++i];
        break;
      case "--with-voiceover":
        opts.withVoiceover = true;
        break;
      case "--output":
        opts.outputPath = args[++i];
        break;
      case "--still":
        opts.stillFrame = parseInt(args[++i], 10);
        break;
      case "--codec":
        opts.codec = args[++i];
        break;
      case "--crf":
        opts.crf = parseInt(args[++i], 10);
        break;
      default:
        if (!arg.startsWith("-") && !opts.brandSlug) {
          opts.brandSlug = arg;
        } else if (!arg.startsWith("-")) {
          console.warn(`Warning: ignoring unknown argument "${arg}"`);
        }
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Voiceover generation
// ---------------------------------------------------------------------------

function generateVoiceoverText(config: BrandConfig): string {
  const parts: string[] = [];
  parts.push(`Introducing ${config.name}. ${config.tagline}.`);

  const features = config.features || DEFAULT_FEATURES;
  for (const feature of features) {
    if (feature.description && feature.description !== "Description here") {
      parts.push(`${feature.title}. ${feature.description}`);
    }
  }

  if (config.ctaText) {
    parts.push(config.ctaText);
  }

  return parts.join(" ");
}

function runVoiceover(config: BrandConfig, projectRoot: string): string {
  const text = generateVoiceoverText(config);
  console.log(`\nGenerating voiceover for text:\n  "${text.slice(0, 100)}..."\n`);

  const scriptPath = path.resolve(__dirname, "generate-voiceover.ts");
  try {
    const result = execFileSync("npx", ["tsx", scriptPath, text], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    console.log(result);

    // Extract the audio path from output
    const match = result.match(/staticFile\("([^"]+)"\)/);
    if (match) {
      return match[1];
    }
    console.warn("Warning: Could not parse voiceover output path.");
    return "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Voiceover generation failed: ${msg}`);
    console.error("Continuing without voiceover...");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  if (!opts.brandSlug) {
    console.error("Error: Brand name is required.\n");
    printUsage();
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const brandDir = path.join(projectRoot, "brands", opts.brandSlug);
  const configPath = path.join(brandDir, "brand-config.json");

  // 1. Load brand config
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Brand config not found at brands/${opts.brandSlug}/brand-config.json`);
    console.error(`\nCreate it first: npx tsx scripts/new-brand.ts ${opts.brandSlug}`);
    process.exit(1);
  }

  const rawConfig = fs.readFileSync(configPath, "utf-8");
  let brandConfig: BrandConfig;
  try {
    brandConfig = JSON.parse(rawConfig);
  } catch {
    console.error(`Error: Invalid JSON in brands/${opts.brandSlug}/brand-config.json`);
    process.exit(1);
  }

  console.log(`Brand: ${brandConfig.name}`);
  console.log(`Composition: ${opts.composition}`);

  // 2. Check for logo
  const logoPath = path.join(brandDir, "logos", "logo.svg");
  const hasLogo = fs.existsSync(logoPath);
  if (hasLogo) {
    console.log(`Logo: found at brands/${opts.brandSlug}/logos/logo.svg`);
  } else {
    console.log("Logo: not found (showLogo will be false)");
  }

  // 3. Handle voiceover
  let voiceoverPath = "";
  if (opts.withVoiceover) {
    voiceoverPath = runVoiceover(brandConfig, projectRoot);
  }

  // 4. Assemble props
  const features = brandConfig.features || DEFAULT_FEATURES;
  const ctaText = brandConfig.ctaText || "Get Started Today";

  const props = {
    brandName: opts.brandSlug,
    brandConfig: {
      name: brandConfig.name,
      tagline: brandConfig.tagline,
      colors: brandConfig.colors,
      typography: brandConfig.typography,
      social: brandConfig.social,
    },
    features,
    ctaText,
    showLogo: hasLogo,
    ...(voiceoverPath ? { voiceoverPath } : {}),
  };

  const propsJson = JSON.stringify(props);

  // 5. Determine output path
  const isStill = opts.stillFrame !== null;
  const ext = isStill ? ".png" : ".mp4";
  const outputPath =
    opts.outputPath || path.join(projectRoot, "out", `${opts.brandSlug}-${opts.composition}${ext}`);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 6. Write props to temp file to avoid shell escaping issues
  const propsFile = path.join(projectRoot, ".tmp-render-props.json");
  fs.writeFileSync(propsFile, propsJson);

  // 7. Build remotion command args
  const entryPoint = "src/index.ts";

  try {
    if (isStill) {
      const args = [
        "remotion",
        "still",
        entryPoint,
        opts.composition,
        outputPath,
        `--props=${propsFile}`,
        `--frame=${opts.stillFrame}`,
      ];

      console.log(`\nRendering still frame ${opts.stillFrame}...`);
      console.log(`Output: ${path.relative(projectRoot, outputPath)}\n`);

      execFileSync("npx", args, {
        cwd: projectRoot,
        stdio: "inherit",
        env: { ...process.env },
      });
    } else {
      const args = [
        "remotion",
        "render",
        entryPoint,
        opts.composition,
        outputPath,
        `--props=${propsFile}`,
        `--codec=${opts.codec}`,
        `--crf=${opts.crf}`,
      ];

      console.log(`\nRendering video...`);
      console.log(`Output: ${path.relative(projectRoot, outputPath)}\n`);

      execFileSync("npx", args, {
        cwd: projectRoot,
        stdio: "inherit",
        env: { ...process.env },
      });
    }
  } catch (_err: unknown) {
    console.error("\nRender failed.");
    process.exit(1);
  } finally {
    // Clean up temp props file
    try {
      fs.unlinkSync(propsFile);
    } catch {
      // ignore cleanup errors
    }
  }

  // 8. Report result
  if (fs.existsSync(outputPath)) {
    const stat = fs.statSync(outputPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`\nDone! Output: ${outputPath} (${sizeMB} MB)`);
  } else {
    console.log(`\nDone! Output: ${outputPath}`);
  }

  if (voiceoverPath) {
    console.log(`Voiceover: public/${voiceoverPath}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
