import { createTransaction } from './_lib/transactions.mjs';
import { getEmployee } from './_lib/supabase.mjs';
import { fail, methodNotAllowed, readJson, sendJson } from './_lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const body = await readJson(req);
    const employee = await getEmployee(String(body.actorId || ''));
    if (!employee) return sendJson(res, 403, { error: 'Choose one of the five demonstration roles.' });
    const transaction = await createTransaction(body, employee, { origin: 'website' });
    sendJson(res, 201, { transaction });
  } catch (error) { fail(res, error); }
}
