/**
 * DashboardPage
 * Wires the live API hooks (useAccounts, useTransactions) into the
 * dashboard UI. Shows loading skeletons and handles errors gracefully.
 */

import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth }         from '../context/AuthContext';
import { useAccounts }     from '../hooks/useAccounts';
import { useTransactions } from '../hooks/useTransactions';
import TransferForm from '../components/TransferForm';
import ProfilePage from './ProfilePage';
import { fmt, fmtDate } from '../utils/format';

const NAV = [
  {id:'dashboard',label:'Dashboard',icon:'▦'},
  {id:'transfer', label:'Transfer', icon:'⇄'},
  {id:'history',  label:'History',  icon:'≡'},
  {id:'profile',  label:'Profile',  icon:'○'},
];

const ACCT_COLORS = {checking:'#34d399',savings:'#60a5fa',investment:'#c4b5fd'};

/* ── Skeleton loader ── */
function Skeleton({w='100%',h=16,radius=6,mb=0}) {
  return <div style={{width:w,height:h,borderRadius:radius,background:'rgba(148,163,184,0.08)',marginBottom:mb,animation:'shimmer 1.4s ease infinite',backgroundImage:'linear-gradient(90deg,rgba(148,163,184,0.06) 25%,rgba(148,163,184,0.12) 50%,rgba(148,163,184,0.06) 75%)',backgroundSize:'200% 100%'}}/>;
}

