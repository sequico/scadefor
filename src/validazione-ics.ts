/**
 * Validatore iCalendar (RFC 5545) senza dipendenze.
 *
 * Non è un parser completo: verifica le regole la cui violazione fa sparire o
 * corrompere gli eventi nei client di calendario, cioè esattamente ciò che in
 * questo progetto non deve accadere in silenzio.
 *
 * Restituisce un elenco di problemi; elenco vuoto significa valido.
 */

import { aggiungiGiorni } from "./date.ts";
import { srotola } from "./ics.ts";

/** RFC 5545 §3.1: le righe non dovrebbero superare i 75 ottetti, escluso l'a-capo. */
const LIMITE_OCTET = 75;

/** RFC 5545 §3.3.6: dur-value = ["+"|"-"] "P" (dur-date / dur-time / dur-week). */
const DURATION_VALIDA = /^[+-]?P(?:\d+W|\d+D(?:T\d+H(?:\d+M(?:\d+S)?)?)?|T\d+H(?:\d+M(?:\d+S)?)?|\d+D)$/;

/** RFC 5545 §3.3.4: DATE = 8 digits. */
const DATA_VALIDA = /^\d{8}$/;

/** RFC 5545 §3.3.5: DATE-TIME in UTC = 8 digits, T, 6 digits, Z. */
const DATAORA_VALIDA = /^\d{8}T\d{6}Z$/;

