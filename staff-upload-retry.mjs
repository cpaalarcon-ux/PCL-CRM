// Build 2903: wording and small helpers for interrupted uploads and for removing a bank statement upload.
// Pure functions, no network. The server holds the real rules (same file again is recognised; a statement in use cannot be removed).
const RETRY_ACTIONS=new Set(['workbook_commit','period_import_save','ledger_import_commit','kra_csv_upload','audit_tb_import']);

export const isRetrySafeAction=action=>RETRY_ACTIONS.has(String(action||''));

// A dropped connection reaches the browser as a TypeError ("Failed to fetch"), not as a server answer.
export const isConnectionDrop=error=>!!error&&!error.status&&(error instanceof TypeError||/failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message||'')));

export function connectionDropMessage(action){
 return isRetrySafeAction(action)
  ?'The connection dropped before the ERP could confirm this import. Nothing is lost: press the same button again. The ERP recognises the same file and will not add the same rows twice.'
  :'The connection dropped before the ERP could confirm this. Check your connection and try again.';
}

// Said after a replay: the ERP found the earlier import of this exact file and added nothing again.
export function alreadyImportedNote(result,action=''){
 if(result?.duplicate_upload===true||(result?.reused===true&&['period_import_save','ledger_import_commit'].includes(action)))return 'This exact file was already imported earlier. Nothing was added again.';
 if(result?.already_uploaded===true)return 'This exact file was already uploaded a moment ago. The earlier copy is being used; no second copy was stored.';
 return '';
}

const dateText=v=>String(v||'').slice(0,10);
// bank = {allowed,reasons,instead,summary:{file_name,period_start,period_end,rows,statements}} from the removal plan.
export function bankRemovalHtml(bank,esc){
 if(!bank?.summary)return '';
 const s=bank.summary,period=s.period_start&&s.period_end?`${esc(dateText(s.period_start))} to ${esc(dateText(s.period_end))}`:'period not recorded';
 const what=`<p class="info full"><b>This will archive:</b> bank statement <b>${esc(s.file_name)}</b> · ${esc(String(s.statements))} statement${s.statements===1?'':'s'} · period ${period} · <b>${esc(String(s.rows))}</b> line${s.rows===1?'':'s'}.</p>`;
 if(bank.allowed)return what+'<p class="muted full">Nothing from this statement has been mapped, matched, reviewed or posted, so it can be removed. The file and its lines stay in Archived sources with your reason.</p>';
 return what+`<p class="error full" role="alert"><b>It cannot be removed.</b> ${bank.reasons.map(esc).join(' ')}</p><p class="full">${bank.instead.map(esc).join(' ')}</p>`;
}