/* ── Account card ── */
function AccountCard({acct, active, onClick}) {
  const color = ACCT_COLORS[acct.type] || '#1a8a5e';
  return (
    <button onClick={onClick} style={{all:'unset',cursor:'pointer',display:'block',width:'100%',boxSizing:'border-box',minWidth:0,background:active?'linear-gradient(135deg,#0f172a,#1e2d3d)':'rgba(15,23,42,0.5)',border:`1px solid ${active?color+'55':'rgba(148,163,184,0.09)'}`,borderRadius:14,padding:'1rem',position:'relative',overflow:'hidden',textAlign:'left',transition:'all 0.2s'}}>
      {active && <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${color},transparent)`}}/>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'0.65rem'}}>
        <div>
          <p style={{fontSize:10,letterSpacing:'0.09em',textTransform:'uppercase',color:active?color:'#94a3b8',fontWeight:600,marginBottom:2}}>{acct.label}</p>
          <p style={{fontSize:9.5,color:'#94a3b8',fontFamily:'monospace'}}>{acct.accountNumber}</p>
        </div>
        <span style={{fontSize:9.5,background:color+'20',color,borderRadius:20,padding:'2px 7px',fontWeight:600,letterSpacing:'0.05em',textTransform:'uppercase'}}>{acct.type}</span>
      </div>
      <p style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:19,color:'#f1f5f9',letterSpacing:'-0.01em'}}>{fmt(acct.balance)}</p>
    </button>
  );
}

/* ── Transaction row ── */
function TxRow({tx,delay=0}) {
  const pos = tx.type==='credit';
  const icons = {Income:'💼',Transfer:'↗',Groceries:'🛒',Subscriptions:'📺',Investment:'📈',Utilities:'☁️',Dining:'🍔',Travel:'✈️',Interest:'🏦'};
  return (
    <div style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.65rem 0',borderBottom:'1px solid rgba(148,163,184,0.05)',animation:'fadeUp 0.25s ease both',animationDelay:`${delay}ms`}}>
      <div style={{width:35,height:35,borderRadius:9,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,background:pos?'rgba(26,138,94,0.1)':'rgba(148,163,184,0.06)'}}>
        {icons[tx.category]||'💳'}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <p style={{fontSize:13,color:'#e2e8f0',fontWeight:500,marginBottom:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{tx.description}</p>
        <p style={{fontSize:10.5,color:'#94a3b8'}}>{tx.category} · {fmtDate(tx.createdAt)}</p>
      </div>
      <span style={{fontSize:13,fontWeight:600,fontFamily:'monospace',color:pos?'#34d399':'#94a3b8',flexShrink:0}}>
        {pos?'+':''}{fmt(pos?tx.amount:-tx.amount)}
      </span>
    </div>
  );
}

/* ── Transfer form ── */
export default function DashboardPage() {
  const { user, logout }               = useAuth();
  const { accounts, totalBalance, loading:acctLoading, error:acctError, refresh:refreshAccts, updatedAt } = useAccounts();
  const [txFilter,   setTxFilter]   = useState('All');
  const { transactions, loading:txLoading, error:txError, refresh:refreshTx, meta:txMeta, loadMore, loadingMore } = useTransactions(txFilter);
  const location=useLocation(),navigate=useNavigate();
  const [section,setSection]=useState('dashboard');
  const activeNav=location.pathname==='/profile'?'profile':section;
  const setActiveNav=id=>{if(id==='profile')navigate('/profile');else{setSection(id);navigate('/dashboard');}};
  const [activeAcct, setActiveAcct] = useState(null);
  const [sidebarOpen,setSidebarOpen]= useState(true);

  const selAcct = accounts.find(a=>a.id===activeAcct) || accounts[0];
  const cats    = ['All','Transfer','Income',...new Set(transactions.map(t=>t.category).filter(Boolean))].filter((c,i,a)=>a.indexOf(c)===i);
  const filteredTx = txFilter==='All'?transactions:transactions.filter(t=>t.category===txFilter);

  const handleTransferSuccess = () => { refreshAccts(); refreshTx(); };

  return (
    <>
      <div style={{display:'flex',minHeight:'100vh',background:'#060d18',fontFamily:"'DM Sans',system-ui,sans-serif",color:'#e2e8f0'}}>

        {/* Sidebar */}
        <aside className="vault-sidebar" style={{width:sidebarOpen?216:64,flexShrink:0,background:'rgba(8,14,24,0.98)',borderRight:'1px solid rgba(148,163,184,0.07)',display:'flex',flexDirection:'column',transition:'width 0.25s ease',overflow:'hidden'}}>
          <div style={{padding:'1.25rem 0.9rem',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgba(148,163,184,0.06)',flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#1a8a5e,#0d6346)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,flexShrink:0}}>⬡</div>
            {sidebarOpen&&<span className="sidebar-label" style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:17,color:'#f1f5f9',letterSpacing:'0.02em',whiteSpace:'nowrap'}}>SecureVault</span>}
          </div>
          <nav style={{flex:1,padding:'0.75rem 0.4rem',display:'flex',flexDirection:'column',gap:2}}>
            {NAV.map(n=>{
              const active=activeNav===n.id;
              return <button key={n.id} aria-label={n.label} aria-current={active?'page':undefined} title={n.label} onClick={()=>setActiveNav(n.id)} style={{all:'unset',cursor:'pointer',display:'flex',alignItems:'center',gap:10,padding:'0.6rem 0.7rem',borderRadius:9,background:active?'rgba(26,138,94,0.12)':'transparent',transition:'background 0.15s',whiteSpace:'nowrap'}}>
                <span style={{width:20,fontSize:14,color:active?'#34d399':'#94a3b8',flexShrink:0,textAlign:'center'}}>{n.icon}</span>
                {sidebarOpen&&<span className="sidebar-label" style={{fontSize:13,color:active?'#e2e8f0':'#94a3b8',fontWeight:active?500:400}}>{n.label}</span>}
                {active&&sidebarOpen&&<div style={{marginLeft:'auto',width:5,height:5,borderRadius:'50%',background:'#1a8a5e'}}/>}
              </button>;
            })}
          </nav>
          <div style={{padding:'0.85rem 0.75rem',borderTop:'1px solid rgba(148,163,184,0.06)',display:'flex',flexWrap:'wrap',alignItems:'center',gap:10,flexShrink:0}}>
            <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(26,138,94,0.12)',border:'1px solid rgba(26,138,94,0.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#34d399',fontWeight:600,flexShrink:0}}>
              {(user?.name||'U').split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase()}
            </div>
            {sidebarOpen&&<div className="sidebar-label" style={{minWidth:0,flex:1}}>
              <div style={{fontSize:12.5,color:'#e2e8f0',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user?.name||'User'}</div>
            </div>}
            <button aria-label="Sign out" title="Sign out" onClick={logout} style={{all:'unset',cursor:'pointer',fontSize:12,color:'#94a3b8'}}>{sidebarOpen?<span className="sidebar-label">Sign out</span>:null}<span className={sidebarOpen?'mobile-signout':''} aria-hidden="true">↪</span></button>
          </div>
        </aside>

        {/* Main */}
        <main style={{flex:1,overflow:'auto',minWidth:0,display:'flex',flexDirection:'column'}}>
          {/* Topbar */}
          <header style={{padding:'0.9rem 1.5rem',display:'flex',alignItems:'center',borderBottom:'1px solid rgba(148,163,184,0.06)',background:'rgba(6,13,24,0.95)',position:'sticky',top:0,zIndex:5,flexShrink:0}}>
            <button aria-label="Toggle navigation" aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(v=>!v)} style={{all:'unset',cursor:'pointer',fontSize:17,color:'#94a3b8',marginRight:'0.85rem'}}>☰</button>
            <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:19,color:'#f1f5f9',fontWeight:400}}>{NAV.find(n=>n.id===activeNav)?.label}</span>
            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:'0.6rem'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,background:'rgba(26,138,94,0.08)',border:'1px solid rgba(26,138,94,0.18)',borderRadius:20,padding:'4px 11px'}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'#34d399'}}/>
                <span style={{fontSize:10.5,color:'#34d399',letterSpacing:'0.06em',fontWeight:600}}>SECURE SESSION</span>
              </div>
            </div>
          </header>

          <div className="vault-content" style={{padding:'1.5rem',flex:1,overflow:'auto',minWidth:0}}>
            {activeNav==='profile'&&<ProfilePage accounts={accounts} accountsLoading={acctLoading} accountsError={acctError} retryAccounts={refreshAccts} onFundsAdded={handleTransferSuccess}/>}

            {/* ── Dashboard ── */}
            {activeNav==='dashboard'&&(
              <div style={{animation:'fadeUp 0.3s ease'}}>
                {/* Net worth banner */}
                <div style={{background:'linear-gradient(135deg,#0a1628 0%,#0f2540 50%,#0a1f35 100%)',border:'1px solid rgba(26,138,94,0.14)',borderRadius:16,padding:'1.5rem',marginBottom:'1.25rem',position:'relative',overflow:'hidden'}}>
                  <div style={{position:'absolute',top:-60,right:-60,width:180,height:180,borderRadius:'50%',background:'radial-gradient(circle,rgba(26,138,94,0.06) 0%,transparent 70%)'}}/>
                  <p style={{fontSize:10.5,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:600,marginBottom:7}}>Total net worth</p>
                  {acctLoading ? <Skeleton h={44} w={220} mb={8}/> : <p style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:36,color:'#f1f5f9',letterSpacing:'-0.02em',marginBottom:7}}>{fmt(totalBalance)}</p>}
                  <span style={{fontSize:11.5,color:'#94a3b8'}}>Last updated: {updatedAt?updatedAt.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Not loaded'}</span>
                </div>

                {/* Account cards */}
                {acctError&&<div role="alert" style={{background:'rgba(220,50,50,0.08)',border:'1px solid rgba(220,50,50,0.2)',borderRadius:10,padding:'0.75rem 1rem',color:'#ef8585',fontSize:13,marginBottom:'1rem'}}>Failed to load accounts: {acctError.message} <button onClick={refreshAccts}>Retry accounts</button></div>}
                <div className="account-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16,marginBottom:'1.25rem',minWidth:0}}>
                  {acctLoading ? [1,2,3].map(i=><div key={i} style={{background:'rgba(15,23,42,0.5)',borderRadius:14,padding:'1rem'}}><Skeleton h={12} w='60%' mb={8}/><Skeleton h={24} w='80%' mb={10}/><Skeleton h={32}/></div>)
                    : accounts.map(a=><AccountCard key={a.id} acct={a} active={selAcct?.id===a.id} onClick={()=>setActiveAcct(a.id)}/>)}
                </div>

                {/* Quick actions */}
                <div style={{display:'flex',gap:8,marginBottom:'1.25rem',flexWrap:'wrap'}}>
                  {[{l:'Transfer',i:'⇄',v:'transfer'},{l:'History',i:'≡',v:'history'}].map(q=>(
                    <button key={q.l} onClick={()=>setActiveNav(q.v)} style={{all:'unset',cursor:'pointer',display:'flex',alignItems:'center',gap:7,padding:'0.5rem 0.9rem',borderRadius:9,background:'rgba(15,23,42,0.6)',border:'1px solid rgba(148,163,184,0.09)',fontSize:12.5,color:'#94a3b8',transition:'all 0.15s'}}>
                      {q.i} {q.l}
                    </button>
                  ))}
                </div>

                {/* Two-column grid */}
                <div className="dashboard-grid" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 290px',gap:'1rem'}}>
                  <div style={{background:'rgba(10,16,26,0.7)',border:'1px solid rgba(148,163,184,0.07)',borderRadius:14,padding:'1.1rem'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.9rem'}}>
                      <span style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:17,color:'#e2e8f0'}}>Recent Activity</span>
                      <button onClick={()=>setActiveNav('history')} style={{all:'unset',cursor:'pointer',fontSize:12,color:'#1a8a5e'}}>View all →</button>
                    </div>
                    {txError&&<p role="alert">Could not load transactions. <button onClick={refreshTx}>Retry history</button></p>}
                    {!txLoading&&!txError&&!transactions.length&&<p>No transactions yet.</p>}
                    {txLoading ? [1,2,3,4].map(i=><div key={i} style={{display:'flex',gap:12,padding:'0.65rem 0',borderBottom:'1px solid rgba(148,163,184,0.05)'}}><Skeleton h={35} w={35} radius={9}/><div style={{flex:1}}><Skeleton h={13} mb={6}/><Skeleton h={10} w='40%'/></div><Skeleton h={13} w={60}/></div>)
                      : transactions.slice(0,6).map((tx,i)=><TxRow key={tx.id} tx={tx} delay={i*40}/>)}
                  </div>
                  <div style={{background:'rgba(10,16,26,0.7)',border:'1px solid rgba(148,163,184,0.07)',borderRadius:14,padding:'1.1rem'}}>
                    <p style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:17,color:'#e2e8f0',marginBottom:'1rem'}}>Your Accounts</p>
                    {acctLoading ? [1,2].map(i=><Skeleton key={i} h={40} mb={10} radius={10}/>) : accounts.map(a=>{
                      const c=ACCT_COLORS[a.type]||'#1a8a5e';
                      return <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.6rem 0.75rem',borderRadius:9,background:'rgba(15,23,42,0.5)',marginBottom:7,border:'1px solid rgba(148,163,184,0.07)'}}>
                        <div><p style={{fontSize:12,fontWeight:500,color:'#e2e8f0',marginBottom:2}}>{a.label}</p><p style={{fontSize:10,color:'#94a3b8',fontFamily:'monospace'}}>{a.accountNumber}</p></div>
                        <span style={{fontSize:13,fontFamily:'monospace',fontWeight:600,color:c}}>{fmt(a.balance)}</span>
                      </div>;
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Transfer ── */}
            {activeNav==='transfer'&&(
              <div style={{maxWidth:560,margin:'0 auto',animation:'fadeUp 0.3s ease'}}>
                <div className="transfer-panel" style={{background:'rgba(10,16,26,0.8)',border:'1px solid rgba(148,163,184,0.09)',borderRadius:16,padding:'1.75rem',marginBottom:'1rem'}}>
                  <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:'1.5rem'}}>
                    <div style={{width:36,height:36,borderRadius:9,background:'rgba(26,138,94,0.12)',border:'1px solid rgba(26,138,94,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⇄</div>
                    <div>
                      <div style={{fontFamily:"'Instrument Serif',Georgia,serif",fontSize:19,color:'#f1f5f9'}}>Fund Transfer</div>
                      <div style={{fontSize:11.5,color:'#94a3b8'}}>Fresh authenticator code required</div>
                    </div>
                  </div>
                  {acctLoading && !accounts.length ? <Skeleton h={200}/> : acctError&&!accounts.length?<p role="alert">Accounts unavailable. <button onClick={refreshAccts}>Retry accounts</button></p>:<TransferForm accounts={accounts} userId={user.id} onSuccess={handleTransferSuccess}/>}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  {[['✓','Authenticator','Fresh code required'],['↻','Retry protection','One transfer per request'],['$','Transfer limits','Rolling 24-hour limit'],['≡','Audit trail','Recorded with each transfer']].map(([icon,title,sub])=>(
                    <div key={title} style={{background:'rgba(10,16,26,0.5)',border:'1px solid rgba(148,163,184,0.06)',borderRadius:9,padding:'0.7rem',display:'flex',gap:8}}>
                      <span style={{fontSize:14}}>{icon}</span>
                      <div><p style={{fontSize:11.5,color:'#94a3b8',fontWeight:500}}>{title}</p><p style={{fontSize:10.5,color:'#94a3b8'}}>{sub}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── History ── */}
            {activeNav==='history'&&(
              <div style={{animation:'fadeUp 0.3s ease'}}>
                {txError && <p role="alert">Could not load transactions: {txError.message} {!txMeta.hasMore&&<button onClick={refreshTx}>Retry history</button>}</p>}
                <div style={{display:'flex',gap:7,marginBottom:'1rem',flexWrap:'wrap'}}>
                  {cats.map(c=>(
                    <button key={c} onClick={()=>setTxFilter(c)} style={{all:'unset',cursor:'pointer',fontSize:12,padding:'4px 12px',borderRadius:20,border:`1px solid ${txFilter===c?'rgba(26,138,94,0.3)':'rgba(148,163,184,0.09)'}`,background:txFilter===c?'rgba(26,138,94,0.12)':'rgba(15,23,42,0.6)',color:txFilter===c?'#34d399':'#64748b',transition:'all 0.15s'}}>{c}</button>
                  ))}
                </div>
                <div style={{background:'rgba(10,16,26,0.7)',border:'1px solid rgba(148,163,184,0.07)',borderRadius:14,padding:'1.1rem'}}>
                  {txLoading ? [1,2,3,4,5].map(i=><div key={i} style={{display:'flex',gap:12,padding:'0.65rem 0',borderBottom:'1px solid rgba(148,163,184,0.05)'}}><Skeleton h={35} w={35} radius={9}/><div style={{flex:1}}><Skeleton h={13} mb={6}/><Skeleton h={10} w='40%'/></div><Skeleton h={13} w={60}/></div>)
                    : filteredTx.length ? filteredTx.map((tx,i)=><TxRow key={tx.id} tx={tx} delay={i*25}/>)
                    : <p style={{textAlign:'center',color:'#94a3b8',padding:'2rem',fontSize:13}}>No transactions in this category.</p>}
                  {txMeta.hasMore && <button onClick={loadMore} disabled={loadingMore}>Load more transactions</button>}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
