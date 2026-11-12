// Builds 2792-2793: the Excise duty dated-rule type (product code, unit, specific rate per unit). No rate is seeded.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]})),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const {registryParameters,validateCanonicalRate,taxTypes,exciseUnits,exciseBases}=await import('../'+fx+'tax-registry.mjs');

test('server: the basis decides which figures are needed, with plain messages',()=>{
 assert.ok(taxTypes.includes('Excise duty'));assert.deepEqual(exciseBases,['Amount per unit','Percentage of value']);
 const unit={excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5},pct={excise_basis:'Percentage of value',product_code:'2711.19.00',rate:10};
 assert.deepEqual(registryParameters('Excise duty',unit),unit);assert.deepEqual(registryParameters('Excise duty',pct),pct);
 assert.equal(registryParameters('Excise duty',{...unit,product_code:' 2711 '}).product_code,'2711');
 assert.throws(()=>registryParameters('Excise duty',{...unit,excise_basis:undefined}),/how the duty is worked out/);
 assert.throws(()=>registryParameters('Excise duty',{...unit,excise_basis:'Both'}),/how the duty is worked out/);
 for(const bad of ['','LPG','27.11'])assert.throws(()=>registryParameters('Excise duty',{...unit,product_code:bad}),/product code as the tariff heading/);
 assert.throws(()=>registryParameters('Excise duty',{...unit,unit:'Barrel'}),/Choose the unit/);
 assert.throws(()=>registryParameters('Excise duty',{...unit,unit:undefined}),/Choose the unit/);
 for(const bad of [undefined,-1,'abc'])assert.throws(()=>registryParameters('Excise duty',{...unit,rate_per_unit:bad}),/duty per unit/);
 for(const bad of [undefined,-1,101,'abc'])assert.throws(()=>registryParameters('Excise duty',{...pct,rate:bad}),/duty \(% of value\)/);
 assert.equal('rate' in registryParameters('Excise duty',{...unit,rate:50}),false,'a per-unit rule never keeps a percentage');
 const switched=registryParameters('Excise duty',{...pct,unit:'Litre',rate_per_unit:9});assert.equal('unit' in switched,false);assert.equal('rate_per_unit' in switched,false,'switching to a percentage drops the per-unit figures');
 assert.ok(exciseUnits.includes('Litre')&&exciseUnits.includes('Kilogram'));
});

test('server: an excise code must use the Excise duty type; other types keep their rules',()=>{
 assert.throws(()=>validateCanonicalRate('KE_EXCISE_LPG','VAT',{}),/requires the Excise duty rule type/);
 validateCanonicalRate('KE_EXCISE_LPG','Excise duty',{product_code:'2711.19.00'});
 assert.throws(()=>validateCanonicalRate('KE_VAT_STD','Excise duty',{}),/requires the VAT rule type/);
 validateCanonicalRate('KE_SOMETHING_ELSE','Excise duty',{});
});

test('database: the type is allowed, one placeholder exists with no figures, Pending and Draft, no rate invented',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 const rows=(await db.query(`select rate_key,tax_type,status,legal_review_status,parameters,is_test from erp_private.tax_rates where tax_type='Excise duty'`)).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].rate_key,'KE_EXCISE_LPG');assert.equal(rows[0].status,'Draft');assert.equal(rows[0].legal_review_status,'Pending');assert.deepEqual(rows[0].parameters,{});
 await assert.rejects(()=>db.exec(`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note) values('X','Not a type','x','2026-01-01','2026-12-31','{}','','')`),/tax_rates_tax_type_check/);
 await db.exec(`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,is_test) values('KE_EXCISE_FICTIONAL','Excise duty','Fictional excise','2027-01-01','2027-12-31','{"product_code":"2711.19.00","unit":"Kilogram","rate_per_unit":1}','','',true)`);
 const mig=rd('supabase/migrations/20261112010000_excise_rule_type.sql');
 assert.equal((mig.match(/INSERT INTO erp_private\.tax_rates/g)||[]).length,1);assert.doesNotMatch(mig,/forensic|ISRS 4000/i);
 assert.doesNotMatch(mig.split('\n').filter(l=>!l.startsWith('--')).join('\n').match(/INSERT[\s\S]*$/)[0],/"rate_per_unit"|"rate"\s*:/,'no figure is seeded');
});

