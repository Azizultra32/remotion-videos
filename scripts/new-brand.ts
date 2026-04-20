#!/usr/bin/env npx tsx
/**
 * Create a new brand workspace
 * Usage: npx tsx scripts/new-brand.ts <brand-name> [--interactive]
 *
 * Creates: brands/<brand-name>/
 *   brand-config.json (with prompts or defaults)
 *   logos/ (empty dir)
 *   photos/ (empty dir)
 *   fonts/ (empty dir)
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  name: "",
  tagline: "Your tagline here",
  colors: {
    primary: "#3b82f6",
    secondary: "#8b5cf6",
    accent: "#f59e0b",
    background: "#ffffff",
    text: "#111827",
  },
  typography: {
    heading: "system-ui, -apple-system, sans-serif",
    body: "system-ui, -apple-system, sans-serif",
  },
  social: {
    website: "",
    twitter: "",
  },
  features: [
    {
      title: "Feature 1",
      description: "Describe your first key feature here.",
      icon: "⚡",
    },
    {
      title: "Feature 2",
      description: "Describe your second key feature here.",
      icon: "🛡️",
    },
    {
      title: "Feature 3",
      description: "Describe your third key feature here.",
      icon: "✨",
    },
  ],
  ctaText: "Get Started Today",
};

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
Usage: npx tsx scripts/new-brand.ts <brand-name> [options]

Options:
  --interactive    Prompt for brand values interactively
  --name <name>    Brand display name (default: derived from brand-name)
  --tagline <text> Brand tagline
  --primary <hex>  Primary color (default: #3b82f6)
  --secondary <hex> Secondary color (default: #8b5cf6)
  --accent <hex>   Accent color (default: #f59e0b)
  --help           Show this help message

Examples:
  npx tsx scripts/new-brand.ts acme-corp
  npx tsx scripts/new-brand.ts acme-corp --interactive
  npx tsx scripts/new-brand.ts acme-corp --name "Acme Corp" --primary "#ff6600"
`);
}

function slugToDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseArgs(): {
  brandSlug: string;
  interactive: boolean;
  overrides: Record<string, string>;
} {
  const args = process.argv.slice(2);
  let brandSlug = "";
  let interactive = false;
  const overrides: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--interactive" || arg === "-i") {
      interactive = true;
    } else if (arg === "--name" && args[i + 1]) {
      overrides.name = args[++i];
    } else if (arg === "--tagline" && args[i + 1]) {
      overrides.tagline = args[++i];
    } else if (arg === "--primary" && args[i + 1]) {
      overrides.primary = args[++i];
    } else if (arg === "--secondary" && args[i + 1]) {
      overrides.secondary = args[++i];
    } else if (arg === "--accent" && args[i + 1]) {
      overrides.accent = args[++i];
    } else if (!arg.startsWith("-")) {
      brandSlug = arg;
    }
  }

  return { brandSlug, interactive, overrides };
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

function ask(rl: readline.Interface, question: string, defaultVal: string): Promise<string> {
  const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function interactivePrompt(
  brandSlug: string,
  overrides: Record<string, string>,
): Promise<typeof DEFAULT_CONFIG> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\nConfiguring brand: ${brandSlug}\n`);

  const config = structuredClone(DEFAULT_CONFIG);

  config.name = await ask(rl, "Brand display name", overrides.name || slugToDisplayName(brandSlug));
  config.tagline = await ask(rl, "Tagline", overrides.tagline || DEFAULT_CONFIG.tagline);
  config.colors.primary = await ask(
    rl,
    "Primary color (hex)",
    overrides.primary || DEFAULT_CONFIG.colors.primary,
  );
  config.colors.secondary = await ask(
    rl,
    "Secondary color (hex)",
    overrides.secondary || DEFAULT_CONFIG.colors.secondary,
  );
  config.colors.accent = await ask(
    rl,
    "Accent color (hex)",
    overrides.accent || DEFAULT_CONFIG.colors.accent,
  );
  config.social.website = await ask(rl, "Website URL", "");
  config.social.twitter = await ask(rl, "Twitter handle", "");
  config.ctaText = await ask(rl, "CTA text", DEFAULT_CONFIG.ctaText);

  rl.close();
  return config;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { brandSlug, interactive, overrides } = parseArgs();

  if (!brandSlug) {
    console.error("Error: Brand name is required.\n");
    printUsage();
    process.exit(1);
  }

  // Validate slug
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brandSlug)) {
    console.error(
      "Error: Brand name must be lowercase alphanumeric with hyphens (e.g., 'acme-corp').",
    );
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const brandDir = path.join(projectRoot, "brands", brandSlug);

  // Check if already exists
  if (fs.existsSync(brandDir)) {
    console.error(`Error: Brand directory already exists: brands/${brandSlug}/`);
    console.error("Delete it first or choose a different name.");
    process.exit(1);
  }

  // Build config
  let config: typeof DEFAULT_CONFIG;

  if (interactive) {
    config = await interactivePrompt(brandSlug, overrides);
  } else {
    config = structuredClone(DEFAULT_CONFIG);
    config.name = overrides.name || slugToDisplayName(brandSlug);
    if (overrides.tagline) config.tagline = overrides.tagline;
    if (overrides.primary) config.colors.primary = overrides.primary;
    if (overrides.secondary) config.colors.secondary = overrides.secondary;
    if (overrides.accent) config.colors.accent = overrides.accent;
  }

  // Create directory structure
  const dirs = ["logos", "photos", "fonts"];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(brandDir, dir), { recursive: true });
  }

  // Write brand-config.json
  const configPath = path.join(brandDir, "brand-config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  // Write .gitkeep files so empty dirs are tracked
  for (const dir of dirs) {
    fs.writeFileSync(path.join(brandDir, dir, ".gitkeep"), "");
  }

  // Success output
  console.log(`
Brand workspace created: brands/${brandSlug}/

  brands/${brandSlug}/
    brand-config.json
    logos/
    photos/
    fonts/

Next steps:
  1. Edit brands/${brandSlug}/brand-config.json to customize your brand
  2. Drop your logo into brands/${brandSlug}/logos/logo.svg
  3. Preview: npx remotion studio (select BrandedDemo, set brandName to "${brandSlug}")
  4. Render: npx tsx scripts/render-brand-video.ts ${brandSlug}
`);
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
