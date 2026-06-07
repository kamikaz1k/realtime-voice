# API Example: Voice Dictation

Use `useSpeechToText` when your app needs the user's words as text. This fits chat boxes, command palettes, agent inputs, notes, search boxes, and any flow where the app already knows what to do with submitted text.

This example uses voice dictation with auto-submit:

- `onStreamChunk` updates the visible draft while the user speaks.
- `onFinal` submits the finalized utterance to your app.
- `mode: "continuous"` keeps listening for more speech turns.
- Client-side VAD decides when to commit an utterance, while realtime transcript deltas keep the UI from sitting empty during longer turns.

## Realtime Hookup

```tsx
import { useState } from "react";
import { useSpeechToText } from "@realtime-speech/react";

type VoiceDictationProps = {
  onSubmit: (text: string) => void;
};

export function VoiceDictation({ onSubmit }: VoiceDictationProps) {
  const [preview, setPreview] = useState("");

  const speech = useSpeechToText({
    auth: {
      mode: "ephemeral",
      getClientSecret,
    },
    mode: "continuous",
    language: "en",
    onStreamChunk: (delta) => {
      setPreview((current) => current + delta);
    },
    onFinal: (utterance) => {
      const text = utterance.text.trim();

      if (text) {
        onSubmit(text);
      }

      setPreview("");
    },
  });

  return (
    <DictationInput
      preview={preview}
      isListening={speech.isListening}
      error={speech.error?.message}
      onStart={speech.startNew}
      onStop={speech.stop}
    />
  );
}
```

## Compared With ElevenLabs `useScribe`

ElevenLabs has a strong direct comparison point: `useScribe` from `@elevenlabs/react`. Their client-side realtime STT guide uses Scribe v2 Realtime, a single-use token, microphone connection, partial transcript callbacks, committed transcript callbacks, and optional timestamped committed transcripts.

The shape is intentionally similar:

```tsx
import { useState } from "react";
import { useScribe } from "@elevenlabs/react";

type ElevenLabsDictationProps = {
  onSubmit: (text: string) => void;
};

function ElevenLabsDictation({ onSubmit }: ElevenLabsDictationProps) {
  const [preview, setPreview] = useState("");

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    onPartialTranscript: (data) => {
      setPreview(data.text);
    },
    onCommittedTranscript: (data) => {
      const text = data.text.trim();

      if (text) {
        onSubmit(text);
      }

      setPreview("");
    },
  });

  async function startNew() {
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
    <DictationInput
      preview={preview}
      isListening={scribe.isConnected}
      error={scribe.error?.message}
      onStart={startNew}
      onStop={scribe.disconnect}
    />
  );
}
```

The practical difference:

- `useScribe` connects directly to ElevenLabs Scribe and owns provider-specific session config.
- `useSpeechToText` keeps the same React shape while routing through OpenAI Realtime ephemeral auth and the rest of this STT/TTS package.

For this library, the behavior to preserve is the preview/commit split: realtime deltas should keep the UI populated during long turns, while VAD-driven final commits decide when to auto-submit.

Sources:

- [ElevenLabs client-side streaming STT](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming)
- [ElevenLabs React Scribe SDK](https://elevenlabs.io/docs/eleven-api/resources/libraries/react-scribe)

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

The practical difference:

- Raw OpenAI Realtime gives you event primitives and leaves transport, buffering, preview state, and commit policy to the app.
- `useSpeechToText` is the app-facing layer for the common React case: start the mic, show live text, and receive committed utterances.

Sources:

- [OpenAI Realtime overview](https://developers.openai.com/api/docs/guides/realtime)
- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)

<details>
<summary>Rendering component used by the examples</summary>

Keep rendering separate from the realtime hookup. The UI can be a chat composer, command bar, note editor, or any app-specific input surface.

```tsx
type DictationInputProps = {
  preview: string;
  isListening: boolean;
  error?: string;
  onStart: () => void;
  onStop: () => void;
};

function DictationInput({
  preview,
  isListening,
  error,
  onStart,
  onStop,
}: DictationInputProps) {
  return (
    <section>
      <textarea value={preview} readOnly placeholder="Start talking..." />
      <button onClick={onStart} disabled={isListening}>
        Start talking
      </button>
      <button onClick={onStop} disabled={!isListening}>
        Stop
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

</details>

## Client Secret Helper

```ts
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

The important behavior for longer turns is that preview is not tied to final commit. Users can see words appear while they continue speaking, then client-side VAD commits the utterance after a natural pause.

## When Not To Use This Hook

Use a full realtime audio session or voice-agent SDK when the model should listen, reason, call tools, and speak back over the same live session. This hook intentionally stops at speech-to-text so your application can decide what the text means and where it goes.

Use request-based speech-to-text for uploaded files, recordings, diarization-heavy workflows, or cases where live partial text is not needed.
