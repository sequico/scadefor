/**
 * RFC 5545 (iCalendar) serializer.
 *
 * This module contains no normative logic. It only turns events that have
 * already been computed by the rules engine into a valid `.ics` payload.
 * Every Italian tax rule lives in `regole.json` / `parametri.json`.
 *
 * Reference: RFC 5545, sections 3.1 (content lines), 3.6.1 (VEVENT),
 * 3.8.6 (alarms).
 */

export type Allarme = {
  /** ISO 8601 duration, e.g. "-P15D" (15 days before the event). */
  trigger: string;
  descrizione: string;
};

export type EventoIcs = {
  uid: string;
  /** All-day event start (DATE value). */
  data: Date;
  titolo: string;
  descrizione: string;
  /** Incremented when the event content changes, so subscribers update it. */
  sequenza: number;
  ultimaModifica: Date;
  /** DTSTAMP: when this serialization instance was produced. */
  timestamp: Date;
  allarmi: Allarme[];
};

export type CalendarioIcs = {
  nome: string;
  descrizione: string;
  prodId: string;
  eventi: EventoIcs[];
};

const LIMITE_OCTET = 75;
const FINE_RIGA = "\r\n";

/**
 * Escapes TEXT values as required by RFC 5545 §3.3.11.
 * Backslash first, otherwise the escapes added later would be double-escaped.
 */
export function escapeTesto(valore: string): string {
  return valore
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Folds a content line at 75 octets, never splitting a multi-byte UTF-8
 * character. Continuation lines start with a single space (RFC 5545 §3.1).
 */
export function piegaRiga(riga: string): string {
  const righe: string[] = [];
  let corrente = "";
  let octet = 0;

  for (const carattere of riga) {
    // A continuation line spends one octet on its leading space.
    const limite = righe.length === 0 ? LIMITE_OCTET : LIMITE_OCTET - 1;
    const dimensione = Buffer.byteLength(carattere, "utf8");
    if (octet + dimensione > limite) {
      righe.push(corrente);
      corrente = "";
      octet = 0;
    }
    corrente += carattere;
    octet += dimensione;
  }
  righe.push(corrente);

  return righe.map((r, i) => (i === 0 ? r : " " + r)).join(FINE_RIGA);
}

/** Local calendar date -> `YYYYMMDD` (all-day DATE value). */
export function formattaData(data: Date): string {
  const a = data.getUTCFullYear().toString().padStart(4, "0");
  const m = (data.getUTCMonth() + 1).toString().padStart(2, "0");
  const g = data.getUTCDate().toString().padStart(2, "0");
  return `${a}${m}${g}`;
}

/** Instant -> `YYYYMMDDTHHMMSSZ` (UTC DATE-TIME value). */
export function formattaDataOra(data: Date): string {
  const a = data.getUTCFullYear().toString().padStart(4, "0");
  const m = (data.getUTCMonth() + 1).toString().padStart(2, "0");
  const g = data.getUTCDate().toString().padStart(2, "0");
  const hh = data.getUTCHours().toString().padStart(2, "0");
  const mm = data.getUTCMinutes().toString().padStart(2, "0");
  const ss = data.getUTCSeconds().toString().padStart(2, "0");
  return `${a}${m}${g}T${hh}${mm}${ss}Z`;
}

function riga(nome: string, valore: string): string {
  return piegaRiga(`${nome}:${valore}`);
}

/** Serializes a full VCALENDAR. All-day events: DTSTART/DTEND are DATE values. */
export function serializzaCalendario(calendario: CalendarioIcs): string {
  const righe: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    riga("PRODID", calendario.prodId),
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    riga("X-WR-CALNAME", escapeTesto(calendario.nome)),
    riga("X-WR-CALDESC", escapeTesto(calendario.descrizione)),
    "X-WR-TIMEZONE:Europe/Rome",
  ];

  for (const evento of calendario.eventi) {
    const fine = new Date(evento.data.getTime());
    fine.setUTCDate(fine.getUTCDate() + 1);

    righe.push(
      "BEGIN:VEVENT",
      riga("UID", evento.uid),
      riga("DTSTAMP", formattaDataOra(evento.timestamp)),
      riga("LAST-MODIFIED", formattaDataOra(evento.ultimaModifica)),
      riga("SEQUENCE", String(evento.sequenza)),
      riga("DTSTART;VALUE=DATE", formattaData(evento.data)),
      riga("DTEND;VALUE=DATE", formattaData(fine)),
      riga("SUMMARY", escapeTesto(evento.titolo)),
      riga("DESCRIPTION", escapeTesto(evento.descrizione)),
      "TRANSP:TRANSPARENT",
      "STATUS:CONFIRMED",
    );

    for (const allarme of evento.allarmi) {
      righe.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        riga("DESCRIPTION", escapeTesto(allarme.descrizione)),
        riga("TRIGGER", allarme.trigger),
        "END:VALARM",
      );
    }

    righe.push("END:VEVENT");
  }

  righe.push("END:VCALENDAR");
  return righe.join(FINE_RIGA) + FINE_RIGA;
}

