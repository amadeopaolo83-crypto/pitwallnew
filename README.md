# PitComm

Comunicazione **box ↔ auto** per gare endurance. Un solo server (Node.js) serve
l'app web e la comunicazione in tempo reale: un indirizzo solo per tutti.

- **Box**: carburante e autonomia, messaggi a schermo intero, pulsanti rapidi, distacchi.
- **Auto**: schermo sempre acceso in orizzontale con carburante, distacchi e 4 pulsanti.
- **Gara**: *Avvio gara* / *Fine gara* tengono sveglio il server solo quando serve.
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

## 6. Aggiornare l'app

Ogni modifica a un file su GitHub fa ripubblicare Render in automatico. Non farlo
durante una gara: il riavvio azzera lo stato (poi i telefoni lo ripristinano).

---

## 7. Se qualcosa non va

| Problema | Cosa controllare |
|---|---|
| Pagina bianca 30-60 s | Il server si stava svegliando: attendi. |
| "Impossibile raggiungere il server" | Il servizio su Render deve essere *Live*. |
| Notifiche non attive | Le due chiavi su Render e il permesso notifiche del telefono. |
| Distacchi in errore | `AUB_URL`, `AUB_USER`, `AUB_PASS` su Render, poi **Collega**. |
| Pagina non trovata | Controlla i nomi delle cartelle: `src`, `public`, `public/js`, `public/css`, `public/icons`. |
