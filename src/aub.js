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
const aubtimer = require("./aubtimer");
const { timingDaAub, capireCampi, pilotiDaAub, nostroNumero } = require("./aubclassifica");
const passo = require("./passo");

// L'istanza socket.io la crea server.js: gliela facciamo passare all'avvio
// invece di importarla, cosi' non si crea un ciclo fra i moduli.
let io = null;

function init(server) {
  io = server;
  // Il timer automatico legge le fasi di gara da Aub con le stesse credenziali.
  aubtimer.init(server, aubGetJson);
}

// Credenziali per stanza, tenute fuori dallo stato: lo stato viaggia verso
// tutti i telefoni della squadra, la password no.
const aubCredentials = new Map(); // code -> { url, user, pass }
const aubLinks = new Map();       // code -> { controller, stopped }

function aubConfigFor(code) {
  const custom = aubCredentials.get(code) || {};
  const pass = custom.pass || AUB_PASS;
  return {
    url: (custom.url || AUB_URL || "").replace(/\/+$/, ""),
    // Con la chiave della squadra l'utente e' qualunque: conta solo la chiave.
    user: custom.user || AUB_USER || (pass ? "pitcomm" : ""),
    pass,
  };
}

// Una lettura singola (GET) con le credenziali di questa stanza: serve al timer
// automatico per le fasi di gara (/racetime). Gli errori hanno un testo da mostrare.
async function aubGetJson(code, percorso, ambito = "programma") {
  const { url, user, pass } = aubConfigFor(code);
  if (!url || !user || !pass) throw new Error("Aub non e' configurato (indirizzo e chiave)");
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(`${url}${percorso}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) throw new Error("chiave non valida o revocata");
  if (res.status === 403) {
    throw new Error(ambito === "classifica"
      ? "la chiave non condivide la classifica: va spuntato l'ambito classifica"
      : "la chiave non ha l'ambito programma: serve per il timer automatico");
  }
  if (!res.ok) throw new Error(`Aub ha risposto ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error("risposta di Aub non leggibile");
  }
}

function setAubStatus(code, patch) {
  const state = getRoomState(code);
  state.aub = { ...state.aub, ...patch };
  io.to(code).emit("aubStatus", state.aub);
}

// Ultima classifica ricevuta e quello che ne e' stato calcolato, per stanza. Serve a
// confrontare, nello stesso istante, i dati grezzi di Aub con quello che vede l'auto
// (GET /api/aub-diagnosi?code=...). Non contiene credenziali.
const aubDiagnosi = new Map(); // code -> istantanea

function righeEssenziali(payload) {
  return (Array.isArray(payload && payload.full_classification_json) ? payload.full_classification_json : [])
    .filter((r) => r && typeof r === "object")
    .sort((a, b) => Number(a.pos) - Number(b.pos))
    .map((r) => ({ pos: r.pos, number: r.number, name: r.name, category: r.category, laps: r.laps, bestlap: r.bestlap, gap: r.gap, diff: r.diff, myself: !!r.myself }));
}

function salvaDiagnosi(code, payload, numero, t) {
  try {
    const righe = righeEssenziali(payload);
    const prima = aubDiagnosi.get(code);
    const adesso = Date.now();
    const intervalli = prima ? (prima.secondiTraGliAggiornamenti || []).slice(-5) : [];
    if (prima && prima._at) intervalli.push(Math.round((adesso - prima._at) / 100) / 10);
    aubDiagnosi.set(code, {
      _at: adesso,
      aggiornamentiRicevuti: (prima ? prima.aggiornamentiRicevuti : 0) + 1,
      secondiTraGliAggiornamenti: intervalli,
      datiAub: payload ? { lastUpdate: payload.lastUpdate, ageSeconds: payload.ageSeconds, updateInterval: payload.updateInterval, maxDataAgeSeconds: payload.maxDataAgeSeconds } : null,
      ricevutoAlle: new Date().toISOString(),
      numeroRichiesto: numero == null ? null : String(numero),
      campiLetti: righe.length ? ({
        scambiati: "gap = intervallo da chi sta davanti, diff = cumulativo dal primo",
        documento: "gap = cumulativo dal primo, diff = intervallo da chi sta davanti",
        cumGap: "gap = distacco con segno da un riferimento (noi), valori vicini di categoria",
        cumDiff: "diff = distacco con segno da un riferimento (noi)",
      }[capireCampi(righe)] || null) : null,
      listaParziale: t && t.parziale ? "il flusso manda solo i vicini della categoria: i calcoli usano la classifica intera" : false,
      stale: Boolean(payload && payload.stale),
      nessunaGara: Boolean(payload && payload.nessunaGara),
      calcolato: t && t.trovata ? t.timing : null,
      righe,
    });
  } catch (e) { /* la diagnosi non deve mai fermare la lettura */ }
}

