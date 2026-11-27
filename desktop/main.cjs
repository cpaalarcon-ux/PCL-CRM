const { app, BrowserWindow, net, protocol, ipcMain, safeStorage, shell, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openStore } = require('./store.cjs');
const { syncPending } = require('./sync.cjs');
const { workspaceConfig } = require('./workspace-config.cjs');
const config = workspaceConfig(require('./workspace.json'));

const UI = 'pcl-desktop://work/';
const ASSETS = { '/':'offline.html', '/work.js':'work.js', '/offline.css':'offline.css', '/icon.png':'icon.png' };
const SNAPSHOT_AGE = 24 * 60 * 60 * 1000;
const IDLE_LIMIT = 30 * 60 * 1000;
const ROOT = config.staging ? 'offline-drafts-v1' : 'offline-drafts-production-v1';
const VERSION_LABEL = config.staging ? 'Staging pilot' : 'Version ' + app.getVersion();
const PREFS = { sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true };

protocol.registerSchemesAsPrivileged([{scheme:'pcl-desktop',privileges:{standard:true,secure:true}}]);

let win, current, syncing, signingIn=false, lockReason='';
const end = (reason, revoke=false) => {
  lockReason = reason;
  const closed = current;
  current = null;
  if (!closed) return;
  closed.abort.abort();
  closed.store.close();
  if (revoke) void call({action:'logout'},closed.token).catch(()=>{});
};

async function call(payload,token,signal,lastActivity) {
  const response = await fetch(config.api,{
    method:'POST',cache:'no-store',redirect:'error',
    signal:AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])]),
    headers:{
      'Content-Type':'application/json', 'apikey':config.publishableKey, 'Origin':config.site, 'x-region':'ap-south-1',
      ...(token?{Authorization:'Bearer '+token,'x-erp-activity-age-ms':String(Math.max(0,Date.now()-(lastActivity??Date.now())))}:{}),
    },
    body:JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(typeof result.error==='string'?result.error:'The workspace request was refused.'),{status:response.status});
  return result;
}

function session() {
  if (current && (Date.now() >= current.expires || Date.now()-current.activeAt >= IDLE_LIMIT)) {
    end('Sign in online to unlock your saved drafts.');
  }
  return current;
}
function activeSession() {
  const state = session();
  if (!state) throw Error('Sign in online to unlock your saved drafts.');
  return state;
}
function server(state,payload) {
  return call(payload,state.token,state.abort.signal,state.activeAt);
}
function view() {
  const state = session();
  return state?{signedIn:true,versionLabel:VERSION_LABEL,connection:state.connection,...state.store.view(Date.now(),SNAPSHOT_AGE)}
    : {signedIn:false,versionLabel:VERSION_LABEL,reason:lockReason};
}

function validateDraft(input,task) {
  if (!task) throw Error('Refresh My Work and choose an available task.');
  const task_id=task.task_id;
  if (input.kind==='note'&&task.can_note) {
    const note=String(input.note??'').trim();
    if (note.length>=3&&note.length<=1000) return {kind:'note',task_id,note};
    throw Error('Enter a work note of 3 to 1,000 characters.');
  }
  if (input.kind==='time'&&task.can_time) {
    const hours=Number(input.hours), work_date=String(input.work_date??''), description=String(input.description??'').trim();
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)||work_date>day||!/^(?:\d{1,2})(?:\.\d{1,2})?$/.test(String(input.hours))
      ||hours<=0||hours>24||!description||description.length>2000) {
      throw Error('Enter a work date, hours from 0.01 to 24, and a description.');
    }
    return {kind:'time',task_id,hours,work_date,description,billable:input.billable===true};
  }
  throw Error('This draft type is unavailable for the selected task.');
}

function refresh(force=false) {
  const state = session();
  if (!state || syncing || (!force && Date.now()<state.nextCheck)) return syncing;
  const ownsSession=()=>session()===state;
  syncing=(async()=>{
    try {
      // Refresh scope before replay. The apply action also checks the live assignment.
      const latest=await server(state,{action:'task_offline_list'});
      if (!ownsSession()) return;
      if (latest.staff_id!==state.staffId||!Array.isArray(latest.tasks)) throw Error('Offline scope could not be verified.');
      state.store.replaceSnapshot(latest,Date.now());
      const result=await syncPending(state.store,p=>server(state,p),{active:ownsSession});
      if (!ownsSession()) return;
      if (result==='sign-in') { end('Sign in again to sync your saved drafts.'); return; }
      state.connection=result==='waiting'?'Waiting to sync':'Connected';
      state.nextCheck=Date.now()+(result==='waiting'?15000:60000);
    } catch (error) {
      if (!ownsSession()) return;
      if ([401,403].includes(error.status)) { end('Sign in online to check your offline access.'); return; }
      state.connection='Waiting to sync';
      state.nextCheck=Date.now()+15000;
    }
  })().finally(()=>{syncing=null;});
  return syncing;
}

