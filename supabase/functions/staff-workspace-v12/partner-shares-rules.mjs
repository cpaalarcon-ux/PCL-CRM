// Partners' profit shares (build 2872). Pure: no database. A partnership deed says how profit and loss are shared. The shares are recorded for each year with the deed as evidence,
// approved by a Partner, and only then used to allocate the year's profit to the partners. Shares are held as basis points (hundredths of a percent) so they always add to exactly 100%.
// Not covered, and refused rather than guessed: a deed that gives partners a salary or interest on capital before the split, or shares losses differently from profit.
export const MIN_PARTNERS=2,MAX_PARTNERS=20;
// "50", "33.33" or "33.33%" to basis points. More than two decimals, zero, negative or above 100 is refused.
export function percentToBp(text){
 const t=String(text??'').trim().replace(/%$/,'').trim();
 if(!/^\d{1,3}(\.\d{1,2})?$/.test(t))return null;
 const bp=Math.round(Number(t)*100);
 return bp>=1&&bp<=10000?bp:null;
}
export const bpToPercent=bp=>(Number(bp)/100).toFixed(2).replace(/\.?0+$/,'')+'%';
const cleanName=v=>String(v??'').replace(/\s+/g,' ').trim();
// rows: [{partner_name, share_percent}]. Returns {ok, problems, lines:[{partner_name, share_bp}]}.
export function validateShares(rows){
 const problems=[],lines=[],seen=new Set();
 if(!Array.isArray(rows)||rows.length<MIN_PARTNERS)return {ok:false,problems:[`A partnership has at least ${MIN_PARTNERS} partners. Enter every partner and share from the deed.`],lines:[]};
 if(rows.length>MAX_PARTNERS)return {ok:false,problems:[`At most ${MAX_PARTNERS} partners can be recorded here.`],lines:[]};
 rows.forEach((r,i)=>{
  const name=cleanName(r?.partner_name),bp=percentToBp(r?.share_percent),n=i+1;
  if(name.length<2||name.length>120){problems.push(`Partner ${n}: enter the partner's full name (2 to 120 characters).`);return;}
  if(seen.has(name.toLowerCase())){problems.push(`${name} appears twice.`);return;}seen.add(name.toLowerCase());
  if(bp===null){problems.push(`${name}: the share must be a percentage above 0 and up to 100, with at most two decimals.`);return;}
  lines.push({partner_name:name,share_bp:bp});
 });
 if(!problems.length){const total=lines.reduce((s,l)=>s+l.share_bp,0);if(total!==10000)problems.push(`The shares add to ${bpToPercent(total)}, not 100%. Check them against the deed.`);}
 return {ok:problems.length===0,problems,lines:problems.length?[]:lines};
}
// Share a year's profit or loss between the partners, in whole cents (decimals 2) or whole presentation units (decimals 0). Each partner gets the rounded-down share; the cents left over go one each to the partners with the largest
// fractions (ties to the earlier name), so the parts always add to the profit exactly and the same inputs always give the same answer.
export function allocateProfit(profit,lines,decimals=2){
 const k=10**decimals,cents=BigInt(Math.round(Number(profit||0)*k)),neg=cents<0n,abs=neg?-cents:cents;
 const parts=lines.map((l,i)=>{const num=abs*BigInt(l.share_bp);return {i,partner_name:l.partner_name,share_bp:l.share_bp,base:num/10000n,rem:num%10000n};});
 let left=abs-parts.reduce((s,p)=>s+p.base,0n);
 const order=[...parts].sort((a,b)=>a.rem>b.rem?-1:a.rem<b.rem?1:a.partner_name.localeCompare(b.partner_name));
 for(const p of order){if(left<=0n)break;p.base+=1n;left-=1n;}
 const rows=parts.map(p=>({partner_name:p.partner_name,share_bp:p.share_bp,amount:Number(neg?-p.base:p.base)/k}));
 return {rows,total:Number(cents)/k};
}
// The state the pack check reads: none, draft (recorded, not approved) or approved.
export function sharesState({approved,draft}){return approved?{status:'approved',set:approved}:draft?{status:'draft',set:draft}:{status:'none',set:null};}
