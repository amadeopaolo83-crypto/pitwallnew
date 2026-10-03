// Collegamento al server di elaborazione classifica (AUBServer).
//
// AUBServer chiede di farsi riconoscere: le squadre amiche usano utente e
// password (Basic su HTTPS). Il collegamento lo apre questo server, non i
// telefoni, per tre motivi: AUBServer non manda header CORS, EventSource non sa
// mandare l'header Authorization, e cosi' la password sta in un posto solo
// invece che nel browser di ogni dispositivo della squadra.
//
// Una sola connessione SSE per team, distribuita a tutti i dispositivi della
// stanza con l'evento `timingUpdate` che il client gia' conosce.

const { AUB_URL, AUB_USER, AUB_PASS } = require("./config");
const { getRoomState } = require("./rooms");

// L'istanza socket.io la crea server.js: gliela facciamo passare all'avvio
// invece di importarla, cosi' non si crea un ciclo fra i moduli.
let io = null;

function init(server) {
  io = server;
}

// Credenziali per stanza, tenute fuori dallo stato: lo stato viaggia verso
// tutti i telefoni della squadra, la password no.
const aubCredentials = new Map(); // code -> { url, user, pass }
const aubLinks = new Map();       // code -> { controller, stopped }

function aubConfigFor(code) {
  const custom = aubCredentials.get(code) || {};
  return {
    url: (custom.url || AUB_URL || "").replace(/\/+$/, ""),
    user: custom.user || AUB_USER,
    pass: custom.pass || AUB_PASS,
  };
}

function setAubStatus(code, patch) {
  const state = getRoomState(code);
  state.aub = { ...state.aub, ...patch };
  io.to(code).emit("aubStatus", state.aub);
}

// "00:01.234" -> "+1.234", "-00:00.850" -> "-0.850", "2 laps" resta com'e'.
function formatGap(gap) {
  if (!gap || typeof gap !== "string") return "";
  if (/laps?/i.test(gap)) return gap;
  const negative = gap.startsWith("-");
  let body = negative ? gap.slice(1) : gap;
  body = body.replace(/^0?0:/, "").replace(/^0(?=\d)/, "");
  return (negative ? "-" : "+") + body;
}

// La vista /driver mette `myself: true` sulla riga della nostra vettura e
// calcola i distacchi rispetto a lei: chi precede ha gap positivo, chi insegue
// negativo. Ci servono solo le due righe adiacenti.
function timingFromRanking(payload) {
  const rows = Array.isArray(payload && payload.full_classification_json)
    ? payload.full_classification_json
    : [];
  const i = rows.findIndex((r) => r && r.myself);
  if (i < 0) return null;
  const ahead = rows[i - 1];
  const behind = rows[i + 1];
  // `name` e' l'unico campo nome che il cronometraggio fornisce: nelle gare
  // endurance di solito e' la squadra, ma non e' garantito. Il numero di gara
  // invece e' inequivocabile, e in pista si riconosce prima.
  return {
    position: rows[i].pos ?? null,
    gapAhead: ahead ? formatGap(ahead.gap) : "",
    nameAhead: (ahead && ahead.name) || "",
    numberAhead: (ahead && ahead.number) || "",
    gapBehind: behind ? formatGap(behind.gap) : "",
    nameBehind: (behind && behind.name) || "",
    numberBehind: (behind && behind.number) || "",
    updatedAt: Date.now(),
  };
}

function applyAubUpdate(code, payload) {
  const state = getRoomState(code);
  const flag = payload && payload.flag ? payload.flag : null;
  setAubStatus(code, {
    status: payload && payload.stale ? "dati non aggiornati" : "in ascolto",
    error: null,
    flag,
    stale: Boolean(payload && payload.stale),
    updatedAt: Date.now(),
  });
  const timing = timingFromRanking(payload);
  if (!timing) return;
  state.timing = timing;
  io.to(code).emit("timingUpdate", state.timing);
}

