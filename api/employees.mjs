import { listEmployees } from './_lib/supabase.mjs';
import { fail, methodNotAllowed, sendJson } from './_lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const employees = await listEmployees();
    sendJson(res, 200, employees.map(({ id, name, role, telegram_chat_id }) => ({
      id, name, role, telegram_linked: Boolean(telegram_chat_id)
    })));
  } catch (error) { fail(res, error); }
}
