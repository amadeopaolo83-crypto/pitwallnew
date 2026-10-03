// Lo stato di ogni team, in memoria.
//
// Deliberatamente stateless-per-riavvio: si tiene solo l'ultimo stato utile
// (config pulsanti, consumo, ecc.) cosi' un dispositivo che si riconnette a
// meta' gara riceve subito lo stato corrente. Dopo un riavvio del processo si
// riparte da zero, collegamento alla classifica compreso: per questo ogni
// stanza nasce con il flag `fresh`, e i telefoni che si ricordano i propri
// valori li rimandano al server (vedi restoreIntoFreshServer nel client).

const { AUB_URL, AUB_USER } = require("./config");

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
      // Collegamento al server classifica (AUBServer). La password non sta
      // qui: lo stato viene mandato a tutti i dispositivi della stanza.
      aub: {
        configured: Boolean(AUB_URL && AUB_USER),
        connected: false,
        driverId: null,
        status: "spento",
        error: null,
        flag: null,
        stale: false,
        updatedAt: null,
      },
      pushSubscriptions: [],
      fuelSystem: {
        tankCapacityLiters: 100,
        currentLiters: 100,
        consumptionRatePerHour: null,
        onTrack: false,
        sessionStartAt: null,
        sessionStartLiters: 0,
      },
      // Gara avviata/fermata dal box: finche' e' attiva il server si tiene sveglio.
      race: { active: false, startedAt: null },
      // true finche' nessun dispositivo ha rimandato i propri valori dopo un
      // riavvio del server; si spegne da solo, una voce alla volta.
      fresh: { fuel: true, buttons: true, race: true },
    });
  }
  return rooms.get(code);
}

module.exports = { rooms, getRoomState };
