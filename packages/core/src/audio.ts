export type AudioChunk = {
  data: ArrayBuffer;
  format: "pcm16";
  sampleRate: 24000;
  channels: 1;
  responseId: string;
  itemId: string;
  index: number;
};

export type PcmPlayerState = {
  isPlaying: boolean;
  bufferedMs: number;
};

export type PcmPlayer = {
  enqueue: (chunk: AudioChunk) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => void;
  clear: () => void;
  close: () => Promise<void>;
  getState: () => PcmPlayerState;
  onStateChange: (listener: (state: PcmPlayerState) => void) => () => void;
};

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export function createPcmPlayer(options: {
  sampleRate?: 24000;
  channels?: 1;
} = {}): PcmPlayer {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio is not available in this browser.");
  }

  const sampleRate = options.sampleRate ?? 24000;
  const audioContext = new AudioContextClass({ sampleRate });
  const gain = audioContext.createGain();
  const listeners = new Set<(state: PcmPlayerState) => void>();
  const pending: AudioChunk[] = [];
  let scheduledEndTime = audioContext.currentTime;
  let isPlaying = false;

  gain.connect(audioContext.destination);

  function emit() {
    const state = getState();
    listeners.forEach((listener) => listener(state));
  }

  function getState(): PcmPlayerState {
    return {
      isPlaying,
      bufferedMs: Math.max(0, scheduledEndTime - audioContext.currentTime) * 1000,
    };
  }

  function schedule(chunk: AudioChunk) {
    const pcm = new Int16Array(chunk.data);
    const buffer = audioContext.createBuffer(1, pcm.length, chunk.sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < pcm.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
    }

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const startAt = Math.max(audioContext.currentTime + 0.02, scheduledEndTime);
    source.start(startAt);
    scheduledEndTime = startAt + buffer.duration;
  }

  function flushPending() {
    while (pending.length > 0) {
      const chunk = pending.shift();

      if (chunk) {
        schedule(chunk);
      }
    }

    emit();
  }

  return {
    enqueue: (chunk) => {
      if (isPlaying) {
        schedule(chunk);
      } else {
        pending.push(chunk);
      }

      emit();
    },
    play: async () => {
      await audioContext.resume();
      isPlaying = true;
      scheduledEndTime = Math.max(scheduledEndTime, audioContext.currentTime);
      flushPending();
      emit();
    },
    pause: async () => {
      await audioContext.suspend();
      isPlaying = false;
      emit();
    },
    stop: () => {
      pending.length = 0;
      scheduledEndTime = audioContext.currentTime;
      isPlaying = false;
      void audioContext.suspend();
      emit();
    },
    clear: () => {
      pending.length = 0;
      scheduledEndTime = audioContext.currentTime;
      emit();
    },
    close: async () => {
      pending.length = 0;
      isPlaying = false;
      await audioContext.close();
      emit();
    },
    getState,
    onStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
