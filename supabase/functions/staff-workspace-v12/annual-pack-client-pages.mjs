// Client-specific pages of the annual pack (build 2884): cover, entity information, report of the directors or partners, statement of responsibilities and key figures.
// Pure: no database. Nothing here is guessed or filled in for the client.
//  * COVER and STATISTICS are built only from verified client facts and the statements; they are never declared.
//  * ENTITY_INFO (bankers, auditors, secretary, advocates), REPORT (review of the business, dividends) and RESPONSIBILITIES (the statement, the date it was approved and who signs) are declared for the
//    year by staff and approved by a Manager or Partner who did not declare them. "Not applicable" is a decision recorded with a reason and approved by a Partner.
//  * The people named come from the client's own records: directors who served in the year, the partners whose profit shares a Partner approved, and officers and signatories a second person verified.
//  * The built-in statement text is a DRAFT put into the form for staff to read and change. Only the text a reviewer approved is ever used.
// No imports: annual-pack-rules imports this module, so it must not import anything that imports annual-pack-rules.
const FORMS={COMPANY:'Company',PARTNERSHIP:'Partnership',PROPRIETOR:'Sole proprietor',OTHER:'Other'};
export const PAGES_VERSION='client-pages-v1';
export const PAGE_CODES=['ENTITY_INFO','REPORT','RESPONSIBILITIES'];
export const PAGE_STATES=['Declared','Not applicable'];
export const SYSTEM_PAGES=['COVER','STATISTICS'];
export const PAGE_ORDER=['COVER','ENTITY_INFO','REPORT','RESPONSIBILITIES','STATISTICS'];

const who=form=>form===FORMS.COMPANY?'directors':form===FORMS.PARTNERSHIP?'partners':form===FORMS.PROPRIETOR?'proprietor':'officers';
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
export function pageTitle(code,form){
 switch(code){
  case 'COVER':return 'Cover';
  case 'ENTITY_INFO':return 'Entity information';
  case 'REPORT':return form===FORMS.COMPANY?'Report of the directors':form===FORMS.PARTNERSHIP?'Report of the partners':form===FORMS.PROPRIETOR?'Report of the proprietor':'Report of the officers';
  case 'RESPONSIBILITIES':return form===FORMS.COMPANY?'Statement of directors’ responsibilities':form===FORMS.PARTNERSHIP?'Statement of partners’ responsibilities':form===FORMS.PROPRIETOR?'Statement of the proprietor’s responsibilities':'Statement of responsibilities';
  case 'STATISTICS':return 'Key figures';
  default:return code;
 }
}
// The declared fields of each page for a legal form. required: must be filled. A line that the client genuinely does not have is written out ("None"); a blank is never read as "none".
export function fieldsFor(code,form,{secretaryOnRecord=false}={}){
 if(code==='ENTITY_INFO'){
  const f=[{key:'bankers',label:'Principal bankers',min:2,max:300,required:true},{key:'auditors',label:'Auditors',min:2,max:300,required:true}];
  if(form===FORMS.COMPANY&&!secretaryOnRecord)f.push({key:'secretary',label:'Company secretary',min:2,max:300,required:true});
  if(form===FORMS.COMPANY||form===FORMS.PARTNERSHIP)f.push({key:'advocates',label:'Advocates',min:2,max:300,required:true});
  return f;
 }
 if(code==='REPORT'){
  const f=[{key:'review',label:'Review of the business and results for the year',min:20,max:4000,required:true,multiline:true},
   {key:'dividends',label:form===FORMS.COMPANY?'Dividends':form===FORMS.PARTNERSHIP?'Profit sharing and drawings':'Drawings and distributions',min:3,max:500,required:true,multiline:true}];
  if(form===FORMS.COMPANY)f.push({key:'audit_info',label:'Statement on information given to the auditor',min:20,max:1000,required:false,multiline:true});
  return f;
 }
 if(code==='RESPONSIBILITIES')return [{key:'statement',label:'Statement of responsibilities',min:50,max:3000,required:true,multiline:true}];
 return [];
}
const isoDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&!Number.isNaN(Date.parse(String(v)+'T00:00:00Z'));
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();

