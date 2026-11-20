// "Configure this setting" links for blockers (build 2838). A blocker that a setting fixes names that setting here, in one place, so every screen words
// and matches it the same way. This is pure: it reads the blocker text the server already gave and returns which setting fixes it. It decides nothing about
// the work itself, and it never offers a link for a blocker that a setting cannot fix (a missing upload, an unreviewed row, a figure to correct).
export const BLOCKER_SETTINGS=Object.freeze([
 {kind:'export_profile',match:/No published export profile/i,label:'export profile'},
 {kind:'routing_map',match:/No approved payroll mapping|have no approved mapping|No approved revenue account|no approved routing/i,label:'routing mapping'},
 {kind:'tax_rate',match:/Applicable approved rate missing|previously selected rate is unavailable or test-only/i,label:'tax rule'}
]);
export function blockerKinds(issues){
 const list=(Array.isArray(issues)?issues:[issues]).map(i=>String(i??'')).filter(Boolean),out=[];
 for(const s of BLOCKER_SETTINGS)if(list.some(i=>s.match.test(i)))out.push(s.kind);
 return out;
}
export const configureLabel=kind=>BLOCKER_SETTINGS.find(s=>s.kind===kind)?.label||'setting';
const attr=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const configureLinksHtml=(issues,from,esc=attr)=>blockerKinds(issues).map(k=>`<button type="button" class="configure-link" data-suite="configure-go" data-id="${esc(k)}::${esc(from)}">Configure this setting (${esc(configureLabel(k))})</button>`).join(' ');
