// Traduce la classifica intera di Aub (/stream senza numero, o /classifica) nel
// formato comune del ponte, cosi' i distacchi assoluti e quelli di categoria li
// calcola la stessa funzione (computeTiming di ponte.js) per tutte le fonti.
//
// Una riga di Aub:
//   { pos, number, name, category, laps, bestlap, laptime, gap, diff, myself }
//   gap  = distacco dal primo, diff = distacco da chi sta davanti, "come li scrive
//          il servizio di cronometraggio": "+12.4", "00:01.234", "1:02.345", "+1 lap".
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

/**
 * Le righe di Aub nel formato comune. `giriRitardo` e' 0 per chi ha un distacco in
 * tempo (o e' il primo), N per chi ha "N lap" dal primo: serve a descrivere la
 * distanza fra due doppiati.
 */
function pilotiDaAub(payload) {
  const righe = Array.isArray(payload && payload.full_classification_json)
    ? payload.full_classification_json
    : [];
  const piloti = [];
  for (const r of righe) {
    if (!r || typeof r !== "object") continue;
    const pos = Number(r.pos);
    if (!Number.isFinite(pos)) continue;
    const giri = Number(r.laps);
    const ritardo = parseGiri(r.gap);
    piloti.push({
      pos,
      numero: r.number == null ? "" : String(r.number).trim(),
      nome: r.name == null ? "" : String(r.name),
      classe: r.category == null ? "" : String(r.category),
      giri: Number.isFinite(giri) ? giri : null,
      giriRitardo: ritardo !== null ? ritardo : 0,
      migliorGiro: parseTempo(r.bestlap),
      tempoTotale: null,
      intervallo: pos === 1 ? null : parseTempo(r.diff),
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

module.exports = { timingDaAub, pilotiDaAub, nostroNumero, parseTempo, parseGiri };