const dom=new JSDOM('<!doctype html><dialog id="editor"><div id="editorBody"></div></dialog>');globalThis.document=dom.window.document;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(items,value,blank='Choose…')=>`<option value="">${esc(blank)}</option>`+items.map(x=>{let [v,l]=Array.isArray(x)?x:[x,x];return `<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`;}).join('');
const field=(name,label,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,items,value='',blank='Choose…')=>`<label>${label}<select name="${name}">${options(items,value,blank)}</select></label>`;
const rates=[{rate_id:'x1',rate_key:'KE_EXCISE_LPG',tax_type:'Excise duty',label:'Excise duty on LPG (rate pending)',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{},status:'Draft',legal_review_status:'Pending',revision:1}];
let submit=null,sent=[];
const ctx={$:s=>document.querySelector(s),esc,field,select,form:(b,l='Save')=>`<form id="editForm">${b}<button type="submit">${l}</button></form>`,
 modal:(t,h,fn)=>{document.querySelector('#editorBody').innerHTML=h;submit=fn;},request:async p=>{sent.push(p);return {ok:true};},shortDate:v=>v,badge:v=>v,today:()=>'2026-11-12',table:()=>'',button:(a,l)=>`<button>${l}</button>`,
 area:(n,l,v='')=>`<label>${l}<textarea name="${n}">${esc(v)}</textarea></label>`,check:(n,l,y=false)=>`<label><input type="checkbox" name="${n}" ${y?'checked':''}>${l}</label>`,
 data:()=>({me:{category_code:'MANAGER',staff_id:'m1'},suite:{rates,release:null},clients:[],firms:[]}),render(){}};
const {createTaxConfigUI}=await import('../staff-tax-config.mjs');const ui=createTaxConfigUI(ctx);
const F=()=>document.querySelector('#editForm'),el=n=>F().elements[n];

test('form: Excise duty asks how the duty is worked out and then shows only the boxes that apply',async()=>{
 await ui.handle('rate-new','');
 el('rule_choice').value='KE_EXCISE_LPG';el('rule_choice').dispatchEvent(new dom.window.Event('change'));
 assert.equal(el('tax_type').value,'Excise duty');
 assert.equal(el('excise_basis').tagName,'SELECT');assert.ok(el('excise_basis').required);assert.deepEqual([...el('excise_basis').options].map(o=>o.value).slice(1),exciseBases);
 assert.ok(el('product_code').required);assert.match(el('product_code').getAttribute('pattern'),/\\d\{4\}/);assert.equal(el('product_code').value,'');
 const unitBox=document.querySelector('[data-basis="Amount per unit"]'),pctBox=document.querySelector('[data-basis="Percentage of value"]');
 assert.ok(unitBox.hidden&&pctBox.hidden,'nothing shows until a basis is chosen');
 el('excise_basis').value='Amount per unit';el('excise_basis').dispatchEvent(new dom.window.Event('change'));
 assert.ok(!unitBox.hidden&&pctBox.hidden);assert.equal(el('rate').disabled,true,'the hidden percentage box cannot block saving');assert.equal(el('unit').disabled,false);
 assert.equal(el('rate_per_unit').type,'number');assert.equal(el('rate_per_unit').value,'','blank, never 0');assert.ok(el('rate_per_unit').required);assert.deepEqual([...el('unit').options].map(o=>o.value).slice(1),exciseUnits);
 el('product_code').value='2711.19.00';el('unit').value='Kilogram';el('rate_per_unit').value='12.5';
 await submit(new dom.window.FormData(F()));
 let p=sent.at(-1);assert.equal(p.rate_key,'KE_EXCISE_LPG');assert.deepEqual(p.parameters,{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5});
 el('excise_basis').value='Percentage of value';el('excise_basis').dispatchEvent(new dom.window.Event('change'));
 assert.ok(unitBox.hidden&&!pctBox.hidden);assert.equal(el('unit').disabled,true);assert.equal(el('rate').max,'100');
 el('rate').value='10';await submit(new dom.window.FormData(F()));
 p=sent.at(-1);assert.deepEqual(p.parameters,{excise_basis:'Percentage of value',product_code:'2711.19.00',rate:10},'only the boxes shown are sent');
});

test('form: editing the placeholder shows the rule as fixed text with blank excise boxes',async()=>{
 await ui.handle('rate-edit','x1');
 assert.ok(!el('rule_choice'));assert.equal(el('tax_type').type,'hidden');assert.equal(el('product_code').value,'');assert.equal(el('rate_per_unit').value,'');
 assert.match(document.querySelector('#editorBody').textContent,/Excise duty · code KE_EXCISE_LPG/);
});

