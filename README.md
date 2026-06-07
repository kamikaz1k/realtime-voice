# Realtime Speech

TypeScript packages for OpenAI Realtime speech-to-text and text-to-speech, plus React hooks and a demo app.

## API Examples

### Voice Dictation With Auto-Submit

Add speech input to a chat, agent, command, or form flow with `useSpeechToText`.

```tsx
const speech = useSpeechToText({
  auth: { mode: "ephemeral", getClientSecret },
  mode: "continuous",
  language: "en",
  onStreamChunk: (delta) => {
    setDraft((current) => current + delta);
  },
  onFinal: (utterance) => {
    submitMessage(utterance.text);
    setDraft("");
  },
});
```

Read the full example: [Voice dictation with auto-submit](docs/examples/stt-dictation.md).

## Current STT Default

`useSpeechToText` defaults to `gpt-realtime-whisper` with client-side VAD and automatic audio commits. This gives live transcript deltas while still producing finalized utterances after local silence detection.

In continuous mode, client VAD uses adaptive silence detection. It starts conservatively, then after a segment has been active for a while, it accepts a shorter quiet gap. That makes natural pauses finalize faster without forcing hard timed cuts in the middle of speech.

## Demo

Set `OPENAI_API_KEY` in `.env.local`, then run:

```sh
pnpm dev
```

Open the printed Vite URL. The demo runs on port `5174` by default.

## Build

```sh
pnpm build
```

The STT spike app is still available separately:

```sh
pnpm dev:stt-spike
pnpm build:stt-spike
```

## Packages

- `@realtime-speech/react`: `useSpeechToText`, `useTextToSpeech`, and `usePcmPlayer`.
- `@realtime-speech/core`: framework-agnostic STT/TTS controllers, shared types, PCM player helper.
- `@realtime-speech/server`: generic Fetch handler for minting Realtime client secrets.
