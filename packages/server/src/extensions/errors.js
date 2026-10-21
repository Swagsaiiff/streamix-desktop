export class ExtensionError extends Error {
  constructor(message, code = "EXTENSION_ERROR", extensionId = null, cause = null) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
    this.extensionId = extensionId;
    if (cause) this.cause = cause;
  }
}

export class ItemNotFoundError extends ExtensionError {
  constructor(itemId, extensionId = null) {
    super(`Item '${itemId}' not found in provider`, "ITEM_NOT_FOUND", extensionId);
  }
}

export class SourceUnavailableError extends ExtensionError {
  constructor(reason, code = "SOURCE_UNAVAILABLE", extensionId = null) {
    super(reason, code, extensionId);
  }
}

export class ExtensionTimeoutError extends ExtensionError {
  constructor(operation, timeoutMs, extensionId = null) {
    super(`Extension operation '${operation}' timed out after ${timeoutMs}ms`, "TIMEOUT", extensionId);
  }
}
