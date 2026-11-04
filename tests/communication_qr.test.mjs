import test from 'node:test';import assert from 'node:assert/strict';import {communicationUrl,communicationQr} from '../staff-communication-qr.mjs';
const ref='00000000-0000-4000-8000-000000000011';
test('communication QR encodes only the existing opaque reference and secure ERP route',()=>{const q=communicationQr(ref,'https://backend-staging-foundation.pcl-crm.pages.dev');assert.equal(q.url,'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot#communication='+ref);assert.match(q.svg,/<svg/);assert.match(q.svg,/<path/);assert.doesNotMatch(q.svg,/client|invoice|token|script/i);});
test('invalid references and insecure production URLs cannot generate a QR',()=>{assert.throws(()=>communicationUrl('javascript:alert(1)','https://pcl.phamalarcon.com'));assert.throws(()=>communicationUrl(ref,'http://pcl.phamalarcon.com'));});
test('letter QR shows the letter details as text, not a link',async()=>{
 const {letterDetails,letterDetailsQr}=await import('../staff-communication-qr.mjs');
 const text=letterDetails({reference:'PCL/LTR/2026/0004',subject:'Engagement for the year ended 31 December 2026',issuedBy:'PCL · Fictional Consulting Ltd',addressedTo:'UAT Fictional Mlima Wholesalers Limited',attention:'UAT Fictional Director',signatory:'Fictional Partner',letterDate:'2026-11-04',generatedOn:'2026-11-04'});
 assert.deepEqual(text.split('\n'),['DATE: 2026-11-04','REF: PCL/LTR/2026/0004','FROM: PCL · Fictional Consulting Ltd','TO: UAT Fictional Mlima Wholesalers Limited (Attn: UAT Fictional Director)','PURPOSE: Engagement for the year ended 31 December 2026','SIGNATORY: Fictional Partner']);
 assert.doesNotMatch(text,/https?:|staff-pilot|communication=/,'no ERP link in the letter QR');
 assert.match(letterDetailsQr(text).svg,/<svg/);
 const long=letterDetails({reference:'R',subject:'x'.repeat(900),issuedBy:'F',addressedTo:'C',signatory:'S',letterDate:'2026-11-04',generatedOn:'2026-11-04'});assert.ok(long.length<=700);
 assert.throws(()=>letterDetails({reference:'R',issuedBy:'F',addressedTo:'',signatory:'S'}),/addressee/);
});
