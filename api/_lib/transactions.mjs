import { dbRequest, getEmployee, getTransaction, insertTransaction, updateTransaction } from './supabase.mjs';
import { calculateCommission, SPLIT_KEYS, SPLIT_NAMES, allocationLabel, sameSplit, validateExpense, validateSale, validateSplit } from './business.mjs';
import { syncToSheets } from './sheets.mjs';
import { money, sendTelegramMessage } from './telegram.mjs';

export function roleCanSubmit(employee, kind) {
  return kind === 'sale'
    ? ['richard', 'anastasia', 'jean_claude'].includes(employee.role)
    : employee.role === 'expense_reporter';
}

export async function markSheetsSynced(row) {
  try {
    await syncToSheets(row);
    await updateTransaction(row.reference, { sheets_sync_status: 'synced', sheets_sync_error: null });
  } catch (error) {
    console.error('Google Sheets sync failed for', row.reference, error);
    await updateTransaction(row.reference, { sheets_sync_status: 'failed', sheets_sync_error: String(error.message || error).slice(0, 1000) });
  }
}

function saleSubmissionText(row) {
  return `Sale ${row.reference} recorded. Amount: ${money(row.amount)}. Project ${row.project}. Status: Pending approval.`;
}

function expenseSubmissionText(row) {
  const status = row.status === 'allocated' ? 'Allocated automatically as company overhead' : 'Awaiting allocation';
  return `Expense ${row.reference} recorded. Amount: ${money(row.amount)}. Proposed allocation: ${allocationLabel(row.proposed_allocation)}. Status: ${status}.`;
}

export function decisionMessage(row) {
  if (row.kind === 'sale') {
    const label = row.decision_changed ? 'Sale approved — commission split changed.' : 'Sale approved.';
    const parts = [label, `Sale ${row.reference}; amount ${money(row.amount)}; total commission ${money(row.commission_pool)}.`];
    for (const key of SPLIT_KEYS) {
      const oldShare = Number(row.proposed_split?.[key] ?? 0);
      const share = Number(row.approved_split?.[key] ?? 0);
      const amount = Number(row.commission_amounts?.[key] ?? 0);
      const shareText = row.decision_changed ? `${oldShare}% → ${share}%` : `${share}%`;
      parts.push(`${SPLIT_NAMES[key]}: ${shareText} (${money(amount)}).`);
    }
    return parts.join(' ');
  }
  const changed = row.proposed_allocation !== row.final_allocation;
  const label = changed ? 'Expense allocation changed.' : 'Expense allocation confirmed.';
  return `Expense ${row.reference}: ${label} ${money(row.amount)} — ${row.description}. Proposed: ${allocationLabel(row.proposed_allocation)}. Approved: ${allocationLabel(row.final_allocation)}.`;
}

async function sendSubmissionConfirmation(row) {
  if (!row.notification_chat_id) {
    await updateTransaction(row.reference, { submission_notification_status: 'no_recipient' });
    return;
  }
  try {
    await sendTelegramMessage(row.notification_chat_id, row.kind === 'sale' ? saleSubmissionText(row) : expenseSubmissionText(row));
    await updateTransaction(row.reference, { submission_notification_status: 'sent', submission_notification_error: null });
  } catch (error) {
    await updateTransaction(row.reference, { submission_notification_status: 'failed', submission_notification_error: String(error.message || error).slice(0, 1000) });
  }
}

