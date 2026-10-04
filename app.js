const state = { employees: [], roleId: '', dashboard: null, ready: false };
const $ = selector => document.querySelector(selector);
const roleSelect = $('#role-select');

const money = value => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const pct = value => `${Number(value || 0).toLocaleString('en-IE', { maximumFractionDigits: 2 })}%`;
const allocationName = value => ({ A: 'Project A', B: 'Project B', company_overhead: 'Company overhead' })[value] || 'Not allocated';
const statusName = value => ({ pending_approval: 'Pending approval', approved: 'Approved', awaiting_allocation: 'Awaiting allocation', allocated: 'Allocated' })[value] || value;
const personName = id => state.employees.find(employee => employee.id === id)?.name || id || 'Unknown';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `The request failed (${response.status}).`);
  return data;
}

function setError(message) {
  const box = $('#error');
  box.textContent = message || '';
  box.hidden = !message;
  if (message) $('#notice').hidden = true;
}

function showNotice(message) {
  const box = $('#notice');
  box.textContent = message;
  box.hidden = false;
  $('#error').hidden = true;
  window.setTimeout(() => { if (box.textContent === message) box.hidden = true; }, 6000);
}

function selectedEmployee() {
  return state.employees.find(employee => employee.id === state.roleId) || null;
}

function renderRoles() {
  roleSelect.innerHTML = state.employees.map(employee => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}</option>`).join('');
  roleSelect.disabled = false;
  roleSelect.value = state.roleId;
  const linkSelect = $('#link-form select[name="employeeId"]');
  linkSelect.innerHTML = state.employees.filter(employee => employee.role !== 'manager').map(employee => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}${employee.telegram_linked ? ' · linked' : ''}</option>`).join('');
}

function setSectionVisibility(employee) {
  const manager = employee?.role === 'manager';
  $('#manager-finances').hidden = !manager;
  $('#manager-approvals').hidden = !manager;
  $('#manager-linking').hidden = !manager;
  $('#entry-area').hidden = !employee;
  $('#sale-entry').hidden = !['richard', 'anastasia', 'jean_claude'].includes(employee?.role);
  $('#expense-entry').hidden = employee?.role !== 'expense_reporter';
  $('#records-section').hidden = !employee;
  $('#records-heading').textContent = manager ? 'All transactions' : 'My submissions';
  $('#records-eyebrow').textContent = manager ? 'Full transaction record' : 'Your activity';
}

function renderFinances(finances) {
  const a = finances.projects.A;
  const b = finances.projects.B;
  const cards = [
    ['Company result', money(finances.company_result), 'Approved sales less commissions and all recorded expenses'],
    ['Project A result', money(a.result), 'Respectable Relatives'],
    ['Project B result', money(b.result), 'Drunk University Friends'],
    ['Commission earned', money(finances.commission_total), 'Across approved sales']
  ];
  $('#summary-cards').innerHTML = cards.map(([label, value, detail]) => `<article class="summary-card"><div class="label">${label}</div><div class="value">${value}</div><p class="detail">${detail}</p></article>`).join('');
  const company = value => money(value);
  const rows = [
    ['Approved income', a.income, b.income, finances.approved_income],
    ['Commission expense', a.commission, b.commission, finances.commission_total],
    ['Allocated project expenses', a.expenses, b.expenses, finances.allocated_expenses],
    ['Company overhead', '—', '—', finances.company_overhead],
    ['Expenses awaiting allocation', '—', '—', finances.awaiting_allocation],
    ['Result', a.result, b.result, finances.company_result]
  ];
  $('#results-body').innerHTML = rows.map(([label, av, bv, cv]) => `<tr><td>${label}</td><td>${av === '—' ? '—' : company(av)}</td><td>${bv === '—' ? '—' : company(bv)}</td><td>${company(cv)}</td></tr>`).join('');
  const labels = { richard: 'Richard', anastasia: 'Anastasia', jean_claude: 'Jean-Claude' };
  $('#commission-totals').innerHTML = `<strong>Commission earned</strong>${Object.entries(finances.earned).map(([key, amount]) => `<span class="commission-chip">${labels[key]} · ${money(amount)}</span>`).join('')}<span class="commission-chip"><strong>Total · ${money(finances.commission_total)}</strong></span>`;
}

