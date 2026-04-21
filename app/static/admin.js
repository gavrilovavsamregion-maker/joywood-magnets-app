'use strict';

const API = '/api/admin';
const TOKEN_KEY = 'adminToken';
let TOKEN = '';
let categories = ['Декор','Мебель','Кухня','Полки','Шкатулки','Игрушки','Светильники','Рамки','Арт/резьба','Для улицы','Другое'];
const WOOD_TYPES = ['Берёза','Дуб','Сосна','Ель','Аспен','Липа','Ольха','Цедр','Орех','Грецкий орех','Акация','Тика','Бамбук','Другая'];

// ===== AUTH =====
document.getElementById('authBtn').onclick = doLogin;
document.getElementById('tokenInput').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });

async function doLogin(){
  const t = document.getElementById('tokenInput').value.trim();
  if(!t){ showAuthError('Введите токен'); return; }
  try {
    const r = await fetch(`${API}/queue`, { headers: {'X-Admin-Token': t} });
    if(r.status===403||r.status===401){ showAuthError('Неверный токен'); return; }
    TOKEN = t;
    window.ADMIN_TOKEN = t;
    localStorage.setItem(TOKEN_KEY, t);
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('adminApp').style.display = 'block';
    initAdmin();
  } catch(e) { showAuthError('Ошибка соединения'); }
}

function showAuthError(msg){ document.getElementById('authError').textContent = msg; }

// Автологин если токен сохранён
(function(){
  const saved = localStorage.getItem(TOKEN_KEY);
  if(saved){
    document.getElementById('tokenInput').value = saved;
    TOKEN = saved;
    window.ADMIN_TOKEN = saved;
    // тихо проверяем
    fetch(`${API}/queue`, { headers: {'X-Admin-Token': saved} }).then(r=>{
      if(r.ok){
        document.getElementById('authScreen').style.display='none';
        document.getElementById('adminApp').style.display='block';
        initAdmin();
      } else { localStorage.removeItem(TOKEN_KEY); }
    }).catch(()=>{});
  }
})();

// ===== TABS =====
function initAdmin(){
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  document.getElementById('btnSync').onclick = doSync;
  document.getElementById('catAddBtn').onclick = addCategory;
  document.getElementById('catAddInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addCategory(); });
  document.getElementById('pubSearch').oninput = debounce(loadPublished, 300);
  document.getElementById('pubCatFilter').onchange = loadPublished;
  document.getElementById('pubWoodFilter').onchange = loadPublished;
  buildCatManager();
  loadQueue();
  loadPublished();
  bindHotkeys();
}

function switchTab(name){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+name));
  if(name==='published') {
    if(!pubItems.length) loadPublished();
    else requestAnimationFrame(renderPubGrid);
  }
}

// ===== SYNC =====
async function doSync(){
  const btn = document.getElementById('btnSync');
  btn.textContent = '↻ Синхронизация...';
  btn.disabled = true;
  try {
    const r = await apiFetch(`${API}/sync`, {method:'POST'});
    const d = await r.json();
    btn.textContent = '✓ Готово';
    setTimeout(()=>{ btn.textContent='↻ Синхронизировать'; btn.disabled=false; }, 3000);
    loadQueue();
  } catch(e){
    btn.textContent = '✗ Ошибка';
    setTimeout(()=>{ btn.textContent='↻ Синхронизировать'; btn.disabled=false; }, 3000);
  }
}

// ===== CATEGORY MANAGER =====
function buildCatManager(){
  const wrap = document.getElementById('catManager');
  wrap.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('span');
    chip.className = 'cat-chip';
    chip.innerHTML = `${esc(cat)} <span class="cat-chip-del" data-cat="${esc(cat)}">×</span>`;
    chip.querySelector('.cat-chip-del').onclick = () => removeCategory(cat);
    wrap.appendChild(chip);
  });
}

function addCategory(){
  const inp = document.getElementById('catAddInput');
  const val = inp.value.trim();
  if(!val || categories.includes(val)) { inp.value=''; return; }
  categories.push(val);
  inp.value = '';
  buildCatManager();
}

function removeCategory(cat){
  categories = categories.filter(c=>c!==cat);
  buildCatManager();
}

// ===== QUEUE =====
let queueItems = [];
let queueCursor = 0;
let statsOk = 0, statsFail = 0;

async function loadQueue(){
  try {
    const r = await apiFetch(`${API}/queue`);
    const d = await r.json();
    queueItems = d.items || [];
    queueCursor = 0;
    statsOk = 0; statsFail = 0;
    updateProgress(d.approved||0, d.rejected||0, d.count||0);
    document.getElementById('queueTabCount').textContent = queueItems.length;
    renderQueue();
  } catch(e){ console.error('loadQueue', e); }
}

function updateProgress(ok, fail, left){
  document.getElementById('progressStats').innerHTML =
    `<span class="p-ok">✓ одобрено: ${ok}</span>` +
    `<span class="p-skip">✗ пропущено: ${fail}</span>` +
    `<span class="p-left">⏳ осталось: ${left}</span>`;
}

