// The same two lines on every task, project and client screen: where the person is working, then the state it is in.
// Status is always written out; the symbol only repeats it, so colour is never the only signal.
const TONES={good:['Completed','Active','Closed','Approved','Posted','Filed'],bad:['Blocked','Inactive','Rejected','Returned','Cancelled'],wait:['In Review','Waiting on client','Paused','Pending setup','Awaiting client approval','Pending supervisor review','Pending client documents','Awaiting review','Submitted','Checked','Draft']};
export function statusTone(status){const s=String(status||'');return TONES.good.includes(s)?'good':TONES.bad.includes(s)?'bad':TONES.wait.includes(s)?'wait':'neutral';}
const MARK={good:'✓',bad:'✕',wait:'●',neutral:'○'};
export function workspaceHeader({client='',project='',period='',status='',esc=x=>String(x??'')}){
 const parts=[['Client',client],['Project',project],['Period',period]].filter(([,v])=>String(v||'').trim());
 if(!parts.length&&!status)return '';
 const tone=statusTone(status),trail=parts.map(([label,value],i)=>`${i?'<span class="wh-sep" aria-hidden="true">›</span>':''}<span class="wh-part"><span class="sr-only">${label}: </span>${i===parts.length-1?'<b>':''}${esc(value)}${i===parts.length-1?'</b>':''}</span>`).join('');
 return `<header class="workspace-header" aria-label="Where you are working"><p class="wh-trail">${trail}</p>${status?`<p class="wh-status"><span class="status-badge tone-${tone}"><span aria-hidden="true">${MARK[tone]}</span> <span class="sr-only">Status: </span>${esc(status)}</span></p>`:''}</header>`;
}
