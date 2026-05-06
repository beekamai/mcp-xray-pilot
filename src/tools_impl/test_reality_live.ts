/*
 * Tool: xray_test_reality_live
 *
 * Spins up a real local pair of xray-core processes (server + client) on
 * ephemeral ports and runs a full REALITY handshake against the requested
 * target. Returns whether REALITY handshake completed cleanly, whether the
 * client received a real (un-spoofed) certificate, plus an HTTP probe
 * latency through the cascade.
 *
 * Why this exists: `xray_validate_sni_target` only confirms TLS 1.3 + h2 +
 * a valid HEAD response. Some hosts (e.g. outlook.live.com, www.ozon.ru)
 * pass that surface check but REALITY still rejects them at the handshake
 * level — clients log "REALITY: received real certificate" and the cascade
 * silently breaks. The only reliable verdict is to actually run REALITY.
 *
 * Implementation notes:
 * - xray binary is downloaded once into ~/.cache/mcp-xray-pilot/xray-bin/
 *   from the latest XTLS/Xray-core release for the host platform.
 * - SOCKS5 is implemented by hand to avoid an extra dep. Xray client
 *   exposes a SOCKS inbound; we issue a single HTTPS GET through it.
 * - Both xray processes log at debug level into temp files we read back.
 * - Everything is killed and unlinked in finally{}.
 *
 * v0.14:
 * - Verdicts are cached on disk in data/reality-verdicts.json. Cap = 50
 *   entries (LRU by cached_at), TTL = 24h. Key = `host:port`. Set
 *   `force_refresh: true` to bypass the cache.
 * - `multi_targets[]` runs a list of candidates sequentially (1..10) and
 *   returns a sorted summary instead of a single verdict.
 * - The HTTP probe socket is now wired through an AbortController so
 *   timing out doesn't leak file descriptors on long-running servers.
 */

import { generateRealityKeypair } from "./gen_reality_keypair.js";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  chmod,
} from "node:fs/promises";
import { homedir, tmpdir, platform, arch } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer as createTcpServer, connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnectRaw, type TLSSocket } from "node:tls";
import { request as httpsRequest } from "node:https";

const execFileP = promisify(execFile);

export interface TestRealityLiveArgs {
  target_host?: string;
  target_port?: number;
  timeout_ms?: number;
  keypair?: { privateKey: string; publicKey: string };
  multi_targets?: string[];
  force_refresh?: boolean;
}

export interface TestRealityLiveResult {
  ok: boolean;
  target: string;
  reality_handshake_complete: boolean;
  client_received_real_cert: boolean;
  http_probe_status: number | null;
  latency_ms: number;
  server_log_excerpt: string;
  client_log_excerpt: string;
  issues: string[];
  used_keypair: { privateKey: string; publicKey: string; shortId: string };
  cached?: boolean;
  cached_at?: string;
}

export interface TestRealityLiveMultiResult {
  results: TestRealityLiveResult[];
  summary: { ok_count: number; total: number };
}

/* --------------------------------------------------------------------- */
/* xray binary download + cache                                          */
/* --------------------------------------------------------------------- */

interface XrayAsset {
  url: string;
  binaryName: string;
  cacheDir: string;
  binaryPath: string;
}

