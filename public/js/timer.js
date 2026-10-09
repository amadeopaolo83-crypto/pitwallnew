// Timer di gara: countdown di partenza, countdown di gara, popup periodici
// sull'auto e schermata Finish. Nessun ticking lato server: ogni client
// calcola da solo il tempo rimanente a partire da remaining/updatedAt/
// running/speed (vedi core.js/sockets.js lato server), cosi' tutti i
// dispositivi restano sincronizzati senza bisogno di un loop sul server.

let lastTimerState = null;
let prevRaceRemainingForPopup = null;
let popupActiveUntil = 0;
let finishHoldTimer = null;
let prevTimerPhase = null;

function currentRemainingClient(baseRemaining, updatedAt, running, speed){
  if(!running) return baseRemaining;
  const elapsed = ((Date.now() - updatedAt) / 1000) * (speed || 1);
  return Math.max(0, baseRemaining - elapsed);
}

function fmtHMS(totalSeconds){
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// Chiamata da connection.js quando arriva lo stato (al join e a ogni timerUpdate).
function applyTimerState(t){
  if(!t) return;
  const partitaOra = prevTimerPhase === 'start' && t.phase === 'race';
  prevTimerPhase = t.phase;
  lastTimerState = t;
  if(role === 'box') renderTimerBox(t);
  if(role === 'auto') renderTimerAuto(t);
  // Il lampeggio verde "si parte" si vede solo sull'auto: e' il pilota che
  // deve accorgersi del cambio, non il box che lo ha appena comandato.
  if(partitaOra && role === 'auto') flashRacePartita();
}

function flashRacePartita(){
  const flash = document.createElement('div');
  flash.className = 'race-start-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 900);
}

// ---------- BOX: card di controllo ----------

function renderTimerBox(t){
  if($('timerPhaseLabel')) $('timerPhaseLabel').textContent =
    t.phase === 'start' ? 'Fase: conto alla rovescia di partenza' :
    t.phase === 'race' ? 'Fase: gara in corso' : 'Fase: arrivo';

  const sInput = $('timerStartInput');
  if(sInput && document.activeElement !== sInput) sInput.value = Math.round(t.startSeconds / 60);

  const rH = $('timerRaceH'), rM = $('timerRaceM'), rS = $('timerRaceS');
  const nessunoInFocus = document.activeElement !== rH && document.activeElement !== rM && document.activeElement !== rS;
  if(nessunoInFocus){
    const tot = Math.round(t.raceSeconds);
    if(rH) rH.value = Math.floor(tot / 3600);
    if(rM) rM.value = Math.floor((tot % 3600) / 60);
    if(rS) rS.value = tot % 60;
  }

  if($('timerSpeedLabel')) $('timerSpeedLabel').textContent = 'Velocità test: x' + t.speed;
  [['timerSpeed1', 1], ['timerSpeed60', 60], ['timerSpeed300', 300]].forEach(([id, val]) => {
    const el = $(id);
    if(el) el.classList.toggle('active', t.speed === val);
  });

  if($('finishModeManual')) $('finishModeManual').classList.toggle('active', t.finishMode !== 'auto');
  if($('finishModeAuto')) $('finishModeAuto').classList.toggle('active', t.finishMode === 'auto');
  if($('finishBgPhoto')) $('finishBgPhoto').classList.toggle('active', t.finishBackground !== 'dark');
  if($('finishBgDark')) $('finishBgDark').classList.toggle('active', t.finishBackground === 'dark');
  const dn = $('finishDriverInput');
  if(dn && document.activeElement !== dn) dn.value = t.finishDriverName || '';
}

function timerStartSet(){
  const minuti = Number($('timerStartInput').value) || 0;
  if(minuti <= 0) return;
  socket.emit('timerStartSet', { seconds: Math.round(minuti * 60) });
}
function timerStartControl(action){ socket.emit('timerStartControl', { action }); }

function timerRaceSet(){
  const h = Number($('timerRaceH').value) || 0;
  const m = Number($('timerRaceM').value) || 0;
  const s = Number($('timerRaceS').value) || 0;
  const totale = Math.round(h * 3600 + m * 60 + s);
  if(totale <= 0) return;
  socket.emit('timerRaceSet', { seconds: totale });
}
function timerRaceControl(action){ socket.emit('timerRaceControl', { action }); }

function timerSetSpeed(speed){ socket.emit('timerTestSpeed', { speed }); }
function timerDebugJump(preset){ socket.emit('timerDebugJump', { preset }); }

function finishSetMode(mode){ socket.emit('finishConfigUpdate', { mode }); }
function finishSetBackground(bg){ socket.emit('finishConfigUpdate', { background: bg }); }
function finishDriverNameChanged(){ socket.emit('finishConfigUpdate', { driverName: $('finishDriverInput').value }); }

function finishTriggerManual(){
  const posInput = $('finishPositionInput');
  const pos = posInput && posInput.value ? Number(posInput.value) : undefined;
  socket.emit('finishTrigger', { position: pos });
}

// ---------- AUTO: banner partenza, popup periodici, schermata Finish ----------

function renderTimerAuto(t){
  const banner = $('timerStartBanner');
  const strip = $('timingStrip');
  const inStart = t.phase === 'start';
  if(banner) banner.hidden = !inStart;
  if(strip) strip.hidden = inStart;
  renderFinishScreen(t);
}

function renderFinishScreen(t){
  const el = $('finishScreen');
  if(!el) return;
  if(t.phase !== 'finished'){ el.hidden = true; el.classList.remove('finish-bg-dark', 'finish-bg-photo'); return; }
  el.hidden = false;
  el.classList.remove('finish-bg-dark', 'finish-bg-photo');
  el.classList.add(t.finishBackground === 'dark' ? 'finish-bg-dark' : 'finish-bg-photo');
  if($('finishPositionLabel')) $('finishPositionLabel').textContent = t.finishPosition ? ('P' + t.finishPosition) : 'ARRIVO';
  if($('finishDriverLabel')) $('finishDriverLabel').textContent = t.finishDriverName || '';
}

// Tenuta di 10 secondi sulla X della schermata Finish (sull'auto), per
// evitare che si chiuda per un tocco involontario del pilota.
function finishHoldStart(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  const fill = $('finishXFill');
  if(fill){ fill.style.transition = 'width 10s linear'; fill.style.width = '100%'; }
  finishHoldTimer = setTimeout(() => {
    socket.emit('timerDebugJump', { preset: 'reset' });
  }, 10000);
}
function finishHoldCancel(){
  clearTimeout(finishHoldTimer);
  const fill = $('finishXFill');
  if(fill){ fill.style.transition = 'width .2s ease'; fill.style.width = '0%'; }
}

// ---------- popup periodici: ogni ora intera trascorsa, ogni 15' nell'ultima ora ----------

function checkPopup(t, remaining){
  if(prevRaceRemainingForPopup == null){ prevRaceRemainingForPopup = remaining; return; }
  const elapsed = t.raceSeconds - remaining;
  const prevElapsed = t.raceSeconds - prevRaceRemainingForPopup;
  const sogliePassate = [];
  for(let h = 3600; h <= t.raceSeconds; h += 3600) sogliePassate.push(h);
  const soglieRimanenti = [3600, 2700, 1800, 900];
  const crossedElapsed = sogliePassate.some(s => prevElapsed < s && elapsed >= s);
  const crossedRemaining = soglieRimanenti.some(s => prevRaceRemainingForPopup > s && remaining <= s);
  if((crossedElapsed || crossedRemaining) && Date.now() > popupActiveUntil) showTimerPopup(remaining);
  prevRaceRemainingForPopup = remaining;
}

function showTimerPopup(remaining){
  const el = $('timerPopup');
  if(!el) return;
  const speed = lastTimerState ? lastTimerState.speed : 1;
  const durataMs = speed > 1 ? Math.max(400, Math.min(10000, 10000 / speed)) : 10000;
  popupActiveUntil = Date.now() + durataMs;
  if($('timerPopupText')) $('timerPopupText').textContent = fmtHMS(remaining) + ' rimanenti';
  el.hidden = false;
  clearTimeout(showTimerPopup._t);
  showTimerPopup._t = setTimeout(() => { el.hidden = true; }, durataMs);
}

// ---------- ciclo locale: aggiorna i display e segnala il via a fine countdown ----------

setInterval(() => {
  const t = lastTimerState;
  if(!t) return;

  if(t.phase === 'start'){
    const rem = currentRemainingClient(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
    const txt = fmtHMS(rem);
    const inAllarme = t.startRunning && rem <= 15 && rem > 0;
    [$('timerStartDisplay'), $('timerStartBannerDisplay')].forEach(el => {
      if(!el) return;
      el.textContent = txt;
      el.classList.toggle('blink-warn', inAllarme);
    });
    prevRaceRemainingForPopup = null;
    // Qualsiasi dispositivo collegato (box o auto) che vede il proprio
    // orologio a zero segnala il via: il server applica il cambio di fase
    // una volta sola, quindi le segnalazioni ripetute sono innocue.
    if(t.startRunning && rem <= 0 && socket && socket.connected) socket.emit('raceTimerAutoStart');
  } else if(t.phase === 'race'){
    const rem = currentRemainingClient(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
    if($('timerRaceDisplay')) $('timerRaceDisplay').textContent = fmtHMS(rem);
    // I promemoria a comparsa (ogni ora, ogni 15' nell'ultima ora) li deve
    // vedere solo il pilota: sul box restano solo i numeri nella card.
    if(t.raceRunning && role === 'auto') checkPopup(t, rem);
    if(t.raceRunning && rem <= 0 && t.finishMode === 'auto' && socket && socket.connected && !t.finishTriggered){
      socket.emit('finishTrigger', {});
    }
  } else {
    prevRaceRemainingForPopup = null;
  }
}, 250);
