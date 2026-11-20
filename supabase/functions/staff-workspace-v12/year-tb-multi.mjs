// Several years of trial balances in one paste, with a preview before anything is recorded (build 2889). Pure: no database, no tax rates.
// The paste has one row per account and one column per balance date (or a debit and a credit column per date). The preview says, for each year, whether it balances, how many accounts are mapped to an
// approved statement line, which are not mapped, which are not in the chart of accounts, and whether it would replace a trial balance already recorded. Nothing is guessed: a date that cannot be read,
// a column that is not a date, an account that is not in the chart, or a year that does not balance stops the upload. An account with no approved statement line does not stop it, but it is named, because
// the comparatives will say "Needs review" until the statement-line map is approved.
import {parseAmount} from './annual-pack-comparatives.mjs';
import {mapInForce} from './annual-pack-rules.mjs';
import {expectedDates} from './year-tb-rules.mjs';

export const MULTI_VERSION='year-tb-multi-v1';
export const MAX_YEARS=6,MAX_ROWS=1500;
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>c/100;
const money=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12,january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
const iso=(y,m,d)=>{const x=new Date(Date.UTC(y,m-1,d));return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d&&y>=2000&&y<=2100?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;};
// A date found inside a header cell: 2025-12-31, 31/12/2025, 31-12-2025, 31.12.2025 or 31 December 2025. Day first, as in Kenya; a day-first reading that is not a real date is refused, never swapped.
export function dateIn(cell){
 const s=String(cell??'').trim();let m;
 if((m=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)))return iso(+m[1],+m[2],+m[3]);
 if((m=s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/)))return iso(+m[3],+m[2],+m[1]);
 if((m=s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/))){const mo=MONTHS[m[2].toLowerCase()];return mo?iso(+m[3],mo,+m[1]):null;}
 return null;
}
const split=line=>(line.includes('\t')?line.split('\t'):line.includes(';')?line.split(';'):line.split(',')).map(x=>x.trim());
const looksDated=cell=>/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}/.test(String(cell??''));

// Returns {years:[{as_of,rows:[{code,name,debit,credit}],duplicates:[code]}],errors:[string]}.
export function parseMultiYearTb(text){
 const errors=[],lines=String(text||'').split(/\r?\n/).map((raw,i)=>({raw:raw.trim(),n:i+1})).filter(l=>l.raw&&!l.raw.startsWith('#'));
 if(!lines.length)return {years:[],errors:['Paste the trial balances: a header row of balance dates, then one row per account.']};
 const head=split(lines[0].raw);while(head.length&&head[head.length-1]==='')head.pop();
 const cols=[];let nameCol=-1;
 for(let c=1;c<head.length;c++){
  const cell=head[c],d=looksDated(cell)?dateIn(cell):null;
  if(looksDated(cell)&&!d){errors.push(`Header column ${c+1}: "${cell}" looks like a date but is not a real one. Write it as 31/12/2025 or 2025-12-31.`);continue;}
  if(d){const side=/\b(debit|dr)\b/i.test(cell)?'debit':/\b(credit|cr)\b/i.test(cell)?'credit':'net';cols.push({c,date:d,side});continue;}
  if(c===1&&nameCol<0&&(cell===''||/name|description|account/i.test(cell))){nameCol=c;continue;}
  errors.push(`Header column ${c+1}: "${cell}" is not a balance date. The first row names the balance date of each column.`);
 }
 if(errors.length)return {years:[],errors};
 if(!cols.length)return {years:[],errors:['The first row has no balance dates. Put the date of each trial balance at the top of its column.']};
 const byDate=new Map();
 for(const col of cols){const g=byDate.get(col.date)||{date:col.date,net:null,debit:null,credit:null};
  if(g[col.side]!==null){errors.push(`${col.date} has two ${col.side==='net'?'balance':col.side} columns.`);continue;}g[col.side]=col.c;byDate.set(col.date,g);}
 for(const g of byDate.values()){
  if(g.net!==null&&(g.debit!==null||g.credit!==null))errors.push(`${g.date}: use either one balance column or a debit and a credit column, not both.`);
  else if(g.net===null&&(g.debit===null||g.credit===null))errors.push(`${g.date}: a debit column needs a credit column beside it, and the other way round.`);
 }
 if(byDate.size>MAX_YEARS)errors.push(`At most ${MAX_YEARS} years can be uploaded at once.`);
 if(errors.length)return {years:[],errors};
 const years=[...byDate.values()].sort((a,b)=>a.date<b.date?-1:1).map(g=>({g,as_of:g.date,rows:[],seen:new Set(),duplicates:[]}));
 let nrows=0;
 for(const {raw,n} of lines.slice(1)){
  const f=split(raw),code=(f[0]||'').toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(code)){errors.push(`Row ${n}: "${f[0]||''}" is not an account code.`);continue;}
  if(++nrows>MAX_ROWS){errors.push(`Too many rows (at most ${MAX_ROWS}).`);break;}
  const name=nameCol>=0?(f[nameCol]||''):'';
  for(const y of years){
   const amt=i=>{const s=f[i];if(s===undefined||s==='')return 0;const v=parseAmount(s);if(v===null)errors.push(`Row ${n}: "${s}" is not an amount (${y.as_of}).`);return v;};
   let debit,credit;
   if(y.g.net!==null){const v=amt(y.g.net);if(v===null)continue;debit=v>0?v:0;credit=v<0?-v:0;}
   else{debit=amt(y.g.debit);credit=amt(y.g.credit);if(debit===null||credit===null)continue;
    if(debit<0||credit<0){errors.push(`Row ${n}: debit and credit are positive amounts (${y.as_of}).`);continue;}
    if(debit&&credit){errors.push(`Row ${n}: ${code} has both a debit and a credit on ${y.as_of}. Enter the net balance.`);continue;}}
   if(!debit&&!credit)continue;
   if(y.seen.has(code)){if(!y.duplicates.includes(code))y.duplicates.push(code);continue;}
   y.seen.add(code);y.rows.push({code,name,debit,credit});
  }
 }
 if(errors.length)return {years:[],errors:errors.slice(0,12).concat(errors.length>12?[`and ${errors.length-12} more problem(s)`]:[])};
 return {years:years.map(y=>({as_of:y.as_of,rows:y.rows,duplicates:y.duplicates})),errors:[]};
}

