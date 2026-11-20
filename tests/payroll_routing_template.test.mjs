// Build 2811: the payroll routing-map template lists every payroll code with its fixed side, and leaves every account and approval field blank.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {readWorkbookSheet} from '../supabase/functions/staff-workspace-v12/workbook-reader.mjs';
import {PAYROLL_CODES} from '../supabase/functions/staff-workspace-v12/routing-map-rules.mjs';
import {TEMPLATES} from '../staff-resources.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('payroll routing-map template: columns, codes and sides from the ERP, accounts and approvals blank',async()=>{
 const t=TEMPLATES.find(x=>x.label==='Payroll routing map');assert.ok(t);assert.equal(t.area,'Payroll');assert.match(t.about,/blank until a Manager proposes/);
 const bytes=new Uint8Array(await fs.readFile(path.join(root,t.file.slice(1))));
 const {sheet}=await readWorkbookSheet(bytes,'Payroll routing map');
 const row=r=>Array.from({length:10},(_,i)=>{const v=sheet.getRow(r).getCell(i+1).value;return v==null?'':String(v);});
 assert.deepEqual(row(1),['Payroll code','Description','Direction','Client TB account code','Client TB account name','Effective from','Effective to','Approval status','Approver','Approval date']);
 for(let i=0;i<PAYROLL_CODES.length;i++){const r=row(i+2),c=PAYROLL_CODES[i];assert.equal(r[0],c.code);assert.equal(r[1],c.label);assert.equal(r[2],c.side);assert.deepEqual(r.slice(3),['','','','','','',''],c.code+' must start blank');}
 assert.equal(row(PAYROLL_CODES.length+2).join(''),'','nothing below the list');
 const first=(await readWorkbookSheet(bytes,'Read first')).sheet;let text='';for(let r=1;r<=first.rowCount;r++)for(let c=1;c<=2;c++){const v=first.getRow(r).getCell(c).value;if(v!=null)text+=String(v)+'\n';}
 assert.match(text,/different Partner|independent Partner|Partner who did not propose/);assert.match(text,/never fills an account/);assert.match(text,/Example \(not data\)/);
});
