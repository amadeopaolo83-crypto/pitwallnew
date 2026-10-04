// Gli eventi socket.io: tutto quello che box e auto si dicono.
//
// Ogni "team" e' una stanza identificata dal codice inserito nell'app: chi
// conosce il codice entra, e ogni messaggio raggiunge solo quella stanza.

const { getRoomState } = require("./rooms");
const { notifyBoxDevices } = require("./push");
const aub = require("./aub");
const ponte = require("./ponte");
const keepalive = require("./keepalive");

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

    socket.on("disconnect", () => {
      // nessuna pulizia particolare: lo stato della stanza resta per i reconnect.
      // Anche il collegamento alla classifica resta aperto: serve alla squadra,
      // non al singolo telefono che si e' spento.
    });
  });
}

module.exports = { registra };
