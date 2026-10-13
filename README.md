# PitComm

Comunicazione **box ↔ auto** per gare endurance. Un solo server (Node.js) serve
l'app web e la comunicazione in tempo reale: un indirizzo solo per tutti.

- **Box**: carburante e autonomia, messaggi a schermo intero, pulsanti rapidi, distacchi.
- **Auto**: schermo sempre acceso in orizzontale con carburante, distacchi e 4 pulsanti.
- **Gara**: *Avvio gara* / *Fine gara* tengono sveglio il server solo quando serve.
- **Distacchi** da tre fonti: dalla classifica **AUB**, dal **nostro ponte** (PitPonte), o a mano.
- **App installabile** sul telefono, con icona nella schermata Home.

---

## 1. Struttura delle cartelle

```
pitcomm/
├── package.json            dipendenze e comando di avvio
├── README.md               questo file
├── src/                    il server (non raggiungibile da fuori)
│   ├── server.js           punto di avvio
│   ├── config.js           variabili d'ambiente
│   ├── static.js           serve la cartella public/
│   ├── rooms.js            stato di ogni team in memoria
│   ├── sockets.js          messaggi tra box e auto
│   ├── push.js             notifiche push al box
│   ├── aub.js              collegamento alla classifica AUBServer
│   ├── ponte.js            distacchi letti dal nostro ponte (PitPonte)
│   └── keepalive.js        tiene sveglio il server durante la gara
└── public/                 l'app che si apre sul telefono
    ├── index.html
    ├── manifest.json       dati per installare l'app
    ├── sw.js               service worker (installazione e notifiche)
    ├── css/
    │   └── style.css
    ├── icons/              icone dell'app
    │   ├── icon-192.png
    │   ├── icon-512.png
    │   ├── icon-maskable-512.png
    │   └── apple-touch-icon.png
    └── js/
        ├── core.js         valori e funzioni condivise (caricato per primo)
        ├── push.js         iscrizione alle notifiche
        ├── connection.js   ingresso nella stanza e recupero valori
        ├── autoview.js     schermo dell'auto
        ├── fuel.js         carburante e consumo
        ├── boxview.js      pannello del box
        ├── timing.js       distacchi (classifica / manuali)
        ├── race.js         Avvio gara / Fine gara
        ├── install.js      pulsante "Installa l'app"
        └── app.js          avvio e riconnessione (caricato per ultimo)
```

Le cartelle `src/` e `public/` devono avere **esattamente** questi nomi e stare
nella radice del repository, accanto a `package.json`. Attenzione: ci sono due
file `push.js`, uno per il server (`src/`) e uno per l'app (`public/js/`).

---

## 2. Pubblicare su GitHub

1. Su github.com: **+ → New repository**, dai un nome (es. `pitcomm`), scegli
   **Private** e crea il repository vuoto.
2. Carica il contenuto mantenendo le cartelle, con il metodo che ti riesce:
   - **Da computer**: trascina le cartelle `src` e `public` e i file della radice
     sulla pagina *Upload files*.
   - **Da telefono**: **Add file → Create new file**, scrivi nel nome il percorso
     completo (per esempio `public/js/fuel.js`: la barra crea la cartella da sola),
     incolla il contenuto del file e conferma. Le 4 icone si caricano con
     **Upload files** dentro `public/icons`.
3. In fondo premi **Commit changes**.

Controllo: nella radice del repository devi vedere `src`, `public`,
`package.json` e `README.md`.

---

## 3. Pubblicare il server su Render

1. Su render.com: **New + → Web Service**, collega GitHub e scegli il repository.
2. Compila: **Runtime** `Node`, **Build Command** `npm install`,
   **Start Command** `npm start`, **Branch** `main`, **Instance Type** `Free`
   (per le gare meglio un piano a pagamento).
