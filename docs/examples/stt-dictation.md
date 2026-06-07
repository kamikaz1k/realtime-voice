# API Example: Voice Dictation

Use `useSpeechToText` when your app needs the user's words as text. This fits chat boxes, command palettes, agent inputs, notes, search boxes, and any flow where the app already knows what to do with submitted text.

This example uses voice dictation with auto-submit:

- `onStreamChunk` updates the visible draft while the user speaks.
- `onFinal` submits the finalized utterance to your app.
- `mode: "continuous"` keeps listening for more speech turns.
- Client-side VAD decides when to commit an utterance, so users do not need to press submit after every sentence.

## React Hook

```tsx
import { useState } from "react";
import { useSpeechToText } from "@realtime-speech/react";

type VoiceDictationProps = {
  onSubmit: (text: string) => void;
};

export function VoiceDictation({ onSubmit }: VoiceDictationProps) {
  const [draft, setDraft] = useState("");

  const speech = useSpeechToText({
    auth: {
      mode: "ephemeral",
      getClientSecret,
    },
    mode: "continuous",
    language: "en",
    onStreamChunk: (delta) => {
      setDraft((current) => current + delta);
    },
    onFinal: (utterance) => {
      const text = utterance.text.trim();

      if (text) {
        onSubmit(text);
      }

      setDraft("");
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        if (draft.trim()) {
          onSubmit(draft.trim());
          setDraft("");
          speech.reset();
        }
      }}
    >
      <textarea
        value={draft}
        readOnly
        placeholder="Start talking..."
      />

      <div>
        <button
          type="button"
          onClick={speech.startNew}
          disabled={speech.isListening}
        >
          Start talking
        </button>

        <button
          type="button"
          onClick={speech.stop}
          disabled={!speech.isListening}
        >
          Stop
        </button>
      </div>

      {speech.error && <p role="alert">{speech.error.message}</p>}
    </form>
  );
}

async function getClientSecret() {
  const response = await fetch("/api/realtime-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purpose: "stt", language: "en" }),
  });

  if (!response.ok) {
    throw new Error("Failed to create realtime session");
  }

  const data = (await response.json()) as {
    value?: string;
    client_secret?: {
      value?: string;
    };
  };

  const secret = data.value ?? data.client_secret?.value;

  if (!secret) {
    throw new Error("Realtime session response did not include a client secret");
  }

  return secret;
}
```

## Server Token Endpoint

The browser should never receive your standard OpenAI API key. Create an app-server endpoint that mints a short-lived Realtime client secret.

```ts
import { createRealtimeSessionHandler } from "@realtime-speech/server";

export const POST = createRealtimeSessionHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  getSafetyIdentifier: async (request) => {
    const user = await getUser(request);
    return user ? hashUserId(user.id) : undefined;
  },
});
```

The default server session for `{ purpose: "stt" }` uses a transcription session with `gpt-realtime-whisper`, `delay: "low"`, and `turn_detection: null`. The client hook owns microphone capture, WebRTC setup, transcript delta handling, and client-side commit timing.

## Why This Shape

Voice dictation is the smallest useful voice primitive for chat and agent products. It gives your app text, not an opinionated voice-agent runtime. You can feed finalized utterances into any system:

```tsx
<VoiceDictation
  onSubmit={(text) => {
    chat.sendMessage({ role: "user", content: text });
  }}
/>
```

The hook exposes two text paths because they have different UI jobs:

- `onStreamChunk` is provisional. Use it for live preview while the user speaks.
- `onFinal` is committed. Use it for auto-submit, command execution, persistence, or analytics.

## Compared With Raw OpenAI Realtime

OpenAI's Realtime transcription docs recommend `gpt-realtime-whisper` when an app needs live transcript deltas. A raw implementation needs to create a transcription session, capture or stream microphone audio, omit or disable turn detection for `gpt-realtime-whisper`, commit audio manually, handle delta and completed events, and reconcile final events by `item_id`.

The raw event handling looks roughly like this:

```ts
ws.onmessage = (message) => {
  const event = JSON.parse(message.data);

  if (event.type === "conversation.item.input_audio_transcription.delta") {
    appendPreviewText(event.delta);
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    submitFinalText(event.item_id, event.transcript);
  }
};
```

That is a good low-level API when you need full control over transport, audio format, buffering, and commit policy. `useSpeechToText` is the app-facing layer for the common React case: start the mic, show live text, and receive committed utterances.

Sources:

- [OpenAI Realtime overview](https://developers.openai.com/api/docs/guides/realtime)
- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)

## Compared With ElevenLabs `useScribe`

ElevenLabs has a strong direct comparison point: `useScribe` from `@elevenlabs/react`. Their client-side realtime STT guide uses Scribe v2 Realtime, a single-use token, microphone connection, partial transcript callbacks, committed transcript callbacks, and optional timestamped committed transcripts.

The shape is similar:

```tsx
import { useScribe } from "@elevenlabs/react";

function ElevenLabsDictation() {
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    onPartialTranscript: (data) => {
      appendPreviewText(data.text);
    },
    onCommittedTranscript: (data) => {
      submitFinalText(data.text);
    },
  });

  async function start() {
    const token = await fetchScribeToken();
    await scribe.connect({
      token,
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  }

  return (
    <>
      <button onClick={start} disabled={scribe.isConnected}>
        Start recording
      </button>
      <button onClick={scribe.disconnect} disabled={!scribe.isConnected}>
        Stop
      </button>
    </>
  );
}
```

The difference is product positioning, not whether both can do live STT. ElevenLabs `useScribe` is a provider-specific Scribe integration. `useSpeechToText` is meant to be the OpenAI Realtime-backed STT hook inside a broader STT/TTS library, with the same auth shape, typed errors, demo patterns, and future provider seams as the rest of this package.

Sources:

- [ElevenLabs client-side streaming STT](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming)
- [ElevenLabs React Scribe SDK](https://elevenlabs.io/docs/eleven-api/resources/libraries/react-scribe)

## When Not To Use This Hook

Use a full realtime audio session or voice-agent SDK when the model should listen, reason, call tools, and speak back over the same live session. This hook intentionally stops at speech-to-text so your application can decide what the text means and where it goes.

Use request-based speech-to-text for uploaded files, recordings, diarization-heavy workflows, or cases where live partial text is not needed.
