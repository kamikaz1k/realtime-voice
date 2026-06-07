# Realtime Speech

TypeScript packages for OpenAI Realtime speech-to-text and text-to-speech, plus React hooks and a demo app.

## Packages

- `@realtime-speech/core`: framework-agnostic STT/TTS controllers, shared types, PCM player helper.
- `@realtime-speech/react`: `useSpeechToText`, `useTextToSpeech`, and `usePcmPlayer`.
- `@realtime-speech/server`: generic Fetch handler for minting Realtime client secrets.

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

## Current STT Default

`useSpeechToText` defaults to `gpt-realtime-whisper` with client-side VAD and automatic audio commits. This gives live transcript deltas while still producing finalized utterances after local silence detection.

In continuous mode, client VAD uses adaptive silence detection. It starts conservatively, then after a segment has been active for a while, it accepts a shorter quiet gap. That makes natural pauses finalize faster without forcing hard timed cuts in the middle of speech.

## API Examples

- [Voice dictation with auto-submit](docs/examples/stt-dictation.md): add speech input to a chat, agent, command, or form flow with `useSpeechToText`.
