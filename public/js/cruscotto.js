// Box: cruscotto di gara, distacco giro per giro, allarmi e consumo imparato.
// Tutto qui lavora SOLO sul box e sul timing (nostro e degli avversari): niente bandiere.
// Non cambia niente della schermata auto.
//
// Letto da Aub / dal ponte: posizione, giri, tempi, distacchi.
// STIMATO: giri alla fine, benzina in giri, soste necessarie, consumo imparato.

const CR_ALLARMI = 'pc_allarmi';
const CR_GAPGIRI = 'pc_gapgiri';
const CR_CONSUMO = 'pc_consumo';

let timingRicevutoAt = null;   // quando e' arrivato l'ultimo aggiornamento della classifica
let aubStatoUltimo = null;
let ponteStatoUltimo = null;
let gapGiri = null;            // [{ n, a, b, na, nb }] un punto per ogni nostro giro
let crAvvisi = [];             // ultimi avvisi (testo, ora)
const crCondizione = {};       // chiave -> vero se la condizione e' gia' scattata
const crUltimoAvviso = {};     // chiave -> ora dell'ultimo avviso

// ---------- aiuti ----------

function crPassoMio(){
  const m = passoRis && passoRis.mio && passoRis.mio.m;
  if(!m) return null;
  if(m[10] && m[10].avg != null) return m[10].avg;
  if(m.tot && m.tot.avg != null) return m.tot.avg;
  return null;
}

function crGiriFine(){
  const rem = (typeof passoRimasto === 'function') ? passoRimasto() : null;
  const pace = crPassoMio();
  if(rem == null || rem <= 0 || pace == null) return null;
  return Math.ceil(rem / pace); // si finisce al primo passaggio dopo lo zero
}

function crLitriOra(){ return fuelSystem && fuelSystem.consumptionRatePerHour > 0 ? fuelSystem.consumptionRatePerHour : null; }

// Giri che si fanno con la benzina che c'e' adesso.
function crGiriBenzina(){
  const pace = crPassoMio(), rate = crLitriOra();
  if(pace == null || rate == null) return null;
  const ore = computeLiveLiters() / rate;
  return Math.max(0, Math.floor(ore * 3600 / pace));
}

// Soste ancora necessarie per arrivare in fondo (stima: ogni sosta riempie il serbatoio).
function crSoste(giriFine, giriBenzina){
  const pace = crPassoMio(), rate = crLitriOra();
  if(giriFine == null || giriBenzina == null || pace == null || rate == null) return null;
  const mancano = giriFine - giriBenzina;
  if(mancano <= 0) return 0;
  const giriPieno = Math.max(1, Math.floor((fuelSystem.tankCapacityLiters / rate) * 3600 / pace));
  return Math.ceil(mancano / giriPieno);
}

// Rivali nella vista scelta (assoluta o categoria) e i loro tempi.
function crSegno(n){ return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1); }

// ---------- classifica: quanto e' fresca ----------

function crEtaClassifica(){
  const aub = aubStatoUltimo && aubStatoUltimo.connected;
  const ponte = ponteStatoUltimo && ponteStatoUltimo.connected;
  if(!aub && !ponte) return { testo: 'Classifica: non collegata', cls: 'cr-cattivo' };
  if(timingRicevutoAt == null) return { testo: 'Classifica: in attesa dei dati', cls: 'cr-attenzione' };
  if(aub && aubStatoUltimo.stale) return { testo: 'Classifica: dati fermi (Aub non aggiorna)', cls: 'cr-cattivo' };
  const s = Math.round((Date.now() - timingRicevutoAt) / 1000);
  const cls = s <= 30 ? 'cr-buono' : s <= 90 ? 'cr-attenzione' : 'cr-cattivo';
  return { testo: 'Classifica aggiornata ' + (s < 60 ? s + ' s' : Math.floor(s / 60) + ' min') + ' fa', cls: cls };
}

// ---------- distacco giro per giro ----------

function crCaricaGap(){
  if(gapGiri) return;
  const s = load(CR_GAPGIRI, null);
  gapGiri = s && s.code === code && Array.isArray(s.items) ? s.items : [];
}

function crSalvaGap(){
  try{ save(CR_GAPGIRI, { code: code, items: gapGiri.slice(-60) }); }catch(e){}
}

