const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { QuotaStore } = require("./quota-store");
const { COMPACT_LAYOUT, taskbarBounds } = require("../shared/compact-layout");

const APP_ICON_PATH = path.join(__dirname, "../../assets/app-icon.png");
const TRAY_ICON_PATH = path.join(__dirname, "../../assets/app-icon-tray-16.png");
const HIDDEN_WINDOW_RELEASE_MS = 60 * 1000;
const SETTINGS_FILE_NAME = "widget-settings.json";
const DEFAULT_SIGNAL_SETTINGS = {
  recentFastBreathMs: 4000,
  criticalBlinkMs: 3000,
  quotaRefreshMs: 3 * 60 * 1000
};

let mainWindow;
let settingsWindow;
let tray;
let quotaStore;
let releaseWindowTimer;
let ipcHandlersRegistered = false;
let isQuitting = false;
let isAlwaysOnTop = true;
let isCompactMode = true;
let compactScale = 0.46;
let isCompactExpanded = false;
let isCompactTopStrip = false;
let isCompactMousePassthrough = false;
let taskbarDock = { enabled: false, x: null, displayId: null, restore: null };
let restoreCompactOnCreate = false;
let signalSettings = { ...DEFAULT_SIGNAL_SETTINGS };
let settingsWrite = Promise.resolve();

const WINDOW_SIZES = {
  full: { width: 390, height: 336 }
};

const COMPACT_HUD_COLLAPSED_BASE_SIZE = { width: COMPACT_LAYOUT.width, height: COMPACT_LAYOUT.hud.collapsedHeight };
const COMPACT_HUD_EXPANDED_BASE_SIZE = { width: COMPACT_LAYOUT.width, height: COMPACT_LAYOUT.hud.expandedHeight };
const COMPACT_STRIP_COLLAPSED_BASE_SIZE = { width: COMPACT_LAYOUT.width, height: COMPACT_LAYOUT.topStrip.collapsedHeight };
const COMPACT_STRIP_EXPANDED_BASE_SIZE = { width: COMPACT_LAYOUT.width, height: COMPACT_LAYOUT.topStrip.expandedHeight };
const COMPACT_SCALE_LIMITS = COMPACT_LAYOUT.scale;
const COMPACT_TOP_OFFSET = 6;
const COMPACT_TOP_SNAP_DISTANCE = 28;
const COMPACT_CENTER_SNAP_DISTANCE = 48;
const COMPACT_STRIP_TOP_OFFSET = 0;
const COMPACT_STRIP_TOP_SNAP_DISTANCE = 4;
const COMPACT_STRIP_CENTER_SNAP_DISTANCE = 56;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(startApp);
}

function clampCompactScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(COMPACT_SCALE_LIMITS.max, Math.max(COMPACT_SCALE_LIMITS.min, scale));
}

function compactDisplayMode() {
  if (taskbarDock.enabled) return "taskbar";
  return isCompactTopStrip ? "topStrip" : "hud";
}

function compactBaseSize(expanded = isCompactExpanded, topStrip = isCompactTopStrip) {
  if (topStrip) {
    return expanded ? COMPACT_STRIP_EXPANDED_BASE_SIZE : COMPACT_STRIP_COLLAPSED_BASE_SIZE;
  }
  return expanded ? COMPACT_HUD_EXPANDED_BASE_SIZE : COMPACT_HUD_COLLAPSED_BASE_SIZE;
}

function scaledCompactSize(scale = compactScale, expanded = isCompactExpanded, topStrip = isCompactTopStrip) {
  if (taskbarDock.enabled) {
    return { width: COMPACT_LAYOUT.taskbar.width, height: COMPACT_LAYOUT.taskbar.height };
  }
  const safeScale = clampCompactScale(scale);
  const baseSize = compactBaseSize(expanded, topStrip);
  return {
    width: Math.round(baseSize.width * safeScale),
    height: Math.round(baseSize.height * safeScale)
  };
}

function compactMinimumSize(topStrip = isCompactTopStrip) {
  return scaledCompactSize(COMPACT_SCALE_LIMITS.min, false, topStrip);
}

