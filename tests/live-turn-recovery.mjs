// Synthetic app-only fixtures; no n8n tool execution, quotes, payments or real customer messages.
import{readFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base='https://hds-chat.vercel.app/api',phone='27900000830';const d=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY);let token;const results=[];
function check(name,pass){results.push({name,pass:!!pass});console.log(pass?'PASS':'FAIL',name);if(!pass)throw Error(name);}
async function req(path,body,headers={}){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-internal-key':env.INTERNAL_KEY,...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)});return{status:r.status,j:await r.json()};}
async function fixture(){const execution=String(Date.now())+String(Math.floor(Math.random()*1000)).padStart(3,'0');const wa_id='wamid.FIXTURE'+randomUUID();const{data:m,error}=await d.from('app_messages').insert({phone,direction:'in',sender:'customer',type:'text',body:'TEST ONLY turn recovery fixture',wa_id,client_id:'fixture-'+randomUUID()}).select('*').single();if(error)throw error;const c=await d.rpc('app_claim_turn',{p_wa_id:wa_id,p_phone:phone,p_execution:execution});if(c.error||c.data!==true)throw Error('fixture claim failed');return{m,execution};}
try {
const i=await req('/internal/invite',{phone,channel:'recovery-test'});const a=await req('/auth/invite/redeem',{token:i.j.url.split('/i/')[1],platform:'test'});token=a.j.token;
const first=await fixture();const G='/wa/'+env.GATEWAY_SECRET+'/v20.0/hdsapp/messages';
const one=await req(G,{to:phone,type:'text',text:{body:'TEST ONLY successful final reply'}},{'x-hds-delivery-key':first.execution+':Send WhatsApp Reply:1'});
const two=await req(G,{to:phone,type:'text',text:{body:'TEST ONLY fallback after a lost reply receipt'}},{'x-hds-delivery-key':first.execution+':Send WhatsApp Reply:2'});
check('final reply and lost-receipt fallback share one message',one.status===200&&two.status===200&&one.j.messages[0].id===two.j.messages[0].id);
const late=await req('/internal/turn/finish',{execution:first.execution,outcome:'failed'});check('late error cannot downgrade delivered reply',late.j.state==='completed'&&late.j.changed===false);
const failed=await fixture();const calls=await Promise.all([req('/internal/turn/finish',{execution:failed.execution,outcome:'failed'}),req('/internal/turn/finish',{execution:failed.execution,outcome:'failed'})]);check('failure callback stored terminal state',calls.every(x=>x.status===200&&x.j.state==='failed'));
const{data:notices}=await d.from('app_messages').select('id').eq('phone',phone).contains('payload',{source:'turn_recovery',message_id:failed.m.id});check('concurrent failure callbacks produce one notice',notices?.length===1);
const again=await d.rpc('app_claim_turn',{p_wa_id:failed.m.wa_id,p_phone:phone,p_execution:'do-not-replay'});check('failed claimed turn never replays',again.data===false);
const timed=await fixture();const{error:ageError}=await d.from('app_turn_claims').update({claimed_at:new Date(Date.now()-11*60e3).toISOString()}).eq('message_id',timed.m.id);if(ageError)throw ageError;
const sweep=await req('/internal/turn/recover',{});check('watchdog endpoint succeeds',sweep.status===200&&sweep.j.ok===true);
const{data:t}=await d.from('app_turn_claims').select('state,notice_pending').eq('message_id',timed.m.id).single();check('stalled turn times out and its notice is acknowledged',t?.state==='timed_out'&&t.notice_pending===false);
const{data:tn}=await d.from('app_messages').select('id').eq('phone',phone).contains('payload',{source:'turn_recovery',message_id:timed.m.id});check('timeout notice persisted once',tn?.length===1);
const oversize=await req('/messages',{client_id:randomUUID().replaceAll('-',''),type:'text',body:'x'.repeat(4097)});check('oversized text rejected rather than truncated',oversize.status===400&&oversize.j.error==='message_too_long');
const loc=await req('/messages',{client_id:randomUUID().replaceAll('-',''),type:'location',location:{lat:200,lon:0}});check('invalid geographic coordinates rejected',loc.status===400&&loc.j.error==='bad_location');
console.log('LIVE TURN RECOVERY ALL PASS');
}catch(e){console.error(e.message);process.exitCode=1;}finally{writeFileSync('scratch/live-turn-recovery-result.json',JSON.stringify({at:new Date().toISOString(),results},null,2));}
