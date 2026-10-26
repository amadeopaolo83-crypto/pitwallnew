// Vista auto: lo schermo che guarda il pilota. Schermo intero, blocco
// orizzontale, schermo sempre acceso, e i pochi dati che deve leggere in curva.

let wakeLockRef = null;

async function enterAutoView(){
  $('autoView').hidden = false;
  disattivaPush(); // questo telefono e' l'auto: niente notifiche dei messaggi
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

// Cosa mostra l'auto: classifica "assoluta" oppure "categoria" (solo i piloti della
// stessa categoria, la scritta gialla sotto il nome sul sito). La sceglie il box.
let timingView = 'assoluta';
let lastTiming = null;

function renderTiming(t){
  if(!t) return;
  lastTiming = t;
  // Se la fonte non conosce la categoria (inserimento manuale) si resta sull'assoluta.
  const cat = timingView === 'categoria' && t.catName;
  const pos = cat ? t.catPosition : t.position;
  coloraGap('Ahead', cat ? t.catGapAhead : t.gapAhead, timingView + '|' + (cat ? t.catNumberAhead : t.numberAhead));
  coloraGap('Behind', cat ? t.catGapBehind : t.gapBehind, timingView + '|' + (cat ? t.catNumberBehind : t.numberBehind));
  const gapA = cat ? t.catGapAhead : t.gapAhead;
  const gapB = cat ? t.catGapBehind : t.gapBehind;
  if($('timingPos')) $('timingPos').textContent = (pos ?? '—');
  if($('timingGapAhead')) $('timingGapAhead').textContent = gapA || '—';
  if($('timingGapBehind')) $('timingGapBehind').textContent = gapB || '—';
  // I nomi si riscrivono sempre, anche quando sono vuoti: se restassero quelli
  // di prima indicherebbero l'avversario sbagliato accanto a un distacco nuovo,
  // che e' peggio che non scrivere niente.
  if($('timingWhoAhead')) $('timingWhoAhead').textContent = cat ? descriviRivale(t.catNumberAhead, t.catNameAhead) : descriviRivale(t.numberAhead, t.nameAhead);
  if($('timingWhoBehind')) $('timingWhoBehind').textContent = cat ? descriviRivale(t.catNumberBehind, t.catNameBehind) : descriviRivale(t.numberBehind, t.nameBehind);
  // Sotto la posizione: la categoria e la posizione nell'altra classifica.
  if($('timingPosSub')){
    $('timingPosSub').textContent = !t.catName ? ''
      : cat ? t.catName + ' \u00b7 ass. ' + (t.position ?? '\u2014') + '\u00b0'
            : t.catName + ' ' + (t.catPosition ?? '\u2014') + '\u00b0';
  }
  if(typeof passoRenderConfronti === 'function') passoRenderConfronti();
}

// Colore dei distacchi: bianco finche' non cambiano, poi verde se la situazione
// migliora (il distacco da chi sta davanti si riduce, quello da chi sta dietro
// aumenta) e giallo se peggiora. Si confronta con l'ultimo valore che ha fatto
// cambiare colore, con una soglia per non seguire i centesimi; un avversario nuovo
// (o una vista diversa) riparta da bianco.
const gapStato = { Ahead: { key: null, ref: null, dir: null }, Behind: { key: null, ref: null, dir: null } };
let sogliaGap = 0.1; // secondi: lo sceglie il box (0.1, 0.25, 0.5 o 1), vale per tutta la squadra
function applySogliaGap(v){
  const n = Number(v);
  sogliaGap = [0.1, 0.25, 0.5, 1].includes(n) ? n : 0.1;
  [['segSoglia01', 0.1], ['segSoglia025', 0.25], ['segSoglia05', 0.5], ['segSoglia1', 1]].forEach(([id, val]) => {
    if($(id)) $(id).classList.toggle('active', sogliaGap === val);
  });
}

function coloraGap(lato, testo, chiave){
  const el = $(lato === 'Ahead' ? 'timingGapAhead' : 'timingGapBehind');
  if(!el) return;
  const s = (typeof passoSecDaGap === 'function') ? passoSecDaGap(testo) : null;
  const st = gapStato[lato];
  if(s == null || st.key !== chiave){
    st.key = s == null ? null : chiave; st.ref = s; st.dir = null;
  } else if(Math.abs(s - st.ref) > sogliaGap){
    st.dir = s < st.ref ? 'shrink' : 'grow';
    st.ref = s;
  }
  const buono = (lato === 'Ahead') === (st.dir === 'shrink');
  el.classList.toggle('g-up', Boolean(st.dir) && buono);
  el.classList.toggle('g-down', Boolean(st.dir) && !buono);
}

// Aspetto della schermata auto, scelto dal box: "telefono" (predefinito) o "tablet".
let autoLayout = 'telefono';
function applyAutoLayout(layout){
  autoLayout = layout === 'tablet' ? 'tablet' : 'telefono';
  if($('autoView')) $('autoView').classList.toggle('layout-tablet', autoLayout === 'tablet');
  if($('segLayTel')) $('segLayTel').classList.toggle('active', autoLayout === 'telefono');
  if($('segLayTab')) $('segLayTab').classList.toggle('active', autoLayout === 'tablet');
  renderQuickGrid();
  if(typeof passoRender === 'function') passoRender();
}

// Il secondo pulsante (di solito "Rifornimento") sta a destra della barra
// carburante, nella stessa riga; gli altri tre stanno sotto, affiancati.
function renderQuickGrid(){
  const grid = $('quickGrid');
  if(!grid) return;
  grid.innerHTML = '';
  quickButtons.forEach((b, i) => {
    // Sul telefono il secondo va nel pulsante accanto al carburante; sul tablet stanno
    // tutti insieme nella griglia in basso.
    if(i === 1 && autoLayout !== 'tablet') return;
    const btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.style.background = b.color;
    btn.textContent = b.label;
    btn.onclick = () => sendQuick(b, btn);
    grid.appendChild(btn);
  });
  renderRefuelButton();
}

function renderRefuelButton(){
  const btn = $('refuelQuickBtn');
  if(!btn || !quickButtons[1]) return;
  btn.style.background = quickButtons[1].color;
  btn.textContent = quickButtons[1].label;
}

function sendQuickAt(i, btnEl){
  const b = quickButtons[i];
  if(b) sendQuick(b, btnEl);
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
