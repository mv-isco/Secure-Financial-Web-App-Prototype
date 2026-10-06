import client, { tokenStore, refreshSession, notifySessionEnded } from './client';
export const login = async payload => (await client.post('/auth/login', payload, { skipSession: true })).data.data;
export const register = async payload => (await client.post('/auth/register', payload, { skipSession: true })).data.data;
export const claimRegistration = async payload => (await client.post('/auth/claim-registration', payload, { skipSession: true })).data.data;
async function complete(url, payload) {
  const generation = tokenStore.getGeneration();
  const data = (await client.post(url, payload, { skipSession: true })).data.data;
  if (generation !== tokenStore.getGeneration()) throw new Error('Session changed. Sign in again.');
  tokenStore.setAccess(data.accessToken);
  return data;
}
export const verify2FA = payload => complete('/auth/verify-2fa', payload);
export const setup2FA = payload => complete('/auth/setup-2fa', payload);
export const recover2FA = async payload => (await client.post('/auth/recover-2fa', payload, { skipSession: true })).data.data;
export const refreshToken = refreshSession;
export const getMe = async () => (await client.get('/auth/me')).data.data;
export async function logout() {
  const access = tokenStore.getAccess(); tokenStore.clearAll();
  try { await client.post('/auth/logout', {}, { headers: access ? { Authorization: 'Bearer ' + access } : {} }); }
  finally { tokenStore.clearAll();notifySessionEnded(); }
}
export async function logoutAll() { await client.post('/auth/logout-all');tokenStore.clearAll();notifySessionEnded(); }