// Check a declaration before it is stored. Returns {error} or {fields} (cleaned). candidates: the names that may sign, from the client's own records.
export function validateDeclaration({code,form,state,reason,fields,period,candidates=[],secretaryOnRecord=false}){
 if(!PAGE_CODES.includes(code))return {error:'That page is not one that is declared.'};
 if(!PAGE_STATES.includes(state))return {error:'Choose Declared or Not applicable.'};
 if(state==='Not applicable'){
  if(code==='ENTITY_INFO')return {error:'The entity information page always applies.'};
  if(String(reason||'').trim().length<10)return {error:'Say why the page does not apply, in at least 10 characters.'};
  return {fields:{},reason:String(reason).trim()};
 }
 const out={},input=fields||{};
 for(const f of fieldsFor(code,form,{secretaryOnRecord})){
  const v=String(input[f.key]??'').trim().replace(/[ \t]+\n/g,'\n');
  if(!v){if(f.required)return {error:`Enter ${f.label.charAt(0).toLowerCase()+f.label.slice(1)}. Write "None" if there is none; a blank is not read as none.`};continue;}
  if(v.length<f.min)return {error:`${f.label} needs at least ${f.min} characters.`};
  if(v.length>f.max)return {error:`${f.label} is too long (at most ${f.max} characters).`};
  out[f.key]=v;
 }
 if(code==='RESPONSIBILITIES'){
  const on=String(input.approved_on||'').trim();
  if(!isoDate(on))return {error:'Enter the date the statements were approved.'};
  if(period&&on<String(period.ends_on).slice(0,10))return {error:'The statements cannot be approved before the end of the year.'};
  out.approved_on=on;
  const names=Array.isArray(input.signatories)?input.signatories.map(x=>String(x||'').trim()).filter(Boolean):[];
  if(!names.length||names.length>3)return {error:'Choose one to three people who sign.'};
  if(new Set(names.map(norm)).size!==names.length)return {error:'Each signatory is named once.'};
  const ok=new Set(candidates.map(norm));
  for(const n of names)if(!ok.has(norm(n)))return {error:`${n} is not on the client’s record as someone who can sign. Record the person in the client file first.`};
  out.signatories=names;
 }
 return {fields:out};
}

// Draft text for the statement of responsibilities, shown in the form for staff to read and change. It is a draft, not the firm's approved wording.
export function draftStatement({form,entity,yearEnd,framework,edition}){
 const e=entity||'the entity',fw=framework&&edition?`the ${framework} (${edition})`:'the applicable financial reporting framework',ye=yearEnd||'the end of the year';
 if(form===FORMS.COMPANY)return `The Companies Act, 2015 requires the directors to prepare financial statements for each financial year that give a true and fair view of the financial position of ${e} (the Company) as at ${ye} and of its financial performance for the year then ended. The directors are responsible for keeping proper accounting records, for safeguarding the assets of the Company, and for the internal control the directors determine is necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error. The directors accept responsibility for these financial statements, which have been prepared in accordance with ${fw} and the requirements of the Companies Act, 2015, using appropriate accounting policies supported by reasonable and prudent judgements and estimates.`;
 if(form===FORMS.PARTNERSHIP)return `The partners are responsible for preparing financial statements that give a true and fair view of the financial position of ${e} (the Partnership) as at ${ye} and of its financial performance for the year then ended, in accordance with ${fw}. The partners are also responsible for keeping proper accounting records, for safeguarding the assets of the Partnership, and for the internal control they determine is necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error.`;
 if(form===FORMS.PROPRIETOR)return `The proprietor is responsible for preparing financial statements that give a true and fair view of the financial position of ${e} (the Business) as at ${ye} and of its financial performance for the year then ended, in accordance with ${fw}. The proprietor is also responsible for keeping proper accounting records, for safeguarding the assets of the Business, and for the internal control the proprietor determines is necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error.`;
 return `Those charged with governance are responsible for preparing financial statements that give a true and fair view of the financial position of ${e} as at ${ye} and of its financial performance for the year then ended, in accordance with ${fw}, for keeping proper accounting records, and for the internal control necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error.`;
}

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const longDate=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d||''));return m?`${Number(m[3])} ${MONTHS[Number(m[2])-1]} ${m[1]}`:'';};
const yearLength=(s,e)=>{const a=new Date(String(s).slice(0,10)+'T00:00:00Z'),b=new Date(String(e).slice(0,10)+'T00:00:00Z'),days=Math.round((b-a)/86400000)+1;return days;};
const periodPhrase=(s,e)=>{const days=yearLength(s,e);return days>=364&&days<=366?`For the year ended ${longDate(e)}`:`For the period from ${longDate(s)} to ${longDate(e)}`;};
const num=v=>v===null||v===undefined?null:Number(v);
const fmt=v=>v===null||v===undefined?'Not available':v<0?'('+Math.abs(v).toLocaleString('en-KE',{maximumFractionDigits:0})+')':Number(v).toLocaleString('en-KE',{maximumFractionDigits:0});
const pct=(a,b)=>b?Math.round((a/b)*1000)/10:null;

