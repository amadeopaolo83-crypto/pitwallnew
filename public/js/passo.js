// Passo gara sul telefono: riepilogo dal server (trend, medie, confronto con le vetture
// vicine) e, sul box, la copia dei giri della nostra vettura. I calcoli stanno sul
// server (src/passo.js); qui si mostrano e si tiene la copia di sicurezza.

let passoRis = null;                 // ultimo riepilogo ricevuto
const PASSO_KEY = 'pc_passo';
const PASSO_MAX_GIRI = 3000;
const PASSO_MAX_ETA_MS = 72 * 3600 * 1000;
let passoLocale = { numero: null, giri: [] }; // copia dei nostri giri (solo box)
let passoSalvaTimer = null;

// ---------- formati ----------

function passoTempo(sec){
  if(sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}
function passoTempo3(sec){
  if(sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
}
function passoDelta(d){
  if(d == null || !isFinite(d)) return '';
  return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(2);
}
const PASSO_FRECCIA = { up: '▲', down: '▼', eq: '●' };

// "+1:02.3" / "-4.2" / "+0.000" -> secondi; altro ("1 giro") -> null
function passoSecDaGap(txt){
  const m = /^[+\-−]?\s*(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(txt == null ? '' : txt).trim());
  if(!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

// ---------- tessere (ultimi 10/20/30 e totale) ----------

function passoRiempiTessere(prefisso, m){
  [['10', m && m[10]], ['20', m && m[20]], ['30', m && m[30]], ['tot', m && m.tot]].forEach(([k, d]) => {
    const el = $(prefisso + k);
    if(!el) return;
    el.classList.remove('pt-up', 'pt-down', 'pt-eq');
    const b = el.querySelector('b'), dd = el.querySelector('.d');
    if(!d || d.avg == null){ b.textContent = '—'; dd.textContent = ''; return; }
    if(d.dir) el.classList.add('pt-' + d.dir);
    b.textContent = (d.dir ? PASSO_FRECCIA[d.dir] + ' ' : '') + passoTempo(d.avg);
    dd.textContent = d.delta != null ? passoDelta(d.delta) + ' s' : (d.n + ' giri');
  });
}

const PASSO_TR_TESTO = { up: 'in miglioramento', down: 'in peggioramento', eq: 'passo stabile' };
const PASSO_TR_BREVE = { up: '▲ migliora', down: '▼ peggiora', eq: '● stabile' };

// ---------- confronto con davanti e dietro ----------

// Chi sta davanti e dietro nella vista scelta (assoluta o categoria) e il loro distacco.
function passoRivali(){
  const t = (typeof lastTiming !== 'undefined') ? lastTiming : null;
  if(!t) return null;
  const cat = timingView === 'categoria' && t.catName;
  return {
    ahead: { numero: cat ? t.catNumberAhead : t.numberAhead, gap: passoSecDaGap(cat ? t.catGapAhead : t.gapAhead) },
    behind: { numero: cat ? t.catNumberBehind : t.numberBehind, gap: passoSecDaGap(cat ? t.catGapBehind : t.gapBehind) },
  };
}

// Testo del confronto: { testo, tono } con tono 'buono' | 'cattivo' | ''.
function passoConfronto(lato){
  const r = passoRivali();
  if(!r || !passoRis || !passoRis.mio) return { testo: '', tono: '' };
  const mio = passoRis.mio.m && passoRis.mio.m[10] ? passoRis.mio.m[10].avg : null;
  const riv = r[lato].numero ? passoRis.auto[String(r[lato].numero)] : null;
  if(mio == null || !riv || riv.m10 == null) return { testo: '', tono: '' };
  // chiusura: positiva se il distacco si riduce (davanti) o ti raggiungono (dietro)
  const chiusura = lato === 'ahead' ? riv.m10 - mio : mio - riv.m10;
  const gap = r[lato].gap;
  if(Math.abs(chiusura) < 0.05) return { testo: 'passo uguale', tono: '' };
  const abs = Math.abs(chiusura).toFixed(1) + ' s/giro';
  if(lato === 'ahead'){
    if(chiusura > 0){
      const giri = gap != null && gap > 0 ? Math.ceil(gap / chiusura) : null;
      return { testo: 'recuperi ' + abs + (giri != null ? ' · preso in ' + (giri > 99 ? '99+' : giri) + ' giri' : ''), tono: 'buono' };
    }
    return { testo: 'perdi ' + abs, tono: 'cattivo' };
  }
  if(chiusura > 0){
    const giri = gap != null && gap > 0 ? Math.ceil(gap / chiusura) : null;
    return { testo: 'ti prende ' + abs + (giri != null ? ' · fra ' + (giri > 99 ? '99+' : giri) + ' giri' : ''), tono: 'cattivo' };
  }
  return { testo: 'ti allontani ' + abs, tono: 'buono' };
}

function passoRenderConfronti(){
  [['ahead', 'projAhead'], ['behind', 'projBehind']].forEach(([lato, id]) => {
    const el = $(id);
    if(!el) return;
    const c = passoConfronto(lato);
    el.textContent = c.testo;
    el.classList.toggle('p-buono', c.tono === 'buono');
    el.classList.toggle('p-cattivo', c.tono === 'cattivo');
  });
}

// ---------- disegno ----------

function passoRender(){
  const r = passoRis;
  const mio = r && r.mio;
  // auto (versione tablet)
  if($('passoHead')){
    $('passoHead').textContent = mio
      ? 'best ' + passoTempo(mio.best) + ' · giro ' + (mio.giri ?? '—') + ' · ult. ' + passoTempo(mio.ultimo)
      : 'in attesa dei giri…';
    $('passoTr').textContent = mio && mio.tr ? PASSO_TR_BREVE[mio.tr] : '';
    $('passoTr').style.color = mio && mio.tr === 'up' ? 'var(--green)' : mio && mio.tr === 'down' ? 'var(--red)' : 'var(--muted)';
  }
  passoRiempiTessere('pa', mio && mio.m);
  passoRenderConfronti();
  if(role === 'box') passoRenderBox();
}

function passoRenderBox(){
  const r = passoRis, mio = r && r.mio;
  if(!$('passoBoxHead')) return;
  $('passoBoxHead').textContent = mio
    ? '#' + r.numero + ' · giro ' + (mio.giri ?? '—') + ' · best ' + passoTempo3(mio.best) + (mio.bestN ? ' (giro ' + mio.bestN + ')' : '') + ' · ult. ' + passoTempo3(mio.ultimo)
    : 'In attesa dei giri…';
  $('passoBoxTr').textContent = mio && mio.tr ? 'Trend: ' + PASSO_TR_TESTO[mio.tr] : '';
  passoRiempiTessere('pb', mio && mio.m);

  const c1 = passoConfronto('ahead'), c2 = passoConfronto('behind');
  const rv = passoRivali();
  const riga = (et, lato, c) => {
    const n = rv && rv[lato].numero ? '#' + rv[lato].numero : '—';
    return et + ' ' + n + ': ' + (c.testo || 'dati non ancora sufficienti');
  };
  $('passoCmpBox').textContent = '';
  [riga('Davanti', 'ahead', c1), riga('Dietro', 'behind', c2)].forEach((t) => {
    const d = document.createElement('div'); d.textContent = t; $('passoCmpBox').appendChild(d);
  });

  const el = $('passoGiriBox');
  el.textContent = '';
  const ultimi = passoLocale.giri.slice(-24).reverse();
  if(!ultimi.length) el.textContent = '—';
  ultimi.forEach((g) => {
    const s = document.createElement('span');
    s.textContent = g.n + ' · ' + passoTempo(g.t);
    if(!g.v) s.className = 'nv';
    el.appendChild(s);
  });

  // tabella di tutte le vetture, dalla piu' veloce
  const tab = $('passoTabellaBox');
  const auto = r ? r.auto : {};
  const righe = Object.keys(auto).map((n) => ({ ...auto[n], num: n }));
  if(mio) righe.push({ num: r.numero, b: mio.best, g: mio.giri, m10: mio.m && mio.m[10] ? mio.m[10].avg : null, tr: mio.tr, mia: true });
  righe.sort((a, b) => (a.b ?? 1e9) - (b.b ?? 1e9));
  if(!righe.length){ tab.textContent = '—'; }
  else {
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>#</th><th>best</th><th>ult.10</th><th>trend</th><th>giri</th></tr></thead>';
    const tb = document.createElement('tbody');
    righe.forEach((x) => {
      const tr = document.createElement('tr');
      if(x.mia) tr.className = 'mia';
      const cells = [x.num, passoTempo3(x.b), passoTempo(x.m10), null, x.g ?? '—'];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        if(i === 3){ td.textContent = x.tr ? PASSO_FRECCIA[x.tr] : '·'; if(x.tr) td.className = x.tr; }
        else td.textContent = v;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    tab.textContent = '';
    tab.appendChild(t);
  }
  if($('passoStoricoInfo')){
    $('passoStoricoInfo').textContent = passoLocale.giri.length
      ? passoLocale.giri.length + ' giri tenuti su questo telefono e sul server'
      : 'Nessun giro registrato.';
  }
}

// ---------- copia locale (box) ----------

function passoCaricaLocale(){
  const s = load(PASSO_KEY, null);
  if(s && s.code === code && Array.isArray(s.giri) && (Date.now() - (s.at || 0)) < PASSO_MAX_ETA_MS){
    passoLocale = { numero: s.numero || null, giri: s.giri };
  } else {
    passoLocale = { numero: null, giri: [] };
  }
}

function passoSalvaLocale(){
  clearTimeout(passoSalvaTimer);
  passoSalvaTimer = setTimeout(() => {
    try{ save(PASSO_KEY, { code, numero: passoLocale.numero, giri: passoLocale.giri, at: Date.now() }); }catch(e){}
  }, 1500);
}

// Unisce dei giri alla copia (per numero di giro), li ordina e pota.
function passoUnisci(giri){
  if(!Array.isArray(giri) || !giri.length) return false;
  const per = new Map(passoLocale.giri.map((g) => [g.n, g]));
  let nuovi = false;
  giri.forEach((g) => { if(g && !per.has(g.n)){ per.set(g.n, g); nuovi = true; } });
  if(!nuovi) return false;
  let tutti = [...per.values()].sort((a, b) => a.n - b.n);
  const ora = Date.now();
  tutti = tutti.filter((g) => ora - g.ts < PASSO_MAX_ETA_MS);
  if(tutti.length > PASSO_MAX_GIRI) tutti = tutti.slice(-PASSO_MAX_GIRI);
  passoLocale.giri = tutti;
  return true;
}

function passoRicevi(r){
  if(!r) return;
  passoRis = r;
  if(role === 'box'){
    if(r.numero && passoLocale.numero && String(r.numero) !== String(passoLocale.numero)){
      passoLocale = { numero: r.numero, giri: [] }; // altra vettura: copia nuova
    }
    if(r.numero) passoLocale.numero = r.numero;
    if(passoUnisci(r.nuovi)) passoSalvaLocale();
  }
  passoRender();
}

// A ogni (ri)collegamento: si chiede il riepilogo e, sul box, si uniscono le due copie.
function passoAlCollegamento(){
  if(!socket) return;
  if(role === 'box') passoCaricaLocale();
  socket.emit('passoRequest', (res) => {
    if(!res || !res.ok) return;
    passoRis = res.riepilogo;
    if(role === 'box'){
      const st = res.storico || {};
      if(st.numero && passoLocale.numero && String(st.numero) !== String(passoLocale.numero)){
        passoLocale = { numero: st.numero, giri: [] };
      }
      if(st.numero) passoLocale.numero = st.numero;
      const serverHa = new Set((st.giri || []).map((g) => g.n));
      const manca = passoLocale.giri.some((g) => !serverHa.has(g.n));
      if(passoUnisci(st.giri)) passoSalvaLocale();
      // Il server ha meno di quello che si ricorda questo telefono (per esempio e' ripartito).
      if(manca && passoLocale.numero){
        socket.emit('passoRestore', { numero: passoLocale.numero, giri: passoLocale.giri }, () => {});
      }
    }
    passoRender();
  });
}

function passoAzzera(){
  if(!confirm('Azzerare lo storico dei giri?')) return;
  passoLocale = { numero: passoLocale.numero, giri: [] };
  try{ localStorage.removeItem(PASSO_KEY); }catch(e){}
  if(socket && socket.connected) socket.emit('passoAzzera');
  passoRender();
}
