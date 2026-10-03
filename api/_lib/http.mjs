export function sendJson(res, status, body) {
  res.setHeader('cache-control', 'no-store');
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new HttpError(400, 'The request body must be valid JSON.'); }
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function fail(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  sendJson(res, status, {
    error: status >= 500 ? 'The request could not be completed.' : error.message,
    ...(error?.details ? { details: error.details } : {})
  });
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('allow', allowed.join(', '));
  sendJson(res, 405, { error: `Use ${allowed.join(' or ')} for this endpoint.` });
}
