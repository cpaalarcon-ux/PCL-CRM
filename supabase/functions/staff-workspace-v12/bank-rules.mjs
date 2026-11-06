// Bank statement line rules and the Fix-It queue. Pure functions; the actions in bank-lines.ts call them.
// A rule maps a keyword in a line's reference or description to a ledger account. Only Active rules (approved by a different
// Manager or Partner) are ever applied. A line is never mapped to its own bank's ledger account.
import {pairTransfers} from './bank-close.mjs';
export const MATCH_MODES=['Contains','Starts with'];
export const DIRECTIONS=['Money in','Money out','Either'];
export const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const num=v=>Number(v||0);
export const lineText=r=>norm([r.normalized?.reference,r.normalized?.description,r.normalized?.narration].filter(x=>x!=null&&String(x).trim()!=='').join(' '));
// Statement convention in this ERP: credit is money in, debit is money out.
export const lineDirection=r=>num(r.normalized?.credit)>0?'Money in':num(r.normalized?.debit)>0?'Money out':'Either';
export const lineMoney=r=>({in:num(r.normalized?.credit),out:num(r.normalized?.debit)});

// The most specific Active rule wins: longest keyword first, then a rule for one direction over 'Either', then the oldest rule.
export function matchRule(rules,row,ownGl=null){
 const text=lineText(row),dir=lineDirection(row);
 const hits=(rules||[]).filter(r=>r.status==='Active'&&norm(r.keyword).length>=3&&(r.direction==='Either'||r.direction===dir)
  &&(r.match_mode==='Starts with'?text.startsWith(norm(r.keyword)):(' '+text+' ').includes(' '+norm(r.keyword)+' '))
  &&String(r.account_code)!==String(ownGl||''));
 hits.sort((a,b)=>norm(b.keyword).length-norm(a.keyword).length||(a.direction==='Either')-(b.direction==='Either')||String(a.created_at).localeCompare(String(b.created_at))||String(a.rule_id).localeCompare(String(b.rule_id)));
 return hits[0]||null;
}

// Lines still needing a person, newest problems first: not mapped (with the rule that would map them, if any) and
// own-account transfers with no opposite line.
export function fixItQueue({rows=[],rules=[],bankAccounts=[],limit=500}={}){
 const gl=new Map(bankAccounts.map(b=>[b.bank_account_id,String(b.gl_code)])),label=new Map(bankAccounts.map(b=>[b.bank_account_id,b.bank_name+(b.account_label?' '+b.account_label:'')]));
 const items=[];
 for(const r of rows){
  if(r.account_code)continue;
  const rule=matchRule(rules,r,gl.get(r.bank_account_id));
  items.push({row_id:r.row_id,revision:r.revision,reason:'Not mapped',date:r.normalized?.date||null,reference:r.normalized?.reference||'',description:r.normalized?.description||'',...(({in:i,out:o})=>({money_in:i,money_out:o}))(lineMoney(r)),
   bank:label.get(r.bank_account_id)||null,suggestion:rule?{rule_id:rule.rule_id,keyword:rule.keyword,account_code:rule.account_code}:null});
 }
 for(const r of pairTransfers(rows).unpaired){
  items.push({row_id:r.row_id,revision:r.revision,reason:'Transfer has no opposite line',date:r.normalized?.date||null,reference:r.normalized?.reference||'',description:r.normalized?.description||'',...(({in:i,out:o})=>({money_in:i,money_out:o}))(lineMoney(r)),
   bank:label.get(r.bank_account_id)||null,account_code:r.account_code,suggestion:null});
 }
 items.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 return {total:items.length,not_mapped:items.filter(i=>i.reason==='Not mapped').length,suggested:items.filter(i=>i.suggestion).length,transfers_unpaired:items.filter(i=>i.reason!=='Not mapped').length,items:items.slice(0,limit),truncated:items.length>limit};
}

// A proposed rule must be specific enough not to swallow unrelated lines.
export function ruleProblem({keyword,match_mode,direction}){
 const k=norm(keyword);
 if(k.length<3)return 'Use at least three letters or digits in the keyword.';
 if(!MATCH_MODES.includes(match_mode))return 'Choose how the keyword is matched.';
 if(!DIRECTIONS.includes(direction))return 'Choose whether the rule applies to money in, money out or either.';
 if(/^[0-9 ]+$/.test(k)&&k.replace(/ /g,'').length<6)return 'A rule on digits alone needs at least six digits.';
 return null;
}
