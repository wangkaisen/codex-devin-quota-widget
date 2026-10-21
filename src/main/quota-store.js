const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getQuota } = require("./quota-service");
const { getDevinQuota } = require("./devin-service");
const { buildPaceAdvice } = require("./pace-advice");

const CACHE_FILE_NAME = "quota-cache.json";
const HISTORY_FILE_NAME = "quota-history.json";
const CACHE_VERSION = 2;
const HISTORY_VERSION = 2;
const PROVIDERS = ["codex", "devin"];
const HISTORY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const HISTORY_MAX_SAMPLES = 4096;
const VISIBLE_REFRESH_INTERVAL_MS = 3 * 60 * 1000;
const HIDDEN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const ERROR_RETRY_BASE_MS = 60 * 1000;
const ERROR_RETRY_MAX_MS = 5 * 60 * 1000;

class QuotaStore extends EventEmitter {
  constructor({
    userDataPath,
    readQuota = getQuota,
    readDevinQuota = (_reason, options) => getDevinQuota(options),
    visibleRefreshIntervalMs = VISIBLE_REFRESH_INTERVAL_MS,
    hiddenRefreshIntervalMs = HIDDEN_REFRESH_INTERVAL_MS,
    errorRetryBaseMs = ERROR_RETRY_BASE_MS,
    errorRetryMaxMs = ERROR_RETRY_MAX_MS,
    autoSchedule = true
  }) {
    super();
    if (!userDataPath) throw new Error("QuotaStore requires a userDataPath.");

    this.cachePath = path.join(userDataPath, CACHE_FILE_NAME);
    this.historyPath = path.join(userDataPath, HISTORY_FILE_NAME);
    this.readers = { codex: readQuota, devin: readDevinQuota };
    this.visibleRefreshIntervalMs = visibleRefreshIntervalMs;
    this.hiddenRefreshIntervalMs = hiddenRefreshIntervalMs;
    this.errorRetryBaseMs = errorRetryBaseMs;
    this.errorRetryMaxMs = errorRetryMaxMs;
    this.autoSchedule = autoSchedule;
    this.windowVisible = true;
    this.failureCount = 0;
    this.history = { codex: [], devin: [] };
    this.inFlight = null;
    this.requestController = null;
    this.generation = 0;
    this.timer = null;
    this.state = {
      providers: Object.fromEntries(PROVIDERS.map((name) => [name, {
        status: "loading", quota: null, error: null, fromCache: false, lastUpdatedAt: null
      }])),
      status: "loading",
      error: null,
      refreshing: false,
      nextRefreshAt: null
    };
  }

  async loadCache() {
    const generation = this.generation;
    await this.loadHistory();
    try {
      const cache = JSON.parse(await fs.readFile(this.cachePath, "utf8"));
      if (generation !== this.generation) return this.getState();
      const entries = cache?.version === CACHE_VERSION ? cache.providers
        : cache?.version === 1 ? { [cache.provider || "codex"]: cache } : {};
      for (const name of PROVIDERS) {
        const entry = entries?.[name];
        if (!entry?.quota) continue;
        this.recordHistory(name, entry.quota);
        this.state.providers[name] = {
          status: "ready",
          quota: this.withCurrentPaceAdvice(name, entry.quota, entry.quota.fetchedAt || entry.savedAt),
          error: null,
          fromCache: true,
          lastUpdatedAt: entry.quota.fetchedAt || entry.savedAt
        };
      }
      this.state.status = this.aggregateStatus();
      this.emitState();
    } catch (error) {
      if (generation !== this.generation) return this.getState();
      if (error?.code !== "ENOENT") this.state.error = serializeError(error);
    }
    return this.getState();
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  aggregateStatus() {
    const statuses = PROVIDERS.map((name) => this.state.providers[name].status);
    if (statuses.every((status) => status === "ready")) return "ready";
    if (statuses.some((status) => status === "ready")) return "partial";
    return statuses.some((status) => status === "error") ? "error" : "loading";
  }

  setWindowVisible(value) {
    this.windowVisible = Boolean(value);
    this.scheduleNextRefresh();
    return this.getState();
  }

  setVisibleRefreshIntervalMs(value) {
    const intervalMs = Number(value);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("Visible refresh interval must be a positive number.");
    }
    this.visibleRefreshIntervalMs = intervalMs;
    this.scheduleNextRefresh();
    return this.getState();
  }

  refreshNow(reason = "manual") {
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    this.state = { ...this.state, error: null, refreshing: true, nextRefreshAt: null };
    this.emitState();
    this.requestController = new AbortController();
    const request = this.runRefresh(reason, this.generation, this.requestController.signal).finally(() => {
      if (this.inFlight === request) this.inFlight = null;
    });
    this.inFlight = request;
    return request;
  }

  destroy() {
    this.generation += 1;
    this.requestController?.abort();
    this.clearTimer();
    this.removeAllListeners();
  }

  async runRefresh(reason, generation, signal) {
    const results = await Promise.allSettled(PROVIDERS.map(async (name) => {
      const rawQuota = await this.readers[name](reason, { signal });
      if (generation !== this.generation) return null;
      this.recordHistory(name, rawQuota);
      return this.withCurrentPaceAdvice(name, rawQuota, rawQuota.fetchedAt);
    }));
    if (generation !== this.generation) return this.getState();

    results.forEach((result, index) => {
      const name = PROVIDERS[index];
      this.state.providers[name] = result.status === "fulfilled" ? {
        status: "ready", quota: result.value, error: null, fromCache: false,
        lastUpdatedAt: result.value.fetchedAt || new Date().toISOString()
      } : {
        ...this.state.providers[name], status: "error", error: serializeError(result.reason)
      };
    });
    this.failureCount = results.some((result) => result.status === "rejected") ? this.failureCount + 1 : 0;
    this.state.status = this.aggregateStatus();
    this.state.refreshing = false;
    try {
      if (results.some((result) => result.status === "fulfilled")) {
        await this.saveCache();
        await this.saveHistory();
      }
    } catch (error) {
      if (generation !== this.generation) return this.getState();
      this.state.error = serializeError(error);
    }
    if (generation !== this.generation) return this.getState();
    this.emitState();
    this.scheduleNextRefresh();
    return this.getState();
  }

