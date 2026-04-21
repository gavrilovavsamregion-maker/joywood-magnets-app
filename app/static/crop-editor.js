// crop-editor.js v2 — Интерактивный редактор кадрирования
// openCropEditor(imgUrl, opts, onSave, videoUrls)
// opts: { focal_x, focal_y, scale, aspect_ratio, video_url, video_start }

(function(){
'use strict';

const RATIOS = [
  {label:'Свободно', val:'free'},
  {label:'1:1', val:'1/1'},
  {label:'4:3', val:'4/3'},
  {label:'3:4', val:'3/4'},
  {label:'3:2', val:'3/2'},
  {label:'2:3', val:'2/3'},
  {label:'16:9', val:'16/9'},
];

let S = null; // state
let onSaveCb = null;
let videoUrls = [];
let currentVideoEl = null;
let aiAnalysis = []; // ai_photo_analysis from server


// ===== BUILD MODAL =====
function buildModal(){
  if(document.getElementById('cropModal')) return;
  const m = document.createElement('div');
  m.id = 'cropModal';
  m.innerHTML = `
<div class="ce-backdrop"></div>
<div class="ce-dialog">
  <div class="ce-toolbar">
    <div class="ce-tabs" id="ceTabs"></div>
    <div class="ce-sep"></div>
    <div class="ce-ratios" id="ceRatios"></div>
    <div class="ce-sep"></div>
    <div class="ce-zoom-row">
      <span class="ce-lbl">Масштаб</span>
      <button class="ce-zoom-btn" id="ceZoomOut">-</button>
      <input type="range" id="ceZoomSlider" min="50" max="400" step="5" value="100">
      <button class="ce-zoom-btn" id="ceZoomIn">+</button>
      <span id="ceZoomVal" class="ce-zoom-val">100%</span>
    </div>
    <div class="ce-sep"></div>
    <div class="ce-actions">
      <button id="ceAiFocal" title="AI предлагает focal point">🎯 AI</button>
      <button id="ceReset">↺</button>
      <button id="ceCancel">✕ Отмена</button>
      <button id="ceSave">✓ Сохранить</button>
    </div>
  </div>
  <div class="ce-stage" id="ceStage">
    <div class="ce-media" id="ceMedia">
      <img id="ceImg" src="" alt="" draggable="false">
      <video id="ceVideo" src="" muted playsinline preload="auto" style="display:none"></video>
    </div>
    <canvas id="ceMask" class="ce-mask"></canvas>
    <div class="ce-frame" id="ceFrame">
      <div class="ce-corner tl" data-h="left"  data-v="top"></div>
      <div class="ce-corner tr" data-h="right" data-v="top"></div>
      <div class="ce-corner bl" data-h="left"  data-v="bottom"></div>
      <div class="ce-corner br" data-h="right" data-v="bottom"></div>
      <div class="ce-edge et" data-v="top"></div>
      <div class="ce-edge eb" data-v="bottom"></div>
      <div class="ce-edge el" data-h="left"></div>
      <div class="ce-edge er" data-h="right"></div>
      <div class="ce-rule-h" style="top:33.33%"></div>
      <div class="ce-rule-h" style="top:66.66%"></div>
      <div class="ce-rule-v" style="left:33.33%"></div>
      <div class="ce-rule-v" style="left:66.66%"></div>
    </div>
    <div class="ce-hint" id="ceHint">Зажми и тяни — перемещай • Колесико — масштаб • Тяни уголки — обрезка</div>
    <div class="ce-video-bar" id="ceVideoBar" style="display:none">
      <button id="ceVidPlay">▶️</button>
      <input type="range" id="ceVidSeek" min="0" max="100" step="0.5" value="0" style="flex:1">
      <span id="ceVidTime">0.0s</span>
      <button id="ceVidCapture">📸 Снять кадр</button>
    </div>
  </div>
</div>`;
  document.body.appendChild(m);

  // Ratio buttons
  const ratioWrap = document.getElementById('ceRatios');
  RATIOS.forEach(r=>{
    const b=document.createElement('button');
    b.className='ce-ratio-btn'; b.dataset.val=r.val; b.textContent=r.label;
    b.onclick=()=>setRatio(r.val);
    ratioWrap.appendChild(b);
  });

  // Zoom
  const sl=document.getElementById('ceZoomSlider');
  sl.oninput=()=>{ S.scale=sl.value/100; document.getElementById('ceZoomVal').textContent=sl.value+'%'; renderMedia(); };
  document.getElementById('ceZoomIn').onclick=()=>  adjustZoom(+0.1);
  document.getElementById('ceZoomOut').onclick=()=> adjustZoom(-0.1);

  // Pan drag
  const media=document.getElementById('ceMedia');
  media.addEventListener('mousedown', panStart);
  media.addEventListener('touchstart', panStart, {passive:false});
  document.addEventListener('mousemove', panMove);
  document.addEventListener('mouseup',  panEnd);
  document.addEventListener('touchmove', panMove, {passive:false});
  document.addEventListener('touchend',  panEnd);

  // Wheel zoom
  document.getElementById('ceStage').addEventListener('wheel', onWheel, {passive:false});

  // Frame corner/edge resize
  document.getElementById('ceFrame').addEventListener('mousedown', resizeStart);
  document.getElementById('ceFrame').addEventListener('touchstart', resizeStart, {passive:false});

  // Buttons
  document.getElementById('ceSave').onclick   = doSave;
  document.getElementById('ceCancel').onclick = closeEditor;

  document.getElementById('ceAiFocal').onclick = () => applyAiSuggestion();
  document.getElementById('ceReset').onclick  = doReset;
  document.querySelector('.ce-backdrop').onclick = closeEditor;

  // Video controls
  document.getElementById('ceVidPlay').onclick = toggleVideoPlay;
  document.getElementById('ceVidSeek').addEventListener('input', onVidSeek);
  document.getElementById('ceVidCapture').onclick = captureVideoFrame;

  // Canvas mask
  window.addEventListener('resize', ()=>{ if(S) updateMask(); });
}

// ===== OPEN =====
window.openCropEditor = function(imgUrl, opts, onSave, videos){
  buildModal();
  onSaveCb = onSave;
  videoUrls = Array.isArray(videos) ? videos : [];

  S = {
    mode: 'image', // 'image' | 'video'
    imgUrl, videoUrl: opts.video_url||'',
    // Pan: смещение центра кадра в % от размера изображения
    panX: opts.focal_x ?? 50,
    panY: opts.focal_y ?? 50,
    scale: Math.max(0.5, Math.min(4, opts.scale ?? 1.0)),
    ratio: opts.aspect_ratio ?? 'free',
    videoStart: opts.video_start ?? 0,
    // Frame crop (в % от stage)
    frameX: 5, frameY: 5, frameW: 90, frameH: 90,
    // Drag state
    panning: false, panLX:0, panLY:0,
    resizing: false, resizeH:null, resizeV:null, resizeLX:0, resizeLY:0,
    // Canvas frame (px) - рассчитывается в initFrame
    stageW:0, stageH:0
  };

  // Строим tabs
  buildTabs();

  // Открываем
  document.getElementById('cropModal').classList.add('open');
  document.body.style.overflow='hidden';

  switchMode('image');
};

// ===== TABS =====
function buildTabs(){
  const wrap=document.getElementById('ceTabs');
  wrap.innerHTML='';

  const imgBtn=document.createElement('button');
  imgBtn.className='ce-tab active'; imgBtn.id='ceTabImg'; imgBtn.textContent='🖼️ Фото';
  imgBtn.onclick=()=>switchMode('image');
  wrap.appendChild(imgBtn);

  if(videoUrls.length){
    videoUrls.forEach((vurl,i)=>{
      const vb=document.createElement('button');
      vb.className='ce-tab'; vb.dataset.vidIdx=i;
      vb.textContent=`▶️ Видео ${videoUrls.length>1?i+1:''}`;
      vb.onclick=()=>switchMode('video',i);
      wrap.appendChild(vb);
    });
  }
}

function switchMode(mode, vidIdx){
  S.mode=mode;
  const img=document.getElementById('ceImg');
  const vid=document.getElementById('ceVideo');
  const vbar=document.getElementById('ceVideoBar');
  const hint=document.getElementById('ceHint');

  document.querySelectorAll('.ce-tab').forEach(b=>b.classList.remove('active'));

  if(mode==='image'){
    document.getElementById('ceTabImg').classList.add('active');
    img.style.display='block'; vid.style.display='none'; vbar.style.display='none';
    hint.style.display='block';
    if(img.src!==S.imgUrl){ img.onload=()=>{ initFrame(); renderMedia(); updateMask(); }; img.src=S.imgUrl; }
    else { initFrame(); renderMedia(); updateMask(); }
  } else {
    const vurl=videoUrls[vidIdx||0];
    S.currentVidIdx=vidIdx||0;
    document.querySelectorAll('.ce-tab[data-vid-idx]')[vidIdx||0]?.classList.add('active');
    img.style.display='none'; vid.style.display='block'; vbar.style.display='flex';
    hint.style.display='none';
    if(vid.src!==vurl){ vid.src=vurl; vid.load(); }
    vid.currentTime=S.videoStart||0;
    vid.onloadedmetadata=()=>{
      document.getElementById('ceVidSeek').max=vid.duration;
      document.getElementById('ceVidSeek').value=vid.currentTime;
      document.getElementById('ceVidTime').textContent=vid.currentTime.toFixed(1)+'s';
      initFrame(); renderMedia(); updateMask();
    };
    if(vid.readyState>=1){ vid.onloadedmetadata(); }
  }
}

// ===== INIT FRAME =====
function initFrame(){
  const stage=document.getElementById('ceStage');
  S.stageW=stage.clientWidth;
  S.stageH=stage.clientHeight;
  applyRatioToFrame();
}

function applyRatioToFrame(){
  if(S.ratio==='free'){
    S.frameX=7; S.frameY=7; S.frameW=86; S.frameH=86;
  } else {
    const [rw,rh]=S.ratio.split('/').map(Number);
    const ar=rw/rh;
    const sw=S.stageW, sh=S.stageH;
    let fw,fh;
    if(ar>sw/sh){ fw=86; fh=fw/ar*(sw/sh); }
    else { fh=86; fw=fh*ar/(sw/sh); }
    S.frameX=(100-fw)/2; S.frameY=(100-fh)/2;
    S.frameW=fw; S.frameH=fh;
  }
  positionFrame();
}

function positionFrame(){
  const f=document.getElementById('ceFrame');
  f.style.left=S.frameX+'%'; f.style.top=S.frameY+'%';
  f.style.width=S.frameW+'%'; f.style.height=S.frameH+'%';
  updateMask();
}

// ===== RENDER MEDIA =====
function renderMedia(){
  const el = S.mode==='image' ? document.getElementById('ceImg') : document.getElementById('ceVideo');
  el.style.transformOrigin=`${S.panX}% ${S.panY}%`;
  el.style.transform=`scale(${S.scale})`;
  el.style.objectPosition=`${S.panX}% ${S.panY}%`;
  const sl=document.getElementById('ceZoomSlider');
  sl.value=Math.round(S.scale*100);
  document.getElementById('ceZoomVal').textContent=Math.round(S.scale*100)+'%';
}

// ===== MASK CANVAS =====
function updateMask(){
  const canvas=document.getElementById('ceMask');
  const stage=document.getElementById('ceStage');
  const W=stage.clientWidth, H=stage.clientHeight;
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(0,0,0,0.58)';
  ctx.fillRect(0,0,W,H);
  // Вырезаем окно рамки
  const fx=S.frameX/100*W, fy=S.frameY/100*H;
  const fw=S.frameW/100*W, fh=S.frameH/100*H;
  ctx.clearRect(fx,fy,fw,fh);
}

// ===== PAN =====
function panStart(e){
  if(e.target.closest('.ce-corner,.ce-edge,.ce-video-bar')) return;
  if(e.button!==undefined && e.button!==0) return;
  S.panning=true;
  const pt=e.touches?e.touches[0]:e;
  S.panLX=pt.clientX; S.panLY=pt.clientY;
  document.getElementById('ceMedia').style.cursor='grabbing';
  e.preventDefault();
}
function panMove(e){
  if(S&&S.resizing){ doResize(e); return; }
  if(!S||!S.panning) return;
  const pt=e.touches?e.touches[0]:e;
  const dx=pt.clientX-S.panLX, dy=pt.clientY-S.panLY;
  S.panLX=pt.clientX; S.panLY=pt.clientY;
  // Переводим px -> %
  const el=S.mode==='image'?document.getElementById('ceImg'):document.getElementById('ceVideo');
  const W=el.clientWidth*S.scale, H=el.clientHeight*S.scale;
  S.panX=clamp(S.panX - dx/W*100, 0, 100);
  S.panY=clamp(S.panY - dy/H*100, 0, 100);
  renderMedia();
  if(e.touches) e.preventDefault();
}
function panEnd(){ if(S){S.panning=false; S.resizing=false; document.getElementById('ceMedia').style.cursor='grab';} }

// ===== RESIZE FRAME =====
function resizeStart(e){
  const corner=e.target.closest('.ce-corner,.ce-edge');
  if(!corner) return;
  S.resizing=true;
  S.resizeH=corner.dataset.h||null;
  S.resizeV=corner.dataset.v||null;
  const pt=e.touches?e.touches[0]:e;
  S.resizeLX=pt.clientX; S.resizeLY=pt.clientY;
  S.frameSnap=S.ratio!=='free'?S.ratio:null;
  e.preventDefault(); e.stopPropagation();
}
function doResize(e){
  const pt=e.touches?e.touches[0]:e;
  const dx=(pt.clientX-S.resizeLX)/S.stageW*100;
  const dy=(pt.clientY-S.resizeLY)/S.stageH*100;
  S.resizeLX=pt.clientX; S.resizeLY=pt.clientY;
  const MIN=10;
  if(S.resizeH==='right')  S.frameW=Math.max(MIN,S.frameW+dx);
  if(S.resizeH==='left'){  S.frameX+=dx; S.frameW=Math.max(MIN,S.frameW-dx); }
  if(S.resizeV==='bottom') S.frameH=Math.max(MIN,S.frameH+dy);
  if(S.resizeV==='top'){   S.frameY+=dy; S.frameH=Math.max(MIN,S.frameH-dy); }
  // Ограничения
  S.frameX=clamp(S.frameX,0,90); S.frameY=clamp(S.frameY,0,90);
  S.frameW=clamp(S.frameW,MIN,100-S.frameX); S.frameH=clamp(S.frameH,MIN,100-S.frameY);
  positionFrame();
  if(e.touches) e.preventDefault();
}

// ===== ZOOM =====
function onWheel(e){ e.preventDefault(); adjustZoom(e.deltaY>0?-0.07:0.07); }
function adjustZoom(d){
  S.scale=clamp(S.scale+d,0.5,4);
  renderMedia();
}

function setRatio(val){
  S.ratio=val;
  document.querySelectorAll('.ce-ratio-btn').forEach(b=>b.classList.toggle('active',b.dataset.val===val));
  applyRatioToFrame();
}

// ===== VIDEO =====
function toggleVideoPlay(){
  const v=document.getElementById('ceVideo');
  v.paused?v.play():v.pause();
  document.getElementById('ceVidPlay').textContent=v.paused?'▶️':'⏸️';
}
function onVidSeek(){
  const v=document.getElementById('ceVideo');
  v.currentTime=+document.getElementById('ceVidSeek').value;
  document.getElementById('ceVidTime').textContent=v.currentTime.toFixed(1)+'s';
}
document.addEventListener('DOMContentLoaded',()=>{
  // Синх слайдера времени видео
  setInterval(()=>{
    if(!S||S.mode!=='video') return;
    const v=document.getElementById('ceVideo');
    if(v&&!v.paused){
      document.getElementById('ceVidSeek').value=v.currentTime;
      document.getElementById('ceVidTime').textContent=v.currentTime.toFixed(1)+'s';
    }
  },200);
});

function captureVideoFrame(){
  const v=document.getElementById('ceVideo');
  S.videoStart=v.currentTime;
  S.videoUrl=v.src;
  document.getElementById('ceVidTime').textContent=v.currentTime.toFixed(1)+'s ✔';
  // Показываем надпись
  const cap=document.getElementById('ceVidCapture');
  cap.textContent='✓ Кадр '+v.currentTime.toFixed(1)+'s';
  cap.style.background='#2a5c3a';
  setTimeout(()=>{ cap.textContent='📸 Снять кадр'; cap.style.background=''; },2000);
}

// ===== RESET / SAVE / CLOSE =====
function doReset(){
  S.panX=50; S.panY=50; S.scale=1.0;
  S.frameX=7; S.frameY=7; S.frameW=86; S.frameH=86;
  renderMedia(); positionFrame();
}

function doSave(){
  if(!onSaveCb){ console.error('[crop] onSaveCb is NULL!'); return; }
  const aspect_ratio = S.ratio!=='free' ? S.ratio :
    (Math.round((S.frameW/S.frameH)*10)/10).toString();
  const result = {
    focal_x:   Math.round(S.panX*10)/10,
    focal_y:   Math.round(S.panY*10)/10,
    scale:     Math.round(S.scale*100)/100,
    aspect_ratio,
    video_url:   S.mode==='video' ? S.videoUrl : null,
    video_start: S.mode==='video' ? Math.round(S.videoStart*10)/10 : null,
  };
  onSaveCb(result);
  closeEditor();
}

function closeEditor(){
  const m=document.getElementById('cropModal');
  if(m) m.classList.remove('open');
  document.body.style.overflow='';
  const v=document.getElementById('ceVideo');
  if(v&&!v.paused) v.pause();
}

function clamp(v,mn,mx){ return Math.max(mn,Math.min(mx,v)); }

})();

