async function refreshCache(): Promise<void> { throw new Error('cache refresh failed'); }

export function startTimers(): void {
  setInterval(() => { refreshCache(); }, 60_000);                    // nobody awaits: flagged
  setInterval(() => { refreshCache().catch(console.error); }, 60_000); // handled: not flagged
}
