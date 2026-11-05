// One error contract for the whole API: RFC 9457 problem+json. This file is the V2 Code sketch.
export class AppError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code, isOperational: true }); }
}

export const errorHandler = (log) => (err, req, res, next) => {
  if (res.headersSent) return next(err);                       // too late for a body
  const known = err.isOperational || err.type?.startsWith('entity.'); // ours, or a body-parser error
  const status = known ? err.status : 500;
  if (!known) log.error({ err, path: req.path }, 'unexpected error');
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', status,
    title: known ? err.message : 'Internal Server Error',      // never echo a bug's message
    code: err.code ?? (known ? err.type : 'INTERNAL'),
  });
};

export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}
