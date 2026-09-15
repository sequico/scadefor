/**
 * Rules engine — the normative heart of the project.
 *
 * Questo modulo interpreta `regole.json` e `parametri.json`. Non contiene
 * nessuna data, nessuna aliquota e nessuna soglia: ogni valore normativo vive
 * nei file JSON, in modo che una modifica di legge sia leggibile come diff e
 * verificabile come dato. Qui restano solo gli *algoritmi* generici:
 *   - calcolo delle date candidate a partire dal tipo di regola;
 *   - applicazione degli slittamenti dichiarati (feriale, giorno non lavorativo);
 *   - applicazione delle proroghe confermate e verificate sulle fonti;
 *   - composizione dei due blocchi descrittivi dell'evento.
 *
 * Regola di sicurezza: se un dato manca o non è interpretabile, il motore
 * solleva un errore e la run fallisce. Non vengono mai inventati valori di
 * fallback silenziosi.
 */

import {
  aggiungiGiorni,
  chiaveData,
  dataUtc,
  dentroPeriodo,
  festiviDellAnno,
  motivoNonLavorativo,
  prossimoGiornoLavorativo,
  type CalendarioFestivi,
} from "./date.ts";
import {
  formattaDataItaliana,
  formattaEuro,
  formattaPercentuale,
} from "./formato.ts";
import type {
  AnnoParametri,
  BloccoCalcolo,
  Parametri,
  Profilo,
  Regola,
  Regole,
} from "./tipi.ts";

export type ProrogaApplicata = {
  scadenza: string;
  data_originale: string;
  data_nuova: string;
  fonte_url: string;
  estratto_testuale: string;
};

export type EventoGenerato = {
  regola_id: string;
  profilo_id: string;
  uid: string;
  /**
   * Anno per cui la regola è stata elaborata.
   *
   * Non è sempre l'anno della data finale: una scadenza di fine dicembre può
   * slittare al primo giorno lavorativo di gennaio. Serve a costruire i file per
   * anno senza dipendere da quel salto.
   */
  anno: number;
  data: Date;
  data_ordinaria: Date;
  titolo: string;
  descrizione: string;
  promemoria_giorni: number[];
};

export type ParametriAnno = {
  anno_richiesto: number;
  anno_valori: number;
  valori: AnnoParametri;
  provvisorio: boolean;
};

/**
 * Giorni di preavviso, espressi come numeri POSITIVI.
 *
 * La convenzione è positiva di proposito: il segno meno lo aggiunge il
 * serializzatore quando costruisce la DURATION. Un dato negativo produrrebbe
 * `-P-15D`, che non è una DURATION valida per RFC 5545 §3.3.6, e i client
 * severi scartano il VALARM: i promemoria non scatterebbero, in silenzio.
 * Tenendo il dato positivo, la forma non valida non è più rappresentabile.
 */
const PROMEMORIA_PREDEFINITI = [15, 3];

