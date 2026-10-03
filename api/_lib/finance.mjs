import { summarize } from './business.mjs';
import { listTransactions } from './supabase.mjs';

export async function dashboardFor(employee) {
  const transactions = await listTransactions(employee);
  const manager = employee.role === 'manager';
  return {
    employee: { id: employee.id, name: employee.name, role: employee.role },
    transactions,
    ...(manager ? { finances: summarize(transactions) } : {})
  };
}
