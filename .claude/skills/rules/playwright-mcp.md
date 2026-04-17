---
name: playwright-mcp
description: Use when needing browser automation for visual verification of Remotion Studio, the editor, or composition previews — driven by the Playwright MCP server
metadata:
  tags: playwright, mcp, browser, automation, screenshot, studio, editor, visual-test
---

# Playwright MCP — Browser Automation for Remotion

## Overview

Microsoft's Playwright MCP server gives Claude Code direct browser-driving tools. Use it to verify Remotion Studio loads, screenshot composition previews, and test the custom editor app — without asking the user to open a browser. The MCP server runs locally via `npx`.

## Setup

Add to `/Users/ali/remotion-videos/.mcp.json`:

```json
{
  "mcpServers": {
    "remotion-documentation": {
      "command": "npx",
      "args": ["@remotion/mcp@latest"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

Restart Claude Code. The tools appear under `mcp__playwright__*`.

## Tool List

| Tool | Purpose |
|---|---|
| `browser_navigate` | Open a URL |
| `browser_take_screenshot` | Capture page or element |
| `browser_snapshot` | Accessibility-tree snapshot (faster than screenshot for assertions) |
| `browser_click` | Click element by selector or accessibility role |
| `browser_type` | Type into focused element |
| `browser_fill_form` | Fill multiple form fields |
| `browser_drag` | Drag-and-drop (useful for testing the editor's draggable timeline) |
| `browser_wait_for` | Wait for text/time/selector condition |
| `browser_evaluate` | Run JS in the page (read state, dispatch events) |
| `browser_resize` | Set viewport dimensions |
| `browser_console_messages` | Read console output |
| `browser_network_requests` | Inspect network |
| `browser_close` | Close the browser |

## Use Cases

### 1. Verify Studio loads
```
browser_navigate { url: "http://localhost:3000" }
browser_wait_for { text: "PublicCut" }
browser_take_screenshot { fullPage: true }
```

### 2. Visual diff a composition at a specific frame
Studio supports URL fragments for composition + frame. Open `http://localhost:3000/PublicCut`, scrub to a frame via `browser_evaluate`, screenshot, compare to baseline.

### 3. Test the custom editor app
With the editor dev server on (likely `http://localhost:5173` for Vite), drag a sidebar element onto the timeline:
```
browser_navigate { url: "http://localhost:5173" }
browser_drag { from: "[data-preset='AHURA']", to: "[data-track='main']" }
browser_take_screenshot { selector: "[data-preview]" }
```

### 4. Capture web reference imagery
Grab a screenshot of an Awwwards site / design ref to use as a still in a composition. Saves to a path; reference via `staticFile()` after copying into `public/`.

### 5. Read render-progress UI from Studio
`browser_evaluate` to pull progress percentage from Studio's React state — useful when monitoring a long render started via Studio.

## Worked Example — Screenshot PublicCut at frame 120

```
browser_navigate { url: "http://localhost:3000/PublicCut" }
browser_wait_for { text: "PublicCut", time: 2 }
browser_evaluate { script: "document.querySelector('[data-testid=\"timeline-current-frame\"]')?.click(); /* or use Studio's API to seek */" }
browser_take_screenshot { fullPage: false, path: "out/snapshots/publiccut-f120.png" }
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Screenshotting before the page loaded | Always `browser_wait_for` a known element first |
| Forgetting to start the dev server (`npm run dev`) | The MCP can't start it for you; check before navigating |
| Hardcoding port 3100 (editor) when Studio is 3000 | Studio = 3000 by default; the custom editor uses Vite (typically 5173) |
| Leaving the browser open between sessions | `browser_close` when done — orphan Chromium processes pile up |
| Selectors that match React-generated class names | Use `data-*` attributes or accessibility roles instead |

## Cross-References

- `update-config` — for adding/editing the `.mcp.json` entry
- `remotion-render` — Studio is one render path; CLI/programmatic are usually faster
