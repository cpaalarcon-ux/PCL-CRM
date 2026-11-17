// System notes for the annual statements (build 2873). Pure: no database, no tax rates.
// A system note analyses a statement caption by account, from the same trial balance and the same Partner-approved statement-line map the statements use, so a note can never show a
// figure the statements do not. Every line of a note is checked against the caption on the face of the statements; a difference is reported, never absorbed. Notes are numbered by the
// engine in the order they first appear on the statements and the number is written on the face. Nothing is typed in here: wording notes and client-specific notes come later and are
// separate. Prior-year figures are shown at caption level only, because the prior year is held by line, not by account.
import {mapInForce} from './annual-pack-rules.mjs';
import {UNITS,roundTo,plSign,sfpSign} from './annual-pack-statements.mjs';
import {FORMS} from './annual-pack-legal-form.mjs';

export const NOTES_VERSION='system-notes-v1';
const cents=v=>Math.round(Number(v||0)*100);
// The note families are the note_ref values on the statement-line catalogue. A family with no line on the face of the statements has no note.
const TITLES={
 REVENUE:'Revenue',PPE:'Property, plant and equipment',LEASES:'Leases',INVPROP:'Investment property',INTANG:'Intangible assets and goodwill',BIO:'Biological assets',INVEST:'Investments',
 INV:'Inventories and cost of sales',REC:'Receivables and prepayments',CONTRACTS:'Contract balances and customer deposits',RELATED:'Related party balances',TAX:'Taxation',CASH:'Cash and cash equivalents',
 FUNDS:'Funds and grants',BORROW:'Borrowings',PROV:'Provisions',PAY:'Trade and other payables',OTHER:'Other income and gains',STAFF:'Staff costs',OPEX:'Other operating expenses',FINANCE:'Finance income and costs'
};
const EQUITY_TITLE={[FORMS.COMPANY]:'Share capital and reserves',[FORMS.PARTNERSHIP]:"Partners' capital and current accounts",[FORMS.PROPRIETOR]:"Owner's capital and drawings",[FORMS.OTHER]:'Equity and funds'};
export const noteTitle=(ref,form=FORMS.OTHER)=>ref==='EQUITY'?(EQUITY_TITLE[form]||EQUITY_TITLE[FORMS.OTHER]):(TITLES[ref]||null);

