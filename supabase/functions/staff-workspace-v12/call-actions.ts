import {fail,text,uuid,choice} from './validation.mjs';
// One-to-one voice and video calls. The audio goes straight between the two browsers; the server only sets the call up (who, ringing, answered,
// ended) and hands each browser the other's connection details. Nothing is recorded or stored beyond the call's status and times.
const env=(k:string)=>(globalThis as any).Deno?.env?.get(k)||'';
const STUN={urls:['stun:stun.cloudflare.com:3478']};
const sdp=(v:any)=>{const s=text(v,20000);if(s.length<50||!s.startsWith('v=0'))fail(400,'The call set-up data is not valid.');return s;};

// Connection servers for the browsers. With a relay account configured (Cloudflare TURN key id + API token as function secrets) the
// browsers get short-lived relay credentials, so calls still connect across networks that block direct connections. Without it only the
// public STUN server is offered, which works between many but not all networks.
export async function iceConfig(fetcher:any=fetch){
 const id=env('PCL_TURN_KEY_ID'),token=env('PCL_TURN_API_TOKEN');
 if(!id||!token)return {ice_servers:[STUN],relay:false};
 try{
  const r=await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({ttl:7200}),signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw new Error('relay '+r.status);
  const body=await r.json(),servers=(Array.isArray(body?.iceServers)?body.iceServers:[]).map((s:any)=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter((u:string)=>typeof u==='string'&&!/:53($|\?)/.test(u))})).filter((s:any)=>s.urls.length);
  if(!servers.some((s:any)=>s.username&&s.credential))throw new Error('relay answer had no credentials');
  return {ice_servers:servers,relay:true};
 }catch{return {ice_servers:[STUN],relay:false,relay_error:true};}
}

export async function callAction(tx:any,a:any,p:any,fetcher:any=fetch){
 const view=async(id:string|null)=>(await tx`select * from erp_private.chat_call_view(${id}::uuid)`)[0]||null;
 if(p.action==='discussion_call_config')return iceConfig(fetcher);
 if(p.action==='discussion_call_start'){
  const r=(await tx`select erp_private.chat_call_start(${uuid(p.channel_id)}::uuid,${sdp(p.offer_sdp)},${choice(p.media||'audio',['audio','video'])}) call_id`)[0];
  return {call_id:r.call_id};
 }
 if(p.action==='discussion_call_get'){const c=await view(uuid(p.call_id));if(!c)fail(403,'This call is not available to your account.');return {call:c};}
 if(p.action==='discussion_call_pending')return {call:await view(null)};
 if(p.action==='discussion_call_answer'){await tx`select erp_private.chat_call_answer(${uuid(p.call_id)}::uuid,${sdp(p.answer_sdp)})`;return {ok:true};}
 if(p.action==='discussion_call_end'){
  const r=(await tx`select erp_private.chat_call_finish(${uuid(p.call_id)}::uuid,${choice(p.outcome,['hangup','decline','failed'])}) status`)[0];
  return {status:r.status};
 }
 return undefined;
}
