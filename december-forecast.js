(()=>{
'use strict';
const MON='2026-12',END='2026-12-31',DAY=86400000;
const cash=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
const escaped=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amt=n=>Math.round(Math.max(0,Number(n)||0)*100);
const dt=s=>Date.parse(String(s)+'T00:00:00Z');
const good=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(dt(s));
const inDec=s=>good(s)&&s.slice(0,7)===MON;
const iso=t=>new Date(t).toISOString().slice(0,10);
const dayInMonth=d=>{const day=Math.min(31,Math.max(1,Number(d)||1));return MON+'-'+String(day).padStart(2,'0');};
const fmt=s=>new Date(dt(s)).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const ui={opening:null,unlisted:0};
function datesFor(item){
 const d=item.date,f=item.frequency;
 if(!good(d))return [];
 if(f==='One-time'||!f)return inDec(d)?[d]:[];
 if(f==='Monthly'){
  const [y,m,day]=d.split('-').map(Number);
  return (2026-y)*12+(12-m)>=0?[dayInMonth(day)]:[];
 }
 if(f==='Weekly'||f==='Biweekly'){
  const period=(f==='Weekly'?7:14)*DAY;
  const anchor=dt(d),start=dt(MON+'-01'),end=dt(END);
  let n=Math.max(0,Math.ceil((start-anchor)/period));
  const out=[];
  for(let i=0;i<6;i++){const at=anchor+(n+i)*period;if(at>end)break;if(at>=start)out.push(iso(at));}
  return out;
 }
 if(f==='Twice monthly'){
  const [y,m,day]=d.split('-').map(Number);
  if((2026-y)*12+(12-m)<0)return [];
  const first=day<=15?day:Math.max(1,day-15),second=Math.min(28,first+15);
  return [...new Set([dayInMonth(first),dayInMonth(second)])].filter(x=>dt(x)>=dt(d));
 }
 return [];
}
function scheduled(items,kind,warnings){
 const rows=[],entries=Array.isArray(items)?items:[];
 const roots=entries.filter(x=>!x.parent),children=entries.filter(x=>x.parent);
 for(const base of roots){
  if(kind==='bill'&&base.budgetOnly)continue;
  if(!amt(base.amount))continue;
  const title=String(base.name||base.member||'Unnamed');
  if(!good(base.date)){
   if(kind==='bill'&&base.frequency!=='One-time'){
    rows.push({date:null,kind,title,amount:-amt(base.amount),id:base.id});
    warnings.push(title+' has no due date. Its cost is included, but the chart reserves it at month-end.');
   }else warnings.push(title+' has no payment date and cannot be included reliably.');
   continue;
  }
  for(const date of datesFor(base)){
   const source=children.find(ch=>ch.parent===base.id&&ch.date===date)||base;
   const value=amt(source.amount);
   if(value)rows.push({date,kind,title:String(source.name||source.member||title),amount:kind==='income'?value:-value,id:source.id});
  }
 }
 for(const item of children){
  if(kind==='bill'&&item.budgetOnly)continue;
  if(!inDec(item.date))continue;
  const base=roots.find(p=>p.id===item.parent);
  if(base&&datesFor(base).includes(item.date))continue;
  rows.push({date:item.date,kind,title:String(item.name||item.member||'Adjusted entry'),amount:(kind==='income'?1:-1)*amt(item.amount),id:item.id});
  warnings.push('A separately dated generated '+kind+' entry was included; check for duplicate schedules.');
 }
 return rows.filter(e=>e.amount!==0);
}
function forecast(state,openingArg=ui.opening,unlistedArg=ui.unlisted){
 const warn=[],rows=[];
 rows.push(...scheduled(state.paychecks,'income',warn));
 rows.push(...scheduled(state.bills,'bill',warn));
 for(const card of state.debts||[]){
  if(!(Number(card.balance)>0)||!amt(card.minimum))continue;
  let day=null;
  if(good(card.due))day=Number(card.due.slice(-2));
  else if(Number(card.dueDay)>=1&&Number(card.dueDay)<=31){
   day=Number(card.dueDay);
   warn.push(card.name+' has no full due date; used its recorded day of month.');
  }else warn.push(card.name+' has no due date; its minimum was counted as undated.');
  rows.push({date:day?dayInMonth(day):null,kind:'minimum',title:String(card.name||'Debt')+' minimum',amount:-amt(card.minimum),id:card.id});
 }
 const pays=state.paychecks||[];
 for(const extra of state.extras||[]){
  const p=pays.find(p=>p.id===extra.pay);
  const when=good(extra.date)?extra.date:(p&&good(p.date)?p.date:null);
  if(inDec(when))rows.push({date:when,kind:'extra',title:'Extra debt payment',amount:-amt(extra.amount),id:extra.id});
  else if(amt(extra.amount))warn.push('An extra debt payment has no December date and is not counted.');
 }
 const sourceIds=new Set([...(state.bills||[]),...(state.debts||[]),...(state.extras||[])].map(e=>e.id));
 for(const transaction of state.transactions||[]){
  if(inDec(transaction.date)&&!sourceIds.has(transaction.source)&&['expense','debt'].includes(transaction.kind))
   rows.push({date:transaction.date,kind:'other',title:String(transaction.name||'Other expense'),amount:-amt(transaction.amount),id:transaction.id});
 }
 const sum=kind=>rows.filter(e=>e.kind===kind).reduce((s,e)=>s+e.amount,0);
 const income=sum('income'),bills=-sum('bill'),minimums=-sum('minimum'),extras=-sum('extra'),other=-sum('other');
 const unlisted=amt(unlistedArg),opening=Math.round((Number(openingArg===null?state.opening:openingArg)||0)*100);
 const net=income-bills-minimums-extras-other-unlisted,closing=opening+net;
 const undated=rows.filter(e=>!e.date);
 const dated=rows.filter(e=>e.date);
 for(const e of undated)dated.push({...e,date:END,kind:'reserved',title:e.title+' (due date missing)'});
 if(unlisted)dated.push({date:END,kind:'reserved',title:'What-if unlisted spending',amount:-unlisted});
 dated.sort((a,b)=>a.date.localeCompare(b.date)||((a.kind==='reserved')-(b.kind==='reserved'))||b.amount-a.amount);
 let running=opening;const days=[],events=[];
 for(let d=1;d<=31;d++){
  const date=dayInMonth(d);
  for(const e of dated.filter(x=>x.date===date)){running+=e.amount;events.push({...e,balance:running});}
  days.push({date,balance:running});
 }
 if(running!==closing)warn.push('Forecast mismatch: the summary and chart differ.');
 return {income,bills,minimums,extras,other,unlisted,net,opening,closing,undated,events,days,warnings:[...new Set(warn)]};
}
function graph(f){
 const W=920,H=290,L=85,R=22,T=21,B=43,values=f.days.map(x=>x.balance/100).concat([0,f.opening/100]);
 let lo=Math.min(...values),hi=Math.max(...values),padding=Math.max(100,(hi-lo)*0.12);lo-=padding;hi+=padding;
 const x=day=>L+(W-L-R)*(day-1)/30,y=val=>T+(H-T-B)*(hi-val)/(hi-lo);
 const path=f.days.map((p,i)=>(i?'L':'M')+x(i+1).toFixed(1)+','+y(p.balance/100).toFixed(1)).join(' ');
 const grid=[0,.25,.5,.75,1].map(frac=>{const v=lo+frac*(hi-lo),Y=y(v).toFixed(1);return '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y+'" y2="'+Y+'" stroke="#40516e" stroke-dasharray="3 6"/><text x="'+(L-11)+'" y="'+(Number(Y)+4)+'" text-anchor="end" fill="#ccd7e8" font-size="12">'+escaped(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v))+'</text>'}).join('');
 const labels=[1,7,14,21,28,31].map(d=>'<text x="'+x(d).toFixed(1)+'" y="'+(H-11)+'" text-anchor="middle" fill="#ccd7e8" font-size="13">Dec '+d+'</text>').join('');
 const zero=lo<0&&hi>0?'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#f59e9e" stroke-dasharray="5 5"/>':'';
 return '<div class="dec-chart"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="December cash balance by day, with undated expenses reserved on December 31 only for display" style="width:100%;min-width:560px;height:auto">'+grid+zero+'<path d="'+path+'" fill="none" stroke="#8ad5f5" stroke-width="4" stroke-linejoin="round"/>'+labels+'</svg></div>';
}
function render(state){
 const f=forecast(state);
 let html='<section id="decForecast"><p class="dec-lede">Forecast based on <strong>your household’s live, signed-in budget data</strong>. No changes here will schedule a payment or alter card balances.</p>';
 const items=[['December paycheck income',f.income],['Bills, including one-time',-f.bills],['Credit card minimums',-f.minimums],['Net December change',f.net]];
 html+='<div class="dec-stats">'+items.map(([label,value])=>'<div class="dec-stat"><small>'+escaped(label)+'</small><strong class="'+(value<0?'dec-red':'')+'">'+(value<0?'−':'')+cash(Math.abs(value))+'</strong></div>').join('')+'</div>';
 html+='<div class="dec-result"><div><small>Conditional December 31 cash balance</small><strong>'+cash(f.closing)+'</strong><p>Assuming '+cash(f.opening)+' is the cash available <strong>December 1</strong>.</p></div><span>December surplus after listed commitments <b>'+cash(f.net)+'</b></span></div>';
 html+='<div class="dec-inputs"><label class="field">Starting cash on December 1 ($)<input id="decOpening" type="number" step="0.01" value="'+(ui.opening===null?Number(state.opening)||0:ui.opening)+'"></label><label class="field">Additional December spending ($)<input id="decUnlisted" type="number" min="0" step="10" value="'+ui.unlisted+'"></label></div>';
 html+='<p class="hint">What-if inputs affect only this forecast. Enter your actual December 1 balance for the best closing-balance estimate. No data is saved or modified.</p>';
 if(f.warnings.length)html+='<div class="dec-warnings"><strong>Items to verify</strong><ul>'+f.warnings.map(w=>'<li>'+escaped(w)+'</li>').join('')+'</ul></div>';
 html+='<h3>Cash-flow chart — December 1–31</h3><p class="hint">Undated expenses are deducted on December 31 as an accounting reserve, <strong>not a predicted payment date</strong>. Earlier balances may be overstated until those dates are entered.</p>'+graph(f);
 html+='<h3>December paychecks and payments</h3><div class="dec-event-list">'+f.events.map(e=>'<div class="dec-event"><span>'+fmt(e.date)+'</span><div><b>'+escaped(e.title)+'</b><small>'+escaped(e.kind==='income'?'Paycheck':e.kind==='minimum'?'Credit-card minimum':e.kind==='reserved'?'Undated reserve / what-if spending':e.kind==='bill'?'Bill':'Other payment')+'</small></div><strong class="'+(e.amount<0?'dec-red':'dec-green')+'">'+(e.amount>=0?'+':'−')+cash(Math.abs(e.amount))+'</strong></div>').join('')+'</div>';
 html+='<p class="hint">Assumes expected paychecks arrive on schedule, recurring bills repeat as entered, required debt minimums are paid, and no additional unrecorded charges occur. Does not reconcile transactions to bank statements. The app’s starting cash is not date-stamped, so the December 31 cash figure depends on your December 1 starting amount.</p></section>';
 return html;
}
function bind(state){
 const root=document.querySelector('#decForecast');if(!root)return;
 const apply=()=>{
  ui.opening=Number(root.querySelector('#decOpening').value)||0;
  ui.unlisted=Math.max(0,Number(root.querySelector('#decUnlisted').value)||0);
  root.outerHTML=render(state);bind(state);
 };
 root.querySelector('#decOpening').addEventListener('change',apply);
 root.querySelector('#decUnlisted').addEventListener('change',apply);
}
function dashboard(state){
 const f=forecast(state);
 return '<div class="dec-dashboard"><div><small>December 2026 cash-flow forecast</small><strong>'+cash(f.net)+' <span>estimated surplus</span></strong><small>Conditional Dec 31 cash: '+cash(f.closing)+' if starting cash is available Dec 1</small></div><button type="button" data-tab="December Forecast">View December forecast</button></div>';
}
window.DecemberForecast={forecast,render,bind,dashboard,datesFor};
})();