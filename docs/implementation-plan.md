# Realtime Speech Implementation Plan

This plan tracks the remaining work after the first runnable spike/demo. Each milestone should end with a review gate before moving on.

## Current Status

The exploratory phase has resolved the main architecture question: OpenAI `server_vad` is useful for turn boundaries, but it is not the v1 default for live dictation. v1 uses `gpt-realtime-whisper` transcript deltas for near-instant UI feedback and client-side VAD/manual commits for finalized utterance boundaries.

Completed:

- Milestone 1: provider and transport seams.
- Milestone 2: adaptive client VAD segmentation and explicit preview vs commit behavior.
- Milestone 3: focused unit test harness for STT, TTS, server handler, audio helpers, and React hooks.

Next:

- Milestone 5: docs and API examples.

Settled for v1:

- STT and TTS stay independent rather than being folded into a voice-agent abstraction.
- STT defaults to WebRTC + `gpt-realtime-whisper` + client-side commit control.
- TTS defaults to WebSocket + FIFO queueing + PCM chunk callbacks.
- Auth defaults to ephemeral client secrets minted by a server Fetch handler.
- Provider and transport seams remain internal for now.

Still uncertain:

- The custom VAD strategy shape, now deferred because the current continuous-mode defaults are working well.
- Whether future `server_vad` or `semantic_vad` support should be exposed as high-level modes.
- Whether a future realtime audio session hook belongs in this library or a companion package.
- Whether a public debug hook should expose raw Realtime events.
- Mobile browser behavior until manual iOS Safari and Android Chrome QA is complete.

## Milestone 1: Provider and Transport Seams (Complete)

Goal: keep the public React hook behavior unchanged while separating reusable state machines from browser/OpenAI transport details.

Work:

- [x] Add internal transport factory interfaces for STT and TTS.
- [x] Keep the current OpenAI WebRTC STT path as the default transport.
- [x] Keep the current OpenAI WebSocket TTS path as the default transport.
- [x] Let tests and future providers inject alternate transports without changing hook call sites.
- [x] Preserve the current client-secret auth path.

Review focus:

- Reviewed: the seam is currently internal and transport-level, which keeps the public hook API small while preserving future proxy/provider support.
- Reviewed: raw OpenAI events do not leak into React hook call sites.

## Milestone 2: Adaptive Client VAD Segmentation (Complete)

Goal: reduce final-utterance latency for continuous dictation without hard-cutting active speech.

Work:

- [x] Default continuous mode to adaptive silence detection.
- [x] Keep single mode pause-based by default so it does not stop mid-thought.
- [x] Expose `vad` through the React hook.
- [x] Document the distinction between live deltas and finalized chunks.
- [x] Annotate demo logs so preview and commit behavior are visibly distinct.

Review focus:

- Reviewed: continuous mode can be more aggressive, but should avoid hard timed cuts.
- Reviewed: preview text and committed/final text are separate UI concepts.

## Milestone 3: Focused Test Harness (Complete)

Goal: make the library safer to change without requiring a live OpenAI session for every check.

Work:

- [x] Add Vitest workspace setup.
- [x] Test STT event accumulation from transcript delta/completed events.
- [x] Test TTS FIFO queue behavior, cancellation, max text guard, and error callbacks.
- [x] Test PCM16 decode and player buffer math where practical.
- [x] Test server handler method/auth/session behavior with mocked `fetch`.
- [x] Test React hook lifecycle cleanup with mocked transports.

Review focus:

- Reviewed: tests cover the current riskiest behavior, especially STT accumulation and TTS queue/cancellation races.
- Reviewed: mocks stay at the transport boundary rather than depending on live OpenAI sessions.

## Milestone 4: Pluggable Client VAD (Deferred)

Goal: keep the current energy-based VAD as the default while making boundary detection replaceable.

Status: deferred. The current client-side continuous-mode detection settings are working well enough for the present workflow. Revisit this when a concrete custom detector is needed, such as AudioWorklet, WASM VAD, or WebRTC VAD.

Work:

- [ ] Extract the current RMS threshold detector behind a small strategy interface.
- [ ] Support custom VAD implementations without coupling them to OpenAI events.
- [ ] Preserve current single-utterance defaults: `startThreshold: 0.08`, `stopThreshold: 0.035`, `silenceDurationMs: 800`, `minSpeechMs: 250`.
- [ ] Preserve adaptive continuous-mode segmentation: base `silenceDurationMs: 600`, eager `silenceDurationMs: 250` after `1600ms` of speech.
- [ ] Add tests for auto-commit timing and custom VAD wiring.

Review focus:

- Whether the custom VAD contract is flexible enough for later AudioWorklet/WASM/WebRTC VAD.
- Whether the default remains easy for app developers.

## Milestone 5: Docs and API Examples (Next)

Goal: make the package usable without reading the source.

Work:

- [ ] Add hook usage examples for STT, TTS, and the PCM player helper.
  - [x] STT voice dictation with auto-submit.
  - [ ] TTS streaming speech playback.
  - [ ] PCM player helper.
- [ ] Document the client-secret endpoint contract.
- [ ] Document client vs proxy mode expectations.
- [ ] Document TTS queue semantics, cancellation handles, and the conservative `maxTextChars` guard.
- [ ] Link to official OpenAI docs for actual API/session limits and explain why the library default is smaller.
- [ ] Document mobile/browser requirements and permission behavior.

Review focus:

- Whether the examples match the API you want to expose.
- Whether the uncertainty around OpenAI limits, VAD behavior, and browser support is explicit enough.

## Milestone 6: Browser and Mobile QA (Pending)

Goal: validate the working behavior in real browsers.

Work:

- [ ] Run desktop browser smoke tests for STT start/stop/reset and TTS play/pause/cancel.
- [ ] Verify denied microphone permission behavior.
- [ ] Check iOS Safari and Android Chrome manually before claiming mobile support.
- [ ] Record known browser limitations in docs.

Review focus:

- Whether the demo experience is good enough for iteration.
- Whether any mobile issue should change the package API before publishing.

## Milestone 7: Realtime Audio Session (Deferred Roadmap)

Goal: consider a separate full-duplex realtime audio session hook for voice-agent style experiences.

Status: deferred. This should not change the v1 STT/TTS architecture. It is a future convenience surface for bidirectional audio sessions where OpenAI receives microphone audio directly and returns model audio directly over WebRTC media tracks.

Reference implementation to revisit:

- [openai/openai-realtime-console](https://github.com/openai/openai-realtime-console)
- Temporary local exploration clone: `/private/tmp/openai-realtime-console`

Reference behavior:

- Mint an ephemeral Realtime client secret from the server.
- Create an `RTCPeerConnection` in the browser.
- Capture microphone audio with `getUserMedia` and send it with `pc.addTrack`.
- Play model audio from `pc.ontrack` using a browser audio element or explicit playback controller.
- Send and receive Realtime JSON events over a WebRTC data channel.
- Keep this separate from transcription-only STT and PCM-chunk TTS APIs.

Potential public shape:

```ts
const session = useRealtimeAudioSession({
  auth,
  onEvent,
  onRemoteStream,
});

session.startSession();
session.sendClientEvent({ type: "response.create" });
session.stopSession();
```

Review focus:

- Whether this belongs in `@realtime-speech/react` or a separate package.
- Whether it should expose raw Realtime events directly or wrap common agent operations.
- Whether audio playback should be browser-media-track based, Web Audio based, or configurable.