function splitLine(split) {
  if (!split) return 'No split recorded';
  return `Richard ${pct(split.richard)} · Anastasia ${pct(split.anastasia)} · Jean-Claude ${pct(split.jean_claude)}`;
}

function renderApprovals(rows) {
  const pending = rows.filter(row => row.status === 'pending_approval' || row.status === 'awaiting_allocation');
  $('#pending-count').textContent = `${pending.length} open`;
  if (!pending.length) {
    $('#approval-list').innerHTML = '<div class="empty-state">No decisions are waiting. New sales and project expenses will appear here.</div>';
    return;
  }
  $('#approval-list').innerHTML = pending.map(row => {
    const summary = row.kind === 'sale'
      ? `<p class="proposal-line">${escapeHtml(personName(row.submitted_by))} · Project ${escapeHtml(row.project)} · ${money(row.amount)}<br>Proposed split: ${escapeHtml(splitLine(row.proposed_split))}</p>`
      : `<p class="proposal-line">${escapeHtml(personName(row.submitted_by))} · ${escapeHtml(row.category)} · ${money(row.amount)}<br>Proposed allocation: ${escapeHtml(allocationName(row.proposed_allocation))}</p>`;
    const controls = row.kind === 'sale'
      ? `<div class="decision-fields" data-decision="sale" data-reference="${escapeHtml(row.reference)}">
          ${[['richard','Richard'],['anastasia','Anastasia'],['jean_claude','Jean-Claude']].map(([key,name]) => `<label>${name} %<input data-split="${key}" type="number" min="0" max="100" step="0.01" value="${escapeHtml(row.proposed_split?.[key] ?? 0)}"></label>`).join('')}
          <button class="primary-button decision-button" data-action="approve-sale" type="button">Approve sale</button>
        </div>`
      : `<div class="decision-fields" data-decision="expense" data-reference="${escapeHtml(row.reference)}">
          <label>Final allocation<select data-allocation><option value="A" ${row.proposed_allocation === 'A' ? 'selected' : ''}>Project A</option><option value="B" ${row.proposed_allocation === 'B' ? 'selected' : ''}>Project B</option><option value="company_overhead" ${row.proposed_allocation === 'company_overhead' ? 'selected' : ''}>Company overhead</option></select></label>
          <button class="primary-button decision-button" data-action="allocate-expense" type="button">Confirm allocation</button>
        </div>`;
    return `<article class="approval-card"><div class="approval-top"><span class="reference">${escapeHtml(row.reference)}</span><span class="record-title">${row.kind === 'sale' ? 'Sale approval' : 'Expense allocation'}</span><span class="record-subtitle">Submitted by ${escapeHtml(personName(row.submitted_by))}</span></div><p class="approval-description">${escapeHtml(row.kind === 'sale' ? `${row.customer} · ${row.description}` : row.description)}</p>${summary}${controls}</article>`;
  }).join('');
}

function relevantNotificationStatus(row) {
  return row.status === 'pending_approval' || row.status === 'awaiting_allocation' || row.decision_notification_status === 'not_required'
    ? row.submission_notification_status
    : row.decision_notification_status;
}

function notificationStatus(row) {
  const status = relevantNotificationStatus(row);
  if (status === 'no_recipient') return 'No Telegram recipient linked';
  if (status === 'failed') return 'Telegram notification failed';
  if (status === 'pending') return 'Telegram notification pending';
  if (status === 'sent') return 'Telegram notification sent';
  return 'No decision notification required';
}

