// PitComm - server di comunicazione box <-> auto per gare endurance
// Ogni "team" è una stanza Socket.io identificata dal codice inserito nell'app.
// Il server è deliberatamente semplice e stateless-per-riavvio: tiene solo
// in memoria l'ultimo stato utile (config pulsanti, consumo, ecc.) così un
// dispositivo che si riconnette a metà gara riceve subito lo stato corrente.

const { Server } = require("socket.io");
const http = require("http");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const PORT = process.env.PORT || 3000;

// Chiavi VAPID per le notifiche push: impostale come variabili d'ambiente
// su Render (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). Il fallback qui sotto
// funziona subito ma è meglio spostarlo su env var in produzione.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BDL1U-RB9YWSWMNoB6_u7gjFrMAlIYkD4hkDFt_ZaauQw8k3OVCTYxfzsHaFSNDaDOSRPxToO3Va4lWbCzNK00M";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "1Gzw3jN-k4GS-SYzXWiJqvGH5j4cie9-gVBjvOIL7tI";
webpush.setVapidDetails("mailto:pitcomm@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Se questo servizio deve servire anche il client (index.html) oltre al
// backend Socket.io, cerchiamo una cartella "public" o "client" accanto a
// questo file (in diverse posizioni possibili, a seconda di come è
// organizzato il repository) e, se la troviamo, la serviamo come sito statico.
const STATIC_CANDIDATES = [
  path.join(__dirname, "public"),
  path.join(__dirname, "client"),
  path.join(__dirname, "..", "public"),
  path.join(__dirname, "..", "client"),
];
const STATIC_DIR = STATIC_CANDIDATES.find((p) => {
  try { return fs.existsSync(path.join(p, "index.html")); } catch (e) { return false; }
});
if (STATIC_DIR) {
  console.log("Client statico servito da:", STATIC_DIR);
} else {
  console.log("Nessuna cartella public/client con index.html trovata accanto al server: risponderà solo con testo semplice su /.");
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const httpServer = http.createServer((req, res) => {
  if (req.url === "/vapid-public-key") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(VAPID_PUBLIC_KEY);
  }

  if (STATIC_DIR) {
    let urlPath = req.url.split("?")[0];
    if (urlPath === "/") urlPath = "/index.html";
    const filePath = path.join(STATIC_DIR, decodeURIComponent(urlPath));
    // evita di uscire dalla cartella statica (sicurezza path traversal)
    if (filePath.startsWith(STATIC_DIR) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      return fs.createReadStream(filePath).pipe(res);
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("PitComm server attivo\n");
});

const io = new Server(httpServer, {
  cors: { origin: "*" }, // in produzione: restringere all'origine del client
});

// Stato in memoria per ogni codice team: { fuel, autonomyMinutes, dayMode,
// quickButtons, timing, lastFlash }
const rooms = new Map();

function getRoomState(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      fuel: { percent: 100, updatedAt: Date.now() },
      autonomyMinutes: 60,
      dayMode: true,
      quickButtons: [
        { id: 1, label: "Box", color: "#3fa9f5" },
        { id: 2, label: "Rifornimento", color: "#f5a623" },
        { id: 3, label: "Pilota", color: "#7ed321" },
        { id: 4, label: "Ripeti", color: "#bd10e0" },
      ],
      timing: null, // { position, gapAhead, gapBehind, updatedAt }
      lastFlash: null,
      pushSubscriptions: [],
      fuelSystem: {
        tankCapacityLiters: 100,
        currentLiters: 100,
        consumptionRatePerHour: null,
        onTrack: false,
        sessionStartAt: null,
        sessionStartLiters: 0,
      },
      // Doppio timer: "partenza" (countdown fino al via) e "gara" (countdown
      // della durata di gara, che scatta in automatico a fine countdown di
      // partenza). Nessun ticking lato server: ogni client calcola il tempo
      // rimanente da remaining/updatedAt/running/speed, così tutti i
      // dispositivi restano sincronizzati senza bisogno di un loop server.
      timer: {
        phase: "start", // "start" | "race" | "finished"
        startSeconds: 900,
        startRemaining: 900,
        startRunning: false,
        startUpdatedAt: Date.now(),
        raceSeconds: 28800,
        raceRemaining: 28800,
        raceRunning: false,
        raceUpdatedAt: Date.now(),
        speed: 1, // moltiplicatore di velocità per i test (1 = tempo reale)
        finishMode: "manual", // "manual" | "auto"
        finishBackground: "photo", // "photo" | "dark"
        finishTriggered: false,
        finishPosition: null,
        finishDriverName: "",
      },
    });
  }
  return rooms.get(code);
}

