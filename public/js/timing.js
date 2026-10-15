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
  const fonte = (sorgente === 'manual' || sorgente === 'ponte') ? sorgente : 'server';
  localStorage.setItem('pc_timing_source', fonte);
  if($('timingServerPane')) $('timingServerPane').hidden = fonte !== 'server';
  if($('timingPontePane')) $('timingPontePane').hidden = fonte !== 'ponte';
  if($('timingManualPane')) $('timingManualPane').hidden = fonte !== 'manual';
  if($('segServer')) $('segServer').classList.toggle('active', fonte === 'server');
  if($('segPonte')) $('segPonte').classList.toggle('active', fonte === 'ponte');
  if($('segManual')) $('segManual').classList.toggle('active', fonte === 'manual');
  // Indirizzo e numero dell'ultima volta, cosi' non si riscrivono.
  if($('ponteUrl') && !$('ponteUrl').value) $('ponteUrl').value = localStorage.getItem('pc_ponte_url') || '';
  if($('ponteNumber') && !$('ponteNumber').value) $('ponteNumber').value = localStorage.getItem('pc_ponte_num') || '';
  // Passando a un'altra sorgente le altre si staccano davvero, non si nascondono
  // soltanto: due collegamenti aperti insieme si sovrascriverebbero a vicenda.
  if(esplicito && socket && socket.connected){
    if(fonte !== 'server') aubDisconnect();
    if(fonte !== 'ponte') ponteDisconnect();
  }
}

// Scelta di cosa mostrare sull'auto: la fa il box, vale per tutti i telefoni della squadra.
function setTimingView(view){
  const v = view === 'categoria' ? 'categoria' : 'assoluta';
  applyTimingView(v);
  if(socket && socket.connected) socket.emit('timingViewUpdate', { view: v });
}

// Scelta dell'aspetto della schermata auto (telefono o tablet): la fa il box, vale per
// tutta la squadra e si ricorda su questo dispositivo per dopo un riavvio del server.
function setAutoLayout(layout){
  const l = layout === 'tablet' ? 'tablet' : 'telefono';
  try{ localStorage.setItem('pc_auto_layout', l); }catch(e){}
  applyAutoLayout(l);
  if(socket && socket.connected) socket.emit('autoLayoutUpdate', { layout: l });
}

function applyTimingView(view){
  timingView = view === 'categoria' ? 'categoria' : 'assoluta';
  if($('segViewAss')) $('segViewAss').classList.toggle('active', timingView === 'assoluta');
  if($('segViewCat')) $('segViewCat').classList.toggle('active', timingView === 'categoria');
  if(lastTiming) renderTiming(lastTiming);
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
  // La chiave resta su questo dispositivo: non va riscritta a ogni apertura.
  if(pass){ try{ localStorage.setItem('pc_aub_pass', pass); }catch(e){} }
  if(btnEl) btnEl.disabled = true;
  setAubLabel('Stato: collegamento…');
  socket.emit('aubConnect', { driverId, url, user, pass }, (res) => {
    if(btnEl) btnEl.disabled = false;
    if(!res || !res.ok){
      setAubLabel('Errore: ' + ((res && res.error) || 'collegamento non riuscito'), true);
      return;
    }
    // Se il server riparte, il box si ricorda cosa stava leggendo e lo riavvia da solo.
    save('pc_aub', { code: code, driverId: driverId, url: url, user: user, active: true, at: Date.now() });
  });
}

function aubDisconnect(){
  socket.emit('aubDisconnect');
  const salvato = load('pc_aub', null);
  if(salvato) save('pc_aub', { ...salvato, active: false });
}

// Toglie la chiave da questo dispositivo (per esempio se il telefono passa a un altro).
function aubForgetKey(){
  try{ localStorage.removeItem('pc_aub_pass'); }catch(e){}
  if($('aubPass')) $('aubPass').value = '';
  setAubLabel('Chiave dimenticata su questo dispositivo');
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

// ---------- Nostro: i distacchi arrivano dal nostro ponte ----------

function ponteConnect(btnEl){
  const url = $('ponteUrl').value.trim();
  const number = $('ponteNumber').value.trim();
  if(!url){
    setPonteLabel("Incolla l'indirizzo della pagina dell'evento", true);
    $('ponteUrl').focus();
    return;
  }
  if(!number){
    setPonteLabel('Inserisci il numero di gara della vettura', true);
    $('ponteNumber').focus();
    return;
  }
  localStorage.setItem('pc_ponte_url', url);
  localStorage.setItem('pc_ponte_num', number);
  if(btnEl) btnEl.disabled = true;
  setPonteLabel('Stato: collegamento\u2026');
  socket.emit('ponteConnect', { url, number }, (res) => {
    if(btnEl) btnEl.disabled = false;
    if(!res || !res.ok){
      setPonteLabel('Errore: ' + ((res && res.error) || 'collegamento non riuscito'), true);
      return;
    }
    // Se il server riparte, i telefoni si ricordano cosa stava leggendo.
    save('pc_ponte', { code: code, url: url, number: number, active: true, at: Date.now() });
  });
}

function ponteDisconnect(){
  socket.emit('ponteDisconnect');
  const salvato = load('pc_ponte', null);
  if(salvato) save('pc_ponte', { ...salvato, active: false });
}

function setPonteLabel(text, isError){
  const el = $('ponteStatusLabel');
  if(!el) return;
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--muted)';
}

function renderPonteStatus(f){
  if(!f) return;
  let testo = 'Stato: ' + (f.status || '\u2014');
  if(f.eventName) testo += ' \u00b7 ' + f.eventName;
  if(f.driverNumber) testo += ' \u00b7 vettura ' + f.driverNumber;
  if(f.session) testo += ' \u00b7 ' + f.session;
  if(f.flag) testo += ' \u00b7 bandiera ' + f.flag;
  if(f.error) testo += ' \u00b7 ' + f.error;
  setPonteLabel(testo, Boolean(f.error));
}
