// Vista box: pannello di controllo. Pulsanti rapidi, messaggi a schermo intero
// e cronologia di quello che arriva dall'auto.

function enterBoxView(){
  $('boxView').hidden = false;
  $('boxCodePill').textContent = code;
  // Numero di gara, indirizzo e utente si ricordano; la password no, si
  // riscrive (o meglio: sta nelle variabili d'ambiente del server).
  if($('aubDriverId') && !$('aubDriverId').value) $('aubDriverId').value = localStorage.getItem('pc_aub_driver') || '';
  if($('aubUrl')) $('aubUrl').value = localStorage.getItem('pc_aub_url') || '';
  if($('aubUser')) $('aubUser').value = localStorage.getItem('pc_aub_user') || '';
  setTimingSource(localStorage.getItem('pc_timing_source') || 'server');
  renderQbEditor();
  renderFlashEditor();
  renderFuelSystemUI();
  renderAlarmCard();
  applyBoxAwake();
  setupPushNotifications();
}

function sendDayMode(){ socket.emit('dayModeUpdate', { dayMode: !$('dayModeToggle').checked }); }

function flashConfirm(btnEl){
  if(!btnEl) return;
  const originalText = btnEl.textContent;
  btnEl.classList.add('sent-confirm');
  btnEl.textContent = 'Inviato ✓';
  setTimeout(() => {
    btnEl.classList.remove('sent-confirm');
    btnEl.textContent = originalText;
  }, 1200);
}

function renderQbEditor(){
  const el = $('qbEditor');
  if(!el) return;
  el.innerHTML = '';
  quickButtons.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'qb-row';
    row.innerHTML = `
      <input type="text" value="${b.label}" oninput="quickButtons[${i}].label=this.value">
      <input type="color" value="${b.color}" oninput="quickButtons[${i}].color=this.value">`;
    el.appendChild(row);
  });
}

function saveQuickButtons(){
  save('pc_qb', quickButtons);
  socket.emit('quickButtonsUpdate', { buttons: quickButtons });
}

function renderFlashEditor(){
  const el = $('flashEditor');
  if(!el) return;
  el.innerHTML = '';
  flashPresets.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'flash-row';
    row.innerHTML = `
      <input type="text" value="${p.text}" oninput="flashPresets[${i}].text=this.value">
      <input type="color" value="${p.color}" oninput="flashPresets[${i}].color=this.value">
      <input type="number" value="${p.duration}" min="2" max="60" oninput="flashPresets[${i}].duration=+this.value" title="secondi">
      <button class="btn small primary" onclick="sendFlashPreset(${i}, this)">Invia</button>`;
    el.appendChild(row);
  });
}

function addFlashPreset(){
  flashPresets.push({text:'NUOVO MESSAGGIO', color:'#2FB6C4', duration:6});
  save('pc_flash', flashPresets);
  renderFlashEditor();
}

function sendFlashPreset(i, btnEl){
  save('pc_flash', flashPresets);
  const p = flashPresets[i];
  socket.emit('flashMessage', { text: p.text, color: p.color, durationSeconds: p.duration });
  flashConfirm(btnEl);
}

// ---------- cronologia dei messaggi dall'auto ----------
// Il server conserva i messaggi della stanza e li manda al box quando si ricollega;
// il box ne tiene una copia sul telefono, cosi' resta anche ricaricando la pagina.
// Un messaggio ha un identificativo: arrivando due volte (dal vivo e poi dalla
// cronologia) compare una volta sola, e solo quello dal vivo suona e vibra.

const HISTORY_MAX = 100;

function loadHistoryLocal(){
  const h = load('pc_history', null);
  return h && h.code === code && Array.isArray(h.items) ? h.items : [];
}

function saveHistoryLocal(items){ save('pc_history', { code: code, items: items }); }

function formatLogTime(at){
  const d = new Date(at);
  const ora = d.toLocaleTimeString('it-IT');
  return d.toDateString() === new Date().toDateString()
    ? ora
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + ora;
}

