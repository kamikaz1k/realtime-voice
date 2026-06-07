import type {
  AudioChunk,
  ClientVadOptions,
  RealtimeAuth,
} from "@realtime-speech/core";
import {
  usePcmPlayer,
  useSpeechToText,
  useTextToSpeech,
} from "@realtime-speech/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  VisualizerPlayground,
  type TtsChunkBus,
} from "./VisualizerPlayground";

type DemoView = "playground" | "realtime";

type SttLogEntry = {
  id: string;
  kind: "preview" | "commit";
  timestamp: string;
  itemId: string;
  text: string;
};

type VadTuning = {
  startThreshold: number;
  stopThreshold: number;
  silenceDurationMs: number;
  minSpeechMs: number;
  adaptiveEnabled: boolean;
  adaptiveAfterSpeechMs: number;
  adaptiveStopThreshold: number;
  adaptiveSilenceDurationMs: number;
};

const DEFAULT_CONTINUOUS_VAD: VadTuning = {
  startThreshold: 0.08,
  stopThreshold: 0.035,
  silenceDurationMs: 600,
  minSpeechMs: 150,
  adaptiveEnabled: true,
  adaptiveAfterSpeechMs: 1600,
  adaptiveStopThreshold: 0.04,
  adaptiveSilenceDurationMs: 250,
};

const SINGLE_VAD: ClientVadOptions = {
  startThreshold: 0.08,
  stopThreshold: 0.035,
  silenceDurationMs: 800,
  minSpeechMs: 250,
};

function formatTurnTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getViewFromLocation(): DemoView {
  return window.location.pathname.startsWith("/visualizations")
    ? "playground"
    : "realtime";
}

