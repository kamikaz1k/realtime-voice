# Realtime Speech Implementation Plan

This plan tracks the remaining work after the first runnable spike/demo. Each milestone should end with a review gate before moving on.

## Milestone 1: Provider and Transport Seams

Goal: keep the public React hook behavior unchanged while separating reusable state machines from browser/OpenAI transport details.

Work:

- Add internal transport factory interfaces for STT and TTS.
- Keep the current OpenAI WebRTC STT path as the default transport.
- Keep the current OpenAI WebSocket TTS path as the default transport.
- Let tests and future providers inject alternate transports without changing hook call sites.
- Preserve the current client-secret auth path.

Review focus:

- Whether the seam is at the right level of abstraction.
- Whether future proxy/provider support is still possible without leaking OpenAI event details into React hooks.
- Whether the public API remains understandable.

## Milestone 2: Adaptive Client VAD Segmentation

Goal: reduce final-utterance latency for continuous dictation without hard-cutting active speech.

Work:

- Default continuous mode to adaptive silence detection.
- Keep single mode pause-based by default so it does not stop mid-thought.
- Expose `vad` through the React hook.
- Document the distinction between live deltas and finalized chunks.

Review focus:

- Whether adaptive continuous defaults are aggressive enough.
- Whether continuous and single mode should have different defaults.

## Milestone 3: Focused Test Harness

Goal: make the library safer to change without requiring a live OpenAI session for every check.

Work:

- Add Vitest workspace setup.
- Test STT event accumulation from transcript delta/completed events.
- Test TTS FIFO queue behavior, cancellation, max text guard, and error callbacks.
- Test PCM16 decode and player buffer math where practical.
- Test server handler method/auth/session behavior with mocked `fetch`.
- Test React hook lifecycle cleanup with mocked transports.

Review focus:

- Whether the tests cover the riskiest behavior.
- Whether mocks are simple enough to maintain.

## Milestone 4: Pluggable Client VAD

Goal: keep the current energy-based VAD as the default while making boundary detection replaceable.

Work:

- Extract the current RMS threshold detector behind a small strategy interface.
- Support custom VAD implementations without coupling them to OpenAI events.
- Preserve current single-utterance defaults: `startThreshold: 0.08`, `stopThreshold: 0.035`, `silenceDurationMs: 800`, `minSpeechMs: 250`.
- Preserve adaptive continuous-mode segmentation: base `silenceDurationMs: 600`, eager `silenceDurationMs: 250` after `1600ms` of speech.
- Add tests for auto-commit timing and custom VAD wiring.

Review focus:

- Whether the custom VAD contract is flexible enough for later AudioWorklet/WASM/WebRTC VAD.
- Whether the default remains easy for app developers.

## Milestone 5: Docs and API Examples

Goal: make the package usable without reading the source.

Work:

- Add hook usage examples for STT, TTS, and the PCM player helper.
- Document the client-secret endpoint contract.
- Document client vs proxy mode expectations.
- Document TTS queue semantics, cancellation handles, and the conservative `maxTextChars` guard.
- Link to official OpenAI docs for actual API/session limits and explain why the library default is smaller.
- Document mobile/browser requirements and permission behavior.

Review focus:

- Whether the examples match the API you want to expose.
- Whether the uncertainty around OpenAI limits, VAD behavior, and browser support is explicit enough.

## Milestone 6: Browser and Mobile QA

Goal: validate the working behavior in real browsers.

Work:

- Run desktop browser smoke tests for STT start/stop/reset and TTS play/pause/cancel.
- Verify denied microphone permission behavior.
- Check iOS Safari and Android Chrome manually before claiming mobile support.
- Record known browser limitations in docs.

Review focus:

- Whether the demo experience is good enough for iteration.
- Whether any mobile issue should change the package API before publishing.
