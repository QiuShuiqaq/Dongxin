const running = new Map<string, Set<AbortController>>();

export function beginVoiceTestWork(sessionId: string) {
  const controller = new AbortController();
  const turns = running.get(sessionId) ?? new Set<AbortController>();
  turns.add(controller);
  running.set(sessionId, turns);
  return {
    signal: controller.signal,
    dispose: () => { turns.delete(controller); if (!turns.size) running.delete(sessionId); },
  };
}

export function cancelVoiceTestWork(sessionId: string): void {
  for (const controller of running.get(sessionId) ?? []) controller.abort(new Error('Voice test stopped'));
}
