# Brand Workspace System

This directory contains brand workspaces for producing branded video content with Remotion.

## Quick Start

```bash
# Create a new brand workspace
npx tsx scripts/new-brand.ts my-brand

# Create interactively (prompts for colors, tagline, etc.)
npx tsx scripts/new-brand.ts my-brand --interactive

# Create with overrides
npx tsx scripts/new-brand.ts my-brand --name "My Brand" --primary "#ff6600" --tagline "We ship fast"

# Render a branded video
npx tsx scripts/render-brand-video.ts my-brand

# Render a still frame (for thumbnails/previews)
npx tsx scripts/render-brand-video.ts my-brand --still 45 --output preview.png

# Render with voiceover (requires ELEVENLABS_API_KEY)
npx tsx scripts/render-brand-video.ts my-brand --with-voiceover

# Render a specific composition
npx tsx scripts/render-brand-video.ts my-brand --composition BrandedDemo
```

## Directory Structure

Each brand gets its own folder under `brands/`:

```
brands/
  <brand-name>/
    brand-config.json   # Brand definition (colors, typography, taglines, features)
    logos/               # SVG/PNG logos (logo.svg is the primary one)
    photos/              # Product photos, team headshots, lifestyle imagery
    fonts/               # Custom .woff2 / .ttf font files
```

## brand-config.json Reference

| Field              | Type     | Required | Description                                          |
|--------------------|----------|----------|------------------------------------------------------|
| `name`             | string   | Yes      | Display name of the brand                            |
| `tagline`          | string   | Yes      | Short brand slogan or motto                          |
| `colors.primary`   | hex      | Yes      | Primary brand color                                  |
| `colors.secondary` | hex      | Yes      | Secondary brand color                                |
| `colors.accent`    | hex      | Yes      | Accent/highlight color                               |
| `colors.background`| hex      | Yes      | Background color                                     |
| `colors.text`      | hex      | Yes      | Text color                                           |
| `typography.heading`| string  | Yes      | Font-family stack for headings                       |
| `typography.body`  | string   | Yes      | Font-family stack for body text                      |
| `social.website`   | string   | No       | Website URL                                          |
| `social.twitter`   | string   | No       | Twitter handle                                       |
| `features`         | array    | No       | Array of `{title, description, icon}` for feature slides |
| `ctaText`          | string   | No       | Call-to-action text (default: "Get Started Today")   |

### Example brand-config.json

```json
{
  "name": "Acme Corp",
  "tagline": "Building the future",
  "colors": {
    "primary": "#3b82f6",
    "secondary": "#8b5cf6",
    "accent": "#f59e0b",
    "background": "#ffffff",
    "text": "#111827"
  },
  "typography": {
    "heading": "system-ui, -apple-system, sans-serif",
    "body": "system-ui, -apple-system, sans-serif"
  },
  "social": {
    "website": "https://acme.com",
    "twitter": "@acme"
  },
  "features": [
    { "title": "Lightning Fast", "description": "Optimized for speed.", "icon": "⚡" },
    { "title": "Rock Solid", "description": "99.99% uptime.", "icon": "🛡️" },
    { "title": "Simple", "description": "Intuitive from day one.", "icon": "✨" }
  ],
  "ctaText": "Ready to Get Started?"
}
```

## Asset Conventions

- **logos/logo.svg** -- Primary logo (used in intros and CTAs when `showLogo` is true)
- **logos/logo-dark.svg** -- Dark-background variant
- **logos/icon.svg** -- Square icon / favicon style
- **photos/** -- Named descriptively (hero.jpg, product-1.png, team.jpg)
- **fonts/** -- Include the font files and reference them in typography fields

## How It Works

1. The `new-brand.ts` script scaffolds a brand workspace with config and empty asset directories.
2. You customize `brand-config.json` and drop in your logo/assets.
3. The `render-brand-video.ts` script reads the config, assembles Remotion props, checks for logos, and shells out to `remotion render` or `remotion still`.
4. If `--with-voiceover` is set, it generates voiceover text from your tagline and feature descriptions, then calls ElevenLabs to produce an audio file.
5. Output lands in `out/<brand>-<composition>.mp4` by default.
