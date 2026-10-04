// "Nostro": i distacchi arrivano dal ponte (PitPonte), un secondo servizio che sa
// leggere i vari siti di live timing e li traduce in un'unica classifica.
//
// L'app principale non conosce i fornitori: chiede sempre al ponte la classifica
// di un evento (a partire dall'indirizzo della sua pagina), cerca la vettura per
// numero e manda all'auto posizione e distacchi. Se un fornitore cambia o ne
// arriva uno nuovo, si aggiorna solo il ponte, senza toccare questo server.
//
// Il ponte si configura con due variabili d'ambiente (vedi config.js):
//   BRIDGE_URL     indirizzo del ponte, per esempio https://pitponte.onrender.com
//   BRIDGE_TOKEN   parola d'ordine condivisa con il ponte
// L'indirizzo del ponte non lo sceglie mai chi usa l'app: viene solo dall'ambiente,
// cosi' nessuno puo' far collegare il server a un indirizzo a piacere.
//
// Formato della classifica che arriva dal ponte (campi usati):
//   sessione: { tipo: "qualifica" | "gara", nome, categoria, bandiera }
//   piloti:   [{ pos, numero, nome, migliorGiro, intervallo, intervalloTesto }]
//   con i tempi in secondi.

const { getRoomState } = require("./rooms");
const { BRIDGE_URL, BRIDGE_TOKEN } = require("./config");

const OGNI_MS = 2500;
const ATTESA_NON_PUBBLICATO_MS = 20000;
const ATTESA_ERRORE_MS = 15000;
const TIMEOUT_PRIMA_RISPOSTA_MS = 65000; // il ponte puo' dormire e metterci un minuto
const TIMEOUT_MS = 8000;

// L'istanza socket.io la crea server.js: gliela facciamo passare all'avvio.
let io = null;
function init(server) {
  io = server;
}

const links = new Map(); // codice team -> { controller, stopped, evento, numero, risposto }

// ---------- tempi ----------

// 2.275 -> "2.275", 72.232 -> "1:12.232"
function formatSeconds(sec) {
  const s = Math.abs(sec);
  if (s < 60) return s.toFixed(3);
  const min = Math.floor(s / 60);
  const resto = (s - min * 60).toFixed(3).padStart(6, "0");
  return `${min}:${resto}`;
}

// Un distacco in secondi con il segno; se il ponte ha solo un testo (per esempio
// "1 giro") si mostra com'e'; se non c'e' niente resta vuoto.
function formatGap(secondi, testo, segno) {
  if (typeof secondi === "number" && Number.isFinite(secondi)) return segno + formatSeconds(secondi);
  const t = String(testo == null ? "" : testo).trim();
  return t;
}

function schedaRivale(p) {
  return {
    name: p ? String(p.nome || "").trim() : "",
    number: p ? String(p.numero == null ? "" : p.numero).trim() : "",
  };
}

/**
 * Posizione e distacchi della vettura `numero`, oppure { trovata: false }.
 *
 * Nelle qualifiche e nelle prove conta il miglior giro: il distacco e' la
 * differenza fra i migliori giri. Nelle gare si usa l'intervallo che il sito
 * calcola gia': davanti quello della nostra riga, dietro quello della riga dopo.
 * In gara va riscontrato con dati reali: lo stato mostra sessione e bandiera.
 */
function computeTiming(sessione, piloti, numero) {
  const validi = piloti
    .filter((p) => p && Number.isFinite(p.pos))
    .sort((a, b) => a.pos - b.pos);
  const i = validi.findIndex((p) => String(p.numero == null ? "" : p.numero).trim() === numero);
  if (i < 0) return { trovata: false };

  const mio = validi[i];
  const davanti = validi[i - 1] || null;
  const dietro = validi[i + 1] || null;

  let gapAhead = "";
  let gapBehind = "";
  if (sessione && sessione.tipo === "qualifica") {
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const mioGiro = num(mio.migliorGiro);
    if (mioGiro !== null && davanti && num(davanti.migliorGiro) !== null) {
      gapAhead = "+" + formatSeconds(mioGiro - davanti.migliorGiro);
    }
    if (mioGiro !== null && dietro && num(dietro.migliorGiro) !== null) {
      gapBehind = "-" + formatSeconds(dietro.migliorGiro - mioGiro);
    }
  } else {
    gapAhead = davanti ? formatGap(mio.intervallo, mio.intervalloTesto, "+") : "";
    gapBehind = dietro ? formatGap(dietro.intervallo, dietro.intervalloTesto, "-") : "";
  }

  const avanti = schedaRivale(davanti);
  const indietro = schedaRivale(dietro);
  return {
    trovata: true,
    timing: {
      position: mio.pos,
      gapAhead,
      nameAhead: avanti.name,
      numberAhead: avanti.number,
      gapBehind,
      nameBehind: indietro.name,
      numberBehind: indietro.number,
      updatedAt: Date.now(),
    },
  };
}

// ---------- rete ----------

