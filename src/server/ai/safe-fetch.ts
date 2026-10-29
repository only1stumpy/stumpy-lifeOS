import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";

export type AiProviderTransportFailureKind =
  | "quota_exceeded"
  | "credits_exhausted"
  | "unavailable"
  | "configuration"
  | "invalid_response"
  | "other";

export class SafeHttpsError extends Error {
  constructor(readonly kind: AiProviderTransportFailureKind) {
    super(kind);
    this.name = "SafeHttpsError";
  }
}

export type ValidatedAiEndpoint = {
  /** Canonical HTTPS base URL with no trailing slash (except the origin root). */
  endpoint: string;
  /** Resolved, verified addresses pinned for the outbound TLS connection. */
  addresses: LookupAddress[];
};

const DEFAULT_TIMEOUT_MS = 18_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const DNS_TIMEOUT_MS = 5_000;
const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
  ".example",
];

/**
 * Parse an OpenAI-compatible base URL and ensure every DNS answer is public.
 * The returned address set is later pinned into `https.request` so DNS cannot
 * change between validation and connection establishment.
 */
export async function validateAiProviderEndpoint(input: string): Promise<ValidatedAiEndpoint> {
  if (typeof input !== "string" || input.length === 0 || input.length > 500) {
    throw new SafeHttpsError("configuration");
  }

  let url: URL;
  const trimmedInput = input.trim();
  try {
    url = new URL(trimmedInput);
  } catch {
    throw new SafeHttpsError("configuration");
  }
  const authority = trimmedInput.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    authority.includes("@") ||
    trimmedInput.includes("?") ||
    trimmedInput.includes("#") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.hostname.includes("%") ||
    hasPathTraversal(trimmedInput, authority)
  ) {
    throw new SafeHttpsError("configuration");
  }

  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalizedHostname === "localhost" ||
    BLOCKED_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix)) ||
    !normalizedHostname.includes(".") && isIP(normalizedHostname) === 0
  ) {
    throw new SafeHttpsError("configuration");
  }

  const directFamily = isIP(normalizedHostname);
  let addresses: LookupAddress[];
  if (directFamily !== 0) {
    addresses = [{ address: normalizedHostname, family: directFamily }];
  } else {
    try {
      addresses = await resolveAll(normalizedHostname);
    } catch {
      throw new SafeHttpsError("configuration");
    }
  }

  if (!areAllAddressesPublic(addresses)) {
    throw new SafeHttpsError("configuration");
  }

  // Normalize the base endpoint. URL removes dot segments before validation,
  // so we inspect the original URL above and keep only the canonical path.
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path || "/";
  return {
    endpoint: url.toString().replace(/\/$/, ""),
    addresses,
  };
}

function resolveAll(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

function hasPathTraversal(input: string, authority: string): boolean {
  const authorityIndex = input.indexOf(authority) + authority.length;
  const rawPath = input.slice(authorityIndex).split(/[?#]/, 1)[0] ?? "";
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return true;
  }
  return decodedPath.split("/").some((part) => part === "." || part === "..");
}

export function areAllAddressesPublic(addresses: readonly Pick<LookupAddress, "address">[]): boolean {
  return addresses.length > 0 && addresses.every(({ address }) => isPublicIpAddress(address));
}

/** Conservative global-address check for IPv4 and IPv6. */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const bytes = parseIpv6(address);
  if (!bytes) return false;

  // IPv4-mapped IPv6 addresses must pass the IPv4 policy too.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPublicIpv4(bytes.slice(12).join("."));
  }

  // Public IPv6 global unicast is 2000::/3. Reject special-purpose ranges
  // inside that space as well as all link-local, multicast and unique-local IPs.
  if ((bytes[0]! & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2]! & 0xf0) === 0x00) return false; // documentation prefix
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    // IETF protocol assignments, benchmarking, documentation and ORCHID.
    const secondGroup = (bytes[2]! << 8) | bytes[3]!;
    if (secondGroup <= 0x02ff) return false;
    if (secondGroup === 0x0db8) return false; // documentation prefix
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4 can encapsulate private IPv4
  return true;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b, c] = octets as [number, number, number, number];

  // Reject unspecified, private, loopback, link-local, carrier NAT, protocol,
  // benchmarking, documentation, multicast and reserved IPv4 ranges.
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b! >= 64 && b! <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a === 255 && b === 255 && c === 255) return false;
  return true;
}

function parseIpv6(address: string): number[] | null {
  if (address.includes("%")) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) return null;

  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}

export type SafeHttpsPostOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
};

/** A cancelable wall-clock deadline used in addition to the socket idle timeout. */
export function createRequestDeadline(timeoutMs: number, onTimeout: () => void): () => void {
  const timeout = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeout);
}

/** POST bounded JSON over a pinned, validated HTTPS connection. */
export async function safeHttpsPost(
  endpoint: string,
  apiKey: string,
  payload: unknown,
  options: SafeHttpsPostOptions = {},
): Promise<{ status: number; body: string }> {
  const validated = await validateAiProviderEndpoint(endpoint);
  const url = new URL(validated.endpoint);
  const requestBody = JSON.stringify(payload);
  if (Buffer.byteLength(requestBody, "utf8") > MAX_REQUEST_BYTES) {
    throw new SafeHttpsError("configuration");
  }

  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, 1_048_576);
  const target = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const lookup: LookupFunction = (_requestedHost, lookupOptions, callback) => {
    if (lookupOptions.all) {
      callback(null, validated.addresses);
      return;
    }
    const record = validated.addresses.find(({ family }) => !lookupOptions.family || family === lookupOptions.family);
    if (!record) {
      callback(Object.assign(new Error("Address family unavailable"), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    callback(null, record.address, record.family);
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = 0;
    const chunks: Buffer[] = [];
    let clearDeadline = () => {};
    const fail = (kind: AiProviderTransportFailureKind) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      reject(new SafeHttpsError(kind));
    };

    const request = httpsRequest(
      {
        protocol: "https:",
        hostname,
        port: url.port ? Number(url.port) : 443,
        path: target,
        method: "POST",
        lookup,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
          "accept-encoding": "identity",
          "content-length": Buffer.byteLength(requestBody, "utf8"),
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          fail("configuration");
          return;
        }
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.byteLength;
          if (responseBytes > maxResponseBytes) {
            response.destroy();
            request.destroy();
            fail("invalid_response");
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", () => fail("unavailable"));
        response.on("end", () => {
          if (settled) return;
          settled = true;
          clearDeadline();
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      fail("unavailable");
    });
    clearDeadline = createRequestDeadline(timeoutMs, () => {
      request.destroy();
      fail("unavailable");
    });
    request.on("error", () => fail("unavailable"));
    request.end(requestBody);
  });
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
