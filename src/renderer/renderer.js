const state = {
  lang: "zh",
  snapshot: null,
  error: null,
  compact: true,
  compactDisplayMode: "hud",
  compactExpanded: false,
  compactScale: 0.46,
  compactTheme: "glass",
  signalSettings: {
    recentFastBreathMs: 4000,
    criticalBlinkMs: 3000
  },
  resizing: null,
  moving: null,
  resizeFrame: null,
  moveFrame: null,
  hoverProbeTimer: null,
  hoverProbeInFlight: false,
  loading: false
};

const COMPACT_HOVER_PROBE_MS = 80;

const COMPACT_SCALE_LIMITS = { min: 0.46, max: 1.25 };
const COMPACT_DEFAULT_SCALE = 0.46;
const COMPACT_DEFAULT_SCALE_SNAP_DISTANCE = 0.035;
const COMPACT_THEME_STORAGE_KEY = "codexQuotaCompactTheme";
const COMPACT_THEMES = new Set(["glass", "island"]);
const COMPACT_DISPLAY_MODES = new Set(["hud", "topStrip", "taskbar"]);

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required DOM element: #${id}`);
  }
  return element;
}

const els = {
  body: document.body,
  trafficLight: requiredElement("trafficLight"),
  brandName: requiredElement("brandName"),
  stateText: requiredElement("stateText"),
  langBtn: requiredElement("langBtn"),
  compactBtn: requiredElement("compactBtn"),
  pinBtn: requiredElement("pinBtn"),
  refreshBtn: requiredElement("refreshBtn"),
  minimizeBtn: requiredElement("minimizeBtn"),
  closeBtn: requiredElement("closeBtn"),
  liquidMeter: requiredElement("liquidMeter"),
  liquidFill: requiredElement("liquidFill"),
  remaining: requiredElement("remaining"),
  remainingLabel: requiredElement("remainingLabel"),
  compactShell: requiredElement("compactShell"),
  compactHud: requiredElement("compactHud"),
  compactControls: requiredElement("compactControls"),
  compactWeeklyFill: requiredElement("compactWeeklyFill"),
  compactShortFill: requiredElement("compactShortFill"),
  compactWeeklyIdeal: requiredElement("compactWeeklyIdeal"),
  compactShortIdeal: requiredElement("compactShortIdeal"),
  compactWeeklyVelocity: requiredElement("compactWeeklyVelocity"),
  compactShortVelocity: requiredElement("compactShortVelocity"),
  compactWeeklyIdealText: requiredElement("compactWeeklyIdealText"),
  compactShortIdealText: requiredElement("compactShortIdealText"),
  compactWeeklyVelocityText: requiredElement("compactWeeklyVelocityText"),
  compactShortVelocityText: requiredElement("compactShortVelocityText"),
  compactWeeklyText: requiredElement("compactWeeklyText"),
  compactShortText: requiredElement("compactShortText"),
  compactWeeklyLabel: requiredElement("compactWeeklyLabel"),
  compactShortLabel: requiredElement("compactShortLabel"),
  compactWeeklyDelta: requiredElement("compactWeeklyDelta"),
  compactShortDelta: requiredElement("compactShortDelta"),
  compactThemeBtn: requiredElement("compactThemeBtn"),
  compactExpandBtn: requiredElement("compactExpandBtn"),
  compactCloseBtn: requiredElement("compactCloseBtn"),
  compactResizeHandle: requiredElement("compactResizeHandle"),
  compactAdviceText: requiredElement("compactAdviceText"),
  compactAdviceKicker: requiredElement("compactAdviceKicker"),
  compactAdviceValue: requiredElement("compactAdviceValue"),
  compactPaceSignal: requiredElement("compactPaceSignal"),
  compactCodexStatus: requiredElement("compactCodexStatus"),
  compactDevinStatus: requiredElement("compactDevinStatus"),
  compactResetInfo: requiredElement("compactResetInfo"),
  compactShortResetText: requiredElement("compactShortResetText"),
  compactWeeklyResetText: requiredElement("compactWeeklyResetText"),
  primaryLabel: requiredElement("primaryLabel"),
  primaryText: requiredElement("primaryText"),
  secondaryLabel: requiredElement("secondaryLabel"),
  secondaryText: requiredElement("secondaryText"),
  planLabel: requiredElement("planLabel"),
  planText: requiredElement("planText"),
  paceTitle: requiredElement("paceTitle"),
  paceBadge: requiredElement("paceBadge"),
  weeklyPaceLabel: requiredElement("weeklyPaceLabel"),
  weeklyPaceText: requiredElement("weeklyPaceText"),
  actualPaceLabel: requiredElement("actualPaceLabel"),
  actualPaceText: requiredElement("actualPaceText"),
  idealPaceLabel: requiredElement("idealPaceLabel"),
  idealPaceText: requiredElement("idealPaceText"),
  velocityPaceLabel: requiredElement("velocityPaceLabel"),
  velocityPaceText: requiredElement("velocityPaceText"),
  deltaPaceLabel: requiredElement("deltaPaceLabel"),
  deltaPaceText: requiredElement("deltaPaceText"),
  statusDot: requiredElement("statusDot"),
  statusText: requiredElement("statusText")
};

