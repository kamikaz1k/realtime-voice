import { afterEach, describe, expect, it, vi } from "vitest";
import { base64ToArrayBuffer, createPcmPlayer, type AudioChunk } from "../src/audio";

describe("audio helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes base64 audio payloads into ArrayBuffers", () => {
    const decoded = new Uint8Array(base64ToArrayBuffer("AQIDBA=="));

    expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
  });

  it("tracks scheduled PCM buffer duration after playback starts", async () => {
    class FakeAudioContext {
      currentTime = 0;
      destination = {};

      createGain() {
        return { connect: vi.fn() };
      }

      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }

      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData: vi.fn() };
      }

      createBuffer(_channels: number, length: number, sampleRate: number) {
        return {
          duration: length / sampleRate,
          getChannelData: () => new Float32Array(length),
        };
      }

      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
        };
      }

      resume = vi.fn(async () => undefined);
      suspend = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    }

    vi.stubGlobal("window", { AudioContext: FakeAudioContext });

    const player = createPcmPlayer();
    const pcm = new Int16Array(2400);
    const chunk: AudioChunk = {
      data: pcm.buffer,
      format: "pcm16",
      sampleRate: 24000,
      channels: 1,
      responseId: "response_1",
      itemId: "item_1",
      index: 0,
    };

    player.enqueue(chunk);
    expect(player.getState().bufferedMs).toBe(0);

    await player.play();

    const state = player.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.bufferedMs).toBeCloseTo(120);
  });
});
