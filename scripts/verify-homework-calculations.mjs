import assert from 'node:assert/strict';
import { calculateCommission, summarize, validateExpense, validateSale, validateSplit } from '../api/_lib/business.mjs';
import { roleCanSubmit } from '../api/_lib/transactions.mjs';

const commissions = (amount, split) => calculateCommission(amount, split);
const sale = (reference, project, amount, split, approved = true) => {
  const earned = approved ? commissions(amount, split) : { pool: 0, commissions: { richard: 0, anastasia: 0, jean_claude: 0 } };
  return {
    reference, kind: 'sale', project, amount,
    status: approved ? 'approved' : 'pending_approval',
    proposed_split: split, approved_split: approved ? split : null,
    commission_pool: earned.pool, commission_amounts: earned.commissions
  };
};
const expense = (reference, amount, status, final_allocation = null) => ({
  reference, kind: 'expense', amount, status, final_allocation
});

const test1 = [
  sale('S01', 'A', 1000, { richard: 50, anastasia: 30, jean_claude: 20 }),
  sale('S02', 'B', 2000, { richard: 20, anastasia: 40, jean_claude: 40 }),
  expense('E01', 120, 'allocated', 'A'),
  expense('E02', 80, 'allocated', 'A'),
  expense('E03', 100, 'allocated', 'company_overhead')
];
const first = summarize(test1);
assert.equal(first.projects.A.result, 700);
assert.equal(first.projects.B.result, 1800);
assert.equal(first.company_result, 2400);
assert.deepEqual(first.earned, { richard: 90, anastasia: 110, jean_claude: 100 });

const test2 = [
  ...test1,
  sale('S03', 'A', 1500, { richard: 20, anastasia: 30, jean_claude: 50 }),
  sale('S04', 'B', 800, { richard: 25, anastasia: 25, jean_claude: 50 }),
  sale('S05', 'B', 600, { richard: 100, anastasia: 0, jean_claude: 0 }, false),
  expense('E04', 250, 'allocated', 'B'),
  expense('E05', 90, 'allocated', 'B'),
  expense('E06', 60, 'allocated', 'company_overhead'),
  expense('E07', 140, 'awaiting_allocation')
];
const second = summarize(test2);
assert.equal(second.projects.A.result, 2050);
assert.equal(second.projects.B.result, 2180);
assert.equal(second.company_result, 3930);
assert.deepEqual(second.earned, { richard: 140, anastasia: 175, jean_claude: 215 });
assert.equal(second.awaiting_allocation, 140);
assert.equal(second.approved_income, 5300);
assert.equal(second.commission_total, 530);

const tiedCent = calculateCommission(0.05, { richard: 34, anastasia: 33, jean_claude: 33 });
assert.equal(tiedCent.pool, 0.01);
assert.deepEqual(tiedCent.commissions, { richard: 0.01, anastasia: 0, jean_claude: 0 });

assert.throws(() => validateSplit({ richard: 60, anastasia: 30, jean_claude: 20 }), /total 100/);
assert.throws(() => validateSale({ reference: 'S99', customer: 'Customer', project: 'A', description: 'Service', amount: 0, proposed_split: { richard: 100, anastasia: 0, jean_claude: 0 } }), /greater than zero/);
assert.throws(() => validateExpense({ reference: 'E99', description: 'Taxi', category: 'Travel', proposed_allocation: 'A' }), /greater than zero/);
assert.equal(roleCanSubmit({ role: 'richard' }, 'sale'), true);
assert.equal(roleCanSubmit({ role: 'expense_reporter' }, 'sale'), false);
assert.equal(roleCanSubmit({ role: 'expense_reporter' }, 'expense'), true);
assert.equal(roleCanSubmit({ role: 'manager' }, 'expense'), false);

console.log('Test 1 and Test 2 totals, commission rounding, invalid split/amount checks, and submission-role rules passed.');
