import {
  connectSpeechToText,
  type ClientVadOptions,
  type RealtimeAuth,
  type RealtimeSpeechError,
  type SpeechBoundaryDetection,
  type SpeechToTextConnection,
  type SpeechToTextMode,
  type SpeechToTextStatus,
  type TranscriptUpdate,
} from "@realtime-speech/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type UseSpeechToTextOptions = {
  auth: RealtimeAuth;
  mode?: SpeechToTextMode;
  boundaryDetection?: SpeechBoundaryDetection;
  language?: string;
  vad?: ClientVadOptions;
  onStreamChunk?: (delta: string) => void;
  onTranscriptUpdate?: (update: TranscriptUpdate) => void;
  onFinal?: (utterance: TranscriptUpdate) => void;
  onAudioLevel?: (level: number) => void;
};

export type UseSpeechToTextResult = {
  status: SpeechToTextStatus;
  isListening: boolean;
  transcript: string;
  currentUtterance: TranscriptUpdate | null;
  mediaStream: MediaStream | null;
  audioLevel: number;
  error: RealtimeSpeechError | null;
  startNew: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  commit: () => void;
};

export function useSpeechToText(
  options: UseSpeechToTextOptions,
): UseSpeechToTextResult {
  const optionsRef = useRef(options);
  const connectionRef = useRef<SpeechToTextConnection | null>(null);
  const [status, setStatus] = useState<SpeechToTextStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [currentUtterance, setCurrentUtterance] =
    useState<TranscriptUpdate | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<RealtimeSpeechError | null>(null);

  optionsRef.current = options;

  const stop = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setMediaStream(null);
    setAudioLevel(0);
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setCurrentUtterance(null);
    setError(null);
  }, []);

  const startNew = useCallback(async () => {
    stop();
    reset();
    setStatus("connecting");

    try {
      const connection = await connectSpeechToText({
        auth: optionsRef.current.auth,
        mode: optionsRef.current.mode ?? "single",
        boundaryDetection: optionsRef.current.boundaryDetection ?? "client_vad",
        language: optionsRef.current.language,
        vad: optionsRef.current.vad,
        onStatus: setStatus,
        onAudioLevel: (level) => {
          setAudioLevel(level);
          optionsRef.current.onAudioLevel?.(level);
        },
        onStreamChunk: (delta) => {
          setTranscript((current) => current + delta);
          optionsRef.current.onStreamChunk?.(delta);
        },
        onTranscriptUpdate: (update) => {
          setCurrentUtterance(update);
          optionsRef.current.onTranscriptUpdate?.(update);
        },
        onFinal: (utterance) => {
          setCurrentUtterance(utterance);
          optionsRef.current.onFinal?.(utterance);

          if ((optionsRef.current.mode ?? "single") === "single") {
            queueMicrotask(stop);
          }
        },
        onError: setError,
      });

      connectionRef.current = connection;
      setMediaStream(connection.mediaStream);
    } catch (caught) {
      setError(caught as RealtimeSpeechError);
      setStatus("error");
    }
  }, [reset, stop]);

  const commit = useCallback(() => {
    connectionRef.current?.commit();
  }, []);

  useEffect(() => stop, [stop]);

  return {
    status,
    isListening: status === "listening",
    transcript,
    currentUtterance,
    mediaStream,
    audioLevel,
    error,
    startNew,
    stop,
    reset,
    commit,
  };
}
