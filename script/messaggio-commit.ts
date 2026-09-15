/**
 * Costruisce il messaggio di commit della run trimestrale.
 * Legge status.json (cosa ha applicato la verifica) e l'elenco dei file
 * modificati, così il messaggio dice in chiaro cosa è cambiato o che non è
 * cambiato nulla a livello normativo.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { StatusFile } from "../src/tipi.ts";

const directory = process.argv[2] ?? ".";

function leggiStatus(): StatusFile | null {
  try {
    return JSON.parse(readFileSync(`${directory}/status.json`, "utf8")) as StatusFile;
  } catch {
    return null;
  }
}

function fileModificati(): string[] {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" })
      .split("\n")
      .map((riga) => riga.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

const status = leggiStatus();
const file = fileModificati();

const righe: string[] = ["Aggiornamento trimestrale dei calendari di scadenze", ""];

righe.push("File modificati:");
if (file.length === 0) righe.push("- nessuno");
else for (const nome of file) righe.push(`- ${nome}`);

righe.push("", "Modifiche normative applicate in questa run:");

const modifiche: string[] = [];
for (const regola of status?.regole_modificate_ultima_run ?? []) {
  modifiche.push(
    `- regola ${regola.id}.${regola.campo_modificato}: ` +
      `${JSON.stringify(regola.valore_precedente)} -> ${JSON.stringify(regola.valore_nuovo)} ` +
      `(fonte: ${regola.fonte_url})`,
  );
}
for (const parametro of status?.parametri_modificati_ultima_run ?? []) {
  modifiche.push(
    `- parametro ${parametro.campo}: ${JSON.stringify(parametro.valore_precedente)} -> ` +
      `${JSON.stringify(parametro.valore_nuovo)} (fonte: ${parametro.fonte_url})`,
  );
}
for (const proroga of status?.proroghe_applicate_ultima_run ?? []) {
  modifiche.push(
    `- proroga ${proroga.scadenza}: ${proroga.data_originale} -> ${proroga.data_nuova} ` +
      `(fonte: ${proroga.fonte_url})`,
  );
}

if (modifiche.length === 0) righe.push("- nessuna modifica normativa");
else righe.push(...modifiche);

righe.push("");
if (status?.ultimo_tentativo_esito === "riuscito") {
  righe.push(`Verifica delle fonti: riuscita (modello: ${status.modello_utilizzato ?? "n/d"}).`);
} else {
  righe.push(
    `Verifica delle fonti: FALLITA. ${status?.dettaglio_fallimento ?? "Motivo non registrato."}`,
  );
}

const scartate = status?.regole_proposte_ma_scartate_per_limite_sicurezza ?? [];
if (scartate.length > 0) {
  righe.push(`Proposte scartate per il limite di sicurezza: ${scartate.join(", ")}.`);
}

console.log(righe.join("\n"));