/** Validates the declarative configuration; returns a list of human-readable errors. */
export function verificaConfigurazione(config: Regole): string[] {
  const errori: string[] = [];

  if (!config.profili || config.profili.length === 0) {
    errori.push("Nessun profilo dichiarato in regole.json.");
  }

  const idProfili = new Set((config.profili ?? []).map((p) => p.id));
  const idRegole = new Set<string>();

  for (const voce of config.regole ?? []) {
    // Duplicazione e requisiti di fonte valgono per OGNI voce, comprese le
    // regole di tipo `calendario_festivi`. In precedenza il controllo usciva
    // subito su quelle voci, quindi una regola marcata `da_verificare` senza
    // nota passava la validazione in silenzio.
    if (idRegole.has(voce.id)) {
      errori.push(`Regola duplicata: ${voce.id}`);
    }
    idRegole.add(voce.id);

    const statoVoce = voce.stato_verifica ?? "verificato";
    if (statoVoce === "verificato") {
      for (const campo of ["fonte_normativa", "fonte_url", "estratto_verificato"] as const) {
        if (!voce[campo]) {
          errori.push(`Regola ${voce.id}: campo fonte obbligatorio mancante (${campo}).`);
        }
      }
    } else if (!voce.nota) {
      errori.push(
        `Regola ${voce.id}: stato_verifica "${statoVoce}" richiede una nota che espliciti l'incertezza.`,
      );
    }

    if (!sonoRegola(voce)) continue;
    const regola = voce;

    for (const profilo of regola.applicabile_a ?? []) {
      if (!idProfili.has(profilo)) {
        errori.push(`Regola ${regola.id}: profilo sconosciuto "${profilo}".`);
      }
    }

    switch (regola.tipo) {
      case "data_fissa_annuale":
        if (!regola.giorno || !regola.mese) {
          errori.push(`Regola ${regola.id}: giorno e mese sono obbligatori.`);
        }
        if (regola.mese && (regola.mese < 1 || regola.mese > 12)) {
          errori.push(`Regola ${regola.id}: mese fuori intervallo.`);
        }
        break;
      case "data_ricorrente_mensile":
        if (!regola.giorno) {
          errori.push(`Regola ${regola.id}: giorno obbligatorio.`);
        }
        break;
      case "date_ricorrenti_trimestrali":
        if (!regola.date || regola.date.length === 0) {
          errori.push(`Regola ${regola.id}: elenco date vuoto.`);
        }
        break;
      case "regola_slittamento":
        if (!regola.periodo_inizio || !regola.periodo_fine || !regola.slitta_a) {
          errori.push(
            `Regola ${regola.id}: periodo_inizio, periodo_fine e slitta_a sono obbligatori.`,
          );
        }
        break;
      case "slittamento_lavorativo":
        if (!regola.usa_festivi) {
          errori.push(`Regola ${regola.id}: usa_festivi è obbligatorio.`);
        }
        break;
      default:
        errori.push(`Regola ${regola.id}: tipo non supportato dal motore.`);
    }

    const varianti = regola.varianti_validita ?? [];

    for (let i = 0; i < varianti.length; i += 1) {
      for (let j = i + 1; j < varianti.length; j += 1) {
        const a = varianti[i];
        const b = varianti[j];
        if (a.da_anno <= b.a_anno && b.da_anno <= a.a_anno) {
          errori.push(
            `Regola ${regola.id}: le varianti ${i + 1} e ${j + 1} coprono entrambe l'anno ` +
              `${Math.max(a.da_anno, b.da_anno)}. La sovrapposizione non è ammessa perché il ` +
              "motore ne applicherebbe una sola in silenzio.",
          );
        }
      }
    }

    // Le fonti aggiuntive descrivono aspetti della stessa regola con basi
    // normative diverse: ognuna dichiara il proprio stato con la stessa
    // disciplina della fonte principale.
    for (const [indice, fonte] of (regola.fonti_aggiuntive ?? []).entries()) {
      if (!fonte.aspetto) {
        errori.push(`Regola ${regola.id}, fonte aggiuntiva ${indice + 1}: manca "aspetto".`);
      }
      const statoFonte = fonte.stato_verifica ?? "verificato";
      if (statoFonte === "verificato") {
        for (const campo of ["fonte_normativa", "fonte_url", "estratto_verificato"] as const) {
          if (!fonte[campo]) {
            errori.push(
              `Regola ${regola.id}, fonte aggiuntiva ${indice + 1}: manca ${campo} per un riferimento dichiarato verificato.`,
            );
          }
        }
      } else if (!fonte.nota) {
        errori.push(
          `Regola ${regola.id}, fonte aggiuntiva ${indice + 1}: stato_verifica "${statoFonte}" richiede una nota.`,
        );
      }
    }

    for (const [indice, variante] of (regola.varianti_validita ?? []).entries()) {
      if (!Number.isInteger(variante.da_anno) || !Number.isInteger(variante.a_anno)) {
        errori.push(
          `Regola ${regola.id}, variante ${indice}: da_anno e a_anno sono obbligatori e interi.`,
        );
        continue;
      }
      if (variante.da_anno > variante.a_anno) {
        errori.push(`Regola ${regola.id}, variante ${indice}: da_anno successivo ad a_anno.`);
      }

      // A variant that is not fully verified must say so in a nota; a variant
      // claiming to be verified must actually carry its own citation, so that a
      // year can never inherit a stale reference silently.
      const statoVariante = variante.stato_verifica ?? "verificato";
      if (statoVariante === "verificato") {
        for (const campo of ["fonte_normativa", "fonte_url", "estratto_verificato"] as const) {
          if (!variante[campo]) {
            errori.push(
              `Regola ${regola.id}, variante ${indice}: manca ${campo} per un riferimento dichiarato verificato.`,
            );
          }
        }
      } else if (!variante.nota) {
        errori.push(
          `Regola ${regola.id}, variante ${indice}: stato_verifica "${statoVariante}" richiede una nota.`,
        );
      }
    }
  }

  const idSlittamentoFestivi = new Set(
    (config.regole ?? [])
      .filter((r) => r.tipo === "slittamento_lavorativo")
      .map((r) => (r as Regola).usa_festivi),
  );
  const idCalendari = new Set(
    (config.regole ?? []).filter((r) => r.tipo === "calendario_festivi").map((r) => r.id),
  );
  for (const riferimento of idSlittamentoFestivi) {
    if (riferimento && !idCalendari.has(riferimento)) {
      errori.push(`slittamento_lavorativo: calendario festivi "${riferimento}" inesistente.`);
    }
  }

  return errori;
}