// A ogni nostro giro nuovo si annotano i distacchi di quel momento.
function crRegistraGap(){
  const mio = passoRis && passoRis.mio;
  if(!mio || mio.giri == null || typeof lastTiming === 'undefined' || !lastTiming) return;
  crCaricaGap();
  const ultimo = gapGiri.length ? gapGiri[gapGiri.length - 1] : null;
  if(ultimo && ultimo.n >= mio.giri) {
    if(ultimo.n > mio.giri) gapGiri = []; // giri ripartiti da capo: altra sessione
    else return;
  }
  const t = lastTiming;
  const cat = timingView === 'categoria' && t.catName;
  const gA = passoSecDaGap(cat ? t.catGapAhead : t.gapAhead), gB = passoSecDaGap(cat ? t.catGapBehind : t.gapBehind);
  gapGiri.push({
    n: mio.giri,
    a: gA, b: gB,
    na: String((cat ? t.catNumberAhead : t.numberAhead) || ''), nb: String((cat ? t.catNumberBehind : t.numberBehind) || ''),
  });
  if(gapGiri.length > 60) gapGiri.shift();
  crSalvaGap();
}

// Variazioni giro per giro con lo stesso rivale: [{ d, buono }] e media.
function crVariazioni(lato){
  crCaricaGap();
  const chiave = lato === 'ahead' ? 'a' : 'b', num = lato === 'ahead' ? 'na' : 'nb';
  const pts = gapGiri.filter((g) => g[chiave] != null);
  const ultimi = pts.slice(-6);
  const d = [];
  for(let i = 1; i < ultimi.length; i++){
    if(ultimi[i][num] !== ultimi[i - 1][num]) continue; // rivale diverso: non si confronta
    d.push(ultimi[i][chiave] - ultimi[i - 1][chiave]);
  }
  const ult = pts.length ? pts[pts.length - 1] : null;
  const media = d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
  return { d: d, media: media, ultimo: ult, numero: ult ? ult[num] : '' };
}

function crTestoGap(lato){
  const v = crVariazioni(lato);
  const et = lato === 'ahead' ? 'Davanti' : 'Dietro';
  if(!v.ultimo) return { testo: et + ': in attesa dei giri', tono: '' };
  const n = v.numero ? ' #' + v.numero : '';
  let testo = et + n + ': ' + v.ultimo[lato === 'ahead' ? 'a' : 'b'].toFixed(1) + ' s';
  if(!v.d.length) return { testo: testo, tono: '' };
  testo += ' · ultimi giri: ' + v.d.map(crSegno).join(' ') + ' · medio ' + crSegno(v.media) + ' s/giro';
  // davanti: scendere e' bene; dietro: salire e' bene
  const buono = lato === 'ahead' ? v.media < -0.05 : v.media > 0.05;
  const cattivo = lato === 'ahead' ? v.media > 0.05 : v.media < -0.05;
  return { testo: testo, tono: buono ? 'buono' : cattivo ? 'cattivo' : '' };
}

// ---------- allarmi (spenti di default) ----------

function crConfigAllarmi(){
  return Object.assign({ on: false, dietro: true, dietroS: 2, passo: true, passoS: 0.5, lento: true, lentoS: 1, rimonta: true }, load(CR_ALLARMI, {}));
}

function crSalvaAllarmi(c){ try{ save(CR_ALLARMI, c); }catch(e){} }

function crImpostaAllarme(chiave, valore){
  const c = crConfigAllarmi();
  c[chiave] = valore;
  crSalvaAllarmi(c);
  crRenderImpostazioni();
}

function crRenderImpostazioni(){
  const c = crConfigAllarmi();
  [['alOn', 'on'], ['alDietro', 'dietro'], ['alPasso', 'passo'], ['alLento', 'lento'], ['alRimonta', 'rimonta']].forEach(([id, k]) => { if($(id)) $(id).checked = !!c[k]; });
  [['alDietroS', 'dietroS'], ['alPassoS', 'passoS'], ['alLentoS', 'lentoS']].forEach(([id, k]) => { if($(id) && document.activeElement !== $(id)) $(id).value = c[k]; });
}

function crVal(el, chiave){
  const n = parseFloat(String(el.value).replace(',', '.'));
  if(isFinite(n) && n > 0) crImpostaAllarme(chiave, n);
}

// Scatta una volta quando la condizione diventa vera; si riarma quando torna falsa
// (e comunque non prima di 5 minuti per la stessa chiave).
function crControlla(chiave, vera, testo){
  if(!vera){ crCondizione[chiave] = false; return; }
  if(crCondizione[chiave]) return;
  crCondizione[chiave] = true;
  const ora = Date.now();
  if(crUltimoAvviso[chiave] && ora - crUltimoAvviso[chiave] < 5 * 60 * 1000) return;
  crUltimoAvviso[chiave] = ora;
  crAvvisi.unshift({ t: ora, testo: testo });
  crAvvisi = crAvvisi.slice(0, 4);
  try{ if(navigator.vibrate) navigator.vibrate([250, 120, 250]); }catch(e){}
  try{ playAlertBeep(); }catch(e){}
}