function xrayAssetForPlatform(): XrayAsset {
  const cacheDir = join(homedir(), ".cache", "mcp-xray-pilot", "xray-bin");
  const isArm64 = arch() === "arm64";
  const base = "https://github.com/XTLS/Xray-core/releases/latest/download";
  let zipName: string;
  let binaryName: string;
  switch (platform()) {
    case "win32":
      zipName = isArm64 ? "Xray-windows-arm64-v8a.zip" : "Xray-windows-64.zip";
      binaryName = "xray.exe";
      break;
    case "darwin":
      zipName = isArm64 ? "Xray-macos-arm64-v8a.zip" : "Xray-macos-64.zip";
      binaryName = "xray";
      break;
    default:
      zipName = isArm64 ? "Xray-linux-arm64-v8a.zip" : "Xray-linux-64.zip";
      binaryName = "xray";
      break;
  }
  return {
    url: `${base}/${zipName}`,
    binaryName,
    cacheDir,
    binaryPath: join(cacheDir, binaryName),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function httpGetRedirect(url: string): Promise<Buffer> {
  const visited = new Set<string>();
  let next = url;
  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(next)) throw new Error(`redirect loop on ${next}`);
    visited.add(next);
    const res = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>(
      (resolve, reject) => {
        const req = httpsRequest(next, { method: "GET" }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () =>
            resolve({
              status: r.statusCode ?? 0,
              headers: r.headers,
              body: Buffer.concat(chunks),
            }),
          );
          r.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      },
    );
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
      next = loc.startsWith("http") ? loc : new URL(loc, next).toString();
      continue;
    }
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} from ${next}`);
    }
    return res.body;
  }
  throw new Error("too many redirects");
}

async function tryExtractZip(zipPath: string, destDir: string): Promise<void> {
  /* Try `tar -xf` first (works on Win10+, macOS bsdtar, modern busybox).
   * Fall back to `unzip` (Linux). Final fallback: PowerShell Expand-Archive on Windows. */
  const attempts: { cmd: string; args: string[] }[] = [
    { cmd: "tar", args: ["-xf", zipPath, "-C", destDir] },
    { cmd: "unzip", args: ["-o", zipPath, "-d", destDir] },
  ];
  if (platform() === "win32") {
    attempts.push({
      cmd: "powershell.exe",
      args: [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ],
    });
  }
  let lastErr: Error | null = null;
  for (const a of attempts) {
    try {
      await execFileP(a.cmd, a.args, { windowsHide: true });
      return;
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`failed to extract ${zipPath}: ${lastErr?.message ?? "no extractor available"}`);
}

async function ensureXrayBinary(): Promise<string> {
  const asset = xrayAssetForPlatform();
  if (await fileExists(asset.binaryPath)) return asset.binaryPath;
  await mkdir(asset.cacheDir, { recursive: true });

  const zipPath = join(asset.cacheDir, "xray.zip");
  const body = await httpGetRedirect(asset.url);
  await writeFile(zipPath, body);
  await tryExtractZip(zipPath, asset.cacheDir);
  await rm(zipPath, { force: true });

  if (!(await fileExists(asset.binaryPath))) {
    throw new Error(`xray binary not found at ${asset.binaryPath} after extraction`);
  }
  if (platform() !== "win32") {
    try {
      await chmod(asset.binaryPath, 0o755);
    } catch {
      /* swallow — best effort */
    }
  }
  return asset.binaryPath;
}

/* --------------------------------------------------------------------- */
/* Free ports + TCP reachability                                          */
/* --------------------------------------------------------------------- */

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createTcpServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("could not allocate free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = netConnect({ host, port });
    let done = false;
    const finish = (v: boolean): void => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* swallow */ }
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
    sock.once("timeout", () => finish(false));
  });
}

/* --------------------------------------------------------------------- */
/* Minimal SOCKS5 + TLS HTTP probe                                        */
/* --------------------------------------------------------------------- */

function socks5Connect(
  socksHost: string,
  socksPort: number,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted before SOCKS5 connect"));
      return;
    }
    const sock = netConnect({ host: socksHost, port: socksPort });
    sock.setTimeout(timeoutMs);
    let stage: "greet" | "connect" = "greet";
    const buf: Buffer[] = [];

    const fail = (e: Error): void => {
      try { sock.destroy(); } catch { /* swallow */ }
      reject(e);
    };

    const onAbort = (): void => {
      fail(new Error("aborted during SOCKS5 handshake"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    sock.once("error", fail);
    sock.once("timeout", () => fail(new Error("SOCKS5 timeout")));

    sock.once("connect", () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    sock.on("data", (chunk: Buffer) => {
      buf.push(chunk);
      const merged = Buffer.concat(buf);
      if (stage === "greet") {
        if (merged.length < 2) return;
        if (merged[0] !== 0x05 || merged[1] !== 0x00) {
          fail(new Error(`SOCKS5 greet failed: ${merged.slice(0, 2).toString("hex")}`));
          return;
        }
        buf.length = 0;
        if (merged.length > 2) buf.push(merged.subarray(2));
        stage = "connect";
        const hostBuf = Buffer.from(targetHost, "utf8");
        const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
        req[0] = 0x05;
        req[1] = 0x01;
        req[2] = 0x00;
        req[3] = 0x03;
        req[4] = hostBuf.length;
        hostBuf.copy(req, 5);
        req.writeUInt16BE(targetPort, 5 + hostBuf.length);
        sock.write(req);
        return;
      }
      /* stage === "connect": parse reply header */
      if (merged.length < 5) return;
      if (merged[0] !== 0x05) {
        fail(new Error(`SOCKS5 bad version in reply: ${merged[0]}`));
        return;
      }
      if (merged[1] !== 0x00) {
        fail(new Error(`SOCKS5 connect refused, code=${merged[1]}`));
        return;
      }
      const atyp = merged[3];
      let headerLen: number;
      if (atyp === 0x01) headerLen = 4 + 4 + 2;
      else if (atyp === 0x03) {
        if (merged.length < 5) return;
        headerLen = 4 + 1 + merged[4] + 2;
      } else if (atyp === 0x04) headerLen = 4 + 16 + 2;
      else {
        fail(new Error(`SOCKS5 unknown ATYP: ${atyp}`));
        return;
      }
      if (merged.length < headerLen) return;
      sock.removeAllListeners("data");
      sock.removeAllListeners("error");
      sock.removeAllListeners("timeout");
      sock.setTimeout(0);
      signal.removeEventListener("abort", onAbort);
      /* unshift any leftover bytes back to be consumed by next layer */
      const leftover = merged.subarray(headerLen);
      if (leftover.length) sock.unshift(leftover);
      resolve(sock);
    });
  });
}

async function probeThroughSocks(
  socksHost: string,
  socksPort: number,
  targetHost: string,
  targetPort: number,
  reqPath: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ status: number; latencyMs: number }> {
  const t0 = Date.now();
  const sock = await socks5Connect(socksHost, socksPort, targetHost, targetPort, timeoutMs, signal);

  /* Make sure the SOCKS socket itself is destroyed if the caller aborts
   * after the handshake completed but before TLS layered on top of it. */
  const onAbortSocks = (): void => {
    try { sock.destroy(); } catch { /* swallow */ }
  };
  signal.addEventListener("abort", onAbortSocks, { once: true });

  const tlsSock = await new Promise<TLSSocket>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted before TLS connect"));
      return;
    }
    const t = tlsConnectRaw({
      socket: sock,
      servername: targetHost,
      ALPNProtocols: ["http/1.1"],
      rejectUnauthorized: false,
    });
    const tmr = setTimeout(() => {
      try { t.destroy(); } catch { /* swallow */ }
      reject(new Error("TLS through SOCKS timeout"));
    }, timeoutMs);
    const onAbortTls = (): void => {
      clearTimeout(tmr);
      try { t.destroy(); } catch { /* swallow */ }
      reject(new Error("aborted during TLS handshake"));
    };
    signal.addEventListener("abort", onAbortTls, { once: true });
    t.once("secureConnect", () => {
      clearTimeout(tmr);
      signal.removeEventListener("abort", onAbortTls);
      resolve(t);
    });
    t.once("error", (e) => {
      clearTimeout(tmr);
      signal.removeEventListener("abort", onAbortTls);
      reject(e);
    });
  });
  signal.removeEventListener("abort", onAbortSocks);

  /* TLS now owns the underlying socket; aborts must destroy tlsSock. */
  const onAbortTlsSock = (): void => {
    try { tlsSock.destroy(); } catch { /* swallow */ }
  };
  signal.addEventListener("abort", onAbortTlsSock, { once: true });

  const req =
    `GET ${reqPath} HTTP/1.1\r\n` +
    `Host: ${targetHost}\r\n` +
    `User-Agent: mcp-xray-pilot/0.14 (reality-test)\r\n` +
    `Connection: close\r\n` +
    `Accept: */*\r\n\r\n`;
  tlsSock.write(req);

  const status = await new Promise<number>((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (v: number): void => {
      if (done) return;
      done = true;
      try { tlsSock.destroy(); } catch { /* swallow */ }
      signal.removeEventListener("abort", onAbortTlsSock);
      resolve(v);
    };
    const tmr = setTimeout(() => finish(0), timeoutMs);
    const onAbortRead = (): void => {
      clearTimeout(tmr);
      finish(0);
    };
    signal.addEventListener("abort", onAbortRead, { once: true });
    tlsSock.on("data", (c: Buffer) => {
      chunks.push(c);
      const merged = Buffer.concat(chunks).toString("utf8");
      const m = merged.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      if (m) {
        clearTimeout(tmr);
        signal.removeEventListener("abort", onAbortRead);
        finish(parseInt(m[1], 10));
      }
    });
    tlsSock.on("end", () => {
      clearTimeout(tmr);
      signal.removeEventListener("abort", onAbortRead);
      finish(0);
    });
    tlsSock.on("error", () => {
      clearTimeout(tmr);
      signal.removeEventListener("abort", onAbortRead);
      finish(0);
    });
  });

  return { status, latencyMs: Date.now() - t0 };
}