// Tempo rimanente "vero" in questo istante, dato l'ultimo valore salvato
// (baseRemaining), il momento in cui è stato salvato (updatedAt), se il
// timer sta scorrendo e a che velocità (1 = normale, usato per i test).
function currentRemaining(baseRemaining, updatedAt, running, speed) {
  if (!running) return baseRemaining;
  const elapsedSeconds = ((Date.now() - updatedAt) / 1000) * (speed || 1);
  return Math.max(0, baseRemaining - elapsedSeconds);
}

function notifyBoxDevices(code, label) {
  const state = getRoomState(code);
  const payload = JSON.stringify({
    title: "Messaggio dall'auto",
    body: label,
  });
  state.pushSubscriptions = state.pushSubscriptions.filter((sub) => {
    webpush.sendNotification(sub, payload).catch((err) => {
      // 404/410 = sottoscrizione non più valida (browser disinstallato, permesso revocato, ecc.)
      if (err.statusCode === 404 || err.statusCode === 410) return false;
    });
    return true; // rimozione effettiva gestita al prossimo giro se serve
  });
}

io.on("connection", (socket) => {
  let joinedCode = null;
  let joinedRole = null; // "box" | "auto"

  socket.on("join", ({ code, role }, ack) => {
    if (!code || !role) return ack && ack({ ok: false, error: "codice o ruolo mancante" });
    joinedCode = String(code).trim().toUpperCase();
    joinedRole = role;
    socket.join(joinedCode);
    socket.data.role = role;

    const state = getRoomState(joinedCode);
    ack && ack({ ok: true, state });
  });

  // BOX -> server: registra la sottoscrizione push di questo dispositivo
  socket.on("registerPush", ({ subscription }) => {
    if (!joinedCode || !subscription) return;
    const state = getRoomState(joinedCode);
    const exists = state.pushSubscriptions.some((s) => s.endpoint === subscription.endpoint);
    if (!exists) state.pushSubscriptions.push(subscription);
  });

  // AUTO -> BOX: pressione di uno dei 4 pulsanti rapidi
  socket.on("quickMessage", ({ buttonId, label }) => {
    if (!joinedCode) return;
    io.to(joinedCode).emit("quickMessageReceived", {
      buttonId,
      label,
      at: Date.now(),
    });
    notifyBoxDevices(joinedCode, label);
  });

  // BOX -> AUTO: messaggio a comparsa (testo, colore, durata) + lettura vocale
  socket.on("flashMessage", ({ text, color, durationSeconds }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.lastFlash = { text, color, durationSeconds, at: Date.now() };
    io.to(joinedCode).emit("flashMessage", state.lastFlash);
  });

  // BOX -> tutti i box: sincronizza capienza, litri, consumo, stato in pista/ai box
  socket.on("fuelSystemUpdate", (fuelSystem) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.fuelSystem = fuelSystem;
    io.to(joinedCode).emit("fuelSystemUpdate", state.fuelSystem);
  });

  // BOX -> AUTO: aggiornamento consumo carburante (percentuale 0-100)
  socket.on("fuelUpdate", ({ percent }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.fuel = { percent, updatedAt: Date.now() };
    io.to(joinedCode).emit("fuelUpdate", state.fuel);
  });

  // BOX -> AUTO: tempo di autonomia stimato (per previsione sosta)
  socket.on("autonomyUpdate", ({ minutes }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.autonomyMinutes = minutes;
    io.to(joinedCode).emit("autonomyUpdate", { minutes });
  });

  // BOX -> AUTO: modalità giorno/notte
  socket.on("dayModeUpdate", ({ dayMode }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.dayMode = dayMode;
    io.to(joinedCode).emit("dayModeUpdate", { dayMode });
  });

  // BOX -> AUTO: configurazione dei 4 pulsanti rapidi (testo + colore)
  socket.on("quickButtonsUpdate", ({ buttons }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.quickButtons = buttons;
    io.to(joinedCode).emit("quickButtonsUpdate", { buttons });
  });

  // BOX -> AUTO: distacchi dal live timing (posizione, distacco davanti, distacco dietro)
  socket.on("timingUpdate", ({ position, gapAhead, gapBehind }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    state.timing = { position, gapAhead, gapBehind, updatedAt: Date.now() };
    io.to(joinedCode).emit("timingUpdate", state.timing);
  });

  // ----- TIMER DI PARTENZA (countdown verso il via) -----

  // BOX -> tutti: imposta la durata del countdown di partenza (solo da fermo)
  socket.on("timerStartSet", ({ seconds }) => {
    if (!joinedCode || !seconds) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (t.startRunning) return;
    t.startSeconds = seconds;
    t.startRemaining = seconds;
    t.startUpdatedAt = Date.now();
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // BOX -> tutti: start / pausa / stop del timer di partenza
  socket.on("timerStartControl", ({ action }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (t.phase !== "start") return;
    if (action === "start") {
      t.startRunning = true;
      t.startUpdatedAt = Date.now();
    } else if (action === "pause") {
      t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
      t.startRunning = false;
      t.startUpdatedAt = Date.now();
    } else if (action === "stop") {
      t.startRunning = false;
      t.startRemaining = t.startSeconds;
      t.startUpdatedAt = Date.now();
    }
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // ----- TIMER DI GARA (countdown della durata di gara, a scalare) -----

  // BOX -> tutti: imposta/modifica la durata di gara (tipicamente da fermo o
  // in pausa, es. dopo una bandiera rossa che accorcia la gara)
  socket.on("timerRaceSet", ({ seconds }) => {
    if (!joinedCode || !seconds) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (t.raceRunning) return;
    t.raceSeconds = seconds;
    t.raceRemaining = seconds;
    t.raceUpdatedAt = Date.now();
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // BOX -> tutti: start / pausa / stop del timer di gara
  socket.on("timerRaceControl", ({ action }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (t.phase !== "race") return;
    if (action === "start") {
      t.raceRunning = true;
      t.raceUpdatedAt = Date.now();
    } else if (action === "pause") {
      t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
      t.raceRunning = false;
      t.raceUpdatedAt = Date.now();
    } else if (action === "stop") {
      t.raceRunning = false;
      t.raceRemaining = t.raceSeconds;
      t.raceUpdatedAt = Date.now();
    }
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // Qualsiasi client (box o auto) segnala che il countdown di partenza è
  // arrivato a zero sul proprio orologio locale: il server applica la
  // transizione partenza -> gara in modo idempotente (le segnalazioni
  // ripetute da altri dispositivi nello stesso istante vengono ignorate).
  socket.on("raceTimerAutoStart", () => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (t.phase !== "start") return;
    t.phase = "race";
    t.startRunning = false;
    t.startRemaining = 0;
    t.raceRunning = true;
    t.raceRemaining = t.raceSeconds;
    t.raceUpdatedAt = Date.now();
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // BOX -> tutti: modalità test, velocità accelerata dei timer
  socket.on("timerTestSpeed", ({ speed }) => {
    if (!joinedCode || !speed) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    // congela i tempi correnti prima di cambiare velocità, per continuità
    t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
    t.startUpdatedAt = Date.now();
    t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
    t.raceUpdatedAt = Date.now();
    t.speed = speed;
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // BOX -> tutti: scorciatoie per saltare subito a un punto del flusso da testare
  socket.on("timerDebugJump", ({ preset }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    const now = Date.now();
    switch (preset) {
      case "start-30s":
        t.phase = "start"; t.startRemaining = 30; t.startRunning = true; t.startUpdatedAt = now;
        t.finishTriggered = false;
        break;
      case "start-near-zero":
        t.phase = "start"; t.startRemaining = 3; t.startRunning = true; t.startUpdatedAt = now;
        t.finishTriggered = false;
        break;
      case "race-last-hour":
        t.phase = "race"; t.raceRemaining = 3600; t.raceRunning = true; t.raceUpdatedAt = now;
        t.finishTriggered = false;
        break;
      case "race-last-15min":
        t.phase = "race"; t.raceRemaining = 900; t.raceRunning = true; t.raceUpdatedAt = now;
        t.finishTriggered = false;
        break;
      case "race-near-finish":
        t.phase = "race"; t.raceRemaining = 4; t.raceRunning = true; t.raceUpdatedAt = now;
        t.finishTriggered = false;
        break;
      case "reset":
        t.phase = "start";
        t.startRemaining = t.startSeconds; t.startRunning = false; t.startUpdatedAt = now;
        t.raceRemaining = t.raceSeconds; t.raceRunning = false; t.raceUpdatedAt = now;
        t.finishTriggered = false; t.finishPosition = null; t.finishDriverName = "";
        break;
      default:
        return;
    }
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // ----- FINISH -----

  // BOX -> tutti: configura modalità (auto/manuale), sfondo e nome pilota
  // senza far comparire subito la schermata (preparazione in anticipo)
  socket.on("finishConfigUpdate", ({ mode, background, driverName }) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    if (mode) t.finishMode = mode;
    if (background) t.finishBackground = background;
    if (driverName !== undefined) t.finishDriverName = driverName;
    io.to(joinedCode).emit("timerUpdate", t);
  });

  // BOX (o un client in automatico a fine timer gara) -> tutti: mostra il Finish
  socket.on("finishTrigger", ({ position, driverName } = {}) => {
    if (!joinedCode) return;
    const state = getRoomState(joinedCode);
    const t = state.timer;
    t.phase = "finished";
    t.finishTriggered = true;
    t.finishPosition = position != null ? position : (state.timing ? state.timing.position : null);
    if (driverName) t.finishDriverName = driverName;
    io.to(joinedCode).emit("timerUpdate", t);
  });

  socket.on("disconnect", () => {
    // nessuna pulizia particolare: lo stato della stanza resta per i reconnect
  });
});

httpServer.listen(PORT, () => {
  console.log(`PitComm server in ascolto sulla porta ${PORT}`);
});
