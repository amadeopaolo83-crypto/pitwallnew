// Passo gara: i giri di ogni vettura, i giri "validi" e il trend.
//
// Si lavora solo su quello che ogni fonte (Aub diretto o ponte) manda per ogni riga:
// numero, classe, giri completati, miglior giro e ultimo giro. Niente dei calcoli di
// trend che fanno i fornitori.
//
//  - Giro VALIDO: non piu' lento del miglior giro della vettura + SOGLIA (8%) (safety car,
//    bandiera gialla, ingresso e uscita dai box restano fuori).
//  - Altre vetture: si tengono best, giri e solo gli ultimi 10 giri validi.
//  - La nostra: si tengono tutti i giri (potati dopo 72 h o oltre 3000 giri).
//  - Trend (ogni vettura): base = media dei primi 5 giri validi. Ogni giro valido dopo
//    si confronta con la base: piu' veloce della tolleranza = "+", piu' lento = "-",
//    dentro = "0". Due segni uguali di fila convalidano il trend (++ miglioramento,
//    -- peggioramento) e la base diventa la media degli ultimi 10 giri validi. Due "0"
//    ... (cinque "0" di fila = passo stabile; il trend convalidato resta fino ad allora
//    o fino a una convalida opposta). Segni diversi (+-) non cambiano niente: si continua a
//    osservare.
//  - Una pausa lunga (piu' di 20 minuti fra due giri) apre uno "stint" nuovo: finestre
//    e trend ripartono.
//  - Nostra vettura: media degli ultimi 10/20/30 giri validi dello stint contro i
//    precedenti altrettanti, e media totale (seconda meta' contro prima meta').

const SOGLIA = 0.08;            // un giro e' valido fino all'8% oltre il miglior giro
const TOLLERANZA = 0.25;        // secondi: sotto questa differenza un giro non conta come + o -
const TOLLERANZA_MEDIA = 0.1;   // secondi: freccia delle medie a 10/20/30 giri
const BASE_GIRI = 5;
const ZERI_STABILE = 5;         // giri validi di fila dentro la tolleranza = passo stabile
const FINESTRA_ALTRI = 10;
const PAUSA_MS = 20 * 60 * 1000;
const MAX_GIRI = 3000;
const MAX_ETA_MS = 72 * 3600 * 1000;
const OGNI_MS = 2000;           // al massimo un aggiornamento ogni 2 s verso i telefoni

let io = null;
const stanze = new Map(); // code -> stato passo

function init(server) {
  io = server;
}

const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const arrotonda = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

function nuovaVettura(numero, classe) {
  return {
    numero, classe: classe || "",
    giri: null, ultimo: null, best: null, bestN: null,
    ultimoTs: null,
    valid: [], nValid: 0, base: null, segni: [], tr: null, zeri: 0,
    stint: 0,
  };
}

function nuovaStanza() {
  return {
    numero: "",
    auto: new Map(),   // numero -> vettura
    giri: [],          // nostri giri: { n, t, ts, v, s }
    byN: new Map(),
    daInviare: [],     // giri nostri nuovi dall'ultimo invio
    timer: null,
    ultimoInvio: 0,
    sporco: false,
  };
}

function stanza(code) {
  if (!stanze.has(code)) stanze.set(code, nuovaStanza());
  return stanze.get(code);
}

// Un giro nuovo valido: aggiorna finestra e trend della vettura.
function aggiungiValido(v, t) {
  v.valid.push(t);
  if (v.valid.length > FINESTRA_ALTRI) v.valid.shift();
  v.nValid++;
  if (v.base == null) {
    if (v.nValid >= BASE_GIRI && v.valid.length >= Math.min(BASE_GIRI, FINESTRA_ALTRI)) {
      v.base = media(v.valid.slice(-BASE_GIRI));
    }
    return;
  }
  const d = t - v.base;
  const s = d < -TOLLERANZA ? "+" : d > TOLLERANZA ? "-" : "0";
  v.segni.push(s);
  if (v.segni.length > 2) v.segni.shift();
  v.zeri = s === "0" ? v.zeri + 1 : 0;
  if (v.segni.length === 2 && v.segni[0] === v.segni[1] && s !== "0") {
    v.tr = s === "+" ? "up" : "down";
    v.base = media(v.valid);
    v.segni = [];
  } else if (v.zeri >= ZERI_STABILE) {
    v.tr = "eq"; // il passo e' fermo da un po': nessuna tendenza
  }
}

function nuovoStint(v) {
  v.valid = []; v.nValid = 0; v.base = null; v.segni = []; v.tr = null; v.zeri = 0;
}

/**
 * Registra un giro completato dalla vettura `v`. Ritorna l'oggetto giro (con v = valido
 * oppure no) o null se non c'e' niente da registrare.
 */
function registraGiro(v, n, t, ts) {
  if (!(t > 0)) return null;
  let stintNuovo = false;
  if (v.ultimoTs != null && ts - v.ultimoTs > PAUSA_MS) { v.stint++; nuovoStint(v); stintNuovo = true; }
  v.ultimoTs = ts;
  if (v.best == null || t < v.best) { v.best = t; v.bestN = n; }
  const valido = t <= v.best * (1 + SOGLIA);
  if (valido) aggiungiValido(v, t);
  return { n, t: arrotonda(t), ts, v: valido, s: v.stint, nuovoStint: stintNuovo };
}

