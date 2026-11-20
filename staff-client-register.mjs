// Client Register for Managers and Partners: the query, the toolbar, the pager and the extra figures on each card.
// The server returns one page at a time (erp_private.client_register); this file only builds the request and the screen pieces.
export const DEFAULT_QUERY=()=>({q:'',service:'',owner:'',sector:'',kyc:'',tax:'',opening:'',projects:'',deadline:'',sort:'name',size:25,page:0,archived:false});
export const queryToRequest=(q,firm)=>({action:'client_register_page',q:q.q||'',firm_id:firm||null,sector:q.sector||null,service_status:q.service||null,owner_staff_id:q.owner||null,kyc:q.kyc||null,tax:q.tax||null,opening:q.opening||null,projects:q.projects||null,deadline_days:q.deadline===''||q.deadline==null?null:Number(q.deadline),sort:q.sort||'name',page_size:q.size||25,page:q.page||0,show_archived:!!q.archived});
export const filterCount=q=>['service','owner','sector','kyc','tax','opening','projects','deadline'].filter(k=>q[k]!==''&&q[k]!=null).length+(q.q?1:0)+(q.archived?1:0);
const pick=(key,label,list,cur,esc)=>`<label>${esc(label)} <select data-creg="${key}"><option value=""${cur===''?' selected':''}>All</option>${list.map(([v,t])=>`<option value="${esc(v)}"${String(cur)===String(v)?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
export function toolbar(q,{sectors=[],owners=[]},esc){
 const n=filterCount(q);
 return `<div class="reg-bar" id="clientRegisterBar" role="group" aria-label="Client register filters">`+
  pick('service','Service status',[['Active','Active'],['Paused','Paused'],['Cancelled','Cancelled']],q.service,esc)+
  pick('owner','Assigned manager',owners.map(o=>[o.staff_id,o.full_name]),q.owner,esc)+
  pick('sector','Sector',sectors.map(s=>[s,s]),q.sector,esc)+
  pick('kyc','KYC',[['complete','Complete'],['outstanding','Outstanding']],q.kyc,esc)+
  pick('tax','Tax profile',[['verified','Verified'],['unverified','Not verified']],q.tax,esc)+
  pick('opening','Opening balance',[['done','Done'],['pending','Pending']],q.opening,esc)+
  pick('projects','Active projects',[['none','None'],['some','One or more']],q.projects,esc)+
  pick('deadline','Next deadline',[['7','Within 7 days'],['14','Within 14 days'],['30','Within 30 days']],q.deadline==null?'':q.deadline,esc)+
  `<label>Sort by <select data-creg="sort">${[['name','Name'],['deadline','Next deadline'],['projects','Most active projects'],['overdue','Most overdue tasks']].map(([v,t])=>`<option value="${v}"${q.sort===v?' selected':''}>${t}</option>`).join('')}</select></label>`+
  `<label><input type="checkbox" data-creg="archived"${q.archived?' checked':''}> Show archived</label>`+
  `<button type="button" data-creg-clear${n?'':' disabled'}>Clear filters${n?` (${n})`:''}</button></div>`;
}
export function pager(page,esc){
 if(!page||page.error)return '';
 const size=page.page_size||25,from=page.total?page.page*size+1:0,to=Math.min(page.total,(page.page+1)*size);
 return `<div class="reg-pager" role="navigation" aria-label="Client pages"><span>${page.total?`Showing ${from}–${to} of ${page.total} clients`:'No clients match'}</span><span class="actions"><button type="button" data-creg-page="prev"${page.page<=0?' disabled':''}>Previous</button><span>Page ${page.page+1} of ${page.pages}</span><button type="button" data-creg-page="next"${page.page+1>=page.pages?' disabled':''}>Next</button><label>Per page <select data-creg="size">${[25,50,100].map(n=>`<option value="${n}"${n===size?' selected':''}>${n}</option>`).join('')}</select></label></span></div>`;
}
// Figures for one card. A figure that is zero or empty is left out (a row of zeros is just empty space); if nothing is left the row is not drawn.
// WIP is unbilled approved time at standard rates, for Managers and Partners with the Billing area; it uses the same definition as the Finance page.
export function compactKes(n){
 const v=Number(n)||0,t=x=>String(Math.round(x*10)/10).replace(/\.0$/,'');
 if(v>=1e6)return 'KES '+t(v/1e6)+'M';
 if(v>=1e3)return 'KES '+t(v/1e3)+'K';
 return 'KES '+Math.round(v);
}
export function rowMeta(r,esc,shortDate,wip=null){
 const parts=[];
 if(r){
  if(r.active_projects>0)parts.push(`<span>${r.active_projects} active ${r.active_projects===1?'project':'projects'}</span>`);
  if(r.open_tasks>0)parts.push(`<span>${r.open_tasks} open ${r.open_tasks===1?'task':'tasks'}${r.overdue_tasks?` · <b class="missing">${r.overdue_tasks} overdue</b>`:''}</span>`);
  if(r.next_deadline)parts.push(`<span>${new Date(r.next_deadline)<new Date()?'<span class="missing">Overdue since</span>':'Next deadline'} ${esc(shortDate(r.next_deadline))}</span>`);
 }
 if(wip&&wip.wip_unbilled>0){
  const full='KES '+Math.round(wip.wip_unbilled).toLocaleString('en-KE')+' of approved time not yet billed'+(wip.hours_without_rate>0?`. ${wip.hours_without_rate} approved hours have no rate, so this is understated`:'');
  parts.push(`<span class="cc-wip" title="${esc(full)}"><b>${esc(compactKes(wip.wip_unbilled))}</b> WIP${wip.hours_without_rate>0?'*':''}</span>`);
 }
 return parts.length?`<div class="cc-figures" data-reg-meta>${parts.join('')}</div>`:'';
}