// ===== AI FOCAL INTEGRATION =====
// Вызывается из admin.js: openCropEditor(imgUrl, opts, onSave, videoUrls, itemId)
const _origOpenCropEditor = window.openCropEditor;
window.openCropEditor = function(imgUrl, opts, onSave, vUrls, itemId) {
  aiAnalysis = [];
  _origOpenCropEditor && _origOpenCropEditor(imgUrl, opts, onSave, vUrls);
  // Сохраняем itemId на кнопке и загружаем AI-анализ
  if(itemId) {
    requestAnimationFrame(() => {
      const btn = document.getElementById('ceAiFocal');
      if(btn) btn.dataset.itemId = String(itemId);
    });
    loadAiAnalysis(itemId);
  }
};

async function loadAiAnalysis(itemId) {
  try {
    const r = await fetch(`/api/admin/items/${itemId}/ai-focal`, {
      headers: {'X-Admin-Token': (window.ADMIN_TOKEN || localStorage.getItem('adminToken') || '')}
    });
    if(!r.ok) return;
    const data = await r.json();
    aiAnalysis = data.analysis || [];
    updateAiButton();
  } catch(e) { console.warn('AI focal load failed', e); }
}

function updateAiButton() {
  const btn = document.getElementById('ceAiFocal');
  if(!btn) return;
  if(aiAnalysis.length > 0) {
    btn.textContent = '\uD83C\uDFAF AI';
    btn.style.background = '#e8f4e8';
    btn.title = `AI предлагает ${aiAnalysis.length} анализов. Нажми чтобы применить.`;
  } else {
    btn.textContent = '\uD83C\uDFAF Анализ...';
    btn.style.background = '';
  }
}

