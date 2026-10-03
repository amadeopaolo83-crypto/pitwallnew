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

function addLog(m){
  const log = $('log');
  if(!log) return;
  const div = document.createElement('div');
  div.className = 'log-item';
  const time = new Date(m.at).toLocaleTimeString('it-IT');
  div.innerHTML = `<span>${m.label}</span><span class="t">${time}</span>`;
  log.prepend(div);
  while(log.children.length > 5){
    log.removeChild(log.lastElementChild);
  }
  if(navigator.vibrate) navigator.vibrate([40,40,40]);
  playAlertBeep();
}

function clearLog(){
  const log = $('log');
  if(log) log.innerHTML = '';
}
