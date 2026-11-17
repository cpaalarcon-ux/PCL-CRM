// Standard wording and client-specific disclosures for the annual statements (build 2878). Pure: no database, no tax rates, no figures.
// Two kinds of text sit beside the system notes:
//  1. STANDARD wording (reporting entity, basis of preparation, currency, estimates, accounting policies). The firm keeps one library, versioned by framework and edition. The built-in text
//     here is only a DRAFT to start from: it is used in a pack only after a Partner has approved a version of it for that framework and edition.
//  2. CLIENT-SPECIFIC disclosures (principal activity, going concern, related parties, events after the reporting period, commitments, contingencies, and the depreciation, stock and revenue
//     policy facts). Staff declare each one for the year as text or as "Nothing to report", and a Manager or Partner who did not declare it approves it. An empty disclosure is never read as
//     "nothing to report".
// Nothing is guessed. A missing approval, a missing fact or a placeholder with no value is reported by name and blocks the pack; the text is never filled in for the client.
// The legal-form names are written here, not imported: annual-pack-rules imports this module and the legal-form module imports annual-pack-rules, so FORMS cannot be read while this file loads.
// They must match FORMS in annual-pack-legal-form.mjs (a test checks it).
const FORMS={COMPANY:'Company',PARTNERSHIP:'Partnership',PROPRIETOR:'Sole proprietor',OTHER:'Other'};

export const WORDING_VERSION='standard-wording-v1';
export const DISCLOSURE_STATES=['Text','Nothing to report'];

const FORM_ALL=[FORMS.COMPANY,FORMS.PARTNERSHIP,FORMS.PROPRIETOR,FORMS.OTHER];
// {name} is a fact taken from the client record or the reporting basis; {{CODE}} is a client-specific disclosure that must be approved first.
const REPORTING_ENTITY_VARIANTS={
 [FORMS.COMPANY]:'{entity} (the Company) is a company incorporated and domiciled in Kenya under the Companies Act, 2015. Its principal activity is: {{PRINCIPAL_ACTIVITY}}',
 [FORMS.PARTNERSHIP]:'{entity} (the Partnership) is a partnership carrying on business in Kenya. Its principal activity is: {{PRINCIPAL_ACTIVITY}}',
 [FORMS.PROPRIETOR]:'{entity} (the Business) is carried on in Kenya by its proprietor. Its principal activity is: {{PRINCIPAL_ACTIVITY}}',
 [FORMS.OTHER]:'{entity} (the Entity) carries on its activities in Kenya. Its principal activity is: {{PRINCIPAL_ACTIVITY}}'
};
const ALL=body=>({All:body});

