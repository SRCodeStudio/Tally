/* Version check: index.html and app.js must come from the same update */
(function(){const m=document.querySelector('meta[name="tally-version"]');
  if(!m||m.content!=='22'){document.body.innerHTML='<div style="font:16px/1.5 system-ui;padding:32px 24px;max-width:480px;margin:auto"><h2 style="margin:0 0 8px">Update incomplete</h2><p>Some Tally files are from an older version. Upload <b>all files</b> from the latest tally.zip to GitHub, then reopen the app.</p><p style="opacity:.7">Your saved data is safe.</p></div>';throw new Error('Tally version mismatch');}})();
/* ================= Data ================= */
const KEY='family-budget-v1', THEME='family-budget-theme', BKP='family-budget-lastbackup';
const store={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v);return true}catch(_){return false}}};
/* --- Validation: every piece of data is checked and cleaned before use --- */
const LIST_KEYS=['income','budget','savings','fixed','bills','gave'];
const DUE_LISTS=['income','savings','fixed','bills'];
const MONTH_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const str=(v,max=60)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
const money=v=>{const n=Number(v);return isFinite(n)&&n>=0&&n<1e12?Math.round(n*100)/100:0};
const newId=()=>Math.random().toString(36).slice(2,9);
function cleanItem(x,list){
  if(!x||typeof x!=='object') return null;
  const label=str(x.label); if(!label) return null;
  const o={id:newId(),label,amt:money(x.amt),done:x.done===true};
  if(list==='savings'){o.who=str(x.who)||'Other';o.cur=x.cur==='USD'?'USD':'MVR';o.add=money(x.add);if(x.ext===true)o.ext=true;if(!o.add)o.done=false}
  if(list==='budget'){o.spent=money(x.spent);delete o.done}
  if(list==='gave'&&x.me===true) o.me=true;
  if(list==='bills'){ if(x.flex===true||(x.flex===undefined&&/\b(food|grocer)/i.test(o.label))){o.flex=true;o.done=false;} else if(x.flex===false) o.flex=false; }
  if(DUE_LISTS.includes(list)){const d=Number(x.due); if(Number.isInteger(d)&&d>=1&&d<=31) o.due=d;}
  return o;
}
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
function cleanExpense(x,monthKey){
  if(!x||typeof x!=='object') return null;
  const amt=money(x.amt); if(!(amt>0)) return null;
  const date=typeof x.date==='string'&&DATE_RE.test(x.date)&&x.date.slice(0,7)===monthKey?x.date:monthKey+'-01';
  const o={id:newId(),date,amt,cat:str(x.cat)||'Other',note:str(x.note)};
  if(x.scope==='house'){ o.scope='house'; o.paidBy=str(x.paidBy)||'You';
    o.split=[...new Set((Array.isArray(x.split)?x.split:[]).slice(0,12).map(v=>str(v)).filter(Boolean))];
    if(o.paidBy==='__fund') o.split=[]; else if(!o.split.length) o.split=[o.paidBy]; }
  return o;
}
function cleanSettle(x,monthKey){
  if(!x||typeof x!=='object') return null; const amt=money(x.amt); if(!(amt>0)) return null;
  const from=str(x.from), to=str(x.to); if(!from||!to||from===to) return null;
  const date=typeof x.date==='string'&&DATE_RE.test(x.date)&&x.date.slice(0,7)===monthKey?x.date:monthKey+'-01';
  return {id:newId(),date,from,to,amt};
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
    mo.settles=(Array.isArray(m.settles)?m.settles:[]).slice(0,500).map(x=>cleanSettle(x,k)).filter(Boolean);
    mo.housePlan=money(m.housePlan);
    mo.fundIns=(Array.isArray(m.fundIns)?m.fundIns:[]).slice(0,500).map(x=>{ if(!x||typeof x!=='object') return null; const amt=money(x.amt), from=str(x.from); if(!(amt>0)||!from) return null;
      const date=typeof x.date==='string'&&DATE_RE.test(x.date)&&x.date.slice(0,7)===k?x.date:k+'-01'; return {id:newId(),date,from,amt}; }).filter(Boolean);
    // Migrate old "spent so far" totals into one expense each
    for(const b of mo.budget){ if(b.spent>0){ mo.expenses.push({id:newId(),date:k+'-01',amt:b.spent,cat:b.label,note:'Earlier spending'}); } delete b.spent; }
    out.months[k]=mo;
  }
  out.accounts=(Array.isArray(d.accounts)?d.accounts:[]).slice(0,200).map(a=>{
    const label=str(a&&a.label); if(!label) return null;
    return {id:newId(),label,bank:str(a.bank,30),acct:str(String(a.acct??''),20).replace(/\D/g,'').slice(-4)};
  }).filter(Boolean);
  // Household members (shared across months). Exactly one may be "me".
  const seen=new Set(); let meSet=false;
  out.members=(Array.isArray(d.members)?d.members:[]).slice(0,12).map(p=>{
    const name=str(p&&p.name,30); if(!name||seen.has(name.toLowerCase())) return null; seen.add(name.toLowerCase());
    const me=p.me===true&&!meSet; if(me) meSet=true; return me?{name,me:true}:{name};
  }).filter(Boolean);
  if(!out.members.length){ // derive people from the latest month's house contributions
    const ks=Object.keys(out.months).sort().reverse(); for(const k of ks){ const g=out.months[k].gave; if(g.length>=2){
      const seen2=new Set(); let me2=false; out.members=g.map(x=>{const n=str(x.label,30); if(!n||seen2.has(n.toLowerCase())) return null; seen2.add(n.toLowerCase());
        const me=x.me===true&&!me2; if(me) me2=true; return me?{name:n,me:true}:{name:n};}).filter(Boolean).slice(0,12); break; } } }
  out.houseMode='split';
  const mg=str(d.fundManager,30); out.fundManager=out.members.some(p=>p.name===mg)?mg:((out.members[0]||{}).name||'');
  return out;
}
/* ================= Encryption (Web Crypto: PBKDF2-SHA256 → AES-256-GCM) ================= */
const ENC_KEY=KEY+'-enc', FAILS='tally-fails', AUTOLOCK='tally-autolock', HIDE='tally-hide';
const ITER=250000;
const b64=buf=>{const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
const unb64=t=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
async function deriveKey(secret,salt,iter){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptText(key,text){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));return {iv:b64(iv),ct:b64(ct)}}
async function decryptText(key,iv,ct){return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(ct)))}
function readEnc(){try{const o=JSON.parse(store.get(ENC_KEY)||'null');return o&&o.v===1&&typeof o.salt==='string'&&typeof o.ct==='string'&&typeof o.iv==='string'?o:null}catch(_){return null}}
function wipePlainCopies(){try{Object.keys(localStorage).forEach(k=>{if(k===KEY||k.startsWith(KEY+'-unreadable-'))localStorage.removeItem(k)})}catch(_){}}

let S={months:{},accounts:[]}, cryptoKey=null, encMeta=readEnc(), LOCKED=!!encMeta;
if(!LOCKED){
  try{ const raw=store.get(KEY); if(raw) S=cleanData(JSON.parse(raw)); }
  catch(_){ try{store.set(KEY+'-unreadable-'+Date.now(),store.get(KEY)||'')}catch(__){} S={months:{},accounts:[]}; }
}
let PRIV=store.get(HIDE)==='1';

const LISTS={income:'Income',budget:'Budget',savings:'Savings',fixed:'Fixed expenses',bills:'House bills',gave:'Contributions'};
const NOUN={income:'income',budget:'spending category',savings:'saving',fixed:'expense',bills:'bill',gave:'person',accounts:'account'};
const TABS=['home','budget','spending','savings','house','more'];
const EMPTY_MONTH=()=>({income:[],budget:[],savings:[],fixed:[],bills:[],gave:[],expenses:[],settles:[],housePlan:0,fundIns:[]});
const OTHER_COLOR='#78716c';
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayStr=()=>ymd(new Date());
function catColor(m,label){const i=m.budget.findIndex(b=>b.label===label);return i<0?OTHER_COLOR:PALETTE[(i+2)%PALETTE.length]}
const isHouse=e=>e.scope==='house';
function spentOn(m,label){return m.expenses.filter(e=>!isHouse(e)&&e.cat===label).reduce((t,e)=>t+e.amt,0)}
/* ---------- Household ---------- */
const MEMBERS=()=>S.members||[];
const ME=()=>(MEMBERS().find(p=>p.me)||{}).name||'You';
const hasHouse=()=>MEMBERS().length>=2;
const myShare=e=>isHouse(e)&&e.split.includes(ME())?e.amt/e.split.length:0;
const houseName=n=>n==='__fund'?'the fund':n===ME()?'You':n;
const FUND=()=>false; // single model: shared purchases are paid with house money or by a person
const potIn=m=>(m.gave||[]).filter(x=>x.done).reduce((t,x)=>t+(Number(x.amt)||0),0)+(m.fundIns||[]).reduce((t,x)=>t+x.amt,0);
const isFlex=x=>x.flex===true;
const houseSpentOn=(m,label)=>m.expenses.filter(e=>isHouse(e)&&e.cat===label).reduce((t,e)=>t+e.amt,0);
const potOut=m=>(m.bills||[]).filter(x=>x.done&&!isFlex(x)).reduce((t,x)=>t+(Number(x.amt)||0),0)+m.expenses.filter(isFundExp).reduce((t,e)=>t+e.amt,0);
function potBalance(upTo=cur){let b=0;for(const k of Object.keys(S.months)){if(k>upTo)continue;b+=potIn(S.months[k])-potOut(S.months[k]);}return Math.round(b*100)/100;}
const usesHouse=m=>hasHouse()||(m&&((m.gave||[]).length||(m.bills||[]).length));
const isFundExp=e=>isHouse(e)&&e.paidBy==='__fund';
const FUND_MGR=()=>MEMBERS().some(p=>p.name===S.fundManager)?S.fundManager:(MEMBERS()[0]||{}).name;
function fundBalance(upTo=cur){ let b=0; for(const k of Object.keys(S.months)){ if(k>upTo) continue; const m=S.months[k];
  b+=(m.fundIns||[]).reduce((t,x)=>t+x.amt,0); b-=m.expenses.filter(isFundExp).reduce((t,e)=>t+e.amt,0); } return Math.round(b*100)/100; }
// Net balance per person across all months: positive = others owe them
function balances(){
  const net={}; MEMBERS().forEach(p=>net[p.name]=0);
  for(const k of Object.keys(S.months)){ const m=S.months[k];
    for(const e of m.expenses) if(isHouse(e)&&!isFundExp(e)){ net[e.paidBy]=(net[e.paidBy]||0)+e.amt; const sh=e.amt/e.split.length; e.split.forEach(n=>net[n]=(net[n]||0)-sh); }
    for(const t of (m.settles||[])){ net[t.from]=(net[t.from]||0)+t.amt; net[t.to]=(net[t.to]||0)-t.amt; } }
  for(const n in net) net[n]=Math.round(net[n]*100)/100;
  return net;
}
// Fewest payments to settle everyone up
function settlements(net){
  const cr=Object.entries(net).filter(([,v])=>v>0.004).map(([n,v])=>[n,v]).sort((a,b)=>b[1]-a[1]);
  const db=Object.entries(net).filter(([,v])=>v<-0.004).map(([n,v])=>[n,-v]).sort((a,b)=>b[1]-a[1]);
  const out=[]; let i=0,j=0;
  while(i<db.length&&j<cr.length){ const a=Math.min(db[i][1],cr[j][1]); out.push({from:db[i][0],to:cr[j][0],amt:Math.round(a*100)/100});
    db[i][1]-=a; cr[j][1]-=a; if(db[i][1]<0.005) i++; if(cr[j][1]<0.005) j++; }
  return out;
}
function dayLabel(ds){const t=todayStr(), y=ymd(new Date(Date.now()-864e5));
  if(ds===t) return 'Today'; if(ds===y) return 'Yesterday';
  const[a,b,c]=ds.split('-').map(Number); return new Date(a,b-1,c).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});}
let spendFilter='';
const PALETTE=['#0d9488','#0284c7','#7c3aed','#db2777','#ea580c','#ca8a04','#16a34a','#4f46e5','#e11d48','#0891b2','#65a30d','#9333ea'];
/* Savings: amt = balance at start of the month, add = deposit planned this month, done = deposited */
const savBal=x=>(Number(x.amt)||0)+(x.done?Number(x.add)||0:0);
const savActive=x=>(Number(x.add)||0)>0;
const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const today=new Date(), thisMonth=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
let cur=S.months[thisMonth]?thisMonth:(Object.keys(S.months).sort().pop()||thisMonth);
let tab=(location.hash||'').slice(1); if(['bills','household'].includes(tab)) tab='house'; if(tab==='fixed') tab='budget'; if(!TABS.includes(tab)) tab='home';

const $=id=>document.getElementById(id);
const mlabel=k=>{const[y,m]=String(k).split('-');return esc((MN[+m-1]||'')+' '+(/^\d{4}$/.test(y)?y:''))};
const shift=(k,d)=>{let[y,m]=k.split('-').map(Number);m+=d;while(m>12){m-=12;y++}while(m<1){m+=12;y--}return y+'-'+String(m).padStart(2,'0')};
const fmt=(n,c='MVR')=>{if(PRIV)return c==='USD'?'$•••••':'•••••/-';n=Number(n||0);const s=n.toLocaleString('en-US',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});return c==='USD'?'$'+s:s+'/-'};
const sum=(a,f=()=>true)=>a.filter(f).reduce((t,x)=>t+Number(x.amt||0),0);
const uid=newId;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const M=()=>S.months[cur];
const pct=(a,b)=>b?Math.round(a/b*100):0;
let saveChain=Promise.resolve();
function save(){
  if(LOCKED) return saveChain;              // never overwrite while locked
  const json=JSON.stringify(S);
  if(cryptoKey&&encMeta){
    const key=cryptoKey, meta=encMeta;
    saveChain=saveChain.then(async()=>{const {iv,ct}=await encryptText(key,json);
      if(!store.set(ENC_KEY,JSON.stringify({...meta,iv,ct}))) toast('Could not save — phone storage is full or blocked');})
      .catch(()=>toast('Could not save'));
  } else if(!store.set(KEY,json)) toast('Could not save — phone storage is blocked');
  return saveChain;
}

