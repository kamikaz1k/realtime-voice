export type Candidate = "whisper_manual" | "server_vad_realtime";

export type SpikeEvent = {
  id: number;
  at: string;
  type: string;
  payload: unknown;
};

export type TranscriptUtterance = {
  itemId: string;
  text: string;
  final: boolean;
  updatedAt: number;
};

export type ConnectOptions = {
  candidate: Candidate;
  language?: string;
  onEvent: (event: SpikeEvent) => void;
  onTranscriptDelta: (itemId: string, delta: string) => void;
  onTranscriptFinal: (itemId: string, transcript: string) => void;
  onAudioLevel: (level: number) => void;
  onStatus: (status: string) => void;
};

export type RealtimeSpikeConnection = {
  candidate: Candidate;
  mediaStream: MediaStream;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  commitAudio: () => void;
  clearAudioBuffer: () => void;
  close: () => void;
};

type ClientSecretResponse = {
  value?: string;
  client_secret?: {
    value?: string;
  };
};

let nextEventId = 1;

export function getCandidateLabel(candidate: Candidate) {
  if (candidate === "whisper_manual") {
    return "gpt-realtime-whisper, manual commit";
  }

  return "Realtime session, server_vad";
}

export function buildClientSessionUpdate(candidate: Candidate, language?: string) {
  if (candidate === "whisper_manual") {
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

  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions:
        "This is a transcription-only spike. Do not produce assistant content unless explicitly requested.",
      output_modalities: ["text"],
      max_output_tokens: 1,
      tools: [],
      tool_choice: "none",
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-transcribe",
            ...(language ? { language } : {}),
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: false,
            interrupt_response: false,
          },
        },
      },
    },
  };
}

export async function connectRealtimeSpike(
  options: ConnectOptions,
): Promise<RealtimeSpikeConnection> {
  assertBrowserSupport();
  options.onStatus("requesting-client-secret");

  const tokenResponse = await fetch("/api/realtime-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      candidate: options.candidate,
      language: options.language || undefined,
    }),
  });

  const tokenJson = (await tokenResponse.json()) as ClientSecretResponse & {
    error?: string;
  };

  if (!tokenResponse.ok) {
    throw new Error(tokenJson.error || "Failed to mint Realtime client secret");
  }

  const clientSecret = tokenJson.value || tokenJson.client_secret?.value;

  if (!clientSecret) {
    throw new Error("Token response did not contain a client secret value");
  }

  let mediaStream: MediaStream | undefined;
  let peerConnection: RTCPeerConnection | undefined;
  let dataChannel: RTCDataChannel | undefined;
  let audioMeter: { close: () => void } | undefined;

  try {
    options.onStatus("requesting-microphone");
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    audioMeter = createAudioMeter(mediaStream, options.onAudioLevel);
    peerConnection = new RTCPeerConnection();
    dataChannel = peerConnection.createDataChannel("oai-events");

    peerConnection.addEventListener("connectionstatechange", () => {
      options.onStatus(`pc:${peerConnection?.connectionState ?? "closed"}`);
    });

    dataChannel.addEventListener("open", () => {
      options.onStatus("data-channel-open");
      dataChannel?.send(
        JSON.stringify(buildClientSessionUpdate(options.candidate, options.language)),
      );
    });

    dataChannel.addEventListener("close", () => {
      options.onStatus("data-channel-closed");
    });

    dataChannel.addEventListener("error", () => {
      options.onStatus("data-channel-error");
    });

    dataChannel.addEventListener("message", (message) => {
      const payload = parseDataChannelMessage(message.data);
      const type = getEventType(payload);

      options.onEvent({
        id: nextEventId++,
        at: new Date().toISOString(),
        type,
        payload,
      });

      handleTranscriptEvent(payload, options);
    });

    const activeMediaStream = mediaStream;
    const activePeerConnection = peerConnection;
    const activeDataChannel = dataChannel;

    activeMediaStream.getAudioTracks().forEach((track) => {
      activePeerConnection.addTrack(track, activeMediaStream);
    });

    options.onStatus("creating-offer");
    const offer = await activePeerConnection.createOffer();
    await activePeerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error("WebRTC offer did not contain SDP");
    }

    options.onStatus("posting-sdp");
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
      throw new Error(answerSdp || "OpenAI Realtime SDP exchange failed");
    }

    await activePeerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    options.onStatus("connected");

    return {
      candidate: options.candidate,
      mediaStream: activeMediaStream,
      peerConnection: activePeerConnection,
      dataChannel: activeDataChannel,
      commitAudio: () => {
        sendDataChannelEvent(activeDataChannel, {
          type: "input_audio_buffer.commit",
        });
      },
      clearAudioBuffer: () => {
        sendDataChannelEvent(activeDataChannel, {
          type: "input_audio_buffer.clear",
        });
      },
      close: () => {
        audioMeter?.close();
        activeDataChannel.close();
        activePeerConnection.close();
        activeMediaStream.getTracks().forEach((track) => track.stop());
        options.onAudioLevel(0);
        options.onStatus("closed");
      },
    };
  } catch (error) {
    audioMeter?.close();
    dataChannel?.close();
    peerConnection?.close();
    mediaStream?.getTracks().forEach((track) => track.stop());
    options.onAudioLevel(0);
    throw error;
  }
}

function assertBrowserSupport() {
  if (!window.RTCPeerConnection) {
    throw new Error("RTCPeerConnection is not available in this browser");
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is not available in this browser");
  }
}

function sendDataChannelEvent(channel: RTCDataChannel, event: unknown) {
  if (channel.readyState !== "open") {
    throw new Error(`Data channel is ${channel.readyState}, not open`);
  }

  channel.send(JSON.stringify(event));
}

function parseDataChannelMessage(data: unknown) {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function getEventType(payload: unknown) {
  if (isRecord(payload) && typeof payload.type === "string") {
    return payload.type;
  }

  return "unknown";
}

function handleTranscriptEvent(payload: unknown, options: ConnectOptions) {
  if (!isRecord(payload) || typeof payload.type !== "string") {
    return;
  }

  if (
    payload.type === "conversation.item.input_audio_transcription.delta" &&
    typeof payload.delta === "string"
  ) {
    options.onTranscriptDelta(getItemId(payload), payload.delta);
    return;
  }

  if (
    payload.type === "conversation.item.input_audio_transcription.completed" &&
    typeof payload.transcript === "string"
  ) {
    options.onTranscriptFinal(getItemId(payload), payload.transcript);
  }
}

function getItemId(payload: Record<string, unknown>) {
  return typeof payload.item_id === "string" ? payload.item_id : "unknown-item";
}

function createAudioMeter(
  mediaStream: MediaStream,
  onAudioLevel: (level: number) => void,
) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio is not available in this browser");
  }

  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();
  let frame = 0;

  analyser.fftSize = 1024;
  const samples = new Uint8Array(analyser.fftSize);
  source.connect(analyser);

  const tick = () => {
    analyser.getByteTimeDomainData(samples);

    let sum = 0;
    for (const sample of samples) {
      const centered = sample - 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / samples.length) / 128;
    onAudioLevel(Math.min(1, rms * 4));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
