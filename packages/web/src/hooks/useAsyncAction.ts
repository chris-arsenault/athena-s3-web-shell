import { useCallback, useReducer } from "react";

type Status = "idle" | "loading" | "success" | "error";

interface State<T> {
  status: Status;
  data: T | null;
  error: Error | null;
}

type Action<T> =
  | { type: "start" }
  | { type: "success"; data: T }
  | { type: "error"; error: Error }
  | { type: "reset" };

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case "start":
      return { status: "loading", data: state.data, error: null };
    case "success":
      return { status: "success", data: action.data, error: null };
    case "error":
      return { status: "error", data: state.data, error: action.error };
    case "reset":
      return { status: "idle", data: null, error: null };
  }
}

export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
) {
  const [state, dispatch] = useReducer(reducer<TResult>, {
    status: "idle",
    data: null,
    error: null,
  });

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      dispatch({ type: "start" });
      try {
        const data = await fn(...args);
        dispatch({ type: "success", data });
        return data;
      } catch (e) {
        dispatch({ type: "error", error: e as Error });
        return null;
      }
    },
    [fn]
  );

  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  return { ...state, run, reset, isLoading: state.status === "loading" };
}
