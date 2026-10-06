import client from './client';
export const getProfile = async signal => (await client.get('/profile', { signal })).data.data;
export const updateProfile = async name => (await client.patch('/profile', { name })).data.data;
export const changePassword = async payload => (await client.post('/profile/password', payload)).data.data;
export const revokeSession = async id => (await client.delete('/profile/sessions/' + encodeURIComponent(id))).data.data;
export const addTestFunds = async (accountId, payload) => (await client.post('/accounts/' + encodeURIComponent(accountId) + '/test-funds', payload)).data.data;
export const getFundingAttempt = async key => (await client.get('/transactions/attempts/' + encodeURIComponent(key))).data.data;
