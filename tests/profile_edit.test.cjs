const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const staffKey = 'pcl-staff-directory-preview-v2';
const clientKey = 'pcl-crm-clients-v1';
const roleKey = 'pcl-unified-shell-preview-v1';
const json = value => JSON.parse(JSON.stringify(value));
class FormDataMock {
  constructor(form) { this.data = form.data; }
  get(key) { return this.data[key] ?? ''; }
  getAll(key) { const v = this.get(key); return Array.isArray(v) ? v : v ? [v] : []; }
  entries() { return Object.entries(this.data)[Symbol.iterator](); }
}
function environment(role = 'Engagement Partner') {
  const storage = new Map([[roleKey, JSON.stringify({category:role,permissions:[]})]]);
  const notices = {};
  const controls = new Proxy({}, {get:(obj,key)=>obj[key] ||= {value:'', readOnly:false,disabled:false,textContent:''}});
  const form = {data:{},elements:controls, reportValidity:()=>true,reset(){},querySelector:()=>({textContent:''}),querySelectorAll:()=>[]};
  const context = {
    console, crypto:webcrypto, Date, FormData:FormDataMock,
    CustomEvent:class {constructor(name,options){this.type=name;this.detail=options?.detail;}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    document:{getElementById:id=>id==='client-form'?form:['staffFormFeedback','staffAccessNotice','clientProfileNotice','clientMissingSummary','clientEditTitle'].includes(id)?(notices[id]||={textContent:'',className:''}):null,querySelectorAll:()=>[],querySelector:()=>null},
    window:{dispatchEvent(){},setTimeout(){},addEventListener(){}},
    CRM:{sectors:['SME/Startup','Financial Services','Public Sector'],branches:['Nairobi','Bungoma','Kisii','Other'],clientCategories:['Corporate','Individual','Non-Profit','Public Entity']},
    clients:[],staffPanelIsSelected:()=>false,firmById:id=>['firm-1','firm-2','firm-3'].includes(id)?{id}:null,
    allServices:()=>['Statutory Audit','Bookkeeping & Outsourced Accounting','Tax Compliance (VAT, PAYE, Income Tax)'],
    selectedServices:()=>form.data.services||[],selectedTaxWorkPacks:()=>form.data.taxWorkPack||[],
    numberOrNull:value=>value===''||value==null?null:Number(value),generateWorkflows:()=>[],
    showRecommendation(){},showTaxComplianceProfile(){},renderClientList(){},setTimeout(){},
  };
  vm.createContext(context);
  const app = fs.readFileSync(path.join(root,'app_group_workspace_firms_v5.js'),'utf8');
  const build=app.split('\n').find(line=>line.startsWith('function buildClient('));
  vm.runInContext(build,context);
  return {context,storage,notices,form};
}
function staffEnvironment(role) {
  const env=environment(role),source=fs.readFileSync(path.join(root,'staff_access_module_v1.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('  const style ='))+'\nwindow.testStaff={saveProfile,staffFormHtml,canEditStaff,setEdit(id,record){editingId=id;editingSnapshot=JSON.stringify(record);}};})();',env.context);
  env.api=env.context.window.testStaff;
  return env;
}
function clientEnvironment(role) {
  const env=environment(role),source=fs.readFileSync(path.join(root,'client_profile_module_v1.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('  const originalRender='))+'\nwindow.pclClientProfiles={missing,stamp,canManage};window.testClient={saveEditor,missing,stamp,setEdit(id,record){editingId=id;snapshot=JSON.stringify(record);}};})();',env.context);
  env.api=env.context.window.testClient;
  env.save=()=>env.api.saveEditor({currentTarget:env.form,preventDefault(){},stopImmediatePropagation(){}});
  return env;
}
function importerEnvironment(role='Engagement Partner') {
  const env=clientEnvironment(role),source=fs.readFileSync(path.join(root,'bulk_import_module_v1.js'),'utf8');
  vm.runInContext(source.slice(0,source.indexOf('  document.addEventListener("click",'))+'\nwindow.testImport={state,autoMap,prepare,canImport};})();',env.context);
  env.importer=env.context.window.testImport;
  env.map=(headers,rows,type='clients')=>{env.importer.state.headers=headers;env.importer.state.rows=rows;env.importer.state.type=type;env.importer.autoMap(type);};
  return env;
}
const staff = {staffId:'TEST001',loginId:'TEST001',fullName:'Example Staff',position:'Audit Assistant',employmentType:'Contract',billingStatus:'Billable',firmScope:'Assigned firms',clientScope:'Assigned clients',projectScope:'Assigned tasks',contractStartDate:'2026-01-01',contractEndDate:'2027-12-31',standardCostRate:1500,billableRate:4000,effectiveDate:'2026-01-01',accountStatus:'Active',rateStatus:'Imported, Finance approval required',extraMetadata:'preserve'};
function staffData(record=staff){return Object.fromEntries(Object.entries(record).filter(([k])=>!['accountStatus','rateStatus','extraMetadata'].includes(k)).map(([k,v])=>[k,String(v)]));}
const client = {id:'client-test-1',importReference:'CL-TEST-1',companyName:'Example Company',tradingName:'',firmId:'firm-1',primarySector:'SME/Startup',branchLocation:'Nairobi',clientCategory:'Individual',contact:{name:'Example Contact',email:'test@example.invalid',phone:'+254700000000',custom:'keep'},services:['Bookkeeping & Outsourced Accounting'],regulators:[],tasks:[{id:'existing-task',status:'Completed'}],eqrCompleted:true,reportSigned:true,createdAt:'2026-01-01T00:00:00Z',kyc:{verified:true},extraMetadata:'preserve'};
function clientData(record=client){return {...record,clientFirm:record.firmId,contactName:record.contact?.name||'',email:record.contact?.email||'',phone:record.contact?.phone||'',jobTitle:'',decisionRole:'',notes:'',engagementLetter:''};}

test('staff category edit preserves ID, account and unrelated metadata and records history',()=>{
 const e=staffEnvironment('Manager');e.storage.set(staffKey,JSON.stringify([staff]));e.api.setEdit(staff.staffId,staff);e.form.data={...staffData(),position:'Audit Supervisor'};e.api.saveProfile(e.form);
 const saved=JSON.parse(e.storage.get(staffKey));assert.equal(saved.length,1);assert.equal(saved[0].staffId,staff.staffId);assert.equal(saved[0].position,'Audit Supervisor');assert.equal(saved[0].accountStatus,'Active');assert.equal(saved[0].extraMetadata,'preserve');assert.equal(saved[0].changeHistory[0].changes[0].field,'position');
});
test('staff validation rejects duplicate login, changed ID, invalid dates, negative rates and empty names',()=>{
 for(const change of [{loginId:'test002'},{staffId:'OTHER'},{contractEndDate:'2025-01-01'},{standardCostRate:'-1'},{fullName:'  '},{position:'Admin'}]){
  const e=staffEnvironment();const records=[staff,{...staff,staffId:'TEST002',loginId:'TEST002'}];e.storage.set(staffKey,JSON.stringify(records));e.api.setEdit(staff.staffId,staff);e.form.data={...staffData(),...change};e.api.saveProfile(e.form);assert.deepEqual(JSON.parse(e.storage.get(staffKey)),records);assert.ok(e.notices.staffFormFeedback.textContent);
 }
});
test('staff stale edits and storage errors do not overwrite records',()=>{
 const e=staffEnvironment();e.storage.set(staffKey,JSON.stringify([{...staff,fullName:'Another update'}]));e.api.setEdit(staff.staffId,staff);e.form.data=staffData();e.api.saveProfile(e.form);assert.match(e.notices.staffFormFeedback.textContent,/changed elsewhere/);
 e.storage.set(staffKey,JSON.stringify([staff]));e.form.data.position='Manager';e.context.localStorage.setItem=()=>{throw new Error('Quota');};e.api.saveProfile(e.form);assert.match(e.notices.staffFormFeedback.textContent,/Could not save/);assert.equal(JSON.parse(e.storage.get(staffKey))[0].position,'Audit Assistant');
});
test('blank rates stay null, edited rates require approval and no-op does not add history',()=>{
 const e=staffEnvironment();e.storage.set(staffKey,JSON.stringify([staff]));e.api.setEdit(staff.staffId,staff);e.form.data=staffData();e.api.saveProfile(e.form);assert.match(e.notices.staffFormFeedback.textContent,/No changes/);
 e.form.data.standardCostRate='';e.form.data.billableRate='';e.api.saveProfile(e.form);const saved=JSON.parse(e.storage.get(staffKey))[0];assert.equal(saved.standardCostRate,null);assert.equal(saved.rateStatus,'Pending Finance approval');
});
test('profile HTML escapes names and fixes staff ID during editing',()=>{
 const e=staffEnvironment();const html=e.api.staffFormHtml({...staff,fullName:'<img src=x onerror=alert(1)>'});assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('readonly'));assert.ok(html.includes('Save staff changes'));assert.ok(html.includes('staffCancelEdit'));
});
test('client importer accepts incomplete and ID-only rows, skips blank-identity and duplicate rows',()=>{
 const e=importerEnvironment();e.map(['Client ID / Reference','Company Name','Primary Sector','Branch Location'],[['C-1','Partial Company','',''],['C-2','','',''],['C-3','Partial Company','',''],['','','',''],['C-1','Other spelling','','']]);
 const r=e.importer.prepare();assert.equal(r.records.length,2);assert.equal(r.duplicates.length,2);assert.equal(r.errors.length,1);assert.equal(r.records[0].profileStatus,'Draft');assert.equal(r.records[0].firmId,'');assert.ok(r.records[0].missingFields.includes('Primary sector'));assert.equal(r.records[0].eqrCompleted,false);assert.equal(r.records[0].tasks.length,0);
});
test('client importer preserves unmapped fields and canonical tax services containing commas',()=>{
 const e=importerEnvironment();e.map(['Company Name','Primary Sector','Branch Location','Handling Firm / Firm Code','Services Requested'],[['Example Company','Bad sector','Bad branch','Unknown firm','Tax Compliance (VAT, PAYE, Income Tax)']]);
 const r=e.importer.prepare().records[0];assert.equal(r.unmappedImportFields['Primary Sector'],'Bad sector');assert.equal(r.firmId,'');assert.equal(r.services[0],'Tax Compliance (VAT, PAYE, Income Tax)');assert.ok(r.missingFields.includes('Tax work packs'));
});
test('existing client identifiers and prior names are deduplicated',()=>{
 const e=importerEnvironment();e.storage.set(clientKey,JSON.stringify([{...client,previousNames:['Old Example Company']}]));e.map(['Client ID / Reference','Company Name'],[['CL-TEST-1','New name'],['NEW-ID','Old Example Company']]);assert.equal(e.importer.prepare().duplicates.length,2);
});
test('only Engagement Partner and Manager can upload, including when System Administration is assigned',()=>{
 for(const role of ['Engagement Partner','Manager','Audit Supervisor','Audit Assistant','Intern']){
  const e=importerEnvironment(role);e.storage.set(roleKey,JSON.stringify({category:role,permissions:['System Administration']}));e.map(['Company Name'],[['Example Company']]);const result=e.importer.prepare();const allowed=['Engagement Partner','Manager'].includes(role);assert.equal(e.importer.canImport(),allowed);assert.equal(Boolean(result.error),!allowed);
  const s=staffEnvironment(role);s.storage.set(staffKey,JSON.stringify([staff]));s.api.setEdit(staff.staffId,staff);s.form.data={...staffData(),position:'Manager'};s.api.saveProfile(s.form);assert.equal(JSON.parse(s.storage.get(staffKey))[0].position,allowed?'Manager':'Audit Assistant');
 }
});
test('client edits preserve identities, task history, contact metadata, verification and aliases',()=>{
 const e=clientEnvironment('Manager');e.storage.set(clientKey,JSON.stringify([client]));e.api.setEdit(client.id,client);e.form.data={...clientData(),companyName:'Renamed Example Company'};e.form.elements.clientFirm.value='firm-1';e.save();
 const saved=JSON.parse(e.storage.get(clientKey))[0];assert.equal(saved.id,client.id);assert.equal(saved.importReference,client.importReference);assert.equal(saved.tasks[0].id,'existing-task');assert.equal(saved.kyc.verified,true);assert.equal(saved.contact.custom,'keep');assert.equal(saved.reportSigned,true);assert.equal(saved.previousNames[0],'Example Company');assert.equal(saved.profileStatus,'Details complete');
});
test('incomplete client can be saved, missing flags recalculate when filled',()=>{
 const e=clientEnvironment();e.form.data={companyName:'Partial Example',tradingName:'',contactName:'',jobTitle:'',email:'',phone:'',engagementLetter:'',notes:'',services:[]};e.form.elements.clientFirm.value='';e.save();const saved=JSON.parse(e.storage.get(clientKey))[0];assert.equal(saved.profileStatus,'Draft');assert.equal(saved.tasks.length,0);assert.ok(saved.missingFields.includes('Branch location'));assert.equal(e.api.missing(client).length,0);
});
test('client stale edits, firm reassignment and unauthorized edits fail closed',()=>{
 for(const scenario of ['stale','firm','role']){
  const e=clientEnvironment(scenario==='role'?'Audit Assistant':'Manager');e.storage.set(clientKey,JSON.stringify([scenario==='stale'?{...client,notes:'Concurrent edit'}:client]));e.api.setEdit(client.id,client);e.form.data={...clientData(),notes:'Modified'};e.form.elements.clientFirm.value=scenario==='firm'?'firm-2':'firm-1';const before=e.storage.get(clientKey);e.save();assert.equal(e.storage.get(clientKey),before);assert.ok(e.notices.clientProfileNotice.textContent);
 }
});
test('legacy-name and ID lead matching retains relationships after a rename',()=>{
 const e=environment();const app=fs.readFileSync(path.join(root,'app_group_workspace_firms_v5.js'),'utf8');vm.runInContext(app.split('\n').filter(l=>l.startsWith('function normaliseName(')||l.startsWith('function clientMatchesLead(')).join('\n'),e.context);assert.equal(e.context.clientMatchesLead({...client,companyName:'New Name',previousNames:['Example Company']},{companyName:'Example Company'}),true);assert.equal(e.context.clientMatchesLead(client,{clientId:client.id,companyName:'Different snapshot'}),true);assert.equal(e.context.clientMatchesLead(client,{clientId:'other',companyName:client.companyName}),false);
});

