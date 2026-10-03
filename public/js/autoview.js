// Vista auto: lo schermo che guarda il pilota. Schermo intero, blocco
// orizzontale, schermo sempre acceso, e i pochi dati che deve leggere in curva.

let wakeLockRef = null;

async function enterAutoView(){
  $('autoView').hidden = false;
  renderQuickGrid();
  try{ await document.documentElement.requestFullscreen(); }catch(e){}
  try{ await screen.orientation.lock('landscape'); }catch(e){ checkOrientation(); }
  window.addEventListener('resize', checkOrientation);
  checkOrientation();
  requestWakeLock();
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible') requestWakeLock(); });
}

function checkOrientation(){
  $('rotateHint').hidden = window.innerWidth > window.innerHeight;
}

async function requestWakeLock(){
  try{ wakeLockRef = await navigator.wakeLock.request('screen'); }catch(e){ /* non supportato o negato */ }
}

function renderFuel(percent){
  $('fuelPct') && ($('fuelPct').textContent = percent + '%');
  const fill = $('fuelFill');
  if(!fill) return;
  fill.style.width = percent + '%';
  const hue = Math.max(0, Math.min(120, percent * 1.2)); // 100%=verde(120), 0%=rosso(0)
  fill.style.background = `hsl(${hue}, 75%, 48%)`;
}

// "#42 · TEAM ROSSI", oppure solo quello dei due che c'e'.
function descriviRivale(numero, nome){
  return [numero ? '#' + numero : '', nome || ''].filter(Boolean).join(' · ');
}

function renderTiming(t){
  if(!t) return;
  if($('timingPos')) $('timingPos').textContent = (t.position ?? '—');
  if($('timingGapAhead')) $('timingGapAhead').textContent = t.gapAhead || '—';
  if($('timingGapBehind')) $('timingGapBehind').textContent = t.gapBehind || '—';
  // I nomi si riscrivono sempre, anche quando sono vuoti: se restassero quelli
  // di prima indicherebbero l'avversario sbagliato accanto a un distacco nuovo,
  // che e' peggio che non scrivere niente.
  if($('timingWhoAhead')) $('timingWhoAhead').textContent = descriviRivale(t.numberAhead, t.nameAhead);
  if($('timingWhoBehind')) $('timingWhoBehind').textContent = descriviRivale(t.numberBehind, t.nameBehind);
}

function renderQuickGrid(){
  const grid = $('quickGrid');
  if(!grid) return;
  grid.innerHTML = '';
  quickButtons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.style.background = b.color;
    btn.textContent = b.label;
    btn.onclick = () => sendQuick(b, btn);
    grid.appendChild(btn);
  });
}

function sendQuick(b, btnEl){
  socket.emit('quickMessage', { buttonId: b.id, label: b.label });
  btnEl.classList.add('flashing');
  setTimeout(()=>btnEl.classList.remove('flashing'), 800);
  if(navigator.vibrate) navigator.vibrate(60);
}

function showFlash(m){
  const ov = $('flashOverlay');
  ov.style.background = m.color;
  $('flashText').textContent = m.text;
  ov.hidden = false;
  try{
    const u = new SpeechSynthesisUtterance(m.text);
    u.lang = 'it-IT';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }catch(e){}
  clearTimeout(showFlash._t);
  showFlash._t = setTimeout(()=>{ ov.hidden = true; }, (m.durationSeconds||6)*1000);
}
