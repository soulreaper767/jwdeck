export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const bad = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'Not permitted') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

// Wrap a sync/async handler so thrown errors become JSON responses.
export const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    const status = e.status || (/UNIQUE constraint/.test(e.message) ? 409 : 400);
    const message = /UNIQUE constraint/.test(e.message) ? 'That code already exists' : e.message;
    if (status >= 500 || !e.status) console.error(e);
    res.status(status).json({ error: message });
  }
};

export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const bool = (v) => (v ? 1 : 0);
