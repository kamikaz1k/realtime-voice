import { getEphemeralClientSecret } from "./auth";
import { createRealtimeSpeechError } from "./errors";
import type {
  ClientVadOptions,
  SpeechToTextConnection,
  SpeechToTextMode,
  SpeechToTextStatus,
  SpeechToTextTransportOptions,
} from "./stt";

type AudioMeter = {
  close: () => void;
};

export async function createOpenAIWebRtcSpeechToTextTransport(
  options: SpeechToTextTransportOptions,
): Promise<SpeechToTextConnection> {
  assertSpeechBrowserSupport();

  if (options.boundaryDetection === "server_vad") {
    throw createRealtimeSpeechError(
      "invalid_state",
      "server_vad is not implemented for live gpt-realtime-whisper transcription.",
    );
  }

  const clientSecret = await getEphemeralClientSecret(options.auth, {
    purpose: "stt",
    language: options.language,
  });

  let status: SpeechToTextStatus = "connecting";
  let mediaStream: MediaStream | undefined;
  let peerConnection: RTCPeerConnection | undefined;
  let dataChannel: RTCDataChannel | undefined;
  let meter: AudioMeter | undefined;

  function setStatus(next: SpeechToTextStatus) {
    status = next;
    options.onStatus?.(next);
  }

  function send(event: unknown) {
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw createRealtimeSpeechError(
        "invalid_state",
        "Realtime data channel is not open.",
      );
    }

    dataChannel.send(JSON.stringify(event));
  }

  function commit() {
    send({ type: "input_audio_buffer.commit" });
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    peerConnection = new RTCPeerConnection();
    dataChannel = peerConnection.createDataChannel("oai-events");

    dataChannel.addEventListener("open", () => {
      send(buildTranscriptionSessionUpdate(options.language));
      setStatus("listening");
    });
    dataChannel.addEventListener("message", (message) => {
      options.onEvent(parseEvent(message.data));
    });
    dataChannel.addEventListener("error", () => {
      const error = createRealtimeSpeechError(
        "connection_failed",
        "Realtime data channel failed.",
        { retryable: true },
      );
      setStatus("error");
      options.onError?.(error);
    });

    const activeMediaStream = mediaStream;
    const activePeerConnection = peerConnection;
    const activeDataChannel = dataChannel;

    activeMediaStream.getAudioTracks().forEach((track) => {
      activePeerConnection.addTrack(track, activeMediaStream);
    });

    meter = createAudioMeter(activeMediaStream, {
      mode: options.mode,
      vad: options.vad,
      onAudioLevel: options.onAudioLevel,
      onAutoCommit:
        options.boundaryDetection === "client_vad" ? commit : undefined,
    });

    const offer = await activePeerConnection.createOffer();
    await activePeerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error("WebRTC offer did not contain SDP.");
    }

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });
    const answerSdp = await sdpResponse.text();

    if (!sdpResponse.ok) {
      throw new Error(answerSdp || "OpenAI Realtime SDP exchange failed.");
    }

    await activePeerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    return {
      mediaStream: activeMediaStream,
      get status() {
        return status;
      },
      commit,
      clearBuffer: () => send({ type: "input_audio_buffer.clear" }),
      close: () => {
        setStatus("closed");
        meter?.close();
        activeDataChannel.close();
        activePeerConnection.close();
        activeMediaStream.getTracks().forEach((track) => track.stop());
        options.onAudioLevel?.(0);
      },
    };
  } catch (cause) {
    meter?.close();
    dataChannel?.close();
    peerConnection?.close();
    mediaStream?.getTracks().forEach((track) => track.stop());
    throw cause;
  }
}

function buildTranscriptionSessionUpdate(language?: string) {
  return {
    type: "session.update",
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: {
            model: "gpt-realtime-whisper",
            ...(language ? { language } : {}),
            delay: "low",
          },
          turn_detection: null,
        },
      },
    },
  };
}

