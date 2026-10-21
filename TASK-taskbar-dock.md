# Task v3: Taskbar-dock mode for the compact HUD

Repo: `C:\Users\denti\Apps\cq` — codex-quota-widget fork (Electron, Windows). Current state: dual weekly quotas (C7d = Codex weekly, D7d = Devin weekly) shown in a compact HUD; window is frameless/transparent, `alwaysOnTop` uses level `"screen-saver"`, `setVisibleOnAllWorkspaces(true)` — see `src/main/main.js` `createWindow`/`setAlwaysOnTop`. Compact display modes already exist (`compactDisplayMode`: "hud"/"topStrip"?) — read the existing code first and follow its conventions. `npm test` must pass; update tests as needed.

## Requirement

Add a **taskbar dock mode**: the compact HUD positioned directly ON the Windows taskbar so it looks embedded next to the system tray / widgets area.

## Implementation notes

1. **New display mode** `"taskbar"` alongside the existing compact display modes (or a separate boolean like `dockToTaskbar` — pick whichever fits the existing architecture more cleanly). Persisted in signal settings like other window prefs.
2. **Positioning**: place the HUD at the bottom edge of the primary display's full screen bounds (NOT workArea — it must overlay the taskbar). Default x: right-aligned, ending ~10px left of where the system tray typically starts is impossible to detect reliably — so default to right edge minus ~330px on a standard centered-icon Win11 taskbar is wrong too. Better: default to a reasonable position (e.g. right edge of screen minus HUD width minus ~300px, i.e. just left of tray area on typical layouts) AND let the user drag it horizontally to fine-tune. Persist the docked x-position.
3. **Height**: shrink HUD to ~40px tall in dock mode (taskbar is 48px on Win11); single-line layout — the existing topStrip single-row layout is probably close to what we need; reuse it. Vertically center within taskbar height: y = screen bounds height - 40 (or HUD height).
4. When docking is enabled: `skipTaskbar: true`, hide normal window decorations as in HUD mode, disable resize. When disabled, restore the previous compact position/mode.
5. **Tray menu**: add a checkable item 「停靠到任务栏」/「Dock to taskbar」 that toggles dock mode. Keep bilingual labels consistent with existing items.
6. Edge cases: taskbar on top/side of screen is out of scope — assume bottom taskbar. Multi-monitor: use the display containing the current window or primary display.
7. Dragging: if the HUD already supports drag-move with position persistence, docked mode should only constrain/init position, not block drag (user may need to nudge it past centered icons).
8. The widget must NOT overlap the Start button/widgets area by default on a standard layout — default x just left of the tray/clock region.

## Acceptance criteria

- `npm test` passes (update/extend `verify-provider-integration.js` if it covers display modes; add coverage for dock position calculation if practical).
- Tray menu gains a working 停靠到任务栏 toggle; on, the HUD sits on the taskbar; off, it returns to its previous spot.
- Do NOT run `npm run build`.
