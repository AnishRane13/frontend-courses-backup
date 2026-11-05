// Last-resort handlers: log, stop taking traffic, exit non-zero. Never keep serving.
import http from 'node:http';

export function installCrashHandlers(server, log) {
  let crashing = false;
  const crash = (kind) => (err) => {
    if (crashing) return;                       // a second error during shutdown: already exiting
    crashing = true;
    log(`${kind}: ${err?.message ?? err}`);
    process.exitCode = 1;
    server.close(() => log('server closed, exiting'));   // finish in-flight requests
    setTimeout(() => process.exit(1), 5000).unref();           // never hang forever
  };
  process.on('uncaughtException', crash('uncaughtException'));
  process.on('unhandledRejection', crash('unhandledRejection'));
}

if (import.meta.main) {
  const mode = process.argv[2];
  const server = http.createServer((req, res) => res.end('ok')).listen(0);
  if (mode === 'handled') installCrashHandlers(server, (m) => console.log('[log]', m));
  if (mode === 'swallow') process.on('unhandledRejection', (e) => console.log('[swallowed]', e.message));
  setTimeout(() => { Promise.reject(new Error('cache refresh failed')); }, 50);   // nobody awaits this
  setTimeout(() => {
    console.log(server.listening ? 'still serving after the error' : 'not serving any more');
    if (server.listening) server.close();
  }, 200);
}