// The built-in draft library. group orders the sections; applies_when is a note family (note_ref) that must exist in the system notes, or null for always.
// review_hint is shown to the Partner when the wording is prepared, where the text depends on the edition of the standard.
export const WORDING_DEFAULTS=[
 {code:'REPORTING_ENTITY',group:'General information',title:'Reporting entity',applies_when:null,variants:REPORTING_ENTITY_VARIANTS},
 {code:'BASIS_OF_PREPARATION',group:'Basis of preparation',title:'Statement of compliance and basis of preparation',applies_when:null,
  variants:{All:'These financial statements have been prepared in accordance with the {framework} ({edition}). They have been prepared on the historical cost basis, except where a note states otherwise, and on the going concern basis described in the note on going concern. {early_application}',
   [FORMS.COMPANY]:'These financial statements have been prepared in accordance with the {framework} ({edition}) and in the manner required by the Companies Act, 2015. They have been prepared on the historical cost basis, except where a note states otherwise, and on the going concern basis described in the note on going concern. {early_application}'}},
 {code:'FUNCTIONAL_CURRENCY',group:'Basis of preparation',title:'Functional and presentation currency',applies_when:null,
  variants:ALL('These financial statements are presented in Kenya shillings (KES), which is the functional currency of the entity. Amounts are rounded to {rounding}. Transactions in other currencies are translated at the rate on the date of the transaction, and monetary balances are translated at the rate at the reporting date.')},
 {code:'ESTIMATES_JUDGEMENTS',group:'Basis of preparation',title:'Use of estimates and judgements',applies_when:null,
  variants:ALL('The preparation of financial statements requires estimates and judgements that affect the amounts reported. Estimates are reviewed at each reporting date and any change is recognised in the period in which it is made. Actual results may differ from the estimates.')},
 {code:'POLICY_REVENUE',group:'Accounting policies',title:'Revenue',applies_when:'REVENUE',review_hint:'The revenue section of the standard changed between the Second and Third Editions. Compare this text with the edition before approving it.',
  variants:ALL('Revenue is measured at the fair value of the consideration received or receivable, net of value added tax, trade discounts and rebates, and is recognised when it is earned. {{POLICY_REVENUE}}')},
 {code:'POLICY_PPE',group:'Accounting policies',title:'Property, plant and equipment',applies_when:'PPE',
  variants:ALL('Property, plant and equipment is stated at cost less accumulated depreciation and accumulated impairment losses. Depreciation is charged on the following basis: {{POLICY_PPE}} Residual values, useful lives and methods are reviewed at each reporting date.')},
 {code:'POLICY_LEASES',group:'Accounting policies',title:'Leases',applies_when:'LEASES',review_hint:'Lease accounting differs between editions of the standard. Compare this text with the edition before approving it.',
  variants:ALL('Leases are accounted for in accordance with the standard applied. Lease payments and any lease liability and right-of-use balances are shown in the note on leases.')},
 {code:'POLICY_INVENTORY',group:'Accounting policies',title:'Inventories',applies_when:'INV',
  variants:ALL('Inventories are measured at the lower of cost and estimated selling price less costs to complete and sell. Cost is determined on the following basis: {{POLICY_INVENTORY}}')},
 {code:'POLICY_RECEIVABLES',group:'Accounting policies',title:'Trade and other receivables',applies_when:'REC',
  variants:ALL('Trade and other receivables are initially measured at the transaction price and subsequently at amortised cost less any impairment. An impairment loss is recognised in profit or loss when there is objective evidence that an amount will not be collected.')},
 {code:'POLICY_CASH',group:'Accounting policies',title:'Cash and cash equivalents',applies_when:'CASH',
  variants:ALL('Cash and cash equivalents comprise cash on hand and balances held with banks and mobile money providers that are readily convertible to known amounts of cash.')},
 {code:'POLICY_PAYABLES',group:'Accounting policies',title:'Trade and other payables',applies_when:'PAY',
  variants:ALL('Trade and other payables are initially measured at the transaction price and subsequently at amortised cost.')},
 {code:'POLICY_BORROWINGS',group:'Accounting policies',title:'Borrowings',applies_when:'BORROW',
  variants:ALL('Borrowings are initially measured at the transaction price, net of transaction costs, and subsequently at amortised cost. Interest is recognised in profit or loss as it accrues.')},
 {code:'POLICY_PROVISIONS',group:'Accounting policies',title:'Provisions',applies_when:'PROV',
  variants:ALL('A provision is recognised when the entity has a present obligation as a result of a past event, it is probable that an outflow of resources will be required to settle it, and the amount can be estimated reliably.')},
 {code:'POLICY_STAFF',group:'Accounting policies',title:'Employee benefits',applies_when:'STAFF',
  variants:ALL('Short-term employee benefits, including salaries and wages, are recognised as an expense in the period in which the service is rendered. Contributions to statutory schemes, including the National Social Security Fund, are charged to profit or loss as they fall due.')},
 {code:'POLICY_TAX',group:'Accounting policies',title:'Income tax',applies_when:'TAX',forms:[FORMS.COMPANY,FORMS.OTHER],
  variants:{All:'Income tax expense comprises current tax and deferred tax. Current tax is the amount expected to be paid on the taxable profit for the year, using the tax rates and laws enacted at the reporting date. Deferred tax is recognised on timing differences between the carrying amounts of assets and liabilities and their tax bases.'}}
];
export const DEFAULT_CODES=WORDING_DEFAULTS.map(d=>d.code);

// Client-specific disclosures. required: 'always', or a note family that must exist in the system notes. allow_nothing: whether "Nothing to report" is a valid declaration.
export const DISCLOSURES=[
 {code:'PRINCIPAL_ACTIVITY',title:'Principal activity',required:'always',allow_nothing:false,hint:'State the main activity of the entity in one or two sentences, as it was carried on in the year.'},
 {code:'GOING_CONCERN',title:'Going concern',required:'always',allow_nothing:false,hint:'State the assessment of whether the entity can continue for at least twelve months, and any material uncertainty. A statement is always needed.'},
 {code:'RELATED_PARTIES',title:'Related party transactions and balances',required:'always',allow_nothing:true,hint:'Describe transactions and balances with owners, directors or partners, key management and entities they control, or declare nothing to report.'},
 {code:'EVENTS_AFTER',title:'Events after the reporting period',required:'always',allow_nothing:true,hint:'Describe events between the reporting date and the date the statements are authorised that need disclosure, or declare nothing to report.'},
 {code:'COMMITMENTS',title:'Capital and other commitments',required:'always',allow_nothing:true,hint:'Describe commitments not recognised in the statements, or declare nothing to report.'},
 {code:'CONTINGENCIES',title:'Contingent liabilities and assets',required:'always',allow_nothing:true,hint:'Describe possible obligations or assets that are not recognised, or declare nothing to report.'},
 {code:'POLICY_REVENUE',title:'Revenue: how it is recognised by this client',required:'REVENUE',allow_nothing:false,hint:'Describe the streams of revenue and when each is recognised for this client.'},
 {code:'POLICY_PPE',title:'Depreciation: method and rates by class',required:'PPE',allow_nothing:false,hint:'Give the method and the annual rate or useful life for each class of asset, as used in the year.'},
 {code:'POLICY_INVENTORY',title:'Inventories: how cost is determined',required:'INV',allow_nothing:false,hint:'State the cost formula used, for example first in first out or weighted average.'}
];
export const DISCLOSURE_CODES=DISCLOSURES.map(d=>d.code);
export const disclosureDef=code=>DISCLOSURES.find(d=>d.code===code)||null;
export const defaultDef=code=>WORDING_DEFAULTS.find(d=>d.code===code)||null;