/* --------------------------------------------------------------------- */
/* xray config builders                                                  */
/* --------------------------------------------------------------------- */

interface XrayConfigPair {
  serverConfigPath: string;
  clientConfigPath: string;
  serverLogPath: string;
  clientLogPath: string;
  serverPort: number;
  clientSocksPort: number;
  workDir: string;
}

function buildServerConfig(opts: {
  port: number;
  uuid: string;
  privateKey: string;
  shortId: string;
  targetHost: string;
  targetPort: number;
  logPath: string;
}): unknown {
  const targetSpec = `${opts.targetHost}:${opts.targetPort}`;
  return {
    log: { loglevel: "debug", error: opts.logPath, access: "none" },
    inbounds: [
      {
        tag: "in",
        listen: "127.0.0.1",
        port: opts.port,
        protocol: "vless",
        settings: {
          clients: [{ id: opts.uuid }],
          decryption: "none",
        },
        streamSettings: {
          network: "xhttp",
          security: "reality",
          realitySettings: {
            show: false,
            target: targetSpec,
            dest: targetSpec,
            xver: 0,
            serverNames: [opts.targetHost],
            privateKey: opts.privateKey,
            shortIds: [opts.shortId],
          },
          xhttpSettings: {
            host: opts.targetHost,
            path: "/api/data",
            mode: "auto",
          },
        },
      },
    ],
    outbounds: [{ tag: "direct", protocol: "freedom" }],
  };
}