const handlers={
  async login(loginId,password) {
    if (current||signingIn) throw Error('Sign out before changing accounts.');
    if (typeof loginId!=='string'||loginId.length>80||typeof password!=='string'||password.length>128) {
      throw Error('Enter your staff login ID and password.');
    }
    signingIn=true;
    let token,store;
    try {
      const auth=await call({action:'login',login_id:loginId,password});
      token=auth.access_token;
      const expires=auth.expires_at*1000;
      if (typeof token!=='string'||!Number.isFinite(expires)||expires<=Date.now()) throw Error('Sign in again.');
      const latest=await call({action:'task_offline_list'},token);
      if (!Array.isArray(latest.tasks)) throw Error('Offline scope could not be verified.');
      store=await openStore(path.join(app.getPath('userData'),ROOT),latest.staff_id,safeStorage);
      store.replaceSnapshot(latest,Date.now());
      current={token,expires,staffId:latest.staff_id,store,activeAt:Date.now(),abort:new AbortController(),
        connection:'Connected',nextCheck:0};
      lockReason='';
      void refresh();
      return view();
    } catch(error) {
      store?.close();
      if (token) void call({action:'logout'},token).catch(()=>{});
      if (!error.status&&['TimeoutError','AbortError','TypeError'].includes(error.name)) {
        throw Error('Connect to the internet to sign in to the offline workspace.');
      }
      throw error;
    } finally {
      signingIn=false;
    }
  },
  view,
  activity() { const state=session(); if (state) state.activeAt=Date.now(); },
  signout() { end('Signed out. Saved drafts are locked on this device.',true); return view(); },
  async sync() { activeSession(); await refresh(true); return view(); },
  save(input,id) {
    const state=activeSession();
    const task=state.store.view(Date.now(),SNAPSHOT_AGE).tasks.find(row=>row.task_id===input?.task_id);
    state.store.save(validateDraft(input,task),typeof id==='string'?id:null);
    state.nextCheck=0;
    return view();
  },
  retryEntry(id) {
    const state=activeSession();
    if (!state.store.retryEntry(String(id))) throw Error('This draft is not waiting for review.');
    state.nextCheck=0;
    return view();
  },
  discard(id) {
    if (!activeSession().store.discard(String(id))) throw Error('This draft is awaiting confirmation from the ERP.');
    return view();
  },
  openERP() { return shell.openExternal(config.workspaceUrl); },
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if (win?.isMinimized()) win.restore(); win?.focus();});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>end(''));
  app.whenReady().then(()=>{
    if (process.platform!=='win32') {
      const { dialog }=require('electron');
      dialog.showErrorBox('PCL Nexus Offline','Use this app on a managed Windows device.');
      app.quit();
      return;
    }
    protocol.handle('pcl-desktop',request=>{
      const address=new URL(request.url);
      const asset=Object.hasOwn(ASSETS,address.pathname)?ASSETS[address.pathname]:null;
      if (address.host!=='work'||!asset) return new Response(null,{status:404});
      return net.fetch(pathToFileURL(path.join(__dirname,asset)).href);
    });
    win=new BrowserWindow({title:'PCL Nexus Offline · '+VERSION_LABEL,width:1080,height:790,minWidth:660,minHeight:590,
      icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,
      webPreferences:{...PREFS,preload:path.join(__dirname,'preload.cjs')}});
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    win.webContents.on('will-frame-navigate',event=>event.preventDefault());
    win.webContents.session.setPermissionCheckHandler(()=>false);
    win.webContents.session.setPermissionRequestHandler((_contents,_permission,done)=>done(false));
    for (const [name,handler] of Object.entries(handlers)) {
      ipcMain.handle('offline:'+name,(event,...args)=>{
        if (event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame?.url!==UI) {
          throw Error('This workspace action is unavailable.');
        }
        return handler(...args);
      });
    }
    powerMonitor.on('lock-screen',()=>end('The device was locked. Sign in to unlock your drafts.'));
    powerMonitor.on('suspend',()=>end('Sign in to unlock your drafts after sleep.'));
    setInterval(()=>{if (session()) void refresh();},5000).unref();
    win.loadURL(UI);
  });
}
