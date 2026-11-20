import test from 'node:test';import assert from 'node:assert/strict';
import {NOTE_FIELDS,NOTE_MAX,cleanNote,validateNotes,sameNotes,blankNotes,snapshotNotes,printable,packKindForReport,packState,canSign,validateFiling,signOffFor,registerSummary,PACK_KINDS,REPORT_KINDS} from '../supabase/functions/staff-workspace-v12/report-notes-rules.mjs';
test('the three notes are named, and only the first two print',()=>{
 assert.deepEqual(NOTE_FIELDS.map(f=>[f.key,f.label,f.prints]),[['client_highlights','Client highlights',true],['information_required','Information required',true],['internal_notes','Internal notes',false]]);
});
test('a note is cleaned before it is kept and is limited in length',()=>{
 assert.equal(cleanNote('  Hello\r\nworld  \t\n\n\n\n\n\nEnd\u0007 '),'Hello\nworld\n\n\nEnd');assert.equal(cleanNote(null),'');
 const v=validateNotes({client_highlights:' Sales up. ',information_required:'',internal_notes:'Call.'});assert.deepEqual(v.notes,{client_highlights:'Sales up.',information_required:'',internal_notes:'Call.'});
 assert.match(validateNotes({client_highlights:'x'.repeat(NOTE_MAX+1)}).error,/Client highlights: keep it to 3000 characters \(it is 3001\)/);assert.match(validateNotes({internal_notes:'x'.repeat(NOTE_MAX+1)}).error,/Internal notes/);
 assert.deepEqual(validateNotes({}).notes,{client_highlights:'',information_required:'',internal_notes:''},'all blank is allowed: it clears the notes');
 assert.equal(validateNotes({client_highlights:'x'.repeat(NOTE_MAX)}).error,undefined);
});
test('what is signed off holds the two client notes only, and nothing when both are blank',()=>{
 assert.equal(snapshotNotes(null),undefined);assert.equal(snapshotNotes({client_highlights:'  ',information_required:'',internal_notes:'Secret'}),undefined,'internal notes alone never reach the snapshot');
 assert.deepEqual(snapshotNotes({client_highlights:'A',information_required:'',internal_notes:'Secret'}),{client_highlights:'A',information_required:''});
 const s=snapshotNotes({client_highlights:'A',information_required:'B',internal_notes:'Secret'});assert.ok(!('internal_notes' in s));assert.ok(!JSON.stringify(s).includes('Secret'));
});
test('a blank client note prints as None and the internal notes never print',()=>{
 assert.deepEqual(printable(null),{client_highlights:'None',information_required:'None'});assert.deepEqual(printable({client_highlights:'  ',information_required:'Send the statement.',internal_notes:'Secret'}),{client_highlights:'None',information_required:'Send the statement.'});
 assert.ok(!JSON.stringify(printable({internal_notes:'Secret'})).includes('Secret'));
 assert.equal(sameNotes({client_highlights:'a '},{client_highlights:'a'}),true);assert.equal(sameNotes({internal_notes:'a'},{internal_notes:'b'}),false);assert.equal(blankNotes({}),true);assert.equal(blankNotes({internal_notes:'x'}),false);
});
test('a pack is Draft, Generated, Signed or Filed by its facts',()=>{
 const base={is_final:true,review_id:null,lock_id:null,generated_by:'g'};
 assert.equal(packState({pack:{...base,is_final:false}}).status,'Draft');assert.equal(packState({pack:base}).status,'Generated');
 assert.deepEqual([packState({pack:{...base,review_id:'r'}}).status,packState({pack:{...base,review_id:'r'}}).signed_via],['Signed','report review']);
 assert.equal(packState({pack:{...base,lock_id:'k'}}).signed_via,'audit lock');assert.equal(packState({pack:base,events:[{event:'Signed'}]}).signed_via,'recorded sign-off');
 assert.equal(packState({pack:base,events:[{event:'Signed'},{event:'Filed'}]}).status,'Filed');assert.equal(packState({pack:{...base,is_final:false},events:[]}).status,'Draft');
});
test('who signs: a Manager or Partner who did not generate it, or the only Partner, on the record',()=>{
 const pack={is_final:true,review_id:null,lock_id:null,generated_by:'g'},mgr={category_code:'MANAGER',staff_id:'m'},ptn={category_code:'PARTNER',staff_id:'p'};
 assert.equal(canSign({pack,actor:mgr}).ok,true);assert.equal(canSign({pack,actor:{category_code:'ASSISTANT',staff_id:'a'}}).ok,false);
 assert.equal(canSign({pack,actor:{...mgr,staff_id:'g'}}).ok,false);assert.equal(canSign({pack,actor:{...ptn,staff_id:'g'}}).ok,false,'a Partner who generated it needs to be the only Partner');
 assert.deepEqual(canSign({pack,actor:{...ptn,staff_id:'g'},soleActivePartner:true}),{ok:true,sole:true,reason:''});assert.equal(canSign({pack,actor:{...mgr,staff_id:'g'},soleActivePartner:true}).ok,false,'only a Partner has the sole-Partner exception');
 assert.match(canSign({pack:{...pack,is_final:false},actor:mgr}).reason,/draft pack cannot be signed/);assert.match(canSign({pack:{...pack,review_id:'r'},actor:mgr}).reason,/signed already/);assert.match(canSign({pack,events:[{event:'Signed'},{event:'Filed'}],actor:mgr}).reason,/filed/);
});
test('the filing record needs a date that is not in the future, and a reference',()=>{
 const ok=validateFiling({filed_on:'2026-02-05',reference:'  Emailed   to the director ',note:' ',today:'2026-02-10',as_of:'2026-01-31'});assert.deepEqual(ok,{filed_on:'2026-02-05',reference:'Emailed to the director',note:null});
 assert.match(validateFiling({filed_on:'2026-02-11',reference:'abc',today:'2026-02-10'}).error,/cannot be in the future/);assert.match(validateFiling({filed_on:'2026-01-30',reference:'abc',today:'2026-02-10',as_of:'2026-01-31'}).error,/before the date it reports on/);
 assert.match(validateFiling({filed_on:'nope',reference:'abc',today:'2026-02-10'}).error,/Enter the date/);assert.match(validateFiling({filed_on:'2026-02-05',reference:'ab',today:'2026-02-10'}).error,/at least 3 characters/);
 assert.match(validateFiling({filed_on:'2026-02-05',reference:'x'.repeat(201),today:'2026-02-10'}).error,/200 characters/);assert.match(validateFiling({filed_on:'2026-02-05',reference:'abc',note:'x'.repeat(501),today:'2026-02-10'}).error,/500 characters/);
 assert.match(validateFiling({filed_on:'2026-02-30',reference:'abc',today:'2026-03-10'}).error,/Enter the date/);
});
test('a pack carries a sign-off only when it exists for exactly these figures',()=>{
 const rv={review_id:'r',status:'Approved',snapshot_digest:'f1',reviewed_by:'m',prepared_by:'a'};
 assert.deepEqual(signOffFor({packKind:'Monthly filing pack',final:true,review:rv,fingerprint:'f1'}),{review_id:'r',lock_id:null});
 assert.deepEqual(signOffFor({packKind:'Monthly filing pack',final:true,review:rv,fingerprint:'other'}),{review_id:null,lock_id:null});
 assert.deepEqual(signOffFor({packKind:'Monthly filing pack',final:true,review:{...rv,status:'Submitted'},fingerprint:'f1'}),{review_id:null,lock_id:null});
 assert.deepEqual(signOffFor({packKind:'Monthly filing pack',final:true,review:{...rv,reviewed_by:'a'},fingerprint:'f1'}),{review_id:null,lock_id:null},'the preparer cannot sign off their own report');
 assert.deepEqual(signOffFor({packKind:'Monthly filing pack',final:false,review:rv,fingerprint:'f1'}),{review_id:null,lock_id:null},'a draft is never signed');
 assert.deepEqual(signOffFor({packKind:'Annual filing pack',final:true,lock:{lock_id:'k',stale:false}}),{review_id:null,lock_id:'k'});assert.deepEqual(signOffFor({packKind:'Annual filing pack',final:true,lock:{lock_id:'k',stale:true}}),{review_id:null,lock_id:null});
});
test('kinds and the summary',()=>{
 assert.deepEqual(PACK_KINDS,['Monthly filing pack','Annual filing pack','Point-in-time status']);assert.deepEqual(REPORT_KINDS,['Month','Quarter','Year to date','Year end']);
 assert.equal(packKindForReport('Month'),'Monthly filing pack');for(const k of ['Quarter','Year to date','Year end'])assert.equal(packKindForReport(k),'Point-in-time status');
 assert.deepEqual(registerSummary([{status:'Draft'},{status:'Filed'},{status:'Filed'}]),{total:3,Draft:1,Generated:0,Signed:0,Filed:2});
});