function renderQueue(){
  const grid = document.getElementById('queueGrid');
  const empty = document.getElementById('emptyQueue');
  if(!queueItems.length){
    grid.innerHTML = ''; empty.style.display='block'; return;
  }
  empty.style.display = 'none';
  grid.innerHTML = '';
  queueItems.forEach((item, idx) => {
    grid.appendChild(makeQueueCard(item, idx));
  });
  // Подсветим текущий
  highlightQueue(queueCursor);
}

function makeQueueCard(item, idx){
  const photos = safeArr(item.photos);
  const videos = safeArr(item.videos);
  const cover = photos[0]?.url || '';
  const stars = item.rating ? '★'.repeat(item.rating) + '☆'.repeat(5-item.rating) : '';

  const card = document.createElement('div');
  card.className = 'queue-card';
  card.dataset.idx = idx;
  card.dataset.id = item.id;

  // Полоска фото
  const visPhotos = photos;
  let stripHtml = '';
  visPhotos.forEach((p,i) => {
    stripHtml += `<div class="ph-thumb" data-idx="${i}" data-url="${esc(p.url)}">
      <img src="${esc(p.url)}" loading="lazy">
    </div>`;
  });

  const aiScore = item.ai_score ? `<span class="queue-ai-score" title="AI score">${item.ai_score}</span>` : '';
  const aiTitle = item.ai_title || item.product_name || '';

  card.innerHTML = `
    <div class="ph-strip">${stripHtml}</div>
    <div class="queue-body">
      <div class="queue-cover-wrap">
        ${ cover ? `<img class="queue-cover" src="${esc(cover)}" loading="lazy">` : '<div class="queue-cover" style="background:#f0ede7"></div>' }
      </div>
      <div class="queue-info">
        <div class="queue-product">${esc(item.product_name||'')}</div>
        <div class="queue-rating">${stars}</div>
        <div class="queue-text">${esc((item.review_text||'').slice(0,200))}</div>
        <div class="queue-fields">
          <input class="title-input" type="text" placeholder="Название" value="${esc(aiTitle)}">
          <select class="cat-select">
            ${categories.map(c=>`<option value="${esc(c)}" ${c===(item.ai_category||'Другое')?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
          <select class="wood-select">
            <option value="">— Порода —</option>
            ${WOOD_TYPES.map(w=>`<option value="${esc(w)}">${esc(w)}</option>`).join('')}
          </select>
          <input class="url-input" type="text" placeholder="Ссылка на товар" value="${esc(item.product_url||'')}">
        </div>
        <div class="queue-actions">
          <button class="btn-approve">✓ Одобрить</button>
          <button class="btn-reject">✗ Пропустить</button>
        </div>
        ${aiScore}
      </div>
    </div>`;

  // Клик по миниатюре — смена обложки
  card.querySelectorAll('.ph-thumb').forEach(th => {
    th.onclick = () => {
      const url = th.dataset.url;
      const coverImg = card.querySelector('.queue-cover');
      if(coverImg) { coverImg.src = url; }
      card.querySelectorAll('.ph-thumb').forEach(t=>t.classList.remove('active'));
      th.classList.add('active');
      card._coverUrl = url;
    };
  });
  card._coverUrl = cover;

  card.querySelector('.btn-approve').onclick = (e) => { e.stopPropagation(); approveItem(card, item, idx); };
  card.querySelector('.btn-reject').onclick  = (e) => { e.stopPropagation(); rejectItem(card, item, idx); };
  card.onclick = () => highlightQueue(idx);

  return card;
}

async function approveItem(card, item, idx){
  const title = card.querySelector('.title-input').value.trim() || item.ai_title || item.product_name || 'Работа мастера';
  const category = card.querySelector('.cat-select').value || 'Другое';
  const wood_type = card.querySelector('.wood-select').value || null;
  const product_url = card.querySelector('.url-input').value.trim() || null;
  const cover_url = card._coverUrl || null;

  try {
    const r = await apiFetch(`${API}/queue/${item.id}/approve`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title, category, wood_type, product_url, cover_url, ai_tags: [] })
    });
    if(!r.ok) throw new Error(await r.text());
    const d = await r.json();
    card.classList.add('approved');
    card.style.opacity = '0.4';
    statsOk++;
    removeQueueItem(idx);
    loadPublished();
  } catch(e){ alert('Ошибка: '+e.message); }
}

async function rejectItem(card, item, idx){
  try {
    await apiFetch(`${API}/queue/${item.id}/reject`, {method:'POST'});
    card.classList.add('rejected');
    card.style.opacity = '0.4';
    statsFail++;
    removeQueueItem(idx);
  } catch(e){ alert('Ошибка: '+e.message); }
}

function removeQueueItem(idx){
  queueItems.splice(idx, 1);
  document.getElementById('queueTabCount').textContent = queueItems.length;
  updateProgress(
    parseInt(document.querySelector('.p-ok')?.textContent.split(': ')[1]||0) + (statsOk?1:0),
    parseInt(document.querySelector('.p-skip')?.textContent.split(': ')[1]||0) + (statsFail?1:0),
    queueItems.length
  );
  statsOk = 0; statsFail = 0;
  if(queueCursor >= queueItems.length) queueCursor = Math.max(0, queueItems.length-1);
  renderQueue();
}

function highlightQueue(idx){
  queueCursor = idx;
  document.querySelectorAll('.queue-card').forEach((c,i)=>{
    c.classList.toggle('active', i===idx);
  });
  const active = document.querySelectorAll('.queue-card')[idx];
  if(active) active.scrollIntoView({behavior:'smooth', block:'nearest'});
}

// ===== HOTKEYS =====
function bindHotkeys(){
  document.addEventListener('keydown', e => {
    // Не срабатывает если фокус в input/textarea
    if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    const card = document.querySelectorAll('.queue-card')[queueCursor];
    if(!card) return;
    const item = queueItems[queueCursor];
    if(!item) return;
    if(e.key==='Enter'||e.key==='ArrowRight'){
      e.preventDefault();
      if(e.key==='Enter') approveItem(card, item, queueCursor);
      else highlightQueue(Math.min(queueCursor+1, queueItems.length-1));
    } else if(e.key==='Delete'||e.key==='Backspace'||e.key==='ArrowLeft'){
      e.preventDefault();
      if(e.key!=='ArrowLeft') rejectItem(card, item, queueCursor);
      else highlightQueue(Math.max(queueCursor-1, 0));
    } else if(e.key==='ArrowDown'){
      e.preventDefault(); highlightQueue(Math.min(queueCursor+1, queueItems.length-1));
    } else if(e.key==='ArrowUp'){
      e.preventDefault(); highlightQueue(Math.max(queueCursor-1, 0));
    }
  });
}


// ===== PUBLISHED — JUSTIFIED GRID + DRAWER =====

let pubItems = [];
let drawerItem = null;   // текущий открытый элемент
let drawerCard = null;   // DOM-карточка
let drawerBackup = null; // для кнопки отмены AI

async function loadPublished(){
  const search = document.getElementById('pubSearch')?.value||'';
  const cat    = document.getElementById('pubCatFilter')?.value||'';
  const wood   = document.getElementById('pubWoodFilter')?.value||'';
  try {
    const params = new URLSearchParams({limit:500, offset:0});
    if(search) params.set('search', search);
    if(cat)    params.set('category', cat);
    if(wood)   params.set('wood_type', wood);
    const r = await apiFetch(`${API}/items?${params}`);
    const d = await r.json();
    pubItems = d.items||[];
    document.getElementById('pubTabCount').textContent = pubItems.length;
    document.getElementById('pubCount').textContent = `${pubItems.length} работ`;
    buildPubFilters(pubItems);
    renderPubGrid();
  } catch(e){ console.error('loadPublished', e); }
}

function buildPubFilters(items){
  const catSel  = document.getElementById('pubCatFilter');
  const woodSel = document.getElementById('pubWoodFilter');
  const curCat  = catSel.value, curWood = woodSel.value;
  const cats  = [...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  const woods = [...new Set(items.map(i=>i.wood_type).filter(Boolean))].sort();
  catSel.innerHTML  = '<option value="">Все категории</option>' + cats.map(c=>`<option value="${esc(c)}" ${c===curCat?'selected':''}>${esc(c)}</option>`).join('');
  woodSel.innerHTML = '<option value="">Все породы</option>'    + woods.map(w=>`<option value="${esc(w)}" ${w===curWood?'selected':''}>${esc(w)}</option>`).join('');
}

// ===== JUSTIFIED LAYOUT (Flickr) =====
function parseAR(str){
  if(!str) return 1;
  if(str.includes('/')){
    const [a,b]=str.split('/').map(Number);
    return b?a/b:1;
  }
  return parseFloat(str)||1;
}

function justifiedLayout(items, containerWidth, targetRowHeight, spacing){
  const boxes=[];
  let row=[],rowAR=0;
  const sp=spacing||8;
  function flushRow(rowItems,ar,last){
    const scale=last&&rowItems.length<2
      ?1
      :(containerWidth-sp*(rowItems.length-1))/ar;
    const h=last&&rowItems.length<2
      ?Math.min(targetRowHeight,containerWidth/ar)
      :Math.round(scale);
    let x=0;
    rowItems.forEach((item,i)=>{
      const w=i===rowItems.length-1?containerWidth-x:Math.round(item._ar*h);
      boxes.push({item,x,w,h});
      x+=w+sp;
    });
  }
  items.forEach(item=>{
    const ar=parseAR(item.cover_aspect_ratio)||1;
    item._ar=ar;
    row.push(item);
    rowAR+=ar;
    const rowWidth=rowAR*targetRowHeight+sp*(row.length-1);
    if(rowWidth>=containerWidth){flushRow(row,rowAR,false);row=[];rowAR=0;}
  });
  if(row.length) flushRow(row,rowAR,true);
  return boxes;
}

function computeTop(boxes,idx,spacing){
  if(idx===0) return 0;
  const cur=boxes[idx];
  let rowStart=idx;
  while(rowStart>0&&boxes[rowStart].x!==0) rowStart--;
  if(rowStart===0) return 0;
  let prevRowStart=rowStart-1;
  while(prevRowStart>0&&boxes[prevRowStart].x!==0) prevRowStart--;
  return computeTop(boxes,prevRowStart,spacing)+boxes[prevRowStart].h+spacing;
}

function renderPubGrid(){
  const grid  = document.getElementById('pubGrid');
  const empty = document.getElementById('emptyPub');
  if(!pubItems.length){grid.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  grid.innerHTML='';
  grid.style.position='relative';

  const containerWidth = grid.offsetWidth;
  if(!containerWidth){ requestAnimationFrame(renderPubGrid); return; }
  const targetRowHeight = Math.round(containerWidth/3.5);
  const spacing = 8;

  const boxes = justifiedLayout(pubItems, containerWidth, targetRowHeight, spacing);
  let maxBottom=0;

  boxes.forEach(({item,x,w,h},idx)=>{
    const top = computeTop(boxes,idx,spacing);
    const card = makePubGridCard(item,w,h);
    card.style.cssText=`position:absolute;left:${x}px;top:${top}px;width:${w}px;height:${h+54}px;`;
    grid.appendChild(card);
    maxBottom=Math.max(maxBottom,top+h+54);
  });
  grid.style.height=maxBottom+'px';
}

function makePubGridCard(item,w,h){
  const photos = safeArr(item.photos);
  const cover  = item.cover_url||photos[0]?.url||'';
  const fx     = item.cover_focal_x??50;
  const fy     = item.cover_focal_y??50;
  const sc     = item.cover_scale||1.0;
  const hasVideo = item.cover_video_url;

  const card = document.createElement('div');
  card.className='pub-grid-card';
  card.dataset.id=item.id;

  card.innerHTML=`
    <div class="pgc-img-wrap" style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border-radius:7px;cursor:pointer;">
      ${cover
        ?`<img class="pgc-cover" src="${esc(cover)}"
            style="width:100%;height:100%;object-fit:cover;object-position:${fx}% ${fy}%;transform:scale(${sc});transform-origin:${fx}% ${fy}%;display:block;">
           ${hasVideo?'<div class="pgc-video-badge">▶</div>':''}`
        :'<div style="width:100%;height:100%;background:#f0ede7"></div>'}
      <div class="pgc-hover-btns">
        <button class="pgc-btn pgc-edit" title="Редактировать">✎</button>
        <button class="pgc-btn pgc-ai"   title="AI focal">🎯</button>
        <button class="pgc-btn pgc-del"  title="Удалить">🗑</button>
      </div>
    </div>
    <div class="pgc-title">${esc(item.title||'Работа мастера')}</div>`;

  // Через фото или кнопку редактирования— открыть drawer
  card.querySelector('.pgc-img-wrap').onclick = (e) => {
    if(e.target.classList.contains('pgc-btn')) return;
    openDrawer(item, card);
  };
  card.querySelector('.pgc-edit').onclick = (e) => { e.stopPropagation(); openDrawer(item, card); };
  card.querySelector('.pgc-ai').onclick   = (e) => { e.stopPropagation(); runAiOnCard(item, card); };
  card.querySelector('.pgc-del').onclick  = (e) => { e.stopPropagation(); deleteItemFromGrid(item, card); };

  return card;
}

// ===== DRAWER =====
function openDrawer(item, card){
  try {
  drawerItem   = item;
  drawerCard   = card;
  drawerBackup = {
    cover_url:          item.cover_url,
    cover_focal_x:      item.cover_focal_x??50,
    cover_focal_y:      item.cover_focal_y??50,
    cover_scale:        item.cover_scale||1,
    cover_aspect_ratio: item.cover_aspect_ratio||'1/1',
    title:              item.title,
  };

  const drawer  = document.getElementById('pubDrawer');
  const overlay = document.getElementById('pubDrawerOverlay');
  if(!drawer){ console.error('DRAWER: #pubDrawer not found!'); return; }
  buildDrawerContent(item);
  drawer.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow='hidden';
  console.log('Drawer opened, right=', drawer.style.right, 'classes=', drawer.className);
  } catch(err) { console.error('DRAWER ERROR:', err); alert('Ошибка drawer: '+err.message); }
}

function closeDrawer(){
  document.getElementById('pubDrawer').classList.remove('open');
  document.getElementById('pubDrawerOverlay').classList.remove('open');
  document.body.style.overflow='';
  drawerItem=null; drawerCard=null;
}

function buildDrawerContent(item){
  console.log('buildDrawerContent called, item.id=', item.id, 'photos type=', typeof item.photos);
  const photos   = safeArr(item.photos);
  const videos   = safeArr(item.videos);
  const hiddenIdx= safeArr(item.hidden_photo_indices);
  const ai       = safeArr(item.ai_photo_analysis);
  const cover    = item.cover_url||photos[0]?.url||'';
  const fx       = item.cover_focal_x??50;
  const fy       = item.cover_focal_y??50;
  const sc       = item.cover_scale||1.0;
  const ar       = item.cover_aspect_ratio||'1/1';

  // Полоска миниатюр
  let stripHtml='';
  photos.forEach((p,i)=>{
    const hidden=hiddenIdx.includes(i);
    const isActive=p.url===cover;
    const aiInfo=ai.find(a=>a.photo_index===i);
    const score=aiInfo?`<span class="dph-score" style="background:${aiInfo.confidence==='high'?'#2a7a2a':'#7a5a00'}">${aiInfo.quality_score}</span>`:""; 
    stripHtml+=`<div class="dph-thumb${hidden?' dph-hidden':''}${isActive?' dph-active':''}" data-i="${i}" data-url="${esc(p.url)}">
      <img src="${esc(p.url)}" loading="lazy">
      ${score}
      <span class="dph-eye" data-i="${i}">${hidden?'🚫':'👁'}</span>
      <span class="dph-star" data-i="${i}" title="Сделать обложкой">⭐</span>
    </div>`;
  });

  // autoplay
  const am=item.autoplay_mode||'';

  // Превью в левую колонку
  const previewPane = document.getElementById('drPreviewPane');
  if(previewPane) previewPane.innerHTML = `
    <div class="dr-preview-wrap" style="width:100%;height:100%;border-radius:0;background:#111;position:relative;overflow:hidden;">
      <img id="drPreviewImg" src="${esc(cover)}" style="width:100%;height:100%;object-fit:cover;object-position:${fx}% ${fy}%;transform:scale(${sc});transform-origin:${fx}% ${fy}%;display:block;">
    </div>
    <div class="dph-strip" style="padding:8px;background:#111;">${stripHtml}</div>
  `;
  document.getElementById('drawerBody').innerHTML=`
    <div class="dr-fields">
      <label class="dr-label">Название</label>
      <input id="drTitleInput" class="dr-input" type="text" value="${esc(item.title||'')}">
      <label class="dr-label">Категория</label>
      <select id="drCat" class="dr-select">
        ${categories.map(c=>`<option value="${esc(c)}" ${c===item.category?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <label class="dr-label">Порода дерева</label>
      <select id="drWood" class="dr-select">
        <option value="">— Не указана —</option>
        ${WOOD_TYPES.map(w=>`<option value="${esc(w)}" ${w===item.wood_type?'selected':''}>${esc(w)}</option>`).join('')}
      </select>
      <label class="dr-label">Ссылка на товар</label>
      <input id="drUrl" class="dr-input" type="text" value="${esc(item.custom_product_url||item.product_url||'')}">
      <label class="dr-label">Автоплей</label>
      <div class="dr-radio-row">
        <label><input type="radio" name="dr_ap" value="slideshow" ${am==='slideshow'?'checked':''}> Слайдшоу</label>
        <label><input type="radio" name="dr_ap" value="video" ${am==='video'?'checked':''}> Видео</label>
        <label><input type="radio" name="dr_ap" value="off" ${am==='off'?'checked':''}> Выкл</label>
      </div>
      <label class="dr-label">Масштаб в галерее</label>
      <select id="drDisplaySize" class="dr-select">
        <option value="small" ${(item.display_size||'normal')==='small'?'selected':''}>🔹 Маленький (украшения, ложки)</option>
        <option value="normal" ${(item.display_size||'normal')==='normal'?'selected':''}>▪️ Обычный</option>
        <option value="large" ${(item.display_size||'normal')==='large'?'selected':''}>🔷 Большой (панно, иконы, мебель)</option>
        <option value="full" ${(item.display_size||'normal')==='full'?'selected':''}>🖼️ На всю ширину</option>
      </select>
      <label class="dr-size-manual-label">
        <input type="checkbox" id="drDisplaySizeManual" ${item.display_size_manual?'checked':''}>
        <span>Зафиксировать (AI не перезапишет)</span>
      </label>
    </div>
    <div class="dr-actions">
      <button class="dr-btn dr-save">💾 Сохранить</button>
      <button class="dr-btn dr-crop">✂ Кроп</button>
      <button class="dr-btn dr-ai">🎯 AI</button>
      <button class="dr-btn dr-undo" id="drUndo" style="display:none">↩ Отменить AI</button>
      <button class="dr-btn dr-duplicate" id="drDuplicate">⧉ Дублировать</button>
    </div>`;

  const _db = document.getElementById('drawerBody');
  // Полоска: глаз + звезда
  document.querySelectorAll('.dph-eye').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();toggleDrawerPhotoHidden(item,+btn.dataset.i);};
  });
  document.querySelectorAll('.dph-star').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();setDrawerCover(item,+btn.dataset.i);};
  });
  document.querySelectorAll('.dph-thumb').forEach(th=>{
    th.onclick=e=>{
      if(e.target.classList.contains('dph-eye')||e.target.classList.contains('dph-star')) return;
      setDrawerCover(item,+th.dataset.i);
    };
  });

  // Автоплей
  document.querySelectorAll('input[name="dr_ap"]').forEach(r=>{
    r.onchange=()=>patchItem(item.id,{autoplay_mode:r.value});
  });

  // Масштаб в галерее
  const drDS = document.getElementById('drDisplaySize');
  const drDSM = document.getElementById('drDisplaySizeManual');
  if(drDS) drDS.onchange = async () => {
    const ds = drDS.value;
    if(drDSM) drDSM.checked = true;
    await patchItem(item.id, {display_size: ds, display_size_manual: true});
    item.display_size = ds;
    item.display_size_manual = true;
    updateGridCard(item);
  };
  if(drDSM) drDSM.onchange = async () => {
    await patchItem(item.id, {display_size_manual: drDSM.checked});
    item.display_size_manual = drDSM.checked;
  };

  // Сохранить
  _db.querySelector('.dr-save').onclick=async()=>{
    await patchItem(item.id,{
      title:    document.getElementById('drTitleInput').value.trim(),
      category: document.getElementById('drCat').value,
      wood_type:document.getElementById('drWood').value||null,
      product_url: document.getElementById('drUrl').value.trim()||null,
    });
    item.title    = document.getElementById('drTitleInput').value.trim();
    item.category = document.getElementById('drCat').value;
    // Обновляем подпись на карточке
    if(drawerCard){
      const tEl=drawerCard.querySelector('.pgc-title');
      if(tEl) tEl.textContent=item.title;
    }
  };

  // Кроп
  _db.querySelector('.dr-crop').onclick=()=>{
    const videoUrls=safeArr(item.videos).map(v=>v.url||v).filter(Boolean);
    openCropEditor(
      item.cover_url||photos[0]?.url||'',
      {focal_x:fx,focal_y:fy,scale:sc,aspect_ratio:ar,video_url:item.cover_video_url||'',video_start:item.cover_video_start||0},
      async(result)=>{
        await patchItem(item.id,{
          cover_focal_x:result.focal_x, cover_focal_y:result.focal_y,
          cover_scale:result.scale, cover_aspect_ratio:result.aspect_ratio,
          cover_video_url:result.video_url||null, cover_video_start:result.video_start||0,
        });
        item.cover_focal_x=result.focal_x; item.cover_focal_y=result.focal_y;
        item.cover_scale=result.scale;     item.cover_aspect_ratio=result.aspect_ratio;
        item.cover_video_url=result.video_url||null;
        item.cover_video_start=result.video_start||0;
        // Синхронизируем pubItems
        const _pi = pubItems.findIndex(x=>x.id===item.id);
        if(_pi>=0) Object.assign(pubItems[_pi], {
          cover_focal_x: item.cover_focal_x,
          cover_focal_y: item.cover_focal_y,
          cover_scale:   item.cover_scale,
          cover_aspect_ratio: item.cover_aspect_ratio,
          cover_video_url:   item.cover_video_url,
          cover_video_start: item.cover_video_start,
        });
        updateDrawerPreview(item);
        renderPubGrid();
      },
      videoUrls, item.id
    );
  };

  // AI
  _db.querySelector('.dr-ai').onclick=()=>runAiOnCard(item, drawerCard, true);

  // Undo
  document.getElementById('drUndo').onclick=async()=>{
    if(!drawerBackup) return;
    await patchItem(item.id,drawerBackup);
    Object.assign(item,drawerBackup);
    updateDrawerPreview(item);
    updateGridCard(item);
    document.getElementById('drUndo').style.display='none';
  };

  document.getElementById('drDuplicate').onclick=async()=>{
    const btn = document.getElementById('drDuplicate');
    btn.disabled=true; btn.textContent='⧉ Копирую...';
    try{
      const r = await apiFetch(`${API}/items/${item.id}/duplicate`,{method:'POST'});
      const d = await r.json();
      if(!r.ok) throw new Error(d.detail||'Ошибка');
      btn.textContent='✅ Создано';
      setTimeout(()=>{ btn.textContent='⧉ Дублировать'; btn.disabled=false; },2000);
      // Перезагружаем сетку чтобы новая карточка появилась
      await loadPublished();
    }catch(e){
      alert('Ошибка: '+ e.message);
      btn.textContent='⧉ Дублировать'; btn.disabled=false;
    }
  };
}

