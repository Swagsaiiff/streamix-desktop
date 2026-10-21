import { logger } from "../logger.js";

const SENSITIVE_KEYS = new Set([
  "token",
  "auth",
  "key",
  "secret",
  "signature",
  "sig",
  "password",
  "pass",
  "cookie",
  "authorization",
  "x-amz-signature",
  "x-amz-security-token"
]);

/**
 * Sanitizes URLs, query parameters, headers, and metadata to redact secrets.
 */
export function redactSensitive(input) {
  if (input == null) return input;
  if (typeof input === "string") {
    // Redact URLs with query parameters containing sensitive tokens
    try {
      if (input.includes("://") && input.includes("?")) {
        const parsed = new URL(input);
        for (const [k] of parsed.searchParams.entries()) {
          if (Array.from(SENSITIVE_KEYS).some((s) => k.toLowerCase().includes(s))) {
            parsed.searchParams.set(k, "[REDACTED]");
          }
        }
        return parsed.toString();
      }
    } catch {
      // not a full URL, fallback to regex
    }
    return input
      .replace(/((?:api_?key|token|auth|secret|sig|password)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(?:Bearer\s+)[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  }

  if (Array.isArray(input)) {
    return input.map(redactSensitive);
  }

  if (typeof input === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(input)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower) || lower.includes("secret") || lower.includes("token") || lower.includes("password")) {
        cleaned[key] = "[REDACTED]";
      } else {
        cleaned[key] = redactSensitive(value);
      }
    }
    return cleaned;
  }

  return input;
}

export class DiagnosticBuffer {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.buffer = [];
    this.sequence = 0;
  }

  log(level, component, stage, message, meta = null) {
    const entry = {
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      level: String(level).toUpperCase(),
      component: String(component || "system"),
      stage: String(stage || "general"),
      message: redactSensitive(String(message || "")),
      meta: meta ? redactSensitive(meta) : null
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }

    // Mirror to standard server logger
    const logMethod = entry.level === "ERROR" ? logger.error : entry.level === "WARN" ? logger.warn : logger.info;
    logMethod?.(`[${entry.component}] [${entry.stage}] ${entry.message}`, entry.meta || {});

    return entry;
  }

  debug(component, stage, message, meta) {
    return this.log("DEBUG", component, stage, message, meta);
  }

  info(component, stage, message, meta) {
    return this.log("INFO", component, stage, message, meta);
  }

  warn(component, stage, message, meta) {
    return this.log("WARN", component, stage, message, meta);
  }

  error(component, stage, message, meta) {
    return this.log("ERROR", component, stage, message, meta);
  }

  getLogs({ level = null, component = null, search = null, sinceId = 0, limit = 200 } = {}) {
    let result = this.buffer;

    if (sinceId > 0) {
      result = result.filter((e) => e.id > sinceId);
    }

    if (level && level !== "ALL") {
      const target = String(level).toUpperCase();
      result = result.filter((e) => e.level === target);
    }

    if (component && component !== "ALL") {
      const compLower = String(component).toLowerCase();
      result = result.filter((e) => e.component.toLowerCase() === compLower);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((e) =>
        e.message.toLowerCase().includes(q) ||
        e.component.toLowerCase().includes(q) ||
        e.stage.toLowerCase().includes(q)
      );
    }

    return result.slice(-Math.min(limit, this.maxEntries));
  }

  clear() {
    this.buffer = [];
  }
}

export const diagnosticLogger = new DiagnosticBuffer(500);
