// Reserved synthetic phones only. Exercises real n8n media downloads and analysis, no payment submissions.
import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const env=Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const base='https://hds-chat.vercel.app';const results=[];
async function request(path,body,token,headers={}){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw Error(path+' HTTP '+r.status+' '+(j.error||''));return j;}
async function trial({phone,name,type,mime,bytes,caption,expect}) {
const inv=await request('/internal/invite',{phone,channel:'media-test'},null,{'x-internal-key':env.INTERNAL_KEY});const {token}=await request('/auth/invite/redeem',{token:inv.url.split('/i/')[1],platform:'test'});
const before=new Set((await request('/messages?limit=200',null,token)).messages.map(m=>m.id));
const u=await request('/media/upload-url',{mime,size:bytes.length,filename:name},token);const put=await fetch(u.upload_url,{method:'PUT',headers:{'Content-Type':mime},body:bytes});if(!put.ok)throw Error('Upload '+put.status);
const t=Date.now();const s=await request('/messages',{client_id:randomUUID().replaceAll('-',''),type,media_id:u.media_id,body:caption||''},token);
if(!s.message.media_url)throw Error('Missing preview URL');
for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,3000));const msgs=(await request('/messages?limit=200',null,token)).messages.filter(m=>m.direction==='out'&&!before.has(m.id));const reply=msgs.map(m=>m.body||'').join('\n');
if(expect.test(reply)){const result={phone,name,pass:true,elapsedSeconds:Math.round((Date.now()-t)/1000),reply:reply.slice(0,900)};results.push(result);console.log('PASS',name,result.elapsedSeconds+'s',reply.slice(-250));return;}}
throw Error(name+' timed out without expected content');}
try {
 const image=await fetch(env.SUPABASE_URL+'/storage/v1/object/public/test-images/cutting-list-typed.jpg');if(!image.ok)throw Error('Image fixture missing');
 await trial({phone:'27900000814',name:'cutting-list.jpg',type:'image',mime:'image/jpeg',bytes:Buffer.from(await image.arrayBuffer()),caption:'Please read this White Melamine 16mm cutting list and confirm the dimensions. Do not create a quote yet.',expect:/\b\d{3,4}\s*(?:x|×|by)\s*\d{3,4}(?:mm)?\b/i});
 await trial({phone:'27900000815',name:'cutlist.pdf',type:'document',mime:'application/pdf',bytes:readFileSync('../Chatbot Tests/fixtures/cutlist.pdf'),caption:'Please read this White Melamine 16mm cutting list and confirm the dimensions. Do not create a quote yet.',expect:/720|560|carcass/i});
 await trial({phone:'27900000816',name:'speech.mp3',type:'audio',mime:'audio/mpeg',bytes:readFileSync('../Chatbot Tests/fixtures/speech.mp3'),expect:/melamine|white|sheet|quote|board/i});
 console.log('LIVE MEDIA ALL PASS');
} catch(e){console.error(e.message);results.push({pass:false,error:e.message});process.exitCode=1;} finally {writeFileSync('scratch/live-media-result.json',JSON.stringify({at:new Date().toISOString(),results},null,2));}
