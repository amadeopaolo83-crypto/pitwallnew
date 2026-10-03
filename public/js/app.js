// Avvio: se il dispositivo era gia' entrato in una stanza si ricollega da solo,
// e registra il service worker. Va caricato per ultimo.

// ---------- AUTO RECONNECT ----------
window.addEventListener('load', () => {
  const savedCode = localStorage.getItem('pc_code');
  const savedRole = localStorage.getItem('pc_role');
  const savedServer = localStorage.getItem('pc_server');
  if(savedCode && savedRole && savedServer){
    code = savedCode; role = savedRole;
    connect(savedServer);
  }
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
});