3. In **Environment** aggiungi:

   | Variabile | Valore |
   |---|---|
   | `VAPID_PUBLIC_KEY` | dal file `chiavi-render-NON-CARICARE-SU-GITHUB.txt` |
   | `VAPID_PRIVATE_KEY` | dal file `chiavi-render-NON-CARICARE-SU-GITHUB.txt` |
   | `AUB_URL`, `AUB_USER`, `AUB_PASS` | il server classifica (vedi «Distacchi da AUB» qui sotto): `AUB_URL=https://racedata.ingangeloni.com`, `AUB_USER` una parola qualsiasi, `AUB_PASS` la chiave della squadra |
   | `BRIDGE_URL`, `BRIDGE_TOKEN` | indirizzo del ponte e parola d'ordine (vedi il README del ponte) |

   Senza chiavi il server parte lo stesso, ma le notifiche restano spente.
4. **Create Web Service** e attendi la fine della pubblicazione.
5. Apri `https://nome.onrender.com`: deve comparire la schermata del codice team.
   Nell'app non c'è nessun indirizzo da impostare.

Le chiavi vanno **solo su Render**, mai nel repository.


### Distacchi da AUB (server classifica)

Il collegamento lo apre il **server** di questa app, non i telefoni: il server
classifica non manda header CORS, `EventSource` non sa mandare l'header
`Authorization` e così la chiave sta in un posto solo. Il lavoro è di Claudio
Angeloni (`src/aub.js` e la struttura del progetto).

Il server classifica (racedata) riconosce la squadra con la **chiave della
squadra**, che l'admin genera nel FactoryPortal: *Squadre → Gare → Accesso ai dati
di gara (pitwall) → Nuova chiave*. La chiave si vede una sola volta.
Con quella chiave il server manda **solo la gara che la squadra sta correndo in
quel momento**: quale evento, quali sessioni e quale numero lo decide il portale.

Su Render, nel servizio di questa app (Environment):

```
AUB_URL=https://racedata.ingangeloni.com
AUB_USER=pit              # qualunque: conta solo la chiave (se manca si usa "pitcomm")
AUB_PASS=aubk_...         # la chiave della squadra
```

In alternativa, per una prova, indirizzo e chiave si possono scrivere nella tendina
**Chiave della squadra** della scheda **AUB** (Timing): la chiave passa dal browser.
**La chiave resta sul dispositivo**: dopo *Collega* viene ricordata nella memoria del
telefono/PC del box (`localStorage`, mai nel riepilogo condiviso né nello stato del
server) e riaprendo l'app la tendina è già compilata. Se il server si riavvia durante
la gara, il box rilancia da solo il collegamento con indirizzo, utente, numero e chiave
ricordati (entro 30 ore, solo se non era stato premuto *Scollega*). Il pulsante
*Dimentica la chiave su questo dispositivo* la cancella. Lato server, se arriva un
*Collega* con la chiave vuota si tiene l'ultima nota per quella squadra. Il posto più
sicuro e che non dipende da nessun dispositivo resta comunque `AUB_PASS` su Render.
Poi si scrive il **numero di gara della vettura** e si tocca *Collega*: il numero
sceglie solo fra le vetture della squadra iscritte alla gara in corso. Posizione,
distacchi e chi hai davanti e dietro (`#42 · NOME`) arrivano da soli sull'auto.
La riga di stato dice se è collegato, se non c'è una gara aperta, se i dati non sono
aggiornati, la bandiera e gli errori della chiave.

**Diagnosi:** `https://<il-tuo-server>/api/aub-diagnosi?code=CODICE` mostra i dati grezzi dell'ultimo
aggiornamento di Aub (tutte le righe, `gap` e `diff` come arrivano), quale campo è stato letto come
intervallo e i distacchi calcolati per l'auto, tutto nello stesso istante. Serve il codice della stanza.

Il server legge la **classifica intera** (`/stream`, senza numero) e calcola da solo
sia l'assoluta sia la categoria (`src/aubclassifica.js`, con lo stesso calcolo del
ponte). Se il numero scritto nel box non è fra le righe, usa la vettura che Aub segna
come `myself`; la riga di stato dice «vettura N non in classifica» se non trova né
l'uno né l'altra. Con più vetture della squadra vale il numero scelto nel box.

### Timer automatico (fasi di gara di Aub)

