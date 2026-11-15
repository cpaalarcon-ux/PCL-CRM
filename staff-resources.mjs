// Resources (build 2796, templates listed by area in build 2801), under Documents. The chart-of-accounts search and the two upload templates, open to every staff member who can open Documents.
// It reads and downloads only. Changes to the chart of accounts are made by Managers and Partners in Settings. Pure view plus a small handler.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const TEMPLATES=[
 {area:'Opening balances',file:'/Opening_TB_Upload_Template.xlsx',label:'Opening TB',about:'A new client\'s opening trial balance (six columns). Staged, then reviewed and posted by a different Manager or Partner.'},
 {area:'Sales',file:'/templates/Sales_Update_Net_Only_Template.xlsx',label:'Sales update (net only)',about:'Month, sales category and net sales. The ERP calculates VAT from the category rate and marks it as calculated.'},
 {area:'Sales',file:'/templates/Sales_Category_Totals_Template.xlsx',label:'Sales category totals',about:'Month and category with net, output VAT, gross and credit notes, when you have all the figures.'},
 {area:'Purchases',file:'/Purchase_Upload_Template.xlsx',label:'Purchases (one template, all categories)',about:'The standard 14-column purchase upload. Choose the VAT category when you upload.'},
 {area:'Purchases',file:'/templates/Purchases_Monthly_Four_Sheet_Template.xlsx',label:'Purchases, monthly four-sheet layout',about:'The firm\'s own layout: General, Other, Zero and Exempt sheets with net amounts. Read as it is.'},
 {area:'Purchases',file:'/templates/Non_eTIMS_Manual_Template.xlsx',label:'Non-eTIMS expenditure (D09)',about:'Supported exceptions only, each with a legal basis and evidence.'},
 {area:'Payroll',file:'/templates/Payroll_Monthly_Template.xlsx',label:'Monthly payroll',about:'One row per employee. PAYE and statutory amounts are calculated by the ERP; source figures are kept for comparison.'},
 {area:'Payroll',file:'/templates/Payroll_Routing_Map_Template.xlsx',label:'Payroll routing map',about:'Which of the client\'s accounts each payroll code posts to. Accounts stay blank until a Manager proposes them and a different Partner approves.'},
 {area:'Bank',file:'/templates/Bank_Statement_Template.xlsx',label:'Bank statement',about:'Date, reference, description, debit, credit and balance. Columns are mapped on screen.'},
 {area:'Bank',file:'/templates/Bank_Monthly_Totals_Workbook.xlsx',label:'Five-bank monthly totals and adjustments',about:'Statement credits, bank charges and finance costs by bank and month, with non-trade credits, bounced cheques and receipt corrections.'},
 {area:'Clients',file:'/templates/Client_Import_Template.xlsx',label:'Client import',about:'Many clients at once: details, KYC, contacts, owners, branches, obligations and engagements.'}
];
export function resourcesView(canChange=false){
 return `<div id="resourcesBody"><p class="muted">Reference material for everyone. Nothing here changes a client's records.</p>`+
  `<section class="card settings-card"><div class="section-head"><div class="settings-card-text"><h2>Chart of accounts</h2><p class="muted">Search accounts by code or name.${canChange?' New accounts are added in Settings and stay Draft until a Partner activates them.':' Managers and Partners add new accounts.'}</p></div><div class="actions"><button type="button" data-accounting="catalog">Search chart of accounts</button></div></div></section>`+
  `<section class="card settings-card" id="templatesCard"><div class="section-head"><div class="settings-card-text"><h2>Upload templates</h2><p class="muted">Choose the template you need, fill it in, then upload it from the client\'s engagement. Templates carry headings and lists only, never client data. Leave unused cells blank; do not type N/A.</p></div></div><table class="table"><thead><tr><th>Area</th><th>Template</th><th>Used for</th><th></th></tr></thead><tbody>${TEMPLATES.map(t=>`<tr><td>${esc(t.area)}</td><td>${esc(t.label)}</td><td>${esc(t.about)}</td><td><a class="button" href="${esc(t.file)}" download>Download</a></td></tr>`).join('')}</tbody></table></section></div>`;
}
export function createResourcesUI(ctx){
 const {modal}=ctx;
 async function handle(action){
  if(action!=='resources-open')return false;
  modal('Resources',resourcesView(['PARTNER','MANAGER'].includes(ctx.data().me?.category_code)));
  return true;
 }
 return {handle};
}