function updateDrawerPreview(item){
  const img=document.getElementById('drPreviewImg');
  if(!img) return;
  const fx=item.cover_focal_x??50;
  const fy=item.cover_focal_y??50;
  // aspect-ratio обновляем на родитель
  const pw=img.closest('.dr-preview-wrap'); if(pw) pw.style.aspectRatio='';
  const sc=item.cover_scale||1;
  img.src=item.cover_url||'';
  img.style.objectPosition=`${fx}% ${fy}%`;
  img.style.transform=`scale(${sc})`;
  img.style.transformOrigin=`${fx}% ${fy}%`;
  const wrap=img.parentElement;
  if(wrap&&item.cover_aspect_ratio) wrap.style.aspectRatio=item.cover_aspect_ratio;
}

function updateGridCard(item){
  const card=document.querySelector(`.pub-grid-card[data-id="${item.id}"]`);
  if(!card) return;
  const img=card.querySelector('.pgc-cover');
  if(img){
    const fx=item.cover_focal_x??50;
    const fy=item.cover_focal_y??50;
    const sc=item.cover_scale||1;
    img.src=item.cover_url||img.src;
    img.style.objectPosition=`${fx}% ${fy}%`;
    img.style.transform=`scale(${sc})`;
    img.style.transformOrigin=`${fx}% ${fy}%`;
  }
  const tEl=card.querySelector('.pgc-title');
  if(tEl) tEl.textContent=item.title||'Работа мастера';
}