function sonoRegola(voce: Regola | CalendarioFestivi): voce is Regola {
  return voce.tipo !== "calendario_festivi";
}

function regoleSlittamento(config: Regole): Regola[] {
  return (config.regole as (Regola | CalendarioFestivi)[])
    .filter(sonoRegola)
    .filter((r) => r.tipo === "regola_slittamento" || r.tipo === "slittamento_lavorativo")
    .filter((r) => r.attivo !== false);
}

function regoleConDate(config: Regole): Regola[] {
  return (config.regole as (Regola | CalendarioFestivi)[])
    .filter(sonoRegola)
    .filter((r) =>
      ["data_fissa_annuale", "data_ricorrente_mensile", "date_ricorrenti_trimestrali"].includes(
        r.tipo,
      ),
    )
    .filter((r) => r.attivo !== false);
}

/**
 * Builds the holiday map for a window of years. A deadline that falls in late
 * December can legitimately shift into the following January, so neighbouring
 * years are always loaded.
 */
function mappaFestivi(config: Regole, anni: number[]): Map<string, string> {
  const mappa = new Map<string, string>();
  for (const regola of config.regole as (Regola | CalendarioFestivi)[]) {
    if (regola.tipo !== "calendario_festivi") continue;
    for (const anno of anni) {
      for (const [chiave, nome] of festiviDellAnno(anno, regola as CalendarioFestivi)) {
        mappa.set(chiave, nome);
      }
    }
  }
  return mappa;
}

/** Resolves the parameter set for a civil year, falling back with an explicit flag. */
export function risolviParametriAnno(parametri: Parametri, anno: number): ParametriAnno {
  const diretto = parametri.anni[String(anno)];
  if (diretto) {
    return {
      anno_richiesto: anno,
      anno_valori: anno,
      valori: diretto,
      provvisorio: diretto.valori_provvisori === true,
    };
  }

  const disponibili = Object.keys(parametri.anni)
    .map((chiave) => Number.parseInt(chiave, 10))
    .filter((valore) => Number.isFinite(valore) && valore < anno)
    .sort((a, b) => b - a);

  if (disponibili.length === 0) {
    throw new Error(
      `Nessun parametro disponibile per l'anno ${anno} né per anni precedenti in parametri.json.`,
    );
  }

  const ripiego = disponibili[0];
  return {
    anno_richiesto: anno,
    anno_valori: ripiego,
    valori: parametri.anni[String(ripiego)],
    provvisorio: true,
  };
}

function leggiNumero(insieme: ParametriAnno, campo: string): number {
  const valore = insieme.valori[campo];
  if (typeof valore !== "number" || !Number.isFinite(valore)) {
    throw new Error(
      `parametri.json: campo "${campo}" assente o non numerico per l'anno ` +
        `${insieme.anno_valori} (richiesto per l'anno ${insieme.anno_richiesto}).`,
    );
  }
  return valore;
}

/**
 * Reads a parameter, preferring the year-specific set and falling back to the
 * year-independent one. Preferring the specific value is what makes a change to
 * a yearly figure take effect without touching the rule that uses it.
 */
function leggiParametro(parametri: Parametri, insieme: ParametriAnno, campo: string): number {
  const dallAnno = insieme.valori[campo];
  if (typeof dallAnno === "number" && Number.isFinite(dallAnno)) return dallAnno;

  const comune = parametri.comuni?.[campo];
  if (typeof comune === "number" && Number.isFinite(comune)) return comune;

  throw new Error(
    `parametri.json: campo "${campo}" assente sia tra i valori dell'anno ` +
      `${insieme.anno_valori} sia tra i valori comuni.`,
  );
}

function leggiNumeroComune(parametri: Parametri, campo: string): number {
  const valore = parametri.comuni?.[campo];
  if (typeof valore !== "number" || !Number.isFinite(valore)) {
    throw new Error(`parametri.json: campo comune "${campo}" assente o non numerico.`);
  }
  return valore;
}

