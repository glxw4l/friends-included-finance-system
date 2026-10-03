import { HttpError } from './http.mjs';

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

function requireSupabase() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new HttpError(503, 'Supabase is not configured. Add SUPABASE_URL and the server-only secret key in the deployment settings.');
  return { base, key, newSecretKey: key.startsWith('sb_secret_') };
}

export async function dbRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const { base, key, newSecretKey } = requireSupabase();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      ...(newSecretKey ? {} : { authorization: `Bearer ${key}` }),
      'content-type': 'application/json',
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = typeof data === 'object' && data?.message ? data.message : `Supabase returned ${response.status}.`;
    const duplicate = response.status === 409 || data?.code === '23505';
    throw new HttpError(duplicate ? 409 : 502, duplicate ? 'That reference has already been used.' : message, data);
  }
  return data;
}

export async function getEmployee(id) {
  const rows = await dbRequest(`employees?id=eq.${encodeURIComponent(id)}&select=*`);
  return rows[0] ?? null;
}

export async function getEmployeeByTelegramId(userId) {
  const rows = await dbRequest(`employees?telegram_user_id=eq.${encodeURIComponent(String(userId))}&select=*`);
  return rows[0] ?? null;
}

export async function listEmployees() {
  return dbRequest('employees?select=id,name,role,telegram_user_id,telegram_chat_id&order=name.asc');
}

export async function getTransaction(reference) {
  const rows = await dbRequest(`transactions?reference=eq.${encodeURIComponent(reference)}&select=*`);
  return rows[0] ?? null;
}

export async function updateTransaction(reference, patch, statusGuard) {
  let query = `transactions?reference=eq.${encodeURIComponent(reference)}&select=*`;
  if (statusGuard) query += `&status=eq.${encodeURIComponent(statusGuard)}`;
  const rows = await dbRequest(query, {
    method: 'PATCH', body: patch,
    headers: { Prefer: 'return=representation' }
  });
  return rows[0] ?? null;
}

export async function listTransactions(employee, limit = 500) {
  const scope = employee.role === 'manager' ? '' : `&submitted_by=eq.${encodeURIComponent(employee.id)}`;
  return dbRequest(`transactions?select=*&order=created_at.desc&limit=${limit}${scope}`);
}

export async function insertTransaction(record) {
  const rows = await dbRequest('transactions?select=*', {
    method: 'POST', body: record,
    headers: { Prefer: 'return=representation' }
  });
  return rows[0];
}
