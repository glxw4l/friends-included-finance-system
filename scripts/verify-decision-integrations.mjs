import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { decideTransaction, retryNotification, retrySync } from '../api/_lib/transactions.mjs';
import { summarize } from '../api/_lib/business.mjs';
import transactionHandler from '../api/transactions.mjs';
import telegramHandler from '../api/telegram/webhook.mjs';

// Exercise the actual processing code with offline service responses. No .env,
// downloaded credentials, browser, or external account is used by this check.
process.env.SUPABASE_URL = 'https://finance-test.invalid';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_offline_test';
process.env.GOOGLE_SHEETS_ID = 'offline-sheet';
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'offline@example.invalid';
process.env.GOOGLE_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.TELEGRAM_BOT_TOKEN = 'offline-test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'offline-webhook-secret';

const manager = { id: 'svetlana', role: 'manager' };
const employees = new Map([
  ['richard', { id: 'richard', name: 'Richard', role: 'richard', telegram_user_id: '111', telegram_chat_id: '909' }],
  ['jean-claude', { id: 'jean-claude', telegram_chat_id: '303' }],
  ['kevin', { id: 'kevin', telegram_chat_id: '404' }]
]);
const rows = new Map();
const sheetWrites = [];
const notifications = [];
let failSheets = false;
let failTelegram = false;
let inserts = 0;
const clone = value => structuredClone(value);
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const method = options.method || 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : null;
  if (url.hostname === 'finance-test.invalid') {
    const collection = url.pathname.split('/').at(-1);
    if (collection === 'employees') {
      const id = url.searchParams.get('id')?.slice(3);
      const userId = url.searchParams.get('telegram_user_id')?.slice(3);
      const employee = id ? employees.get(id) : [...employees.values()].find(item => item.telegram_user_id === userId);
      if (method === 'PATCH' && employee) Object.assign(employee, body);
      return response(employee ? [clone(employee)] : []);
    }
    assert.equal(collection, 'transactions');
    const reference = url.searchParams.get('reference')?.slice(3);
    const row = rows.get(reference);
    if (method === 'GET') return response(row ? [clone(row)] : []);
    if (method === 'POST') { inserts++; throw new Error('A decision or retry must never insert a transaction.'); }
    assert.equal(method, 'PATCH');
    const guard = url.searchParams.get('status')?.slice(3);
    if (!row || (guard && row.status !== guard)) return response([]);
    Object.assign(row, body);
    return response([clone(row)]);
  }
  if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'offline-token', expires_in: 3600 });
  if (url.hostname === 'sheets.googleapis.com') {
    if (method === 'GET' && url.pathname.endsWith('/offline-sheet')) return response({ sheets: [{ properties: { title: 'Sales' } }, { properties: { title: 'Expenses' } }] });
    if (method === 'GET') return response({ values: [['Reference']] });
    assert.equal(method, 'PUT');
    const range = decodeURIComponent(url.pathname.split('/values/')[1]);
    sheetWrites.push({ range, values: clone(body.values), failed: failSheets });
    return failSheets ? response({ error: { message: 'Offline interrupted Sheets update' } }, 503) : response({ updatedRange: range });
  }
  if (url.hostname === 'api.telegram.org') {
    notifications.push({ ...clone(body), failed: failTelegram });
    return failTelegram ? response({ ok: false, description: 'Offline Telegram delivery failure' }, 403) : response({ ok: true, result: { message_id: notifications.length } });
  }
  throw new Error(`Unexpected offline request host: ${url.hostname}`);
};

function sale(reference, overrides = {}) {
  const row = {
    reference, kind: 'sale', submitted_by: 'richard', submitter_name: 'Richard',
    origin: 'website', origin_chat_id: null, origin_telegram_user_id: null,
    notification_chat_id: null, project: 'A', amount: 1000, description: 'Service', customer: 'Customer',
    proposed_split: { richard: 50, anastasia: 30, jean_claude: 20 },
    approved_split: null, commission_pool: 0, commission_amounts: { richard: 0, anastasia: 0, jean_claude: 0 },
    status: 'pending_approval', sheets_sync_status: 'synced', sheets_sync_error: null,
    submission_notification_status: 'sent', decision_notification_status: 'pending',
    sheet_row: rows.size + 2, created_at: '2026-10-04T10:00:00Z', ...overrides
  };
  rows.set(reference, row);
  return row;
}

