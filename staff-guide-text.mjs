// On-screen instructions. A short "how this works" banner for upload screens and (i) tips for technical fields.
// Text only: nothing here changes what the server accepts.
export function guideBanner(title,steps,esc=v=>String(v??''),{open=true}={}){
 return `<details class="info full guide-banner"${open?' open':''}><summary><b>${esc(title)}</b></summary><ol>${steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></details>`;
}
export function tip(text,esc=v=>String(v??'')){
 return ` <span class="tip" role="img" tabindex="0" title="${esc(text)}" aria-label="${esc(text)}" style="cursor:help;border:1px solid currentColor;border-radius:50%;padding:0 .35em;font-size:.8em">i</span>`;
}
export const GUIDE={
 sales:['Upload the KRA sales CSV or Excel file first, as an Import Source in the project documents.','Choose that file below, then set the exact period the totals cover.','Say whether the totals are already after credit notes. If they are not, enter the credit-note net and VAT per VAT category.','Check the preview. Nothing is saved until you confirm it, and every figure comes from your file.','A different Supervisor, Manager or Partner reviews it. If you spot a mistake after submitting, use Withdraw from review.'],
 payroll:['Upload the payroll file first, as an Import Source in the project documents. Use one complete calendar month.','Choose the file and the employee worksheet below.','The ERP recalculates PAYE, SHIF, NSSF and housing levy for the month and shows them beside your file. Review every difference.','Confirm residence only where the file does not say. Nothing is saved until you confirm the preview.','A different Supervisor, Manager or Partner reviews it. If you spot a mistake after submitting, use Withdraw from review.'],
 purchases:['Upload the purchase template (14 columns) or the KRA purchase sections as an Import Source.','Rows whose ERP routing code (column M) and TB item code (column N) match one active account for this client are mapped for you.','Everything else stays Unmapped. Filter to Unmapped, select rows, and map them one by one or in bulk.','Credit notes with no original invoice number wait in the pending list. They do not post until a corrected upload supplies it.','Mappings are reviewed when the journal that uses them is approved and posted by a different Manager or Partner.']
};
export const TIPS={
 creditBasis:'Some sales exports are already net of credit notes and some are not. Choose carefully: it decides whether we deduct credit notes from these totals.',
 routing:'ERP routing code (column M): the category of the ERP account, for example a purchases or expenses category. It must match the account in column N.',
 tbCode:'ERP TB item code (column N): the five-digit ERP account the row belongs to. With column M it lets the ERP map the row automatically.',
 residence:'Residence changes how PAYE relief is calculated. Only tick this if the file does not show residence and you know these employees are resident.',
 worksheet:'Leave blank to use the recognised worksheet. Enter a name only if the file has several and you need one of them.'
};
