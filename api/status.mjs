import { isSupabaseConfigured } from './_lib/supabase.mjs';
import { telegramConfigured } from './_lib/telegram.mjs';
import { sendJson, methodNotAllowed } from './_lib/http.mjs';

export default function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const missing = [];
  if (!isSupabaseConfigured()) missing.push('Supabase');
  if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) missing.push('Google Sheets');
  if (!telegramConfigured()) missing.push('Telegram');
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  sendJson(res, 200, {
    ready: missing.length === 0,
    missing,
    studentName: process.env.APP_STUDENT_NAME || 'Set your name before publishing',
    links: {
      telegram: username ? `https://t.me/${username}` : null,
      sheets: process.env.GOOGLE_SHEETS_URL || null,
      github: process.env.GITHUB_REPOSITORY_URL || null
    }
  });
}