function createAudioMeter(
  stream: MediaStream,
  options: {
    mode: SpeechToTextMode;
    vad?: ClientVadOptions;
    onAudioLevel?: (level: number) => void;
    onAutoCommit?: () => void;
  },
): AudioMeter {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw createRealtimeSpeechError(
      "unsupported_browser",
      "Web Audio is not available in this browser.",
    );
  }

  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  const startThreshold = options.vad?.startThreshold ?? 0.08;
  const stopThreshold = options.vad?.stopThreshold ?? 0.035;
  const silenceDurationMs =
    options.vad?.silenceDurationMs ?? (options.mode === "continuous" ? 600 : 800);
  const minSpeechMs =
    options.vad?.minSpeechMs ?? (options.mode === "continuous" ? 150 : 250);
  const adaptiveAfterSpeechMs =
    options.vad?.adaptive?.afterSpeechMs ??
    (options.mode === "continuous" ? 1600 : undefined);
  const adaptiveStopThreshold =
    options.vad?.adaptive?.stopThreshold ??
    (options.mode === "continuous" ? 0.04 : stopThreshold);
  const adaptiveSilenceDurationMs =
    options.vad?.adaptive?.silenceDurationMs ??
    (options.mode === "continuous" ? 250 : silenceDurationMs);
  let speaking = false;
  let hasUncommittedSpeech = false;
  let segmentStartedAt = 0;
  let lastVoiceAt = 0;
  let frame = 0;

  analyser.fftSize = 1024;
  const samples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);

  const tick = () => {
    analyser.getByteTimeDomainData(samples);
    const level = getRmsLevel(samples);
    const now = performance.now();

    options.onAudioLevel?.(level);

    if (level >= startThreshold) {
      if (!speaking) {
        speaking = true;
      }

      if (!hasUncommittedSpeech) {
        hasUncommittedSpeech = true;
        segmentStartedAt = now;
      }
      lastVoiceAt = now;
    }

    if (
      speaking &&
      hasUncommittedSpeech &&
      shouldCommitSpeechSegment({
        level,
        now,
        segmentStartedAt,
        lastVoiceAt,
        stopThreshold,
        silenceDurationMs,
        adaptiveAfterSpeechMs,
        adaptiveStopThreshold,
        adaptiveSilenceDurationMs,
      }) &&
      now - segmentStartedAt >= minSpeechMs
    ) {
      speaking = false;
      hasUncommittedSpeech = false;
      options.onAutoCommit?.();
    }

    frame = window.requestAnimationFrame(tick);
  };

  void audioContext.resume();
  frame = window.requestAnimationFrame(tick);

  return {
    close: () => {
      window.cancelAnimationFrame(frame);
      source.disconnect();
      void audioContext.close();
    },
  };
}

function shouldCommitSpeechSegment(options: {
  level: number;
  now: number;
  segmentStartedAt: number;
  lastVoiceAt: number;
  stopThreshold: number;
  silenceDurationMs: number;
  adaptiveAfterSpeechMs?: number;
  adaptiveStopThreshold: number;
  adaptiveSilenceDurationMs: number;
}) {
  const segmentDurationMs = options.now - options.segmentStartedAt;
  const silenceMs = options.now - options.lastVoiceAt;

  if (
    options.level < options.stopThreshold &&
    silenceMs >= options.silenceDurationMs
  ) {
    return true;
  }

  if (
    options.adaptiveAfterSpeechMs &&
    segmentDurationMs >= options.adaptiveAfterSpeechMs &&
    options.level < options.adaptiveStopThreshold &&
    silenceMs >= options.adaptiveSilenceDurationMs
  ) {
    return true;
  }

  return false;
}

function getRmsLevel(samples: Uint8Array) {
  let sum = 0;

  for (const sample of samples) {
    const centered = sample - 128;
    sum += centered * centered;
  }

  return Math.min(1, (Math.sqrt(sum / samples.length) / 128) * 4);
}

function parseEvent(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function assertSpeechBrowserSupport() {
  if (!window.RTCPeerConnection) {
    throw createRealtimeSpeechError(
      "unsupported_browser",
      "RTCPeerConnection is not available in this browser.",
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw createRealtimeSpeechError(
      "unsupported_browser",
      "getUserMedia is not available in this browser.",
    );
  }
}
