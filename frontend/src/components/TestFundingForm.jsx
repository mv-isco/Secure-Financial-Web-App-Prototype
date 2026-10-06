import { useRef, useState } from 'react';
import { addTestFunds, getFundingAttempt } from '../api/profileApi';
import { fmt } from '../utils/format';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function readSaved(storageKey){
 try{const value=JSON.parse(sessionStorage.getItem(storageKey));if(value&&uuid.test(value.key)&&typeof value.accountId==='string'&&typeof value.amount==='string')return value;}catch{/* No saved attempt. */}
 return null;
}
function readKey(storageKey){try{const value=localStorage.getItem(storageKey+':key');return uuid.test(value)?value:null;}catch{return null;}}
function clearSaved(storageKey,key){
 try{if(JSON.parse(sessionStorage.getItem(storageKey))?.key===key)sessionStorage.removeItem(storageKey);if(localStorage.getItem(storageKey+':key')===key)localStorage.removeItem(storageKey+':key');}catch{/* Retain the server result if storage is unavailable. */}
}
export default function TestFundingForm({accounts,userId,limits,onSuccess}){
 const storageKey='sv:test-funding:'+userId;
 const [pending,setPending]=useState(()=>readSaved(storageKey));
 const [carriedKey,setCarriedKey]=useState(()=>readKey(storageKey));
 const [accountId,setAccountId]=useState(()=>readSaved(storageKey)?.accountId||accounts.find(a=>a.status==='active')?.id||'');
 const [amount,setAmount]=useState(()=>readSaved(storageKey)?.amount||'');
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const busy=useRef(false);
 const unresolved=!!pending,hasPrevious=!!(pending||carriedKey);
 const finish=(transaction,key)=>{
  if(transaction.category!=='Test funding')throw new Error('This saved result belongs to a different operation.');
  clearSaved(storageKey,key);setPending(null);setCarriedKey(null);setAmount('');
  setMessage(fmt(transaction.amount)+' in test money added. Reference: '+transaction.reference);onSuccess();
 };
 const send=async e=>{
  e.preventDefault();if(busy.current)return;setError('');setMessage('');
  const selected=accounts.find(a=>a.id===accountId);
  if(!pending&&(!selected||selected.status!=='active')){setError('Choose an active account.');return;}
  if(!pending&&(!/^\d{1,9}(\.\d{1,2})?$/.test(amount)||Number(amount)<.01||Number(amount)>limits.singleLimit)){setError('Enter $0.01 to '+fmt(limits.singleLimit)+' with at most two decimal places.');return;}
  busy.current=true;setLoading(true);
  const attempt=pending||{accountId,amount,key:carriedKey||crypto.randomUUID()};
  try{
   const submit=async()=>{
    const previous=readKey(storageKey);
    if(previous&&previous!==attempt.key){setCarriedKey(previous);throw new Error('Check the previous top-up before adding more test money.');}
    try{sessionStorage.setItem(storageKey,JSON.stringify(attempt));localStorage.setItem(storageKey+':key',attempt.key);}catch{throw new Error('Enable browser storage to add test money safely.');}
    setPending(attempt);setCarriedKey(attempt.key);
    return addTestFunds(attempt.accountId,{amount:attempt.amount,idempotencyKey:attempt.key});
   };
   const data=await (globalThis.navigator?.locks?navigator.locks.request('securevault-test-funding:'+userId,submit):submit());
   finish(data.transaction,attempt.key);
  }catch(err){
   setError(err.message);
   if(err.code==='TEST_FUNDING_REJECTED'||[400,404].includes(err.status)){clearSaved(storageKey,attempt.key);setPending(null);setCarriedKey(null);}
  }finally{busy.current=false;setLoading(false);}
 };
 const check=async()=>{
  const key=carriedKey||pending?.key;if(!key||busy.current)return;busy.current=true;setLoading(true);setError('');setMessage('');
  try{
   const data=await getFundingAttempt(key);
   if(data.result.success)finish(data.result.data.transaction,key);
   else{clearSaved(storageKey,key);setPending(null);setCarriedKey(null);setError(data.result.message);}
  }catch(err){setError(err.message);}finally{busy.current=false;setLoading(false);}
 };
 return <form onSubmit={send}>
  <p className="profile-note">Artificial funds for testing. They have no real monetary value.</p>
  {error&&<p role="alert" className="profile-error">{error}</p>}
  {message&&<p role="status" className="profile-success">{message}</p>}
  {hasPrevious&&<div className="profile-notice"><p>The previous top-up needs confirmation. Checking or retrying it will keep the same request key.</p>{!pending&&<p>To retry, enter the original account and amount. Check its result before starting a different top-up.</p>}<button type="button" className="profile-button secondary" disabled={loading} onClick={check}>Check previous top-up</button></div>}
  <label htmlFor="test-funding-account">Account to top up</label>
  <select id="test-funding-account" className="profile-input" value={accountId} onChange={e=>setAccountId(e.target.value)} disabled={loading||unresolved} required>
   <option value="" disabled>Choose an account</option>
   {accounts.filter(a=>a.status==='active').map(a=><option key={a.id} value={a.id}>{a.label} — {fmt(a.balance)}</option>)}
  </select>
  <label htmlFor="test-funding-amount">Test amount (USD)</label>
  <input id="test-funding-amount" className="profile-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} disabled={loading||unresolved} required/>
  {!hasPrevious&&<div className="profile-presets">{[100,1000,10000].filter(v=>v<=limits.singleLimit).map(v=><button type="button" className="profile-button secondary compact" key={v} disabled={loading} onClick={()=>setAmount(String(v))}>+{fmt(v)}</button>)}</div>}
  <p className="profile-note">Up to {fmt(limits.singleLimit)} per top-up and {fmt(limits.dailyLimit)} over 24 hours. Maximum account balance: {fmt(limits.balanceLimit)}.</p>
  <button className="profile-button" disabled={loading||(!pending&&!accounts.some(a=>a.status==='active'))}>{loading?'Processing…':hasPrevious?'Retry test top-up':'Add test money'}</button>
 </form>;
}
