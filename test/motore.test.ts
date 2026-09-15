import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  campiDaVerificareManualmente,
  costruisciEventi,
  regolaPerAnno,
  risolviParametriAnno,
  verificaConfigurazione,
} from "../src/motore.ts";
import type { Parametri, Regola, Regole } from "../src/tipi.ts";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;
const parametri = JSON.parse(readFileSync(join(radice, "parametri.json"), "utf8")) as Parametri;

const ISTANTE = new Date(Date.UTC(2026, 8, 15, 12, 0, 0));

function eventi(anni: number[]) {
  return costruisciEventi({ config, parametri, anni, dataGenerazione: ISTANTE });
}

function date(profilo: string, anno: number, regola: string): string[] {
  return eventi([anno])
    .filter((e) => e.profilo_id === profilo && e.regola_id === regola)
    .map((e) => e.data.toISOString().slice(0, 10));
}

test("regole.json e parametri.json reali superano la validazione", () => {
  assert.deepEqual(verificaConfigurazione(config), []);
});

test("le scadenze coperte sono solo l'anno corrente e il successivo", () => {
  const generati = eventi([2026, 2027]);
  const anni = new Set(generati.map((e) => e.data.getUTCFullYear()));
  // Gli slittamenti possono sconfinare di pochi giorni, ma mai su anni passati.
  assert.deepEqual([...anni].sort(), [2026, 2027]);
  assert.ok(generati.every((e) => e.data.getUTCFullYear() >= 2026));
});

test("ogni evento ha un UID distinto", () => {
  const uid = eventi([2026, 2027]).map((e) => e.uid);
  assert.equal(new Set(uid).size, uid.length);
});

test("le quattro rate INPS hanno UID distinti", () => {
  const rate = eventi([2026]).filter(
    (e) => e.profilo_id === "artigiani-ridotto-35" && e.regola_id === "rate_trimestrali_inps",
  );
  assert.equal(rate.length, 4);
  assert.equal(new Set(rate.map((e) => e.uid)).size, 4);
});

test("la rata INPS di maggio 2026 slitta dal sabato al lunedì", () => {
  assert.deepEqual(date("artigiani-ridotto-35", 2026, "rate_trimestrali_inps"), [
    "2026-02-16",
    "2026-05-18",
    "2026-08-20",
    "2026-11-16",
  ]);
});

test("la rata INPS di agosto resta al 20 per la sospensione feriale", () => {
  // La regola dichiara il 20 agosto: cade in un giovedì lavorativo e non si muove.
  assert.ok(date("commercianti-ridotto-35", 2026, "rate_trimestrali_inps").includes("2026-08-20"));
});

test("l'opzione per la riduzione slitta quando il 28 febbraio è sabato", () => {
  assert.deepEqual(date("artigiani-ridotto-35", 2026, "opzione_riduzione_35"), ["2026-03-02"]);
  assert.deepEqual(date("commercianti-ridotto-35", 2027, "opzione_riduzione_35"), ["2027-03-01"]);
});

test("saldo, primo e secondo acconto cadono al 30 giugno e al 30 novembre", () => {
  assert.deepEqual(date("gestione-separata", 2026, "saldo_primo_acconto"), ["2026-06-30"]);
  assert.deepEqual(date("gestione-separata", 2026, "secondo_acconto"), ["2026-11-30"]);
});

test("la Gestione Separata non riceve rate contributive INPS né l'opzione di riduzione", () => {
  const generati = eventi([2026, 2027]).filter((e) => e.profilo_id === "gestione-separata");
  const regole = new Set(generati.map((e) => e.regola_id));
  assert.deepEqual([...regole].sort(), ["saldo_primo_acconto", "secondo_acconto"]);
});

test("la regola disattivata non produce eventi", () => {
  assert.ok(!eventi([2026, 2027]).some((e) => e.regola_id === "versamento_mensile_iva"));
});

test("la descrizione contiene entrambi i blocchi richiesti", () => {
  const evento = eventi([2026]).find((e) => e.regola_id === "saldo_primo_acconto");
  assert.ok(evento);
  assert.ok(evento.descrizione.includes("CRITERI DI CALCOLO: "));
  assert.ok(evento.descrizione.includes("CRITERI DI SCADENZA: "));
  assert.ok(evento.descrizione.includes("Riferimento normativo applicato per il 2026"));
});

test("l'esempio numerico usa i valori dei parametri", () => {
  const evento = eventi([2026]).find(
    (e) => e.regola_id === "rate_trimestrali_inps" && e.profilo_id === "commercianti-ridotto-35",
  );
  assert.ok(evento);
  // 18.808 × 24,48% × 65% = 2.992,73 → rata 748,18
  assert.ok(evento.descrizione.includes("18.808 €"));
  assert.ok(evento.descrizione.includes("24,48%"));
  assert.ok(evento.descrizione.includes("2.992,73 €"));
  assert.ok(evento.descrizione.includes("748,18 €"));
});

