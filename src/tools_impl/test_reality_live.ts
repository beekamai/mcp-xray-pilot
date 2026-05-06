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
import { join } from "node:path";
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
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host: socksHost, port: socksPort });
    sock.setTimeout(timeoutMs);
    let stage: "greet" | "connect" = "greet";
    const buf: Buffer[] = [];

    const fail = (e: Error): void => {
      try { sock.destroy(); } catch { /* swallow */ }
      reject(e);
    };

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
  path: string,
  timeoutMs: number,
): Promise<{ status: number; latencyMs: number }> {
  const t0 = Date.now();
  const sock = await socks5Connect(socksHost, socksPort, targetHost, targetPort, timeoutMs);

  const tlsSock = await new Promise<TLSSocket>((resolve, reject) => {
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
    t.once("secureConnect", () => {
      clearTimeout(tmr);
      resolve(t);
    });
    t.once("error", (e) => {
      clearTimeout(tmr);
      reject(e);
    });
  });

  const req =
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${targetHost}\r\n` +
    `User-Agent: mcp-xray-pilot/0.13 (reality-test)\r\n` +
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
      resolve(v);
    };
    const tmr = setTimeout(() => finish(0), timeoutMs);
    tlsSock.on("data", (c: Buffer) => {
      chunks.push(c);
      const merged = Buffer.concat(chunks).toString("utf8");
      const m = merged.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      if (m) {
        clearTimeout(tmr);
        finish(parseInt(m[1], 10));
      }
    });
    tlsSock.on("end", () => { clearTimeout(tmr); finish(0); });
    tlsSock.on("error", () => { clearTimeout(tmr); finish(0); });
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

async function readTail(path: string, maxLines: number): Promise<string> {
  try {
    const buf = await readFile(path, "utf8");
    const lines = buf.split(/\r?\n/);
    const slice = lines.slice(-maxLines - 1).filter((l) => l.length > 0);
    return slice.join("\n");
  } catch {
    return "";
  }
}

/* --------------------------------------------------------------------- */
/* Main entrypoint                                                       */
/* --------------------------------------------------------------------- */

const HARDCODED_UUID = "fc6a8a7e-6c0a-4b7a-9b1f-9c3a0a1b2c3d";

export async function testRealityLive(args: TestRealityLiveArgs): Promise<TestRealityLiveResult> {
  const targetHost = (args.target_host ?? "").trim();
  if (!targetHost) throw new Error("Missing required parameter: target_host");
  const targetPort = args.target_port ?? 443;
  const overallTimeout = args.timeout_ms ?? 15000;

  const kp = args.keypair
    ? { privateKey: args.keypair.privateKey, publicKey: args.keypair.publicKey }
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
    try {
      probe = await Promise.race([
        probeThroughSocks(
          "127.0.0.1",
          pair.clientSocksPort,
          "1.1.1.1",
          443,
          "/cdn-cgi/trace",
          probeBudget,
        ),
        delay(probeBudget).then(() => {
          throw new Error(`timeout: REALITY handshake didn't complete in ${overallTimeout} ms`);
        }),
      ]);
      result.http_probe_status = probe.status || null;
      result.latency_ms = probe.latencyMs;
    } catch (e) {
      result.issues.push((e as Error).message);
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
    killProc(serverProc);
    killProc(clientProc);
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => { /* swallow */ });
    }
  }
}
