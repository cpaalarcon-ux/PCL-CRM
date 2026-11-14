// Exception queue for bank statement lines (build 2785): a list with filters on the left, the chosen line and the account dropdown on the right.
// Pure view helpers. Mapping uses the existing actions, which re-check everything on the server; nothing posts to the ledger from this screen.
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const REASONS=[['all','All lines'],['Not mapped','Not mapped'],['suggested','Has a rule suggestion'],['transfer','Transfers without an opposite line']];
export const DIRS=[['all','Money in or out'],['in','Money in'],['out','Money out']];
export const newState=()=>({reason:'all',dir:'all',bank:'',q:'',active:null,sel:new Set()});

// The wording of a line without its numbers, so "MPESA CHARGE 8821" and "MPESA CHARGE 9934" are recognised as alike.
export const wordingKey=i=>norm((i.reference||'')+' '+(i.description||'')).split(' ').filter(t=>t.length>=3&&!/\d/.test(t)).slice(0,6).join(' ');
const direction=i=>Number(i.money_in)>0?'in':Number(i.money_out)>0?'out':'';
const unmapped=i=>i.reason==='Not mapped';

export function filterItems(items,fx){
 const q=norm(fx.q);
 return (items||[]).filter(i=>(fx.reason==='all'||(fx.reason==='Not mapped'?unmapped(i):fx.reason==='suggested'?!!i.suggestion:fx.reason==='transfer'?!unmapped(i):true))
  &&(fx.dir==='all'||direction(i)===fx.dir)&&(!fx.bank||i.bank===fx.bank)&&(!q||norm([i.reference,i.description,i.bank].join(' ')).includes(q)));
}
// Other unmapped lines with the same wording and the same direction as this one.
export function similarLines(items,item){
 const k=item&&unmapped(item)?wordingKey(item):'';if(!k)return [];
 return (items||[]).filter(i=>i.row_id!==item.row_id&&unmapped(i)&&direction(i)===direction(item)&&wordingKey(i)===k);
}
export function accountGroups(accounts){
 const g=new Map();for(const a of accounts||[]){const k=a.group||'Other';if(!g.has(k))g.set(k,[]);g.get(k).push(a);}
 return [...g.entries()].map(([group,list])=>({group,accounts:list}));
}
export const banksOf=items=>[...new Set((items||[]).map(i=>i.bank).filter(Boolean))].sort();

export function filterBar({fx,items,h}){
 const opt=(list,cur)=>list.map(([v,l])=>`<option value="${h.esc(v)}"${String(v)===String(cur)?' selected':''}>${h.esc(l)}</option>`).join('');
 return `<div class="fx-filters" role="search"><label>Show<select id="fxReason">${opt(REASONS,fx.reason)}</select></label><label>Direction<select id="fxDir">${opt(DIRS,fx.dir)}</select></label><label>Bank<select id="fxBank">${opt([['','All banks'],...banksOf(items).map(b=>[b,b])],fx.bank)}</select></label><label>Search<input id="fxQ" type="search" value="${h.esc(fx.q)}" placeholder="Reference or description" maxlength="60"></label></div>`;
}

