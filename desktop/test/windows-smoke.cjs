const {app,safeStorage} = require('electron');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openStore} = require('../store.cjs');

app.whenReady().then(async()=>{
  const pathOnDisk=fs.mkdtempSync(path.join(os.tmpdir(),'pcl-smoke-'));
  try {
    assert.equal(process.platform,'win32');
    const account=randomUUID(), taskId=randomUUID();
    const first=await openStore(pathOnDisk,account,safeStorage);
    first.save({kind:'note',task_id:taskId,note:'Fictional encrypted smoke test'});
    first.close();
    const reopened=await openStore(pathOnDisk,account,safeStorage);
    assert.equal(reopened.claim(Date.now()).payload.note,'Fictional encrypted smoke test');
    reopened.close();
    assert.equal(fs.readFileSync(path.join(pathOnDisk,account,'work.db')).includes(Buffer.from('SQLite format 3')),false);
    console.log('Windows Electron: secure storage and encrypted draft reopen passed.');
  } finally { fs.rmSync(pathOnDisk,{recursive:true,force:true}); }
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
