// Le impostazioni della squadra, salvate fuori dalla memoria del server.
//
// Che cosa si salva: capienza e consumo del serbatoio, i tasti rapidi, i messaggi
// a comparsa, giorno/notte, cosa mostra l'auto (assoluta/categoria, telefono/tablet),
// le durate dei timer, la schermata di arrivo e gli indirizzi dei collegamenti
// (mai le password). Non si salva niente di "dal vivo": classifica, giri, messaggi.
//
// Dove: Upstash Redis (ARCHIVIO_URL/TOKEN) oppure una cartella su un disco vero
// (DATA_DIR). Senza nessuno dei due questo modulo non fa niente e restano le copie
// sui telefoni, come prima.
//
// Le stanze di prova (TEST + numero) non si salvano mai.
//
// Sicurezza dei dati: se la lettura iniziale fallisce, per quella stanza non si
// scrive nulla finche' non riesce una lettura, cosi' i valori di partenza non
// cancellano mai quelli veri.

const fs = require("fs");
const path = require("path");
const { ARCHIVIO_URL, ARCHIVIO_TOKEN, DATA_DIR } = require("./config");
const { rooms, getRoomState, eProva } = require("./rooms");

const RITARDO_SALVA_MS = Number(process.env.ARCHIVIO_RITARDO_MS) || 1500;
const TIMEOUT_MS = Number(process.env.ARCHIVIO_TIMEOUT_MS) || 4000;
// Un carburante "in pista" salvato da piu' di cosi' non e' piu' vero: si tengono
// capienza e consumo e si ferma il conteggio.
const CARBURANTE_MAX_MS = 30 * 3600 * 1000;

function nome() {
  if (ARCHIVIO_URL && ARCHIVIO_TOKEN) return "upstash";
  if (DATA_DIR) return "cartella";
  return null;
}

const chiave = (code) => "pitcomm:" + code;
const sicuro = (code) => String(code).replace(/[^A-Za-z0-9_-]/g, "_");

async function conTimeout(promessa) {
  let t;
  const scaduto = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("tempo scaduto")), TIMEOUT_MS); });
  try { return await Promise.race([promessa, scaduto]); } finally { clearTimeout(t); }
}

async function upstash(comando) {
  const r = await fetch(ARCHIVIO_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + ARCHIVIO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(comando),
  });
  if (!r.ok) throw new Error("archivio: risposta " + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error("archivio: " + j.error);
  return j ? j.result : null;
}

