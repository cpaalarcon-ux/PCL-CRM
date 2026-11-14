export const setupExpiryText=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(value))+' EAT';
export function watchSetupLinks(receive,env=window){
 const capture=()=>{
  const params=new URLSearchParams(env.location.hash.slice(1));
  if(!params.has('setup'))return false;
  const value=params.get('setup');
  env.history.replaceState(null,'',env.location.pathname+env.location.search);
  receive(/^[a-f0-9]{64}$/.test(value||'')?value:null);
  return true;
 };
 env.addEventListener('hashchange',capture);
 return {hasSetup:capture(),stop:()=>env.removeEventListener('hashchange',capture)};
}
