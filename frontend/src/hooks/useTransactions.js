import { useState, useEffect, useCallback, useRef } from 'react';
import { getTransactions } from '../api/transactionsApi';
const PAGE_SIZE=20;
export function useTransactions(category='All') {
 const [transactions,setTransactions]=useState([]),[meta,setMeta]=useState({total:0,hasMore:false});
 const [loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState(null);
 const [refreshKey,setRefreshKey]=useState(0);
 const busy=useRef(false),generation=useRef(0),nextOffset=useRef(0);
 const refresh=useCallback(()=>setRefreshKey(k=>k+1),[]);
 useEffect(()=>{
  const current=++generation.current,controller=new AbortController();
  busy.current=true;nextOffset.current=0;setLoading(true);setLoadingMore(false);setError(null);setTransactions([]);
  getTransactions({limit:PAGE_SIZE,offset:0,...(category==='All'?{}:{category})},controller.signal).then(({data,meta:m})=>{
   if(current!==generation.current)return;
   const rows=data.transactions||[];setTransactions(rows);setMeta(m||{total:0,hasMore:false});nextOffset.current=rows.length;
  }).catch(err=>{if(current===generation.current&&!controller.signal.aborted)setError(err);})
   .finally(()=>{if(current===generation.current){busy.current=false;setLoading(false);}});
  return ()=>{generation.current=current+1;controller.abort();};
 },[refreshKey,category]);
 const loadMore=useCallback(async()=>{
  if(!meta.hasMore||busy.current)return;
  busy.current=true;setLoadingMore(true);setError(null);const current=generation.current;
  try {
   const {data,meta:m}=await getTransactions({limit:PAGE_SIZE,offset:nextOffset.current,...(category==='All'?{}:{category})});
   if(current!==generation.current)return;
   const rows=data.transactions||[];
   setTransactions(prev=>{const ids=new Set(prev.map(t=>t.id));return [...prev,...rows.filter(t=>!ids.has(t.id))];});
   setMeta(m||{total:0,hasMore:false});nextOffset.current+=rows.length;
  }catch(err){if(current===generation.current)setError(err);}
  finally{if(current===generation.current){busy.current=false;setLoadingMore(false);}}
 },[meta.hasMore,category]);
 return {transactions,meta,loading,loadingMore,error,refresh,loadMore};
}
