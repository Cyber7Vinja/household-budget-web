(function(){
'use strict';
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n)||0);
const precise = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const esc = v => String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
const settings = {strategy:'avalanche',extra:0,missingApr:30};
function cards(state){
 return (Array.isArray(state.debts)?state.debts:[]).filter(d=>/credit\s*card/i.test(String(d.type||''))&&Number(d.balance)>0).map(d=>({
  id:String(d.id||''),name:String(d.name||'Unnamed card'),balance:Math.round(Math.max(0,Number(d.balance)||0)*100),
  minimum:Math.round(Math.max(0,Number(d.minimum)||0)*100),
  apr: d.apr===null||d.apr===undefined||d.apr===''?null:clamp(Number(d.apr)||0,0,100),
  limit:Math.max(0,Number(d.limit)||0)
 }));
}
function monthlyBills(state){
 const factors={'Weekly':52/12,'Biweekly':26/12,'Twice monthly':2,'Monthly':1};
 return (state.bills||[]).reduce((s,b)=>s+(!b.budgetOnly?Math.max(0,Number(b.amount)||0)*(factors[b.frequency]||0):0),0);
}
function recurringIncome(state){
 const factors={'Weekly':52/12,'Biweekly':26/12,'Twice monthly':2,'Monthly':1};
 const latest=new Map();
 for(const p of (state.paychecks||[])){
  if(!factors[p.frequency])continue;
  const key=String(p.member||'unknown')+'|'+p.frequency;
  const old=latest.get(key);
  if(!old||(old.parent&&!p.parent)||(!old.parent===!p.parent&&String(p.date||'')>String(old.date||'')))latest.set(key,p);
 }
 let total=0;
 for(const p of latest.values())total+=Math.max(0,Number(p.amount)||0)*(factors[p.frequency]||0);
 return {total,series:latest.size};
}
function simulate(entries,extra,strategy,missingApr){
 const list=entries.map(x=>({...x,remaining:x.balance,aprApplied:x.apr===null?missingApr:x.apr}));
 const principal=list.reduce((s,x)=>s+x.remaining,0);
 const monthlyBudget=list.reduce((s,x)=>s+x.minimum,0)+Math.round(extra*100);
 let cumulativeInterest=0;
 const points=[principal];
 const finished=[];
 if(!principal)return {months:0,interest:0,points,finished,paidOff:true};
 if(monthlyBudget<=0)return {months:null,interest:0,points,finished,paidOff:false};
 for(let month=1;month<=600;month++){
  const active=list.filter(d=>d.remaining>0);
  for(const d of active){
   const interest=Math.round(d.remaining*d.aprApplied/1200);
   d.remaining+=interest;cumulativeInterest+=interest;
  }
  let remainingBudget=monthlyBudget;
  for(const d of active){
   const payment=Math.min(remainingBudget,d.minimum,d.remaining);
   d.remaining-=payment;remainingBudget-=payment;
   if(d.remaining<=0)finished.push({name:d.name,month});
  }
  const priority=list.filter(d=>d.remaining>0).sort((a,b)=>strategy==='avalanche'
   ? b.aprApplied-a.aprApplied||a.remaining-b.remaining
   : a.remaining-b.remaining||b.aprApplied-a.aprApplied);
  for(const d of priority){
   if(remainingBudget<=0)break;
   const payment=Math.min(remainingBudget,d.remaining);
   d.remaining-=payment;remainingBudget-=payment;
   if(d.remaining<=0)finished.push({name:d.name,month});
  }
  const left=list.reduce((s,d)=>s+d.remaining,0);
  points.push(left);
  if(left===0)return {months:month,interest:cumulativeInterest,points,finished,paidOff:true};
 }
 return {months:null,interest:cumulativeInterest,points,finished,paidOff:false};
}
function plot(baseline,scenario,total){
 const horizon=Math.min(120,Math.max(12,baseline.months||60,scenario.months||60));
 const W=900,H=270,left=82,right=20,top=25,bottom=44,plotW=W-left-right,plotH=H-top-bottom;
 const x=n=>left+plotW*n/horizon;
 const y=v=>top+plotH*(1-Math.min(1,Math.max(0,v/Math.max(1,total))));
 function poly(model){
  const d=[];
  for(let m=0;m<=horizon;m++){
   const index=Math.min(m,model.points.length-1);
   const value=model.months!==null&&m>model.months?0:model.points[index];
   d.push((m?'L':'M')+x(m).toFixed(1)+','+y(value).toFixed(1));
  }
  return d.join(' ');
 }
 const ticks=[0,.25,.5,.75,1].map(v=>'<line x1="'+left+'" x2="'+(W-right)+'" y1="'+y(total*v)+'" y2="'+y(total*v)+'" stroke="#35435b" stroke-dasharray="3 5"/><text x="'+(left-12)+'" y="'+(y(total*v)+4)+'" text-anchor="end" font-size="13" fill="#bbc8db">'+money(total*v)+'</text>').join('');
 const xticks=[0,Math.round(horizon/4),Math.round(horizon/2),Math.round(3*horizon/4),horizon].map(m=>'<text x="'+x(m)+'" y="'+(H-12)+'" text-anchor="middle" font-size="13" fill="#bbc8db">'+m+' mo</text>').join('');
 return '<div class="dp-chart-scroll"><svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Projected remaining credit card debt over '+horizon+' months. Purple is your selected plan; gray is minimum-only baseline." style="width:100%;height:auto;min-width:460px">'+ticks+'<path d="'+poly(baseline)+'" stroke="#94a3b8" stroke-width="3" stroke-dasharray="9 7" fill="none" stroke-linecap="round"/><path d="'+poly(scenario)+'" stroke="#a5b4fc" stroke-width="4" fill="none" stroke-linecap="round"/>'+xticks+'</svg></div><div class="dp-legend"><span><i class="dp-dot" style="background:#a5b4fc"></i>Selected strategy</span><span><i class="dp-dot" style="background:#94a3b8"></i>Minimum-only comparison</span></div>';
}
function monthText(n){return n===null?'Not reached in model':n===0?'Already paid off':n+' months (approx. '+(n/12).toFixed(1)+' years)'}
function result(state){
 const all=cards(state);
 if(!all.length)return '<div class="empty">Add credit card accounts in Debt & Credit to model repayment.</div>';
 const total=all.reduce((a,c)=>a+c.balance,0);
 const min=all.reduce((a,c)=>a+c.minimum,0);
 const known=all.reduce((a,c)=>a+(c.apr!==null?Math.round(c.balance*c.apr/1200):0),0);
 const missing=all.filter(c=>c.apr===null);
 const zero=all.filter(c=>c.apr===0);
 const over=all.filter(c=>c.limit>0&&c.balance/100>c.limit);
 const incl=(known+missing.reduce((s,c)=>s+Math.round(c.balance*settings.missingApr/1200),0))/100;
 const scenario=simulate(all,settings.extra,settings.strategy,settings.missingApr);
 const baseline=simulate(all,0,settings.strategy,settings.missingApr);
 const income=recurringIncome(state);
 const other=monthlyBills(state);
 const needs=other+min/100;
 const margin=income.total-needs;
 const canExtra=margin>=settings.extra;
 const top=[...all].sort((a,b)=>settings.strategy==='avalanche'?(b.apr===null?settings.missingApr:b.apr)-(a.apr===null?settings.missingApr:a.apr)||a.balance-b.balance:a.balance-b.balance);
 const savings=baseline.paidOff&&scenario.paidOff?(baseline.interest-scenario.interest)/100:null;
 let html='<div class="dp-metrics">'+[
  ['Outstanding card debt',precise(total/100)],['Minimum card payments / month',precise(min/100)],
  ['Approx. first month interest',precise(incl)],['Selected payoff horizon',monthText(scenario.months)]
 ].map(pair=>'<div class="dp-stat"><small>'+esc(pair[0])+'</small><strong>'+esc(pair[1])+'</strong></div>').join('')+'</div>';
 html+='<div class="dp-budget '+(margin<0?'dp-warning':'')+'"><strong>Recorded recurring cash flow</strong><p>Estimated recurring income: '+precise(income.total)+'/month across '+income.series+' recorded pay schedule(s). Listed non-card bills: '+precise(other)+'/month. Card minimums: '+precise(min/100)+'/month. <strong>Difference: '+precise(margin)+'/month.</strong></p>';
 if(income.series===0)html+='<p>There are no recorded recurring paycheck schedules. Income needs to be entered before affordability can be assessed.</p>';
 else if(margin<0)html+='<p><strong>Warning:</strong> Recorded recurring income does not cover listed bills plus card minimums. Add any missing household paychecks and review actual monthly expenses before making extra payments.</p>';
 else if(!canExtra)html+='<p><strong>Warning:</strong> The selected extra payment exceeds the surplus shown by recorded income and bills. Do not commit to it until actual cash flow is verified.</p>';
 else html+='<p>The selected extra payment is within the surplus currently recorded, but verify the figures against real account balances.</p>';
 html+='</div>';
 if(missing.length||zero.length||over.length)html+='<div class="dp-warning"><strong>Check these details:</strong> '+[
  missing.length?missing.length+' card(s) have no APR entered ('+missing.map(c=>esc(c.name)).join(', ')+'). The scenario uses '+settings.missingApr+'% for them; that is an assumption, not the actual rate.':'',
  zero.length?zero.length+' card(s) show 0% APR. Confirm whether that rate is temporary.':'',
  over.length?over.length+' card(s) are above their entered credit limits.':''
 ].filter(Boolean).join(' ')+'</div>';
 html+='<h3>Projected remaining card debt</h3>';
 html+='<p class="hint">The purple line assumes the same total card payment continues each month even after individual cards are paid off. The gray line shows the recorded minimum-payment total without additional money. Both are modeled estimates, not bank statements.</p>';
 html+=plot(baseline,scenario,total);
 html+='<div class="dp-comparison"><div><small>Minimum-only strategy</small><strong>'+monthText(baseline.months)+'</strong></div><div><small>Selected strategy</small><strong>'+monthText(scenario.months)+'</strong></div><div><small>Estimated interest saved versus minimum-only</small><strong>'+(savings===null?'Not calculable':precise(Math.max(0,savings)))+'</strong></div></div>';
 html+='<h3>Which cards to target</h3><p class="hint">Pay at least each card’s required minimum. Put additional money toward the first target below, then move to the next. This is the priority order, not a promise of the order each card will close.</p>';
 html+='<div class="dp-targets">'+top.slice(0,6).map((d,i)=>'<div class="dp-target"><span class="dp-number">'+(i+1)+'</span><div><strong>'+esc(d.name)+'</strong><small>'+ (d.apr===null?'Unknown APR ('+settings.missingApr+'% scenario)':d.apr.toFixed(2)+'% APR')+'</small></div><b>'+precise(d.balance/100)+'</b></div>').join('')+'</div>';
 html+='<p class="hint">Assumptions: no new card charges or fees; unchanged APRs; monthly interest approximated as APR ÷ 12; payments made monthly; no missed payments; current minimums and the full initial monthly card-payment budget continue to be paid, even as individual debts reach $0. Your actual minimum payments, statement dates, promotions, and interest will vary. This chart does not schedule or make any payments.</p>';
 return html;
}
function render(state){
 const all=cards(state);
 return '<section id="debtPlanner"><div class="dp-intro">Explore a debt-free path using <strong>your signed-in household’s current card data</strong>. The controls below model scenarios only; changing them will not change account balances or schedule a payment.</div>'+
 '<div class="dp-controls"><label class="field">Payoff approach<select id="dpStrategy"><option value="avalanche"'+(settings.strategy==='avalanche'?' selected':'')+'>Highest APR first (avalanche)</option><option value="snowball"'+(settings.strategy==='snowball'?' selected':'')+'>Smallest balance first (snowball)</option></select></label>'+
 '<label class="field">Extra card payment each month ($)<input id="dpExtra" type="number" min="0" max="10000" step="25" value="'+settings.extra+'"></label>'+
 '<label class="field">Assumed APR for missing rates (%)<input id="dpUnknown" type="number" min="0" max="100" step="0.25" value="'+settings.missingApr+'"></label></div>'+
 '<p class="hint">The APR assumption is used only for modeling cards with missing rates. Enter their real APRs in Debt & Credit for a better forecast.</p>'+
 '<div id="dpResults" aria-live="polite">'+result(state)+'</div></section>';
}
function bind(state){
 const root=document.getElementById('debtPlanner');if(!root)return;
 const update=()=>{
  const strategy=root.querySelector('#dpStrategy');
  const extra=root.querySelector('#dpExtra');
  const unknown=root.querySelector('#dpUnknown');
  settings.strategy=strategy.value==='snowball'?'snowball':'avalanche';
  settings.extra=clamp(Number(extra.value)||0,0,10000);
  settings.missingApr=clamp(Number(unknown.value)||0,0,100);
  root.querySelector('#dpResults').innerHTML=result(state);
 };
 root.querySelectorAll('#dpStrategy,#dpExtra,#dpUnknown').forEach(el=>el.addEventListener('input',update));
}
window.DebtPlanner={render,bind,simulate,cards};
})();