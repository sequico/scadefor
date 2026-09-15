import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { verificaConfigurazione } from "../src/motore.ts";
import type { Regole } from "../src/tipi.ts";
import { serializzaSnapshot } from "../verificaFonti.ts";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const regole = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;

test("lo snapshot contiene lo stato PRECEDENTE, non quello modificato", () => {
  // Riproduce esattamente l'ordine reale: si clona, poi si muta l'oggetto vivo
  // (come fa l'applicazione delle modifiche), poi si serializza il clone.
  const vivo = structuredClone(regole);
  const prima = structuredClone(vivo);

  const giornale = vivo.regole.find((r) => r.id === "secondo_acconto");
  assert.ok(giornale);
  assert.equal(giornale.giorno, 30);
  giornale.giorno = 18;

  const istante = new Date(Date.UTC(2026, 9, 1, 6, 0, 0));
  const snapshot = serializzaSnapshot(
    prima,
    [
      {
        id: "secondo_acconto",
        campo_modificato: "giorno",
        valore_precedente: 30,
        valore_nuovo: 18,
        fonte_url: "https://example.org/fonte",
      },
    ],
    [],
    "modello-di-prova",
    istante,
  );

  const letto = JSON.parse(snapshot) as Regole & { _meta: Record<string, unknown> };
  const nelSnapshot = letto.regole.find((r) => r.id === "secondo_acconto");

  assert.equal(nelSnapshot?.giorno, 30, "lo snapshot deve contenere il valore vecchio");
  assert.notEqual(nelSnapshot?.giorno, 18, "lo snapshot non deve contenere il valore nuovo");
  assert.equal(letto._meta.istante, istante.toISOString());
  assert.equal(letto._meta.modello, "modello-di-prova");
});

test("lo snapshot resta immutabile dopo che lo stato vivo cambia ancora", () => {
  const vivo = structuredClone(regole);
  const prima = structuredClone(vivo);
  const snapshot = serializzaSnapshot(prima, [], [], null, new Date());

  const regola = vivo.regole.find((r) => r.id === "saldo_primo_acconto");
  assert.ok(regola);
  regola.mese = 12;

  const letto = JSON.parse(snapshot) as Regole;
  assert.equal(
    letto.regole.find((r) => r.id === "saldo_primo_acconto")?.mese,
    6,
    "una mutazione successiva non deve toccare uno snapshot già creato",
  );
});

test("uno snapshot valido resta un regole.json ripristinabile", () => {
  const prima = structuredClone(regole);
  const snapshot = serializzaSnapshot(prima, [], [], null, new Date());
  const letto = JSON.parse(snapshot) as Regole & { _meta: unknown };

  // Il ripristino deve funzionare: tutte le chiavi originali ci sono, con lo
  // stesso contenuto. `_meta` è l'unica aggiunta, ed è il registro della run.
  for (const chiave of Object.keys(regole)) {
    assert.ok(chiave in letto, `chiave mancante nello snapshot: ${chiave}`);
    assert.deepEqual(
      (letto as Record<string, unknown>)[chiave],
      (regole as Record<string, unknown>)[chiave],
      `contenuto diverso per ${chiave}`,
    );
  }
  assert.deepEqual(Object.keys(letto).sort(), [...Object.keys(regole), "_meta"].sort());

  // La prova che conta: la configurazione ripristinata è ancora valida per il
  // motore, quindi lo snapshot è davvero utilizzabile, non solo scritto.
  assert.deepEqual(verificaConfigurazione(letto), []);
});
