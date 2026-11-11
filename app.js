/* ================= Data ================= */
const KEY='family-budget-v1', THEME='family-budget-theme', BKP='family-budget-lastbackup';
const store={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(_){return false}}};
/* --- Validation: every piece of data is checked and cleaned before use --- */
const LIST_KEYS=['income','budget','savings','fixed','bills','gave'];
const MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const str=(v,max=60)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
const money=v=>{const n=Number(v);return isFinite(n)&&n>=0&&n<1e12?Math.round(n*100)/100:0};
const newId=()=>Math.random().toString(36).slice(2,9);
function cleanItem(x,list){
  if(!x||typeof x!=='object') return null;
  const label=str(x.label); if(!label) return null;
  const o={id:newId(),label,amt:money(x.amt),done:x.done===true};
  if(list==='savings'){o.who=str(x.who)||'Other';o.cur=x.cur==='USD'?'USD':'MVR'}
  if(list==='budget'){o.spent=money(x.spent);delete o.done}
  if(list==='gave'&&x.me===true) o.me=true;
  return o;
}
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
function cleanExpense(x,monthKey){
  if(!x||typeof x!=='object') return null;
  const amt=money(x.amt); if(!(amt>0)) return null;
  const date=typeof x.date==='string'&&DATE_RE.test(x.date)&&x.date.slice(0,7)===monthKey?x.date:monthKey+'-01';
  return {id:newId(),date,amt,cat:str(x.cat)||'Other',note:str(x.note)};
}
function cleanData(d){
  const out={months:{},accounts:[]};
  if(!d||typeof d!=='object') return out;
  const months=d.months&&typeof d.months==='object'?d.months:{};
  for(const k of Object.keys(months).slice(0,600)){
    if(!MONTH_RE.test(k)) continue;
    const m=months[k]||{}, mo={};
    for(const l of LIST_KEYS) mo[l]=(Array.isArray(m[l])?m[l]:[]).slice(0,500).map(x=>cleanItem(x,l)).filter(Boolean);
    mo.expenses=(Array.isArray(m.expenses)?m.expenses:[]).slice(0,3000).map(x=>cleanExpense(x,k)).filter(Boolean);
    // Migrate old "spent so far" totals into one expense each
    for(const b of mo.budget){ if(b.spent>0){ mo.expenses.push({id:newId(),date:k+'-01',amt:b.spent,cat:b.label,note:'Earlier spending'}); } delete b.spent; }
    out.months[k]=mo;
  }
  out.accounts=(Array.isArray(d.accounts)?d.accounts:[]).slice(0,200).map(a=>{
    const label=str(a&&a.label); if(!label) return null;
    return {id:newId(),label,bank:str(a.bank,30),acct:str(String(a.acct??''),20).replace(/\D/g,'').slice(-4)};
  }).filter(Boolean);
  return out;
}
let S={months:{},accounts:[]};
try{
  const raw=store.get(KEY);
  if(raw) S=cleanData(JSON.parse(raw));
}catch(_){
  // Saved data unreadable: keep a copy instead of crashing, start clean
  try{store.set(KEY+'-unreadable-'+Date.now(),store.get(KEY)||'')}catch(__){}
  S={months:{},accounts:[]};
}

const LISTS={income:'Income',budget:'Budget',savings:'Savings',fixed:'Fixed expenses',bills:'House bills',gave:'Contributions'};
const NOUN={income:'income',budget:'spending category',savings:'saving',fixed:'expense',bills:'bill',gave:'person',accounts:'account'};
const TABS=['home','budget','spending','savings','bills','more'];
const EMPTY_MONTH=()=>({income:[],budget:[],savings:[],fixed:[],bills:[],gave:[],expenses:[]});
const OTHER_COLOR='#78716c';
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayStr=()=>ymd(new Date());
function catColor(m,label){const i=m.budget.findIndex(b=>b.label===label);return i<0?OTHER_COLOR:PALETTE[(i+2)%PALETTE.length]}
function spentOn(m,label){return m.expenses.filter(e=>e.cat===label).reduce((t,e)=>t+e.amt,0)}
function dayLabel(ds){const t=todayStr(), y=ymd(new Date(Date.now()-864e5));
  if(ds===t) return 'Today'; if(ds===y) return 'Yesterday';
  const[a,b,c]=ds.split('-').map(Number); return new Date(a,b-1,c).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});}
let spendFilter='';
const PALETTE=['#0d9488','#0284c7','#7c3aed','#db2777','#ea580c','#ca8a04','#16a34a','#4f46e5','#e11d48','#0891b2','#65a30d','#9333ea'];
const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const today=new Date(), thisMonth=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
let cur=S.months[thisMonth]?thisMonth:(Object.keys(S.months).sort().pop()||thisMonth);
let tab=(location.hash||'').slice(1); if(tab==='fixed'||tab==='house') tab='bills'; if(!TABS.includes(tab)) tab='home';

const $=id=>document.getElementById(id);
const mlabel=k=>{const[y,m]=String(k).split('-');return esc((MN[+m-1]||'')+' '+(/^\d{4}$/.test(y)?y:''))};
const shift=(k,d)=>{let[y,m]=k.split('-').map(Number);m+=d;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return y+'-'+String(m).padStart(2,'0')};
const fmt=(n,c='MVR')=>{n=Number(n||0);const s=n.toLocaleString('en-US',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});return c==='USD'?'$'+s:s+'/-'};
const sum=(a,f=()=>true)=>a.filter(f).reduce((t,x)=>t+Number(x.amt||0),0);
const uid=newId;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const M=()=>S.months[cur];
const pct=(a,b)=>b?Math.round(a/b*100):0;
function save(){ if(!store.set(KEY,JSON.stringify(S))) toast('Could not save — phone storage is blocked'); }

/* ================= Icons ================= */
const IC={
  tick:'<svg class="icon size-4 stroke-3" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  chev:'<svg class="icon size-[18px] text-teal-900/35 dark:text-teal-300/60" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  plus:'<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  spend:'<svg class="icon size-5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  info:'<svg class="icon mt-px" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
};
const MUTE='text-teal-900/55 dark:text-teal-200/70';
const CHIP='min-h-9 rounded-full border border-line bg-white px-3 text-sm aria-pressed:border-teal-600 aria-pressed:bg-teal-50 aria-pressed:text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:aria-pressed:border-emerald-400 dark:aria-pressed:bg-teal-800 dark:aria-pressed:text-emerald-200';

