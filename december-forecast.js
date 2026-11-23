(()=>{
'use strict';
// Scenario-only cash flow: no budget write, no embedded household data.
const START='2026-11-23',END='2026-12-31',DAY=86400000;
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(n)||0)/100);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cents=n=>Math.round(Math.max(0,Number(n)||0)*100);
const time=s=>Date.parse(String(s)+'T00:00:00Z');
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(time(s));
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const add=(s,n)=>iso(time(s)+n*DAY);
const fmt=s=>new Date(time(s)).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const monthEnd=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();
const dayAt=(year,month,day)=>year+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(monthEnd(year,month),day)).padStart(2,'0');
const between=d=>d>=START&&d<=END;
const ui={opening:null,weekly:100,buffer:500,novExtra:0,decExtra:0,novUndated:false};
function datesFor(item){
 if(!dateOK(item.date))return [];
 const anchor=item.date,frequency=item.frequency||'One-time',out=[];
 if(frequency==='One-time')return between(anchor)?[anchor]:[];
 if(frequency==='Weekly'||frequency==='Biweekly'){
  const step=(frequency==='Weekly'?7:14)*DAY;
  const first=Math.max(0,Math.ceil((time(START)-time(anchor))/step));
  for(let n=first;n<first+8;n++){const d=iso(time(anchor)+n*step);if(d>END)break;if(between(d))out.push(d);}
 }else if(frequency==='Monthly'||frequency==='Twice monthly'){
  const [y,m,day]=anchor.split('-').map(Number);
  for(const [yr,mo] of [[2026,11],[2026,12]]){
   if((yr-y)*12+mo-m<0)continue;
   if(frequency==='Monthly'){const date=dayAt(yr,mo,day);if(date>=anchor&&between(date))out.push(date);}
   else{
    const first=day<=15?day:Math.max(1,day-15),second=Math.min(28,first+15);
    for(const d of [dayAt(yr,mo,first),dayAt(yr,mo,second)])if(d>=anchor&&between(d)&&!out.includes(d))out.push(d);
   }
  }
 }
 return out;
}
function datedEntries(entries,kind,warn,opt){
 const all=Array.isArray(entries)?entries:[],parents=all.filter(x=>!x.parent),children=all.filter(x=>x.parent),result=[];
 const include=(source,date,base)=>{const amount=cents(source.amount);if(amount)result.push({date,title:String(source.name||source.member||base.name||base.member||'Entry'),kind,amount:kind==='income'?amount:-amount,source:source.id});};
 for(const base of parents){
  if(kind==='bill'&&base.budgetOnly)continue;
  if(!cents(base.amount))continue;
  if(!dateOK(base.date)){
   const isRecurring=base.frequency&&base.frequency!=='One-time';
   if(kind==='bill'&&isRecurring){
    warn.push(String(base.name||'Bill')+' has no due date. December is reserved at month-end; check whether it is also still owed in November.');
    include(base,END,base);
    result[result.length-1].kind='undated';
    if(opt.novUndated){include(base,'2026-11-30',base);result[result.length-1].kind='undated';}
   }else warn.push(String(base.name||base.member||'Entry')+' has no date and cannot be reliably forecast.');
   continue;
  }
  for(const d of datesFor(base)){
   const change=children.find(x=>x.parent===base.id&&x.date===d);
   include(change||base,d,base);
  }
 }
 for(const ch of children){
  if(kind==='bill'&&ch.budgetOnly)continue;
  if(!dateOK(ch.date)||!between(ch.date))continue;
  const parent=parents.find(x=>x.id===ch.parent);
  if(parent&&datesFor(parent).includes(ch.date))continue;
  include(ch,ch.date,parent||ch);
  warn.push('An adjusted '+kind+' date was included separately; check for overlapping entries.');
 }
 return result;
}
function weeks(){
 const r=[];for(let day=START;day<=END;day=add(day,7)){const weekEnd=add(day,6);r.push({start:day,end:weekEnd>END?END:weekEnd});}return r;
}
function makeForecast(state,options={}){
 const opt={...ui,...options};
 const warn=[],events=[];
 events.push(...datedEntries(state.paychecks,'income',warn,opt));
 events.push(...datedEntries(state.bills,'bill',warn,opt));
 for(const d of state.debts||[]){
  if(!(Number(d.balance)>0)||!cents(d.minimum))continue;
  const label=String(d.name||'Credit card');
  let dates=[];
  if(dateOK(d.due)){
   dates=datesFor({date:d.due,frequency:'Monthly'});
   if(Number(d.dueDay)>=1&&Number(d.dueDay)<=31&&Number(d.due.slice(-2))!==Number(d.dueDay)){
    warn.push(label+' has a due-date/day mismatch; the full dated value is used.');
   }
  }else if(Number(d.dueDay)>=1&&Number(d.dueDay)<=31){
   dates=[dayAt(2026,12,Number(d.dueDay))];
   warn.push(label+' has no full due date; only its saved day-of-month was used for December.');
  }else{
   dates=[END];
   warn.push(label+' is missing its due date; the minimum is reserved on December 31.');
  }
  for(const day of dates)events.push({date:day,kind:dateOK(d.due)?'minimum':'minimum-estimated',title:label+' minimum',amount:-cents(d.minimum),source:d.id});
 }
 const assigned=new Set([...(state.bills||[]),...(state.debts||[]),...(state.extras||[])].map(x=>x.id).filter(Boolean));
 for(const x of state.extras||[]){
  const parent=(state.paychecks||[]).find(p=>p.id===x.pay);
  const d=dateOK(x.date)?x.date:(parent&&dateOK(parent.date)?parent.date:null);
  if(d&&between(d))events.push({date:d,kind:'extra',title:'Extra debt payment',amount:-cents(x.amount),source:x.id});
  else if(cents(x.amount))warn.push('An extra payment without a date in this period is excluded.');
 }
 for(const x of state.transactions||[]){
  if(!dateOK(x.date)||!between(x.date)||assigned.has(x.source)||!['expense','debt'].includes(x.kind))continue;
  events.push({date:x.date,kind:'transaction',title:String(x.name||'Transaction'),amount:-cents(x.amount),source:x.id});
 }
 const opening=Math.round(Number(opt.opening===null?state.opening:opt.opening||0)*100);
 const reserve=(date,amount,label)=>{const v=cents(amount);if(v)events.push({date,kind:'reserve',title:label,amount:-v});};
 reserve('2026-11-30',opt.novExtra,'Other November spending (what-if)');
 reserve(END,opt.decExtra,'Other December spending (what-if)');
 const grossTotals=month=>({
  income:events.filter(e=>e.date.startsWith(month)&&e.kind==='income').reduce((s,e)=>s+e.amount,0),
  bill:events.filter(e=>e.date.startsWith(month)&&['bill','undated'].includes(e.kind)).reduce((s,e)=>s-e.amount,0),
  minimum:events.filter(e=>e.date.startsWith(month)&&e.kind.startsWith('minimum')).reduce((s,e)=>s-e.amount,0),
  other:events.filter(e=>e.date.startsWith(month)&&['extra','transaction','reserve'].includes(e.kind)).reduce((s,e)=>s-e.amount,0)
 });
 const calcBase={nov:grossTotals('2026-11'),dec:grossTotals('2026-12')};
 const scenario=weeks(),baseDays=[],byDate=new Map();
 for(const e of events){if(!byDate.has(e.date))byDate.set(e.date,[]);byDate.get(e.date).push(e);}
 let running=opening;
 for(let d=START;d<=END;d=add(d,1)){
  for(const e of byDate.get(d)||[])running+=e.amount;
  baseDays.push({date:d,balance:running});
 }
 const baseMap=new Map(baseDays.map(e=>[e.date,e.balance]));
 const weeklyBase=cents(opt.weekly),buffer=cents(opt.buffer);
 let spentGroceries=0;
 const groceryEvents=[];
 for(const w of scenario){
  const previous=w.start===START?opening:(baseMap.get(add(w.start,-1))??opening)-spentGroceries;
  const lookout=add(w.end,7)>END?END:add(w.end,7);
  const future=baseDays.filter(d=>d.date>=w.start&&d.date<=lookout).map(d=>d.balance-spentGroceries);
  const lowest=Math.min(previous,...future);
  let mode='Not set',factor=0,reason='Set a weekly grocery budget to see shopping recommendations.';
  if(weeklyBase>0){
   if(lowest<buffer+weeklyBase*1.5){mode='Light';factor=0.6;reason='Tight cash ahead or below your safety cushion: buy essentials and avoid a stock-up.';}
   else if(lowest>=buffer+weeklyBase*5){mode='Stock-up';factor=1.4;reason='Larger projected cushion after upcoming bills: a bigger trip may fit.';}
   else {mode='Regular';factor=1;reason='Allow a normal grocery trip while keeping cash for upcoming bills.';}
  }
  const cost=Math.round(weeklyBase*factor);
  w.mode=mode;w.cost=cost;w.why=reason;w.forwardLowest=lowest;
  if(cost){groceryEvents.push({date:w.start,kind:'grocery',title:mode+' grocery trip (scenario)',amount:-cost});spentGroceries+=cost;}
 }
 const all=events.concat(groceryEvents);
 const eventMap=new Map();
 for(const e of all){if(!eventMap.has(e.date))eventMap.set(e.date,[]);eventMap.get(e.date).push(e);}
 for(const v of eventMap.values())v.sort((a,b)=>b.amount-a.amount);
 const days=[],detail=[];
 running=opening;
 for(let d=START;d<=END;d=add(d,1)){
  for(const e of eventMap.get(d)||[]){running+=e.amount;detail.push({...e,balance:running});}
  days.push({date:d,balance:running});
 }
 const dmap=new Map(days.map(d=>[d.date,d.balance]));
 for(const w of scenario){
  const observations=days.filter(d=>d.date>=w.start&&d.date<=w.end);
  const openingBalance=w.start===START?opening:dmap.get(add(w.start,-1));
  w.close=dmap.get(w.end);
  w.low=Math.min(openingBalance,...observations.map(d=>d.balance));
  w.high=Math.max(openingBalance,...observations.map(d=>d.balance));
  w.income=detail.filter(e=>e.kind==='income'&&e.date>=w.start&&e.date<=w.end).reduce((s,e)=>s+e.amount,0);
  w.bills=-detail.filter(e=>e.amount<0&&e.kind!=='grocery'&&e.date>=w.start&&e.date<=w.end).reduce((s,e)=>s+e.amount,0);
 }
 const grocNov=-groceryEvents.filter(e=>e.date.startsWith('2026-11')).reduce((s,e)=>s+e.amount,0);
 const grocDec=-groceryEvents.filter(e=>e.date.startsWith('2026-12')).reduce((s,e)=>s+e.amount,0);
 const novClose=dmap.get('2026-11-30'),decClose=dmap.get(END);
 const excludingGroceries={nov:calcBase.nov.income-calcBase.nov.bill-calcBase.nov.minimum-calcBase.nov.other,dec:calcBase.dec.income-calcBase.dec.bill-calcBase.dec.minimum-calcBase.dec.other};
 const observed=days.map(d=>({date:d.date,value:d.balance}));
 const high=observed.reduce((a,b)=>b.value>a.value?b:a);
 const low=observed.reduce((a,b)=>b.value<a.value?b:a);
 const negatives=days.filter(d=>d.balance<0);
 if(negatives.length)warn.push('One or more projected days fall below $0. A positive month-end amount does not guarantee bills can be covered on time.');
 if(opt.weekly===100)warn.push('The $100 weekly grocery figure is an example, not a recorded expense. Change it to your actual plan.');
 if(!opt.novUndated)warn.push('Undated recurring bills (including housing) are NOT charged in November. Enable the November reserve if they are still owed.');
 warn.push('Starting cash is not date-stamped in your budget. Confirm the amount available BEFORE November 23 paychecks and payments to prevent double-counting.');
 const summary={opening,nov:calcBase.nov,dec:calcBase.dec,novClose,decClose,grocNov,grocDec,excludingGroceries,high,low,negativeDays:negatives.length};
 return {summary,days,weeks:scenario,events:detail,warnings:[...new Set(warn)],options:opt};
}
function plot(f){
 const W=980,H=374,L=91,R=31,T=44,B=65;
 const all=f.days.map(d=>d.balance).concat([f.summary.opening]);
 const min=Math.min(...all,0),max=Math.max(...all,0);
 const extent=Math.max(150000,max-min),lo=min-extent*.10,hi=max+extent*.13;
 const X=i=>L+(W-L-R)*i/(f.days.length-1);
 const Y=v=>T+(H-T-B)*(hi-v)/(hi-lo);
 const stepPath=f.days.map((d,i)=>i===0?'M'+X(i).toFixed(1)+','+Y(d.balance).toFixed(1):'H'+X(i).toFixed(1)+'V'+Y(d.balance).toFixed(1)).join(' ');
 const zero=lo<0&&hi>0?'<line x1="'+L+'" x2="'+(W-R)+'" y1="'+Y(0).toFixed(1)+'" y2="'+Y(0).toFixed(1)+'" stroke="#ff9da5" stroke-width="2" stroke-dasharray="7 5"/>':'';
 const ticks=[0,.25,.5,.75,1].map(p=>{const value=lo+(hi-lo)*p,y=Y(value);return '<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="#35445e" stroke-dasharray="4 6"/><text x="'+(L-12)+'" y="'+(y+4)+'" text-anchor="end" font-size="13" fill="#c1cfe0">'+esc(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(value/100))+'</text>'}).join('');
 const labels=[0,6,13,20,27,34,38].map(i=>'<text x="'+X(i)+'" y="'+(H-16)+'" text-anchor="middle" font-size="13" fill="#c8d3e5">'+fmt(f.days[i].date)+'</text>').join('');
 const divider=X(7)-((X(7)-X(6))/2);
 const monthDivision='<line x1="'+divider+'" x2="'+divider+'" y1="'+T+'" y2="'+(H-B)+'" stroke="#d2a36d" stroke-width="2" stroke-dasharray="6 5"/><text x="'+(divider+8)+'" y="'+(T+8)+'" font-size="13" fill="#f1cf99">December</text>';
 const points=f.weeks.map(w=>{const i=f.days.findIndex(d=>d.date===w.end);return '<circle cx="'+X(i)+'" cy="'+Y(w.close)+'" r="5" stroke="#ecf4ff" stroke-width="1.5" fill="#7e97e2"><title>'+fmt(w.end)+' week end: '+money(w.close)+'</title></circle>'}).join('');
 function marker(hit,color,caption,position){
  const i=f.days.findIndex(d=>d.date===hit.date),x=X(i),y=Y(hit.value),label=caption+' '+money(hit.value);
  const width=Math.min(230,label.length*7.5+24),px=Math.max(L,Math.min(W-R-width,x-width/2));
  const py=position==='above'?Math.max(1,y-56):Math.min(H-B-35,y+17);
  return '<circle cx="'+x+'" cy="'+y+'" r="8" fill="'+color+'" stroke="#eef8ff" stroke-width="1.5"/><rect x="'+px+'" y="'+py+'" width="'+width+'" height="32" rx="7" fill="#101827" stroke="'+color+'"/><text x="'+(px+9)+'" y="'+(py+21)+'" font-size="14" fill="#f1f6ff">'+esc(label)+'</text>';
 }
 const high=marker(f.summary.high,'#82e2bd','HIGH',f.summary.high.value>f.summary.low.value?'above':'below');
 const low=marker(f.summary.low,'#ffacac','LOW','below');
 return '<div class="dec-chart" style="overflow:auto"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Projected remaining November and December cash balance, with labeled high and low and Sunday week ending markers" style="width:100%;min-width:650px;height:auto"><rect x="'+L+'" y="'+T+'" width="'+(W-R-L)+'" height="'+(H-T-B)+'" rx="8" fill="#132234"/>'+ticks+zero+monthDivision+'<path d="'+stepPath+'" stroke="#83d0f5" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'+points+high+low+labels+'</svg></div>';
}
function render(state){
 const f=makeForecast(state),s=f.summary,round=n=>money(n);
 const cell=(label,value,css='')=>'<div class="dec-stat"><small>'+esc(label)+'</small><strong class="'+css+'">'+round(value)+'</strong></div>';
 let html='<section id="decForecast"><div class="dec-lede"><strong>November 23 – December 31, 2026</strong>. This cash-flow scenario starts before the November 23 paycheck and carries November’s remaining cash into December. Groceries are a planning example, not existing bank transactions.</div>';
 html+='<div class="dec-stats">'+cell('Starting cash (Nov 23)',s.opening)+cell('November 30 estimate',s.novClose,s.novClose<0?'dec-red':'')+cell('December 31 estimate',s.decClose,s.decClose<0?'dec-red':'')+cell('December net before groceries',s.excludingGroceries.dec,s.excludingGroceries.dec<0?'dec-red':'')+'</div>';
 html+='<div class="dec-result"><div><small>Lowest projected day</small><strong class="'+(s.low.value<0?'dec-red':'')+'">'+round(s.low.value)+'</strong><p>'+fmt(s.low.date)+'</p></div><div><small>Highest projected day</small><strong>'+round(s.high.value)+'</strong><p>'+fmt(s.high.date)+'</p></div><div><small>Grocery scenario across both months</small><strong>'+round(s.grocNov+s.grocDec)+'</strong><p>November '+round(s.grocNov)+' · December '+round(s.grocDec)+'</p></div></div>';
 html+='<div class="dec-inputs"><label class="field">Starting cash before Nov 23 entries ($)<input id="decOpening" type="number" step="0.01" value="'+(f.options.opening===null?Number(state.opening)||0:f.options.opening)+'"></label><label class="field">Weekly grocery example ($)<input id="decWeekly" type="number" min="0" max="5000" step="5" value="'+f.options.weekly+'"></label><label class="field">Minimum cash cushion ($)<input id="decBuffer" type="number" min="0" max="50000" step="50" value="'+f.options.buffer+'"></label><label class="field">Other spending through Nov 30 ($)<input id="decNovExtra" type="number" min="0" max="100000" step="10" value="'+f.options.novExtra+'"></label><label class="field">Other December spending ($)<input id="decDecExtra" type="number" min="0" max="100000" step="10" value="'+f.options.decExtra+'"></label><label class="field"><span>November housing or other undated monthly bills still unpaid?</span><span class="dec-check"><input type="checkbox" id="decNovUndated" '+(f.options.novUndated?'checked':'')+'> Reserve them in November too</span></label></div>';
 html+='<p class="hint">These are <strong>what-if controls only</strong>. Nothing here changes your saved paychecks, debts, or bill dates. Week-ending balances include the example grocery plan; they are not verified bank balances.</p>';
 html+='<h3>Cash highs and lows — with week-end markers</h3><p class="hint">The line changes when paychecks or expenses occur. Blue dots mark the end of each forecast week. Green and pink markers identify the highest and lowest end-of-day balances, not necessarily your intraday cash.</p>'+plot(f);
 html+='<h3>Week-ending balances and grocery-shopping guidance</h3><div class="dec-weeks"><div class="dec-week-header"><span>Week ending</span><span>Week low / high</span><span>Ending cash</span><span>Grocery plan</span></div>';
 for(const w of f.weeks){
  const css=w.mode==='Light'?'dec-light':w.mode==='Stock-up'?'dec-heavy':'dec-regular';
  html+='<div class="dec-week"><div><strong>'+fmt(w.start)+'–'+fmt(w.end)+'</strong><small>+ '+round(w.income)+' income · − '+round(w.bills)+' bills/cards</small></div><div><span class="dec-red">Low '+round(w.low)+'</span><small>High '+round(w.high)+'</small></div><div class="dec-week-close '+(w.close<0?'dec-red':'')+'">'+round(w.close)+'</div><div><span class="dec-grocery '+css+'">'+esc(w.mode)+'</span><strong class="dec-grocery-dollar">'+round(w.cost)+'</strong><small>'+esc(w.why)+'</small></div></div>';
 }
 html+='</div><p class="hint">“Stock-up” means a <strong>larger grocery trip</strong> looks more practical based on the projected cash cushion. “Light” means a smaller essentials-focused trip. Shopping is placed at the beginning of each displayed week, for forecasting only. A weekly example budget of $100 is used until you adjust it.</p>';
 const breakdown=(label,obj,grocery)=>'<div class="dec-breakdown"><strong>'+label+'</strong><div>Expected paychecks <b>'+round(obj.income)+'</b></div><div>Bills and one-time charges <b>−'+round(obj.bill)+'</b></div><div>Card minimums <b>−'+round(obj.minimum)+'</b></div><div>Other spending/extra debt <b>−'+round(obj.other)+'</b></div><div>Example groceries <b>−'+round(grocery)+'</b></div><div class="dec-total">Net change <b>'+round(obj.income-obj.bill-obj.minimum-obj.other-grocery)+'</b></div></div>';
 html+='<h3>November-to-December rollover</h3><div class="dec-breakdowns">'+breakdown('Remaining November',s.nov,s.grocNov)+breakdown('December',s.dec,s.grocDec)+'</div>';
 if(f.warnings.length)html+='<div class="dec-warnings"><strong>Dates and assumptions to verify</strong><ul>'+f.warnings.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>';
 html+='<details class="dec-details"><summary>Show all paychecks, bills, cards and shopping assumptions</summary><div class="dec-event-list">'+f.events.map(e=>'<div class="dec-event"><span>'+fmt(e.date)+'</span><div><b>'+esc(e.title)+'</b><small>'+esc(e.kind)+'</small></div><strong class="'+(e.amount<0?'dec-red':'dec-green')+'">'+(e.amount>=0?'+':'−')+round(Math.abs(e.amount))+'</strong></div>').join('')+'</div></details>';
 html+='<p class="hint">This is a cash-planning projection, not a bank balance or advice to postpone essential food purchases. It assumes no unrecorded transactions, steady pay schedules, and bills/card payments as entered. Undated payments are reserved at month-end, which can hide earlier cash shortages; enter due dates in Bills and Debt & Credit for a safer plan. Your forecast is visible only after household login.</p></section>';
 return html;
}
function bind(state){
 const root=document.getElementById('decForecast');if(!root)return;
 const changes=()=>{
  const get=id=>root.querySelector('#'+id);
  ui.opening=Number(get('decOpening').value)||0;
  ui.weekly=Math.max(0,Math.min(5000,Number(get('decWeekly').value)||0));
  ui.buffer=Math.max(0,Math.min(50000,Number(get('decBuffer').value)||0));
  ui.novExtra=Math.max(0,Number(get('decNovExtra').value)||0);
  ui.decExtra=Math.max(0,Number(get('decDecExtra').value)||0);
  ui.novUndated=get('decNovUndated').checked;
  root.outerHTML=render(state);bind(state);
 };
 for(const id of ['decOpening','decWeekly','decBuffer','decNovExtra','decDecExtra','decNovUndated'])root.querySelector('#'+id).addEventListener('change',changes);
}
function dashboard(state){
 const s=makeForecast(state).summary;
 return '<div class="dec-dashboard"><div><small>November → December 2026 cash forecast (with example grocery trips)</small><strong>'+money(s.decClose)+' <span>projected Dec 31 cash</span></strong><small>Estimated November 30 carryover: '+money(s.novClose)+' · Check starting cash and missing due dates</small></div><button type="button" data-tab="December Forecast">View weekly cash forecast</button></div>';
}
window.DecemberForecast={forecast:makeForecast,render,bind,dashboard,datesFor};
})();