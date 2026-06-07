export type RealtimeSessionPurpose = "stt" | "tts";

export type RealtimeSessionRequestBody = {
  purpose?: RealtimeSessionPurpose;
  language?: string;
  voice?: string;
};

export type CreateRealtimeSessionHandlerOptions = {
  apiKey: string;
  getSafetyIdentifier?: (request: Request) => string | undefined | Promise<string | undefined>;
  authorize?: (request: Request) => void | Response | Promise<void | Response>;
  expiresAfterSeconds?: number;
  buildSession?: (
    body: RealtimeSessionRequestBody,
    request: Request,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

const OPENAI_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/client_secrets";

export function createRealtimeSessionHandler(
  options: CreateRealtimeSessionHandlerOptions,
) {
  return async function handleRealtimeSession(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const authorization = await options.authorize?.(request);
    if (authorization instanceof Response) {
      return authorization;
    }

    let body: RealtimeSessionRequestBody;

    try {
      body = (await request.json()) as RealtimeSessionRequestBody;
    } catch {
      body = {};
    }

    const session = options.buildSession
      ? await options.buildSession(body, request)
      : buildDefaultSession(body);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    };
    const safetyIdentifier = await options.getSafetyIdentifier?.(request);

    if (safetyIdentifier) {
      headers["OpenAI-Safety-Identifier"] = safetyIdentifier;
    }

    const upstream = await fetch(OPENAI_CLIENT_SECRET_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: options.expiresAfterSeconds ?? 600,
        },
        session,
      }),
    });
    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  };
}

export function buildDefaultSession(body: RealtimeSessionRequestBody) {
  if (body.purpose === "tts") {
    return {
      type: "realtime",
      model: "gpt-realtime",
      output_modalities: ["audio"],
      instructions: "Speak the user's provided text clearly and naturally.",
      audio: {
        output: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          voice: body.voice ?? "marin",
        },
      },
    };
  }

  return {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: "gpt-realtime-whisper",
          ...(body.language ? { language: body.language } : {}),
          delay: "low",
        },
        turn_detection: null,
      },
    },
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