test('both Partners and Managers can reopen and edit a newly created staff profile without duplication',()=>{
 for(const role of ['Engagement Partner','Manager']){
  const e=staffEnvironment(role);e.form.data=staffData();e.api.saveProfile(e.form);
  const created=JSON.parse(e.storage.get(staffKey))[0];assert.equal(created.position,'Audit Assistant');
  e.api.setEdit(created.staffId,created);e.form.data={...staffData(created),fullName:'Updated Example Staff',position:'Audit Supervisor',employmentType:'Permanent'};e.api.saveProfile(e.form);
  const records=JSON.parse(e.storage.get(staffKey));assert.equal(records.length,1);const saved=records[0];assert.equal(saved.staffId,created.staffId);assert.equal(saved.createdAt,created.createdAt);assert.equal(saved.position,'Audit Supervisor');assert.equal(saved.employmentType,'Permanent');assert.equal(saved.accountStatus,created.accountStatus);assert.equal(saved.changeHistory.length,1);
 }
});

test('both Partners and Managers can complete an existing client draft and edit it again',()=>{
 for(const role of ['Engagement Partner','Manager']){
  const e=clientEnvironment(role);e.form.data={companyName:'Draft Example',tradingName:'',contactName:'',jobTitle:'',email:'',phone:'',engagementLetter:'',notes:'',services:[]};e.form.elements.clientFirm.value='';e.save();
  const draft=JSON.parse(e.storage.get(clientKey))[0];assert.equal(draft.profileStatus,'Draft');
  e.api.setEdit(draft.id,draft);e.form.data={...clientData(),companyName:'Draft Example'};e.form.elements.clientFirm.value='firm-1';e.save();
  const completed=JSON.parse(e.storage.get(clientKey))[0];assert.equal(completed.id,draft.id);assert.equal(completed.importReference,draft.importReference);assert.equal(completed.profileStatus,'Details complete');assert.equal(completed.eqrCompleted,false);assert.equal(completed.reportSigned,false);
  e.api.setEdit(completed.id,completed);e.form.data={...clientData(completed),phone:'+254700000001'};e.form.elements.clientFirm.value='firm-1';e.save();
  const records=JSON.parse(e.storage.get(clientKey));assert.equal(records.length,1);assert.equal(records[0].contact.phone,'+254700000001');assert.equal(records[0].createdAt,draft.createdAt);assert.equal(records[0].changeHistory.length,2);
 }
});

