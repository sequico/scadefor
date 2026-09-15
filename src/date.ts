/**
 * Working-day arithmetic.
 *
 * The set of Italian public holidays is deliberately NOT hardcoded here: it is
 * declared in `regole.json` with `tipo: "calendario_festivi"` and passed in as
 * an argument. Keeping the holiday list as data means a normative change can be
 * reviewed and diffed like every other rule, instead of hiding in a source file.
 */

export type FestivoFisso = { giorno: number; mese: number; denominazione: string };
export type FestivoMobile = { tipo: string; denominazione: string };
export type CalendarioFestivi = {
  festivi_fissi: FestivoFisso[];
  festivi_mobili: FestivoMobile[];
};

/** Builds a UTC-midnight Date so that day arithmetic never crosses a DST edge. */
export function dataUtc(anno: number, mese: number, giorno: number): Date {
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

export function chiaveData(data: Date): string {
  const a = data.getUTCFullYear().toString().padStart(4, "0");
  const m = (data.getUTCMonth() + 1).toString().padStart(2, "0");
  const g = data.getUTCDate().toString().padStart(2, "0");
  return `${a}-${m}-${g}`;
}

export function aggiungiGiorni(data: Date, giorni: number): Date {
  const copia = new Date(data.getTime());
  copia.setUTCDate(copia.getUTCDate() + giorni);
  return copia;
}

/** Gregorian Easter Sunday, Meeus/Jones/Butcher algorithm — an algorithm, not a table. */
export function pasqua(anno: number): Date {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return dataUtc(anno, mese, giorno);
}

/** Holiday key (`YYYY-MM-DD`) -> description. */
export function festiviDellAnno(
  anno: number,
  calendario: CalendarioFestivi,
): Map<string, string> {
  const festivi = new Map<string, string>();

  for (const festivo of calendario.festivi_fissi) {
    festivi.set(chiaveData(dataUtc(anno, festivo.mese, festivo.giorno)), festivo.denominazione);
  }

  for (const mobile of calendario.festivi_mobili) {
    if (mobile.tipo === "lunedi_di_pasqua") {
      festivi.set(chiaveData(aggiungiGiorni(pasqua(anno), 1)), mobile.denominazione);
    }
    // Unknown movable rules are ignored rather than guessed; `verificaRegole`
    // in the test suite fails loudly if a new tipo appears without support.
  }

  return festivi;
}

/** Returns the holiday name if the date is a holiday, otherwise undefined. */
export function nomeFestivo(data: Date, festivi: Map<string, string>): string | undefined {
  return festivi.get(chiaveData(data));
}

/** Saturday and Sunday are non-working days for tax-deadline purposes. */
export function motivoNonLavorativo(
  data: Date,
  festivi: Map<string, string>,
): string | undefined {
  const giornoSettimana = data.getUTCDay();
  if (giornoSettimana === 6) return "sabato";
  if (giornoSettimana === 0) return "domenica";
  return nomeFestivo(data, festivi);
}

export function eGiornoLavorativo(data: Date, festivi: Map<string, string>): boolean {
  return motivoNonLavorativo(data, festivi) === undefined;
}

export function prossimoGiornoLavorativo(data: Date, festivi: Map<string, string>): Date {
  let corrente = data;
  let guardia = 0;
  while (!eGiornoLavorativo(corrente, festivi)) {
    corrente = aggiungiGiorni(corrente, 1);
    guardia += 1;
    if (guardia > 30) {
      throw new Error(
        `Nessun giorno lavorativo trovato entro 30 giorni da ${chiaveData(data)}: ` +
          "il calendario dei festivi è probabilmente incoerente.",
      );
    }
  }
  return corrente;
}

/**
 * Year-agnostic comparison of a date against a recurring window such as
 * 1-20 August. Both ends are inclusive; windows crossing the new year are
 * supported.
 */
export function dentroPeriodo(
  data: Date,
  inizio: { giorno: number; mese: number },
  fine: { giorno: number; mese: number },
): boolean {
  // getUTCMonth() è 0-based, mentre i mesi in regole.json sono 1-based: senza il
  // +1 il confronto sarebbe sempre falso e la regola non scatterebbe mai.
  const valore = (data.getUTCMonth() + 1) * 100 + data.getUTCDate();
  const da = inizio.mese * 100 + inizio.giorno;
  const a = fine.mese * 100 + fine.giorno;
  if (da <= a) return valore >= da && valore <= a;
  return valore >= da || valore <= a;
}
