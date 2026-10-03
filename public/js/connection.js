// Ingresso nella stanza e collegamento socket: scelta del ruolo, join,
// applicazione dello stato ricevuto e registrazione degli ascoltatori.

// Una copia locale dei valori del carburante resta valida per questo tempo
// (una gara di 24h + margine): oltre, e' roba di un'altra sessione.
const FUEL_LOCAL_MAX_MS = 30 * 3600 * 1000;

function setLandingStatus(msg, isError){
  const el = $('landingStatus');
  if(!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function joinAs(chosenRole){
  const codeVal = $('teamCode').value.trim().toUpperCase();
  if(!codeVal){
    setLandingStatus('Inserisci prima il codice team', true);
    $('teamCode').focus();
    return;
  }
  code = codeVal;
  role = chosenRole;
  const serverUrl = $('serverUrl').value.trim() || DEFAULT_SERVER_URL;
  localStorage.setItem('pc_code', code);
  localStorage.setItem('pc_role', role);
  localStorage.setItem('pc_server', serverUrl);
  $('btnBox').disabled = true; $('btnAuto').disabled = true;
  setLandingStatus('Connessione al server in corso…');
  const joinTimeout = setTimeout(() => {
    setLandingStatus('Il server ci sta mettendo più del solito (potrebbe essersi "addormentato"): attendi ancora qualche secondo…');
  }, 8000);
  connect(serverUrl, joinTimeout);
}

function connect(serverUrl, joinTimeout){
  socket = io(serverUrl, { transports:['websocket','polling'] });
  socket.on('connect', () => {
    socket.emit('join', { code, role }, (res) => {
      clearTimeout(joinTimeout);
      if(!res || !res.ok){
        setLandingStatus('Errore durante il collegamento, riprova.', true);
        $('btnBox').disabled = false; $('btnAuto').disabled = false;
        return;
      }
      setLandingStatus('');
      applyState(res.state);
      $('landing').hidden = true;
      if(role === 'auto') enterAutoView(); else enterBoxView();
    });
  });
  socket.on('connect_error', () => {
    setLandingStatus('Impossibile raggiungere il server. Controlla la connessione e riprova.', true);
    $('btnBox').disabled = false; $('btnAuto').disabled = false;
  });
  registerListeners();
}

// Se il server e' appena ripartito (stanza vuota, flag `fresh`) gli si
// rimandano i valori che questo telefono si ricorda: carburante, pulsanti
// rapidi e gara in corso. Ogni voce vale una sola volta: appena un dispositivo
// la rimanda, il server smette di considerarla vuota. Ritorna true se ha
// ripristinato il carburante.
function restoreIntoFreshServer(state){
  const fresh = state.fresh || {};
  let fuelRestored = false;

  if(fresh.fuel){
    const saved = load('pc_fuel', null);
    if(saved && saved.fs && saved.code === code && (Date.now() - saved.at) < FUEL_LOCAL_MAX_MS){
      fuelSystem = saved.fs;
      state.fuelSystem = saved.fs;
      socket.emit('fuelSystemUpdate', saved.fs);
      const live = computeLiveLiters();
      const pct = fuelSystem.tankCapacityLiters > 0 ? Math.round((live / fuelSystem.tankCapacityLiters) * 100) : 0;
      state.fuel = { percent: pct, updatedAt: Date.now() };
      socket.emit('fuelUpdate', { percent: pct });
      fuelRestored = true;
    }
  }

  if(fresh.buttons && localStorage.getItem('pc_qb')){
    state.quickButtons = quickButtons;
    socket.emit('quickButtonsUpdate', { buttons: quickButtons });
  }

  if(fresh.race){
    const r = load('pc_race', null);
    if(r && r.code === code && r.active && r.startedAt){
      socket.emit('raceRestore', { startedAt: r.startedAt });
    }
  }

  return fuelRestored;
}

function applyState(state){
  const fuelRestored = restoreIntoFreshServer(state);
  const fresh = state.fresh || {};

  if(state.quickButtons){
    quickButtons = state.quickButtons;
    if(!fresh.buttons) save('pc_qb', quickButtons);
  }
  document.body.classList.toggle('night', !state.dayMode);
  if($('dayModeToggle')) $('dayModeToggle').checked = !state.dayMode;
  if(state.fuelSystem){
    fuelSystem = state.fuelSystem;
    // Si salva la copia locale solo se il server ha valori veri (o li abbiamo
    // appena ripristinati), non i suoi valori di partenza.
    if(!fresh.fuel || fuelRestored) saveFuelLocal();
  }
  renderFuel(state.fuel.percent);
  if(state.timing) renderTiming(state.timing);
  if(state.aub) renderAubStatus(state.aub);
  if(state.race) renderRace(state.race);
  renderQuickGrid();
  renderQbEditor();
  renderFlashEditor();
  renderFuelSystemUI();
  resumeFuelTicking();
}

function registerListeners(){
  socket.on('quickMessageReceived', (m) => addLog(m));
  socket.on('flashMessage', (m) => { if(role==='auto') showFlash(m); });
  socket.on('fuelUpdate', (f) => { renderFuel(f.percent); if($('fuelValLabel')) $('fuelValLabel').textContent = 'Livello: '+f.percent+'%'; });
  socket.on('autonomyUpdate', (a) => { if($('autonomyLiveLabel')) $('autonomyLiveLabel').textContent = 'Autonomia stimata: '+(a.minutes==null?'—':a.minutes+' min'); });
  socket.on('fuelSystemUpdate', (fs) => { fuelSystem = fs; saveFuelLocal(); renderFuelSystemUI(); resumeFuelTicking(); });
  socket.on('dayModeUpdate', (d) => { document.body.classList.toggle('night', !d.dayMode); if($('dayModeToggle')) $('dayModeToggle').checked = !d.dayMode; });
  socket.on('quickButtonsUpdate', (q) => { quickButtons = q.buttons; save('pc_qb', quickButtons); renderQuickGrid(); renderQbEditor(); });
  socket.on('raceStatus', renderRace);
  socket.on('timingUpdate', renderTiming);
  socket.on('aubStatus', renderAubStatus);
}

function resetRole(){
  if(socket) socket.disconnect();
  localStorage.removeItem('pc_code');
  localStorage.removeItem('pc_role');
  localStorage.removeItem('pc_server');
  location.reload();
}
