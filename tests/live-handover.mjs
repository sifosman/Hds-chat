import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));const base='https://hds-chat.vercel.app';const phone='27900000817';let token,conversation;const results=[];
function assert(name,ok){results.push({name,ok:!!ok});console.log(ok?'PASS':'FAIL',name);if(!ok)throw Error(name);}
async function app(p,b){const r=await fetch(base+'/api'+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'x-internal-key':env.INTERNAL_KEY},body:b?JSON.stringify(b):undefined});const j=await r.json();if(!r.ok)throw Error(p+' '+r.status);return j;}
async function cw(p,method='GET',body){const r=await fetch(env.CHATWOOT_URL+'/api/v1/accounts/1'+p,{method,headers:{'Api-Access-Token':env.CHATWOOT_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error('Chatwoot '+p+' '+r.status);return j;}
async function wait(check){for(let i=0;i<75;i++){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,3000));}throw Error('handover wait timed out');}
try {
const inv=await app('/internal/invite',{phone,channel:'handover-test'});token=(await app('/auth/invite/redeem',{token:inv.url.split('/i/')[1],platform:'test'})).token;
await app('/messages',{client_id:randomUUID().replaceAll('-',''),type:'text',body:'Hello, my name is TEST ONLY App Handover. Please connect me to a human at HDS. This is an authorised integration test, no customer order or payment required.'});
conversation=await wait(async()=>{const c=await cw('/contacts/search?q='+phone);const contact=(c.payload||[]).find(x=>String(x.phone_number).replace(/\D/g,'')===phone);if(!contact)return null;const cs=await cw('/contacts/'+contact.id+'/conversations');return (cs.payload||[]).find(x=>x.inbox_id===4&&x.status!=='resolved');});
assert('handover routed to dedicated app inbox',conversation.inbox_id===4);
const publicText='Automated integration test reply from the HDS App inbox. No customer action is needed.';
const privateText='PRIVATE TEST NOTE must never reach the customer app '+randomUUID();
await cw('/conversations/'+conversation.id+'/messages','POST',{content:privateText,message_type:'outgoing',private:true});
await cw('/conversations/'+conversation.id+'/messages','POST',{content:publicText,message_type:'outgoing',private:false});
const delivered=await wait(async()=>{const msgs=(await app('/messages?limit=200')).messages;return msgs.find(m=>m.sender==='agent'&&m.body===publicText);});
assert('real Chatwoot staff reply delivered to app',!!delivered);
assert('real private Chatwoot note hidden',!(await app('/messages?limit=200')).messages.some(m=>m.body===privateText));
await app('/messages',{client_id:randomUUID().replaceAll('-',''),type:'text',body:'Test customer reply to the human agent. Please keep the bot paused.'});
const incoming=await wait(async()=>{const msgs=await cw('/conversations/'+conversation.id+'/messages');return (msgs.payload||[]).find(m=>m.content?.includes('Test customer reply to the human agent'));});
assert('customer reply mirrored into active handover',!!incoming);
console.log('LIVE HANDOVER ALL PASS');
} catch(e){console.error(e.message);results.push({ok:false,error:e.message});process.exitCode=1;} finally {
 if(conversation)await cw('/conversations/'+conversation.id+'/toggle_status','POST',{status:'resolved'}).catch(()=>{});
 writeFileSync('scratch/live-handover-result.json',JSON.stringify({at:new Date().toISOString(),phone,conversationId:conversation?.id,results},null,2));
}
