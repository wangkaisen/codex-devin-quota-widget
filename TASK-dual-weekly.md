# Task v2: Show Codex and Devin weekly quota SIMULTANEOUSLY

Repo: `C:\Users\denti\Apps\cq` — codex-quota-widget fork. A previous task already added a Devin provider with a Codex/Devin toggle (`src/main/devin-service.js`, `provider:get`/`provider:set` IPC, provider button in renderer). Tests exist: `npm run test:pace`, `test:quota-store`, `test:devin-service`, `test:provider-integration` — keep them passing; update any that assume the toggle.

## New requirement — replace the toggle model

The user wants BOTH providers' **weekly** quota shown at the same time. The compact HUD already renders two rows — perfect fit:

- Row 1 (was "7d" Codex weekly): label becomes **C7d**, value = Codex `secondary` window remainingPercent + pace markers as before.
- Row 2 (was "5h" Codex short window): label becomes **D7d**, value = Devin `secondary` (weekly) window remainingPercent. Devin has no 5h window — the second row is now Devin's weekly.

## Implementation notes

1. **QuotaStore** must now fetch BOTH providers every refresh cycle (concurrently, `Promise.allSettled` so one failing doesn't kill the other). State shape becomes e.g. `{ providers: { codex: {...}, devin: {...} }, status, ... }` — design it cleanly; renderer adapts. Errors should be per-provider: if Devin fails but Codex succeeds, show Codex data and mark Devin's row as unavailable (`--`), plus a status-line note. Do not blank the whole widget on a single-provider failure.
2. **Keep per-provider cache**: reuse the existing cache mechanism so each provider's last-good snapshot survives restarts and the other's failures. The existing provider-scoped cache from v1 can be reused — store both providers' quotas in the cache payload.
3. **Renderer** (`renderer.js` + `index.html`):
   - Compact HUD: two rows labeled `C7d` and `D7d`. Codex row keeps its ideal/velocity pace markers; Devin row gets pace markers too if the plumbing is free, otherwise just the fill + text.
   - Pace advice line (`compactAdviceText`): use the worse of the two providers' overall status; when hovering/expanded show both.
   - The provider toggle button (`providerBtn`) is no longer needed — remove it and its IPC (`provider:get`/`provider:set`, `provider:changed`). Keep Devin service as-is.
   - Full (non-compact) window: repurpose the two quota-cards to show `Codex 7天` and `Devin 7天` remaining + reset. The liquid meter should reflect the LOWER of the two weekly remaining percentages. Pace panel can key off Codex (or worst of both — your call, keep it simple).
   - Labels bilingual like the existing copy (zh: "Codex 7天" / "Devin 7天"; en equivalents).
   - Tray menu: remove the provider-switch item; keep 刷新额度 (now refreshes both), 显示/隐藏, etc.
   - Tray tooltip: show both remaining percentages when available, e.g. `Codex 7d 78% · Devin 7d 94%`.
4. **Refresh cadence**: both providers refresh together on the existing schedule (respect `quotaRefreshMs` signal setting and hidden-window interval).
5. **Devin fetch details are already implemented** in `src/main/devin-service.js` — read it, don't change the wire protocol. It fetches `%APPDATA%\devin\credentials.toml`, resolves devin.exe version, POSTs GetUserStatus to `server.codeium.com`.
6. Keep `getQuota` (Codex) untouched.

## Acceptance criteria

- `npm test` passes (update existing tests for the new state shape; add a case covering one-provider-failure).
- App start shows both rows populated: `C7d xx%` and `D7d xx%` in compact HUD.
- No provider toggle remains anywhere (button, IPC, tray menu).
- Do NOT run `npm run build` — I'll build and deploy.
