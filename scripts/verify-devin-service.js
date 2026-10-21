const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const childProcess = require("node:child_process");
const { mock } = require("node:test");
const path = require("node:path");

async function verifyNormalizedQuota() {
  const calls = [];
  mock.method(fs, "readFile", async (filePath) => {
    assert.equal(filePath, path.join(process.env.APPDATA, "devin", "credentials.toml"));
    return 'windsurf_api_key = "test-only-key"\napi_server_url = "https://untrusted.invalid"\n';
  });
  mock.method(childProcess, "spawn", (_command, args, options) => {
    assert.deepEqual(args, ["version"]);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("devin 3000.10.67 (0b186d6e)\n"));
      child.emit("close", 0);
    });
    return child;
  });
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        planInfo: { planName: "Pro" },
        userStatus: { planStatus: {
          dailyQuotaRemainingPercent: 82.5,
          weeklyQuotaRemainingPercent: 24,
          dailyQuotaResetAtUnix: "1781049600",
          weeklyQuotaResetAtUnix: 1781568000
        } }
      })
    };
  });
  try {
    const { getDevinQuota } = require("../src/main/devin-service");
    const quota = await getDevinQuota();
    assert.equal(quota.limitId, "devin");
    assert.equal(quota.limitName, "Devin");
    assert.equal(quota.planType, "Pro");
    assert.deepEqual(quota.primary, {
      remainingPercent: 82.5, usedPercent: 17.5, windowDurationMins: 1440,
      resetsAt: "2026-06-10T00:00:00.000Z"
    });
    assert.deepEqual(quota.secondary, {
      remainingPercent: 24, usedPercent: 76, windowDurationMins: 10080,
      resetsAt: "2026-06-16T00:00:00.000Z"
    });
    assert.equal(quota.remainingPercent, 24);
    assert.equal(quota.usedPercent, 76);
    assert.equal(quota.resetsAt, "2026-06-16T00:00:00.000Z");
    assert.ok(Number.isFinite(Date.parse(quota.fetchedAt)));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.redirect, "error");
    assert.deepEqual(calls[0].options.headers, {
      "Content-Type": "application/json", "Connect-Protocol-Version": "1"
    });
    assert.deepEqual(JSON.parse(calls[0].options.body), { metadata: {
      apiKey: "test-only-key", ideName: "devin", ideVersion: "3000.10.67",
      extensionVersion: "3000.10.67", locale: "en"
    } });
  } finally {
    mock.restoreAll();
  }
}

