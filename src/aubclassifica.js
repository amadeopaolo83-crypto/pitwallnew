// Traduce la classifica intera di Aub (/stream senza numero, o /classifica) nel
// formato comune del ponte, cosi' i distacchi assoluti e quelli di categoria li
// calcola la stessa funzione (computeTiming di ponte.js) per tutte le fonti.
//
// Una riga di Aub:
//   { pos, number, name, category, laps, bestlap, laptime, gap, diff, myself }
//   gap / diff = distacco dal primo e distacco da chi sta davanti (quale e' quale lo
//          si capisce dai dati, vedi capireCampi), "come li scrive il servizio di
//          cronometraggio": "+12.4", "00:01.234", "1:02.345", "+1 lap".
//
// Formato comune (campi usati da computeTiming):
//   { pos, numero, nome, classe, giri, giriRitardo, migliorGiro, tempoTotale, intervallo }
//   con i tempi in secondi.

const { computeTiming } = require("./ponte");

// "+12.4" -> 12.4, "00:01.234" -> 1.234, "-1:02.345" -> 62.345, "" -> null, "+1 lap" -> null.
// Il segno non conta: chi sta davanti o dietro lo decide l'ordine della classifica.
function parseTempo(testo) {
  if (typeof testo === "number") return Number.isFinite(testo) ? Math.abs(testo) : null;
  const t = String(testo == null ? "" : testo).trim().replace(/^[+\-]\s*/, "");
  if (!/^\d+(?::\d+){0,2}(?:[.,]\d+)?$/.test(t)) return null;
  const parti = t.replace(",", ".").split(":").map(Number);
  let sec = 0;
  for (const p of parti) sec = sec * 60 + p;
  return Number.isFinite(sec) ? Math.round(sec * 1000) / 1000 : null;
}

// Come parseTempo ma tenendo il segno: "-00:36.144" -> -36.144, "+12.4" -> 12.4.
// Serve quando il distacco e' misurato da un punto di riferimento (noi): chi sta
// davanti ha un valore positivo, chi sta dietro negativo.
function parseTempoFirmato(testo) {
  if (typeof testo === "number") return Number.isFinite(testo) ? testo : null;
  const t = String(testo == null ? "" : testo).trim();
  const v = parseTempo(t.replace(/^[\u2212\u2013]/, "-"));
  if (v === null) return null;
  return /^[-\u2212\u2013]/.test(t) ? -v : v;
}

// "+1 lap", "2 laps", "1 giro", "3 giri" -> numero di giri; altrimenti null.
function parseGiri(testo) {
  const m = /(\d+)\s*(?:laps?|giri|giro|l)\b/i.exec(String(testo == null ? "" : testo));
  return m ? Number(m[1]) : null;
}

// Nei dati di prova di Aub `gap` e `diff` sono SCAMBIATI rispetto alla documentazione:
// `gap` e' l'intervallo da chi sta davanti e `diff` il distacco cumulativo dal primo.
// Per questo i nomi non bastano: si guarda come si comportano i numeri. Un distacco
// cumulativo e' la somma degli intervalli: per ogni riga, cumulativo(k) - cumulativo(k-1)
// e' uguale all'intervallo(k). La coppia di campi che lo verifica sulle righe e' quella
// giusta. Se i dati non bastano a decidere, si tiene l'ultima scelta sicura, altrimenti
// la lettura della documentazione (gap = dal primo, diff = da chi sta davanti).
const TOLLERANZA = 0.0025; // arrotondamenti al millesimo
let ultimaScelta = null; // "documento" | "scambiati"

