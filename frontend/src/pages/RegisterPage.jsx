import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
const input={width:'100%',padding:12,margin:'6px 0 16px',borderRadius:8,background:'#161b22',border:'1px solid #544624',color:'#fff',fontSize:16};
const button={width:'100%',padding:12,borderRadius:8,border:0,background:'#c9a84c',color:'#0d1117',cursor:'pointer',margin:'8px 0'};
export default function RegisterPage(){
 const {register,setup2FA,claimRegistration}=useAuth(),navigate=useNavigate();
 const [search]=useSearchParams();const ticket=search.get('ticket');
 const [step,setStep]=useState(ticket?5:1),[form,setForm]=useState({name:'',email:'',password:'',confirm:''});
 const [enrollment,setEnrollment]=useState(null),[token,setToken]=useState(''),[codes,setCodes]=useState([]);
 const [error,setError]=useState(''),[loading,setLoading]=useState(false);
 const busy=useRef(false);
 const submit=async e=>{
  e.preventDefault();if(busy.current)return;busy.current=true;setError('');setLoading(true);
  try{
   if(step===1){
    if(form.password!==form.confirm)throw new Error('Passwords do not match.');
    await register({name:form.name,email:form.email,password:form.password});
    setForm({...form,password:'',confirm:''});setStep(4);
   }else if(step===5){
    const data=await claimRegistration({ticket,password:form.password});
    setForm({...form,password:''});
    if(data.alreadyRegistered){navigate('/login',{replace:true});return;}
    setEnrollment(data.twoFactor);setStep(2);navigate('/register',{replace:true});
   }else{
    const data=await setup2FA({token});setCodes(data.recoveryCodes);setEnrollment(null);setToken('');setStep(3);
   }
  }catch(err){setError(err.message);}finally{busy.current=false;setLoading(false);}
 };
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#080a0e',fontFamily:'system-ui'}}>
  <section style={{width:'100%',maxWidth:440,padding:'2rem',borderRadius:16,background:'#0d1117',border:'1px solid #544624',color:'#e8dfc0'}}>
   <h1 style={{marginBottom:16}}>SecureVault</h1>
   <h2 style={{marginBottom:12}}>{step===1?'Create account':step===2?'Set up authenticator':step===4?'Check your email':step===5?'Confirm your verification link':'Save recovery codes'}</h2>
   {error&&<p role="alert" style={{color:'#ef8585',margin:'12px 0'}}>{error}</p>}
   {step<3||step===5?<form onSubmit={submit}>
    {step===5?<>
     <p style={{marginBottom:12}}>Enter the password you chose when requesting this link. If you did not request it, return to sign in without continuing.</p>
     <label htmlFor="proof-password">Password</label><input id="proof-password" type="password" autoComplete="current-password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} style={input}/>
    </>:step===1?<>
     {[['name','Full name','text','name'],['email','Email address','email','username'],['password','Password','password','new-password'],['confirm','Confirm password','password','new-password']].map(([key,label,type,autoComplete])=><div key={key}>
      <label htmlFor={key}>{label}</label><input id={key} required type={type} autoComplete={autoComplete} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} style={input}/>
     </div>)}
     <p style={{fontSize:12,marginBottom:12}}>Use at least 8 characters, an uppercase letter, a digit and a symbol. Accounts start with a zero balance.</p>
    </>:<>
     <p style={{marginBottom:16}}>Scan this code with your authenticator app.</p>
     <QRCodeSVG value={enrollment.otpAuthUrl} size={176} bgColor="#fff" style={{padding:12,background:'#fff'}} title="Authenticator enrollment QR code"/>
     <p style={{margin:'16px 0'}}>Manual setup key: <code style={{wordBreak:'break-all'}}>{enrollment.secret}</code></p>
     <label htmlFor="otp">6-digit authenticator code</label><input id="otp" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={token} onChange={e=>setToken(e.target.value.replace(/\D/g,'').slice(0,6))} style={input}/>
    </>}
    <button style={button} disabled={loading}>{loading?'Please wait…':step===5?'Verify email & continue':step===1?'Continue':'Activate authenticator'}</button>
   </form>:step===4?<>
    <p style={{margin:'12px 0'}}>Open the verification link in your email to continue. The link expires in 30 minutes.</p>
    <p style={{margin:'12px 0'}}>If you already have an account, <Link to="/login" style={{color:'#c9a84c'}}>sign in</Link>.</p>
   </>:<>
    <p style={{margin:'12px 0'}}>Keep these offline. Each code works once with your password if you lose your authenticator.</p>
    <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-all',fontSize:12}}>{codes.join('\n')}</pre>
    <p style={{margin:'12px 0'}}>Your checking and savings accounts are ready.</p>
    <button style={button} onClick={()=>{setCodes([]);navigate('/dashboard',{replace:true});}}>I saved my codes. Continue</button>
   </>}
   {(step<3||step===5)&&<p style={{marginTop:16}}>Already have an account? <Link to="/login" style={{color:'#c9a84c'}}>Sign in</Link></p>}
  </section>
 </main>;
}
