export type RealtimeSpeechErrorCode =
  | "auth_failed"
  | "permission_denied"
  | "unsupported_browser"
  | "connection_failed"
  | "session_expired"
  | "invalid_state"
  | "text_too_long"
  | "provider_error"
  | "unknown";

export type RealtimeSpeechError = {
  code: RealtimeSpeechErrorCode;
  message: string;
  cause?: unknown;
  retryable: boolean;
};

export function createRealtimeSpeechError(
  code: RealtimeSpeechErrorCode,
  message: string,
  options: { cause?: unknown; retryable?: boolean } = {},
): RealtimeSpeechError {
  return {
    code,
    message,
    cause: options.cause,
    retryable: options.retryable ?? false,
  };
}

export function normalizeError(
  cause: unknown,
  fallbackCode: RealtimeSpeechErrorCode = "unknown",
): RealtimeSpeechError {
  if (isRealtimeSpeechError(cause)) {
    return cause;
  }

  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return createRealtimeSpeechError(
      "permission_denied",
      "Microphone permission was denied.",
      { cause },
    );
  }

  if (cause instanceof Error) {
    return createRealtimeSpeechError(fallbackCode, cause.message, { cause });
  }

  return createRealtimeSpeechError(fallbackCode, "Unknown realtime speech error.", {
    cause,
  });
}

function isRealtimeSpeechError(value: unknown): value is RealtimeSpeechError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "retryable" in value
  );
}