function setDrawerCover(item, photoIdx){
  const photos=safeArr(item.photos);
  const url=photos[photoIdx]?.url;
  if(!url) return;
  item.cover_url=url;
  patchItem(item.id,{cover_url:url});
  document.querySelectorAll('.dph-thumb').forEach((t,i)=>t.classList.toggle('dph-active',i===photoIdx));
  updateDrawerPreview(item);
  updateGridCard(item);
}

function toggleDrawerPhotoHidden(item, photoIdx){
  const hidden=safeArr(item.hidden_photo_indices);
  const newHidden=hidden.includes(photoIdx)?hidden.filter(i=>i!==photoIdx):[...hidden,photoIdx];
  item.hidden_photo_indices=newHidden;
  patchItem(item.id,{hidden_photo_indices:newHidden});
  const thumb=document.querySelectorAll('.dph-thumb')[photoIdx];
  if(thumb){
    thumb.classList.toggle('dph-hidden',newHidden.includes(photoIdx));
    const eye=thumb.querySelector('.dph-eye');
    if(eye) eye.textContent=newHidden.includes(photoIdx)?'🚫':'👁';
  }
}

async function deleteItemFromGrid(item, card){
  if(!confirm(`Удалить «${item.title}»?`)) return;
  try {
    const r=await apiFetch(`${API}/items/${item.id}`,{method:'DELETE'});
    if(!r.ok) throw new Error(await r.text());
    card.remove();
    pubItems=pubItems.filter(i=>i.id!==item.id);
    document.getElementById('pubTabCount').textContent=pubItems.length;
    document.getElementById('pubCount').textContent=`${pubItems.length} работ`;
    if(drawerItem?.id===item.id) closeDrawer();
  } catch(e){ alert('Ошибка: '+e.message); }
}