function potatura(S, ora) {
  if (S.giri.length > MAX_GIRI) S.giri.splice(0, S.giri.length - MAX_GIRI);
  while (S.giri.length && ora - S.giri[0].ts > MAX_ETA_MS) S.giri.shift();
  S.byN = new Map(S.giri.map((g) => [g.n, g]));
}

/**
 * Chiamata a ogni lettura della classifica.
 * piloti: [{ numero, classe, giri, migliorGiro, ultimoGiro }]  numero: la nostra vettura.
 */
function registra(code, piloti, numero, ora = Date.now()) {
  if (!Array.isArray(piloti) || !piloti.length) return;
  const S = stanza(code);
  const nostro = String(numero == null ? "" : numero).trim();
  if (S.numero && nostro && S.numero !== nostro) {
    // Altra vettura scelta dal box: si riparte.
    Object.assign(S, nuovaStanza());
  }
  if (nostro) S.numero = nostro;
  let cambiato = false;

  for (const r of piloti) {
    const num_ = String(r && r.numero != null ? r.numero : "").trim();
    if (!num_) continue;
    let v = S.auto.get(num_);
    if (!v) { v = nuovaVettura(num_, r.classe); S.auto.set(num_, v); }
    v.classe = r.classe || v.classe;
    const giri = num(r.giri);
    const ultimo = num(r.ultimoGiro);
    const best = num(r.migliorGiro);
    const nostra = num_ === S.numero;

    // Meno giri di prima: e' iniziata un'altra sessione.
    if (giri != null && v.giri != null && giri < v.giri) {
      const classe = v.classe;
      Object.assign(v, nuovaVettura(num_, classe));
      if (nostra) { S.giri = []; S.byN = new Map(); S.daInviare = []; }
      cambiato = true;
    }
    // Primo contatto con la nostra vettura: una copia ripristinata di un'altra sessione
    // (con piu' giri di quelli che ha ora) non e' valida.
    if (nostra && v.giri == null && giri != null && S.giri.length && S.giri[S.giri.length - 1].n > giri) {
      S.giri = []; S.byN = new Map(); S.daInviare = [];
    }
    if (best != null && (v.best == null || best < v.best)) { v.best = best; if (giri != null && v.bestN == null) v.bestN = giri; }

    let nuovoN = null;
    if (giri != null) {
      if (v.giri == null || giri > v.giri) nuovoN = giri;
    } else if (ultimo != null && ultimo !== v.ultimo) {
      nuovoN = (v.giri || 0) + 1;
    }
    if (nuovoN != null && ultimo != null && !(nostra && S.byN.has(nuovoN))) {
      const g = registraGiro(v, nuovoN, ultimo, ora);
      if (g) {
        cambiato = true;
        if (nostra) {
          if (g.nuovoStint) { /* gli stint dei giri passati restano come sono */ }
          delete g.nuovoStint;
          S.giri.push(g); S.byN.set(g.n, g); S.daInviare.push(g);
          potatura(S, ora);
        }
      }
    }
    if (giri != null) v.giri = giri;
    else if (nuovoN != null) v.giri = nuovoN;
    if (ultimo != null) v.ultimo = ultimo;
  }
  if (cambiato) segna(code, S);
}

// ---------- statistiche della nostra vettura ----------

function finestre(S) {
  const v = S.auto.get(S.numero);
  const stint = v ? v.stint : 0;
  const validiStint = S.giri.filter((g) => g.v && g.s === stint).map((g) => g.t);
  const validiTutti = S.giri.filter((g) => g.v).map((g) => g.t);
  const out = {};
  for (const N of [10, 20, 30]) {
    const ultimi = validiStint.slice(-N);
    const prima = validiStint.slice(-2 * N, -N);
    const avg = ultimi.length >= 3 ? media(ultimi) : null;
    const prec = prima.length >= 3 ? media(prima) : null;
    const delta = avg != null && prec != null ? avg - prec : null;
    out[N] = {
      avg: arrotonda(avg), delta: arrotonda(delta), n: ultimi.length,
      dir: delta == null ? null : delta < -TOLLERANZA_MEDIA ? "up" : delta > TOLLERANZA_MEDIA ? "down" : "eq",
    };
  }
  let tot = { avg: null, delta: null, n: validiTutti.length, dir: null };
  if (validiTutti.length >= 3) {
    tot.avg = arrotonda(media(validiTutti));
    if (validiTutti.length >= 6) {
      const meta = Math.floor(validiTutti.length / 2);
      const d = media(validiTutti.slice(-meta)) - media(validiTutti.slice(0, meta));
      tot.delta = arrotonda(d);
      tot.dir = d < -TOLLERANZA_MEDIA ? "up" : d > TOLLERANZA_MEDIA ? "down" : "eq";
    }
  }
  out.tot = tot;
  return out;
}