/* ================= Icons ================= */
const IC={
  tick:'<svg class="icon size-4 stroke-3" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  chev:'<svg class="icon size-[18px] text-[#557570] dark:text-teal-300/60" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
  plus:'<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  spend:'<svg class="icon size-5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  info:'<svg class="icon mt-px" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
};
const MUTE='text-[#4a6964] dark:text-teal-200/70';
const CHIP='min-h-9 rounded-full border border-line bg-white px-3 text-sm aria-pressed:border-teal-600 aria-pressed:bg-teal-50 aria-pressed:text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:aria-pressed:border-emerald-400 dark:aria-pressed:bg-teal-800 dark:aria-pressed:text-emerald-200';

/* ================= Render ================= */
/* iPhone: data in a Safari tab can be lost (Private Browsing wipes it; Safari also clears
   site data after 7 days unused). The Home Screen app keeps its own, separate storage. */
const IS_IOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const STANDALONE=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
function browserWarning(){
  if(!IS_IOS||STANDALONE) return '';
  return `<div role="alert" class="mb-4 rounded-2xl bg-red-100 px-4 py-3 text-red-900 dark:bg-red-400/15 dark:text-red-100">
    <p class="font-semibold">Your data may be lost in Safari</p>
    <p class="mt-1 text-sm">You're using Tally in a Safari tab. Private Browsing deletes everything when the tab closes, and Safari can clear it after 7 days.
    Tap <b>Share</b>, then <b>Add to Home Screen</b>, and always open Tally from that icon. The icon has its own storage, so enter or restore your data there.</p></div>`;
}
function render(){
  if(LOCKED){ $('app').innerHTML=''; return; }
  const isNow=cur===thisMonth;
  {const [yy,mm]=cur.split('-'); $('mtitle').textContent=document.documentElement.dataset.text==='big'?`${MS[+mm-1]} ${yy}`:mlabel(cur); $('mtitle').setAttribute('aria-label',`${mlabel(cur)}. Go to this month`);} $('today').classList.toggle('hidden',isNow);
  document.querySelectorAll('#nav [data-tab]').forEach(b=>b.dataset.tab===tab?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  const m=M();
  let h='';
  if(tab==='more') h=renderMore();
  else if(!m) h=renderNoMonth();
  else h={home:renderHome,budget:renderBudget,spending:renderSpending,savings:renderSavings,house:renderHouse}[tab](m);
  $('app').innerHTML=browserWarning()+h;
  document.title=`${TAB_NAMES[tab]||'Tally'}, ${mlabel(cur)} – Tally`;
  document.querySelectorAll('svg:not([role])').forEach(x=>x.setAttribute('aria-hidden','true'));
  $('fab').classList.toggle('hidden',tab==='more');
  if(tab==='home'&&document.querySelector('.tally.animate')&&!PRIV) countUp();
  $('eye').setAttribute('aria-pressed',PRIV); $('eye').setAttribute('aria-label',PRIV?'Show amounts':'Hide amounts');
}
const GRID2='md:grid md:grid-cols-2 md:items-start md:gap-4 md:[&>*]:mb-0 mb-4';
function pageHead(t,sub,action=''){return `<div class="mx-1 mt-1 mb-4 flex items-end justify-between gap-2 [&>.tag]:shrink-0 [&>.tag]:whitespace-nowrap"><div class="min-w-0"><h2 class="text-[30px] leading-tight font-semibold tracking-tight">${t}</h2>${sub?`<p class="mt-0.5 text-sm ${MUTE}">${sub}</p>`:''}</div>${action}</div>`}
function empty(title,text){return `<div class="px-4 py-6 text-center text-sm ${MUTE}"><b class="mb-1 block text-[15px] text-teal-950 dark:text-teal-50">${title}</b>${text}</div>`}

function totals(m){
  const inc=sum(m.income), incGot=sum(m.income,x=>x.done);
  const dep=m.savings.filter(x=>savActive(x)&&!x.ext);
  const sav=dep.filter(x=>x.cur!=='USD').reduce((t,x)=>t+x.add,0), usd=dep.filter(x=>x.cur==='USD').reduce((t,x)=>t+x.add,0);
  const balMvr=m.savings.filter(x=>x.cur!=='USD').reduce((t,x)=>t+savBal(x),0), balUsd=m.savings.filter(x=>x.cur==='USD').reduce((t,x)=>t+savBal(x),0);
  const pers=m.expenses.filter(e=>!isHouse(e)), hx=m.expenses.filter(isHouse);
  const houseSpent=hx.reduce((t,e)=>t+e.amt,0), houseMine=hx.reduce((t,e)=>t+myShare(e),0);
  const housePlanMine=hasHouse()&&MEMBERS().some(p=>p.me)?(Number(m.housePlan)||0)/MEMBERS().length:0;
  const myIns=(m.fundIns||[]).filter(x=>x.from===ME()).reduce((t,x)=>t+x.amt,0);
  const houseUse=houseMine; // your share of shared shopping paid by a person (house-money purchases are covered by what you paid in)
  const fix=sum(m.fixed), plan=sum(m.budget), persSpent=pers.reduce((t,e)=>t+e.amt,0), spent=persSpent+houseMine;
  const myGave=m.gave.filter(x=>x.me), house=sum(myGave), houseSet=myGave.length>0;
  // Each category counts as its plan, or what was actually spent if more. Unplanned spending also counts.
  const labels=new Set(m.budget.map(b=>b.label));
  const catUse=m.budget.reduce((t,b)=>t+Math.max(Number(b.amt)||0,spentOn(m,b.label)),0);
  const unplanned=pers.filter(e=>!labels.has(e.cat)).reduce((t,e)=>t+e.amt,0);
  const alloc=sav+fix+house+catUse+unplanned+houseUse;
  return {inc,incGot,sav,usd,balMvr,balUsd,fix,house,houseSet,myGave,plan,spent,persSpent,houseSpent,houseMine,housePlanMine,houseUse,myIns,unplanned,alloc,left:Math.round((inc-alloc)*100)/100};
}
function guide(m){
  if(store.get('tally-guide')==='hidden') return '';
  const steps=[
    ['Add your income','Salary or any money you receive',m.income.length>0,'add-income'],
    ['Add your fixed bills','Phone, course fee, school…',m.fixed.length>0,'add-fixed'],
    ['Plan your spending','Set amounts for Food, Transport…',m.budget.length>0,'go-budget'],
    ['Add your savings','What’s saved and what you add monthly',m.savings.length>0,'add-savings'],
    ['Living with others? Set up House','Optional. Share bills and shopping',usesHouse(m),'go-house'],
    ['Save a backup','So you never lose your data',!!store.get(BKP),'backup'],
    ['Lock Tally with a PIN','Keeps your money private',!!encMeta,'pin']];
  const done=steps.filter(x=>x[2]).length; if(done===steps.length) return '';
  return `<section class="card" aria-labelledby="gtitle"><div class="card-h"><h3 id="gtitle" class="card-t">Get started</h3>
      <span class="flex items-center gap-1"><span class="meta tabular-nums">${done} of ${steps.length} done</span><button class="link-btn" data-act="guidehide">Hide</button></span></div>
    <div class="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-mist dark:bg-teal-950" aria-hidden="true"><div class="h-full rounded-full bg-teal-700 dark:bg-reef" style="width:${pct(done,steps.length)}%"></div></div>
    <ol class="pb-1">${steps.map(([t,sub,ok,act],i)=>`<li><button class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left" data-act="guide" data-step="${act}" ${ok?'aria-disabled="true"':''}>
      <span class="grid size-7 flex-none place-items-center rounded-full text-[13px] font-bold ${ok?'bg-teal-700 text-white dark:bg-reef dark:text-teal-950':'border-2 border-teal-900/25 text-[#4a6964] dark:border-teal-400/40 dark:text-teal-200/80'}">${ok?'✓':i+1}</span>
      <span class="min-w-0 flex-1 ${ok?'text-[#557570] dark:text-teal-200/60':''}">${t}<span class="block text-[12.5px] ${MUTE}">${ok?'Done':sub}</span></span>${ok?'':IC.chev}</button></li>`).join('')}</ol></section>`;
}
function renderNoMonth(){
  if(!Object.keys(S.months).length) return `<section class="mb-4 rounded-[30px] bg-lagoon px-6 py-7 text-white">
      <img src="icon-192.png" alt="" class="mb-4 size-12 rounded-2xl">
      <h2 class="text-[30px] leading-tight font-semibold tracking-tight">Welcome to Tally</h2>
      <p class="mt-2 text-[15.5px] text-teal-100/80">Plan your month, track every expense, and share house costs fairly. Everything stays on this phone.</p>
      <div class="mt-6 grid gap-2"><button class="btn w-full border-reef bg-reef text-teal-950 hover:bg-emerald-300" data-act="newmonth">Start ${mlabel(cur)}</button>
      <button class="btn w-full border-white/20 bg-white/10 text-white hover:bg-white/20" data-act="import">I have a backup file</button></div></section>`;
  const prev=Object.keys(S.months).filter(k=>k<cur).sort().pop();
  return pageHead(mlabel(cur),'Nothing recorded for this month yet.')+
  `<div class="card">${empty('Start '+mlabel(cur),prev?`Copies all items from ${mlabel(prev)} with ticks cleared and spending reset to 0, so you only update what changed.`:'Starts an empty month. Tip: restore a backup from More if you have one.')}
   <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="newmonth">${IC.plus} Start ${mlabel(cur)}</button></div></div>`;
}

function renderHome(m){
  const all=['income','savings','fixed','bills','gave'].flatMap(l=>l==='savings'?m[l].filter(savActive):l==='bills'?m[l].filter(x=>!isFlex(x)):m[l]);
  const done=all.filter(x=>x.done).length;
  const bt=sum(m.bills),gt=sum(m.gave),rem=gt-bt;
  const ft=sum(m.fixed),fp=sum(m.fixed,x=>x.done);
  const T=totals(m), smvr=T.sav, susd=T.usd;
  let h=hero(m,T,done,all.length);
  const lb=+store.get(BKP)||0, days=lb?Math.floor((Date.now()-lb)/864e5):null;
  h+=guide(m);
  if(all.length&&(days===null||days>30)) h+=`<div class="mb-4 flex items-center gap-3 rounded-[22px] border border-amber-200 bg-amber-50 py-3 pr-3 pl-3.5 dark:border-amber-300/15 dark:bg-amber-300/[.06]">
    <span class="grid size-10 flex-none place-items-center rounded-xl bg-amber-200/70 text-amber-800 dark:bg-amber-300/15 dark:text-amber-300"><svg class="icon size-5" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg></span>
    <p class="min-w-0 flex-1 text-sm"><b class="block font-semibold text-amber-950 dark:text-amber-100">${days===null?'No backup yet':`Last backup ${days} days ago`}</b><span class="text-amber-900 dark:text-amber-200/80">Your data lives only on this phone</span></p>
    <button class="min-h-10 flex-none rounded-full bg-amber-900 px-4 text-sm font-semibold text-amber-50 hover:bg-amber-950 dark:bg-amber-300/15 dark:text-amber-200 dark:hover:bg-amber-300/25" data-act="export">Back up</button></div>`;
  if(!all.length&&!m.budget.length&&!m.expenses.length) return h+`<div class="card">${empty('Nothing here yet','Start with your income, then share it out in Budget. Or restore a backup from More.')}
    <div class="px-4 pb-4"><button class="btn w-full" data-act="import">Restore a backup</button></div></div>`;
  const tone=rem===0?'tag-ok':rem>0?'tag-warn':'tag-bad';
  const lt=T.left===0?'tag-ok':T.left>0?'tag-warn':'tag-bad';
  h+=`<div class="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
    ${(()=>{const act=m.savings.filter(savActive), dn=act.filter(x=>x.done).length, addAll=act.filter(x=>x.cur!=='USD').reduce((t,x)=>t+x.add,0);
      return kpi('Total saved',fmt(T.balMvr),[T.balUsd?'+ '+fmt(T.balUsd,'USD'):'',act.length?`${dn}/${act.length} deposits done`:'No monthly deposit'].filter(Boolean).join(', '),act.length?pct(dn,act.length):null,'savings')})()}
    ${kpi('Fixed paid',fmt(fp),'of '+fmt(ft),pct(fp,ft),'fixed')}
    ${kpi('Spending',fmt(T.spent),T.plan?`of ${fmt(T.plan)} planned`:`${m.expenses.length} expense${m.expenses.length===1?'':'s'}`,T.plan?pct(T.spent,T.plan):null,'spending',T.spent>T.plan)}
    ${(()=>{const pb=potBalance(cur);return usesHouse(m)?kpi('House money',`<span class="${pb<0?'text-red-700 dark:text-red-300':''}">${pb<0?'−':''}${fmt(Math.abs(pb))}</span>`,`${m.gave.filter(x=>x.done).length}/${m.gave.length} paid in`,null,'house'):kpi('House money','—','Not sharing a house',null,'house')})()}
  </div>`;
  const todo=[]; for(const l of ['income','savings','fixed','bills','gave']) m[l].filter(x=>!x.done&&(l!=='savings'||savActive(x))&&!(l==='bills'&&isFlex(x))).forEach(x=>todo.push([l,x]));
  const rank=x=>{const d=dueInfo(x);return d?(d.lvl===3?-100+x.due:x.due):99};
  todo.sort((a,b)=>rank(a[1])-rank(b[1]));
  const overdue=todo.filter(([l,x])=>(dueInfo(x)||{}).lvl===3).length;
  h+=`<div class="card"><div class="card-h"><h3 class="card-t">Still to do</h3>${overdue?`<span class="tag tag-bad">${overdue} overdue</span>`:`<span class="meta">${todo.length?todo.length+' left':''}</span>`}</div>`;
  h+=todo.length?todo.map(([l,x])=>row(l,x,l==='savings'?esc(x.who)+', deposit':l==='income'?'Income · not received yet':LISTS[l])).join('')
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
  const todaySpent=cur===thisMonth?m.expenses.filter(e=>e.date===todayStr()).reduce((t,e)=>t+(isHouse(e)?myShare(e):e.amt),0):null;
  const stat=(l,v,go)=>`<button class="min-w-0 rounded-2xl bg-white/[.07] px-2.5 py-2.5 sm:px-3 big:flex big:items-center big:justify-between big:gap-3 big:px-3 text-left hover:bg-white/[.12]" data-act="go" data-to="${go}"><span class="block truncate text-[12.5px] text-teal-100/70">${l}</span><span class="block truncate text-[13.5px] font-semibold tracking-tight tabular-nums sm:text-base">${v}</span></button>`;
  return `<section class="mb-4 rounded-[30px] bg-lagoon px-5 pt-5 pb-5 text-white shadow-[0_24px_50px_-28px_rgba(6,48,43,.9)] ring-1 ring-white/5 md:px-7 md:pt-6 dark:bg-lagoon-2/60">
    <div class="flex items-start justify-between gap-3">
      <p class="text-sm text-teal-100/75">${T.inc?(neg?'Over your income by':'Left to plan this month'):'What’s left this month'}</p>
      ${neg&&T.inc?`<span class="tag bg-red-400/20 text-red-200">Over</span>`:T.inc&&left===0?`<span class="tag bg-reef/20 text-reef">All planned</span>`:''}
    </div>
    ${T.inc?`<p class="display mt-1 text-[46px] leading-none font-semibold tracking-tight tabular-nums md:text-[64px] ${neg?'text-red-200':''}"><span data-count="${Math.abs(left)}">${bigNum(Math.abs(left))}</span><span class="ml-1 text-[22px] font-medium text-teal-100/60 md:text-[28px]">MVR</span></p>`
      :`<p class="display mt-2 text-[28px] leading-tight font-semibold tracking-tight">Add your income to see<br>what’s left each month</p>
        <button class="btn mt-4 border-reef bg-reef text-teal-950 hover:bg-emerald-300" data-act="add" data-list="income">${IC.plus} Add income</button>`}
    <div class="mt-5 grid grid-cols-3 gap-2 big:grid-cols-1">
      ${stat('Income',fmt(T.inc),'budget')}
      ${stat('Planned out',fmt(T.alloc),'budget')}
      ${stat(todaySpent!==null?'Spent today':'Spent',fmt(todaySpent!==null?todaySpent:T.spent),'spending')}
    </div>
    ${total?`<div class="mt-5 flex items-end justify-between gap-4">${tallyMarks(done,total,animate)}<p class="shrink-0 pb-0.5 text-right text-[13px] text-teal-100/70"><span class="display block text-[22px] leading-none font-semibold text-white tabular-nums">${done}<span class="text-teal-100/70">/${total}</span></span>paid or received</p></div>`:''}
  </section>`;
}
function bigNum(v){const t=fmt(v).replace('/-',''), i=t.indexOf('.');return i<0?t:`${t.slice(0,i)}<span class="text-[0.55em] font-medium opacity-70">${t.slice(i)}</span>`}
function countUp(){
  const el=document.querySelector('[data-count]'); if(!el||el.dataset.done) return; el.dataset.done='1';
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const end=Number(el.dataset.count)||0, t0=performance.now(), dur=750;
  const step=t=>{const p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3); el.innerHTML=bigNum(Math.round(end*e*100)/100); if(p<1) requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
const KICON={
  'Total saved':['bg-teal-100 text-teal-800 dark:bg-teal-800/70 dark:text-reef','<path d="M19 7h-1V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M3 7h15"/><circle cx="16" cy="14" r="1.2"/>'],
  'Fixed paid':['bg-teal-100 text-teal-800 dark:bg-teal-800/70 dark:text-reef','<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>'],
  'Spending':['bg-teal-100 text-teal-800 dark:bg-teal-800/70 dark:text-reef','<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'],
  'House money':['bg-teal-100 text-teal-800 dark:bg-teal-800/70 dark:text-reef','<path d="M4 21V10l8-6 8 6v11"/><path d="M9 21v-5h6v5"/>']};
function kpi(l,v,s,p,go,over){
  const ic=KICON[l];
  return `<button class="flex flex-col justify-start rounded-[22px] border border-line bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(6,48,43,.04)] hover:border-teal-300 dark:border-teal-800/50 dark:bg-teal-900/35 dark:shadow-[inset_0_1px_0_rgba(255,255,255,.04)] dark:hover:border-teal-600" data-act="go" data-to="${go}">
    <div class="flex items-center gap-2">${ic?`<span class="grid size-7 place-items-center rounded-lg ${ic[0]}"><svg class="icon size-4" viewBox="0 0 24 24">${ic[1]}</svg></span>`:''}<span class="text-[13px] font-semibold ${MUTE}">${l}</span></div>
    <div class="display mt-2 text-[22px] leading-tight font-semibold tracking-tight tabular-nums">${v}</div>
    <div class="mt-1 text-[12.5px] leading-snug ${MUTE}">${s}</div>
    ${p!=null?`<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-mist dark:bg-teal-950" aria-hidden="true"><div class="h-full rounded-full transition-all ${over?'bg-red-500 dark:bg-red-400':'bg-teal-700 dark:bg-reef'}" style="width:${Math.min(100,p)}%"></div></div>`:''}</button>`;
}

function renderSavings(m){
  const T=totals(m), act=m.savings.filter(savActive), dn=act.filter(x=>x.done).length;
  const addMvr=act.filter(x=>x.cur!=='USD').reduce((t,x)=>t+x.add,0);
  let h=pageHead('Savings',`Total saved ${fmt(T.balMvr)}${T.balUsd?' and '+fmt(T.balUsd,'USD'):''}`,act.length?`<span class="tag ${dn===act.length?'tag-ok':'tag-warn'}">+${fmt(addMvr)} this month</span>`:'');
  if(!m.savings.length) return h+`<div class="card">${empty('No savings yet','Add each savings account with what’s in it now, and how much you add each month.')}${addBtn('savings')}</div>`;
  // growth across months (MVR balances at the end of each month)
  const keys=Object.keys(S.months).filter(k=>k<=cur).sort().slice(-6);
  const pts=keys.map(k=>({k,v:S.months[k].savings.filter(x=>x.cur!=='USD').reduce((t,x)=>t+savBal(x),0)}));
  const max=Math.max(1,...pts.map(p=>p.v));
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Growth</h3><span class="meta">${act.length?`${dn} of ${act.length} deposits done`:'Set a monthly deposit to see it grow'}</span></div>
    <div class="flex h-36 items-end gap-2 px-4 pt-2 pb-3" role="img" aria-label="Total saved by month">${pts.map(p=>`<div class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span class="text-[11.5px] font-semibold tabular-nums ${MUTE}">${PRIV?'•••':(p.v>=1000?Math.round(p.v/100)/10+'k':Math.round(p.v))}</span>
      <div class="w-full max-w-12 rounded-t-lg ${p.k===cur?'bg-teal-700 dark:bg-reef':'bg-teal-700/25 dark:bg-reef/30'}" style="height:${Math.max(4,p.v/max*84)}px"></div>
      <span class="text-[12px] ${p.k===cur?'font-semibold':MUTE}">${MS[+p.k.slice(5)-1]}</span></div>`).join('')}</div></section>`;
  const groups=[...new Set(m.savings.map(x=>x.who))];
  h+=`<div class="${GRID2}">`;
  groups.forEach(g=>{
    const it=m.savings.filter(x=>x.who===g);
    const sub=['MVR','USD'].map(c=>{const t=it.filter(x=>(x.cur||'MVR')===c).reduce((a,x)=>a+savBal(x),0);return t?fmt(t,c):''}).filter(Boolean).join(' + ');
    h+=`<section class="card"><div class="card-h"><h3 class="card-t">${esc(g)}</h3><span class="meta tabular-nums">${sub}</span></div>${it.map(x=>row('savings',x)).join('')}${addBtn('savings',g)}</section>`;
  });
  return h+`</div><p class="mx-1 mb-3 text-[13px] ${MUTE}">Tick an account when you’ve made this month’s deposit. Its balance goes up, and next month starts from the new total.</p>
    <button class="btn w-full" data-act="add" data-list="savings">${IC.plus} Add saving for someone new</button>`;
}
function renderHouse(m){
  const others=MEMBERS().filter(p=>!p.me).map(p=>p.name);
  const edit=`<button class="link-btn shrink-0" data-act="members">${hasHouse()?'Edit people':'Set up'}</button>`;
  let h=pageHead('House',hasHouse()?`Shared with ${others.map(esc).join(', ')}`:'Costs you share with the people you live with',edit);
  if(!usesHouse(m)) return h+`<div class="card">${empty('Living with others?','Add the people you live with. Then track what everyone pays in, the shared bills, and shopping for the house. Your budget only counts your part.')}
    <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="members">${IC.plus} Add people</button></div></div>`;
  const inM=potIn(m), outM=potOut(m), bal=potBalance(cur), carried=Math.round((bal-inM+outM)*100)/100;
  h+=`<section class="mb-4 rounded-[26px] bg-lagoon px-5 py-4 text-white dark:bg-lagoon-2/60">
    <p class="text-sm text-teal-100/75">${bal<0?'House money is short by':'House money now'}</p>
    <p class="display mt-0.5 text-[36px] leading-none font-semibold tracking-tight tabular-nums ${bal<0?'text-red-200':''}">${bigNum(Math.abs(bal))}<span class="ml-1 text-lg font-medium text-teal-100/60">MVR</span></p>
    <div class="mt-4 grid grid-cols-3 gap-2 big:grid-cols-1">${[['Paid in',fmt(inM)],['Paid out',fmt(outM)],['Carried over',fmt(carried)]].map(([l,v])=>`<div class="min-w-0 rounded-2xl bg-white/[.07] px-2.5 py-2 big:flex big:items-center big:justify-between big:gap-3 big:px-3"><span class="block truncate text-[12px] text-teal-100/70">${l}</span><span class="block truncate text-[13.5px] font-semibold tabular-nums">${v}</span></div>`).join('')}</div>
    <p class="mt-3 text-[12.5px] text-teal-100/60">Paid in = ticked payments below. Paid out = ticked bills and shopping paid with house money.</p></section>`;
  // pay-ins
  const gt=sum(m.gave), bt=sum(m.bills), gd=m.gave.filter(x=>x.done).length;
  h+=`<div class="${GRID2}"><section class="card"><div class="card-h"><h3 class="card-t">Paying in</h3><span class="meta">tick when received</span></div>
    ${m.gave.length?m.gave.map(x=>row('gave',x,(x.me?'<b class="font-semibold text-teal-700 dark:text-reef">You</b>':'')+(bt&&x.amt?(x.me?', ':'')+pct(x.amt,bt)+'% of bills':''))).join('')
      +`<div class="total"><span>Total <span class="font-medium ${MUTE}">${gd}/${m.gave.length} paid</span></span><span class="tabular-nums">${fmt(gt)}</span></div>`
      :empty('Nobody added yet','Tap Edit people to add who pays in.')}
    <button class="add-btn" data-act="members">${IC.plus} Add or edit people</button></section>`;
  const fixedB=m.bills.filter(x=>!isFlex(x)), flexB=m.bills.filter(isFlex), fd=fixedB.filter(x=>x.done).length;
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Shared bills</h3>${fixedB.length?`<button class="link-btn" data-act="all" data-list="bills">${fd===fixedB.length?'Untick all':'Tick all'}</button>`:''}</div>
    ${fixedB.map(x=>row('bills',x)).join('')}
    ${flexB.map((x,i)=>{const plan=Number(x.amt)||0, sp=houseSpentOn(m,x.label), left=plan-sp, over=left<0;
      return `<div class="flex items-center gap-2 border-b border-line px-4 dark:border-teal-800/60">
        <button class="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 text-left" data-act="edit" data-list="bills" data-id="${esc(x.id)}">
          <span class="flex w-full items-center gap-2"><span class="min-w-0 flex-1 truncate">${esc(x.label)}</span><span class="font-semibold tabular-nums">${fmt(plan)}</span></span>
          <span class="h-1.5 w-full overflow-hidden rounded-full bg-mist dark:bg-teal-950"><span class="block h-full rounded-full ${over?'bg-red-500 dark:bg-red-400':'bg-teal-700 dark:bg-reef'}" style="width:${Math.min(100,pct(sp,plan||sp||1))}%"></span></span>
          <span class="flex w-full justify-between text-[12.5px] tabular-nums ${MUTE}"><span>Spend as you go, ${fmt(sp)} spent</span><span class="${over?'font-semibold text-red-700 dark:text-red-300':''}">${over?fmt(-left)+' over':fmt(left)+' left'}</span></span></button>
        <button class="grid size-11 flex-none place-items-center rounded-xl border border-line text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-reef dark:hover:bg-teal-800" data-act="addexp" data-scope="house" data-cat="${esc(x.label)}" aria-label="Add ${esc(x.label)} shopping">${IC.spend}</button></div>`}).join('')}
    ${m.bills.length?`<div class="total"><span>Total</span><span class="tabular-nums">${fmt(bt)}</span></div>`:empty('No shared bills yet','Rent, electric, water, internet… and shared budgets like Food.')}
    ${addBtn('bills')}</section></div>`;
  if(bt&&gt&&Math.abs(gt-bt)>0.004) h+=`<p class="-mt-2 mx-1 mb-4 text-[13px] ${gt>bt?MUTE:'font-semibold text-red-700 dark:text-red-300'}">${gt>bt?`Pay-ins are ${fmt(gt-bt)} more than the bills. It stays in house money for shopping.`:`Pay-ins are ${fmt(bt-gt)} short of the bills.`}</p>`;
  // shared shopping
  const hx=m.expenses.filter(isHouse).slice().sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Shopping for the house</h3><span class="meta tabular-nums">${hx.length?fmt(hx.reduce((t,e)=>t+e.amt,0)):''}</span></div>
    ${hx.length?hx.map(e=>`<button class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2 text-left dark:border-teal-800/60" data-act="editexp" data-id="${esc(e.id)}">
        <span class="size-2.5 flex-none rounded-full" style="background:${m.bills.some(b=>isFlex(b)&&b.label===e.cat)?'#0f766e':OTHER_COLOR}"></span>
        <span class="min-w-0 flex-1 truncate">${esc(e.note||e.cat)}<span class="block text-[12.5px] ${MUTE}">${e.note&&e.cat!=='Other'?esc(e.cat)+', ':''}${dayLabel(e.date)}, ${isFundExp(e)?'paid with house money':'paid by '+esc(houseName(e.paidBy))+(e.split.length===MEMBERS().length?', split between everyone':', split '+e.split.map(houseName).map(esc).join(', '))}</span></span>
        <span class="text-right"><span class="block font-semibold tabular-nums">${fmt(e.amt)}</span>${myShare(e)?`<span class="block text-[12px] tabular-nums ${MUTE}">you ${fmt(Math.round(myShare(e)*100)/100)}</span>`:''}</span>${IC.chev}</button>`).join('')
      :empty('No shopping yet','Fish, vegetables, cleaning things… add them here.')}
    <button class="add-btn" data-act="addexp" data-scope="house">${IC.plus} Add shopping</button></section>`;
  // who owes whom (only when a person paid for something)
  const anyPersonal=Object.keys(S.months).some(k=>S.months[k].expenses.some(e=>isHouse(e)&&!isFundExp(e))||(S.months[k].settles||[]).length);
  if(hasHouse()&&anyPersonal){ const net=balances(), plan2=settlements(net);
    h+=`<section class="card"><div class="card-h"><h3 class="card-t">Who owes whom</h3><span class="meta">from shopping someone paid for</span></div>
      ${plan2.length?plan2.map(t=>`<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 dark:border-teal-800/60">
        <span class="flex-1"><b class="font-semibold">${esc(houseName(t.from))}</b> pay${t.from===ME()?'':'s'} <b class="font-semibold">${esc(houseName(t.to))}</b><span class="block text-sm tabular-nums ${MUTE}">${fmt(t.amt)}</span></span>
        <button class="btn min-h-10 px-4" data-act="settle" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amt="${t.amt}">Settle</button></div>`).join('')
        :`<p class="px-4 pb-4 text-sm ${MUTE}">Everyone is settled up.</p>`}</section>`; }
  return h;
}
function renderBills(m){
  const t=sum(m.fixed),p=sum(m.fixed,x=>x.done);
  const bt=sum(m.bills),gt=sum(m.gave),rem=gt-bt;
  const st=rem===0?['tag-ok','Covered']:rem>0?['tag-warn','+'+fmt(rem)+' extra']:['tag-bad',fmt(-rem)+' short'];
  let h=pageHead('Bills',`Fixed: ${fmt(p)} paid of ${fmt(t)}`);
  h+=listCard('fixed',m.fixed,'Fixed expenses',fmt(t));
  h+=`<div class="mx-0.5 mt-6 mb-3 flex items-end justify-between gap-2"><div><h2 class="text-lg font-bold">Shared house bills</h2><p class="text-sm ${MUTE}">Split between people · only the share marked <b class="font-semibold">You</b> counts in your budget</p></div>${bt?`<span class="tag ${st[0]} shrink-0 whitespace-nowrap">${st[1]}</span>`:''}</div>`;
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
  const segs=[{l:'Savings deposits',v:T.sav,c:'#0f766e'},{l:'Fixed bills',v:T.fix,c:'#0369a1'}]
    .concat(T.houseSet||T.houseUse?[{l:'House',v:T.house+T.houseUse,c:'#b45309'}]:[])
    .concat(m.budget.map((x,i)=>({l:x.label,v:Math.max(Number(x.amt)||0,spentOn(m,x.label)),c:PALETTE[(i+2)%PALETTE.length]})))
    .concat(T.unplanned?[{l:'Unplanned spending',v:T.unplanned,c:OTHER_COLOR}]:[])
    ;
  const base=Math.max(T.inc,T.alloc)||1;
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Where it goes</h3><span class="meta tabular-nums">${T.inc?pct(T.alloc,T.inc)+'% of income':''}</span></div>
    <div class="px-4 pt-4"><div class="flex h-4 overflow-hidden rounded-full bg-mist dark:bg-teal-950" role="img" aria-label="Budget split">${segs.filter(g=>g.v>0).map(g=>`<div style="width:${g.v/base*100}%;background:${g.c}" title="${esc(g.l)}"></div>`).join('')}</div></div>
    <ul class="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 text-sm sm:grid-cols-2">${segs.map(g=>`<li class="flex items-center gap-2"><span class="size-2.5 flex-none rounded-full" style="background:${g.c}"></span><span class="min-w-0 flex-1 truncate">${esc(g.l)}</span><span class="tabular-nums ${MUTE}">${fmt(g.v)}${T.inc?` · ${pct(g.v,T.inc)}%`:''}</span></li>`).join('')}
      ${T.inc?`<li class="flex items-center gap-2"><span class="size-2.5 flex-none rounded-full border-2 border-teal-900/25 dark:border-teal-700"></span><span class="flex-1">${T.left<0?'Over income':'Not assigned'}</span><span class="tabular-nums ${T.left<0?'text-red-700 dark:text-red-300':MUTE}">${fmt(Math.abs(T.left))}</span></li>`:''}</ul>
    ${T.usd?`<p class="px-4 pb-3 text-[12.5px] ${MUTE}">USD deposits (${fmt(T.usd,'USD')}) are not counted here because they're in a different currency.</p>`:''}
  </section></div>`;
  // Plan
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Plan</h3><span class="meta">tap + to add an expense</span></div>
    ${(()=>{const n=m.savings.filter(x=>savActive(x)&&!x.ext).length;return linkRow('Savings deposits',T.sav,T.inc,'savings',n?`${n} deposit${n===1?'':'s'} this month, from Savings tab`:'No deposits set. Balances are not deducted')})()}
    ${linkRow('Fixed bills',T.fix,T.inc,'fixed',`${m.fixed.length} bill${m.fixed.length===1?'':'s'}, listed below`)}
    ${T.houseSet||T.houseUse?linkRow('House',T.house+T.houseUse,T.inc,'house',[T.houseSet?`You pay in ${fmt(T.house)}`:'',T.houseUse?`your share of shopping ${fmt(Math.round(T.houseUse*100)/100)}`:''].filter(Boolean).join(', '))
      :usesHouse(m)?`<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="go" data-to="house">
        <span class="min-w-0 flex-1">House<span class="block text-[12.5px] text-amber-700 dark:text-amber-300">Not counted yet. Open House and mark which person is you</span></span>
        <span class="font-semibold tabular-nums ${MUTE}">—</span>${IC.chev}</button></div>`:''}
    ${m.budget.map((x,i)=>envRow(m,x,T.inc,PALETTE[(i+2)%PALETTE.length])).join('')}
    ${T.unplanned?`<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="filter" data-cat="__other">
      <span class="size-2.5 flex-none rounded-full" style="background:${OTHER_COLOR}"></span><span class="min-w-0 flex-1">Unplanned spending<span class="block text-[12.5px] ${MUTE}">Expenses without a category in this plan</span></span>
      <span class="font-semibold tabular-nums">${fmt(T.unplanned)}</span>${IC.chev}</button></div>`:''}
    ${!m.budget.length?`<div class="px-4 py-3"><p class="mb-2 text-sm ${MUTE}">Add spending categories to plan the rest. Quick picks:</p><div class="flex flex-wrap gap-1.5">${['Groceries','Transport','Eating out','Personal','Charity','Emergency fund','Gifts'].map(c=>`<button class="${CHIP}" data-act="add" data-list="budget" data-label="${c}">${c}</button>`).join('')}</div></div>`:''}
    <div class="total"><span>Total planned</span><span class="tabular-nums">${fmt(T.alloc)}</span></div>
    ${T.inc?`<div class="flex items-center justify-between border-t border-line px-4 py-3 font-bold dark:border-teal-800/60"><span>${T.left<0?'Over income':'Left to assign'}</span><span class="tag ${lt[0]} text-[15px]!">${T.left<0?'−':''}${fmt(Math.abs(T.left))}</span></div>`:''}
    ${addBtn('budget')}</section>`;
  const ft=sum(m.fixed), fp=sum(m.fixed,x=>x.done);
  h+=`<div id="fixedcard" class="scroll-mt-20">${listCard('fixed',m.fixed,'Fixed bills',fmt(ft))}</div>
    <p class="-mt-2 mx-1 mb-4 text-[13px] ${MUTE}">Your own monthly bills, such as phone, course fee or school. Shared house bills go under House. ${ft?`${fmt(fp)} of ${fmt(ft)} paid.`:''}</p>`;
  return h;
}
let spendMode='me';
function modeSwitch(){
  return `<div class="mb-4 grid grid-cols-2 gap-1 rounded-full bg-white p-1 ring-1 ring-line dark:bg-teal-900/50 dark:ring-teal-800/70" role="tablist" aria-label="Whose spending">
    ${[['me','Personal'],['house','Household']].map(([v,l])=>`<button role="tab" aria-selected="${spendMode===v}" data-act="mode" data-v="${v}" class="min-h-10 rounded-full text-[14.5px] font-semibold text-[#4a6964] aria-selected:bg-teal-800 aria-selected:text-white dark:text-teal-200/70 dark:aria-selected:bg-reef dark:aria-selected:text-teal-950">${l}</button>`).join('')}</div>`;
}
function renderSpending(m){
  const T=totals(m), ex=m.expenses.filter(e=>!isHouse(e));
  const today=todayStr(), wk=ymd(new Date(Date.now()-6*864e5));
  const isNow=cur===thisMonth;
  const todayAmt=ex.filter(e=>e.date===today).reduce((t,e)=>t+e.amt,0);
  const weekAmt=ex.filter(e=>e.date>=wk&&e.date<=today).reduce((t,e)=>t+e.amt,0);
  const [y,mo]=cur.split('-').map(Number), dim=new Date(y,mo,0).getDate();
  const daysSoFar=isNow?new Date().getDate():dim;
  let h=pageHead('Spending',ex.length?`${ex.length} personal expense${ex.length===1?'':'s'} in ${MN[mo-1]}`:'Every rufiyaa you spend, day by day');
  h+=`<div class="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    ${isNow?statBox('Today',fmt(todayAmt)):''}
    ${isNow?statBox('Last 7 days',fmt(weekAmt)):''}
    ${statBox('This month',fmt(T.persSpent),T.plan?`of ${fmt(T.plan)} planned`:'')}
    ${statBox('Daily average',fmt(Math.round(T.persSpent/Math.max(1,daysSoFar))),`over ${daysSoFar} day${daysSoFar===1?'':'s'}`)}
  </div>`;
  if(!ex.length) return h+`<div class="card">${empty('No personal expenses yet','Tap + whenever you spend: a coffee, fuel, a phone top-up. Shopping for the house goes under House.')}
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
      ${items.map(e=>`<button class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 dark:border-teal-800/60" data-act="editexp" data-id="${esc(e.id)}">
        <span class="size-2.5 flex-none rounded-full" style="background:${catColor(m,e.cat)}"></span>
        <span class="min-w-0 flex-1 truncate">${esc(e.note||e.cat)}${e.note?`<span class="block text-[12.5px] ${MUTE}">${esc(e.cat)}</span>`:''}</span>
        <span class="font-semibold tabular-nums">${fmt(e.amt)}</span>${IC.chev}</button>`).join('')}</section>`}).join('');
  return h;
}
function renderHousehold(m){
  if(FUND()) return renderFund(m);
  let h=pageHead('Household','Shared spending with the people you live with')+modeSwitch();
  if(!hasHouse()) return h+`<div class="card">${empty('Share expenses with housemates','Add the people you live with. Then each shared purchase is split, and Tally shows who owes whom.')}
    <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="members">${IC.plus} Set up household</button></div></div>`;
  const T=totals(m), hx=m.expenses.filter(isHouse), plan=Number(m.housePlan)||0;
  h+=`<div class="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
    ${statBox('Shared this month',fmt(T.houseSpent),plan?`of ${fmt(plan)} budget`:`${hx.length} purchase${hx.length===1?'':'s'}`)}
    ${statBox('Your share',fmt(T.houseMine),`${MEMBERS().length} people`)}
  </div>`;
  if(plan){ const p=pct(T.houseSpent,plan), over=T.houseSpent>plan;
    h+=`<div class="mb-4 -mt-1 px-1"><div class="h-2 overflow-hidden rounded-full bg-white ring-1 ring-line dark:bg-teal-950 dark:ring-teal-800/60"><div class="h-full rounded-full ${over?'bg-red-500 dark:bg-red-400':'bg-teal-700 dark:bg-reef'}" style="width:${Math.min(100,p)}%"></div></div>
      <p class="mt-1.5 text-[13px] ${over?'font-semibold text-red-700 dark:text-red-300':MUTE}">${over?`${fmt(T.houseSpent-plan)} over the household budget`:`${fmt(plan-T.houseSpent)} left in the household budget`}</p></div>`; }
  // balances (all time)
  const net=balances(), plan2=settlements(net);
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Balances</h3><button class="link-btn" data-act="members">Edit people</button></div>
    ${MEMBERS().map(p=>{const v=net[p.name]||0;return `<div class="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 dark:border-teal-800/60">
      <span class="grid size-8 flex-none place-items-center rounded-full bg-teal-100 text-[13px] font-bold text-teal-800 dark:bg-teal-800 dark:text-reef">${esc(p.name.slice(0,1).toUpperCase())}</span>
      <span class="flex-1">${esc(houseName(p.name))}</span>
      <span class="text-sm font-semibold tabular-nums ${v>0.004?'text-teal-700 dark:text-reef':v<-0.004?'text-red-700 dark:text-red-300':MUTE}">${v>0.004?'gets back '+fmt(v):v<-0.004?'owes '+fmt(-v):'settled'}</span></div>`}).join('')}
    ${plan2.length?`<div class="px-4 pt-3 pb-1 text-[13px] font-semibold ${MUTE}">To settle up</div>${plan2.map(t=>`<div class="flex min-h-14 items-center gap-3 px-4 py-2">
      <span class="flex-1"><b class="font-semibold">${esc(houseName(t.from))}</b> pay${t.from===ME()?'':'s'} <b class="font-semibold">${esc(houseName(t.to))}</b><span class="block text-sm tabular-nums ${MUTE}">${fmt(t.amt)}</span></span>
      <button class="btn min-h-10 px-4" data-act="settle" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amt="${t.amt}">Settle</button></div>`).join('')}`
      :`<p class="px-4 py-3 text-sm ${MUTE}">Everyone is settled up.</p>`}
  </section>`;
  if(!hx.length&&!(m.settles||[]).length) return h+`<div class="card">${empty('No shared purchases this month','Tap “+ Expense” and choose Household. Pick who paid and who shares it.')}
    <div class="px-4 pb-4"><button class="btn btn-pri w-full" data-act="addexp" data-scope="house">${IC.plus} Add shared expense</button></div></div>`;
  const items=[...hx.map(e=>({k:'e',d:e.date,e})),...(m.settles||[]).map(t=>({k:'s',d:t.date,t}))].sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:0);
  const days=[...new Set(items.map(i=>i.d))];
  h+=days.map(d=>{const its=items.filter(i=>i.d===d), dt=its.filter(i=>i.k==='e').reduce((t,i)=>t+i.e.amt,0);
    return `<section class="card"><div class="card-h py-2.5"><h3 class="text-sm font-bold">${dayLabel(d)}</h3><span class="text-sm font-semibold tabular-nums">${dt?fmt(dt):''}</span></div>
      ${its.map(i=>i.k==='e'?`<button class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 dark:border-teal-800/60" data-act="editexp" data-id="${esc(i.e.id)}">
        <span class="size-2.5 flex-none rounded-full" style="background:${catColor(m,i.e.cat)}"></span>
        <span class="min-w-0 flex-1 truncate">${esc(i.e.note||i.e.cat)}<span class="block text-[12.5px] ${MUTE}">Paid by ${esc(houseName(i.e.paidBy))}, split ${i.e.split.length===MEMBERS().length?'between everyone':i.e.split.map(houseName).map(esc).join(', ')}</span></span>
        <span class="text-right"><span class="block font-semibold tabular-nums">${fmt(i.e.amt)}</span>${myShare(i.e)?`<span class="block text-[12px] tabular-nums ${MUTE}">you ${fmt(Math.round(myShare(i.e)*100)/100)}</span>`:''}</span>${IC.chev}</button>`
      :`<div class="flex min-h-12 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 dark:border-teal-800/60">
        <span class="grid size-2.5 flex-none place-items-center"></span><span class="flex-1 text-sm">${esc(houseName(i.t.from))} paid ${esc(houseName(i.t.to))}<span class="block text-[12.5px] ${MUTE}">Settled up</span></span>
        <span class="text-sm font-semibold tabular-nums ${MUTE}">${fmt(i.t.amt)}</span>
        <button class="grid size-9 place-items-center rounded-full ${MUTE} hover:bg-mist dark:hover:bg-teal-800" data-act="unsettle" data-id="${esc(i.t.id)}" aria-label="Remove this settlement"><svg class="icon size-4" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('')}</section>`}).join('');
  return h;
}
function renderFund(m){
  const T=totals(m), mgr=FUND_MGR(), n=MEMBERS().length, target=Number(m.housePlan)||0, each=target?Math.round(target/n*100)/100:0;
  const ins=m.fundIns||[], collected=ins.reduce((t,x)=>t+x.amt,0), fx=m.expenses.filter(isFundExp), spent=fx.reduce((t,e)=>t+e.amt,0);
  const bal=fundBalance(cur), carried=Math.round((bal-collected+spent)*100)/100;
  let h=pageHead('Household fund',`Managed by ${esc(houseName(mgr))}`)+modeSwitch();
  h+=`<section class="mb-4 rounded-[26px] bg-lagoon px-5 py-4 text-white dark:bg-lagoon-2/60">
    <p class="text-sm text-teal-100/75">${bal<0?'Fund is short by':'In the fund now'}</p>
    <p class="display mt-0.5 text-[36px] leading-none font-semibold tracking-tight tabular-nums ${bal<0?'text-red-200':''}">${bigNum(Math.abs(bal))}<span class="ml-1 text-lg font-medium text-teal-100/60">MVR</span></p>
    <div class="mt-4 grid grid-cols-3 gap-2 text-left">
      ${[['Collected',fmt(collected)],['Spent',fmt(spent)],['Carried over',fmt(carried)]].map(([l,v])=>`<div class="min-w-0 rounded-2xl bg-white/[.07] px-2.5 py-2 big:flex big:items-center big:justify-between big:gap-3 big:px-3"><span class="block truncate text-[12px] text-teal-100/70">${l}</span><span class="block truncate text-[13.5px] font-semibold tabular-nums">${v}</span></div>`).join('')}
    </div></section>`;
  // contributions this month
  h+=`<section class="card"><div class="card-h"><h3 class="card-t">Paid in this month</h3><button class="link-btn" data-act="members">${target?`Target ${fmt(each)} each`:'Set target'}</button></div>
    ${MEMBERS().map(p=>{const paid=ins.filter(x=>x.from===p.name).reduce((t,x)=>t+x.amt,0), due=each?Math.max(0,each-paid):0, done=each?paid>=each-0.004:paid>0;
      return `<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 dark:border-teal-800/60">
        <span class="grid size-8 flex-none place-items-center rounded-full ${done?'bg-teal-700 text-white dark:bg-reef dark:text-teal-950':'bg-teal-100 text-teal-800 dark:bg-teal-800 dark:text-reef'} text-[13px] font-bold">${done?'✓':esc(p.name.slice(0,1).toUpperCase())}</span>
        <span class="min-w-0 flex-1">${esc(houseName(p.name))}${p.name===mgr?` <span class="tag tag-ok ml-1">Manager</span>`:''}<span class="block text-[12.5px] tabular-nums ${due&&!done?'font-semibold text-amber-700 dark:text-amber-300':MUTE}">${fmt(paid)} paid${each?(done?'':`, ${fmt(due)} to go`):''}</span></span>
        <button class="btn min-h-10 px-4" data-act="fundin" data-from="${esc(p.name)}" data-amt="${due||''}">${IC.plus} Add</button></div>`}).join('')}
  </section>`;
  const items=[...fx.map(e=>({k:'e',d:e.date,e})),...ins.map(x=>({k:'i',d:x.date,x})),...m.expenses.filter(e=>isHouse(e)&&!isFundExp(e)).map(e=>({k:'e',d:e.date,e}))]
    .sort((a,b)=>a.d<b.d?1:a.d>b.d?-1:0);
  if(!items.length) return h+`<div class="card">${empty('Nothing in the fund yet','Record what each person pays in, then add shared purchases with “+ Expense” → Household.')}</div>`;
  const days=[...new Set(items.map(i=>i.d))];
  h+=`<h3 class="mx-1 mt-6 mb-3 text-lg font-semibold tracking-tight">Activity</h3>`;
  h+=days.map(d=>{const its=items.filter(i=>i.d===d);
    return `<section class="card"><div class="card-h py-2.5"><h3 class="text-sm font-bold">${dayLabel(d)}</h3></div>
      ${its.map(i=>i.k==='e'?`<button class="flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2 text-left last:border-b-0 dark:border-teal-800/60" data-act="editexp" data-id="${esc(i.e.id)}">
          <span class="size-2.5 flex-none rounded-full" style="background:${catColor(m,i.e.cat)}"></span>
          <span class="min-w-0 flex-1 truncate">${esc(i.e.note||i.e.cat)}<span class="block text-[12.5px] ${MUTE}">${isFundExp(i.e)?'Paid from the fund':'Paid by '+esc(houseName(i.e.paidBy))}</span></span>
          <span class="font-semibold tabular-nums">−${fmt(i.e.amt)}</span>${IC.chev}</button>`
        :`<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 dark:border-teal-800/60">
          <span class="size-2.5 flex-none rounded-full bg-teal-600 dark:bg-reef"></span>
          <span class="min-w-0 flex-1">From ${esc(houseName(i.x.from))}<span class="block text-[12.5px] ${MUTE}">Paid into the fund</span></span>
          <span class="font-semibold tabular-nums text-teal-700 dark:text-reef">+${fmt(i.x.amt)}</span>
          <button class="grid size-9 place-items-center rounded-full ${MUTE} hover:bg-mist dark:hover:bg-teal-800" data-act="unfund" data-id="${esc(i.x.id)}" aria-label="Remove this payment"><svg class="icon size-4" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('')}</section>`}).join('');
  return h;
}
function statBox(l,v,s=''){return `<div class="rounded-[22px] border border-line bg-white px-4 py-3.5 shadow-sm dark:border-teal-800/50 dark:bg-teal-900/35 dark:shadow-none"><div class="text-[13px] font-semibold ${MUTE}">${l}</div><div class="display mt-0.5 text-[22px] font-semibold tracking-tight tabular-nums">${v}</div>${s?`<div class="mt-0.5 text-[12.5px] ${MUTE}">${s}</div>`:''}</div>`}

function linkRow(label,v,inc,go,sub){
  return `<div class="border-b border-line px-4 dark:border-teal-800/60"><button class="flex min-h-14 w-full items-center gap-2.5 py-2 text-left" data-act="go" data-to="${go}">
    <span class="min-w-0 flex-1">${label}<span class="block text-[12.5px] ${MUTE}">${sub}</span></span>
    <span class="text-right"><span class="block font-semibold tabular-nums">${fmt(v)}</span>${inc?`<span class="block text-[12.5px] tabular-nums ${MUTE}">${pct(v,inc)}%</span>`:''}</span>${IC.chev}</button></div>`;
}
function envRow(m,x,inc,color){
  const plan=Number(x.amt)||0, spent=spentOn(m,x.label), left=plan-spent, over=left<0;
  return `<div class="flex items-center gap-2 border-b border-line px-4 dark:border-teal-800/60">
    <button class="flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 text-left" data-act="edit" data-list="budget" data-id="${esc(x.id)}">
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
const MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dueInfo(x,monthKey=cur){
  if(!x.due) return null;
  const [y,mo]=monthKey.split('-').map(Number), day=Math.min(x.due,new Date(y,mo,0).getDate()), when=`${day} ${MS[mo-1]}`;
  if(x.done) return {lvl:0,txt:`Due ${when}`};
  if(monthKey<thisMonth) return {lvl:3,txt:`Overdue, was due ${when}`};
  if(monthKey>thisMonth) return {lvl:0,txt:`Due ${when}`};
  const diff=day-new Date().getDate();
  if(diff<0) return {lvl:3,txt:`Overdue, was due ${when}`};
  if(diff===0) return {lvl:2,txt:'Due today'};
  if(diff<=3) return {lvl:1,txt:`Due in ${diff} day${diff===1?'':'s'}`};
  return {lvl:0,txt:`Due ${when}`};
}
const DUE_CLS=['','text-amber-700 dark:text-amber-300 font-semibold','text-amber-700 dark:text-amber-300 font-semibold','text-red-700 dark:text-red-300 font-semibold'];
function row(list,x,sub=''){
  const isSav=list==='savings', canTick=!isSav||savActive(x);
  const di=canTick?dueInfo(x):null; if(di) sub=`<span class="${DUE_CLS[di.lvl]}">${di.txt}</span>${sub?', '+sub:''}`;
  if(isSav) sub=`Saved ${fmt(savBal(x),x.cur)}${x.ext?', not from your income':''}${sub?'. '+sub:''}`;
  const amtTxt=isSav?(savActive(x)?'+'+fmt(x.add,x.cur):'<span class="font-normal '+MUTE+'">No deposit</span>'):fmt(x.amt,x.cur);
  const doneTxt=x.done?'text-[#557570] dark:text-teal-100/60':'';
  return `<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0 dark:border-teal-800/60">
    ${!canTick?'<span class="-my-1 -mr-1.5 -ml-2.5 grid size-12 flex-none place-items-center"><span class="size-[26px] rounded-full border-2 border-dashed border-teal-900/20 dark:border-teal-400/25"></span></span>':''}<button class="group -my-1 -mr-1.5 -ml-2.5 ${canTick?'grid':'hidden'} size-12 flex-none place-items-center rounded-xl" role="checkbox" aria-checked="${!!x.done}" data-act="tog" data-list="${list}" data-id="${esc(x.id)}" aria-label="${esc(x.label)}">
      <span class="grid size-[26px] place-items-center rounded-full border-2 border-teal-900/30 text-white transition-colors group-aria-checked:border-teal-800 group-aria-checked:bg-teal-800 dark:border-teal-400/60 dark:text-teal-950 dark:group-aria-checked:border-reef dark:group-aria-checked:bg-reef"><span class="opacity-0 group-aria-checked:opacity-100">${IC.tick}</span></span></button>
    <button class="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left" data-act="edit" data-list="${list}" data-id="${esc(x.id)}">
      <span class="min-w-0 flex-1 truncate"><span class="${doneTxt} ${x.done?'line-through decoration-teal-900/25 dark:decoration-teal-600':''}">${esc(x.label)}</span>${sub?`<span class="block text-[12.5px] ${MUTE}">${sub}</span>`:''}</span>
      <span class="whitespace-nowrap font-semibold tabular-nums ${doneTxt}">${amtTxt}</span>${IC.chev}</button></div>`;
}

function renderMore(){
  const th=store.get(THEME)||'system', lb=+store.get(BKP)||0;
  const setrow=(t,s,btn)=>`<div class="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 dark:border-teal-800/60"><div class="flex-1">${t}<span class="block text-[12.5px] ${MUTE}">${s}</span></div>${btn}</div>`;
  const al=store.get(AUTOLOCK)||'60';
  const sec=`<section class="card"><div class="card-h"><h3 class="card-t">Security</h3>${encMeta?'<span class="tag tag-ok">Encrypted</span>':''}</div>
    ${encMeta?setrow('PIN lock','On. Your data is encrypted on this phone',`<div class="flex gap-1.5"><button class="btn px-4" data-act="pinchange">Change</button><button class="btn btn-danger px-4" data-act="pinoff">Turn off</button></div>`)
      :setrow('PIN lock','Off. Anyone using your phone can open Tally','<button class="btn btn-pri" data-act="pinset">Set PIN</button>')}
    ${encMeta?`<div class="border-b border-line px-4 py-3 dark:border-teal-800/60"><div class="mb-2">Auto-lock<span class="block text-[12.5px] ${MUTE}">After leaving the app, or when idle</span></div>
      <div class="grid grid-cols-4 gap-1 rounded-xl bg-mist p-1 dark:bg-teal-950" role="group" aria-label="Auto-lock">${[['0','Instantly'],['60','1 min'],['300','5 min'],['900','15 min']].map(([v,l])=>`<button data-act="autolock" data-v="${v}" aria-pressed="${al===v}" class="min-h-10 rounded-lg text-sm font-semibold ${MUTE} aria-pressed:bg-white aria-pressed:text-teal-950 aria-pressed:shadow-sm dark:aria-pressed:bg-teal-700 dark:aria-pressed:text-white">${l}</button>`).join('')}</div></div>`:''}
    ${setrow('Hide amounts','Show •••• instead of numbers. Also the eye button at the top',`<button role="switch" aria-checked="${PRIV}" aria-label="Hide amounts" data-act="hide" class="relative h-8 w-14 flex-none rounded-full bg-teal-900/15 transition-colors aria-checked:bg-teal-700 dark:bg-teal-700/60 dark:aria-checked:bg-reef"><span class="absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform ${PRIV?'translate-x-6':''}"></span></button>`)}
    ${encMeta?setrow('Lock now','Close Tally behind your PIN','<button class="btn" data-act="locknow">Lock</button>'):''}
  </section>`;
  return pageHead('More','Security, appearance and backup')+`<div class="${GRID2}"><div>${sec}
  <section class="card"><div class="card-h"><h3 class="card-t">Appearance</h3></div>
    <div class="mx-4 mt-3 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1 dark:bg-teal-950" role="group" aria-label="Theme">${['system','light','dark'].map(t=>`<button data-act="theme" data-v="${t}" aria-pressed="${th===t}" class="min-h-10 rounded-lg text-sm font-semibold ${MUTE} aria-pressed:bg-white aria-pressed:text-teal-950 aria-pressed:shadow-sm dark:aria-pressed:bg-teal-700 dark:aria-pressed:text-white">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}</div>
    <p class="mx-4 mt-2 mb-3 text-[13px] ${MUTE}">“System” follows your phone's light/dark setting.</p>
    <div class="border-t border-line px-4 py-3 dark:border-teal-800/60"><div id="tslabel" class="mb-2">Text size</div>
      <div class="grid grid-cols-3 gap-1 rounded-xl bg-mist p-1 dark:bg-teal-950" role="group" aria-labelledby="tslabel">${[['100','Normal'],['115','Large'],['130','Larger']].map(([v,l])=>`<button data-act="textsize" data-v="${v}" aria-pressed="${(store.get('tally-text')||'100')===v}" class="min-h-11 rounded-lg font-semibold ${MUTE} aria-pressed:bg-white aria-pressed:text-teal-950 aria-pressed:shadow-sm dark:aria-pressed:bg-teal-700 dark:aria-pressed:text-white" style="font-size:${v==='100'?14:v==='115'?16:18}px">${l}</button>`).join('')}</div></div>
    ${setrow('High contrast','Darker text and stronger lines. Easier to read',`<button role="switch" aria-checked="${store.get('tally-contrast')==='high'}" aria-label="High contrast" data-act="contrast" class="relative h-8 w-14 flex-none rounded-full bg-teal-900/15 transition-colors aria-checked:bg-teal-700 dark:bg-teal-700/60 dark:aria-checked:bg-reef"><span class="absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform ${store.get('tally-contrast')==='high'?'translate-x-6':''}"></span></button>`)}
    ${store.get('tally-guide')==='hidden'?setrow('Get started guide','Show the setup checklist on Home again','<button class="btn" data-act="guideshow">Show</button>'):''}
  </section>
  <section class="card"><div class="card-h"><h3 class="card-t">Backup</h3><span class="meta">${lb?'Last: '+new Date(lb).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Never backed up'}</span></div>
    ${setrow('Save backup file','Protected with a password you choose','<button class="btn" data-act="export">Save</button>')}
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
  clearTimeout(tTimer); tTimer=setTimeout(hideToast,undo?10000:4000);
}
$('toast').addEventListener('pointerenter',()=>clearTimeout(tTimer)); $('toast').addEventListener('focusin',()=>clearTimeout(tTimer));
$('toast').addEventListener('pointerleave',()=>{clearTimeout(tTimer);tTimer=setTimeout(hideToast,4000)});
function hideToast(){ const t=$('toast'); t.classList.add('hidden'); t.classList.remove('flex'); undoFn=null; }
$('tbtn').onclick=()=>{ const f=undoFn; hideToast(); if(f) f(); };
function snapshot(){ const before=JSON.stringify(S); return ()=>{ if(LOCKED) return; S=JSON.parse(before); save(); render(); toast('Undone'); }; }

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
    :c.item?'Change the details, or delete with the bin.':isSav?'What’s in the account now, and how much you add each month.':L==='income'?'Salary, allowance, rent received, side income…':isBud?'How much you plan to spend on this each month.':'';
  $('fname').classList.toggle('hidden',isSpend);
  $('lamt').textContent=isSpend?'Amount spent':isBud?'Planned amount':isSav?'Total saved now (balance)':'Amount';
  $('fadd').classList.toggle('hidden',!isSav); $('fext').classList.toggle('hidden',!isSav);
  $('fflex').classList.toggle('hidden',L!=='bills'); $('iflex').checked=L==='bills'&&isFlex(x);
  $('iadd').value=isSav&&x.add?x.add:''; $('eadd').textContent=''; $('iadd').removeAttribute('aria-invalid'); $('iext').checked=!!x.ext;
  $('fwho').classList.toggle('hidden',!isSav); $('famt').classList.toggle('hidden',isAcct);
  $('fme').classList.toggle('hidden',L!=='gave'||isSpend); $('ime').checked=!!x.me;
  $('fbank').classList.toggle('hidden',!isAcct); $('facct').classList.toggle('hidden',!isAcct);
  $('icur').classList.toggle('hidden',!isSav);
  $('fdue').classList.toggle('hidden',!DUE_LISTS.includes(L)||isSpend);
  $('ldue').textContent=L==='income'?'Expected on day (optional)':L==='savings'?'Transfer by day (optional)':'Due day of month (optional)';
  $('idue').value=x.due||''; $('edue').textContent=''; $('idue').removeAttribute('aria-invalid');
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
  const rawAdd=$('iadd').value.replace(/[,\s]/g,''), addAmt=rawAdd===''?0:Number(rawAdd);
  if(ctx.list==='savings'&&(!isFinite(addAmt)||addAmt<0||addAmt>=1e12)){$('eadd').textContent='Enter an amount, or leave empty for no monthly deposit';$('iadd').setAttribute('aria-invalid','true');ok=false}
  const rawDue=$('idue').value.trim(), due=Number(rawDue);
  if(DUE_LISTS.includes(ctx.list)&&rawDue&&!(Number.isInteger(due)&&due>=1&&due<=31)){$('edue').textContent='Enter a day from 1 to 31, or leave empty';$('idue').setAttribute('aria-invalid','true');ok=false}
  if(!ok){(label?($('idue').getAttribute('aria-invalid')?$('idue'):$('iamt')):$('ilabel')).focus();return}
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
    if(ctx.list==='bills'){ if($('iflex').checked){ x.flex=true; x.done=false; } else x.flex=false; }
    if(DUE_LISTS.includes(ctx.list)){ if(rawDue) x.due=due; else delete x.due; }
    if(ctx.list==='savings'){x.who=str($('iwho').value)||'Other';x.cur=$('icur').value;x.add=money(addAmt);if(!x.add)x.done=false;if($('iext').checked)x.ext=true;else delete x.ext}
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
    savings:(src.savings||[]).map(x=>({...x,id:uid(),amt:Math.round(savBal(x)*100)/100,done:false})),fixed:cp(src.fixed),bills:cp(src.bills),gave:cp(src.gave),expenses:[],settles:[],housePlan:Number(src.housePlan)||0,fundIns:[]};
  return S.months[k];
}
function openExp(c){
  ectx=c; const e=c.item||{};
  $('etitle').textContent=c.item?'Edit expense':'Add expense';
  $('eamt2').value=c.item?e.amt:''; $('enote').value=e.note||'';
  const [y,mo]=cur.split('-').map(Number);
  $('edate').value=e.date||(cur===thisMonth?todayStr():cur+'-01');
  const m=M()||S.months[thisMonth]||{budget:[]};
  ectx.scope=e.scope||c.scope||(spendMode==='house'&&tab==='spending'?'house':'me');
  if(ectx.scope==='house'&&!hasHouse()) ectx.scope='me';
  const hm=M(); ectx.paidBy=e.paidBy||(hm&&((hm.gave||[]).length||(hm.bills||[]).length)?'__fund':ME()); ectx.split=e.split&&e.split.length?[...e.split]:MEMBERS().map(p=>p.name);
  ectx.cat=e.cat||c.cat||''; ectx.keepCat=!!(e.cat||c.cat);
  drawScope();
  $('eerr').textContent=''; $('ecerr').textContent=''; $('eamt2').removeAttribute('aria-invalid');
  $('edel').classList.toggle('hidden',!c.item);
  $('edlg').showModal(); setTimeout(()=>$('eamt2').focus(),60);
}
function drawCats(){
  const m=M()||S.months[thisMonth]||{budget:[],bills:[]}, hs=ectx.scope==='house';
  const base=hs?(m.bills||[]).filter(isFlex).map(b=>b.label):(m.budget||[]).map(b=>b.label);
  const cats=[...new Set([...base,...(ectx.keepCat&&ectx.cat&&ectx.cat!=='Other'?[ectx.cat]:[]),'Other'])];
  if(!cats.includes(ectx.cat)) ectx.cat=cats.length===1?'Other':'';
  if(cats.length===2&&!ectx.cat) ectx.cat=cats[0];
  $('ecats').innerHTML=cats.map(k=>`<button type="button" class="${CHIP}" data-c="${esc(k)}" aria-pressed="${k===ectx.cat}"><span class="mr-1.5 inline-block size-2 rounded-full align-middle" style="background:${hs?(k==='Other'?OTHER_COLOR:'#0f766e'):(M()?catColor(M(),k):OTHER_COLOR)}"></span>${esc(k)}</button>`).join('');
}
function drawScope(){
  const hs=ectx.scope==='house'; drawCats();
  $('escope').innerHTML=[['me','Personal'],['house','House']].map(([v,l])=>`<button type="button" role="radio" aria-checked="${ectx.scope===v}" data-s="${v}" class="min-h-10 rounded-full text-sm font-semibold text-[#4a6964] aria-checked:bg-teal-800 aria-checked:text-white dark:text-teal-200/70 dark:aria-checked:bg-reef dark:aria-checked:text-teal-950">${l}</button>`).join('');
  $('ehouse').classList.toggle('hidden',!hs); $('efund').classList.add('hidden');
  if(hs){
    const pot=ectx.paidBy==='__fund';
    $('epaid').innerHTML=`<button type="button" class="${CHIP}" data-p="__fund" aria-pressed="${pot}">House money</button>`+MEMBERS().map(p=>`<button type="button" class="${CHIP}" data-p="${esc(p.name)}" aria-pressed="${ectx.paidBy===p.name}">${esc(houseName(p.name))}</button>`).join('');
    $('esplitwrap').classList.toggle('hidden',pot);
    $('esplit').innerHTML=MEMBERS().map(p=>`<button type="button" class="${CHIP}" data-sp="${esc(p.name)}" aria-pressed="${ectx.split.includes(p.name)}">${esc(houseName(p.name))}</button>`).join('');
    const amt=Number(($('eamt2').value||'').replace(/[,\s]/g,''))||0, n=ectx.split.length;
    $('eshare').textContent=n&&amt?`${fmt(Math.round(amt/n*100)/100)} each`+(ectx.split.includes(ME())?'':' (you’re not in this split)'):'';
  }
}
$('escope').onclick=e=>{const b=e.target.closest('[data-s]');if(!b)return;
  if(b.dataset.s==='house'&&!hasHouse()){ $('edlg').close(); openMembers(()=>openExp({scope:'house'})); return; }
  ectx.scope=b.dataset.s; ectx.keepCat=false; ectx.cat=''; drawScope();};
