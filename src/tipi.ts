/**
 * Declarative configuration types.
 *
 * Everything the rules engine reads is described here, so that `regole.json` and
 * `parametri.json` can be validated at load time and a malformed edit fails the
 * run closed instead of silently producing a wrong calendar.
 */

export type DataRicorrente = { giorno: number; mese: number };

/**
 * How well a normative datum is supported by a machine-readable source.
 *
 *  - "verificato": the excerpt was matched mechanically against the cited page.
 *  - "verificato_manualmente": letto e confermato a mano sulla fonte citata, ma
 *    non ricontrollabile automaticamente — tipicamente perché la fonte è un PDF,
 *    che la pipeline dichiara non testuale invece di fingersi capace di leggerlo.
 *  - "fonte_primaria_non_leggibile": an official source exists but its body is
 *    rendered by JavaScript and exposes nothing to a plain HTTP request, so the
 *    value came from unofficial reproductions and needs a human check.
 *  - "da_verificare": no reliable source was located.
 *
 * Tutto ciò che non è "verificato" è dichiarato sulla pagina pubblica: i due
 * stati "verificato_manualmente" e gli altri non vengono mai presentati come
 * accertati dal controllo automatico.
 */
export type StatoVerifica =
  | "verificato"
  | "verificato_manualmente"
  | "fonte_primaria_non_leggibile"
  | "da_verificare";

export type RiferimentoFonte = {
  fonte_normativa: string;
  fonte_url: string;
  estratto_verificato: string;
  stato_verifica?: StatoVerifica;
  nota?: string;
};

/**
 * Fonte relativa a un aspetto specifico della stessa regola.
 *
 * Serve quando una regola ha più basi normative distinte: per esempio la data
 * del saldo viene dall'art. 17 del D.P.R. 435/2001, ma la ripartizione
 * dell'acconto in due rate di pari importo viene dalla risoluzione 93/E/2019.
 * Un solo campo `fonte_*` per regola non basta a dirlo in modo onesto.
 */
export type FonteAggiuntiva = RiferimentoFonte & { aspetto: string };

export type CalendarioFestiviConfig = RiferimentoFonte & {
  id: string;
  tipo: "calendario_festivi";
  descrizione: string;
  festivi_fissi: { giorno: number; mese: number; denominazione: string }[];
  festivi_mobili: { tipo: string; denominazione: string }[];
};

export type BloccoCalcolo =
  | { tipo: "nessuno" }
  | { tipo: "adempimento" }
  /** Uses the profile's own `calcolo_contributi`. */
  | { tipo: "dal_profilo" }
  | {
      tipo: "contributo_fisso_rateizzato";
      base_param: string;
      aliquota_param: string;
      numero_rate: number;
    }
  | {
      tipo: "aliquota_su_reddito";
      aliquota_param: string;
      reddito_esempio_param: string;
    }
  | {
      tipo: "imposta_sostitutiva";
      aliquota_param: string;
      reddito_esempio_param: string;
      quota_acconto_percentuale?: number;
      descrizione_quota: string;
    };

export type PianificazioneRate = {
  tipo: "mensile_stesso_giorno";
  numero_rate: number;
  prima_rata: DataRicorrente;
  /** Month of the last instalment (closed interval start). */
  mese_ultima_rata: number;
};

/**
 * A rule version in force for a closed range of years.
 *
 * This exists so that the calendar for year N cites the norm that was actually
 * in force in year N. When a rule changes, the verification adds a variant for
 * the years it applies to and leaves the previous one untouched: the git history
 * then reads as an accurate record of what the system considered valid, year by
 * year, instead of a single citation that silently retro-applies.
 *
 * Any date-bearing or source-bearing field of the rule may be overridden.
 */
export type VarianteValidita = RiferimentoFonte & {
  da_anno: number;
  a_anno: number;
  giorno?: number;
  mese?: number;
  date?: DataRicorrente[];
  periodo_inizio?: DataRicorrente;
  periodo_fine?: DataRicorrente;
  slitta_a?: DataRicorrente;
  split_acconto_percentuale?: number;
  rateizzabile?: boolean;
  max_rate?: number;
};

