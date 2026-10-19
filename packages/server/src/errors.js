import { ProviderError } from "./providers/base.js";

function statusForCode(code) {
  switch (code) {
    case "validation":
      return 400;
    case "not_found":
      return 404;
    case "access_denied":
      return 403;
    case "timeout":
      return 504;
    case "unsupported":
      return 422;
    case "parse":
    case "network":
    case "http":
      return 502;
    default:
      return 502;
  }
}

export function safeProviderMessage(err) {
  if (!(err instanceof ProviderError)) return "An unexpected error occurred.";
  switch (err.code) {
    case "timeout":
      return "Upstream provider request timed out.";
    case "network":
      return "Upstream provider is unreachable.";
    case "http":
    case "parse":
      return "Upstream provider returned an invalid response.";
    default:
      return err.message;
  }
}

export function sendError(res, err) {
  if (err instanceof ProviderError) {
    const status = statusForCode(err.code);
    const kind = err.code === "validation" ? "validation_error" : "provider_error";
    return res.status(status).json({ error: kind, code: err.code, message: safeProviderMessage(err) });
  }
  return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred." });
}