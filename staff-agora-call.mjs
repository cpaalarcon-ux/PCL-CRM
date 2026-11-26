const SDK_URL='https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.10/AgoraRTC_N-production.js';
const SDK_INTEGRITY='sha384-Fryxcc/iPzIxW4hBocNoKhgrAirY/sADbjunHrckZ2n33q76zjpXZz6tv0qy9Jsc';

let loading;
export function loadAgoraRtc(win,doc){
 if(!loading){
  loading=new Promise((resolve,reject)=>{
   const script=doc.createElement('script');
   script.src=SDK_URL;
   script.integrity=SDK_INTEGRITY;
   script.crossOrigin='anonymous';
   script.onload=()=>win.AgoraRTC?.createClient?resolve(win.AgoraRTC):reject(new Error('Agora could not load.'));
   script.onerror=()=>{script.remove();reject(new Error('Agora could not load.'));};
   doc.head.appendChild(script);
  }).catch(error=>{loading=null;throw error;});
 }
 return loading;
}

// Keep native MediaStreams in the Chatter controls so mute, camera and volume keep working.
export function createAgoraMedia({sdk,grant,renew,stream,win,onRemote,onState,onError}){
 const client=sdk.createClient({mode:'rtc',codec:'vp8'});
 const localTracks=[],remote=new win.MediaStream();
 const remoteTracks=new Map(),pending=new Map();
 const peerUid=grant.uid===1?2:1;
 let closed=false,renewal,expired=false;

 function setRemote(kind,track){
  const previous=remoteTracks.get(kind);
  if(previous===track)return;
  if(previous)remote.removeTrack(previous);
  if(track){remoteTracks.set(kind,track);remote.addTrack(track);}
  else remoteTracks.delete(kind);
  onRemote(remote);
 }
 client.on('user-published',async(user,kind)=>{
  if(closed||user.uid!==peerUid||!['audio','video'].includes(kind))return;
  const ticket=Symbol(kind);
  pending.set(kind,ticket);
  try{
   await client.subscribe(user,kind);
   if(closed||pending.get(kind)!==ticket)return;
   const track=(kind==='audio'?user.audioTrack:user.videoTrack)?.getMediaStreamTrack();
   if(track){setRemote(kind,track);onState('connected');}
  }catch(error){
   if(!closed&&pending.get(kind)===ticket)onError(error);
  }
 });
 client.on('user-unpublished',(user,kind)=>{
  if(closed||user.uid!==peerUid)return;
  pending.delete(kind);
  setRemote(kind,null);
 });
 client.on('user-left',user=>{
  if(closed||user.uid!==peerUid)return;
  pending.clear();
  setRemote('audio',null);
  setRemote('video',null);
  onState('disconnected');
 });
 client.on('connection-state-change',state=>{
  if(closed)return;
  if(state==='CONNECTED'&&remote.getTracks().length)onState('connected');
  if(state==='RECONNECTING'||state==='DISCONNECTED')onState('disconnected');
 });
 function renewToken(rejoin=false){
  expired||=rejoin;
  if(closed||renewal)return;
  renewal=(async()=>{
   const next=await renew();
   if(closed)return;
   if(expired){
    expired=false;
    pending.clear();
    setRemote('audio',null);
    setRemote('video',null);
    await client.join(next.app_id,next.channel,next.token,next.uid);
    if(closed){await leave();return;}
    await client.publish(localTracks);
   }else await client.renewToken(next.token);
  })().catch(error=>{if(!closed)onError(error);}).finally(()=>{
   renewal=null;
   if(expired&&!closed)renewToken();
  });
 }
 client.on('token-privilege-will-expire',()=>renewToken());
 client.on('token-privilege-did-expire',()=>renewToken(true));
 const leave=()=>client.leave().catch(()=>{});
 return {
  async connect(){
   await client.join(grant.app_id,grant.channel,grant.token,grant.uid);
   if(closed){await leave();return;}
   for(const track of stream.getAudioTracks())localTracks.push(sdk.createCustomAudioTrack({mediaStreamTrack:track}));
   for(const track of stream.getVideoTracks())localTracks.push(sdk.createCustomVideoTrack({mediaStreamTrack:track}));
   await client.publish(localTracks);
   if(closed)await leave();
  },
  close(){
   if(closed)return;
   closed=true;
   client.removeAllListeners();
   localTracks.forEach(track=>track.close());
   void leave();
  },
 };
}
