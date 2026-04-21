(function(){
'use strict';
const API = '/api/gallery';
let allItems = [];
let activeCat = '', activeWood = '';

const SIZE_WEIGHT = { small: 0.7, normal: 1.0, large: 1.3, full: 99 };

const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря'];

function formatDate(str){
  if(!str) return '';
  try{
    const d = new Date(str);
    return MONTHS_RU[d.getMonth()] + ' ' + d.getFullYear();
  }catch{ return ''; }
}

function shortAuthor(name){
  if(!name || name === 'Покупатель') return 'Мастер';
  return name.split(' ')[0];
}

async function fetchAll(){
  let items = [], offset = 0, limit = 100;
  while(true){
    const r = await fetch(`${API}/items?limit=${limit}&offset=${offset}`);
    if(!r.ok) throw new Error(`API ${r.status}`);
    const d = await r.json();
    items = items.concat(d.items || []);
    if(items.length >= (d.total || 0) || !(d.items || []).length) break;
    offset += limit;
  }
  return items;
}

async function init(){
  try{
    allItems = await fetchAll();
    buildFilters();
    renderGrid(allItems);
    bindLightbox();
    window.addEventListener('resize', debounce(()=>renderGrid(getFiltered()), 200));
  }catch(e){
    console.error('widget init failed', e);
    const grid = document.getElementById('masonryGrid');
    if(grid) grid.innerHTML = `<div class="gallery-empty">Ошибка загрузки: ${esc(e.message||'unknown')}</div>`;
  }
}

function getFiltered(){
  return allItems.filter(i=>{
    if(activeCat && i.category!==activeCat) return false;
    if(activeWood && i.wood_type!==activeWood) return false;
    return true;
  });
}

function buildFilters(){
  const cats = [...new Set(allItems.map(i=>i.category).filter(Boolean))].sort();
  const woods = [...new Set(allItems.map(i=>i.wood_type).filter(Boolean))].sort();
  const catWrap = document.getElementById('filterCats');
  const woodWrap = document.getElementById('filterWoods');
  if(!catWrap || !woodWrap) return;
  catWrap.querySelectorAll('.filter-chip:not([data-val=""])').forEach(el=>el.remove());
  woodWrap.querySelectorAll('.filter-chip:not([data-val=""])').forEach(el=>el.remove());
  cats.forEach(cat=>{
    const count = allItems.filter(i=>i.category===cat).length;
    const btn = document.createElement('button');
    btn.className='filter-chip'; btn.dataset.type='cat'; btn.dataset.val=cat;
    btn.innerHTML=`${esc(cat)} <span class="chip-count">${count}</span>`;
    catWrap.appendChild(btn);
  });
  woods.forEach(wood=>{
    const count = allItems.filter(i=>i.wood_type===wood).length;
    const btn = document.createElement('button');
    btn.className='filter-chip'; btn.dataset.type='wood'; btn.dataset.val=wood;
    btn.innerHTML=`${esc(wood)} <span class="chip-count">${count}</span>`;
    woodWrap.appendChild(btn);
  });
  document.querySelectorAll('.filter-chip').forEach(btn=>{ btn.onclick = ()=>onFilter(btn); });
}

function onFilter(btn){
  const type = btn.dataset.type, val = btn.dataset.val;
  if(type==='cat'){
    activeCat = val;
    document.querySelectorAll('.filter-chip[data-type="cat"]').forEach(b=>b.classList.remove('active'));
  } else {
    activeWood = val;
    document.querySelectorAll('.filter-chip[data-type="wood"]').forEach(b=>b.classList.remove('active'));
  }
  btn.classList.add('active');
  renderGrid(getFiltered());
}

// ===== JUSTIFIED LAYOUT с display_size =====
function justifiedLayout(items, containerWidth, targetRowHeight, spacing){
  const boxes = [];
  const sp = spacing || 8;

  // SIZE_WEIGHT влияет на порог заполнения ряда:
  // large карточка в виртуальном смысле занимает больше места -> в ряд попадёт меньше карточек
  function effectiveAR(item){
    if((item.display_size||'normal') === 'full') return 9999;
    // large: ear = ar * 1.3 -> он пораньше заполняет ряд, попадает меньше карточек
    // small: ear = ar * 0.7 -> он позже заполняет, попадает больше карточек
    const w = SIZE_WEIGHT[item.display_size||'normal'] || 1.0;
    return item._ar * w;
  }

  function flushRow(rowItems, last){
    const totalAR = rowItems.reduce((s, i) => s + i._ar, 0);
    const gaps = sp * (rowItems.length - 1);

    let h;
    if(last){
      // Неполный последний ряд — фиксированная высота
      h = Math.min(targetRowHeight, Math.round(containerWidth * 0.55));
    } else {
      // Полный ряд — высота такая чтобы карточки ТОЧНО заняли containerWidth
      h = Math.round((containerWidth - gaps) / totalAR);
    }

    let x = 0;
    rowItems.forEach((item, i) => {
      let w;
      if((item.display_size||'normal') === 'full'){
        w = containerWidth; // на всю ширину
      } else if(i === rowItems.length - 1 && !last){
        w = containerWidth - x; // компенсация округления
      } else {
        w = Math.round(item._ar * h);
      }
      boxes.push({item, x, w, h});
      x += w + sp;
    });
  }

  let row = [], rowEffAR = 0;

  items.forEach(item => {
    const ar = Math.max(0.5, parseAR(item.cover_aspect_ratio) || 1.33);
    item._ar = ar;
    const ear = effectiveAR(item);

    // Проверяем до добавления: влезет ли карточка?
    if(row.length > 0){
      const projectedW = (rowEffAR + ear) * targetRowHeight + sp * row.length;
      if(projectedW > containerWidth){
        flushRow(row, false);
        row = []; rowEffAR = 0;
      }
    }

    row.push(item);
    rowEffAR += ear;
  });

  if(row.length) flushRow(row, true);
  return boxes;
}
function parseAR(str){
  if(!str) return 1.33;
  if(str.includes('/')){
    const [a,b] = str.split('/').map(Number);
    return b ? a/b : 1.33;
  }
  return parseFloat(str) || 1.33;
}


function scatterVideoCards(items) {
  // Разделяем видео и обычные
  const videos = items.filter(i => i.cover_video_url);
  const normal = items.filter(i => !i.cover_video_url);
  if (!videos.length) return items;
  // Равномерно расставляем видео через каждые N обычных
  const gap = Math.max(3, Math.floor(normal.length / videos.length));
  const result = [];
  let vi = 0, ni = 0;
  while (ni < normal.length || vi < videos.length) {
    // Добавляем gap обычных
    for (let k = 0; k < gap && ni < normal.length; k++) result.push(normal[ni++]);
    // Добавляем 1 видео
    if (vi < videos.length) result.push(videos[vi++]);
  }
  return result;
}

function renderGrid(items){
  const grid = document.getElementById('masonryGrid');
  const stats = document.getElementById('galleryStats');
  if(!grid) return;
  if(stats) stats.textContent = items.length ? `${items.length} работ${items.length===1?'a':items.length<5?'ы':''}` : '';
  if(!items.length){
    grid.innerHTML='<div class="gallery-empty">Ничего не найдено</div>';
    return;
  }

  const _cs = getComputedStyle(grid);
  const _pl = parseFloat(_cs.paddingLeft||0);
  const _pr = parseFloat(_cs.paddingRight||0);
  const containerWidth = grid.clientWidth - _pl - _pr || 900;

  function getTargetRowHeight(w){
  if(w < 480) return Math.round(w / 2.2);
  if(w < 900) return Math.round(w / 2.8);
  return Math.round(w / 3.2);
}
  const targetRowHeight = getTargetRowHeight(containerWidth);
  const spacing = 10;

  items = scatterVideoCards(items);
  const boxes = justifiedLayout(items, containerWidth, targetRowHeight, spacing);

  grid.innerHTML = '';
  grid.style.position = 'relative';
  let maxBottom = 0;

  boxes.forEach(({item, x, w, h}, idx)=>{
    const top = computeTop(boxes, idx, spacing);
    const card = makeCard(item, idx, w, h);
    card.style.cssText += `position:absolute;left:${x}px;top:${top}px;width:${w}px;height:${h}px;`;
    grid.appendChild(card);
    maxBottom = Math.max(maxBottom, top + h);
  });

  grid.style.height = maxBottom + 'px';

  requestAnimationFrame(()=>{
    initAllCarousels();
    initVideoAutoplay();
  });
}

function computeTop(boxes, idx, spacing){
  if(idx === 0) return 0;
  let rowStart = idx;
  while(rowStart > 0 && boxes[rowStart].x !== 0) rowStart--;
  if(rowStart === 0) return 0;
  let prevRowStart = rowStart - 1;
  while(prevRowStart > 0 && boxes[prevRowStart].x !== 0) prevRowStart--;
  const prevTop = computeTop(boxes, prevRowStart, spacing);
  return prevTop + boxes[prevRowStart].h + spacing;
}

function makeCard(item, idx, w, h){
  const photos = safeJson(item.photos, []);
  const videos = safeJson(item.videos, []);
  const cover = item.cover_url || photos[0]?.url || '';
  const hasVideo = videos.length > 0;

  const card = document.createElement('div');
  card.className = 'gallery-card justified-card';
  card.dataset.id = item.id;
  card.style.animationDelay = Math.min(idx * 15, 200) + 'ms';

  if(item.cover_video_url){card.dataset.videoUrl=item.cover_video_url;card.dataset.videoStart=item.cover_video_start||0;}
  const allP = safeArr(item.photos).map(p=>p.url||p).filter(Boolean);
  const hiddenIdx = safeArr(item.hidden_photo_indices);
  const visPhotos = allP.filter((_,i)=>!hiddenIdx.includes(i));
  if(visPhotos.length>1) card.dataset.photos=JSON.stringify(visPhotos);
  if(item.autoplay_mode) card.dataset.autoplay=item.autoplay_mode;

  const fx = item.cover_focal_x ?? 50;
  const fy = item.cover_focal_y ?? 50;
  const sc = item.cover_scale || 1.0;

  const author = shortAuthor(item.author_name);
  const pubdate = formatDate(item.review_published_at);
  const videoBadge = item.cover_video_url ? `<div class="card-live-badge">LIVE</div>` : '';

  card.innerHTML = `
    <div class="card-img-wrap" style="width:${w}px;height:${h}px;overflow:hidden;position:relative;border-radius:6px;">
      ${ cover
        ? `<img class="card-cover" src="${esc(cover)}" alt="${esc(item.title||'')}" loading="lazy"
             style="width:100%;height:100%;object-fit:cover;object-position:${fx}% ${fy}%;transform:scale(${sc});transform-origin:${fx}% ${fy}%;">
           ${ item.cover_video_url ? `<button class="card-play-btn" aria-label="Смотреть видео"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>` : '' }
           ${ visPhotos.length>1 ? `<button class="card-arr card-arr-l" data-dir="-1">&lsaquo;</button><span class="card-dots"></span><button class="card-arr card-arr-r" data-dir="1">&rsaquo;</button>` : '' }`
        : `<div style="width:${w}px;height:${h}px;background:#f0ede7"></div>`
      }
      ${videoBadge}
      <div class="card-overlay">
        <span class="card-author">${esc(author)}</span>
        ${pubdate ? `<span class="card-date">${esc(pubdate)}</span>` : ''}
      </div>
    </div>
    <div class="card-info">
      <div class="card-title">${esc(item.title || 'Работа мастера')}</div>
      <div class="card-meta">
        ${item.category?`<span class="card-cat">${esc(item.category)}</span>`:''}
        ${item.wood_type?`<span class="card-wood">· ${esc(item.wood_type)}</span>`:''}
      </div>
    </div>`;

  // Стрелки карусели: event delegation до initCarousel
  card.addEventListener('click', e=>{
    const arrBtn = e.target.closest('.card-arr');
    if(arrBtn){ e.stopPropagation(); return; } // initCarousel сам обработает
    openLightbox(item, photos, videos);
  }, true); // capture=true чтобы перехватить раньше любых bubble
  return card;
}

// ===== LIGHTBOX =====

function stopAllBgVideos(){
  document.querySelectorAll('.gallery-card').forEach(c=>{
    if(c._autoVid){
      try{c._autoVid.pause();}catch{}
      c._autoVid.style.opacity='0';
      setTimeout(()=>{ if(c._autoVid){c._autoVid.remove();c._autoVid=null;} const ci=c.querySelector('.card-cover'); if(ci) ci.style.opacity=''; },400);
    }
  });
}
function openLightbox(item, photos, videos){
  const lb = document.getElementById('lightbox');
  if(!lb) return;
  const mainImg = document.getElementById('lbMainImg');
  const thumbs = document.getElementById('lbThumbs');
  const title = document.getElementById('lbTitle');
  const meta = document.getElementById('lbMeta');
  const review = document.getElementById('lbReview');
  const ozonWrap = document.getElementById('lbOzonWrap');
  const lbAuthor = document.getElementById('lbAuthor');
  const lbPubDate = document.getElementById('lbPubDate');
  const lbProductImg = document.getElementById('lbProductImg');
  if(!mainImg||!thumbs||!title||!meta||!review||!ozonWrap) return;

  const hiddenIdx = safeArr(item.hidden_photo_indices);
  const visPhotos = photos.filter((_,i)=>!hiddenIdx.includes(i));
  const cover = item.cover_url || visPhotos[0]?.url || '';

  stopAllBgVideos();
  const oldVid = document.getElementById('lbVideo');
  if(oldVid) oldVid.remove();

  // blur-bg removed

  function setMainPhoto(url){
    const vid = document.getElementById('lbVideo');
    if(vid){try{vid.pause();}catch{}vid.remove();}
    mainImg.src = url;
    mainImg.style.display = 'block';
    thumbs.querySelectorAll('.lightbox-thumb,.lightbox-video-thumb').forEach(t=>t.classList.remove('active'));
      const _dlw = document.getElementById('lbDownloadWrap');
    if(_dlw) _dlw.innerHTML = url ? `<a class="lightbox-download" href="/api/gallery/download?url=${encodeURIComponent(url)}">⬇ Скачать фото</a>` : '';
  }

  setMainPhoto(cover);
  // Если есть видео - автоматически запускаем его вместо фото
  if(item.cover_video_url){
    let vid = document.getElementById('lbVideo');
    if(!vid){
      vid = document.createElement('video');
      vid.id='lbVideo'; vid.controls=true; vid.playsInline=true; vid.autoplay=true;
      vid.style.cssText='width:100%;max-height:60vh;background:#000;display:block;position:relative;z-index:1;border-radius:8px;';
      mainImg.parentNode.insertBefore(vid, mainImg);
    }
    vid.src = item.cover_video_url;
    vid.currentTime = item.cover_video_start || 0;
    mainImg.style.display = 'none';
    // Активируем нужный тамб в плеере
    thumbs.querySelectorAll('.lightbox-video-thumb').forEach(t=>t.classList.add('active'));
  }

  thumbs.innerHTML = '';
  visPhotos.forEach((p)=>{
    const img = document.createElement('img');
    img.className = 'lightbox-thumb' + (p.url===cover?' active':'');
    img.src = p.url; img.alt = '';
    img.onclick = ()=>{ setMainPhoto(p.url); img.classList.add('active'); };
    thumbs.appendChild(img);
  });
  videos.forEach((v)=>{
    const btn = document.createElement('div');
    btn.className = 'lightbox-video-thumb'; btn.textContent = '▶';
    btn.onclick = ()=>{
      let vid = document.getElementById('lbVideo');
      if(!vid){
        vid = document.createElement('video');
        vid.id='lbVideo'; vid.controls=true; vid.playsInline=true;
        vid.style.cssText='width:100%;max-height:60vh;background:#000;display:block;position:relative;z-index:1;';
        mainImg.parentNode.insertBefore(vid, mainImg);
      }
      vid.src = v.url; mainImg.style.display='none';
      thumbs.querySelectorAll('.lightbox-thumb,.lightbox-video-thumb').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
    };
    thumbs.appendChild(btn);
  });

  thumbs.style.display = thumbs.children.length<=1?'none':'flex';
  title.textContent = item.title || 'Работа мастера';
  meta.innerHTML = '';
  if(item.category) meta.innerHTML += `<span class="lb-cat">${esc(item.category)}</span>`;
  if(item.wood_type) meta.innerHTML += `<span class="lb-wood">${esc(item.wood_type)}</span>`;
  review.textContent = item.review_text || '';
  ozonWrap.innerHTML = item.product_url ? `<a class="lightbox-ozon" href="${esc(item.product_url)}" target="_blank" rel="noopener">🛒 Купить на Ozon</a>` : '';
  const _dlw = document.getElementById('lbDownloadWrap');
  if(_dlw){
    const _imgSrc = document.getElementById('lbMainImg')?.src || '';
    _dlw.innerHTML = _imgSrc ? `<a class="lightbox-download" href="/api/gallery/download?url=${encodeURIComponent(_imgSrc)}">⬇ Скачать фото</a>` : '';
  }

  // Автор и дата
  if(lbAuthor) lbAuthor.textContent = shortAuthor(item.author_name);
  if(lbPubDate) lbPubDate.textContent = formatDate(item.review_published_at);

  // Фото товара — lazy
  if(lbProductImg){
    lbProductImg.innerHTML = '';
    if(item.product_id){
      lbProductImg.innerHTML = '<div class="lb-product-loading">Загрузка товара…</div>';
      fetch(`${API}/product-image/${item.product_id}`)
        .then(r=>r.ok?r.json():null)
        .then(d=>{
          if(!lbProductImg) return;
          if(d && d.url){
            const link = item.product_url || '';
            lbProductImg.innerHTML =
              `<div class="lb-product-label">Изделие из этого материала:</div>
               <div class="lb-product-wrap">
                 <img class="lb-product-img" src="${esc(d.url)}" alt="Материал">
                 <div class="lb-product-info">
                   <div class="lb-product-name">${esc((item.product_name||'').replace(/^SKU \d+$/,'Деревянный материал'))}</div>
                   ${link?`<a class="lb-product-link" href="${esc(link)}" target="_blank" rel="noopener">Смотреть на Ozon →</a>`:''}
                 </div>
               </div>`;
          } else {
            lbProductImg.innerHTML = link
              ? `<a class="lightbox-ozon" href="${esc(link)}" target="_blank" rel="noopener">🛒 Материал на Ozon</a>`
              : '';
          }
        })
        .catch(()=>{ if(lbProductImg) lbProductImg.innerHTML=''; });
    }
  }

  // Навигация назад/вперёд
  let _lbAllMedia = [...visPhotos.map((p,i)=>({type:'photo',url:p.url,idx:i})), ...videos.map((v,i)=>({type:'video',url:v.url||v,idx:i}))];
  let _lbCur = item.cover_video_url ? _lbAllMedia.findIndex(m=>m.type==='video'&&m.url===item.cover_video_url) : 0;
  if(_lbCur < 0) _lbCur = 0;
  function _lbGo(n){
    _lbCur = (n + _lbAllMedia.length) % _lbAllMedia.length;
    const m = _lbAllMedia[_lbCur];
    const vid = document.getElementById('lbVideo');
    if(m.type==='video'){
      if(!vid || vid.src !== m.url){
        let v2 = document.getElementById('lbVideo');
        if(!v2){ v2=document.createElement('video'); v2.id='lbVideo'; v2.controls=true; v2.playsInline=true; v2.autoplay=true; v2.style.cssText='width:100%;max-height:60vh;background:#000;display:block;position:relative;z-index:1;border-radius:8px;'; mainImg.parentNode.insertBefore(v2,mainImg); }
        v2.src=m.url; mainImg.style.display='none'; v2.play().catch(()=>{});
      }
    } else {
      if(vid){try{vid.pause();}catch{} vid.style.display='none';}
      mainImg.src=m.url; mainImg.style.display='block';
      const _dlw=document.getElementById('lbDownloadWrap');
      if(_dlw) _dlw.innerHTML=m.url?`<a class="lightbox-download" href="/api/gallery/download?url=${encodeURIComponent(m.url)}">⬇ Скачать фото</a>`:'' ;
    }
    thumbs.querySelectorAll('.lightbox-thumb,.lightbox-video-thumb').forEach((t,i)=>t.classList.toggle('active',i===_lbCur));
    const prevBtn=document.getElementById('lbPrev'); const nextBtn=document.getElementById('lbNext');
    if(prevBtn) prevBtn.disabled=_lbAllMedia.length<=1;
    if(nextBtn) nextBtn.disabled=_lbAllMedia.length<=1;
  }
  const _lbPrev=document.getElementById('lbPrev'); const _lbNext=document.getElementById('lbNext');
  if(_lbPrev) _lbPrev.onclick=e=>{e.stopPropagation();_lbGo(_lbCur-1);};
  if(_lbNext) _lbNext.onclick=e=>{e.stopPropagation();_lbGo(_lbCur+1);};

  lb.classList.add('open');
  document.body.style.overflow='hidden';
}

let _lbKeyBound = false;
function bindLightbox(){
  const closeBtn = document.getElementById('lbClose');
  const lightbox = document.getElementById('lightbox');
  if(closeBtn) closeBtn.onclick = closeLightbox;
  if(lightbox) lightbox.onclick = (e)=>{ if(e.target===lightbox) closeLightbox(); };
  if(!_lbKeyBound){
    document.addEventListener('keydown', e=>{
      if(e.key==='Escape') closeLightbox();
      if(e.key==='ArrowLeft')  { const lb2=document.getElementById('lightbox'); if(lb2?.classList.contains('open')) document.getElementById('lbPrev')?.click(); }
      if(e.key==='ArrowRight') { const lb2=document.getElementById('lightbox'); if(lb2?.classList.contains('open')) document.getElementById('lbNext')?.click(); }
    });
    _lbKeyBound = true;
  }
}

function closeLightbox(){
  const lb = document.getElementById('lightbox');
  if(lb) lb.classList.remove('open');
  document.body.style.overflow='';
  const vid = document.getElementById('lbVideo');
  if(vid){try{vid.pause();}catch{} vid.remove();}
}

// ===== CAROUSEL =====
function initCarousel(card){
  const photosRaw = card.dataset.photos;
  if(!photosRaw) return;
  const photos = safeArr(JSON.parse(photosRaw));
  if(!photos.length) return;
  let cur = 0;
  const imgEl = card.querySelector('.card-cover');
  const dots = card.querySelector('.card-dots');
  const wrap = card.querySelector('.card-img-wrap');
  if(!imgEl) return;

  let bgEl = wrap.querySelector('.card-blur-bg');
  if(!bgEl){
    bgEl = document.createElement('div');
    bgEl.className = 'card-blur-bg';
    bgEl.style.cssText = 'position:absolute;inset:-10px;background-size:cover;background-position:center;filter:blur(12px) brightness(0.7);transform:scale(1.05);z-index:0;';
    wrap.insertBefore(bgEl, wrap.firstChild);
    imgEl.style.position = 'relative';
    imgEl.style.zIndex = '1';
  }
  function updateBg(url){ bgEl.style.backgroundImage = `url(${url})`; }
  updateBg(photos[0]);

  if(dots){
    dots.innerHTML = photos.map((_,i)=>`<span class="card-dot${i===0?' active':''}" data-i="${i}"></span>`).join('');
    dots.querySelectorAll('.card-dot').forEach(d=>d.addEventListener('click',e=>{e.stopPropagation();goTo(+d.dataset.i);}));
  }
  function goTo(idx){
    cur = (idx+photos.length)%photos.length;
    imgEl.style.opacity='0';
    setTimeout(()=>{ imgEl.src=photos[cur]; imgEl.style.opacity='1'; updateBg(photos[cur]); },150);
    dots?.querySelectorAll('.card-dot').forEach((d,i)=>d.classList.toggle('active',i===cur));
  }
  card.querySelectorAll('.card-arr').forEach(btn=>{
    btn.addEventListener('click',e=>{ e.stopPropagation(); goTo(cur+(+btn.dataset.dir)); });
  });
  let tx=0;
  card.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;},{passive:true});
  card.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-tx;
    if(Math.abs(dx)>40) goTo(cur+(dx<0?1:-1));
  },{passive:true});
  card._carousel={goTo,getCur:()=>cur,len:photos.length};
}

