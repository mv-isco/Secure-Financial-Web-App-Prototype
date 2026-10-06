import axios from 'axios';
let accessToken = null;
let generation = 0;
let refreshing = null;
const sessionChannel=typeof window!=='undefined'&&window.BroadcastChannel?new window.BroadcastChannel('securevault-session'):null;
if(sessionChannel)sessionChannel.onmessage=event=>{if(event.data==='signed-out')expire(false);};
export function notifySessionEnded(){sessionChannel?.postMessage('signed-out');}
export const tokenStore = {
  getAccess: () => accessToken,
  getGeneration: () => generation,
  setAccess: token => { accessToken = token; },
  clearAll: () => { accessToken = null; generation++; },
};
const client = axios.create({ baseURL: '/api', timeout: 15000, withCredentials: true,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-SecureVault-Request': '1' } });
client.interceptors.request.use(config => {
  if (accessToken && !config.skipSession) config.headers.Authorization = 'Bearer ' + accessToken;
  return config;
});
function expire(broadcast=true) { tokenStore.clearAll(); window.dispatchEvent(new CustomEvent('sv:session-expired'));if(broadcast)notifySessionEnded(); }
export async function refreshSession() {
  if (!refreshing) {
    const current = generation;
    const refresh = async () => {
      if(current!==generation)throw new Error('Session changed.');
      const res=await client.post('/auth/refresh', {}, { skipSession: true });
      if (current !== generation) throw new Error('Session changed.');
      tokenStore.setAccess(res.data.data.accessToken);
      return res.data.data;
    };
    // Cookies are shared across tabs. Hold the lock until Set-Cookie is applied.
    refreshing = (globalThis.navigator?.locks ? navigator.locks.request('securevault-refresh',refresh) : refresh())
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}
function normalise(error) {
  if (error.response) {
    const e = new Error(error.response.data?.message || 'Request failed.');
    e.status = error.response.status; e.errors = error.response.data?.errors; e.code = error.response.data?.code; return e;
  }
  if (error.request) { const e = new Error('The server could not be reached. Retry this request.'); e.status = 0; return e; }
  return error;
}
client.interceptors.response.use(res => res, async error => {
  const original = error.config;
  const is401 = error.response?.status === 401;
  const isSessionRoute = original && (!original.url?.startsWith('/auth/') || ['/auth/me','/auth/sessions','/auth/logout-all'].includes(original.url));
  if (is401 && isSessionRoute && !original._retried) {
    original._retried = true;
    try { const data = await refreshSession(); original.headers.Authorization = 'Bearer ' + data.accessToken; return await client(original); }
    catch (err) { expire(); throw normalise(err); }
  }
  if (is401 && isSessionRoute) expire();
  throw normalise(error);
});
export default client;
