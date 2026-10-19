export class ProviderError extends Error {
  constructor(message, code = "provider_error", cause) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export class BaseProvider {
  constructor({ name, timeoutMs = 15000, onOutcome } = {}) {
    this.name = name;
    this.timeoutMs = timeoutMs;
    this.onOutcome = onOutcome;
  }

  getUserAgent() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  }

  async fetchText(url, { timeoutMs = this.timeoutMs, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": this.getUserAgent(), Accept: "application/json", ...headers },
        signal: controller.signal
      });
      if (!res.ok) {
        throw new ProviderError(`upstream responded ${res.status} for ${url}`, "http");
      }
      return await res.text();
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err.name === "AbortError") {
        throw new ProviderError(`request timed out after ${timeoutMs}ms: ${url}`, "timeout", err);
      }
      throw new ProviderError(`network error: ${err.message}`, "network", err);
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchJson(url, options) {
    try {
      const text = await this.fetchText(url, options);
      const parsed = JSON.parse(text);
      this.onOutcome?.({ ok: true, operation: "fetch", at: Date.now() });
      return parsed;
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : "parse";
      this.onOutcome?.({ ok: false, operation: "fetch", code, at: Date.now() });
      if (err instanceof ProviderError) throw err;
      throw new ProviderError("invalid JSON from upstream", "parse", err);
    }
  }
}

export function isRetryableError(err) {
  if (!(err instanceof ProviderError)) return false;
  return err.code === "timeout" || err.code === "network" || err.code === "http";
}
