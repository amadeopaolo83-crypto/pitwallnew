// Tutto quello che arriva dall'ambiente, in un posto solo: chi vuole sapere
// come si configura il server legge questo file e basta.
//
// Le variabili si impostano su Render (servizio -> Environment). Nessun segreto
// sta nel codice: il repository puo' anche essere letto da altri senza danni.

const PORT = process.env.PORT || 3000;

// Chiavi VAPID per le notifiche push. Se mancano il server funziona lo stesso,
// ma le notifiche a schermo spento restano disattivate.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

// Server di elaborazione classifica (AUBServer). Le squadre amiche si
// autenticano con utente e password: qui e' il posto giusto dove tenerli,
// invece che nel browser di ogni dispositivo della squadra.
const AUB_URL = (process.env.AUB_URL || "").replace(/\/+$/, "");
const AUB_USER = process.env.AUB_USER || "";
const AUB_PASS = process.env.AUB_PASS || "";

// Indirizzo pubblico di questo stesso server: serve al keep-alive di gara,
// che deve passare dall'esterno per contare come traffico in arrivo. Su
// Render la variabile RENDER_EXTERNAL_URL c'e' gia'; altrove si puo' impostare
// SELF_URL a mano. Se manca, il keep-alive resta spento.
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || "").replace(/\/+$/, "");

module.exports = {
  PORT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  AUB_URL,
  AUB_USER,
  AUB_PASS,
  SELF_URL,
};