// statements: the built statements (rows carry code, label, current, prior). Returns {notes,face_refs,problems,unit}.
// notes: [{number,ref,title,sections:[{line_code,label,statement,accounts:[{code,name,amount}],rounding,total,face,prior,ties}],ties,control}]
export function buildNotes({statements,lineDefs,tb,maps,asOf,form=FORMS.OTHER,rounding='Whole shillings'}){
 const unit=UNITS[rounding]||100,defs=new Map(lineDefs.map(d=>[d.line_code,d])),problems=[];
 // Account amounts per statement line, in cents, with the same sign the face uses.
 const byLine=new Map();
 for(const r of tb||[]){
  const mv=cents(r.movement_debit)-cents(r.movement_credit),net=cents(r.net);
  if(!cents(r.opening)&&!mv&&!net)continue;
  const m=mapInForce(maps||[],r.code,asOf),d=m&&defs.get(m.line_code);
  if(!d||d.statement==='Excluded')continue;
  const pl=d.statement==='Profit or loss',signed=pl?mv:net,natural=d.normal_side==='Credit'?-signed:signed,shown=natural*(pl?plSign(d):sfpSign(d));
  if(!shown)continue;
  if(!byLine.has(d.line_code))byLine.set(d.line_code,[]);
  byLine.get(d.line_code).push({code:r.code,name:r.name||'',cents:shown});
 }
 // Face rows in statement order, profit or loss first, as the statements are presented.
 const face=[];
 for(const [key,st] of [['profit_or_loss','Profit or loss'],['financial_position','Financial position']])for(const row of statements?.[key]?.rows||[])if(row.code&&defs.has(row.code)&&row.kind==='line')face.push({row,statement:st,def:defs.get(row.code)});
 const order=[],byRef=new Map();
 for(const f of face){
  const ref=f.def.note_ref;if(!ref||!noteTitle(ref,form))continue;
  if(!byRef.has(ref)){byRef.set(ref,[]);order.push(ref);}
  byRef.get(ref).push(f);
 }
 const faceRefs={},notes=order.map((ref,i)=>{
  const number=i+1,sections=byRef.get(ref).map(({row,statement,def})=>{
   const accts=(byLine.get(def.line_code)||[]).sort((a,b)=>String(a.code).localeCompare(String(b.code))),exact=accts.reduce((s,a)=>s+a.cents,0);
   const accounts=accts.map(a=>({code:a.code,name:a.name,amount:roundTo(a.cents,unit)})),total=roundTo(exact,unit),sum=accounts.reduce((s,a)=>s+a.amount,0),diff=total-sum;
   const ties=total===row.current;
   if(!ties)problems.push(`Note ${number} ${noteTitle(ref,form)}: ${row.label} is ${total.toLocaleString('en-KE')} in the note and ${Number(row.current).toLocaleString('en-KE')} on the statements.`);
   faceRefs[def.line_code]=number;
   return {line_code:def.line_code,label:row.label,statement,accounts,rounding:diff,total,face:row.current,prior:row.prior??null,ties};
  });
  return {number,ref,title:noteTitle(ref,form),sections,ties:sections.every(s=>s.ties),
   control:{source:'Posted trial balance through the Partner-approved statement-line map',calculation:NOTES_VERSION,evidence:'System figures from the ledger. No supporting schedule is attached yet.',prior_year:'Shown for the caption only; the prior year is held by statement line.'}};
 });
 return {notes,face_refs:faceRefs,problems,unit_label:UNITS[rounding]===100000?'KES thousands':'KES'};
}
// Write the note number on the face of the statements. Rows keep their figures; only a note reference is added.
export function applyFaceRefs(statements,faceRefs){
 for(const key of ['profit_or_loss','financial_position'])for(const row of statements?.[key]?.rows||[])if(row.code&&faceRefs[row.code])row.note=faceRefs[row.code];
 return statements;
}
// What is hashed: the numbers, titles and every figure. Any change in a figure, an account or a number changes it.
export const canonicalNotes=notes=>notes.map(n=>({n:n.number,ref:n.ref,t:n.title,s:n.sections.map(s=>({l:s.line_code,tot:s.total,r:s.rounding,pr:s.prior,a:s.accounts.map(a=>[a.code,a.amount])}))}));
// State of the notes set against the notes the ledger would produce now: none, draft, approved, or stale (an approval that no longer matches the figures).
export function notesState({approved,draft,digestNow}){
 if(approved&&approved.digest===digestNow)return {status:'approved',set:approved};
 if(draft&&draft.digest===digestNow)return {status:'draft',set:draft};
 if(approved)return {status:'stale',set:approved};
 if(draft)return {status:'stale',set:draft};
 return {status:'none',set:null};
}
export function notesCheck({state,count,problems}){
 if(!count)return {status:'Blocked',detail:'No notes can be built yet: the statements have no lines with a note.'};
 if(problems&&problems.length)return {status:'Blocked',detail:'A note does not agree with its caption: '+problems[0]};
 if(state.status==='approved')return {status:'Pass',detail:`${count} note${count===1?'':'s'} approved by a Partner.`};
 if(state.status==='draft')return {status:'Blocked',detail:'The notes are prepared and wait for a Partner to approve them.'};
 if(state.status==='stale')return {status:'Blocked',detail:'The figures have changed since the notes were prepared or approved. Prepare the notes again and have a Partner approve them.'};
 return {status:'Blocked',detail:'The notes have not been prepared. Prepare them, then a Partner approves them, before the statements can be final.'};
}
