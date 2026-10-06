'use strict';
function toCents(value) {
  if (!['number', 'string'].includes(typeof value)) throw new Error('Amount must be a decimal number or string.');
  const text = String(value);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) throw new Error('Amount must have at most two decimal places.');
  const [whole, decimal = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 5000000) throw new Error('Amount must be between $0.01 and $50,000.');
  return cents;
}
const maskAccount = number => number ? '****' + number.slice(-4) : null;
function transactionDTO(row) {
  return { id: row.id, accountId: row.accountId, reference: row.reference, status: row.status,
    type: row.type, amount: row.amountCents / 100, description: row.description, category: row.category,
    note: row.note, toAccount: maskAccount(row.toAccountNumber), balanceAfter: row.balanceAfterCents / 100, createdAt: row.createdAt };
}
module.exports = { toCents, maskAccount, transactionDTO };
