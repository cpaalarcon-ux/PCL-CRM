import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {FIELDS,cleanValue} from '../supabase/functions/staff-workspace-v12/client-master-rules.mjs';
import {LAYOUT,gridKeys,kindOf,dateToIso,isoToDate,dayMonthToStored,storedToDayMonth,display,toStored,cellProblem,isMandatory,gridStatus,approvalTrail,otherRows} from '../staff-kyc-grid-rules.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('every cell on the page is a real client-master field, and none is placed twice',()=>{
 const keys=gridKeys(),known=new Set(FIELDS.map(f=>f.key));
 assert.equal(new Set(keys).size,keys.length);
 for(const k of keys)assert.ok(known.has(k),k+' is not in the server field catalogue');
 assert.deepEqual(LAYOUT.map(s=>s.title).slice(0,2),['PIN Details','Section A : Basic Information']);
});
test('dates and year end are read the way staff type them and stored the one way the server expects',()=>{
 assert.equal(dateToIso('5/3/2020'),'2020-03-05');assert.equal(dateToIso('05-03-2020'),'2020-03-05');assert.equal(dateToIso('2020-03-05'),'2020-03-05');
 assert.equal(dateToIso('31/02/2020'),null);assert.equal(dateToIso('29/02/2021'),null);assert.equal(dateToIso('29/02/2020'),'2020-02-29');assert.equal(dateToIso('nonsense'),null);
 assert.equal(isoToDate('2020-03-05'),'05/03/2020');
 assert.equal(dayMonthToStored('31/12'),'12-31');assert.equal(dayMonthToStored('31/04'),null);assert.equal(storedToDayMonth('12-31'),'31/12');
 assert.equal(toStored('commencement_date','5/3/2020'),'2020-03-05');assert.equal(display('commencement_date','2020-03-05'),'05/03/2020');
 assert.equal(toStored('year_end','31/12'),'12-31');assert.equal(display('year_end','12-31'),'31/12');
 assert.equal(kindOf('has_branches'),'yesno');assert.equal(kindOf('county'),'choice');assert.equal(kindOf('city_town'),'text');
 // What the page stores must pass the server's own check.
 for(const [k,t] of [['commencement_date','5/3/2020'],['year_end','31/12'],['postal_code','00100'],['legal_rep_pin','a000000001z']])assert.ok(cleanValue(k,toStored(k,t)).ok,k);
});
test('a typed cell is checked the way the server will check it, and a mandatory empty cell is flagged',()=>{
 assert.match(cellProblem('county','',{mandatory:true,hadValue:false}),/./);assert.equal(cellProblem('county','',{mandatory:false,hadValue:false}),null);
 assert.match(cellProblem('postal_code','abc',{mandatory:true}),/./);assert.equal(cellProblem('postal_code','00100',{mandatory:true}),null);
 assert.match(cellProblem('commencement_date','31/02/2020',{mandatory:true}),/./);
 assert.equal(isMandatory({optional:true}),false);assert.equal(isMandatory({extra:true}),false);assert.equal(isMandatory({key:'x'}),true);assert.equal(isMandatory(null),false);
});
test('the status bar restates today\'s rules and adds none',()=>{
 const R=(n,state,extra={})=>Array.from({length:n},(_,i)=>({key:'k'+i,state:state[i]||'Missing',fact:state[i]?{}:null,...extra}));
 assert.equal(gridStatus({rows:R(3,['Recorded'])}).code,'DRAFT');
 assert.equal(gridStatus({rows:R(3,['Recorded','Verified','Recorded'])}).code,'PENDING_VERIFICATION');
 assert.equal(gridStatus({rows:R(2,['Verified','Verified'])}).code,'VERIFIED');
 assert.equal(gridStatus({rows:R(2,['Verified','Verified']),eddNeeded:true,eddApproved:false}).code,'PENDING_PARTNER');
 assert.equal(gridStatus({rows:R(2,['Verified','Verified']),eddNeeded:true,eddApproved:true}).code,'VERIFIED');
 assert.equal(gridStatus({rows:R(2,['Verified','Verified']),structureKnown:false}).code,'DRAFT');
 const g=gridStatus({rows:[...R(2,['Verified','Verified']),{key:'opt',optional:true,fact:null,state:'Missing'}]});assert.equal(g.code,'VERIFIED','optional cells never block');
 assert.deepEqual(gridStatus({rows:R(3,['Recorded'])}).missing,['k1','k2']);
});
test('the approval trail only names people the server recorded',()=>{
 const t=approvalTrail([{fact:{recorded_by_name:'A',recorded_at:'2026-11-01',verified_by_name:'B',verified_at:'2026-11-03'}},{fact:{recorded_by_name:'A',recorded_at:'2026-11-02'}},{fact:null}]);
 assert.deepEqual(t.prepared,[{name:'A',first:'2026-11-01',last:'2026-11-02',n:2}]);assert.deepEqual(t.verified,[{name:'B',first:'2026-11-03',last:'2026-11-03',n:1}]);
 assert.deepEqual(otherRows([{key:'contact_person'},{key:'county'},{key:'zz',extra:true}]).map(r=>r.key),['contact_person']);
});
test('the grid is wired in, keeps the old list, and the migration asks for the iTax identity cells',()=>{
 const imp=rd('staff-improvements.mjs'),mig=rd('supabase/migrations/20261120100000_itax_profile_fields.sql'),css=rd('staff-pilot.css'),act=rd('supabase/functions/staff-workspace-v12/client-master-actions.ts');
 assert.match(imp,/staff-kyc-grid\.mjs\?v=20261122-loc-v1/);assert.match(imp,/if\(a==='master'\)await grid\.open\(id\)/);assert.match(imp,/if\(a==='master-list'\)await master\.open\(id\)/);
 assert.match(rd('staff-pilot.html'),/staff-pilot\.css\?v=20261118-approval-board-v1/);assert.match(css,/#editor:has\(\.kg\)/);assert.match(css,/\.kg-bad/);assert.match(css,/\.kg-star/);
 for(const k of ['street_road','city_town','county','postal_code','po_box'])assert.match(mig,new RegExp("'"+k+"','Required'"),k);
 assert.match(mig,/commencement_date/);assert.match(mig,/registered_address/);
 assert.match(act,/client_master_record_many/);assert.match(act,/client_master_verify_many/);
 assert.match(rd('staff-kyc-grid.mjs'),/client_master_record_many/);assert.match(rd('staff-kyc-grid.mjs'),/client_master_verify_many/);
});
