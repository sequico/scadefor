/**
 * Verifica geometrica della pagina con Chrome headless.
 *
 * Esiste perché certi difetti non si vedono leggendo il markup. Ne ha già
 * intercettati due, entrambi reali:
 *
 *   1. i tre bottoni «Iscriviti al calendario» a quote verticali diverse;
 *   2. la pagina che sfora orizzontalmente, perché un elemento `nowrap` dentro
 *      una griglia allarga la colonna oltre lo schermo.
 *
 * Il secondo è arrivato dopo aver corretto il primo: sistemare la verticale con
 * `white-space:nowrap` ha introdotto lo sconfinamento. Un controllo che misuri
 * una sola dimensione non basta, quindi qui si misurano entrambe.
 *
 * Richiede Chrome (o Chromium). Se non c'è, lo script lo dichiara e termina
 * senza errore: è un controllo in più, non un requisito del progetto.
 *
 * Uso: node script/verifica-geometria.ts [--larghezze=320,390,768,1280,1440]
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const radice = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pagina = pathToFileURL(join(radice, "public", "index.html")).href;

const argomento = process.argv.find((a) => a.startsWith("--larghezze="));
const LARGHEZZE = (argomento?.slice(12) ?? "320,390,768,1280,1440")
  .split(",")
  .map((valore) => Number.parseInt(valore.trim(), 10))
  .filter((valore) => Number.isInteger(valore));

function trovaChrome(): string | null {
  const candidati = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((valore): valor is string => Boolean(valore));

  return candidati.find((percorso) => existsSync(percorso)) ?? null;
}

const attendi = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Misura = {
  profilo: string;
  top: number;
  dallaCima: number;
  dalFondo: number;
  alto: number;
};

type Rilievo = {
  carte: Misura[];
  scrollWidth: number;
  clientWidth: number;
  fuori: string[];
};

async function misuraLarghezza(
  eseguibile: string,
  larghezza: number,
  porta: number,
): Promise<Rilievo> {
  const chrome = spawn(
    eseguibile,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      `--remote-debugging-port=${porta}`,
      `--window-size=${larghezza},2600`,
      pagina,
    ],
    { stdio: "ignore" },
  );

  try {
    let bersaglio: string | undefined;
    for (let tentativo = 0; tentativo < 40 && !bersaglio; tentativo += 1) {
      try {
        const lista = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()) as {
          type: string;
          url: string;
          webSocketDebuggerUrl?: string;
        }[];
        bersaglio = lista.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {
        // Chrome non è ancora in ascolto.
      }
      if (!bersaglio) await attendi(250);
    }
    if (!bersaglio) throw new Error("Chrome non ha esposto alcun bersaglio di debug");

    const ws = new WebSocket(bersaglio);
    await new Promise((r) => {
      ws.onopen = r;
    });

    let contatore = 0;
    const invia = async (
      metodo: string,
      parametri: Record<string, unknown>,
    ): Promise<{ result?: { result?: { value?: string } } }> => {
      contatore += 1;
      const identificatore = contatore;
      return (await new Promise((r) => {
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data as string);
          if (m.id === identificatore) r(m);
        };
        ws.send(JSON.stringify({ id: identificatore, method: metodo, params: parametri }));
      })) as { result?: { result?: { value?: string } } };
    };

    const valuta = async (espressione: string): Promise<string> => {
      const r = await invia("Runtime.evaluate", { expression: espressione, returnByValue: true });
      return r.result?.result?.value ?? "";
    };

    // Chrome headless non scende sotto una finestra di circa 500px: senza questo
    // override i test "mobile" misurerebbero in realtà una pagina larga 500, cioè
    // proprio la fascia in cui il difetto non si vede.
    await invia("Emulation.setDeviceMetricsOverride", {
      width: larghezza,
      height: 2600,
      deviceScaleFactor: 1,
      mobile: larghezza < 768,
    });

    // Con file:// la valutazione può arrivare prima del rendering.
    for (let tentativo = 0; tentativo < 40; tentativo += 1) {
      if (Number(await valuta("document.querySelectorAll('.calendario .pulsante').length")) > 0) {
        break;
      }
      await attendi(250);
    }

    const espressione = `
      (() => {
        const radice = document.documentElement;
        const limite = radice.clientWidth + 1;
        const fuori = [...document.querySelectorAll('body *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.right <= limite) return false;
            // Un elemento dentro un contenitore che scorre ha per definizione il
            // bordo oltre la finestra: è il contenitore a gestirlo, non è uno
            // sconfinamento della pagina. Senza questa esclusione il controllo
            // segnalava le tabelle scorrevoli come se fossero il problema.
            for (let p = el.parentElement; p; p = p.parentElement) {
              if (getComputedStyle(p).overflowX !== 'visible') return false;
            }
            return true;
          })
          .slice(0, 6)
          .map((el) =>
            typeof el.className === 'string' && el.className
              ? el.className
              : el.tagName.toLowerCase()
          );
        return JSON.stringify({
          carte: [...document.querySelectorAll('.calendario')].map((carta) => {
            const b = carta.querySelector('.pulsante').getBoundingClientRect();
            const r = carta.getBoundingClientRect();
            return {
              profilo: carta.querySelector('h3').textContent.trim(),
              top: Math.round(b.top),
              dallaCima: Math.round(b.top - r.top),
              dalFondo: Math.round(r.bottom - b.bottom),
              alto: Math.round(r.height)
            };
          }),
          scrollWidth: radice.scrollWidth,
          clientWidth: radice.clientWidth,
          fuori
        });
      })()
    `;

    const rilievo = JSON.parse(await valuta(espressione)) as Rilievo;
    ws.close();
    return rilievo;
  } finally {
    chrome.kill("SIGKILL");
    await attendi(600);
  }
}

/**
 * Misura con un paio di tentativi su porte diverse. Chrome può impiegare più
 * del previsto a rilasciare la porta di debug, e un fallimento di rete locale
 * non deve essere scambiato per un difetto della pagina.
 */