  async saveCache() {
    const payload = {
      version: CACHE_VERSION,
      providers: Object.fromEntries(PROVIDERS.map((name) => [name, {
        quota: this.state.providers[name].quota,
        savedAt: this.state.providers[name].lastUpdatedAt
      }]))
    };
    const tempPath = `${this.cachePath}.tmp`;
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.cachePath);
  }

  async loadHistory() {
    const generation = this.generation;
    try {
      const payload = JSON.parse(await fs.readFile(this.historyPath, "utf8"));
      if (generation !== this.generation) return this.history;
      const entries = payload?.version === HISTORY_VERSION ? payload.providers
        : payload?.version === 1 ? { [payload.provider || "codex"]: payload.samples } : {};
      for (const name of PROVIDERS) this.history[name] = normalizeHistory(entries?.[name]);
    } catch (error) {
      if (generation !== this.generation) return this.history;
      if (error?.code !== "ENOENT") this.history = { codex: [], devin: [] };
    }
    for (const name of PROVIDERS) this.history[name] = pruneHistory(this.history[name], Date.now());
    return this.history;
  }

  async saveHistory() {
    const payload = { version: HISTORY_VERSION, providers: this.history };
    const tempPath = `${this.historyPath}.tmp`;
    await fs.mkdir(path.dirname(this.historyPath), { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.historyPath);
  }

  recordHistory(name, quota) {
    const sample = quotaHistorySample(quota);
    if (!sample) return this.history[name];
    const history = this.history[name].filter((entry) => entry.fetchedAt !== sample.fetchedAt);
    history.push(sample);
    this.history[name] = pruneHistory(normalizeHistory(history), Date.parse(sample.fetchedAt));
    return this.history[name];
  }

  withCurrentPaceAdvice(name, quota, now = new Date().toISOString()) {
    return { ...quota, paceAdvice: buildPaceAdvice(quota, now || quota.fetchedAt, this.history[name]) };
  }

  scheduleNextRefresh(delayMs) {
    if (!this.autoSchedule) return;
    this.clearTimer();
    const intervalMs = Number.isFinite(delayMs)
      ? Math.max(0, delayMs)
      : this.windowVisible
        ? (this.failureCount ? this.retryDelayMs() : this.visibleRefreshIntervalMs)
        : this.hiddenRefreshIntervalMs;
    this.state.nextRefreshAt = new Date(Date.now() + intervalMs).toISOString();
    this.timer = setTimeout(() => { this.refreshNow("scheduled").catch(() => {}); }, intervalMs);
    this.emitState();
  }

  retryDelayMs() {
    const multiplier = Math.max(1, 2 ** Math.max(0, this.failureCount - 1));
    return Math.min(this.errorRetryMaxMs, this.errorRetryBaseMs * multiplier);
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  emitState() {
    this.emit("state", this.getState());
  }
}

function quotaHistorySample(quota) {
  const fetchedAt = quota?.fetchedAt || new Date().toISOString();
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return null;

  return {
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    primary: quotaWindowHistorySample(quota?.primary),
    secondary: quotaWindowHistorySample(quota?.secondary)
  };
}

function quotaWindowHistorySample(window) {
  if (!window) return null;
  const remainingPercent = Number(window.remainingPercent);
  return {
    remainingPercent: Number.isFinite(remainingPercent) ? Math.max(0, Math.min(100, remainingPercent)) : null,
    windowDurationMins: Number.isFinite(Number(window.windowDurationMins)) ? Number(window.windowDurationMins) : null,
    resetsAt: window.resetsAt || null
  };
}

function normalizeHistory(samples) {
  if (!Array.isArray(samples)) return [];
  return samples
    .map((sample) => {
      const fetchedAtMs = Date.parse(sample?.fetchedAt || "");
      if (!Number.isFinite(fetchedAtMs)) return null;
      return {
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        primary: normalizeHistoryWindow(sample?.primary),
        secondary: normalizeHistoryWindow(sample?.secondary)
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
}

function normalizeHistoryWindow(window) {
  if (!window) return null;
  const remainingPercent = Number(window.remainingPercent);
  return {
    remainingPercent: Number.isFinite(remainingPercent) ? Math.max(0, Math.min(100, remainingPercent)) : null,
    windowDurationMins: Number.isFinite(Number(window.windowDurationMins)) ? Number(window.windowDurationMins) : null,
    resetsAt: window.resetsAt || null
  };
}

function pruneHistory(history, nowMs) {
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  return history
    .filter((sample) => {
      const fetchedAtMs = Date.parse(sample.fetchedAt || "");
      return Number.isFinite(fetchedAtMs) && safeNowMs - fetchedAtMs <= HISTORY_MAX_AGE_MS;
    })
    .slice(-HISTORY_MAX_SAMPLES);
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error)
  };
}

module.exports = {
  QuotaStore,
  HISTORY_MAX_AGE_MS,
  HISTORY_MAX_SAMPLES,
  VISIBLE_REFRESH_INTERVAL_MS,
  HIDDEN_REFRESH_INTERVAL_MS,
  ERROR_RETRY_BASE_MS,
  ERROR_RETRY_MAX_MS
};