function riepilogo(code) {
  const S = stanza(code);
  const mio = S.auto.get(S.numero) || null;
  const auto = {};
  for (const [n, v] of S.auto) {
    if (n === S.numero) continue;
    auto[n] = {
      b: arrotonda(v.best), g: v.giri,
      m10: v.valid.length >= 3 ? arrotonda(media(v.valid)) : null,
      n: v.valid.length, tr: v.tr,
    };
  }
  return {
    numero: S.numero || null,
    ts: Date.now(),
    mio: mio ? {
      giri: mio.giri, ultimo: mio.ultimo, best: arrotonda(mio.best), bestN: mio.bestN,
      m: finestre(S), tr: mio.tr, nGiri: S.giri.length,
    } : null,
    auto,
  };
}

function storico(code) {
  const S = stanza(code);
  return { numero: S.numero || null, giri: S.giri.map((g) => ({ n: g.n, t: g.t, ts: g.ts, v: g.v, s: g.s })) };
}

// Rigioca i nostri giri validi, in ordine, per ricostruire base e trend.
function ricostruisci(S) {
  const v = S.auto.get(S.numero);
  if (!v) return;
  const { giri: g0, ultimo, best, bestN, classe } = v;
  Object.assign(v, nuovaVettura(S.numero, classe));
  v.giri = g0; v.ultimo = ultimo;
  let stint = -1;
  for (const g of S.giri) {
    if (g.s !== stint) { stint = g.s; nuovoStint(v); v.stint = g.s; }
    if (v.best == null || g.t < v.best) { v.best = g.t; v.bestN = g.n; }
    if (g.v) aggiungiValido(v, g.t);
    v.ultimoTs = g.ts;
  }
  if (best != null && (v.best == null || best < v.best)) { v.best = best; v.bestN = bestN; }
}

/**
 * Il box rimanda la copia che si e' tenuta: si uniscono i giri per numero.
 * Valida solo se e' della stessa vettura e non ha piu' giri di quelli che la vettura
 * ha adesso (altrimenti e' roba di un'altra sessione).
 */
function ripristina(code, dati, ora = Date.now()) {
  if (!dati || !Array.isArray(dati.giri)) return { ok: false, aggiunti: 0 };
  const S = stanza(code);
  const numero = String(dati.numero == null ? "" : dati.numero).trim();
  if (!numero) return { ok: false, aggiunti: 0 };
  if (S.numero && S.numero !== numero) return { ok: false, aggiunti: 0 };
  if (!S.numero) S.numero = numero;
  const v = S.auto.get(S.numero);
  const giriOra = v && v.giri != null ? v.giri : null;
  if (giriOra != null && dati.giri.some((g) => g && Number.isFinite(g.n) && g.n > giriOra)) {
    return { ok: false, aggiunti: 0, motivo: "altra sessione" };
  }
  let aggiunti = 0;
  for (const g of dati.giri) {
    if (!g || !Number.isFinite(g.n) || !(g.t > 0) || !Number.isFinite(g.ts)) continue;
    if (ora - g.ts > MAX_ETA_MS) continue;
    if (giriOra != null && g.n > giriOra) continue;
    if (S.byN.has(g.n)) continue;
    S.giri.push({ n: g.n, t: arrotonda(g.t), ts: g.ts, v: Boolean(g.v), s: Number.isFinite(g.s) ? g.s : 0 });
    S.byN.set(g.n, S.giri[S.giri.length - 1]);
    aggiunti++;
  }
  if (aggiunti) {
    S.giri.sort((a, b) => a.n - b.n);
    potatura(S, ora);
    if (!S.auto.has(S.numero)) S.auto.set(S.numero, nuovaVettura(S.numero, ""));
    ricostruisci(S);
    segna(code, S);
  }
  return { ok: true, aggiunti };
}

function azzera(code) {
  const S = stanza(code);
  const numero = S.numero;
  if (S.timer) clearTimeout(S.timer);
  Object.assign(S, nuovaStanza());
  S.numero = numero;
  if (io) io.to(code).emit("passoAzzerato"); // anche le copie sugli altri telefoni
  segna(code, S, true);
}

// ---------- invio ai telefoni ----------

function segna(code, S, subito) {
  S.sporco = true;
  if (!io) return;
  if (S.timer) return;
  const attesa = subito ? 0 : Math.max(0, OGNI_MS - (Date.now() - S.ultimoInvio));
  S.timer = setTimeout(() => {
    S.timer = null;
    if (!S.sporco) return;
    S.sporco = false;
    S.ultimoInvio = Date.now();
    const r = riepilogo(code);
    r.nuovi = S.daInviare.map((g) => ({ n: g.n, t: g.t, ts: g.ts, v: g.v, s: g.s }));
    S.daInviare = [];
    io.to(code).emit("passoUpdate", r);
  }, attesa);
}

function dimentica(code) {
  const S = stanze.get(code);
  if (S && S.timer) clearTimeout(S.timer);
  stanze.delete(code);
}

module.exports = {
  init, registra, riepilogo, storico, ripristina, azzera, dimentica,
  _test: { SOGLIA, TOLLERANZA, aggiungiValido, nuovaVettura, registraGiro, stanze },
};
