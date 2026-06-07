// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeAuth,
  SpeechToTextTransportOptions,
} from "@realtime-speech/core";
import { useSpeechToText } from "../src/useSpeechToText";

const mocks = vi.hoisted(() => ({
  clearBuffer: vi.fn(),
  close: vi.fn(),
  commit: vi.fn(),
  connectSpeechToText: vi.fn(),
  options: undefined as SpeechToTextTransportOptions | undefined,
}));

vi.mock("@realtime-speech/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@realtime-speech/core")>();

  return {
    ...actual,
    connectSpeechToText: mocks.connectSpeechToText,
  };
});

const auth: RealtimeAuth = {
  mode: "ephemeral",
  getClientSecret: async () => "test-client-secret",
};

describe("useSpeechToText", () => {
  beforeEach(() => {
    mocks.clearBuffer.mockReset();
    mocks.close.mockReset();
    mocks.commit.mockReset();
    mocks.options = undefined;
    mocks.connectSpeechToText.mockImplementation(async (options) => {
      mocks.options = options;
      options.onStatus?.("listening");

      return {
        mediaStream: {} as MediaStream,
        status: "listening",
        commit: mocks.commit,
        clearBuffer: mocks.clearBuffer,
        close: mocks.close,
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates live transcript from stream chunks and closes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useSpeechToText({
        auth,
        mode: "continuous",
        vad: { silenceDurationMs: 400 },
      }),
    );

    await act(async () => {
      await result.current.startNew();
    });

    expect(result.current.isListening).toBe(true);
    expect(mocks.connectSpeechToText).toHaveBeenCalledWith(
      expect.objectContaining({
        auth,
        mode: "continuous",
        vad: { silenceDurationMs: 400 },
      }),
    );

    act(() => {
      mocks.options?.onStreamChunk?.("hello");
      mocks.options?.onStreamChunk?.(" world");
    });

    expect(result.current.transcript).toBe("hello world");

    act(() => {
      result.current.commit();
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