function initSlideshows(){
  document.querySelectorAll('.gallery-card[data-photos][data-autoplay="slideshow"]').forEach(card=>{
    if(card._ssTimer) return;
    if(!card._carousel) initCarousel(card);
    card._ssTimer=setInterval(()=>{
      if(!document.contains(card)){clearInterval(card._ssTimer);return;}
      card._carousel?.goTo(card._carousel.getCur()+1);
    },3000);
  });
}

function initVideoAutoplay(){
  if(!('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      const card = e.target;
      if(!card.dataset.videoUrl) return;
      const wrap = card.querySelector('.card-img-wrap');
      const img  = card.querySelector('.card-cover');
      if(e.isIntersecting && e.intersectionRatio >= 0.4){
        if(card._autoVid) return;
        // Пульс пока видео загружается
        const pulse = document.createElement('div');
        pulse.className='card-video-pulse';
        wrap.appendChild(pulse);
        const v = document.createElement('video');
        v.src=card.dataset.videoUrl; v.muted=true; v.playsInline=true; v.loop=true;
        v.currentTime=parseFloat(card.dataset.videoStart)||0;
        v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;opacity:0;transition:opacity .6s ease;';
        wrap.appendChild(v);
        v.addEventListener('canplay',()=>{
          pulse.remove();
          v.style.opacity='1';  // плавный fade-in
          if(img) img.style.opacity='0';
        },{once:true});
        v.play().catch(()=>{});
        card._autoVid=v;
      } else {
        if(card._autoVid){
          try{card._autoVid.pause();}catch{}
          card._autoVid.style.opacity='0';
          setTimeout(()=>{
            if(card._autoVid){card._autoVid.remove();card._autoVid=null;}
            if(img) img.style.opacity='';
            card.querySelector('.card-video-pulse')?.remove();
          },600);
        }
      }
    });
  },{threshold:[0,0.4,1.0], rootMargin:'-15% 0px -15% 0px'});
  document.querySelectorAll('.gallery-card[data-video-url]').forEach(c=>obs.observe(c));
  // Остановка видео при скролле пальцем на мобильном (touchstart)
  let _scrollTimer;
  window.addEventListener('scroll', ()=>{ // scrollstopvideo
    clearTimeout(_scrollTimer);
    // Приостанавливаем видео у карточек вышедших из зоны viewport
    document.querySelectorAll('.gallery-card').forEach(c=>{
      if(!c._autoVid) return;
      const r=c.getBoundingClientRect();
      const vh=window.innerHeight;
      const inZone=r.top<vh*0.85&&r.bottom>vh*0.15;
      if(!inZone){ try{c._autoVid.pause();}catch{} c._autoVid.style.opacity='0'; setTimeout(()=>{ if(c._autoVid){c._autoVid.remove();c._autoVid=null;} const ci=c.querySelector('.card-cover'); if(ci) ci.style.opacity=''; },400); }
    });
  },{passive:true});
}

function initAllCarousels(){
  document.querySelectorAll('.gallery-card[data-photos]').forEach(card=>{
    if(!card._carousel) initCarousel(card);
  });
  initSlideshows();
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
function safeArr(v){try{const a=typeof v==="string"?JSON.parse(v):v;return Array.isArray(a)?a:[];}catch{return [];}}
function safeJson(v,def){try{return typeof v==='string'?JSON.parse(v):(Array.isArray(v)?v:def);}catch{return def;}}
function esc(s){const d=document.createElement('div');d.textContent=s??'';return d.innerHTML;}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})();
