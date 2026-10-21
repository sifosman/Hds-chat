// Live app-only journey. Reserved test numbers, no real payment submission or customer campaign.
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {whiteUnitPrice} from './live-pricing.mjs';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>/^[A-Z_]+=/i.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base=process.argv[2]||'https://chat.hdsgroup.co.za';
const phone=process.argv[3]||'27900000831';
if(!/^2790000\d{4}$/.test(phone))throw Error('Synthetic phones only');
let token;const results=[];const turnIds=[];
function check(name,ok,detail){ results.push({name,ok,detail}); console.log(ok?'PASS':'FAIL',name,detail||''); if(!ok)throw Error(name); }
async function req(path,body,extra={}){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:body?JSON.stringify(body):undefined}); const j=await r.json(); if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(j));return j;}
async function turn(body,predicate){const old=new Set((await req('/messages?limit=200')).messages.map(m=>m.id));const t=Date.now();const client_id=randomUUID().replaceAll('-','');const sent=await req('/messages',{type:'text',body,client_id});check('server acknowledgement',!!sent.message?.id,Date.now()-t+' ms');turnIds.push(sent.message.id);const duplicate=await req('/messages',{type:'text',body,client_id});check('client retry deduplicated',duplicate.message.id===sent.message.id && duplicate.duplicate===true);
for(let n=0;n<90;n++){await new Promise(r=>setTimeout(r,3000));const fresh=(await req('/messages?limit=200')).messages.filter(m=>!old.has(m.id)&&m.direction==='out');if(fresh.some(predicate)){console.log('Reply after',Math.round((Date.now()-t)/1000),'seconds');return fresh;}}
throw Error('William reply timeout');}
try {
 const i=await req('/internal/invite',{phone,channel:'staff-test'},{'x-internal-key':env.INTERNAL_KEY});
 const invite=i.url.split('/i/')[1];
 const p=await req('/auth/invite/peek',{token:invite}); check('invite previews before redemption',p.ok);
 const auth=await req('/auth/invite/redeem',{token:invite,platform:'test'}); token=auth.token; check('invite authenticated correct test identity',auth.user.phone===phone);
 check('fresh test account required',(await req('/messages?limit=1')).messages.length===0,'Use a new reserved number: old n8n memory and in-date quotes survive data cleanup.');
 const expectedTotal=4*await whiteUnitPrice(env,phone);
 const msgs=await turn('Hi, my name is App Pilot. I need a quote for 4 full sheets of Premium White melamine 16mm. No cutting, no edging, no hardware, no delivery. I will collect at HDS Church Street in Pretoria and pay at the branch. Please generate the quote now.',m=>m.payload?.quote || /Q-20\d{6}/.test(m.body||''));
 const qs=(await req('/quotes')).quotes;const q=qs.find(q=>q.total===expectedTotal && q.status!=='superseded');
 check('same engine amount: four white sheets',!!q,qs.map(q=>q.total).join(','));
 check('quote PDF accessible from owned rich card',msgs.some(m=>m.payload?.quote?.quote_number===q.quote_number && m.payload.quote.pdf_url===q.pdf_url));
 const pdf=await fetch(q.pdf_url);check('PDF downloadable',pdf.ok);const buf=Buffer.from(await pdf.arrayBuffer());check('real PDF bytes',buf.subarray(0,4).toString()==='%PDF');
 const count=qs.length;
 await turn('Please resend my quote PDF. Nothing has changed; do not make a new quote.',m=>m.type==='document');
 check('resend does not create another quote',(await req('/quotes')).quotes.length===count);
 const answer=await turn('How many sheets are included in this quote?',m=>/\b4\b|\bfour\b/i.test(m.body||''));
 check('William answers from quote',answer.some(m=>/\b4\b|\bfour\b/i.test(m.body||'')));
 let completed=false;for(let n=0;n<10;n++){const all=(await req('/messages?limit=200')).messages;completed=turnIds.every(id=>all.find(m=>m.id===id)?.bot_status==='completed');if(completed)break;await new Promise(r=>setTimeout(r,1000));}
 check('all real workflow turns explicitly completed',completed);
 // Save only synthetic reference/evidence, never bearer or invite secrets.
 writeFileSync('scratch/live-core-result.json',JSON.stringify({base,phone,at:new Date().toISOString(),results,expectedTotal,quote:q.quote_number},null,2));
 console.log('LIVE CORE ALL PASS');
} catch(e){console.error(e.message);writeFileSync('scratch/live-core-result.json',JSON.stringify({base,phone,at:new Date().toISOString(),results,error:e.message},null,2));process.exitCode=1;}
