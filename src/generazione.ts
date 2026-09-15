/**
 * Turns computed events into published artefacts.
 *
 * Two guarantees live here rather than in prose:
 *
 *  1. **No past years.** Every calendar covers only the current year and the
 *     next one. `verificaIntervalloAnni` makes that an enforced invariant: a
 *     generated date that falls in an earlier year aborts the run.
 *  2. **Stable output.** When nothing substantive changed, the regenerated file
 *     is byte-identical to the published one, so the quarterly workflow really
 *     can conclude "nessuna modifica" instead of committing a timestamp churn.
 *     SEQUENCE is bumped only for events whose content actually changed, which
 *     is what makes subscribers update instead of ignore.
 */

import {
  analizzaCalendario,
  serializzaCalendario,
  type Allarme,
  type EventoIcs,
} from "./ics.ts";
import type { EventoGenerato } from "./motore.ts";
import type { Profilo, Regole } from "./tipi.ts";

/** Days of notice, expressed as ISO 8601 durations relative to the event. */
/**
 * Promemoria come DURATION negative rispetto all'evento. `giorno` è il numero di
 * giorni di preavviso, positivo: il meno che rende la durata «prima dell'evento»
 * viene aggiunto qui, in un unico punto.
 */
function allarmi(giorni: number[], titolo: string): Allarme[] {
  return giorni.map((giorno) => {
    if (!Number.isInteger(giorno) || giorno <= 0) {
      throw new Error(
        `Allarme non valido: ${giorno} non è un numero di giorni di preavviso positivo.`,
      );
    }
    return { trigger: `-P${giorno}D`, descrizione: titolo };
  });
}

function impronta(evento: EventoIcs): string {
  // Extracted through the same reader used on the published file, so both sides
  // are framed identically. Comparing a bare VEVENT body against a body parsed
  // out of a whole calendar never matches, which would silently defeat the
  // "unchanged content produces no diff" guarantee.
  const serializzato = serializzaCalendario({
    nome: "",
    descrizione: "",
    prodId: "x",
    eventi: [evento],
  });
  return analizzaCalendario(serializzato).get(evento.uid)?.corpo ?? serializzato;
}

function daFormatoIcs(valore: string): Date | null {
  const trovato = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(valore);
  if (!trovato) return null;
  return new Date(
    Date.UTC(
      Number(trovato[1]),
      Number(trovato[2]) - 1,
      Number(trovato[3]),
      Number(trovato[4]),
      Number(trovato[5]),
      Number(trovato[6]),
    ),
  );
}

/**
 * Enforces the scope rule: calendars and page describe the current year and the
 * next one, and nothing from earlier years.
 *
 * L'intervallo ammesso è un parametro esplicito, calcolato dall'anno corrente, e
 * NON viene ricavato dall'elenco degli anni da generare: altrimenti basterebbe
 * invocare `--anni=2020,2021` per far passare il controllo su un calendario di
 * anni passati, cioè proprio ciò che questo guardiano deve impedire.
 */
export function verificaIntervalloAnni(
  eventi: EventoGenerato[],
  intervallo: { dal: number; al: number },
): void {
  if (
    !Number.isInteger(intervallo.dal) ||
    !Number.isInteger(intervallo.al) ||
    intervallo.al < intervallo.dal
  ) {
    throw new Error(
      `Intervallo di anni non valido: ${JSON.stringify(intervallo)}.`,
    );
  }

  const fuori = eventi.filter((evento) => {
    const anno = evento.data.getUTCFullYear();
    if (anno < intervallo.dal) return true;
    // Uno sconfinamento è ammesso solo a gennaio: una scadenza di fine dicembre
    // può slittare al primo giorno lavorativo dell'anno successivo.
    if (anno > intervallo.al) return evento.data.getUTCMonth() !== 0;
    return false;
  });

  if (fuori.length > 0) {
    const dettaglio = fuori
      .slice(0, 5)
      .map((e) => `${e.regola_id}/${e.profilo_id} -> ${e.data.toISOString().slice(0, 10)}`)
      .join(", ");
    throw new Error(
      `Generazione interrotta: ${fuori.length} scadenze cadono fuori dall'intervallo ` +
        `[${intervallo.dal}, ${intervallo.al}] (${dettaglio}). Il calendario deve contenere solo ` +
        `l'anno corrente e il successivo.`,
    );
  }
}

export type FileGenerato = {
  nome: string;
  contenuto: string;
  modificato: boolean;
};

/** Serializes one profile's calendar, reusing timestamps when content is unchanged. */
export function costruisciCalendarioProfilo(
  profilo: Profilo,
  eventi: EventoGenerato[],
  config: Regole,
  contenutoPrecedente: string | null,
  istante: Date,
  opzioni: { suffissoNome?: string; notaScaricato?: boolean } = {},
): string {
  const precedente = contenutoPrecedente ? analizzaCalendario(contenutoPrecedente) : new Map();

  const eventiIcs: EventoIcs[] = eventi.map((evento) => {
    const voci = allarmi(evento.promemoria_giorni, evento.titolo);
    const base: EventoIcs = {
      uid: evento.uid,
      data: evento.data,
      titolo: evento.titolo,
      descrizione: evento.descrizione,
      sequenza: 0,
      ultimaModifica: istante,
      timestamp: istante,
      allarmi: voci,
    };

    const vecchio = precedente.get(evento.uid);
    if (vecchio && vecchio.corpo === impronta(base)) {
      return {
        ...base,
        sequenza: vecchio.sequenza,
        timestamp: daFormatoIcs(vecchio.timestamp) ?? istante,
        ultimaModifica: daFormatoIcs(vecchio.ultimaModifica) ?? istante,
      };
    }

    return {
      ...base,
      sequenza: vecchio ? vecchio.sequenza + 1 : 0,
    };
  });

  const anni = [...new Set(eventi.map((e) => e.anno))].sort();

  return serializzaCalendario({
    nome: `${profilo.nome_calendario}${opzioni.suffissoNome ?? ""}`,
    descrizione:
      `${profilo.descrizione} Scadenze generate automaticamente per il ${anni.join(" e il ")}. ` +
      (opzioni.notaScaricato
        ? "Copia scaricata: è una fotografia statica, non si aggiorna da sola. "
        : "Calendario sottoscritto: si aggiorna automaticamente ad ogni verifica. ") +
      "Servizio non verificato da un professionista: solo a titolo indicativo. " +
      `Dettagli e fonti su https://${config.metadati.dominio}/`,
    prodId: config.metadati.prod_id,
    eventi: eventiIcs,
  });
}

/** Nome del file per anno, usato dai link «scarica». */
export function nomeFileAnno(profilo: Profilo, anno: number): string {
  return profilo.file.replace(/\.ics$/, `-${anno}.ics`);
}

/** Names the file the way the specification requires: `public/<slug>.ics`. */
export function nomeFileCalendario(profilo: Profilo): string {
  return profilo.file;
}
