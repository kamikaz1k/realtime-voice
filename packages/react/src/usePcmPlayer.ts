import {
  createPcmPlayer,
  type AudioChunk,
  type PcmPlayer,
  type PcmPlayerState,
} from "@realtime-speech/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type UsePcmPlayerResult = PcmPlayerState & {
  enqueue: (chunk: AudioChunk) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => void;
  clear: () => void;
};

export function usePcmPlayer(): UsePcmPlayerResult {
  const playerRef = useRef<PcmPlayer | null>(null);
  const [state, setState] = useState<PcmPlayerState>({
    isPlaying: false,
    bufferedMs: 0,
  });

  const getPlayer = useCallback(() => {
    if (!playerRef.current) {
      playerRef.current = createPcmPlayer();
      playerRef.current.onStateChange(setState);
    }

    return playerRef.current;
  }, []);

  const enqueue = useCallback(
    (chunk: AudioChunk) => {
      getPlayer().enqueue(chunk);
    },
    [getPlayer],
  );

  const play = useCallback(async () => {
    await getPlayer().play();
  }, [getPlayer]);

  const pause = useCallback(async () => {
    await getPlayer().pause();
  }, [getPlayer]);

  const stop = useCallback(() => {
    getPlayer().stop();
  }, [getPlayer]);

  const clear = useCallback(() => {
    getPlayer().clear();
  }, [getPlayer]);

  useEffect(
    () => () => {
      void playerRef.current?.close();
      playerRef.current = null;
    },
    [],
  );

  return {
    ...state,
    enqueue,
    play,
    pause,
    stop,
    clear,
  };
}
