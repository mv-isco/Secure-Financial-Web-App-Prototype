import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider,useAuth } from './AuthContext';
import * as api from '../api/authApi';
import {tokenStore} from '../api/client';
vi.mock('../api/authApi',()=>({refreshToken:vi.fn(),getMe:vi.fn(),login:vi.fn(),verify2FA:vi.fn(),logout:vi.fn(),logoutAll:vi.fn(),register:vi.fn(),claimRegistration:vi.fn(),setup2FA:vi.fn(),recover2FA:vi.fn()}));
function Harness(){
 const auth=useAuth();
 return <><span>{auth.status}</span><button onClick={()=>auth.login({email:'a@example.com',password:'password'})}>Login</button>
 <button onClick={()=>auth.verify2FA({token:'123456'})}>Verify</button><button onClick={auth.logout}>Logout</button></>;
}
afterEach(()=>{cleanup();vi.resetAllMocks();tokenStore.clearAll();});
it('a failed all-device logout preserves authentication so the user can retry',async()=>{
 api.refreshToken.mockResolvedValue({});api.getMe.mockResolvedValue({id:'alice'});api.logoutAll.mockRejectedValue(new Error('Offline'));tokenStore.setAccess('current');
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await waitFor(()=>expect(result.current.status).toBe('authenticated'));
 let error;await act(async()=>{try{await result.current.logoutAll();}catch(err){error=err;}});
 expect(error.message).toBe('Offline');expect(result.current.status).toBe('authenticated');expect(tokenStore.getAccess()).toBe('current');
});
it('a confirmed all-device logout clears the shared local account state',async()=>{
 api.refreshToken.mockResolvedValue({});api.getMe.mockResolvedValue({id:'alice'});api.logoutAll.mockResolvedValue({});tokenStore.setAccess('current');
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await waitFor(()=>expect(result.current.status).toBe('authenticated'));
 await act(()=>result.current.logoutAll());expect(result.current.status).toBe('unauthenticated');expect(tokenStore.getAccess()).toBeNull();
});
it('binds 2FA to the preauth token from the password step',async()=>{
 api.refreshToken.mockRejectedValue(new Error('No session'));
 api.login.mockResolvedValue({preAuthToken:'password-challenge',twoFactorRequired:true});
 api.verify2FA.mockResolvedValue({user:{id:'alice',name:'Alice'}});
 render(<AuthProvider><Harness/></AuthProvider>);await screen.findByText('unauthenticated');
 const user=userEvent.setup();await user.click(screen.getByText('Login'));await user.click(screen.getByText('Verify'));
 expect(api.verify2FA).toHaveBeenCalledWith({preAuthToken:'password-challenge',token:'123456'});
 await screen.findByText('authenticated');
});
it('clears local state and tokens even when logout fails',async()=>{
 api.refreshToken.mockResolvedValue({});api.getMe.mockResolvedValue({id:'alice'});api.logout.mockRejectedValue(new Error('offline'));
 tokenStore.setAccess('old');render(<AuthProvider><Harness/></AuthProvider>);await screen.findByText('authenticated');
 await userEvent.setup().click(screen.getByText('Logout'));await screen.findByText('unauthenticated');expect(tokenStore.getAccess()).toBeNull();
});
it('a late restore cannot sign a logged-out user back in',async()=>{
 let resolve;api.refreshToken.mockImplementation(()=>new Promise(r=>{resolve=r;}));api.getMe.mockResolvedValue({id:'alice'});api.logout.mockResolvedValue({});
 render(<AuthProvider><Harness/></AuthProvider>);await userEvent.setup().click(screen.getByText('Logout'));
 resolve({});await waitFor(()=>expect(screen.getByText('unauthenticated')).toBeTruthy());
});
it('a late email claim cannot restore an enrollment after logout',async()=>{
 api.refreshToken.mockRejectedValue(new Error('No session'));api.logout.mockResolvedValue({});
 let finish;api.claimRegistration.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await waitFor(()=>expect(result.current.status).toBe('unauthenticated'));
 let pending;act(()=>{pending=result.current.claimRegistration({ticket:'proof',password:'password'}).catch(error=>error);});
 await act(()=>result.current.logout());let outcome;
 await act(async()=>{finish({enrollmentToken:'old-enrollment'});outcome=await pending;});
 expect(outcome.message).toBe('Session changed.');expect(result.current.pending).toBeNull();
});
it('an email-enrollment response never becomes a password challenge',async()=>{
 api.refreshToken.mockRejectedValue(new Error('No session'));api.login.mockResolvedValue({requiresEmailVerification:true,nextStep:'check-email'});
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await waitFor(()=>expect(result.current.status).toBe('unauthenticated'));
 await act(()=>result.current.login({email:'alice@example.com',password:'password'}));
 expect(result.current.pending).toBeNull();expect(result.current.isAuthenticated).toBe(false);
});