function crAllarmi(){
  const c = crConfigAllarmi();
  if(!c.on) return;
  const mio = passoRis && passoRis.mio;
  const m10 = mio && mio.m && mio.m[10];
  // prima di una decina di giri validi non si avvisa: i dati non sono affidabili
  if(!mio || !m10 || m10.avg == null || m10.n < 10 || typeof lastTiming === 'undefined' || !lastTiming) return;
  const t = lastTiming;
  const catOk = Boolean(t.catName);
  // 1. rivale dietro vicino
  if(c.dietro){
    const g = passoSecDaGap(timingView === 'categoria' && catOk ? t.catGapBehind : t.gapBehind);
    crControlla('dietro', g != null && g <= c.dietroS, 'Dietro a ' + g + ' s (soglia ' + c.dietroS + ' s)');
  }
  // 2. passo calato: ultimi 3 giri validi contro la media degli ultimi 10
  if(c.passo){
    const v = passoLocale.giri.filter((x) => x.v).slice(-3);
    if(v.length === 3){
      const media3 = (v[0].t + v[1].t + v[2].t) / 3;
      crControlla('passo', media3 - m10.avg > c.passoS, 'Passo calato: ' + (media3 - m10.avg).toFixed(1) + ' s sopra la media');
    }
  }
  // 3. ultimo giro piu' lento (ma non un giro di sosta: quelli non sono validi)
  if(c.lento){
    const ult = passoLocale.giri.length ? passoLocale.giri[passoLocale.giri.length - 1] : null;
    crControlla('lento', Boolean(ult && ult.v && ult.t - m10.avg > c.lentoS), ult ? 'Giro lento: ' + passoTempo(ult.t) : '');
  }
  // 4. il rivale di categoria dietro ci raggiunge entro la fine
  if(c.rimonta){
    const num = catOk ? t.catNumberBehind : t.numberBehind;
    const gap = passoSecDaGap(catOk ? t.catGapBehind : t.gapBehind);
    const riv = num && passoRis.auto ? passoRis.auto[String(num)] : null;
    const L = crGiriFine();
    let scatta = false, giri = null;
    if(riv && riv.m10 != null && gap != null && gap > 0 && L != null){
      const chiusura = m10.avg - riv.m10;
      if(chiusura > 0.05){ giri = Math.ceil(gap / chiusura); scatta = giri <= L; }
    }
    crControlla('rimonta:' + num, scatta, '#' + num + (catOk ? ' (categoria)' : '') + ' ti raggiunge entro la fine: fra ~' + giri + ' giri, ne restano ' + L);
  }
}

// ---------- consumo imparato dai rifornimenti ----------
// Si conosce il livello a un certo punto (serbatoio pieno oppure litri impostati a mano).
// Rifornendo "fino al pieno" il consumo e' livello + litri aggiunti - capienza, diviso le
// ore passate in pista (dal momento in cui si preme "In pista", non dallo zero del timing).

function crStatoConsumo(){
  const s = load(CR_CONSUMO, null);
  if(s && s.code === code) return s;
  return { code: code, liv: null, sec: 0, l: 0, h: 0, n: 0 };
}

function crSalvaConsumo(s){ try{ save(CR_CONSUMO, s); }catch(e){} }

function crSecSessione(){
  const fs = fuelSystem;
  if(!fs.onTrack || !fs.sessionStartAt) return 0;
  return ((nowSync() - fs.sessionStartAt) / 1000) * fuelTestSpeed();
}

// Si parte in pista: se il serbatoio e' pieno e non si sa altro, e' il punto di partenza.
function consumoInizioSessione(){
  const s = crStatoConsumo();
  if(s.liv == null && fuelSystem.currentLiters >= fuelSystem.tankCapacityLiters * 0.98){ s.liv = fuelSystem.currentLiters; s.sec = 0; crSalvaConsumo(s); }
}

// Si rientra ai box: il tempo in pista si somma.
function consumoFineSessione(){
  const s = crStatoConsumo();
  s.sec += crSecSessione();
  crSalvaConsumo(s);
}

// Livello di partenza impostato a mano.
function consumoLivelloImpostato(litri){
  const s = crStatoConsumo();
  s.liv = litri;
  s.sec = 0;
  crSalvaConsumo(s);
}

