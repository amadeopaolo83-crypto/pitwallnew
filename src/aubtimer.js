// Timer automatico: partenza e gara prese dalle fasi che Aub trasmette.
//
// Aub manda le fasi della gara con gli orari (PIT, RACE, PAUSE, END; vedi
// /racetime e l'evento `racetime` dello stream). Qui diventano lo stesso stato
// `raceTimer` che usa il timer manuale: i client non sanno da dove arriva, quindi
// lampeggio negli ultimi secondi, "VIA!" e foto finale funzionano senza modifiche.
//
// Regole:
//  - il conto di partenza arriva all'inizio della prima fase RACE;
//  - il tempo gara e' la somma delle fasi RACE ancora da correre: durante PAUSE
//    (o fra due RACE) il timer gara e' fermo;
//  - gli orari di Aub sono "ora locale del circuito" senza fuso: si leggono con
//    AUB_TZ (predefinito Europe/Rome);
//  - il timer segue orari assoluti, quindi se il collegamento cade i telefoni
//    continuano a contare giusto da soli;
//  - la bandiera a scacchi di Aub puo' far partire il Finish (solo con Finish
//    automatico e nelle ultime fasi della gara).
//
// Come il resto dei timer, nessun ciclo di conteggio sul server: ogni tanto (a ogni
// cambio di fase e ogni 30 s) si riallinea lo stato, e i client contano da soli.

const { getRoomState } = require("./rooms");
const { AUB_TZ } = require("./config");

let io = null;
let aubGet = null; // (code, percorso) -> JSON di Aub; la fornisce aub.js

function init(server, getJson) {
  io = server;
  aubGet = getJson;
}

const rooms = new Map(); // code -> { fasi, poll, ultimaBandiera }
const POLL_MS = 30 * 1000;
const SOGLIA_RIALLINEA_S = 1.5;      // sotto questo scarto non si riscrive lo stato
const FINISH_DA_BANDIERA_ENTRO_S = 10 * 60; // bandiera a scacchi valida solo nell'ultima parte

const stanza = (code) => {
  if (!rooms.has(code)) rooms.set(code, { fasi: [], poll: null, prossimo: null, ultimaBandiera: null });
  return rooms.get(code);
};

// ---------- fuso orario ----------

function fusoValido(tz) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date());
    return tz;
  } catch (e) {
    return "Europe/Rome";
  }
}
const FUSO = fusoValido(AUB_TZ || "Europe/Rome");

// Differenza (ms) fra l'ora scritta sull'orologio del fuso e l'ora UTC, in quell'istante.
function scartoFuso(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms))) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** "2026-10-11T09:00:00" (ora locale del circuito) -> millisecondi UTC, oppure null. */
function localeInEpoch(testo, tz = FUSO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(testo || ""));
  if (!m) return null;
  const come = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let ms = come - scartoFuso(come, tz);
  ms = come - scartoFuso(ms, tz); // secondo passaggio: vicino al cambio ora legale
  return Number.isFinite(ms) ? ms : null;
}

// ---------- fasi ----------

