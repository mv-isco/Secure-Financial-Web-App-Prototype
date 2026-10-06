import { useEffect, useRef, useState } from 'react';
import { transfer, confirmRecipient, getTransferAttempt } from '../api/transactionsApi';
import { fmt } from '../utils/format';
const input={width:'100%',padding:12,borderRadius:8,background:'#0f172a',border:'1px solid #334155',color:'#f1f5f9',margin:'6px 0 16px',fontSize:14};
const button={width:'100%',padding:12,borderRadius:8,background:'#1a8a5e',border:0,color:'#fff',margin:'8px 0',cursor:'pointer'};
const retryKey=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function readAttempt(storageKey) {
 try {
  const value=JSON.parse(sessionStorage.getItem(storageKey));
  if(value&&typeof value.fromId==='string'&&typeof value.to==='string'&&/^\d{12}$/.test(value.to)&&typeof value.amount==='string'&&typeof value.note==='string'&&retryKey.test(value.key)&&typeof value.recipient?.displayName==='string'&&Number.isFinite(value.recipient.readyAt))return value;
 }catch { /* No valid pending transfer. */ }
 return null;
}
function clearAttempt(storageKey,key) {
 try{if(JSON.parse(sessionStorage.getItem(storageKey))?.key===key)sessionStorage.removeItem(storageKey);}catch { /* Storage was unavailable. */ }
 try{if(localStorage.getItem(storageKey+':key')===key)localStorage.removeItem(storageKey+':key');}catch { /* Storage was unavailable. */ }
}
function readKey(storageKey){try{const key=localStorage.getItem(storageKey+':key');return retryKey.test(key)?key:null;}catch{return null;}}
export default function TransferForm({accounts,onSuccess,userId}){
 const storageKey='sv:transfer:'+ (userId||accounts[0]?.id||'');
 const [saved]=useState(()=>readAttempt(storageKey));
 const [carriedKey,setCarriedKey]=useState(()=>readKey(storageKey));
 const [step,setStep]=useState(saved?2:1),[fromId,setFromId]=useState(saved?.fromId||accounts[0]?.id||'');
 const [to,setTo]=useState(saved?.to||''),[amount,setAmount]=useState(saved?.amount||''),[note,setNote]=useState(saved?.note||''),[token,setToken]=useState('');
 const [recipient,setRecipient]=useState(saved?.recipient||null),[key,setKey]=useState(saved?.key||carriedKey),[result,setResult]=useState(null);
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(!!saved);
 const [definitive,setDefinitive]=useState(false);
 const busy=useRef(false),attempt=useRef(null);
 const account=accounts.find(a=>a.id===fromId);
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{
  if(step!==2||!recipient||recipient.readyAt<=Date.now())return;
  const timer=setInterval(()=>{const time=Date.now();setNow(time);if(time>=recipient.readyAt)clearInterval(timer);},1000);return ()=>clearInterval(timer);
 },[recipient,step]);
 const review=async e=>{
  e.preventDefault();if(busy.current)return;setError('');
  const number=to.replace(/[\s-]/g,'');
  if(!/^\d{12}$/.test(number)){setError('Enter a 12-digit recipient account number.');return;}
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(amount)||Number(amount)<.01||Number(amount)>50000){setError('Enter an amount from $0.01 to $50,000 with at most two decimal places.');return;}
  if(!account||account.status!=='active'){setError('Choose an active source account.');return;}
  if(Number(amount)>account.balance){setError('Insufficient funds.');return;}
  busy.current=true;setLoading(true);
  try{
   const data=await confirmRecipient(number);
   setRecipient(data);setTo(number);
   const fingerprint=JSON.stringify({fromId,number,amount,note});
   if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:carriedKey||crypto.randomUUID()};
   setKey(attempt.current.key);setDefinitive(false);setUncertain(false);setStep(2);setToken('');setNow(Date.now());
  }catch(err){setError(err.message);}finally{busy.current=false;setLoading(false);}
 };
 const send=async e=>{
  e.preventDefault();if(busy.current)return;
  if(!/^\d{6}$/.test(token)){setError('Enter a fresh 6-digit authenticator code.');return;}
  busy.current=true;setLoading(true);setError('');
  try{
   const submit=async()=>{
    const outstanding=readKey(storageKey);
    if(outstanding&&outstanding!==key){setKey(outstanding);setCarriedKey(outstanding);throw Object.assign(new Error('Confirm the earlier transfer before sending another.'),{status:409});}
    // Persist before sending. Only the opaque key survives a closed tab.
    try{sessionStorage.setItem(storageKey,JSON.stringify({fromId,to,amount,note,key,recipient}));localStorage.setItem(storageKey+':key',key);setCarriedKey(key);}
    catch{throw new Error('Browser storage is unavailable. Enable it to send transfers safely.');}
    return transfer({fromAccountId:fromId,toAccountNumber:to,amount,note,idempotencyKey:key,token});
   };
   const data=await (globalThis.navigator?.locks?navigator.locks.request('securevault-transfer:'+storageKey,submit):submit());
   clearAttempt(storageKey,key);setCarriedKey(null);setResult(data.transaction);setUncertain(false);setStep(3);onSuccess();
  }catch(err){
   setError(err.message);
   if(!err.status||err.status>=500)setUncertain(true);
   else if([403,409].includes(err.status)) { setUncertain(true); }
   else if(err.code==='TRANSFER_REJECTED') { clearAttempt(storageKey,key);setCarriedKey(null);setUncertain(false); setDefinitive(true); }
   else if(err.status===400||['STEP_UP_REQUIRED','TOTP_LOCKED','PAYEE_COOLING_OFF'].includes(err.code)){setUncertain(false);}
  }finally{busy.current=false;setLoading(false);}
 };
 const checkResult=async()=>{
  if(busy.current||!key)return;busy.current=true;setLoading(true);setError('');
  try{
   const outcome=await getTransferAttempt(key);
   clearAttempt(storageKey,key);setCarriedKey(null);setUncertain(false);
   if(outcome.result.success){setRecipient(null);setResult(outcome.result.data.transaction);setStep(3);onSuccess();}
   else{setError(outcome.result.message);setDefinitive(true);}
  }catch(err){setError(err.message);}finally{busy.current=false;setLoading(false);}
 };
 const reset=()=>{clearAttempt(storageKey,key);setCarriedKey(null);setStep(1);setTo('');setAmount('');setNote('');setToken('');setKey(null);setResult(null);setError('');setDefinitive(false);setUncertain(false);attempt.current=null;};
 if(step===3)return <div role="status">
  <h2>Transfer completed</h2><p style={{margin:'16px 0'}}>{fmt(result.amount)} credited to {recipient?.displayName||result.toAccount}.</p>
  <p style={{wordBreak:'break-all'}}>Reference: {result.reference}</p><button style={button} onClick={reset}>New transfer</button>
 </div>;
 return <form onSubmit={step===1?review:send}>
  {error&&<p role="alert" style={{color:'#ef8585',marginBottom:12}}>{error}</p>}
  {carriedKey&&<div role="status"><p style={{marginBottom:12}}>An earlier transfer needs confirmation. Check its result, or retry using its original details. Its saved retry key prevents a second debit.</p><button type="button" style={button} disabled={loading} onClick={checkResult}>Check previous transfer</button></div>}
  {step===1?<>
   <label htmlFor="source">From account</label><select id="source" value={fromId} onChange={e=>setFromId(e.target.value)} style={input}>
    {accounts.map(a=><option key={a.id} value={a.id}>{a.label} — {fmt(a.balance)}</option>)}
   </select>
   <label htmlFor="recipient">Recipient account number</label><input id="recipient" required value={to} onChange={e=>setTo(e.target.value)} inputMode="numeric" style={input} placeholder="12 digits"/>
   <label htmlFor="amount">Amount (USD)</label><input id="amount" required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} style={input} placeholder="0.00"/>
   <label htmlFor="note">Note (optional)</label><input id="note" value={note} onChange={e=>setNote(e.target.value)} style={input} maxLength={120}/>
   <p style={{fontSize:12,color:'#94a3b8'}}>Transfers are available between SecureVault accounts. Limit: $50,000 per transfer and $100,000 over 24 hours.</p>
   <button style={button} disabled={loading}>{loading?'Checking recipient…':'Review transfer'}</button>
   {definitive&&<button type="button" style={button} onClick={reset}>Start a new transfer</button>}
  </>:<>
   <p style={{marginBottom:12}}>Send <strong>{fmt(Number(amount))}</strong> from {account?.label||'your source account'} to <strong>{recipient.displayName}</strong> ({to}).</p>
   {recipient.readyAt>now&&<p style={{marginBottom:12}}>New recipient available after {new Date(recipient.readyAt).toLocaleString()}.</p>}
   <label htmlFor="transfer-code">Fresh authenticator code</label><input id="transfer-code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,6))} style={input}/>
   <p style={{fontSize:12,color:'#94a3b8'}}>Wait for a new code if you used the current one to sign in. Each code can authorize one operation.</p>
   {uncertain&&<p role="status" style={{marginTop:12}}>The result is unconfirmed. Retry here with the same transfer details to retrieve the result safely.</p>}
   <button style={button} disabled={loading||definitive||recipient.readyAt>now}>{loading?'Processing…':uncertain?'Retry transfer':'Authorize & send'}</button>
   {definitive&&<button type="button" style={button} onClick={reset}>Start a new transfer</button>}
   <button type="button" style={{...button,background:'#334155'}} disabled={loading||uncertain} onClick={()=>{setStep(1);setError('');setToken('');}}>Back</button>
  </>}
 </form>;
}
