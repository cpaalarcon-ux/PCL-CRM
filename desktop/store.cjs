const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3-multiple-ciphers');

async function openStore(root, staffId, safeStorage) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(staffId)) {
    throw Error('The staff profile is invalid.');
  }
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw Error('Windows secure storage is unavailable on this device.');
  }

  const directory = path.join(root, staffId.toLowerCase());
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(directory, 'key.dpapi');
  const dbPath = path.join(directory, 'work.db');
  if (!fs.existsSync(keyPath)) {
    if (fs.existsSync(dbPath)) throw Error('The key for your saved drafts is missing.');
    const wrapped = await safeStorage.encryptStringAsync(randomBytes(32).toString('hex'));
    const temp = path.join(directory, randomUUID());
    try {
      fs.writeFileSync(temp, wrapped, { flag: 'wx', mode: 0o600, flush: true });
      fs.renameSync(temp, keyPath);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  const unlocked = await safeStorage.decryptStringAsync(fs.readFileSync(keyPath));
  if (unlocked?.isTemporarilyUnavailable || !/^[a-f0-9]{64}$/.test(unlocked?.result ?? '')) {
    throw Error('Windows could not unlock your saved drafts.');
  }
  return connectStore(dbPath, unlocked.result);
}

function connectStore(filename, key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid database key.');
  const db = new Database(filename);
  try {
    db.pragma("cipher='sqlcipher'");
    db.pragma('legacy=4');
    db.pragma(`key="x'${key}'"`);
    db.prepare('select count(*) from sqlite_master').get();
    db.pragma('foreign_keys=ON');
    db.pragma('journal_mode=WAL');
    db.pragma('synchronous=FULL');
    db.exec(`
      create table if not exists snapshot (
        slot integer primary key check(slot=1),
        captured_at integer not null,
        tasks text not null,
        has_more integer not null check(has_more in (0,1))
      );
      create table if not exists drafts (
        id text primary key,
        task_id text not null,
        kind text not null check(kind in ('time','note')),
        payload text not null
      );
      create table if not exists outbox (
        id text primary key references drafts(id) on delete cascade,
        position integer not null unique,
        status text not null check(status in ('pending','synced','attention')),
        attempts integer not null default 0,
        retry_at integer not null default 0,
        reason text
      );
    `);
  } catch {
    db.close();
    throw Error('The encrypted work database could not be opened.');
  }

  const addDraft = db.prepare('insert into drafts(id,task_id,kind,payload) values(?,?,?,?)');
  const addAction = db.prepare("insert into outbox(id,position,status) values(?,(select coalesce(max(position),0)+1 from outbox),'pending')");
  const insert = db.transaction(payload => {
    const id = randomUUID();
    addDraft.run(id,payload.task_id,payload.kind,JSON.stringify(payload));
    addAction.run(id);
    return id;
  });
  const update = db.prepare(`update drafts set payload=? where id=? and task_id=? and kind=?
    and exists(select 1 from outbox where outbox.id=drafts.id and status='pending' and attempts=0)`);
  const snapshot = db.prepare('select captured_at,tasks,has_more from snapshot where slot=1');
  const rows = db.prepare(`select drafts.id,drafts.task_id,drafts.payload,outbox.status,outbox.attempts,outbox.reason
    from outbox join drafts using(id) order by position desc`);
  const claim = db.transaction(now => {
    const item = db.prepare(`select outbox.id,outbox.attempts,drafts.payload from outbox join drafts using(id)
      where outbox.status='pending' and outbox.retry_at<=?
      and not exists(select 1 from outbox earlier join drafts prior on prior.id=earlier.id
       where prior.task_id=drafts.task_id and earlier.status='pending' and earlier.position<outbox.position)
      order by outbox.position limit 1`).get(now);
    if (!item) return null;
    db.prepare('update outbox set attempts=attempts+1 where id=?').run(item.id);
    return { ...item, attempts:item.attempts+1, payload:JSON.parse(item.payload) };
  });
  return {
    close: () => db.close(),
    save(payload,id) {
      if (!id) return insert(payload);
      if (!update.run(JSON.stringify(payload),id,payload.task_id,payload.kind).changes) {
        throw Error('This draft has already been sent for sync and cannot be edited here.');
      }
      return id;
    },
    discard(id) {
      return Boolean(db.prepare(`delete from drafts where id=? and exists (select 1 from outbox
        where outbox.id=drafts.id and (status in ('attention','synced') or (status='pending' and attempts=0)))`).run(id).changes);
    },
    replaceSnapshot(data,now) {
      db.prepare(`insert into snapshot(slot,captured_at,tasks,has_more) values(1,?,?,?)
        on conflict(slot) do update set captured_at=excluded.captured_at,tasks=excluded.tasks,has_more=excluded.has_more`)
        .run(now,JSON.stringify(data.tasks),Number(data.has_more===true));
    },
    view(now,maximumAge) {
      const latest = snapshot.get();
      const fresh = latest && now >= latest.captured_at && now-latest.captured_at <= maximumAge;
      const tasks = fresh ? JSON.parse(latest.tasks) : [];
      const visible = new Set(tasks.map(task => task.task_id));
      return {
        tasks, capturedAt:latest?.captured_at ?? null, hasMore:Boolean(fresh && latest.has_more), stale:!fresh,
        drafts:rows.all().map(({payload,...row}) => ({
          ...row,payload:visible.has(row.task_id) ? JSON.parse(payload) : null,
        })),
      };
    },
    claim,
    retry(id,when) { db.prepare('update outbox set retry_at=? where id=?').run(when,id); },
    retryEntry(id) {
      return Boolean(db.prepare("update outbox set status='pending',retry_at=0,reason=null where id=? and status='attention'").run(id).changes);
    },
    outcome:db.transaction((id,status,reason=null)=>{
      db.prepare('update outbox set status=?,reason=? where id=?').run(status,reason,id);
      if (status==='synced') db.prepare("update drafts set payload='null' where id=?").run(id);
    }),
  };
}

module.exports = { connectStore, openStore };
