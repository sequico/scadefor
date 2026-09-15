/**
 * Genera `public/og-image.png`: l'immagine che appare quando il link viene
 * condiviso su una chat, un social o un forum.
 *
 * Non è un fattore di posizionamento, ma decide se qualcuno clicca il link
 * quando lo incontra. Senza, l'anteprima è una riga di testo grigia.
 *
 * Richiede Chrome (o Chromium) installato. Se non c'è, lo script lo dichiara e
 * termina senza errore. Non fa parte della run trimestrale: l'immagine cambia
 * solo quando cambia l'identità visiva, e si rigenera a mano:
 *
 *   node script/genera-og-image.ts
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const radice = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destinazione = join(radice, "public", "og-image.png");

const LARGHEZZA = 1200;
const ALTEZZA = 630;

function trovaChrome(): string | null {
  const candidati = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((valore): valore is string => Boolean(valore));
  return candidati.find((percorso) => existsSync(percorso)) ?? null;
}

const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    width:${LARGHEZZA}px;height:${ALTEZZA}px;overflow:hidden;
    background:
      radial-gradient(900px 420px at 8% -10%, #0d5a63 0%, transparent 62%),
      #0c1417;
    color:#eef2f1;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    display:flex;flex-direction:column;justify-content:space-between;
    padding:64px 72px;
  }
  .mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
  .marchio{font-size:34px;letter-spacing:-.02em;color:#9fb6b5}
  .marchio b{color:#fff;font-weight:800;letter-spacing:-.03em}
  .marchio .punto{display:inline-block;width:11px;height:11px;background:#ad1140;border-radius:2px;margin-left:11px;vertical-align:baseline}
  h1{font-size:74px;line-height:1.04;letter-spacing:-.035em;font-weight:800;max-width:19ch;margin:26px 0 0}
  h1 em{font-style:normal;color:#5cc0c3}
  .riga{display:flex;align-items:flex-end;justify-content:space-between;gap:40px}
  .scadenze{font-size:23px;color:#b9c8c7;max-width:34ch;line-height:1.45}
  .bollo{
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;letter-spacing:.1em;
    text-transform:uppercase;color:#0c1417;background:#5cc0c3;border-radius:999px;padding:11px 22px;white-space:nowrap;
  }
  .piede{display:flex;gap:14px;align-items:center;font-size:20px;color:#7f9594}
  .piede .sep{width:5px;height:5px;background:#40605f;border-radius:50%}
</style>
</head>
<body>
  <div>
    <p class="marchio"><b>Scade</b>nze <b>For</b>fettari<span class="punto"></span></p>
    <h1>Il fisco non ti manda un promemoria. <em>Questo sì.</em></h1>
  </div>
  <div class="riga">
    <p class="scadenze">Le scadenze fiscali e contributive del regime forfettario, in un calendario
    da sottoscrivere. Aggiornato dall'intelligenza artificiale ogni trimestre.</p>
    <span class="bollo">scadefor.sequi.company</span>
  </div>
  <div class="piede">
    <span class="mono">2026 · 2027</span><span class="sep"></span>
    <span class="mono">imposta sostitutiva</span><span class="sep"></span>
    <span class="mono">contributi INPS</span><span class="sep"></span>
    <span class="mono">riduzione 35%</span>
  </div>
</body>
</html>
`;

const eseguibile = trovaChrome();
if (!eseguibile) {
  console.log("Chrome non trovato: immagine di anteprima non rigenerata (non è un errore).");
  process.exit(0);
}

const cartella = mkdtempSync(join(tmpdir(), "scadefor-og-"));
const sorgente = join(cartella, "og.html");
writeFileSync(sorgente, html);

const chrome = spawn(
  eseguibile,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    `--window-size=${LARGHEZZA},${ALTEZZA}`,
    `--screenshot=${destinazione}`,
    `file://${sorgente}`,
  ],
  { stdio: "ignore" },
);

await new Promise((r) => {
  chrome.on("exit", r);
});

if (!existsSync(destinazione)) {
  console.error("Chrome non ha prodotto l'immagine.");
  process.exit(1);
}

console.log(`Immagine di anteprima generata: public/og-image.png (${LARGHEZZA}×${ALTEZZA}).`);
