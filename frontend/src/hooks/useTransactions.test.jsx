import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useTransactions} from './useTransactions';
import {getTransactions} from '../api/transactionsApi';
vi.mock('../api/transactionsApi',()=>({getTransactions:vi.fn()}));
const rows=(start)=>Array.from({length:20},(_,i)=>({id:String(start+i),category:'Transfer'}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('retries a failed history page without skipping records and clears its error',async()=>{
 getTransactions.mockResolvedValueOnce({data:{transactions:rows(0)},meta:{total:60,hasMore:true}})
  .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({data:{transactions:rows(20)},meta:{total:60,hasMore:true}});
 const {result}=renderHook(()=>useTransactions());await waitFor(()=>expect(result.current.loading).toBe(false));
 await act(()=>result.current.loadMore());expect(result.current.error.message).toBe('offline');
 await act(()=>result.current.loadMore());expect(result.current.error).toBeNull();expect(result.current.transactions).toHaveLength(40);
 expect(getTransactions.mock.calls.map(([p])=>p.offset)).toEqual([0,20,20]);
});
it('blocks two immediate load requests before React rerenders',async()=>{
 getTransactions.mockResolvedValueOnce({data:{transactions:rows(0)},meta:{total:60,hasMore:true}});
 let finish;getTransactions.mockImplementation(()=>new Promise(r=>{finish=r;}));
 const {result}=renderHook(()=>useTransactions());await waitFor(()=>expect(result.current.loading).toBe(false));
 let pending;act(()=>{pending=result.current.loadMore();result.current.loadMore();});expect(getTransactions).toHaveBeenCalledTimes(2);
 await act(async()=>{finish({data:{transactions:rows(20)},meta:{total:60,hasMore:true}});await pending;});expect(result.current.transactions).toHaveLength(40);
});
it('filters the complete history on the server and resets pagination when the category changes',async()=>{
 getTransactions.mockResolvedValue({data:{transactions:rows(0)},meta:{total:20,hasMore:false}});
 const {result,rerender}=renderHook(({category})=>useTransactions(category),{initialProps:{category:'All'}});
 await waitFor(()=>expect(result.current.loading).toBe(false));rerender({category:'Transfer'});
 await waitFor(()=>expect(getTransactions.mock.calls.at(-1)[0]).toEqual({limit:20,offset:0,category:'Transfer'}));
});
