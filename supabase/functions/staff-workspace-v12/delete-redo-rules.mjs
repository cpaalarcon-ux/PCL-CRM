// "Delete and redo" (build 2806). Pure rules: what a person may do about a mistaken upload or payroll run, given where it stands and who they are.
// Nothing is ever deleted. A removed summary stays in the history as Discarded with who, when and why. Work that was approved or posted is never
// removed: it is corrected through an amendment (sales and payroll), which reverses the posted entries first.
const LEADERS=['PARTNER','MANAGER'],REVIEWERS=['PARTNER','MANAGER','SUPERVISOR'],AMENDABLE=['Sales','Payroll'];
const dayText=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const noun=kind=>kind==='Payroll'?'payroll run':kind==='Sales'?'sales summary':String(kind||'summary').toLowerCase()+' summary';
const redoHint=kind=>kind==='Payroll'?'Prepare the month again from the payroll register.':kind==='Sales'?'Upload the correct sales file for this period.':'Upload the correct file for this period.';

// facts: {kind,status,prepared_by,reviewed_by,starts_on,ends_on,journals:n,tax_cases:n,amendment_live:bool,tax_open:bool}
// me: {staff_id,category_code}
export function importPlan(facts,me){
 const f=facts||{},kind=f.kind,what=noun(kind),isPreparer=!!me&&f.prepared_by===me.staff_id,leader=!!me&&LEADERS.includes(me.category_code),reviewer=!!me&&REVIEWERS.includes(me.category_code);
 const out={stage:f.status,what,period:dayText(f.starts_on)+' to '+dayText(f.ends_on),can_apply:false,apply:null,route:null,who:null,blockers:[],steps:[],redo:redoHint(kind),keeps:'The record stays in the history with who removed it, when and why. Nothing is deleted.'};
 if(f.status==='Discarded'||f.status==='Superseded'){out.stage=f.status;out.steps.push('Already removed from use. '+out.redo);return out;}
 if(f.status==='Confirmed'){
  out.route=AMENDABLE.includes(kind)?'amendment':'partner';
  out.who='A Manager or Partner asks; a different Manager or Partner approves';
  out.steps=AMENDABLE.includes(kind)
   ?[f.amendment_live?'An amendment is already open for this '+what+'. Continue it from the amendment panel.':'Confirmed work is not deleted. Ask to amend it: a different Manager or Partner approves, the posted entries are reversed and posted by someone else, then the corrected '+what+' replaces it or this one is withdrawn.']
   :['Confirmed work is not deleted. Ask a Partner or Manager to correct it.'];
  if(Number(f.journals)>0)out.steps.push(f.journals+' accounting '+(f.journals===1?'entry was':'entries were')+' prepared from it. They are reversed as part of the amendment, never edited.');
  return out;
 }
 if(!['Draft','Returned','Submitted'].includes(f.status)){out.blockers.push('This '+what+' is in a state that cannot be removed.');return out;}
 if(Number(f.journals)>0)out.blockers.push('An accounting entry was prepared from this '+what+'. Return or reverse that entry first.');
 if(Number(f.tax_cases)>0)out.blockers.push('A tax computation uses this '+what+'. Remove it from the computation first.');
 if(f.amendment_live)out.blockers.push('An amendment is open for this '+what+'. Finish or cancel it first.');
 if(f.status==='Submitted'&&f.tax_open===false)out.blockers.push('This period is in submitted or locked tax work. Return the tax work first.');
 if(f.status==='Draft'||f.status==='Returned'){
  if(!(isPreparer||leader)){out.who='The person who prepared it, a Manager or a Partner';out.blockers.push('Only the person who prepared this '+what+', a Manager or a Partner can remove it.');}
  else{out.who=isPreparer?'You prepared this':'A Manager or Partner';out.apply='discard';out.steps=['Discard it with a reason. '+out.redo];}
 }else{
  // Submitted: the preparer pulls it back while nobody has started reviewing; otherwise an independent reviewer returns it and a leader discards it.
  if(isPreparer){
   if(f.reviewed_by){out.who='The reviewer';out.blockers.push('A reviewer has already started on this '+what+'. Ask them to return it.');}
   else{out.who='You prepared this';out.apply='withdraw_discard';out.steps=['Withdraw it from review, then discard it with a reason. '+out.redo];}
  }else if(leader){out.who='A Manager or Partner who did not prepare it';out.apply='return_discard';out.steps=['Return it to the preparer with a note, then discard it with a reason. '+out.redo];}
  else if(reviewer){out.who='A Supervisor can return it; a Manager or Partner then discards it';out.apply='return';out.steps=['Return it to the preparer with a note. The preparer, a Manager or a Partner can then discard it. '+out.redo];}
  else{out.who='The preparer, or a reviewer';out.blockers.push('Only the preparer or an independent reviewer can pull this '+what+' back from review.');}
 }
 if(out.blockers.length){out.apply=null;}
 out.can_apply=!!out.apply;
 return out;
}

// An uploaded import source (purchase or other workbook). The uploader can remove it while nothing a person decided depends on it.
// A Manager or Partner can also remove it as a controlled correction after rows were mapped, summaries were saved or entries were prepared.
// facts: {rows,protected_rows,imports,journals,opening_submitted,uploaded_by}
export function uploadPlan(facts,me){
 const f=facts||{},leader=!!me&&LEADERS.includes(me.category_code),mine=!!me&&f.uploaded_by===me.staff_id;
 const locked=Number(f.protected_rows)||0,imports=Number(f.imports)||0,journals=Number(f.journals)||0;
 const out={what:'upload',stage:'Active',can_apply:false,apply:null,route:null,controlled:false,who:null,blockers:[],steps:[],redo:'Upload the corrected file.',keeps:'The file and its rows stay in the history as removed, with who, when and why. Nothing is deleted.'};
 if(Number(f.opening_submitted)>0){out.blockers.push('This opening trial balance is waiting for independent review. Ask the reviewer to return it, then remove the upload.');return out;}
 const dependent=locked>0||imports>0||journals>0;
 if(!leader&&!mine){out.who='The person who uploaded it, a Manager or a Partner';out.blockers.push('Only the person who uploaded this, a Manager or a Partner can remove it.');return out;}
 if(!leader&&dependent){
  out.who='A Manager or Partner';
  if(journals>0)out.blockers.push('An accounting entry was prepared from this upload. Ask a Partner or Manager to remove it as a controlled correction.');
  if(imports>0)out.blockers.push(imports+' summar'+(imports===1?'y was':'ies were')+' saved from this upload. Discard '+(imports===1?'it':'them')+' first, or ask a Partner or Manager.');
  if(locked>0)out.blockers.push(locked+' row'+(locked===1?' is':'s are')+' mapped, reviewed or posted by a person. Ask a Partner or Manager to remove the upload as a controlled correction.');
  return out;
 }
 out.can_apply=true;out.apply='archive';out.who=leader?'A Manager or Partner':'You uploaded this';out.controlled=leader&&dependent;
 out.steps=[out.controlled?'Remove it from active mapping with a reason as a controlled correction. Posted entries are not changed by this; reverse them separately.':'Remove it from active mapping with a reason.',out.redo];
 return out;
}
