import assert from "node:assert/strict";
import { test } from "node:test";

import { analizzaCalendario, escapeTesto, piegaRiga, serializzaCalendario } from "../src/ics.ts";

test("escapeTesto protegge i caratteri riservati del testo iCalendar", () => {
  assert.equal(escapeTesto("a;b"), "a\\;b");
  assert.equal(escapeTesto("a,b"), "a\\,b");
  assert.equal(escapeTesto("a\\b"), "a\\\\b");
  assert.equal(escapeTesto("a\nb"), "a\\nb");
  // The backslash must be handled first, otherwise the escapes added later
  // would themselves be escaped again.
  assert.equal(escapeTesto("a\\;b"), "a\\\\\\;b");
});

test("piegaRiga non supera mai i 75 ottetti", () => {
  const riga = "DESCRIPTION:" + "parola ".repeat(60).trim();
  const piegata = piegaRiga(riga);
  for (const pezzo of piegata.split("\r\n")) {
    assert.ok(
      Buffer.byteLength(pezzo, "utf8") <= 75,
      `riga di ${Buffer.byteLength(pezzo, "utf8")} ottetti`,
    );
  }
});

test("piegaRiga non spezza i caratteri multi-byte", () => {
  // 30 emoji, 4 byte ciascuna: un taglio ingenuo a 75 byte produrrebbe
  // sequenze UTF-8 invalide.
  const riga = "SUMMARY:" + "🥐".repeat(30);
  const piegata = piegaRiga(riga);
  assert.ok(!piegata.includes("\uFFFD"));
  const ricomposta = piegata
    .split("\r\n")
    .map((pezzo, indice) => (indice === 0 ? pezzo : pezzo.slice(1)))
    .join("");
  assert.equal(ricomposta, riga);
});

test("serializzaCalendario usa CRLF e i valori DATE per gli eventi a giornata intera", () => {
  const contenuto = serializzaCalendario({
    nome: "Prova",
    descrizione: "Descrizione",
    prodId: "-//prova//IT",
    eventi: [
      {
        uid: "a@example.org",
        data: new Date(Date.UTC(2026, 5, 30)),
        titolo: "Scadenza",
        descrizione: "Corpo",
        sequenza: 0,
        ultimaModifica: new Date(Date.UTC(2026, 0, 1)),
        timestamp: new Date(Date.UTC(2026, 0, 1)),
        allarmi: [{ trigger: "-P15D", descrizione: "Scadenza" }],
      },
    ],
  });

  assert.ok(contenuto.endsWith("\r\n"));
  assert.ok(contenuto.includes("DTSTART;VALUE=DATE:20260630\r\n"));
  assert.ok(contenuto.includes("DTEND;VALUE=DATE:20260701\r\n"));
  assert.ok(contenuto.includes("BEGIN:VALARM\r\n"));
});

test("analizzaCalendario ignora le proprietà volatili nel corpo confrontabile", () => {
  const costruisci = (timestamp: string, sequenza: number, titolo: string) =>
    serializzaCalendario({
      nome: "N",
      descrizione: "D",
      prodId: "p",
      eventi: [
        {
          uid: "x@example.org",
          data: new Date(Date.UTC(2026, 0, 1)),
          titolo,
          descrizione: "corpo",
          sequenza,
          ultimaModifica: new Date(Date.UTC(2026, 0, 1)),
          timestamp: new Date(Date.parse(timestamp)),
          allarmi: [],
        },
      ],
    });

  const a = analizzaCalendario(costruisci("2026-01-01T00:00:00Z", 0, "Titolo"));
  const b = analizzaCalendario(costruisci("2026-09-15T10:00:00Z", 7, "Titolo"));
  const c = analizzaCalendario(costruisci("2026-01-01T00:00:00Z", 0, "Altro"));

  assert.equal(a.get("x@example.org")?.corpo, b.get("x@example.org")?.corpo);
  assert.notEqual(a.get("x@example.org")?.corpo, c.get("x@example.org")?.corpo);
  assert.equal(b.get("x@example.org")?.sequenza, 7);
});
