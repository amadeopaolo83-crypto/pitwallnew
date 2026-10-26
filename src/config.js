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

// Fuso orario del circuito: gli orari delle fasi di gara che manda Aub sono "ora
// locale del circuito" senza fuso. Serve al timer automatico. Predefinito Europe/Rome.
const AUB_TZ = process.env.AUB_TZ || "Europe/Rome";

// Indirizzo pubblico di questo stesso server: serve al keep-alive di gara,
// che deve passare dall'esterno per contare come traffico in arrivo. Su
// Render la variabile RENDER_EXTERNAL_URL c'e' gia'; altrove si puo' impostare
// SELF_URL a mano. Se manca, il keep-alive resta spento.
const SELF_URL = (process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || "").replace(/\/+$/, "");

// Il ponte (PitPonte): il servizio che legge i siti di live timing e li traduce.
// BRIDGE_URL e' il suo indirizzo, BRIDGE_TOKEN la parola d'ordine condivisa.
// Senza BRIDGE_URL la modalita' "Nostro" resta spenta.
const BRIDGE_URL = (process.env.BRIDGE_URL || "").replace(/\/+$/, "");
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";

// Dove si salvano le impostazioni della squadra (serbatoio, tasti, ecc.) perche'
// restino anche dopo un riavvio. Il disco di Render gratuito si cancella a ogni
// riavvio, quindi serve un posto fuori: Upstash Redis (gratuito) con i suoi due
// valori REST, oppure una cartella su un disco vero (DATA_DIR). Senza nessuno dei
// due le impostazioni stanno solo in memoria e nelle copie dei telefoni.
const ARCHIVIO_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const ARCHIVIO_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const DATA_DIR = process.env.DATA_DIR || "";

module.exports = {
  ARCHIVIO_URL,
  ARCHIVIO_TOKEN,
  DATA_DIR,
  PORT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  AUB_URL,
  AUB_USER,
  AUB_PASS,
  AUB_TZ,
  SELF_URL,
  BRIDGE_URL,
  BRIDGE_TOKEN,
};
