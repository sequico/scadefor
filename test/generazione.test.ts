import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { costruisciCalendarioProfilo, nomeFileAnno, verificaIntervalloAnni } from "../src/generazione.ts";
import { serializzaCalendario, analizzaCalendario, srotola, type EventoIcs } from "../src/ics.ts";
import { costruisciEventi, type EventoGenerato } from "../src/motore.ts";
import type { Parametri, Regole } from "../src/tipi.ts";
import { validaCalendario } from "../src/validazione-ics.ts";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(radice, "regole.json"), "utf8")) as Regole;
const parametri = JSON.parse(readFileSync(join(radice, "parametri.json"), "utf8")) as Parametri;

const ISTANTE_A = new Date(Date.UTC(2026, 8, 15, 6, 0, 0));
const ISTANTE_B = new Date(Date.UTC(2026, 10, 1, 9, 30, 0));

function eventi(anni: number[]): EventoGenerato[] {
  return costruisciEventi({ config, parametri, anni, dataGenerazione: ISTANTE_A });
}

const profilo = config.profili.find((p) => p.id === "artigiani-ridotto-35");
assert.ok(profilo);

test("un contenuto invariato produce un file identico, senza churn di timestamp", () => {
  const primo = costruisciCalendarioProfilo(profilo, eventi([2026, 2027]), config, null, ISTANTE_A);
  const secondo = costruisciCalendarioProfilo(profilo, eventi([2026, 2027]), config, primo, ISTANTE_B);
  assert.equal(secondo, primo);
});

test("un contenuto modificato incrementa SEQUENCE solo per l'evento cambiato", () => {
  const base = eventi([2026, 2027]);
  const primo = costruisciCalendarioProfilo(profilo, base, config, null, ISTANTE_A);

  const modificati = base.map((evento) =>
    evento.regola_id === "saldo_primo_acconto"
      ? { ...evento, descrizione: `${evento.descrizione}\n\nAGGIUNTA DI PROVA` }
      : evento,
  );

  const secondo = costruisciCalendarioProfilo(profilo, modificati, config, primo, ISTANTE_B);

  const dopo = analizzaCalendario(secondo);
  const chiave = (regola: string, slot: string) =>
    `2026-${regola}-${slot}-artigiani-ridotto-35@sequico.github.io`;

  assert.equal(
    analizzaCalendario(primo).get(chiave("saldo_primo_acconto", "0630"))?.sequenza,
    0,
    "la run iniziale parte da SEQUENCE 0",
  );
  assert.equal(
    dopo.get(chiave("saldo_primo_acconto", "0630"))?.sequenza,
    1,
    "l'evento modificato deve passare a SEQUENCE 1",
  );
  assert.equal(
    dopo.get(chiave("secondo_acconto", "1130"))?.sequenza,
    0,
    "un evento intatto non deve incrementare SEQUENCE",
  );
});

test("il calendario generato è conforme a RFC 5545", () => {
  const contenuto = costruisciCalendarioProfilo(profilo, eventi([2026, 2027]), config, null, ISTANTE_A);
  assert.deepEqual(validaCalendario(contenuto), []);
});

test("il validatore riconosce un UID duplicato", () => {
  const evento: EventoIcs = {
    uid: "stesso@example.org",
    data: new Date(Date.UTC(2026, 0, 16)),
    titolo: "Prova",
    descrizione: "Corpo",
    sequenza: 0,
    ultimaModifica: ISTANTE_A,
    timestamp: ISTANTE_A,
    allarmi: [{ trigger: "-P3D", descrizione: "Prova" }],
  };

  const contenuto = serializzaCalendario({
    nome: "N",
    descrizione: "D",
    prodId: "-//prova//IT",
    eventi: [evento, { ...evento, data: new Date(Date.UTC(2026, 4, 16)) }],
  });

  assert.ok(validaCalendario(contenuto).some((problema) => problema.includes("UID duplicato")));
});

test("il validatore riconosce un evento senza DTEND e uno senza VALARM", () => {
  const senzaDtend = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//prova//IT",
    "BEGIN:VEVENT",
    "UID:x@example.org",
    "DTSTAMP:20260915T060000Z",
    "DTSTART;VALUE=DATE:20260630",
    "SUMMARY:Prova",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  assert.ok(validaCalendario(senzaDtend).some((p) => p.includes("manca DTEND")));

  const senzaValarm = costruisciCalendarioProfilo(
    profilo,
    eventi([2026]).map((e) => ({ ...e, promemoria_giorni: [] })),
    config,
    null,
    ISTANTE_A,
  );
  assert.ok(validaCalendario(senzaValarm).some((p) => p.includes("nessun VALARM")));
});

test("il validatore riconosce una riga troppo lunga", () => {
  const contenuto = costruisciCalendarioProfilo(profilo, eventi([2026]), config, null, ISTANTE_A);
  const guasto = contenuto.replace("BEGIN:VCALENDAR", `X-LUNGA:${"a".repeat(120)}`);
  assert.ok(validaCalendario(guasto).some((problema) => problema.includes("oltre il limite")));
});

