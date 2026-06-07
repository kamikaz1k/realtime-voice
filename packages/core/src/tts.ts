import { type RealtimeAuth } from "./auth";
import { base64ToArrayBuffer, type AudioChunk } from "./audio";
import {
  createRealtimeSpeechError,
  normalizeError,
  type RealtimeSpeechError,
} from "./errors";
import { createOpenAIRealtimeTextToSpeechTransport } from "./tts-transport";

export type TextToSpeechStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "streaming"
  | "paused"
  | "error";

export type TtsQueueItem = {
  id: string;
  text: string;
  voice: string;
  createdAt: number;
};

type TtsQueueEntry = TtsQueueItem & {
  // A queue entry can be canceled while processQueue is awaiting preconnect.
  // The entry stays as the current reservation until processQueue resumes and
  // either skips it or sends it, keeping currentItem assignment in one place.
  isCancelled: boolean;
};

export type TextToSpeechHandle = {
  id: string;
  cancel: () => void;
};

export type TextToSpeechOptions = {
  auth: RealtimeAuth;
  voice?: string;
  speed?: number;
  maxTextChars?: number;
  transportFactory?: TextToSpeechTransportFactory;
  onStatus?: (status: TextToSpeechStatus) => void;
  onStateChange?: (state: TextToSpeechSnapshot) => void;
  onStreamChunk?: (chunk: AudioChunk) => void;
  onItemStart?: (item: TtsQueueItem) => void;
  onItemDone?: (item: TtsQueueItem) => void;
  onItemError?: (event: { item: TtsQueueItem; error: RealtimeSpeechError }) => void;
  onTextTooLong?: (event: { text: string; maxTextChars: number }) => void;
  onError?: (error: RealtimeSpeechError) => void;
};

export type TextToSpeechSnapshot = {
  status: TextToSpeechStatus;
  isConnected: boolean;
  isStreaming: boolean;
  queueSize: number;
  currentItem: TtsQueueItem | null;
  error: RealtimeSpeechError | null;
};

export type TextToSpeechTransport = {
  isOpen: () => boolean;
  send: (event: unknown) => void;
  close: () => void;
};

export type TextToSpeechTransportFactoryOptions = {
  auth: RealtimeAuth;
  voice?: string;
  onEvent: (event: unknown) => void;
  onClose: () => void;
  onError: (error: RealtimeSpeechError) => void;
};

export type TextToSpeechTransportFactory = (
  options: TextToSpeechTransportFactoryOptions,
) => Promise<TextToSpeechTransport>;

type ServerEvent = {
  type?: string;
  delta?: string;
  response_id?: string;
  item_id?: string;
  error?: {
    message?: string;
  };
};

export class RealtimeTextToSpeech {
  private readonly options: TextToSpeechOptions;
  private transport: TextToSpeechTransport | null = null;
  private status: TextToSpeechStatus = "idle";
  private queue: TtsQueueEntry[] = [];
  private currentItem: TtsQueueEntry | null = null;
  private currentResponseId = "";
  private chunkIndex = 0;
  private error: RealtimeSpeechError | null = null;

  constructor(options: TextToSpeechOptions) {
    this.options = options;
  }

  getSnapshot(): TextToSpeechSnapshot {
    return {
      status: this.status,
      isConnected: this.transport?.isOpen() ?? false,
      isStreaming: this.status === "streaming",
      queueSize: this.queue.length,
      currentItem:
        this.currentItem && !this.currentItem.isCancelled
          ? toPublicItem(this.currentItem)
          : null,
      error: this.error,
    };
  }

  async preconnect(): Promise<void> {
    if (this.transport?.isOpen()) {
      return;
    }

    this.setStatus("connecting");

    try {
      const transportFactory =
        this.options.transportFactory ?? createOpenAIRealtimeTextToSpeechTransport;

      this.transport = await transportFactory({
        auth: this.options.auth,
        voice: this.options.voice,
        onEvent: (event) => {
          this.handleEvent(event);
        },
        onClose: () => {
          this.transport = null;
          if (this.status !== "idle") {
            this.setStatus("idle");
          }
        },
        onError: (error) => {
          this.failCurrent(error);
        },
      });

      this.send(buildTtsSessionUpdate(this.options));
      this.setStatus("ready");
    } catch (cause) {
      const error = normalizeError(cause, "connection_failed");
      this.failConnection(error);
      throw error;
    }
  }

  sendText(text: string): TextToSpeechHandle {
    const maxTextChars = this.options.maxTextChars ?? 8000;
    const id = crypto.randomUUID();
    const item: TtsQueueEntry = {
      id,
      text,
      voice: this.options.voice ?? "marin",
      createdAt: Date.now(),
      isCancelled: false,
    };

    if (text.length > maxTextChars) {
      const error = createRealtimeSpeechError(
        "text_too_long",
        `Text is ${text.length} characters, above the ${maxTextChars} character limit.`,
      );
      this.error = error;
      this.options.onTextTooLong?.({ text, maxTextChars });
      this.options.onItemError?.({ item: toPublicItem(item), error });
      this.emitState();
      return { id, cancel: () => undefined };
    }

    this.queue.push(item);
    this.emitState();
    void this.processQueue();

    return {
      id,
      cancel: () => this.cancelItem(id),
    };
  }

  cancelCurrent(): void {
    const item = this.currentItem;
    if (item) {
      item.isCancelled = true;

      if (this.queue[0] === item) {
        this.queue.shift();
        this.emitState();
        return;
      }

      if (this.transport?.isOpen()) {
        this.send({ type: "response.cancel" });
      }

      this.currentItem = null;
      this.currentResponseId = "";
      this.chunkIndex = 0;
      this.setStatus(
        this.queue.length > 0 && this.transport?.isOpen() ? "ready" : "idle",
      );
      void this.processQueue();
    }
  }

