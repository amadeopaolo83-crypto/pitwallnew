// Fondamenta condivise da tutti gli altri script: scorciatoie, stato del
// client e valori di partenza. Va caricato per primo.

// L'app e il server escono dallo stesso indirizzo (quello di Render): il
// server di default e' quindi la pagina stessa, senza niente da configurare.
const DEFAULT_SERVER_URL = location.origin;

const $ = id => document.getElementById(id);

let socket, code, role;

// Differenza tra l'orologio del server e quello di questo telefono: i timer
// sono calcolati sul tempo del server (Date.now() da solo non basta se
// l'orologio del telefono e' sbagliato o va a un'ora diversa). Si aggiorna
// a ogni (ri)collegamento; nowSync() e' quello che il resto del codice usa
// al posto di Date.now() per tutto cio' che riguarda i timer.
let clockOffset = 0;
function nowSync(){ return Date.now() + clockOffset; }

function load(key, fallback){
  try{ const v = JSON.parse(localStorage.getItem(key)); return v || fallback; }catch(e){ return fallback; }
}

function save(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

const DEFAULT_QB = [
  {id:1,label:'Box',color:'#3fa9f5'},
  {id:2,label:'Rifornimento',color:'#f5a623'},
  {id:3,label:'Pilota',color:'#7ed321'},
  {id:4,label:'Ripeti',color:'#bd10e0'},
];

const DEFAULT_FLASH = [
  {text:'BOX QUESTO GIRO', color:'#F5C518', duration:8},
  {text:'PUSH', color:'#E63946', duration:6},
  {text:'TUTTO OK', color:'#3ECF6E', duration:6},
];

let quickButtons = load('pc_qb', DEFAULT_QB);

let flashPresets = load('pc_flash', DEFAULT_FLASH);

let fuelSystem = {
  tankCapacityLiters: 100,
  currentLiters: 100,
  consumptionRatePerHour: null,
  onTrack: false,
  sessionStartAt: null,
  sessionStartLiters: 0,
};

let fuelTickInterval = null;

// ---------- audio ----------
// Il browser fa partire l'audio solo dopo un tocco sulla pagina: si sblocca al primo
// tocco (qualunque) e poi resta pronto. Dopo aver ricaricato la pagina serve un tocco.

let audioCtx = null;

function getAudio(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch(e){ return null; }
}

['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { getAudio(); }, { passive: true }));

// Vibrazione "SOS" (tre corte, tre lunghe, tre corte): si riconosce al volo.
const SOS_VIBRATION = [300,100,300,100,300,200,600,100,600,100,600,200,300,100,300,100,300];

function loadSirenSettings(){
  const s = load('pc_siren', null);
  const vol = s && Number(s.volume) ? Number(s.volume) : 0.8;
  return { on: s ? s.on !== false : true, volume: Math.min(1, Math.max(0.2, vol)) };
}

function saveSirenSettings(s){ save('pc_siren', s); }

// Sirena: due toni che si alternano, circa tre secondi, con il volume scelto.
function playSiren(){
  const ctx = getAudio();
  if(!ctx) return;
  const vol = loadSirenSettings().volume;
  const durata = 3, passo = 0.35;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  for(let i = 0; i * passo < durata; i++) osc.frequency.setValueAtTime(i % 2 ? 720 : 960, t0 + i * passo);
  const picco = 0.35 * vol;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(picco, t0 + 0.05);
  gain.gain.setValueAtTime(picco, t0 + durata - 0.15);
  gain.gain.linearRampToValueAtTime(0.0001, t0 + durata);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durata + 0.05);
}

// Bip breve (usato quando la sirena e' spenta).
function playAlertBeep(){
  const ctx = getAudio();
  if(!ctx) return;
  try{
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); }, 350);
  }catch(e){}
}
