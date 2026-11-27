const MAX_BATCH = 12;
const sleepFor = attempt => Math.min(300000, 5000 * 2 ** Math.min(6,attempt-1));

async function syncPending(store,send,{now=Date.now,active=()=>true}={}) {
  for (let count=0;count<MAX_BATCH && active();count++) {
    const draft = store.claim(now());
    if (!draft) return 'ready';
    try {
      await send({action:'task_offline_apply',operation_id:draft.id,...draft.payload});
      if (!active()) return 'locked';
      store.outcome(draft.id,'synced');
    } catch (error) {
      if (!active()) return 'locked';
      const status = error.status;
      if (status===401) return 'sign-in';
      if ([400,403,409,422].includes(status)) {
        store.outcome(draft.id,'attention',error.message);
        continue;
      }
      store.retry(draft.id,now()+sleepFor(draft.attempts));
      return 'waiting';
    }
  }
  return 'ready';
}

module.exports = { syncPending };