export async function createTransaction(input, employee, { origin = 'website', telegramUserId = null, chatId = null } = {}) {
  const kind = input.kind;
  if (!['sale', 'expense'].includes(kind)) throw Object.assign(new Error('Choose a sale or an expense.'), { status: 400 });
  if (!roleCanSubmit(employee, kind)) throw Object.assign(new Error('This demonstration role cannot submit that transaction.'), { status: 403 });
  const cleaned = kind === 'sale' ? validateSale(input) : validateExpense(input);
  const notificationChatId = origin === 'telegram' ? String(chatId) : (employee.telegram_chat_id ? String(employee.telegram_chat_id) : null);
  const row = {
    reference: cleaned.reference,
    kind,
    submitted_by: employee.id,
    submitter_name: employee.name,
    origin,
    origin_telegram_user_id: telegramUserId === null ? null : String(telegramUserId),
    origin_chat_id: chatId === null ? null : String(chatId),
    notification_chat_id: notificationChatId,
    customer: kind === 'sale' ? cleaned.customer : null,
    project: kind === 'sale' ? cleaned.project : null,
    description: cleaned.description,
    amount: cleaned.amount,
    category: kind === 'expense' ? cleaned.category : null,
    proposed_split: kind === 'sale' ? cleaned.proposed_split : null,
    approved_split: null,
    commission_pool: 0,
    commission_amounts: { richard: 0, anastasia: 0, jean_claude: 0 },
    proposed_allocation: kind === 'expense' ? cleaned.proposed_allocation : null,
    final_allocation: kind === 'expense' && cleaned.proposed_allocation === 'company_overhead' ? 'company_overhead' : null,
    status: kind === 'sale' ? 'pending_approval' : (cleaned.proposed_allocation === 'company_overhead' ? 'allocated' : 'awaiting_allocation'),
    decision_changed: false,
    sheets_sync_status: 'pending',
    sheets_sync_error: null,
    submission_notification_status: notificationChatId ? 'pending' : 'no_recipient',
    submission_notification_error: null,
    decision_notification_status: kind === 'expense' && cleaned.proposed_allocation === 'company_overhead' ? 'not_required' : 'pending',
    decision_notification_error: null
  };
  const saved = await insertTransaction(row);
  await markSheetsSynced(saved);
  await sendSubmissionConfirmation(saved);
  return (await getTransaction(saved.reference)) || saved;
}