test("un anno senza parametri propri ricade sull'ultimo disponibile ed è segnalato", () => {
  const risolto = risolviParametriAnno(parametri, 2027);
  assert.equal(risolto.provvisorio, true);
  assert.equal(risolto.anno_valori, 2026);

  const evento = eventi([2027]).find((e) => e.profilo_id === "gestione-separata");
  assert.ok(evento);
  assert.ok(
    evento.descrizione.includes("valori provvisori") ||
      evento.descrizione.includes("non sono ancora pubblicati"),
  );
});

test("una variante per periodo prevale sui campi di base solo negli anni coperti", () => {
  const regola: Regola = {
    id: "prova",
    descrizione: "Prova",
    tipo: "data_fissa_annuale",
    attivo: true,
    categoria: "adempimento",
    giorno: 30,
    mese: 6,
    calcolo: { tipo: "nessuno" },
    fonte_normativa: "Norma base",
    fonte_url: "https://example.org/base",
    estratto_verificato: "estratto base",
    stato_verifica: "verificato",
    varianti_validita: [
      {
        da_anno: 2027,
        a_anno: 2027,
        giorno: 10,
        mese: 7,
        fonte_normativa: "Norma modificata",
        fonte_url: "https://example.org/nuova",
        estratto_verificato: "estratto nuovo",
        stato_verifica: "verificato",
      },
    ],
  };

  assert.equal(regolaPerAnno(regola, 2026).giorno, 30);
  assert.equal(regolaPerAnno(regola, 2026).fonte_normativa, "Norma base");
  assert.equal(regolaPerAnno(regola, 2027).giorno, 10);
  assert.equal(regolaPerAnno(regola, 2027).fonte_normativa, "Norma modificata");
  assert.equal(regolaPerAnno(regola, 2028).giorno, 30);
});

test("i dati non verificabili automaticamente sono dichiarati, non nascosti", () => {
  const elenco = campiDaVerificareManualmente(config, parametri);
  const campi = elenco.map((voce) => `${voce.dove}:${voce.campo}`).sort();

  // Elenco completo e chiuso. Se un dato passa a "verificato" o ne compare uno
  // nuovo non dichiarato, questo test lo segnala invece di lasciarlo passare:
  // è così che si è accorto che le festività nazionali erano state confermate.
  assert.deepEqual(
    campi,
    [
      "parametro 2026:aliquota_gestione_separata",
      "parametro 2026:aliquota_gestione_separata_altra_copertura",
      "parametro 2026:minimale_inps_artigiani_commercianti",
    ],
    "l'elenco dei dati non confermati è cambiato: aggiornare questa attesa se il cambiamento è voluto",
  );

  // Ogni voce non verificata deve portare una spiegazione.
  assert.ok(elenco.every((voce) => voce.nota && voce.nota.length > 20));
});

test("nessuna regola resta non verificata senza dirlo", () => {
  // Dopo la ricerca sulle fonti tutte le regole risultano confermate, e le
  // festività nazionali hanno smesso di essere un'eccezione.
  const nonVerificate = config.regole.filter(
    (regola) => (regola.stato_verifica ?? "verificato") !== "verificato",
  );
  assert.deepEqual(
    nonVerificate.map((regola) => regola.id),
    [],
    "ci sono regole non confermate: vanno dichiarate sulla pagina e spiegate con una nota",
  );
});

test("la norma sullo slittamento e i mesi delle rate sono verificati", () => {
  // Chiusi il 2026-09-15 sull'art. 18 del D.Lgs. 241/1997: il primo comma per lo
  // slittamento di sabato o festivo, il secondo per i mesi delle rate.
  for (const id of ["slittamento_giorno_non_lavorativo", "rate_trimestrali_inps"]) {
    const regola = config.regole.find((r) => r.id === id);
    assert.ok(regola, `regola ${id} assente`);
    assert.equal(regola.stato_verifica, "verificato", `${id} deve risultare verificato`);
    assert.match(regola.fonte_url, /decreto\.legislativo:1997-07-09;241~art18/, `${id}: URL art. 18`);
    assert.ok(regola.estratto_verificato.length > 20, `${id}: estratto mancante`);
  }
});

test("una regola dichiarata non verificata deve spiegare l'incertezza", () => {
  // Il controllo vive nel validatore, quindi si prova su una configurazione
  // costruita apposta: così il test resta valido anche quando i dati reali
  // migliorano, come è successo con le festività nazionali.
  const rotta = JSON.parse(JSON.stringify(config)) as Regole;
  const regola = rotta.regole.find((r) => r.id === "festivi_nazionali");
  assert.ok(regola);
  regola.stato_verifica = "da_verificare";
  regola.nota = "";

  const errori = verificaConfigurazione(rotta);
  assert.ok(
    errori.some((errore) => errore.includes("festivi_nazionali")),
    "una regola non verificata senza nota deve far fallire la validazione",
  );
});