// Ritorna l'oggetto salvato oppure null se non c'e' niente. Lancia se non riesce a leggere.
async function leggi(code) {
  const b = nome();
  if (b === "upstash") {
    const txt = await conTimeout(upstash(["GET", chiave(code)]));
    return txt ? JSON.parse(txt) : null;
  }
  if (b === "cartella") {
    try { return JSON.parse(await fs.promises.readFile(path.join(DATA_DIR, sicuro(code) + ".json"), "utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  return null;
}

async function scrivi(code, oggetto) {
  const b = nome();
  const txt = JSON.stringify(oggetto);
  if (b === "upstash") await conTimeout(upstash(["SET", chiave(code), txt]));
  else if (b === "cartella") {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const f = path.join(DATA_DIR, sicuro(code) + ".json");
    await fs.promises.writeFile(f + ".tmp", txt);
    await fs.promises.rename(f + ".tmp", f);
  }
}

// ---------- cosa si salva ----------

function istantanea(S) {
  const t = S.raceTimer;
  return {
    v: 1,
    at: Date.now(),
    fuelSystem: S.fuelSystem,
    quickButtons: S.quickButtons,
    flashPresets: S.flashPresets,
    dayMode: S.dayMode,
    autonomyMinutes: S.autonomyMinutes,
    timingView: S.timingView,
    autoLayout: S.autoLayout,
    sogliaGap: S.sogliaGap,
    raceTimer: {
      startSeconds: t.startSeconds, raceSeconds: t.raceSeconds,
      finishMode: t.finishMode, finishBackground: t.finishBackground, finishDriverName: t.finishDriverName,
    },
    collegamenti: S.collegamenti,
  };
}

const eNumero = (x) => typeof x === "number" && Number.isFinite(x);

// Mette nello stato i valori salvati; ogni voce solo se ha la forma giusta.
function applica(S, d) {
  if (!d || typeof d !== "object") return;
  if (d.fuelSystem && typeof d.fuelSystem === "object" && eNumero(d.fuelSystem.tankCapacityLiters)) {
    const f = { ...S.fuelSystem, ...d.fuelSystem };
    if (f.onTrack && (!eNumero(d.at) || Date.now() - d.at > CARBURANTE_MAX_MS)) {
      f.currentLiters = eNumero(f.sessionStartLiters) && f.sessionStartLiters > 0 ? Math.min(f.sessionStartLiters, f.tankCapacityLiters) : f.tankCapacityLiters;
      f.onTrack = false;
      f.sessionStartAt = null;
    }
    S.fuelSystem = f;
    S.fresh.fuel = false;
    const pct = f.tankCapacityLiters > 0 ? Math.round((f.currentLiters / f.tankCapacityLiters) * 100) : 0;
    S.fuel = { percent: Math.max(0, Math.min(100, pct)), updatedAt: Date.now() };
  }
  if (Array.isArray(d.quickButtons) && d.quickButtons.length) { S.quickButtons = d.quickButtons; S.fresh.buttons = false; }
  if (Array.isArray(d.flashPresets) && d.flashPresets.length) S.flashPresets = d.flashPresets;
  if (typeof d.dayMode === "boolean") S.dayMode = d.dayMode;
  if (eNumero(d.autonomyMinutes)) S.autonomyMinutes = d.autonomyMinutes;
  if (d.timingView === "assoluta" || d.timingView === "categoria") S.timingView = d.timingView;
  if (d.autoLayout === "telefono" || d.autoLayout === "tablet") { S.autoLayout = d.autoLayout; S.fresh.layout = false; }
  if ([0.1, 0.25, 0.5, 1].includes(d.sogliaGap)) { S.sogliaGap = d.sogliaGap; S.fresh.soglia = false; }
  const t = d.raceTimer;
  if (t && typeof t === "object") {
    const R = S.raceTimer;
    const ora = Date.now();
    if (eNumero(t.startSeconds) && t.startSeconds >= 0) { R.startSeconds = t.startSeconds; R.startRemaining = t.startSeconds; R.startUpdatedAt = ora; }
    if (eNumero(t.raceSeconds) && t.raceSeconds > 0) { R.raceSeconds = t.raceSeconds; R.raceRemaining = t.raceSeconds; R.raceUpdatedAt = ora; }
    if (t.finishMode === "manual" || t.finishMode === "auto") R.finishMode = t.finishMode;
    if (t.finishBackground === "photo" || t.finishBackground === "dark") R.finishBackground = t.finishBackground;
    if (typeof t.finishDriverName === "string") R.finishDriverName = t.finishDriverName.slice(0, 80);
  }
  if (d.collegamenti && typeof d.collegamenti === "object") S.collegamenti = d.collegamenti;
}

// ---------- caricamento e salvataggio ----------

const caricamenti = new Map(); // codice -> promessa
const daSalvare = new Map();   // codice -> timer
let ultimoErrore = null;

// Da chiamare prima di creare lo stato di una stanza (al join). Una volta sola per
// stanza finche' il processo vive; se la lettura e' fallita ci riprova al join dopo.
async function prepara(code) {
  if (!nome() || eProva(code)) return;
  if (rooms.has(code) && !rooms.get(code).archivioErrore) return;
  if (!caricamenti.has(code)) {
    caricamenti.set(code, (async () => {
      const dallArchivio = { ok: false, dati: null };
      try { dallArchivio.dati = await leggi(code); dallArchivio.ok = true; ultimoErrore = null; }
      catch (e) { ultimoErrore = e.message || String(e); console.error("archivio: lettura di " + code + " non riuscita: " + ultimoErrore); }
      const S = getRoomState(code);
      if (dallArchivio.ok) {
        applica(S, dallArchivio.dati);
        S.archivioErrore = false;
        S.archivioSalvataggi = true;
      } else {
        S.archivioErrore = true;
        S.archivioSalvataggi = false;
      }
    })().finally(() => caricamenti.delete(code)));
  }
  await caricamenti.get(code);
}

// Una impostazione e' cambiata: tra poco si salva (le modifiche ravvicinate si uniscono).
function segna(code) {
  if (!nome() || eProva(code) || !rooms.has(code)) return;
  const S = rooms.get(code);
  if (!S.archivioSalvataggi) return;
  if (daSalvare.has(code)) return;
  daSalvare.set(code, setTimeout(async () => {
    daSalvare.delete(code);
    try { await scrivi(code, istantanea(rooms.get(code))); ultimoErrore = null; }
    catch (e) { ultimoErrore = e.message || String(e); console.error("archivio: salvataggio di " + code + " non riuscito: " + ultimoErrore); }
  }, RITARDO_SALVA_MS));
}

// Per i test e per la chiusura: salva subito le stanze in attesa.
async function svuota() {
  const codici = [...daSalvare.keys()];
  for (const c of codici) clearTimeout(daSalvare.get(c));
  daSalvare.clear();
  await Promise.allSettled(codici.map((c) => scrivi(c, istantanea(rooms.get(c)))));
}

function stato() { return { archivio: nome(), ultimoErrore }; }

module.exports = { prepara, segna, svuota, stato, istantanea, applica, _test: { leggi, scrivi } };