const copy = {
  zh: {
    brand: "Codex · Devin",
    loading: "读取中",
    ready: "已更新",
    error: "读取失败",
    remaining: "剩余",
    primary: "Codex 7天",
    secondary: "Devin 7天",
    plan: "计划",
    unknown: "未知",
    refresh: "刷新",
    hide: "隐藏",
    hideToTray: "隐藏到托盘",
    close: "退出",
    pin: "置顶",
    unpin: "取消置顶",
    compact: "紧凑窗口",
    expand: "展开窗口",
    resize: "缩放",
    theme: "切换 HUD 主题",
    statusLoading: "正在读取双周额度...",
    statusError: "无法读取额度",
    authRequired: "需要登录后才能读取额度",
    unavailable: "不可用",
    partial: "部分可用",
    cached: "缓存",
    paceTitle: "Codex 节奏建议",
    weeklyPace: "7天节奏",
    actualRemaining: "实际剩余",
    idealRemaining: "理想剩余",
    velocityRemaining: "近速需留",
    paceDelta: "偏差",
    status: {
      urgent: "加速蹬！",
      accelerate: "余量充足",
      normal: "节奏正常",
      recentFast: "近期偏快",
      coolingDown: "继续放缓",
      slow: "建议减速",
      critical: "接近耗尽",
      unknown: "无法判断"
    },
    reasons: {
      ahead: "7天窗口剩余额度高于当前时间进度",
      onTrack: "7天窗口消耗与当前时间进度基本一致",
      behind: "7天窗口剩余额度低于当前时间进度",
      critical: "7天窗口剩余额度不高于 5%",
      urgentAhead: "7天窗口剩余额度明显高于理想剩余额度",
      shortWindowTight: "5小时窗口近期速度偏快",
      shortWindowCritical: "5小时窗口剩余额度紧张",
      recentPaceRecovered: "5小时窗口近期速度已经回到合理范围",
      bothWindowsBehind: "7天窗口和5小时窗口都低于当前时间进度",
      dynamicPaceTight: "按近期速度继续使用会提前耗尽",
      bothReferencesBehind: "实际剩余同时低于理想线和近速需留线",
      insufficientData: "7天窗口缺少 reset 时间或窗口时长",
      missingLongWindow: "没有可用于主判断的 7天窗口数据"
    },
    reset: "重置时间",
    noReset: "未提供重置时间"
  },
  en: {
    brand: "Codex · Devin",
    loading: "Loading",
    ready: "Updated",
    error: "Failed",
    remaining: "left",
    primary: "Codex 7d",
    secondary: "Devin 7d",
    plan: "Plan",
    unknown: "Unknown",
    refresh: "Refresh",
    hide: "Hide",
    hideToTray: "Hide to tray",
    close: "Quit",
    pin: "Pin",
    unpin: "Unpin",
    compact: "Compact",
    expand: "Expand",
    resize: "Resize",
    theme: "Switch HUD theme",
    statusLoading: "Reading both weekly quotas...",
    statusError: "Unable to read quota",
    authRequired: "Sign in before quota can be read",
    unavailable: "unavailable",
    partial: "Partly available",
    cached: "cached",
    paceTitle: "Codex pace advice",
    weeklyPace: "7-day pace",
    actualRemaining: "Actual",
    idealRemaining: "Ideal",
    velocityRemaining: "Recent",
    paceDelta: "Delta",
    status: {
      urgent: "Use soon",
      accelerate: "Enough left",
      normal: "On track",
      recentFast: "Recent fast",
      coolingDown: "Cooling",
      slow: "Slow down",
      critical: "Nearly exhausted",
      unknown: "Unknown"
    },
    reasons: {
      ahead: "The 7-day quota is above the current time progress",
      onTrack: "The 7-day usage matches the current time progress",
      behind: "The 7-day quota is below the current time progress",
      critical: "The 7-day quota is at or below 5%",
      urgentAhead: "The 7-day quota is well above the ideal remaining quota",
      shortWindowTight: "The 5-hour window is burning too fast",
      shortWindowCritical: "The 5-hour window is tight",
      recentPaceRecovered: "The 5-hour window has recovered to a reasonable pace",
      bothWindowsBehind: "Both the 7-day and 5-hour windows are behind",
      dynamicPaceTight: "The recent pace would run out before reset",
      bothReferencesBehind: "The current quota is below both reference lines",
      insufficientData: "The 7-day reset time or window duration is missing",
      missingLongWindow: "No 7-day window data is available for the main decision"
    },
    reset: "reset time",
    noReset: "reset time unavailable"
  }
};

function t(path) {
  return path.split(".").reduce((value, key) => value?.[key], copy[state.lang]) ?? path;
}

function setText(element, value) {
  element.textContent = value;
}