async function verifyFailureBoundaries() {
  const { getDevinQuota } = require("../src/main/devin-service");
  const originalAppData = process.env.APPDATA;
  let credentials = 'windsurf_api_key = "test-only-key"';
  let versionMode = "fallback";
  let fetchMode = "ok";
  let spawnCount = 0;
  let fetchCount = 0;
  const status = {
    dailyQuotaRemainingPercent: 0, weeklyQuotaRemainingPercent: 100,
    dailyQuotaResetAtUnix: "1781049600", weeklyQuotaResetAtUnix: "1781568000",
    planInfo: { planName: "Teams" }
  };
  mock.method(fs, "readFile", async (filePath) => {
    const root = process.env.APPDATA || path.join(process.env.USERPROFILE, "AppData", "Roaming");
    assert.equal(filePath, path.join(root, "devin", "credentials.toml"));
    return credentials;
  });
  mock.method(childProcess, "spawn", (command, _args, options) => {
    spawnCount += 1;
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (versionMode === "fallback" && command !== "devin") {
        child.emit("error", new Error("ENOENT"));
      } else {
        child.stderr.emit("data", Buffer.from(versionMode === "invalid" ? "unknown" : "devin 3000.10.67 (test)"));
        child.emit("close", 0);
      }
    });
    return child;
  });
  mock.method(globalThis, "fetch", async (_url, options) => {
    fetchCount += 1;
    assert.equal(options.redirect, "error");
    if (fetchMode === "unsafe-error") throw new Error("Devin authentication required: test-only-key");
    if (fetchMode === "unauthorized") return { ok: false, status: 401 };
    if (fetchMode === "server-error") return { ok: false, status: 500 };
    if (fetchMode === "bad-json") return { ok: true, json: async () => { throw new Error("test-only-key"); } };
    return { ok: true, json: async () => ({ userStatus: { planStatus: status } }) };
  });
  try {
    delete process.env.APPDATA;
    const fallback = await getDevinQuota();
    assert.equal(fallback.planType, "Teams");
    assert.equal(fallback.remainingPercent, 0);
    assert.equal(fallback.usedPercent, 100);
    assert.equal(fallback.resetsAt, "2026-06-10T00:00:00.000Z");
    assert.equal(spawnCount, 2, "A missing installed CLI must fall back to PATH");
    delete status.planInfo;
    assert.equal((await getDevinQuota()).planType, "unknown");

    const beforeInvalidVersion = fetchCount;
    versionMode = "invalid";
    await assert.rejects(getDevinQuota(), /version could not be resolved/);
    assert.equal(fetchCount, beforeInvalidVersion, "Never send an unknown version");
    versionMode = "fallback";
    credentials = "# no API key";
    await assert.rejects(getDevinQuota(), /authentication required/);
    assert.equal(fetchCount, beforeInvalidVersion);
    credentials = 'windsurf_api_key = "test-only-key"';

    for (const mode of ["unauthorized", "server-error", "bad-json", "unsafe-error"]) {
      fetchMode = mode;
      await assert.rejects(getDevinQuota(), (error) => {
        assert.ok(!error.message.includes("test-only-key"), "Errors must never expose credentials");
        return true;
      });
    }
    fetchMode = "ok";
    status.dailyQuotaRemainingPercent = null;
    await assert.rejects(getDevinQuota(), /invalid remaining/);
    status.dailyQuotaRemainingPercent = 101;
    await assert.rejects(getDevinQuota(), /invalid remaining/);
    status.dailyQuotaRemainingPercent = 20;
    status.dailyQuotaResetAtUnix = "not a timestamp";
    await assert.rejects(getDevinQuota(), /invalid quota reset/);
    const abort = new AbortController();
    abort.abort();
    const beforeAbort = fetchCount;
    await assert.rejects(getDevinQuota({ signal: abort.signal }));
    assert.equal(fetchCount, beforeAbort);
  } finally {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    mock.restoreAll();
  }
}

async function verifyTimeouts() {
  const { getDevinQuota } = require("../src/main/devin-service");
  const realSetTimeout = globalThis.setTimeout;
  let hangVersion = true;
  let kills = 0;
  mock.method(fs, "readFile", async () => 'windsurf_api_key = "test-only-key"');
  mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { kills += 1; };
    if (!hangVersion) queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("devin 3000.10.67 (test)"));
      child.emit("close", 0);
    });
    return child;
  });
  const versionTimer = mock.method(globalThis, "setTimeout", (callback, delay) => {
    assert.equal(delay, 5000);
    return realSetTimeout(callback, 0);
  });
  mock.method(globalThis, "fetch", async (_url, options) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("test-only-key")), { once: true });
    })
  }));
  try {
    await assert.rejects(getDevinQuota(), /version could not be resolved/);
    assert.equal(kills, 2, "Timed out CLI processes must be stopped");
    versionTimer.mock.restore();
    hangVersion = false;
    mock.method(AbortSignal, "timeout", (delay) => {
      assert.equal(delay, 12000);
      const controller = new AbortController();
      realSetTimeout(() => controller.abort(), 0);
      return controller.signal;
    });
    await assert.rejects(getDevinQuota(), /quota request timed out/);
  } finally {
    mock.restoreAll();
  }
}

(async () => {
  await verifyNormalizedQuota();
  await verifyFailureBoundaries();
  await verifyTimeouts();
  console.log("Verified Devin normalization, fixed-host requests, CLI fallback, credential-safe errors, cancellation, and timeouts.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
