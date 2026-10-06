import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { notifySessionEnded } from '../api/client';
import * as api from '../api/profileApi';
import TestFundingForm from '../components/TestFundingForm';

const events={
 'AUTH:REGISTER_SUCCESS':'Account created','AUTH:2FA_SUCCESS':'Signed in with authenticator','AUTH:2FA_ENROLLED':'Authenticator activated',
 'AUTH:LOGOUT':'Signed out','AUTH:LOGOUT_ALL':'Signed out on all devices','AUTH:SESSION_REVOKED':'Session signed out',
 'PROFILE:NAME_UPDATED':'Profile name updated','PROFILE:PASSWORD_CHANGED':'Password changed','ACCOUNT:TEST_FUNDED':'Test money added',
 'TXN:TRANSFER_SUCCESS':'Transfer sent','TXN:TRANSFER_RECEIVED':'Transfer received','ACCOUNT:FUNDED':'Account funded',
 'AUTH:2FA_FAILURE':'Authenticator verification failed','AUTH:2FA_RECOVERED':'Authenticator recovered','AUTH:REFRESH_REUSE':'Session revoked after token reuse',
 'TXN:TRANSFER_REJECTED':'Transfer rejected',
};
export default function ProfilePage({accounts,accountsLoading,accountsError,onFundsAdded,retryAccounts}){
 const {user,refreshUser,endSession,logoutAll}=useAuth();
 const [profile,setProfile]=useState(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [name,setName]=useState(user.name),[nameBusy,setNameBusy]=useState(false),[nameError,setNameError]=useState(''),[nameMessage,setNameMessage]=useState('');
 const [currentPassword,setCurrentPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[token,setToken]=useState('');
 const [passwordBusy,setPasswordBusy]=useState(false),[passwordError,setPasswordError]=useState('');
 const [sessionBusy,setSessionBusy]=useState(false),[sessionError,setSessionError]=useState(''),[confirmLogout,setConfirmLogout]=useState(false);
 const nameLock=useRef(false),passwordLock=useRef(false),sessionLock=useRef(false);
 const loadState=useRef({epoch:0,alive:true});
 const load=useCallback(async()=>{
  const state=loadState.current,epoch=++state.epoch;setLoading(true);setLoadError('');
  try{const data=await api.getProfile();if(state.alive&&epoch===state.epoch)setProfile(data);}
  catch(err){if(state.alive&&epoch===state.epoch)setLoadError(err.message);}
  finally{if(state.alive&&epoch===state.epoch)setLoading(false);}
 },[]);
 useEffect(()=>{const state=loadState.current;state.alive=true;load();return()=>{state.alive=false;state.epoch++;};},[load]);
 const saveName=async e=>{
  e.preventDefault();if(nameLock.current)return;nameLock.current=true;setNameBusy(true);setNameError('');setNameMessage('');
  try{await api.updateProfile(name.trim());await refreshUser();setNameMessage('Your profile has been updated.');load();}
  catch(err){setNameError(err.message);}finally{nameLock.current=false;setNameBusy(false);}
 };
 const savePassword=async e=>{
  e.preventDefault();if(passwordLock.current)return;setPasswordError('');
  if(newPassword!==confirmation){setPasswordError('New passwords do not match.');return;}
  if(newPassword===currentPassword){setPasswordError('Choose a different new password.');return;}
  if(newPassword.length<8||new TextEncoder().encode(newPassword).length>72||!/[A-Z]/.test(newPassword)||!/[0-9]/.test(newPassword)||! /[^A-Za-z0-9]/.test(newPassword)){setPasswordError('Use 8–72 UTF-8 bytes with an uppercase letter, number and symbol.');return;}
  if(!/^\d{6}$/.test(token)){setPasswordError('Enter a fresh 6-digit authenticator code.');return;}
  passwordLock.current=true;setPasswordBusy(true);
  try{await api.changePassword({currentPassword,newPassword,token});notifySessionEnded();endSession();}
  catch(err){setPasswordError(err.message);}finally{setCurrentPassword('');setNewPassword('');setConfirmation('');setToken('');passwordLock.current=false;setPasswordBusy(false);}
 };
 const signOutSession=async id=>{
  if(sessionLock.current)return;sessionLock.current=true;setSessionBusy(true);setSessionError('');
  try{const data=await api.revokeSession(id);if(data.current){notifySessionEnded();endSession();}else await load();}
  catch(err){setSessionError(err.message);}finally{sessionLock.current=false;setSessionBusy(false);}
 };
 const signOutAll=async()=>{
  if(sessionLock.current)return;sessionLock.current=true;setSessionBusy(true);
  setSessionError('');
  try{await logoutAll();}catch(err){setSessionError(err.message);}finally{sessionLock.current=false;setSessionBusy(false);}
 };
 const funded=()=>{onFundsAdded();load();};
 return <div className="profile-page">
  <div className="profile-intro"><div className="profile-avatar" aria-hidden="true">{user.name.split(/\s+/).map(p=>p[0]).join('').slice(0,2).toUpperCase()}</div><div><h1>Your profile</h1><p>Manage your details, account security and sessions.</p></div></div>
  {loadError&&<p role="alert" className="profile-error">Could not load profile: {loadError} <button className="profile-button secondary compact" onClick={load}>Retry profile</button></p>}
  <div className="profile-grid">
   <section className="profile-panel" aria-labelledby="profile-details-title">
    <h2 id="profile-details-title">Personal details</h2><p className="profile-note">Your name appears on your dashboard and recipient confirmations.</p>
    <form onSubmit={saveName}>
     {nameError&&<p role="alert" className="profile-error">{nameError}</p>}{nameMessage&&<p role="status" className="profile-success">{nameMessage}</p>}
     <label htmlFor="profile-name">Full name</label><input id="profile-name" className="profile-input" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={60} disabled={nameBusy} required/>
     <label htmlFor="profile-email">Verified email address</label><input id="profile-email" className="profile-input" value={user.email} readOnly/>
     <p className="profile-note">Member since {profile?new Date(profile.user.createdAt).toLocaleDateString():'…'}. Email changes require a separate verification flow.</p>
     <button className="profile-button" disabled={nameBusy||name.trim()===user.name}>{nameBusy?'Saving…':'Save profile'}</button>
    </form>
   </section>
   <section className="profile-panel" aria-labelledby="profile-password-title">
    <h2 id="profile-password-title">Change password</h2><p className="profile-note">Changing your password signs you out on all devices. Your authenticator stays active.</p>
    <form onSubmit={savePassword}>
     {passwordError&&<p role="alert" className="profile-error">{passwordError}</p>}
     <label htmlFor="profile-current-password">Current password</label><input id="profile-current-password" className="profile-input" type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} disabled={passwordBusy} required/>
     <label htmlFor="profile-new-password">New password</label><input id="profile-new-password" className="profile-input" type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={8} maxLength={72} disabled={passwordBusy} required/>
     <p className="profile-note">At least 8 characters, including an uppercase letter, number and symbol. Maximum 72 UTF-8 bytes.</p>
     <label htmlFor="profile-confirm-password">Confirm new password</label><input id="profile-confirm-password" className="profile-input" type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={passwordBusy} required/>
     <label htmlFor="profile-password-token">Fresh authenticator code</label><input id="profile-password-token" className="profile-input" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,6))} pattern="[0-9]{6}" maxLength={6} disabled={passwordBusy} required/>
     <p className="profile-note">Wait for a new code if you used the current code to sign in or transfer money.</p>
     <button className="profile-button" disabled={passwordBusy}>{passwordBusy?'Changing password…':'Change password & sign out'}</button>
    </form>
   </section>
   <section className="profile-panel" aria-labelledby="profile-funding-title">
    <h2 id="profile-funding-title">Test money</h2>
    {loading&&!profile?<p className="profile-note" role="status">Loading funding settings…</p>:profile?.testFunding.enabled?<>
     <span className="profile-badge">LOCAL TEST MODE</span>
     {accountsError&&<p role="alert" className="profile-error">Could not load accounts. <button onClick={retryAccounts} className="profile-button secondary compact">Retry accounts</button></p>}
     {accountsLoading&&!accounts.length?<p role="status">Loading accounts…</p>:<TestFundingForm key={user.id} accounts={accounts} userId={user.id} limits={profile.testFunding} onSuccess={funded}/>}
    </>:profile?<p className="profile-note">Artificial funding is available in local development only.</p>:<p className="profile-note">Load your profile to check funding availability.</p>}
   </section>
   <section className="profile-panel" aria-labelledby="profile-security-title">
    <h2 id="profile-security-title">Security & sessions</h2>
    <div className="profile-security-row"><span>Authenticator</span><span className="profile-badge">{user.twoFactorEnabled?'ENABLED':'SETUP REQUIRED'}</span></div>
    <p className="profile-note">{profile?profile.security.recoveryCodesRemaining+' unused recovery codes. Keep your saved codes offline.':'Loading security details…'}</p>
    {sessionError&&<p role="alert" className="profile-error">{sessionError}</p>}
    <h3>Active sessions {profile?'('+profile.sessions.length+')':''}</h3>
    {profile?.sessions.map((session,index)=><div className="profile-session" key={session.id}><div><strong>{session.current?'This browser':'Other session '+(index+1)}</strong><p className="profile-note">Expires {new Date(session.expiresAt).toLocaleString()}</p></div><button className="profile-button secondary compact" disabled={sessionBusy} onClick={()=>signOutSession(session.id)} aria-label={session.current?'Sign out this session':'Sign out session '+(index+1)}>Sign out</button></div>)}
    {!confirmLogout?<button className="profile-button secondary" disabled={sessionBusy||!profile} onClick={()=>setConfirmLogout(true)}>Sign out on all devices</button>:<div className="profile-notice"><p>This will end every session, including this one.</p><div className="profile-presets"><button className="profile-button danger" disabled={sessionBusy} onClick={signOutAll}>Confirm sign out on all devices</button><button className="profile-button secondary" disabled={sessionBusy} onClick={()=>setConfirmLogout(false)}>Cancel</button></div></div>}
   </section>
   <section className="profile-panel profile-wide" aria-labelledby="profile-activity-title"><h2 id="profile-activity-title">Recent account activity</h2><p className="profile-note">The latest ten events for your account.</p>
    {profile?.activity.length?<ul className="profile-activity">{profile.activity.map(item=><li key={item.id}><span>{events[item.event]||item.event}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></li>)}</ul>:<p className="profile-note">{loading?'Loading activity…':'No recent activity.'}</p>}
   </section>
  </div>
 </div>;
}
