// Legal-form profile for the annual statements (build 2870). Pure: no database and no tax rates.
// One engine serves three legal forms. The form comes from the client record; it is never typed on the pack. It decides the captions the statements use
// and which statement lines may carry a balance. Company captions are not reused for a partnership or a sole proprietor, and a balance that belongs to
// another form is reported as a problem, never moved or hidden.
import {mapInForce} from './annual-pack-rules.mjs';

export const FORMS={COMPANY:'Company',PARTNERSHIP:'Partnership',PROPRIETOR:'Sole proprietor',OTHER:'Other'};
// Client record (legal_entity_type) to pack form. Non-profit organisations and other entities keep the general captions.
export function formOf(legalEntityType){
 const t=String(legalEntityType||'').trim();
 if(t==='Limited company')return FORMS.COMPANY;
 if(t==='Partnership')return FORMS.PARTNERSHIP;
 if(t==='Sole proprietor')return FORMS.PROPRIETOR;
 return FORMS.OTHER;
}

const OWNER_LINES=['SFP.OWNER_CAP','SFP.OWNER_CUR','SFP.DRAWINGS'];
const COMPANY_ONLY_LINES=['SFP.SHARE_CAP','SFP.SHARE_PREM','SFP.RETAINED','SFP.DIVIDENDS_PAY','PL.TAX'];

const LABELS={
 [FORMS.COMPANY]:{},
 [FORMS.PARTNERSHIP]:{
  'SFP.OWNER_CAP':"Partners' capital accounts",'SFP.OWNER_CUR':"Partners' current accounts",'SFP.DRAWINGS':"Partners' drawings",
  'SFP.CURRENT_PROFIT':'Profit for the year, to be allocated to partners','PL.PROFIT':'Profit for the year available to partners'
 },
 [FORMS.PROPRIETOR]:{
  'SFP.OWNER_CAP':"Owner's capital",'SFP.OWNER_CUR':"Owner's current account",'SFP.DRAWINGS':"Owner's drawings",
  'SFP.CURRENT_PROFIT':'Profit for the year attributable to the owner','PL.PROFIT':'Profit for the year attributable to the owner'
 },
 [FORMS.OTHER]:{}
};
const EQUITY_TITLE={[FORMS.COMPANY]:'Statement of changes in equity',[FORMS.PARTNERSHIP]:"Statement of changes in partners' equity",[FORMS.PROPRIETOR]:"Statement of changes in owner's equity",[FORMS.OTHER]:'Statement of changes in equity'};
const MOVE_LABEL={
 [FORMS.COMPANY]:{DIVIDENDS_DRAWINGS:'Dividends declared',CAPITAL:'Shares issued or capital repaid'},
 [FORMS.PARTNERSHIP]:{DIVIDENDS_DRAWINGS:'Drawings by partners',CAPITAL:'Capital introduced or withdrawn by partners'},
 [FORMS.PROPRIETOR]:{DIVIDENDS_DRAWINGS:'Drawings by the owner',CAPITAL:'Capital introduced or withdrawn by the owner'},
 [FORMS.OTHER]:{}
};
const MISFIT_REASON={
 [FORMS.COMPANY]:code=>OWNER_LINES.includes(code)?'is a partner or owner account and does not belong on a company':null,
 [FORMS.PARTNERSHIP]:code=>code==='PL.TAX'?'is income tax; a partnership is not taxed on its own account, so tax paid for the partners belongs in drawings':COMPANY_ONLY_LINES.includes(code)?'is a company account (share capital, retained earnings or dividends) and does not belong on a partnership':null,
 [FORMS.PROPRIETOR]:code=>code==='PL.TAX'?"is income tax; the owner's tax is personal, so tax paid for the owner belongs in drawings":COMPANY_ONLY_LINES.includes(code)?'is a company account (share capital, retained earnings or dividends) and does not belong on a sole proprietor':null,
 [FORMS.OTHER]:()=>null
};

