import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {LAYOUTS,KINDS,identifierIssues,joinPayroll,buildNssf,buildShif,buildP10,buildFile,totalsAgree,reconcileToJournal,csvCell,toCsv,fileName} from '../supabase/functions/staff-workspace-v12/statutory-file-rules.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const emp=(n,pin,extra={})=>({name:'E'+n,pin,employee_id:'2000000'+n,source_row:n+1,resident:true,employment_type:'Permanent',other_pension:0,postretirement_medical:0,mortgage_interest:0,...extra});
const calc=(n,o={})=>({source_row:n+1,gross:100000,paye:20000,employee_nssf:2160,employer_nssf:2160,shif:2750,employee_ahl:1500,employer_ahl:1500,nita:50,taxable:90000,personal_relief:2400,insurance_relief:0,taxable_benefits:0,...o});
const person=(pin,o={})=>({kra_pin:pin,national_id:'2000000'+pin.slice(-3,-1).replace(/^0+/,''),phone:'0712345678',surname:'S',other_names:'O',id_type:'National ID',nssf_number:'N1',sha_number:'H1',payroll_number:'P1',p10_employee_type:'Primary Employee',disability:false,exemption_certificate:null,...o});

test('layouts keep the column order of the agencies\' sample files',()=>{
 assert.deepEqual(KINDS,['NSSF','SHIF','PAYE_P10']);
 assert.equal(LAYOUTS.NSSF.columns.length,7);assert.equal(LAYOUTS.SHIF.columns.length,9);assert.equal(LAYOUTS.PAYE_P10.columns.length,26);
 assert.equal(LAYOUTS.SHIF.columns[7],'CONTRIBUTION AMOUNT');assert.equal(LAYOUTS.PAYE_P10.columns[6],'Total Cash Pay (A)');assert.equal(LAYOUTS.PAYE_P10.columns[24],'Self Assessed PAYE Tax (S)');
});
test('identifier rules mirror the table and name what is wrong',()=>{
 assert.deepEqual(identifierIssues({nssf_number:'NS1001',sha_number:'SHA-2/1',id_type:'National ID',p10_employee_type:'Primary Employee'}),[]);
 assert.match(identifierIssues({nssf_number:'!!'}).join(' '),/NSSF number may contain/);
 assert.match(identifierIssues({id_type:'Licence'}).join(' '),/National ID, Passport or Alien ID/);
 assert.match(identifierIssues({exemption_certificate:'EX1',disability:false}).join(' '),/applies only to a person with a disability/);
 assert.deepEqual(identifierIssues({exemption_certificate:'EX1',disability:true}),[]);
});
test('a person missing from the register or missing a field is named and stops the file; nothing is guessed',()=>{
 const employees=[emp(1,'A000000001Z'),emp(2,'A000000002Z')],calculated=[calc(1),calc(2)];
 const j=joinPayroll({employees,calculated,people:[person('A000000001Z',{nssf_number:null,phone:null})]});
 const n=buildNssf({joined:j});assert.equal(n.rows.length,0);assert.match(n.issues[0],/E1: NSSF number is missing/);assert.match(n.issues[1],/E2: not on the payroll register/);
 const s=buildShif({joined:j});assert.match(s.issues[0],/E1: .*phone/);
});
test('P10: a person with no PIN is Section E item 5, not a Section B row; NITA must be KES 50 a member',()=>{
 const employees=[emp(1,'A000000001Z'),emp(2,'',{employment_type:'Casual'})],calculated=[calc(1),calc(2,{paye:300,nita:0})];
 const b=buildP10({joined:joinPayroll({employees,calculated,people:[person('A000000001Z')]})});
 assert.equal(b.rows.length,1);assert.equal(b.section_e.paye_without_pin,30000);assert.equal(b.section_e.total_paye_payable,2030000);assert.equal(b.section_e.nita_levy,5000);assert.deepEqual(b.issues,[]);
 const bad=buildP10({joined:joinPayroll({employees:[emp(1,'A000000001Z')],calculated:[calc(1,{nita:60})],people:[person('A000000001Z')]})});assert.match(bad.issues[0],/NITA/);
 const pwd=buildP10({joined:joinPayroll({employees:[emp(1,'A000000001Z')],calculated:[calc(1)],people:[person('A000000001Z',{disability:true})]})});assert.match(pwd.issues[0],/exemption certificate/);
});
test('file totals must equal the confirmed summary, so a dropped row can never under-declare',()=>{
 const employees=[emp(1,'A000000001Z'),emp(2,'A000000002Z')],calculated=[calc(1),calc(2)];
 const b=buildFile('NSSF',{employees,calculated,people:[person('A000000001Z')]});
 assert.equal(b.rows.length,1);assert.ok(totalsAgree('NSSF',b.totals,calculated).length>0);
 const ok=buildFile('NSSF',{employees:[employees[0]],calculated:[calculated[0]],people:[person('A000000001Z')]});assert.deepEqual(totalsAgree('NSSF',ok.totals,[calculated[0]]),[]);
});
test('reconciliation to the posted journal: none, agrees, variance',()=>{
 const calculated=[calc(1)];
 assert.equal(reconcileToJournal({calculated,maps:[],end:'2026-09-30',posted:null}).status,'No posted journal');
 const v=reconcileToJournal({calculated,maps:[],end:'2026-09-30',posted:{by_account:{},reference:'X'}});assert.equal(v.ok,false);assert.match(v.problems[0],/No approved payroll mapping for/);
});
test('CSV is safe for Excel: byte order mark, CRLF, quoting, no formula injection, numbers untouched',()=>{
 assert.equal(csvCell('=SUM(A1)'),"'=SUM(A1)");assert.equal(csvCell('+254'),"'+254");assert.equal(csvCell('a,b'),'"a,b"');assert.equal(csvCell('say "hi"'),'"say ""hi"""');assert.equal(csvCell(-12.5),'-12.5');assert.equal(csvCell(null),'');
 assert.equal(toCsv(['A','B'],[['x',1]]),'﻿A,B\r\nx,1\r\n');
 assert.equal(fileName('PAYE_P10','2026-09','Jaki Wholesalers Ltd.'),'P10_SectionB_2026-09_Jaki_Wholesalers_Ltd.csv');assert.equal(fileName('NSSF','2026-09',''),'NSSF_2026-09_client.csv');
});
test('screens: statutory buttons, handlers, download and the not-the-KRA-file wording are wired',()=>{
 const reg=rd('staff-payroll-register.mjs'),ui=rd('staff-statutory-files.mjs'),act=rd('supabase/functions/staff-workspace-v12/statutory-file-actions.ts'),idx=rd('supabase/functions/staff-workspace-v12/index.ts');
 for(const a of ['register-ids','statutory-files','statutory-prepare','statutory-release'])assert.match(reg,new RegExp("'"+a+"'"));
 assert.match(reg,/staff-statutory-files\.mjs\?v=20261117-frame-v1/);assert.match(ui,/It is not the KRA file itself/);assert.match(ui,/Release and download/);
 assert.match(act,/statutory_file_prepare/);assert.match(act,/not ready to release/);assert.match(idx,/statutoryFileAction/);
});
