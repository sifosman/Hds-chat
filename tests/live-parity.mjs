// Compare a fresh app quote with the existing WhatsApp TEST clone, never the live WA webhook.
import {readFileSync,writeFileSync} from 'node:fs';
import {buildTextPayload} from '../../Chatbot Tests/harness/payload.js';
import {whiteUnitPrice} from './live-pricing.mjs';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const phone=process.argv[2]||'27900000832', appPhone=process.argv[3]||'27900000831';
if(![phone,appPhone].every(p=>/^2790000\d{4}$/.test(p))) throw Error('Synthetic phones only');
const headers={apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY};
const sb=async p=>{const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+p,{headers});if(!r.ok)throw Error('Supabase '+r.status);return r.json()};
const text='Hi, my name is App Pilot. I need a quote for 4 full sheets of Premium White melamine 16mm. No cutting, no edging, no hardware, no delivery. I will collect at HDS Church Street in Pretoria and pay at the branch. Please generate the quote now.';
try {
 const old=await sb('ai_conversations?phone_number=eq.'+phone+'&select=id&limit=1');
 if(old.length)throw Error('Use a fresh reserved test phone; n8n memory persists');
 const expectedTotal=4*await whiteUnitPrice(env,phone);
 const payload=buildTextPayload({phoneNumber:phone,senderName:'TEST ONLY App Parity',messageText:text,wabaId:'hds-test',displayPhoneNumber:'27787060895',phoneNumberId:'732486796615007'});
 const r=await fetch('https://n8n.owdsolutions.co.za/webhook/hds-whatsapp-test-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!r.ok)throw Error('Clone webhook '+r.status);
 let done=false;
 for(let n=0;n<90;n++) {
  await new Promise(r=>setTimeout(r,3000));
  const q=await sb('quotes?customer_phone=eq.'+phone+'&select=quote_number,total,branch_trading_as&order=created_at.desc&limit=1');
  const replies=await sb('ai_conversations?phone_number=eq.'+phone+'&role=eq.assistant&select=message_text&order=created_at.desc&limit=1');
  if(q.length&&replies.length) {
   const app=await sb('quotes?customer_phone=eq.'+appPhone+'&select=quote_number,total,branch_trading_as&order=created_at.desc&limit=1');
   const out={at:new Date().toISOString(),scenario:'four full Premium White sheets; no cutting/edging; Church Street; pay at branch',phone,appPhone,expectedTotal,appTotal:Number(app[0]?.total),cloneTotal:Number(q[0].total),appBranch:app[0]?.branch_trading_as,cloneBranch:q[0].branch_trading_as,cloneQuote:q[0].quote_number,reply:replies[0].message_text};
   out.pass=out.appTotal===expectedTotal&&out.cloneTotal===expectedTotal&&out.appBranch===out.cloneBranch;
   writeFileSync('scratch/live-parity-result.json',JSON.stringify(out,null,2));
   console.log(out.pass?'PASS':'FAIL','app and WhatsApp clone quote parity',out.appTotal,out.cloneTotal,out.appBranch,out.cloneBranch);
   if(!out.pass)process.exitCode=1;done=true;break;
  }
 }
 if(!done)throw Error('Clone timeout');
} catch(e){console.error(e.message);process.exitCode=1;}
