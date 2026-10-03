// Gara: pulsanti "Avvio gara" / "Fine gara" della vista box. Finche' la gara e'
// avviata il server si tiene sveglio da solo (keep-alive lato server); con
// "Fine gara" smette e Render puo' spegnerlo se nessuno lo usa.

let raceState = { active: false, startedAt: null };

function fmtOra(ts){
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function renderRace(race){
  raceState = race || { active: false, startedAt: null };
  const on = !!raceState.active;
  const bStart = $('btnRaceStart'), bStop = $('btnRaceStop');
  if(bStart){
    bStart.classList.toggle('on', on);
    bStart.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if(bStop){
    bStop.classList.toggle('on', !on);
    bStop.setAttribute('aria-pressed', on ? 'false' : 'true');
  }
  const label = $('raceStatusLabel');
  if(label){
    if(on) label.textContent = 'Gara in corso dalle ' + fmtOra(raceState.startedAt) + ' · server tenuto sveglio';
    else if(raceState.endedBy === 'timeout') label.textContent = 'Gara chiusa in automatico dopo 26 ore · server libero di spegnersi';
    else label.textContent = 'Gara ferma · il server può spegnersi se nessuno lo usa';
  }
  // Copia locale: serve a rimettere in piedi la gara se il server riparte.
  save('pc_race', { code: code, active: on, startedAt: raceState.startedAt });
}

function startRace(){
  if(raceState.active) return;
  socket.emit('raceStart');
}

function stopRace(){
  if(!raceState.active) return;
  if(!confirm('Terminare la gara? Il server potrà spegnersi se nessuno lo usa.')) return;
  socket.emit('raceStop');
}
