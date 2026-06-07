import { useMemo, useRef, useState } from "react";
import {
  connectRealtimeSpike,
  getCandidateLabel,
  type Candidate,
  type RealtimeSpikeConnection,
  type SpikeEvent,
  type TranscriptUtterance,
} from "./realtime";

type Status = "idle" | "connecting" | "connected" | "error";

const candidateOptions: Candidate[] = ["whisper_manual", "server_vad_realtime"];

export function App() {
  const [candidate, setCandidate] = useState<Candidate>("whisper_manual");
  const [language, setLanguage] = useState("en");
  const [status, setStatus] = useState<Status>("idle");
  const [transportStatus, setTransportStatus] = useState("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [events, setEvents] = useState<SpikeEvent[]>([]);
  const [utterances, setUtterances] = useState<Record<string, TranscriptUtterance>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [showRawEvents, setShowRawEvents] = useState(false);
  const connectionRef = useRef<RealtimeSpikeConnection | null>(null);

  const finalUtterances = useMemo(
    () =>
      Object.values(utterances)
        .filter((utterance) => utterance.final)
        .sort((left, right) => left.updatedAt - right.updatedAt),
    [utterances],
  );

  const interimUtterances = useMemo(
    () =>
      Object.values(utterances)
        .filter((utterance) => !utterance.final)
        .sort((left, right) => left.updatedAt - right.updatedAt),
    [utterances],
  );

  async function connect() {
    disconnect();
    setError(null);
    setStatus("connecting");
    setEvents([]);
    setUtterances({});

    try {
      connectionRef.current = await connectRealtimeSpike({
        candidate,
        language: language.trim() || undefined,
        onStatus: setTransportStatus,
        onAudioLevel: setAudioLevel,
        onEvent: (event) => {
          setEvents((current) => [event, ...current].slice(0, 200));
        },
        onTranscriptDelta: (itemId, delta) => {
          setUtterances((current) => {
            const existing = current[itemId];
            const text = `${existing?.text ?? ""}${delta}`;

            return {
              ...current,
              [itemId]: {
                itemId,
                text,
                final: false,
                updatedAt: Date.now(),
              },
            };
          });
        },
        onTranscriptFinal: (itemId, transcript) => {
          setUtterances((current) => ({
            ...current,
            [itemId]: {
              itemId,
              text: transcript,
              final: true,
              updatedAt: Date.now(),
            },
          }));
        },
      });
      setStatus("connected");
    } catch (caught) {
      setStatus("error");
      setTransportStatus("error");
      setAudioLevel(0);
      setError(caught instanceof Error ? caught.message : "Unknown error");
      connectionRef.current?.close();
      connectionRef.current = null;
    }
  }

  function disconnect() {
    connectionRef.current?.close();
    connectionRef.current = null;
    setStatus("idle");
    setTransportStatus("idle");
    setAudioLevel(0);
  }

  function commitAudio() {
    try {
      connectionRef.current?.commitAudio();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Commit failed");
    }
  }

  function clearBuffer() {
    try {
      connectionRef.current?.clearAudioBuffer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Clear failed");
    }
  }

  return (
    <main className="app">
      <section className="toolbar" aria-label="Spike controls">
        <div className="field">
          <label htmlFor="candidate">Candidate</label>
          <select
            id="candidate"
            value={candidate}
            disabled={status === "connecting" || status === "connected"}
            onChange={(event) => setCandidate(event.target.value as Candidate)}
          >
            {candidateOptions.map((option) => (
              <option key={option} value={option}>
                {getCandidateLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div className="field short">
          <label htmlFor="language">Language</label>
          <input
            id="language"
            value={language}
            disabled={status === "connecting" || status === "connected"}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder="en"
          />
        </div>

        <div className="actions">
          <button disabled={status === "connecting"} onClick={() => void connect()}>
            Connect
          </button>
          <button disabled={status !== "connected"} onClick={disconnect}>
            Disconnect
          </button>
          <button disabled={status !== "connected"} onClick={commitAudio}>
            Commit audio
          </button>
          <button disabled={status !== "connected"} onClick={clearBuffer}>
            Clear buffer
          </button>
        </div>
      </section>

      <section className="statusGrid" aria-label="Connection status">
        <StatusTile label="State" value={status} />
        <StatusTile label="Transport" value={transportStatus} />
        <StatusTile label="Events" value={events.length.toString()} />
        <div className="meterTile">
          <span>Audio level</span>
          <div className="meter">
            <div style={{ width: `${Math.round(audioLevel * 100)}%` }} />
          </div>
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}

      <section className="columns">
        <article className="panel">
          <div className="panelHeader">
            <h2>Live Transcript</h2>
            <button
              className="secondary"
              onClick={() => {
                setUtterances({});
                setEvents([]);
                setError(null);
              }}
            >
              Reset
            </button>
          </div>

          {interimUtterances.length === 0 && finalUtterances.length === 0 ? (
            <p className="empty">No transcript yet.</p>
          ) : null}

          {interimUtterances.map((utterance) => (
            <TranscriptRow
              key={utterance.itemId}
              utterance={utterance}
              label="Interim"
            />
          ))}

          {finalUtterances.map((utterance) => (
            <TranscriptRow
              key={utterance.itemId}
              utterance={utterance}
              label="Final"
            />
          ))}
        </article>

        <article className="panel">
          <div className="panelHeader">
            <h2>Raw Events</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={showRawEvents}
                onChange={(event) => setShowRawEvents(event.target.checked)}
              />
              Show payloads
            </label>
          </div>

          <ol className="eventList">
            {events.map((event) => (
              <li key={event.id}>
                <div className="eventLine">
                  <time>{event.at.slice(11, 19)}</time>
                  <code>{event.type}</code>
                </div>
                {showRawEvents ? (
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                ) : null}
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="notes">
        <h2>What to check</h2>
        <ul>
          <li>For the Whisper candidate, speak and then press Commit audio.</li>
          <li>For the server VAD candidate, verify whether final transcripts arrive automatically.</li>
          <li>Watch whether deltas appear while speaking or only after speech stops.</li>
          <li>Confirm no assistant response audio is generated.</li>
        </ul>
      </section>
    </main>
  );
}

function StatusTile(props: { label: string; value: string }) {
  return (
    <div className="statusTile">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TranscriptRow(props: {
  utterance: TranscriptUtterance;
  label: "Interim" | "Final";
}) {
  return (
    <div className={props.label === "Final" ? "transcript final" : "transcript"}>
      <div>
        <span>{props.label}</span>
        <code>{props.utterance.itemId}</code>
      </div>
      <p>{props.utterance.text}</p>
    </div>
  );
}
