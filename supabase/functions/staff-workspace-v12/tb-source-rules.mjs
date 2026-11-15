// Build 2827: reading amounts and checking account choices on a client's trial balance workbook.
// This file is plain JavaScript with no imports so the browser screen and the server use the same logic (the copy at the repository root must stay identical).
const CURRENCY=/^(kes|ksh|kshs|k\.?sh\.?s?|kes\.|ksh\.|\/=)\s*|\s*(\/=|kes|ksh|kshs)$/i;

// Reads one spreadsheet cell as an amount. Returns {ok,value,converted,problem}.
// Accepts numbers, "1,234.50", "(1,234.50)" (negative), "-1,234.50", "1,234.50-" (negative), "KES 1,234.50", and a lone dash or blank (nil).
// Anything else is a problem that names what was found; nothing is guessed. converted is true when the stored number differs from what the cell showed.
export function sourceAmount(raw){
 if(raw===null||raw===undefined||raw==='')return {ok:true,value:0,converted:false};
 if(raw instanceof Date)return {ok:false,problem:'is a date, not an amount'};
 if(typeof raw==='boolean')return {ok:false,problem:'is true/false, not an amount'};
 if(typeof raw==='number')return Number.isFinite(raw)&&Math.abs(raw)<=1e12?{ok:true,value:raw,converted:raw<0}:{ok:false,problem:'is not a usable number'};
 if(typeof raw==='object')return {ok:false,problem:'is a formula or object with no value (open the workbook, let it calculate, and save it again)'};
 let s=String(raw).replace(/[   ]/g,' ').trim();
 if(!s)return {ok:true,value:0,converted:false};
 s=s.replace(/[−‒–—]/g,'-');
 if(/^-+$/.test(s))return {ok:true,value:0,converted:true};
 let negative=false;
 const bracket=s.match(/^\(\s*(.*?)\s*\)$/);
 if(bracket){negative=true;s=bracket[1];}
 s=s.replace(CURRENCY,'').trim();
 if(/^-/.test(s)){negative=true;s=s.slice(1).trim();}
 else if(/-$/.test(s)){negative=true;s=s.slice(0,-1).trim();}
 s=s.replace(CURRENCY,'').trim();
 if(!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$|^\.\d+$/.test(s))return {ok:false,problem:'is not a number'};
 const n=Number(s.replace(/,/g,''));
 if(!Number.isFinite(n)||n>1e12)return {ok:false,problem:'is not a usable number'};
 if(Math.abs(n*100-Math.round(n*100))>.0001)return {ok:false,problem:'has more than two decimal places'};
 return {ok:true,value:negative?-n:n,converted:true};
}

export const columnLetters=i=>{let n=Number(i),out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return out;};

// One sentence for a bad cell. row is the Excel row number, column is 1-based.
export function amountProblem({row,column,label,raw,problem}){
 return `Excel row ${row}, column ${columnLetters(column)} (${label}): "${String(raw).slice(0,40)}" ${problem}. Correct that cell in the workbook (a plain number such as 1234.50, or (1,234.50) for a credit shown in brackets) and upload again.`;
}

const CONTROL=/^(total|subtotal|sub-total|grand total|net total|balance check|difference in books)\b/i;
export const isControlRow=(...cells)=>cells.some(c=>CONTROL.test(String(c||'').trim()));

// A source row that is the profit or loss for the year. It is a result, not capital or a reserve.
export function isProfitLossForYear(name){
 const n=String(name||'').toLowerCase().replace(/[^a-z0-9/ ]+/g,' ').replace(/\s+/g,' ').trim();
 if(!n)return false;
 if(/retained|brought forward|b\/f|bf|accumulated|reserve|appropriation|drawings|distribution|dividend/.test(n))return false;
 return /^(net |current year |year )?(profit|loss|surplus|deficit)( (or|and) (profit|loss|surplus|deficit))?( for the (financial )?(year|period))?( current year)?$/.test(n)||/^profit ?\/ ?loss( for the (financial )?(year|period))?$/.test(n)||/^(profit|loss) (for|of) the (financial )?(year|period)( ended.*)?$/.test(n)||/^current year (profit|loss|result|earnings)/.test(n);
}
const NOT_FOR_RESULT=new Set(['30000','30010','33000','34000','34100','34200','35000','36000']);
// Returns a sentence when this source name must not be mapped to this ERP account, otherwise ''.
export function mappingConflict(sourceName,erpCode){
 const code=String(erpCode||'').trim();
 if(!code)return '';
 if(isProfitLossForYear(sourceName)){
  const n=Number(code);
  if(NOT_FOR_RESULT.has(code)||!(n>=30000&&n<40000))return `"${String(sourceName).trim()}" is the profit or loss for the year, so it cannot go to ${code}. Map it to retained earnings or the current-year result account.`;
 }
 return '';
}
