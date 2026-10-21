// Read-only pricing oracle for live scenarios. Do not pin temporary promotions in regression assertions.
export async function whiteUnitPrice(env,phone){
 const headers={apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json'};
 const r=await fetch(env.SUPABASE_URL+'/rest/v1/hds_prices_william?code=eq.CMWHTP2DT9616&select=price,special_price,special_ends_at,ad_only_special',{headers});
 if(!r.ok)throw Error('Cannot read current price');const row=(await r.json())[0];if(!row)throw Error('White board price missing');
 let eligible=!row.ad_only_special;
 if(row.ad_only_special){const e=await fetch(env.SUPABASE_URL+'/rest/v1/rpc/ad_special_eligible',{method:'POST',headers,body:JSON.stringify({p_phone:phone})});if(!e.ok)throw Error('Cannot verify special eligibility');eligible=await e.json()===true;}
 const special=eligible && Number(row.special_price)>0 && Date.parse(row.special_ends_at)>Date.now();
 const amount=Number(special?row.special_price:row.price);if(!Number.isFinite(amount)||amount<=0)throw Error('Invalid price');return amount;
}
