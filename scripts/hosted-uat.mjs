// Hosted staging check for the PCL ERP. Fictional accounts and a fictional client only.
// 1. Release identity: the live page, the live server and this commit carry the same build label.
// 2. Sign-in: the page loads in Chromium with sign-in enabled and no release warning.
// 3. Optional role checks (secrets UAT_<ROLE>_LOGIN / _PASSWORD): each account signs in with its role.
// 4. Optional workflow checks (variables UAT_CLIENT_ID, UAT_PROJECT_ID, UAT_PERIOD_ID): mapping reviewed at
//    posting, KYC evidence verified by someone else, depreciation posted from a submitted asset.
// Credentials are read from the environment only and never printed.
import fs from 'node:fs';
import {chromium} from 'playwright';

const PAGE=process.env.UAT_PAGE_URL||'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot';
const API=process.env.UAT_API_URL||'https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v12';
const KEY='sb_publishable_ibWMisivJ2reyfJl1eHP9A_HFuFY3Hc',ORIGIN=new URL(PAGE).origin;
const expected=JSON.parse(fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/release.json',import.meta.url),'utf8')).build;
const waitSeconds=Number(process.env.UAT_WAIT_SECONDS||600),stamp=new Date().toISOString().replace(/\D/g,'').slice(0,14);
const results=[];let failed=false;
const record=(name,ok,detail='')=>{results.push({name,ok,detail});if(!ok)failed=true;console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' — '+detail:''}`);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function call(payload,token){
 const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Origin:ORIGIN,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});
 const body=await r.json().catch(()=>({}));return {status:r.status,body};
}
async function ok(payload,token){const r=await call(payload,token);if(r.status!==200)throw Error(`${payload.action}: HTTP ${r.status} ${r.body.error||''}`);return r.body;}
async function refused(name,payload,token,pattern){const r=await call(payload,token);record(name,r.status>=400&&r.status<500&&pattern.test(r.body.error||''),`HTTP ${r.status} ${r.body.error||''}`);}

async function pageBuild(){const r=await fetch(PAGE,{cache:'no-store'});const html=await r.text();return html.match(/data-build="([^"]+)"/)?.[1]||null;}

async function identity(){
 let build=null;for(let waited=0;waited<=waitSeconds;waited+=20){build=await pageBuild();if(build===expected)break;console.log(`Waiting for Pages: live page is ${build}, expected ${expected}`);await sleep(20000);}
 record('Live page build matches this commit',build===expected,`page ${build}, expected ${expected}`);
 const server=await call({action:'release_info'});
 record('Live server build matches this commit',server.status===200&&server.body.build===expected,server.status===200?`server ${server.body.build||'unknown'}${server.body.commit?' · commit '+server.body.commit.slice(0,7):''}, expected ${expected}`:`HTTP ${server.status} — the server may predate release_info; deploy staff-workspace-v12`);
 for(const slug of ['staff-workspace-v6','staff-workspace-v7','staff-workspace-v8','staff-workspace-v9','staff-workspace-v10','staff-pilot']){
  const r=await fetch(API.replace(/staff-workspace-v12$/,slug),{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Origin:ORIGIN},body:'{"action":"login"}'});
  record(`Retired endpoint ${slug} answers 410`,r.status===410,`HTTP ${r.status}`);
 }
 const anonymous=await call({action:'workspace'});
 record('Anonymous protected call is refused',[401,403].includes(anonymous.status),`HTTP ${anonymous.status}`);
}

async function browserCheck(){
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(PAGE,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.documentElement.dataset.staffPilotReady==='true',null,{timeout:20000});
  const enabled=!(await page.locator('#loginForm button[type="submit"]').isDisabled());
  await page.waitForFunction(()=>'serverBuild' in document.documentElement.dataset,null,{timeout:15000}).catch(()=>{});
  const warning=await page.locator('#releaseCheck').isVisible();
  record('Sign-in page ready in Chromium',enabled&&!warning&&!errors.length,`sign-in ${enabled?'enabled':'disabled'}, release warning ${warning?'shown':'none'}, page errors ${errors.length}`);
 }finally{await browser.close();}
}

const ROLES={ASSISTANT:'preparer',MANAGER:'reviewer',PARTNER:'approver'},sessions={};
async function signIn(){
 for(const role of Object.keys(ROLES)){
  const login=process.env[`UAT_${role}_LOGIN`],password=process.env[`UAT_${role}_PASSWORD`];if(!login||!password)return false;
  try{const s=await ok({action:'login',login_id:login,password});const w=await ok({action:'workspace'},s.access_token);sessions[role]={token:s.access_token,me:w.me,workspace:w};
   record(`${ROLES[role]} signs in with the ${role} role`,w.me?.category_code===role,`role ${w.me?.category_code}`);}
  catch(e){record(`${ROLES[role]} signs in`,false,e.message);}
 }
 return Object.keys(sessions).length===3;
}
const as=role=>sessions[role].token;

async function mappingFlow(base,period){
 const name='Hosted UAT mapping '+stamp;
 await ok({action:'v3_client_account_mapping_add',client_id:process.env.UAT_CLIENT_ID,source_account_code:'HUAT-'+stamp,source_account_name:name,erp_account_code:'61180',effective_from:period.starts_on.slice(0,10)},as('MANAGER'));
 await refused('Separate mapping approval is retired',{action:'v3_client_account_mapping_approve_batch',client_id:process.env.UAT_CLIENT_ID,items:[]},as('PARTNER'),/no longer have a separate approval/);
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Hosted UAT fictional evidence'});
 const date=period.starts_on.slice(0,10);
 const j=await ok({...base,action:'ledger_journal_save',kind:'Adjustment',reference:'HUAT-'+stamp,journal_date:date,evidence:'Fictional hosted UAT adjustment, reversed in the same run',lines:[entry('61180',1,0),entry('20000',0,1)]},as('ASSISTANT'));
 let r=await ok({...base,action:'ledger_journal_read',journal_id:j.journal_id},as('ASSISTANT'));
 await ok({...base,action:'ledger_journal_submit',journal_id:j.journal_id,revision:r.journal.revision},as('ASSISTANT'));
 r=await ok({...base,action:'ledger_journal_read',journal_id:j.journal_id},as('ASSISTANT'));
 await refused('Mapping creator cannot post the journal that uses it',{...base,action:'ledger_journal_review',journal_id:j.journal_id,revision:r.journal.revision,status:'Posted',review_note:'Hosted UAT self-review attempt'},as('MANAGER'),/You set up the client account mapping/);
 const posted=await ok({...base,action:'ledger_journal_review',journal_id:j.journal_id,revision:r.journal.revision,status:'Posted',review_note:'Hosted UAT independent review of mapping and journal'},as('PARTNER'));
 record('Independent posting activates the new mapping',posted.activated_mapping_count>=1,`activated ${posted.activated_mapping_count}`);
 const rev=await ok({...base,action:'ledger_reverse',journal_id:j.journal_id,reference:'HUAT-R-'+stamp,journal_date:date,evidence:'Reversal of the fictional hosted UAT adjustment'},as('MANAGER'));
 let x=await ok({...base,action:'ledger_journal_read',journal_id:rev.journal_id},as('MANAGER'));await ok({...base,action:'ledger_journal_submit',journal_id:rev.journal_id,revision:x.journal.revision},as('MANAGER'));
 x=await ok({...base,action:'ledger_journal_read',journal_id:rev.journal_id},as('MANAGER'));await ok({...base,action:'ledger_journal_review',journal_id:rev.journal_id,revision:x.journal.revision,status:'Posted',review_note:'Hosted UAT reversal reviewed'},as('PARTNER'));
 record('Hosted UAT adjustment reversed',true);
}

async function kycFlow(){
 const cid=process.env.UAT_CLIENT_ID,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
 const compliance=async role=>((await ok({action:'workspace'},as(role))).suite?.compliance||[]).find(x=>x.client_id===cid);
 const e=await ok({action:'compliance_evidence_save',client_id:cid,document_type:'KRA_PIN',evidence_form:'online',online_source:'iTax (hosted UAT)',online_reference:'HUAT-'+stamp,evidence_date:today,change_reason:'Hosted UAT online check'},as('MANAGER'));
 let c=await compliance('MANAGER');
 await refused('KYC: the person who recorded evidence cannot verify',{action:'compliance_verify',client_id:cid,revision:c?.revision},as('MANAGER'),/different Manager or Partner/);
 const v=await call({action:'compliance_verify',client_id:cid,revision:c?.revision,review_note:'Hosted UAT independent KYC verification'},as('PARTNER'));
 record('KYC: a different person verifies',v.status===200,v.status===200?'':`HTTP ${v.status} ${v.body.error||''} (check the fictional client's KYC file is otherwise complete)`);
 await ok({action:'compliance_evidence_remove',client_id:cid,evidence_id:e.evidence_id,revision:1,change_reason:'Hosted UAT clean-up'},as('PARTNER'));
 c=await compliance('MANAGER');const back=await call({action:'compliance_verify',client_id:cid,revision:c?.revision,review_note:'Hosted UAT clean-up verification'},as('MANAGER'));
 record('KYC: withdrawal reopens review and is verified again',back.status===200,back.status===200?'':`HTTP ${back.status} ${back.body.error||''}`);
}

async function depreciationFlow(base,period,rates){
 const computer=rates.find(x=>x.class_code==='COMPUTER');if(!computer){record('Depreciation: COMPUTER class rate available',false);return;}
 const start=period.starts_on.slice(0,10);
 const asset=await ok({...base,action:'ledger_asset_save',asset_name:'Hosted UAT computer '+stamp,asset_account:'15006',rate_id:computer.rate_id,first_use_date:start,cost:1000,business_percentage:100,noncommercial_vehicle:false,evidence:'Fictional hosted UAT invoice and first-use evidence'},as('ASSISTANT'));
 let a=await ok({...base,action:'ledger_asset_read',asset_id:asset.asset_id},as('ASSISTANT'));
 await ok({...base,action:'ledger_asset_submit',asset_id:asset.asset_id,revision:a.asset.revision},as('ASSISTANT'));
 const charge=await ok({...base,action:'ledger_depreciation_create',asset_id:asset.asset_id,starts_on:start,ends_on:start,reference:'HUAT-DEP-'+stamp,evidence:'Fictional hosted UAT one-day charge'},as('ASSISTANT'));
 let j=await ok({...base,action:'ledger_journal_read',journal_id:charge.journal_id},as('ASSISTANT'));
 await ok({...base,action:'ledger_journal_submit',journal_id:charge.journal_id,revision:j.journal.revision},as('ASSISTANT'));
 j=await ok({...base,action:'ledger_journal_read',journal_id:charge.journal_id},as('ASSISTANT'));
 await ok({...base,action:'ledger_journal_review',journal_id:charge.journal_id,revision:j.journal.revision,status:'Posted',review_note:'Hosted UAT review of classification, class rate and charge'},as('MANAGER'));
 a=await ok({...base,action:'ledger_asset_read',asset_id:asset.asset_id},as('ASSISTANT'));
 record('Depreciation posting approves the submitted asset',a.asset.status==='Approved'&&a.asset.reviewed_by===sessions.MANAGER.me.staff_id,`asset ${a.asset.status}`);
}

try{
 await identity();
 await browserCheck();
 if(await signIn()){
  if(process.env.UAT_CLIENT_ID&&process.env.UAT_PROJECT_ID&&process.env.UAT_PERIOD_ID){
   const base={project_id:process.env.UAT_PROJECT_ID,period_id:process.env.UAT_PERIOD_ID};
   const ledger=await ok({action:'ledger_periods',project_id:base.project_id},as('ASSISTANT')),period=ledger.periods.find(p=>p.period_id===base.period_id);
   if(!period||period.status!=='Open')record('Fictional client year is open',false,period?period.status:'period not found');
   else for(const [name,run] of [['Mapping at Gate B',()=>mappingFlow(base,period)],['KYC evidence',kycFlow],['Depreciation at Gate B',()=>depreciationFlow(base,period,ledger.rates)]]){try{await run();}catch(e){record(name,false,e.message);}}
  }else console.log('Workflow checks skipped: set UAT_CLIENT_ID, UAT_PROJECT_ID and UAT_PERIOD_ID repository variables.');
 }else console.log('Role checks skipped: set UAT_ASSISTANT/MANAGER/PARTNER _LOGIN and _PASSWORD secrets.');
}catch(e){record('Hosted UAT run',false,e.message);}
finally{for(const s of Object.values(sessions))await call({action:'logout'},s.token).catch(()=>{});}

if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Hosted staging check (build ${expected})\n\n| Check | Result | Detail |\n|---|---|---|\n${results.map(r=>`| ${r.name} | ${r.ok?'✅ Pass':'❌ Fail'} | ${String(r.detail).replace(/\|/g,'/')} |`).join('\n')}\n\nVAT/PAYE computation confirming its summary remains a manual staff test.\n`);
process.exitCode=failed?1:0;
