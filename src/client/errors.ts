export type KankaErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export class KankaError extends Error {
  readonly code: KankaErrorCode;
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(
    code: KankaErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "KankaError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export interface KankaValidationDetails {
  fields: Record<string, string[]>;
}

interface KankaErrorBody {
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

export async function buildErrorFromResponse(response: Response): Promise<KankaError> {
  const status = response.status;
  let body: KankaErrorBody | undefined;
  let bodyText = "";

  try {
    bodyText = await response.text();
    if (bodyText) body = JSON.parse(bodyText) as KankaErrorBody;
  } catch {
    body = undefined;
  }

  const message =
    body?.message ?? body?.error ?? (bodyText.slice(0, 200) || response.statusText);

  if (status === 401) {
    return new KankaError("AUTH_REQUIRED", `Unauthorized: ${message}`, { status });
  }
  if (status === 403) {
    return new KankaError("FORBIDDEN", `Forbidden: ${message}`, { status });
  }
  if (status === 404) {
    return new KankaError("NOT_FOUND", `Not found: ${message}`, { status });
  }
  if (status === 422 && body?.errors) {
    const details: KankaValidationDetails = { fields: body.errors };
    return new KankaError("VALIDATION_ERROR", `Validation failed: ${message}`, {
      status,
      details,
    });
  }
  if (status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return new KankaError("RATE_LIMITED", `Rate limit exceeded`, {
      status,
      details: { retryAfterSeconds: retryAfter ? Number.parseInt(retryAfter, 10) : undefined },
    });
  }
  if (status >= 500) {
    return new KankaError("SERVER_ERROR", `Server error ${status}: ${message}`, { status });
  }
  return new KankaError("UNKNOWN", `HTTP ${status}: ${message}`, { status });
}
