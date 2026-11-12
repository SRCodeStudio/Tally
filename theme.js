// Resolve theme before paint: stored "system" | "light" | "dark"
  (function(){
    var pref='system'; try{pref=localStorage.getItem('family-budget-theme')||'system'}catch(_){}
    var dark=pref==='dark'||(pref==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
    document.querySelector('meta[name=theme-color]').content=dark?'#042f2e':'#eef4f2';
    try{var z=localStorage.getItem('tally-text');if(z&&z!=='100'){document.documentElement.style.zoom=Number(z)/100;document.documentElement.dataset.text='big';}
      if(localStorage.getItem('tally-contrast')==='high')document.documentElement.dataset.contrast='high';}catch(_){}
  })();
