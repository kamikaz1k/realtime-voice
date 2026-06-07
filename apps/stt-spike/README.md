# STT Realtime Spike

This app compares two candidate OpenAI Realtime STT configurations:

- `gpt-realtime-whisper` transcription session with manual audio commits.
- `gpt-realtime` session with `server_vad` and input transcription enabled.

## Run

```sh
cp apps/stt-spike/.env.example apps/stt-spike/.env.local
```

Set `OPENAI_API_KEY` in `apps/stt-spike/.env.local` or the repo root `.env.local`, then run:

```sh
pnpm dev:stt-spike
```

The token middleware reads `.env.local` when a token is requested, so adding or changing the key while the dev server is already running is fine. It checks the spike app directory first, then the repo root.

Open the printed Vite URL. For phone testing, use the network URL Vite prints and make sure the phone can reach the machine. Mobile microphone access usually requires a secure context, so use an HTTPS tunnel or HTTPS dev certificate if the phone blocks `getUserMedia` on the LAN URL.

## Test Procedure

1. Select `gpt-realtime-whisper, manual commit`.
2. Connect, grant microphone permission, speak, then press `Commit audio`.
3. Check whether transcript deltas appear before the final transcript.
4. Disconnect, switch to `Realtime session, server_vad`.
5. Connect and speak without pressing `Commit audio`.
6. Check whether speech start/stop events and transcript final events arrive automatically.
7. Confirm that no assistant audio response plays.

Use the raw event log to compare exact OpenAI event shapes before implementing the library abstractions.