async function misuraConRitentativi(eseguibile: string, larghezza: number): Promise<Rilievo> {
  let ultimoErrore: unknown;
  for (let tentativo = 0; tentativo < 3; tentativo += 1) {
    const porta = 9400 + ((process.pid + larghezza + tentativo * 37) % 400);
    try {
      return await misuraLarghezza(eseguibile, larghezza, porta);
    } catch (errore) {
      ultimoErrore = errore;
      await attendi(500);
    }
  }
  throw ultimoErrore;
}

const eseguibile = trovaChrome();
if (!eseguibile) {
  console.log("Chrome non trovato: verifica geometrica saltata (il progetto non ne ha bisogno).");
  process.exit(0);
}

if (!existsSync(join(radice, "public", "index.html"))) {
  console.error("public/index.html non esiste: eseguire prima `npm run genera:offline`.");
  process.exit(1);
}

let problemi = 0;

for (const larghezza of LARGHEZZE) {
  const rilievo = await misuraConRitentativi(eseguibile, larghezza);
  const misure = rilievo.carte;

  if (misure.length < 2) {
    console.error(`  ${larghezza}px: trovate ${misure.length} carte, attese almeno 2.`);
    problemi += 1;
    continue;
  }

  const eccedenza = rilievo.scrollWidth - rilievo.clientWidth;

  // In colonna singola le carte stanno una sotto l'altra e i bottoni DEVONO
  // stare a quote diverse: confrontarli tutti sarebbe un falso allarme. Si
  // confrontano quindi solo le carte che condividono la stessa riga, cioè
  // quelle il cui bordo superiore cade alla stessa quota.
  const righe = new Map<number, number[]>();
  for (const misura of misure) {
    const bordoCarta = misura.top - misura.dallaCima;
    const chiave = Math.round(bordoCarta / 4);
    righe.set(chiave, [...(righe.get(chiave) ?? []), misura.top]);
  }
  const gruppi = [...righe.values()].filter((gruppo) => gruppo.length > 1);
  const disallineati = gruppi.filter((gruppo) => !gruppo.every((t) => t === gruppo[0]));

  console.log(
    `  ${String(larghezza).padStart(4)}px  ` +
      `${gruppi.length > 0 ? `${gruppi[0].length} carte affiancate` : "carte in colonna"}` +
      `  |  bottoni ${disallineati.length === 0 ? "allineati" : "DISALLINEATI"}` +
      `  |  larghezza ${rilievo.scrollWidth}/${rilievo.clientWidth}` +
      `${eccedenza > 1 ? `  SBORDA di ${eccedenza}px` : "  non sborda"}`,
  );

  for (const gruppo of disallineati) {
    problemi += 1;
    console.error(
      `         scarto verticale di ${Math.max(...gruppo) - Math.min(...gruppo)}px fra bottoni ` +
        "che dovrebbero essere affiancati.",
    );
  }

  if (eccedenza > 1) {
    problemi += 1;
    console.error(
      `         la pagina sfora orizzontalmente. Elementi oltre il bordo: ` +
        `${rilievo.fuori.join(", ") || "non identificati"}`,
    );
  }
}

if (problemi > 0) {
  console.error(`\nVerifica geometrica fallita: ${problemi} problemi di impaginazione.`);
  process.exit(1);
}

console.log(
  "\nVerifica geometrica superata: bottoni allineati dove sono affiancati, nessuno sconfinamento orizzontale, da telefono a schermo largo.",
);