function renderHistory(items){
  const log = $('log');
  if(!log) return;
  log.innerHTML = '';
  items.forEach(m => {
    const div = document.createElement('div');
    div.className = 'log-item';
    const testo = document.createElement('span');
    testo.textContent = m.label;          // testo semplice: niente HTML dal messaggio
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = formatLogTime(m.at);
    div.appendChild(testo);
    div.appendChild(t);
    log.prepend(div);
  });
}

/** Aggiunge i messaggi nuovi alla cronologia; `dalVivo` fa suonare e vibrare. */
function mergeHistory(nuovi, dalVivo){
  const attuali = loadHistoryLocal();
  const noti = new Set(attuali.map(m => m.id));
  const aggiunti = [];
  (nuovi || []).forEach(m => {
    if(!m) return;
    const id = m.id || (m.at + ':' + m.label);
    if(noti.has(id)) return;
    noti.add(id);
    aggiunti.push({ id: id, label: String(m.label == null ? '' : m.label), at: Number(m.at) || Date.now() });
  });
  if(!aggiunti.length){ renderHistory(attuali); return false; }
  const tutti = attuali.concat(aggiunti).sort((a, b) => a.at - b.at).slice(-HISTORY_MAX);
  saveHistoryLocal(tutti);
  renderHistory(tutti);
  if(dalVivo) avvisaMessaggio();
  return true;
}

function addLog(m){ mergeHistory([m], true); }

function clearHistoryLocal(){
  saveHistoryLocal([]);
  renderHistory([]);
}

function clearLog(){
  clearHistoryLocal();
  if(socket && socket.connected) socket.emit('historyClear');
}

// ---------- avviso, sirena e schermo acceso ----------

// Un messaggio dal vivo: vibrazione SOS e sirena (o un bip, se la sirena e' spenta).
function avvisaMessaggio(){
  if(navigator.vibrate) navigator.vibrate(SOS_VIBRATION);
  if(loadSirenSettings().on) playSiren(); else playAlertBeep();
}

function renderAlarmCard(){
  const s = loadSirenSettings();
  if($('sirenToggle')) $('sirenToggle').checked = s.on;
  if($('sirenVolume')) $('sirenVolume').value = Math.round(s.volume * 100);
  if($('awakeToggle')) $('awakeToggle').checked = localStorage.getItem('pc_box_awake') === '1';
}

function setSirenOn(on){
  const s = loadSirenSettings();
  s.on = !!on;
  saveSirenSettings(s);
}

function setSirenVolume(v){
  const s = loadSirenSettings();
  s.volume = Math.min(1, Math.max(0.2, Number(v) / 100));
  saveSirenSettings(s);
}

// Il tocco sul pulsante serve anche a sbloccare l'audio del browser.
function testSiren(){
  if(navigator.vibrate) navigator.vibrate(SOS_VIBRATION);
  playSiren();
}

// Schermo sempre acceso sul box: la pagina resta in primo piano e la connessione non
// cade, cosi' la sirena suona sempre. Si perde se la pagina va in secondo piano e si
// riprende al ritorno. Consuma batteria.
let boxWakeLock = null;

function setAwakeStatus(testo){
  if($('awakeStatus')) $('awakeStatus').textContent = testo;
}

async function applyBoxAwake(){
  const on = localStorage.getItem('pc_box_awake') === '1';
  if(!on){
    try{ if(boxWakeLock) await boxWakeLock.release(); }catch(e){}
    boxWakeLock = null;
    setAwakeStatus('Spento: lo schermo si spegne come al solito.');
    return;
  }
  if(!navigator.wakeLock){
    setAwakeStatus('Questo telefono non lo permette.');
    return;
  }
  try{
    boxWakeLock = await navigator.wakeLock.request('screen');
    boxWakeLock.addEventListener('release', () => { boxWakeLock = null; });
    setAwakeStatus("Attivo: lo schermo resta acceso finch\u00e9 l'app \u00e8 aperta in primo piano.");
  }catch(e){
    setAwakeStatus('Non riesco ad attivarlo adesso: riprova toccando di nuovo.');
  }
}

function setBoxAwake(on){
  localStorage.setItem('pc_box_awake', on ? '1' : '0');
  applyBoxAwake();
}

document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible' && role === 'box' && localStorage.getItem('pc_box_awake') === '1' && !boxWakeLock) applyBoxAwake();
});
