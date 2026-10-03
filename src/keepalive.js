// Tiene sveglio il server mentre una gara e' in corso.
//
// Sui piani gratuiti di Render il servizio si spegne dopo ~15 minuti senza
// traffico in arrivo. Mentre almeno un team ha la gara avviata, il server
// chiama il proprio indirizzo pubblico ogni pochi minuti; quando l'ultima gara
// finisce il timer si ferma e Render puo' spegnere il servizio da solo.
//
// Rete di sicurezza: una gara si chiude da sola dopo DURATA_MAX_MS, cosi' se
// ci si dimentica di premere "Fine gara" il server non resta acceso all'infinito.

const { SELF_URL } = require("./config");

const DURATA_MAX_MS = 26 * 3600 * 1000; // 24h di gara + margine
const OGNI_MS = 5 * 60 * 1000; // ben sotto i 15 minuti di Render

const attive = new Map(); // codice team -> { inizio, allaScadenza }
let timer = null;

function ping() {
  if (!SELF_URL) return;
  // /manifest.json e' leggero e c'e' sempre: va bene come bersaglio.
  fetch(SELF_URL + "/manifest.json", { signal: AbortSignal.timeout(10000) }).catch(() => {});
}

function controlla() {
  const ora = Date.now();
  for (const [codice, g] of attive) {
    if (ora - g.inizio > DURATA_MAX_MS) {
      attive.delete(codice);
      if (g.allaScadenza) g.allaScadenza(codice);
    }
  }
  if (!attive.size) return fermaTimer();
  ping();
}

function fermaTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Avvia (o riprende) il keep-alive per un team. `inizio` e' l'ora di partenza gara. */
function start(codice, inizio, allaScadenza) {
  attive.set(codice, { inizio: inizio || Date.now(), allaScadenza });
  if (!timer) {
    timer = setInterval(controlla, OGNI_MS);
    console.log(SELF_URL
      ? `keep-alive attivo (ping a ${SELF_URL} ogni ${OGNI_MS / 60000} min)`
      : "keep-alive: nessun indirizzo pubblico noto (RENDER_EXTERNAL_URL / SELF_URL), il server non verra' tenuto sveglio");
  }
  ping();
}

/** Ferma il keep-alive per un team; se era l'ultimo, ferma anche il timer. */
function stop(codice) {
  attive.delete(codice);
  if (!attive.size) fermaTimer();
}

module.exports = { start, stop, DURATA_MAX_MS };
