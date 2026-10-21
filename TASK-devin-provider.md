# Task: Add Devin quota provider to this Electron widget

You are working in `C:\Users\denti\Apps\cq` — a fork of `codex-quota-widget`, an Electron desktop widget that shows local Codex quota (5h + 7d windows) in a floating HUD. Everything works today for Codex. Your job: add **Devin** as a second provider so the widget can display Devin quota too.

## What exists

- `src/main/quota-service.js` — fetches Codex quota via `codex app-server` stdio JSON-RPC, returns a normalized snapshot:
  ```js
  {
    limitId, limitName, planType,
    primary:   { usedPercent, remainingPercent, windowDurationMins, resetsAt /* ISO */ },
    secondary: { same shape },
    remainingPercent, usedPercent, resetsAt, credits, fetchedAt
  }
  ```
- `src/main/quota-store.js` — polls `readQuota` on a timer, caches state, emits `quota:changed`.
- `src/main/main.js` — wires IPC (`quota:state`, `quota:refresh`), tray menu, window modes.
- `src/main/preload.js` — exposes a `codexQuota` bridge to the renderer.
- `src/renderer/*` — renders `state.quota` (two windows, plan, pace advice).

## Required changes

### 1. New `src/main/devin-service.js` exporting `getDevinQuota()`

It must:

1. Read `%APPDATA%\devin\credentials.toml` (use `process.env.APPDATA`; fall back to `%USERPROFILE%\AppData\Roaming`). Parse TOML minimally (regex is fine — the file is simple `key = "value"` lines) for `windsurf_api_key` and optional `api_server_url`. If `api_server_url` is absent, default to `https://server.codeium.com`.
2. Resolve the Devin CLI version: look for `devin.exe` at `%LOCALAPPDATA%\Programs\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe` (also try `devin` on PATH as fallback). Run `devin version` (spawn, 5s timeout, windowsHide), parse the semver from output like `devin 3000.10.67 (0b186d6e)`. If it cannot be resolved, throw — **do not** send "unknown": the server rejects it (HTTP 500).
3. POST `https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus` (always this host — do NOT use api_server_url from the file; the quota endpoint lives on the codeium host). Headers: `Content-Type: application/json`, `Connect-Protocol-Version: 1`. Body:
   ```json
   {"metadata":{"apiKey": KEY, "ideName":"devin","ideVersion": VER,"extensionVersion": VER,"locale":"en"}}
   ```
   Use `fetch` (Electron main has Node 20+). Timeout 12s. Never log the key or write it anywhere.
4. Response shape: `payload.userStatus.planStatus` contains `dailyQuotaRemainingPercent`, `weeklyQuotaRemainingPercent` (numbers 0-100, ALREADY remaining, not used), `dailyQuotaResetAtUnix`, `weeklyQuotaResetAtUnix` (unix seconds, may be strings). Plan name in `payload.planInfo.planName` (fallback `userStatus.planStatus.planInfo.planName`).
5. Return the SAME normalized shape quota-service uses:
   - `limitId: "devin"`, `limitName: "Devin"`, `planType: planName || "unknown"`
   - `primary` = daily window (windowDurationMins: 1440), `secondary` = weekly window (windowDurationMins: 10080)
   - each window: `{ usedPercent: 100 - remaining, remainingPercent: remaining, windowDurationMins, resetsAt: ISO string }`
   - top-level remainingPercent/usedPercent/resetsAt = worst (lowest remainingPercent) of the two windows
   - `fetchedAt: new Date().toISOString()`

### 2. Provider plumbing

- `quota-store.js`: accept a `provider` name (default `"codex"`) and choose `getQuota` vs `getDevinQuota`. Add `setProvider(name)` that switches the reader and triggers a refresh. Keep a separate cache namespace per provider — simplest: include the provider in the state and skip cross-provider cache reuse (cache file may stay single: store `{ provider, quota }` and only reuse when provider matches).
- `main.js`: IPC handlers `provider:get` and `provider:set(name)`; persist the last provider in the existing widget-settings.json (add a top-level `provider` key, default `"codex"`). Tray menu: add a "切换到 Devin" / "切换到 Codex" item that flips provider.
- `preload.js`: expose `getProvider`, `setProvider(name)`, and `onProviderChanged(cb)` (main should send `provider:changed` after switch so renderer updates immediately).

### 3. Renderer

- `index.html`: in the titlebar brand area add a small provider toggle button showing the current provider name (`Codex`/`Devin`), clicking it switches provider. Put it right of `#stateText`.
- `renderer.js`:
  - Track `state.provider`; on `provider:changed` update it.
  - Provider-specific copy: brand shows `Codex 额度`/`Devin 额度` (en: `Codex Quota`/`Devin Quota`); window labels: Codex keeps `5小时窗口`/`7天窗口`, Devin uses `每日额度`/`每周额度` (en: `Daily`/`Weekly`).
  - Compact HUD labels: the two rows are hardcoded `7d`/`5h` in index.html — change them to `id`-addressable spans (e.g. `compactWeeklyLabel`, `compactShortLabel`) and set text per provider: Codex `7d`/`5h`, Devin `7d`/`24h`.
  - Loading/status texts should name the active provider.
- Keep all existing Codex behavior and pace advice untouched — Devin quota flows through the same `primary`/`secondary` shape so pace advice works automatically.

## Constraints & notes

- Windows-only target; spawn with `windowsHide: true` for any child process.
- No new npm dependencies — parse the tiny TOML by hand.
- The Devin API key must never be logged, persisted, or sent to any host other than `server.codeium.com`.
- `npm install` is already expected to work; do NOT run `npm run build` (electron-builder portable) — I will build. You may run `npm test` if tests exist (there are `test:pace` / `test:quota-store` scripts; make sure they still pass).
- Do not rename the app/productName; keep appId `cn.codex.quota.widget`.

## Acceptance criteria

1. `npm test` (test:pace + test:quota-store) passes.
2. `provider:set("devin")` → `quota:state` returns Devin daily/weekly data within seconds; `provider:set("codex")` returns Codex data.
3. No `devin`-related network call happens unless Devin is the active provider.
4. Restarting the app remembers the last selected provider.