$('epaid').onclick=e=>{const b=e.target.closest('[data-p]');if(!b)return;ectx.paidBy=b.dataset.p;drawScope()};
$('esplit').onclick=e=>{const b=e.target.closest('[data-sp]');if(!b)return;const n=b.dataset.sp;
  ectx.split=ectx.split.includes(n)?ectx.split.filter(x=>x!==n):[...ectx.split,n]; $('eserr').textContent=''; drawScope()};
$('eamt2').addEventListener('input',()=>{if(ectx&&ectx.scope==='house')drawScope()});
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
  if(ectx.scope==='house'&&ectx.paidBy!=='__fund'&&!ectx.split.length){$('eserr').textContent='Choose at least one person to share it';return}
  const date=DATE_RE.test($('edate').value)?$('edate').value:todayStr();
  const undo=snapshot();
  const rec={id:ectx.item?ectx.item.id:uid(),date,amt:money(amt),cat:str(ectx.cat)||'Other',note:str($('enote').value)};
  if(ectx.scope==='house'){rec.scope='house'; rec.paidBy=ectx.paidBy; rec.split=ectx.paidBy==='__fund'?[]:[...ectx.split];}
  if(ectx.item){ const om=S.months[monthOf(ectx.item.date)]; if(om){const i=om.expenses.indexOf(ectx.item); if(i>=0) om.expenses.splice(i,1);} }
  const tm=ensureMonth(monthOf(date)); tm.expenses.push(rec);
  const moved=monthOf(date)!==cur;
  $('edlg').close(); save(); render();
  toast(ectx.item?'Expense updated':`${fmt(rec.amt)} · ${rec.scope==='house'?'House':rec.cat}`+(moved?` (saved in ${mlabel(monthOf(date))})`:''),undo);
};

