import { getEphemeralClientSecret } from "./auth";
import { createRealtimeSpeechError } from "./errors";
import type {
  TextToSpeechTransport,
  TextToSpeechTransportFactoryOptions,
} from "./tts";

export async function createOpenAIRealtimeTextToSpeechTransport(
  options: TextToSpeechTransportFactoryOptions,
): Promise<TextToSpeechTransport> {
  const clientSecret = await getEphemeralClientSecret(options.auth, {
    purpose: "tts",
    voice: options.voice,
  });

  return await new Promise<TextToSpeechTransport>((resolve, reject) => {
    const url = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
    const ws = new WebSocket(url, [
      "realtime",
      `openai-insecure-api-key.${clientSecret}`,
    ]);
    let settled = false;

    ws.addEventListener("open", () => {
      settled = true;
      resolve({
        isOpen: () => ws.readyState === WebSocket.OPEN,
        send: (event) => {
          ws.send(JSON.stringify(event));
        },
        close: () => {
          ws.close();
        },
      });
    });

    ws.addEventListener("message", (message) => {
      options.onEvent(parseEvent(message.data));
    });

    ws.addEventListener("error", () => {
      const error = createRealtimeSpeechError(
        "connection_failed",
        "Realtime TTS WebSocket failed.",
        { retryable: true },
      );

      if (!settled) {
        settled = true;
        reject(error);
        return;
      }

      options.onError(error);
    });

    ws.addEventListener("close", () => {
      options.onClose();
    });
  });
}

function parseEvent(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}
