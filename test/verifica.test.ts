import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { campiDaVerificareManualmente, fontiVerificateAMano } from "../src/motore.ts";
import type { Parametri, Regole } from "../src/tipi.ts";
import {
  dominiAmmessiCorrenti,
  impostaDominiAmmessi,
  leggiFonte,
  normalizza,
} from "../src/verifica-web.ts";
import {
  caricaFonti,
  dominiPerLaVerifica,
  numeroPresenteNellEstratto,
} from "../verificaFonti.ts";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;
const parametri = JSON.parse(readFileSync(join(radice, "parametri.json"), "utf8")) as Parametri;

/* ---------------- host interni ---------------- */

test("gli host interni e di loopback vengono rifiutati prima di qualunque richiesta", async () => {
  // La prova è nel codice: il rifiuto avviene prima del fetch, quindi il test
  // non tocca la rete ed è deterministico.
  const vietati = [
    "http://127.0.0.1:8765/x",
    "http://localhost/x",
    "http://[::1]/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/x",
    "http://172.16.4.1/x",
    "http://192.168.1.1/x",
    "http://0.0.0.0/x",
    "http://metadati.internal/x",
  ];

  for (const url of vietati) {
    const esito = await leggiFonte(url);
    assert.equal(esito.testo, null, `${url} non deve essere leggibile`);
    assert.equal(esito.motivo, "url_non_valido", `${url}: motivo inatteso`);
    assert.match(esito.dettaglio ?? "", /bloccata/, `${url}: manca la spiegazione del blocco`);
  }
});

test("file:// e schemi non http restano rifiutati", async () => {
  const esito = await leggiFonte("file:///etc/passwd");
  assert.equal(esito.testo, null);
  assert.equal(esito.motivo, "url_non_valido");
});

/* ---------------- elenco dei domini ammessi ---------------- */

test("l'elenco dei domini ammessi deriva dalle fonti dichiarate e da quelle in uso", () => {
  const domini = dominiPerLaVerifica(caricaFonti(radice), config, parametri);

  assert.ok(domini.includes("normattiva.it"), "normattiva.it deve essere ammesso");
  assert.ok(domini.includes("agenziaentrate.gov.it"), "agenziaentrate.gov.it deve essere ammesso");
  assert.ok(domini.includes("inps.it"), "inps.it deve essere ammesso");

  // I domini effettivamente citati finiscono nell'elenco, così una fonte già
  // pubblicata non smette di funzionare.
  for (const regola of config.regole) {
    if (!regola.fonte_url) continue;
    const host = new URL(regola.fonte_url).hostname.toLowerCase();
    assert.ok(domini.includes(host), `manca il dominio di una fonte in uso: ${host}`);
  }
});

test("con un elenco impostato, un host estraneo viene rifiutato", async () => {
  impostaDominiAmmessi(["normattiva.it"]);
  assert.deepEqual(dominiAmmessiCorrenti(), ["normattiva.it"]);

  const esito = await leggiFonte("http://example.org/pagina");
  assert.equal(esito.testo, null);
  assert.equal(esito.motivo, "url_non_valido");
  assert.match(esito.dettaglio ?? "", /non presente nell'elenco/);
});

test("impostaDominiAmmessi normalizza schema, percorso e maiuscole", () => {
  impostaDominiAmmessi([
    "https://www.Normattiva.it/qualcosa",
    " inps.it ",
    "",
  ]);
  assert.deepEqual(dominiAmmessiCorrenti(), ["www.normattiva.it", "inps.it"]);
  impostaDominiAmmessi([]);
});

/* ---------------- valore dentro l'estratto ---------------- */

test("un numero deve comparire nell'estratto, e non come parte di un altro numero", () => {
  assert.ok(numeroPresenteNellEstratto(1, "il giorno 1 del mese"));

  // 3 non deve passare grazie a un 30 qualsiasi
  assert.ok(!numeroPresenteNellEstratto(3, "la scadenza è il 30 giugno"));
  assert.ok(numeroPresenteNellEstratto(30, "la scadenza è il 30 giugno"));
});

test("i numeri con separatori italiani sono riconosciuti", () => {
  assert.ok(numeroPresenteNellEstratto(18808, "il minimale è 18.808,00 euro"));
  assert.ok(numeroPresenteNellEstratto(18808, "pari a 18808 euro"));
  assert.ok(!numeroPresenteNellEstratto(18808, "pari a 18.809 euro"));
});

test("una quota decimale è riconosciuta anche nella forma percentuale", () => {
  // Il dato è 0.2448 ma la fonte scrive "24,48%".
  assert.ok(numeroPresenteNellEstratto(0.2448, "risultano il 24,48% per i commercianti"));
  assert.ok(!numeroPresenteNellEstratto(0.2448, "risultano il 25,00% per i commercianti"));
});

test("la normalizzazione condivisa rende confrontabili testo e citazione", () => {
  assert.equal(normalizza("Imposta ,   nella misura del 15 %"), "imposta, nella misura del 15%");
  assert.equal(normalizza("l’articolo  …  1º"), "l'articolo … 1º");
});

/* ---------------- stato delle fonti ---------------- */

test("le fonti verificate a mano sono distinte da quelle non confermate", () => {
  const aMano = fontiVerificateAMano(config, parametri);
  const dubbi = campiDaVerificareManualmente(config, parametri);

  const campiAMano = aMano.map((voce) => voce.campo);
  const campiDubbi = dubbi.map((voce) => voce.campo);

  // La ripartizione 50/50 è confermata sulla risoluzione 93/E/2019, che è un
  // PDF: solida, ma non ricontrollabile automaticamente. Deve stare fra le
  // "a mano", non fra i dubbi.
  assert.ok(campiAMano.some((campo) => campo.includes("ripartizione dell'acconto")));
  assert.ok(!campiDubbi.some((campo) => campo.includes("ripartizione dell'acconto")));

  // E i due elenchi non devono sovrapporsi.
  for (const campo of campiAMano) {
    assert.ok(!campiDubbi.includes(campo), `${campo} compare in entrambi gli elenchi`);
  }
});