test("i file per anno contengono un solo anno e insieme ricompongono il file completo", () => {
  const tutti = eventi([2026, 2027]);
  const miei = tutti.filter((e) => e.profilo_id === "artigiani-ridotto-35");

  const perAnno = [2026, 2027].map((anno) => {
    const delAnno = miei.filter((e) => e.anno === anno);
    return {
      anno,
      contenuto: costruisciCalendarioProfilo(profilo, delAnno, config, null, ISTANTE_A, {
        suffissoNome: ` — anno ${anno}`,
        notaScaricato: true,
      }),
      attesi: delAnno.length,
    };
  });

  for (const { anno, contenuto, attesi } of perAnno) {
    const date = [...contenuto.matchAll(/DTSTART;VALUE=DATE:(\d{4})/g)].map((m) => Number(m[1]));
    assert.equal(date.length, attesi, `anno ${anno}: numero di eventi inatteso`);
    assert.ok(
      date.every((a) => a === anno),
      `il file ${anno} contiene date di altri anni: ${[...new Set(date)].join(", ")}`,
    );

    // Le righe lunghe sono piegate a 75 ottetti: per cercare una frase dentro
    // una proprietà va prima srotolata, altrimenti la ricerca fallisce senza che
    // il contenuto sia sbagliato.
    const disteso = srotola(contenuto).join("\n");
    assert.ok(disteso.includes(`anno ${anno}`), `manca l'anno nel nome del calendario`);
    assert.ok(
      disteso.includes("fotografia statica"),
      "il file scaricato deve dichiarare di non aggiornarsi da solo",
    );
  }

  const totale = perAnno.reduce((somma, voce) => somma + voce.attesi, 0);
  assert.equal(totale, miei.length, "i file per anno devono coprire tutti gli eventi del profilo");
});

test("il file completo dichiara invece di aggiornarsi da solo", () => {
  const contenuto = costruisciCalendarioProfilo(
    profilo,
    eventi([2026, 2027]).filter((e) => e.profilo_id === profilo.id),
    config,
    null,
    ISTANTE_A,
  );
  const disteso = srotola(contenuto).join("\n");

  assert.ok(disteso.includes("si aggiorna automaticamente"));
  assert.ok(!disteso.includes("fotografia statica"));
  // E il nome resta quello stabile, perché è l'indirizzo di iscrizione.
  assert.ok(disteso.includes(profilo.nome_calendario));
});

test("il nome del file per anno si ricava dal nome del profilo", () => {
  assert.equal(nomeFileAnno(profilo, 2026), "artigiani-ridotto-35-2026.ics");
  assert.equal(nomeFileAnno(profilo, 2027), "artigiani-ridotto-35-2027.ics");
});

test("la pagina offre sia l'iscrizione sia il download per anno", () => {
  const html = readFileSync(join(radice, "public", "index.html"), "utf8");
  for (const p of config.profili) {
    assert.ok(
      html.includes(`webcal://${config.metadati.dominio}/${p.file}`),
      `manca il link di iscrizione per ${p.id}`,
    );
    for (const anno of [2026, 2027]) {
      assert.ok(
        html.includes(`href="${nomeFileAnno(p, anno)}"`),
        `manca il link di scaricamento ${anno} per ${p.id}`,
      );
    }
  }
  assert.ok(html.includes("Iscriviti al calendario"));
  assert.ok(html.includes("Dinamico") && html.includes("Statico"));
});

test("il guardiano dell'intervallo respinge una scadenza di un anno passato", () => {
  const fuori: EventoGenerato[] = [
    {
      regola_id: "saldo_primo_acconto",
      profilo_id: "artigiani-ridotto-35",
      uid: "x",
      anno: 2024,
      data: new Date(Date.UTC(2024, 5, 30)),
      data_ordinaria: new Date(Date.UTC(2024, 5, 30)),
      titolo: "T",
      descrizione: "D",
      promemoria_giorni: [15, 3],
    },
  ];

  assert.throws(
    () => verificaIntervalloAnni(fuori, { dal: 2026, al: 2027 }),
    /fuori dall'intervallo/,
    "una scadenza del 2024 non deve poter finire in calendario",
  );
});

test("il guardiano non si lascia allargare dall'elenco degli anni da generare", () => {
  // Questo era il difetto: l'intervallo ammesso veniva ricavato dagli stessi
  // anni passati alla generazione, quindi `--anni=2020,2021` lo allargava e il
  // controllo non scattava mai. Ora l'intervallo è un parametro calcolato
  // dall'anno corrente.
  const eventi2020: EventoGenerato[] = [
    {
      regola_id: "saldo_primo_acconto",
      profilo_id: "artigiani-ridotto-35",
      uid: "y",
      anno: 2020,
      data: new Date(Date.UTC(2020, 5, 30)),
      data_ordinaria: new Date(Date.UTC(2020, 5, 30)),
      titolo: "T",
      descrizione: "D",
      promemoria_giorni: [15, 3],
    },
  ];

  assert.throws(() => verificaIntervalloAnni(eventi2020, { dal: 2026, al: 2027 }), /2020/);
  assert.throws(() => verificaIntervalloAnni([], { dal: 2027, al: 2026 }), /non valido/);
});

