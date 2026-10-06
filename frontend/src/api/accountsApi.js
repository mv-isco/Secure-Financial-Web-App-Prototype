/**
 * Accounts API
 */

import client from './client';

/** List all accounts with current balances */
export async function getAccounts(signal) {
  const res = await client.get('/accounts',{signal});
  return res.data.data;  // { accounts[], totalBalance, currency, count }
}

/** Single account detail */
export async function getAccount(accountId) {
  const res = await client.get(`/accounts/${accountId}`);
  return res.data.data;
}

/**
 * Paginated transaction history for a specific account.
 * @param {string} accountId
 * @param {{ limit?: number, offset?: number }} params
 */
export async function getAccountTransactions(accountId, params = {}) {
  const res = await client.get(`/accounts/${accountId}/transactions`, { params });
  return { data: res.data.data, meta: res.data.meta };
}