// known: Map(code -> name) of the chart of accounts. maps: statement-line map rows. lineDefs: statement_lines rows. existing: the current recorded trial balances [{tb_kind,as_of,version,row_count,total_debit,total_credit}].
// startsOn: the first day of the ledger year being prepared. Returns the preview, year by year, and whether it can be saved.
export function previewMultiYearTb({text,known,maps=[],lineDefs=[],existing=[],startsOn}){
 const p=parseMultiYearTb(text),dates=expectedDates(startsOn);
 if(p.errors.length)return {version:MULTI_VERSION,ok:false,can_save:false,parse_errors:p.errors,years:[],expected:{year_end:dates.prior_end,opening:dates.opening_as_of},problems:p.errors,warnings:[]};
 const defs=new Map(lineDefs.map(l=>[l.line_code,l])),warnings=[],problems=[];
 const years=p.years.map(y=>{
  const role=y.as_of===dates.opening_as_of?'Opening':'Year-end',expected=y.as_of===dates.prior_end||y.as_of===dates.opening_as_of;
  const probs=[];let d=0,c=0,mapped=0,unmapped=[],mappedC=0,unmappedC=0;const unknown=[];
  if(y.as_of>=startsOn)probs.push(`${y.as_of} is not before this financial year starts (${startsOn}).`);
  if(!y.rows.length)probs.push('This year has no balances.');
  for(const r of y.rows){
   d+=cents(r.debit);c+=cents(r.credit);const net=cents(r.debit)-cents(r.credit);
   if(!known.has(r.code)){unknown.push(r.code);continue;}
   const m=mapInForce(maps,r.code,y.as_of),ok=m&&defs.has(m.line_code);
   if(ok){mapped++;mappedC+=Math.abs(net);}else{unmapped.push({code:r.code,name:r.name||known.get(r.code)||'',amount:kes(net)});unmappedC+=Math.abs(net);}
  }
  if(y.duplicates.length)probs.push(`${y.duplicates.slice(0,8).join(', ')} appears more than once in this year. Enter one net balance per account.`);
  if(unknown.length)probs.push(`Not in the chart of accounts: ${unknown.slice(0,8).join(', ')}${unknown.length>8?` and ${unknown.length-8} more`:''}. They are not guessed; map or add them first.`);
  const diff=d-c,balanced=Math.abs(diff)<1;
  if(y.rows.length&&!balanced)probs.push(`Does not balance: debits KES ${money(d)}, credits KES ${money(c)} (difference KES ${money(Math.abs(diff))}).`);
  const cur=existing.find(t=>t.tb_kind===role&&String(t.as_of).slice(0,10)===y.as_of)||null;
  const same=!!cur&&Number(cur.row_count)===y.rows.length&&cents(cur.total_debit)===d&&cents(cur.total_credit)===c;
  const state=probs.length?'Blocked':unmapped.length?'Accounts not mapped':'Ready';
  return {as_of:y.as_of,role,expected,rows:y.rows.length,total_debit:kes(d),total_credit:kes(c),difference:kes(Math.abs(diff)),balanced,
   mapped_accounts:mapped,unmapped_accounts:unmapped.length,unmapped_amount:kes(unmappedC),mapped_amount:kes(mappedC),unmapped:unmapped.slice(0,50),unmapped_more:Math.max(0,unmapped.length-50),
   unknown_accounts:unknown.length,duplicates:y.duplicates,replaces:cur?{version:Number(cur.version)}:null,same_as_recorded:same,problems:probs,state,can_save:!probs.length};
 });
 for(const y of years)for(const m of y.problems)problems.push(`${y.as_of}: ${m}`);
 if(!years.some(y=>y.as_of===dates.prior_end))warnings.push(`There is no column for ${dates.prior_end}. The comparatives need a year-end trial balance as of that date.`);
 if(!years.some(y=>y.as_of===dates.opening_as_of))warnings.push(`There is no column for ${dates.opening_as_of}. Without it the prior-year cash flow and equity movements are Not available.`);
 for(const y of years)if(!y.expected)warnings.push(`${y.as_of} is recorded as an earlier year-end. The comparatives do not use it.`);
 const um=years.filter(y=>y.unmapped_accounts);
 if(um.length)warnings.push(`${um.reduce((n,y)=>n+y.unmapped_accounts,0)} account balance(s) have no approved statement line (${um.map(y=>y.as_of).join(', ')}). They can be recorded, but the comparatives will say Needs review until the statement-line map is approved.`);
 for(const y of years)if(y.same_as_recorded)warnings.push(`${y.as_of}: same rows and totals as version ${y.replaces.version} already recorded. Saving adds a new version.`);
 return {version:MULTI_VERSION,ok:!problems.length,can_save:!problems.length&&years.length>0,needs_unmapped_ack:um.length>0,parse_errors:[],years,expected:{year_end:dates.prior_end,opening:dates.opening_as_of},problems,warnings,
  closing_note:'Year-end columns are recorded as year-end trial balances with the "taken" state you choose. The column dated '+dates.opening_as_of+' is recorded as the opening trial balance, after the year-end close.'};
}
