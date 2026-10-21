const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const STATUS_URL = "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus";

async function readCredentials() {
  const appData = process.env.APPDATA || (process.env.USERPROFILE && path.join(process.env.USERPROFILE, "AppData", "Roaming"));
  if (!appData) throw new Error("Devin credentials location is unavailable.");

  let source;
  try {
    source = await fs.readFile(path.join(appData, "devin", "credentials.toml"), "utf8");
  } catch {
    throw new Error("Devin credentials could not be read. Sign in to Devin first.");
  }
  const credentials = { api_server_url: "https://server.codeium.com" };
  try {
    for (const match of source.matchAll(/^\s*(windsurf_api_key|api_server_url)\s*=\s*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')\s*(?:#.*)?$/gm)) {
      credentials[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2].slice(1, -1);
    }
  } catch {
    throw new Error("Devin credentials could not be parsed.");
  }
  if (!credentials.windsurf_api_key?.trim()) {
    throw new Error("Devin authentication required: sign in to Devin first.");
  }
  return credentials;
}

function readVersion(command, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = childProcess.spawn(command, ["version"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let settled = false;
    const finish = (error, version) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(version);
      }
    };
    const onAbort = () => finish(new Error("Devin quota request cancelled."));
    const timer = setTimeout(() => finish(new Error("Devin version command timed out.")), 5000);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.once("error", () => finish(new Error("Devin CLI could not be started.")));
    child.once("close", (code) => {
      const version = output.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/)?.[1];
      finish(code === 0 && version ? null : new Error("Devin CLI did not return a valid version."), version);
    });
  });
}

async function resolveVersion(signal) {
  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE && path.join(process.env.USERPROFILE, "AppData", "Local"));
  const candidates = localAppData
    ? [path.join(localAppData, "Programs", "Devin", "resources", "app", "extensions", "windsurf", "devin", "bin", "devin.exe"), "devin"]
    : ["devin"];
  for (const command of candidates) {
    signal?.throwIfAborted();
    try {
      return await readVersion(command, signal);
    } catch {
      signal?.throwIfAborted();
    }
  }
  throw new Error("Devin CLI version could not be resolved. Install Devin or add devin to PATH.");
}

function normalizeWindow(remainingPercent, resetAtUnix, windowDurationMins) {
  if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) {
    throw new Error("Devin returned an invalid remaining quota percentage.");
  }
  const resetsAt = new Date(Number(resetAtUnix) * 1000);
  if (resetAtUnix === null || resetAtUnix === undefined || resetAtUnix === "" || !Number.isFinite(resetsAt.getTime())) {
    throw new Error("Devin returned an invalid quota reset time.");
  }
  return { usedPercent: 100 - remainingPercent, remainingPercent, windowDurationMins, resetsAt: resetsAt.toISOString() };
}

async function getDevinQuota({ signal } = {}) {
  signal?.throwIfAborted();
  const credentials = await readCredentials();
  const version = await resolveVersion(signal);
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let payload;
  let responseError;
  try {
    const response = await fetch(STATUS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1" },
      // Never forward the credential to a redirect target or the configured API server.
      redirect: "error",
      signal: requestSignal,
      body: JSON.stringify({ metadata: {
        apiKey: credentials.windsurf_api_key,
        ideName: "devin", ideVersion: version, extensionVersion: version, locale: "en"
      } })
    });
    if (!response.ok) {
      responseError = new Error(response.status === 401 || response.status === 403
        ? "Devin authentication required: sign in to Devin again."
        : `Devin quota request failed (HTTP ${response.status}).`);
      throw responseError;
    }
    payload = await response.json();
  } catch (error) {
    if (requestSignal.aborted) throw new Error(signal?.aborted ? "Devin quota request cancelled." : "Devin quota request timed out.");
    if (responseError === error) throw responseError;
    throw new Error("Devin quota request failed. Check your connection and try again.");
  }
  const status = payload?.userStatus?.planStatus;
  const primary = normalizeWindow(status?.dailyQuotaRemainingPercent, status?.dailyQuotaResetAtUnix, 1440);
  const secondary = normalizeWindow(status?.weeklyQuotaRemainingPercent, status?.weeklyQuotaResetAtUnix, 10080);
  const worst = primary.remainingPercent <= secondary.remainingPercent ? primary : secondary;
  return {
    limitId: "devin", limitName: "Devin",
    planType: payload?.planInfo?.planName || status?.planInfo?.planName || "unknown",
    primary, secondary,
    remainingPercent: worst.remainingPercent, usedPercent: worst.usedPercent, resetsAt: worst.resetsAt,
    credits: null,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { getDevinQuota };