function diagnosi(code) {
  const c = String(code || "");
  const chiave = aubDiagnosi.has(c) ? c : aubDiagnosi.has(c.toUpperCase()) ? c.toUpperCase() : null;
  if (!chiave) return null;
  const { _at, ...d } = aubDiagnosi.get(chiave);
  return { ...d, _stanza: chiave };
}

// Come diagnosi(), piu' una lettura fresca di /classifica fatta in questo istante:
// se i due non coincidono, e' il flusso che arriva in ritardo, non il calcolo.
async function diagnosiCompleta(code) {
  const d = diagnosi(code);
  if (!d) return null;
  const chiave = d._stanza;
  delete d._stanza;
  const cl = aubClassifica.get(chiave);
  d.letturaClassificaIntera = cl
    ? { ultimaRiuscitaAlle: cl.ultimoOk ? new Date(cl.ultimoOk).toISOString() : null, errore: cl.errore }
    : "non necessaria: il flusso manda gia' la classifica intera";
  try {
    const fresca = await aubGetJson(chiave, "/classifica", "classifica");
    const righe = righeEssenziali(fresca);
    const t = timingDaAub(fresca, d.numeroRichiesto);
    d.adessoDaClassifica = {
      letta: new Date().toISOString(),
      datiAub: { lastUpdate: fresca.lastUpdate, ageSeconds: fresca.ageSeconds, updateInterval: fresca.updateInterval },
      calcolato: t && t.trovata ? t.timing : null,
      righe,
    };
  } catch (e) {
    d.adessoDaClassifica = { errore: e.message || String(e) };
  }
  return d;
}

function applyAubUpdate(code, payload, numero) {
  const state = getRoomState(code);
  const flag = payload && payload.flag ? payload.flag : null;
  // "Nessuna gara aperta" non e' un guasto: la squadra non ha una gara in corso
  // (o non ancora). Si dice cosi', senza far credere che i dati siano vecchi.
  const nessunaGara = Boolean(payload && payload.nessunaGara);
  const stale = Boolean(payload && payload.stale);
  // La classifica arriva intera: assoluta e categoria le calcoliamo noi, con la
  // stessa funzione del ponte. Il numero e' quello scelto dal box; se non c'e' fra
  // le righe si usa la vettura che Aub segna come "myself".
  const t = timingDaAub(payload, numero);
  salvaDiagnosi(code, payload, numero, t);
  const mancante = !t.trovata && !t.vuota && !nessunaGara && !stale;
  setAubStatus(code, {
    status: nessunaGara ? "nessuna gara aperta ora"
      : stale ? "dati non aggiornati"
      : mancante ? `vettura ${numero} non in classifica`
      : "in ascolto",
    error: null,
    flag,
    stale,
    updatedAt: Date.now(),
  });
  // La bandiera a scacchi puo' far partire il Finish del timer automatico.
  aubtimer.suBandiera(code, flag && flag.state ? String(flag.state) : null);
  // Se il flusso manda solo i vicini della categoria, posizione di categoria e vicini in
  // classifica generale vengono dalla classifica intera (/classifica), letta qui accanto.
  // Il flusso resta per la bandiera, lo stato e come ripiego se /classifica non risponde.
  if (t.trovata && t.parziale) chiediClassifica(code, numero);
  const cl = aubClassifica.get(code);
  const recente = cl && cl.ultimoOk && Date.now() - cl.ultimoOk < 30000;
  if (!t.trovata || (t.parziale && recente)) return;
  state.timing = t.timing;
  io.to(code).emit("timingUpdate", state.timing);
}

// Lettura della classifica intera, al massimo una ogni 2,5 s (Aub ne ammette una ogni 2 s)
// e una alla volta; se arrivano piu' richieste se ne fa una sola, con l'ultimo numero.
const aubClassifica = new Map(); // code -> { inCorso, timer, ultimo, ultimoOk, errore, numero }
const OGNI_CLASSIFICA_MS = 2500;