const s01 = sale('S01', { origin: 'telegram', origin_chat_id: '101', origin_telegram_user_id: '111', notification_chat_id: '101' });
await decideTransaction('S01', manager, { action: 'approve_sale' });
assert.equal(s01.status, 'approved');
assert.equal(s01.sheets_sync_status, 'synced');
assert.equal(sheetWrites.length, 1, 'Approval must update an already synced submission row.');
assert.equal(sheetWrites[0].range, "'Sales'!A2:Q2");
assert.deepEqual(sheetWrites[0].values[0].slice(7, 13), [50, 30, 20, 50, 30, 20]);
assert.equal(sheetWrites[0].values[0].at(-1), 'Approved');
assert.equal(notifications.at(-1).chat_id, '101', 'A later employee chat must not replace the original bot chat.');
assert.equal(s01.origin_chat_id, '101');
assert.equal(s01.origin_telegram_user_id, '111');
assert.equal(s01.submitted_by, 'richard');
const beforeRepeat = summarize([...rows.values()]);
await decideTransaction('S01', manager, { action: 'approve_sale' });
assert.deepEqual(summarize([...rows.values()]), beforeRepeat);
assert.equal(sheetWrites.length, 1);
assert.equal(notifications.length, 1);

const s03 = sale('S03', { submitted_by: 'jean-claude', submitter_name: 'Jean-Claude', amount: 1500, proposed_split: { richard: 40, anastasia: 40, jean_claude: 20 } });
await decideTransaction('S03', manager, { action: 'approve_sale', approved_split: { richard: 20, anastasia: 30, jean_claude: 50 } });
assert.equal(s03.notification_chat_id, '303', 'A website submitter linked before approval must receive the decision.');
assert.equal(notifications.at(-1).chat_id, '303');
assert.deepEqual(s03.proposed_split, { richard: 40, anastasia: 40, jean_claude: 20 });
assert.deepEqual(s03.commission_amounts, { richard: 30, anastasia: 45, jean_claude: 75 });
assert.match(notifications.at(-1).text, /split changed/);

const s04 = sale('S04', { notification_chat_id: '202' });
await decideTransaction('S04', manager, { action: 'approve_sale' });
assert.equal(s04.notification_chat_id, '202', 'An existing website destination must stay frozen.');

const e02 = {
  reference: 'E02', kind: 'expense', origin: 'website', submitted_by: 'kevin', submitter_name: 'Kevin',
  notification_chat_id: null, description: 'Taxi', category: 'Travel', amount: 80,
  proposed_allocation: 'B', final_allocation: null, status: 'awaiting_allocation',
  sheets_sync_status: 'synced', decision_notification_status: 'pending', sheet_row: 2, created_at: '2026-10-04T10:00:00Z'
};
rows.set('E02', e02);
await decideTransaction('E02', manager, { action: 'allocate_expense', final_allocation: 'A' });
assert.equal(e02.proposed_allocation, 'B');
assert.equal(e02.final_allocation, 'A');
assert.equal(sheetWrites.at(-1).range, "'Expenses'!A2:I2");
assert.deepEqual(sheetWrites.at(-1).values[0].slice(-3), ['Project B', 'Project A', 'Allocated']);
assert.equal(e02.notification_chat_id, '404');

const interrupted = sale('S06');
failSheets = true;
const originalConsoleError = console.error;
console.error = () => {};
try { await decideTransaction('S06', manager, { action: 'approve_sale' }); }
finally { console.error = originalConsoleError; }
assert.equal(interrupted.status, 'approved');
assert.equal(interrupted.sheets_sync_status, 'failed');
assert.match(interrupted.sheets_sync_error, /interrupted/);
const failedRange = sheetWrites.at(-1).range;
const beforeSyncRetry = summarize([...rows.values()]);
failSheets = false;
await retrySync('S06', manager);
assert.equal(interrupted.sheets_sync_status, 'synced');
assert.equal(sheetWrites.at(-1).range, failedRange);
assert.deepEqual(summarize([...rows.values()]), beforeSyncRetry);

const failedDecision = sale('S07', { notification_chat_id: '101' });
failTelegram = true;
await decideTransaction('S07', manager, { action: 'approve_sale' });
assert.equal(failedDecision.status, 'approved');
assert.equal(failedDecision.decision_notification_status, 'failed');
const beforeNotificationRetry = summarize([...rows.values()]);
failTelegram = false;
await retryNotification('S07', manager);
assert.equal(failedDecision.decision_notification_status, 'sent');
assert.deepEqual(summarize([...rows.values()]), beforeNotificationRetry);