async function chiediAlPonte(link) {
  const indirizzo = `${BRIDGE_URL}/api/classifica?evento=${encodeURIComponent(link.evento)}`;
  const res = await fetch(indirizzo, {
    signal: AbortSignal.any([
      link.controller.signal,
      AbortSignal.timeout(link.risposto ? TIMEOUT_MS : TIMEOUT_PRIMA_RISPOSTA_MS),
    ]),
    headers: BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {},
  });
  if (res.status === 401) throw new Error("il ponte rifiuta la parola d'ordine (BRIDGE_TOKEN diverso)");
  if (!res.ok) throw new Error(`il ponte ha risposto ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error("risposta del ponte non leggibile");
  }
}

// ---------- stato verso i telefoni ----------

function setStatus(code, patch) {
  const state = getRoomState(code);
  const prima = state.ponte;
  const dopo = { ...prima, ...patch };
  const cambiato = ["connected", "status", "error", "session", "flag", "driverNumber", "provider", "eventName"]
    .some((k) => prima[k] !== dopo[k]);
  state.ponte = dopo;
  if (cambiato) io.to(code).emit("ponteStatus", state.ponte);
}

function applica(code, link, r) {
  const piloti = Array.isArray(r.piloti) ? r.piloti : [];
  const sess = r.sessione || {};
  const sessione = [sess.nome, sess.categoria].filter(Boolean).join(" ");
  const bandiera = sess.bandiera ? String(sess.bandiera) : null;
  const comune = {
    connected: true,
    error: null,
    provider: r.fornitore || null,
    eventName: (r.evento && (r.evento.nome || r.evento.id)) || null,
    session: sessione || null,
    flag: bandiera,
  };
  if (!piloti.length) {
    setStatus(code, { ...comune, status: "in attesa di dati", session: null, flag: null });
    return;
  }
  const c = computeTiming(sess, piloti, link.numero);
  if (!c.trovata) {
    setStatus(code, { ...comune, status: `vettura ${link.numero} non in classifica` });
    return;
  }
  setStatus(code, { ...comune, status: "in ascolto", updatedAt: Date.now() });
  // Si rimanda ai telefoni solo quando qualcosa e' cambiato.
  const state = getRoomState(code);
  const prima = state.timing;
  const cambiato = !prima || ["position", "gapAhead", "gapBehind", "nameAhead", "nameBehind", "numberAhead", "numberBehind"]
    .some((k) => prima[k] !== c.timing[k]);
  state.timing = c.timing;
  if (cambiato) io.to(code).emit("timingUpdate", state.timing);
}

function dormi(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop(code, link) {
  let attesa = OGNI_MS;
  while (!link.stopped) {
    try {
      const r = await chiediAlPonte(link);
      link.risposto = true;
      attesa = OGNI_MS;
      if (!r || r.ok !== true) {
        const motivo = (r && (r.messaggio || r.code)) || "risposta non valida";
        if (r && r.code === "non_pubblicato") {
          setStatus(code, { connected: true, status: "evento non ancora pubblicato", error: null, session: null, flag: null });
          attesa = ATTESA_NON_PUBBLICATO_MS;
        } else {
          // Per esempio un fornitore che il ponte non conosce ancora: si riprova,
          // cosi' appena il ponte viene aggiornato riparte da solo.
          setStatus(code, { connected: true, status: "errore", error: motivo, session: null, flag: null });
          attesa = ATTESA_ERRORE_MS;
        }
      } else {
        applica(code, link, r);
      }
    } catch (e) {
      if (link.stopped) break;
      const motivo = e && e.name === "TimeoutError" ? "il ponte non risponde" : (e.message || String(e));
      setStatus(code, { connected: false, status: "riconnessione…", error: motivo });
      attesa = Math.min(Math.max(attesa, OGNI_MS) * 2, 15000);
    }
    if (link.stopped) break;
    await dormi(attesa);
  }
  if (links.get(code) === link) links.delete(code);
}

function stop(code) {
  const link = links.get(code);
  if (!link) return;
  link.stopped = true;
  link.controller.abort();
  links.delete(code);
}

function validaEvento(testo) {
  const t = String(testo == null ? "" : testo).trim();
  if (!t || t.length > 600) return null;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch (e) {
    return null;
  }
}

/** Avvia la lettura per questo team. Ritorna { ok } oppure { ok:false, error }. */
function start(code, eventoTesto, numeroTesto) {
  if (!BRIDGE_URL) return { ok: false, error: "il ponte non e' configurato sul server (variabile BRIDGE_URL)" };
  const evento = validaEvento(eventoTesto);
  if (!evento) return { ok: false, error: "indirizzo non valido: incolla quello della pagina dell'evento" };
  const numero = String(numeroTesto == null ? "" : numeroTesto).trim();
  if (!/^[A-Za-z0-9]{1,6}$/.test(numero)) return { ok: false, error: "numero di gara non valido" };

  // Piu' telefoni che chiedono la stessa cosa (per esempio dopo un riavvio):
  // la lettura gia' in corso resta com'e', senza ripartire da capo.
  const esistente = links.get(code);
  if (esistente && !esistente.stopped && esistente.evento === evento && esistente.numero === numero) {
    return { ok: true };
  }

  stop(code);
  const link = { controller: new AbortController(), stopped: false, evento, numero, risposto: false };
  links.set(code, link);
  setStatus(code, {
    connected: false,
    status: "collegamento…",
    error: null,
    driverNumber: numero,
    provider: null,
    eventName: null,
    session: null,
    flag: null,
  });
  loop(code, link);
  return { ok: true };
}

module.exports = {
  init,
  start,
  stop,
  setStatus,
  _test: { computeTiming, formatSeconds, formatGap, validaEvento },
};
