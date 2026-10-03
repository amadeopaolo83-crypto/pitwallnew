// Notifiche push verso i telefoni del box: arrivano anche a schermo spento,
// che e' il punto di tutta la funzione.

const webpush = require("web-push");

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = require("./config");
const { getRoomState } = require("./rooms");

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
  state.pushSubscriptions = state.pushSubscriptions.filter((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      // 404/410 = sottoscrizione non più valida (browser disinstallato, permesso revocato, ecc.)
      if (err.statusCode === 404 || err.statusCode === 410) return false;
    });
    return true; // rimozione effettiva gestita al prossimo giro se serve
  });
}

module.exports = { notifyBoxDevices };