// A legal form uses its own variant of an entry where one exists and the shared "All" variant otherwise. variantKey is the key a library row is stored under.
export function variantKey(code,form){
 const d=defaultDef(code);if(!d)return null;
 if(d.forms&&!d.forms.includes(form))return null;
 return d.variants[form]!==undefined?form:(d.variants.All!==undefined?'All':null);
}
export const variantKeys=code=>{const d=defaultDef(code);return d?Object.keys(d.variants):[];};
// The built-in draft text for one entry and legal form; null where the entry does not apply to that form.
export function builtInText(code,form){
 const k=variantKey(code,form);return k?defaultDef(code).variants[k]:null;
}
export const builtInVariant=(code,key)=>{const d=defaultDef(code);return d&&d.variants[key]!==undefined?d.variants[key]:null;};
// Which standard entries apply to a legal form and a set of note families.
export function applicableEntries({form,noteRefs}){
 const refs=new Set(noteRefs||[]);
 return WORDING_DEFAULTS.filter(d=>(!d.forms||d.forms.includes(form))&&(!d.applies_when||refs.has(d.applies_when)));
}
// Which client-specific disclosures this year needs.
export function requiredDisclosures({noteRefs}){
 const refs=new Set(noteRefs||[]);
 return DISCLOSURES.filter(d=>d.required==='always'||refs.has(d.required));
}
const unitPhrase=r=>r==='Whole shillings'?'the nearest Kenya shilling':r==='Thousands'?'the nearest thousand Kenya shillings':null;
const asOfPhrase=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d||''));if(!m)return null;const N=['January','February','March','April','May','June','July','August','September','October','November','December'];return `${Number(m[3])} ${N[Number(m[2])-1]} ${m[1]}`;};

// Fill a text. Returns {text,missing:[names]}. {name} comes from facts; {{CODE}} from approved disclosure text. Anything without a value is listed, never blanked.
export function renderText(body,{facts,slots}){
 const missing=[];
 let text=String(body||'').replace(/\{\{([A-Z_]+)\}\}/g,(m,code)=>{const v=slots&&slots[code];if(v==null||v===''){missing.push(code);return m;}return String(v).trim();});
 text=text.replace(/\{([a-z_]+)\}/g,(m,key)=>{const v=facts&&facts[key];if(v===undefined||v===null){missing.push(key);return m;}return String(v);});
 return {text:text.replace(/ {2,}/g,' ').trim(),missing};
}
export function factsFrom({entity,asOf,reporting}){
 const r=reporting||{},early=String(r.early_application_note||'').trim();
 return {entity:String(entity||'').trim()||undefined,year_end:asOfPhrase(asOf)||undefined,framework:r.framework||undefined,edition:r.edition||undefined,
  rounding:unitPhrase(r.rounding)||undefined,early_application:early};
}

