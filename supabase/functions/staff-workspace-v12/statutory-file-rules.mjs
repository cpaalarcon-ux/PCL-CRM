// Statutory return files (build 2829). Pure rules; no database, no clock.
// A file is built only from a CONFIRMED payroll summary, and is released only when (a) every column the layout requires can be filled from real
// data, (b) the file's own totals equal the confirmed summary, and (c) the summary agrees, account by account, with the POSTED payroll journal.
// Nothing is guessed: a missing NSSF number, ID or phone stops the file and names the person and the field.
//
// Layouts are the column orders of the agencies' own sample files as supplied on 15 Nov 2026:
//  - NSSF.xlsx (Sheet1, 7 columns), SHIF.xlsx (Sheet1, 9 columns), P10_Return_Simplified.xlsm v30.0.3 (Section B, 26 columns used, Section E lines).
// The KRA P10 is a macro workbook with its own validation and import, so the P10 output is the Section B workings in the template's column order for
// pasting into the official workbook. It is not the KRA file, and the screen says so.
import {payrollTotals,buildPayrollJournal} from './payroll-journal-rules.mjs';
import {applyRounding} from './export-profile-rules.mjs';

const cents=v=>Math.round(Number(v||0)*100);
const money=c=>c/100;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();

export const LAYOUTS={
 NSSF:{kind:'NSSF',code:'NSSF_MONTHLY_7COL_V1',label:'NSSF monthly contributions',agency:'NSSF',
  columns:['PAYROLL NUMBER','SURNAME','OTHER NAMES','ID Number','KRA Pin','NSSF Number','GROSS PAY'],
  source:'NSSF.xlsx sample (Sheet1), supplied 15 Nov 2026'},
 SHIF:{kind:'SHIF',code:'SHA_SHIF_9COL_V1',label:'Social Health Insurance Fund contributions',agency:'SHA',
  columns:['PAYROLL NUMBER','FIRSTNAME','LASTNAME','IDENTITY TYPE','ID NO','KRA PIN','NHIF NO','CONTRIBUTION AMOUNT','PHONE'],
  source:'SHIF.xlsx sample (Sheet1), supplied 15 Nov 2026'},
 PAYE_P10:{kind:'PAYE_P10',code:'KRA_P10_SIMPLIFIED_V30_0_3_SECTION_B',label:'PAYE return P10, Section B workings and Section E totals',agency:'KRA',
  columns:['PIN of Employee','Name of Employee','Resident Status','Type of Employee','Persons With Disability (PWD)','Exemption Certificate Number','Total Cash Pay (A)','Value of Car Benefit (B)','Value of Meals (C)','Non Cash Benefits (D)','Type of Housing','Housing Benefit (F)','Other Benefits (G)','Total Gross Pay (H)','Social Health Insurance Fund (SHIF) (I)','NSSF Contribution (J)','Other Pension Contribution (K)','Post Retirement Medical Fund (L)','Mortgage Interest (M)','Affordable Housing Levy (N)','Taxable Pay (O)','Monthly Personal Relief (P)','Amount of Insurance Relief (Q)','PAYE Tax (R)','Self Assessed PAYE Tax (S)','Deposit on Home Ownership Saving Plan'],
  source:'P10_Return_Simplified.xlsm v30.0.3 (B_Employees_Dtls_Simplified, E_Tax_Due), supplied 15 Nov 2026'}
};
export const KINDS=Object.keys(LAYOUTS);
export const SHEET_M_COLUMNS=['PIN of Employee','Name of Employee','Employee Contribution (A)','Employer Contribution (B)','Total (A+B)'];
export const ID_TYPES=['National ID','Passport','Alien ID'];
export const P10_EMPLOYEE_TYPES=['Primary Employee','Secondary Employee'];
// The identifiers the register must hold. Validation mirrors the table's CHECK constraints so the screen can say what is wrong before the database does.
export function identifierIssues(x){
 const out=[],v=k=>clean(x[k]);
 if(v('surname').length>80)out.push('Surname is too long (80 characters at most).');
 if(v('other_names').length>120)out.push('Other names are too long (120 characters at most).');
 if(v('id_type')&&!ID_TYPES.includes(v('id_type')))out.push('Choose National ID, Passport or Alien ID.');
 for(const [k,l] of [['nssf_number','NSSF number'],['sha_number','SHA (SHIF) number']])if(v(k)&&!/^[A-Za-z0-9/-]{3,20}$/.test(v(k)))out.push(`${l} may contain letters, digits, / and - only (3 to 20 characters).`);
 if(v('payroll_number').length>30)out.push('Payroll number is too long (30 characters at most).');
 if(v('p10_employee_type')&&!P10_EMPLOYEE_TYPES.includes(v('p10_employee_type')))out.push('Choose Primary Employee or Secondary Employee.');
 if(v('exemption_certificate')&&!(x.disability===true||x.disability==='true'))out.push('An exemption certificate number applies only to a person with a disability. Tick the disability box first.');
 if(v('exemption_certificate').length>50)out.push('Exemption certificate number is too long (50 characters at most).');
 return out;
}
// Matches each employee line of the summary to the register entry (by KRA PIN, then ID number; the latest entry wins when someone was re-added).
export function joinPayroll({employees=[],calculated=[],people=[]}){
 const calc=new Map(calculated.map(c=>[c.source_row,c])),byPin=new Map(),byId=new Map();
 for(const p of people){if(p.kra_pin)byPin.set(String(p.kra_pin).toUpperCase(),p);if(p.national_id)byId.set(clean(p.national_id),p);}
 return employees.map(e=>({e,c:calc.get(e.source_row)||null,p:(e.pin&&byPin.get(String(e.pin).toUpperCase()))||(e.employee_id&&byId.get(clean(e.employee_id)))||null,casual:e.employment_type==='Casual'}));
}
const missing=(p,fields)=>fields.filter(([k])=>!clean(p?.[k])).map(([,l])=>l);
function gaps(rows){return rows.map(r=>`${r.name}: ${r.missing.join(', ')} ${r.missing.length>1?'are':'is'} missing from the payroll register.`);}

