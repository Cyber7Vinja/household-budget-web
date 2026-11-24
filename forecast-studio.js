(()=>{
'use strict';
// Forecast workspace: a deep-copy, never written to the shared household database.
const dayMs=86400000,fmtCash=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Math.round((Number(n)||0)*100)/100);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cents=x=>Math.round((Number(x)||0)*100);
const nonneg=x=>Math.max(0,cents(x));
const asDate=s=>Date.parse(String(s)+'T00:00:00Z');
const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&Number.isFinite(asDate(s))&&new Date(asDate(s)).toISOString().slice(0,10)===s;
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const addDays=(d,n)=>iso(asDate(d)+n*dayMs);
const monthEnd=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const monthDay=(y,m,d)=>[y,String(m).padStart(2,'0'),String(Math.min(d,monthEnd(y,m))).padStart(2,'0')].join('-');
const labelDate=d=>valid(d)?new Date(asDate(d)).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'Not dated';
const localToday=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const labelLong=d=>valid(d)?new Date(asDate(d)).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'Unknown date';
const copy=o=>JSON.parse(JSON.stringify(o));
const groups=['paychecks','bills','debts','transactions','extras'];
let snapshot=null,sourceBaseline=null,sourceFingerprint=null,starting=null,mode=1,notice='',dirty=false,openNames=new Set();
let options={};
const defaultOptions=(state)=>{
 const now=localToday(),year=Number(now.slice(0,4));
 const upcomingChristmas=now>(year+'-12-25')?year+1:year;
 const grocery=Number.isFinite(Number(state.groceryWeekly))&&state.groceryWeekly!==undefined&&state.groceryWeekly!==null?Math.max(0,Math.min(5000,Number(state.groceryWeekly))):100;
 return {cash:Number(state.opening)||0,grocery,gas:0,christmas:0,christmasDate:upcomingChristmas+'-12-20',cushion:500};
};
function reset(state){
 sourceBaseline=copy(state);
 sourceFingerprint=JSON.stringify(state);
 snapshot=copy(state);
 for(const name of groups)if(!Array.isArray(snapshot[name]))snapshot[name]=[];
 snapshot.whatIf=[];
 options=defaultOptions(state);starting=localToday();mode=1;dirty=false;
 notice='Reset to the latest household budget. Forecast-only changes were cleared; no main-tab data was changed.';
 openNames=new Set();
}
function clear(){snapshot=null;sourceBaseline=null;sourceFingerprint=null;starting=null;notice='';dirty=false;openNames.clear()}
function generateThreeMonths(){
 mode=3;notice='Generated three future calendar months in this forecast only. Original Paychecks and Bills were not changed.';
}
// Bring newly saved income, bills, cards, and transactions into the forecast without
// replacing unrelated scenario changes. Each scenario field override wins over the
// corresponding live field; entries deleted only in the scenario stay hidden.
function mergeSandbox(draft,previous,live){
 const merged=copy(live);
 for(const group of groups){
  const oldRows=Array.isArray(previous?.[group])?previous[group]:[];
  const draftRows=Array.isArray(draft?.[group])?draft[group]:[];
  const priorById=new Map(oldRows.filter(row=>row&&row.id!=null).map(row=>[String(row.id),row]));
  const scenarioById=new Map(draftRows.filter(row=>row&&row.id!=null).map(row=>[String(row.id),row]));
  const removed=new Set(oldRows.filter(row=>row&&row.id!=null&&!scenarioById.has(String(row.id))).map(row=>String(row.id)));
  const fresh=Array.isArray(merged[group])?merged[group]:[];
  merged[group]=fresh.filter(row=>!removed.has(String(row?.id))).map(row=>{
   const old=priorById.get(String(row?.id));
   const edited=scenarioById.get(String(row?.id));
   if(!old||!edited)return row;
   for(const key of Object.keys(edited)){
    if(key==='id')continue;
    // Only fields changed in Forecast take precedence over future live changes.
    if(JSON.stringify(edited[key])!==JSON.stringify(old[key]))row[key]=copy(edited[key]);
   }
   return row;
  });
 }
 merged.whatIf=copy(Array.isArray(draft?.whatIf)?draft.whatIf:[]);
 return merged;
}
function ensure(state){
 if(!snapshot){reset(state);return;}
 const currentFingerprint=JSON.stringify(state);
 if(currentFingerprint===sourceFingerprint)return;
 const previousBaseline=sourceBaseline;
 const wasCashEdited=cents(options.cash)!==cents(previousBaseline?.opening);
 const previousGrocery=Number.isFinite(Number(previousBaseline?.groceryWeekly))&&previousBaseline?.groceryWeekly!==undefined&&previousBaseline?.groceryWeekly!==null?Number(previousBaseline.groceryWeekly):100;
 const groceryWasEdited=cents(options.grocery)!==cents(previousGrocery);
 snapshot=mergeSandbox(snapshot,previousBaseline,state);
 sourceBaseline=copy(state);
 sourceFingerprint=currentFingerprint;
 if(!wasCashEdited)options.cash=Number(state.opening)||0;
 if(!groceryWasEdited){options.grocery=Number.isFinite(Number(state.groceryWeekly))&&state.groceryWeekly!==undefined&&state.groceryWeekly!==null?Math.max(0,Math.min(5000,Number(state.groceryWeekly))):100;}
 notice='Updated from the latest household budget. Forecast-only changes are preserved; your original tabs were not edited.';
}
function endDate(start,months){const [y,m]=start.split('-').map(Number),d=new Date(Date.UTC(y,m-1+months+1,0));return iso(d.getTime());}
function occurrences(base,from,to){
 const d=base.date,f=base.frequency||'One-time';
 if(!valid(d))return [];
 if(f==='One-time')return d>=from&&d<=to?[d]:[];
 const result=[];
 if(f==='Weekly'||f==='Biweekly'){
  const step=(f==='Weekly'?7:14)*dayMs,first=Math.max(0,Math.ceil((asDate(from)-asDate(d))/step));
  for(let n=first;n<first+100;n++){const date=iso(asDate(d)+n*step);if(date>to)break;result.push(date);}
 }else if(f==='Monthly'||f==='Twice monthly'){
  const [year,mo,day]=d.split('-').map(Number);
  const [sy,sm]=from.split('-').map(Number),[ey,em]=to.split('-').map(Number);
  let ym=Math.max(year*12+mo-1,sy*12+sm-1);
  const last=ey*12+em-1;
  for(;ym<=last;ym++){
   const Y=Math.floor(ym/12),M=ym%12+1;
   if(f==='Monthly'){
    const dd=monthDay(Y,M,day);
    if(dd>=d&&dd>=from&&dd<=to)result.push(dd);
   }else{
    const first=day<=15?day:Math.max(1,day-15),second=Math.min(28,first+15);
    for(const date of [monthDay(Y,M,first),monthDay(Y,M,second)])
     if(date>=d&&date>=from&&date<=to&&!result.includes(date))result.push(date);
   }
  }
 }
 return result;
}
function recurring(entries,category,from,to,alerts){
 const base=entries.filter(x=>!x.parent),children=entries.filter(x=>x.parent),rows=[];
 const skip=x=>category==='bill'&&(x.budgetOnly||String(x.name||'').trim().toLowerCase()==='house');
 for(const item of base){
  if(skip(item))continue;
  const name=String(item.name||item.member||'Untitled');
  if(!valid(item.date)){
   if(category==='bill'&&item.frequency!=='One-time'&&nonneg(item.amount)>0){
    alerts.push(name+' has no due date. A monthly placeholder was reserved at month-end.');
    let Y=Number(from.slice(0,4)),M=Number(from.slice(5,7));
    while(Y*12+M<=Number(to.slice(0,4))*12+Number(to.slice(5,7))){
     const date=monthDay(Y,M,monthEnd(Y,M));
     if(date>=from&&date<=to)rows.push({date,category:'bill',name:name+' (date unknown)',amount:-nonneg(item.amount)});
     M++;if(M>12){M=1;Y++;}
    }
   }else if(category==='income')alerts.push(name+' has no date, so its income is excluded.');
   continue;
  }
  for(const date of occurrences(item,from,to)){
   const alternate=children.find(c=>c.parent===item.id&&c.date===date),entry=alternate||item;
   if((item.paid||entry.paid)&&date===item.date)continue;
   const value=nonneg(entry.amount);if(value)rows.push({date,category,name:String(entry.name||entry.member||name),amount:category==='income'?value:-value});
  }
 }
 for(const entry of children){
  if(skip(entry))continue;
  if(!valid(entry.date)||entry.date<from||entry.date>to)continue;
  const parent=base.find(b=>b.id===entry.parent);
  if(parent&&skip(parent))continue;
  if(parent&&occurrences(parent,from,to).includes(entry.date))continue;
  if(entry.paid)continue;
  const value=nonneg(entry.amount);if(value)rows.push({date:entry.date,category,name:String(entry.name||entry.member||'Adjusted entry'),amount:category==='income'?value:-value});
 }
 return rows;
}
function model(){
 const from=starting||localToday(),to=endDate(from,mode),warn=[],rows=[];
 rows.push(...recurring(snapshot.paychecks,'income',from,to,warn));
 rows.push(...recurring(snapshot.bills,'bill',from,to,warn));
 for(const card of snapshot.debts){
  if(!(Number(card.balance)>0)||!(Number(card.minimum)>0))continue;
  const d=valid(card.due)?card.due:null;
  const dueDay=Number(card.dueDay)||0,name=String(card.name||'Debt');
  if(!d&&(!dueDay||dueDay>31)){warn.push(name+' has no due date. Minimums are reserved at month-end.');}
  const firstMonth=Number(from.slice(0,4))*12+Number(from.slice(5,7));
  const lastMonth=Number(to.slice(0,4))*12+Number(to.slice(5,7));
  for(let mi=firstMonth;mi<=lastMonth;mi++){
   const year=Math.floor((mi-1)/12),month=(mi-1)%12+1;
   if(d&&mi<(Number(d.slice(0,4))*12+Number(d.slice(5,7))))continue;
   const day=d?Number(d.slice(-2)):(dueDay>=1&&dueDay<=31?dueDay:monthEnd(year,month));
   const date=monthDay(year,month,day);
   if(date<from||date>to)continue;
   if(card.paid&&d&&date===d)continue;
   rows.push({date,category:'debt',name:name+' minimum',amount:-nonneg(card.minimum)});
  }
 }
 for(const e of snapshot.extras){
  if(e.paid||!(Number(e.amount)>0))continue;
  const linked=snapshot.paychecks.find(p=>p.id===e.pay);
  const date=valid(e.date)?e.date:valid(linked?.date)?linked.date:null;
  if(date&&date>=from&&date<=to)rows.push({date,category:'extra',name:(snapshot.debts.find(x=>x.id===e.debt)?.name||'Debt')+' extra payment',amount:-nonneg(e.amount)});
  else warn.push('An extra debt payment has no valid forecast date.');
 }
 for(const t of snapshot.transactions){
  if(!valid(t.date)||t.date<from||t.date>to)continue;
  const cat=t.kind==='income'?'income':'other',value=nonneg(t.amount);
  if(value)rows.push({date:t.date,category:cat,name:String(t.name||'Recorded transaction'),amount:cat==='income'?value:-value});
 }
 for(const t of snapshot.whatIf){
  if(!valid(t.date)||t.date<from||t.date>to)continue;
  rows.push({date:t.date,category:t.kind,name:t.name,amount:(t.kind==='income'?1:-1)*nonneg(t.amount)});
 }
 const christmas=nonneg(options.christmas),gas=nonneg(options.gas);
 if(christmas&&valid(options.christmasDate)&&options.christmasDate>=from&&options.christmasDate<=to)
  rows.push({date:options.christmasDate,category:'christmas',name:'Christmas spending (what-if)',amount:-christmas});
 const weeks=[];for(let d=from;d<=to;d=addDays(d,7)){const end=addDays(d,6);weeks.push({from:d,to:end>to?to:end});}
 if(gas)for(const w of weeks)rows.push({date:w.from,category:'gas',name:'Weekly gas allowance (what-if)',amount:-gas});
 // Choose light/normal/stock-up trips using next-week bills and rollover of unused grocery budget.
 const base=rows.slice(),grocery=nonneg(options.grocery),cushion=nonneg(options.cushion);
 let spent=0,carry=0;
 const runningBase=date=>cents(options.cash)+base.filter(e=>e.date<=date).reduce((s,e)=>s+e.amount,0)-spent;
 for(const w of weeks){
  const lookahead=addDays(w.to,7)>to?to:addDays(w.to,7);
  // Include the cash available immediately BEFORE the first event of this week.
  // The Dashboard does the same; a payday later today must not make cash
  // that is unavailable at the start of the day look safe for groceries.
  const previous=w.from===from?cents(options.cash):runningBase(addDays(w.from,-1));
  let least=previous;
  for(let date=w.from;date<=lookahead;date=addDays(date,1))least=Math.min(least,runningBase(date));
  let modeText='Not set',cost=0;
  if(grocery){
   if(least<cushion+grocery*1.5){modeText='Light';cost=Math.round(grocery*.6);}
   else if(least>=cushion+grocery*5&&carry>=Math.round(grocery*.4)){modeText='Stock-up';cost=Math.round(grocery*1.4);}
   else{modeText='Regular';cost=grocery;}
   carry=Math.max(0,carry+grocery-cost);
  }
  w.shop=modeText;w.suggestedShopCost=cost;w.shopCost=grocery;
  // Balance reserves the entire weekly grocery allocation, whether or not the
  // recommended individual shopping trip would spend that much.
  if(grocery){rows.push({date:w.from,category:'groceries',name:'Weekly groceries reserved (suggested '+modeText+' trip '+fmtCash(cost/100)+')',amount:-grocery});spent+=grocery;}
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date)||b.amount-a.amount);
 const days=[],details=[];let balance=cents(options.cash);
 for(let d=from;d<=to;d=addDays(d,1)){
  for(const item of rows.filter(r=>r.date===d)){balance+=item.amount;details.push({...item,balance});}
  days.push({date:d,balance});
 }
 const byDate=new Map(days.map(d=>[d.date,d.balance]));
 for(const w of weeks){
  w.startCash=w.from===from?cents(options.cash):byDate.get(addDays(w.from,-1));
  w.endCash=byDate.get(w.to);
  w.events=details.filter(e=>e.date>=w.from&&e.date<=w.to);
  w.in=w.events.filter(e=>e.amount>0).reduce((s,e)=>s+e.amount,0);
  w.out=-w.events.filter(e=>e.amount<0).reduce((s,e)=>s+e.amount,0);
  w.low=Math.min(w.startCash,...days.filter(d=>d.date>=w.from&&d.date<=w.to).map(d=>d.balance));
  if(w.startCash+w.in-w.out!==w.endCash)throw Error('Forecast week does not reconcile.');
 }
 if(!gas)warn.push('Gas is TBD and has not been deducted.');
 if(!christmas)warn.push('Christmas is TBD and has not been deducted.');
 if(!grocery)warn.push('No grocery allowance entered.');
 warn.push('House is excluded from forecasting. Starting cash should be the available amount before the first forecast date.');
 return {from,to,weeks,days,rows,alerts:[...new Set(warn)],ending:balance,opening:cents(options.cash),totalIncome:rows.filter(r=>r.amount>0).reduce((s,r)=>s+r.amount,0),totalOut:-rows.filter(r=>r.amount<0).reduce((s,r)=>s+r.amount,0)};
}
const field=(label,id,type,value,other='')=>'<label class="fs-field">'+esc(label)+'<input id="'+id+'" type="'+type+'" value="'+esc(value)+'" '+other+'></label>';
const fmtInput=v=>v===null||v===undefined?'':v;
function rowEditors(items,group,columns){
 const header=columns.map(c=>'<th>'+esc(c.title)+'</th>').join('');
 const rows=items.map((obj,index)=>{
  const html=columns.map(col=>{
   const value=fmtInput(obj[col.key]);
   if(col.type==='select'){
    const opts=col.values.map(v=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(v)+'</option>').join('');
    return '<td><select data-fs-group="'+group+'" data-fs-index="'+index+'" data-fs-field="'+col.key+'">'+opts+'</select></td>';
   }
   return '<td><input type="'+(col.type||'text')+'" data-fs-group="'+group+'" data-fs-index="'+index+'" data-fs-field="'+col.key+'" value="'+esc(value)+'" '+(col.type==='number'?'min="0" step="0.01"':'')+' aria-label="'+esc(col.title)+'"></td>';
  }).join('');
  return '<tr>'+html+'<td><button type="button" class="compact danger-btn" data-fs-remove="'+group+'" data-fs-index="'+index+'">Remove</button></td></tr>';
 }).join('');
 return '<div class="fs-scroller"><table class="fs-table"><thead><tr>'+header+'<th>Scenario</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function render(state){
 ensure(state);
 const plan=model(),detailsName='forecastSources',extraName='forecastAdd',warningsName='forecastWarnings';
 let html='<section id="forecastStudio" class="fs-wrap">';
 html+='<div class="fs-notice"><strong><span aria-hidden="true">🧪</span> Forecast sandbox — independent from your household budget</strong><p>This tab automatically picks up changes from Paychecks, Bills, Debt & Credit and Transactions when you return here. Any changes you make in Forecast are kept separate and never saved back to those tabs.</p></div>';
 html+='<div class="fs-toolbar"><button type="button" id="fsGenerate" class="primary">'+(mode===3?'Showing generated 3-month forecast':'Generate next 3 months')+'</button><button type="button" id="fsReset">Reset to latest budget</button><span class="hint">'+(mode===3?'Full next 3 calendar months':'Current and next month')+' · '+esc(labelLong(plan.from))+' – '+esc(labelLong(plan.to))+'</span></div>';
 if(notice)html+='<div class="fs-status" role="status">'+esc(notice)+'</div>';
 html+='<div class="fs-stats">'+[['Starting cash',plan.opening],['Projected income',plan.totalIncome],['Projected expenses',plan.totalOut],['Estimated ending cash',plan.ending]].map(([t,v])=>'<div class="fs-stat"><small>'+esc(t)+'</small><strong class="'+(v<0?'fs-danger':'')+'">'+fmtCash(v/100)+'</strong></div>').join('')+'</div>';
 html+='<details id="fsSpend" class="fs-details"'+(openNames.has('fsSpend')?' open':'')+'><summary>Christmas, gas and grocery planning</summary><div class="fs-inputs">';
 html+=field('Opening cash before forecast', 'fsCash','number',options.cash,'step="0.01"');
 html+=field('Weekly groceries reserved ($)', 'fsGrocery','number',options.grocery,'min="0" step="5"');
 html+=field('Weekly gas ($) · TBD until entered', 'fsGas','number',options.gas,'min="0" step="10"');
 html+=field('Christmas total ($) · TBD until entered', 'fsChristmas','number',options.christmas,'min="0" step="25"');
 html+=field('Christmas estimated date','fsChristmasDate','date',options.christmasDate);
 html+=field('Cash safety cushion ($)','fsCushion','number',options.cushion,'min="0" step="50"');
 html+='</div><p class="hint">Gas and Christmas show TBD when their estimates are zero; they are not assumed to be free. The full weekly grocery amount is reserved when calculating ending cash; the Light/Regular/Stock-up suggestion is not a discount. Already recorded grocery purchases can be double-counted if you include both.</p></details>';
 html+='<h3>Week-by-week cash forecast</h3><p class="hint">Three-month generation repeats saved schedules in this separate preview, never in Paychecks or Bills.</p>';
 html+='<div class="fs-week-list">';
 for(const w of plan.weeks){
  html+='<article class="fs-week'+(w.low<0?' fs-risk':'')+'"><div class="fs-week-head"><strong>'+esc(labelDate(w.from))+' – '+esc(labelDate(w.to))+'</strong><span class="fs-shop">'+(w.shop==='Not set'?'No grocery budget':esc(w.shop)+' trip suggested · '+fmtCash(w.shopCost/100)+' reserved')+'</span></div>';
  html+='<div class="fs-week-grid"><span><small>Starting</small><b>'+fmtCash(w.startCash/100)+'</b></span><span><small>Money in</small><b class="fs-income">+'+fmtCash(w.in/100)+'</b></span><span><small>Money out</small><b class="fs-expense">−'+fmtCash(w.out/100)+'</b></span><span><small>Week ending</small><b class="'+(w.endCash<0?'fs-danger':'fs-success')+'">'+fmtCash(w.endCash/100)+'</b></span></div>';
  html+='<details class="fs-week-events"><summary>Show '+w.events.length+' income and payment items · Low '+fmtCash(w.low/100)+'</summary>';
  for(const e of w.events)html+='<div class="fs-event"><time>'+esc(labelDate(e.date))+'</time><span>'+esc(e.name)+'</span><strong class="'+(e.amount<0?'fs-expense':'fs-income')+'">'+(e.amount<0?'−':'+')+fmtCash(Math.abs(e.amount)/100)+'</strong></div>';
  html+='</details></article>';
 }
 html+='</div>';
 html+='<details id="fsSources" class="fs-details"'+(openNames.has('fsSources')?' open':'')+'><summary>Edit copied income, bills, credit cards and transactions</summary><p class="hint">These are scenario-only copies of your saved entries. Amount and date changes recalculate this forecast, but never touch your original records. Removing an entry here only removes it from this preview.</p>';
 html+='<h3>Paychecks ('+snapshot.paychecks.length+')</h3>'+rowEditors(snapshot.paychecks,'paychecks',[{key:'member',title:'Member'},{key:'amount',title:'Pay ($)',type:'number'},{key:'date',title:'First pay date',type:'date'},{key:'frequency',title:'Repeat',type:'select',values:['One-time','Weekly','Biweekly','Twice monthly','Monthly']}]);
 html+='<h3>Bills ('+snapshot.bills.length+')</h3>'+rowEditors(snapshot.bills,'bills',[{key:'name',title:'Name'},{key:'amount',title:'Amount ($)',type:'number'},{key:'date',title:'Due date',type:'date'},{key:'frequency',title:'Repeat',type:'select',values:['One-time','Weekly','Biweekly','Twice monthly','Monthly']}]);
 html+='<p class="hint">House is intentionally excluded from the cash forecast. Bills marked reference-only are not charged twice.</p>';
 html+='<h3>Credit cards and loans ('+snapshot.debts.length+')</h3>'+rowEditors(snapshot.debts,'debts',[{key:'name',title:'Account'},{key:'balance',title:'Balance ($)',type:'number'},{key:'minimum',title:'Monthly minimum ($)',type:'number'},{key:'due',title:'Next due date',type:'date'},{key:'dueDay',title:'Due day',type:'number'},{key:'apr',title:'APR (%)',type:'number'}]);
 html+='<p class="hint">The weekly budget includes minimum payments, but does not project interest charges or changes in debt balances. APR and balances are available for what-if comparisons.</p>';
 html+='<h3>Recorded transactions ('+snapshot.transactions.length+')</h3>'+rowEditors(snapshot.transactions,'transactions',[{key:'name',title:'Description'},{key:'amount',title:'Amount ($)',type:'number'},{key:'date',title:'Date',type:'date'},{key:'kind',title:'Type',type:'select',values:['expense','debt','income']}]);
 html+='<h3>Extra debt payments ('+snapshot.extras.length+')</h3>'+rowEditors(snapshot.extras,'extras',[{key:'amount',title:'Amount ($)',type:'number'},{key:'date',title:'Date',type:'date'}]);
 html+='</details>';
 html+='<details id="fsAdd" class="fs-details"'+(openNames.has('fsAdd')?' open':'')+'><summary>Add or remove one-time forecast-only income or spending</summary><form id="fsAddForm" class="fs-add"><label>What kind?<select name="kind"><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Description<input name="name" type="text" maxlength="80" required placeholder="e.g. holiday trip"></label><label>Amount ($)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Date<input name="date" type="date" value="'+esc(starting)+'" required></label><button type="submit" class="primary">Add to forecast only</button></form>';
 for(const [i,e] of snapshot.whatIf.entries())html+='<div class="fs-event"><time>'+esc(labelDate(e.date))+'</time><span>'+esc(e.name)+'</span><strong>'+fmtCash(e.amount)+'</strong><button type="button" class="compact danger-btn" data-fs-remove="whatIf" data-fs-index="'+i+'">Remove</button></div>';
 html+='</details>';
 if(plan.alerts.length)html+='<details id="fsWarnings" class="fs-details"'+(openNames.has('fsWarnings')?' open':'')+'><summary>Forecast limitations ('+plan.alerts.length+')</summary><ul>'+plan.alerts.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></details>';
 html+='<p class="hint">All amounts are estimates. This standalone forecast is not saved and resets when you sign out or choose Reload original budget. The original Paychecks, Bills, Debt & Credit, Transactions and Dashboard remain unchanged.</p></section>';
 return html;
}
function bind(state,refresh){
 const root=document.querySelector('#forecastStudio');if(!root)return;
 const rerender=()=>{
  for(const d of root.querySelectorAll('details[id]')){if(d.open)openNames.add(d.id);else openNames.delete(d.id);}
  root.outerHTML=render(state);
  bind(state,refresh);
 };
 root.addEventListener('toggle',e=>{if(!e.target.id)return;e.target.open?openNames.add(e.target.id):openNames.delete(e.target.id)},true);
 root.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.fsGroup){
   const obj=snapshot[t.dataset.fsGroup]?.[Number(t.dataset.fsIndex)];if(!obj)return;
   const key=t.dataset.fsField;let value=t.value;
   if(['amount','balance','minimum','apr','dueDay'].includes(key)){const n=Number(value);value=value===''?null:Number.isFinite(n)?Math.max(0,n):0}
   obj[key]=value;dirty=true;notice='Forecast scenario updated. No saved household records changed.';rerender();return;
  }
  const binds={fsCash:'cash',fsGrocery:'grocery',fsGas:'gas',fsChristmas:'christmas',fsChristmasDate:'christmasDate',fsCushion:'cushion'};
  const name=binds[t.id];
  if(name){options[name]=name==='christmasDate'?t.value:Math.max(0,Number(t.value)||0);dirty=true;notice='Spending assumptions updated for this forecast only.';rerender();}
 });
 root.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.id==='fsGenerate'){generateThreeMonths();rerender();return;}
  if(t.id==='fsReset'){reset(state);rerender();return;}
  if(t.dataset.fsRemove){
   const a=snapshot[t.dataset.fsRemove],idx=Number(t.dataset.fsIndex);
   if(Array.isArray(a)&&idx>=0&&idx<a.length){a.splice(idx,1);dirty=true;notice='Removed from forecast only — the saved entry still exists.';rerender();}
  }
 });
 root.addEventListener('submit',e=>{
  if(e.target.id!=='fsAddForm')return;
  e.preventDefault();
  const v=Object.fromEntries(new FormData(e.target).entries());
  if(!valid(v.date)||!(Number(v.amount)>0)||!String(v.name||'').trim())return;
  snapshot.whatIf.push({kind:v.kind==='income'?'income':'expense',name:String(v.name).trim().slice(0,80),amount:Number(v.amount),date:v.date});
  dirty=true;notice='Added only to this forecast scenario.';rerender();
 });
}
window.ForecastStudio={reset,clear,ensure,mergeSandbox,render,bind,model,generateThreeMonths,dates:occurrences};
})();