// Un campo e' un distacco "cumulativo" (una posizione su un asse del tempo) quando i
// suoi valori, letti in ordine di classifica, vanno sempre nella stessa direzione.
// L'intervallo da chi sta davanti si ottiene allora come differenza fra due righe.
// Due varianti: dal primo (crescente) oppure da una vettura di riferimento, di solito
// la nostra (positivo davanti, zero su di noi, negativo dietro: decrescente).
function andamento(valori) {
  let n = 0, su = 0, giu = 0, ultimo = null, min = Infinity, max = -Infinity;
  for (const x of valori) {
    if (x === null) continue;
    if (ultimo !== null) {
      n++;
      if (x >= ultimo - TOLLERANZA) su++;
      if (x <= ultimo + TOLLERANZA) giu++;
    }
    ultimo = x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { n, su, giu, ampiezza: max - min };
}

function relativoANoi(v, campo) {
  // Il riferimento e' la riga `myself` e il suo valore e' zero; chi la precede ha valori
  // positivi e chi la segue negativi (si ammette qualche riga fuori posto).
  const i = v.findIndex((r) => r.mio);
  if (i <= 0) return false;
  const x = (r) => r[campo];
  if (x(v[i]) === null || Math.abs(x(v[i])) > 0.0005) return false;
  let coerenti = 0, totale = 0, lati = new Set();
  for (let k = 0; k < v.length; k++) {
    if (k === i || x(v[k]) === null || Math.abs(x(v[k])) <= 0.0005) continue;
    totale++;
    const davanti = k < i;
    if ((davanti && x(v[k]) > 0) || (!davanti && x(v[k]) < 0)) { coerenti++; lati.add(davanti); }
  }
  return totale >= 2 && coerenti / totale >= 0.7 && coerenti >= 2;
}

function capireCampi(righe) {
  const v = righe
    .map((r) => ({ pos: Number(r.pos), g: parseTempo(r.gap), d: parseTempo(r.diff), gs: parseTempoFirmato(r.gap), ds: parseTempoFirmato(r.diff), mio: !!r.myself }))
    .filter((r) => Number.isFinite(r.pos))
    .sort((x, y) => x.pos - y.pos);
  // 1) misurato da noi: lo si riconosce dal valore zero sulla nostra riga e dai segni.
  const rel = (campo, nome) => {
    const w = v.map((r) => ({ mio: r.mio, f: campo === "g" ? r.gs : r.ds }));
    return relativoANoi(w.map((r) => ({ mio: r.mio, f: r.f })), "f") ? nome : null;
  };
  const relativo = rel("g", "cumGap") || rel("d", "cumDiff");
  if (relativo) { ultimaScelta = relativo; return relativo; }

  let documento = 0; // gap cumulativo, diff intervallo
  let scambiati = 0; // diff cumulativo, gap intervallo
  let suG = 0, parG = 0, suD = 0, parD = 0;
  for (let k = 1; k < v.length; k++) {
    const p = v[k - 1], r = v[k];
    if (p.g !== null && r.g !== null && r.d !== null && r.d > 0 && Math.abs(r.g - p.g - r.d) <= TOLLERANZA) documento++;
    if (p.d !== null && r.d !== null && r.g !== null && r.g > 0 && Math.abs(r.d - p.d - r.g) <= TOLLERANZA) scambiati++;
    if (p.g !== null && r.g !== null) { parG++; if (r.g >= p.g) suG++; }
    if (p.d !== null && r.d !== null) { parD++; if (r.d >= p.d) suD++; }
  }
  let scelta = null;
  if (documento >= 2 && documento > scambiati) scelta = "documento";
  else if (scambiati >= 2 && scambiati > documento) scelta = "scambiati";
  else {
    // 2) un solo campo sempre nella stessa direzione (con segno): e' il cumulativo.
    const aG = andamento(v.map((r) => r.gs)), aD = andamento(v.map((r) => r.ds));
    const monotono = (a) => a.n >= 4 && a.ampiezza > 1 && Math.max(a.su, a.giu) / a.n >= 0.85;
    if (monotono(aG) && !monotono(aD)) scelta = "cumGap";
    else if (monotono(aD) && !monotono(aG)) scelta = "cumDiff";
    else if (parG >= 4 && parD >= 4) {
      // 3) secondo indizio: il campo cumulativo non scende quasi mai, l'intervallo si'.
      const rG = suG / parG, rD = suD / parD;
      if (rD >= 0.7 && rD >= rG + 0.25) scelta = "scambiati";
      else if (rG >= 0.7 && rG >= rD + 0.25) scelta = "documento";
    }
  }
  if (scelta) ultimaScelta = scelta;
  return scelta || ultimaScelta || "documento";
}

// Distanza fra due valori cumulativi (con segno), oppure null se ne manca uno.
function differenza(a, b) {
  if (typeof a !== "number" || typeof b !== "number") return null;
  return Math.round(Math.abs(a - b) * 1000) / 1000;
}

/**
 * Le righe di Aub nel formato comune. L'intervallo da chi sta davanti e' il campo che
 * capireCampi() riconosce come tale. `giriRitardo` e' quanti giri ha dal primo, letto
 * dai giri completati (non dalle scritte dei distacchi, che per i doppiati non sono
 * coerenti fra i due campi).
 */
function pilotiDaAub(payload) {
  const righe = (Array.isArray(payload && payload.full_classification_json)
    ? payload.full_classification_json
    : []).filter((r) => r && typeof r === "object" && Number.isFinite(Number(r.pos)));
  if (!righe.length) return [];
  const modo = capireCampi(righe);
  const campoCumulativo = modo === "cumGap" ? "gap" : modo === "cumDiff" ? "diff" : null;
  const campoIntervallo = modo === "scambiati" ? "gap" : "diff";
  const primo = righe.reduce((m, r) => (Number(r.pos) < Number(m.pos) ? r : m), righe[0]);
  const giriPrimo = Number(primo.laps);
  const piloti = [];
  // Distacco cumulativo con segno di ogni riga, in ordine di classifica.
  const ordinate = [...righe].sort((a, b) => Number(a.pos) - Number(b.pos));
  const cumulativoDi = new Map();
  if (campoCumulativo) ordinate.forEach((r) => cumulativoDi.set(r, parseTempoFirmato(r[campoCumulativo])));
  const precedente = new Map();
  ordinate.forEach((r, k) => precedente.set(r, k > 0 ? ordinate[k - 1] : null));
  for (const r of righe) {
    const pos = Number(r.pos);
    const giri = Number(r.laps);
    const ritardo = Number.isFinite(giriPrimo) && Number.isFinite(giri) ? Math.max(0, giriPrimo - giri) : null;
    piloti.push({
      pos,
      numero: r.number == null ? "" : String(r.number).trim(),
      nome: r.name == null ? "" : String(r.name),
      classe: r.category == null ? "" : String(r.category),
      giri: Number.isFinite(giri) ? giri : null,
      giriRitardo: ritardo,
      migliorGiro: parseTempo(r.bestlap),
      tempoTotale: null,
      intervallo: pos === 1 ? null
        : campoCumulativo ? differenza(cumulativoDi.get(r), cumulativoDi.get(precedente.get(r)))
        : parseTempo(r[campoIntervallo]),
      cumulativo: campoCumulativo && cumulativoDi.get(r) !== undefined ? cumulativoDi.get(r) : null,
    });
  }
  return piloti;
}

/**
 * Il numero della nostra vettura nella classifica: quello richiesto dal box se c'e'
 * fra le righe, altrimenti quello segnato `myself` da Aub.
 */
function nostroNumero(payload, richiesto) {
  const righe = Array.isArray(payload && payload.full_classification_json)
    ? payload.full_classification_json
    : [];
  const voluto = String(richiesto == null ? "" : richiesto).trim();
  if (voluto && righe.some((r) => r && String(r.number == null ? "" : r.number).trim() === voluto)) return voluto;
  const mia = righe.find((r) => r && r.myself);
  return mia && mia.number != null ? String(mia.number).trim() : "";
}

/**
 * Posizione e distacchi, assoluti e di categoria, della nostra vettura.
 * Ritorna { trovata:false, vuota } oppure { trovata:true, timing }.
 */
function timingDaAub(payload, richiesto) {
  const piloti = pilotiDaAub(payload);
  if (!piloti.length) return { trovata: false, vuota: true };
  const numero = nostroNumero(payload, richiesto);
  if (!numero) return { trovata: false, vuota: false };
  const c = computeTiming({ tipo: "gara" }, piloti, numero);
  if (!c.trovata) return { trovata: false, vuota: false };
  // Aub, senza il numero della vettura, puo' mandare solo la nostra vettura e i vicini
  // della sua categoria (posizioni con dei buchi, il primo non c'e'). Da una lista cosi'
  // i vicini in classifica generale e la posizione di categoria non si possono sapere.
  const posizioni = piloti.map((p) => p.pos).sort((a, b) => a - b);
  const parziale = posizioni[0] > 1 || posizioni.some((p, k) => k > 0 && p - posizioni[k - 1] !== 1);
  if (parziale) {
    const t = c.timing;
    const mia = Number(t.position);
    const accanto = (numeroVicino, posAttesa) => {
      const v = piloti.find((p) => p.numero === String(numeroVicino));
      return Boolean(v) && v.pos === posAttesa;
    };
    if (!accanto(t.numberAhead, mia - 1)) { t.gapAhead = ""; t.nameAhead = ""; t.numberAhead = ""; }
    if (!accanto(t.numberBehind, mia + 1)) { t.gapBehind = ""; t.nameBehind = ""; t.numberBehind = ""; }
    t.catPosition = null;
  }
  return { trovata: true, timing: c.timing, parziale };
}

module.exports = { timingDaAub, pilotiDaAub, nostroNumero, parseTempo, parseTempoFirmato, parseGiri, capireCampi, _reset: () => { ultimaScelta = null; } };