// Approved library rows are given as a map code -> variant key -> row for the period's framework and edition; approved declarations as a map code -> row.
// order: the codes of the disclosures in the order the user chose (any not listed follow in the standard order).
export function assembleWording({form,noteRefs,entity,asOf,reporting,library,declarations,order}){
 const problems=[],sections=[],facts=factsFrom({entity,asOf,reporting});
 if(!facts.entity)problems.push('The client has no name on record, so the wording cannot name the entity.');
 if(!facts.rounding)problems.push('The rounding in the reporting basis is not one the wording knows.');
 if(!facts.framework||!facts.edition)problems.push('The reporting framework and edition are not recorded.');
 if(reporting&&reporting.framework&&reporting.framework!=='IFRS for SMEs Accounting Standard')problems.push(`There is no standard wording for ${reporting.framework}. Write the policies as client-specific notes first.`);
 const req=requiredDisclosures({noteRefs}),slots={};
 for(const d of req){
  const row=declarations&&declarations[d.code];
  if(row&&row.status==='Approved'&&row.state==='Text')slots[d.code]=row.body;
 }
 // Every disclosure slot used by wording needs an approved text, so slots of disclosures not required this year are never offered.
 const sectionsStd=applicableEntries({form,noteRefs});
 for(const e of sectionsStd){
  const row=library&&library[e.code]&&library[e.code][variantKey(e.code,form)];
  if(!row||row.status!=='Approved'){problems.push(`Standard wording "${e.title}" is not approved for ${reporting?.edition||'this edition'}.`);continue;}
  const r=renderText(row.body,{facts,slots});
  for(const m of r.missing){
   if(/^[A-Z_]+$/.test(m)){const d=disclosureDef(m);problems.push(`"${e.title}" needs "${d?d.title:m}" to be declared and approved.`);}
   else problems.push(`"${e.title}" uses {${m}}, which has no value for this client.`);
  }
  sections.push({key:e.code,kind:'standard',group:e.group,title:e.title,text:r.missing.length?null:r.text,source:{wording_id:row.wording_id,version:row.version}});
 }
 const base=req.map(d=>d.code),chosen=(Array.isArray(order)?order:[]).filter(c=>base.includes(c)),rest=base.filter(c=>!chosen.includes(c)),ordered=[...chosen,...rest];
 for(const code of ordered){
  const d=disclosureDef(code),row=declarations&&declarations[code];
  // The policy facts are shown through the policy wording that uses them, so they are checked here but not repeated as a section of their own.
  const inline=code.startsWith('POLICY_');
  if(!row||row.status!=='Approved'){
   problems.push(row&&row.status==='Draft'?`"${d.title}" is declared and waits for a Manager or Partner to approve it.`:row&&row.status==='Returned'?`"${d.title}" was returned and needs to be declared again.`:`"${d.title}" has not been declared. Describe it, or declare nothing to report where that is allowed.`);
   if(!inline)sections.push({key:code,kind:'disclosure',group:'Other disclosures',title:d.title,text:null,state:null,source:null});
   continue;
  }
  if(!inline)sections.push({key:code,kind:'disclosure',group:'Other disclosures',title:d.title,text:row.state==='Nothing to report'?'Nothing to report.':renderText(row.body,{facts,slots}).text,state:row.state,source:{disclosure_id:row.disclosure_id,version:row.version}});
 }
 const unique=[...new Set(problems)];
 return {sections,problems:unique,complete:unique.length===0,order:ordered,version:WORDING_VERSION};
}
export const canonicalWording=a=>a.sections.map(s=>({k:s.key,t:s.title,x:s.text,s:s.source}));
export function wordingCheck({count,problems}){
 if(problems&&problems.length)return {status:'Blocked',detail:problems.slice(0,3).join(' ')+(problems.length>3?` (+${problems.length-3} more)`:'')};
 return {status:'Pass',detail:`${count} wording section${count===1?'':'s'} approved.`};
}
// Check a disclosure declaration before it is stored.
export function validateDeclaration({code,state,body}){
 const d=disclosureDef(code);
 if(!d)return 'That disclosure is not one the pack uses.';
 if(!DISCLOSURE_STATES.includes(state))return 'Choose Text or Nothing to report.';
 if(state==='Nothing to report'){
  if(!d.allow_nothing)return `"${d.title}" needs a statement. "Nothing to report" is not a valid answer for it.`;
  if(String(body||'').trim())return 'A nothing-to-report declaration carries no text.';
  return null;
 }
 const t=String(body||'').trim();
 if(t.length<10)return 'Write at least 10 characters, or declare nothing to report where that is allowed.';
 if(t.length>4000)return 'The text is too long: keep it to 4,000 characters.';
 if(/\{\{?[A-Za-z_]+\}\}?/.test(t))return 'The text contains a placeholder in braces. Write the facts out.';
 return null;
}
// Check library wording before it is stored. Only the known placeholders may be used.
export function validateWordingBody(code,body){
 const d=defaultDef(code);if(!d)return 'That wording is not one the library holds.';
 const t=String(body||'').trim();
 if(t.length<20)return 'Write at least 20 characters.';
 if(t.length>4000)return 'The text is too long: keep it to 4,000 characters.';
 const facts=['entity','year_end','framework','edition','rounding','early_application'];
 for(const m of t.matchAll(/\{\{([A-Z_]+)\}\}/g))if(!DISCLOSURE_CODES.includes(m[1]))return `{{${m[1]}}} is not a client-specific disclosure the pack knows.`;
 for(const m of t.replace(/\{\{[A-Z_]+\}\}/g,'').matchAll(/\{([^{}]*)\}/g))if(!facts.includes(m[1]))return `{${m[1]}} is not a fact the wording can use. Allowed: ${facts.map(f=>'{'+f+'}').join(', ')}.`;
 return null;
}