async function applyAiSuggestion() {
  if(!S) return;
  // Если aiAnalysis пусто — запросить
  if(!aiAnalysis.length) {
    const btn = document.getElementById('ceAiFocal');
    if(!btn) return;
    btn.textContent = '\uD83D\uDD04 Запрашиваю...';
    btn.disabled = true;
    const itemId = btn.dataset.itemId;
    if(itemId) {
      try {
        const r = await fetch(`/api/admin/items/${itemId}/ai-focal`, {
          method: 'POST',
          headers: {'X-Admin-Token': (window.ADMIN_TOKEN || localStorage.getItem('adminToken') || '')}
        });
        const data = await r.json();
        aiAnalysis = data.analysis || [];
      } catch(e){}
    }
    btn.textContent = '\uD83C\uDFAF AI';
    btn.disabled = false;
    if(!aiAnalysis.length) { alert('Нет AI-анализа. Проверьте настройки.'); return; }
  }

  // Находим лучшее фото (макс quality_score, confidence != low)
  const good = aiAnalysis
    .filter(a => a.confidence !== 'low' && a.object_size !== 'small')
    .sort((a,b) => b.quality_score - a.quality_score);
  const best = good[0] || aiAnalysis[0];

  if(!best) return;

  const msg = [
    `Фото ${best.photo_index}: ${best.photo_type || 'other'}`,
    `Качество: ${best.quality_score}/100`,
    `Объект: ${best.object_size}`,
    `Уверенность: ${best.confidence}`,
    best.skip_reason ? `Замечание: ${best.skip_reason}` : null,
    `Focal: x=${(best.suggested_focal_x*100).toFixed(0)}%, y=${(best.suggested_focal_y*100).toFixed(0)}%`,
    `Кроп: ${best.suggested_crop}`,
    best.suggested_title ? `Название: "${best.suggested_title}"` : null,
    '',
    'Применить эти настройки?'
  ].filter(x=>x!==null).join('\n');

  if(!confirm(msg)) return;

  // Применяем
  S.panX = best.suggested_focal_x * 100;
  S.panY = best.suggested_focal_y * 100;
  if(best.suggested_crop && best.suggested_crop !== 'free') {
    setRatio(best.suggested_crop);
  }
  renderMedia();

  // Показываем панель анализа slideshow
  showSlideshowPanel(best);
}

