import { decideTransaction } from './_lib/transactions.mjs';
import { getEmployee } from './_lib/supabase.mjs';
import { fail, methodNotAllowed, readJson, sendJson } from './_lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const body = await readJson(req);
    const manager = await getEmployee(String(body.actorId || ''));
    if (!manager) return sendJson(res, 403, { error: 'Choose a valid demonstration role.' });
    const transaction = await decideTransaction(String(body.reference || ''), manager, body);
    sendJson(res, 200, { transaction });
  } catch (error) { fail(res, error); }
}
