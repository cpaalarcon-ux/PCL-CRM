import AgoraToken from 'agora-token';
import {fail,text,uuid,choice} from './validation.mjs';
// The ERP manages the private call lifecycle. WebRTC exchanges SDP here, while Agora exchanges media using a signed RTC token.
const env=(k:string)=>(globalThis as any).Deno?.env?.get(k)||'';
const STAGING_SUPABASE_URL='https://yfjiculexbzpkvtapudk.supabase.co';
const PRODUCTION_SUPABASE_URL='https://tafrrmcxrsorffkonrxq.supabase.co';
const AGORA_TOKEN_SECONDS=300;
function agoraSettings(){
 const projectUrl=env('SUPABASE_URL');
 const rollout=env('PCL_AGORA_RTC_ENABLED').trim();
 const enabled=(projectUrl===STAGING_SUPABASE_URL&&rollout!=='false')
  ||(projectUrl===PRODUCTION_SUPABASE_URL&&rollout==='true');
 const appId=env('AGORA_APP_ID').trim(),certificate=env('AGORA_APP_CERTIFICATE').trim();
 const validKey=(value:string)=>/^[0-9a-f]{32}$/i.test(value);
 return enabled&&validKey(appId)&&validKey(certificate)?{appId,certificate}:null;
}
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
 const view=async(id:string|null)=>(await tx`
  select v.*,case when c.offer_sdp is null then 'agora' else 'webrtc' end as transport
  from erp_private.chat_call_view(${id}::uuid) v join erp_private.chat_calls c using(call_id)
 `)[0]||null;
 if(p.action==='discussion_call_config'){
  const config=await iceConfig(fetcher);
  return {...config,agora:!!agoraSettings()};
 }
 if(p.action==='discussion_call_start'){
  const agora=p.transport==='agora';
  if(agora&&!agoraSettings())fail(503,'Agora calling is not available in this workspace.');
  const media=choice(p.media||'audio',['audio','video']);
  const offer=agora?null:sdp(p.offer_sdp);
  const [r]=await tx`select erp_private.chat_call_start(${uuid(p.channel_id)}::uuid,${offer},${media}) call_id`;
  return {call_id:r.call_id};
 }
 if(p.action==='discussion_call_get'){const c=await view(uuid(p.call_id));if(!c)fail(403,'This call is not available to your account.');return {call:c};}
 if(p.action==='discussion_call_pending'){
  const c=await view(null);
  return {call:c?.transport==='agora'&&p.agora!==true?null:c};
 }
 if(p.action==='discussion_call_answer'){
  const answer=p.transport==='agora'?null:sdp(p.answer_sdp);
  await tx`select erp_private.chat_call_answer(${uuid(p.call_id)}::uuid,${answer})`;
  return {ok:true};
 }
 if(p.action==='discussion_call_agora_token'){
  const settings=agoraSettings();
  if(!settings)fail(503,'Agora calling is not available in this workspace.');
  const c=await view(uuid(p.call_id));
  if(!c||c.transport!=='agora'||c.status!=='Answered')fail(403,'This call is not available to your account.');
  const channel='pcl-'+c.call_id,uid=c.role==='caller'?1:2;
  const token=AgoraToken.RtcTokenBuilder.buildTokenWithUid(
   settings.appId,settings.certificate,channel,uid,AgoraToken.RtcRole.PUBLISHER,AGORA_TOKEN_SECONDS,AGORA_TOKEN_SECONDS
  );
  if(!token)fail(503,'Agora calling is not available in this workspace.');
  return {app_id:settings.appId,channel,uid,token};
 }
 if(p.action==='discussion_call_end'){
  const r=(await tx`select erp_private.chat_call_finish(${uuid(p.call_id)}::uuid,${choice(p.outcome,['hangup','decline','failed'])}) status`)[0];
  return {status:r.status};
 }
 return undefined;
}
