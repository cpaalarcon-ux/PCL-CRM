import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePurchaseUpload} from '../supabase/functions/staff-workspace-v12/purchase-upload.mjs';

const row=['Local','P000000001A','Example supplier','2026-10-03','0000123','Goods for resale','',100,16,116,'','','STOCK','50000'];
const catalog=[{code:'50000',name:'Purchases - goods for resale',route:1,category_code:'STOCK',status:'Active',is_legacy:false}];

test('valid uploaded routing and TB codes produce a confirmation suggestion only when the client mapping covers the invoice date',()=>{
 const approved=[{erp_account_code:'50000',effective_from:'2026-01-01',effective_to:null}];
 const mapped=normalizePurchaseUpload(row,'16%','2026-10-01','2026-10-31',catalog,approved);
 assert.deepEqual(mapped.issues,[]);
 assert.deepEqual(mapped.row.mapping_suggestion,{route:1,category_code:'STOCK',account_code:'50000',confirmed:false});
 const unapproved=normalizePurchaseUpload(row,'16%','2026-10-01','2026-10-31',catalog,[]);
 assert.equal(unapproved.row.mapping_suggestion,undefined);
 assert.match(unapproved.row.mapping_suggestion_issue,/valid, but this account is not approved for the client/);
});

test('a routing code that does not match the TB account says which code is expected',()=>{
 const wrong=[...row];wrong[12]='EXP02';
 const result=normalizePurchaseUpload(wrong,'16%','2026-10-01','2026-10-31',catalog,[]);
 assert.equal(result.row.mapping_suggestion,undefined);
 assert.match(result.row.mapping_suggestion_issue,/Routing code EXP02 does not match ERP TB item code 50000/);
 assert.match(result.row.mapping_suggestion_issue,/uses routing code STOCK/);
});
