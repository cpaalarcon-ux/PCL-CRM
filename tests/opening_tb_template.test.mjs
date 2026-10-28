import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readWorkbookSheet} from '../supabase/functions/staff-workspace-v6/workbook-reader.mjs';

test('opening TB template uses six ERP-readable columns and one upload-level evidence step',async()=>{
 const bytes=new Uint8Array(await fs.readFile(new URL('../Opening_TB_Upload_Template.xlsx',import.meta.url)));
 const {sheet}=await readWorkbookSheet(bytes,'Opening TB');
 assert.equal(sheet.columnCount,6);
 assert.deepEqual(Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(1).getCell(i+1).value),[
  'Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)',
 ]);
 assert.equal(sheet.getRow(2).getCell(3).value.formula,'cached worksheet formula');
 const {sheet:guide}=await readWorkbookSheet(bytes,'Read first');
 assert.match(guide.getRow(7).getCell(2).value,/reference once/i);
 assert.match(guide.getRow(10).getCell(2).value,/Do not type N\/A/);
});
