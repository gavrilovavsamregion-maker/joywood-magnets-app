(function(){
'use strict';
var G='https://gallery.joywood.fun';
var css='.jw-e{font-family:"Segoe UI",system-ui,sans-serif;background:#1a1612;border-radius:12px;padding:1.25rem;overflow:hidden}.jw-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}.jw-t{font-size:1rem;font-weight:700;color:#f0e8d8}.jw-t span{color:#c8a84b}.jw-a{font-size:.8rem;color:#c8a84b;text-decoration:none;border:1px solid #8a6f2e;padding:.25rem .7rem;border-radius:99px;transition:background .2s}.jw-a:hover{background:#c8a84b;color:#1a1612}.jw-c{display:flex;gap:.75rem;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:.25rem}.jw-c::-webkit-scrollbar{display:none}.jw-card{flex:0 0 200px;scroll-snap-align:start;border-radius:10px;overflow:hidden;cursor:pointer;position:relative;background:#231e19;border:1px solid #3a3028;transition:transform .2s}.jw-card:hover{transform:translateY(-3px)}.jw-card img{width:200px;height:200px;object-fit:cover;display:block}.jw-ov{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.8) 40%,transparent);opacity:0;transition:opacity .2s;padding:.6rem;display:flex;flex-direction:column;justify-content:flex-end}.jw-card:hover .jw-ov{opacity:1}.jw-ct{color:#fff;font-size:.78rem;font-weight:600}.jw-cp{color:#e2c978;font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.jw-vi{position:absolute;top:.5rem;right:.5rem;background:rgba(0,0,0,.55);color:#fff;width:1.8rem;height:1.8rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem}.jw-sk{background:linear-gradient(90deg,#231e19 25%,#2c2620 50%,#231e19 75%);background-size:200% 100%;animation:jw-sh 1.5s infinite;border-radius:10px;width:200px;height:200px;flex-shrink:0}@keyframes jw-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}@media(max-width:600px){.jw-card,.jw-card img,.jw-sk{width:160px;height:160px}}';
function css_inject(){if(document.getElementById('jw-css'))return;var s=document.createElement('style');s.id='jw-css';s.textContent=css;document.head.appendChild(s);}
function sj(v,d){try{return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:d);}catch(e){return d;}}
function skeleton(c){
  var w=document.createElement('div');w.className='jw-e';
  var h=document.createElement('div');h.className='jw-h';
  h.innerHTML='<div class="jw-t">Joy<span>wood</span> Gallery</div>';
  w.appendChild(h);
  var ca=document.createElement('div');ca.className='jw-c';
  for(var i=0;i<5;i++){var sk=document.createElement('div');sk.className='jw-sk';ca.appendChild(sk);}
  w.appendChild(ca);c.innerHTML='';c.appendChild(w);
}
function render(c,items){
  var w=document.createElement('div');w.className='jw-e';
  var h=document.createElement('div');h.className='jw-h';
  h.innerHTML='<div class="jw-t">Joy<span>wood</span> Gallery</div>'
    +'<a class="jw-a" href="'+G+'" target="_blank" rel="noopener">&rarr; Смотреть все</a>';
  w.appendChild(h);
  var ca=document.createElement('div');ca.className='jw-c';
  items.forEach(function(item){
    var card=document.createElement('div');card.className='jw-card';
    var photos=sj(item.photos,[]);var videos=sj(item.videos,[]);
    var cover=item.cover_url||(photos[0]&&photos[0].url)||'';
    if(cover){var img=document.createElement('img');img.src=cover;img.alt=item.title||'';img.loading='lazy';img.width=200;img.height=200;card.appendChild(img);}
    if(videos.length){var vi=document.createElement('div');vi.className='jw-vi';vi.textContent='\u25b6';card.appendChild(vi);}
    var ov=document.createElement('div');ov.className='jw-ov';
    ov.innerHTML='<div class="jw-ct">'+(item.title||'')+'</div><div class="jw-cp">'+(item.product_name||'')+'</div>';
    card.appendChild(ov);
    card.addEventListener('click',function(){window.open(G,'_blank');});
    ca.appendChild(card);
  });
  w.appendChild(ca);c.innerHTML='';c.appendChild(w);
}
function init(){
  css_inject();
  var cs=document.querySelectorAll('[data-jw-gallery]');
  cs.forEach(function(c){
    skeleton(c);
    fetch(G+'/embed/items')
      .then(function(r){return r.json();})
      .then(function(items){render(c,items);})
      .catch(function(){c.innerHTML='';});
  });
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();
