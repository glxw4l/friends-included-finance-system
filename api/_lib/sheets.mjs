import { SPLIT_KEYS, SPLIT_NAMES, allocationLabel } from './business.mjs';

const tabs = {
  sales: {
    title: 'Sales',
    headers: [
      'Reference', 'Submitted at', 'Salesperson', 'Customer', 'Project', 'Description', 'Amount (€)',
      'Proposed Richard (%)', 'Proposed Anastasia (%)', 'Proposed Jean-Claude (%)',
      'Approved Richard (%)', 'Approved Anastasia (%)', 'Approved Jean-Claude (%)',
      'Richard earned (€)', 'Anastasia earned (€)', 'Jean-Claude earned (€)', 'Status'
    ]
  },
  expenses: {
    title: 'Expenses',
    headers: ['Reference', 'Submitted at', 'Reporter', 'Description', 'Category', 'Amount (€)', 'Proposed allocation', 'Final allocation', 'Status']
  }
};

let tokenCache = { token: null, expiresAt: 0 };
const b64url = value => Buffer.from(value).toString('base64url');

function configuration() {
  const id = process.env.GOOGLE_SHEETS_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!id || !email || !key) throw new Error('Google Sheets service-account settings are incomplete.');
  return { id, email, key };
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.expiresAt > now + 60) return tokenCache.token;
  const { email, key } = configuration();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signer = (await import('node:crypto')).createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Google did not issue an access token.');
  tokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return tokenCache.token;
}

async function googleRequest(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const reason = typeof data === 'object' ? data?.error?.message : '';
    throw new Error(reason || `Google Sheets returned ${response.status}.`);
  }
  return data;
}

async function ensureTabs(id) {
  const current = await googleRequest(`spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,title)`);
  const titles = new Set((current.sheets || []).map(sheet => sheet.properties.title));
  const missing = Object.values(tabs).filter(tab => !titles.has(tab.title));
  if (missing.length) {
    await googleRequest(`spreadsheets/${encodeURIComponent(id)}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map(tab => ({ addSheet: { properties: { title: tab.title } } })) }
    });
  }
  for (const tab of Object.values(tabs)) {
    const range = encodeURIComponent(`'${tab.title}'!A1`);
    const values = await googleRequest(`spreadsheets/${encodeURIComponent(id)}/values/${range}`);
    if (!values.values?.length) {
      await googleRequest(`spreadsheets/${encodeURIComponent(id)}/values/${range}?valueInputOption=RAW`, {
        method: 'PUT', body: { values: [tab.headers] }
      });
    }
  }
}

function statusText(row) {
  return ({
    pending_approval: 'Pending approval',
    approved: 'Approved',
    awaiting_allocation: 'Awaiting allocation',
    allocated: 'Allocated'
  })[row.status] || row.status;
}

function rowValues(row) {
  if (row.kind === 'sale') {
    const proposed = row.proposed_split || {};
    const approved = row.approved_split || {};
    const earned = row.commission_amounts || {};
    const employees = row.submitter_name || row.submitted_by;
    return [
      row.reference, row.created_at, employees, row.customer, `Project ${row.project}`, row.description, Number(row.amount),
      ...SPLIT_KEYS.map(key => proposed[key] ?? ''),
      ...SPLIT_KEYS.map(key => approved[key] ?? ''),
      ...SPLIT_KEYS.map(key => Number(earned[key] || 0)), statusText(row)
    ];
  }
  return [
    row.reference, row.created_at, row.submitter_name || row.submitted_by, row.description, row.category,
    Number(row.amount), allocationLabel(row.proposed_allocation),
    row.final_allocation ? allocationLabel(row.final_allocation) : '', statusText(row)
  ];
}

export async function syncToSheets(row) {
  const { id } = configuration();
  await ensureTabs(id);
  const tab = row.kind === 'sale' ? tabs.sales : tabs.expenses;
  const lastColumn = row.kind === 'sale' ? 'Q' : 'I';
  const rowNumber = Number(row.sheet_row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('The database did not assign a valid spreadsheet row. Apply the Supabase migration.');
  const range = encodeURIComponent(`'${tab.title}'!A${rowNumber}:${lastColumn}${rowNumber}`);
  await googleRequest(`spreadsheets/${encodeURIComponent(id)}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT', body: { values: [rowValues(row)] }
  });
}
