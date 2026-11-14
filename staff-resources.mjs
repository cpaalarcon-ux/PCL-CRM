// Resources (build 2796), under Documents. The chart-of-accounts search and the two upload templates, open to every staff member who can open Documents.
// It reads and downloads only. Changes to the chart of accounts are made by Managers and Partners in Settings. Pure view plus a small handler.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const TEMPLATES=[
 {file:'/Opening_TB_Upload_Template.xlsx',label:'Opening TB template',about:'For a new client\'s opening trial balance.'},
 {file:'/Purchase_Upload_Template.xlsx',label:'Purchase template',about:'For a month of purchases.'}
];
export function resourcesView(canChange=false){
 return `<div id="resourcesBody"><p class="muted">Reference material for everyone. Nothing here changes a client's records.</p>`+
  `<section class="card settings-card"><div class="section-head"><div class="settings-card-text"><h2>Chart of accounts</h2><p class="muted">Search accounts by code or name.${canChange?' New accounts are added in Settings and stay Draft until a Partner activates them.':' Managers and Partners add new accounts.'}</p></div><div class="actions"><button type="button" data-accounting="catalog">Search chart of accounts</button></div></div></section>`+
  `<section class="card settings-card"><div class="section-head"><div class="settings-card-text"><h2>Upload templates</h2><p class="muted">Download the current template, fill it in, then upload it from the client\'s engagement.</p></div><div class="actions">${TEMPLATES.map(t=>`<a class="button" href="${esc(t.file)}" download>${esc(t.label)}</a>`).join('')}</div></div></section></div>`;
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
