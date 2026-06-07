import {
  RealtimeTextToSpeech,
  type AudioChunk,
  type RealtimeAuth,
  type RealtimeSpeechError,
  type TextToSpeechHandle,
  type TextToSpeechSnapshot,
  type TtsQueueItem,
} from "@realtime-speech/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type UseTextToSpeechOptions = {
  auth: RealtimeAuth;
  voice?: string;
  speed?: number;
  maxTextChars?: number;
  onStreamChunk?: (chunk: AudioChunk) => void;
  onItemStart?: (item: TtsQueueItem) => void;
  onItemDone?: (item: TtsQueueItem) => void;
  onItemError?: (event: { item: TtsQueueItem; error: RealtimeSpeechError }) => void;
  onTextTooLong?: (event: { text: string; maxTextChars: number }) => void;
};

export type UseTextToSpeechResult = TextToSpeechSnapshot & {
  preconnect: () => Promise<void>;
  sendText: (text: string) => TextToSpeechHandle;
  cancelCurrent: () => void;
  clearQueue: () => void;
  cancelAll: () => void;
};

const initialSnapshot: TextToSpeechSnapshot = {
  status: "idle",
  isConnected: false,
  isStreaming: false,
  queueSize: 0,
  currentItem: null,
  error: null,
};

export function useTextToSpeech(
  options: UseTextToSpeechOptions,
): UseTextToSpeechResult {
  const optionsRef = useRef(options);
  const controllerRef = useRef<RealtimeTextToSpeech | null>(null);
  const [snapshot, setSnapshot] = useState<TextToSpeechSnapshot>(initialSnapshot);

  optionsRef.current = options;

  const getController = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = new RealtimeTextToSpeech({
        auth: optionsRef.current.auth,
        voice: optionsRef.current.voice,
        speed: optionsRef.current.speed,
        maxTextChars: optionsRef.current.maxTextChars,
        onStateChange: setSnapshot,
        onStreamChunk: (chunk) => optionsRef.current.onStreamChunk?.(chunk),
        onItemStart: (item) => optionsRef.current.onItemStart?.(item),
        onItemDone: (item) => optionsRef.current.onItemDone?.(item),
        onItemError: (event) => optionsRef.current.onItemError?.(event),
        onTextTooLong: (event) => optionsRef.current.onTextTooLong?.(event),
      });
    }

    return controllerRef.current;
  }, []);

  const preconnect = useCallback(async () => {
    await getController().preconnect();
  }, [getController]);

  const sendText = useCallback(
    (text: string) => getController().sendText(text),
    [getController],
  );

  const cancelCurrent = useCallback(() => {
    getController().cancelCurrent();
  }, [getController]);

  const clearQueue = useCallback(() => {
    getController().clearQueue();
  }, [getController]);

  const cancelAll = useCallback(() => {
    getController().cancelAll();
  }, [getController]);

  useEffect(
    () => () => {
      controllerRef.current?.close();
      controllerRef.current = null;
    },
    [],
  );

  return {
    ...snapshot,
    preconnect,
    sendText,
    cancelCurrent,
    clearQueue,
    cancelAll,
  };
}
