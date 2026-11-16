import { execFileSync } from "node:child_process";
import dns from "node:dns";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";

export type FakeRequest = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: string };
export type FakeReply = { status?: number; body?: string; headers?: Record<string, string>; delayMs?: number; hold?: boolean };
export type FakeHandler = (request: FakeRequest) => FakeReply;

let certificate: { key: string; cert: string } | undefined;

/** One throwaway self-signed certificate per process; the private key never leaves the temp directory. */
function testCertificate() {
  if (certificate) return certificate;
  const directory = mkdtempSync(join(tmpdir(), "lifeos-fake-provider-"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2",
      "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem"),
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    ], { stdio: "ignore" });
    certificate = { key: readFileSync(join(directory, "key.pem"), "utf8"), cert: readFileSync(join(directory, "cert.pem"), "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return certificate;
}

/**
 * A local HTTPS server that stands in for every AI provider. While it runs, DNS answers any public-looking
 * name with a public address (so endpoint validation passes) and every outbound `https.request` that uses the
 * global agent, which is what the SSRF-guarded transport does, is connected to this server instead.
 * Production code is untouched; only process-level network seams are patched and restored by `close()`.
 */
export async function startFakeProvider(initial: FakeHandler) {
  const { key, cert } = testCertificate();
  let handler = initial;
  const requests: FakeRequest[] = [];
  const open = new Set<import("node:net").Socket>();
  const server = https.createServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const record = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(record);
      const reply = handler(record);
      if (reply.hold) return;
      setTimeout(() => {
        res.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
        res.end(reply.body ?? "{}");
      }, reply.delayMs ?? 0);
    });
  });
  server.on("connection", (socket) => { open.add(socket); socket.on("close", () => open.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as import("node:net").AddressInfo;

  const agent = https.globalAgent as unknown as { createConnection: (options: tls.ConnectionOptions, callback?: () => void) => unknown };
  const originalConnection = agent.createConnection;
  const originalLookup = dns.lookup;
  agent.createConnection = (_options, callback) => tls.connect({ host: "127.0.0.1", port, ca: cert }, callback);
  (dns as { lookup: unknown }).lookup = ((_host: string, options: unknown, callback: unknown) => {
    const done = (typeof options === "function" ? options : callback) as (error: null, result: unknown, family?: number) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) done(null, [{ address: "8.8.8.8", family: 4 }]);
    else done(null, "8.8.8.8", 4);
  }) as typeof dns.lookup;

  return {
    requests,
    setHandler: (next: FakeHandler) => { handler = next; },
    async close() {
      https.globalAgent.destroy(); // pooled keep-alive sockets point at this server
      agent.createConnection = originalConnection;
      (dns as { lookup: unknown }).lookup = originalLookup;
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** OpenAI-compatible chat completion carrying the given assistant text. */
export const chatReply = (content: string): FakeReply => ({ body: JSON.stringify({ choices: [{ message: { content } }] }) });