Aub trasmette anche le fasi della gara con gli orari (PIT, RACE, PAUSE, END). Nel
Timing, card **Timer gara**, il selettore **Manuale | Automatico (Aub)** sceglie da
dove arrivano partenza e tempo gara. Il manuale resta com'è. In automatico:

- il conto alla rovescia di partenza arriva all'inizio della prima fase **RACE**;
- il tempo gara è la somma delle fasi RACE ancora da correre: durante **PAUSE** (o
  fra due RACE) è fermo e poi riparte dal valore fermo;
- lampeggio degli ultimi secondi, «VIA!» e foto finale funzionano come nel manuale,
  perché usano lo stesso stato del timer;
- la **bandiera a scacchi** di Aub fa partire il Finish solo con Finish *Automatico*
  e solo nell'ultima parte della gara (ultimi 10 minuti), così non scatta per errore;
- avvia, pausa, durate, velocità di test e salti sono fermi; **Azzera** torna al
  manuale; «Reset completo» (anche la X sul Finish) riallinea agli orari di Aub;
- se il collegamento cade i telefoni continuano a contare giusto da soli (orari
  assoluti); se il server riparte, il box ripristina da solo l'automatico;
- la card mostra una **riga di controllo** con le fasi lette, per esempio
  «Aub: RACE 09:00→15:00 (fuso Europe/Rome)», e il problema se c'è.

Serve la chiave con l'ambito **programma** (oltre a `classifica`). Gli orari di Aub
sono «ora locale del circuito» senza fuso: su Render si può impostare `AUB_TZ`
(predefinito `Europe/Rome`) se la gara è in un altro fuso.

---

## 4. Installare l'app sul telefono

- **Android (Chrome):** nella schermata iniziale premi **Installa l'app sul
  telefono**, oppure menu ⋮ → *Installa app*.
- **iPhone (Safari):** **Condividi** → **Aggiungi alla schermata Home**. Le
  notifiche su iPhone funzionano solo con l'app aggiunta alla Home.

---

## 5. In gara

1. Tutti inseriscono lo stesso codice team; l'auto sceglie **Auto**, il box **Box**.
2. Qualche minuto prima apri l'app (il server può impiegare 30-60 secondi a
   svegliarsi) e premi **Avvio gara**: il server si tiene sveglio da solo. A fine
   gara premi **Fine gara**, altrimenti la gara si chiude da sola dopo 26 ore.
3. **In pista / Ai box** si accendono per mostrare lo stato attuale.
4. Se il server si riavvia, i telefoni rimandano capienza, consumo, litri, pulsanti
   e gara avviata (valgono per lo stesso codice team, fino a 30 ore). Resta da
   ripremere **Collega** nei distacchi.

Sul piano gratuito di Render il servizio si spegne dopo ~15 minuti senza traffico:
con **Avvio gara** non succede, ma non protegge da un riavvio deciso da Render o da
una nuova pubblicazione.

---

## 6. Distacchi: le tre modalità

Nella scheda **Distacchi** del box ci sono tre pulsanti. Passando da uno all'altro
il collegamento precedente si stacca da solo.

- **AUB**: come prima, passa dal server AUB.
- **Nostro**: legge i distacchi dal nostro **ponte** (PitPonte), un secondo servizio
  che sa leggere i siti di live timing (oggi FICR) senza passare da AUB.
- **Manuali**: li scrivi tu.

### Usare "Nostro"

1. Apri la pagina dell'evento sul live timing e copia il suo indirizzo, per esempio
   `https://www.livetiming.ficr.it/cronoferrara/`.
2. Nell'app: **Distacchi → Nostro**, incolla l'indirizzo, scrivi il **numero di gara**
   della vettura e premi **Collega**.
3. Lo stato dice cosa succede: *evento non ancora pubblicato* (resta in attesa e
   riprova da solo), *in attesa di dati*, *in ascolto*, *vettura N non in
   classifica*, oppure un errore (per esempio *nessun traduttore per questo sito*).

Se un fornitore è nuovo o cambia, si aggiorna **solo il ponte**: questa app resta
accesa e, appena il ponte è pronto, la lettura riparte da sola. Se il server di
questa app si riavvia, la lettura riparte da sola.