const overhead = {
  reference: 'E03', kind: 'expense', origin: 'website', submitted_by: 'kevin', notification_chat_id: '404',
  description: 'Subscription', amount: 100, proposed_allocation: 'company_overhead', final_allocation: 'company_overhead',
  status: 'allocated', submission_notification_status: 'failed', decision_notification_status: 'not_required'
};
rows.set('E03', overhead);
failTelegram = true;
await retryNotification('E03', manager);
assert.equal(overhead.submission_notification_status, 'failed');
assert.match(overhead.submission_notification_error, /delivery failure/);
failTelegram = false;
const beforeOverheadRetry = summarize([...rows.values()]);
await retryNotification('E03', manager);
assert.equal(overhead.submission_notification_status, 'sent');
assert.equal(overhead.submission_notification_error, null);
assert.deepEqual(summarize([...rows.values()]), beforeOverheadRetry);
assert.equal(inserts, 0);

// Execute the actual client event handler and visibility functions with a
// minimal document. The decision button intentionally has no reference itself.
const elements = new Map();
const listeners = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    hidden: false, textContent: '', innerHTML: '', style: {},
    addEventListener() {}, setAttribute() {}, querySelector() { return null; }
  });
  return elements.get(selector);
}
const requests = [];
const clientContext = vm.createContext({
  document: { querySelector: element, addEventListener(name, callback) { listeners.set(name, callback); } },
  window: { setTimeout() {}, prompt() { return null; } }, Intl, Date, console,
  fetch: async (path, options = {}) => {
    if (path === '/api/status') return response({ studentName: 'Test', missing: ['Supabase'] });
    requests.push({ path, body: JSON.parse(options.body || '{}') });
    return response({ transaction: {} });
  }
});
vm.runInContext(await readFile(new URL('../app.js', import.meta.url), 'utf8'), clientContext);
vm.runInContext("state.roleId = 'svetlana'; loadDashboard = async () => {}; setSectionVisibility({ role: 'manager' });", clientContext);
assert.equal(element('#entry-area').hidden, false, 'The parent of manager setup must remain visible to Svetlana.');
assert.equal(element('#manager-linking').hidden, false);
assert.equal(element('#sale-entry').hidden, true);
assert.equal(element('#expense-entry').hidden, true);
vm.runInContext("setSectionVisibility({ role: 'richard' });", clientContext);
assert.equal(element('#manager-linking').hidden, true);
assert.equal(element('#sale-entry').hidden, false);

for (const action of ['approve-sale', 'allocate-expense']) {
  const controls = {
    dataset: { reference: action === 'approve-sale' ? 'S01' : 'E02' },
    querySelectorAll: () => ['richard', 'anastasia', 'jean_claude'].map((key, index) => ({ dataset: { split: key }, value: [50, 30, 20][index] })),
    querySelector: () => ({ value: 'A' })
  };
  const button = { dataset: { action }, disabled: false, textContent: 'Decide', closest: () => controls };
  await listeners.get('click')({ target: { closest: () => button } });
  assert.equal(requests.at(-1).path, '/api/decisions');
  assert.equal(requests.at(-1).body.reference, controls.dataset.reference);
}
clientContext.overheadRow = { ...overhead, submission_notification_status: 'failed' };
assert.equal(vm.runInContext('notificationStatus(overheadRow)', clientContext), 'Telegram notification failed');
vm.runInContext('renderRecords([overheadRow], true)', clientContext);
assert.match(element('#records-list').innerHTML, /data-action="retry-notification"/);

function capturedResponse() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    end(value) { this.body = JSON.parse(value); }
  };
}
const validSale = {
  actorId: 'richard', kind: 'sale', reference: 'S99', customer: 'Customer', project: 'A', description: 'Service', amount: 100,
  proposed_split: { richard: 100, anastasia: 0, jean_claude: 0 }
};
for (const missing of [null, undefined, '', '   ']) {
  const res = capturedResponse();
  await transactionHandler({ method: 'POST', body: { ...validSale, proposed_split: { ...validSale.proposed_split, anastasia: missing } } }, res);
  assert.equal(res.statusCode, 400, 'The API must refuse missing percentages rather than converting them to zero.');
  assert.match(res.body.error, /Enter the proposed commission percentage for Anastasia/);
}
const telegramRes = capturedResponse();
await telegramHandler({
  method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'offline-webhook-secret' },
  body: { message: { text: '/sale|S99|Customer|A|Service|100|100||0', chat: { id: 777 }, from: { id: 111 } } }
}, telegramRes);
assert.equal(telegramRes.statusCode, 200);
assert.match(notifications.at(-1).text, /Could not record the transaction.*Enter the proposed commission percentage for Anastasia/);
assert.equal(rows.has('S99'), false);
assert.equal(inserts, 0);

console.log('Decision Sheets updates, stable retry rows, approval idempotency, Telegram recipient preservation/fallback, failed notification retries, manager setup visibility, both decision button references, and missing split refusal at API/Telegram entry points passed offline.');