test('other categories cannot edit an existing client even with System Administration permission',()=>{
 for(const role of ['Audit Supervisor','Audit Assistant','Intern']){
  const e=clientEnvironment(role);e.storage.set(roleKey,JSON.stringify({category:role,permissions:['System Administration']}));e.storage.set(clientKey,JSON.stringify([client]));e.api.setEdit(client.id,client);e.form.data={...clientData(),companyName:'Unauthorised change'};e.form.elements.clientFirm.value='firm-1';e.save();
  assert.deepEqual(JSON.parse(e.storage.get(clientKey)),[client]);assert.match(e.notices.clientProfileNotice.textContent,/Only Engagement Partners and Managers/);
 }
});

test('removing editing permission while a profile is open blocks both save actions',()=>{
 const s=staffEnvironment('Manager');s.storage.set(staffKey,JSON.stringify([staff]));s.api.setEdit(staff.staffId,staff);s.form.data={...staffData(),fullName:'Unsaved change'};s.storage.set(roleKey,JSON.stringify({category:'Audit Assistant',permissions:[]}));s.api.saveProfile(s.form);assert.deepEqual(JSON.parse(s.storage.get(staffKey)),[staff]);
 const c=clientEnvironment('Engagement Partner');c.storage.set(clientKey,JSON.stringify([client]));c.api.setEdit(client.id,client);c.form.data={...clientData(),companyName:'Unsaved change'};c.form.elements.clientFirm.value='firm-1';c.storage.set(roleKey,JSON.stringify({category:'Intern',permissions:[]}));c.save();assert.deepEqual(JSON.parse(c.storage.get(clientKey)),[client]);
});
