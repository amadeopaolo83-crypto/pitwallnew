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
   | `AUB_URL`, `AUB_USER`, `AUB_PASS` | copiati dal vecchio servizio Render |
   | `BRIDGE_URL`, `BRIDGE_TOKEN` | indirizzo del ponte e parola d'ordine (vedi il README del ponte) |

   Senza chiavi il server parte lo stesso, ma le notifiche restano spente.
4. **Create Web Service** e attendi la fine della pubblicazione.
5. Apri `https://nome.onrender.com`: deve comparire la schermata del codice team.
   Nell'app non c'è nessun indirizzo da impostare.

Le chiavi vanno **solo su Render**, mai nel repository.

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

**Da verificare alla prima gara.** Il calcolo è stato provato su qualifiche di
motocross. Per qualifiche e prove il distacco è la differenza fra i migliori giri;
in gara usa l'intervallo che il sito calcola già. In gara controlla subito che
posizione e vetture davanti e dietro abbiano senso, e se qualcosa non torna passa a
**Manuali** e segnalalo.

---

## 7. Aggiornare l'app

Ogni modifica a un file su GitHub fa ripubblicare Render in automatico. Non farlo
durante una gara: il riavvio azzera lo stato (poi i telefoni lo ripristinano).

---

## 8. Se qualcosa non va

| Problema | Cosa controllare |
|---|---|
| Pagina bianca 30-60 s | Il server si stava svegliando: attendi. |
| "Impossibile raggiungere il server" | Il servizio su Render deve essere *Live*. |
| Notifiche non attive | Le due chiavi su Render e il permesso notifiche del telefono. |
| Distacchi AUB in errore | `AUB_URL`, `AUB_USER`, `AUB_PASS` su Render, poi **Collega**. Oppure prova **Nostro**. |
| "Nostro": il ponte non è configurato | Mancano `BRIDGE_URL` e `BRIDGE_TOKEN` sul server di questa app. |
| "Nostro": il ponte rifiuta la parola d'ordine | `BRIDGE_TOKEN` diverso fra app e ponte: devono coincidere. |
| "Nostro": il ponte non risponde | Il ponte si sta svegliando (fino a un minuto) o è spento: controlla su Render. |
| "Nostro": nessun traduttore per questo sito | Il fornitore non è ancora supportato dal ponte: serve aggiornare il ponte. |
| "Nostro": evento non ancora pubblicato | L'evento non è ancora in elenco: resta in attesa e si collega da solo. |
| Pagina non trovata | Controlla i nomi delle cartelle: `src`, `public`, `public/js`, `public/css`, `public/icons`. |