async function startApp() {
  if (process.platform === "win32") {
    app.setAppUserModelId("cn.codex.quota.widget");
  }

  const settings = await loadWidgetSettings();
  signalSettings = settings.signal;
  taskbarDock = settings.taskbarDock;
  if (taskbarDock.enabled && taskbarDock.restore) {
    compactScale = taskbarDock.restore.scale;
    isCompactTopStrip = taskbarDock.restore.displayMode === "topStrip";
  }
  quotaStore = new QuotaStore({
    userDataPath: app.getPath("userData"),
    visibleRefreshIntervalMs: signalSettings.quotaRefreshMs
  });
  await quotaStore.loadCache();
  quotaStore.on("state", (state) => {
    sendToWindow("quota:changed", state);
    updateTrayTooltip(state);
  });

  registerIpcHandlers();
  createWindow();
  createTray();
  setInterval(reassertPinnedWindow, 3000).unref();
  quotaStore.refreshNow("startup").catch(() => {});

  app.on("activate", showWindow);
}

function createWindow() {
  const existingWindow = getLiveWindow();
  if (existingWindow) return existingWindow;

  const initialSize = isCompactMode ? scaledCompactSize() : WINDOW_SIZES.full;
  const minCompactSize = compactMinimumSize();
  const window = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: minCompactSize.width,
    minHeight: minCompactSize.height,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: isAlwaysOnTop || taskbarDock.enabled,
    skipTaskbar: isCompactMode,
    show: false,
    backgroundColor: "#00000000",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });

  mainWindow = window;
  window.setHasShadow(!isCompactMode);
  window.setAlwaysOnTop(isAlwaysOnTop || taskbarDock.enabled, "screen-saver");
  window.setVisibleOnAllWorkspaces(isAlwaysOnTop || taskbarDock.enabled, { visibleOnFullScreen: true });

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("quota:changed", quotaStore.getState());
    window.webContents.send("window:alwaysOnTopChanged", isAlwaysOnTop);
    window.webContents.send("window:compactChanged", isCompactMode);
    window.webContents.send("window:compactScaleChanged", compactScale);
    window.webContents.send("window:compactDisplayModeChanged", compactDisplayMode());
    window.webContents.send("signal:settingsChanged", signalSettings);
  });

  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    window.show();
    placeWindow(window);
  });

  window.on("show", () => {
    cancelWindowRelease();
    quotaStore.setWindowVisible(true);
    quotaStore.refreshNow("window-show").catch(() => {});
  });

  window.on("hide", () => {
    quotaStore.setWindowVisible(false);
    scheduleWindowRelease();
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.loadFile(path.join(__dirname, "../renderer/index.html"));
  return window;
}

function reassertPinnedWindow() {
  if (!isAlwaysOnTop && !taskbarDock.enabled) return;
  const window = getLiveWindow();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) return;
  window.moveTop();
}

function placeWindow(window = getLiveWindow()) {
  if (!window) return;
  if (taskbarDock.enabled) {
    placeTaskbarWindow(window);
    return;
  }
  if (isCompactMode && restoreCompactOnCreate) {
    restoreCompactOnCreate = false;
    restoreCompactWindow(window);
    return;
  }
  if (isCompactMode) {
    setCompactTopStrip(false);
    isCompactExpanded = false;
    resizeCompactWindow(window);
    placeCompactWindowTopCenter(window);
  } else {
    placeWindowTopRight(window);
  }
}

function placeCompactWindowTopCenter(window = getLiveWindow()) {
  if (!window) return;
  const display = screen.getPrimaryDisplay();
  const { width, height } = window.getBounds();
  const { workArea } = display;
  window.setBounds({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + COMPACT_TOP_OFFSET,
    width,
    height
  });
}

function placeTaskbarWindow(window = getLiveWindow(), x = taskbarDock.x) {
  if (!window) return null;
  const savedDisplay = screen.getAllDisplays().find((item) => item.id === taskbarDock.displayId);
  const display = savedDisplay || screen.getPrimaryDisplay();
  const bounds = taskbarBounds(display.bounds, savedDisplay ? x : null);
  taskbarDock.displayId = display.id;
  window.setMinimumSize(1, 1);
  window.setBounds(bounds);
  window.setContentSize(bounds.width, bounds.height, false);
  window.setMinimumSize(bounds.width, bounds.height);
  const actualBounds = window.getBounds();
  taskbarDock.x = actualBounds.x;
  return actualBounds;
}

