// Timer di gara: countdown di partenza, countdown di gara (sempre visibile
// sull'auto) e schermata Finish. Nessun ticking lato server: ogni client
// calcola da solo il tempo rimanente a partire da remaining/updatedAt/
// running/speed (vedi core.js/sockets.js lato server), cosi' tutti i
// dispositivi restano sincronizzati senza bisogno di un loop sul server.

let lastTimerState = null;
let prevTimerPhase = null;

function currentRemainingClient(baseRemaining, updatedAt, running, speed){
  if(!running) return baseRemaining;
  const elapsed = ((nowSync() - updatedAt) / 1000) * (speed || 1);
  return Math.max(0, baseRemaining - elapsed);
}

function fmtClock(totalSeconds){
  const s = Math.max(0, Math.round(totalSeconds));
  const p = n => String(n).padStart(2, '0');
  return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
}

function fmtHMS(totalSeconds){
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// Chiamata da connection.js quando arriva lo stato (al join e a ogni timerUpdate).
function applyTimerState(t){
  if(!t) return;
  const oldSpeed = lastTimerState ? lastTimerState.speed : 1;
  const partitaOra = prevTimerPhase === 'start' && t.phase === 'race';
  prevTimerPhase = t.phase;
  // Il carburante segue la stessa velocita' di test del timer: se e' appena
  // cambiata, si congela il consumo fatto con quella vecchia prima di
  // passare alla nuova (altrimenti i litri farebbero un salto).
  if(t.speed !== oldSpeed && typeof rebaseFuelSpeed === 'function'){
    rebaseFuelSpeed(oldSpeed);
    // Il box ripubblica il carburante ricalcolato, cosi' tutti ripartono dagli
    // stessi valori (anche chi si collega dopo il cambio di velocita').
    if(role === 'box' && fuelSystem.onTrack) syncFuelSystem();
  }
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
  flash.innerHTML = '<span>VIA!</span>';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1400);
}

// ---------- BOX: card di controllo ----------

function renderTimerBox(t){
  if($('timerPhaseLabel')) $('timerPhaseLabel').textContent =
    t.phase === 'start' ? 'Fase: conto alla rovescia di partenza' :
    t.phase === 'race' ? 'Fase: gara in corso' : 'Fase: arrivo';

  const sM = $('timerStartM'), sS = $('timerStartS');
  if(document.activeElement !== sM && document.activeElement !== sS){
    const tot = Math.round(t.startSeconds);
    if(sM) sM.value = Math.floor(tot / 60);
    if(sS) sS.value = tot % 60;
  }

  const rH = $('timerRaceH'), rM = $('timerRaceM'), rS = $('timerRaceS');
  const nessunoInFocus = document.activeElement !== rH && document.activeElement !== rM && document.activeElement !== rS;
  if(nessunoInFocus){
    const tot = Math.round(t.raceSeconds);
    if(rH) rH.value = Math.floor(tot / 3600);
    if(rM) rM.value = Math.floor((tot % 3600) / 60);
    if(rS) rS.value = tot % 60;
  }

  if($('timerSpeedLabel')){
    $('timerSpeedLabel').textContent = 'Velocità test: x' + t.speed + (t.speed !== 1 ? ' — ACCELERATO' : '');
    $('timerSpeedLabel').style.color = t.speed !== 1 ? 'var(--red)' : '';
  }
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
  const m = Number($('timerStartM').value) || 0;
  const s = Number($('timerStartS').value) || 0;
  const totale = Math.round(m * 60 + s);
  if(totale <= 0) return;
  socket.emit('timerStartSet', { seconds: totale });
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

// ---------- AUTO: banner partenza, schermata Finish ----------

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

// X sulla schermata Finish (sull'auto): un tocco la chiude e rimette il
// timer pronto per la prossima partenza.
function finishClose(){
  socket.emit('timerDebugJump', { preset: 'reset' });
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
    // Qualsiasi dispositivo collegato (box o auto) che vede il proprio
    // orologio a zero segnala il via: il server applica il cambio di fase
    // una volta sola, quindi le segnalazioni ripetute sono innocue.
    if(t.startRunning && rem <= 0 && socket && socket.connected) socket.emit('raceTimerAutoStart');
  } else if(t.phase === 'race'){
    const rem = currentRemainingClient(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
    if($('timerRaceDisplay')) $('timerRaceDisplay').textContent = fmtHMS(rem);
    if($('raceClockDisplay')) $('raceClockDisplay').textContent = fmtClock(rem);
    if(t.raceRunning && rem <= 0 && t.finishMode === 'auto' && socket && socket.connected && !t.finishTriggered){
      socket.emit('finishTrigger', {});
    }
  } else if($('raceClockDisplay')){
    $('raceClockDisplay').textContent = '00:00:00';
  }
}, 250);
