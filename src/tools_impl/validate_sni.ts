/*
 * Tool: xray_validate_sni_target
 *
 * Live-check that a candidate REALITY target supports TLS 1.3, ALPN h2,
 * returns a 200/30x and presents a real cert. Pings happen from the
 * machine running mcp-xray-pilot — the verdict reflects YOUR network's
 * view, not necessarily a Russian residential. For RU-side checks, run
 * the probe from a РФ IP separately.
 */

import { connect as tlsConnect, type TLSSocket, type PeerCertificate } from "node:tls";
import { request as httpsRequest } from "node:https";

export interface ValidateSniArgs {
  host?: string;
  port?: number;
  timeout_ms?: number;
}

export interface ValidateSniResult {
  host: string;
  port: number;
  ok: boolean;
  tls_version: string;
  alpn: string | null;
  http_status: number;
  cert_subject: string;
  cert_san_count: number;
  latency_ms: number;
  issues: string[];
}

function certSubject(cert: PeerCertificate | undefined): string {
  if (!cert) return "";
  /* `subject` shape varies; fall back to subjectaltname. */
  const sub = (cert as unknown as { subject?: { CN?: string } }).subject;
  if (sub && typeof sub === "object" && typeof sub.CN === "string") return sub.CN;
  const san = (cert as unknown as { subjectaltname?: string }).subjectaltname;
  if (typeof san === "string") {
    const first = san.split(",")[0]?.trim().replace(/^DNS:/, "");
    if (first) return first;
  }
  return "";
}

function countSan(cert: PeerCertificate | undefined): number {
  if (!cert) return 0;
  const san = (cert as unknown as { subjectaltname?: string }).subjectaltname;
  if (typeof san !== "string") return 0;
  return san.split(",").filter((s) => s.trim().toUpperCase().startsWith("DNS:")).length;
}

interface TlsHandshake {
  protocol: string;
  alpn: string | null;
  cert: PeerCertificate | undefined;
  socket: TLSSocket;
}

function tlsHandshake(host: string, port: number, timeoutMs: number): Promise<TlsHandshake> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host,
      port,
      servername: host,
      ALPNProtocols: ["h2", "http/1.1"],
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.3",
      rejectUnauthorized: true,
      timeout: timeoutMs,
    });
    const cleanup = (): void => {
      socket.removeAllListeners("secureConnect");
      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
    };
    socket.once("secureConnect", () => {
      cleanup();
      resolve({
        protocol: socket.getProtocol() ?? "unknown",
        alpn: typeof socket.alpnProtocol === "string" ? socket.alpnProtocol : null,
        cert: socket.getPeerCertificate(true),
        socket,
      });
    });
    socket.once("error", (e) => {
      cleanup();
      try { socket.destroy(); } catch { /* swallow */ }
      reject(e);
    });
    socket.once("timeout", () => {
      cleanup();
      try { socket.destroy(); } catch { /* swallow */ }
      reject(new Error(`TLS handshake timeout after ${timeoutMs}ms`));
    });
  });
}

function headRequest(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        host,
        port,
        method: "HEAD",
        path: "/",
        timeout: timeoutMs,
        servername: host,
        headers: {
          "user-agent": "mcp-xray-pilot/0.11 (sni-validator)",
          accept: "*/*",
        },
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      },
    );
    req.on("error", () => resolve(0));
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.end();
  });
}

export async function validateSniTarget(args: ValidateSniArgs): Promise<ValidateSniResult> {
  const host = (args.host ?? "").trim();
  if (!host) throw new Error("Missing required parameter: host");
  const port = args.port ?? 443;
  const timeoutMs = args.timeout_ms ?? 5000;

  const result: ValidateSniResult = {
    host,
    port,
    ok: false,
    tls_version: "fail",
    alpn: null,
    http_status: 0,
    cert_subject: "",
    cert_san_count: 0,
    latency_ms: 0,
    issues: [],
  };

  const t0 = Date.now();
  let handshake: TlsHandshake | null = null;
  try {
    handshake = await tlsHandshake(host, port, timeoutMs);
  } catch (e) {
    result.latency_ms = Date.now() - t0;
    result.issues.push(`TLS handshake failed: ${(e as Error).message}`);
    return result;
  }

  result.tls_version = handshake.protocol;
  result.alpn = handshake.alpn;
  result.cert_subject = certSubject(handshake.cert);
  result.cert_san_count = countSan(handshake.cert);

  if (handshake.protocol !== "TLSv1.3") {
    result.issues.push(`TLS ${handshake.protocol} only — REALITY needs TLS 1.3 on the target`);
  }
  if (handshake.alpn !== "h2") {
    result.issues.push(
      handshake.alpn === "http/1.1"
        ? "ALPN is http/1.1 — REALITY needs h2 for proper xhttp/raw mimicry"
        : `ALPN missing/unsupported (${handshake.alpn ?? "null"}) — REALITY needs h2`,
    );
  }
  try {
    handshake.socket.destroy();
  } catch {
    /* swallow */
  }

  const status = await headRequest(host, port, timeoutMs);
  result.http_status = status;
  if (status === 0) {
    result.issues.push("HEAD / failed (timeout or socket error)");
  } else if (status >= 400 && status !== 405) {
    /* 405 Method Not Allowed for HEAD is fine — server is responsive. */
    result.issues.push(`HEAD / returned HTTP ${status} (need 200/30x; 405 also acceptable)`);
  }

  result.latency_ms = Date.now() - t0;
  /* "ok" iff TLS 1.3 + h2 + reachable HTTP. */
  result.ok =
    handshake.protocol === "TLSv1.3" &&
    handshake.alpn === "h2" &&
    (status === 405 || (status >= 200 && status < 400));
  return result;
}
