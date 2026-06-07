import type { AudioChunk } from "@realtime-speech/core";
import type {
  UsePcmPlayerResult,
  UseSpeechToTextResult,
  UseTextToSpeechResult,
} from "@realtime-speech/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

type VisualizationSource = "simulator" | "microphone" | "tts";
type VisualizerKind =
  | "siriRibbon"
  | "staticBars"
  | "scrollingBars"
  | "processingBars"
  | "circularWaveform"
  | "duplexHalo"
  | "transcriptRail";

type SourceColors = {
  label: string;
  shortLabel: string;
  primary: string;
  secondary: string;
  tertiary: string;
};

type SignalFrame = {
  source: VisualizationSource;
  active: boolean;
  level: number;
  low: number;
  mid: number;
  high: number;
  phase: number;
  updatedAt: number;
  colors: SourceColors;
  timeData: Float32Array;
  frequencyData: Float32Array;
};

type SignalSnapshot = {
  source: VisualizationSource;
  active: boolean;
  level: number;
  low: number;
  mid: number;
  high: number;
};

type UseVisualizationSignalOptions = {
  source: VisualizationSource;
  mediaStream: MediaStream | null;
  micLevelHint: number;
  ttsChunkBus: TtsChunkBus;
  ttsBufferedMs: number;
  ttsPlaying: boolean;
  ttsStreaming: boolean;
};

type CanvasSize = {
  width: number;
  height: number;
  now: number;
};

type CanvasDrawState = {
  history: number[];
  railHistory: number[];
  rotation: number;
  phase: number;
  lastTime: number;
  lastHistoryAt: number;
};

type VisualizerOptions = {
  bars?: number;
  barWidth?: number;
  density?: "compact" | "balanced" | "dense";
  palette?: "source" | "warm" | "mono";
  rotation?: boolean;
  mirror?: boolean;
};

type VisualizerConfig = {
  id: string;
  title: string;
  origin: string;
  kind: VisualizerKind;
  shape?: "wide" | "square";
  options?: VisualizerOptions;
};

export type TtsChunkBus = {
  subscribe: (listener: (chunk: AudioChunk) => void) => () => void;
};

type VisualizerPlaygroundProps = {
  speech: UseSpeechToTextResult;
  tts: UseTextToSpeechResult;
  player: UsePcmPlayerResult;
  ttsText: string;
  onTtsTextChange: (text: string) => void;
  onSendTts: () => Promise<void>;
  ttsChunkBus: TtsChunkBus;
};

const SOURCE_COLORS: Record<VisualizationSource, SourceColors> = {
  simulator: {
    label: "Simulator",
    shortLabel: "SIM",
    primary: "#13b8a6",
    secondary: "#ff6b6b",
    tertiary: "#e5b53b",
  },
  microphone: {
    label: "Microphone",
    shortLabel: "MIC",
    primary: "#188f7a",
    secondary: "#57c785",
    tertiary: "#2f80ed",
  },
  tts: {
    label: "TTS output",
    shortLabel: "TTS",
    primary: "#3b82f6",
    secondary: "#f4608a",
    tertiary: "#f2c94c",
  },
};

const SOURCE_OPTIONS: Array<{
  id: VisualizationSource;
  label: string;
  detail: string;
}> = [
  { id: "simulator", label: "Simulator", detail: "Shared synthetic signal" },
  { id: "microphone", label: "Mic", detail: "Live analyser" },
  { id: "tts", label: "TTS", detail: "PCM stream tap" },
];

const SEEDED_VISUALIZERS: VisualizerConfig[] = [
  {
    id: "siri-ribbon",
    title: "Siri-style ribbon",
    origin: "CodePen / fgnass",
    kind: "siriRibbon",
    shape: "wide",
    options: { density: "balanced", palette: "source" },
  },
  {
    id: "eleven-static",
    title: "Live waveform",
    origin: "ElevenLabs",
    kind: "staticBars",
    shape: "wide",
    options: { bars: 52, mirror: true },
  },
  {
    id: "eleven-scroll",
    title: "Streaming history",
    origin: "ElevenLabs",
    kind: "scrollingBars",
    shape: "wide",
    options: { bars: 64 },
  },
  {
    id: "eleven-processing",
    title: "Processing waveform",
    origin: "ElevenLabs",
    kind: "processingBars",
    shape: "wide",
    options: { bars: 42, palette: "warm" },
  },
  {
    id: "pipecat-circular-32",
    title: "Circular 32",
    origin: "Pipecat",
    kind: "circularWaveform",
    shape: "square",
    options: { bars: 32, barWidth: 4, rotation: true },
  },
  {
    id: "pipecat-circular-72",
    title: "Circular 72",
    origin: "Pipecat",
    kind: "circularWaveform",
    shape: "square",
    options: { bars: 72, barWidth: 3, rotation: true },
  },
  {
    id: "pipecat-circular-128",
    title: "Circular 128",
    origin: "Pipecat",
    kind: "circularWaveform",
    shape: "square",
    options: { bars: 128, barWidth: 2, rotation: false },
  },
];