function resizeCompactWindow(window = getLiveWindow(), expanded = isCompactExpanded) {
  if (!window) return null;
  const bounds = window.getBounds();
  const size = scaledCompactSize(compactScale, expanded);
  const minSize = compactMinimumSize();
  window.setMinimumSize(1, 1);
  window.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: size.width,
    height: size.height
  });
  window.setContentSize(size.width, size.height, false);
  window.setMinimumSize(minSize.width, minSize.height);
  return size;
}

function placeWindowTopRight(window = getLiveWindow()) {
  if (!window) return;
  const display = screen.getPrimaryDisplay();
  const { width, height } = window.getBounds();
  const { workArea } = display;
  window.setBounds({
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  if (icon.isEmpty()) {
    throw new Error(`Tray icon is missing or invalid: ${TRAY_ICON_PATH}`);
  }
  tray = new Tray(icon);
  updateTrayTooltip(quotaStore.getState());
  rebuildTrayMenu();
  tray.on("click", toggleWindow);
}

function updateTrayTooltip(state) {
  if (!tray) return;
  const labels = Object.entries({ codex: "Codex", devin: "Devin" }).map(([name, label]) => {
    const provider = state.providers[name];
    const remaining = provider.status === "ready" ? provider.quota?.secondary?.remainingPercent : null;
    return `${label} 7d ${Number.isFinite(remaining) ? `${Math.round(remaining)}%` : "--"}`;
  });
  tray.setToolTip(labels.join(" · "));
}

function openSignalSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const parent = getLiveWindow();
  settingsWindow = new BrowserWindow({
    width: 360,
    height: 344,
    parent: parent || undefined,
    modal: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    show: false,
    title: "灯效设置",
    backgroundColor: "#111418",
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.webContents.on("did-finish-load", () => {
    sendToSettingsWindow("signal:settingsChanged", signalSettings);
  });
  settingsWindow.once("ready-to-show", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.show();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, "../settings/index.html"));
  return settingsWindow;
}

function rebuildTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏", click: toggleWindow },
      { label: "刷新额度", click: () => quotaStore.refreshNow("tray-manual").catch(() => {}) },
      { label: "灯效设置...", click: openSignalSettingsWindow },
      {
        label: isCompactMode ? "展开窗口" : "紧凑窗口",
        click: () => setCompactMode(!isCompactMode)
      },
      {
        label: "停靠到任务栏 / Dock to taskbar",
        type: "checkbox",
        checked: taskbarDock.enabled,
        click: () => setTaskbarDock(!taskbarDock.enabled)
      },
      {
        label: isAlwaysOnTop ? "取消置顶" : "置顶",
        enabled: !taskbarDock.enabled,
        click: () => setAlwaysOnTop(!isAlwaysOnTop)
      },
      { type: "separator" },
      { label: "退出", click: quitApp }
    ])
  );
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.handle("quota:state", () => quotaStore.getState());
  ipcMain.handle("quota:refresh", () => quotaStore.refreshNow("manual"));
  ipcMain.handle("window:minimize", hideWindow);
  ipcMain.handle("window:close", quitApp);
  ipcMain.handle("window:alwaysOnTop:get", () => isAlwaysOnTop);
  ipcMain.handle("window:alwaysOnTop:set", (_event, value) => setAlwaysOnTop(value));
  ipcMain.handle("window:compact:get", () => isCompactMode);
  ipcMain.handle("window:compact:set", (_event, value) => setCompactMode(value));
  ipcMain.handle("window:compactScale:get", () => compactScale);
  ipcMain.handle("window:compactScale:set", (_event, value) => setCompactScale(value));
  ipcMain.handle("window:compactMove", (_event, deltaX, deltaY) => moveCompactWindow(deltaX, deltaY));
  ipcMain.handle("window:compactSnap", () => snapCompactWindow());
  ipcMain.handle("window:compactExpanded:set", (_event, value) => setCompactExpanded(value));
  ipcMain.handle("window:compactDisplayMode:get", () => compactDisplayMode());
  ipcMain.handle("window:compactMousePassthrough:set", (_event, value) => setCompactMousePassthrough(value));
  ipcMain.handle("window:cursorState:get", () => getCursorState());
  ipcMain.handle("signal:settings:get", () => signalSettings);
  ipcMain.handle("signal:settings:set", (_event, settings) => setSignalSettings(settings));
  ipcMain.handle("signal:settings:reset", () => setSignalSettings(DEFAULT_SIGNAL_SETTINGS));
}

