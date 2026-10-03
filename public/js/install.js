// Installazione dell'app sul telefono (PWA): icona nella schermata Home e
// apertura a tutto schermo, senza barra del browser.
//
// Su Android/Chrome il browser offre l'installazione diretta; su iPhone e
// altri browser non c'e' un pulsante "vero", quindi si mostrano i passaggi.

let installPrompt = null;

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
}

function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function hideInstall(){
  if($('btnInstall')) $('btnInstall').hidden = true;
  if($('installHelp')) $('installHelp').hidden = true;
}

// Il browser avvisa che l'app e' installabile: teniamo l'evento per usarlo al tocco.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  hideInstall();
});

window.addEventListener('load', () => {
  // Gia' installata e aperta come app: il pulsante non serve.
  if(isStandalone()) hideInstall();
  else if($('btnInstall')) $('btnInstall').hidden = false;
});

async function installApp(){
  if(installPrompt){
    installPrompt.prompt();
    try{ await installPrompt.userChoice; }catch(e){}
    installPrompt = null;
    return;
  }
  // Nessuna installazione diretta disponibile: si spiegano i passaggi.
  const help = $('installHelp');
  if(!help) return;
  help.textContent = isIOS()
    ? 'Su iPhone/iPad apri la pagina con Safari, tocca il tasto Condividi (il quadrato con la freccia) e scegli "Aggiungi alla schermata Home".'
    : 'Apri il menu del browser (i tre puntini) e scegli "Installa app" oppure "Aggiungi a schermata Home".';
  help.hidden = !help.hidden;
}
