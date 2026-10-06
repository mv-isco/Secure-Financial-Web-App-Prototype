import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TestFundingForm from './TestFundingForm';
import * as api from '../api/profileApi';
vi.mock('../api/profileApi',()=>({addTestFunds:vi.fn(),getFundingAttempt:vi.fn()}));
const accounts=[{id:'checking',label:'Checking',status:'active',balance:0},{id:'savings',label:'Savings',status:'active',balance:0}];
const limits={singleLimit:50000,dailyLimit:100000,balanceLimit:1000000};
const transaction={amount:19.99,category:'Test funding',reference:'FUND-one-credit'};
function show(extra={}){return render(<TestFundingForm accounts={accounts} userId="alice" limits={limits} onSuccess={()=>{}} {...extra}/>);}
afterEach(()=>{cleanup();sessionStorage.clear();localStorage.clear();vi.resetAllMocks();});
it('blocks synchronous double submissions and records the exact input amount',async()=>{
 let finish;api.addTestFunds.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const onSuccess=vi.fn();show({onSuccess});
 await userEvent.setup().type(screen.getByLabelText('Test amount (USD)'),'19.99');
 const form=screen.getByRole('button',{name:'Add test money'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);
 expect(api.addTestFunds).toHaveBeenCalledTimes(1);expect(api.addTestFunds.mock.calls[0][1].amount).toBe('19.99');
 finish({transaction});await screen.findByText(/in test money added/);expect(onSuccess).toHaveBeenCalledTimes(1);expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0);
});
it('retries with the same key and details after navigation or reload',async()=>{
 api.addTestFunds.mockRejectedValueOnce(Object.assign(new Error('Response lost'),{status:0})).mockResolvedValueOnce({transaction});
 const view=show();const user=userEvent.setup();await user.type(screen.getByLabelText('Test amount (USD)'),'19.99');await user.click(screen.getByRole('button',{name:'Add test money'}));await screen.findByText('Response lost');
 const first=api.addTestFunds.mock.calls[0];view.unmount();show();
 expect(screen.getByLabelText('Test amount (USD)').disabled).toBe(true);
 await user.click(screen.getByRole('button',{name:'Retry test top-up'}));await screen.findByText(/in test money added/);
 expect(api.addTestFunds.mock.calls[1]).toEqual(first);
});
it('recovers a result after a tab closes using only the saved opaque key',async()=>{
 const key=crypto.randomUUID();localStorage.setItem('sv:test-funding:alice:key',key);
 api.getFundingAttempt.mockResolvedValue({result:{success:true,data:{transaction}}});show();
 await userEvent.setup().click(screen.getByRole('button',{name:'Check previous top-up'}));await screen.findByText(/in test money added/);
 expect(api.getFundingAttempt).toHaveBeenCalledWith(key);expect(api.addTestFunds).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it('keeps the original key for re-entered details when the server has no result yet',async()=>{
 const key=crypto.randomUUID();localStorage.setItem('sv:test-funding:alice:key',key);
 api.getFundingAttempt.mockRejectedValue(Object.assign(new Error('No completed result yet'),{status:404}));show();
 await userEvent.setup().click(screen.getByRole('button',{name:'Check previous top-up'}));await screen.findByText('No completed result yet');
 expect(localStorage.getItem('sv:test-funding:alice:key')).toBe(key);
 api.addTestFunds.mockResolvedValue({transaction});const user=userEvent.setup();await user.type(screen.getByLabelText('Test amount (USD)'),'19.99');await user.click(screen.getByRole('button',{name:'Retry test top-up'}));await screen.findByText(/in test money added/);
 expect(api.addTestFunds.mock.calls[0][1].idempotencyKey).toBe(key);
});
it('a definitive rejection permits a new top-up with changed details',async()=>{
 api.addTestFunds.mockRejectedValueOnce(Object.assign(new Error('Daily limit'),{status:422,code:'TEST_FUNDING_REJECTED'})).mockResolvedValueOnce({transaction:{...transaction,amount:10}});
 show();const user=userEvent.setup();await user.type(screen.getByLabelText('Test amount (USD)'),'19.99');await user.click(screen.getByRole('button',{name:'Add test money'}));await screen.findByText('Daily limit');
 await user.clear(screen.getByLabelText('Test amount (USD)'));await user.type(screen.getByLabelText('Test amount (USD)'),'10.00');await user.click(screen.getByRole('button',{name:'Add test money'}));await screen.findByText(/in test money added/);
 expect(api.addTestFunds.mock.calls[1][1].idempotencyKey).not.toBe(api.addTestFunds.mock.calls[0][1].idempotencyKey);
});
it.each(['0','-1','1.005','50000.01','1e3'])('rejects invalid amounts before posting: %s',async amount=>{
 show();const user=userEvent.setup();await user.type(screen.getByLabelText('Test amount (USD)'),amount);await user.click(screen.getByRole('button',{name:'Add test money'}));
 expect(api.addTestFunds).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
});
it('never restores another user pending attempt',()=>{
 sessionStorage.setItem('sv:test-funding:bob',JSON.stringify({accountId:'savings',amount:'19.99',key:crypto.randomUUID()}));show();
 expect(screen.getByLabelText('Test amount (USD)').value).toBe('');expect(screen.queryByRole('button',{name:'Retry test top-up'})).toBeNull();
});
it('blocks a different pending intent discovered at submission',async()=>{
 show();await userEvent.setup().type(screen.getByLabelText('Test amount (USD)'),'19.99');const other=crypto.randomUUID();localStorage.setItem('sv:test-funding:alice:key',other);
 fireEvent.submit(screen.getByRole('button',{name:'Add test money'}).closest('form'));await screen.findByText('Check the previous top-up before adding more test money.');
 expect(api.addTestFunds).not.toHaveBeenCalled();expect(localStorage.getItem('sv:test-funding:alice:key')).toBe(other);
});