  clearQueue(): void {
    this.queue.forEach((item) => {
      item.isCancelled = true;
    });
    this.queue = [];
    this.emitState();
  }

  cancelAll(): void {
    const item = this.currentItem;
    const isReserved = item ? this.queue[0] === item : false;

    this.queue.forEach((queued) => {
      queued.isCancelled = true;
    });
    if (item) {
      item.isCancelled = true;
    }

    this.queue = [];

    if (item && !isReserved) {
      if (this.transport?.isOpen()) {
        this.send({ type: "response.cancel" });
      }

      this.currentItem = null;
      this.currentResponseId = "";
      this.chunkIndex = 0;
      this.setStatus("idle");
      return;
    }

    this.emitState();
  }

  close(): void {
    this.queue.forEach((item) => {
      item.isCancelled = true;
    });
    if (this.currentItem) {
      this.currentItem.isCancelled = true;
    }
    this.queue = [];
    this.currentItem = null;
    this.transport?.close();
    this.transport = null;
    this.setStatus("idle");
  }

  private async processQueue(): Promise<void> {
    if (this.currentItem || this.queue.length === 0) {
      return;
    }

    const item = this.queue[0]!;
    this.currentItem = item;
    this.currentResponseId = "";
    this.chunkIndex = 0;
    this.error = null;
    this.emitState();

    try {
      await this.preconnect();
    } catch {
      this.currentItem = null;
      this.currentResponseId = "";
      this.chunkIndex = 0;
      this.emitState();
      return;
    }

    if (item.isCancelled) {
      this.currentItem = null;
      this.currentResponseId = "";
      this.chunkIndex = 0;
      this.emitState();
      void this.processQueue();
      return;
    }

    this.queue.shift();

    try {
      this.setStatus("streaming");
      this.options.onItemStart?.(toPublicItem(item));
      this.send(buildTextInputEvent(item));
      this.send(buildResponseCreateEvent(item, this.options));
      this.emitState();
    } catch (cause) {
      this.failCurrent(normalizeError(cause, "connection_failed"));
    }
  }

  private handleEvent(event: unknown): void {
    if (!isRecord(event) || typeof event.type !== "string") {
      return;
    }

    const serverEvent = event as ServerEvent;

    if (serverEvent.type === "error") {
      this.failCurrent(
        createRealtimeSpeechError(
          "provider_error",
          serverEvent.error?.message ?? "OpenAI Realtime returned an error.",
        ),
      );
      return;
    }

    if (
      (serverEvent.type === "response.output_audio.delta" ||
        serverEvent.type === "response.audio.delta") &&
      serverEvent.delta &&
      this.currentItem
    ) {
      const responseId =
        serverEvent.response_id || this.currentResponseId || this.currentItem.id;
      this.currentResponseId = responseId;
      this.options.onStreamChunk?.({
        data: base64ToArrayBuffer(serverEvent.delta),
        format: "pcm16",
        sampleRate: 24000,
        channels: 1,
        responseId,
        itemId: serverEvent.item_id || this.currentItem.id,
        index: this.chunkIndex,
      });
      this.chunkIndex += 1;
      return;
    }

    if (serverEvent.type === "response.done" && this.currentItem) {
      const done = this.currentItem;
      this.currentItem = null;
      this.currentResponseId = "";
      this.chunkIndex = 0;
      this.options.onItemDone?.(toPublicItem(done));
      this.setStatus(this.queue.length > 0 ? "ready" : "idle");
      void this.processQueue();
    }
  }

  private cancelItem(id: string): void {
    if (this.currentItem?.id === id) {
      this.cancelCurrent();
      return;
    }

    this.queue = this.queue.filter((item) => {
      if (item.id === id) {
        item.isCancelled = true;
        return false;
      }

      return true;
    });
    this.emitState();
  }

  private failCurrent(error: RealtimeSpeechError): void {
    this.error = error;
    this.options.onError?.(error);

    if (this.currentItem) {
      this.options.onItemError?.({ item: toPublicItem(this.currentItem), error });
      this.currentItem = null;
    }

    this.setStatus("error");
  }

  private failConnection(error: RealtimeSpeechError): void {
    this.error = error;
    this.options.onError?.(error);
    this.setStatus("error");
  }

  private send(event: unknown): void {
    if (!this.transport?.isOpen()) {
      throw createRealtimeSpeechError(
        "invalid_state",
        "Realtime TTS WebSocket is not open.",
      );
    }

    this.transport.send(event);
  }

  private setStatus(status: TextToSpeechStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
    this.emitState();
  }

  private emitState(): void {
    this.options.onStateChange?.(this.getSnapshot());
  }
}

function buildTtsSessionUpdate(options: TextToSpeechOptions) {
  return {
    type: "session.update",
    session: {
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
          voice: options.voice ?? "marin",
          ...(options.speed ? { speed: options.speed } : {}),
        },
      },
    },
  };
}

function buildTextInputEvent(item: TtsQueueItem) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: item.text,
        },
      ],
    },
  };
}

function buildResponseCreateEvent(item: TtsQueueItem, options: TextToSpeechOptions) {
  return {
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      audio: {
        output: {
          format: {
            type: "audio/pcm",
            rate: 24000,
          },
          voice: item.voice,
          ...(options.speed ? { speed: options.speed } : {}),
        },
      },
    },
  };
}

function toPublicItem(item: TtsQueueEntry): TtsQueueItem {
  return {
    id: item.id,
    text: item.text,
    voice: item.voice,
    createdAt: item.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
