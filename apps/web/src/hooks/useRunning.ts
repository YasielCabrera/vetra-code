import { useCallback, useState } from "react";

export function useRunning(): readonly [boolean, (run: () => Promise<unknown>) => Promise<void>] {
  const [running, setRunning] = useState(false);
  const track = useCallback(async (run: () => Promise<unknown>) => {
    setRunning(true);
    try {
      await run();
    } finally {
      setRunning(false);
    }
  }, []);
  return [running, track] as const;
}
