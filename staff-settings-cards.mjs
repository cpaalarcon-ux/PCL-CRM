// One layout for every card on the Settings page (build 2796): title and purpose on the left, the button on the right, and who the card is for underneath.
// Pure, so it can be tested without a browser. Every Settings card uses it so the page lines up.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function settingsCard({id='',title,purpose='',audience='Managers and Partners',actions=''}){
 return `<section class="card settings-card"${id?` id="${esc(id)}"`:''}><div class="section-head"><div class="settings-card-text"><h2>${esc(title)}</h2>${purpose?`<p class="muted">${esc(purpose)}</p>`:''}${audience?`<small class="muted settings-audience">For: ${esc(audience)}</small>`:''}</div><div class="actions">${actions}</div></div></section>`;
}
