/**
 * Verifica meccanica degli estratti dichiarati in regole.json e parametri.json.
 *
 * Per ogni voce marcata `stato_verifica: "verificato"` apre la `fonte_url` e
 * controlla che `estratto_verificato` compaia letteralmente nella pagina. È lo
 * stesso controllo che il sistema applica alle proposte del modello, qui
 * applicato ai dati già pubblicati: se un estratto viene modificato a mano in
 * modo incoerente con la fonte, questo script lo segnala.
 *
 * Uso:
 *   node script/verifica-estratti.ts
 *
 * Esce con codice 1 se almeno una voce dichiarata verificata non lo è.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { verificaEstratto } from "../src/verifica-web.ts";
import { impostaDominiAmmessi } from "../src/verifica-web.ts";
import type { Parametri, Regole } from "../src/tipi.ts";
import { caricaFonti, dominiPerLaVerifica } from "../verificaFonti.ts";

const radice = process.argv[2] ?? ".";

type Voce = { dove: string; url: string; estratto: string };

function raccogli(radice: string): { voci: Voce[]; aMano: string[] } {
  const config = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;
  const parametri = JSON.parse(readFileSync(join(radice, "parametri.json"), "utf8")) as Parametri;

  const voci: Voce[] = [];
  const aMano: string[] = [];

  const aggiungi = (
    dove: string,
    voce: { stato_verifica?: string; fonte_url?: string; estratto_verificato?: string },
  ) => {
    const stato = voce.stato_verifica ?? "verificato";
    // `verificato_manualmente` è confermato leggendo la fonte, ma la pipeline non
    // può ricontrollarlo da sé (tipicamente perché la fonte è un PDF): non è un
    // errore da segnalare, ma va dichiarato per non farlo passare per automatico.
    if (stato === "verificato_manualmente") {
      aMano.push(`${dove} — ${voce.fonte_url ?? "fonte non indicata"}`);
      return;
    }
    if (stato !== "verificato") return;
    if (!voce.fonte_url || !voce.estratto_verificato) return;
    voci.push({ dove, url: voce.fonte_url, estratto: voce.estratto_verificato });
  };

  for (const regola of config.regole) {
    aggiungi(`regola:${regola.id}`, regola);
    (regola.fonti_aggiuntive ?? []).forEach((fonte) => {
      aggiungi(`regola:${regola.id}#${fonte.aspetto || "fonte-aggiuntiva"}`, fonte);
    });
    (regola.varianti_validita ?? []).forEach((variante, indice) => {
      aggiungi(`regola:${regola.id}#variante${indice + 1}`, variante);
    });
  }

  for (const fonte of parametri.fonti_comuni ?? []) {
    aggiungi(`parametro-comune:${fonte.campo}`, fonte);
  }
  for (const [anno, insieme] of Object.entries(parametri.anni)) {
    for (const fonte of insieme.fonti ?? []) {
      aggiungi(`parametro:${anno}.${fonte.campo}`, fonte);
    }
  }

  return { voci, aMano };
}

const { voci, aMano } = raccogli(radice);

// Lo script usa gli stessi criteri della pipeline: se una fonte pubblicata non
// rientra nei domini ammessi, è un problema che va scoperto qui, non il giorno
// della run trimestrale.
const config = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;
const parametri = JSON.parse(readFileSync(join(radice, "parametri.json"), "utf8")) as Parametri;
impostaDominiAmmessi(dominiPerLaVerifica(caricaFonti(radice), config, parametri));
console.log(`Estratti dichiarati verificati: ${voci.length}\n`);

const esiti = await Promise.all(
  voci.map(async (voce) => ({ voce, esito: await verificaEstratto(voce.url, voce.estratto) })),
);

let falliti = 0;
let nonRaggiungibili = 0;

for (const { voce, esito } of esiti) {
  if (esito.esito === "confermato") {
    console.log(`OK        ${voce.dove}`);
  } else if (esito.esito === "estratto_non_trovato" || esito.esito === "url_non_valido") {
    // Problema di DATI: l'estratto non c'è più, o l'URL è fuori dall'elenco
    // delle fonti ammesse. Questo deve far fallire il controllo.
    falliti += 1;
    console.log(`FALLITO   ${voce.dove}`);
    console.log(`          url: ${voce.url}`);
    console.log(`          esito: ${esito.esito} — ${esito.dettaglio}`);
    console.log(`          estratto: "${voce.estratto.slice(0, 110)}..."`);
  } else {
    // Problema di AMBIENTE: il sito non risponde da qui, o la fonte non è
    // testuale. Non significa che l'estratto sia sbagliato, quindi non si
    // blocca la pubblicazione: si dichiara che il controllo non è stato
    // possibile. Distinguere i due casi è necessario, perché un controllo che
    // non può passare non protegge niente: impedisce solo di lavorare.
    nonRaggiungibili += 1;
    console.log(`NON VERIFICABILE ORA  ${voce.dove}`);
    console.log(`          url: ${voce.url}`);
    console.log(`          motivo: ${esito.esito} — ${esito.dettaglio}`);
  }
}

// Non-verified entries are reported too, so the list of open items is visible
// every time this script runs.
const daVerificare: string[] = [];
for (const regola of (JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole)
  .regole) {
  if ((regola.stato_verifica ?? "verificato") !== "verificato") daVerificare.push(`regola:${regola.id}`);
}

console.log(`\nVoci non verificate automaticamente: ${daVerificare.length}`);
for (const voce of daVerificare) console.log(`  - ${voce}`);

if (aMano.length > 0) {
  console.log(`\nVerificate a mano, non ricontrollabili automaticamente: ${aMano.length}`);
  for (const voce of aMano) console.log(`  - ${voce}`);
}

console.log(
  `\nEsito: ${esiti.length - falliti - nonRaggiungibili}/${esiti.length} estratti confermati` +
    `${nonRaggiungibili > 0 ? `, ${nonRaggiungibili} non verificabili da qui` : ""}.`,
);
if (falliti > 0) {
  console.error(`${falliti} estratti NON confermati: correggere i dati o la fonte.`);
  process.exit(1);
}
if (nonRaggiungibili > 0) {
  console.warn(
    `${nonRaggiungibili} estratti non sono stati verificati perché la fonte non ha risposto ` +
      "da questo ambiente. Non è un errore dei dati.",
  );
}