export function validaCalendario(contenuto: string): string[] {
  const problemi: string[] = [];
  const righeGrezze = contenuto.split("\r\n");

  if (!contenuto.endsWith("\r\n")) {
    problemi.push("Il file non termina con CRLF.");
  }

  // Only bare LF is a violation: a CRLF split leaves no empty trailing element
  // beyond the final one produced by the terminating CRLF.
  const righeNonCrLf = contenuto.split("\n").length - 1 - (contenuto.split("\r\n").length - 1);
  if (righeNonCrLf > 0) {
    problemi.push(`Trovati ${righeNonCrLf} a-capo senza CR (atteso CRLF).`);
  }

  for (const [indice, riga] of righeGrezze.entries()) {
    if (riga === "") continue;
    const ottetti = Buffer.byteLength(riga, "utf8");
    if (ottetti > LIMITE_OCTET) {
      problemi.push(`Riga ${indice + 1}: ${ottetti} ottetti, oltre il limite di ${LIMITE_OCTET}.`);
    }
  }

  const righe = srotola(contenuto).filter((riga) => riga !== "");

  if (righe[0] !== "BEGIN:VCALENDAR") {
    problemi.push("Il file non inizia con BEGIN:VCALENDAR.");
  }
  if (righe[righe.length - 1] !== "END:VCALENDAR") {
    problemi.push("Il file non termina con END:VCALENDAR.");
  }

  const proprietaObbligatorie = ["VERSION", "PRODID"];
  for (const proprieta of proprietaObbligatorie) {
    if (!righe.some((riga) => riga.startsWith(`${proprieta}:`))) {
      problemi.push(`Proprietà obbligatoria mancante: ${proprieta}.`);
    }
  }

  // Bilanciamento dei blocchi.
  const pila: string[] = [];
  for (const riga of righe) {
    if (riga.startsWith("BEGIN:")) pila.push(riga.slice(6).trim());
    else if (riga.startsWith("END:")) {
      const atteso = pila.pop();
      const trovato = riga.slice(4).trim();
      if (atteso !== trovato) {
        problemi.push(`Blocco non bilanciato: atteso END:${atteso ?? "?"}, trovato END:${trovato}.`);
      }
    }
  }
  if (pila.length > 0) {
    problemi.push(`Blocchi non chiusi: ${pila.join(", ")}.`);
  }

  // Analisi per evento.
  const uidVisti = new Set<string>();
  let dentroEvento = false;
  let evento: { uid?: string; dtstart?: string; dtend?: string; summary?: string; valarm: number } = {
    valarm: 0,
  };
  let numeroEvento = 0;

  for (const riga of righe) {
    if (riga === "BEGIN:VEVENT") {
      dentroEvento = true;
      numeroEvento += 1;
      evento = { valarm: 0 };
      continue;
    }
    if (riga === "END:VEVENT") {
      dentroEvento = false;
      const etichetta = `Evento ${numeroEvento}${evento.uid ? ` (${evento.uid})` : ""}`;

      for (const campo of ["uid", "dtstart", "summary"] as const) {
        if (!evento[campo]) problemi.push(`${etichetta}: manca ${campo.toUpperCase()}.`);
      }
      if (!evento.dtend) {
        problemi.push(`${etichetta}: manca DTEND (gli eventi a giornata intera ne hanno bisogno).`);
      }
      if (evento.uid) {
        if (uidVisti.has(evento.uid)) {
          problemi.push(`${etichetta}: UID duplicato — i client ne perderebbero uno.`);
        }
        uidVisti.add(evento.uid);
      }
      if (evento.valarm === 0) {
        problemi.push(`${etichetta}: nessun VALARM.`);
      }

      // DTEND di un evento a giornata intera deve essere il giorno successivo.
      const giornoInizio = /DTSTART;VALUE=DATE:([^\r\n]+)/.exec(evento.dtstart ?? "")?.[1]?.trim();
      const giornoFine = /DTEND;VALUE=DATE:([^\r\n]+)/.exec(evento.dtend ?? "")?.[1]?.trim();
      if (giornoInizio && giornoFine) {
        const atteso = aggiungiGiorni(
          new Date(
            Date.UTC(
              Number(giornoInizio.slice(0, 4)),
              Number(giornoInizio.slice(4, 6)) - 1,
              Number(giornoInizio.slice(6, 8)),
            ),
          ),
          1,
        );
        const attesoTesto = `${atteso.getUTCFullYear()}${String(atteso.getUTCMonth() + 1).padStart(2, "0")}${String(atteso.getUTCDate()).padStart(2, "0")}`;
        if (giornoFine !== attesoTesto) {
          problemi.push(
            `${etichetta}: DTEND ${giornoFine} non è il giorno successivo a DTSTART ${giornoInizio}.`,
          );
        }
      }
      continue;
    }

    if (!dentroEvento) {
      if (/^(DTSTART|DTEND|SUMMARY|DESCRIPTION|UID)/.test(riga)) {
        problemi.push(`Proprietà di evento fuori da un VEVENT: ${riga.slice(0, 30)}…`);
      }
      continue;
    }

    if (riga.startsWith("UID:")) evento.uid = riga.slice(4);
    if (riga.startsWith("DTSTART")) evento.dtstart = riga;
    if (riga.startsWith("DTEND")) evento.dtend = riga;
    if (riga.startsWith("SUMMARY:")) evento.summary = riga.slice(8);
    if (riga === "BEGIN:VALARM") evento.valarm += 1;

    if (riga.startsWith("DTSTART")) {
      const valore = riga.slice(riga.indexOf(":") + 1).trim();
      if (!riga.includes("VALUE=DATE:")) {
        problemi.push("DTSTART senza VALUE=DATE: le scadenze sono eventi a giornata intera.");
      } else if (!DATA_VALIDA.test(valore)) {
        problemi.push(`DTSTART non è una DATE valida: "${valore}".`);
      }
    }

    if (riga.startsWith("DTSTAMP:") || riga.startsWith("LAST-MODIFIED:")) {
      const valore = riga.slice(riga.indexOf(":") + 1).trim();
      if (!DATAORA_VALIDA.test(valore)) {
        problemi.push(`${riga.slice(0, riga.indexOf(":"))} non è una DATE-TIME UTC valida: "${valore}".`);
      }
    }

    // Il controllo che mancava, ed è quello che conta di più: senza una
    // DURATION conforme il VALARM viene scartato dai client e i promemoria non
    // scattano, in silenzio. È il difetto che ha prodotto `-P-15D` in tutti e
    // 68 gli allarmi pubblicati.
    if (riga.startsWith("TRIGGER")) {
      const valore = riga.slice(riga.indexOf(":") + 1).trim();
      if (!DURATION_VALIDA.test(valore)) {
        problemi.push(
          `TRIGGER non è una DURATION valida per RFC 5545 §3.3.6: "${valore}". ` +
            "Un segno doppio come -P-15D fa scartare il promemoria al client.",
        );
      }
    }
  }

  // Forma generale delle righe di contenuto.
  for (const riga of righe) {
    if (!/^[A-Za-z0-9-]+(;[^:]*)?:/.test(riga)) {
      problemi.push(`Riga non conforme a "NOME[;parametri]:valore": ${riga.slice(0, 40)}…`);
    }
    const valore = riga.slice(riga.indexOf(":") + 1);
    // A raw CR or LF inside a value is impossible here (lines are unfolded), but
    // an unescaped comma or semicolon in TEXT breaks clients that split on them.
    if (/(^|[^\\])[;,](?![^:]*:)/.test(valore) && /^(SUMMARY|DESCRIPTION|X-WR-CALDESC|X-WR-CALNAME):/.test(riga)) {
      const grezzo = valore.replace(/\\./g, "");
      if (/[;,]/.test(grezzo)) {
        problemi.push(`Valore TEXT non escapato in ${riga.slice(0, 24)}…: contiene ; o , non preceduti da \\`);
      }
    }
  }

  return problemi;
}
