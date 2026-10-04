import { createTransaction } from '../_lib/transactions.mjs';
import { getEmployeeByTelegramId } from '../_lib/supabase.mjs';
import { sendTelegramMessage } from '../_lib/telegram.mjs';
import { fail, readJson, sendJson } from '../_lib/http.mjs';

async function reply(chatId, text) {
  try { await sendTelegramMessage(chatId, text); }
  catch (error) { console.error('Telegram reply failed:', error); }
}

function parseCommand(text) {
  const cells = String(text || '').trim().split('|').map(value => value.trim());
  const command = cells.shift()?.replace(/^\//, '').split('@')[0].toLowerCase();
  return { command, cells };
}

function helpText() {
  return [
    'Friends Included staff bot',
    'Use /id to show the numeric Telegram user ID for manager setup.',
    'After Svetlana links you, send one line in this format:',
    '/sale|S01|Customer|A|Description|1000|50|30|20',
    '/expense|E01|Description|Materials|120|A',
    'Sale fields: reference, customer, project A/B, description, amount, Richard %, Anastasia %, Jean-Claude %.',
    'Expense fields: reference, description, Materials/Travel/Other, amount, proposed allocation A/B/overhead.'
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Telegram sends webhook updates with POST.' });
  let update = {};
  try {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || req.headers['x-telegram-bot-api-secret-token'] !== expected) return sendJson(res, 401, { error: 'Invalid webhook secret.' });
    update = await readJson(req);
    const message = update.message;
    const text = message?.text;
    const chatId = message?.chat?.id;
    const userId = message?.from?.id;
    if (!text || chatId === undefined || userId === undefined) return sendJson(res, 200, { ok: true });
    const { command, cells } = parseCommand(text);

    if (['start', 'id', 'help'].includes(command)) {
      const employee = await getEmployeeByTelegramId(userId);
      if (command === 'id') {
        return await reply(chatId, `Telegram user ID: ${userId}\nChat ID: ${chatId}\nGive the user ID to Svetlana for manager setup.`), sendJson(res, 200, { ok: true });
      }
      if (command === 'help') return await reply(chatId, helpText()), sendJson(res, 200, { ok: true });
      if (employee) {
        const { dbRequest } = await import('../_lib/supabase.mjs');
        await dbRequest(`employees?id=eq.${encodeURIComponent(employee.id)}`, {
          method: 'PATCH', body: { telegram_chat_id: String(chatId) }, headers: { Prefer: 'return=minimal' }
        });
        await reply(chatId, `Welcome, ${employee.name}. You can submit transactions with /sale or /expense. Send /help for formats.`);
      } else {
        await reply(chatId, `This account is not linked to an employee. Send /id to Svetlana for manager setup. Your user ID is ${userId}.`);
      }
      return sendJson(res, 200, { ok: true });
    }

    const employee = await getEmployeeByTelegramId(userId);
    if (!employee) {
      await reply(chatId, `Submission refused: this Telegram account is not linked to an employee. Send /id to Svetlana for manager setup. Your user ID is ${userId}.`);
      return sendJson(res, 200, { ok: true });
    }
    const { dbRequest } = await import('../_lib/supabase.mjs');
    await dbRequest(`employees?id=eq.${encodeURIComponent(employee.id)}`, {
      method: 'PATCH', body: { telegram_chat_id: String(chatId) }, headers: { Prefer: 'return=minimal' }
    });

    if (command === 'sale') {
      if (cells.length !== 8) throw Object.assign(new Error('Sale needs 8 fields after /sale. Send /help for the exact format.'), { status: 400 });
      const [reference, customer, project, description, amount, richard, anastasia, jeanClaude] = cells;
      const transaction = await createTransaction({
        kind: 'sale', reference, customer, project, description, amount,
        proposed_split: { richard, anastasia, jean_claude: jeanClaude }
      }, employee, { origin: 'telegram', telegramUserId: userId, chatId });
      return sendJson(res, 200, { ok: true, reference: transaction.reference });
    }
    if (command === 'expense') {
      if (cells.length !== 5) throw Object.assign(new Error('Expense needs 5 fields after /expense. Send /help for the exact format.'), { status: 400 });
      const [reference, description, category, amount, rawAllocation] = cells;
      const proposed_allocation = /^overhead$/i.test(rawAllocation) ? 'company_overhead' : rawAllocation.toUpperCase();
      const transaction = await createTransaction({ kind: 'expense', reference, description, category, amount, proposed_allocation }, employee, {
        origin: 'telegram', telegramUserId: userId, chatId
      });
      return sendJson(res, 200, { ok: true, reference: transaction.reference });
    }
    await reply(chatId, helpText());
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    const chatId = update?.message?.chat?.id;
    if (chatId !== undefined) await reply(chatId, `Could not record the transaction. ${error.message || 'Check the details and try again.'}`);
    // Return success to Telegram after responding; reference uniqueness prevents
    // a retried webhook from creating a duplicate financial record.
    sendJson(res, 200, { ok: true });
  }
}
