import { readFileSync, writeFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base='https://chat.hdsgroup.co.za'; const checks=[];
async function req(p,body,token,headers={}){const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
function ok(name,test){checks.push({name,pass:!!test});console.log(test?'PASS':'FAIL',name);if(!test)throw Error(name);}
async function login(phone){const inv=await req('/internal/invite',{phone,channel:'security-test'},null,{'x-internal-key':env.INTERNAL_KEY});const t=inv.body.url.split('/i/')[1];const [a,b]=await Promise.all([req('/auth/invite/redeem',{token:t,platform:'test'}),req('/auth/invite/redeem',{token:t,platform:'test'})]);ok('concurrent invite redemption single winner',[a,b].filter(r=>r.status===200).length===1 && [a,b].filter(r=>r.status===410).length===1);return [a,b].find(r=>r.status===200).body.token;}
try {
 ok('unauthenticated reads denied',(await req('/messages')).status===401);
 ok('synthetic OTP disabled in production',(await req('/auth/otp/start',{phone:'27900000815'})).status===400);
 const a=await login('27900000811');const b=await login('27900000812');
 const qa=(await req('/quotes',null,a)).body.quotes[0];ok('synthetic quote fixture exists',!!qa);
 ok('other user quote denied',(await req('/quotes/'+qa.quote_number,null,b)).status===404);
 const G='/wa/'+env.GATEWAY_SECRET+'/v20.0/hdsapp/messages';
 ok('wrong gateway secret denied',(await req('/wa/not-secret/v20.0/hdsapp/messages',{to:'27900000812',type:'text',text:{body:'not delivered'}})).status===404);
 ok('unknown recipient NOT forwarded to real WhatsApp',(await req(G,{to:'27900000888',type:'text',text:{body:'not delivered'}})).status===403);
 ok('foreign quote PDF blocked before delivery',(await req(G,{to:'27900000812',type:'document',document:{link:qa.pdf_url,filename:'forbidden.pdf'}})).status===403);
 ok('foreign payment link blocked before delivery',(await req(G,{to:'27900000812',type:'text',text:{body:'https://hds-nine.vercel.app/api/pay?quoteId='+encodeURIComponent(qa.quote_number)}})).status===403);
 const payload={to:'27900000812',type:'text',text:{body:'Synthetic callback deduplication check'}};
 const header={'x-hds-delivery-key':'security:'+randomUUID()};
 const pair=await Promise.all([req(G,payload,null,header),req(G,payload,null,header)]);
 ok('concurrent gateway callback stored once',pair.every(r=>r.status===200)&&pair[0].body.messages[0].id===pair[1].body.messages[0].id);
 const msgs=(await req('/messages',null,a)).body.messages;const m=msgs.find(m=>m.direction==='in' && m.client_id);
 const conflict=await req('/messages',{client_id:m.client_id,type:'text',body:'not delivered'},b);ok('cross-user client id collision denied',conflict.status===409);
 const repeat=await req('/internal/turn/claim',{wa_id:m.wa_id,phone:'27900000811',execution:'security-replay'},null,{'x-internal-key':env.INTERNAL_KEY});ok('processed turn cannot be claimed again',repeat.status===200&&repeat.body.claimed===false);
 ok('webpush SSRF endpoint rejected',(await req('/push/subscribe',{kind:'webpush',endpoint:'https://127.0.0.1/private',keys:{p256dh:'x'.repeat(87),auth:'y'.repeat(22)}},a)).status===400);
 const before=(await req('/messages',null,a)).body.messages.length;
 await req('/chatwoot/'+env.CHATWOOT_WEBHOOK_SECRET,{id:randomUUID(),event:'message_created',message_type:'outgoing',private:true,inbox:{id:4},account:{id:1},conversation:{meta:{sender:{phone_number:'+27900000811'}}},content:'must remain private'});
 ok('private Chatwoot notes not delivered',(await req('/messages',null,a)).body.messages.length===before);
 await req('/auth/logout',{all:false},b);ok('revoked session denied',(await req('/me',null,b)).status===401);
 console.log('LIVE SECURITY ALL PASS');
} catch(e){console.error(e.message);process.exitCode=1;} finally {writeFileSync('scratch/live-security-result.json',JSON.stringify({at:new Date().toISOString(),checks},null,2));}