Per usarlo servono sul server le variabili `BRIDGE_URL` e `BRIDGE_TOKEN`: senza,
il pulsante *Nostro* risponde che il ponte non è configurato.

### Assoluta o categoria

Sotto i tre pulsanti della fonte c'è la scelta **Sull'auto mostra: Assoluta / Categoria**.
La fa il box e vale per tutti i telefoni della squadra.

- **Assoluta**: posizione, davanti e dietro in classifica generale. Sotto la posizione
  l'auto scrive la tua categoria e la tua posizione fra pari (per esempio `GOLD 1°`).
- **Categoria**: posizione, davanti e dietro **solo fra i piloti della tua categoria**
  (la scritta gialla sotto il nome sul sito). Sotto la posizione compare anche quella
  assoluta (`GOLD · ass. 5°`).

La categoria la conoscono *Nostro* e *AUB* (dal campo `category` della classifica).
Con Manuali l'auto resta sull'assoluta anche se è scelta *Categoria*. Dopo un riavvio del server la scelta torna su *Assoluta*.

Nei distacchi di categoria, in qualifica si usa la differenza di miglior giro; in gara,
con gli stessi giri, la differenza dei tempi totali; se i giri sono diversi la somma
degli intervalli del sito, e per i doppiati i giri di differenza (`1 giro`).
Con AUB l'intervallo è il campo `diff` (da chi sta davanti) e i giri di ritardo sono
letti dal testo del distacco (`+1 lap`).

**Da verificare alla prima gara.** Il calcolo è stato provato su qualifiche di
motocross. Per qualifiche e prove il distacco è la differenza fra i migliori giri;
in gara usa l'intervallo che il sito calcola già. In gara controlla subito che
posizione e vetture davanti e dietro abbiano senso, e se qualcosa non torna passa a
**Manuali** e segnalalo.

---

## 7. Aggiornare l'app

Ogni modifica a un file su GitHub fa ripubblicare Render in automatico.

**Dopo un aggiornamento dei file in `public/js` o `public/css`** cambia il numero
`?v=3` nei collegamenti di `public/index.html` (per esempio `?v=4`): i telefoni tengono
in memoria questi file fino a un'ora, e col numero nuovo li scaricano subito. Non farlo
durante una gara: il riavvio azzera lo stato (poi i telefoni lo ripristinano).

---

## 8. Se qualcosa non va

| Problema | Cosa controllare |
|---|---|
| Pagina bianca 30-60 s | Il server si stava svegliando: attendi. |
| "Impossibile raggiungere il server" | Il servizio su Render deve essere *Live*. |
| Notifiche non attive | Le due chiavi su Render e il permesso notifiche del telefono. |
| Timer automatico: «ambito programma» | La chiave non ha l'ambito `programma`: l'admin deve spuntarlo. «Nessuna fase di gara»: Aub non ha fasi per questa gara. Orari sfasati di un'ora: imposta `AUB_TZ`. |
| Distacchi AUB in errore | `AUB_URL` e `AUB_PASS` (la chiave) su Render, poi **Collega**. «Chiave non valida o revocata»: ne serve una nuova. «Non condivide la classifica»: l'admin deve spuntare l'ambito. «Nessuna gara aperta ora»: è normale fuori dalla finestra della gara. Oppure prova **Nostro**. |
| "Nostro": il ponte non è configurato | Mancano `BRIDGE_URL` e `BRIDGE_TOKEN` sul server di questa app. |
| "Nostro": il ponte rifiuta la parola d'ordine | `BRIDGE_TOKEN` diverso fra app e ponte: devono coincidere. |
| "Nostro": il ponte non risponde | Il ponte si sta svegliando (fino a un minuto) o è spento: controlla su Render. |
| "Nostro": nessun traduttore per questo sito | Il fornitore non è ancora supportato dal ponte: serve aggiornare il ponte. |
| "Nostro": evento non ancora pubblicato | L'evento non è ancora in elenco: resta in attesa e si collega da solo. |
| Pagina non trovata | Controlla i nomi delle cartelle: `src`, `public`, `public/js`, `public/css`, `public/icons`. |