function renderRecords(rows, manager) {
  if (!rows.length) {
    $('#records-list').innerHTML = `<div class="empty-state">${manager ? 'No transactions yet.' : 'Your submissions will appear here.'}</div>`;
    return;
  }
  $('#records-list').innerHTML = rows.map(row => {
    const isSale = row.kind === 'sale';
    const detail = isSale
      ? `${escapeHtml(row.customer)} · Project ${escapeHtml(row.project)} · ${escapeHtml(row.description)}`
      : `${escapeHtml(row.category)} · ${escapeHtml(row.description)}`;
    const proposal = isSale
      ? `Proposed split: ${escapeHtml(splitLine(row.proposed_split))}${row.approved_split ? `<br>Approved split: ${escapeHtml(splitLine(row.approved_split))}` : '<br>Earned commission: €0.00 until approval'}`
      : `Proposed: ${escapeHtml(allocationName(row.proposed_allocation))}${row.final_allocation ? `<br>Final: ${escapeHtml(allocationName(row.final_allocation))}` : '<br>Expense is included in company result while awaiting allocation'}`;
    const sheets = row.sheets_sync_status === 'synced' ? '<span class="status-badge good">Sheets synced</span>' : `<span class="status-badge ${row.sheets_sync_status === 'failed' ? 'bad' : ''}">${row.sheets_sync_status === 'failed' ? 'Sheets sync failed' : 'Sheets sync pending'}</span>`;
    const telegram = notificationStatus(row);
    const telegramClass = telegram.includes('failed') ? 'bad' : (telegram.includes('sent') ? 'good' : '');
    const relevantTelegramStatus = relevantNotificationStatus(row);
    const actions = manager ? `<div class="record-actions">${row.sheets_sync_status !== 'synced' ? `<button data-action="retry-sync" data-reference="${escapeHtml(row.reference)}">Retry Sheets sync</button>` : ''}${['failed','pending'].includes(relevantTelegramStatus) ? `<button data-action="retry-notification" data-reference="${escapeHtml(row.reference)}">Retry Telegram</button>` : ''}</div>` : '';
    return `<article class="record-card"><div class="record-grid"><div class="record-main"><div class="record-top"><span class="reference">${escapeHtml(row.reference)}</span><span class="record-title">${isSale ? 'Sale' : 'Expense'}</span><span class="record-subtitle">${escapeHtml(personName(row.submitted_by))} · ${escapeHtml(new Date(row.created_at).toLocaleString())}</span></div><div class="record-details"><span>${detail}</span><span>${proposal}</span></div>${actions}</div><div class="record-side"><span class="record-amount">${money(row.amount)}</span><span class="status-badge ${row.status === 'approved' || row.status === 'allocated' ? 'good' : ''}">${escapeHtml(statusName(row.status))}</span>${sheets}<span class="status-badge ${telegramClass}">${escapeHtml(telegram)}</span></div></div></article>`;
  }).join('');
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  const employee = dashboard.employee;
  const manager = employee.role === 'manager';
  setSectionVisibility(employee);
  if (manager) renderFinances(dashboard.finances);
  if (manager) renderApprovals(dashboard.transactions);
  renderRecords(dashboard.transactions, manager);
  $('#last-updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('#student-name').textContent = window.studentName || 'Student name required';
  const linkedEmployees = state.employees.filter(item => item.telegram_linked).length;
  if (manager) $('#manager-linking .linking-copy')?.setAttribute('data-linked-count', `${linkedEmployees} linked`);
}

async function loadDashboard() {
  setError('');
  try {
    const dashboard = await api(`/api/dashboard?employeeId=${encodeURIComponent(state.roleId)}`);
    renderDashboard(dashboard);
  } catch (error) { setError(error.message); }
}

async function refreshEmployees() {
  const rows = await api('/api/employees');
  state.employees = rows;
  if (!state.roleId || !rows.some(employee => employee.id === state.roleId)) state.roleId = 'svetlana';
  renderRoles();
  await loadDashboard();
}

function setFeedback(form, message, isError = false) {
  const feedback = form.querySelector('.form-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.style.color = isError ? '#9a3b33' : '';
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

$('#sale-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  setFeedback(form, 'Saving…');
  const data = formObject(form);
  try {
    await api('/api/transactions', { method: 'POST', body: JSON.stringify({
      actorId: state.roleId, kind: 'sale', reference: data.reference, customer: data.customer,
      project: data.project, description: data.description, amount: data.amount,
      proposed_split: { richard: data.richard, anastasia: data.anastasia, jean_claude: data.jean_claude }
    }) });
    form.reset();
    form.elements.richard.value = '34'; form.elements.anastasia.value = '33'; form.elements.jean_claude.value = '33';
    setFeedback(form, 'Sale saved. It is waiting for Svetlana’s approval.');
    await loadDashboard();
  } catch (error) { setFeedback(form, error.message, true); }
});

$('#expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  setFeedback(form, 'Saving…');
  try {
    const data = formObject(form);
    await api('/api/transactions', { method: 'POST', body: JSON.stringify({ actorId: state.roleId, kind: 'expense', ...data }) });
    form.reset();
    setFeedback(form, 'Expense saved. Project allocations wait for Svetlana; overhead is allocated automatically.');
    await loadDashboard();
  } catch (error) { setFeedback(form, error.message, true); }
});

$('#link-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  setFeedback(form, 'Saving…');
  try {
    const data = formObject(form);
    await api('/api/link-telegram', { method: 'POST', body: JSON.stringify({ actorId: state.roleId, ...data }) });
    setFeedback(form, 'Telegram identity linked. Ask the employee to send /start to the bot.');
    await refreshEmployees();
  } catch (error) { setFeedback(form, error.message, true); }
});