/* ================= Render ================= */
function render(){
  const isNow=cur===thisMonth;
  $('mtitle').innerHTML=`${mlabel(cur)}<span class="block text-xs font-medium ${MUTE}">${isNow?'This month':'Tap to go to this month'}</span>`;
  document.querySelectorAll('#nav [data-tab]').forEach(b=>b.dataset.tab===tab?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  const m=M();
  let h='';
  if(tab==='more') h=renderMore();
  else if(!m) h=renderNoMonth();
  else h={home:renderHome,budget:renderBudget,spending:renderSpending,savings:renderSavings,bills:renderBills}[tab](m);
  $('app').innerHTML=h;
  $('fab').classList.toggle('hidden',tab==='more');
  if(tab==='home'&&document.querySelector('.tally.animate')) countUp();
}
const GRID2='md:grid md:grid-cols-2 md:items-start md:gap-4 md:[&>*]:mb-0 mb-4';
function pageHead(t,sub,action=''){return `<div class="mx-1 mt-1 mb-4 flex items-end justify-between gap-2 [&>.tag]:shrink-0 [&>.tag]:whitespace-nowrap"><div class="min-w-0"><h2 class="text-[30px] leading-tight font-semibold tracking-tight">${t}</h2>${sub?`<p class="mt-0.5 text-sm ${MUTE}">${sub}</p>`:''}</div>${action}</div>`}
function empty(title,text){return `<div class="px-4 py-6 text-center text-sm ${MUTE}"><b class="mb-1 block text-[15px] text-teal-950 dark:text-teal-50">${title}</b>${text}</div>`}

function totals(m){
  const inc=sum(m.income), incGot=sum(m.income,x=>x.done);
  const sav=sum(m.savings,x=>x.cur!=='USD'), usd=sum(m.savings,x=>x.cur==='USD');
  const fix=sum(m.fixed), plan=sum(m.budget), spent=m.expenses.reduce((t,e)=>t+e.amt,0);
  const myGave=m.gave.filter(x=>x.me), house=sum(myGave), houseSet=myGave.length>0;
  // Each category counts as its plan, or what was actually spent if more. Unplanned spending also counts.
  const labels=new Set(m.budget.map(b=>b.label));
  const catUse=m.budget.reduce((t,b)=>t+Math.max(Number(b.amt)||0,spentOn(m,b.label)),0);
  const unplanned=m.expenses.filter(e=>!labels.has(e.cat)).reduce((t,e)=>t+e.amt,0);
  const alloc=sav+fix+house+catUse+unplanned;
  return {inc,incGot,sav,usd,fix,house,houseSet,myGave,plan,spent,unplanned,alloc,left:Math.round((inc-alloc)*100)/100};
}
function renderNoMonth(){
  const prev=Object.keys(S.months).filter(k=>k<cur).sort().pop();
  return pageHead(mlabel(cur),'Nothing recorded for this month yet.')+
  `<div class="card">${empty('Start '+mlabel(cur),prev?`Copies all items from ${mlabel(prev)} with ticks cleared and spending reset to 0, so you only update what changed.`:'Starts an empty month. Tip: restore a backup from More if you have one.')}
   <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="newmonth">${IC.plus} Start ${mlabel(cur)}</button></div></div>`;
}

function renderHome(m){
  const all=['income','savings','fixed','bills','gave'].flatMap(l=>m[l]);
  const done=all.filter(x=>x.done).length;
  const bt=sum(m.bills),gt=sum(m.gave),rem=gt-bt;
  const ft=sum(m.fixed),fp=sum(m.fixed,x=>x.done);
  const T=totals(m), smvr=T.sav, susd=T.usd;
  let h=hero(m,T,done,all.length);
  const lb=+store.get(BKP)||0, days=lb?Math.floor((Date.now()-lb)/864e5):null;
  if(all.length&&(days===null||days>30)) h+=`<div class="mb-4 flex items-start gap-2.5 rounded-2xl bg-amber-100 px-4 py-3 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">${IC.info}
    <p class="flex-1 text-sm">${days===null?'You haven\'t saved a backup yet.':`Last backup was ${days} days ago.`} Your data lives only on this phone.</p>
    <button class="link-btn -my-1.5 whitespace-nowrap text-amber-900! dark:text-amber-200!" data-act="export">Back up</button></div>`;
  if(!all.length&&!m.budget.length&&!m.expenses.length) return h+`<div class="card">${empty('Nothing here yet','Start with your income, then share it out in Budget. Or restore a backup from More.')}
    <div class="px-4 pb-4"><button class="btn w-full" data-act="import">Restore a backup</button></div></div>`;
  const tone=rem===0?'tag-ok':rem>0?'tag-warn':'tag-bad';
  const lt=T.left===0?'tag-ok':T.left>0?'tag-warn':'tag-bad';
  h+=`<div class="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
    ${kpi('Savings',fmt(smvr),susd?'+ '+fmt(susd,'USD'):`${m.savings.filter(x=>x.done).length}/${m.savings.length} done`,pct(m.savings.filter(x=>x.done).length,m.savings.length),'savings')}
    ${kpi('Fixed paid',fmt(fp),'of '+fmt(ft),pct(fp,ft),'bills')}
    ${kpi('Spending',fmt(T.spent),T.plan?`of ${fmt(T.plan)} planned`:`${m.expenses.length} expense${m.expenses.length===1?'':'s'}`,T.plan?pct(T.spent,T.plan):null,'spending',T.spent>T.plan)}
    ${kpi('House balance',`<span class="tag ${tone} text-lg!">${rem<0?'−':''}${fmt(Math.abs(rem))}</span>`,bt?(rem===0?'Fully covered':rem>0?'Extra collected':'Still short'):'No shared bills',null,'bills')}
  </div>`;
  const todo=[]; for(const l of ['income','savings','fixed','bills','gave']) m[l].filter(x=>!x.done).forEach(x=>todo.push([l,x]));
  h+=`<div class="card"><div class="card-h"><h3 class="card-t">Still to do</h3><span class="meta">${todo.length?todo.length+' left':''}</span></div>`;
  h+=todo.length?todo.map(([l,x])=>row(l,x,l==='savings'?esc(x.who)+' · '+LISTS[l]:l==='income'?'Income · not received yet':LISTS[l])).join('')
     :empty(`All done for ${MN[+cur.split('-')[1]-1]} 🎉`,'All income received, every transfer and bill ticked.');
  return h+'</div>';
}
let heroPlayed=false;
function tallyMarks(done,total,animate){
  const groups=[]; const n=Math.min(total,60);
  for(let g=0;g<Math.ceil(n/5);g++){
    const lines=[];
    for(let i=0;i<5&&g*5+i<n;i++){
      const k=g*5+i, cls=k<done?'on':'off', delay=animate&&k<done?` style="animation-delay:${120+k*45}ms"`:(animate?' style="animation-duration:0s"':'');
      lines.push(i<4?`<line class="${cls}"${delay} x1="${4+i*8}" y1="3" x2="${4+i*8}" y2="25"/>`:`<line class="${cls}"${delay} x1="-1" y1="20" x2="33" y2="7"/>`);
    }
    groups.push(`<svg viewBox="0 0 34 28" aria-hidden="true">${lines.join('')}</svg>`);
  }
  return `<div class="tally${animate?' animate':''}" role="img" aria-label="${done} of ${total} done">${groups.join('')}</div>`;
}
function hero(m,T,done,total){
  const animate=!heroPlayed&&tab==='home'&&!matchMedia('(prefers-reduced-motion: reduce)').matches; heroPlayed=true;
  const left=T.left, neg=left<0;
  const todaySpent=cur===thisMonth?m.expenses.filter(e=>e.date===todayStr()).reduce((t,e)=>t+e.amt,0):null;
  const stat=(l,v,go)=>`<button class="min-w-0 rounded-2xl bg-white/[.07] px-3 py-2.5 text-left hover:bg-white/[.12]" data-act="go" data-to="${go}"><span class="block truncate text-[12.5px] text-teal-100/70">${l}</span><span class="block truncate font-semibold tabular-nums">${v}</span></button>`;
  return `<section class="mb-4 rounded-[30px] bg-lagoon px-5 pt-5 pb-5 text-white shadow-[0_24px_50px_-28px_rgba(6,48,43,.9)] ring-1 ring-white/5 md:px-7 md:pt-6 dark:bg-lagoon-2/60">
    <div class="flex items-start justify-between gap-3">
      <p class="text-sm text-teal-100/75">${T.inc?(neg?'Over your income by':'Left to plan this month'):'What’s left this month'}</p>
      ${neg?`<span class="tag bg-red-400/20 text-red-200">Over</span>`:T.inc&&left===0?`<span class="tag bg-reef/20 text-reef">All planned</span>`:''}
    </div>
    ${T.inc?`<p class="display mt-1 text-[46px] leading-none font-semibold tracking-tight tabular-nums md:text-[64px] ${neg?'text-red-200':''}"><span data-count="${Math.abs(left)}">${fmt(Math.abs(left)).replace('/-','')}</span><span class="ml-1 text-[22px] font-medium text-teal-100/60 md:text-[28px]">MVR</span></p>`
      :`<p class="display mt-2 text-[28px] leading-tight font-semibold tracking-tight">Add your income to see<br>what’s left each month</p>
        <button class="btn mt-4 border-reef bg-reef text-teal-950 hover:bg-emerald-300" data-act="add" data-list="income">${IC.plus} Add income</button>`}
    <div class="mt-5 grid grid-cols-3 gap-2">
      ${stat('Income',fmt(T.inc),'budget')}
      ${stat('Planned out',fmt(T.alloc),'budget')}
      ${stat(todaySpent!==null?'Spent today':'Spent',fmt(todaySpent!==null?todaySpent:T.spent),'spending')}
    </div>
    ${total?`<div class="mt-5 flex items-end justify-between gap-4">${tallyMarks(done,total,animate)}<p class="shrink-0 pb-0.5 text-right text-[13px] text-teal-100/70"><span class="display block text-[22px] leading-none font-semibold text-white tabular-nums">${done}<span class="text-teal-100/50">/${total}</span></span>paid or received</p></div>`:''}
  </section>`;
}
function countUp(){
  const el=document.querySelector('[data-count]'); if(!el||el.dataset.done) return; el.dataset.done='1';
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const end=Number(el.dataset.count)||0, t0=performance.now(), dur=750;
  const step=t=>{const p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3); el.textContent=fmt(Math.round(end*e*100)/100).replace('/-',''); if(p<1) requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
function kpi(l,v,s,p,go,over){
  return `<button class="rounded-[22px] border border-line bg-white px-4 py-3.5 text-left shadow-sm hover:border-teal-300 dark:border-teal-800/50 dark:bg-teal-900/35 dark:shadow-none dark:hover:border-teal-600" data-act="go" data-to="${go}" aria-label="${l}. ${s}. Open">
    <div class="text-[13px] font-semibold ${MUTE}">${l}</div>
    <div class="display mt-0.5 text-[22px] font-semibold tracking-tight tabular-nums">${v}</div>
    <div class="mt-0.5 text-[12.5px] ${MUTE}">${s}</div>
    ${p!=null?`<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-mist dark:bg-teal-950" aria-hidden="true"><div class="h-full rounded-full transition-all ${over?'bg-red-500 dark:bg-red-400':'bg-teal-700 dark:bg-reef'}" style="width:${Math.min(100,p)}%"></div></div>`:''}</button>`;
}

function renderSavings(m){
  const mvr=sum(m.savings,x=>x.cur!=='USD'),usd=sum(m.savings,x=>x.cur==='USD');
  let h=pageHead('Savings',`${fmt(mvr)}${usd?' + '+fmt(usd,'USD'):''} · ${m.savings.filter(x=>x.done).length}/${m.savings.length} transferred`);
  if(!m.savings.length) return h+`<div class="card">${empty('No savings yet','Add each account you transfer into, grouped by person.')}${addBtn('savings')}</div>`;
  const groups=[...new Set(m.savings.map(x=>x.who))];
  h+=`<div class="${GRID2}">`;
  groups.forEach(g=>{
    const it=m.savings.filter(x=>x.who===g);
    const sub=['MVR','USD'].map(c=>{const t=sum(it,x=>(x.cur||'MVR')===c);return t?fmt(t,c):''}).filter(Boolean).join(' + ');
    h+=`<section class="card"><div class="card-h"><h3 class="card-t">${esc(g)}</h3><span class="meta tabular-nums">${sub}</span></div>${it.map(x=>row('savings',x)).join('')}${addBtn('savings',g)}</section>`;
  });
  return h+`</div><button class="btn w-full" data-act="add" data-list="savings">${IC.plus} Add saving for someone new</button>`;
}
function renderBills(m){
  const t=sum(m.fixed),p=sum(m.fixed,x=>x.done);
  const bt=sum(m.bills),gt=sum(m.gave),rem=gt-bt;
  const st=rem===0?['tag-ok','Fully covered']:rem>0?['tag-warn',fmt(rem)+' extra collected']:['tag-bad',fmt(-rem)+' still short'];
  let h=pageHead('Bills',`Fixed: ${fmt(p)} paid of ${fmt(t)}`);
  h+=listCard('fixed',m.fixed,'Fixed expenses',fmt(t));
  h+=`<div class="mx-0.5 mt-6 mb-3 flex items-end justify-between gap-2"><div><h2 class="text-lg font-bold">Shared house bills</h2><p class="text-sm ${MUTE}">Split between people · only the share marked <b class="font-semibold">You</b> counts in your budget</p></div>${bt?`<span class="tag ${st[0]}">${st[1]}</span>`:''}</div>`;
  h+=`<div class="${GRID2}">`+listCard('bills',m.bills,'Bills',fmt(bt))+listCard('gave',m.gave,'Contributions',fmt(gt),x=>(x.me?'<b class="font-semibold text-teal-700 dark:text-reef">You</b> · ':'')+(bt?pct(x.amt,bt)+'% of bills':''))+'</div>';
  if(bt||gt) h+=`<div class="card"><div class="flex items-center justify-between px-4 py-3 font-bold"><span>Remaining after bills</span><span class="tag ${st[0]} text-[15px]!">${rem<0?'−':''}${fmt(Math.abs(rem))}</span></div></div>`;
  return h;
}

function renderBudget(m){
  const T=totals(m);
  const lt=T.left===0?['tag-ok','All assigned']:T.left>0?['tag-warn',fmt(T.left)+' left to assign']:['tag-bad',fmt(-T.left)+' over income'];
  let h=pageHead('Budget',T.inc?`${fmt(T.inc)} in, ${fmt(T.alloc)} planned`:'Add income, then share it out',T.inc?`<span class="tag ${lt[0]}">${lt[1]}</span>`:'');
  h+=`<div class="${GRID2}">`;
  // Income
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Income</h3><span class="meta">tick when received</span></div>
    ${m.income.length?m.income.map(x=>row('income',x)).join('')+`<div class="total"><span>Total <span class="font-medium ${MUTE}">· ${fmt(T.incGot)} received</span></span><span class="tabular-nums">${fmt(T.inc)}</span></div>`
      :empty('No income yet','Add salary, allowance, side income… anything you receive this month.')}
    ${addBtn('income')}</section>`;
  // Distribution
  const segs=[{l:'Savings',v:T.sav,c:'#0f766e',go:'savings'},{l:'Fixed expenses',v:T.fix,c:'#0369a1',go:'bills'}]
    .concat(T.houseSet?[{l:'My house share',v:T.house,c:'#b45309',go:'bills'}]:[])
    .concat(m.budget.map((x,i)=>({l:x.label,v:Math.max(Number(x.amt)||0,spentOn(m,x.label)),c:PALETTE[(i+2)%PALETTE.length]})))
    .concat(T.unplanned?[{l:'Unplanned spending',v:T.unplanned,c:OTHER_COLOR}]:[]);
  const base=Math.max(T.inc,T.alloc)||1;
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Where it goes</h3><span class="meta tabular-nums">${T.inc?pct(T.alloc,T.inc)+'% of income':''}</span></div>
    <div class="px-4 pt-4"><div class="flex h-4 overflow-hidden rounded-full bg-mist dark:bg-teal-950" role="img" aria-label="Budget split">${segs.filter(g=>g.v>0).map(g=>`<div style="width:${g.v/base*100}%;background:${g.c}" title="${esc(g.l)}"></div>`).join('')}</div></div>
    <ul class="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 text-sm sm:grid-cols-2">${segs.map(g=>`<li class="flex items-center gap-2"><span class="size-2.5 flex-none rounded-full" style="background:${g.c}"></span><span class="min-w-0 flex-1 truncate">${esc(g.l)}</span><span class="tabular-nums ${MUTE}">${fmt(g.v)}${T.inc?` · ${pct(g.v,T.inc)}%`:''}</span></li>`).join('')}
      ${T.inc?`<li class="flex items-center gap-2"><span class="size-2.5 flex-none rounded-full border-2 border-teal-900/25 dark:border-teal-700"></span><span class="flex-1">${T.left<0?'Over income':'Not assigned'}</span><span class="tabular-nums ${T.left<0?'text-red-700 dark:text-red-300':MUTE}">${fmt(Math.abs(T.left))}</span></li>`:''}</ul>
    ${T.usd?`<p class="px-4 pb-3 text-[12.5px] ${MUTE}">USD savings (${fmt(T.usd,'USD')}) are not counted here because they're in a different currency.</p>`:''}
  </section></div>`;
  // Plan
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Plan</h3><span class="meta">tap + to add an expense</span></div>
    ${linkRow('Savings',T.sav,T.inc,'savings',`${m.savings.length} transfer${m.savings.length===1?'':'s'} · from Savings tab`)}
    ${linkRow('Fixed expenses',T.fix,T.inc,'bills',`${m.fixed.length} item${m.fixed.length===1?'':'s'} · from Bills tab`)}
    ${T.houseSet?linkRow('My house share',T.house,T.inc,'bills',`Only your part of ${fmt(sum(m.bills))} shared bills`)
      :m.gave.length?`<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="pickme">
        <span class="min-w-0 flex-1">My house share<span class="block text-[12.5px] text-amber-700 dark:text-amber-300">Not counted · tap to choose which contribution is yours</span></span>
        <span class="font-semibold tabular-nums ${MUTE}">—</span>${IC.chev}</button></div>`:''}
    ${m.budget.map((x,i)=>envRow(m,x,T.inc,PALETTE[(i+2)%PALETTE.length])).join('')}
    ${T.unplanned?`<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="filter" data-cat="__other">
      <span class="size-2.5 flex-none rounded-full" style="background:${OTHER_COLOR}"></span><span class="min-w-0 flex-1">Unplanned spending<span class="block text-[12.5px] ${MUTE}">Expenses without a category in this plan</span></span>
      <span class="font-semibold tabular-nums">${fmt(T.unplanned)}</span>${IC.chev}</button></div>`:''}
    ${!m.budget.length?`<div class="px-4 py-3"><p class="mb-2 text-sm ${MUTE}">Add spending categories to plan the rest. Quick picks:</p><div class="flex flex-wrap gap-1.5">${['Groceries','Transport','Eating out','Personal','Charity','Emergency fund','Gifts'].map(c=>`<button class="${CHIP}" data-act="add" data-list="budget" data-label="${c}">${c}</button>`).join('')}</div></div>`:''}
    <div class="total"><span>Total planned</span><span class="tabular-nums">${fmt(T.alloc)}</span></div>
    ${T.inc?`<div class="flex items-center justify-between border-t border-line px-4 py-3 font-bold dark:border-teal-800/60"><span>${T.left<0?'Over income':'Left to assign'}</span><span class="tag ${lt[0]} text-[15px]!">${T.left<0?'−':''}${fmt(Math.abs(T.left))}</span></div>`:''}
    ${addBtn('budget')}</section>`;
  return h;
}
function renderSpending(m){
  const T=totals(m), ex=m.expenses;
  const today=todayStr(), wk=ymd(new Date(Date.now()-6*864e5));
  const isNow=cur===thisMonth;
  const todayAmt=ex.filter(e=>e.date===today).reduce((t,e)=>t+e.amt,0);
  const weekAmt=ex.filter(e=>e.date>=wk&&e.date<=today).reduce((t,e)=>t+e.amt,0);
  const [y,mo]=cur.split('-').map(Number), dim=new Date(y,mo,0).getDate();
  const daysSoFar=isNow?new Date().getDate():dim;
  let h=pageHead('Spending',ex.length?`${ex.length} expense${ex.length===1?'':'s'} in ${MN[mo-1]}`:'Every rufiyaa you spend, day by day');
  h+=`<div class="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    ${isNow?statBox('Today',fmt(todayAmt)):''}
    ${isNow?statBox('Last 7 days',fmt(weekAmt)):''}
    ${statBox('This month',fmt(T.spent),T.plan?`of ${fmt(T.plan)} planned`:'')}
    ${statBox('Daily average',fmt(Math.round(T.spent/Math.max(1,daysSoFar))),`over ${daysSoFar} day${daysSoFar===1?'':'s'}`)}
  </div>`;
  if(!ex.length) return h+`<div class="card">${empty('No expenses yet','Tap “+ Expense” whenever you spend: groceries, fuel, a coffee. It takes 3 seconds.')}
    <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="addexp">${IC.plus} Add first expense</button></div></div>`;
  // category filter chips
  const cats=[...new Set([...m.budget.map(b=>b.label),...ex.map(e=>e.cat)])].filter(c=>ex.some(e=>e.cat===c));
  if(spendFilter&&spendFilter!=='__other'&&!cats.includes(spendFilter)) spendFilter='';
  const labels=new Set(m.budget.map(b=>b.label));
  const chip=(v,l,amt)=>`<button class="${CHIP} whitespace-nowrap" data-act="filter" data-cat="${esc(v)}" aria-pressed="${spendFilter===v}">${v&&v!=='__other'?`<span class="mr-1.5 inline-block size-2 rounded-full align-middle" style="background:${catColor(m,v)}"></span>`:''}${esc(l)}${amt!=null?` <span class="tabular-nums opacity-70">${fmt(amt)}</span>`:''}</button>`;
  h+=`<div class="-mx-3.5 mb-3 flex gap-1.5 overflow-x-auto px-3.5 pb-1 md:mx-0 md:flex-wrap md:px-0">${chip('','All',null)}${cats.map(c=>chip(c,c,spentOn(m,c))).join('')}</div>`;
  const list=ex.filter(e=>!spendFilter||(spendFilter==='__other'?!labels.has(e.cat):e.cat===spendFilter))
    .slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  if(!list.length) return h+`<div class="card">${empty('Nothing here','No expenses in this category this month.')}</div>`;
  const days=[...new Set(list.map(e=>e.date))];
  h+=days.map(d=>{const items=list.filter(e=>e.date===d), dt=items.reduce((t,e)=>t+e.amt,0);
    return `<section class="card"><div class="card-h py-2.5"><h3 class="text-sm font-bold">${dayLabel(d)}</h3><span class="text-sm font-semibold tabular-nums">${fmt(dt)}</span></div>
      ${items.map(e=>`<button class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 dark:border-teal-800/60" data-act="editexp" data-id="${esc(e.id)}" aria-label="Edit ${esc(e.note||e.cat)}, ${fmt(e.amt)}">
        <span class="size-2.5 flex-none rounded-full" style="background:${catColor(m,e.cat)}"></span>
        <span class="min-w-0 flex-1 truncate">${esc(e.note||e.cat)}${e.note?`<span class="block text-[12.5px] ${MUTE}">${esc(e.cat)}</span>`:''}</span>
        <span class="font-semibold tabular-nums">${fmt(e.amt)}</span>${IC.chev}</button>`).join('')}</section>`}).join('');
  return h;
}
function statBox(l,v,s=''){return `<div class="rounded-[22px] border border-line bg-white px-4 py-3.5 shadow-sm dark:border-teal-800/50 dark:bg-teal-900/35 dark:shadow-none"><div class="text-[13px] font-semibold ${MUTE}">${l}</div><div class="display mt-0.5 text-[22px] font-semibold tracking-tight tabular-nums">${v}</div>${s?`<div class="mt-0.5 text-[12.5px] ${MUTE}">${s}</div>`:''}</div>`}

function linkRow(label,v,inc,go,sub){
  return `<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="go" data-to="${go}" aria-label="${label}, ${fmt(v)}. Open">
    <span class="min-w-0 flex-1">${label}<span class="block text-[12.5px] ${MUTE}">${sub}</span></span>
    <span class="text-right"><span class="block font-semibold tabular-nums">${fmt(v)}</span>${inc?`<span class="block text-[12.5px] tabular-nums ${MUTE}">${pct(v,inc)}%</span>`:''}</span>${IC.chev}</button></div>`;
}
function envRow(m,x,inc,color){
  const plan=Number(x.amt)||0, spent=spentOn(m,x.label), left=plan-spent, over=left<0;
  return `<div class="flex items-center gap-2 border-b border-line px-4 dark:border-teal-800/60">
    <button class="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 text-left" data-act="edit" data-list="budget" data-id="${esc(x.id)}" aria-label="Edit ${esc(x.label)}: planned ${fmt(plan)}, spent ${fmt(spent)}">
      <span class="flex w-full items-center gap-2"><span class="size-2.5 flex-none rounded-full" style="background:${color}"></span><span class="min-w-0 flex-1 truncate">${esc(x.label)}</span><span class="font-semibold tabular-nums">${fmt(plan)}</span></span>
      <span class="h-1.5 w-full overflow-hidden rounded-full bg-mist dark:bg-teal-950"><span class="block h-full rounded-full ${over?'bg-red-500 dark:bg-red-400':'bg-teal-700 dark:bg-reef'}" style="width:${Math.min(100,pct(spent,plan||spent||1))}%"></span></span>
      <span class="flex w-full justify-between text-[12.5px] tabular-nums ${MUTE}"><span>Spent ${fmt(spent)}</span><span class="${over?'font-semibold text-red-700 dark:text-red-300':''}">${over?fmt(-left)+' over':fmt(left)+' left'}${inc?` · ${pct(plan,inc)}%`:''}</span></span>
    </button>
    <button class="grid size-11 flex-none place-items-center rounded-xl border border-line text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-reef dark:hover:bg-teal-800" data-act="addexp" data-cat="${esc(x.label)}" aria-label="Add expense to ${esc(x.label)}">${IC.spend}</button></div>`;
}
function listCard(list,items,title,total,subFn){
  const d=items.filter(x=>x.done).length;
  return `<section class="card"><div class="card-h"><h3 class="card-t">${title}</h3>${items.length?`<button class="link-btn" data-act="all" data-list="${list}">${d===items.length?'Untick all':'Tick all'}</button>`:''}</div>
    ${items.length?items.map(x=>row(list,x,subFn?subFn(x):'')).join('')+`<div class="total"><span>Total <span class="font-medium ${MUTE}">· ${d}/${items.length} done</span></span><span class="tabular-nums">${total}</span></div>`
      :empty('Nothing here yet',`Tap below to add your first ${NOUN[list]}.`)}
    ${addBtn(list)}</section>`;
}
function addBtn(list,who=''){return `<button class="add-btn" data-act="add" data-list="${list}" ${who?`data-who="${esc(who)}"`:''}>${IC.plus} Add ${NOUN[list]}${who?' for '+esc(who):''}</button>`}
function row(list,x,sub=''){
  const doneTxt=x.done?'text-teal-900/35 dark:text-teal-100/60':'';
  return `<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0 dark:border-teal-800/60">
    <button class="group -my-1 -mr-1.5 -ml-2.5 grid size-12 flex-none place-items-center rounded-xl" role="checkbox" aria-checked="${!!x.done}" data-act="tog" data-list="${list}" data-id="${esc(x.id)}" aria-label="${esc(x.label)} ${x.done?'done':'not done'}">
      <span class="grid size-[26px] place-items-center rounded-full border-2 border-teal-900/30 text-white transition-colors group-aria-checked:border-teal-800 group-aria-checked:bg-teal-800 dark:border-teal-400/60 dark:text-teal-950 dark:group-aria-checked:border-reef dark:group-aria-checked:bg-reef"><span class="opacity-0 group-aria-checked:opacity-100">${IC.tick}</span></span></button>
    <button class="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left" data-act="edit" data-list="${list}" data-id="${esc(x.id)}" aria-label="Edit ${esc(x.label)}, ${fmt(x.amt,x.cur)}">
      <span class="min-w-0 flex-1 truncate"><span class="${doneTxt} ${x.done?'line-through decoration-teal-900/25 dark:decoration-teal-600':''}">${esc(x.label)}</span>${sub?`<span class="block text-[12.5px] ${MUTE}">${sub}</span>`:''}</span>
      <span class="whitespace-nowrap font-semibold tabular-nums ${doneTxt}">${fmt(x.amt,x.cur)}</span>${IC.chev}</button></div>`;
}

function renderMore(){
  const th=store.get(THEME)||'system', lb=+store.get(BKP)||0;
  const setrow=(t,s,btn)=>`<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 dark:border-teal-800/60"><div class="flex-1">${t}<span class="block text-[12.5px] ${MUTE}">${s}</span></div>${btn}</div>`;
  return pageHead('More','Accounts, appearance and backup')+`<div class="${GRID2}"><div>
  <section class="card"><div class="card-h"><h3 class="card-t">Appearance</h3></div>
    <div class="mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1 dark:bg-teal-950" role="group" aria-label="Theme">${['system','light','dark'].map(t=>`<button data-act="theme" data-v="${t}" aria-pressed="${th===t}" class="min-h-10 rounded-lg text-sm font-semibold ${MUTE} aria-pressed:bg-white aria-pressed:text-teal-950 aria-pressed:shadow-sm dark:aria-pressed:bg-teal-700 dark:aria-pressed:text-white">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div>
    <p class="mx-4 mt-2 mb-3 text-[13px] ${MUTE}">“System” follows your phone's light/dark setting.</p></section>
  <section class="card"><div class="card-h"><h3 class="card-t">Backup</h3><span class="meta">${lb?'Last: '+new Date(lb).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Never backed up'}</span></div>
    ${setrow('Save backup file','Keep it in Files, Drive or send to yourself','<button class="btn" data-act="export">Save</button>')}
    ${setrow('Restore from backup','Replaces everything on this phone','<button class="btn" data-act="import">Restore</button>')}
  </section></div><div>
  <section class="card"><div class="card-h"><h3 class="card-t">Saving accounts</h3></div>
    ${S.accounts.length?S.accounts.map(a=>`<div class="border-b border-line px-4 last:border-b-0 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2 py-2 text-left" data-act="editacct" data-id="${esc(a.id)}"><span class="flex-1">${esc(a.label)}<span class="block text-[12.5px] ${MUTE}">${esc(a.bank)} ${a.acct?'••'+esc(String(a.acct).replace(/\D/g,'').slice(-4)):''}</span></span>${IC.chev}</button></div>`).join('')
      :empty('No accounts saved','Add the accounts you transfer savings into.')}
    <button class="add-btn" data-act="addacct">${IC.plus} Add account</button></section>
  <p class="-mt-2 mx-1 mb-4 text-[13px] ${MUTE}">Only last 4 digits are kept. Never store passwords or PINs here.</p>
  ${M()?`<section class="card">${setrow('Delete '+mlabel(cur),"Removes this month's items only",'<button class="btn btn-danger" data-act="delmonth">Delete</button>')}</section>`:''}
  </div></div>`;
}

/* ================= Toast with undo ================= */
let tTimer=null, undoFn=null;
function toast(msg,undo){
  $('tmsg').textContent=msg; undoFn=undo||null; $('tbtn').classList.toggle('hidden',!undo);
  const t=$('toast'); t.classList.remove('hidden'); t.classList.add('flex');
  clearTimeout(tTimer); tTimer=setTimeout(hideToast,undo?6000:2500);
}
function hideToast(){ const t=$('toast'); t.classList.add('hidden'); t.classList.remove('flex'); undoFn=null; }
$('tbtn').onclick=()=>{ const f=undoFn; hideToast(); if(f) f(); };
function snapshot(){ const before=JSON.stringify(S); return ()=>{ S=JSON.parse(before); save(); render(); toast('Undone'); }; }

/* ================= Confirm ================= */
function confirmSheet(title,msg,yes){
  return new Promise(res=>{
    $('ctitle').textContent=title; $('cmsg').textContent=msg; $('cyes').textContent=yes;
    const d=$('cdlg'); d.showModal();
    $('cyes').onclick=()=>{d.close();res(true)}; $('cno').onclick=()=>{d.close();res(false)}; d.oncancel=()=>res(false);
  });
}

/* ================= Edit sheet ================= */
let ctx=null;
// chip style defined above
const _CHIP='min-h-9 rounded-full border border-line bg-white px-3 text-sm aria-pressed:border-teal-600 aria-pressed:bg-teal-50 aria-pressed:text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:aria-pressed:border-emerald-400 dark:aria-pressed:bg-teal-800 dark:aria-pressed:text-emerald-200';
function openDlg(c){
  ctx=c; const x=c.item||{}; const L=c.list;
  const isSav=L==='savings', isAcct=L==='accounts', isBud=L==='budget', isSpend=c.mode==='spend';
  $('dtitle').textContent=isSpend?'Record spending':(c.item?'Edit ':'Add ')+NOUN[L];
  $('dhint').textContent=isSpend?`${x.label}: spent ${fmt(x.spent)} of ${fmt(x.amt)} planned.`
    :c.item?'Change the details, or delete with the bin.':isSav?'Add an account you transfer savings into.':L==='income'?'Salary, allowance, rent received, side income…':isBud?'How much you plan to spend on this each month.':'';
  $('fname').classList.toggle('hidden',isSpend);
  $('lamt').textContent=isSpend?'Amount spent':isBud?'Planned amount':L==='income'?'Amount':'Amount';
  $('fwho').classList.toggle('hidden',!isSav); $('famt').classList.toggle('hidden',isAcct);
  $('fme').classList.toggle('hidden',L!=='gave'||isSpend); $('ime').checked=!!x.me;
  $('fbank').classList.toggle('hidden',!isAcct); $('facct').classList.toggle('hidden',!isAcct);
  $('icur').classList.toggle('hidden',!isSav);
  $('llabel').textContent=isSav?'Bank / account name':isAcct?'Account name':L==='gave'?'Person':L==='income'?'Source':isBud?'Category':'Name';
  $('ilabel').placeholder=isSav?'e.g. MIB':isAcct?'e.g. Thol Saving':L==='gave'?'e.g. Najey':L==='income'?'e.g. Salary':isBud?'e.g. Groceries':'e.g. Phone bill';
  const whos=M()?[...new Set(M().savings.map(s=>s.who))]:[];
  $('iwho').value=x.who||c.who||'';
  $('whochips').innerHTML=whos.map(w=>`<button type="button" class="${CHIP}" data-w="${esc(w)}" aria-pressed="${w===$('iwho').value}">${esc(w)}</button>`).join('');
  $('ilabel').value=x.label||c.label||''; $('iamt').value=isSpend?'':(x.amt!=null?x.amt:''); $('icur').value=x.cur||'MVR';
  $('ibank').value=x.bank||''; $('iacct').value=x.acct?String(x.acct).replace(/\D/g,'').slice(-4):'';
  ['elabel','eamt'].forEach(e=>$(e).textContent=''); ['ilabel','iamt'].forEach(e=>$(e).removeAttribute('aria-invalid'));
  $('bdel').classList.toggle('hidden',!c.item||isSpend);
  $('bsave').textContent=isSpend?'Add':'Save';
  $('dlg').showModal();
  setTimeout(()=>{(isSpend||(c.item&&!isAcct)||c.label?$('iamt'):(isSav&&!$('iwho').value?$('iwho'):$('ilabel'))).focus()},60);
}
$('whochips').onclick=e=>{const b=e.target.closest('[data-w]');if(!b)return;$('iwho').value=b.dataset.w;[...$('whochips').children].forEach(c=>c.setAttribute('aria-pressed',c===b))};
$('iwho').oninput=()=>[...$('whochips').children].forEach(c=>c.setAttribute('aria-pressed',c.dataset.w===$('iwho').value.trim()));
$('bcancel').onclick=()=>$('dlg').close();
['dlg','cdlg'].forEach(id=>$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).close()}));
$('bdel').onclick=()=>{
  const undo=snapshot(); const arr=ctx.list==='accounts'?S.accounts:M()[ctx.list];
  arr.splice(arr.indexOf(ctx.item),1); $('dlg').close(); save(); render(); toast(`Deleted “${ctx.item.label}”`,undo);
};
$('dform').onsubmit=e=>{
  e.preventDefault();
  if(ctx.mode==='spend'){
    const v=Number($('iamt').value.replace(/[,\s]/g,''));
    if(!$('iamt').value.trim()||!isFinite(v)||v<=0||v>=1e12){$('eamt').textContent='Enter the amount you spent, e.g. 250';$('iamt').setAttribute('aria-invalid','true');$('iamt').focus();return}
    const undo=snapshot(); const x=ctx.item; x.spent=money((Number(x.spent)||0)+v);
    $('dlg').close(); save(); render(); toast(`${fmt(v)} added to ${x.label}`,undo); return;
  }
  const label=str($('ilabel').value); const isAcct=ctx.list==='accounts';
  const rawAmt=$('iamt').value.replace(/[,\s]/g,''); const amt=Number(rawAmt);
  let ok=true;
  if(!label){$('elabel').textContent='Please enter a name.';$('ilabel').setAttribute('aria-invalid','true');ok=false}else{$('elabel').textContent='';$('ilabel').removeAttribute('aria-invalid')}
  if(!isAcct&&(rawAmt===''||!isFinite(amt)||amt<0||amt>=1e12)){$('eamt').textContent='Enter an amount, e.g. 1500 or 2101.89';$('iamt').setAttribute('aria-invalid','true');ok=false}else{$('eamt').textContent='';$('iamt').removeAttribute('aria-invalid')}
  if(!ok){(label?$('iamt'):$('ilabel')).focus();return}
  const undo=snapshot();
  if(isAcct){
    const x=ctx.item||{id:uid()}; x.label=label; x.bank=str($('ibank').value,30); x.acct=$('iacct').value.replace(/\D/g,'').slice(-4);
    if(!ctx.item) S.accounts.push(x);
  }else{
    const x=ctx.item||(ctx.list==='budget'?{id:uid()}:{id:uid(),done:false});
    if(ctx.list==='budget'&&ctx.item&&ctx.item.label!==label){
      if(M().budget.some(b=>b!==x&&b.label===label)){$('elabel').textContent='You already have a category with this name.';$('ilabel').setAttribute('aria-invalid','true');$('ilabel').focus();return}
      M().expenses.forEach(e=>{if(e.cat===x.label)e.cat=label});
    }
    if(ctx.list==='budget'&&!ctx.item&&M().budget.some(b=>b.label===label)){$('elabel').textContent='You already have a category with this name.';$('ilabel').setAttribute('aria-invalid','true');$('ilabel').focus();return}
    x.label=label; x.amt=Math.round(amt*100)/100;
    if(ctx.list==='gave'){ if($('ime').checked) x.me=true; else delete x.me; }
    if(ctx.list==='savings'){x.who=str($('iwho').value)||'Other';x.cur=$('icur').value}
    if(!ctx.item) M()[ctx.list].push(x);
  }
  $('dlg').close(); save(); render(); toast(ctx.item?'Saved changes':`Added “${label}”`,undo);
};

/* ================= Expense sheet ================= */
let ectx=null;
function monthOf(ds){return ds.slice(0,7)}
function ensureMonth(k){
  if(S.months[k]) return S.months[k];
  const prev=Object.keys(S.months).filter(x=>x<k).sort().pop();
  const src=prev?S.months[prev]:EMPTY_MONTH();
  const cp=arr=>(arr||[]).map(x=>({...x,id:uid(),done:false}));
  S.months[k]={income:cp(src.income),budget:(src.budget||[]).map(x=>({id:uid(),label:x.label,amt:x.amt})),
    savings:cp(src.savings),fixed:cp(src.fixed),bills:cp(src.bills),gave:cp(src.gave),expenses:[]};
  return S.months[k];
}
function openExp(c){
  ectx=c; const e=c.item||{};
  $('etitle').textContent=c.item?'Edit expense':'Add expense';
  $('eamt2').value=c.item?e.amt:''; $('enote').value=e.note||'';
  const [y,mo]=cur.split('-').map(Number);
  $('edate').value=e.date||(cur===thisMonth?todayStr():cur+'-01');
  const m=M()||S.months[thisMonth]||{budget:[]};
  const cats=[...new Set([...(m.budget||[]).map(b=>b.label),...(c.item&&e.cat!=='Other'?[e.cat]:[]),'Other'])];
  ectx.cat=e.cat||c.cat||(cats.length>1?'':'Other');
  $('ecats').innerHTML=cats.map(k=>`<button type="button" class="${CHIP}" data-c="${esc(k)}" aria-pressed="${k===ectx.cat}"><span class="mr-1.5 inline-block size-2 rounded-full align-middle" style="background:${M()?catColor(M(),k):OTHER_COLOR}"></span>${esc(k)}</button>`).join('');
  $('eerr').textContent=''; $('ecerr').textContent=''; $('eamt2').removeAttribute('aria-invalid');
  $('edel').classList.toggle('hidden',!c.item);
  $('edlg').showModal(); setTimeout(()=>$('eamt2').focus(),60);
}
$('ecats').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;ectx.cat=b.dataset.c;$('ecerr').textContent='';[...$('ecats').children].forEach(x=>x.setAttribute('aria-pressed',x===b))};
$('ecancel').onclick=()=>$('edlg').close();
$('edlg').addEventListener('click',e=>{if(e.target===$('edlg'))$('edlg').close()});
$('edel').onclick=()=>{
  const undo=snapshot(); const mk=monthOf(ectx.item.date); const arr=(S.months[mk]||M()).expenses;
  const i=arr.indexOf(ectx.item); if(i>=0) arr.splice(i,1);
  $('edlg').close(); save(); render(); toast(`Deleted ${fmt(ectx.item.amt)} expense`,undo);
};
$('eform').onsubmit=ev=>{
  ev.preventDefault();
  const raw=$('eamt2').value.replace(/[,\s]/g,''), amt=Number(raw);
  if(!raw||!isFinite(amt)||amt<=0||amt>=1e12){$('eerr').textContent='Enter the amount, e.g. 250';$('eamt2').setAttribute('aria-invalid','true');$('eamt2').focus();return}
  if(!ectx.cat){$('ecerr').textContent='Pick a category';return}
  const date=DATE_RE.test($('edate').value)?$('edate').value:todayStr();
  const undo=snapshot();
  const rec={id:ectx.item?ectx.item.id:uid(),date,amt:money(amt),cat:str(ectx.cat)||'Other',note:str($('enote').value)};
  if(ectx.item){ const om=S.months[monthOf(ectx.item.date)]; if(om){const i=om.expenses.indexOf(ectx.item); if(i>=0) om.expenses.splice(i,1);} }
  const tm=ensureMonth(monthOf(date)); tm.expenses.push(rec);
  const moved=monthOf(date)!==cur;
  $('edlg').close(); save(); render();
  toast(ectx.item?'Expense updated':`${fmt(rec.amt)} · ${rec.cat}`+(moved?` (saved in ${mlabel(monthOf(date))})`:''),undo);
};

/* ================= Backup ================= */
function exportData(){
  const name=`tally-backup-${new Date().toISOString().slice(0,10)}.json`;
  const blob=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
  const done=()=>{store.set(BKP,String(Date.now()));render();toast('Backup saved')};
  let file=null; try{file=new File([blob],name,{type:'application/json'})}catch(_){}
  if(file&&navigator.canShare&&navigator.canShare({files:[file]})){
    navigator.share({files:[file],title:'Tally backup'}).then(done).catch(()=>{});
  }else{
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000); done();
  }
}
$('ifile').onchange=()=>{
  const f=$('ifile').files[0]; $('ifile').value=''; if(!f) return;
  if(f.size>2*1024*1024){toast('File too large to be a Tally backup');return}
  const r=new FileReader();
  r.onload=async()=>{
    let d; try{d=JSON.parse(r.result); if(!d||typeof d.months!=='object') throw 0; d=cleanData(d);}catch(_){toast('That file isn\'t a Tally backup');return}
    const n=Object.keys(d.months).length;
    if(!n&&!d.accounts.length){toast('No usable data found in that file');return}
    if(Object.keys(S.months).length && !await confirmSheet('Replace data on this phone?',`The backup has ${n} month${n===1?'':'s'}. Everything currently in the app will be replaced. You can undo right after.`,'Replace')) return;
    const undo=snapshot(); S=d;
    cur=S.months[thisMonth]?thisMonth:(Object.keys(S.months).sort().pop()||thisMonth);
    save(); tab='home'; render(); toast(`Restored ${n} month${n===1?'':'s'}`,undo);
  };
  r.readAsText(f);
};

/* ================= Theme ================= */
const mq=matchMedia('(prefers-color-scheme: dark)');
function resolveTheme(){
  const pref=store.get(THEME)||'system';
  const dark=pref==='dark'||(pref==='system'&&mq.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.querySelector('meta[name=theme-color]').content=dark?'#042f2e':'#eef4f2';
}
mq.addEventListener?.('change',resolveTheme);

/* ================= Events ================= */
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-act]'); if(!t||t.closest('dialog')) return;
  const a=t.dataset.act, list=t.dataset.list, id=t.dataset.id;
  if(a==='tog'){const x=M()[list].find(i=>i.id===id);x.done=!x.done;save();render();
    document.querySelector(`[data-act="tog"][data-id="${id}"]`)?.focus({preventScroll:true}); try{navigator.vibrate?.(8)}catch(_){} }
  if(a==='all'){const undo=snapshot();const arr=M()[list];const v=!arr.every(x=>x.done);arr.forEach(x=>x.done=v);save();render();toast(v?'All ticked':'All unticked',undo)}
  if(a==='edit') openDlg({list,item:M()[list].find(i=>i.id===id)});
  if(a==='add') openDlg({list,who:t.dataset.who,label:t.dataset.label});
  if(a==='addexp') openExp({cat:t.dataset.cat});
  if(a==='editexp') openExp({item:M().expenses.find(i=>i.id===id)});
  if(a==='filter'){ spendFilter=spendFilter===t.dataset.cat?'':t.dataset.cat; if(tab!=='spending') go('spending'); else render(); }
  if(a==='addacct') openDlg({list:'accounts'});
  if(a==='editacct') openDlg({list:'accounts',item:S.accounts.find(i=>i.id===id)});
  if(a==='go') go(t.dataset.to);
  if(a==='pickme'){ go('bills'); toast('Tap your name in Contributions, then tick “This is my share”'); }
  if(a==='export') exportData();
  if(a==='import') $('ifile').click();
  if(a==='theme'){store.set(THEME,t.dataset.v);resolveTheme();render()}
  if(a==='newmonth'){
    const prev=Object.keys(S.months).filter(k=>k<cur).sort().pop();
    ensureMonth(cur);
    save();render();toast(`${mlabel(cur)} started`);
  }
  if(a==='delmonth'){
    if(!await confirmSheet(`Delete ${mlabel(cur)}?`,'All items for this month will be removed. Other months are not affected.','Delete')) return;
    const undo=snapshot(); delete S.months[cur]; save(); render(); toast(`${mlabel(cur)} deleted`,undo);
  }
});
function go(t){tab=t; try{history.replaceState(null,'','#'+t)}catch(_){} render(); $('app').focus({preventScroll:true}); window.scrollTo({top:0});}
document.querySelectorAll('#nav [data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
$('fab').onclick=()=>openExp({});
$('gear').onclick=()=>go('more');
$('prev').onclick=()=>{cur=shift(cur,-1);render()};
$('next').onclick=()=>{cur=shift(cur,1);render()};
$('mtitle').onclick=()=>{cur=thisMonth;render()};
document.addEventListener('keydown',e=>{ if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;
  if(e.key==='e'||e.key==='E'){e.preventDefault();openExp({});return}
  if(e.key==='ArrowLeft'){cur=shift(cur,-1);render()} if(e.key==='ArrowRight'){cur=shift(cur,1);render()} });
let sx=null,sy=null;
$('app').addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
$('app').addEventListener('touchend',e=>{ if(sx===null)return; const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy;
  if(Math.abs(dx)>80&&Math.abs(dy)<40){cur=shift(cur,dx<0?1:-1);render()} sx=null; },{passive:true});

render();
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
navigator.storage?.persist?.().catch(()=>{});
