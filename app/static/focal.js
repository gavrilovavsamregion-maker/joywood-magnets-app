// focal.js — переиспользуемый focal point picker
// makeFocalPicker(imgUrl, focalX=50, focalY=50, onChange(x,y))
// Возвращает DOM-элемент .focal-wrap
function makeFocalPicker(imgUrl, focalX, focalY, onChange) {
  focalX = focalX ?? 50;
  focalY = focalY ?? 50;

  const wrap = document.createElement('div');
  wrap.className = 'focal-wrap';
  wrap.innerHTML = `
    <div class="focal-hint">Точка фокуса: клик по фото</div>
    <div class="focal-img-wrap">
      <img class="focal-img" src="${imgUrl}" alt="" draggable="false">
      <div class="focal-dot" style="left:${focalX}%;top:${focalY}%"></div>
      <div class="focal-crosshair-h" style="top:${focalY}%"></div>
      <div class="focal-crosshair-v" style="left:${focalX}%"></div>
    </div>
    <div class="focal-coords">x: <b class="fx-val">${Math.round(focalX)}</b>% &nbsp; y: <b class="fy-val">${Math.round(focalY)}</b>%</div>
  `;

  const imgWrap = wrap.querySelector('.focal-img-wrap');
  const dot = wrap.querySelector('.focal-dot');
  const ch = wrap.querySelector('.focal-crosshair-h');
  const cv = wrap.querySelector('.focal-crosshair-v');
  const fxVal = wrap.querySelector('.fx-val');
  const fyVal = wrap.querySelector('.fy-val');

  function setFocal(x, y) {
    x = Math.max(0, Math.min(100, x));
    y = Math.max(0, Math.min(100, y));
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    ch.style.top = y + '%';
    cv.style.left = x + '%';
    fxVal.textContent = Math.round(x);
    fyVal.textContent = Math.round(y);
    focalX = x; focalY = y;
    onChange(x, y);
  }

  function handleClick(e) {
    const rect = imgWrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 100;
    const y = (e.clientY - rect.top) / rect.height * 100;
    setFocal(x, y);
  }

  imgWrap.addEventListener('click', handleClick);
  imgWrap.style.cursor = 'crosshair';

  // drag support
  let dragging = false;
  dot.addEventListener('mousedown', e => { dragging = true; e.stopPropagation(); });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const rect = imgWrap.getBoundingClientRect();
    setFocal((e.clientX - rect.left) / rect.width * 100, (e.clientY - rect.top) / rect.height * 100);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  wrap.getFocal = () => ({ x: focalX, y: focalY });
  return wrap;
}
