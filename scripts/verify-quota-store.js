const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { QuotaStore } = require("../src/main/quota-store");

function quota(remainingPercent, fetchedAt = "2026-06-10T00:00:00.000Z") {
  return {
    limitId: "codex",
    limitName: "Codex",
    planType: "test",
    reachedType: null,
    credits: null,
    primary: {
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      windowDurationMins: 300,
      resetsAt: "2026-06-10T05:00:00.000Z"
    },
    secondary: {
      usedPercent: 100 - remainingPercent,
      remainingPercent,
      windowDurationMins: 10080,
      resetsAt: "2026-06-17T00:00:00.000Z"
    },
    remainingPercent,
    usedPercent: 100 - remainingPercent,
    resetsAt: "2026-06-10T05:00:00.000Z",
    fetchedAt,
    paceAdvice: {
      longWindow: null,
      shortWindow: null,
      overall: { status: "unknown", severity: "muted", reasonCode: "test", source: "test" },
      thresholds: { paceDelta: 15, criticalRemainingPercent: 5 }
    }
  };
}

async function withTempDir(callback) {
  const root = path.join(__dirname, "../artifacts/tests");
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "quota-store-"));
  try {
    await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function verifyCacheLoad() {
  for (const provider of [undefined, "codex", "devin"]) {
    await withTempDir(async (dir) => {
      const name = provider || "codex";
      const cachedQuota = { ...quota(42), limitId: name };
      await fs.writeFile(
        path.join(dir, "quota-cache.json"),
        `${JSON.stringify({ version: 1, provider, savedAt: "2026-06-10T00:01:00.000Z", quota: cachedQuota })}\n`,
        "utf8"
      );
      const store = new QuotaStore({ userDataPath: dir, autoSchedule: false });
      await store.loadCache();
      const state = store.getState();
      assert.equal(state.status, "partial");
      assert.equal(state.providers[name].fromCache, true);
      assert.equal(state.providers[name].quota.remainingPercent, 42);
      assert.equal(state.providers[name === "codex" ? "devin" : "codex"].quota, null);
      store.destroy();
    });
  }
}

async function verifyRefreshCoalescing() {
  await withTempDir(async (dir) => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const store = new QuotaStore({
      userDataPath: dir,
      readDevinQuota: async () => quota(90),
      readQuota: async () => {
        calls += 1;
        await gate;
        return quota(77);
      },
      autoSchedule: false
    });

    const first = store.refreshNow("first");
    const second = store.refreshNow("second");
    assert.equal(calls, 1);
    release();
    const states = await Promise.all([first, second]);
    assert.equal(states[0].providers.codex.quota.remainingPercent, 77);
    assert.equal(states[1].providers.codex.quota.remainingPercent, 77);
    assert.equal(store.getState().status, "ready");
    assert.equal(calls, 1);
    await fs.access(path.join(dir, "quota-cache.json"));
    store.destroy();
  });
}

async function verifyFailurePreservesQuota() {
  await withTempDir(async (dir) => {
    const cachedQuota = quota(64);
    await fs.writeFile(
      path.join(dir, "quota-cache.json"),
      `${JSON.stringify({ version: 1, savedAt: "2026-06-10T00:01:00.000Z", quota: cachedQuota })}\n`,
      "utf8"
    );

    const store = new QuotaStore({
      userDataPath: dir,
      readDevinQuota: async () => quota(90),
      readQuota: async () => {
        throw new Error("network unavailable");
      },
      autoSchedule: false
    });
    await store.loadCache();
    const state = await store.refreshNow("failure-case");
    assert.equal(state.status, "partial");
    assert.equal(state.providers.codex.quota.remainingPercent, 64);
    assert.match(state.providers.codex.error.message, /network unavailable/);
    store.destroy();
  });
}

