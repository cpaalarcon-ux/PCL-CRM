// Service period wording for invoices (browser copy; the server has the same rules in suite-rules.mjs and a test keeps them equal).
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const formatDay=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(v||''));return m?`${Number(m[3])} ${MONTHS[Number(m[2])-1]} ${m[1]}`:'';};
const addMonthsAnchored=(iso,months)=>{const [y,m,d]=iso.split('-').map(Number),idx=y*12+(m-1)+months,year=Math.floor(idx/12),month=((idx%12)+12)%12,day=Math.min(d,new Date(Date.UTC(year,month+1,0)).getUTCDate());return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);};
export function monthsInPeriod(from,to){
 if(!from||!to||to<from)return null;
 for(let n=1;n<=60;n++){const end=new Date(Date.parse(addMonthsAnchored(from,n)+'T00:00:00Z')-86400000).toISOString().slice(0,10);if(end===to)return n;if(end>to)break;}
 return null;
}
export function serviceNarration(service,from,to){
 const base=String(service||'').trim();if(!from||!to||to<from)return base;
 const months=monthsInPeriod(from,to);return `${base}${base?' ':''}${months?`${months} Month${months===1?'':'s'} `:''}${formatDay(from)} to ${formatDay(to)}`.trim();
}
