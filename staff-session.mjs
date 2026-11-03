// Login persists independently of activity. Revocation and renewable Auth tokens are verified.
export const IDLE_MS=Infinity, WARNING_MS=0;
export const SESSION_KEY='pcl-staff-session-v2';
export const EXPIRED_MESSAGE='Your account session ended. Please sign in again.';
export function idleState(lastActivity,now){return {remaining:Infinity,expired:false,warning:false};}

export function createStaffSession({storage,send,now=Date.now,onEnd=()=>{},onWarning=()=>{}}){
 let state=null,generation=0,refreshing=null,pulsing=null,lastReported=0,lastPulse=0;
 function valid(s){return s&&typeof s.access_token==='string'&&s.access_token&&typeof s.refresh_token==='string'&&s.refresh_token&&typeof s.session_id==='string'&&s.session_id&&Number.isFinite(s.expires_at)&&Number.isFinite(s.last_activity)&&s.last_activity<=now();}
 function save(){if(state)storage.setItem(SESSION_KEY,JSON.stringify(state));}
 // A legacy token has no renewable credential. Sign in once.
 storage.removeItem('pcl-pilot-session');
 try{const saved=JSON.parse(storage.getItem(SESSION_KEY));if(valid(saved))state=saved;else storage.removeItem(SESSION_KEY);}catch{storage.removeItem(SESSION_KEY);}
 lastReported=state?.last_activity||0;
 function end(message=''){
  const previous=state;state=null;generation++;refreshing=null;pulsing=null;
  storage.removeItem(SESSION_KEY);onWarning(null);onEnd(message);
  // Clear the screen immediately, even if offline. Explicit sign-out revokes
  // the server session; inactivity does not revoke it.
  if(previous)void send({action:'logout'},{headers:{Authorization:'Bearer '+previous.access_token}}).catch(()=>{});
 }
 function check(){
  if(!state)return false;
  // Share token rotation and manual sign-out across browser tabs.
  let saved;try{saved=JSON.parse(storage.getItem(SESSION_KEY));}catch{}
  if(!valid(saved)||saved.session_id!==state.session_id){state=null;generation++;refreshing=null;pulsing=null;onWarning(null);onEnd('Signed out in another tab.');return false;}
  if(saved.expires_at>=state.expires_at)state={...saved,last_activity:Math.max(saved.last_activity,state.last_activity)};
  onWarning(null);return true;
 }
 function required(){if(!check())throw Error('Your session ended. Please sign in again.');}
 function context(){return {generation,session_id:state.session_id,activity:state.last_activity,headers:{Authorization:'Bearer '+state.access_token,'x-erp-activity-age-ms':String(Math.max(0,Math.floor(now()-state.last_activity)))}};}
 function isCurrent(ctx){return !!state&&ctx.generation===generation&&ctx.session_id===state.session_id;}
 function accept(ctx){if(!isCurrent(ctx))throw Error('Your session ended. Please sign in again.');required();lastReported=Math.max(lastReported,ctx.activity);}
 function reject(ctx,error){if(isCurrent(ctx)&&error.status===401)end(error.message||'Your session ended. Please sign in again.');}
 async function beforeRequest(){
  required();
  if(state.expires_at*1000-now()<=120000){
   if(!refreshing){
    const ctx=context(),refreshToken=state.refresh_token;
    refreshing=(async()=>{
     try{
      const fresh=await send({action:'refresh_session',refresh_token:refreshToken},{headers:{'x-erp-activity-age-ms':ctx.headers['x-erp-activity-age-ms']}});
      accept(ctx);
      if(!valid({...fresh,last_activity:state.last_activity})||fresh.session_id!==ctx.session_id)throw Object.assign(Error('Your session could not be renewed. Please sign in again.'),{status:401});
      state={...fresh,last_activity:state.last_activity};save();
     }catch(error){reject(ctx,error);throw error;}
    })();
   }
   const currentRefresh=refreshing;
   try{await currentRefresh;}finally{if(refreshing===currentRefresh)refreshing=null;}
  }
  required();return context();
 }
 function start(session){
  const fresh={...session,last_activity:now()};if(!valid(fresh))throw Error('The login response is incomplete. Please sign in again.');
  generation++;state=fresh;refreshing=null;pulsing=null;lastReported=state.last_activity;lastPulse=0;save();onWarning(null);
 }
 function activity(){
  // Activity is presence metadata; it does not start or end authentication.
  if(!check())return false;
  state.last_activity=now();save();onWarning(null);return true;
 }
 async function pulse(){
  if(!check()||pulsing||state.last_activity<=lastReported||now()-lastPulse<60000)return;
  lastPulse=now();
  const work=(async()=>{let ctx;try{ctx=await beforeRequest();await send({action:'session_activity'},{headers:ctx.headers});accept(ctx);}catch(error){if(ctx)reject(ctx,error);}})();
  pulsing=work;try{await work;}finally{if(pulsing===work)pulsing=null;}
 }
 return {get active(){return !!state;},start,end,check,activity,pulse,beforeRequest,accept,reject,isCurrent};
}

export function watchStaffActivity(session,{document:doc=document,window:win=window,now=Date.now}={}){
 let lastPointer=0;
 const act=e=>{if(!e.isTrusted)return;if(e.type==='pointermove'){if(now()-lastPointer<1000)return;lastPointer=now();}if(session.activity())void session.pulse();};
 const wake=()=>{session.check();void session.pulse();};
 const events=['pointerdown','pointermove','keydown','input','wheel','touchstart'];
 for(const event of events)doc.addEventListener(event,act,{capture:true,passive:true});
 doc.addEventListener('visibilitychange',wake);win.addEventListener('pageshow',wake);
 const timer=win.setInterval(wake,1000);wake();
 return ()=>{win.clearInterval(timer);for(const event of events)doc.removeEventListener(event,act,true);doc.removeEventListener('visibilitychange',wake);win.removeEventListener('pageshow',wake);};
}