// ---- Build 2793: excise products on the client tax profile ----
const {exciseProducts,validateProfile}=await import('../'+fx+'tax-registry.mjs');
const okLine={rate_key:'KE_EXCISE_LPG',registration_reference:'EXC-FICT-001',effective_from:'2026-01-01',effective_to:'2026-12-31'};

test('server: excise products need the Excise duty position, a rule, dates inside the profile, and no overlap',()=>{
 assert.deepEqual(exciseProducts([],['VAT'],null,null),[]);assert.deepEqual(exciseProducts(undefined,['VAT'],null,null),[]);
 assert.deepEqual(exciseProducts([okLine],['Excise duty'],'2026-01-01','2026-12-31'),[okLine]);
 assert.throws(()=>exciseProducts([okLine],['VAT'],'2026-01-01','2026-12-31'),/Tick the Excise duty position/);
 assert.throws(()=>exciseProducts([{...okLine,rate_key:'KE_VAT_STD'}],['Excise duty'],null,null),/Choose the excise rule/);
 assert.throws(()=>exciseProducts([{...okLine,rate_key:''}],['Excise duty'],null,null),/Choose the excise rule/);
 assert.throws(()=>exciseProducts([{...okLine,effective_to:''}],['Excise duty'],null,null),/dates each excise product/);
 assert.throws(()=>exciseProducts([{...okLine,effective_to:'2025-12-31'}],['Excise duty'],null,null),/cannot end before it starts/);
 assert.throws(()=>exciseProducts([{...okLine,effective_from:'2025-12-01'}],['Excise duty'],'2026-01-01','2026-12-31'),/within the profile dates/);
 assert.throws(()=>exciseProducts([okLine,{...okLine,effective_from:'2026-06-01'}],['Excise duty'],null,null),/twice for overlapping dates/);
 assert.equal(exciseProducts([okLine,{...okLine,effective_from:'2027-01-01',effective_to:'2027-12-31'}],['Excise duty'],null,null).length,2,'the same rule in separate periods is fine');
 assert.throws(()=>exciseProducts('x',['Excise duty'],null,null),/must be a list/);
 assert.throws(()=>exciseProducts(Array.from({length:21},(_,i)=>({...okLine,effective_from:`20${30+i}-01-01`,effective_to:`20${30+i}-12-31`})),['Excise duty'],null,null),/at most 20/);
 assert.equal(exciseProducts([{...okLine,registration_reference:undefined}],['Excise duty'],null,null)[0].registration_reference,'');
 assert.ok(!JSON.stringify(exciseProducts([okLine],['Excise duty'],null,null)).match(/rate_per_unit|product_code|unit/),'only the rule key is held, never the figures');
});

test('server: validateProfile carries the list and refuses it without the position',()=>{
 const base={entity_type:'Company',residency:'Resident',regime:'Standard',obligations:['Company','Excise duty'],effective_from:'2026-01-01',effective_to:'2026-12-31',notes:'Fictional note',obligation_statuses:{}};
 assert.deepEqual(validateProfile({...base,excise_products:[okLine]}).excise_products,[okLine]);
 assert.deepEqual(validateProfile(base).excise_products,[]);
 assert.throws(()=>validateProfile({...base,obligations:['Company'],excise_products:[okLine]}),/Tick the Excise duty position/);
});

test('database: the list is a bounded array, defaults empty, and a verified profile stays immutable',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 const col=(await db.query(`select column_default,is_nullable from information_schema.columns where table_schema='erp_private' and table_name='client_tax_profiles' and column_name='excise_products'`)).rows[0];
 assert.ok(col&&col.is_nullable==='NO'&&/\[\]/.test(col.column_default));
 const cid=crypto.randomUUID(),sid=crypto.randomUUID(),pid=crypto.randomUUID();
 await db.query(`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status) values($1,null,'X','x','Fictional','MANAGER','Permanent','2027-12-31','Active')`,[sid]).catch(()=>{});
 const ins=(extra)=>db.query(`insert into erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,created_by,excise_products) values($1,$2,'Company','Resident','Standard',array['Company'],'2026-01-01','2026-12-31','n',$3,$4)`,[crypto.randomUUID(),cid,sid,extra]);
 await db.exec('set session_replication_role=replica');
 await db.query(`insert into erp_private.clients(client_id,company_name,kra_pin) values($1,'Fictional','A000000999Z')`,[cid]).catch(()=>{});
 await assert.rejects(()=>ins('{"a":1}'),/excise_products_check/,'an object is refused');
 await assert.rejects(()=>ins(JSON.stringify(Array.from({length:21},()=>({})))),/excise_products_check/,'more than 20 is refused');
 await ins(JSON.stringify([{rate_key:'KE_EXCISE_LPG'}]));await ins('[]');
 const mig=rd('supabase/migrations/20261112020000_client_excise_products.sql');assert.doesNotMatch(mig,/forensic|ISRS 4000/i);assert.doesNotMatch(mig,/INSERT INTO/i,'no rate or product is seeded');
});