function buildClientConfig(opts: {
  socksPort: number;
  serverPort: number;
  uuid: string;
  publicKey: string;
  shortId: string;
  targetHost: string;
  logPath: string;
}): unknown {
  return {
    log: { loglevel: "debug", error: opts.logPath, access: "none" },
    inbounds: [
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: opts.socksPort,
        protocol: "socks",
        settings: { auth: "noauth", udp: false },
      },
    ],
    outbounds: [
      {
        tag: "vless-out",
        protocol: "vless",
        settings: {
          vnext: [
            {
              address: "127.0.0.1",
              port: opts.serverPort,
              users: [{ id: opts.uuid, encryption: "none" }],
            },
          ],
        },
        streamSettings: {
          network: "xhttp",
          security: "reality",
          realitySettings: {
            show: false,
            fingerprint: "chrome",
            serverName: opts.targetHost,
            publicKey: opts.publicKey,
            shortId: opts.shortId,
            spiderX: "/",
          },
          xhttpSettings: {
            host: opts.targetHost,
            path: "/api/data",
            mode: "auto",
          },
        },
      },
    ],
  };
}

async function writeConfigPair(
  workDir: string,
  serverCfg: unknown,
  clientCfg: unknown,
  serverLogPath: string,
  clientLogPath: string,
  serverPort: number,
  clientSocksPort: number,
): Promise<XrayConfigPair> {
  await mkdir(workDir, { recursive: true });
  const serverConfigPath = join(workDir, "server.json");
  const clientConfigPath = join(workDir, "client.json");
  await writeFile(serverConfigPath, JSON.stringify(serverCfg, null, 2), "utf8");
  await writeFile(clientConfigPath, JSON.stringify(clientCfg, null, 2), "utf8");
  /* Pre-create empty log files so xray opens them in append mode without
   * racing against our reads. */
  await writeFile(serverLogPath, "", "utf8");
  await writeFile(clientLogPath, "", "utf8");
  return {
    serverConfigPath,
    clientConfigPath,
    serverLogPath,
    clientLogPath,
    serverPort,
    clientSocksPort,
    workDir,
  };
}

/* --------------------------------------------------------------------- */
/* Process management                                                    */
/* --------------------------------------------------------------------- */

