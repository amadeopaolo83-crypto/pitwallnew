// Fondamenta condivise da tutti gli altri script: scorciatoie, stato del
// client e valori di partenza. Va caricato per primo.

// L'app e il server escono dallo stesso indirizzo (quello di Render): il
// server di default e' quindi la pagina stessa, senza niente da configurare.
const DEFAULT_SERVER_URL = location.origin;

const $ = id => document.getElementById(id);

let socket, code, role;

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

function playAlertBeep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 350);
  }catch(e){}
}
