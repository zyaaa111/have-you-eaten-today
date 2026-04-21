import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { reportError } from "./error-monitor";

export function useLiveQuery<T>(
  querier: () => Promise<T> | T,
  deps: React.DependencyList = []
): T | undefined {
  const [value, setValue] = useState<T>();

  useEffect(() => {
    const observable = liveQuery(querier);
    const subscription = observable.subscribe({
      next: (result) => setValue(result),
      error: (err) => reportError({ type: "error", message: String(err) }),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