export function App() {
  const [activeView, setActiveView] = useState<DemoView>(getViewFromLocation);
  const [mode, setMode] = useState<"single" | "continuous">("continuous");
  const [ttsText, setTtsText] = useState("This is a realtime speech test.");
  const [sttLog, setSttLog] = useState<SttLogEntry[]>([]);
  const [ttsEvents, setTtsEvents] = useState<string[]>([]);
  const [vadTuning, setVadTuning] = useState<VadTuning>(DEFAULT_CONTINUOUS_VAD);
  const ttsChunkListenersRef = useRef(new Set<(chunk: AudioChunk) => void>());
  const ttsChunkBus = useMemo<TtsChunkBus>(
    () => ({
      subscribe: (listener) => {
        ttsChunkListenersRef.current.add(listener);

        return () => {
          ttsChunkListenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );
  const auth = useMemo<RealtimeAuth>(
    () => ({
      mode: "ephemeral",
      getClientSecret: async (request) => {
        const response = await fetch("/api/realtime-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to create Realtime client secret");
        }

        const value = data.value ?? data.client_secret?.value;

        if (!value) {
          throw new Error("Realtime client secret response did not include a value");
        }

        return value;
      },
    }),
    [],
  );

  useEffect(() => {
    const handlePopState = () => setActiveView(getViewFromLocation());

    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(view: DemoView) {
    const path = view === "playground" ? "/visualizations" : "/";

    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }

    setActiveView(view);
  }

  function updateVadTuning<Key extends keyof VadTuning>(
    key: Key,
    value: VadTuning[Key],
  ) {
    setVadTuning((current) => ({ ...current, [key]: value }));
  }

  async function startSpeech() {
    setSttLog([]);
    await speech.startNew();
  }

  function resetSpeech() {
    speech.reset();
    setSttLog([]);
  }

  const vadOptions = useMemo<ClientVadOptions>(() => {
    if (mode === "single") {
      return SINGLE_VAD;
    }

    return {
      startThreshold: vadTuning.startThreshold,
      stopThreshold: vadTuning.stopThreshold,
      silenceDurationMs: vadTuning.silenceDurationMs,
      minSpeechMs: vadTuning.minSpeechMs,
      adaptive: vadTuning.adaptiveEnabled
        ? {
            afterSpeechMs: vadTuning.adaptiveAfterSpeechMs,
            stopThreshold: vadTuning.adaptiveStopThreshold,
            silenceDurationMs: vadTuning.adaptiveSilenceDurationMs,
          }
        : undefined,
    };
  }, [mode, vadTuning]);

  const speech = useSpeechToText({
    auth,
    mode,
    boundaryDetection: "client_vad",
    language: "en",
    vad: vadOptions,
    onTranscriptUpdate: (update) => {
      if (update.isFinal || !update.text.trim()) {
        return;
      }

      const id = `preview-${update.utteranceId}`;
      setSttLog((current) => [
        {
          id,
          kind: "preview" as const,
          timestamp: formatTurnTimestamp(),
          itemId: update.utteranceId,
          text: update.text,
        },
        ...current.filter((entry) => entry.id !== id),
      ].slice(0, 12));
    },
    onFinal: (utterance) => {
      setSttLog((current) => [
        {
          id: `commit-${utterance.utteranceId}-${Date.now()}`,
          kind: "commit" as const,
          timestamp: formatTurnTimestamp(),
          itemId: utterance.utteranceId,
          text: utterance.text,
        },
        ...current,
      ].slice(0, 12));
    },
  });
  const player = usePcmPlayer();
  const tts = useTextToSpeech({
    auth,
    voice: "marin",
    onStreamChunk: (chunk) => {
      player.enqueue(chunk);
      ttsChunkListenersRef.current.forEach((listener) => listener(chunk));
    },
    onItemStart: (item) => {
      setTtsEvents((current) => [`Started ${item.id}`, ...current].slice(0, 8));
    },
    onItemDone: (item) => {
      setTtsEvents((current) => [`Done ${item.id}`, ...current].slice(0, 8));
    },
    onItemError: ({ error }) => {
      setTtsEvents((current) => [`Error ${error.message}`, ...current].slice(0, 8));
    },
  });

  async function sendTts() {
    await player.play();
    tts.sendText(ttsText);
  }

  return (
    <main className="appShell">
      <section className="topbar">
        <div>
          <h1>Realtime Speech Demo</h1>
          <p>Visualization playground and OpenAI Realtime hooks</p>
        </div>
        <div className="topbarActions">
          <div className="viewSwitch" role="group" aria-label="Demo view">
            <button
              type="button"
              className={activeView === "playground" ? "selected" : ""}
              onClick={() => navigate("playground")}
            >
              Visualizations
            </button>
            <button
              type="button"
              className={activeView === "realtime" ? "selected" : ""}
              onClick={() => navigate("realtime")}
            >
              Realtime
            </button>
          </div>
          <div className="statusPills">
            <span>{speech.status}</span>
            <span>{tts.status}</span>
          </div>
        </div>
      </section>

      {activeView === "playground" ? (
        <VisualizerPlayground
          speech={speech}
          tts={tts}
          player={player}
          ttsText={ttsText}
          onTtsTextChange={setTtsText}
          onSendTts={sendTts}
          ttsChunkBus={ttsChunkBus}
        />
      ) : (
        <section className="workspace">
          <article className="panel">
            <div className="panelHeader">
              <h2>Speech to Text</h2>
              <select
                value={mode}
                disabled={speech.isListening}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="continuous">Continuous</option>
                <option value="single">Single</option>
              </select>
            </div>

            <div className="meter">
              <div style={{ width: `${Math.round(speech.audioLevel * 100)}%` }} />
            </div>

            <div className="buttonRow">
              <button
                disabled={speech.isListening}
                onClick={() => void startSpeech()}
              >
                Start
              </button>
              <button disabled={!speech.isListening} onClick={speech.stop}>
                Stop
              </button>
              <button onClick={resetSpeech}>Reset</button>
            </div>

            <VadTuningPanel
              disabled={speech.isListening || mode === "single"}
              tuning={vadTuning}
              onChange={updateVadTuning}
              onReset={() => setVadTuning(DEFAULT_CONTINUOUS_VAD)}
            />

            {speech.error ? <p className="error">{speech.error.message}</p> : null}

            <div className="logHeader">
              <h3>Live Preview</h3>
              <span className="eventBadge preview">preview</span>
            </div>

            <textarea
              aria-label="Live preview transcript"
              readOnly
              value={speech.transcript}
            />

            <div className="logHeader">
              <h3>STT Log</h3>
            </div>

            <div className="list">
              {sttLog.map((entry) => (
                <div key={entry.id} className="listItem">
                  <div className="turnMeta">
                    <span className={`eventBadge ${entry.kind}`}>
                      {entry.kind}
                    </span>
                    <time>{entry.timestamp}</time>
                    <code>{entry.itemId}</code>
                  </div>
                  <span>{entry.text}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panelHeader">
              <h2>Text to Speech</h2>
              <span>{Math.round(player.bufferedMs)} ms buffered</span>
            </div>

            <textarea
              value={ttsText}
              onChange={(event) => setTtsText(event.target.value)}
            />

            <div className="buttonRow">
              <button onClick={() => void tts.preconnect()}>Preconnect</button>
              <button disabled={!ttsText.trim()} onClick={() => void sendTts()}>
                Send
              </button>
              <button onClick={() => void player.play()}>Play</button>
              <button onClick={() => void player.pause()}>Pause</button>
              <button onClick={tts.cancelAll}>Cancel</button>
            </div>

            {tts.error ? <p className="error">{tts.error.message}</p> : null}

            <div className="queueStats">
              <span>Queue: {tts.queueSize}</span>
              <span>Streaming: {tts.isStreaming ? "yes" : "no"}</span>
              <span>Player: {player.isPlaying ? "playing" : "paused"}</span>
            </div>

            <div className="list">
              {ttsEvents.map((event, index) => (
                <div key={`${event}-${index}`} className="listItem">
                  <span>{event}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}
    </main>
  );
}

type VadTuningPanelProps = {
  disabled: boolean;
  tuning: VadTuning;
  onChange: <Key extends keyof VadTuning>(
    key: Key,
    value: VadTuning[Key],
  ) => void;
  onReset: () => void;
};

function VadTuningPanel({
  disabled,
  tuning,
  onChange,
  onReset,
}: VadTuningPanelProps) {
  return (
    <section className="vadControls" aria-label="Continuous VAD tuning">
      <div className="vadControlsHeader">
        <h3>Continuous VAD</h3>
        <button type="button" disabled={disabled} onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="vadGrid">
        <VadNumberControl
          disabled={disabled}
          label="Start threshold"
          max={0.2}
          min={0.01}
          step={0.005}
          value={tuning.startThreshold}
          onChange={(value) => onChange("startThreshold", value)}
        />
        <VadNumberControl
          disabled={disabled}
          label="Stop threshold"
          max={0.12}
          min={0.005}
          step={0.005}
          value={tuning.stopThreshold}
          onChange={(value) => onChange("stopThreshold", value)}
        />
        <VadNumberControl
          disabled={disabled}
          label="Silence ms"
          max={1200}
          min={100}
          step={25}
          value={tuning.silenceDurationMs}
          onChange={(value) => onChange("silenceDurationMs", value)}
        />
        <VadNumberControl
          disabled={disabled}
          label="Min speech ms"
          max={700}
          min={50}
          step={25}
          value={tuning.minSpeechMs}
          onChange={(value) => onChange("minSpeechMs", value)}
        />
      </div>

      <label className="vadToggle">
        <input
          checked={tuning.adaptiveEnabled}
          disabled={disabled}
          type="checkbox"
          onChange={(event) => onChange("adaptiveEnabled", event.target.checked)}
        />
        <span>Adaptive eager detector</span>
      </label>

      <div className="vadGrid">
        <VadNumberControl
          disabled={disabled || !tuning.adaptiveEnabled}
          label="Adaptive after ms"
          max={4000}
          min={400}
          step={100}
          value={tuning.adaptiveAfterSpeechMs}
          onChange={(value) => onChange("adaptiveAfterSpeechMs", value)}
        />
        <VadNumberControl
          disabled={disabled || !tuning.adaptiveEnabled}
          label="Adaptive stop"
          max={0.14}
          min={0.005}
          step={0.005}
          value={tuning.adaptiveStopThreshold}
          onChange={(value) => onChange("adaptiveStopThreshold", value)}
        />
        <VadNumberControl
          disabled={disabled || !tuning.adaptiveEnabled}
          label="Adaptive silence ms"
          max={900}
          min={100}
          step={25}
          value={tuning.adaptiveSilenceDurationMs}
          onChange={(value) => onChange("adaptiveSilenceDurationMs", value)}
        />
      </div>
    </section>
  );
}

type VadNumberControlProps = {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

function VadNumberControl({
  disabled,
  label,
  max,
  min,
  step,
  value,
  onChange,
}: VadNumberControlProps) {
  function update(rawValue: string) {
    const next = Number(rawValue);

    if (Number.isFinite(next)) {
      onChange(Math.min(max, Math.max(min, next)));
    }
  }

  return (
    <label className="vadControl">
      <span>{label}</span>
      <input
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => update(event.target.value)}
      />
      <input
        disabled={disabled}
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => update(event.target.value)}
      />
    </label>
  );
}