export type Regola = {
  id: string;
  descrizione: string;
  titolo_breve?: string;
  varianti_validita?: VarianteValidita[];
  /** Fonti relative ad aspetti specifici della regola, oltre a quella principale. */
  fonti_aggiuntive?: FonteAggiuntiva[];
  tipo:
    | "data_fissa_annuale"
    | "data_ricorrente_mensile"
    | "date_ricorrenti_trimestrali"
    | "regola_slittamento"
    | "slittamento_lavorativo";
  attivo: boolean;
  categoria: "imposta_sostitutiva" | "contributi_inps" | "adempimento";
  /** Profiles this rule generates events for. Empty/absent means "every profile". */
  applicabile_a?: string[];
  giorno?: number;
  mese?: number;
  date?: DataRicorrente[];
  periodo_inizio?: DataRicorrente;
  periodo_fine?: DataRicorrente;
  slitta_a?: DataRicorrente;
  usa_festivi?: string;
  aliquota_param?: string;
  split_acconto_percentuale?: number;
  rateizzabile?: boolean;
  max_rate?: number;
  pianificazione_rate?: PianificazioneRate;
  calcolo: BloccoCalcolo;
  /**
   * Giorni di preavviso per i promemoria dell'evento, come interi POSITIVI
   * (es. `[15, 3]` = 15 e 3 giorni prima). Il segno meno della DURATION lo
   * aggiunge il serializzatore: un valore negativo qui produrrebbe `-P-15D`,
   * che non è una DURATION valida e farebbe scartare il promemoria ai client.
   */
  promemoria_giorni?: number[];
  /**
   * Aggiunge il calcolo contributivo del profilo al blocco CRITERI DI CALCOLO.
   * Serve alle regole dell'imposta sostitutiva: alla stessa scadenza si versa
   * anche la contribuzione previdenziale, e per la Gestione Separata questa è
   * l'unica occasione in cui il suo calcolo compare in calendario.
   */
  includi_calcolo_contributi?: boolean;
  fonte_normativa: string;
  fonte_url: string;
  estratto_verificato: string;
  stato_verifica?: StatoVerifica;
  nota?: string;
};

export type Profilo = {
  id: string;
  nome: string;
  nome_calendario: string;
  descrizione: string;
  /**
   * Copy per la pagina pubblica, distinta da `descrizione` perché quest'ultima
   * finisce dentro il calendario (X-WR-CALDESC), dove serve un tono neutro.
   * Se assente, la pagina usa `descrizione`.
   */
  descrizione_pagina?: string;
  /** Fino a tre punti brevi mostrati come pillole sulla carta del calendario. */
  punti_chiave?: string[];
  file: string;
  applica_riduzione_forfettario: boolean;
  calcolo_contributi: BloccoCalcolo;
};

/**
 * A confirmed, source-verified postponement of a deadline.
 *
 * Kept in `regole.json` next to the structural rules so that the whole body of
 * normative knowledge lives in one reviewable, versioned file, and so that the
 * commit history is the chronology shown on the website.
 */
export type ProrogaPubblicata = {
  scadenza: string;
  data_originale: string;
  data_nuova: string;
  fonte_url: string;
  estratto_testuale: string;
  rilevata_il: string;
};

export type Regole = {
  versione_normativa_verificata: string;
  metadati: {
    /** Indirizzo a cui il sito viene pubblicato: costruisce i link della pagina. */
    dominio: string;
    /**
     * Identità stabile degli eventi, usata negli UID dei calendari.
     *
     * È separata da `dominio` di proposito: se cambia l'indirizzo di
     * pubblicazione, gli UID devono restare gli stessi, altrimenti ogni client
     * già iscritto riceverebbe gli eventi come nuovi e li vedrebbe duplicati.
     */
    dominio_calendari: string;
    /** Dominio personalizzato da scrivere in CNAME; `null` per non pubblicarlo. */
    cname: string | null;
    prod_id: string;
    fuso_orario: string;
    url_repository: string;
  };
  profili: Profilo[];
  regole: (Regola | CalendarioFestiviConfig)[];
  proroghe?: ProrogaPubblicata[];
};

export type FonteParametro = {
  campo: string;
  fonte_url: string;
  fonte_normativa: string;
  estratto_verificato: string;
  stato_verifica?: StatoVerifica;
  data_fonte?: string;
  nota?: string;
};

export type AnnoParametri = {
  anno: number;
  /** True when the values were carried over because the year is unpublished. */
  valori_provvisori?: boolean;
  nota?: string;
  [campo: string]: unknown;
};

export type Parametri = {
  schema_version: number;
  comuni: Record<string, number>;
  fonti_comuni?: FonteParametro[];
  anni: Record<string, AnnoParametri>;
};

export type ModificaRegola = {
  id: string;
  campo_modificato: string;
  valore_precedente: unknown;
  valore_nuovo: unknown;
  fonte_url: string;
};

export type StatusFile = {
  schema_version: number;
  ultimo_tentativo: string;
  ultimo_tentativo_esito: "riuscito" | "fallito";
  ultimo_aggiornamento_riuscito: string | null;
  dettaglio_fallimento: string | null;
  regole_modificate_ultima_run: ModificaRegola[];
  parametri_modificati_ultima_run: {
    campo: string;
    valore_precedente: unknown;
    valore_nuovo: unknown;
    fonte_url: string;
  }[];
  proroghe_applicate_ultima_run: {
    scadenza: string;
    data_originale: string;
    data_nuova: string;
    fonte_url: string;
    estratto_testuale: string;
  }[];
  regole_proposte_ma_scartate_per_limite_sicurezza: string[];
  proposte_scartate_per_verifica_fallita: {
    id_o_campo: string;
    motivo: string;
  }[];
  modello_utilizzato: string | null;
  verifica_eseguita: boolean;
};
