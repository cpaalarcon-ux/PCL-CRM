import {guideBanner,GUIDE} from './staff-guide-text.mjs?v=20261107-views-v1';
// Non-eTIMS exceptions: mapping a purchase that has no eTIMS invoice needs a named legal basis from an approved list, evidence, and a
// check against other purchases and the bank. A Partner approves each basis; a Manager or Partner can add one for approval.
export function createNonEtimsUI(ctx){
 const {$,esc,request}=ctx,d=()=>ctx.data();
 const opts=(items,value='',blank='Choose…')=>`<option value="">${esc(blank)}</option>`+items.map(([k,v])=>`<option value="${esc(k)}" ${String(k)===String(value)?'selected':''}>${esc(v)}</option>`).join('');
 const money=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n||0));
 const badge=s=>`<span class="badge ${s==='Active'?'ok':s==='Retired'?'muted':'warn'}">${esc(s==='Testing'?'In testing':s==='Active'?'Approved':s)}</span>`;

 /** Fills the #neException block of the mapping form. Called after the form is on screen. */
 async function exceptionFields(f,list,pid,draft){
  const host=$('#neException');if(!host)return;
  try{
   const ids=list.map(x=>x.row_id).slice(0,500);
   const [{bases,categories},{duplicates,window_days:win}]=await Promise.all([request({action:'non_etims_bases'}),request({action:'non_etims_check',project_id:pid,row_ids:ids})]);
   if(!$('#neException'))return;
   const usable=bases.filter(b=>b.status!=='Retired'),current=draft?.basis_code||(list.length===1?list[0].review_details?.basis_code:'')||'';
   const currentBasis=usable.find(b=>b.basis_code===current),category=draft?.legal_category||currentBasis?.legal_category||(list.length===1?list[0].review_details?.legal_category||list[0].normalized?.legal_category:'')||'';
   const docs=(d().documents||[]).filter(x=>x.project_id===pid&&!x.archived_at);
   const dupRows=Object.entries(duplicates||{});
   const dupHtml=dupRows.length?`<div class="warning full" role="alert"><b>Possible duplicate</b><ul>${dupRows.flatMap(([rid,ms])=>{const src=list.find(x=>x.row_id===rid);return ms.map(m=>`<li>Row ${esc(src?.source_row??'')}: ${esc(m.kind)} — ${esc(m.dataset)} row ${esc(m.source_row)}${m.party?' · '+esc(m.party):''}${m.date?' · '+esc(m.date):''} · ${money(m.amount)}</li>`);}).join('')}</ul><p class="muted">A bank debit may simply be the payment of this purchase. Keep the row only if it is not the same cost counted twice, and say why.</p></div><label class="full">Why this is not a duplicate *<textarea name="duplicate_reason" maxlength="500" required minlength="10"></textarea></label>`:'';
   host.innerHTML=`${guideBanner('How non-eTIMS purchases are supported',GUIDE.nonEtims,esc,{open:false})}<label>Legal category *<select name="legal_category" required>${opts(categories.map(c=>[c,c]),category,'Choose category')}</select></label><label>Legal basis *<select name="basis_code" required></select></label><p id="neBasisHelp" class="muted full"></p><label>Evidence document<select name="evidence_document_id">${opts(docs.map(x=>[x.document_id,x.file_name]),draft?.evidence_document_id||list[0]?.review_details?.evidence_document_id||'','No document linked')}</select></label><label>Receipt / evidence reference<input name="evidence_reference" maxlength="500" value="${esc(draft?.evidence_reference||list[0]?.review_details?.evidence_reference||'')}"></label><p class="muted full">Link a document, or type the receipt or evidence reference. At least one is needed.</p>${dupHtml}`;
   const cat=f.elements.legal_category,basis=f.elements.basis_code,help=$('#neBasisHelp');
   const paint=()=>{const list2=usable.filter(b=>!cat.value||b.legal_category===cat.value);basis.innerHTML=opts(list2.map(b=>[b.basis_code,b.label+(b.status==='Active'?'':' (in testing)')]),current&&list2.some(b=>b.basis_code===current)?current:basis.value);const b=usable.find(x=>x.basis_code===basis.value);help.textContent=b?`${b.guidance||''} ${b.status==='Active'?'Approved reference: '+b.legal_reference:'Not yet approved by a Partner: tax review stays blocked for rows on this basis.'}`.trim():'';};
   cat.onchange=paint;basis.onchange=()=>{const b=usable.find(x=>x.basis_code===basis.value);if(b&&cat.value!==b.legal_category)cat.value=b.legal_category;paint();};paint();
  }catch(error){host.innerHTML=`<p class="info full">${esc(error.message||'Legal bases could not be loaded.')}</p>`;}
 }

 /** Partner / Manager screen: the list of bases, add, approve and retire. */
 async function adminBases(){
  const {modal,form,field,select,area,check,button,table,shortDate}=ctx;
  const r=await request({action:'non_etims_bases'});
  const rows=r.bases.map(b=>[esc(b.basis_code),esc(b.label),esc(b.legal_category),badge(b.status),esc(b.legal_reference||'—'),String(b.used||0),
   [r.can_edit&&b.status==='Testing'?button('ne-edit','Edit',b.basis_id):'',r.can_approve&&b.status==='Testing'?button('ne-approve','Approve',b.basis_id):'',r.can_approve&&b.status!=='Retired'?button('ne-retire','Retire',b.basis_id):''].join(' ')]);
  modal('Non-eTIMS legal bases',`<p class="info">A purchase without an eTIMS invoice can stay in the working only on an approved basis. Bases start in testing. A Partner approves one after entering the legal reference they verified; a retired basis stays on earlier rows but cannot be chosen again.</p>${r.can_edit?`<p>${button('ne-new','+ Add a basis')}</p>`:''}${table(['Code','Basis','Category','Status','Legal reference','Rows','Action'],rows)}`);
  $('#editorBody')._ne=r;
 }
 const find=id=>($('#editorBody')._ne?.bases||[]).find(b=>b.basis_id===id);
 async function handle(action,id){
  const {modal,form,field,select,area,check}=ctx;
  if(action==='ne-bases'){await adminBases();return true;}
  if(action==='ne-new'||action==='ne-edit'){
   const b=action==='ne-edit'?find(id):null,cats=$('#editorBody')._ne.categories;
   modal(b?'Edit '+b.basis_code:'Add a legal basis',form((b?'':field('basis_code','Basis code *','','text','required maxlength="30" pattern="[A-Za-z0-9-]{3,30}" placeholder="NE-EXAMPLE"'))+select('legal_category','Legal category *',cats,b?.legal_category||'','Choose category')+field('label','Name of the basis *',b?.label||'','text','required maxlength="200"')+area('guidance','What evidence is needed',b?.guidance||'')+field('legal_reference','Legal reference (a Partner must verify it before approval)',b?.legal_reference||'','text','maxlength="500"'),b?'Save basis':'Add basis'),f=>request({action:'non_etims_basis_save',...(b?{basis_id:b.basis_id,revision:b.revision}:{}),...Object.fromEntries(f)}),async()=>{await adminBases();});
   return true;
  }
  if(action==='ne-approve'){
   const b=find(id);
   modal('Approve · '+b.label,form(`<p class="info full">Approving makes this basis available for client work without a testing flag. Enter the Act section, regulation or KRA notice you checked.</p>`+field('legal_reference','Legal reference you verified *',b.legal_reference||'','text','required minlength="10" maxlength="500"')+check('confirm_verified','I checked this reference against the official source and the basis fits the category'),'Approve basis'),f=>request({action:'non_etims_basis_approve',basis_id:b.basis_id,revision:b.revision,legal_reference:f.get('legal_reference'),confirm_verified:f.has('confirm_verified')}),async()=>{await adminBases();});
   return true;
  }
  if(action==='ne-retire'){
   const b=find(id);
   modal('Retire · '+b.label,form(`<p class="info full">Rows already on this basis keep it. New rows cannot choose it.</p>`+area('reason','Reason *','' ),'Retire basis'),f=>request({action:'non_etims_basis_retire',basis_id:b.basis_id,revision:b.revision,reason:f.get('reason')}),async()=>{await adminBases();});
   return true;
  }
  return false;
 }
 return {exceptionFields,adminBases,handle};
}
