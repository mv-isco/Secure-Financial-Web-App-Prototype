import { expect,it,vi } from 'vitest';
import {transfer} from './transactionsApi';
import client from './client';
vi.mock('./client',()=>({default:{post:vi.fn()}}));
it('passes the caller retry key unchanged',async()=>{
 client.post.mockResolvedValue({data:{data:{transaction:{reference:'TXN'}}}});
 const payload={idempotencyKey:'stable',amount:'19.99',token:'123456'};
 await transfer(payload);await transfer(payload);
 expect(client.post.mock.calls[0][1]).toBe(payload);expect(client.post.mock.calls[1][1].idempotencyKey).toBe('stable');
});
it('requires a retry key rather than creating one per request',async()=>{await expect(transfer({amount:'19.99'})).rejects.toThrow('stable');});