// AI для карточки (isDrawer=true — обновляет дравер)
async function runAiOnCard(item, card, isDrawer=false){
  const aiBtn=isDrawer
    ?_db.querySelector('.dr-ai')
    :(card?.querySelector('.pgc-ai'));
  if(aiBtn){aiBtn.textContent='⏳...';aiBtn.disabled=true;}
  try{
    let r=await apiFetch(`${API}/items/${item.id}/ai-focal`);
    let data=await r.json();
    let analysis=data.analysis||[];
    if(!analysis.length){
      if(aiBtn) aiBtn.textContent='🔄 Анализ...';
      r=await apiFetch(`${API}/items/${item.id}/ai-focal`,{method:'POST'});
      data=await r.json();
      analysis=data.analysis||[];
    }
    if(!analysis.length){alert('Нет AI-анализа');return;}

    const hidden=safeArr(item.hidden_photo_indices);
    const good=analysis
      .filter(a=>a.confidence!=='low'&&a.photo_type!=='packaging'&&!hidden.includes(a.photo_index))
      .sort((a,b)=>b.quality_score-a.quality_score);
    const best=good[0]||analysis[0];

    const photos=safeArr(item.photos);
    const newCover=photos[best.photo_index]?.url||item.cover_url;
    const newFx=Math.round((best.suggested_focal_x||0.5)*100*10)/10;
    const newFy=Math.round((best.suggested_focal_y||0.5)*100*10)/10;
    const newCrop=best.suggested_crop||item.cover_aspect_ratio||'1/1';
    const newScale=item.cover_scale||1.0;

    const msg=[
      `📸 Фото #${best.photo_index+1}: ${best.photo_type||''}`,
      `⭐ Качество: ${best.quality_score}/100`,
      `🎯 Focal: x=${newFx}%, y=${newFy}%`,
      `📐 Кроп: ${newCrop}`,
      `🔍 Уверенность: ${best.confidence}`,
      best.suggested_title?`✏️ Название: "${best.suggested_title}"`:null,
      '','Применить?'
    ].filter(x=>x!==null).join('\n');
    if(!confirm(msg)){if(aiBtn){aiBtn.textContent='🎯 AI';aiBtn.disabled=false;}return;}

    await patchItem(item.id,{
      cover_url:newCover,cover_focal_x:newFx,cover_focal_y:newFy,
      cover_aspect_ratio:newCrop,
    });
    item.cover_url=newCover;item.cover_focal_x=newFx;item.cover_focal_y=newFy;
    item.cover_aspect_ratio=newCrop;
    if(best.suggested_title&&(item.title||'').startsWith('SKU')){
      item.title=best.suggested_title;
      await patchItem(item.id,{title:best.suggested_title});
    }

    updateGridCard(item);
    if(isDrawer){
      updateDrawerPreview(item);
      buildDrawerContent(item); // перестроить дравер с новыми данными
      const undoBtn=document.getElementById('drUndo');
      if(undoBtn) undoBtn.style.display='inline-block';
    }

    if(aiBtn){aiBtn.textContent='✅ AI';aiBtn.style.background='#e8f4e8';
      setTimeout(()=>{aiBtn.textContent='🎯 AI';aiBtn.style.background='';aiBtn.disabled=false;},2500);}
  } catch(e){
    console.error('AI',e);
    if(aiBtn){aiBtn.textContent='🎯 AI';aiBtn.disabled=false;}
    alert('Ошибка AI: '+e.message);
  }
}

