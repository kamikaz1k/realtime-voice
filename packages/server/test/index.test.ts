import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDefaultSession,
  createRealtimeSessionHandler,
} from "../src/index";

describe("buildDefaultSession", () => {
  it("builds low-latency transcription sessions by default", () => {
    expect(buildDefaultSession({ language: "en" })).toEqual({
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "gpt-realtime-whisper",
            language: "en",
            delay: "low",
          },
          turn_detection: null,
        },
      },
    });
  });

  it("builds PCM realtime TTS sessions", () => {
    expect(buildDefaultSession({ purpose: "tts", voice: "verse" })).toEqual({
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
          voice: "verse",
        },
      },
    });
  });
});

describe("createRealtimeSessionHandler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-POST requests", async () => {
    const handler = createRealtimeSessionHandler({ apiKey: "test-key" });

    const response = await handler(new Request("https://example.test/token"));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: "Method not allowed" });
  });

  it("short-circuits when authorize returns a Response", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const handler = createRealtimeSessionHandler({
      apiKey: "test-key",
      authorize: () => new Response("Unauthorized", { status: 401 }),
    });

    const response = await handler(
      new Request("https://example.test/token", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards client secret requests to OpenAI with session and safety metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: "client-secret" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = createRealtimeSessionHandler({
      apiKey: "test-key",
      expiresAfterSeconds: 300,
      getSafetyIdentifier: () => "demo-user",
    });

    const response = await handler(
      new Request("https://example.test/token", {
        method: "POST",
        body: JSON.stringify({ purpose: "tts", voice: "marin" }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ value: "client-secret" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "demo-user",
    });
    expect(JSON.parse(init.body)).toMatchObject({
      expires_after: {
        anchor: "created_at",
        seconds: 300,
      },
      session: {
        type: "realtime",
        audio: {
          output: {
            voice: "marin",
          },
        },
      },
    });
  });
});