async function verifyHistoryBackedVelocityAdvice() {
  await withTempDir(async (dir) => {
    const samples = [quota(70, "2026-06-10T00:00:00.000Z"), quota(64, "2026-06-10T06:00:00.000Z")];
    const store = new QuotaStore({
      userDataPath: dir,
      readDevinQuota: async () => quota(90),
      readQuota: async () => samples.shift(),
      autoSchedule: false
    });

    const first = await store.refreshNow("first");
    assert.equal(first.providers.codex.quota.paceAdvice.longWindow.velocity.source, "ideal");
    assert.equal(first.providers.codex.quota.paceAdvice.longWindow.velocity.sampleWindowMins, 0);

    const second = await store.refreshNow("second");
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.sampleWindowMins, 360);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.burnRatePercentPerHour, 0.2);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.rawBurnedPercent, 6);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.auxiliaryBurnedPercent, 6);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.smoothedBurnedPercent, 1.1);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.adjustedBurnedPercent, 1.1);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.shortToLongUsageRatio, 0.18);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.shortToLongUsageRatioConfidence, 0.08);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.observedShortToLongUsageRatio, 0.25);
    assert.equal(second.providers.codex.quota.paceAdvice.longWindow.velocity.recentRequiredRemainingPercent, 28.6);
    assert.ok(second.providers.codex.quota.paceAdvice.longWindow.velocity.requiredRemainingPercent < 70);
    assert.ok(second.providers.codex.quota.paceAdvice.longWindow.velocity.requiredRemainingPercent > 50);
    await fs.access(path.join(dir, "quota-history.json"));
    store.destroy();
  });
}

async function verifyVisibleRefreshIntervalCanChange() {
  await withTempDir(async (dir) => {
    const store = new QuotaStore({
      userDataPath: dir,
      readDevinQuota: async () => quota(90),
      readQuota: async () => quota(80),
      visibleRefreshIntervalMs: 10_000,
      autoSchedule: false
    });

    store.setVisibleRefreshIntervalMs(60_000);
    assert.equal(store.visibleRefreshIntervalMs, 60_000);
    assert.throws(() => store.setVisibleRefreshIntervalMs(0), /positive number/);
    store.destroy();
  });
}

async function verifyProviderCacheIsolation() {
  await withTempDir(async (dir) => {
    const fetchedAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const options = {
      userDataPath: dir, autoSchedule: false,
      readQuota: async () => quota(80, fetchedAt),
      readDevinQuota: async () => ({ ...quota(30, fetchedAt), limitId: "devin" })
    };
    const original = new QuotaStore(options);
    await original.refreshNow();
    original.destroy();
    const restored = new QuotaStore({ ...options, readQuota: () => { throw new Error("Codex offline"); } });
    const cached = await restored.loadCache();
    assert.equal(cached.status, "ready");
    for (const name of ["codex", "devin"]) assert.equal(cached.providers[name].fromCache, true);
    assert.equal(cached.providers.codex.quota.secondary.remainingPercent, 80);
    assert.equal(cached.providers.devin.quota.secondary.remainingPercent, 30);
    const partial = await restored.refreshNow();
    assert.equal(partial.status, "partial");
    assert.equal(partial.providers.codex.status, "error");
    assert.equal(partial.providers.devin.status, "ready");
    restored.destroy();
    const restarted = new QuotaStore(options);
    const state = await restarted.loadCache();
    assert.equal(state.providers.codex.quota.secondary.remainingPercent, 80);
    assert.equal(state.providers.codex.lastUpdatedAt, fetchedAt);
    assert.equal(state.providers.devin.quota.secondary.remainingPercent, 30);
    restarted.destroy();
  });
}

async function verifyDestroyedResponses() {
  for (const rejectRequest of [false, true]) {
    await withTempDir(async (dir) => {
      let resolveRequest;
      let reject;
      const signals = [];
      const gate = new Promise((resolve, rejectPromise) => { resolveRequest = resolve; reject = rejectPromise; });
      const reader = (_reason, { signal }) => { signals.push(signal); return gate; };
      const store = new QuotaStore({ userDataPath: dir, autoSchedule: false, readQuota: reader, readDevinQuota: reader });
      const pending = store.refreshNow();
      store.destroy();
      assert.equal(signals.length, 2);
      assert.ok(signals.every((signal) => signal.aborted));
      if (rejectRequest) reject(new Error("late failure"));
      else resolveRequest(quota(2));
      await pending;
      assert.equal(store.getState().providers.codex.quota, null);
      assert.equal(store.getState().providers.devin.quota, null);
      await assert.rejects(fs.access(path.join(dir, "quota-cache.json")), { code: "ENOENT" });
    });
  }
}

