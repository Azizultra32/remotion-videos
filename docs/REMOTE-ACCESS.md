# Remote Access — Driving the editor from anywhere

You're not at the computer and you need to reach the editor or a rendered MP4. Three working paths, with trade-offs.

## Path 1 — `npm run mv:tunnel` (Cloudflare quick tunnel, fastest, no account)

Primary repo command:

```bash
npm run mv:tunnel
```

This wraps `cloudflared tunnel --url http://127.0.0.1:4000`, prints the
resulting `https://<random>.trycloudflare.com` URL, and refuses to report
success until both `/` and `/api/songs` return `200` through the public URL.
The wrapper now hands `cloudflared` off to a per-user `launchd` job, so the
public URL stays alive after the shell command itself returns.

Kill it with:

```bash
npm run mv:tunnel -- --kill
```

**Use when:** you need editor + MP4 access for a single session from anywhere on the internet. Zero setup.

**Limits:**
- URL dies when the `cloudflared` process dies
- No uptime guarantee, Cloudflare can kill it for abuse detection
- URL is un-guessable but unauthenticated — don't post it publicly
- Rate-limited (fine for one user; bad for anything production)

**Required config** (already applied, commit `bfc408d`):
Vite 6 blocks requests whose Host header isn't in `server.allowedHosts`. The
editor's `vite.config.ts` now has `allowedHosts: true` so any tunnel hostname
works. Without this, every tunnel URL returns a 403 "Blocked request. This
host … is not allowed."

**How to test:** `curl -sI https://<random>.trycloudflare.com/api/songs` should
return `HTTP/2 200`. If you get 403 with "Blocked request", `allowedHosts` was
reverted — re-apply.

**Lifecycle:** `npm run mv:tunnel` exits after the public URL is healthy; the
tunnel process keeps running under `launchd` until you explicitly stop it with
`npm run mv:tunnel -- --kill`.

## Path 2 — Named cloudflared tunnel (stable URL, free)

Sign up at dash.cloudflare.com (free), create a tunnel, bind a subdomain.
Requires DNS control over a domain you own. Gives you `https://editor.<your-domain>/`
that survives process restarts and is authenticatable via Cloudflare Access.

**Use when:** you want to always-be-on or share with collaborators.

**Out of scope** for this doc; Cloudflare's own tunnel docs cover it.

## Path 3 — Tailscale Funnel (stable URL, free, no DNS needed)

If you have a Tailscale account:

```bash
brew install tailscale
tailscale up
tailscale funnel 4000
```

Gives you `https://<machine>.<tailnet>.ts.net/` that's authenticated via your
Tailscale identity.

**Use when:** you already run Tailscale.

**Install status on this machine:** `which tailscale` → not installed. Install
via `brew install --cask tailscale` and sign in.

## Serving just an MP4 (no editor)

The sidecar exposes `GET /api/out/:filename` for files in `out/`. Combined with
Path 1's tunnel:

```
https://<random>.trycloudflare.com/api/out/rush-comes-flashes-123.mp4
```

Streams the MP4 with correct `Content-Type: video/mp4`, supports HTTP Range for
seeking. Works in any browser without needing the full editor.

## Alternative: iCloud Drive sync

For permanent availability on your Apple devices without a live tunnel:

```bash
cp out/<render>.mp4 ~/Library/Mobile\ Documents/com~apple~CloudDocs/remotion-renders/
```

Shows up in Files app → iCloud Drive → `remotion-renders/` on your phone/iPad
a few minutes after copy (sync latency depends on connection).

## Troubleshooting

**"Blocked request. This host (…) is not allowed."** → Vite's allowlist. Fix:
`allowedHosts: true` in `editor/vite.config.ts`. Should already be set; if
reverted, re-apply (engine-locked path, requires `ENGINE_UNLOCK=1`).

**`npm run mv:tunnel` says the editor is not reachable on `http://127.0.0.1:4000`**
→ Vite isn't up. Run `cd editor && npm run dev` and check `/tmp/mv-vite.log`
or the terminal you started it from.

**`npm run mv:tunnel` says `cloudflared` is not installed** → install it with
`brew install cloudflared`.

**Tunnel URL loads but `/api/songs` 500s** → sidecar isn't running because Vite
didn't start. Run `cd editor && npm run dev` and check stderr.

**MP4 plays but no audio** → the MP4 has audio; your browser's codec support
might be the issue. Safari handles AAC better than Chrome for some edge
encodings. QuickTime always works.

**Tunnel responds slowly** → cloudflared's QUIC protocol adds a bit of latency
compared to direct localhost. Usually still < 200ms.
