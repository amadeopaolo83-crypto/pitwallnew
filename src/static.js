// Il client web servito da questo stesso processo.
//
// Un solo indirizzo per pagina e socket: niente CORS, nessun campo "server" da
// compilare, e soprattutto nessun modo che il client resti indietro rispetto al
// server dopo un deploy, visto che partono dallo stesso commit.
//
// Si serve solo public/: i file del server stanno in src/ e non sono
// raggiungibili, senza bisogno di elenchi di esclusione.

const fs = require("fs");
const path = require("path");

const { VAPID_PUBLIC_KEY } = require("./config");

const ROOT = path.join(__dirname, "..", "public");

const TIPI = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};


/** Il file da servire per questo URL, oppure null se non e' roba nostra. */
function fileRichiesto(url) {
  let percorso;
  try {
    percorso = decodeURIComponent(url.split("?")[0]);
  } catch (e) {
    return null; // percent-encoding malformato
  }
  const relativo = percorso === "/" ? "index.html" : percorso.replace(/^\/+/, "");
  // resolve() risolve i ".." prima del confronto: se il risultato esce da ROOT
  // la richiesta stava cercando di uscire dalla cartella.
  const assoluto = path.resolve(ROOT, relativo);
  if (assoluto !== ROOT && !assoluto.startsWith(ROOT + path.sep)) return null;
  const nome = path.basename(assoluto);
  if (nome.startsWith(".")) return null;
  if (!TIPI[path.extname(assoluto).toLowerCase()]) return null;
  return assoluto;
}

function serviRichiesta(req, res) {
  if (req.url === "/vapid-public-key") {
    // Senza chiavi configurate le notifiche sono spente: il client lo capisce
    // dal 404 e lo scrive nello stato, invece di provare a iscriversi.
    if (!VAPID_PUBLIC_KEY) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("");
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(VAPID_PUBLIC_KEY);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
    return res.end("Metodo non consentito\n");
  }

  const file = fileRichiesto(req.url || "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Non trovato\n");
  }

  fs.stat(file, (err, info) => {
    if (err || !info.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Non trovato\n");
    }
    const nome = path.basename(file);
    // La pagina e il service worker non si mettono in cache: altrimenti dopo un
    // deploy il telefono resta su una versione vecchia proprio durante la gara.
    const cache = nome === "index.html" || nome === "sw.js"
      ? "no-cache"
      : "public, max-age=3600";
    res.writeHead(200, {
      "Content-Type": TIPI[path.extname(file).toLowerCase()],
      "Content-Length": info.size,
      "Cache-Control": cache,
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  });
}

module.exports = { serviRichiesta };
