// Distacchi: dalla classifica live di AUBServer, o inseriti a mano dal box.
// Il collegamento lo apre il server PitComm, non il telefono: AUBServer non
// manda header CORS e la password resta in un posto solo invece che nel
// browser di ogni dispositivo della squadra.

function sendTiming(btnEl){
  socket.emit('timingUpdate', {
    position: $('timingPosInput').value ? +$('timingPosInput').value : null,
    gapAhead: $('timingGapAheadInput').value,
    gapBehind: $('timingGapBehindInput').value,
    nameAhead: $('timingNameAheadInput').value,
    nameBehind: $('timingNameBehindInput').value,
  });
  flashConfirm(btnEl);
}

// Le due sorgenti scrivono nello stesso posto della vista auto, quindi una
// sola alla volta puo' essere attiva: se restassero accese entrambe, ogni
// aggiornamento della classifica cancellerebbe i valori scritti a mano.
// `esplicito` distingue il tocco sul selettore dal semplice ripristino della
// scelta all'apertura della pagina. La scelta e' di questo dispositivo, ma
// staccare il collegamento vale per tutta la stanza: se lo facesse anche al
// ripristino, un box aperto sui manuali spegnerebbe la classifica agli altri.
function setTimingSource(sorgente, esplicito){
  const server = sorgente !== 'manual';
  localStorage.setItem('pc_timing_source', server ? 'server' : 'manual');
  if($('timingServerPane')) $('timingServerPane').hidden = !server;
  if($('timingManualPane')) $('timingManualPane').hidden = server;
  if($('segServer')) $('segServer').classList.toggle('active', server);
  if($('segManual')) $('segManual').classList.toggle('active', !server);
  // Passando ai manuali il collegamento si stacca davvero, non si nasconde
  // soltanto: un collegamento aperto continuerebbe a sovrascrivere.
  if(esplicito && !server && socket && socket.connected) aubDisconnect();
}

function aubConnect(btnEl){
  const driverId = $('aubDriverId').value.trim();
  if(!driverId){
    setAubLabel('Inserisci il numero di gara della vettura', true);
    $('aubDriverId').focus();
    return;
  }
  localStorage.setItem('pc_aub_driver', driverId);
  const url = $('aubUrl').value.trim();
  const user = $('aubUser').value.trim();
  const pass = $('aubPass').value;
  if(url) localStorage.setItem('pc_aub_url', url);
  if(user) localStorage.setItem('pc_aub_user', user);
  if(btnEl) btnEl.disabled = true;
  setAubLabel('Stato: collegamento…');
  socket.emit('aubConnect', { driverId, url, user, pass }, (res) => {
    if(btnEl) btnEl.disabled = false;
    if(!res || !res.ok) setAubLabel('Errore: ' + ((res && res.error) || 'collegamento non riuscito'), true);
  });
}

function aubDisconnect(){
  socket.emit('aubDisconnect');
}

function setAubLabel(text, isError){
  const el = $('aubStatusLabel');
  if(!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function renderAubStatus(a){
  if(!a) return;
  if($('aubDriverId') && a.driverId && !$('aubDriverId').value) $('aubDriverId').value = a.driverId;
  let testo = 'Stato: ' + (a.status || '—');
  if(a.driverId) testo += ' · vettura ' + a.driverId;
  if(a.flag && a.flag.label) testo += ' · bandiera ' + a.flag.label;
  if(a.error) testo += ' · ' + a.error;
  setAubLabel(testo, Boolean(a.error));
}
