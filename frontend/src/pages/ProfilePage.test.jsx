import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from './ProfilePage';
import * as api from '../api/profileApi';
const auth=vi.hoisted(()=>({user:{id:'alice',name:'Alice Example',email:'alice@example.com',twoFactorEnabled:true},refreshUser:vi.fn(),endSession:vi.fn(),logoutAll:vi.fn()}));
vi.mock('../context/AuthContext',()=>({useAuth:()=>auth}));
vi.mock('../api/profileApi',()=>({getProfile:vi.fn(),updateProfile:vi.fn(),changePassword:vi.fn(),revokeSession:vi.fn(),addTestFunds:vi.fn(),getFundingAttempt:vi.fn()}));
const profile={user:{...auth.user,createdAt:'2026-01-01T00:00:00Z'},security:{recoveryCodesRemaining:8},sessions:[{id:'current',current:true,expiresAt:Date.now()+86400000},{id:'other',current:false,expiresAt:Date.now()+86400000}],activity:[],testFunding:{enabled:false}};
function show(data=profile){api.getProfile.mockResolvedValue(data);return render(<ProfilePage accounts={[]} accountsLoading={false} onFundsAdded={()=>{}} retryAccounts={()=>{}}/>);}
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('shows account information, protected email and safe security details',async()=>{
 show();await screen.findByText(/8 unused recovery codes/);expect(screen.getByLabelText('Verified email address').readOnly).toBe(true);expect(screen.getByLabelText('Verified email address').value).toBe(auth.user.email);
 expect(screen.getByText('This browser')).toBeTruthy();expect(screen.getByText('Artificial funding is available in local development only.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Add test money'})).toBeNull();
});
it('saving a name refreshes the shared account information',async()=>{
 api.updateProfile.mockResolvedValue({});auth.refreshUser.mockResolvedValue({});show();const user=userEvent.setup();await screen.findByText(/8 unused recovery codes/);
 await user.clear(screen.getByLabelText('Full name'));await user.type(screen.getByLabelText('Full name'),'Alice Updated');await user.click(screen.getByRole('button',{name:'Save profile'}));await screen.findByText('Your profile has been updated.');
 expect(api.updateProfile).toHaveBeenCalledWith('Alice Updated');expect(auth.refreshUser).toHaveBeenCalledTimes(1);
});
it('requires confirmation before signing out everywhere',async()=>{
 show();const user=userEvent.setup();await screen.findByText(/8 unused recovery codes/);await user.click(screen.getByRole('button',{name:'Sign out on all devices',exact:true}));expect(auth.logoutAll).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Confirm sign out on all devices'}));expect(auth.logoutAll).toHaveBeenCalledTimes(1);
});
it('revoking the current session clears local authentication',async()=>{
 api.revokeSession.mockResolvedValue({current:true});show();await screen.findByText(/8 unused recovery codes/);await userEvent.setup().click(screen.getByRole('button',{name:'Sign out this session'}));expect(auth.endSession).toHaveBeenCalledTimes(1);
});
it('a failed all-device logout shows an error and allows another attempt',async()=>{
 auth.logoutAll.mockRejectedValue(new Error('Server unavailable'));show();const user=userEvent.setup();await screen.findByText(/8 unused recovery codes/);
 await user.click(screen.getByRole('button',{name:'Sign out on all devices',exact:true}));await user.click(screen.getByRole('button',{name:'Confirm sign out on all devices'}));await screen.findByText('Server unavailable');
 expect(auth.endSession).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Confirm sign out on all devices'}).disabled).toBe(false);
});
it('password confirmation mismatch never sends a password request',async()=>{
 show();const user=userEvent.setup();await user.type(screen.getByLabelText('Current password'),'Current@123');await user.type(screen.getByLabelText('New password'),'NewSecure@123');await user.type(screen.getByLabelText('Confirm new password'),'Different@123');await user.type(screen.getByLabelText('Fresh authenticator code'),'123456');
 await user.click(screen.getByRole('button',{name:'Change password & sign out'}));await screen.findByText('New passwords do not match.');expect(api.changePassword).not.toHaveBeenCalled();
});
it('password change sends both proofs and signs out only after server confirmation',async()=>{
 api.changePassword.mockResolvedValue({});show();const user=userEvent.setup();await user.type(screen.getByLabelText('Current password'),'Current@123');await user.type(screen.getByLabelText('New password'),'NewSecure@123');await user.type(screen.getByLabelText('Confirm new password'),'NewSecure@123');await user.type(screen.getByLabelText('Fresh authenticator code'),'123456');
 await user.click(screen.getByRole('button',{name:'Change password & sign out'}));
 expect(api.changePassword).toHaveBeenCalledWith({currentPassword:'Current@123',newPassword:'NewSecure@123',token:'123456'});expect(auth.endSession).toHaveBeenCalledTimes(1);
});