const IMPLEMENTATION_VISUALIZERS: VisualizerConfig[] = [
  {
    id: "duplex-halo",
    title: "Turn halo",
    origin: "Implementation candidate",
    kind: "duplexHalo",
    shape: "square",
    options: { bars: 72 },
  },
  {
    id: "transcript-rail",
    title: "Transcript rail",
    origin: "Implementation candidate",
    kind: "transcriptRail",
    shape: "wide",
    options: { bars: 84 },
  },
];

export function VisualizerPlayground({
  speech,
  tts,
  player,
  ttsText,
  onTtsTextChange,
  onSendTts,
  ttsChunkBus,
}: VisualizerPlaygroundProps) {
  const [source, setSource] = useState<VisualizationSource>("simulator");
  const { signalRef, snapshot } = useVisualizationSignal({
    source,
    mediaStream: speech.mediaStream,
    micLevelHint: speech.audioLevel,
    ttsChunkBus,
    ttsBufferedMs: player.bufferedMs,
    ttsPlaying: player.isPlaying,
    ttsStreaming: tts.isStreaming,
  });

  const sourceLabel = SOURCE_COLORS[source].label;
  const levelPercent = Math.round(snapshot.level * 100);

  return (
    <section className="visualPlayground" aria-label="Visualization playground">
      <section className="playgroundControls" aria-label="Signal controls">
        <div className="sourcePicker" role="group" aria-label="Signal source">
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={source === option.id ? "sourceOption selected" : "sourceOption"}
              onClick={() => setSource(option.id)}
            >
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>

        <div className="signalPanel">
          <div className="signalReadout">
            <div>
              <span>Source</span>
              <strong>{sourceLabel}</strong>
            </div>
            <div>
              <span>Level</span>
              <strong>{levelPercent}%</strong>
            </div>
            <div>
              <span>State</span>
              <strong>{snapshot.active ? "active" : "idle"}</strong>
            </div>
          </div>
          <div className="signalMeter" aria-label="Current signal level">
            <div style={{ width: `${levelPercent}%` }} />
          </div>
          <div className="bandMeters" aria-label="Signal bands">
            <BandMeter label="Low" value={snapshot.low} />
            <BandMeter label="Mid" value={snapshot.mid} />
            <BandMeter label="High" value={snapshot.high} />
          </div>
        </div>

        <div className="sourceActions" aria-label="Source actions">
          <div className="micActions">
            <button
              type="button"
              disabled={speech.isListening}
              onClick={() => void speech.startNew()}
            >
              Start mic
            </button>
            <button type="button" disabled={!speech.isListening} onClick={speech.stop}>
              Stop mic
            </button>
            <button type="button" disabled={!speech.isListening} onClick={speech.commit}>
              Commit
            </button>
          </div>

          <div className="ttsInline">
            <textarea
              aria-label="TTS text"
              value={ttsText}
              onChange={(event) => onTtsTextChange(event.target.value)}
            />
            <div className="ttsInlineActions">
              <button
                type="button"
                disabled={!ttsText.trim()}
                onClick={() => void onSendTts()}
              >
                Send TTS
              </button>
              <button type="button" onClick={() => void player.play()}>
                Play
              </button>
              <button type="button" onClick={() => void player.pause()}>
                Pause
              </button>
            </div>
          </div>
        </div>
      </section>

      <VisualizerSection title="Seeded Options" items={SEEDED_VISUALIZERS} signalRef={signalRef} />
      <VisualizerSection
        title="Our Implementation"
        items={IMPLEMENTATION_VISUALIZERS}
        signalRef={signalRef}
      />
    </section>
  );
}

function BandMeter({ label, value }: { label: string; value: number }) {
  return (
    <div className="bandMeter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${Math.round(clamp01(value) * 100)}%` }} />
      </div>
    </div>
  );
}

