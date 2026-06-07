# STT Model and VAD Spike Plan

## Outcome

Default v1 STT should use `gpt-realtime-whisper` with client-side VAD and automatic commits.

Reason:

- The `gpt-realtime-whisper` candidate streams transcript deltas while the user is speaking.
- The `server_vad` candidate behaves like turn-boundary detection: text appears after the user pauses because VAD is deciding when to commit/chunk an utterance.
- The target product behavior needs both live UI feedback and automatic boundaries, so the right composition is live streaming transcription plus local/client VAD.

`server_vad` remains useful as a future option for turn-based transcription, but it should not be the default for live dictation.

## Original Objective

Resolve the main uncertainty in the architecture: which OpenAI Realtime configuration should back `useSpeechToText` v1 while preserving the desired public behavior:

- Works in mobile browsers.
- Uses browser-friendly microphone capture.
- Streams near-instant transcript deltas.
- Supports VAD-style automatic utterance boundaries.
- Does not generate assistant audio or text responses.

The output of this spike is a documented implementation choice, not a polished library.

## Background

OpenAI's Realtime transcription docs identify `gpt-realtime-whisper` as the lowest-latency streaming transcription model. The same docs say `gpt-realtime-whisper` requires `audio.input.turn_detection` to be omitted or set to `null`, then audio must be committed manually.

OpenAI's VAD docs say transcription-session VAD depends on model support. Models that support VAD default to `server_vad`, while `gpt-realtime-whisper` requires turn detection to be omitted or set to `null`.

This means the exact desired config, `gpt-realtime-whisper` plus server VAD, is probably not valid. We need to test the viable alternatives before locking the STT implementation.

Sources:

- [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad)
- [gpt-realtime-whisper](https://developers.openai.com/api/docs/models/gpt-realtime-whisper)
- [Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)

## Candidate A: Realtime Transcription with gpt-realtime-whisper

Hypothesis: `gpt-realtime-whisper` gives the best near-instant transcript deltas, but we must handle utterance boundaries ourselves.

Configuration:

- Browser connects with WebRTC using an ephemeral client secret.
- Session type is `transcription`.
- Transcription model is `gpt-realtime-whisper`.
- `audio.input.turn_detection` is omitted or set to `null`.
- Client sends commit events when it believes an utterance boundary occurred.

Validation questions:

- Do transcript delta events arrive while the user is still speaking?
- Can WebRTC microphone audio be manually committed through data-channel events in this mode?
- If manual commit works, does the model emit reliable final transcript events?
- How much local VAD/client commit logic is needed to make the UX feel automatic?
- Does it behave acceptably on iOS Safari and Chrome Android?

Expected events:

- `conversation.item.input_audio_transcription.delta`
- `conversation.item.input_audio_transcription.completed`

Likely outcome:

- Best latency.
- More client-side logic.
- Public API can still expose VAD-like behavior, but implementation may be local/client VAD rather than OpenAI server VAD.

## Candidate B: Realtime Session with Server VAD and Input Transcription

Hypothesis: a normal Realtime session can use `server_vad` for utterance boundaries while still emitting transcript events, with assistant response generation disabled or ignored.

Configuration:

- Browser connects with WebRTC using an ephemeral client secret.
- Session type is `realtime`.
- `audio.input.turn_detection.type` is `server_vad`.
- Input transcription is enabled.
- Assistant response creation is disabled if the API supports it for this session shape, or ignored/cancelled if not.

Validation questions:

- Do transcript delta events arrive while speaking, or only final transcripts after VAD stop?
- Can the session avoid generating assistant responses?
- Are final transcript events reliable across continuous utterances?
- Is latency good enough for the target UI?
- Does it behave acceptably on iOS Safari and Chrome Android?

Expected events:

- `input_audio_buffer.speech_started`
- `input_audio_buffer.speech_stopped`
- Transcript delta/final events if input transcription is configured successfully.

Likely outcome:

- Cleaner automatic utterance boundaries.
- Potentially worse or less predictable transcript delta behavior.
- Risk of fighting the conversation-response lifecycle if response generation cannot be fully disabled.

## Spike Implementation

Create a minimal local app, not the final package structure:

```txt
apps/stt-spike/
  src/
    App.tsx
    realtime.ts
    token.ts
```

Add a minimal server route or dev server middleware that:

- Accepts `POST`.
- Uses `OPENAI_API_KEY` only on the server.
- Mints a Realtime client secret.
- Returns only the client secret to the browser.

The UI should have:

- Candidate selector: `gpt-realtime-whisper manual commit` vs `server_vad realtime session`.
- Connect/disconnect.
- Start/stop listening.
- Live transcript area.
- Final utterance list keyed by OpenAI `item_id`.
- Raw event log toggle for spike debugging only.
- Audio level meter.

## Success Criteria

A candidate can be the v1 default if it satisfies all of these:

- Works through WebRTC in a desktop browser.
- Produces visible transcript deltas before final completion.
- Produces final utterances reliably.
- Supports repeated utterances in one session.
- Avoids assistant audio/text output.
- Cleans up microphone tracks and peer connection on stop/unmount.
- Has a plausible path for mobile browser support.

Before declaring the spike done, test at least:

- Desktop Chromium.
- iOS Safari or iOS Chrome.
- Chrome Android if available.

## Decision Matrix

Use this table when recording the result:

| Requirement | Candidate A | Candidate B |
| --- | --- | --- |
| Near-instant deltas | Unknown | Unknown |
| Automatic utterance boundaries | Requires local/client VAD | Expected via server VAD |
| No assistant response | Expected | Unknown |
| WebRTC mic path | Expected | Expected |
| Mobile viability | Unknown | Unknown |
| Implementation complexity | Medium | Low to medium |
| API fit for `useSpeechToText` | Good if local VAD is acceptable | Best if transcript deltas are good |

## Follow-up After Spike

Update `docs/architecture.md` with:

- The chosen default STT mode: `gpt-realtime-whisper` plus client-side VAD/auto-commit.
- Whether v1 uses server VAD or local/client VAD internally: local/client VAD internally.
- The default transcription model/session type: Realtime transcription session with `gpt-realtime-whisper`.
- Any mobile caveats discovered.
- Any hook API changes required by observed behavior.

Then scaffold the pnpm workspace and start implementation.