// Facts that must be verified in the client file for each page. Only a verified fact is ever printed.
const FACT_LABEL={company_name:'Registered name',registration_number:'Registration number',incorporation_date:'Date of incorporation',registered_address:'Registered address'};
function needFacts(form,facts,keys,problems){
 for(const k of keys)if(!facts[k])problems.push(`${FACT_LABEL[k]||k} is not verified in the client file.`);
}
const postal=facts=>facts.po_box&&!/^none$/i.test(String(facts.po_box).trim())&&facts.postal_code&&facts.postal_town?`P.O. Box ${facts.po_box}-${facts.postal_code}, ${facts.postal_town}`:null;

// Who served in the year, from dated records (appointed_on, ceased_on).
export function servedInYear(people,start,end){
 const s=String(start).slice(0,10),e=String(end).slice(0,10);
 return (people||[]).filter(p=>String(p.appointed_on).slice(0,10)<=e&&(!p.ceased_on||String(p.ceased_on).slice(0,10)>=s));
}
const dateNote=(p,start,end)=>{const bits=[],s=String(start).slice(0,10),e=String(end).slice(0,10),a=String(p.appointed_on||'').slice(0,10),c=p.ceased_on?String(p.ceased_on).slice(0,10):'';
 if(a>s&&a<=e)bits.push('appointed '+longDate(a));if(c&&c>=s&&c<e)bits.push('resigned '+longDate(c));return bits.length?` (${bits.join(', ')})`:'';};

const rowBy=(st,code,label)=>{const rows=st?.rows||[];return rows.find(r=>code&&r.code===code)||rows.find(r=>label&&r.label===label&&r.kind!=='heading')||null;};
// Profit for the year is the last total of the statement of profit or loss, whatever the legal form calls it.
const profitRow=pl=>{const rows=pl?.rows||[];const t=rows.filter(r=>r.kind==='total');return t.length?t[t.length-1]:null;};
// Revenue is the sum of the lines under the Revenue heading. A prior figure is shown only when every line has one.
function revenueRow(pl){
 const rows=pl?.rows||[],i=rows.findIndex(r=>r.kind==='heading'&&r.label==='Revenue');if(i<0)return null;
 let cur=0,pri=0,hasPri=true,n=0;
 for(let j=i+1;j<rows.length&&rows[j].kind==='line';j++){n++;cur+=Number(rows[j].current||0);if(rows[j].prior===null||rows[j].prior===undefined)hasPri=false;else pri+=Number(rows[j].prior);}
 return n?{current:cur,prior:hasPri?pri:null}:null;
}