test("lo sconfinamento a gennaio dell'anno dopo è ammesso, uno a febbraio no", () => {
  const evento = (iso: string): EventoGenerato => ({
    regola_id: "saldo_primo_acconto",
    profilo_id: "artigiani-ridotto-35",
    uid: iso,
    anno: Number(iso.slice(0, 4)),
    data: new Date(`${iso}T00:00:00Z`),
    data_ordinaria: new Date(`${iso}T00:00:00Z`),
    titolo: "T",
    descrizione: "D",
    promemoria_giorni: [15, 3],
  });

  assert.doesNotThrow(() =>
    verificaIntervalloAnni([evento("2028-01-03")], { dal: 2026, al: 2027 }),
  );
  assert.throws(
    () => verificaIntervalloAnni([evento("2028-02-03")], { dal: 2026, al: 2027 }),
    /fuori dall'intervallo/,
  );
});

test("ogni promemoria pubblicato è una DURATION valida", () => {
  // Il difetto era `-P-15D`: il dato conteneva giorni negativi e il
  // serializzatore ne aggiungeva un altro. I client severi scartano il VALARM,
  // quindi i promemoria non sarebbero mai scattati.
  const contenuto = costruisciCalendarioProfilo(profilo, eventi([2026]), config, null, ISTANTE_A);
  const trigger = [...contenuto.matchAll(/^TRIGGER:(.+)$/gm)].map((m) => m[1].trim());

  assert.ok(trigger.length > 0, "nessun promemoria generato");
  for (const valore of trigger) {
    assert.match(valore, /^-[PT]|^-[+-]?P/, `forma inattesa: ${valore}`);
    assert.ok(!/^[-+]?P-/.test(valore), `segno doppio nella DURATION: ${valore}`);
  }
  assert.ok(trigger.includes("-P15D"), "atteso il promemoria a 15 giorni");
  assert.ok(trigger.includes("-P3D"), "atteso il promemoria a 3 giorni");
});

test("un TRIGGER malformato viene riconosciuto dal validatore", () => {
  const contenuto = costruisciCalendarioProfilo(profilo, eventi([2026]), config, null, ISTANTE_A);
  const guasto = contenuto.replace("TRIGGER:-P15D", "TRIGGER:-P-15D");
  assert.notEqual(guasto, contenuto, "la sostituzione non ha morso");
  assert.ok(
    validaCalendario(guasto).some((problema) => problema.includes("TRIGGER non è una DURATION")),
  );
});

test("una proroga sposta solo la scadenza a cui si riferisce", () => {
  // Le quattro rate INPS condividono la regola e l'anno: senza il confronto
  // sulla data, un differimento di maggio avrebbe spostato anche febbraio,
  // agosto e novembre.
  const conProroga = costruisciEventi({
    config,
    parametri,
    anni: [2026],
    dataGenerazione: ISTANTE_A,
    proroghe: [
      {
        scadenza: "rate_trimestrali_inps",
        data_originale: "2026-05-16",
        data_nuova: "2026-06-30",
        fonte_url: "https://example.org/proroga",
        estratto_testuale: "estratto di prova",
      },
    ],
  }).filter((e) => e.profilo_id === "artigiani-ridotto-35" && e.regola_id === "rate_trimestrali_inps");

  const date = conProroga.map((e) => e.data.toISOString().slice(0, 10)).sort();
  assert.deepEqual(date, ["2026-02-16", "2026-06-30", "2026-08-20", "2026-11-16"]);
  assert.ok(
    conProroga.find((e) => e.data.toISOString().startsWith("2026-06-30"))?.descrizione.includes("ATTENZIONE PROROGA"),
    "la scadenza prorogata deve dichiarare la proroga",
  );
  assert.ok(
    !conProroga.find((e) => e.data.toISOString().startsWith("2026-11-16"))?.descrizione.includes("ATTENZIONE PROROGA"),
    "una scadenza non prorogata non deve dichiarare proroghe",
  );
});

test("i calendari pubblicati superano la validazione", () => {
  for (const p of config.profili) {
    const percorso = join(radice, "public", p.file);
    let contenuto: string;
    try {
      contenuto = readFileSync(percorso, "utf8");
    } catch {
      continue; // artefatto non ancora generato in questo ambiente
    }
    assert.deepEqual(validaCalendario(contenuto), [], `${p.file} non valido`);
  }
});

test("i calendari pubblicati non contengono anni precedenti a quello corrente", () => {
  for (const p of config.profili) {
    let contenuto: string;
    try {
      contenuto = readFileSync(join(radice, "public", p.file), "utf8");
    } catch {
      continue;
    }
    const anni = [...contenuto.matchAll(/DTSTART;VALUE=DATE:(\d{4})/g)].map((m) => Number(m[1]));
    assert.ok(anni.length > 0, `${p.file} non contiene eventi`);
    assert.ok(Math.min(...anni) >= 2026, `${p.file} contiene anni passati: ${Math.min(...anni)}`);
  }
});
