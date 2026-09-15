/**
 * Punto di ingresso della run trimestrale.
 *
 * Sequenza (sezione 5 della specifica):
 *   1. verificaFonti.ts — regole strutturali, parametri annuali e proroghe;
 *   2. rules engine — calcolo delle scadenze per l'anno corrente e il successivo;
 *   3. rigenerazione dei tre file .ics e di public/index.html;
 *   4. aggiornamento di status.json.
 *
 * Il commit e il push NON sono compito di questo script: li esegue il workflow,
 * e solo se qualcosa è davvero cambiato. Lo script scrive i file solo quando il
 * contenuto differisce, così una run senza novità non produce alcun diff.
 *
 * Uso:
 *   node genera.ts                     esegue anche la verifica delle fonti
 *   node genera.ts --senza-verifica     genera soltanto (nessuna chiamata al modello)
 *   node genera.ts --anni=2026,2027     forza l'intervallo di anni
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { costruisciCalendarioProfilo, nomeFileAnno, verificaIntervalloAnni } from "./src/generazione.ts";
import { campiDaVerificareManualmente, costruisciEventi, fontiVerificateAMano, verificaConfigurazione } from "./src/motore.ts";
import { generaPagina, generaRobots, generaSitemap } from "./src/pagina.ts";
import type { Parametri, Regole } from "./src/tipi.ts";
import { aggiornaStatus, eseguiVerificaFonti, leggiStatus, scriviStatus } from "./verificaFonti.ts";

type Opzioni = {
  directory: string;
  senzaVerifica: boolean;
  anni: number[] | null;
};

function leggiOpzioni(argv: string[]): Opzioni {
  const opzioni: Opzioni = { directory: ".", senzaVerifica: false, anni: null };

  for (const argomento of argv) {
    if (argomento === "--senza-verifica") opzioni.senzaVerifica = true;
    if (argomento.startsWith("--directory=")) opzioni.directory = argomento.slice(12);
    if (argomento.startsWith("--anni=")) {
      opzioni.anni = argomento
        .slice(7)
        .split(",")
        .map((valore) => Number.parseInt(valore.trim(), 10))
        .filter((valore) => Number.isInteger(valore));
    }
  }

  return opzioni;
}

function leggiJson<T>(percorso: string): T {
  return JSON.parse(readFileSync(percorso, "utf8")) as T;
}

function leggiEsistente(cartella: string, nome: string): string | null {
  const percorso = join(cartella, nome);
  return existsSync(percorso) ? readFileSync(percorso, "utf8") : null;
}

/** Writes only when the content differs; returns whether the file changed. */
function scriviSeCambiato(percorso: string, contenuto: string): boolean {
  if (existsSync(percorso)) {
    const esistente = readFileSync(percorso, "utf8");
    if (esistente === contenuto) return false;
  }
  writeFileSync(percorso, contenuto);
  return true;
}