const profileRates=[{rate_id:'x1',rate_key:'KE_EXCISE_LPG',tax_type:'Excise duty',label:'Excise duty on LPG (rate pending)',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{},status:'Draft'},
 {rate_id:'v1',rate_key:'KE_VAT_STD',tax_type:'VAT',label:'VAT standard',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{rate:16},status:'Approved'}];
const client={client_id:'c1',company_name:'UAT Fictional LPG Distributors Ltd',legal_structure:'Limited Company',legal_subtype:'Private Limited Company'};
let profiles=[];
const pdom=new JSDOM('<!doctype html><dialog id="editor"><div id="editorBody"></div></dialog>');
test('form: the excise section appears with the position, offers rules from a list, and sends only rule, reference and dates',async()=>{
 globalThis.document=pdom.window.document;let pSubmit=null,pSent=[];
 const pctx={...ctx,$:s=>document.querySelector(s),modal:(t,h,fn)=>{document.querySelector('#editorBody').innerHTML=h;pSubmit=fn;},request:async x=>{pSent.push(x);return {ok:true};},
  button:(a,l,id='')=>`<button type="button" data-action="${a}" data-id="${id}">${l}</button>`,
  data:()=>({me:{category_code:'MANAGER',staff_id:'m1'},suite:{rates:profileRates,tax_profiles:profiles,legal_structure_tax_defaults:[],release:null},clients:[client],firms:[],client_firms:[]})};
 const pui=createTaxConfigUI(pctx);
 await pui.handle('tax-profile','c1');
 const f=()=>document.querySelector('#editForm'),box=()=>document.querySelector('#exciseSection');
 assert.ok(box().hidden,'hidden until the Excise duty position is ticked');
 const tick=f().querySelector('[name="obligations"][value="Excise duty"]');assert.ok(tick,'the position exists');
 tick.checked=true;tick.dispatchEvent(new pdom.window.Event('change',{bubbles:true}));
 assert.ok(!box().hidden);
 await pui.handle('excise-add','');const e=f().elements;
 assert.deepEqual([...e.ex_rule_0.options].map(o=>o.value),['','KE_EXCISE_LPG'],'only excise rules are offered');
 assert.match([...e.ex_rule_0.options][1].textContent,/Excise duty on LPG · KE_EXCISE_LPG/);
 assert.ok(e.ex_rule_0.required);assert.equal(e.ex_from_0.value,e.effective_from.value,'dates start as the profile dates');assert.equal(e.ex_to_0.value,e.effective_to.value);
 assert.ok(!f().querySelector('[name*="product"],[name*="rate_per_unit"],[name*="unit"]'),'no product code, unit or rate boxes on the client');
 e.ex_rule_0.value='KE_EXCISE_LPG';e.ex_ref_0.value='EXC-FICT-001';
 e.effective_from.value='2026-03-01';e.effective_from.dispatchEvent(new pdom.window.Event('change',{bubbles:true}));assert.equal(e.ex_from_0.value,'2026-03-01','a row that followed the profile start keeps following it');
 await pui.handle('excise-add','');assert.ok(e.ex_rule_1);await pui.handle('excise-remove','1');assert.equal(e.ex_rule_1,undefined);
 await pSubmit(new pdom.window.FormData(f()));
 const sent1=pSent.at(-1);assert.equal(sent1.action,'tax_profile_save');assert.deepEqual(sent1.excise_products,[{rate_key:'KE_EXCISE_LPG',registration_reference:'EXC-FICT-001',effective_from:'2026-03-01',effective_to:sent1.excise_products[0].effective_to}]);
 tick.checked=false;tick.dispatchEvent(new pdom.window.Event('change',{bubbles:true}));assert.ok(box().hidden);
 await pSubmit(new pdom.window.FormData(f()));assert.deepEqual(pSent.at(-1).excise_products,[],'a hidden list is never sent');
});
