// Gli eventi socket.io: tutto quello che box e auto si dicono.
//
// Ogni "team" e' una stanza identificata dal codice inserito nell'app: chi
// conosce il codice entra, e ogni messaggio raggiunge solo quella stanza.

const { getRoomState } = require("./rooms");
const { notifyBoxDevices } = require("./push");
const aub = require("./aub");
const ponte = require("./ponte");
const keepalive = require("./keepalive");

// Tempo rimanente "vero" in questo istante, dato l'ultimo valore salvato
// (baseRemaining), il momento in cui e' stato salvato (updatedAt), se il
// timer sta scorrendo e a che velocita' (1 = normale, usato per i test).
function currentRemaining(baseRemaining, updatedAt, running, speed) {
  if (!running) return baseRemaining;
  const elapsedSeconds = ((Date.now() - updatedAt) / 1000) * (speed || 1);
  return Math.max(0, baseRemaining - elapsedSeconds);
}

function registra(io) {
  // Allo scadere del tempo massimo la gara si chiude da sola e lo dice a tutti.
  const fineAutomatica = (code) => {
    const state = getRoomState(code);
    state.race = { active: false, startedAt: null, endedBy: "timeout" };
    io.to(code).emit("raceStatus", state.race);
  };

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
      // serverNow: l'orologio del telefono puo' essere sbagliato o su un'altra
      // ora; i timer si calcolano sul tempo del server, non su quello del
      // dispositivo, cosi' restano giusti e uguali su tutti i telefoni.
      ack && ack({ ok: true, state, serverNow: Date.now() });
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
      const state = getRoomState(joinedCode);
      // Ogni messaggio ha un identificativo unico, cosi' chi lo riceve due volte
      // (dal vivo e poi dalla cronologia) lo mostra una volta sola.
      const msg = {
        id: Date.now().toString(36) + "-" + (++state.msgSeq),
        buttonId,
        label: String(label == null ? "" : label).slice(0, 200),
        at: Date.now(),
      };
      state.messages.push(msg);
      if (state.messages.length > 200) state.messages.splice(0, state.messages.length - 200);
      io.to(joinedCode).emit("quickMessageReceived", msg);
      notifyBoxDevices(joinedCode, msg.label);
    });

    // BOX: chiede i messaggi ricevuti (per esempio quando la pagina torna visibile).
    socket.on("historyRequest", (ack) => {
      if (!joinedCode || typeof ack !== "function") return;
      ack({ messages: getRoomState(joinedCode).messages });
    });

    // BOX: cancella la cronologia per tutti i telefoni della squadra.
    socket.on("historyClear", () => {
      if (!joinedCode) return;
      getRoomState(joinedCode).messages = [];
      io.to(joinedCode).emit("historyCleared");
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
      state.fresh.fuel = false;
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
      state.fresh.buttons = false;
      io.to(joinedCode).emit("quickButtonsUpdate", { buttons });
    });

    // BOX: avvio gara. Da qui il server si tiene sveglio (keep-alive) finche'
    // non arriva "fine gara" o scade il tempo massimo.
    socket.on("raceStart", () => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.fresh.race = false;
      if (state.race.active) return;
      state.race = { active: true, startedAt: Date.now() };
      keepalive.start(joinedCode, state.race.startedAt, fineAutomatica);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // BOX: fine gara. Il server puo' tornare a spegnersi da solo se inattivo.
    socket.on("raceStop", () => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.fresh.race = false;
      state.race = { active: false, startedAt: null };
      keepalive.stop(joinedCode);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // Dopo un riavvio del server un telefono che si ricordava una gara in corso
    // la rimette in piedi, con l'ora di partenza originale (e quindi lo stesso
    // limite massimo). Vale una volta sola, solo se il server e' ripartito da zero.
    socket.on("raceRestore", ({ startedAt } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      if (!state.fresh.race) return;
      state.fresh.race = false;
      const inizio = Number(startedAt);
      if (!inizio || Date.now() - inizio > keepalive.DURATA_MAX_MS) return;
      state.race = { active: true, startedAt: inizio };
      keepalive.start(joinedCode, inizio, fineAutomatica);
      io.to(joinedCode).emit("raceStatus", state.race);
    });

    // BOX -> AUTO: cosa mostrare sull'auto, classifica assoluta o di categoria
    socket.on("timingViewUpdate", ({ view } = {}) => {
      if (!joinedCode || (view !== "assoluta" && view !== "categoria")) return;
      getRoomState(joinedCode).timingView = view;
      io.to(joinedCode).emit("timingViewUpdate", { view });
    });

    // BOX -> AUTO: distacchi dal live timing (posizione, distacco davanti, distacco dietro)
    socket.on("timingUpdate", ({ position, gapAhead, gapBehind, nameAhead, nameBehind }) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      state.timing = { position, gapAhead, gapBehind, nameAhead, nameBehind, updatedAt: Date.now() };
      io.to(joinedCode).emit("timingUpdate", state.timing);
    });

    // BOX -> server: aggancia la classifica AUB al numero di gara della vettura.
    // url/user/pass sono facoltativi: se non arrivano si usano le variabili
    // d'ambiente del server, che e' il posto giusto dove tenerli.
    socket.on("aubConnect", ({ driverId, url, user, pass }, ack) => {
      if (!joinedCode) return ack && ack({ ok: false, error: "non sei in una stanza" });
      const numero = String(driverId || "").trim();
      if (!numero) return ack && ack({ ok: false, error: "numero di gara mancante" });
      const credenziali = (url || user || pass)
        ? { url: (url || "").trim(), user: (user || "").trim(), pass: pass || "" }
        : null;
      aub.start(joinedCode, numero, credenziali);
      ack && ack({ ok: true });
    });

    socket.on("aubDisconnect", () => {
      if (!joinedCode) return;
      aub.stop(joinedCode);
      aub.setStatus(joinedCode, {
        connected: false,
        driverId: null,
        status: "spento",
        error: null,
      });
    });

    // BOX -> server: legge i distacchi dal nostro ponte, che traduce i vari siti di
    // live timing. Servono l'indirizzo della pagina dell'evento e il numero della vettura.
    socket.on("ponteConnect", ({ url, number } = {}, ack) => {
      if (!joinedCode) return ack && ack({ ok: false, error: "non sei in una stanza" });
      const res = ponte.start(joinedCode, url, number);
      if (res.ok) getRoomState(joinedCode).fresh.ponte = false;
      ack && ack(res);
    });

    socket.on("ponteDisconnect", () => {
      if (!joinedCode) return;
      getRoomState(joinedCode).fresh.ponte = false;
      ponte.stop(joinedCode);
      ponte.setStatus(joinedCode, { connected: false, status: "spento", error: null, session: null, flag: null });
    });

    // ----- TIMER DI PARTENZA (countdown verso il via) -----

    // BOX -> tutti: imposta la durata del countdown di partenza (solo da fermo)
    socket.on("timerStartSet", ({ seconds } = {}) => {
      if (!joinedCode || !seconds) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.startRunning) return;
      t.startSeconds = seconds;
      t.startRemaining = seconds;
      t.startUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: start / pausa / azzera del timer di partenza
    socket.on("timerStartControl", ({ action } = {}) => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
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

    // ----- TIMER DI GARA (countdown della durata di gara) -----

    // BOX -> tutti: imposta/modifica la durata di gara (tipicamente da fermo o
    // in pausa, per esempio dopo una bandiera rossa che accorcia la gara)
    socket.on("timerRaceSet", ({ seconds } = {}) => {
      if (!joinedCode || !seconds) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.raceRunning) return;
      t.raceSeconds = seconds;
      t.raceRemaining = seconds;
      t.raceUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: start / pausa / azzera del timer di gara
    socket.on("timerRaceControl", ({ action } = {}) => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
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

    // Qualsiasi client (box o auto) segnala che il countdown di partenza e'
    // arrivato a zero sul proprio orologio locale: il server applica la
    // transizione partenza -> gara una volta sola (le segnalazioni ripetute
    // da altri dispositivi nello stesso istante vengono ignorate).
    socket.on("raceTimerAutoStart", () => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (t.phase !== "start") return;
      t.phase = "race";
      t.startRunning = false;
      t.startRemaining = 0;
      t.raceRunning = true;
      t.raceUpdatedAt = Date.now();
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: modalita' test, velocita' accelerata dei timer
    socket.on("timerTestSpeed", ({ speed } = {}) => {
      if (!joinedCode || !speed) return;
      const t = getRoomState(joinedCode).raceTimer;
      // congela i tempi correnti prima di cambiare velocita', per continuita'
      t.startRemaining = currentRemaining(t.startRemaining, t.startUpdatedAt, t.startRunning, t.speed);
      t.startUpdatedAt = Date.now();
      t.raceRemaining = currentRemaining(t.raceRemaining, t.raceUpdatedAt, t.raceRunning, t.speed);
      t.raceUpdatedAt = Date.now();
      t.speed = speed;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX -> tutti: scorciatoie per saltare subito a un punto del flusso da testare
    socket.on("timerDebugJump", ({ preset } = {}) => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
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
          // Un "reset completo" deve anche togliere la velocita' accelerata di
          // test: altrimenti resta a x60/x300 e il prossimo conto alla
          // rovescia scorre piu' in fretta di quanto i minuti/secondi dicano.
          t.speed = 1;
          break;
        default:
          return;
      }
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // ----- FINISH -----

    // BOX -> tutti: configura modalita' (manuale/auto), sfondo e nome pilota
    // senza far comparire subito la schermata (preparazione in anticipo)
    socket.on("finishConfigUpdate", ({ mode, background, driverName } = {}) => {
      if (!joinedCode) return;
      const t = getRoomState(joinedCode).raceTimer;
      if (mode) t.finishMode = mode;
      if (background) t.finishBackground = background;
      if (driverName !== undefined) t.finishDriverName = driverName;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    // BOX (o in automatico a fine timer gara) -> tutti: mostra il Finish
    socket.on("finishTrigger", ({ position, driverName } = {}) => {
      if (!joinedCode) return;
      const state = getRoomState(joinedCode);
      const t = state.raceTimer;
      t.phase = "finished";
      t.finishTriggered = true;
      t.finishPosition = position != null ? position : (state.timing ? state.timing.position : null);
      if (driverName) t.finishDriverName = driverName;
      io.to(joinedCode).emit("timerUpdate", t);
    });

    socket.on("disconnect", () => {
      // nessuna pulizia particolare: lo stato della stanza resta per i reconnect.
      // Anche il collegamento alla classifica resta aperto: serve alla squadra,
      // non al singolo telefono che si e' spento.
    });
  });
}

module.exports = { registra };
