// Notifiche push verso i telefoni del box: arrivano anche a schermo spento,
// che e' il punto di tutta la funzione.

const webpush = require("web-push");

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = require("./config");
const { rooms, getRoomState } = require("./rooms");

// Senza chiavi (o con chiavi non valide) le notifiche si spengono, ma il
// server parte lo stesso: non deve cadere per una variabile mancante.
let configurato = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails("mailto:pitcomm@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configurato = true;
  } catch (e) {
    console.error("notifiche push disattivate: chiavi VAPID non valide (" + e.message + ")");
  }
} else {
  console.log("notifiche push disattivate: mancano VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY");
}

function notifyBoxDevices(code, label) {
  if (!configurato) return;
  const state = getRoomState(code);
  const payload = JSON.stringify({
    title: "Messaggio dall'auto",
    body: label,
  });
  for (const sub of state.pushSubscriptions) {
    Promise.resolve(webpush.sendNotification(sub, payload)).catch((err) => {
      // 404/410 = sottoscrizione non più valida (browser disinstallato, permesso revocato, ecc.)
      if (err && (err.statusCode === 404 || err.statusCode === 410)) togliDispositivo(sub.endpoint);
    });
  }
}

// Un telefono che non e' piu' un box (per esempio e' passato a "Auto") non deve piu'
// ricevere le notifiche dei messaggi: si toglie da tutte le stanze.
function togliDispositivo(endpoint) {
  if (!endpoint) return 0;
  let tolti = 0;
  for (const state of rooms.values()) {
    const prima = state.pushSubscriptions.length;
    state.pushSubscriptions = state.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    tolti += prima - state.pushSubscriptions.length;
  }
  return tolti;
}

module.exports = { notifyBoxDevices, togliDispositivo };