export async function linkTelegramIdentity(targetEmployeeId, telegramUserId) {
  const target = await getEmployee(targetEmployeeId);
  if (!target) throw Object.assign(new Error('Choose an existing employee.'), { status: 404 });
  const userId = String(telegramUserId ?? '').trim();
  if (!/^\d{1,24}$/.test(userId)) throw Object.assign(new Error('Enter the numeric Telegram user ID shown by /id.'), { status: 400 });
  // Clear any previous mapping first. This makes changing the test identity from
  // Richard to Kevin explicit while preserving chat IDs already frozen on records.
  await dbRequest(`employees?telegram_user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', body: { telegram_user_id: null, telegram_chat_id: null },
    headers: { Prefer: 'return=minimal' }
  });
  await dbRequest(`employees?id=eq.${encodeURIComponent(targetEmployeeId)}`, {
    method: 'PATCH', body: { telegram_user_id: userId, telegram_chat_id: null },
    headers: { Prefer: 'return=minimal' }
  });
  return { employee: { id: target.id, name: target.name }, telegram_user_id: userId };
}

export async function decideTransaction(reference, manager, decision) {
  if (manager.role !== 'manager') throw Object.assign(new Error('Only Svetlana can approve or allocate transactions.'), { status: 403 });
  const row = await getTransaction(reference);
  if (!row) throw Object.assign(new Error('No transaction has that reference.'), { status: 404 });
  let patch;
  let expectedStatus;
  let sameFinal = false;

  if (row.kind === 'sale') {
    if (decision.action !== 'approve_sale') throw Object.assign(new Error('This reference is not an expense.'), { status: 400 });
    const split = validateSplit(decision.approved_split ?? row.proposed_split);
    const { pool, commissions } = calculateCommission(row.amount, split);
    expectedStatus = 'pending_approval';
    sameFinal = row.status === 'approved' && sameSplit(row.approved_split, split);
    patch = {
      status: 'approved', approved_split: split, commission_pool: pool,
      commission_amounts: commissions,
      decision_changed: !sameSplit(row.proposed_split, split),
      decided_by: manager.id, decided_at: new Date().toISOString(),
      decision_notification_status: row.notification_chat_id ? 'pending' : 'no_recipient',
      decision_notification_error: null
    };
  } else {
    if (decision.action !== 'allocate_expense') throw Object.assign(new Error('This reference is not a sale.'), { status: 400 });
    if (row.status === 'allocated' && row.final_allocation === 'company_overhead' && !row.decided_at) {
      throw Object.assign(new Error('Company overhead is allocated automatically when submitted.'), { status: 409 });
    }
    const allocation = String(decision.final_allocation ?? '');
    if (!['A', 'B', 'company_overhead'].includes(allocation)) throw Object.assign(new Error('Choose Project A, Project B, or Company overhead.'), { status: 400 });
    expectedStatus = 'awaiting_allocation';
    sameFinal = row.status === 'allocated' && row.final_allocation === allocation;
    patch = {
      status: 'allocated', final_allocation: allocation,
      decision_changed: row.proposed_allocation !== allocation,
      decided_by: manager.id, decided_at: new Date().toISOString(),
      decision_notification_status: row.notification_chat_id ? 'pending' : 'no_recipient',
      decision_notification_error: null
    };
  }

  let decided;
  if (sameFinal) {
    decided = row;
  } else {
    if (row.status !== expectedStatus) throw Object.assign(new Error('This transaction has already been decided. Refresh the page to see its saved decision.'), { status: 409 });
    decided = await updateTransaction(reference, patch, expectedStatus);
    if (!decided) {
      const latest = await getTransaction(reference);
      const alreadyApplied = row.kind === 'sale'
        ? latest?.status === 'approved' && sameSplit(latest.approved_split, patch.approved_split)
        : latest?.status === 'allocated' && latest.final_allocation === patch.final_allocation;
      if (!alreadyApplied) throw Object.assign(new Error('Another decision was saved first. Refresh the page.'), { status: 409 });
      decided = latest;
    }
  }

  if (decided.sheets_sync_status !== 'synced') await markSheetsSynced(decided);
  const current = await getTransaction(reference) || decided;
  if (current.decision_notification_status !== 'sent' && current.decision_notification_status !== 'no_recipient') {
    await sendDecisionNotification(current);
  }
  return (await getTransaction(reference)) || current;
}

export async function retrySync(reference, manager) {
  if (manager.role !== 'manager') throw Object.assign(new Error('Only Svetlana can retry a Sheets sync.'), { status: 403 });
  const row = await getTransaction(reference);
  if (!row) throw Object.assign(new Error('No transaction has that reference.'), { status: 404 });
  await markSheetsSynced(row);
  return getTransaction(reference);
}

export async function sendDecisionNotification(row) {
  if (!row.notification_chat_id) {
    await updateTransaction(row.reference, { decision_notification_status: 'no_recipient', decision_notification_error: null });
    return;
  }
  try {
    await sendTelegramMessage(row.notification_chat_id, decisionMessage(row));
    await updateTransaction(row.reference, { decision_notification_status: 'sent', decision_notification_error: null });
  } catch (error) {
    await updateTransaction(row.reference, { decision_notification_status: 'failed', decision_notification_error: String(error.message || error).slice(0, 1000) });
  }
}

export async function retryNotification(reference, manager) {
  if (manager.role !== 'manager') throw Object.assign(new Error('Only Svetlana can retry a Telegram notification.'), { status: 403 });
  const row = await getTransaction(reference);
  if (!row) throw Object.assign(new Error('No transaction has that reference.'), { status: 404 });
  if (row.status === 'pending_approval' || row.status === 'awaiting_allocation') {
    if (!row.notification_chat_id) {
      await updateTransaction(reference, { submission_notification_status: 'no_recipient' });
    } else {
      try {
        await sendTelegramMessage(row.notification_chat_id, row.kind === 'sale' ? saleSubmissionText(row) : expenseSubmissionText(row));
        await updateTransaction(reference, { submission_notification_status: 'sent', submission_notification_error: null });
      } catch (error) {
        await updateTransaction(reference, { submission_notification_status: 'failed', submission_notification_error: String(error.message || error).slice(0, 1000) });
      }
    }
  } else if (row.decision_notification_status !== 'not_required') {
    await sendDecisionNotification(row);
  } else if (row.notification_chat_id) {
    await sendTelegramMessage(row.notification_chat_id, row.kind === 'sale' ? saleSubmissionText(row) : expenseSubmissionText(row));
    await updateTransaction(reference, { submission_notification_status: 'sent', submission_notification_error: null });
  }
  return getTransaction(reference);
}