async function loadWidgetSettings() {
  try {
    const payload = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    return {
      signal: normalizeSignalSettings(payload?.signal),
      taskbarDock: normalizeTaskbarDock(payload?.window?.taskbarDock)
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Failed to read widget settings: ${error.message}`);
    }
    return { signal: { ...DEFAULT_SIGNAL_SETTINGS }, taskbarDock: normalizeTaskbarDock() };
  }
}

function normalizeTaskbarDock(value) {
  const restore = value?.restore;
  return {
    enabled: value?.enabled === true,
    x: Number.isFinite(value?.x) ? Math.round(value.x) : null,
    displayId: Number.isFinite(value?.displayId) ? value.displayId : null,
    restore: restore && Number.isFinite(restore.x) && Number.isFinite(restore.y)
      ? {
        x: Math.round(restore.x), y: Math.round(restore.y),
        displayMode: restore.displayMode === "topStrip" ? "topStrip" : "hud",
        scale: Number.isFinite(restore.scale) ? clampCompactScale(restore.scale) : compactScale
      }
      : null
  };
}

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

async function setSignalSettings(settings) {
  signalSettings = normalizeSignalSettings(settings);
  quotaStore?.setVisibleRefreshIntervalMs(signalSettings.quotaRefreshMs);
  await saveWidgetSettings();
  sendToWindow("signal:settingsChanged", signalSettings);
  sendToSettingsWindow("signal:settingsChanged", signalSettings);
  return signalSettings;
}

function normalizeSignalSettings(settings) {
  return {
    recentFastBreathMs: clampSignalMs(settings?.recentFastBreathMs, DEFAULT_SIGNAL_SETTINGS.recentFastBreathMs),
    criticalBlinkMs: clampSignalMs(settings?.criticalBlinkMs, DEFAULT_SIGNAL_SETTINGS.criticalBlinkMs),
    quotaRefreshMs: clampQuotaRefreshMs(settings?.quotaRefreshMs, DEFAULT_SIGNAL_SETTINGS.quotaRefreshMs)
  };
}

function clampSignalMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(20000, Math.max(1000, Math.round(number)));
}

function clampQuotaRefreshMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(30 * 60 * 1000, Math.max(60 * 1000, Math.round(number)));
}

function saveWidgetSettings() {
  const filePath = settingsPath();
  const payload = {
    version: 1,
    signal: signalSettings,
    window: { taskbarDock: { ...taskbarDock } }
  };
  settingsWrite = settingsWrite.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  });
  return settingsWrite;
}

function setAlwaysOnTop(value) {
  isAlwaysOnTop = Boolean(value);
  const window = getLiveWindow();
  if (window) {
    const pinned = isAlwaysOnTop || taskbarDock.enabled;
    window.setAlwaysOnTop(pinned, "screen-saver");
    window.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true });
  }
  sendToWindow("window:alwaysOnTopChanged", isAlwaysOnTop);
  rebuildTrayMenu();
  return isAlwaysOnTop;
}

async function setTaskbarDock(value) {
  const enabled = Boolean(value);
  if (enabled === taskbarDock.enabled) return enabled;
  const window = getLiveWindow();
  if (enabled) {
    const displayId = window ? screen.getDisplayMatching(window.getBounds()).id : screen.getPrimaryDisplay().id;
    if (displayId !== taskbarDock.displayId) taskbarDock.x = null;
    taskbarDock.displayId = displayId;
    if (isCompactMode) {
      rememberCompactWindow(window);
    } else {
      isCompactMode = true;
      restoreCompactWindow(window);
      sendToWindow("window:compactChanged", true);
    }
  }
  taskbarDock.enabled = enabled;
  restoreCompactOnCreate = !enabled && !window;
  if (!enabled) isCompactTopStrip = taskbarDock.restore?.displayMode === "topStrip";
  isCompactExpanded = false;
  setCompactMousePassthrough(false);
  if (window) {
    window.setSkipTaskbar(true);
    window.setResizable(false);
    window.setHasShadow(false);
    if (enabled) {
      placeTaskbarWindow(window);
    } else {
      restoreCompactWindow(window);
    }
  }
  setAlwaysOnTop(isAlwaysOnTop);
  sendToWindow("window:compactDisplayModeChanged", compactDisplayMode());
  await saveWidgetSettings();
  return enabled;
}

function rememberCompactWindow(window) {
  if (!window) return;
  const { x, y } = window.getBounds();
  taskbarDock.restore = { x, y, displayMode: compactDisplayMode(), scale: compactScale };
}

function restoreCompactWindow(window) {
  if (!window) return;
  isCompactTopStrip = taskbarDock.restore?.displayMode === "topStrip";
  if (taskbarDock.restore) compactScale = taskbarDock.restore.scale;
  resizeCompactWindow(window, false);
  if (taskbarDock.restore) {
    window.setPosition(taskbarDock.restore.x, taskbarDock.restore.y, false);
  } else {
    placeCompactWindowTopCenter(window);
  }
  sendToWindow("window:compactScaleChanged", compactScale);
}

async function setCompactMode(value) {
  if (taskbarDock.enabled) await setTaskbarDock(false);
  if (isCompactMode && !value) rememberCompactWindow(getLiveWindow());
  isCompactMode = Boolean(value);
  const window = getLiveWindow();
  if (window) {
    window.setHasShadow(!isCompactMode);
    window.setSkipTaskbar(isCompactMode);
    if (isCompactMode) {
      setCompactTopStrip(false);
      isCompactExpanded = false;
      resizeCompactWindow(window, false);
      placeCompactWindowTopCenter(window);
    } else {
      setCompactTopStrip(false);
      isCompactExpanded = false;
      setCompactMousePassthrough(false);
      window.setMinimumSize(WINDOW_SIZES.full.width, WINDOW_SIZES.full.height);
      window.setSize(WINDOW_SIZES.full.width, WINDOW_SIZES.full.height, false);
      placeWindowTopRight(window);
    }
  }
  sendToWindow("window:compactChanged", isCompactMode);
  sendToWindow("window:compactScaleChanged", compactScale);
  rebuildTrayMenu();
  return isCompactMode;
}

function setCompactScale(value) {
  if (taskbarDock.enabled) return compactScale;
  compactScale = clampCompactScale(value);
  const window = getLiveWindow();
  if (window && isCompactMode) {
    resizeCompactWindow(window);
    if (isCompactTopStrip) {
      snapCompactWindow();
    } else {
      placeCompactWindowTopCenter(window);
    }
  }
  sendToWindow("window:compactScaleChanged", compactScale);
  return compactScale;
}

function setCompactExpanded(value) {
  isCompactExpanded = Boolean(value) && !taskbarDock.enabled;
  const window = getLiveWindow();
  if (window && isCompactMode) {
    resizeCompactWindow(window, isCompactExpanded);
  }
  if (isCompactExpanded) setCompactMousePassthrough(false);
  return isCompactExpanded;
}

function setCompactTopStrip(value) {
  const nextValue = Boolean(value);
  if (isCompactTopStrip === nextValue) return isCompactTopStrip;
  isCompactTopStrip = nextValue;
  if (!isCompactTopStrip) setCompactMousePassthrough(false);
  sendToWindow("window:compactDisplayModeChanged", compactDisplayMode());
  return isCompactTopStrip;
}

function setCompactMousePassthrough(value) {
  const window = getLiveWindow();
  const nextValue = Boolean(value) && isCompactMode && isCompactTopStrip && !isCompactExpanded && !taskbarDock.enabled;
  if (isCompactMousePassthrough === nextValue) return isCompactMousePassthrough;
  isCompactMousePassthrough = nextValue;
  if (window) {
    window.setIgnoreMouseEvents(isCompactMousePassthrough, { forward: true });
  }
  return isCompactMousePassthrough;
}

function getCursorState() {
  const window = getLiveWindow();
  const cursor = screen.getCursorScreenPoint();
  return {
    cursor,
    windowBounds: window ? window.getBounds() : null
  };
}

function moveCompactWindow(deltaX, deltaY) {
  const window = getLiveWindow();
  if (!window) throw new Error("Main window has not been created.");
  if (!isCompactMode) throw new Error("Compact window movement is only available in compact mode.");
  const parsedDeltaX = Number(deltaX);
  const parsedDeltaY = Number(deltaY);
  if (!Number.isFinite(parsedDeltaX) || !Number.isFinite(parsedDeltaY)) {
    throw new Error("Compact window movement requires finite numeric deltas.");
  }
  const bounds = window.getBounds();
  if (taskbarDock.enabled) {
    const next = placeTaskbarWindow(window, bounds.x + parsedDeltaX);
    return { x: next.x, y: next.y, snapped: false, displayMode: "taskbar" };
  }
  const x = Math.round(bounds.x + parsedDeltaX);
  const y = Math.round(bounds.y + parsedDeltaY);
  window.setPosition(x, y, false);
  return { x, y, snapped: false, displayMode: compactDisplayMode() };
}

function snapCompactWindow() {
  const window = getLiveWindow();
  if (!window) throw new Error("Main window has not been created.");
  if (!isCompactMode) throw new Error("Compact window snapping is only available in compact mode.");
  if (taskbarDock.enabled) {
    const next = placeTaskbarWindow(window);
    return saveWidgetSettings().then(() => ({ x: next.x, y: next.y, snapped: true, displayMode: "taskbar" }));
  }
  const bounds = window.getBounds();
  const next = snapCompactPosition(bounds.x, bounds.y, bounds.width, bounds.height);
  const nextTopStrip = next.displayMode === "topStrip";
  const modeChanged = isCompactTopStrip !== nextTopStrip;
  const wasExpanded = isCompactExpanded;
  setCompactTopStrip(nextTopStrip);
  isCompactExpanded = false;
  if (modeChanged || wasExpanded) resizeCompactWindow(window, false);
  if (next.snapped || modeChanged) window.setPosition(next.x, next.y, false);
  if (!nextTopStrip) setCompactMousePassthrough(false);
  return { ...next, displayMode: compactDisplayMode() };
}

function snapCompactPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({
    x: x + Math.round(width / 2),
    y: y + Math.round(height / 2)
  });
  const { workArea } = display;
  const targetX = workArea.x + Math.round((workArea.width - width) / 2);
  const stripTargetY = workArea.y + COMPACT_STRIP_TOP_OFFSET;
  const nearStripTopY = y <= stripTargetY + COMPACT_STRIP_TOP_SNAP_DISTANCE;
  if (nearStripTopY) {
    const nearStripCenterX = Math.abs(x - targetX) <= COMPACT_STRIP_CENTER_SNAP_DISTANCE;
    return {
      x: nearStripCenterX ? targetX : clampWindowX(x, width, workArea),
      y: stripTargetY,
      snapped: true,
      displayMode: "topStrip"
    };
  }

  const targetY = workArea.y + COMPACT_TOP_OFFSET;
  const nearTopCenterX = Math.abs(x - targetX) <= COMPACT_CENTER_SNAP_DISTANCE;
  const nearTopCenterY = Math.abs(y - targetY) <= COMPACT_TOP_SNAP_DISTANCE;

  if (nearTopCenterX && nearTopCenterY) {
    return { x: targetX, y: targetY, snapped: true, displayMode: "hud" };
  }

  return { x, y, snapped: false, displayMode: "hud" };
}

function clampWindowX(x, width, workArea) {
  return Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, Math.round(x)));
}

function toggleWindow() {
  const window = getLiveWindow();
  if (window?.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

function showWindow() {
  const window = getLiveWindow();
  if (!window) {
    createWindow();
    return;
  }

  cancelWindowRelease();
  if (!window.isVisible()) window.show();
  window.focus();
  quotaStore?.setWindowVisible(true);
  quotaStore?.refreshNow("window-show").catch(() => {});
}

function hideWindow() {
  const window = getLiveWindow();
  if (window) window.hide();
}

function scheduleWindowRelease() {
  if (isQuitting) return;
  cancelWindowRelease();
  releaseWindowTimer = setTimeout(() => {
    const window = getLiveWindow();
    if (window && !window.isVisible()) {
      window.destroy();
    }
  }, HIDDEN_WINDOW_RELEASE_MS);
}

function cancelWindowRelease() {
  if (releaseWindowTimer) {
    clearTimeout(releaseWindowTimer);
    releaseWindowTimer = null;
  }
}

function quitApp() {
  isQuitting = true;
  cancelWindowRelease();
  quotaStore?.destroy();
  app.quit();
}

function getLiveWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function sendToWindow(channel, ...args) {
  const window = getLiveWindow();
  if (!window || window.webContents.isDestroyed()) return;
  window.webContents.send(channel, ...args);
}

function sendToSettingsWindow(channel, ...args) {
  if (!settingsWindow || settingsWindow.isDestroyed() || settingsWindow.webContents.isDestroyed()) return;
  settingsWindow.webContents.send(channel, ...args);
}

app.on("before-quit", () => {
  isQuitting = true;
  cancelWindowRelease();
  quotaStore?.destroy();
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) event.preventDefault();
});
