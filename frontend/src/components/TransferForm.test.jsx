import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferForm from './TransferForm';
import * as api from '../api/transactionsApi';
vi.mock('../api/transactionsApi', () => ({ transfer:vi.fn(), confirmRecipient:vi.fn(),getTransferAttempt:vi.fn() }));
const accounts=[{id:'source',label:'Checking',balance:1000,status:'active'}];
async function review(){
 const user=userEvent.setup();
 await user.type(screen.getByLabelText('Recipient account number'),'123456789012');
 await user.type(screen.getByLabelText('Amount (USD)'),'19.99');
 await user.click(screen.getByRole('button',{name:'Review transfer'}));
 await screen.findByText(/Bob S/);
 await user.type(screen.getByLabelText('Fresh authenticator code'),'123456');
 return user;
}
afterEach(()=>{cleanup();sessionStorage.clear();localStorage.clear();vi.resetAllMocks();});
describe('Transfer authorization and stable retries',()=>{
 it('recovers a completed payment after the tab data is lost using only an opaque persistent key',async()=>{
  const key=crypto.randomUUID();localStorage.setItem('sv:transfer:alice:key',key);
  api.getTransferAttempt.mockResolvedValue({status:201,result:{success:true,data:{transaction:{amount:19.99,reference:'RECOVERED',toAccount:'****9012'}}}});
  render(<TransferForm accounts={accounts} userId="alice" onSuccess={()=>{}}/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Check previous transfer'}));await screen.findByText('Transfer completed');
  expect(api.transfer).not.toHaveBeenCalled();expect(api.getTransferAttempt).toHaveBeenCalledWith(key);expect(localStorage.getItem('sv:transfer:alice:key')).toBeNull();
 });
 it('a missing result never resets the original key or silently starts another payment',async()=>{
  const key=crypto.randomUUID();localStorage.setItem('sv:transfer:source:key',key);
  api.getTransferAttempt.mockRejectedValue(Object.assign(new Error('Still unconfirmed'),{status:404}));
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});api.transfer.mockResolvedValue({transaction:{amount:19.99,reference:'SAME-INTENT'}});
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);
  await userEvent.setup().click(screen.getByRole('button',{name:'Check previous transfer'}));await screen.findByText('Still unconfirmed');
  const user=await review();await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Transfer completed');
  expect(api.transfer.mock.calls[0][0].idempotencyKey).toBe(key);
 });
 it('blocks another pending transfer discovered after the review step',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);const user=await review();
  const other=crypto.randomUUID();localStorage.setItem('sv:transfer:source:key',other);
  await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Confirm the earlier transfer before sending another.');
  expect(api.transfer).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Back'}).disabled).toBe(true);
 });
 it('preserves the retry key and details after unmounting and remounting',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});
  api.transfer.mockRejectedValueOnce(Object.assign(new Error('Lost response'),{status:0})).mockResolvedValueOnce({transaction:{amount:19.99,reference:'ONE-DEBIT'}});
  const view=render(<TransferForm accounts={accounts} userId="alice" onSuccess={()=>{}}/>),user=await review();
  await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Lost response');
  const original=api.transfer.mock.calls[0][0];view.unmount();
  render(<TransferForm accounts={accounts} userId="alice" onSuccess={()=>{}}/>);
  expect(screen.getByRole('button',{name:'Back'}).disabled).toBe(true);
  await user.type(screen.getByLabelText('Fresh authenticator code'),'654321');await user.click(screen.getByRole('button',{name:'Retry transfer'}));
  await screen.findByText('Transfer completed');expect(api.transfer.mock.calls[1][0]).toEqual({...original,token:'654321'});expect(sessionStorage.getItem('sv:transfer:alice')).toBeNull();
 });
 it('never restores another user pending transfer',()=>{
  sessionStorage.setItem('sv:transfer:alice',JSON.stringify({fromId:'source',to:'123456789012',amount:'19.99',note:'',key:crypto.randomUUID(),recipient:{displayName:'Bob S.',readyAt:0}}));
  render(<TransferForm accounts={accounts} userId="bob" onSuccess={()=>{}}/>);
  expect(screen.getByLabelText('Amount (USD)').value).toBe('');expect(screen.queryByRole('button',{name:'Retry transfer'})).toBeNull();
 });
 it('a rejected transfer can go back and authorize changed details',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});
  api.transfer.mockRejectedValueOnce(Object.assign(new Error('Insufficient funds'),{status:422,code:'TRANSFER_REJECTED'})).mockResolvedValueOnce({transaction:{amount:10,reference:'CHANGED'}});
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);const user=await review();
  await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Insufficient funds');
  await user.click(screen.getByRole('button',{name:'Back'}));await user.clear(screen.getByLabelText('Amount (USD)'));await user.type(screen.getByLabelText('Amount (USD)'),'10.00');
  await user.click(screen.getByRole('button',{name:'Review transfer'}));expect(screen.getByRole('button',{name:'Authorize & send'}).disabled).toBe(false);
  await user.type(screen.getByLabelText('Fresh authenticator code'),'654321');await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Transfer completed');
  expect(api.transfer.mock.calls[1][0].idempotencyKey).not.toBe(api.transfer.mock.calls[0][0].idempotencyKey);
 });
 it('unlocks automatically when recipient cooling off ends',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:Date.now()+60000});
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);await review();
  expect(screen.getByRole('button',{name:'Authorize & send'}).disabled).toBe(true);
  const future=Date.now()+61000,clock=vi.spyOn(Date,'now').mockReturnValue(future);
  try{await waitFor(()=>expect(screen.getByRole('button',{name:'Authorize & send'}).disabled).toBe(false),{timeout:2500});}finally{clock.mockRestore();}
 });
 it('uses one idempotency key for retries after an unknown network result',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});
  api.transfer.mockRejectedValueOnce(Object.assign(new Error('Network unavailable'),{status:0}))
   .mockResolvedValueOnce({transaction:{amount:19.99,reference:'TXN-1'}});
  const onSuccess=vi.fn();render(<TransferForm accounts={accounts} onSuccess={onSuccess}/>);
  const user=await review();await user.click(screen.getByRole('button',{name:'Authorize & send'}));
  await screen.findByText('Network unavailable');
  expect(screen.getByRole('button',{name:'Back'}).disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Retry transfer'}));
  await screen.findByText('Transfer completed');
  expect(api.transfer).toHaveBeenCalledTimes(2);
  expect(api.transfer.mock.calls[0][0].idempotencyKey).toBe(api.transfer.mock.calls[1][0].idempotencyKey);
  expect(api.transfer.mock.calls[0][0].amount).toBe('19.99');expect(api.transfer.mock.calls[0][0].token).toBe('123456');
  expect(onSuccess).toHaveBeenCalledTimes(1);
 });
 it('blocks double submissions before React updates the loading state',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});
  let resolve;api.transfer.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);await review();
  const form=screen.getByRole('button',{name:'Authorize & send'}).closest('form');
  fireEvent.submit(form);fireEvent.submit(form);
  expect(api.transfer).toHaveBeenCalledTimes(1);
  resolve({transaction:{amount:19.99,reference:'TXN-2'}});await screen.findByText('Transfer completed');
 });
 it('keeps the key when going back to review the same details',async()=>{
  api.confirmRecipient.mockResolvedValue({displayName:'Bob S.',readyAt:0});
  api.transfer.mockRejectedValue(Object.assign(new Error('Use a fresh code'),{status:422}));
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);const user=await review();
  await user.click(screen.getByRole('button',{name:'Authorize & send'}));await screen.findByText('Use a fresh code');
  const first=api.transfer.mock.calls[0][0].idempotencyKey;
  await user.click(screen.getByRole('button',{name:'Back'}));await user.click(screen.getByRole('button',{name:'Review transfer'}));
  await user.type(screen.getByLabelText('Fresh authenticator code'),'654321');await user.click(screen.getByRole('button',{name:'Authorize & send'}));
  await waitFor(()=>expect(api.transfer).toHaveBeenCalledTimes(2));expect(api.transfer.mock.calls[1][0].idempotencyKey).toBe(first);
 });
 it('does not send an invalid amount or unconfirmed recipient',async()=>{
  render(<TransferForm accounts={accounts} onSuccess={()=>{}}/>);const user=userEvent.setup();
  await user.type(screen.getByLabelText('Recipient account number'),'123456789012');await user.type(screen.getByLabelText('Amount (USD)'),'1.005');
  await user.click(screen.getByRole('button',{name:'Review transfer'}));expect(api.confirmRecipient).not.toHaveBeenCalled();expect(api.transfer).not.toHaveBeenCalled();
 });
});