// ===== HELPERS =====
function apiFetch(url, opts={}){
  opts.headers = opts.headers || {};
  opts.headers['X-Admin-Token'] = TOKEN;
  return fetch(url, opts);
}

async function patchItem(id, data){
  const r = await apiFetch(`${API}/items/${id}`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  });
  if(!r.ok) throw new Error(`PATCH failed: ${r.status}`);
  return r.json();
}

function safeArr(v){
  try{ const a=typeof v==="string"?JSON.parse(v):v; return Array.isArray(a)?a:[]; }catch{ return []; }
}

function esc(s){
  const d=document.createElement('div'); d.textContent=s??''; return d.innerHTML;
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

// ===== AI FOCAL ON CARD =====
async function applyAiFocalToCard(item, card) {
  const btn = card.querySelector('.btn-ai-focal');
  btn.textContent = '⏳ AI...';
  btn.disabled = true;
  try {
    // Сначала пробуем GET (уже есть анализ)
    let r = await apiFetch(`${API}/items/${item.id}/ai-focal`);
    let data = await r.json();
    let analysis = data.analysis || [];

    // Если нет — запускаем POST (новый анализ)
    if (!analysis.length) {
      btn.textContent = '🔄 Анализ...';
      r = await apiFetch(`${API}/items/${item.id}/ai-focal`, { method: 'POST' });
      data = await r.json();
      analysis = data.analysis || [];
    }

    if (!analysis.length) {
      btn.textContent = '🎯 AI';
      btn.disabled = false;
      alert('AI не смог проанализировать фото');
      return;
    }

    // Лучшее фото (max quality_score, не packaging, не low confidence)
    const good = analysis
      .filter(a => a.confidence !== 'low' && a.photo_type !== 'packaging' && !safeArr(item.hidden_photo_indices).includes(a.photo_index))
      .sort((a, b) => b.quality_score - a.quality_score);
    const best = good[0] || analysis[0];

    const photos = safeArr(item.photos);
    const bestPhoto = photos[best.photo_index];
    const newCover = bestPhoto?.url || item.cover_url;
    const newFx = Math.round((best.suggested_focal_x || 0.5) * 100 * 10) / 10;
    const newFy = Math.round((best.suggested_focal_y || 0.5) * 100 * 10) / 10;
    const newCrop = best.suggested_crop || item.cover_aspect_ratio || '4/5';

    // Показываем что предлагает AI
    const msg = [
      `📸 Фото #${best.photo_index + 1}: ${best.photo_type || ''}`,
      `⭐ Качество: ${best.quality_score}/100`,
      `🎯 Focal: x=${newFx}%, y=${newFy}%`,
      `📐 Кроп: ${newCrop}`,
      `🔍 Уверенность: ${best.confidence}`,
      best.suggested_title ? `✏️ Название: "${best.suggested_title}"` : null,
      '',
      'Применить?'
    ].filter(x => x !== null).join('\n');

    if (!confirm(msg)) {
      btn.textContent = '🎯 AI';
      btn.disabled = false;
      return;
    }

    // Сохраняем backup для отмены
    const backup = {
      cover_url: item.cover_url,
      cover_focal_x: item.cover_focal_x ?? 50,
      cover_focal_y: item.cover_focal_y ?? 50,
      cover_aspect_ratio: item.cover_aspect_ratio || '4/5',
      title: item.title,
    };

    // Применяем обложку
    const patch = {
      cover_url: newCover,
      cover_focal_x: newFx,
      cover_focal_y: newFy,
      cover_aspect_ratio: newCrop,
    };
    if (best.suggested_title && !item.title.startsWith('SKU')) {
      // не перезатираем название если оно уже нормальное
    } else if (best.suggested_title) {
      patch.title = best.suggested_title;
      card.querySelector('.title-input').value = best.suggested_title;
    }
    await patchItem(item.id, patch);

    // Обновляем UI карточки
    const img = card.querySelector('.pub-cover-img');
    if (img) {
      img.src = newCover;
      img.style.objectPosition = `${newFx}% ${newFy}%`;
      img.style.transformOrigin = `${newFx}% ${newFy}%`;
    }
    const wrap = card.querySelector('.pub-cover-wrap');
    if (wrap) wrap.style.aspectRatio = newCrop;

    // Подсвечиваем лучшее фото в полоске
    card.querySelectorAll('.ph-thumb').forEach((t, i) => {
      t.classList.toggle('ph-active', i === best.photo_index);
    });

    btn.textContent = '✅ AI';
    btn.style.background = '#e8f4e8';
    setTimeout(() => { btn.textContent = '🎯 AI'; btn.style.background = ''; btn.disabled = false; }, 3000);

    // Кнопка Отмены
    const undoBtn = card.querySelector('.btn-undo-ai');
    if (undoBtn) {
      undoBtn.style.display = 'inline-block';
      undoBtn.onclick = async () => {
        await patchItem(item.id, {
          cover_url: backup.cover_url,
          cover_focal_x: backup.cover_focal_x,
          cover_focal_y: backup.cover_focal_y,
          cover_aspect_ratio: backup.cover_aspect_ratio,
          title: backup.title,
        });
        const img = card.querySelector('.pub-cover-img');
        if (img) {
          img.src = backup.cover_url;
          img.style.objectPosition = `${backup.cover_focal_x}% ${backup.cover_focal_y}%`;
          img.style.transformOrigin = `${backup.cover_focal_x}% ${backup.cover_focal_y}%`;
        }
        const wrap = card.querySelector('.pub-cover-wrap');
        if (wrap) wrap.style.aspectRatio = backup.cover_aspect_ratio;
        card.querySelector('.title-input').value = backup.title;
        // Обновляем item
        Object.assign(item, backup);
        undoBtn.style.display = 'none';
        undoBtn.textContent = '✓ Отменено';
        setTimeout(() => { undoBtn.textContent = '↩'; }, 1500);
      };
    }

  } catch(e) {
    console.error('AI focal', e);
    btn.textContent = '🎯 AI';
    btn.disabled = false;
    alert('Ошибка AI: ' + e.message);
  }
}