function VisualizerSection({
  title,
  items,
  signalRef,
}: {
  title: string;
  items: VisualizerConfig[];
  signalRef: MutableRefObject<SignalFrame>;
}) {
  return (
    <section className="visualSection">
      <div className="visualSectionHeader">
        <h2>{title}</h2>
      </div>
      <div className="visualGrid">
        {items.map((item) => (
          <VisualizerCard key={item.id} item={item} signalRef={signalRef} />
        ))}
      </div>
    </section>
  );
}

function VisualizerCard({
  item,
  signalRef,
}: {
  item: VisualizerConfig;
  signalRef: MutableRefObject<SignalFrame>;
}) {
  return (
    <article className={item.shape === "square" ? "visualCard square" : "visualCard"}>
      <div className="visualCardHeader">
        <div>
          <h3>{item.title}</h3>
          <span>{item.origin}</span>
        </div>
      </div>
      <div className="visualCanvasShell">
        <CanvasVisualizer
          kind={item.kind}
          options={item.options}
          signalRef={signalRef}
        />
      </div>
    </article>
  );
}

function CanvasVisualizer({
  kind,
  options,
  signalRef,
}: {
  kind: VisualizerKind;
  options?: VisualizerOptions;
  signalRef: MutableRefObject<SignalFrame>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawInputRef = useRef({ kind, options });
  drawInputRef.current = { kind, options };

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return undefined;
    }

    let animationFrame = 0;
    let width = 1;
    let height = 1;
    const drawState: CanvasDrawState = {
      history: [],
      railHistory: [],
      rotation: 0,
      phase: 0,
      lastTime: performance.now(),
      lastHistoryAt: 0,
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const animate = (now: number) => {
      const drawInput = drawInputRef.current;
      drawVisualizer(
        context,
        { width, height, now },
        signalRef.current,
        drawState,
        drawInput.kind,
        drawInput.options ?? {},
      );
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [signalRef]);

  return <canvas ref={canvasRef} />;
}

function useVisualizationSignal({
  source,
  mediaStream,
  micLevelHint,
  ttsChunkBus,
  ttsBufferedMs,
  ttsPlaying,
  ttsStreaming,
}: UseVisualizationSignalOptions) {
  const signalRef = useRef(createEmptySignalFrame(source));
  const [snapshot, setSnapshot] = useState<SignalSnapshot>(() =>
    toSignalSnapshot(signalRef.current),
  );
  const micLevelHintRef = useRef(micLevelHint);
  const ttsPlaybackRef = useRef({
    bufferedMs: ttsBufferedMs,
    playing: ttsPlaying,
    streaming: ttsStreaming,
  });

  micLevelHintRef.current = micLevelHint;
  ttsPlaybackRef.current = {
    bufferedMs: ttsBufferedMs,
    playing: ttsPlaying,
    streaming: ttsStreaming,
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSnapshot(toSignalSnapshot(signalRef.current));
    }, 120);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const frame = signalRef.current;
    frame.source = source;
    frame.colors = SOURCE_COLORS[source];
    frame.active = false;
    frame.level = 0;
    frame.low = 0;
    frame.mid = 0;
    frame.high = 0;
    frame.timeData.fill(0);
    frame.frequencyData.fill(0);
  }, [source]);

  useEffect(() => {
    if (source !== "simulator") {
      return undefined;
    }

    let animationFrame = 0;

    const animate = (now: number) => {
      writeSimulatedSignal(signalRef.current, now);
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [source]);

  useEffect(() => {
    if (source !== "microphone") {
      return undefined;
    }

    let animationFrame = 0;
    let closed = false;
    let audioContext: AudioContext | null = null;
    let mediaSource: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    const timeBytes = new Uint8Array(512);
    const frequencyBytes = new Uint8Array(256);

    if (mediaStream) {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (AudioContextClass) {
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.74;
        mediaSource = audioContext.createMediaStreamSource(mediaStream);
        mediaSource.connect(analyser);
        void audioContext.resume();
      }
    }

    const animate = (now: number) => {
      if (closed) {
        return;
      }

      if (analyser) {
        analyser.getByteTimeDomainData(timeBytes);
        analyser.getByteFrequencyData(frequencyBytes);
        writeAnalyserSignal(
          signalRef.current,
          timeBytes,
          frequencyBytes,
          now,
          micLevelHintRef.current,
        );
      } else {
        writeIdleSignal(signalRef.current, now, micLevelHintRef.current);
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      closed = true;
      window.cancelAnimationFrame(animationFrame);
      mediaSource?.disconnect();
      analyser?.disconnect();
      void audioContext?.close();
    };
  }, [mediaStream, source]);

  useEffect(() => {
    if (source !== "tts") {
      return undefined;
    }

    let animationFrame = 0;
    let lastChunkAt = 0;
    let lastLevel = 0;
    const latestTime = new Float32Array(128);
    const latestFrequency = new Float32Array(64);

    const unsubscribe = ttsChunkBus.subscribe((chunk) => {
      const level = writePcmChunkData(chunk, latestTime, latestFrequency);
      lastLevel = level;
      lastChunkAt = performance.now();
    });

    const animate = (now: number) => {
      const playback = ttsPlaybackRef.current;
      const chunkAge = lastChunkAt > 0 ? now - lastChunkAt : Number.POSITIVE_INFINITY;
      const activeWindow = Math.max(650, playback.bufferedMs + 180);
      const decay = clamp01(1 - chunkAge / activeWindow);
      const syntheticActivity =
        playback.playing || playback.streaming ? 0.12 + 0.08 * Math.sin(now / 130) : 0;
      const level = Math.max(lastLevel * decay, syntheticActivity);

      writeArraySignal(
        signalRef.current,
        latestTime,
        latestFrequency,
        level,
        now,
        decay > 0.04 || playback.playing || playback.streaming,
      );
      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [source, ttsChunkBus]);

  return useMemo(() => ({ signalRef, snapshot }), [snapshot]);
}

function createEmptySignalFrame(source: VisualizationSource): SignalFrame {
  return {
    source,
    active: false,
    level: 0,
    low: 0,
    mid: 0,
    high: 0,
    phase: 0,
    updatedAt: performance.now(),
    colors: SOURCE_COLORS[source],
    timeData: new Float32Array(128),
    frequencyData: new Float32Array(64),
  };
}

function toSignalSnapshot(frame: SignalFrame): SignalSnapshot {
  return {
    source: frame.source,
    active: frame.active,
    level: frame.level,
    low: frame.low,
    mid: frame.mid,
    high: frame.high,
  };
}

function writeSimulatedSignal(frame: SignalFrame, now: number) {
  const time = now / 1000;
  const phrase =
    0.42 +
    0.27 * Math.sin(time * 1.7) +
    0.16 * Math.sin(time * 4.3) +
    0.08 * Math.sin(time * 7.1);
  const level = clamp01(phrase);

  frame.source = "simulator";
  frame.colors = SOURCE_COLORS.simulator;
  frame.active = true;
  frame.level = level;
  frame.phase = time;
  frame.updatedAt = now;

  for (let index = 0; index < frame.timeData.length; index += 1) {
    const position = index / Math.max(1, frame.timeData.length - 1);
    frame.timeData[index] =
      Math.sin(position * Math.PI * 7 + time * 5.2) * level * 0.58 +
      Math.sin(position * Math.PI * 17 - time * 3.4) * level * 0.24 +
      Math.sin(position * Math.PI * 33 + time * 1.9) * level * 0.1;
  }

  for (let index = 0; index < frame.frequencyData.length; index += 1) {
    const position = index / Math.max(1, frame.frequencyData.length - 1);
    const formantA = Math.exp(-Math.pow((position - 0.18 - 0.05 * Math.sin(time)) / 0.12, 2));
    const formantB = Math.exp(-Math.pow((position - 0.46 - 0.08 * Math.sin(time * 0.7)) / 0.16, 2));
    const formantC = Math.exp(-Math.pow((position - 0.76 + 0.06 * Math.sin(time * 1.3)) / 0.18, 2));
    frame.frequencyData[index] = clamp01(
      (formantA * 0.8 + formantB * 0.55 + formantC * 0.38) *
        (0.28 + level * 0.78),
    );
  }

  writeBands(frame);
}

function writeAnalyserSignal(
  frame: SignalFrame,
  timeBytes: Uint8Array,
  frequencyBytes: Uint8Array,
  now: number,
  micLevelHint: number,
) {
  let sum = 0;

  for (let index = 0; index < timeBytes.length; index += 1) {
    const value = (timeBytes[index] - 128) / 128;
    sum += value * value;
  }

  const rms = Math.sqrt(sum / timeBytes.length);
  const level = clamp01(Math.max(rms * 4.8, micLevelHint));

  frame.source = "microphone";
  frame.colors = SOURCE_COLORS.microphone;
  frame.active = level > 0.035;
  frame.level = level;
  frame.phase = now / 1000;
  frame.updatedAt = now;

  for (let index = 0; index < frame.timeData.length; index += 1) {
    const sourceIndex = Math.floor((index / frame.timeData.length) * timeBytes.length);
    frame.timeData[index] = (timeBytes[sourceIndex] - 128) / 128;
  }

  for (let index = 0; index < frame.frequencyData.length; index += 1) {
    const sourceIndex = Math.floor((index / frame.frequencyData.length) * frequencyBytes.length);
    frame.frequencyData[index] = clamp01(frequencyBytes[sourceIndex] / 255);
  }

  writeBands(frame);
}

function writeIdleSignal(frame: SignalFrame, now: number, levelHint = 0) {
  const level = clamp01(levelHint);

  frame.active = level > 0.03;
  frame.level = level;
  frame.phase = now / 1000;
  frame.updatedAt = now;

  for (let index = 0; index < frame.timeData.length; index += 1) {
    frame.timeData[index] = Math.sin(index * 0.24 + now / 520) * level * 0.22;
  }

  for (let index = 0; index < frame.frequencyData.length; index += 1) {
    frame.frequencyData[index] = level * Math.max(0, 1 - index / frame.frequencyData.length);
  }

  writeBands(frame);
}

function writePcmChunkData(
  chunk: AudioChunk,
  timeData: Float32Array,
  frequencyData: Float32Array,
) {
  const pcm = new Int16Array(chunk.data);
  let sum = 0;

  if (pcm.length === 0) {
    timeData.fill(0);
    frequencyData.fill(0);
    return 0;
  }

  for (let index = 0; index < timeData.length; index += 1) {
    const sourceIndex = Math.min(
      pcm.length - 1,
      Math.floor((index / timeData.length) * pcm.length),
    );
    const value = pcm[sourceIndex] / 32768;
    timeData[index] = clamp(value, -1, 1);
  }

  for (let index = 0; index < pcm.length; index += 1) {
    const value = pcm[index] / 32768;
    sum += value * value;
  }

  for (let bin = 0; bin < frequencyData.length; bin += 1) {
    const start = Math.floor((bin / frequencyData.length) * pcm.length);
    const end = Math.max(start + 1, Math.floor(((bin + 1) / frequencyData.length) * pcm.length));
    let binSum = 0;

    for (let index = start; index < end; index += 1) {
      const value = pcm[index] / 32768;
      binSum += value * value;
    }

    const position = bin / Math.max(1, frequencyData.length - 1);
    const voiceBias =
      0.55 +
      0.38 * Math.exp(-Math.pow((position - 0.24) / 0.18, 2)) +
      0.2 * Math.exp(-Math.pow((position - 0.62) / 0.28, 2));
    frequencyData[bin] = clamp01(Math.sqrt(binSum / (end - start)) * 5.2 * voiceBias);
  }

  return clamp01(Math.sqrt(sum / pcm.length) * 5.2);
}

function writeArraySignal(
  frame: SignalFrame,
  timeData: Float32Array,
  frequencyData: Float32Array,
  level: number,
  now: number,
  active: boolean,
) {
  frame.source = "tts";
  frame.colors = SOURCE_COLORS.tts;
  frame.active = active;
  frame.level = clamp01(level);
  frame.phase = now / 1000;
  frame.updatedAt = now;

  for (let index = 0; index < frame.timeData.length; index += 1) {
    frame.timeData[index] = timeData[index] * Math.max(frame.level, 0.12);
  }

  for (let index = 0; index < frame.frequencyData.length; index += 1) {
    const carrier =
      active && level > 0
        ? 0
        : Math.max(0, Math.sin(now / 160 + index * 0.32)) * 0.08;
    frame.frequencyData[index] = clamp01(frequencyData[index] * Math.max(frame.level, 0.18) + carrier);
  }

  writeBands(frame);
}

function writeBands(frame: SignalFrame) {
  frame.low = averageRange(frame.frequencyData, 0, 0.22);
  frame.mid = averageRange(frame.frequencyData, 0.22, 0.58);
  frame.high = averageRange(frame.frequencyData, 0.58, 1);
}

function averageRange(values: Float32Array, startRatio: number, endRatio: number) {
  const start = Math.floor(values.length * startRatio);
  const end = Math.max(start + 1, Math.floor(values.length * endRatio));
  let sum = 0;

  for (let index = start; index < end; index += 1) {
    sum += values[index];
  }

  return clamp01(sum / (end - start));
}

function drawVisualizer(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  kind: VisualizerKind,
  options: VisualizerOptions,
) {
  switch (kind) {
    case "siriRibbon":
      drawSiriRibbon(context, size, signal, state, options);
      break;
    case "staticBars":
      drawStaticBars(context, size, signal, options);
      break;
    case "scrollingBars":
      drawScrollingBars(context, size, signal, state, options);
      break;
    case "processingBars":
      drawProcessingBars(context, size, signal, options);
      break;
    case "circularWaveform":
      drawCircularWaveform(context, size, signal, state, options);
      break;
    case "duplexHalo":
      drawDuplexHalo(context, size, signal, state, options);
      break;
    case "transcriptRail":
      drawTranscriptRail(context, size, signal, state, options);
      break;
  }
}

function drawSiriRibbon(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#10181d");
  state.phase += Math.max(0.01, (now - state.lastTime) / 900);
  state.lastTime = now;

  const amplitude = height * (options.density === "dense" ? 0.34 : 0.28);
  const centerY = height / 2;
  const lines = [
    { color: signal.colors.primary, alpha: 0.95, shift: 0, scale: 1 },
    { color: signal.colors.secondary, alpha: 0.7, shift: 1.8, scale: 0.76 },
    { color: signal.colors.tertiary, alpha: 0.5, shift: 3.2, scale: 0.55 },
  ];

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";

  for (const line of lines) {
    context.beginPath();

    for (let index = 0; index < signal.timeData.length; index += 1) {
      const ratio = index / Math.max(1, signal.timeData.length - 1);
      const taper = Math.sin(ratio * Math.PI);
      const carrier = Math.sin(ratio * Math.PI * 4 + state.phase + line.shift) * 0.22;
      const sample = signal.timeData[index] + carrier * (0.25 + signal.level);
      const x = ratio * width;
      const y =
        centerY +
        sample * amplitude * line.scale * (0.24 + signal.level * 1.35) * taper;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.strokeStyle = colorWithAlpha(line.color, line.alpha);
    context.lineWidth = 2.5 + signal.level * 5 * line.scale;
    context.shadowColor = line.color;
    context.shadowBlur = 16 + signal.level * 18;
    context.stroke();
  }

  context.restore();
  drawCenterLine(context, width, height, colorWithAlpha(signal.colors.primary, 0.14));
}

function drawStaticBars(
  context: CanvasRenderingContext2D,
  { width, height }: CanvasSize,
  signal: SignalFrame,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#f8fbfc");
  const bars = options.bars ?? 48;
  const gap = bars > 72 ? 1.4 : 2;
  const available = Math.min(width - 26, bars * 9);
  const step = available / bars;
  const barWidth = Math.max(2, step - gap);
  const startX = (width - available) / 2;
  const centerY = height / 2;

  for (let index = 0; index < bars; index += 1) {
    const ratio = index / Math.max(1, bars - 1);
    const binIndex = Math.floor(ratio * (signal.frequencyData.length - 1));
    const value = clamp01(signal.frequencyData[binIndex] * 1.18 + signal.level * 0.28);
    const edgeFade = Math.sin(ratio * Math.PI);
    const barHeight = 6 + value * edgeFade * height * 0.42;
    const color = blendHex(signal.colors.primary, signal.colors.secondary, ratio);
    const alpha = 0.32 + 0.62 * edgeFade;
    const x = startX + index * step;

    context.fillStyle = colorWithAlpha(color, alpha);
    roundedRect(
      context,
      x,
      centerY - barHeight,
      barWidth,
      barHeight * 2,
      Math.min(barWidth / 2, 5),
    );
    context.fill();
  }

  drawCenterLine(context, width, height, "#dce5e9");
}

function drawScrollingBars(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#11181c");
  const step = 5;
  const maxItems = Math.ceil(width / step) + 2;

  if (now - state.lastHistoryAt > 34) {
    const value = clamp01(signal.level * 0.78 + signal.low * 0.2 + signal.high * 0.18);
    state.history.push(value);
    state.lastHistoryAt = now;
  }

  while (state.history.length > maxItems) {
    state.history.shift();
  }

  const bars = options.bars ?? maxItems;
  const centerY = height / 2;

  for (let index = 0; index < Math.min(bars, state.history.length); index += 1) {
    const historyIndex = state.history.length - 1 - index;
    const value = state.history[historyIndex];
    const x = width - 12 - index * step;
    const fade = clamp01(1 - index / maxItems);
    const barHeight = 4 + value * height * 0.43;
    const color = blendHex(signal.colors.secondary, signal.colors.primary, fade);

    context.fillStyle = colorWithAlpha(color, 0.14 + fade * 0.82);
    roundedRect(context, x, centerY - barHeight, 3, barHeight * 2, 2);
    context.fill();
  }

  context.fillStyle = colorWithAlpha(signal.colors.tertiary, signal.active ? 0.92 : 0.35);
  roundedRect(context, width - 12, centerY - 28, 4, 56, 2);
  context.fill();
}

function drawProcessingBars(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#f9fbfb");
  const bars = options.bars ?? 42;
  const available = width - 30;
  const step = available / bars;
  const barWidth = Math.max(3, Math.min(8, step * 0.54));
  const centerY = height / 2;

  for (let index = 0; index < bars; index += 1) {
    const ratio = index / Math.max(1, bars - 1);
    const binIndex = Math.floor(ratio * (signal.frequencyData.length - 1));
    const sourceValue = signal.frequencyData[binIndex] * 0.8 + signal.level * 0.28;
    const sweep = Math.max(0, Math.sin(now / 220 - ratio * Math.PI * 2));
    const idleValue = 0.14 + sweep * 0.5;
    const value = clamp01(signal.active ? sourceValue : idleValue);
    const color =
      options.palette === "warm"
        ? blendHex("#f28d35", "#25a18e", ratio)
        : blendHex(signal.colors.primary, signal.colors.secondary, ratio);
    const barHeight = 8 + value * height * 0.42;
    const x = 15 + index * step;

    context.fillStyle = colorWithAlpha(color, 0.34 + value * 0.62);
    roundedRect(context, x, centerY - barHeight, barWidth, barHeight * 2, barWidth / 2);
    context.fill();
  }
}

function drawCircularWaveform(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#10171c");
  const minSize = Math.min(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const bars = options.bars ?? 64;
  const barWidth = options.barWidth ?? (bars > 90 ? 2 : 3);
  const baseRadius = minSize * 0.27;
  const maxBar = minSize * 0.22;
  const delta = Math.max(0, now - state.lastTime);
  state.lastTime = now;

  if (options.rotation !== false) {
    state.rotation += delta * (0.00016 + signal.level * 0.00042);
  }

  context.save();
  context.translate(centerX, centerY);
  context.rotate(state.rotation);

  for (let index = 0; index < bars; index += 1) {
    const ratio = index / bars;
    const binIndex = Math.floor(ratio * (signal.frequencyData.length - 1));
    const idlePulse = Math.max(0, Math.sin(now / 250 - ratio * Math.PI * 2)) * 0.18;
    const value = clamp01(signal.frequencyData[binIndex] * 1.15 + signal.level * 0.16 + idlePulse);
    const barLength = 5 + value * maxBar;
    const color = blendHex(signal.colors.primary, signal.colors.secondary, ratio);

    context.save();
    context.rotate(ratio * Math.PI * 2);
    context.fillStyle = colorWithAlpha(color, 0.3 + value * 0.68);
    roundedRect(
      context,
      -barWidth / 2,
      -baseRadius - barLength,
      barWidth,
      barLength,
      barWidth / 2,
    );
    context.fill();
    context.restore();
  }

  context.strokeStyle = colorWithAlpha(signal.colors.primary, 0.2);
  context.lineWidth = 1;
  context.beginPath();
  context.arc(0, 0, baseRadius - 8, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = colorWithAlpha(signal.colors.tertiary, signal.active ? 0.64 : 0.25);
  context.lineWidth = 2 + signal.level * 3;
  context.beginPath();
  context.arc(0, 0, minSize * (0.115 + signal.level * 0.02), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawDuplexHalo(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#0f171b");
  const minSize = Math.min(width, height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = minSize * 0.26;
  const bars = options.bars ?? 72;
  const delta = Math.max(0, now - state.lastTime);
  state.lastTime = now;
  state.rotation += delta * 0.00012;

  const micWeight = signal.source === "tts" ? 0.3 : 1;
  const ttsWeight = signal.source === "microphone" ? 0.3 : 1;

  context.save();
  context.translate(centerX, centerY);
  context.rotate(state.rotation);

  for (let index = 0; index < bars; index += 1) {
    const ratio = index / bars;
    const angle = ratio * Math.PI * 2;
    const sideWeight = Math.cos(angle) < 0 ? micWeight : ttsWeight;
    const binIndex = Math.floor(ratio * (signal.frequencyData.length - 1));
    const value = clamp01(signal.frequencyData[binIndex] * sideWeight + signal.level * 0.16);
    const length = 4 + value * minSize * 0.16;
    const color = Math.cos(angle) < 0 ? signal.colors.primary : signal.colors.secondary;

    context.save();
    context.rotate(angle);
    context.fillStyle = colorWithAlpha(color, 0.16 + value * 0.74);
    roundedRect(context, -1.5, -radius - length, 3, length, 2);
    context.fill();
    context.restore();
  }

  context.lineCap = "round";
  context.lineWidth = 8 + signal.level * 8;
  context.strokeStyle = colorWithAlpha(signal.colors.primary, 0.72 * micWeight);
  context.beginPath();
  context.arc(0, 0, radius - 16, Math.PI * 0.58, Math.PI * 1.42);
  context.stroke();

  context.strokeStyle = colorWithAlpha(signal.colors.secondary, 0.72 * ttsWeight);
  context.beginPath();
  context.arc(0, 0, radius - 16, -Math.PI * 0.42, Math.PI * 0.42);
  context.stroke();

  context.lineWidth = 1;
  context.strokeStyle = colorWithAlpha(signal.colors.tertiary, 0.3 + signal.level * 0.34);
  context.beginPath();
  context.arc(0, 0, radius * (0.36 + signal.level * 0.1), 0, Math.PI * 2);
  context.stroke();
  context.restore();

  const pulseWidth = width * (0.2 + signal.level * 0.28);
  context.fillStyle = colorWithAlpha(signal.colors.tertiary, 0.75);
  roundedRect(context, centerX - pulseWidth / 2, centerY - 2, pulseWidth, 4, 2);
  context.fill();
}

function drawTranscriptRail(
  context: CanvasRenderingContext2D,
  { width, height, now }: CanvasSize,
  signal: SignalFrame,
  state: CanvasDrawState,
  options: VisualizerOptions,
) {
  paintStage(context, width, height, "#f8fbfc");
  const maxItems = options.bars ?? 84;

  if (now - state.lastHistoryAt > 40) {
    state.railHistory.push(clamp01(signal.level * 0.76 + signal.mid * 0.26));
    state.lastHistoryAt = now;
  }

  while (state.railHistory.length > maxItems) {
    state.railHistory.shift();
  }

  const paddingX = 18;
  const trackWidth = width - paddingX * 2;
  const upperY = height * 0.38;
  const lowerY = height * 0.63;
  const itemStep = trackWidth / maxItems;
  const micWeight = signal.source === "tts" ? 0.32 : 1;
  const ttsWeight = signal.source === "microphone" ? 0.32 : 1;

  drawRailBase(context, paddingX, upperY, trackWidth, signal.colors.primary, micWeight);
  drawRailBase(context, paddingX, lowerY, trackWidth, signal.colors.secondary, ttsWeight);

  for (let index = 0; index < state.railHistory.length; index += 1) {
    const ratio = index / Math.max(1, maxItems - 1);
    const value = state.railHistory[index];
    const x = paddingX + ratio * trackWidth;
    const fade = 0.18 + ratio * 0.82;
    const micHeight = value * height * 0.17 * micWeight;
    const ttsHeight =
      (value * 0.78 + signal.high * 0.14) * height * 0.16 * ttsWeight;

    context.fillStyle = colorWithAlpha(signal.colors.primary, fade * micWeight);
    roundedRect(context, x, upperY - micHeight, Math.max(2, itemStep * 0.48), micHeight * 2, 2);
    context.fill();

    context.fillStyle = colorWithAlpha(signal.colors.secondary, fade * ttsWeight);
    roundedRect(context, x, lowerY - ttsHeight, Math.max(2, itemStep * 0.48), ttsHeight * 2, 2);
    context.fill();
  }

  const cursorX = paddingX + trackWidth * 0.84;
  context.strokeStyle = colorWithAlpha(signal.colors.tertiary, signal.active ? 0.84 : 0.38);
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cursorX, height * 0.22);
  context.lineTo(cursorX, height * 0.78);
  context.stroke();
}

function drawRailBase(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string,
  weight: number,
) {
  context.strokeStyle = colorWithAlpha(color, 0.16 * weight);
  context.lineWidth = 8;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + width, y);
  context.stroke();
}

function paintStage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
}

function drawCenterLine(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
) {
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(16, height / 2);
  context.lineTo(width - 16, height / 2);
  context.stroke();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function blendHex(left: string, right: string, amount: number) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  const ratio = clamp01(amount);
  const red = Math.round(leftRgb.red + (rightRgb.red - leftRgb.red) * ratio);
  const green = Math.round(leftRgb.green + (rightRgb.green - leftRgb.green) * ratio);
  const blue = Math.round(leftRgb.blue + (rightRgb.blue - leftRgb.blue) * ratio);

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function colorWithAlpha(color: string, alpha: number) {
  const rgb = hexToRgb(color);

  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${clamp01(alpha)})`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