$('#set-webhook').addEventListener('click', async () => {
  const secret = window.prompt('Enter the TELEGRAM_SETUP_SECRET from your deployment settings.');
  if (!secret) return;
  try {
    await api('/api/telegram/set-webhook', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' });
    showNotice('Telegram webhook connected to this website.');
  } catch (error) { setError(error.message); }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const reference = button.dataset.reference;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Saving…';
  try {
    if (action === 'approve-sale' || action === 'allocate-expense') {
      const controls = button.closest('[data-decision]');
      const body = { actorId: state.roleId, reference: controls.dataset.reference };
      if (action === 'approve-sale') {
        body.action = 'approve_sale';
        body.approved_split = Object.fromEntries([...controls.querySelectorAll('[data-split]')].map(input => [input.dataset.split, input.value]));
      } else {
        body.action = 'allocate_expense';
        body.final_allocation = controls.querySelector('[data-allocation]').value;
      }
      await api('/api/decisions', { method: 'POST', body: JSON.stringify(body) });
      showNotice(`${body.reference} decision saved. The Sheets row and notification status have been updated.`);
    } else if (action === 'retry-sync') {
      await api('/api/retry-sync', { method: 'POST', body: JSON.stringify({ actorId: state.roleId, reference }) });
      showNotice(`Sheets sync retried for ${reference}.`);
    } else if (action === 'retry-notification') {
      await api('/api/retry-notification', { method: 'POST', body: JSON.stringify({ actorId: state.roleId, reference }) });
      showNotice(`Telegram delivery retried for ${reference}.`);
    }
    await loadDashboard();
  } catch (error) {
    setError(error.message);
    button.disabled = false;
    button.textContent = originalText;
  }
});

roleSelect.addEventListener('change', async () => {
  state.roleId = roleSelect.value;
  setError('');
  await loadDashboard();
});
$('#refresh').addEventListener('click', loadDashboard);

async function boot() {
  try {
    const status = await api('/api/status');
    window.studentName = status.studentName;
    const missing = status.missing || [];
    const systemStatus = $('#system-status');
    if (missing.includes('Supabase')) {
      systemStatus.className = 'system-status warn';
      systemStatus.textContent = 'Finance records are not connected yet.';
      $('#setup-card').hidden = false;
      $('#setup-message').textContent = `Connect ${missing.join(', ')} in the deployment settings, then reload this page.`;
      $('#student-name').textContent = window.studentName;
      return;
    }
    systemStatus.className = missing.length ? 'system-status warn' : 'system-status ready';
    systemStatus.textContent = missing.length
      ? `Supabase is connected. Finish setup for ${missing.join(' and ')} to enable every integration.`
      : 'All connected systems are ready.';
    $('#setup-card').hidden = !missing.length;
    if (missing.length) $('#setup-message').textContent = `Some features are unavailable until you configure ${missing.join(', ')}.`;
    if (status.links) {
      const links = [
        status.links.telegram ? `<a href="${escapeHtml(status.links.telegram)}" target="_blank" rel="noreferrer">Telegram bot</a>` : '',
        status.links.sheets ? `<a href="${escapeHtml(status.links.sheets)}" target="_blank" rel="noreferrer">Google Sheets</a>` : '',
        status.links.github ? `<a href="${escapeHtml(status.links.github)}" target="_blank" rel="noreferrer">GitHub repository</a>` : ''
      ].filter(Boolean).join('');
      $('#integration-links').innerHTML = links;
    }
    await refreshEmployees();
  } catch (error) {
    $('#system-status').className = 'system-status warn';
    $('#system-status').textContent = 'The application could not reach its backend.';
    $('#setup-card').hidden = false;
    $('#setup-message').textContent = error.message;
    setError(error.message);
  }
}

boot();