function spawnXray(binary: string, configPath: string): ChildProcess {
  const proc = spawn(binary, ["run", "-c", configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  /* Drain stdio so it doesn't fill the pipe buffer and stall xray. */
  proc.stdout?.on("data", () => { /* swallow */ });
  proc.stderr?.on("data", () => { /* swallow */ });
  return proc;
}

function killProc(proc: ChildProcess | null): void {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  try {
    proc.kill("SIGKILL");
  } catch {
    /* swallow */
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readTail(filePath: string, maxLines: number): Promise<string> {
  try {
    const buf = await readFile(filePath, "utf8");
    const lines = buf.split(/\r?\n/);
    const slice = lines.slice(-maxLines - 1).filter((l) => l.length > 0);
    return slice.join("\n");
  } catch {
    return "";
  }
}

/* --------------------------------------------------------------------- */
/* On-disk LRU verdict cache                                             */
/* --------------------------------------------------------------------- */

const VERDICT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const VERDICT_CACHE_CAP = 50;

interface VerdictCacheEntry {
  /* Stored verdict, *without* any cached:* fields — we re-add them on read. */
  verdict: TestRealityLiveResult;
  cached_at: string;
}

interface VerdictCacheFile {
  version: 1;
  entries: Record<string, VerdictCacheEntry>;
}

function verdictCachePath(): string {
  /*
   * Resolve relative to this module so it works in both source (tsx) and
   * built (dist) layouts. Both land on <repo>/data/reality-verdicts.json.
   *   - source: src/tools_impl/test_reality_live.ts → ../../data/reality-verdicts.json
   *   - dist:   dist/tools_impl/test_reality_live.js → ../../data/reality-verdicts.json
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "data", "reality-verdicts.json");
}

function cacheKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

async function readVerdictCache(): Promise<VerdictCacheFile> {
  try {
    const raw = await readFile(verdictCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<VerdictCacheFile>;
    if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
      return { version: 1, entries: parsed.entries };
    }
    return { version: 1, entries: {} };
  } catch {
    /* Missing or corrupted — start clean. */
    return { version: 1, entries: {} };
  }
}

async function writeVerdictCache(cache: VerdictCacheFile): Promise<void> {
  const filePath = verdictCachePath();
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(cache, null, 2), "utf8");
  } catch {
    /* Best-effort persistence. The cache miss next call is harmless. */
  }
}

function lookupCache(
  cache: VerdictCacheFile,
  host: string,
  port: number,
): TestRealityLiveResult | null {
  const entry = cache.entries[cacheKey(host, port)];
  if (!entry) return null;
  const ts = Date.parse(entry.cached_at);
  if (!Number.isFinite(ts) || Date.now() - ts > VERDICT_CACHE_TTL_MS) return null;
  return { ...entry.verdict, cached: true, cached_at: entry.cached_at };
}

function evictLRU(cache: VerdictCacheFile): void {
  const keys = Object.keys(cache.entries);
  if (keys.length <= VERDICT_CACHE_CAP) return;
  const sorted = keys
    .map((k) => ({ k, t: Date.parse(cache.entries[k].cached_at) || 0 }))
    .sort((a, b) => a.t - b.t);
  const toDrop = sorted.slice(0, keys.length - VERDICT_CACHE_CAP);
  for (const { k } of toDrop) delete cache.entries[k];
}

function storeInCache(
  cache: VerdictCacheFile,
  host: string,
  port: number,
  verdict: TestRealityLiveResult,
): { cached_at: string } {
  const cached_at = new Date().toISOString();
  /* Strip any inbound cached:* flags before storing. */
  const { cached: _c, cached_at: _ca, ...clean } = verdict;
  void _c;
  void _ca;
  cache.entries[cacheKey(host, port)] = { verdict: clean, cached_at };
  evictLRU(cache);
  return { cached_at };
}

/* --------------------------------------------------------------------- */
/* Main entrypoint                                                       */
/* --------------------------------------------------------------------- */

const HARDCODED_UUID = "fc6a8a7e-6c0a-4b7a-9b1f-9c3a0a1b2c3d";

interface SingleTargetOpts {
  targetHost: string;
  targetPort: number;
  overallTimeout: number;
  keypair?: { privateKey: string; publicKey: string };
}

async function runSingleTarget(opts: SingleTargetOpts): Promise<TestRealityLiveResult> {
  const { targetHost, targetPort, overallTimeout } = opts;

  const kp = opts.keypair
    ? { privateKey: opts.keypair.privateKey, publicKey: opts.keypair.publicKey }
    : (() => {
        const g = generateRealityKeypair();
        return { privateKey: g.privateKey, publicKey: g.publicKey };
      })();
  const shortId = randomBytes(4).toString("hex");

  const result: TestRealityLiveResult = {
    ok: false,
    target: `${targetHost}:${targetPort}`,
    reality_handshake_complete: false,
    client_received_real_cert: false,
    http_probe_status: null,
    latency_ms: 0,
    server_log_excerpt: "",
    client_log_excerpt: "",
    issues: [],
    used_keypair: { privateKey: kp.privateKey, publicKey: kp.publicKey, shortId },
  };

  const t0 = Date.now();
  let serverProc: ChildProcess | null = null;
  let clientProc: ChildProcess | null = null;
  let workDir: string | null = null;
  const probeAbort = new AbortController();

  try {
    /* 1. xray binary. */
    let xrayBin: string;
    try {
      xrayBin = await ensureXrayBinary();
    } catch (e) {
      result.issues.push(`xray-binary unavailable: ${(e as Error).message}`);
      return result;
    }

    /* 2. target reachability. */
    const reachable = await tcpReachable(targetHost, targetPort, Math.min(overallTimeout, 5000));
    if (!reachable) {
      result.issues.push("target unreachable");
      return result;
    }

    /* 3. allocate ports + write configs. */
    const serverPort = await getFreePort();
    const clientSocksPort = await getFreePort();
    workDir = join(tmpdir(), `mcp-xray-pilot-reality-${randomUUID()}`);
    const serverLogPath = join(workDir, "server.log");
    const clientLogPath = join(workDir, "client.log");

    const serverCfg = buildServerConfig({
      port: serverPort,
      uuid: HARDCODED_UUID,
      privateKey: kp.privateKey,
      shortId,
      targetHost,
      targetPort,
      logPath: serverLogPath,
    });
    const clientCfg = buildClientConfig({
      socksPort: clientSocksPort,
      serverPort,
      uuid: HARDCODED_UUID,
      publicKey: kp.publicKey,
      shortId,
      targetHost,
      logPath: clientLogPath,
    });
    const pair = await writeConfigPair(
      workDir,
      serverCfg,
      clientCfg,
      serverLogPath,
      clientLogPath,
      serverPort,
      clientSocksPort,
    );

    /* 4. spawn server, then client. */
    serverProc = spawnXray(xrayBin, pair.serverConfigPath);
    await delay(800);
    if (serverProc.exitCode !== null) {
      const tail = await readTail(pair.serverLogPath, 30);
      result.server_log_excerpt = tail;
      result.issues.push(`server xray exited early (code=${serverProc.exitCode})`);
      return result;
    }
    clientProc = spawnXray(xrayBin, pair.clientConfigPath);
    await delay(800);
    if (clientProc.exitCode !== null) {
      const tail = await readTail(pair.clientLogPath, 20);
      result.client_log_excerpt = tail;
      result.issues.push(`client xray exited early (code=${clientProc.exitCode})`);
      return result;
    }

    /* 5. give REALITY ~3s to settle, then probe. */
    await delay(2000);

    const probeBudget = Math.max(3000, overallTimeout - (Date.now() - t0) - 1500);
    let probe: { status: number; latencyMs: number } | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    try {
      probe = await new Promise<{ status: number; latencyMs: number }>((resolve, reject) => {
        timeoutTimer = setTimeout(() => {
          probeAbort.abort();
          reject(new Error(`timeout: REALITY handshake didn't complete in ${overallTimeout} ms`));
        }, probeBudget);
        probeThroughSocks(
          "127.0.0.1",
          pair.clientSocksPort,
          "1.1.1.1",
          443,
          "/cdn-cgi/trace",
          probeBudget,
          probeAbort.signal,
        ).then((r) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(r);
        }, (e) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(e);
        });
      });
      result.http_probe_status = probe.status || null;
      result.latency_ms = probe.latencyMs;
    } catch (e) {
      result.issues.push((e as Error).message);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    /* 6. settle then read logs. */
    await delay(300);
    result.server_log_excerpt = await readTail(pair.serverLogPath, 30);
    result.client_log_excerpt = await readTail(pair.clientLogPath, 20);

    if (result.client_log_excerpt.includes("REALITY: received real certificate")) {
      result.client_received_real_cert = true;
      result.issues.push(
        "client received a real certificate — REALITY target is not compatible (server cannot spoof its cert)",
      );
    }
    if (
      result.server_log_excerpt.includes("hs.handshake() err: <nil>") ||
      result.server_log_excerpt.includes("isHandshakeComplete.Load(): true")
    ) {
      result.reality_handshake_complete = true;
    }

    const status = result.http_probe_status ?? 0;
    result.ok =
      result.reality_handshake_complete &&
      !result.client_received_real_cert &&
      ((status >= 200 && status < 400) || status === 200);

    return result;
  } finally {
    /*
     * Ensure the probe socket chain can never outlive this call: even on
     * the happy path the listeners are removed but a stray reference
     * shouldn't pin a socket open. abort() is idempotent.
     */
    probeAbort.abort();
    killProc(serverProc);
    killProc(clientProc);
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => { /* swallow */ });
    }
  }
}

