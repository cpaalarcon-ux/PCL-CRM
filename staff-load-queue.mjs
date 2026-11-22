// One workspace read at a time. A request that arrives while a read is running shares a single follow-up read,
// so three quick saves cost two full reads instead of three. A caller always receives a read that started
// after its own call, so it never sees data older than the write it just made.
export function createLoadQueue(run){
 let active=null,queued=null;
 function load(options={}){
  if(!active){active=run(options).finally(()=>{active=null;});return active;}
  if(!queued)queued=active.catch(()=>{}).then(()=>{queued=null;return load(options);});
  return queued;
 }
 return load;
}
