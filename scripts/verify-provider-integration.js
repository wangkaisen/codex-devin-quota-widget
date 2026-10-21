const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const childProcess = require("node:child_process");
const { taskbarBounds } = require("../src/shared/compact-layout");

assert.deepEqual(taskbarBounds({ x: 0, y: 0, width: 1920, height: 1080 }), { x: 1380, y: 1040, width: 240, height: 40 });
assert.deepEqual(taskbarBounds({ x: -1920, y: -200, width: 1920, height: 1080 }), { x: -540, y: 840, width: 240, height: 40 });
assert.equal(taskbarBounds({ x: 0, y: 0, width: 1366, height: 768 }, 0).x, 0, "A saved x of zero is valid");
assert.equal(taskbarBounds({ x: -1920, y: 0, width: 1920, height: 1080 }, -9999).x, -1920);
assert.equal(taskbarBounds({ x: -1920, y: 0, width: 1920, height: 1080 }, 9999).x, -240);

if (!process.versions.electron) {
  (async () => {
    const root = path.join(__dirname, "../artifacts/tests");
    await fs.mkdir(root, { recursive: true });
    const dir = await fs.mkdtemp(path.join(root, "provider-integration-"));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      for (const phase of ["dual", "restart"]) {
        await new Promise((resolve, reject) => {
          const child = childProcess.spawn(require("electron"), [__filename, dir, phase], {
            env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
          });
          child.stdout.pipe(process.stdout);
          child.stderr.pipe(process.stderr);
          child.once("error", reject);
          child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Provider integration ${phase} failed (${code}).`)));
        });
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  })().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  runElectronChecks().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
}

async function runElectronChecks() {
  const electron = require("electron");
  const { EventEmitter } = require("node:events");
  const { mock } = require("node:test");
  const Module = require("node:module");
  const dir = process.argv[2];
  const phase = process.argv[3];
  for (const name of ["appData", "userData", "sessionData", "logs", "crashDumps"]) {
    const target = path.join(dir, name);
    require("node:fs").mkdirSync(target, { recursive: true });
    electron.app.setPath(name, target);
  }
  electron.app.disableHardwareAcceleration();
  let devinRequests = 0;
  let codexRequests = 0;
  let failCodex = false;
  let devinWeekly = 31;
  let codexWeekly = 60;
  let tooltip;
  let trayItems;
  let failDevin = false;
  const readFile = fs.readFile.bind(fs);
  mock.method(fs, "readFile", (filePath, ...args) => String(filePath).endsWith("credentials.toml")
    ? Promise.resolve('windsurf_api_key = "integration-test-key"') : readFile(filePath, ...args));
  mock.method(childProcess, "spawn", (_command, args, options) => {
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    if (args[0] === "version") {
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("devin 3000.10.67 (test)"));
        child.emit("close", 0);
      });
    } else {
      child.stdin = { write(line) {
        const request = JSON.parse(line);
        if (request.method !== "initialize") codexRequests += 1;
        if (failCodex && request.method !== "initialize") {
          queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: request.id, error: { message: "Codex unavailable" } })}\n`)));
          return;
        }
        const result = request.method === "initialize" ? {} : { rateLimitsByLimitId: { codex: {
          planType: "plus",
          primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 18000 },
          secondary: { usedPercent: 100 - codexWeekly, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 604800 }
        } } };
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify({ id: request.id, result })}\n`)));
      } };
    }
    return child;
  });
  mock.method(globalThis, "fetch", async (url, options) => {
    devinRequests += 1;
    assert.equal(url, "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus");
    assert.equal(options.redirect, "error");
    if (failDevin) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ planInfo: { planName: "Pro" }, userStatus: { planStatus: {
      dailyQuotaRemainingPercent: 74, weeklyQuotaRemainingPercent: devinWeekly,
      dailyQuotaResetAtUnix: String(Math.floor(Date.now() / 1000) + 86400),
      weeklyQuotaResetAtUnix: String(Math.floor(Date.now() / 1000) + 604800)
    } } }) };
  });
  const setToolTip = electron.Tray.prototype.setToolTip;
  mock.method(electron.Tray.prototype, "setToolTip", function (value) { tooltip = value; return setToolTip.call(this, value); });
  const buildMenu = electron.Menu.buildFromTemplate.bind(electron.Menu);
  mock.method(electron.Menu, "buildFromTemplate", (template) => { trayItems = template; return buildMenu(template); });
  const load = Module._load;
  mock.method(Module, "_load", function (id, ...args) {
    if (id === "electron") return { ...electron, BrowserWindow: new Proxy(electron.BrowserWindow, {
      construct(Target, [options]) {
        const window = new Target({ ...options, webPreferences: { ...options.webPreferences, offscreen: true } });
        window.show = () => {};
        return window;
      }
    }) };
    return load.call(this, id, ...args);
  });
  const watchdog = setTimeout(() => { console.error("Provider integration timed out."); electron.app.exit(1); }, 25000);
  require("../src/main/main");
  await electron.app.whenReady();
  let window;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    window = electron.BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading() && await window.webContents.executeJavaScript("Boolean(window.codexQuota && document.getElementById('brandName'))")) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(window, "The app should create its real renderer");
  const js = (source) => window.webContents.executeJavaScript(source);
  const waitReady = () => js(`(async () => {
    for (let i = 0; i < 100; i++) {
      const value = await window.codexQuota.getQuotaState();
      if (value.status === 'ready' && !value.refreshing) return value;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Both quotas did not become ready');
  })()`);
  const initial = await waitReady();
  assert.equal(initial.providers.codex.quota.secondary.remainingPercent, 60);
  assert.equal(initial.providers.devin.quota.secondary.remainingPercent, 31);
  const docked = (await js("window.codexQuota.getCompactDisplayMode()")) === "taskbar";
  assert.deepEqual(await js("['compactWeeklyLabel', 'compactWeeklyText', 'compactShortLabel', 'compactShortText'].map(id => document.getElementById(id).textContent)"), docked ? ["Codex", "60%", "Devin", "31%"] : ["C7d", "60%", "D7d", "31%"]);
  assert.equal(await js("document.getElementById('providerBtn')"), null);
  assert.equal(await js("typeof window.codexQuota.getProvider"), "undefined");
  assert.equal(await js("typeof window.codexQuota.setProvider"), "undefined");
  assert.equal(await js("typeof window.codexQuota.onProviderChanged"), "undefined");
  assert.equal(trayItems.some((item) => /切换到/.test(item.label || "")), false);
  assert.equal(tooltip, "Codex 7d 60% · Devin 7d 31%");
  if (phase === "restart") {
    assert.equal((await js("window.codexQuota.getSignalSettings()")).quotaRefreshMs, 120000);
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "taskbar", "Dock mode survives a restart");
    const expected = JSON.parse(await fs.readFile(path.join(dir, "dock-expected.json"), "utf8"));
    assert.deepEqual(window.getBounds(), expected.docked, "The horizontal dock adjustment survives a restart");
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "topStrip");
    assert.deepEqual(window.getBounds(), expected.undocked, "The previous compact position survives a docked restart");
    assert.ok(devinRequests > 0 && codexRequests > 0);
    console.log("Verified both providers, signal settings, docked position, and undocking restoration after an Electron restart.");
  } else {
    await js("window.codexQuota.setCompactMode(false)");
    assert.deepEqual(await js("['primaryLabel', 'secondaryLabel', 'remaining'].map(id => document.getElementById(id).textContent)"), ["Codex 7天", "Devin 7天", "31%"]);
    assert.equal(await js("document.getElementById('liquidFill').style.height"), "31%");
    assert.match(await js("document.getElementById('primaryText').textContent"), /^60%/);
    assert.match(await js("document.getElementById('secondaryText').textContent"), /^31%/);
    await js("document.getElementById('langBtn').click()");
    assert.deepEqual(await js("['primaryLabel', 'secondaryLabel'].map(id => document.getElementById(id).textContent)"), ["Codex 7d", "Devin 7d"]);
    assert.equal(await js(`(() => {
      const brand = document.querySelector('.brand').getBoundingClientRect();
      const actions = document.querySelector('.window-actions').getBoundingClientRect();
      return brand.right <= actions.left;
    })()`), true, "The full-window title must fit beside its controls");
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(__dirname, "../artifacts/dual-weekly-full.png"), (await window.webContents.capturePage()).toPNG());

    failDevin = true;
    const partial = await js("window.codexQuota.refreshQuota()");
    assert.equal(partial.status, "partial");
    assert.equal(partial.providers.devin.status, "error");
    assert.deepEqual(await js("['compactWeeklyText', 'compactShortText'].map(id => document.getElementById(id).textContent)"), ["60%", "--"]);
    assert.match(await js("document.getElementById('statusText').textContent"), /Devin.*unavailable/i);
    assert.equal(tooltip, "Codex 7d 60% · Devin 7d --");
    await js("document.getElementById('langBtn').click()");
    assert.match(await js("document.getElementById('statusText').textContent"), /Devin.*不可用/);
    assert.equal(await js("document.getElementById('secondaryText').textContent"), "--");
    failCodex = true;
    assert.equal((await js("window.codexQuota.refreshQuota()")).status, "error");
    assert.deepEqual(await js("['compactWeeklyText', 'compactShortText', 'remaining'].map(id => document.getElementById(id).textContent)"), ["--", "--", "--"]);
    failDevin = false;
    const reverse = await js("window.codexQuota.refreshQuota()");
    assert.equal(reverse.providers.devin.status, "ready");
    assert.equal(reverse.providers.codex.status, "error");
    assert.deepEqual(await js("['compactWeeklyText', 'compactShortText'].map(id => document.getElementById(id).textContent)"), ["--", "31%"]);
    failCodex = false;
    devinWeekly = 4;
    await trayItems.find((item) => item.label === "刷新额度").click();
    await waitReady();
    assert.match(await js("document.getElementById('compactAdviceText').className"), /critical/);
    assert.match(await js("document.getElementById('compactAdviceText').title"), /Codex.*Devin/);
    assert.equal(await js("document.getElementById('remaining').textContent"), "4%");
    devinWeekly = 90;
    codexWeekly = 3;
    await js("window.codexQuota.refreshQuota()");
    assert.match(await js("document.getElementById('compactAdviceText').className"), /critical/);
    assert.equal(await js("document.getElementById('remaining').textContent"), "3%");
    codexWeekly = 60;
    devinWeekly = 31;
    await js("window.codexQuota.refreshQuota()");
    await js("window.codexQuota.setSignalSettings({ quotaRefreshMs: 120000 })");
    await js("window.codexQuota.setCompactMode(true)");
    await js("window.codexQuota.setCompactScale(0.46)");
    await fs.writeFile(path.join(__dirname, "../artifacts/dual-weekly-compact.png"), (await window.webContents.capturePage()).toPNG());
    await js("window.codexQuota.setCompactExpanded(true)");
    await js("document.body.dataset.compactExpanded = 'true'");
    await js("new Promise(resolve => setTimeout(resolve, 200))");
    assert.match(await js("document.getElementById('compactCodexStatus').textContent"), /.+/);
    assert.match(await js("document.getElementById('compactDevinStatus').textContent"), /.+/);
    await fs.writeFile(path.join(__dirname, "../artifacts/dual-weekly-expanded.png"), (await window.webContents.capturePage()).toPNG());
    devinWeekly = 0;
    await js("window.codexQuota.refreshQuota()");
    await js("document.getElementById('langBtn').click()");
    assert.equal(await js("document.getElementById('compactShortText').textContent"), "0%");
    assert.equal(await js("document.getElementById('remaining').textContent"), "0%");
    assert.equal(await js(`['compactCodexStatus', 'compactDevinStatus'].every(id => {
      const element = document.getElementById(id);
      return element.scrollWidth <= element.clientWidth;
    })`), true, "Expanded provider status labels must be readable without truncation");
    assert.equal(await js(`(() => {
      const panel = document.getElementById('compactResetInfo').getBoundingClientRect();
      const reset = document.getElementById('compactShortResetText').getBoundingClientRect();
      return reset.right <= panel.right;
    })()`), true, "English pace advice must leave the weekly reset visible inside the expanded HUD");
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await fs.writeFile(path.join(__dirname, "../artifacts/dual-weekly-expanded-en.png"), (await window.webContents.capturePage()).toPNG());
    devinWeekly = 31;
    await js("window.codexQuota.refreshQuota()");
    await js("document.getElementById('langBtn').click()");
    const workArea = electron.screen.getPrimaryDisplay().workArea;
    window.setPosition(workArea.x + 100, workArea.y);
    await js("window.codexQuota.snapCompactWindow()");
    await js("window.codexQuota.setCompactExpanded(true)");
    await js("document.body.dataset.compactExpanded = 'true'");
    await js("new Promise(resolve => setTimeout(resolve, 200))");
    assert.equal(await js(`['Weekly', 'Short'].every(name => {
      const label = document.createRange();
      label.selectNodeContents(document.getElementById('compact' + name + 'Label'));
      return label.getBoundingClientRect().right < document.getElementById('compact' + name + 'Text').getBoundingClientRect().left;
    })`), true, "C7d and D7d must not overlap their quotas in the expanded top strip");
    await fs.writeFile(path.join(__dirname, "../artifacts/dual-weekly-strip.png"), (await window.webContents.capturePage()).toPNG());
    await js("window.codexQuota.setCompactExpanded(false)");
    const undockedBounds = window.getBounds();
    const dockItem = trayItems.find((item) => /停靠到任务栏/.test(item.label || ""));
    assert.ok(dockItem, "The tray must offer Dock to taskbar");
    assert.equal(dockItem.type, "checkbox");
    assert.equal(dockItem.checked, false);
    await dockItem.click();
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "taskbar");
    assert.deepEqual(await js("['compactWeeklyLabel', 'compactShortLabel'].map(id => document.getElementById(id).textContent)"), ["Codex", "Devin"], "Taskbar mode uses full provider names");
    assert.equal(trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).checked, true);
    const displayBounds = electron.screen.getDisplayMatching(undockedBounds).bounds;
    assert.deepEqual(window.getBounds(), {
      x: displayBounds.x + displayBounds.width - 540,
      y: displayBounds.y + displayBounds.height - 40,
      width: 240,
      height: 40
    }, "Dock uses full display bounds, with room for the tray");
    assert.equal(window.isResizable(), false);
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "topStrip");
    assert.deepEqual(window.getBounds(), undockedBounds, "Undocking restores the previous compact position and mode");
    await js("window.codexQuota.setCompactMode(true)");
    window.setPosition(workArea.x + 200, workArea.y + 180);
    const hudBounds = window.getBounds();
    await js("window.codexQuota.setCompactMode(false)");
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "hud");
    assert.deepEqual(window.getPosition(), [hudBounds.x, hudBounds.y], "Docking from full view remembers the previous compact HUD position");
    assert.equal(await js("window.codexQuota.getCompactScale()"), 0.46);
    window.setPosition(undockedBounds.x, undockedBounds.y);
    await js("window.codexQuota.snapCompactWindow()");
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    const dockedBounds = window.getBounds();
    await js("window.codexQuota.moveCompactWindow(45, -180)");
    const draggedBounds = window.getBounds();
    assert.ok(Math.abs(draggedBounds.x - dockedBounds.x - 45) <= 1, "Horizontal drag allows Windows DPI rounding");
    assert.deepEqual({ ...draggedBounds, x: dockedBounds.x }, dockedBounds, "Dragging stays at the same taskbar height");
    await js("window.codexQuota.snapCompactWindow()");
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "taskbar", "Finishing a drag must not turn docking into a normal HUD");
    assert.equal(await js("window.codexQuota.setCompactExpanded(true)"), false);
    await js("window.codexQuota.setCompactScale(1.25)");
    assert.deepEqual(window.getBounds(), draggedBounds, "Hover and scale requests cannot resize the dock");
    assert.equal(await js("document.body.dataset.compactDisplay"), "taskbar");
    await js(`document.getElementById('compactHud').dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: 20, clientY: 20
    }))`);
    assert.equal(await js("document.body.dataset.compactExpanded"), "false", "Hover leaves the dock as a single row");
    await js(`document.getElementById('compactHud').dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: 20, clientY: 20, screenX: 100, screenY: 100
    }));
    window.dispatchEvent(new MouseEvent('mousemove', { screenX: 132, screenY: 160 }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));`);
    await js("new Promise(resolve => setTimeout(resolve, 100))");
    assert.equal(window.getBounds().x, draggedBounds.x + 32, "The renderer's drag handlers move the dock");
    assert.equal(window.getBounds().y, draggedBounds.y);
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "taskbar");
    codexWeekly = 100;
    devinWeekly = 100;
    await js("window.codexQuota.refreshQuota()");
    await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    assert.equal(await js(`['Weekly', 'Short'].every(name => {
      const label = document.getElementById('compact' + name + 'Label').getBoundingClientRect();
      const quota = document.getElementById('compact' + name + 'Text').getBoundingClientRect();
      const track = document.getElementById('compact' + name + 'Fill').parentElement.getBoundingClientRect();
      return label.width > 0 && label.right <= quota.left && quota.right <= track.left && track.width > 10
        && quota.top >= 0 && quota.bottom <= 40;
    })`), true, "Dock labels, 100% quotas and tracks fit without overlap");
    await js("new Promise(resolve => setTimeout(resolve, 350))");
    await fs.writeFile(path.join(__dirname, "../artifacts/taskbar-dock.png"), (await window.webContents.capturePage()).toPNG());
    const lastDockedBounds = window.getBounds();
    window.destroy();
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    trayItems.find((item) => item.label === "显示/隐藏").click();
    for (let i = 0; i < 100; i++) {
      window = electron.BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoading() && await js("Boolean(window.codexQuota && document.getElementById('brandName'))")) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(await js("window.codexQuota.getCompactDisplayMode()"), "topStrip");
    assert.deepEqual(window.getBounds(), undockedBounds, "Undocking after the hidden window is released still restores its position");
    await trayItems.find((item) => /停靠到任务栏/.test(item.label || "")).click();
    assert.deepEqual(window.getBounds(), lastDockedBounds, "Recreating the window retains the docked x");
    await js("window.codexQuota.setSignalSettings({ quotaRefreshMs: 120000 })");
    await fs.writeFile(path.join(dir, "dock-expected.json"), JSON.stringify({ docked: window.getBounds(), undocked: undockedBounds }));
    console.log("Verified real Electron dual weekly HUD, full view, bilingual copy, tray docking, horizontal drag, fixed dock layout, window recreation, isolated failures, and recovery (mock quota services).");
  }
  clearTimeout(watchdog);
  electron.app.quit();
}