/** Reverses RFC 5545 line folding (section 3.1). */
export function srotola(contenuto: string): string[] {
  const righe = contenuto.split(/\r\n|\r|\n/);
  const srotolate: string[] = [];
  for (const riga of righe) {
    if (riga.startsWith(" ") || riga.startsWith("\t")) {
      if (srotolate.length === 0) continue;
      srotolate[srotolate.length - 1] += riga.slice(1);
    } else {
      srotolate.push(riga);
    }
  }
  return srotolate;
}

/**
 * Volatile properties. They record *when* a file was written, not *what* it
 * says, so they must be excluded when deciding whether anything changed.
 */
const PROPRIETA_VOLATILI = ["DTSTAMP", "LAST-MODIFIED", "SEQUENCE"];

function eVolatile(riga: string): boolean {
  return PROPRIETA_VOLATILI.some((nome) => riga.startsWith(`${nome}:`));
}

export type EventoPrecedente = {
  sequenza: number;
  timestamp: string;
  ultimaModifica: string;
  /** VEVENT body without DTSTAMP/LAST-MODIFIED/SEQUENCE, for change detection. */
  corpo: string;
};

/**
 * Indexes an already-published calendar by UID.
 *
 * Two things depend on this: reusing DTSTAMP when the content is unchanged (so
 * a run with nothing to say produces no diff and therefore no commit), and
 * bumping SEQUENCE only when an event really changed (so subscribers update the
 * event instead of ignoring it).
 */
export function analizzaCalendario(contenuto: string): Map<string, EventoPrecedente> {
  const indice = new Map<string, EventoPrecedente>();
  let uid: string | undefined;
  let sequenza = 0;
  let timestamp = "";
  let ultimaModifica = "";
  let corpo: string[] = [];
  let dentro = false;

  const chiudi = () => {
    if (dentro && uid) {
      indice.set(uid, { sequenza, timestamp, ultimaModifica, corpo: corpo.join("\n") });
    }
    uid = undefined;
    sequenza = 0;
    timestamp = "";
    ultimaModifica = "";
    corpo = [];
    dentro = false;
  };

  for (const riga of srotola(contenuto)) {
    if (riga === "BEGIN:VEVENT") {
      dentro = true;
      continue;
    }
    if (riga === "END:VEVENT") {
      chiudi();
      continue;
    }
    if (!dentro) continue;

    if (riga.startsWith("UID:")) uid = riga.slice(4).trim();
    if (riga.startsWith("SEQUENCE:")) sequenza = Number.parseInt(riga.slice(9).trim(), 10) || 0;
    if (riga.startsWith("DTSTAMP:")) timestamp = riga.slice(8).trim();
    if (riga.startsWith("LAST-MODIFIED:")) ultimaModifica = riga.slice(14).trim();
    if (!eVolatile(riga)) corpo.push(riga);
  }

  return indice;
}

/**
 * Strips volatile properties from a serialized calendar so that two files can be
 * compared on meaning rather than on write time.
 */
export function contenutoConfrontabile(contenuto: string): string {
  return srotola(contenuto)
    .filter((riga) => !eVolatile(riga))
    .join("\n");
}
