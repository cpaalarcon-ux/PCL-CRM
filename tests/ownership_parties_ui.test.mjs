// Step 3 (joined-practice review): the register screen, the server actions, the rights and the release counts.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {registerStatus,shareholdingTotal,groupLine,partiesSection,partyFormFields,groupFormFields,PARTY_ROLES,EXPECTATION_NOTE} from '../staff-parties.mjs';
import {STAFF_RIGHTS,rightForAction} from '../supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const P=(o)=>({party_id:o.id||'p'+Math.random(),client_id:'c1',role:'Director',party_kind:'Individual',full_name:'Fictional Person',appointed_on:'2024-01-01',revision:1,...o});
const table=(heads,rows)=>`<table><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const button=(a,l,id='')=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const sd=v=>String(v||'').slice(0,10),names={c2:'Holding <Ltd>',c1:'Operating Ltd'},clientName=id=>names[id]||'another client';

test('shareholding total ignores ended entries and non-shareholders',()=>{
 assert.equal(shareholdingTotal([P({role:'Shareholder',shareholding_percentage:'60.0000'}),P({role:'Shareholder',shareholding_percentage:'40'}),P({role:'Shareholder',shareholding_percentage:'25',ceased_on:'2025-01-01'}),P({role:'Director'})]),100);
 assert.equal(shareholdingTotal([]),0);assert.equal(shareholdingTotal([P({role:'Shareholder',shareholding_percentage:'33.3333'}),P({role:'Shareholder',shareholding_percentage:'33.3333'})]),66.6666);
});
test('register status: optional, gaps, complete',()=>{
 assert.equal(registerStatus({expects:[],issues:[]},[]).tone,'neutral');
 const gap=registerStatus({expects:['Director','Shareholder'],issues:['No current director is recorded']},[]);assert.equal(gap.tone,'warn');assert.match(gap.text,/No current director is recorded/);
 const ok=registerStatus({expects:['Trustee'],issues:[]},[]);assert.equal(ok.tone,'ok');assert.match(ok.text,/Complete for this legal structure \(trustee\)/);
 assert.equal(registerStatus(undefined,[]).tone,'neutral','a client the server did not report is optional, not an error');
});
test('group line',()=>{
 assert.match(groupLine(null,clientName),/has not been recorded/);
 assert.match(groupLine({group_status:'Standalone'},clientName),/Standalone/);
 assert.match(groupLine({group_status:'Part of a group',ultimate_parent_name:'Foreign GmbH',ultimate_parent_country:'Germany',operates_in_other_countries:'Yes'},clientName),/Foreign GmbH \(Germany\).*other countries: Yes/);
 assert.match(groupLine({group_status:'Part of a group',ultimate_parent_client_id:'c2'},clientName),/Holding <Ltd>/,'the caller escapes');
});
test('section: rows, links, ended entries, escaping, and no buttons without leader rights',()=>{
 const parties=[P({id:'d1',role:'Director',full_name:'Dir <One>'}),P({id:'s1',role:'Shareholder',party_kind:'Entity',full_name:'Holding <Ltd>',holder_client_id:'c2',shareholding_percentage:'100',share_class:'Ordinary'}),P({id:'old',role:'Shareholder',full_name:'Old Holder',shareholding_percentage:'10',ceased_on:'2025-02-01',end_reason:'Shares transferred away'}),P({id:'o1',client_id:'c2',role:'Shareholder',party_kind:'Entity',full_name:'Operating Ltd',holder_client_id:'c1',shareholding_percentage:'30'})];
 const args={client:{client_id:'c1'},parties:parties.filter(p=>p.client_id==='c1'),everyParty:parties,status:{expects:['Director','Shareholder'],issues:[]},group:{group_status:'Standalone',note:'Checked <b>'},clientName,table,button,shortDate:sd};
 const html=partiesSection({...args,leader:true});
 assert.match(html,/Dir &lt;One&gt;/);assert.doesNotMatch(html,/Dir <One>/);
 assert.match(html,/client: Holding &lt;Ltd&gt;/);assert.match(html,/100%/);assert.match(html,/add up to <b>100%/);
 assert.match(html,/Ended entries \(1\)/);assert.match(html,/Shares transferred away/);
 assert.match(html,/data-suite="party-new"/);assert.match(html,/data-suite="party-end" data-id="d1"/);assert.match(html,/data-suite="group-edit"/);
 assert.match(html,/This client also holds shares in: Holding &lt;Ltd&gt; \(30%\)/);
 assert.match(html,/Checked &lt;b&gt;/);
 assert.match(html,new RegExp(EXPECTATION_NOTE.slice(0,40)));assert.match(html,/Top-up tax and similar rules wait for the Tax Lead/);
 const ro=partiesSection({...args,leader:false});assert.doesNotMatch(ro,/data-suite="party-new"|data-suite="party-end"|data-suite="group-edit"/);
});
test('forms offer the right fields',()=>{
 const f=(n,l,v='',t='text',x='')=>`<f ${n}>`,s=(n,l,items)=>`<s ${n} ${JSON.stringify(items)}>`,a=(n)=>`<a ${n}>`;
 const party=partyFormFields({field:f,select:s,area:a,clientOptions:[['c9','Nine']]});
 for(const n of ['role','party_kind','full_name','identity_reference','kra_pin','holder_client_id','shareholding_percentage','share_class','appointed_on','change_reason'])assert.match(party,new RegExp('<[fsa] '+n+'[ >]'),n);
 assert.deepEqual(PARTY_ROLES,['Director','Shareholder','Trustee']);
 const grp=groupFormFields({field:f,select:s,area:a,clientOptions:[],group:null});
 for(const n of ['group_status','ultimate_parent_client_id','ultimate_parent_name','ultimate_parent_country','operates_in_other_countries','note'])assert.match(grp,new RegExp('<[fsa] '+n+'[ >]'),n);
});
test('server: actions, snapshot, and friendly checks mirror the database',()=>{
 const s=rd(fx+'engagement-actions.ts');
 for(const act of ['party_add','party_end','group_profile_save'])assert.match(s,new RegExp("p\\.action==='"+act+"'"));
 assert.match(s,/'owner_add','party_add','party_end','group_profile_save','licence_add','licence_end','engagement_checklist','reference_service_add','reference_service_confirm','engagement_read'/);
 assert.match(s,/const parties=await tx`select party_id,role,full_name,holder_client_id,shareholding_percentage,appointed_on from erp_private\.client_parties/);
 assert.match(s,/ownership_reaches/);assert.match(s,/exceed 100 percent/);assert.match(s,/Record why this ended or was entered in error/);
 assert.match(s,/kycChanged\(tx,a,cid,before,\['PARTIES_'\+role\.toUpperCase\(\)\]/,'a verified KYC file goes back for re-verification');
 assert.doesNotMatch(s,/delete from erp_private\.client_parties/);
});
test('rights: a Manager or Partner records the register; nobody below does',()=>{
 for(const act of ['party_add','party_end','group_profile_save']){assert.equal(rightForAction(act),'client.owners',act);}
 assert.deepEqual(STAFF_RIGHTS.find(r=>r.code==='client.owners').roles,['PARTNER','MANAGER']);
 assert.equal(rd('staff-rights-catalog.mjs'),rd(fx+'staff-rights-catalog.mjs'));
 assert.match(rd(fx+'staff-access-control.mjs'),/owner_add\|party_add\|party_end\|group_profile_save\|licence_add\|licence_end\|contact_save/);
});
test('read path and release counts',()=>{
 const r=rd(fx+'suite-actions.ts');assert.match(r,/'parties',\(select/);assert.match(r,/'group_profiles',\(select/);assert.match(r,/'ownership_status',\(select coalesce\(jsonb_agg\(x\),'\[\]'\) from \(select \* from erp_private\.ownership_status_all\(\)\)x\)/);
 const t=rd(fx+'tax-config-actions.ts');assert.match(t,/ownership_status_all\(\) where cardinality\(issues\)>0\) ownership_register_gaps/);assert.match(t,/group_unassessed_count\(\) clients_group_status_not_recorded/);
});
test('screen wiring and build label',()=>{
 const s=rd('staff-suite.mjs');
 assert.match(s,/import \{partiesSection,partyFormFields,groupFormFields\} from '\.\/staff-parties\.mjs\?v=\d{8}-[a-z0-9-]+'/);
 for(const a of ['party-new','party-end','group-edit'])assert.match(s,new RegExp("action==='"+a+"'"));
 assert.match(s,/'party_add',\{client_id:id\}/);assert.match(s,/'party_end',\{party_id:p\.party_id,revision:p\.revision\}/);assert.match(s,/'group_profile_save',\{client_id:id,revision:g\?\.revision\}/);
 const rel=JSON.parse(rd(fx+'release.json')).build;assert.match(rel,/^2026-11-09\.\d{4}$/);assert.match(rd('staff-pilot.html'),new RegExp('data-build="'+rel.replace(/\./g,'\\.')+'"'));
});
test('migration: never deletes, never rewrites, tax thresholds untouched',()=>{
 const m=rd('supabase/migrations/20261109260000_ownership_parties.sql');
 assert.match(m,/CREATE TRIGGER no_delete BEFORE DELETE ON erp_private\.client_parties/);assert.match(m,/CREATE TRIGGER no_delete BEFORE DELETE ON erp_private\.client_group_profile/);
 assert.doesNotMatch(m,/DELETE FROM|UPDATE erp_private\.(clients|client_tax_profiles|beneficial_owners)/i);
 assert.doesNotMatch(m,/EUR|\b750\b|5,?000,?000/,'no tax threshold is stored');
 assert.match(m,/FORCE ROW LEVEL SECURITY/);
});
