const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomBytes,randomUUID} = require('node:crypto');
const {connectStore,openStore} = require('../store.cjs');
const {syncPending} = require('../sync.cjs');

const key = () => randomBytes(32).toString('hex');
const account = () => randomUUID();
const now = 1774000000000;
const task = {task_id:randomUUID(),task_name:'Fictional assigned task',can_note:true,can_time:true};
const draft = {kind:'note',task_id:task.task_id,note:'Synthetic content for encryption test'};

function temp(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'pcl-drafts-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
}

test('drafts persist encrypted across restarts and a different key cannot read them', t=>{
  const filename=path.join(temp(t),'work.db'),secret=key();
  const first=connectStore(filename,secret);
  first.replaceSnapshot({tasks:[task]},now);
  const id=first.save(draft);
  first.save({...draft,note:'Edited before sync'},id);
  assert.equal(first.view(now,1000).drafts[0].payload.note,'Edited before sync');
  for (const file of [filename,filename+'-wal']) {
    const bytes=fs.readFileSync(file);
    assert.equal(bytes.includes(Buffer.from('SQLite format 3')),false);
    assert.equal(bytes.includes(Buffer.from('Edited before sync')),false);
  }
  first.close();
  assert.throws(()=>connectStore(filename,key()),/could not be opened/);
  const reopened=connectStore(filename,secret);
  assert.equal(reopened.view(now,1000).drafts[0].id,id);
  assert.equal(reopened.view(now+5000,1000).drafts[0].payload,null);
  assert.equal(reopened.view(now+5000,1000).stale,true);
  reopened.close();
});

test('a lost reply retries the same operation and a blocked draft does not block unrelated work',async t=>{
  const store=connectStore(path.join(temp(t),'work.db'),key());
  t.after(()=>store.close());
  const id=store.save(draft);
  const second=store.save({...draft,task_id:randomUUID()});
  const sent=[];
  await syncPending(store,p=>{
    sent.push(p.operation_id);
    throw Object.assign(Error('Waiting for the network'),{status:503});
  },{now:()=>now});
  assert.throws(()=>store.save({...draft,note:'changed'},id),/already been sent/);
  assert.equal(store.discard(id),false,'uncertain delivery cannot be treated as a local discard');
  await syncPending(store,async p=>{
    sent.push(p.operation_id);
    if (p.operation_id===id) throw Object.assign(Error('Task reassigned'),{status:409});
  },{now:()=>now+10000});
  assert.deepEqual(sent,[id,id,second]);
  const summary=store.view(now,1000).drafts;
  assert.deepEqual(summary.map(row=>row.status),['synced','attention']);
  assert.equal(store.retryEntry(id),true);
  await syncPending(store,async p=>sent.push(p.operation_id),{now:()=>now+11000});
  assert.equal(sent.at(-1),id);
  assert.equal(store.discard(id),true);
});

test('secure storage is required and staff profiles keep different keys and drafts',async t=>{
  const root=temp(t),a=account(),b=account();
  const testStorage={
    isAsyncEncryptionAvailable:async()=>true,
    encryptStringAsync:async value=>Buffer.from(value,'hex'),
    decryptStringAsync:async value=>({result:value.toString('hex')}),
  };
  await assert.rejects(openStore(root,a,{isAsyncEncryptionAvailable:async()=>false}),/unavailable/);
  const first=await openStore(root,a,testStorage);
  first.save(draft);
  first.close();
  const other=await openStore(root,b,testStorage);
  assert.equal(other.view(now,1000).drafts.length,0);
  other.close();
  const reopened=await openStore(root,a,testStorage);
  assert.equal(reopened.view(now,1000).drafts.length,1);
  reopened.close();
  const firstKey=fs.readFileSync(path.join(root,a,'key.dpapi'));
  const secondKey=fs.readFileSync(path.join(root,b,'key.dpapi'));
  assert.notDeepEqual(firstKey,secondKey);
  fs.unlinkSync(path.join(root,a,'key.dpapi'));
  await assert.rejects(openStore(root,a,testStorage),/key for your saved drafts is missing/);
});