export function listView({shown,fx,h}){
 if(!shown.length)return '<p class="info">No lines match these filters.</p>';
 return `<div class="scroll"><table id="fixitList"><thead><tr><th><span class="sr-only">Select</span></th><th>Date</th><th>Line</th><th>In</th><th>Out</th><th></th></tr></thead><tbody>${shown.map(i=>`<tr${fx.active===i.row_id?' class="fx-active" aria-current="true"':''}><td>${unmapped(i)?`<input type="checkbox" class="fixit-pick" data-row="${h.esc(i.row_id)}" data-rev="${h.esc(i.revision)}" aria-label="Select line"${fx.sel.has(i.row_id)?' checked':''}>`:''}</td><td>${h.esc(h.shortDate(i.date)||'')}</td><td><b>${h.esc(i.reference)}</b>${i.description?`<small>${h.esc(i.description)}</small>`:''}<small>${h.esc(i.bank||'')} · ${h.esc(i.reason)}${i.suggestion?' · rule suggestion':''}</small></td><td>${i.money_in?h.kes(i.money_in):''}</td><td>${i.money_out?h.kes(i.money_out):''}</td><td>${h.btn('fx-open','Open',i.row_id)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function detailView({item,similar,fx,accounts,acct,canMap,h}){
 if(!item)return '<aside class="fx-detail" id="fixitDetail"><p class="muted">Choose a line on the left to see it here and map it.</p></aside>';
 const sel=[...fx.sel],opts=accountGroups(accounts).map(g=>`<optgroup label="${h.esc(g.group)}">${g.accounts.map(a=>`<option value="${h.esc(a.code)}"${item.suggestion&&item.suggestion.account_code===a.code?' selected':''}>${h.esc(a.code)} ${h.esc(a.name)}</option>`).join('')}</optgroup>`).join('');
 const facts=`<dl class="fx-facts"><dt>Date</dt><dd>${h.esc(h.shortDate(item.date)||'')}</dd><dt>Bank</dt><dd>${h.esc(item.bank||'')}</dd><dt>Reference</dt><dd>${h.esc(item.reference)}</dd>${item.description?`<dt>Description</dt><dd>${h.esc(item.description)}</dd>`:''}<dt>${item.money_in?'Money in':'Money out'}</dt><dd><b>${h.kes(item.money_in||item.money_out)}</b></dd><dt>Why it is here</dt><dd>${h.esc(item.reason)}</dd></dl>`;
 if(!unmapped(item))return `<aside class="fx-detail" id="fixitDetail">${facts}<p class="info">This transfer is already mapped to an account of this client but has no opposite line on another statement within 3 days. Import the other statement, or correct the mapping in Banks.</p></aside>`;
 const sg=item.suggestion?`<p class="info">A rule suggests <b>${h.esc(item.suggestion.account_code)} ${h.esc(acct.get(item.suggestion.account_code)||'')}</b> (rule “${h.esc(item.suggestion.keyword)}”). The dropdown starts on it; you still choose.</p>`:'';
 const controls=canMap?`<label class="full">Ledger account<select id="fxAccount"><option value="">Choose an account…</option>${opts}</select></label><div class="actions">${h.btn('fx-map-one','Map this line',item.row_id)}${similar.length?h.btn('fx-map-similar',`Map this line and ${similar.length} similar`,item.row_id):''}${sel.length?h.btn('fx-map-sel',`Map ${sel.length} selected`,item.row_id):''}</div>`:'<p class="muted">Your role can look at this queue but not map lines.</p>';
 const sim=similar.length?`<p class="muted">${similar.length} other unmapped line(s) have the same wording and direction: ${similar.slice(0,3).map(s=>h.esc(s.reference)).join(', ')}${similar.length>3?'…':''}. ${h.btn('fx-select-similar','Tick them',item.row_id)}</p>`:'';
 return `<aside class="fx-detail" id="fixitDetail">${facts}${sg}${controls}${sim}<p class="muted">Mapping chooses the account the line belongs to. It does not post to the ledger: the entry register is reviewed and posted by a different person.</p></aside>`;
}

export function splitView({items,fx,accounts,acct,canMap,h}){
 const shown=filterItems(items,fx),active=(items||[]).find(i=>i.row_id===fx.active)||null;
 const selShown=shown.filter(i=>unmapped(i));
 return `${filterBar({fx,items,h})}<p class="muted" id="fxCount">${shown.length} of ${(items||[]).length} line(s) shown${fx.sel.size?` · ${fx.sel.size} ticked`:''}.${canMap&&selShown.length?' '+h.btn('fx-select-shown',`Tick the ${selShown.length} unmapped shown`,''):''}${fx.sel.size?' '+h.btn('fx-clear','Clear ticks',''):''}</p><div class="fx-split">${listView({shown,fx,h})}${detailView({item:active,similar:similarLines(items,active),fx,accounts,acct,canMap,h})}</div>`;
}
