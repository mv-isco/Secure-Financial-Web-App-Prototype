import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
const panel = { width:'100%',maxWidth:440,padding:'2rem',borderRadius:16,background:'#0d1117',border:'1px solid #544624',color:'#e8dfc0' };
const input = { width:'100%',padding:12,margin:'6px 0 16px',borderRadius:8,background:'#161b22',border:'1px solid #544624',color:'#fff',fontSize:16 };
const button = { width:'100%',padding:12,borderRadius:8,border:0,background:'#c9a84c',color:'#0d1117',cursor:'pointer',margin:'8px 0' };
export default function LoginPage() {
  const { login,verify2FA,setup2FA,recover2FA,resetLogin,pending,isAuthenticated } = useAuth();
  const navigate=useNavigate(),location=useLocation();
  const raw=location.state?.from?.pathname;
  const from=raw?.startsWith('/')&&!raw.startsWith('//')?raw:'/dashboard';
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[token,setToken]=useState('');
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const busy=useRef(false);
  const [checkEmail,setCheckEmail]=useState(false);
  const [recovery,setRecovery]=useState(false),[recoveryCode,setRecoveryCode]=useState(''),[codes,setCodes]=useState([]);
  useEffect(()=>{if(isAuthenticated&&!codes.length)navigate(from,{replace:true});},[isAuthenticated,codes.length,navigate,from]);
  const submit=async e=>{
    e.preventDefault();if(busy.current)return;busy.current=true;setLoading(true);setError('');
    try {
      if(!pending) {const data=await login({email,password});setRecovery(!!data.recoveryRequired);setPassword('');setCheckEmail(!!data.requiresEmailVerification);}
      else if(recovery&&!pending.enrollmentToken) {await recover2FA({recoveryCode});setRecovery(false);setRecoveryCode('');setToken('');}
      else {
        const result=pending.enrollmentToken?await setup2FA({token}):await verify2FA({token});
        if(result.recoveryCodes) setCodes(result.recoveryCodes);
      }
    } catch(err){setError(err.message);setToken('');}
    finally{busy.current=false;setLoading(false);}
  };
  return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#080a0e',fontFamily:'system-ui'}}>
    <section style={panel}>
      <h1 style={{marginBottom:16}}>SecureVault</h1>
      {codes.length>0 ? <>
        <h2>Save your recovery codes</h2>
        <p style={{margin:'12px 0'}}>Keep these offline. Each code works once with your password if you lose your authenticator.</p>
        <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',fontSize:12}}>{codes.join('\n')}</pre>
        <button style={button} onClick={()=>navigate(from,{replace:true})}>I saved my codes. Continue</button>
      </> : <form onSubmit={submit}>
        <h2 style={{marginBottom:12}}>{checkEmail?'Check your email':!pending?'Sign in':pending.enrollmentToken?'Set up authenticator':recovery?'Recover authenticator':'Verify authenticator'}</h2>
        {checkEmail&&<p style={{marginBottom:12}}>Open the verification link in your email and enter your password to finish enrollment. You can sign in after setting up your authenticator.</p>}
        {error&&<p role="alert" style={{color:'#ef8585',margin:'12px 0'}}>{error}</p>}
        {!checkEmail&&(!pending ? <>
          <label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} style={input}/>
          <label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} style={input}/>
        </> : <>
          {pending.enrollmentToken&&<div style={{margin:'16px 0'}}>
            <QRCodeSVG value={pending.twoFactor.otpAuthUrl} size={176} bgColor="#fff" style={{padding:12,background:'#fff'}} title="Scan with your authenticator"/>
            <p style={{marginTop:12}}>Manual setup key: <code style={{wordBreak:'break-all'}}>{pending.twoFactor.secret}</code></p>
          </div>}
          {recovery&&!pending.enrollmentToken ? <>
            <label htmlFor="recovery">Recovery code</label><input id="recovery" autoComplete="off" required value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value.trim())} style={input}/>
          </> : <>
            <p style={{marginBottom:12}}>Enter the current code from your authenticator. Each code can be used once.</p>
            <label htmlFor="otp">6-digit authenticator code</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,6))} style={input}/>
          </>}
        </>)}
        {!checkEmail&&<button type="submit" style={button} disabled={loading}>{loading?'Please wait…':!pending?'Continue':recovery?'Recover':'Verify & sign in'}</button>}
        {checkEmail&&<button type="button" style={button} onClick={()=>{resetLogin();setCheckEmail(false);}}>Back to sign in</button>}
        {pending&&<>
          {!pending.enrollmentToken&&!checkEmail&&<button type="button" disabled={loading} style={button} onClick={()=>{setRecovery(v=>!v);setError('');}}>Use {recovery?'authenticator':'a recovery code'}</button>}
          {!checkEmail&&<button type="button" disabled={loading} style={button} onClick={()=>{resetLogin();setError('');setToken('');setRecovery(false);}}>Back to sign in</button>}
        </>}
        <p style={{marginTop:16}}>New here? <Link to="/register" style={{color:'#c9a84c'}}>Create account</Link></p>
      </form>}
    </section>
  </main>;
}
