import { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as api from '../api/authApi';
import { tokenStore } from '../api/client';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [pending, setPending] = useState(null);
  const restored = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    const expire = () => { epoch.current++; setUser(null); setPending(null); setStatus('unauthenticated'); };
    window.addEventListener('sv:session-expired', expire);
    if (!restored.current) {
      restored.current = true;
      const current = epoch.current;
      api.refreshToken().then(api.getMe).then(data => {
        if (epoch.current === current) { setUser(data); setStatus('authenticated'); }
      }).catch(() => { if (epoch.current === current) { tokenStore.clearAll(); setStatus('unauthenticated'); } });
    }
    return () => window.removeEventListener('sv:session-expired', expire);
  }, []);
  const complete = data => { setUser(data.user); setPending(null); setStatus('authenticated'); return data; };
  const login = async payload => { const current=epoch.current; const data = await api.login(payload); if(current!==epoch.current) throw new Error('Session changed.'); setPending(data.preAuthToken||data.enrollmentToken?data:null); return data; };
  const register = async payload => { const current=epoch.current; const data = await api.register(payload); if(current!==epoch.current)throw new Error('Session changed.'); setPending(null); return data; };
  const claimRegistration = async payload => { const current=epoch.current; const data = await api.claimRegistration(payload); if(current!==epoch.current)throw new Error('Session changed.'); if (data.enrollmentToken) setPending(data); return data; };
  const verify2FA = async ({ token }) => { const current=epoch.current; const data=await api.verify2FA({ preAuthToken: pending?.preAuthToken, token }); if(current!==epoch.current) throw new Error('Session changed.'); return complete(data); };
  const setup2FA = async ({ token }) => { const current=epoch.current; const data=await api.setup2FA({ enrollmentToken: pending?.enrollmentToken, token }); if(current!==epoch.current) throw new Error('Session changed.'); return complete(data); };
  const recover2FA = async ({ recoveryCode }) => {
    const current=epoch.current;
    const data = await api.recover2FA({ preAuthToken: pending?.preAuthToken, recoveryCode });
    if(current!==epoch.current)throw new Error('Session changed.');
    setPending({ ...data, requiresEnrollment: true }); return data;
  };
  const logout = async () => {
    epoch.current++;
    try { await api.logout(); } catch { /* Always leave the local signed-out state. */ }
    finally { tokenStore.clearAll(); setUser(null); setPending(null); setStatus('unauthenticated'); }
  };
  const resetLogin = () => { epoch.current++;tokenStore.clearAll();setPending(null); };
  const refreshUser = async () => {
    const current=epoch.current,data=await api.getMe();
    if(current!==epoch.current)throw new Error('Session changed.');
    setUser(data);return data;
  };
  const endSession = () => { epoch.current++;tokenStore.clearAll();setUser(null);setPending(null);setStatus('unauthenticated'); };
  const logoutAll = async () => { await api.logoutAll();endSession(); };
  return <AuthContext.Provider value={{ user,status,pending,loginStep:pending ? 'twoFactor' : null,
    isAuthenticated: status === 'authenticated',isLoading:status === 'loading',
    login,register,claimRegistration,verify2FA,setup2FA,recover2FA,resetLogin,logout,refreshUser,endSession,logoutAll }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('AuthProvider is required.'); return context; }
