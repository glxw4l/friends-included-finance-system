import { HttpError } from './http.mjs';

export const SPLIT_KEYS = ['richard', 'anastasia', 'jean_claude'];
export const SPLIT_NAMES = {
  richard: 'Richard',
  anastasia: 'Anastasia',
  jean_claude: 'Jean-Claude'
};
export const ALLOCATIONS = ['A', 'B', 'company_overhead'];

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function amountNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Amount must be greater than zero.');
  if (Math.abs(amount - roundMoney(amount)) > 0.0000001) throw new HttpError(400, 'Enter an amount with no more than two decimal places.');
  return roundMoney(amount);
}

export function validateReference(reference, kind) {
  const value = String(reference ?? '').trim().toUpperCase();
  const prefix = kind === 'sale' ? 'S' : 'E';
  if (!new RegExp(`^${prefix}[A-Z0-9_-]{1,15}$`).test(value)) {
    throw new HttpError(400, `Reference must begin with ${prefix} and contain 2 to 16 letters, numbers, dashes, or underscores.`);
  }
  return value;
}

export function validateSplit(input) {
  const split = {};
  for (const key of SPLIT_KEYS) {
    const raw = input?.[key];
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      throw new HttpError(400, `Enter the proposed commission percentage for ${SPLIT_NAMES[key]}.`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new HttpError(400, 'Each proposed commission share must be between 0% and 100%.');
    if (Math.abs(value - Math.round(value * 100) / 100) > 0.0000001) throw new HttpError(400, 'Commission percentages can have at most two decimal places.');
    split[key] = value;
  }
  if (Math.abs(Object.values(split).reduce((sum, value) => sum + value, 0) - 100) > 0.000001) {
    throw new HttpError(400, 'The three commission percentages must total 100%.');
  }
  return split;
}

export function validateSale(input) {
  const reference = validateReference(input.reference, 'sale');
  const customer = String(input.customer ?? '').trim();
  const description = String(input.description ?? '').trim();
  const project = String(input.project ?? '').toUpperCase();
  if (!customer) throw new HttpError(400, 'Enter the customer name.');
  if (!description) throw new HttpError(400, 'Enter a sale description.');
  if (!['A', 'B'].includes(project)) throw new HttpError(400, 'Choose Project A or Project B.');
  return {
    reference, customer, description, project,
    amount: amountNumber(input.amount),
    proposed_split: validateSplit(input.proposed_split)
  };
}

export function validateExpense(input) {
  const reference = validateReference(input.reference, 'expense');
  const description = String(input.description ?? '').trim();
  const category = String(input.category ?? '');
  const allocation = String(input.proposed_allocation ?? '');
  if (!description) throw new HttpError(400, 'Enter an expense description.');
  if (!['Materials', 'Travel', 'Other'].includes(category)) throw new HttpError(400, 'Choose Materials, Travel, or Other.');
  if (!ALLOCATIONS.includes(allocation)) throw new HttpError(400, 'Choose Project A, Project B, or Company overhead.');
  return {
    reference, description, category,
    amount: amountNumber(input.amount),
    proposed_allocation: allocation
  };
}

export function calculateCommission(amount, split) {
  const pool = roundMoney(roundMoney(amount) * 0.10);
  const commissions = {};
  for (const key of SPLIT_KEYS) commissions[key] = roundMoney(pool * split[key] / 100);
  const difference = roundMoney(pool - Object.values(commissions).reduce((sum, value) => sum + value, 0));
  if (difference) {
    const maxShare = Math.max(...SPLIT_KEYS.map(key => split[key]));
    const recipient = SPLIT_KEYS.find(key => split[key] === maxShare);
    commissions[recipient] = roundMoney(commissions[recipient] + difference);
  }
  return { pool, commissions };
}

export function sameSplit(a, b) {
  return SPLIT_KEYS.every(key => Number(a?.[key]) === Number(b?.[key]));
}

export function allocationLabel(value) {
  return ({ A: 'Project A', B: 'Project B', company_overhead: 'Company overhead' })[value] ?? 'Not allocated';
}

export function summarize(transactions) {
  const projects = {
    A: { income: 0, commission: 0, expenses: 0, result: 0 },
    B: { income: 0, commission: 0, expenses: 0, result: 0 }
  };
  const earned = { richard: 0, anastasia: 0, jean_claude: 0 };
  let approvedIncome = 0;
  let commissionTotal = 0;
  let allExpenses = 0;
  let overhead = 0;
  let awaitingAllocation = 0;

  for (const row of transactions) {
    const amount = Number(row.amount) || 0;
    if (row.kind === 'sale' && row.status === 'approved') {
      const project = projects[row.project];
      if (!project) continue;
      const c = row.commission_amounts ?? {};
      const rowCommission = SPLIT_KEYS.reduce((sum, key) => sum + (Number(c[key]) || 0), 0);
      project.income += amount;
      project.commission += rowCommission;
      approvedIncome += amount;
      commissionTotal += rowCommission;
      for (const key of SPLIT_KEYS) earned[key] += Number(c[key]) || 0;
    }
    if (row.kind === 'expense') {
      allExpenses += amount;
      if (row.status === 'awaiting_allocation') awaitingAllocation += amount;
      else if (row.final_allocation === 'company_overhead') overhead += amount;
      else if (row.final_allocation === 'A' || row.final_allocation === 'B') projects[row.final_allocation].expenses += amount;
    }
  }
  for (const key of ['A', 'B']) {
    const p = projects[key];
    p.income = roundMoney(p.income);
    p.commission = roundMoney(p.commission);
    p.expenses = roundMoney(p.expenses);
    p.result = roundMoney(p.income - p.commission - p.expenses);
  }
  for (const key of SPLIT_KEYS) earned[key] = roundMoney(earned[key]);
  return {
    projects,
    approved_income: roundMoney(approvedIncome),
    commission_total: roundMoney(commissionTotal),
    allocated_expenses: roundMoney(projects.A.expenses + projects.B.expenses),
    company_overhead: roundMoney(overhead),
    awaiting_allocation: roundMoney(awaitingAllocation),
    company_result: roundMoney(approvedIncome - commissionTotal - allExpenses),
    earned
  };
}