async function main(): Promise<void> {
  const opzioni = leggiOpzioni(process.argv.slice(2));
  const directory = resolve(opzioni.directory);
  const percorsoRegole = join(directory, "regole.json");
  const percorsoParametri = join(directory, "parametri.json");
  const cartellaPubblica = join(directory, "public");

  if (!existsSync(percorsoRegole) || !existsSync(percorsoParametri)) {
    throw new Error(`regole.json o parametri.json non trovati in ${directory}.`);
  }

  const annoCorrente = new Date().getUTCFullYear();
  // `--anni` è uno strumento di diagnosi, non una scorciatoia: l'intervallo
  // ammesso resta quello vero, calcolato dall'anno corrente, così non può essere
  // allargato per far passare anni passati.
  const anni = opzioni.anni ?? [annoCorrente, annoCorrente + 1];
  const istante = new Date();

  let status = leggiStatus(directory);
  const modifiche: string[] = [];

  /* 1. Verifica delle fonti (facoltativa ma attiva per default). */
  if (opzioni.senzaVerifica) {
    console.log("Verifica delle fonti saltata su richiesta (--senza-verifica).");
  } else {
    console.log("Verifica delle fonti in corso…");
    const esito = await eseguiVerificaFonti({ directory });
    status = aggiornaStatus(status, esito, istante);
    scriviSeCambiato(join(directory, "status.json"), `${JSON.stringify(status, null, 2)}\n`);

    if (esito.esito === "riuscito") {
      console.log(
        `Verifica riuscita. Regole modificate: ${esito.regoleModificate.length}, ` +
          `parametri modificati: ${esito.parametriModificati.length}, ` +
          `proroghe applicate: ${esito.prorogheApplicate.length}, ` +
          `proposte scartate: ${esito.scartatePerVerifica.length + esito.scartatePerLimite.length}.`,
      );
      modifiche.push(...esito.regoleModificate.map((r) => `regola ${r.id}.${r.campo_modificato}`));
      modifiche.push(
        ...esito.parametriModificati.map((p) => `parametro ${p.campo}`),
      );
      modifiche.push(...esito.prorogheApplicate.map((p) => `proroga ${p.scadenza}`));
    } else {
      console.error(`Verifica fallita: ${esito.dettaglio}`);
    }
  }

  /* 2. Rilettura: la verifica può aver modificato regole e parametri. */
  const config = leggiJson<Regole>(percorsoRegole);
  const parametri = leggiJson<Parametri>(percorsoParametri);

  const errori = verificaConfigurazione(config);
  if (errori.length > 0) {
    throw new Error(`regole.json non valido:\n  - ${errori.join("\n  - ")}`);
  }

  /* 3. Calcolo delle scadenze: solo anno corrente e successivo. */
  const eventi = costruisciEventi({
    config,
    parametri,
    anni,
    dataGenerazione: istante,
    proroghe: config.proroghe ?? [],
  });
  verificaIntervalloAnni(eventi, { dal: annoCorrente, al: annoCorrente + 1 });
  console.log(`Scadenze calcolate: ${eventi.length} su ${anni.join(" e ")}.`);

  /* 4. Generazione dei calendari. */
  mkdirSync(cartellaPubblica, { recursive: true });

  const fileGenerati: { nome: string; contenuto: string; modificato: boolean }[] = [];
  const scrivi = (nome: string, contenuto: string) => {
    const modificato = scriviSeCambiato(join(cartellaPubblica, nome), contenuto);
    fileGenerati.push({ nome: `public/${nome}`, contenuto, modificato });
    console.log(`  ${modificato ? "aggiornato" : "invariato "}  public/${nome}`);
  };

  for (const profilo of config.profili) {
    const eventiProfilo = eventi.filter((evento) => evento.profilo_id === profilo.id);

    // File completo: è quello che si sottoscrive, e copre anno corrente e
    // successivo. Il nome resta stabile perché è l'indirizzo di iscrizione.
    scrivi(
      profilo.file,
      costruisciCalendarioProfilo(profilo, eventiProfilo, config, leggiEsistente(cartellaPubblica, profilo.file), istante),
    );

    // Un file per anno: è quello che si scarica, ed è una fotografia statica.
    // Separato dal precedente proprio perché i due usi sono diversi.
    for (const anno of anni) {
      const nome = nomeFileAnno(profilo, anno);
      scrivi(
        nome,
        costruisciCalendarioProfilo(
          profilo,
          eventiProfilo.filter((evento) => evento.anno === anno),
          config,
          leggiEsistente(cartellaPubblica, nome),
          istante,
          { suffissoNome: ` — anno ${anno}`, notaScaricato: true },
        ),
      );
    }
  }

  /* 5. Dominio personalizzato, solo se dichiarato in regole.json.
     Finché non lo è, l'eventuale CNAME presente va rimosso: lasciarlo
     attiverebbe un dominio che non risponde, e il sito diventerebbe
     irraggiungibile proprio all'indirizzo su cui è pubblicato. */
  const percorsoCname = join(cartellaPubblica, "CNAME");
  if (config.metadati.cname) {
    scrivi("CNAME", `${config.metadati.cname}\n`);
  } else if (existsSync(percorsoCname)) {
    rmSync(percorsoCname);
    console.log("  rimosso     public/CNAME (nessun dominio personalizzato attivo)");
  }

  /* 5-bis. File per i motori di ricerca. Rigenerati come tutto il resto, così
     non possono descrivere un sito diverso da quello pubblicato. */
  scrivi("robots.txt", generaRobots(config));
  scrivi("sitemap.xml", generaSitemap(config, status, anni));

  /* 6. Pagina pubblica, rigenerata insieme ai calendari. */
  const html = generaPagina({
    config,
    parametri,
    status,
    eventi,
    anni,
    fileGenerati: fileGenerati.map((f) => ({ nome: f.nome, modificato: f.modificato })),
    campiDaVerificare: campiDaVerificareManualmente(config, parametri),
    fontiAMano: fontiVerificateAMano(config, parametri),
  });
  const paginaModificata = scriviSeCambiato(join(cartellaPubblica, "index.html"), html);
  console.log(`  ${paginaModificata ? "aggiornata" : "invariata "}  public/index.html`);

  /* 7. Riepilogo per il messaggio di commit. */
  const cambiati = [
    ...fileGenerati.filter((f) => f.modificato).map((f) => f.nome),
    ...(paginaModificata ? ["public/index.html"] : []),
  ];

  console.log("");
  if (cambiati.length === 0 && modifiche.length === 0) {
    console.log("RISULTATO: nessuna modifica.");
  } else {
    console.log(`RISULTATO: ${cambiati.length} file aggiornati.`);
    if (modifiche.length > 0) {
      console.log(`Modifiche normative applicate: ${modifiche.join("; ")}`);
    }
  }
}

await main();
