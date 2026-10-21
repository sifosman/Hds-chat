import { describe, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({db:vi.fn()}));
vi.mock('../server/db.js',()=>({db:f.db,rateOk:vi.fn(async()=>true),event:vi.fn(),broadcast:vi.fn()}));
vi.mock('../server/push.js',()=>({pushToUser:vi.fn()}));
import {customerSend} from '../server/messages.js';
const s:any={id:'session',user:{id:'user',phone:'27900000830'}};
const ctx=(body:any):any=>({body:{client_id:'valid-client-id',...body}});
describe('customer content is never silently truncated',()=>{
 it.each(['text','image','document','interactive'])('rejects oversized %s before any database/network work',async(type)=>{
  f.db.mockClear();await expect(customerSend(ctx({type,body:'x'.repeat(4097)}),s)).rejects.toMatchObject({status:400,code:'message_too_long'});expect(f.db).not.toHaveBeenCalled();
 });
 it.each(['text','interactive'])('rejects empty %s before database/network work',async(type)=>{
  f.db.mockClear();await expect(customerSend(ctx({type,body:'   '}),s)).rejects.toMatchObject({status:400,code:'empty'});expect(f.db).not.toHaveBeenCalled();
 });
});
