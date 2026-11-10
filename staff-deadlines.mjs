// Filing deadline windows (Settings): for each kind of filing, how many days before the due date it is flagged "due soon", and how many days after it the
// Partners are alerted. The values and their rules live in the database (20261110270000_filing_deadline_windows.sql); this file draws the screen.
// Flag and alert only: nothing is blocked. Managers can read the matrix; only a Partner can change a value or record its confirmation.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const DEADLINE_NOTE='These windows came from a Partner\'s written instruction of 10 November 2026. They are measured from the due date on each filing task. They flag a filing as due soon and alert the Partners when it is late; they never block anyone from filing. Until a Partner records the confirmation they show "Default - not yet confirmed".';
export const CLASSES=[['paye','PAYE and payroll','due the 9th'],['vat','VAT and monthly','due the 20th'],['annual','Annual','due 30 June or April']];
export const settingStatus=s=>s.rule_status==='Confirmed'?`Confirmed${s.confirmed_at?' on '+day(s.confirmed_at):''}`:'Default - not yet confirmed';
export const daysText=n=>`${n} day${Number(n)===1?'':'s'}`;

// The matrix as a table: one row per kind of filing, a column for the warning and a column for the late alert.
export function matrixView({settings,partner,button}){
 const by=Object.fromEntries((settings||[]).map(s=>[s.setting_key,s]));
 const cell=key=>{const s=by[key];if(!s)return '<td>-</td>';return `<td><b>${esc(daysText(s.int_value))}</b><br><small class="${s.rule_status==='Confirmed'?'ok':'warn'}">${esc(settingStatus(s))}</small>${s.source_note&&s.rule_status==='Confirmed'?'<br><small>'+esc(s.source_note)+'</small>':''}${partner?'<br>'+button('deadline-setting-set','Change',key)+(s.rule_status==='Confirmed'?'':' '+button('deadline-setting-confirm','Record confirmation',key)):''}</td>`;};
 return `<p class="info full">${esc(DEADLINE_NOTE)}</p><div class="scroll full"><table id="deadlineMatrix"><thead><tr><th>Kind of filing</th><th>Flag as due soon, before the due date</th><th>Alert the Partners, after the due date</th></tr></thead><tbody>${CLASSES.map(([k,name,when])=>`<tr><td><b>${esc(name)}</b><br><small>${esc(when)}</small></td>${cell(k+'_warn_days')}${cell(k+'_late_days')}</tr>`).join('')}</tbody></table></div>`;
}

export function createDeadlineUI(ctx){
 const {field,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 let cur=null;
 const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
 // The card on the Settings screen. Managers and Partners only.
 function card(){
  if(!leaderRole(d().me))return '';
  return `<section class="card"><div class="section-head"><h2>Filing deadline windows</h2>${button('deadline-settings','Open the warning windows')}</div><p class="muted">When a PAYE, VAT, monthly or annual filing is flagged as due soon, and when the Partners are alerted that one is late. Nothing is blocked.</p></section>`;
 }
 async function settings(){
  const r=await request({action:'deadline_settings_read'}),partner=d().me?.category_code==='PARTNER';
  cur={settings:r.settings};
  modal('Filing deadline windows',matrixView({settings:r.settings,partner,button}));
 }
 async function handle(action,id){
  if(!action.startsWith('deadline-'))return false;
  if(action==='deadline-settings'){await settings();return true;}
  if(action==='deadline-setting-set'){
   const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;
   modal('Change · '+s.label,form(field('value','New value (days) *',String(s.int_value),'number','required min="1" max="90"')+'<p class="info full">Changing a value withdraws any confirmation. A Partner then records the confirmation with its written source.</p>','Save'),
    f=>request({action:'deadline_setting_set',setting_key:id,revision:s.revision,value:f.get('value')}),settings);
   return true;
  }
  if(action==='deadline-setting-confirm'){
   const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;
   modal('Record confirmation · '+s.label,form(area('source_note','Who confirmed this, and where it is written (for example the Partner minute and its date) *','',true),'Record confirmation'),
    f=>request({action:'deadline_setting_confirm',setting_key:id,revision:s.revision,source_note:f.get('source_note')}),settings);
   return true;
  }
  return false;
 }
 return {card,handle,settings};
}