function chiediClassifica(code, numero) {
  let c = aubClassifica.get(code);
  if (!c) {
    c = { inCorso: false, timer: null, ultimo: 0, ultimoOk: 0, errore: null, numero };
    aubClassifica.set(code, c);
  }
  c.numero = numero;
  if (c.inCorso || c.timer) return;
  const attesa = Math.max(0, OGNI_CLASSIFICA_MS - (Date.now() - c.ultimo));
  c.timer = setTimeout(async () => {
    c.timer = null;
    c.inCorso = true;
    c.ultimo = Date.now();
    try {
      const payload = await aubGetJson(code, "/classifica", "classifica");
      if (aubClassifica.get(code) !== c) return; // collegamento fermato nel frattempo
      passoDaClassifica(code, payload, c.numero);
      const t = timingDaAub(payload, c.numero);
      if (t.trovata) {
        c.ultimoOk = Date.now();
        c.errore = null;
        getRoomState(code).timing = t.timing;
        io.to(code).emit("timingUpdate", t.timing);
      } else {
        c.errore = payload && payload.nessunaGara ? "nessuna gara aperta" : `vettura ${c.numero} non nella classifica intera`;
      }
    } catch (e) {
      c.errore = e.message || String(e);
    } finally {
      c.inCorso = false;
    }
  }, attesa);
}

// Giri e passo: servono ultimo giro e miglior giro di ogni vettura, che stanno nella
// classifica intera (il flusso, senza il numero, non manda l'ultimo giro).
function passoDaClassifica(code, payload, numero) {
  try {
    const piloti = pilotiDaAub(payload);
    if (piloti.length) passo.registra(code, piloti, nostroNumero(payload, numero));
  } catch (e) { /* il passo non deve fermare i distacchi */ }
}

const OGNI_PASSO_MS = Number(process.env.PASSO_OGNI_MS) || 10000; // la variabile serve solo ai test

// Una lettura della classifica intera ogni 10 s per il passo, saltata se ne e' appena
// arrivata una (la stessa che serve ai distacchi di categoria) o se una e' in corso.
async function aubPassoLoop(code, link, driverId) {
  while (!link.stopped) {
    await new Promise((r) => setTimeout(r, OGNI_PASSO_MS));
    if (link.stopped) break;
    const c = aubClassifica.get(code);
    if (c && (c.inCorso || (c.ultimo && Date.now() - c.ultimo < OGNI_PASSO_MS - 2000))) continue;
    try {
      const payload = await aubGetJson(code, "/classifica", "classifica");
      if (link.stopped) break;
      passoDaClassifica(code, payload, driverId);
    } catch (e) { /* si riprova al giro dopo */ }
  }
}

function fermaClassifica(code) {
  const c = aubClassifica.get(code);
  if (c && c.timer) clearTimeout(c.timer);
  aubClassifica.delete(code);
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
  const res = await fetch(`${url}/stream`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "text/event-stream" },
    signal: link.controller.signal,
  });

  if (res.status === 401 || res.status === 403) {
    // Non e' un problema di rete: riprovare da soli non serve a niente.
    const err = new Error(
      res.status === 401
        ? "chiave non valida o revocata: chiedine una nuova nel FactoryPortal"
        : "la chiave non condivide la classifica: va spuntato l'ambito classifica"
    );
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
      if (!dati) continue;
      if (evento === "racetime") {
        // Le fasi di gara cambiano: il timer automatico si riallinea.
        try { aubtimer.suFasi(code, JSON.parse(dati)); } catch (e) { /* blocco malformato */ }
        continue;
      }
      if (evento !== "update") continue;
      try {
        applyAubUpdate(code, JSON.parse(dati), driverId);
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
  fermaClassifica(code);
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
  // I campi lasciati vuoti non cancellano quelli gia' noti: riaprendo l'app con la
  // chiave non riscritta non si perde quella che il server ha gia'.
  if (credenziali) {
    const prima = aubCredentials.get(code) || {};
    const nuove = {};
    for (const k of ["url", "user", "pass"]) nuove[k] = credenziali[k] || prima[k] || "";
    aubCredentials.set(code, nuove);
  }
  const { url, user, pass } = aubConfigFor(code);
  if (!url || !user || !pass) {
    setAubStatus(code, {
      configured: false,
      connected: false,
      status: "errore",
      error: "indirizzo o chiave del server classifica mancanti",
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
  aubPassoLoop(code, link, driverId);
}

module.exports = {
  init,
  start: aubStart,
  stop: aubStop,
  setStatus: setAubStatus,
  diagnosi,
  diagnosiCompleta,
};
