import { fail, methodNotAllowed, sendJson } from '../_lib/http.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!process.env.TELEGRAM_SETUP_SECRET || req.headers.authorization !== `Bearer ${process.env.TELEGRAM_SETUP_SECRET}`) {
      return sendJson(res, 401, { error: 'Manager setup secret is missing or incorrect.' });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const baseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !baseUrl || !webhookSecret) return sendJson(res, 503, { error: 'Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and APP_BASE_URL first.' });
    let parsedBaseUrl;
    try { parsedBaseUrl = new URL(baseUrl); }
    catch { return sendJson(res, 400, { error: 'APP_BASE_URL must be a valid HTTPS URL.' }); }
    if (parsedBaseUrl.protocol !== 'https:') return sendJson(res, 400, { error: 'APP_BASE_URL must use HTTPS for Telegram webhooks.' });
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) return sendJson(res, 400, { error: 'TELEGRAM_WEBHOOK_SECRET must contain 1 to 256 letters, numbers, dashes, or underscores.' });
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: `${baseUrl}/api/telegram/webhook`,
        secret_token: webhookSecret,
        allowed_updates: ['message']
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) return sendJson(res, 502, { error: result.description || 'Telegram webhook setup failed.' });
    sendJson(res, 200, { ok: true, description: result.description });
  } catch (error) { fail(res, error); }
}
