// Notifiche push: iscrizione del dispositivo box, cosi' i messaggi dell'auto
// arrivano anche a schermo spento.
//
// La chiave pubblica non sta piu' scritta qui: la dice il server
// (/vapid-public-key), cosi' si puo' cambiare senza toccare il client.

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function setPushStatus(text){
  const el = $('pushStatus');
  if(el) el.textContent = text;
}

// Vero se due chiavi (ArrayBuffer e Uint8Array) sono la stessa.
function sameKey(buf, arr){
  if(!buf) return false;
  const a = new Uint8Array(buf);
  if(a.length !== arr.length) return false;
  for(let i = 0; i < a.length; i++) if(a[i] !== arr[i]) return false;
  return true;
}

async function setupPushNotifications(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    setPushStatus('Notifiche non disponibili su questo browser');
    return;
  }
  try{
    // La chiave la fornisce il server: se non e' configurata, le notifiche sono spente.
    const res = await fetch(location.origin + '/vapid-public-key');
    const publicKey = res.ok ? (await res.text()).trim() : '';
    if(!publicKey){
      setPushStatus('Notifiche non attive: il server non le ha configurate');
      return;
    }
    const keyBytes = urlBase64ToUint8Array(publicKey);

    const reg = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      setPushStatus('Notifiche non attive: permesso negato dal browser');
      return;
    }
    let sub = await reg.pushManager.getSubscription();
    // Un'iscrizione fatta con un'altra chiave (per esempio dopo un cambio di
    // server) non funzionerebbe piu': si rifa da capo.
    if(sub && !sameKey(sub.options && sub.options.applicationServerKey, keyBytes)){
      await sub.unsubscribe();
      sub = null;
    }
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes,
      });
    }
    socket.emit('registerPush', { subscription: sub.toJSON() });
    setPushStatus('Notifiche attive su questo dispositivo');
  }catch(e){
    setPushStatus('Notifiche non disponibili su questo browser');
  }
}