// The statement lines that carry a balance, from the trial balance and the approved map. Used by the readiness check and the statements, so both agree.
export function usedLineCodes({tb,maps,asOf}){
 const out=new Set();
 for(const r of tb||[]){
  const any=Math.round(Number(r.opening||0)*100)||Math.round(Number(r.movement_debit||0)*100)||Math.round(Number(r.movement_credit||0)*100)||Math.round(Number(r.net||0)*100);
  if(!any)continue;
  const m=mapInForce(maps||[],r.code,asOf);
  if(m)out.add(m.line_code);
 }
 return out;
}
// Balances on lines that belong to another legal form: [{code,label,reason}]
export function misfits(form,usedCodes,labelOf=()=>null){
 const rule=MISFIT_REASON[form]||MISFIT_REASON[FORMS.OTHER],out=[];
 for(const code of [...usedCodes].sort()){const reason=rule(code);if(reason)out.push({code,label:labelOf(code)||code,reason});}
 return out;
}
// The readiness check for the annual pack. Pass, Blocked or Info, in the same shape as the other checks.
export function legalFormCheck({form,legalEntityType,used,labelOf}){
 if(!legalEntityType)return {status:'Blocked',detail:'The client record has no legal structure, so the statements cannot choose their captions. Set the legal structure on the client.'};
 if(form===FORMS.OTHER)return {status:'Info',detail:`${legalEntityType}: the general captions are used.`};
 const bad=misfits(form,used,labelOf);
 const names=bad.slice(0,4).map(b=>`${b.label} ${b.reason}`).join('; ');
 const base=`${form} statements for a ${legalEntityType.toLowerCase()}.`;
 if(bad.length)return {status:'Blocked',detail:`${base} ${names}${bad.length>4?` (+${bad.length-4} more)`:''}. Move the balance to the right account first.`};
 return {status:'Pass',detail:base};
}
// A partnership's statements show each partner's account. Until the deed's profit shares are recorded for the year, the allocation of profit is not known.
export function partnerSharesCheck({form,shares}){
 if(form!==FORMS.PARTNERSHIP)return null;
 if(!shares||shares.status==='none')return {status:'Blocked',detail:"The partners' profit shares from the partnership deed are not recorded for this year, so profit cannot be allocated to each partner."};
 if(shares.status==='draft')return {status:'Blocked',detail:"The partners' profit shares are recorded and wait for a Partner to approve them, so profit cannot be allocated yet."};
 const n=(shares.lines||[]).length;
 return {status:'Pass',detail:`Profit shares approved for ${n} partner${n===1?'':'s'}.`};
}

// Rewrite the captions of built statements for the form. Statements are an object from buildStatements plus changes_in_equity and cash_flow.
// Labels are replaced by line code, so the current and prior columns always agree. Figures are never touched.
export function applyCaptions(statements,form){
 if(!statements||form===FORMS.OTHER)return statements;
 const labels=LABELS[form]||{},moves=MOVE_LABEL[form]||{};
 const fixRows=rows=>{for(const r of rows||[]){if(r.code&&labels[r.code])r.label=labels[r.code];}};
 fixRows(statements.financial_position?.rows);
 fixRows(statements.profit_or_loss?.rows);
 const pl=statements.profit_or_loss?.rows||[],last=pl[pl.length-1];
 if(last&&last.kind==='total'&&last.label==='Profit for the year'&&labels['PL.PROFIT'])last.label=labels['PL.PROFIT'];
 const eq=statements.changes_in_equity;
 if(eq){
  eq.title=EQUITY_TITLE[form];
  for(const side of ['current','prior']){
   const blk=eq[side];if(!blk)continue;
   for(const c of blk.columns||[])if(labels[c.code])c.label=labels[c.code];
   for(const r of blk.rows||[])if(moves[r.move])r.label=moves[r.move];
  }
 }
 statements.legal_form=form;
 return statements;
}