// Da chiamare in doRefuel PRIMA di cambiare lo stato del carburante.
function consumoImpara(aggiunti, pieno){
  const s = crStatoConsumo();
  const ore = (s.sec + crSecSessione()) / 3600;
  let imparato = false;
  const consumati = s.liv != null ? s.liv + aggiunti - fuelSystem.tankCapacityLiters : 0;
  if(pieno && consumati > 0 && ore >= 0.15){
    s.l += consumati; s.h += ore; s.n += 1;
    fuelSystem.consumptionRatePerHour = s.l / s.h;
    imparato = true;
  }
  s.liv = pieno ? fuelSystem.tankCapacityLiters : null;
  s.sec = 0;
  crSalvaConsumo(s);
  return imparato;
}

function crRenderConsumo(){
  const el = $('consumoImparatoLabel');
  if(!el) return;
  const s = crStatoConsumo();
  el.textContent = s.n ? 'Consumo imparato: ' + (s.l / s.h).toFixed(1) + ' L/ora (da ' + s.n + (s.n === 1 ? ' rifornimento' : ' rifornimenti') + ')'
    : 'Il consumo si impara da solo: imposta il livello di partenza (o parti col pieno), premi "In pista" quando esce, poi rifornisci fino al pieno.';
}

// ---------- disegno ----------

function crRiga(contenitore, testo, cls){
  if(!testo) return;
  const d = document.createElement('div');
  d.textContent = testo;
  if(cls) d.className = cls;
  contenitore.appendChild(d);
}

function crRenderCruscotto(){
  const box = $('crCruscotto');
  if(!box) return;
  box.textContent = '';
  const eta = crEtaClassifica();
  crRiga(box, eta.testo, 'cr-riga ' + eta.cls);
  // davanti e dietro: previsione sul passo (c'e' gia' nella scheda Passo)
  const rv = passoRivali();
  [['ahead', 'Davanti'], ['behind', 'Dietro']].forEach(([lato, et]) => {
    const c = passoConfronto(lato);
    const n = rv && rv[lato].numero ? ' #' + rv[lato].numero : '';
    crRiga(box, et + n + ': ' + (c.testo || 'dati non ancora sufficienti'), 'cr-riga ' + (c.tono === 'buono' ? 'cr-buono' : c.tono === 'cattivo' ? 'cr-cattivo' : ''));
  });
  // fine gara, benzina, soste
  const gf = crGiriFine(), gb = crGiriBenzina(), so = crSoste(gf, gb);
  if(gf == null) crRiga(box, 'Fine gara: serve il timer di gara in corso e qualche giro valido', 'cr-riga cr-muto');
  else {
    let t = 'Fine gara: ~' + gf + ' giri';
    if(gb == null) t += ' · consumo non impostato';
    else {
      t += ' · benzina per ~' + gb + ' giri';
      t += so === 0 ? ' · basta fino alla fine' : ' · servono ' + so + (so === 1 ? ' sosta' : ' soste');
    }
    crRiga(box, t, 'cr-riga' + (so > 0 ? ' cr-attenzione' : ''));
    crRiga(box, 'Stima: tempo rimasto diviso il tuo passo (ultimi 10 giri), ±1 giro.', 'cr-riga cr-muto cr-piccolo');
  }
  // avvisi
  if(crAvvisi.length){
    crRiga(box, 'Ultimi avvisi', 'cr-riga cr-titolo');
    crAvvisi.forEach((a) => crRiga(box, new Date(a.t).toLocaleTimeString('it-IT') + ' · ' + a.testo, 'cr-riga cr-attenzione'));
  }
}

function crRenderGapCard(){
  const box = $('passoGapGiri');
  if(!box) return;
  box.textContent = '';
  [['ahead'], ['behind']].forEach(([lato]) => {
    const r = crTestoGap(lato);
    crRiga(box, r.testo, 'cr-riga ' + (r.tono === 'buono' ? 'cr-buono' : r.tono === 'cattivo' ? 'cr-cattivo' : ''));
  });
}

function crGiro(){
  if(role !== 'box') return;
  try{
    crRegistraGap();
    crAllarmi();
    crRenderCruscotto();
    crRenderGapCard();
    crRenderConsumo();
  }catch(e){ /* il cruscotto non deve mai fermare il resto */ }
}

setInterval(crGiro, 2000);
document.addEventListener('DOMContentLoaded', () => { try{ crRenderImpostazioni(); }catch(e){} });