function fontePerCampo(parametri: Parametri, campo: string): string | undefined {
  for (const anno of Object.values(parametri.anni)) {
    const fonti = (anno as { fonti?: { campo: string; fonte_normativa?: string }[] }).fonti ?? [];
    const trovata = fonti.find((f) => f.campo === campo);
    if (trovata) return trovata.fonte_normativa;
  }
  return (parametri.fonti_comuni ?? []).find((f) => f.campo === campo)?.fonte_normativa;
}

/**
 * Restituisce la versione della regola in vigore per l'anno richiesto.
 *
 * Se una variante copre l'anno, i suoi campi prevalgono su quelli di base. È
 * questo che garantisce che il calendario di ciascun anno citi la norma
 * effettivamente applicabile a quell'anno, sia perché originaria sia perché
 * intervenuta una modifica.
 */
export function regolaPerAnno(regola: Regola, anno: number): Regola {
  const variante = (regola.varianti_validita ?? []).find(
    (v) => anno >= v.da_anno && anno <= v.a_anno,
  );
  if (!variante) return regola;
  const { da_anno: _da, a_anno: _a, ...campi } = variante;
  return { ...regola, ...campi };
}

/**
 * Elenca i dati la cui fonte non è verificabile automaticamente, così che la
 * pagina pubblica possa dichiararli invece di presentarli come accertati.
 *
 * `verificato_manualmente` è deliberatamente ESCLUSO: quel dato è stato
 * confermato leggendo la fonte, semplicemente la pipeline non può ricontrollarlo
 * da sola (tipicamente perché è un PDF). Tenerlo qui lo farebbe apparire come
 * dubbio, che sarebbe falso. Viene raccolto da `fontiVerificateAMano`.
 */
