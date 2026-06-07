import { type RealtimeAuth } from "./auth";
import {
  createRealtimeSpeechError,
  normalizeError,
  type RealtimeSpeechError,
} from "./errors";
import { createOpenAIWebRtcSpeechToTextTransport } from "./stt-transport";

export type SpeechToTextMode = "single" | "continuous";
export type SpeechBoundaryDetection = "client_vad" | "manual" | "server_vad";

export type TranscriptUpdate = {
  utteranceId: string;
  delta: string;
  text: string;
  isFinal: boolean;
  startedAt?: number;
  endedAt?: number;
  confidence?: number;
};

export type SpeechToTextStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "stopping"
  | "closed"
  | "error";

export type ClientVadOptions = {
  startThreshold?: number;
  stopThreshold?: number;
  silenceDurationMs?: number;
  minSpeechMs?: number;
  adaptive?: {
    afterSpeechMs?: number;
    stopThreshold?: number;
    silenceDurationMs?: number;
  };
};

export type SpeechToTextConnectionOptions = {
  auth: RealtimeAuth;
  mode?: SpeechToTextMode;
  boundaryDetection?: SpeechBoundaryDetection;
  language?: string;
  vad?: ClientVadOptions;
  transportFactory?: SpeechToTextTransportFactory;
  onStatus?: (status: SpeechToTextStatus) => void;
  onAudioLevel?: (level: number) => void;
  onStreamChunk?: (delta: string) => void;
  onTranscriptUpdate?: (update: TranscriptUpdate) => void;
  onFinal?: (utterance: TranscriptUpdate) => void;
  onError?: (error: RealtimeSpeechError) => void;
};

export type SpeechToTextConnection = {
  mediaStream: MediaStream;
  status: SpeechToTextStatus;
  commit: () => void;
  clearBuffer: () => void;
  close: () => void;
};

export type SpeechToTextTransportOptions = {
  auth: RealtimeAuth;
  mode: SpeechToTextMode;
  boundaryDetection: SpeechBoundaryDetection;
  language?: string;
  vad?: ClientVadOptions;
  onStatus?: (status: SpeechToTextStatus) => void;
  onAudioLevel?: (level: number) => void;
  onEvent: (event: unknown) => void;
  onError?: (error: RealtimeSpeechError) => void;
};

export type SpeechToTextTransportFactory = (
  options: SpeechToTextTransportOptions,
) => Promise<SpeechToTextConnection>;

type TranscriptionEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
};

export async function connectSpeechToText(
  options: SpeechToTextConnectionOptions,
): Promise<SpeechToTextConnection> {
  const boundaryDetection = options.boundaryDetection ?? "client_vad";
  const mode = options.mode ?? "single";

  if (boundaryDetection === "server_vad" && !options.transportFactory) {
    throw createRealtimeSpeechError(
      "invalid_state",
      "server_vad is not implemented for live gpt-realtime-whisper transcription.",
    );
  }

  options.onStatus?.("connecting");
  const utterances = new Map<string, TranscriptUpdate>();
  const transportFactory =
    options.transportFactory ?? createOpenAIWebRtcSpeechToTextTransport;

  try {
    return await transportFactory({
      auth: options.auth,
      mode,
      boundaryDetection,
      language: options.language,
      vad: options.vad,
      onAudioLevel: options.onAudioLevel,
      onStatus: options.onStatus,
      onEvent: (event) => handleTranscriptionEvent(event, utterances, options),
      onError: options.onError,
    });
  } catch (cause) {
    const error = normalizeError(cause, "connection_failed");
    options.onStatus?.("error");
    options.onError?.(error);
    throw error;
  }
}

function handleTranscriptionEvent(
  event: unknown,
  utterances: Map<string, TranscriptUpdate>,
  options: SpeechToTextConnectionOptions,
) {
  if (!isRecord(event) || typeof event.type !== "string") {
    return;
  }

  const typed = event as TranscriptionEvent;

  if (
    typed.type === "conversation.item.input_audio_transcription.delta" &&
    typed.delta
  ) {
    const utteranceId = typed.item_id ?? "unknown-item";
    const previous = utterances.get(utteranceId);
    const update: TranscriptUpdate = {
      utteranceId,
      delta: typed.delta,
      text: `${previous?.text ?? ""}${typed.delta}`,
      isFinal: false,
      startedAt: previous?.startedAt ?? Date.now(),
    };

    utterances.set(utteranceId, update);
    options.onStreamChunk?.(typed.delta);
    options.onTranscriptUpdate?.(update);
    return;
  }

  if (
    typed.type === "conversation.item.input_audio_transcription.completed" &&
    typeof typed.transcript === "string"
  ) {
    const utteranceId = typed.item_id ?? "unknown-item";
    const update: TranscriptUpdate = {
      utteranceId,
      delta: "",
      text: typed.transcript,
      isFinal: true,
      startedAt: utterances.get(utteranceId)?.startedAt,
      endedAt: Date.now(),
    };

    utterances.set(utteranceId, update);
    options.onTranscriptUpdate?.(update);
    options.onFinal?.(update);
  }
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
