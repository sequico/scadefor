import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dataUtc,
  dentroPeriodo,
  festiviDellAnno,
  motivoNonLavorativo,
  pasqua,
  prossimoGiornoLavorativo,
} from "../src/date.ts";

const FESTIVI = {
  festivi_fissi: [
    { giorno: 1, mese: 1, denominazione: "Capodanno" },
    { giorno: 2, mese: 6, denominazione: "Festa della Repubblica" },
    { giorno: 25, mese: 12, denominazione: "Natale" },
  ],
  festivi_mobili: [{ tipo: "lunedi_di_pasqua", denominazione: "Lunedì dell'Angelo" }],
};

test("pasqua calcola le date corrette per anni noti", () => {
  const casi: [number, string][] = [
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
  ];
  for (const [anno, atteso] of casi) {
    assert.equal(pasqua(anno).toISOString().slice(0, 10), atteso, `pasqua ${anno}`);
  }
});

test("il lunedì di Pasqua entra nel calendario dei festivi", () => {
  const festivi = festiviDellAnno(2026, FESTIVI);
  assert.equal(festivi.get("2026-04-06"), "Lunedì dell'Angelo");
});

test("sabato e domenica non sono giorni lavorativi", () => {
  assert.equal(motivoNonLavorativo(dataUtc(2026, 5, 16), new Map()), "sabato");
  assert.equal(motivoNonLavorativo(dataUtc(2026, 5, 17), new Map()), "domenica");
  assert.equal(motivoNonLavorativo(dataUtc(2026, 5, 18), new Map()), undefined);
});

test("prossimoGiornoLavorativo salta il fine settimana e i festivi", () => {
  const festivi = festiviDellAnno(2026, FESTIVI);
  // Il 16 maggio 2026 è sabato: la rata INPS slitta al lunedì 18.
  assert.equal(
    prossimoGiornoLavorativo(dataUtc(2026, 5, 16), festivi).toISOString().slice(0, 10),
    "2026-05-18",
  );
  // Il 2 giugno 2026 (festa della Repubblica) cade di martedì: slitta al 3.
  assert.equal(
    prossimoGiornoLavorativo(dataUtc(2026, 6, 2), festivi).toISOString().slice(0, 10),
    "2026-06-03",
  );
});

test("dentroPeriodo gestisce gli estremi inclusi e i periodi a cavallo d'anno", () => {
  const inizio = { giorno: 1, mese: 8 };
  const fine = { giorno: 20, mese: 8 };

  assert.ok(dentroPeriodo(dataUtc(2026, 8, 1), inizio, fine));
  assert.ok(dentroPeriodo(dataUtc(2026, 8, 20), inizio, fine));
  assert.ok(!dentroPeriodo(dataUtc(2026, 8, 21), inizio, fine));
  assert.ok(!dentroPeriodo(dataUtc(2026, 7, 31), inizio, fine));

  assert.ok(dentroPeriodo(dataUtc(2026, 12, 30), { giorno: 20, mese: 12 }, { giorno: 10, mese: 1 }));
  assert.ok(dentroPeriodo(dataUtc(2026, 1, 5), { giorno: 20, mese: 12 }, { giorno: 10, mese: 1 }));
  assert.ok(!dentroPeriodo(dataUtc(2026, 6, 1), { giorno: 20, mese: 12 }, { giorno: 10, mese: 1 }));
});