// Il flusso SSE arriva a blocchi separati da riga vuota; le righe che iniziano
// con ":" sono keepalive e si scartano.
function parseSseChunk(blocco) {
  let evento = "message";
  const dati = [];
  for (const riga of blocco.split("\n")) {
    if (!riga || riga.startsWith(":")) continue;
    if (riga.startsWith("event:")) evento = riga.slice(6).trim();
    else if (riga.startsWith("data:")) dati.push(riga.slice(5).replace(/^ /, ""));
  }
  return { evento, dati: dati.join("\n") };
}

async function aubReadStream(code, link, driverId) {
  const { url, user, pass } = aubConfigFor(code);
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(`${url}/stream?id=${encodeURIComponent(driverId)}&range=1`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "text/event-stream" },
    signal: link.controller.signal,
  });

  if (res.status === 401 || res.status === 403) {
    // Non e' un problema di rete: riprovare da soli non serve a niente.
    const err = new Error("utente o password non validi");
    err.fatal = true;
    throw err;
  }
  if (!res.ok) throw new Error(`il server classifica ha risposto ${res.status}`);

  setAubStatus(code, { connected: true, status: "collegato", error: null });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let taglio;
    while ((taglio = buffer.indexOf("\n\n")) >= 0) {
      const blocco = buffer.slice(0, taglio);
      buffer = buffer.slice(taglio + 2);
      const { evento, dati } = parseSseChunk(blocco);
      if (evento !== "update" || !dati) continue;
      try {
        applyAubUpdate(code, JSON.parse(dati));
      } catch (e) {
        // Un blocco malformato non deve buttare giu' il collegamento.
      }
    }
  }
}

async function aubLoop(code, link, driverId) {
  let attesa = 3000;
  while (!link.stopped) {
    try {
      await aubReadStream(code, link, driverId);
      // Stream chiuso dall'altra parte: si riprova, la gara e' ancora in corso.
      if (!link.stopped) setAubStatus(code, { connected: false, status: "riconnessione…" });
      attesa = 3000;
    } catch (e) {
      if (link.stopped) break;
      if (e.fatal) {
        setAubStatus(code, { connected: false, status: "errore", error: e.message });
        break;
      }
      setAubStatus(code, {
        connected: false,
        status: "riconnessione…",
        error: e.message || String(e),
      });
      attesa = Math.min(attesa * 2, 30000);
    }
    if (link.stopped) break;
    await new Promise((r) => setTimeout(r, attesa));
  }
  // Lo stato finale lo scrive chi ha fermato il collegamento: se qui il loop
  // scrivesse "spento" cancellerebbe il "collegamento..." di un aubStart
  // arrivato nel frattempo.
  if (aubLinks.get(code) === link) aubLinks.delete(code);
}

function aubStop(code) {
  const link = aubLinks.get(code);
  if (!link) return;
  link.stopped = true;
  link.controller.abort();
  aubLinks.delete(code);
}

function aubStart(code, driverId, credenziali) {
  aubStop(code);
  // Credenziali passate dal box: valgono per questa stanza e si fermano qui,
  // fuori dallo stato che viene mandato ai telefoni.
  if (credenziali) aubCredentials.set(code, credenziali);
  const { url, user, pass } = aubConfigFor(code);
  if (!url || !user || !pass) {
    setAubStatus(code, {
      configured: false,
      connected: false,
      status: "errore",
      error: "indirizzo, utente o password del server classifica mancanti",
    });
    return;
  }
  const link = { controller: new AbortController(), stopped: false };
  aubLinks.set(code, link);
  setAubStatus(code, {
    configured: true,
    connected: false,
    driverId,
    status: "collegamento…",
    error: null,
  });
  aubLoop(code, link, driverId);
}

module.exports = {
  init,
  start: aubStart,
  stop: aubStop,
  setStatus: setAubStatus,
};
