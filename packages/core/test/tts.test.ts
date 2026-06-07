import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeTextToSpeech,
  type TextToSpeechTransport,
  type TextToSpeechTransportFactoryOptions,
} from "../src/tts";
import type { RealtimeAuth } from "../src/auth";

const auth: RealtimeAuth = {
  mode: "ephemeral",
  getClientSecret: async () => "test-client-secret",
};

function createOpenTransport(sent: unknown[]): TextToSpeechTransport {
  return {
    isOpen: () => true,
    send: (event) => sent.push(event),
    close: vi.fn(),
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RealtimeTextToSpeech", () => {
  it("streams queued text FIFO and advances on response.done", async () => {
    let transportOptions: TextToSpeechTransportFactoryOptions | undefined;
    const sent: unknown[] = [];
    const starts: string[] = [];
    const done: string[] = [];
    const chunks: Array<{ itemId: string; index: number; bytes: number[] }> = [];
    const states: string[] = [];

    const tts = new RealtimeTextToSpeech({
      auth,
      voice: "marin",
      transportFactory: async (options) => {
        transportOptions = options;
        return createOpenTransport(sent);
      },
      onStatus: (status) => states.push(status),
      onItemStart: (item) => starts.push(item.text),
      onItemDone: (item) => done.push(item.text),
      onStreamChunk: (chunk) => {
        chunks.push({
          itemId: chunk.itemId,
          index: chunk.index,
          bytes: Array.from(new Uint8Array(chunk.data)),
        });
      },
    });

    tts.sendText("first");
    tts.sendText("second");

    await vi.waitFor(() => expect(starts).toEqual(["first"]));
    expect(tts.getSnapshot()).toMatchObject({
      status: "streaming",
      queueSize: 1,
    });
    expect(sent).toMatchObject([
      { type: "session.update" },
      { type: "conversation.item.create" },
      { type: "response.create" },
    ]);

    transportOptions?.onEvent({
      type: "response.output_audio.delta",
      delta: "AQIDBA==",
      response_id: "response_1",
      item_id: "item_1",
    });

    expect(chunks).toEqual([
      {
        itemId: "item_1",
        index: 0,
        bytes: [1, 2, 3, 4],
      },
    ]);

    transportOptions?.onEvent({ type: "response.done" });

    await vi.waitFor(() => expect(starts).toEqual(["first", "second"]));
    expect(done).toEqual(["first"]);
    expect(states).toContain("ready");
    expect(tts.getSnapshot()).toMatchObject({
      status: "streaming",
      queueSize: 0,
    });
  });

  it("returns a cancel handle that removes queued items", async () => {
    const sent: unknown[] = [];
    const starts: string[] = [];
    const tts = new RealtimeTextToSpeech({
      auth,
      transportFactory: async () => createOpenTransport(sent),
      onItemStart: (item) => starts.push(item.text),
    });

    tts.sendText("first");
    const second = tts.sendText("second");
    second.cancel();

    await vi.waitFor(() => expect(starts).toEqual(["first"]));
    expect(tts.getSnapshot().queueSize).toBe(0);
  });

  it("reports over-limit text without opening a transport", () => {
    const itemErrors: string[] = [];
    const textTooLong = vi.fn();
    const transportFactory = vi.fn(async () => createOpenTransport([]));
    const tts = new RealtimeTextToSpeech({
      auth,
      maxTextChars: 3,
      transportFactory,
      onTextTooLong: textTooLong,
      onItemError: ({ error }) => itemErrors.push(error.code),
    });

    const handle = tts.sendText("abcd");
    handle.cancel();

    expect(textTooLong).toHaveBeenCalledWith({
      text: "abcd",
      maxTextChars: 3,
    });
    expect(itemErrors).toEqual(["text_too_long"]);
    expect(transportFactory).not.toHaveBeenCalled();
    expect(tts.getSnapshot().error).toMatchObject({ code: "text_too_long" });
  });

  it("keeps a reserved item queued when preconnect fails", async () => {
    const errors: string[] = [];
    const itemErrors = vi.fn();
    const tts = new RealtimeTextToSpeech({
      auth,
      transportFactory: async () => {
        throw new Error("network unavailable");
      },
      onError: (error) => errors.push(error.code),
      onItemError: itemErrors,
    });

    tts.sendText("first");

    await vi.waitFor(() =>
      expect(tts.getSnapshot()).toMatchObject({
        status: "error",
        queueSize: 1,
        currentItem: null,
      }),
    );
    expect(errors).toEqual(["connection_failed"]);
    expect(itemErrors).not.toHaveBeenCalled();
  });

  it("does not send a reserved item canceled while preconnect is pending", async () => {
    const sent: unknown[] = [];
    const starts: string[] = [];
    const transport = deferred<TextToSpeechTransport>();
    const tts = new RealtimeTextToSpeech({
      auth,
      transportFactory: async () => transport.promise,
      onItemStart: (item) => starts.push(item.text),
    });

    const handle = tts.sendText("first");
    handle.cancel();

    expect(tts.getSnapshot()).toMatchObject({
      queueSize: 0,
      currentItem: null,
    });

    transport.resolve(createOpenTransport(sent));

    await vi.waitFor(() => expect(tts.getSnapshot().status).toBe("ready"));
    expect(starts).toEqual([]);
    expect(sent).toMatchObject([{ type: "session.update" }]);
    expect(
      sent.some((event) => {
        return (
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "conversation.item.create"
        );
      }),
    ).toBe(false);
  });

  it("does not send reserved or queued items canceled by cancelAll while preconnect is pending", async () => {
    const sent: unknown[] = [];
    const starts: string[] = [];
    const transport = deferred<TextToSpeechTransport>();
    const tts = new RealtimeTextToSpeech({
      auth,
      transportFactory: async () => transport.promise,
      onItemStart: (item) => starts.push(item.text),
    });

    tts.sendText("first");
    tts.sendText("second");
    tts.cancelAll();

    expect(tts.getSnapshot()).toMatchObject({
      queueSize: 0,
      currentItem: null,
    });

    transport.resolve(createOpenTransport(sent));

    await vi.waitFor(() => expect(tts.getSnapshot().status).toBe("ready"));
    expect(starts).toEqual([]);
    expect(sent).toMatchObject([{ type: "session.update" }]);
    expect(sent).toHaveLength(1);
  });
});
