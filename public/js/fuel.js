// Carburante: capienza, litri, consumo stimato e conteggio che scende da solo
// mentre la vettura e' in pista.

// Ogni telefono si tiene una copia dei valori del carburante (legata al codice
// team): se il server riparte da zero, la rimanda indietro (vedi connection.js).
function saveFuelLocal(){
  save('pc_fuel', { code: code, fs: fuelSystem, at: Date.now() });
}

function renderFuelSystemUI(){
  const fs = fuelSystem;
  if($('tankCapacityInput')) $('tankCapacityInput').value = fs.tankCapacityLiters;
  if($('trackStatusLabel')) $('trackStatusLabel').textContent = 'Stato: ' + (fs.onTrack ? 'in pista' : 'ai box');
  // I due pulsanti mostrano lo stato attuale: si accende quello attivo.
  if($('btnOnTrack')){
    $('btnOnTrack').classList.toggle('on', !!fs.onTrack);
    $('btnOnTrack').setAttribute('aria-pressed', fs.onTrack ? 'true' : 'false');
  }
  if($('btnAtBox')){
    $('btnAtBox').classList.toggle('on', !fs.onTrack);
    $('btnAtBox').setAttribute('aria-pressed', fs.onTrack ? 'false' : 'true');
  }
  if($('rateLabel')) $('rateLabel').textContent = fs.consumptionRatePerHour
    ? 'Consumo stimato: ' + fs.consumptionRatePerHour.toFixed(1) + ' L/ora'
    : 'Consumo stimato: non ancora impostato';
  if($('knownRateLph') && fs.consumptionRatePerHour) $('knownRateLph').value = fs.consumptionRatePerHour.toFixed(1);
  const liveLiters = computeLiveLiters();
  if($('litersNowLabel')) $('litersNowLabel').textContent = 'Litri in serbatoio: ' + liveLiters.toFixed(1) + ' / ' + fs.tankCapacityLiters + ' L';
  const pct = fs.tankCapacityLiters > 0 ? Math.round((liveLiters / fs.tankCapacityLiters) * 100) : 0;
  if($('fuelValLabel')) $('fuelValLabel').textContent = 'Livello: ' + pct + '%';
  const autonomyMin = fs.consumptionRatePerHour ? (liveLiters / fs.consumptionRatePerHour) * 60 : null;
  const autonomyTxt = 'Autonomia stimata: ' + (autonomyMin==null ? '—' : Math.round(autonomyMin)+' min');
  if($('autonomyLiveLabel')) $('autonomyLiveLabel').textContent = autonomyTxt;
  if($('autonomyLiveAuto')) $('autonomyLiveAuto').textContent = autonomyTxt;
}

// La velocita' di test del timer gara (x1/x60/x300) acceleta anche il
// consumo carburante, cosi' durante un test si vede scendere in pochi
// secondi invece che nelle ore vere della gara.
function fuelTestSpeed(){
  return (typeof lastTimerState !== 'undefined' && lastTimerState && lastTimerState.speed) ? lastTimerState.speed : 1;
}

function computeLiveLiters(){
  const fs = fuelSystem;
  if(!fs.onTrack || !fs.consumptionRatePerHour || !fs.sessionStartAt) return fs.currentLiters;
  const elapsedHours = ((nowSync() - fs.sessionStartAt) / 3600000) * fuelTestSpeed();
  return Math.max(0, fs.sessionStartLiters - elapsedHours * fs.consumptionRatePerHour);
}

// Quando la velocita' di test cambia (timer.js) si "congela" il consumo
// fatto finora con la velocita' precedente, poi si riparte da zero con la
// nuova: altrimenti il salto di velocita' farebbe saltare anche i litri.
function rebaseFuelSpeed(oldSpeed){
  const fs = fuelSystem;
  if(!fs.onTrack || !fs.sessionStartAt) return;
  const elapsedHours = ((nowSync() - fs.sessionStartAt) / 3600000) * (oldSpeed || 1);
  const liters = Math.max(0, fs.sessionStartLiters - elapsedHours * (fs.consumptionRatePerHour || 0));
  fs.currentLiters = liters;
  fs.sessionStartAt = nowSync();
  fs.sessionStartLiters = liters;
}

function syncFuelSystem(){
  saveFuelLocal();
  socket.emit('fuelSystemUpdate', fuelSystem);
}

