// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeAuth, TextToSpeechOptions } from "@realtime-speech/core";
import { useTextToSpeech } from "../src/useTextToSpeech";

const mocks = vi.hoisted(() => ({
  cancelAll: vi.fn(),
  cancelCurrent: vi.fn(),
  clearQueue: vi.fn(),
  close: vi.fn(),
  options: undefined as TextToSpeechOptions | undefined,
  preconnect: vi.fn(async () => undefined),
  sendText: vi.fn(() => ({ id: "tts_1", cancel: vi.fn() })),
}));

vi.mock("@realtime-speech/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@realtime-speech/core")>();

  return {
    ...actual,
    RealtimeTextToSpeech: vi.fn().mockImplementation(function (
      options: TextToSpeechOptions,
    ) {
      mocks.options = options;

      return {
        preconnect: mocks.preconnect,
        sendText: mocks.sendText,
        cancelCurrent: mocks.cancelCurrent,
        clearQueue: mocks.clearQueue,
        cancelAll: mocks.cancelAll,
        close: mocks.close,
      };
    }),
  };
});

const auth: RealtimeAuth = {
  mode: "ephemeral",
  getClientSecret: async () => "test-client-secret",
};

describe("useTextToSpeech", () => {
  beforeEach(() => {
    mocks.cancelAll.mockReset();
    mocks.cancelCurrent.mockReset();
    mocks.clearQueue.mockReset();
    mocks.close.mockReset();
    mocks.options = undefined;
    mocks.preconnect.mockReset();
    mocks.preconnect.mockResolvedValue(undefined);
    mocks.sendText.mockReset();
    mocks.sendText.mockReturnValue({ id: "tts_1", cancel: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("delegates commands to the controller and closes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useTextToSpeech({
        auth,
        voice: "marin",
        maxTextChars: 500,
      }),
    );

    act(() => {
      result.current.sendText("hello");
      result.current.cancelCurrent();
      result.current.clearQueue();
      result.current.cancelAll();
    });
    await act(async () => {
      await result.current.preconnect();
    });

    expect(mocks.options).toMatchObject({
      auth,
      voice: "marin",
      maxTextChars: 500,
    });
    expect(mocks.sendText).toHaveBeenCalledWith("hello");
    expect(mocks.cancelCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.clearQueue).toHaveBeenCalledTimes(1);
    expect(mocks.cancelAll).toHaveBeenCalledTimes(1);
    expect(mocks.preconnect).toHaveBeenCalledTimes(1);

    unmount();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
