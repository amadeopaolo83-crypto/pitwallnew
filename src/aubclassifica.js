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

function capireCampi(righe) {
  const v = righe
    .map((r) => ({ pos: Number(r.pos), g: parseTempo(r.gap), d: parseTempo(r.diff) }))
    .filter((r) => Number.isFinite(r.pos))
    .sort((x, y) => x.pos - y.pos);
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
  else if (parG >= 4 && parD >= 4) {
    // Secondo indizio: il campo cumulativo non scende quasi mai, l'intervallo si'.
    const rG = suG / parG, rD = suD / parD;
    if (rD >= 0.7 && rD >= rG + 0.25) scelta = "scambiati";
    else if (rG >= 0.7 && rG >= rD + 0.25) scelta = "documento";
  }
  if (scelta) ultimaScelta = scelta;
  return scelta || ultimaScelta || "documento";
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
  const campoIntervallo = capireCampi(righe) === "scambiati" ? "gap" : "diff";
  const primo = righe.reduce((m, r) => (Number(r.pos) < Number(m.pos) ? r : m), righe[0]);
  const giriPrimo = Number(primo.laps);
  const piloti = [];
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
      intervallo: pos === 1 ? null : parseTempo(r[campoIntervallo]),
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
  return c.trovata ? { trovata: true, timing: c.timing } : { trovata: false, vuota: false };
}

module.exports = { timingDaAub, pilotiDaAub, nostroNumero, parseTempo, parseGiri, capireCampi, _reset: () => { ultimaScelta = null; } };