async function verifyColdFailureAndRecovery() {
  for (const failing of ["codex", "devin"]) {
    await withTempDir(async (dir) => {
      let fail = true;
      const reader = (name) => async () => {
        if (fail && name === failing) throw new Error(`${name} offline`);
        return quota(name === "codex" ? 81 : 32);
      };
      const store = new QuotaStore({ userDataPath: dir, autoSchedule: false,
        readQuota: reader("codex"), readDevinQuota: reader("devin") });
      const partial = await store.refreshNow();
      assert.equal(partial.status, "partial");
      assert.equal(partial.providers[failing].quota, null);
      assert.equal(partial.providers[failing === "codex" ? "devin" : "codex"].status, "ready");
      fail = false;
      const ready = await store.refreshNow();
      assert.equal(ready.status, "ready");
      assert.equal(ready.providers[failing].error, null);
      store.destroy();
    });
  }
}

async function verifySharedSchedule() {
  await withTempDir(async (dir) => {
    const calls = { codex: 0, devin: 0 };
    const store = new QuotaStore({ userDataPath: dir, visibleRefreshIntervalMs: 20, hiddenRefreshIntervalMs: 60000,
      readQuota: async () => { calls.codex += 1; return quota(80); },
      readDevinQuota: async () => { calls.devin += 1; return quota(30); }
    });
    try {
      await store.refreshNow();
      const deadline = Date.now() + 2000;
      while (calls.codex < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      store.setWindowVisible(false);
      if (store.inFlight) await store.inFlight;
      assert.ok(calls.codex >= 2);
      assert.equal(calls.codex, calls.devin);
      assert.ok(Math.abs(Date.parse(store.getState().nextRefreshAt) - Date.now() - 60000) < 1000);
      store.setVisibleRefreshIntervalMs(120000);
      assert.ok(Math.abs(Date.parse(store.getState().nextRefreshAt) - Date.now() - 60000) < 1000);
      store.setWindowVisible(true);
      assert.ok(Math.abs(Date.parse(store.getState().nextRefreshAt) - Date.now() - 120000) < 1000);
    } finally { store.destroy(); }
  });
}

async function verifyDualRefresh() {
  await withTempDir(async (dir) => {
    const calls = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let failDevin = false;
    const store = new QuotaStore({
      userDataPath: dir, autoSchedule: false,
      readQuota: async (reason) => { calls.push(`codex:${reason}`); await gate; return quota(80); },
      readDevinQuota: async (reason) => {
        calls.push(`devin:${reason}`);
        await gate;
        if (failDevin) throw new Error("Devin unavailable");
        return { ...quota(31), limitId: "devin" };
      }
    });
    const pending = store.refreshNow("both");
    await Promise.resolve();
    assert.deepEqual(calls, ["codex:both", "devin:both"], "Both requests must start before either finishes");
    release();
    const ready = await pending;
    assert.equal(ready.status, "ready");
    assert.equal(ready.providers.codex.quota.secondary.remainingPercent, 80);
    assert.equal(ready.providers.devin.quota.secondary.remainingPercent, 31);
    failDevin = true;
    const partial = await store.refreshNow("partial");
    assert.equal(partial.status, "partial");
    assert.equal(partial.providers.codex.status, "ready");
    assert.equal(partial.providers.codex.quota.secondary.remainingPercent, 80);
    assert.equal(partial.providers.devin.status, "error");
    assert.equal(partial.providers.devin.quota.secondary.remainingPercent, 31, "Keep the last good snapshot for persistence");
    assert.match(partial.providers.devin.error.message, /Devin unavailable/);
    store.destroy();
  });
}

(async () => {
  await verifyDualRefresh();
  await verifyCacheLoad();
  await verifyRefreshCoalescing();
  await verifyFailurePreservesQuota();
  await verifyHistoryBackedVelocityAdvice();
  await verifyVisibleRefreshIntervalCanChange();
  await verifyProviderCacheIsolation();
  await verifyDestroyedResponses();
  await verifyColdFailureAndRecovery();
  await verifySharedSchedule();
  console.log("Verified quota store cache, coalescing, stale-data errors, pace history, dual refresh, isolated failures and caches, recovery, scheduling, and cancellation.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
