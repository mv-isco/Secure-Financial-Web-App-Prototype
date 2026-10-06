import client from './client';
export async function transfer(payload) {
  if (!payload.idempotencyKey) throw new Error('A stable transfer retry key is required.');
  return (await client.post('/transactions/transfer', payload)).data.data;
}
export const confirmRecipient = async accountNumber => (await client.post('/transactions/recipient', { accountNumber })).data.data;
export async function getTransactions(params = {},signal) { const res = await client.get('/transactions', { params,signal }); return { data: res.data.data, meta: res.data.meta }; }
export const getTransaction = async id => (await client.get('/transactions/' + encodeURIComponent(id))).data.data;
export const getTransferAttempt = async key => (await client.get('/transactions/attempts/' + encodeURIComponent(key))).data.data;