function showSlideshowPanel(best) {
  let panel = document.getElementById('ceAiPanel');
  if(!panel) {
    panel = document.createElement('div');
    panel.id = 'ceAiPanel';
    panel.style.cssText = 'position:absolute;bottom:48px;left:0;right:0;background:rgba(0,0,0,0.85);color:#fff;padding:10px 16px;font-size:12px;z-index:10;border-top:1px solid #555;';
    document.querySelector('.ce-stage')?.appendChild(panel);
  }

  const slides = aiAnalysis.filter(a => a.photo_index !== best.photo_index);
  const toShow = slides.filter(a => a.include_in_slideshow !== false && a.photo_type !== 'packaging');
  const toHide = slides.filter(a => a.include_in_slideshow === false || a.photo_type === 'packaging');

  panel.innerHTML = `
    <b>🤖 AI анализ слайдшоу</b>
    <span style="float:right;cursor:pointer" onclick="this.parentNode.remove()">×</span><br>
    ${ toShow.length ? `✅ Включить в слайдшоу: фото ${toShow.map(a=>a.photo_index).join(', ')} (${toShow.map(a=>a.photo_type).join(', ')})` : '' }
    ${ toHide.length ? `<br>🚫 Скрыть: фото ${toHide.map(a=>a.photo_index).join(', ')} (${toHide.map(a=>a.skip_reason||a.photo_type).join(', ')})` : '' }
    ${ slides.filter(a=>a.confidence==='low').length ? `<br>⚠️ Низкая уверенность: фото ${slides.filter(a=>a.confidence==='low').map(a=>a.photo_index).join(', ')} — проверьте вручную` : '' }
  `;
}