function setAttr(element, name, value) {
  element.setAttribute(name, value);
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentText(value) {
  const number = finiteNumberOrNull(value);
  return number === null ? "--" : `${Math.round(number)}%`;
}

function signedPercentText(value) {
  const number = finiteNumberOrNull(value);
  if (number === null) return "--";
  const rounded = Math.round(number);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function signedDeltaText(value) {
  const number = finiteNumberOrNull(value);
  if (number === null) return "--";
  const rounded = Math.round(number);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function compactDeltaClass(value) {
  const number = finiteNumberOrNull(value);
  if (number === null || Math.round(number) === 0) return "compact-delta neutral";
  return `compact-delta ${number > 0 ? "positive" : "negative"}`;
}

function clampPercentValue(value) {
  const number = finiteNumberOrNull(value);
  if (number === null) return null;
  return Math.min(100, Math.max(0, number));
}

function formatWindow(window) {
  if (!window) return "--";
  const resetText = window.resetsAt ? compactResetTime(window) : t("noReset");
  return `${percentText(window.remainingPercent)} · ${resetText}`;
}

function formatReset(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("noReset");
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${t("reset")} ${month}/${day} ${hour}:${minute}`;
}

function compactResetTime(window) {
  if (!window?.resetsAt) return "--";
  const date = new Date(window.resetsAt);
  if (!Number.isFinite(date.getTime())) return "--";
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${month}/${day} ${hour}:${minute}`;
}

function compactResetDetail(window) {
  return compactResetTime(window);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function statusClassFromRemaining(remainingPercent) {
  const remaining = finiteNumberOrNull(remainingPercent);
  if (remaining === null) return "loading";
  if (remaining <= 0) return "danger";
  if (remaining < 10) return "warning";
  return "good";
}

function renderStaticCopy() {
  document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
  setText(els.brandName, t("brand"));
  updateCompactMetricLabels();
  setAttr(els.liquidMeter, "aria-label", `${t("brand")} · ${t("remaining")}`);
  setAttr(els.compactShell, "aria-label", `${t("brand")} HUD`);
  setAttr(els.compactHud, "aria-label", `${t("secondary")} / ${t("primary")} HUD`);
  setText(els.remainingLabel, t("remaining"));
  setText(els.primaryLabel, t("primary"));
  setText(els.secondaryLabel, t("secondary"));
  setText(els.planLabel, t("plan"));
  setText(els.paceTitle, t("paceTitle"));
  setText(els.weeklyPaceLabel, t("weeklyPace"));
  setText(els.actualPaceLabel, t("actualRemaining"));
  setText(els.idealPaceLabel, t("idealRemaining"));
  setText(els.velocityPaceLabel, t("velocityRemaining"));
  setText(els.deltaPaceLabel, t("paceDelta"));
  setText(els.langBtn, state.lang === "zh" ? "EN" : "中");
  renderCompactButton(state.compact);
  setAttr(els.refreshBtn, "title", t("refresh"));
  setAttr(els.refreshBtn, "aria-label", t("refresh"));
  setAttr(els.minimizeBtn, "title", t("hide"));
  setAttr(els.minimizeBtn, "aria-label", t("hide"));
  setAttr(els.closeBtn, "title", t("close"));
  setAttr(els.closeBtn, "aria-label", t("close"));
  setAttr(els.compactExpandBtn, "title", t("expand"));
  setAttr(els.compactExpandBtn, "aria-label", t("expand"));
  setAttr(els.compactCloseBtn, "title", t("hideToTray"));
  setAttr(els.compactCloseBtn, "aria-label", t("hideToTray"));
  setAttr(els.compactThemeBtn, "title", t("theme"));
  setAttr(els.compactThemeBtn, "aria-label", t("theme"));
  setAttr(els.compactResizeHandle, "title", t("resize"));
  setAttr(els.compactResizeHandle, "aria-label", t("resize"));
  renderCompactTheme(state.compactTheme, { persist: false });
}

function availableQuota(provider) {
  return provider?.status === "ready" ? provider.quota : null;
}

function renderQuota(providers = {}) {
  renderStaticCopy();
  const codex = availableQuota(providers.codex);
  const devin = availableQuota(providers.devin);
  const values = [codex, devin].map((quota) => finiteNumberOrNull(quota?.secondary?.remainingPercent)).filter((value) => value !== null);
  const remaining = values.length ? Math.min(...values) : null;
  const quotaState = statusClassFromRemaining(remaining);
  els.body.dataset.state = quotaState;
  els.trafficLight.className = `traffic-light ${quotaState}`;
  els.statusDot.className = `status-dot ${quotaState}`;
  setText(els.remaining, percentText(remaining));
  els.liquidFill.style.height = `${remaining ?? 0}%`;
  renderCompactHud(codex, devin);
  setText(els.primaryText, formatWindow(codex?.secondary));
  setText(els.secondaryText, formatWindow(devin?.secondary));
  setAttr(els.primaryText, "title", codex?.secondary?.resetsAt ? formatReset(codex.secondary.resetsAt) : t("noReset"));
  setAttr(els.secondaryText, "title", devin?.secondary?.resetsAt ? formatReset(devin.secondary.resetsAt) : t("noReset"));
  const plans = `Codex ${codex?.planType || "--"} · Devin ${devin?.planType || "--"}`;
  setText(els.planText, plans);
  setAttr(els.planText, "title", plans);
  renderPaceAdvice(codex?.paceAdvice);
  renderCompactAdvice(providers);
}

function renderPaceAdvice(advice) {
  const weekly = advice?.longWindow;
  const overall = advice?.overall || { status: "unknown", severity: "muted", reasonCode: "missingLongWindow" };

  setText(els.weeklyPaceText, t(`status.${weekly?.status || "unknown"}`));
  setText(els.paceBadge, t(`status.${overall.status}`));
  setText(els.actualPaceText, percentText(weekly?.remainingPercent));
  setText(els.idealPaceText, percentText(weekly?.idealRemainingPercent));
  setText(els.velocityPaceText, percentText(weekly?.velocity?.requiredRemainingPercent));
  setText(els.deltaPaceText, signedPercentText(weekly?.paceDelta));
  els.paceBadge.className = `pace-badge ${overall.severity}`;
}

function renderCompactAdvice(providers) {
  const priority = { urgent: 0, accelerate: 1, normal: 2, unknown: 3, coolingDown: 4, recentFast: 5, slow: 6, critical: 7 };
  const summaries = Object.entries({ codex: "Codex", devin: "Devin" }).map(([name, label]) => {
    const provider = providers[name];
    const overall = availableQuota(provider)?.paceAdvice?.overall || { status: "unknown", severity: "muted" };
    const statusLabel = provider?.status === "error" ? t("unavailable") : t(`status.${overall.status}`);
    const statusElement = name === "codex" ? els.compactCodexStatus : els.compactDevinStatus;
    const shortLabel = state.lang === "en"
      ? provider?.status === "error" ? "Failed" : {
        urgent: "Soon", accelerate: "Plenty", normal: "On track", recentFast: "Fast",
        coolingDown: "Cooling", slow: "Slow", critical: "Low", unknown: "Unknown"
      }[overall.status]
      : statusLabel;
    setText(statusElement, shortLabel);
    setAttr(statusElement, "title", `${label}: ${statusLabel}`);
    return { overall, description: `${label}: ${statusLabel}` };
  });
  const overall = summaries.reduce((worst, item) => priority[item.overall.status] > priority[worst.status] ? item.overall : worst, summaries[0].overall);
  const compactText = compactAdviceText(overall.status);
  setText(els.compactAdviceKicker, compactText.kicker);
  setText(els.compactAdviceValue, compactText.value);
  const description = summaries.map((item) => item.description).join(" · ");
  setAttr(els.compactAdviceText, "title", description);
  setAttr(els.compactAdviceText, "aria-label", description);
  els.compactAdviceText.className = `compact-advice ${overall.severity} ${overall.status}`;
  renderCompactPaceSignal(overall);
}

function compactAdviceText(status) {
  const statusKey = knownPaceStatus(status) ? status : "unknown";
  const labels = {
    zh: {
      urgent: { kicker: "加速", value: "蹬！" },
      accelerate: { kicker: "余量", value: "充足" },
      normal: { kicker: "节奏", value: "正常" },
      recentFast: { kicker: "近期", value: "偏快" },
      coolingDown: { kicker: "继续", value: "放缓" },
      slow: { kicker: "建议", value: "减速" },
      critical: { kicker: "接近", value: "耗尽" },
      unknown: { kicker: "状态", value: "未知" }
    },
    en: {
      urgent: { kicker: "Use", value: "Soon" },
      accelerate: { kicker: "Use", value: "Fast" },
      normal: { kicker: "Status", value: "OK" },
      recentFast: { kicker: "Recent", value: "Fast" },
      coolingDown: { kicker: "Keep", value: "Slow" },
      slow: { kicker: "Use", value: "Less" },
      critical: { kicker: "Risk", value: "Pause" },
      unknown: { kicker: "Status", value: "?" }
    }
  };
  return (labels[state.lang] || labels.zh)[statusKey];
}

function renderCompactPaceSignal(overall) {
  const status = knownPaceStatus(overall?.status) ? overall.status : "unknown";
  const label = t(`status.${status}`);
  els.compactPaceSignal.className = `compact-pace-signal ${status}`;
  setAttr(els.compactPaceSignal, "title", label);
  setAttr(els.compactPaceSignal, "aria-label", label);
}

function knownPaceStatus(status) {
  return ["urgent", "accelerate", "normal", "recentFast", "coolingDown", "slow", "critical", "unknown"].includes(status);
}

function renderSignalSettings(settings) {
  state.signalSettings = normalizeSignalSettings(settings);
  document.documentElement.style.setProperty("--signal-recent-fast-cycle", `${state.signalSettings.recentFastBreathMs}ms`);
  document.documentElement.style.setProperty("--signal-critical-cycle", `${state.signalSettings.criticalBlinkMs}ms`);
}

function normalizeSignalSettings(settings) {
  return {
    recentFastBreathMs: clampSignalMs(settings?.recentFastBreathMs, 4000),
    criticalBlinkMs: clampSignalMs(settings?.criticalBlinkMs, 3000)
  };
}

function clampSignalMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(20000, Math.max(1000, Math.round(number)));
}

function setCompactTrack(
  fillElement,
  idealElement,
  idealTextElement,
  velocityElement,
  velocityTextElement,
  actualValue,
  idealValue,
  velocityValue
) {
  const actual = clampPercentValue(actualValue);
  const ideal = clampPercentValue(idealValue);
  const velocity = clampPercentValue(velocityValue);
  const track = fillElement.parentElement;

  fillElement.style.width = actual === null ? "0%" : `${actual}%`;
  fillElement.hidden = actual === null;

  idealElement.hidden = ideal === null;
  idealTextElement.hidden = ideal === null;
  velocityElement.hidden = velocity === null;
  velocityTextElement.hidden = velocity === null;
  track.dataset.referenceMode = "separate";

  if (ideal === null) {
    idealElement.style.left = "0%";
    idealTextElement.style.left = "0%";
    setText(idealTextElement, "--");
  } else {
    const idealPosition = `${ideal}%`;
    idealElement.style.left = markerPosition(ideal);
    idealTextElement.style.left = `clamp(20px, ${idealPosition}, calc(100% - 20px))`;
    setText(idealTextElement, compactReferenceText("ideal", ideal));
  }

  if (velocity === null) {
    velocityElement.style.left = "0%";
    velocityTextElement.style.left = "0%";
    setText(velocityTextElement, "--");
  } else {
    const velocityPosition = `${velocity}%`;
    velocityElement.style.left = markerPosition(velocity);
    velocityTextElement.style.left = `clamp(20px, ${velocityPosition}, calc(100% - 20px))`;
    setText(velocityTextElement, compactReferenceText("velocity", velocity));
  }

  resolveCompactReferenceOverlap(track, idealTextElement, velocityTextElement);
  const title =
    ideal !== null && velocity !== null
      ? `${t("idealRemaining")} ${percentText(ideal)} / ${t("velocityRemaining")} ${percentText(velocity)}`
      : ideal !== null
        ? `${t("idealRemaining")} ${percentText(ideal)}`
        : velocity !== null
          ? `${t("velocityRemaining")} ${percentText(velocity)}`
          : "";
  setAttr(idealTextElement, "title", title);
  setAttr(velocityTextElement, "title", title);
}

function compactReferenceText(type, value) {
  return percentText(value);
}

function markerPosition(value) {
  return `clamp(2px, ${value}%, calc(100% - 2px))`;
}

function resolveCompactReferenceOverlap(track, idealTextElement, velocityTextElement) {
  idealTextElement.classList.remove("merged");
  if (idealTextElement.hidden || velocityTextElement.hidden) return;

  const idealRect = idealTextElement.getBoundingClientRect();
  const velocityRect = velocityTextElement.getBoundingClientRect();
  const overlaps = idealRect.left <= velocityRect.right && velocityRect.left <= idealRect.right;
  if (!overlaps) return;

  velocityTextElement.hidden = true;
  track.dataset.referenceMode = "idealOnly";
}

function renderCompactMetric({ fill, ideal, idealText, velocity, velocityText, percentTextElement, deltaTextElement }, window) {
  setCompactTrack(
    fill,
    ideal,
    idealText,
    velocity,
    velocityText,
    window?.remainingPercent,
    window?.idealRemainingPercent,
    window?.velocity?.requiredRemainingPercent
  );
  setText(percentTextElement, percentText(window?.remainingPercent));
  if (isTaskbarMode()) {
    setText(deltaTextElement, resetCountdownText(window?.resetsAt));
    deltaTextElement.className = "compact-delta neutral";
  } else {
    setText(deltaTextElement, signedDeltaText(window?.paceDelta));
    deltaTextElement.className = compactDeltaClass(window?.paceDelta);
  }
}

function resetCountdownText(resetsAt) {
  if (!resetsAt) return "--";
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "0h";
  const hours = ms / 3600000;
  if (hours >= 48) return `${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `${Math.floor(hours)}h`;
  return `${Math.max(1, Math.floor(ms / 60000))}m`;
}

function renderCompactHud(codex, devin) {
  const weekly = { ...codex?.paceAdvice?.longWindow, remainingPercent: codex?.secondary?.remainingPercent };
  const devinWeekly = { ...devin?.paceAdvice?.longWindow, remainingPercent: devin?.secondary?.remainingPercent };

  renderCompactMetric(
    {
      fill: els.compactWeeklyFill,
      ideal: els.compactWeeklyIdeal,
      idealText: els.compactWeeklyIdealText,
      velocity: els.compactWeeklyVelocity,
      velocityText: els.compactWeeklyVelocityText,
      percentTextElement: els.compactWeeklyText,
      deltaTextElement: els.compactWeeklyDelta
    },
    weekly
  );
  renderCompactMetric(
    {
      fill: els.compactShortFill,
      ideal: els.compactShortIdeal,
      idealText: els.compactShortIdealText,
      velocity: els.compactShortVelocity,
      velocityText: els.compactShortVelocityText,
      percentTextElement: els.compactShortText,
      deltaTextElement: els.compactShortDelta
    },
    devinWeekly
  );
  setText(els.compactWeeklyResetText, compactResetDetail(codex?.secondary));
  setText(els.compactShortResetText, compactResetDetail(devin?.secondary));
}

function renderLoading() {
  renderQuotaState({ status: "loading", providers: {}, refreshing: true });
}

function renderError(error) {
  renderQuotaState({ ...state.snapshot, refreshing: false, error });
}

function renderQuotaState(snapshot) {
  state.snapshot = snapshot;
  state.error = snapshot?.error || null;
  state.loading = Boolean(snapshot?.refreshing);
  const providers = snapshot?.providers || {};
  renderQuota(providers);
  const notes = Object.entries({ codex: "Codex", devin: "Devin" }).map(([name, label]) => {
    const provider = providers[name];
    if (provider?.status === "error") return `${label} ${t("unavailable")}: ${friendlyErrorMessage(provider.error)}`;
    if (provider?.fromCache) return `${label} ${t("cached")}`;
    return `${label} ${provider?.status === "ready" ? t("ready") : t("loading")}`;
  });
  if (state.error) notes.push(`${t("statusError")}: ${friendlyErrorMessage(state.error)}`);
  if (state.loading) notes.unshift(t("statusLoading"));
  setText(els.statusText, notes.join(" · "));
  setAttr(els.statusText, "title", notes.join(" · "));
  setAttr(els.compactHud, "title", notes.join(" · "));
  const status = snapshot?.status;
  setText(els.stateText, state.loading ? t("loading") : t(status === "partial" ? "partial" : status === "ready" ? "ready" : status === "error" || state.error ? "error" : "loading"));
  if (status === "partial" || status === "error" || state.error) {
    els.statusDot.className = `status-dot ${status === "error" ? "danger" : "warning"}`;
  }
}

function friendlyErrorMessage(error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("authentication required")) {
    return t("authRequired");
  }
  return message || t("unknown");
}

async function refreshQuota() {
  if (state.loading) return;
  renderQuotaState({ ...state.snapshot, refreshing: true });
  try {
    renderQuotaState(await window.codexQuota.refreshQuota());
  } catch (error) {
    renderError(error);
  } finally {
    state.loading = false;
  }
}

async function syncAlwaysOnTop() {
  const isPinned = await window.codexQuota.getAlwaysOnTop();
  renderPin(isPinned);
}

async function syncCompactMode() {
  const isCompact = await window.codexQuota.getCompactMode();
  renderCompactMode(isCompact);
}

async function syncCompactScale() {
  const compactScale = await window.codexQuota.getCompactScale();
  renderCompactScale(compactScale);
}

async function syncCompactDisplayMode() {
  const compactDisplayMode = await window.codexQuota.getCompactDisplayMode();
  renderCompactDisplayMode(compactDisplayMode);
}

function renderPin(isPinned) {
  els.pinBtn.classList.toggle("active", Boolean(isPinned));
  const label = isPinned ? t("unpin") : t("pin");
  setAttr(els.pinBtn, "title", label);
  setAttr(els.pinBtn, "aria-label", label);
}

function renderCompactMode(isCompact) {
  state.compact = Boolean(isCompact);
  els.body.dataset.view = state.compact ? "compact" : "full";
  renderCompactButton(state.compact);
  if (!state.compact) renderCompactExpanded(false);
  updateCompactMousePassthrough();
}

function normalizeCompactDisplayMode(value) {
  return COMPACT_DISPLAY_MODES.has(value) ? value : "hud";
}

function isTopStripMode() {
  return state.compactDisplayMode === "topStrip";
}

function isTaskbarMode() {
  return state.compactDisplayMode === "taskbar";
}

function updateCompactMetricLabels() {
  const verbose = isTaskbarMode();
  setText(els.compactWeeklyLabel, verbose ? "Codex" : "C7d");
  setText(els.compactShortLabel, verbose ? "Devin" : "D7d");
}

function renderCompactDisplayMode(value) {
  state.compactDisplayMode = normalizeCompactDisplayMode(value);
  els.body.dataset.compactDisplay = state.compactDisplayMode;
  updateCompactMetricLabels();
  renderCompactExpanded(false);
  if (!isTopStripMode()) {
    setCompactMousePassthrough(false);
  } else {
    updateCompactMousePassthrough();
  }
}

function clampCompactScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(COMPACT_SCALE_LIMITS.max, Math.max(COMPACT_SCALE_LIMITS.min, scale));
}

function snapCompactScale(value) {
  const scale = clampCompactScale(value);
  if (Math.abs(scale - COMPACT_DEFAULT_SCALE) <= COMPACT_DEFAULT_SCALE_SNAP_DISTANCE) {
    return COMPACT_DEFAULT_SCALE;
  }
  return scale;
}

function renderCompactScale(value) {
  state.compactScale = clampCompactScale(value);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--compact-scale", String(state.compactScale));
  rootStyle.setProperty(
    "--compact-ideal-font-size",
    `${compensatedFontSize(state.compactScale, { min: 8.5, base: 8.5, max: 11.5 })}px`
  );
  rootStyle.setProperty(
    "--compact-advice-font-size",
    `${compensatedFontSize(state.compactScale, { min: 10, base: 10.5, max: 13 })}px`
  );
  rootStyle.setProperty(
    "--compact-detail-font-size",
    `${compensatedFontSize(state.compactScale, { min: 10, base: 10.5, max: 13 })}px`
  );
  rootStyle.setProperty(
    "--compact-detail-label-font-size",
    `${compensatedFontSize(state.compactScale, { min: 10.5, base: 11, max: 13.5 })}px`
  );
  rootStyle.setProperty(
    "--compact-detail-line-height",
    `${compensatedFontSize(state.compactScale, { min: 12, base: 12.5, max: 16 })}px`
  );
}

function compensatedFontSize(scale, { min, base, max }) {
  const safeScale = clampCompactScale(scale);
  const visualSize = Math.min(max, Math.max(min, base * Math.sqrt(safeScale / COMPACT_DEFAULT_SCALE)));
  return visualSize / safeScale;
}

function normalizeCompactTheme(value) {
  return COMPACT_THEMES.has(value) ? value : "glass";
}

function loadCompactTheme() {
  return normalizeCompactTheme(window.localStorage.getItem(COMPACT_THEME_STORAGE_KEY));
}

function renderCompactTheme(value, options = {}) {
  const theme = normalizeCompactTheme(value);
  state.compactTheme = theme;
  els.body.dataset.compactTheme = theme;
  setText(els.compactThemeBtn, theme === "glass" ? "岛" : "玻");
  if (options.persist !== false) {
    window.localStorage.setItem(COMPACT_THEME_STORAGE_KEY, theme);
  }
}

function toggleCompactTheme() {
  renderCompactTheme(state.compactTheme === "glass" ? "island" : "glass");
}

function reportInteractionError(error) {
  console.error("Codex Quota Widget interaction failed:", error);
}

function setCompactMousePassthrough(enabled) {
  window.codexQuota.setCompactMousePassthrough(Boolean(enabled)).catch(reportInteractionError);
}

function updateCompactMousePassthrough() {
  const passthrough =
    state.compact &&
    isTopStripMode() &&
    !state.moving &&
    !state.resizing &&
    !state.compactExpanded;
  setCompactMousePassthrough(passthrough);
}

function renderCompactButton(isCompact) {
  const label = isCompact ? t("expand") : t("compact");
  els.compactBtn.classList.toggle("active", Boolean(isCompact));
  setAttr(els.compactBtn, "title", label);
  setAttr(els.compactBtn, "aria-label", label);
}

function startCompactResize(event) {
  if (!state.compact || isTopStripMode() || isTaskbarMode()) return;
  event.preventDefault();
  event.stopPropagation();
  state.resizing = {
    startX: event.screenX,
    startY: event.screenY,
    startScale: state.compactScale,
    pendingScale: state.compactScale
  };
  els.body.classList.add("is-resizing");
  syncCompactHoverProbe();
  window.addEventListener("mousemove", handleCompactResize);
  window.addEventListener("mouseup", stopCompactResize, { once: true });
}

function handleCompactResize(event) {
  if (!state.resizing) return;
  event.preventDefault();
  const deltaX = event.screenX - state.resizing.startX;
  const deltaY = event.screenY - state.resizing.startY;
  const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const nextScale = snapCompactScale(state.resizing.startScale + dominantDelta / 210);
  renderCompactScale(nextScale);
  scheduleCompactScaleCommit(nextScale);
}

function scheduleCompactScaleCommit(scale) {
  if (!state.resizing) return;
  state.resizing.pendingScale = scale;
  if (state.resizeFrame) return;

  state.resizeFrame = window.requestAnimationFrame(() => {
    state.resizeFrame = null;
    const pendingScale = state.resizing?.pendingScale;
    if (!Number.isFinite(Number(pendingScale))) return;
    window.codexQuota.setCompactScale(pendingScale).catch(reportInteractionError);
  });
}

function stopCompactResize() {
  if (!state.resizing) return;
  window.removeEventListener("mousemove", handleCompactResize);
  if (state.resizeFrame) {
    window.cancelAnimationFrame(state.resizeFrame);
    state.resizeFrame = null;
  }
  els.body.classList.remove("is-resizing");
  state.resizing = null;
  window.codexQuota.setCompactScale(state.compactScale).then(renderCompactScale).catch(reportInteractionError);
  syncCompactHoverProbe();
  updateCompactMousePassthrough();
}

function renderCompactExpanded(expanded) {
  state.compactExpanded = Boolean(expanded) && !isTaskbarMode();
  els.body.dataset.compactExpanded = state.compactExpanded ? "true" : "false";
  syncCompactHoverProbe();
}

function setCompactExpanded(expanded) {
  const nextExpanded = Boolean(expanded) && state.compact && !isTaskbarMode();
  if (state.compactExpanded === nextExpanded) return;
  renderCompactExpanded(nextExpanded);
  if (nextExpanded) setCompactMousePassthrough(false);
  window.codexQuota
    .setCompactExpanded(nextExpanded)
    .then(() => {
      if (!nextExpanded) updateCompactMousePassthrough();
    })
    .catch(reportInteractionError);
}

function handleCompactPointerMove(event) {
  if (!state.compact || state.moving || state.resizing) return;
  setCompactExpanded(isInsideCompactVisibleSurface(event));
}

function syncCompactHoverProbe() {
  if (state.hoverProbeTimer && (!state.compactExpanded || state.moving || state.resizing)) {
    window.clearInterval(state.hoverProbeTimer);
    state.hoverProbeTimer = null;
  }
  if (!state.compactExpanded || state.moving || state.resizing || state.hoverProbeTimer) return;
  state.hoverProbeTimer = window.setInterval(probeCompactHoverState, COMPACT_HOVER_PROBE_MS);
}

async function probeCompactHoverState() {
  if (!state.compactExpanded || state.moving || state.resizing) {
    syncCompactHoverProbe();
    return;
  }
  if (state.hoverProbeInFlight) return;
  state.hoverProbeInFlight = true;
  try {
    const cursorState = await window.codexQuota.getCursorState();
    const pointerEvent = pointerEventFromCursorState(cursorState);
    if (!pointerEvent || !isInsideCompactVisibleSurface(pointerEvent)) {
      setCompactExpanded(false);
    }
  } catch (error) {
    reportInteractionError(error);
  } finally {
    state.hoverProbeInFlight = false;
  }
}

function pointerEventFromCursorState(cursorState) {
  const cursor = cursorState?.cursor;
  const bounds = cursorState?.windowBounds;
  if (!cursor || !bounds) return null;
  return {
    clientX: cursor.x - bounds.x,
    clientY: cursor.y - bounds.y
  };
}

function startCompactMove(event) {
  if (!state.compact || event.button !== 0) return;
  if (!isInsideCompactDragArea(event)) return;
  event.preventDefault();
  event.stopPropagation();
  setCompactMousePassthrough(false);
  state.moving = {
    lastX: event.screenX,
    lastY: event.screenY,
    pendingDeltaX: 0,
    pendingDeltaY: 0,
    movePromise: Promise.resolve()
  };
  els.body.classList.add("is-moving");
  syncCompactHoverProbe();
  window.addEventListener("mousemove", handleCompactMove);
  window.addEventListener("mouseup", stopCompactMove, { once: true });
}

function isInsideCompactDragArea(event) {
  if (isTopStripMode() || isTaskbarMode()) return isInsideCompactVisibleSurface(event);
  return isInsideCompactHudCapsule(event);
}

function isInsideCompactVisibleSurface(event) {
  if (isTopStripMode() || isTaskbarMode()) {
    return isInsideElementRect(event, els.compactHud);
  }
  if (isInsideCompactHudCapsule(event)) return true;
  if (!state.compactExpanded) return false;
  return [els.compactControls, els.compactAdviceText, els.compactResetInfo, els.compactResizeHandle].some((element) =>
    isInsideElementRect(event, element)
  );
}

function isInsideElementRect(event, element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function isInsideCompactHudCapsule(event) {
  const rect = els.compactHud.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return false;

  const radius = rect.height / 2;
  if (x < radius) {
    return Math.hypot(x - radius, y - radius) <= radius;
  }
  if (x > rect.width - radius) {
    return Math.hypot(x - (rect.width - radius), y - radius) <= radius;
  }
  return true;
}

function handleCompactMove(event) {
  if (!state.moving) return;
  event.preventDefault();
  const deltaX = event.screenX - state.moving.lastX;
  const deltaY = event.screenY - state.moving.lastY;
  state.moving.lastX = event.screenX;
  state.moving.lastY = event.screenY;
  state.moving.pendingDeltaX += deltaX;
  state.moving.pendingDeltaY += deltaY;
  scheduleCompactMove();
}

function scheduleCompactMove() {
  if (!state.moving || state.moveFrame) return;

  state.moveFrame = window.requestAnimationFrame(() => {
    state.moveFrame = null;
    if (!state.moving) return;
    flushCompactMove();
  });
}

function flushCompactMove() {
  if (!state.moving) return;
  const moving = state.moving;
  const deltaX = state.moving.pendingDeltaX;
  const deltaY = state.moving.pendingDeltaY;
  state.moving.pendingDeltaX = 0;
  state.moving.pendingDeltaY = 0;
  if (deltaX === 0 && deltaY === 0) return moving.movePromise;

  const request = moving.movePromise
    .catch(() => undefined)
    .then(() => window.codexQuota.moveCompactWindow(deltaX, deltaY));
  moving.movePromise = request.catch(reportInteractionError);
  return moving.movePromise;
}

function stopCompactMove() {
  if (!state.moving) return;
  const moving = state.moving;
  window.removeEventListener("mousemove", handleCompactMove);
  if (state.moveFrame) {
    window.cancelAnimationFrame(state.moveFrame);
    state.moveFrame = null;
  }
  const finishMove = flushCompactMove() || moving.movePromise;
  els.body.classList.remove("is-moving");
  state.moving = null;
  syncCompactHoverProbe();
  finishMove
    .then(() => window.codexQuota.snapCompactWindow())
    .then((snapResult) => {
      renderCompactDisplayMode(snapResult?.displayMode);
      updateCompactMousePassthrough();
    })
    .catch(reportInteractionError);
}

els.langBtn.addEventListener("click", () => {
  state.lang = state.lang === "zh" ? "en" : "zh";
  renderQuotaState(state.snapshot);
  syncAlwaysOnTop();
});

els.compactBtn.addEventListener("click", async () => {
  const isCompact = await window.codexQuota.setCompactMode(!state.compact);
  renderCompactMode(isCompact);
});

els.compactExpandBtn.addEventListener("click", async () => {
  const isCompact = await window.codexQuota.setCompactMode(false);
  renderCompactMode(isCompact);
});

els.compactCloseBtn.addEventListener("click", () => window.codexQuota.minimize());
els.compactThemeBtn.addEventListener("click", toggleCompactTheme);
window.addEventListener("mousemove", handleCompactPointerMove);
window.addEventListener("mouseout", (event) => {
  if (!event.relatedTarget) setCompactExpanded(false);
});
els.compactHud.addEventListener("mousedown", startCompactMove);
els.compactResizeHandle.addEventListener("mousedown", startCompactResize);

els.refreshBtn.addEventListener("click", refreshQuota);
els.minimizeBtn.addEventListener("click", () => window.codexQuota.minimize());
els.closeBtn.addEventListener("click", () => window.codexQuota.close());
els.pinBtn.addEventListener("click", async () => {
  const next = !els.pinBtn.classList.contains("active");
  const isPinned = await window.codexQuota.setAlwaysOnTop(next);
  renderPin(isPinned);
});

renderCompactTheme(loadCompactTheme(), { persist: false });
renderSignalSettings(state.signalSettings);

window.codexQuota.onQuotaChanged(renderQuotaState);
window.codexQuota.onAlwaysOnTopChanged(renderPin);
window.codexQuota.onCompactChanged(renderCompactMode);
window.codexQuota.onCompactScaleChanged((value) => {
  if (state.resizing) return;
  renderCompactScale(value);
});
window.codexQuota.onCompactDisplayModeChanged(renderCompactDisplayMode);
window.codexQuota.onSignalSettingsChanged(renderSignalSettings);

renderLoading();
syncAlwaysOnTop();
syncCompactMode();
syncCompactDisplayMode();
syncCompactScale();
window.codexQuota.getSignalSettings().then(renderSignalSettings).catch(reportInteractionError);
window.codexQuota.getQuotaState().then(renderQuotaState).catch(renderError);