export function campiDaVerificareManualmente(
  config: Regole,
  parametri: Parametri,
): { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[] {
  return raccogliFontiNonAutomatiche(config, parametri, (stato) => stato !== "verificato_manualmente");
}

/** I dati confermati a mano: solidi, ma non ricontrollabili automaticamente. */
export function fontiVerificateAMano(
  config: Regole,
  parametri: Parametri,
): { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[] {
  return raccogliFontiNonAutomatiche(config, parametri, (stato) => stato === "verificato_manualmente");
}

function raccogliFontiNonAutomatiche(
  config: Regole,
  parametri: Parametri,
  seleziona: (stato: string) => boolean,
): { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[] {
  const elenco: { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[] =
    [];

  const controlla = (
    dove: string,
    campo: string,
    voce: { stato_verifica?: string; nota?: string; fonte_url?: string },
  ) => {
    const stato = voce.stato_verifica ?? "verificato";
    if (stato === "verificato" || !seleziona(stato)) return;
    elenco.push({
      dove,
      campo,
      stato,
      nota: voce.nota ?? "Nessuna nota disponibile.",
      fonte_url: voce.fonte_url ?? "",
    });
  };

  for (const regola of config.regole) {
    controlla("regola", regola.id, regola);
    regola.fonti_aggiuntive?.forEach((fonte, indice) => {
      controlla("regola", `${regola.id} (${fonte.aspetto || `fonte ${indice + 1}`})`, fonte);
    });
    regola.varianti_validita?.forEach((variante, indice) => {
      controlla("regola", `${regola.id} (variante ${indice + 1})`, variante);
    });
  }

  for (const fonte of parametri.fonti_comuni ?? []) {
    controlla("parametro comune", fonte.campo, fonte);
  }
  for (const [anno, insieme] of Object.entries(parametri.anni)) {
    for (const fonte of insieme.fonti ?? []) {
      controlla(`parametro ${anno}`, fonte.campo, fonte);
    }
  }

  return elenco;
}

/** Days of notice; declared per rule, defaulting to 15 and 3 days. */
function promemoria(regola: Regola): number[] {
  const giorni = regola.promemoria_giorni ?? PROMEMORIA_PREDEFINITI;
  for (const giorno of giorni) {
    if (!Number.isInteger(giorno) || giorno <= 0) {
      throw new Error(
        `Regola ${regola.id}: promemoria_giorni deve contenere interi positivi ` +
          `(giorni di preavviso), trovato ${giorno}.`,
      );
    }
  }
  return [...giorni].sort((a, b) => b - a);
}

/* ------------------------------------------------------------------ *
 * Rendering of the two description blocks required by section 4.
 * ------------------------------------------------------------------ */

function testoRiduzione(profilo: Profilo, parametri: Parametri): string {
  if (!profilo.applica_riduzione_forfettario) {
    return "Nessuna riduzione contributiva applicabile a questo profilo.";
  }
  const riduzione = leggiNumeroComune(parametri, "riduzione_forfettario");
  return (
    `Riduzione forfettario ${formattaPercentuale(riduzione, 0)} attiva ` +
    `(si versa il ${formattaPercentuale(1 - riduzione, 0)}).`
  );
}

function calcoloContributoFisso(
  blocco: Extract<BloccoCalcolo, { tipo: "contributo_fisso_rateizzato" }>,
  profilo: Profilo,
  parametri: Parametri,
  insieme: ParametriAnno,
): string {
  const minimale = leggiParametro(parametri, insieme, blocco.base_param);
  const aliquota = leggiParametro(parametri, insieme, blocco.aliquota_param);
  const riduzione = profilo.applica_riduzione_forfettario
    ? leggiNumeroComune(parametri, "riduzione_forfettario")
    : 0;
  const quotaVersata = 1 - riduzione;
  const annuo = minimale * aliquota * quotaVersata;
  const rata = annuo / blocco.numero_rate;
  const fonte = fontePerCampo(parametri, blocco.base_param);
  const etichettaAnno = insieme.provvisorio
    ? `${insieme.anno_valori} (valori provvisori, anno ${insieme.anno_richiesto} non ancora pubblicato)`
    : String(insieme.anno_valori);

  const parti = [
    `Aliquota ${formattaPercentuale(aliquota)} sul minimale INPS ${etichettaAnno} ` +
      `(${formattaEuro(minimale)}${fonte ? `, fonte: ${fonte}` : ""}).`,
    testoRiduzione(profilo, parametri),
    `Calcolo: ${formattaEuro(minimale)} × ${formattaPercentuale(aliquota)} × ` +
      `${formattaPercentuale(quotaVersata, 0)} = ${formattaEuro(annuo)}/anno, ` +
      `rata trimestrale ${formattaEuro(rata)}.`,
  ];
  return parti.join(" ");
}

function calcoloAliquotaSuReddito(
  blocco: Extract<BloccoCalcolo, { tipo: "aliquota_su_reddito" }>,
  profilo: Profilo,
  parametri: Parametri,
  insieme: ParametriAnno,
): string {
  const aliquota = leggiParametro(parametri, insieme, blocco.aliquota_param);
  const reddito = leggiParametro(parametri, insieme, blocco.reddito_esempio_param);
  const importo = reddito * aliquota;
  const fonte = fontePerCampo(parametri, blocco.aliquota_param);

  return [
    `Aliquota ${formattaPercentuale(aliquota)} sul reddito effettivo, senza minimale` +
      `${fonte ? ` (fonte: ${fonte})` : ""}.`,
    testoRiduzione(profilo, parametri),
    `Esempio su reddito imponibile di ${formattaEuro(reddito)} (valore illustrativo): ` +
      `${formattaEuro(reddito)} × ${formattaPercentuale(aliquota)} = ${formattaEuro(importo)}/anno.`,
  ].join(" ");
}

function calcoloImpostaSostitutiva(
  blocco: Extract<BloccoCalcolo, { tipo: "imposta_sostitutiva" }>,
  parametri: Parametri,
  insieme: ParametriAnno,
): string {
  const aliquota = leggiParametro(parametri, insieme, blocco.aliquota_param);
  const reddito = leggiParametro(parametri, insieme, blocco.reddito_esempio_param);
  const imposta = reddito * aliquota;
  const parti = [
    `${blocco.descrizione_quota}.`,
    `Aliquota imposta sostitutiva ${formattaPercentuale(aliquota, 0)}.`,
    `Esempio su reddito imponibile di ${formattaEuro(reddito)} (valore illustrativo, non un dato normativo): ` +
      `${formattaEuro(reddito)} × ${formattaPercentuale(aliquota, 0)} = ${formattaEuro(imposta)} di imposta annua.`,
  ];

  if (typeof blocco.quota_acconto_percentuale === "number") {
    const quota = blocco.quota_acconto_percentuale / 100;
    parti.push(
      `Quota di riferimento ${formattaPercentuale(quota, 0)} dell'imposta: ` +
        `${formattaEuro(imposta * quota)}.`,
    );
  }

  if (insieme.provvisorio) {
    parti.push(
      `Valori provvisori: i parametri dell'anno ${insieme.anno_richiesto} non sono ancora ` +
        `pubblicati, il calcolo usa quelli dell'anno ${insieme.anno_valori}.`,
    );
  }

  return parti.join(" ");
}

/** Renders the "CRITERI DI CALCOLO" block for one rule/profile pair. */
export function descriviCalcolo(
  regola: Regola,
  profilo: Profilo,
  parametri: Parametri,
  insieme: ParametriAnno,
): string {
  const blocco = regola.calcolo ?? { tipo: "nessuno" };
  const principale = calcoloPrincipale(regola, blocco, profilo, parametri, insieme);

  if (!regola.includi_calcolo_contributi || blocco.tipo === "dal_profilo") {
    return principale;
  }

  // Recursion guard: the profile's own calculation is rendered by the same
  // function, so the flag must be off on the recursive call.
  const contributi = calcoloPrincipale(
    { ...regola, includi_calcolo_contributi: false, calcolo: profilo.calcolo_contributi },
    profilo.calcolo_contributi,
    profilo,
    parametri,
    insieme,
  );

  return `Contributi previdenziali dovuti alla stessa scadenza: ${contributi} ${principale}`;
}

function calcoloPrincipale(
  regola: Regola,
  blocco: BloccoCalcolo,
  profilo: Profilo,
  parametri: Parametri,
  insieme: ParametriAnno,
): string {
  switch (blocco.tipo) {
    case "contributo_fisso_rateizzato":
      return calcoloContributoFisso(blocco, profilo, parametri, insieme);
    case "aliquota_su_reddito":
      return calcoloAliquotaSuReddito(blocco, profilo, parametri, insieme);
    case "imposta_sostitutiva":
      return calcoloImpostaSostitutiva(blocco, parametri, insieme);
    case "dal_profilo":
      return calcoloPrincipale(
        regola,
        profilo.calcolo_contributi,
        profilo,
        parametri,
        insieme,
      );
    case "adempimento": {
      const effetto = calcoloPrincipale(
        regola,
        profilo.calcolo_contributi,
        profilo,
        parametri,
        insieme,
      );
      return `Adempimento senza versamento. Effetto dell'opzione su questo profilo: ${effetto}`;
    }
    case "nessuno":
    default:
      return regola.nota ?? "Nessun calcolo associato a questa scadenza.";
  }
}

/* ------------------------------------------------------------------ *
 * Date computation
 * ------------------------------------------------------------------ */

type EsitoData = {
  data: Date;
  spiegazioni: string[];
};

function dateCandidate(regola: Regola, anno: number): Date[] {
  switch (regola.tipo) {
    case "data_fissa_annuale":
      return [dataUtc(anno, regola.mese as number, regola.giorno as number)];
    case "data_ricorrente_mensile":
      return Array.from({ length: 12 }, (_, indice) =>
        dataUtc(anno, indice + 1, regola.giorno as number),
      );
    case "date_ricorrenti_trimestrali":
      return (regola.date ?? []).map((d) => dataUtc(anno, d.mese, d.giorno));
    default:
      return [];
  }
}

/**
 * Applica, nell'ordine in cui sono dichiarate in regole.json, le regole di
 * slittamento. L'ordine è significativo: la sospensione feriale sposta la data
 * al 20 agosto, e solo dopo si verifica se il 20 agosto è un giorno lavorativo.
 */
function applicaSlittamenti(
  dataPartenza: Date,
  slittamenti: Regola[],
  festivi: Map<string, string>,
): EsitoData {
  let corrente = dataPartenza;
  const spiegazioni: string[] = [];

  for (const slittamento of slittamenti) {
    if (slittamento.tipo === "regola_slittamento") {
      const inizio = slittamento.periodo_inizio;
      const fine = slittamento.periodo_fine;
      const destinazione = slittamento.slitta_a;
      if (!inizio || !fine || !destinazione) continue;

      if (dentroPeriodo(corrente, inizio, fine)) {
        const nuova = dataUtc(corrente.getUTCFullYear(), destinazione.mese, destinazione.giorno);
        if (chiaveData(nuova) !== chiaveData(corrente)) {
          spiegazioni.push(
            `Scadenza nel periodo ${inizio.giorno}-${fine.giorno} ` +
              `${nomeMese(inizio.mese)}, slittata al ${destinazione.giorno} ` +
              `${nomeMese(destinazione.mese)} per ${slittamento.descrizione.toLowerCase()}.`,
          );
          corrente = nuova;
        } else {
          spiegazioni.push(
            `Scadenza nel periodo ${inizio.giorno}-${fine.giorno} ${nomeMese(inizio.mese)}, ` +
              `già collocata al ${destinazione.giorno} ${nomeMese(destinazione.mese)} ` +
              `per ${slittamento.descrizione.toLowerCase()}.`,
          );
        }
      }
      continue;
    }

    if (slittamento.tipo === "slittamento_lavorativo") {
      const motivo = motivoNonLavorativo(corrente, festivi);
      if (motivo) {
        const nuova = prossimoGiornoLavorativo(corrente, festivi);
        spiegazioni.push(
          `Slittata al ${formattaDataItaliana(nuova)} perché il ` +
            `${formattaDataItaliana(corrente)} cade di ${motivo}.`,
        );
        corrente = nuova;
      }
    }
  }

  return { data: corrente, spiegazioni };
}

const NOMI_MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

function nomeMese(mese: number): string {
  return NOMI_MESI[mese - 1] ?? `mese ${mese}`;
}

/**
 * Identificatore stabile di una singola scadenza all'interno di una regola.
 *
 * È costruito sulla posizione *dichiarata* (giorno e mese), non sulla data
 * finale: se una proroga o uno slittamento sposta la scadenza, l'evento resta lo
 * stesso e il client di calendario lo aggiorna invece di duplicarlo.
 *
 * Senza questo suffisso le quattro rate trimestrali condividerebbero lo stesso
 * UID e nei client ne sopravviverebbe una sola.
 */
function chiaveSlot(data: Date): string {
  const mese = (data.getUTCMonth() + 1).toString().padStart(2, "0");
  const giorno = data.getUTCDate().toString().padStart(2, "0");
  return `${mese}${giorno}`;
}

function riferimentoNormativo(regola: Regola, anno: number): string {
  const stato = regola.stato_verifica ?? "verificato";
  const parti = [
    `Riferimento normativo applicato per il ${anno}: ` +
      `${regola.fonte_normativa || "non disponibile"}.`,
  ];
  if (regola.fonte_url) parti.push(`Fonte: ${regola.fonte_url}`);
  for (const fonte of regola.fonti_aggiuntive ?? []) {
    parti.push(
      `Fonte per ${fonte.aspetto}: ${fonte.fonte_normativa}` +
        `${fonte.fonte_url ? ` — ${fonte.fonte_url}` : ""}.`,
    );
  }
  if (stato !== "verificato") {
    // Deliberately short: an event description has to stay readable, while the
    // full explanation belongs on the public page, which lists every
    // non-verified datum in its own section.
    parti.push(
      `ATTENZIONE: riferimento non confermato automaticamente (${stato}). ` +
        `Spiegazione e limiti sulla pagina pubblica.`,
    );
  }
  return parti.join(" ");
}

function testoScadenza(
  regola: Regola,
  esito: EsitoData,
  insieme: ParametriAnno,
  proroga: ProrogaApplicata | undefined,
  dataFinale: Date,
  dataGenerazione: Date,
): string {
  const parti: string[] = [];

  if (proroga) {
    parti.push(
      `ATTENZIONE PROROGA: data ordinaria ${formattaDataItaliana(esito.data)}, ` +
        `differita a ${formattaDataItaliana(dataFinale)}. Fonte verificata: ` +
        `${proroga.fonte_url}. Estratto: "${proroga.estratto_testuale}".`,
    );
  } else {
    parti.push(`Scadenza ordinaria: ${formattaDataItaliana(esito.data)}.`);
    parti.push(...esito.spiegazioni);
    parti.push(
      `Nessuna proroga rilevata alla data di generazione ` +
        `(${formattaDataItaliana(dataGenerazione)}). Verifica sempre il calendario ufficiale ` +
        `Agenzia delle Entrate in prossimità della scadenza.`,
    );
  }

  parti.push(riferimentoNormativo(regola, insieme.anno_richiesto));

  if (regola.rateizzabile && regola.max_rate) {
    parti.push(testoRateizzazione(regola));
  }

  if (insieme.provvisorio) {
    parti.push(
      `Le date dell'anno ${insieme.anno_richiesto} sono calcolate sulla regola vigente; ` +
        `potrebbero essere modificate da proroghe non ancora pubblicate.`,
    );
  }

  return parti.join(" ");
}

function testoRateizzazione(regola: Regola): string {
  const piano = regola.pianificazione_rate;
  const base = `Rateizzabile in un massimo di ${regola.max_rate} rate.`;
  if (!piano) return base;

  const date: string[] = [];
  for (let indice = 0; indice < piano.numero_rate; indice += 1) {
    const mese = piano.prima_rata.mese + indice;
    if (mese > piano.mese_ultima_rata) break;
    date.push(`${piano.prima_rata.giorno} ${nomeMese(mese)}`);
  }

  return (
    `${base} Opzione per ${piano.numero_rate} rate mensili di pari importo, con scadenza il ` +
    `${date.join(", ")}. Ogni rata va maggiorata degli interessi di dilazione previsti.`
  );
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export type OpzioniGenerazione = {
  config: Regole;
  parametri: Parametri;
  anni: number[];
  dataGenerazione: Date;
  proroghe?: ProrogaApplicata[];
};

export function costruisciEventi(opzioni: OpzioniGenerazione): EventoGenerato[] {
  const { config, parametri, dataGenerazione } = opzioni;
  const proroghe = opzioni.proroghe ?? [];
  const errori = verificaConfigurazione(config);
  if (errori.length > 0) {
    throw new Error(`regole.json non valido:\n  - ${errori.join("\n  - ")}`);
  }

  const slittamenti = regoleSlittamento(config);
  const festivi = mappaFestivi(config, opzioni.anni.flatMap((a) => [a - 1, a, a + 1]));
  const eventi: EventoGenerato[] = [];

  for (const anno of opzioni.anni) {
    const insieme = risolviParametriAnno(parametri, anno);
    // Gli slittamenti possono essere dichiarati con varianti: vanno risolti per
    // l'anno in lavorazione, come le regole che producono le date.
    const slittamentiAnno = slittamenti.map((s) => regolaPerAnno(s, anno));

    for (const regolaBase of regoleConDate(config)) {
      const regola = regolaPerAnno(regolaBase, anno);
      for (const candidata of dateCandidate(regola, anno)) {
        const esito = applicaSlittamenti(candidata, slittamentiAnno, festivi);

        // La proroga va applicata alla SINGOLA scadenza, non a tutte quelle
        // dell'anno: un differimento della rata di maggio non deve spostare
        // anche febbraio, agosto e novembre. Si confronta perciò la data, sia
        // nella forma dichiarata dalla regola sia in quella effettiva dopo gli
        // slittamenti (il modello può citare l'una o l'altra).
        const chiaviAmmesse = new Set([chiaveData(candidata), chiaveData(esito.data)]);
        const proroga = proroghe.find(
          (p) => p.scadenza === regola.id && chiaviAmmesse.has(p.data_originale),
        );
        const dataFinale = proroga ? new Date(`${proroga.data_nuova}T00:00:00Z`) : esito.data;

        const profili = config.profili.filter(
          (profilo) =>
            !regola.applicabile_a ||
            regola.applicabile_a.length === 0 ||
            regola.applicabile_a.includes(profilo.id),
        );

        for (const profilo of profili) {
          const calcolo = descriviCalcolo(regola, profilo, parametri, insieme);
          const scadenza = testoScadenza(
            regola,
            esito,
            insieme,
            proroga,
            dataFinale,
            dataGenerazione,
          );

          eventi.push({
            regola_id: regola.id,
            profilo_id: profilo.id,
            anno,
            uid: `${anno}-${regola.id}-${chiaveSlot(candidata)}-${profilo.id}@${config.metadati.dominio_calendari}`,
            data: dataFinale,
            data_ordinaria: esito.data,
            titolo: `${regola.titolo_breve ?? regola.descrizione} — ${profilo.nome}`,
            descrizione: [`CRITERI DI CALCOLO: ${calcolo}`, `CRITERI DI SCADENZA: ${scadenza}`].join(
              "\n\n",
            ),
            promemoria_giorni: promemoria(regola),
          });
        }
      }
    }
  }

  const uidVisti = new Map<string, string>();
  for (const evento of eventi) {
    const precedente = uidVisti.get(evento.uid);
    if (precedente) {
      throw new Error(
        `UID duplicato "${evento.uid}": gli eventi ${precedente} e ` +
          `${evento.regola_id}/${evento.profilo_id} collidono. Un UID ripetuto fa perdere ` +
          "eventi ai client di calendario: la generazione viene interrotta.",
      );
    }
    uidVisti.set(evento.uid, `${evento.regola_id}/${evento.profilo_id}`);
  }

  return eventi.sort(
    (a, b) =>
      a.data.getTime() - b.data.getTime() ||
      a.profilo_id.localeCompare(b.profilo_id) ||
      a.regola_id.localeCompare(b.regola_id),
  );
}
