import { describe, expect, it, vi } from "vitest";
import {
  connectSpeechToText,
  type SpeechToTextTransportOptions,
} from "../src/stt";
import type { RealtimeAuth } from "../src/auth";

const auth: RealtimeAuth = {
  mode: "ephemeral",
  getClientSecret: async () => "test-client-secret",
};

function fakeConnection() {
  return {
    mediaStream: {} as MediaStream,
    status: "listening" as const,
    commit: vi.fn(),
    clearBuffer: vi.fn(),
    close: vi.fn(),
  };
}

describe("connectSpeechToText", () => {
  it("accumulates transcript deltas by item and emits final transcripts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));

    let transportOptions: SpeechToTextTransportOptions | undefined;
    const chunks: string[] = [];
    const updates: Array<{ id: string; text: string; final: boolean }> = [];
    const finals: string[] = [];

    await connectSpeechToText({
      auth,
      mode: "continuous",
      transportFactory: async (options) => {
        transportOptions = options;
        return fakeConnection();
      },
      onStreamChunk: (delta) => chunks.push(delta),
      onTranscriptUpdate: (update) => {
        updates.push({
          id: update.utteranceId,
          text: update.text,
          final: update.isFinal,
        });
      },
      onFinal: (utterance) => finals.push(utterance.text),
    });

    transportOptions?.onEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_a",
      delta: "Hello ",
    });
    transportOptions?.onEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_a",
      delta: "world",
    });
    transportOptions?.onEvent({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item_b",
      delta: "Next",
    });
    transportOptions?.onEvent({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item_a",
      transcript: "Hello world.",
    });

    expect(chunks).toEqual(["Hello ", "world", "Next"]);
    expect(updates).toEqual([
      { id: "item_a", text: "Hello ", final: false },
      { id: "item_a", text: "Hello world", final: false },
      { id: "item_b", text: "Next", final: false },
      { id: "item_a", text: "Hello world.", final: true },
    ]);
    expect(finals).toEqual(["Hello world."]);

    vi.useRealTimers();
  });

  it("rejects server VAD for the default live whisper transport", async () => {
    await expect(
      connectSpeechToText({
        auth,
        boundaryDetection: "server_vad",
      }),
    ).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});
