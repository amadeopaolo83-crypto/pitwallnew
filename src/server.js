// PitComm - server di comunicazione box <-> auto per gare endurance.
//
// Questo file e' solo il punto di avvio: mette insieme i pezzi e accende il
// server. La sostanza sta nei moduli accanto:
//
//   config.js     la configurazione che arriva dall'ambiente
//   static.js     il client web (public/) servito da questo stesso processo
//   rooms.js      lo stato in memoria di ogni team
//   sockets.js    gli eventi che box e auto si scambiano
//   push.js       le notifiche ai telefoni del box
//   aub.js        il collegamento al server di elaborazione classifica
//   keepalive.js  tiene sveglio il server mentre una gara e' in corso

const http = require("http");
const { Server } = require("socket.io");

const { PORT } = require("./config");
const { serviRichiesta } = require("./static");
const aub = require("./aub");
const sockets = require("./sockets");

const httpServer = http.createServer(serviRichiesta);

const io = new Server(httpServer, {
  cors: { origin: "*" }, // in produzione: restringere all'origine del client
});

aub.init(io);
sockets.registra(io);

httpServer.listen(PORT, () => {
  console.log(`PitComm server in ascolto sulla porta ${PORT}`);
});