const MULTI_TARGETS_MAX = 10;

function parseTargetSpec(spec: string, defaultPort: number): { host: string; port: number } {
  /* Accept "host", "host:port" and bracketed-IPv6 "[::1]:443". */
  const trimmed = spec.trim();
  if (!trimmed) throw new Error("empty target in multi_targets[]");
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    if (close < 0) throw new Error(`invalid IPv6 target: ${spec}`);
    const host = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    if (!rest) return { host, port: defaultPort };
    if (!rest.startsWith(":")) throw new Error(`invalid IPv6 target suffix: ${spec}`);
    const port = parseInt(rest.slice(1), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`invalid port in target: ${spec}`);
    }
    return { host, port };
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon < 0) return { host: trimmed, port: defaultPort };
  const host = trimmed.slice(0, colon);
  const port = parseInt(trimmed.slice(colon + 1), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port in target: ${spec}`);
  }
  return { host, port };
}

export async function testRealityLive(
  args: TestRealityLiveArgs,
): Promise<TestRealityLiveResult | TestRealityLiveMultiResult> {
  const overallTimeout = args.timeout_ms ?? 15000;
  const defaultPort = args.target_port ?? 443;
  const forceRefresh = args.force_refresh === true;
  const hasSingle = typeof args.target_host === "string" && args.target_host.trim().length > 0;
  const hasMulti = Array.isArray(args.multi_targets) && args.multi_targets.length > 0;

  if (hasSingle && hasMulti) {
    throw new Error("`target_host` and `multi_targets` are mutually exclusive");
  }
  if (!hasSingle && !hasMulti) {
    throw new Error("Missing required parameter: target_host (or multi_targets[])");
  }
  if (hasMulti) {
    if (args.multi_targets!.length > MULTI_TARGETS_MAX) {
      throw new Error(`multi_targets[] has ${args.multi_targets!.length} entries; max is ${MULTI_TARGETS_MAX}`);
    }
  }

  const cache = await readVerdictCache();
  const ranSinceLastWrite: { dirty: boolean } = { dirty: false };

  const runOne = async (host: string, port: number): Promise<TestRealityLiveResult> => {
    if (!forceRefresh) {
      const hit = lookupCache(cache, host, port);
      if (hit) return hit;
    }
    const fresh = await runSingleTarget({
      targetHost: host,
      targetPort: port,
      overallTimeout,
      keypair: args.keypair,
    });
    const { cached_at } = storeInCache(cache, host, port, fresh);
    ranSinceLastWrite.dirty = true;
    return { ...fresh, cached: false, cached_at };
  };

  try {
    if (hasSingle) {
      return await runOne(args.target_host!.trim(), defaultPort);
    }

    /* multi: sequential to avoid xray binary contention on stdio/ports. */
    const results: TestRealityLiveResult[] = [];
    for (const spec of args.multi_targets!) {
      const { host, port } = parseTargetSpec(spec, defaultPort);
      const r = await runOne(host, port);
      results.push(r);
    }
    results.sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return (a.latency_ms || Number.MAX_SAFE_INTEGER) - (b.latency_ms || Number.MAX_SAFE_INTEGER);
    });
    return {
      results,
      summary: {
        ok_count: results.filter((r) => r.ok).length,
        total: results.length,
      },
    };
  } finally {
    if (ranSinceLastWrite.dirty) {
      await writeVerdictCache(cache);
    }
  }
}