/* ================= Household members sheet ================= */
let mDraft=[], mNext=null;
function openMembers(next){
  mNext=next||null;
  mDraft=MEMBERS().length?MEMBERS().map(p=>({...p})):(()=>{ // prefill from House contributions
    const g=(M()||{gave:[]}).gave||[]; const list=g.map(x=>({name:x.label,...(x.me?{me:true}:{})}));
    if(!list.some(p=>p.me)) list.unshift({name:'You',me:true}); return list;})();
  $('mplan').value=M()&&M().housePlan?M().housePlan:'';
  mMode=S.houseMode==='fund'?'fund':'split'; mMgr=S.fundManager||'';
  drawMembers(); drawMode(); $('merr').textContent=''; $('mdlg').showModal();
}
let mMode='split', mMgr='';
function drawMode(){ ['mmode','mmodehint','mmgrwrap','mplanwrap'].forEach(id=>$(id)&&$(id).classList.add('hidden')); return;
  $('mmode').innerHTML=[['split','Split each purchase'],['fund','Shared fund']].map(([v,l])=>`<button type="button" role="radio" aria-checked="${mMode===v}" data-mm="${v}" class="min-h-10 rounded-full text-sm font-semibold text-[#4a6964] aria-checked:bg-teal-800 aria-checked:text-white dark:text-teal-200/70 dark:aria-checked:bg-reef dark:aria-checked:text-teal-950">${l}</button>`).join('');
  $('mmodehint').textContent=mMode==='fund'?'Everyone pays into one fund. One person manages it and buys for the house.':'Whoever pays, the cost is split. Tally shows who owes whom.';
  $('mmgrwrap').classList.toggle('hidden',mMode!=='fund');
  const names=mDraft.map(p=>str(p.name,30)).filter(Boolean); if(!names.includes(mMgr)) mMgr=names[0]||'';
  $('mmgr').innerHTML=names.map(n=>`<button type="button" class="${CHIP}" data-mg="${esc(n)}" aria-pressed="${n===mMgr}">${esc(n)}</button>`).join('');
  $('lplan').textContent=mMode==='fund'?'Fund target this month, everyone together (optional)':'Household budget this month (optional)';
}
$('mmode').onclick=e=>{const b=e.target.closest('[data-mm]');if(!b)return;mMode=b.dataset.mm;drawMode()};
$('mmgr').onclick=e=>{const b=e.target.closest('[data-mg]');if(!b)return;mMgr=b.dataset.mg;drawMode()};
function drawMembers(){
  $('mlist').innerHTML=mDraft.map((p,i)=>`<div class="flex items-center gap-2">
    <input class="input flex-1" data-mi="${i}" value="${esc(p.name)}" maxlength="30" aria-label="Name">
    <button type="button" data-me="${i}" aria-pressed="${!!p.me}" class="min-h-12 flex-none rounded-2xl border border-line px-3 text-sm font-semibold text-[#4a6964] aria-pressed:border-teal-700 aria-pressed:bg-teal-50 aria-pressed:text-teal-900 dark:border-teal-700 dark:text-teal-200/70 dark:aria-pressed:border-reef dark:aria-pressed:bg-teal-800 dark:aria-pressed:text-reef">${p.me?'This is me':'Me?'}</button>
    <button type="button" data-mx="${i}" class="grid size-12 flex-none place-items-center rounded-2xl text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-400/10" aria-label="Remove ${esc(p.name)}"><svg class="icon size-5" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join('');
}
$('mlist').addEventListener('input',e=>{const i=e.target.dataset.mi;if(i!=null){mDraft[+i].name=e.target.value;drawMode()}});
$('mlist').addEventListener('click',e=>{const a=e.target.closest('[data-me]'),x=e.target.closest('[data-mx]');
  if(a){mDraft.forEach((p,i)=>{if(i===+a.dataset.me)p.me=true;else delete p.me});drawMembers()}
  if(x){mDraft.splice(+x.dataset.mx,1);drawMembers();drawMode()}});
$('madd').onclick=()=>{if(mDraft.length>=12)return;mDraft.push({name:''});drawMembers();$('mlist').querySelector(`[data-mi="${mDraft.length-1}"]`).focus()};
$('mcancel').onclick=()=>{$('mdlg').close();mNext=null};
$('mdlg').addEventListener('click',e=>{if(e.target===$('mdlg')){$('mdlg').close();mNext=null}});
$('mform').onsubmit=e=>{
  e.preventDefault();
  const list=mDraft.map(p=>({...p,name:str(p.name,30)})).filter(p=>p.name);
  const lower=list.map(p=>p.name.toLowerCase());
  if(list.length<2){$('merr').textContent='Add at least 2 people, including you.';return}
  if(new Set(lower).size!==lower.length){$('merr').textContent='Each person needs a different name.';return}
  if(!list.some(p=>p.me)){$('merr').textContent='Tap “Me?” next to your own name.';return}
  const old=MEMBERS();

  const undo=snapshot();
  // rename references when a name changed in place
  old.forEach((p,i)=>{ const nw=mDraft[i]&&str(mDraft[i].name,30); if(nw&&nw!==p.name&&!old.some(q=>q.name===nw)){
    for(const k in S.months){ const m=S.months[k];
      m.expenses.forEach(x=>{ if(isHouse(x)){ if(x.paidBy===p.name)x.paidBy=nw; x.split=x.split.map(n=>n===p.name?nw:n);} });
      (m.settles||[]).forEach(t=>{ if(t.from===p.name)t.from=nw; if(t.to===p.name)t.to=nw; }); } } });
  // rename references to the manager and fund payments too
  old.forEach((p,i)=>{ const nw=mDraft[i]&&str(mDraft[i].name,30); if(nw&&nw!==p.name){ if(mMgr===p.name) mMgr=nw;
    for(const k in S.months) (S.months[k].fundIns||[]).forEach(x=>{ if(x.from===p.name) x.from=nw; }); } });
  S.members=list.map(p=>p.me?{name:p.name,me:true}:{name:p.name});
  S.houseMode='split';
  const mm=ensureMonth(cur);
  // pay-in rows follow the people list: rename, add new people, drop removed ones that have nothing recorded
  old.forEach((p,i)=>{ const nw=mDraft[i]&&str(mDraft[i].name,30); if(nw&&nw!==p.name) mm.gave.forEach(g=>{ if(g.label===p.name) g.label=nw; }); });
  const names=new Set(S.members.map(p=>p.name));
  mm.gave=mm.gave.filter(g=>names.has(g.label)||(Number(g.amt)||0)>0||g.done);
  S.members.forEach(p=>{ let g=mm.gave.find(x=>x.label===p.name); if(!g){ g={id:uid(),label:p.name,amt:0,done:false}; mm.gave.push(g);} if(p.me) g.me=true; else delete g.me; });
  $('mdlg').close(); save(); if(tab!=='house') tab='house'; render(); toast('People saved',undo);
  const n=mNext; mNext=null; n&&n();
};

/* ================= Pay into fund sheet ================= */
let fFrom='';
function openFundIn(from,amt){
  fFrom=from||ME();
  $('fifrom').innerHTML=MEMBERS().map(p=>`<button type="button" class="${CHIP}" data-f="${esc(p.name)}" aria-pressed="${p.name===fFrom}">${esc(houseName(p.name))}</button>`).join('');
  $('fiamt').value=amt||''; $('fidate').value=cur===thisMonth?todayStr():cur+'-01'; $('fierr').textContent='';
  $('fdlg').showModal(); setTimeout(()=>$('fiamt').focus(),60);
}
$('fifrom').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;fFrom=b.dataset.f;[...$('fifrom').children].forEach(x=>x.setAttribute('aria-pressed',x===b))};
$('fcancel').onclick=()=>$('fdlg').close();
$('fdlg').addEventListener('click',e=>{if(e.target===$('fdlg'))$('fdlg').close()});
$('fform').onsubmit=e=>{
  e.preventDefault(); const v=Number($('fiamt').value.replace(/[,\s]/g,''));
  if(!(v>0)||!isFinite(v)||v>=1e12){$('fierr').textContent='Enter the amount paid in, e.g. 1500';return}
  const d=DATE_RE.test($('fidate').value)?$('fidate').value:todayStr();
  const undo=snapshot(); ensureMonth(monthOf(d)).fundIns.push({id:uid(),date:d,from:fFrom,amt:money(v)});
  $('fdlg').close(); save(); render(); toast(`${fmt(v)} from ${houseName(fFrom)} added to the fund`,undo);
};

/* ================= Backup ================= */
function exportData(){ openPw('export'); }
async function writeBackup(password){
  const name=`tally-backup-${new Date().toISOString().slice(0,10)}.json`;
  let body;
  if(password){
    const salt=crypto.getRandomValues(new Uint8Array(16)), key=await deriveKey(password,salt,ITER);
    const {iv,ct}=await encryptText(key,JSON.stringify(S));
    body=JSON.stringify({tally:'backup',v:2,enc:{alg:'AES-GCM',kdf:'PBKDF2-SHA256',iter:ITER,salt:b64(salt),iv,ct}});
  } else body=JSON.stringify(S,null,1);
  const blob=new Blob([body],{type:'application/json'});
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
    let d; try{d=JSON.parse(r.result);}catch(_){toast('That file isn\'t a Tally backup');return}
    if(d&&d.enc&&typeof d.enc.ct==='string'){ pendingEnc=d.enc; openPw('import'); return; }
    restoreData(d);
  };
  r.readAsText(f);
};
let pendingEnc=null;
async function restoreData(d){
    try{ if(!d||typeof d.months!=='object') throw 0; d=cleanData(d);}catch(_){toast('That file isn\'t a Tally backup');return}
    const n=Object.keys(d.months).length;
    if(!n&&!d.accounts.length){toast('No usable data found in that file');return}
    if(Object.keys(S.months).length && !await confirmSheet('Replace data on this phone?',`The backup has ${n} month${n===1?'':'s'}. Everything currently in the app will be replaced. You can undo right after.`,'Replace')) return;
    const undo=snapshot(); S=d;
    cur=S.months[thisMonth]?thisMonth:(Object.keys(S.months).sort().pop()||thisMonth);
    save(); tab='home'; render(); toast(`Restored ${n} month${n===1?'':'s'}`,undo);
}

/* ================= Password sheet (backups) ================= */
let pwMode=null;
function openPw(mode){
  pwMode=mode;
  $('pwtitle').textContent=mode==='export'?'Protect your backup':'Enter backup password';
  $('pwhint').textContent=mode==='export'?'Anyone with the file needs this password to read it. There is no way to recover it, so keep it safe.':'This backup is password-protected.';
  $('pw2wrap').classList.toggle('hidden',mode!=='export'); $('pwplain').classList.toggle('hidden',mode!=='export');
  $('pwgo').textContent=mode==='export'?'Save protected backup':'Restore';
  $('pw1').value=''; $('pw2').value=''; $('pwerr').textContent=''; $('pw1').setAttribute('autocomplete',mode==='export'?'new-password':'current-password');
  $('pwdlg').showModal(); setTimeout(()=>$('pw1').focus(),60);
}
$('pwcancel').onclick=()=>{$('pwdlg').close();pendingEnc=null};
$('pwdlg').addEventListener('click',e=>{if(e.target===$('pwdlg')){$('pwdlg').close();pendingEnc=null}});
$('pwplain').onclick=async()=>{
  if(!await confirmSheet('Save without a password?','Anyone who gets this file can read all your amounts and names.','Save anyway')) return;
  $('pwdlg').close(); writeBackup(null);
};
$('pwform').onsubmit=async e=>{
  e.preventDefault(); const p1=$('pw1').value, p2=$('pw2').value;
  if(pwMode==='export'){
    if(p1.length<6){$('pwerr').textContent='Use at least 6 characters.';return}
    if(p1!==p2){$('pwerr').textContent='The two passwords don’t match.';return}
    $('pwgo').disabled=true; $('pwgo').textContent='Encrypting…';
    try{ await writeBackup(p1); $('pwdlg').close(); } finally{ $('pwgo').disabled=false; }
  } else {
    if(!p1){$('pwerr').textContent='Enter the password.';return}
    $('pwgo').disabled=true; $('pwgo').textContent='Checking…';
    try{
      const enc=pendingEnc, key=await deriveKey(p1,unb64(enc.salt),Math.min(Math.max(+enc.iter||ITER,100000),2000000));
      const d=JSON.parse(await decryptText(key,enc.iv,enc.ct));
      $('pwdlg').close(); pendingEnc=null; restoreData(d);
    }catch(_){ $('pwerr').textContent='Wrong password, or the file is damaged.'; }
    finally{ $('pwgo').disabled=false; $('pwgo').textContent='Restore'; }
  }
};

/* ================= PIN lock ================= */
let pinMode='unlock', pinBuf='', pinFirst='', pinBusy=false, pinNext=null;
const LOCK_TXT={unlock:['Enter your PIN',''],set1:['Choose a PIN','4 to 6 digits. You’ll need it every time you open Tally.'],set2:['Enter the PIN again','To make sure it’s right.'],verify:['Enter your current PIN','']};
function showLock(mode,next){
  pinMode=mode; pinNext=next||null; pinBuf=''; pinFirst=mode==='set2'?pinFirst:'';
  $('lock').classList.remove('hidden'); $('lock').classList.add('flex'); document.body.classList.add('overflow-hidden');
  $('ltitle').textContent=LOCK_TXT[mode][0]; $('lsub').textContent=LOCK_TXT[mode][1]; $('lerr').textContent='';
  $('lcancel').classList.toggle('hidden',mode==='unlock'); $('lforgot').classList.toggle('hidden',mode!=='unlock');
  $('lgo').classList.toggle('hidden',mode!=='set1');
  drawDots(); checkThrottle();
}
function hideLock(){ $('lock').classList.add('hidden'); $('lock').classList.remove('flex'); document.body.classList.remove('overflow-hidden'); }
function pinLen(){ return pinMode==='set1'?6:pinMode==='set2'?pinFirst.length:(encMeta&&encMeta.len)||6; }
function drawDots(){
  const n=pinMode==='set1'?Math.max(4,pinBuf.length):pinLen();
  $('ldots').innerHTML=Array.from({length:n},(_,i)=>`<span class="size-3.5 rounded-full border-2 border-white/60 ${i<pinBuf.length?'bg-white border-white':''}"></span>`).join('');
  $('lgo').disabled=pinBuf.length<4;
}
function fails(){try{return JSON.parse(store.get(FAILS)||'{"n":0,"until":0}')}catch(_){return {n:0,until:0}}}
let throttleTimer=null;
function checkThrottle(){
  clearInterval(throttleTimer); const f=fails();
  const tick=()=>{const s=Math.ceil((f.until-Date.now())/1000);
    if(s>0){ $('lerr').textContent=`Too many wrong tries. Try again in ${Math.floor(s/60)}:${pad(s%60)}`; $('lkeys').classList.add('pointer-events-none','opacity-40'); }
    else { clearInterval(throttleTimer); if($('lerr').textContent.startsWith('Too many')) $('lerr').textContent=''; $('lkeys').classList.remove('pointer-events-none','opacity-40'); }};
  if(f.until>Date.now()){ tick(); throttleTimer=setInterval(tick,1000); } else tick();
}
function shake(msg){ $('lerr').textContent=msg; pinBuf=''; drawDots(); const d=$('ldots'); d.classList.remove('animate-[shake_.35s]'); void d.offsetWidth; d.classList.add('animate-[shake_.35s]'); try{navigator.vibrate?.([30,40,30])}catch(_){} }
async function checkPin(pin){ // returns decrypted text or null
  const key=await deriveKey(pin,unb64(encMeta.salt),encMeta.iter||ITER);
  try{ return {key,text:await decryptText(key,encMeta.iv,encMeta.ct)}; }catch(_){ return null; }
}
async function pinEntered(){
  if(pinBusy) return;
  if(pinMode==='set1'){ if(pinBuf.length<4) return; pinFirst=pinBuf; showLock('set2',pinNext); return; }
  if(pinMode==='set2'){
    if(pinBuf!==pinFirst){ pinFirst=''; showLock('set1',pinNext); $('lerr').textContent='Those PINs didn’t match. Choose a PIN again.'; return; }
    pinBusy=true; $('lsub').textContent='Encrypting your data…';
    try{ await enablePin(pinBuf); hideLock(); render(); toast('PIN set. Your data is now encrypted'); } catch(_){ shake('Could not set the PIN'); }
    pinBusy=false; return;
  }
  // unlock / verify
  if(fails().until>Date.now()) return;
  pinBusy=true; $('lsub').textContent='Checking…';
  const res=await checkPin(pinBuf); pinBusy=false; $('lsub').textContent=LOCK_TXT[pinMode][1];
  if(!res){ const f=fails(); f.n++; if(f.n>=5) f.until=Date.now()+Math.min(30000*Math.pow(2,f.n-5),15*60000); store.set(FAILS,JSON.stringify(f));
    shake(f.n>=5?'':`Wrong PIN. ${Math.max(0,5-f.n)} ${5-f.n===1?'try':'tries'} left before a short wait`); checkThrottle(); return; }
  store.set(FAILS,'{"n":0,"until":0}');
  if(pinMode==='unlock'){
    try{ S=cleanData(JSON.parse(res.text)); }catch(_){ S={months:{},accounts:[]}; }
    cryptoKey=res.key; LOCKED=false; lastActive=Date.now();
    cur=S.months[thisMonth]?thisMonth:(Object.keys(S.months).sort().pop()||thisMonth);
    hideLock(); heroPlayed=false; render();
  } else { hideLock(); const n=pinNext; pinNext=null; n&&n(); }
}
async function enablePin(pin){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await deriveKey(pin,salt,ITER);
  const meta={v:1,salt:b64(salt),iter:ITER,len:pin.length};
  const {iv,ct}=await encryptText(key,JSON.stringify(S));
  if(!store.set(ENC_KEY,JSON.stringify({...meta,iv,ct}))) throw new Error('storage');
  cryptoKey=key; encMeta=meta; wipePlainCopies(); store.set(FAILS,'{"n":0,"until":0}');
}
async function disablePin(){
  await saveChain; if(!store.set(KEY,JSON.stringify(S))){toast('Could not save — storage blocked');return}
  try{localStorage.removeItem(ENC_KEY)}catch(_){}
  cryptoKey=null; encMeta=null; render(); toast('PIN turned off. Data is no longer encrypted');
}
async function lockNow(){
  if(!encMeta||LOCKED) return;
  await saveChain; encMeta=readEnc()||encMeta;
  document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  S={months:{},accounts:[]}; cryptoKey=null; LOCKED=true; hideToast(); render(); showLock('unlock');
}
$('lkeys').addEventListener('click',e=>{
  const b=e.target.closest('[data-k]'); if(!b||pinBusy) return; const k=b.dataset.k;
  if(k==='del'){ pinBuf=pinBuf.slice(0,-1); drawDots(); return; }
  if(pinBuf.length>=(pinMode==='set1'?6:pinLen())) return;
  pinBuf+=k; drawDots(); if(pinMode!=='set1'&&pinBuf.length===pinLen()) setTimeout(pinEntered,90);
});
$('lgo').onclick=()=>pinEntered();
$('lcancel').onclick=()=>{ pinNext=null; hideLock(); };
$('lforgot').onclick=async()=>{
  if(!await confirmSheet('Erase data and start over?','Without your PIN the data on this phone can’t be opened. Erase it, then restore a backup (you’ll need that backup’s password).','Erase')) return;
  try{localStorage.removeItem(ENC_KEY)}catch(_){} store.set(FAILS,'{"n":0,"until":0}');
  encMeta=null; cryptoKey=null; LOCKED=false; S={months:{},accounts:[]}; hideLock(); tab='more'; render(); toast('Erased. Restore a backup or start fresh');
};
document.addEventListener('keydown',e=>{
  if($('lock').classList.contains('hidden')||document.querySelector('dialog[open]')) return;
  if(/^\d$/.test(e.key)){ $('lkeys').querySelector(`[data-k="${e.key}"]`)?.click(); e.preventDefault(); }
  else if(e.key==='Backspace'){ $('lkeys').querySelector('[data-k="del"]').click(); e.preventDefault(); }
  else if(e.key==='Enter'&&pinMode==='set1'){ pinEntered(); }
  else if(e.key==='Escape'&&pinMode!=='unlock'){ $('lcancel').click(); }
},true);

/* Auto-lock: after leaving the app, or when idle */
let hiddenAt=0, lastActive=Date.now();
const lockAfter=()=>Number(store.get(AUTOLOCK)||'60');
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ hiddenAt=Date.now(); if(encMeta&&!LOCKED){ $('cover').classList.remove('hidden'); $('cover').classList.add('grid'); if(lockAfter()===0) lockNow(); } }
  else { if(encMeta&&!LOCKED&&Date.now()-hiddenAt>=lockAfter()*1000) lockNow(); $('cover').classList.add('hidden'); $('cover').classList.remove('grid'); lastActive=Date.now(); }
});
['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{lastActive=Date.now()},{passive:true,capture:true}));
setInterval(()=>{ if(encMeta&&!LOCKED&&Date.now()-lastActive>Math.max(lockAfter(),300)*1000) lockNow(); },15000);

/* ================= Accessibility ================= */
function applyA11y(){
  const z=store.get('tally-text')||'100'; document.documentElement.style.zoom=z==='100'?'':(Number(z)/100);
  document.documentElement.dataset.contrast=store.get('tally-contrast')==='high'?'high':'';
  document.documentElement.dataset.text=z==='100'?'':'big';
}
applyA11y();
const TAB_NAMES={home:'Home',budget:'Budget',spending:'Spending',savings:'Savings',house:'House',more:'More'};

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
  if(a==='all'){const undo=snapshot();const arr=M()[list].filter(x=>!(list==='bills'&&isFlex(x)));const v=!arr.every(x=>x.done);arr.forEach(x=>x.done=v);save();render();toast(v?'All ticked':'All unticked',undo)}
  if(a==='edit') openDlg({list,item:M()[list].find(i=>i.id===id)});
  if(a==='add') openDlg({list,who:t.dataset.who,label:t.dataset.label});
  if(a==='addexp') openExp({cat:t.dataset.cat,scope:t.dataset.scope});
  if(a==='mode'){ spendMode=t.dataset.v; spendFilter=''; render(); }
  if(a==='members') openMembers();
  if(a==='guidehide'){ store.set('tally-guide','hidden'); render(); toast('Guide hidden. Turn it back on in More'); }
  if(a==='guideshow'){ store.set('tally-guide','shown'); go('home'); }
  if(a==='guide'&&t.getAttribute('aria-disabled')!=='true'){ const st=t.dataset.step;
    if(st==='add-income') openDlg({list:'income'}); if(st==='add-fixed') openDlg({list:'fixed'}); if(st==='go-budget') go('budget');
    if(st==='add-savings') go('savings'); if(st==='go-house') go('house'); if(st==='backup') exportData(); if(st==='pin') showLock('set1'); }
  if(a==='fundin') openFundIn(t.dataset.from,t.dataset.amt);
  if(a==='unfund'){ const undo=snapshot(); const m=M(); m.fundIns=m.fundIns.filter(x=>x.id!==id); save(); render(); toast('Payment removed',undo); }
  if(a==='settle'){ const from=t.dataset.from,to=t.dataset.to,amt=Number(t.dataset.amt);
    if(!await confirmSheet(`Record ${fmt(amt)} payment?`,`${houseName(from)} paid ${houseName(to)} ${fmt(amt)}. Balances will update.`,'Record payment')) return;
    const undo=snapshot(); const d=cur===thisMonth?todayStr():cur+'-01'; ensureMonth(monthOf(d)).settles.push({id:uid(),date:d,from,to,amt:money(amt)});
    save(); render(); toast('Payment recorded',undo); }
  if(a==='unsettle'){ const undo=snapshot(); const m=M(); m.settles=m.settles.filter(x=>x.id!==id); save(); render(); toast('Settlement removed',undo); }
  if(a==='editexp') openExp({item:M().expenses.find(i=>i.id===id)});
  if(a==='filter'){ spendFilter=spendFilter===t.dataset.cat?'':t.dataset.cat; if(tab!=='spending') go('spending'); else render(); }
  if(a==='addacct') openDlg({list:'accounts'});
  if(a==='editacct') openDlg({list:'accounts',item:S.accounts.find(i=>i.id===id)});
  if(a==='go') go(t.dataset.to);
  if(a==='pickme'){ go('bills'); toast('Tap your name in Contributions, then tick “This is my share”'); }
  if(a==='export') exportData();
  if(a==='import') $('ifile').click();
  if(a==='theme'){store.set(THEME,t.dataset.v);resolveTheme();render()}
  if(a==='pinset') showLock('set1');
  if(a==='pinchange') showLock('verify',()=>showLock('set1'));
  if(a==='pinoff') showLock('verify',async()=>{ if(await confirmSheet('Turn off PIN lock?','Your data will be stored without encryption, and anyone using your phone can open Tally.','Turn off')) disablePin(); });
  if(a==='locknow') lockNow();
  if(a==='autolock'){ store.set(AUTOLOCK,t.dataset.v); render(); }
  if(a==='hide') togglePriv();
  if(a==='textsize'){ store.set('tally-text',t.dataset.v); applyA11y(); render(); toast('Text size changed'); }
  if(a==='contrast'){ store.set('tally-contrast',store.get('tally-contrast')==='high'?'normal':'high'); applyA11y(); render(); }
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
function go(t){ let anchor=null; if(t==='household'||t==='bills') t='house'; if(t==='fixed'){ t='budget'; anchor='fixedcard'; }
  setTimeout(()=>{ if(anchor) document.getElementById(anchor)?.scrollIntoView({behavior:'smooth',block:'start'}); },30);
  tab=t; try{history.replaceState(null,'','#'+t)}catch(_){} render(); $('app').focus({preventScroll:true}); window.scrollTo({top:0});}
document.querySelectorAll('#nav [data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
$('fab').onclick=()=>openExp({});
let lastY=scrollY;
let fabTimer=null;
addEventListener('scroll',()=>{const y=scrollY, f=$('fab'); clearTimeout(fabTimer); fabTimer=setTimeout(()=>{f.dataset.away='false'},700);
  if(Math.abs(y-lastY)<8) return; f.dataset.away=String(y>lastY&&y>120); lastY=y;},{passive:true});
$('gear').onclick=()=>go('more');
function togglePriv(){ PRIV=!PRIV; store.set(HIDE,PRIV?'1':'0'); render(); toast(PRIV?'Amounts hidden':'Amounts shown'); }
$('eye').onclick=togglePriv;
$('prev').onclick=()=>{cur=shift(cur,-1);render()};
$('next').onclick=()=>{cur=shift(cur,1);render()};
$('mtitle').onclick=()=>{cur=thisMonth;render()};
$('today').onclick=()=>{cur=thisMonth;render()};
document.addEventListener('keydown',e=>{ if(e.target.matches('input,select,textarea')||document.querySelector('dialog[open]'))return;
  if(e.key==='e'||e.key==='E'){e.preventDefault();openExp({});return}
  if(e.key==='ArrowLeft'){cur=shift(cur,-1);render()} if(e.key==='ArrowRight'){cur=shift(cur,1);render()} });
let sx=null,sy=null;
$('app').addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
$('app').addEventListener('touchend',e=>{ if(sx===null)return; const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy;
  if(Math.abs(dx)>80&&Math.abs(dy)<40){cur=shift(cur,dx<0?1:-1);render()} sx=null; },{passive:true});

render();
if(LOCKED) showLock('unlock');
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
navigator.storage?.persist?.().catch(()=>{});
