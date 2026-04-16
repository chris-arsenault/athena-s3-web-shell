import { useEffect, useRef, useState } from "react";

interface PollingOpts<T> {
  enabled: boolean;
  fn: () => Promise<T>;
  intervalMs: number;
  until: (value: T) => boolean;
  timeoutMs?: number;
}

interface PollingState<T> {
  data: T | null;
  error: Error | null;
  done: boolean;
  timedOut: boolean;
}

export function usePolling<T>(opts: PollingOpts<T>): PollingState<T> {
  const [state, setState] = useState<PollingState<T>>({
    data: null,
    error: null,
    done: false,
    timedOut: false,
  });
  const startedRef = useRef<number>(0);

  useEffect(() => {
    if (!opts.enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    startedRef.current = Date.now();

    const tick = async () => {
      try {
        const data = await opts.fn();
        if (cancelled) return;
        const finished = opts.until(data);
        const timedOut =
          opts.timeoutMs !== undefined && Date.now() - startedRef.current > opts.timeoutMs;
        setState({ data, error: null, done: finished || timedOut, timedOut });
        if (!finished && !timedOut) timer = setTimeout(tick, opts.intervalMs);
      } catch (e) {
        if (cancelled) return;
        setState((s) => ({ ...s, error: e as Error, done: true }));
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.intervalMs, opts.timeoutMs]);

  return state;
}