// The pages for a client year. input:
//  form, entity, period {starts_on, ends_on}, facts {key: value} (verified only), directors [{full_name,appointed_on,ceased_on}], partners [names],
//  officers [{holder_name,holder_position,kind}] (verified only), records {CODE:{approved,draft,returned}} (approved: {state,fields,reason}),
//  principalActivity (approved text or null), statements (the built statements), reporting {framework,edition}.
export function buildClientPages({form,entity,period,facts={},directors=[],partners=[],officers=[],records={},principalActivity=null,statements=null,reporting={}}){
 const start=String(period.starts_on).slice(0,10),end=String(period.ends_on).slice(0,10),pages=[];
 const name=facts.company_name||null;
 const people=form===FORMS.COMPANY?servedInYear(directors,start,end).map(p=>({name:p.full_name,note:dateNote(p,start,end)})):form===FORMS.PARTNERSHIP?(partners||[]).map(n=>({name:n,note:''})):[];
 const pend=(code)=>{const r=records[code]||{};return r.draft?'waiting for approval':r.returned?'returned for changes':'not declared yet';};
 const secretaryOfficer=officers.find(o=>/secretary/i.test(o.holder_position));
 // ---- cover
 {
  const problems=[];needFacts(form,facts,['company_name'],problems);
  if(form===FORMS.COMPANY)needFacts(form,facts,['registration_number'],problems);
  const blocks=name?[{type:'title',text:name},{type:'subtitle',text:form===FORMS.COMPANY?'Annual report and financial statements':'Financial statements'},{type:'text',text:periodPhrase(start,end)}]:[];
  if(name&&facts.registration_number)blocks.push({type:'text',text:`Registration number: ${facts.registration_number}`});
  pages.push({code:'COVER',title:pageTitle('COVER',form),kind:'system',state:problems.length?'Not ready':'Ready',blocks:problems.length?[]:blocks,problems});
 }
 // ---- entity information
 {
  const problems=[],blocks=[],rec=(records.ENTITY_INFO||{}).approved||null;
  const keys=['company_name','registered_address'];if(form===FORMS.COMPANY)keys.push('registration_number','incorporation_date');
  needFacts(form,facts,keys,problems);
  const lines=[];
  if(name)lines.push(['Registered name',name]);
  if(facts.registration_number)lines.push(['Registration number',facts.registration_number]);
  if(form===FORMS.COMPANY&&facts.incorporation_date)lines.push(['Date of incorporation',longDate(facts.incorporation_date)]);
  if(facts.registered_address)lines.push(['Registered office',facts.registered_address]);
  const po=postal(facts);if(po)lines.push(['Postal address',po]);
  if(form===FORMS.COMPANY||form===FORMS.PARTNERSHIP){
   if(!people.length)problems.push(form===FORMS.COMPANY?'No director is recorded as serving in this year.':'No partner has approved profit shares for this year.');
   else lines.push([cap(who(form)),people.map(p=>p.name+p.note).join('; ')]);
  }
  const named=officers.filter(o=>!(form===FORMS.COMPANY&&/director/i.test(o.holder_position)));
  if(named.length)lines.push(['Officers and signatories',named.map(o=>`${o.holder_name} (${o.holder_position})`).join('; ')]);
  if(!rec)problems.push(`The bankers, auditors and other lines are ${pend('ENTITY_INFO')}.`);
  else{
   const f=rec.fields||{},defs=fieldsFor('ENTITY_INFO',form,{secretaryOnRecord:!!secretaryOfficer});
   for(const d of defs)if(f[d.key])lines.push([d.label,f[d.key]]);
   for(const d of defs.filter(x=>x.required))if(!f[d.key])problems.push(`${d.label} is missing from the approved entity information.`);
  }
  if(secretaryOfficer&&form===FORMS.COMPANY)lines.push(['Company secretary',secretaryOfficer.holder_name]);
  pages.push({code:'ENTITY_INFO',title:pageTitle('ENTITY_INFO',form),kind:'declared',state:problems.length?'Not ready':'Ready',blocks:problems.length?[]:[{type:'lines',lines}],problems});
 }
 // ---- report of the directors or partners
 {
  const rec=(records.REPORT||{}).approved||null,problems=[],blocks=[];
  if(!rec)problems.push(`The ${pageTitle('REPORT',form).toLowerCase()} is ${pend('REPORT')}.`);
  else if(rec.state==='Not applicable')blocks.push({type:'text',text:`This page does not apply: ${rec.reason}`});
  else{
   if(!principalActivity)problems.push('The principal activity is not approved, so the report cannot state it.');
   else blocks.push({type:'heading',text:'Principal activity'},{type:'text',text:principalActivity});
   const pl=statements?.profit_or_loss,profit=profitRow(pl),unit=statements?.presentation?.unit_label||'KES';
   if(profit&&profit.current!==null&&profit.current!==undefined)blocks.push({type:'heading',text:'Results for the year'},{type:'text',text:`The profit for the year was ${unit} ${fmt(num(profit.current))}${profit.prior!==null&&profit.prior!==undefined?` (prior year: ${unit} ${fmt(num(profit.prior))})`:''}.`});
   else problems.push('The profit for the year is not available from the statements.');
   const f=rec.fields||{};
   blocks.push({type:'heading',text:'Review of the business'},{type:'text',text:f.review||''});
   if(people.length)blocks.push({type:'heading',text:`${cap(who(form))} in office during the year`},{type:'text',text:people.map(p=>p.name+p.note).join('; ')});
   const dv=fieldsFor('REPORT',form).find(x=>x.key==='dividends');
   blocks.push({type:'heading',text:dv.label},{type:'text',text:f.dividends||''});
   if(f.audit_info)blocks.push({type:'heading',text:'Information given to the auditor'},{type:'text',text:f.audit_info});
   if(!f.review||!f.dividends)problems.push('The approved report is missing required text.');
  }
  pages.push({code:'REPORT',title:pageTitle('REPORT',form),kind:'declared',state:problems.length?'Not ready':rec&&rec.state==='Not applicable'?'Not applicable':'Ready',blocks:problems.length?[]:blocks,problems});
 }
 // ---- statement of responsibilities
 {
  const rec=(records.RESPONSIBILITIES||{}).approved||null,problems=[],blocks=[];
  if(!rec)problems.push(`The statement of responsibilities is ${pend('RESPONSIBILITIES')}.`);
  else if(rec.state==='Not applicable')blocks.push({type:'text',text:`This page does not apply: ${rec.reason}`});
  else{
   const f=rec.fields||{};
   if(!f.statement||!f.approved_on||!(f.signatories||[]).length)problems.push('The approved statement is missing text, a date or a signatory.');
   else blocks.push({type:'text',text:f.statement},{type:'text',text:`The financial statements were approved on ${longDate(f.approved_on)} and signed on behalf of the ${who(form)} by:`},{type:'signatures',names:f.signatories});
  }
  pages.push({code:'RESPONSIBILITIES',title:pageTitle('RESPONSIBILITIES',form),kind:'declared',state:problems.length?'Not ready':rec&&rec.state==='Not applicable'?'Not applicable':'Ready',blocks:problems.length?[]:blocks,problems});
 }
 // ---- key figures
 {
  const problems=[],pl=statements?.profit_or_loss,fp=statements?.financial_position,unit=statements?.presentation?.unit_label||'KES';
  if(!pl||!fp)problems.push('The statements are not available, so the key figures cannot be shown.');
  const rows=[];
  if(!problems.length){
   const rev=revenueRow(pl),gp=rowBy(pl,null,'Gross profit'),np=profitRow(pl),ta=rowBy(fp,null,'Total assets'),cash=rowBy(fp,'SFP.CASH','Cash and cash equivalents');
   const add=(label,r)=>{if(r)rows.push({label,current:num(r.current),prior:num(r.prior)});};
   add('Revenue',rev);add('Gross profit',gp);add('Profit for the year',np);add('Total assets',ta);add('Cash and cash equivalents',cash);
   const ratio=(label,a,b)=>{if(a&&b&&b.current)rows.push({label,current:pct(a.current,b.current),prior:b.prior&&a.prior!==null&&a.prior!==undefined?pct(a.prior,b.prior):null,percent:true});};
   ratio('Gross profit margin (%)',gp,rev);ratio('Net profit margin (%)',np,rev);
   if(!rows.length)problems.push('No key figure could be taken from the statements.');
  }
  pages.push({code:'STATISTICS',title:pageTitle('STATISTICS',form),kind:'system',state:problems.length?'Not ready':'Ready',blocks:problems.length?[]:[{type:'figures',unit,rows:rows.map(r=>({label:r.label,current:r.current,prior:r.prior,percent:!!r.percent,current_text:r.percent?(r.current===null?'Not available':String(r.current)):fmt(r.current),prior_text:r.percent?(r.prior===null?'Not available':String(r.prior)):fmt(r.prior)}))},{type:'note',text:'Derived from the statements. Margins are shown to one decimal place.'}],problems});
 }
 const bad=pages.filter(p=>p.state==='Not ready');
 return {version:PAGES_VERSION,pages,complete:bad.length===0,problems:bad.flatMap(p=>p.problems.map(m=>`${p.title}: ${m}`))};
}
// The pack check. built: result of buildClientPages.
export function pagesCheck(built){
 if(!built)return {status:'Info',detail:''};
 if(!built.complete){const p=built.problems;return {status:'Blocked',detail:p.slice(0,3).join(' ')+(p.length>3?` (+${p.length-3} more)`:'')};}
 const applies=built.pages.filter(x=>x.state==='Ready').length;
 return {status:'Pass',detail:`${applies} client page${applies===1?'':'s'} ready.`};
}