/** Dalla risposta di /racetime (o dall'evento racetime) alla lista di fasi ordinate. */
function leggiFasi(payload, tz = FUSO) {
  const lista = Array.isArray(payload && payload.racesessions) ? payload.racesessions : [];
  return lista
    .map((f) => {
      const startMs = localeInEpoch(f && f.start, tz);
      const endMs = localeInEpoch(f && f.end, tz);
      return {
        fase: String((f && f.event) || "").trim().toUpperCase(),
        startMs, endMs,
        startTxt: String((f && f.start) || ""),
        endTxt: String((f && f.end) || ""),
      };
    })
    .filter((f) => f.fase && f.startMs !== null)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Cosa devono mostrare i timer in questo istante, dalle sole fasi RACE.
 * Ritorna null se non ci sono fasi di gara.
 */
function calcola(fasi, adesso) {
  const gare = fasi.filter((f) => f.fase === "RACE" && f.endMs !== null && f.endMs > f.startMs);
  if (!gare.length) return null;
  const totaleMs = gare.reduce((s, g) => s + (g.endMs - g.startMs), 0);
  const inizio = gare[0].startMs;
  const fine = gare[gare.length - 1].endMs;
  let restaMs = 0;
  let inCorso = false;
  for (const g of gare) {
    restaMs += Math.max(0, g.endMs - Math.max(g.startMs, adesso));
    if (adesso >= g.startMs && adesso < g.endMs) inCorso = true;
  }
  return {
    prima: adesso < inizio,
    partenzaS: Math.max(0, (inizio - adesso) / 1000),
    totaleS: totaleMs / 1000,
    restaS: restaMs / 1000,
    inCorso,
    finita: adesso >= fine,
  };
}

const hhmm = (testo) => String(testo || "").slice(11, 16);
const giorno = (testo) => String(testo || "").slice(0, 10);

/** La riga di controllo mostrata nella card Timer (cosi' si vede se gli orari sono letti bene). */
function descrivi(fasi, tz = FUSO) {
  if (!fasi.length) return "";
  const primo = giorno(fasi[0].startTxt);
  const pezzi = fasi.slice(0, 6).map((f) => {
    const data = giorno(f.startTxt) !== primo ? ` ${giorno(f.startTxt).slice(8, 10)}/${giorno(f.startTxt).slice(5, 7)}` : "";
    return `${f.fase}${data} ${hhmm(f.startTxt)}${f.endTxt ? "→" + hhmm(f.endTxt) : ""}`;
  });
  return `Aub: ${pezzi.join(" · ")}${fasi.length > 6 ? " …" : ""} (fuso ${tz})`;
}

// ---------- stato ----------

function restoSalvato(base, updatedAt, running) {
  if (!running) return base;
  return Math.max(0, base - (Date.now() - updatedAt) / 1000); // il timer automatico va sempre a x1
}

function emetti(code) {
  if (io) io.to(code).emit("timerUpdate", getRoomState(code).raceTimer);
}

/**
 * Riallinea `raceTimer` alle fasi di Aub. Riscrive e rimanda lo stato solo se
 * qualcosa e' davvero cambiato (fase, in corso/fermo, scarto oltre 1,5 s, testo).
 */
function sincronizza(code) {
  const t = getRoomState(code).raceTimer;
  if (t.source !== "aub") return;
  const room = stanza(code);
  const adesso = Date.now();
  const info = descrivi(room.fasi);
  let cambiato = false;

  if (t.aubInfo !== info) { t.aubInfo = info; cambiato = true; }

  const c = calcola(room.fasi, adesso);
  if (!c) {
    if (!room.fasi.length && !t.aubError) {
      t.aubError = "nessuna fase di gara ricevuta da Aub (serve l'ambito programma)";
      cambiato = true;
    }
  } else if (t.phase !== "finished") {
    const nuovo = c.prima
      ? {
          phase: "start",
          startRemaining: c.partenzaS, startRunning: true,
          raceRemaining: c.totaleS, raceRunning: false,
        }
      : {
          phase: "race",
          startRemaining: 0, startRunning: false,
          raceRemaining: c.restaS,
          // A fine gara lo stato "in corso" resta com'e': serve ai telefoni per
          // accorgersi dello zero e far scattare il Finish automatico.
          raceRunning: c.finita ? Boolean(t.phase === "race" && t.raceRunning) : c.inCorso,
        };
    const startCorr = restoSalvato(t.startRemaining, t.startUpdatedAt, t.startRunning);
    const raceCorr = restoSalvato(t.raceRemaining, t.raceUpdatedAt, t.raceRunning);
    const uguale =
      t.phase === nuovo.phase &&
      t.startRunning === nuovo.startRunning &&
      t.raceRunning === nuovo.raceRunning &&
      Math.abs(startCorr - nuovo.startRemaining) < SOGLIA_RIALLINEA_S &&
      Math.abs(raceCorr - nuovo.raceRemaining) < SOGLIA_RIALLINEA_S &&
      Math.abs(t.raceSeconds - c.totaleS) < SOGLIA_RIALLINEA_S;
    if (!uguale) {
      Object.assign(t, nuovo, {
        startSeconds: nuovo.phase === "start" ? Math.max(1, Math.ceil(c.partenzaS)) : t.startSeconds,
        raceSeconds: c.totaleS,
        startUpdatedAt: adesso,
        raceUpdatedAt: adesso,
        speed: 1,
      });
      cambiato = true;
    }
  }
  if (cambiato) emetti(code);
  programmaProssimoCambio(code);
}

// Un solo avviso, preciso, al prossimo cambio di fase (inizio o fine di una fase):
// cosi' la pausa ferma il timer gara e il via parte nell'istante giusto anche se
// nessun telefono lo segnala. Non e' un ciclo: dopo ogni cambio se ne programma uno.
function programmaProssimoCambio(code) {
  const room = stanza(code);
  clearTimeout(room.prossimo);
  room.prossimo = null;
  if (getRoomState(code).raceTimer.source !== "aub") return;
  const adesso = Date.now();
  let prossimo = Infinity;
  for (const f of room.fasi) {
    if (f.fase !== "RACE") continue;
    if (f.startMs > adesso) prossimo = Math.min(prossimo, f.startMs);
    if (f.endMs !== null && f.endMs > adesso) prossimo = Math.min(prossimo, f.endMs);
  }
  if (!Number.isFinite(prossimo)) return;
  const attesa = Math.min(prossimo - adesso + 30, 2 ** 31 - 1);
  room.prossimo = setTimeout(() => sincronizza(code), attesa);
  if (room.prossimo.unref) room.prossimo.unref();
}

function segnala(code, errore) {
  const t = getRoomState(code).raceTimer;
  const nuovo = errore || "";
  if (t.aubError !== nuovo) {
    t.aubError = nuovo;
    emetti(code);
  }
}

async function aggiornaFasi(code) {
  const t = getRoomState(code).raceTimer;
  if (t.source !== "aub" || !aubGet) return;
  try {
    const corpo = await aubGet(code, "/racetime");
    stanza(code).fasi = leggiFasi(corpo);
    segnala(code, "");
  } catch (e) {
    segnala(code, e.message || String(e));
  }
  sincronizza(code);
}

// ---------- comandi dal resto del server ----------

/** Passa il timer di questa stanza in automatico (da Aub). */
function attiva(code) {
  const t = getRoomState(code).raceTimer;
  const room = stanza(code);
  t.source = "aub";
  t.speed = 1; // la velocita' di test non ha senso con orari veri
  t.aubError = "";
  clearInterval(room.poll);
  room.poll = setInterval(() => aggiornaFasi(code), POLL_MS);
  if (room.poll.unref) room.poll.unref();
  // Intanto che arriva la prima risposta si usano le fasi gia' note (se ce ne sono).
  t.aubInfo = descrivi(room.fasi);
  sincronizza(code);
  emetti(code);
  return aggiornaFasi(code);
}

/** Torna al manuale: i valori correnti restano, da qui li comanda il box. */
function disattiva(code) {
  const t = getRoomState(code).raceTimer;
  const room = stanza(code);
  clearInterval(room.poll);
  room.poll = null;
  clearTimeout(room.prossimo);
  room.prossimo = null;
  const eraAub = t.source === "aub";
  t.source = "manual";
  t.aubInfo = "";
  t.aubError = "";
  if (eraAub) emetti(code);
}

/** Arrivata una lista di fasi dallo stream (evento `racetime`). */
function suFasi(code, payload) {
  stanza(code).fasi = leggiFasi(payload);
  sincronizza(code);
}

/** Bandiera di Aub: la scacchi puo' far partire il Finish (una sola volta). */
function suBandiera(code, stato) {
  const room = stanza(code);
  const prima = room.ultimaBandiera;
  room.ultimaBandiera = stato || null;
  if (stato !== "finish" || prima === "finish") return;
  const state = getRoomState(code);
  const t = state.raceTimer;
  if (t.source !== "aub" || t.finishMode !== "auto" || t.phase !== "race" || t.finishTriggered) return;
  const resta = restoSalvato(t.raceRemaining, t.raceUpdatedAt, t.raceRunning);
  if (resta > FINISH_DA_BANDIERA_ENTRO_S) return;
  t.phase = "finished";
  t.finishTriggered = true;
  t.finishPosition = state.timing ? state.timing.position : null;
  emetti(code);
}

module.exports = {
  init, attiva, disattiva, sincronizza, suFasi, suBandiera,
  _test: { localeInEpoch, leggiFasi, calcola, descrivi, scartoFuso, stanza, rooms },
};