export function buildNssf({joined}){
 const rows=[],issues=[],gapRows=[],t={employee:0,employer:0,gross:0};
 for(const {e,c,p,casual} of joined){
  if(casual)continue;
  if(!c){issues.push(`${e.name||'A line'} (row ${e.source_row}) has no calculation in the confirmed summary.`);continue;}
  if(!p){gapRows.push({name:e.name,missing:['not on the payroll register (surname, other names, NSSF number)']});continue;}
  const need=missing({...p,kra_pin:p.kra_pin||e.pin,national_id:p.national_id||e.employee_id},[['payroll_number','payroll number'],['surname','surname'],['other_names','other names'],['national_id','ID number'],['kra_pin','KRA PIN'],['nssf_number','NSSF number']]);
  if(need.length){gapRows.push({name:e.name,missing:need});continue;}
  rows.push([clean(p.payroll_number),clean(p.surname),clean(p.other_names),clean(p.national_id||e.employee_id),String(p.kra_pin||e.pin).toUpperCase(),clean(p.nssf_number),money(cents(c.gross))]);
  t.employee+=cents(c.employee_nssf);t.employer+=cents(c.employer_nssf);t.gross+=cents(c.gross);
 }
 return {rows,issues:[...issues,...gaps(gapRows)],totals:{employees:rows.length,gross:t.gross,employee_nssf:t.employee,employer_nssf:t.employer,total_payable:t.employee+t.employer},gapCount:gapRows.length};
}
export function buildShif({joined}){
 const rows=[],issues=[],gapRows=[],t={shif:0,gross:0};
 for(const {e,c,p,casual} of joined){
  if(casual)continue;
  if(!c){issues.push(`${e.name||'A line'} (row ${e.source_row}) has no calculation in the confirmed summary.`);continue;}
  if(!p){gapRows.push({name:e.name,missing:['not on the payroll register (names, ID type, SHA number, phone)']});continue;}
  const need=missing({...p,kra_pin:p.kra_pin||e.pin,national_id:p.national_id||e.employee_id},[['payroll_number','payroll number'],['other_names','other names'],['surname','surname'],['id_type','ID type'],['national_id','ID number'],['kra_pin','KRA PIN'],['sha_number','SHA (SHIF) number'],['phone','phone']]);
  if(need.length){gapRows.push({name:e.name,missing:need});continue;}
  rows.push([clean(p.payroll_number),clean(p.other_names),clean(p.surname),p.id_type,clean(p.national_id||e.employee_id),String(p.kra_pin||e.pin).toUpperCase(),clean(p.sha_number),money(cents(c.shif)),clean(p.phone)]);
  t.shif+=cents(c.shif);t.gross+=cents(c.gross);
 }
 return {rows,issues:[...issues,...gaps(gapRows)],totals:{employees:rows.length,gross:t.gross,shif:t.shif},gapCount:gapRows.length};
}
// P10. Section B needs a KRA PIN for every row (it is mandatory in the template); PAYE deducted from a person with no PIN is not a Section B row, it is
// Section E item 5. Benefits are held in one figure in the register, so they are reported under Other Benefits (G); the car, meals and housing split is not held.
export function buildP10({joined,sheetM=false}){
 const rows=[],sheet=[],issues=[],notes=[],t={ahl_no_pin:0,emp:0,paye:0,paye_no_pin:0,no_pin_people:0,ahl_employee:0,ahl_employer:0,nita:0,nita_members:0,nssf_employee:0,nssf_employer:0,shif:0,gross:0,housing_in_rows:0};
 let notInRegister=0;
 for(const {e,c,p,casual} of joined){
  if(!c){issues.push(`${e.name||'A line'} (row ${e.source_row}) has no calculation in the confirmed summary.`);continue;}
  const paye=cents(c.paye);
  t.ahl_employee+=cents(c.employee_ahl);t.ahl_employer+=cents(c.employer_ahl);t.nita+=cents(c.nita);if(cents(c.nita)>0)t.nita_members++;
  t.nssf_employee+=cents(c.employee_nssf);t.nssf_employer+=cents(c.employer_nssf);t.shif+=cents(c.shif);t.gross+=cents(c.gross);
  const pin=String(e.pin||'').toUpperCase();
  if(!pin){t.paye_no_pin+=paye;t.no_pin_people++;t.ahl_no_pin+=cents(c.employee_ahl)+cents(c.employer_ahl);continue;}
  if(!p)notInRegister++;
  const type=p?.p10_employee_type||'Primary Employee',pwd=p?.disability===true,cert=pwd?clean(p?.exemption_certificate):'';
  if(pwd&&!cert)issues.push(`${e.name}: a person with a disability needs the exemption certificate number in the register.`);
  const cash=cents(c.gross),other=cents(c.taxable_benefits);
  rows.push([pin,clean(e.name),e.resident===true?'Resident':'Non-Resident',type,pwd?'Yes':'No',cert,money(cash),0,0,0,'Benefit not given',0,money(other),money(cash+other),money(cents(c.shif)),money(cents(c.employee_nssf)),money(cents(e.other_pension)),money(cents(e.postretirement_medical)),money(cents(e.mortgage_interest)),money(cents(c.employee_ahl)),money(cents(c.taxable)),money(cents(c.personal_relief)),money(cents(c.insurance_relief)),money(paye),money(paye),0]);
  t.emp++;t.paye+=paye;t.housing_in_rows+=cents(c.employee_ahl);t.ahl_rows_employer=(t.ahl_rows_employer||0)+cents(c.employer_ahl);
  if(sheetM)sheet.push([pin,clean(e.name),money(cents(c.employee_ahl)),money(cents(c.employer_ahl)),money(cents(c.employee_ahl)+cents(c.employer_ahl))]);
 }
 if(notInRegister)notes.push(`${notInRegister} ${notInRegister===1?'person is':'people are'} not on the payroll register, so Primary Employee and no disability are used for them. Add them to the register to set these properly.`);
 if(t.no_pin_people)notes.push(`${t.no_pin_people} ${t.no_pin_people===1?'person has':'people have'} no KRA PIN. They are not Section B rows; their PAYE is Section E item 5.`);
 notes.push('Car benefit, meals, non-cash benefits and housing benefit are not held separately in the register. All taxable benefits are reported under Other Benefits (G), and Type of Housing is Benefit not given. Split them in the P10 if the client has them.');
 notes.push('Taxable pay, relief and PAYE columns are the ERP\'s own figures. The KRA workbook recalculates them: compare its result with these before filing.');
 const nitaExpected=t.nita_members*5000;
 if(t.nita!==nitaExpected)issues.push(`The NITA levy in the summary (${money(t.nita).toFixed(2)}) is not KES 50 per member for ${t.nita_members} members (${money(nitaExpected).toFixed(2)}). The P10 computes members × 50, so correct the NITA rate or the summary first.`);
 const section_e={total_employees:t.emp,paye_deducted:t.paye,lump_sum_paye:0,fbt:0,paye_without_pin:t.paye_no_pin,total_paye_payable:t.paye+t.paye_no_pin,housing_levy_employee:t.housing_in_rows,housing_levy_employer_shown_separately:t.ahl_rows_employer||0,housing_levy_without_pin:t.ahl_no_pin,nita_members:t.nita_members,nita_levy:nitaExpected,
  total_payable:t.paye+t.paye_no_pin+t.housing_in_rows+nitaExpected};
 notes.push('Section E item 7 (housing levy) is the employee share only, the total of the Affordable Housing Levy column.'+(sheetM?' The employer share is in the separate Sheet M file, with the employee share and the total (A+B).':' This profile does not show the employer share.'));
 if(t.ahl_no_pin)notes.push(`Housing levy of ${money(t.ahl_no_pin).toFixed(2)} (employee and employer) belongs to people with no KRA PIN, so it is in neither Section B nor Sheet M. Get their PINs to declare it.`);
 return {rows,issues,notes,totals:{employees:t.emp,gross:t.gross,paye:t.paye,paye_without_pin:t.paye_no_pin,employee_ahl:t.ahl_employee,employer_ahl:t.ahl_employer,nita:t.nita,shif:t.shif,employee_nssf:t.nssf_employee},section_e,gapCount:0,notInRegister,extra_tables:sheetM?[{key:'sheet_m',label:'Affordable Housing Levy, Sheet M workings',columns:SHEET_M_COLUMNS,rows:sheet,file_prefix:'P10_SheetM',totals:{employee:t.housing_in_rows,employer:t.ahl_rows_employer||0,total:t.housing_in_rows+(t.ahl_rows_employer||0)}}]:[]};
}
export function buildFile(kind,{employees,calculated,people,profile=null}){
 const joined=joinPayroll({employees,calculated,people});
 const b=kind==='NSSF'?buildNssf({joined}):kind==='SHIF'?buildShif({joined}):kind==='PAYE_P10'?buildP10({joined,sheetM:profile?.employer_housing_levy==='SEPARATE_SHEET'}):null;
 if(!b)return {issues:['Choose NSSF, SHIF or PAYE (P10).'],rows:[],totals:{},notes:[]};
 const layout=LAYOUTS[kind],issues=[...b.issues],notes=[...(b.notes||[])];
 if(!profile)issues.push('No published export profile is in force for this return and month. A Manager or Partner publishes one in Settings, Upload & Export Templates.');
 // Accepted identifiers (SHIF): the profile lists the ID types the authority accepts; a person with another type is named, never silently changed.
 if(profile&&kind==='SHIF'){for(const r of b.rows){if(!(profile.accepted_id_types||[]).includes(r[3]))issues.push(`${r[1]} ${r[2]}: ID type ${r[3]} is not accepted by the export profile in force.`);}}
 // Rounding is applied to the file only. The exact amounts stay in the totals so the file reconciles to the ledger through the stored difference.
 const rounded=applyRounding(layout.columns,b.rows,profile);
 if(Object.keys(rounded.rounding).length)notes.push('Rounded up in this file only: '+Object.entries(rounded.rounding).map(([c,v])=>`${c} ${v.exact.toFixed(2)} becomes ${v.rounded.toFixed(2)} (difference ${v.difference.toFixed(2)})`).join('; ')+'. The exact amounts stay in the payroll records.');
 return {...b,issues,notes,rows:rounded.rows,rounding:rounded.rounding,layout,profile_id:profile?.profile_id||null,profile_version:profile?.version||null};
}
// The file's own totals must equal the confirmed summary for the same heads. This catches a person dropped from the file (for example a row skipped for
// missing data) so the file can never quietly under-declare.
export function totalsAgree(kind,fileTotals,calculated){
 const t=payrollTotals(calculated),out=[],cmp=(label,a,b)=>{if(Math.abs(a-b)>0)out.push(`${label}: the file has ${money(a).toFixed(2)} but the confirmed payroll summary has ${money(b).toFixed(2)}.`);};
 if(kind==='NSSF'){cmp('Employee NSSF',fileTotals.employee_nssf,t.employee_nssf);cmp('Employer NSSF',fileTotals.employer_nssf,t.employer_nssf);}
 if(kind==='SHIF')cmp('SHIF',fileTotals.shif,t.shif);
 if(kind==='PAYE_P10'){cmp('PAYE (Section B plus no-PIN)',fileTotals.paye+fileTotals.paye_without_pin,t.paye);cmp('Housing levy, employee share',fileTotals.employee_ahl,t.employee_ahl);cmp('Housing levy, employer share',fileTotals.employer_ahl,t.employer_ahl);cmp('NITA',fileTotals.nita,t.nita);}
 return out;
}
// Reconciles the confirmed summary to the posted journal. postedByAccount: {account_code: net credit minus debit, in cents}.
// The expected journal is rebuilt from the summary and the client's active payroll mappings; every account must agree, so a head that is mapped to a shared account is
// still checked. A posted journal that is missing, unposted, or different blocks release.
export function reconcileToJournal({calculated,maps,end,posted}){
 if(!posted)return {ok:false,status:'No posted journal',lines:[],problems:['The payroll journal for this month is not posted yet. Post it (after independent review) before releasing a statutory file, so the file and the books agree.']};
 const t=payrollTotals(calculated),built=buildPayrollJournal(t,maps,end),problems=[],lines=[];
 for(const u of built.unmapped)problems.push(`No approved payroll mapping for ${u.code}, so the posted journal cannot be compared. ${u.reason||''}`.trim());
 const expected=new Map();for(const l of built.lines)expected.set(l.account_code,(expected.get(l.account_code)||0)+cents(l.credit)-cents(l.debit));
 const accounts=new Set([...expected.keys(),...Object.keys(posted.by_account||{})]);
 for(const a of [...accounts].sort()){
  const e=expected.get(a)||0,p=Number(posted.by_account?.[a]||0),diff=p-e;
  lines.push({account_code:a,expected:money(e),posted:money(p),difference:money(diff)});
  if(diff!==0)problems.push(`Account ${a}: the posted journal has ${money(p).toFixed(2)} but the confirmed summary gives ${money(e).toFixed(2)} (difference ${money(diff).toFixed(2)}).`);
 }
 return {ok:!problems.length,status:problems.length?'Variance':'Agrees',lines,problems,journal_reference:posted.reference||null};
}
// CSV: UTF-8 with a byte order mark so Excel reads it correctly, CRLF line ends. A text cell that begins with = + - @ gets a leading single quote so Excel
// cannot run it as a formula; numbers are written as numbers and are never altered.
const needsGuard=s=>/^[=+\-@\t\r]/.test(s);
export function csvCell(v){
 if(typeof v==='number')return Number.isFinite(v)?String(v):'';
 let s=String(v??'');if(needsGuard(s))s="'"+s;
 return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}
export function toCsv(columns,rows){return '﻿'+[columns,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';}
export function fileName(kind,month,clientName){
 const slug=clean(clientName).replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,28)||'client';
 return `${kind==='PAYE_P10'?'P10_SectionB':kind}_${month}_${slug}.csv`;
}
