// Type-ahead client logic: debounce keystrokes, abort the stale request.
export function createSearch(fetchFn, onResults, waitMs = 250) {
  let timer, controller;
  return (text) => {
    clearTimeout(timer);                                   // debounce
    timer = setTimeout(async () => {
      controller?.abort();                                 // cancel the stale request
      controller = new AbortController();
      try {
        const res = await fetchFn(`/admin/users?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        onResults(text, await res.json());
      } catch (err) { if (err.name !== 'AbortError') throw err; }
    }, waitMs);
  };
}
