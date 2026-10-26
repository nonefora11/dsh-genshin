# dsh-genshin-autolaunch

A DeepSeek Harness plugin: **when DSH starts, it opens the official Genshin Impact site and downloads the official launcher for you.**

No dependencies, no telemetry, no third‑party mirrors — it resolves the installer straight from mihoyo's own download endpoint, resumes interrupted downloads, and stays out of your way afterwards.

## What it does

On every DSH start (after a short delay, so the app is fully up):

1. Opens <https://ys.mihoyo.com/> in your default browser (or `genshin.hoyoverse.com` with `region: global`).
2. Resolves the official installer URL from `ys-api.mihoyo.com` (302 → `autopatchcn.yuanshen.com/.../yuanshen_setup_*.exe`).
3. Downloads it to `~/Downloads/GenshinImpact` with resume support (`.part` + HTTP `Range`).
4. Optionally launches the installer when the download finishes (`launchInstaller: true`).

The download runs once per version: if the same file is already complete and recorded in the state file, it is skipped on later starts instead of re-downloading several hundred megabytes.

## Install

### From the DSH plugin marketplace

Search for **Genshin Auto Launch** in *Settings → Plugins → Discover*, or add this repository as an index source (`market/index.json`).

### From a tarball / git

```bash
# inside your DSH profile directory, e.g. C:\Users\<you>\.dsh\profiles\desktop
pnpm add file:./dsh-genshin-autolaunch-0.1.0.tgz   # release asset
pnpm add "git+https://github.com/headacheee/dsh-genshin-autolaunch.git#<commit>"
```

Then add the bundle to `dsh.profile.bundles` in the profile `package.json`, or let the bundled `cordis.patch.yml` insert the row for you:

```yaml
- insert:
    - id: genshin-autolaunch
      name: 'dsh-genshin-autolaunch'
      config:
        enabled: true
        openSite: true
        download: true
        launchInstaller: false
        region: cn
        delayMs: 2500
```

## Configuration

Every key is optional; anything omitted falls back to the default below. Booleans accept `true/false`, `1/0`, `yes/no`, `on/off` strings too.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Mount the plugin but do nothing when `false`. |
| `openSite` | `true` | Open the official site on start. |
| `download` | `true` | Download the launcher. |
| `launchInstaller` | `false` | Run the downloaded installer when it finishes. |
| `region` | `cn` | `cn` → `ys.mihoyo.com`, `global` → `genshin.hoyoverse.com`. |
| `siteUrl` | *(by region)* | Override the site URL. |
| `launcherUrl` | official endpoint | Override the download endpoint or pass a direct `.exe` link. |
| `downloadDir` | `~/Downloads/GenshinImpact` | Where the installer is saved. `~` is expanded. |
| `delayMs` | `2500` | Wait before starting, so the app and browser are ready. |
| `once` | `true` | Skip when the same file is already complete. |
| `requestTimeoutMs` | `120000` | Per-request timeout. |
| `downloadTimeoutMs` | `21600000` | Overall download timeout (6 h). |
| `retries` | `3` | Retry attempts with exponential backoff. |
| `stateDir` | `$DSH_HOME/genshin-autolaunch` | Where `state.json` lives. |

## CLI (run it once, without restarting DSH)

```bash
node lib/cli.js --dry-run        # resolve the URL only, download nothing
node lib/cli.js --json           # full run, machine-readable summary
node lib/cli.js --no-site        # download only
node lib/cli.js --no-download    # open the site only
node lib/cli.js --launch         # download, then run the installer
node lib/cli.js --dir=D:/Games/Genshin --region=global
```

## Tests

```bash
node test/smoke.mjs
```

Eleven offline cases: config normalisation, filename resolution, 302 following, first download, `once` skip, `.part` resume, `dryRun` purity, and mounting through a stub cordis context. They run against a local HTTP server — no external traffic, no real installer downloaded.

## Notes

- This plugin only fetches files from mihoyo/hoyoverse official endpoints. It is not affiliated with or endorsed by HoYoverse.
- If you have no intention of installing the game, set `download: false` (or `dryRun: true`) so startup only opens the site.
- Linux/macOS: `openSite` uses `xdg-open`/`open`; the launcher is a Windows `.exe`, so download-only is the sensible setting there.

## License

MIT © headacheee
