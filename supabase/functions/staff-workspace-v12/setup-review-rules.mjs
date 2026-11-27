// Build 2828: deferred review of client set-up sections. Pure rules, no database.
// A section is submitted by the preparer and reviewed later; the preparer is never held up by a pending review.
// Only the Chart of Accounts and the Opening Trial Balance keep a blocking approval, and those are approved where they already are.
export const SECTIONS=[
 {code:'identity',label:'Client identification and legal structure',hint:'Name, legal structure, accounting family and the evidence for it.'},
 {code:'registration',label:'BRS registration details',hint:'Registration number, incorporation date, registered address.'},
 {code:'tax',label:'KRA PIN and tax obligations',hint:'PIN, tax profile and dated obligations.'},
 {code:'ownership',label:'Directors, partners and ownership',hint:'Beneficial owners, parties and office holders.'},
 {code:'activities',label:'Business activities and sector',hint:'Dated activities and income streams.'},
 {code:'year_end',label:'Financial year and reporting details',hint:'Year-end month and day.'},
 {code:'contacts',label:'Contact details and addresses',hint:'Contacts and the main contact facts.'},
 {code:'permanent_file',label:'Permanent file information',hint:'Evidence held on the client file.'},
 {code:'engagement',label:'Engagement and assigned personnel',hint:'Who is assigned. Engagement acceptance and authorisation are separate controls and are not waived by this review.'}
];
export const SECTION_CODES=SECTIONS.map(s=>s.code);
// The least a client must have recorded before any of its sections can be sent for approval in bulk.
export const REQUIRED_MINIMUM=['identity','registration','ownership','contacts'];
export const SOURCE_KINDS=['BRS','KRA','Permanent file','Client document','Other approved source'];
export const STATUSES=['Draft','Pending Review','Approved','Correction Required','Blocked'];
export const sectionLabel=code=>SECTIONS.find(s=>s.code===code)?.label||code;

export function sourceProblem(kind,note){
 if(!SOURCE_KINDS.includes(kind))return 'Say where this information came from: BRS, KRA, the permanent file, a client document or another approved source.';
 if(kind==='Other approved source'&&String(note||'').trim().length<5)return 'Name the other approved source (at least 5 characters).';
 return '';
}

// What happens when a preparer submits a section whose data hashes to `digest`.
// row is the saved section or null. An approved section whose data has not changed is not reviewed again.
export function submitPlan(row,digest){
 if(row&&row.approved_digest&&row.approved_digest===digest)return {action:row.status==='Approved'&&row.content_digest===digest?'none':'approve_unchanged'};
 return {action:'submit'};
}

// A reviewer's decision on a pending section. current is the digest of the data now.
export function decidePlan(row,outcome,note,currentDigest){
 if(!row||row.status!=='Pending Review')return {ok:false,problem:'This section is not waiting for review.'};
 if(!['Approved','Returned'].includes(outcome))return {ok:false,problem:'Choose Approved or Returned.'};
 if(outcome==='Returned'&&String(note||'').trim().length<10)return {ok:false,problem:'Say what to correct (at least 10 characters).'};
 if(outcome==='Approved'&&row.content_digest!==currentDigest)return {ok:false,problem:'The information was changed after it was submitted. Ask the preparer to submit it again so you approve what is on file now.'};
 return {ok:true};
}

// Approve all ready (build 2910). rows are pending sections with the digest recorded at submission and the digest of the data now.
// Ready means: nothing was edited since it was sent, and the signed-in reviewer may decide it (maker is not checker, except your firm's only Partner).
// Everything else is left for a person and listed with the reason, so nothing is approved that the reviewer could not have approved one by one.
export function planApproveReady(rows,{staff_id,sole=false}){
 const ready=[],left=[];
 for(const r of rows||[]){
  const base={client_id:r.client_id,company_name:r.company_name,section_code:r.section_code,label:sectionLabel(r.section_code)};
  if(r.content_digest!==r.now_digest)left.push({...base,reason:'Edited after it was sent. Ask the sender to send it again, or return it.'});
  else if(r.submitted_by===staff_id&&!sole)left.push({...base,reason:'You sent this. A different Manager or Partner reviews it.'});
  else ready.push({...r,...base});
 }
 return {ready,left};
}

// Approve once (build 2910). A change proposal is approved by a Manager or Partner who is not its proposer. If a set-up section it changes was already
// sent for review and nobody edited it since, the same approval covers the section. Returns the sections to approve with the digest of what is now on file.
// Nothing is approved when another proposal for the client is still open (the section could change again), when the data did not change, when the section was
// edited after it was sent, or when the approver sent the section (unless your firm's only Partner).
export function planApproveOnce({before,after,sections,approver,sole=false,otherOpenProposals=false}){
 if(otherOpenProposals)return [];
 const out=[];
 for(const s of sections||[]){
  const c=s.section_code;
  if(s.status!=='Pending Review'||after?.[c]===undefined||before?.[c]===undefined)continue;
  if(after[c]===before[c])continue;
  if(s.content_digest!==before[c])continue;
  if(s.submitted_by===approver&&!sole)continue;
  out.push({section_id:s.section_id,section_code:c,source_kind:s.source_kind,digest:after[c]});
 }
 return out;
}

// Display status of one set-up section.
export function sectionState(row,currentDigest){
 if(!row)return {status:'Draft',changed:false};
 const changed=row.status==='Approved'?row.approved_digest!==currentDigest:row.status==='Pending Review'?row.content_digest!==currentDigest:false;
 return {status:row.status,changed};
}

// chart and opening are {status} using the same five words. Two milestones are kept apart on purpose:
// data entry completed (everything submitted or approved) and fully approved (everything approved, including the two mandatory controls).
export function milestones(sections,chart,opening){
 const entry=sections.every(s=>['Pending Review','Approved'].includes(s.status)&&!(s.status==='Approved'&&s.changed));
 const approved=sections.every(s=>s.status==='Approved'&&!s.changed)&&chart.status==='Approved'&&opening.status==='Approved';
 const pending=sections.filter(s=>s.status==='Pending Review').length;
 const attention=sections.filter(s=>s.status==='Correction Required'||s.changed).length;
 return {data_entry_completed:entry,fully_approved:approved,pending_review:pending,needs_attention:attention,
  summary:approved?'Setup fully approved.':entry?`Setup data entry completed. ${pending} section${pending===1?'':'s'} waiting for review${chart.status!=='Approved'||opening.status!=='Approved'?'; the Chart of Accounts and Opening Trial Balance still need their approval before accounting work that depends on them':''}.`:'Setup data entry in progress.'};
}

// Which blocking control (if any) stands behind an accounting step. The deferred sections never appear here.
export function mandatoryBlockers(chart,opening){
 const out=[];
 if(chart.status!=='Approved')out.push('The client Chart of Accounts must be approved before entries are mapped or posted.');
 if(opening.status!=='Approved')out.push('The Opening Trial Balance must be approved before reports and tasks that depend on it.');
 return out;
}

// The next sub-step to open after saving one, in the order a preparer works through set-up.
export const SETUP_ORDER=['identity','activity','stock','chart','vat-cats'];
export function nextSetupStep(current){const i=SETUP_ORDER.indexOf(current);return i>=0&&i<SETUP_ORDER.length-1?SETUP_ORDER[i+1]:null;}