function tickFuelSystem(){
  const liveLiters = computeLiveLiters();
  const pct = fuelSystem.tankCapacityLiters > 0 ? Math.round((liveLiters / fuelSystem.tankCapacityLiters) * 100) : 0;
  const autonomyMin = fuelSystem.consumptionRatePerHour ? Math.round((liveLiters / fuelSystem.consumptionRatePerHour) * 60) : null;
  renderFuelSystemUI();
  socket.emit('fuelUpdate', { percent: pct });
  socket.emit('autonomyUpdate', { minutes: autonomyMin });
  if(liveLiters <= 0){
    fuelSystem.currentLiters = 0;
    fuelSystem.onTrack = false;
    stopFuelTicking();
    syncFuelSystem();
  }
}

function stopFuelTicking(){ clearInterval(fuelTickInterval); fuelTickInterval = null; }

function resumeFuelTicking(){
  stopFuelTicking();
  if(fuelSystem.onTrack && fuelSystem.consumptionRatePerHour){
    fuelTickInterval = setInterval(tickFuelSystem, 3000);
    tickFuelSystem();
  } else {
    renderFuelSystemUI();
  }
}

function setTankCapacity(){
  const cap = +$('tankCapacityInput').value;
  if(!cap) return;
  fuelSystem.tankCapacityLiters = cap;
  fuelSystem.currentLiters = Math.min(fuelSystem.currentLiters, cap);
  if(fuelSystem.sessionStartLiters) fuelSystem.sessionStartLiters = Math.min(fuelSystem.sessionStartLiters, cap);
  syncFuelSystem();
  renderFuelSystemUI();
}

function setStartingLiters(){
  const liters = +$('startingLitersInput').value;
  if(liters === 0 || isNaN(liters) || $('startingLitersInput').value === '') return;
  fuelSystem.currentLiters = Math.min(liters, fuelSystem.tankCapacityLiters);
  fuelSystem.onTrack = false;
  fuelSystem.sessionStartAt = null;
  stopFuelTicking();
  syncFuelSystem();
  renderFuelSystemUI();
}

function doRefuel(){
  const added = +$('refuelLitersInput').value;
  if(!added) return;
  const before = computeLiveLiters();
  fuelSystem.currentLiters = Math.min(fuelSystem.tankCapacityLiters, before + added);
  fuelSystem.onTrack = false;
  fuelSystem.sessionStartAt = null;
  stopFuelTicking();
  syncFuelSystem();
  renderFuelSystemUI();
  $('refuelLitersInput').value = '';
}

function setKnownRate(){
  const lph = +$('knownRateLph').value;
  if(!lph){
    if($('rateLabel')) $('rateLabel').textContent = 'Inserisci un consumo valido (L/ora)';
    return;
  }
  fuelSystem.consumptionRatePerHour = lph;
  syncFuelSystem();
  resumeFuelTicking();
}

function setOnTrack(goingOnTrack){
  // Se e' gia' in quello stato non si fa nulla: ripremere il pulsante acceso
  // non deve far ripartire il conteggio.
  if(!!goingOnTrack === !!fuelSystem.onTrack) return;
  if(goingOnTrack){
    fuelSystem.currentLiters = computeLiveLiters();
    fuelSystem.onTrack = true;
    fuelSystem.sessionStartAt = nowSync();
    fuelSystem.sessionStartLiters = fuelSystem.currentLiters;
  } else {
    fuelSystem.currentLiters = computeLiveLiters();
    fuelSystem.onTrack = false;
    fuelSystem.sessionStartAt = null;
  }
  syncFuelSystem();
  resumeFuelTicking();
}

function markDryAndCalibrate(){
  if(!fuelSystem.onTrack || !fuelSystem.sessionStartAt){
    if($('rateLabel')) $('rateLabel').textContent = 'Metti prima la macchina "in pista" per poter calibrare';
    return;
  }
  const elapsedHours = (Date.now() - fuelSystem.sessionStartAt) / 3600000;
  fuelSystem.consumptionRatePerHour = elapsedHours > 0 ? fuelSystem.sessionStartLiters / elapsedHours : null;
  fuelSystem.currentLiters = 0;
  fuelSystem.onTrack = false;
  fuelSystem.sessionStartAt = null;
  stopFuelTicking();
  syncFuelSystem();
  renderFuelSystemUI();
  socket.emit('fuelUpdate', { percent: 0 });
  socket.emit('autonomyUpdate', { minutes: 0 });
}
