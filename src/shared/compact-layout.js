const COMPACT_LAYOUT = Object.freeze({
  width: 500,
  hud: Object.freeze({
    collapsedHeight: 86,
    expandedHeight: 168
  }),
  topStrip: Object.freeze({
    collapsedHeight: 28,
    expandedHeight: 124
  }),
  taskbar: Object.freeze({ width: 240, height: 40, trayGap: 300 }),
  scale: Object.freeze({
    min: 0.46,
    max: 1.25
  })
});

function taskbarBounds(displayBounds, savedX) {
  const { width, height, trayGap } = COMPACT_LAYOUT.taskbar;
  const right = displayBounds.x + displayBounds.width;
  const x = Number.isFinite(savedX) ? savedX : right - width - trayGap;
  return {
    x: Math.max(displayBounds.x, Math.min(right - width, Math.round(x))),
    y: displayBounds.y + displayBounds.height - height,
    width,
    height
  };
}

module.exports = { COMPACT_LAYOUT, taskbarBounds };
