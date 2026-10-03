import { dashboardFor } from './_lib/finance.mjs';
import { getEmployee } from './_lib/supabase.mjs';
import { fail, methodNotAllowed, sendJson } from './_lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const employeeId = String(req.query?.employeeId || '');
    if (!employeeId) return sendJson(res, 400, { error: 'Select a demonstration role.' });
    const employee = await getEmployee(employeeId);
    if (!employee) return sendJson(res, 404, { error: 'That demonstration role was not found.' });
    sendJson(res, 200, await dashboardFor(employee));
  } catch (error) { fail(res, error); }
}
