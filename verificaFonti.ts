/**
 * Quarterly verification of the normative data (section 3 of the specification).
 *
 * Tre categorie verificate ad ogni run:
 *   1. regole strutturali (regole.json) — fonti modificate, abrogate o sostituite;
 *   2. parametri annuali (parametri.json) — valori dell'anno corrente e successivo;
 *   3. proroghe — decreti o comunicati che spostano temporaneamente una scadenza.
 *
 * Il modello propone; il codice decide. Nessuna proposta viene applicata senza
 * che l'estratto citato sia stato ritrovato letteralmente nella pagina indicata
 * (`src/verifica-web.ts`). In più, i campi modificabili sono limitati da una
 * allowlist: il modello non può cambiare `tipo`, `attivo`, `applicabile_a` o il
 * tipo di calcolo di una regola, nemmeno se glielo si chiedesse.
 *
 * Fail-closed: qualunque errore — chiave assente, timeout, JSON non valido,
 * verifica web fallita — lascia regole.json e parametri.json invariati.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  conversaConStrumenti,
  estraiJson,
  configurazioneDaAmbiente as configurazioneDeepSeek,
  type DefinizioneStrumento,
  type Messaggio,
} from "./src/deepseek.ts";
import { cercaWeb, configurazioneDaAmbiente as configurazioneRicerca, providerRichiedeChiave, PROVIDER_PREDEFINITO } from "./src/ricerca.ts";
import { impostaDominiAmmessi, leggiFonte, normalizza, verificaEstratto } from "./src/verifica-web.ts";
import type {
  ModificaRegola,
  Parametri,
  ProrogaPubblicata,
  Regole,
  StatusFile,
} from "./src/tipi.ts";

export const MAX_MODIFICHE_REGOLE_PER_RUN = 2;

/* ------------------------------------------------------------------ *
 * Allowlist dei campi modificabili automaticamente
 * ------------------------------------------------------------------ */

const CAMPI_REGOLA_MODIFICABILI = new Set([
  "giorno",
  "mese",
  "descrizione",
  "titolo_breve",
  "nota",
  "split_acconto_percentuale",
  "rateizzabile",
  "max_rate",
  "fonte_normativa",
  "fonte_url",
  "estratto_verificato",
  "periodo_inizio",
  "periodo_fine",
  "slitta_a",
  "date",
]);

/** Structurally load-bearing fields the model must never touch. */
const CAMPI_REGOLA_VIETATI = new Set([
  "id",
  "tipo",
  "attivo",
  "categoria",
  "applicabile_a",
  "usa_festivi",
  "calcolo",
  "pianificazione_rate",
]);

/* ------------------------------------------------------------------ *
 * Pagine indice istituzionali (fonti.json)
 * ------------------------------------------------------------------ */

export type PaginaIndice = {
  id: string;
  ente: string;
  url: string;
  cosa_cercare: string;
};

export type FontiIndice = {
  schema_version: number;
  descrizione?: string;
  verificato_il?: string;
  /** Domini accettati come prova. Vuoto = nessuna restrizione. */
  domini_autorevoli?: string[];
  pagine_indice: PaginaIndice[];
  query_predefinite?: string[];
};

export function caricaFonti(directory: string): FontiIndice {
  const percorso = join(directory, "fonti.json");
  if (!existsSync(percorso)) {
    return { schema_version: 1, pagine_indice: [], query_predefinite: [], domini_autorevoli: [] };
  }
  const letto = JSON.parse(readFileSync(percorso, "utf8")) as FontiIndice;
  return {
    schema_version: letto.schema_version ?? 1,
    descrizione: letto.descrizione,
    verificato_il: letto.verificato_il,
    pagine_indice: letto.pagine_indice ?? [],
    query_predefinite: letto.query_predefinite ?? [],
    domini_autorevoli: letto.domini_autorevoli ?? [],
  };
}

/**
 * Elenco dei domini ammessi come prova: quelli dichiarati in fonti.json più
 * quelli già citati nelle fonti pubblicate.
 *
 * Derivare l'elenco dai dati esistenti evita che una fonte già accettata smetta
 * di funzionare, e allo stesso tempo impedisce che una pagina scelta dal modello
 * fuori da questo perimetro venga trattata come prova.
 */
export function dominiPerLaVerifica(
  fonti: FontiIndice,
  config: Regole,
  parametri: Parametri,
): string[] {
  const domini = new Set(fonti.domini_autorevoli ?? []);

  const aggiungiDaUrl = (valore: string | undefined) => {
    if (!valore) return;
    try {
      domini.add(new URL(valore).hostname.toLowerCase());
    } catch {
      // Un URL non analizzabile non aggiunge nulla all'elenco: verrà rifiutato
      // comunque, più avanti, dal controllo sui domini.
    }
  };

  for (const regola of config.regole) {
    aggiungiDaUrl(regola.fonte_url);
    regola.fonti_aggiuntive?.forEach((fonte) => aggiungiDaUrl(fonte.fonte_url));
    regola.varianti_validita?.forEach((variante) => aggiungiDaUrl(variante.fonte_url));
  }
  for (const proroga of config.proroghe ?? []) aggiungiDaUrl(proroga.fonte_url);
  for (const fonte of parametri.fonti_comuni ?? []) aggiungiDaUrl(fonte.fonte_url);
  for (const insieme of Object.values(parametri.anni)) {
    for (const fonte of insieme.fonti ?? []) aggiungiDaUrl(fonte.fonte_url);
  }

  return [...domini];
}

export type PropostaRegola = {
  id: string;
  campo_modificato: string;
  valore_nuovo: unknown;
  fonte_url: string;
  estratto_testuale: string;
  motivo_modifica?: string;
};

export type PropostaParametro = {
  campo: string;
  anno?: number;
  valore_nuovo: unknown;
  fonte_url: string;
  estratto_testuale: string;
};

export type PropostaProroga = {
  scadenza: string;
  data_originale: string;
  data_nuova: string;
  fonte_url: string;
  estratto_testuale: string;
};

export type RispostaModello = {
  regole_aggiornate: PropostaRegola[];
  parametri_aggiornati: PropostaParametro[];
  proroghe: PropostaProroga[];
};

export type EsitoVerifica = {
  eseguita: boolean;
  esito: "riuscito" | "fallito";
  dettaglio: string | null;
  modello: string | null;
  regoleModificate: ModificaRegola[];
  parametriModificati: {
    campo: string;
    valore_precedente: unknown;
    valore_nuovo: unknown;
    fonte_url: string;
  }[];
  prorogheApplicate: ProrogaPubblicata[];
  scartatePerLimite: string[];
  scartatePerVerifica: { id_o_campo: string; motivo: string }[];
};

/**
 * Controlla che il nuovo valore numerico compaia davvero nell'estratto citato.
 *
 * La sola presenza dell'estratto non basta: si può citare una pagina che parla
di "24,48%" per giustificare il cambio di un giorno. Qui si pretende che la
 * prova contenga proprio il numero che si vuole scrivere.
 *
 * Fail-closed: se il numero non compare, la proposta viene scartata e il motivo
 * finisce in status.json. Il caso in cui la fonte scrive il numero a parole è un
 * falso negativo accettato, perché il verso opposto (applicare un numero non
 * provato) è molto più dannoso.
 */
export function numeroPresenteNellEstratto(valore: number, estratto: string): boolean {
  const testo = normalizza(estratto);
  const candidati = new Set<string>();

  candidati.add(String(valore));
  candidati.add(String(valore).replace(".", ","));

  if (Number.isInteger(valore)) {
    candidati.add(String(valore).replace(/\B(?=(\d{3})+(?!\d))/g, "."));
  } else {
    // Una quota come 0,2448 viene normalmente citata come "24,48".
    const per100 = valore * 100;
    candidati.add(String(per100).replace(".", ","));
    candidati.add(per100.toFixed(2).replace(/\.?0+$/, "").replace(".", ","));
  }

  for (const candidato of candidati) {
    if (candidato === "") continue;
    const indice = testo.indexOf(candidato);
    if (indice === -1) continue;
    const prima = indice === 0 ? "" : testo[indice - 1];
    const dopo = testo[indice + candidato.length] ?? "";
    if (!/[0-9]/.test(prima) && !/[0-9]/.test(dopo)) return true;
  }

  return false;
}

/** Campi scalari numerici per cui il valore deve comparire nell'estratto. */
const CAMPI_NUMERICI_CON_PROVA = new Set([
  "giorno",
  "mese",
  "max_rate",
  "split_acconto_percentuale",
]);

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

function bloccoRegole(config: Regole): string {
  return JSON.stringify(
    {
      versione_normativa_verificata: config.versione_normativa_verificata,
      regole: config.regole,
      proroghe: config.proroghe ?? [],
    },
    null,
    2,
  );
}

function bloccoParametri(parametri: Parametri): string {
  return JSON.stringify(parametri, null, 2);
}

function bloccoPagineIndice(fonti: FontiIndice): string {
  if (fonti.pagine_indice.length === 0) return "(nessuna pagina indice configurata)";
  return fonti.pagine_indice
    .map((p) => `- ${p.id} [${p.ente}] ${p.url}\n    da cercare: ${p.cosa_cercare}`)
    .join("\n");
}

/**
 * Runs the predefined search queries before the conversation starts.
 *
 * This is the install-and-forget path: even without a search API key, and even
 * if the model makes no tool call at all, the run still starts from fresh
 * institutional signals. Failures are collected, never fatal.
 */
async function raccogliRicerchePredefinite(
  fonti: FontiIndice,
  ricerca: { provider: string; apiKey: string },
): Promise<string> {
  const query = fonti.query_predefinite ?? [];
  if (query.length === 0) return "(nessuna query predefinita)";

  const blocchi: string[] = [];
  for (const q of query) {
    try {
      const risultati = await cercaWeb(q, ricerca);
      blocchi.push(
        `### query: ${q}\n${JSON.stringify(
          risultati.map((r) => ({
            titolo: r.titolo,
            data: r.data,
            testata: r.testata,
            url: r.url,
            estratto: r.estratto.slice(0, 200),
          })),
          null,
          1,
        )}`,
      );
    } catch (errore) {
      blocchi.push(
        `### query: ${q}\n(ricerca non riuscita: ${
          errore instanceof Error ? errore.message : String(errore)
        })`,
      );
    }
  }
  return blocchi.join("\n\n");
}

export function costruisciPromptSistema(
  config: Regole,
  parametri: Parametri,
  annoCorrente: number,
  fonti: FontiIndice,
  ricerchePreliminari: string,
): string {
  return `Sei un verificatore di normativa fiscale e previdenziale italiana, al servizio di un
generatore automatico di calendari di scadenze per il regime forfettario.

Data odierna: ${new Date().toISOString().slice(0, 10)}. Anno corrente: ${annoCorrente}.

Hai due strumenti:
- "cerca_web" per trovare segnali recenti (restituisce titoli, date e testate; può non
dare URL direttamente apribili);
- "apri_url" per scaricare il testo di una pagina pubblica. Usalo sulle pagine indice
  istituzionali e sugli URL ufficiali che devi citare.

Considera attendibili solo fonti istituzionali: Agenzia delle Entrate, INPS, Ministero
dell'Economia e delle Finanze, Ministero del Lavoro, Gazzetta Ufficiale, Normattiva.

PAGINE INDICE ISTITUZIONALI (sempre raggiungibili, senza motore di ricerca):
${bloccoPagineIndice(fonti)}

RISULTATI DELLE RICERCHE PREDEFINITE, GIÀ ESEGUITE PER TE:
${ricerchePreliminari}

Devi verificare TRE categorie:

1. REGOLE STRUTTURALI — per ciascuna regola dell'elenco, controlla se la fonte normativa citata
   è stata modificata, abrogata o sostituita, cercando riferimenti recenti alle fonte_url già
   presenti. Proponi una modifica solo se la norma è cambiata davvero.

2. PARAMETRI ANNUALI — verifica i valori per l'anno corrente (${annoCorrente}) e per l'anno
   successivo (${annoCorrente + 1}) contro fonti ufficiali (circolari INPS, Legge di Bilancio).
   Per ogni valore proposto indica sempre il campo "anno" a cui si riferisce.
   Se i valori dell'anno successivo non sono ancora pubblicati, NON inventarli: ometti la voce.

3. PROROGHE — cerca decreti, DPCM o comunicati del trimestre in corso che spostano
   temporaneamente una scadenza già presente nell'elenco.

REGOLE INVIOLABILI:
- Non inventare fonti, URL, numeri o estratti. Se non trovi una conferma ufficiale, ometti la voce.
- Hai un numero limitato di chiamate agli strumenti: usale con giudizio e **concludi**. All'ultimo
  giro gli strumenti ti vengono tolti, quindi arriva comunque con una risposta scritta.
- Se una pagina non risponde o risponde con un errore, non riprovare più di una volta: segnala il
  problema fra le note e passa avanti.
- Per ogni voce l'estratto_testuale DEVE essere copiato letteralmente dalla pagina che citi:
  verrà ricercato automaticamente nel contenuto della pagina e la proposta sarà scartata se non
  compare. Apri la pagina con "apri_url" e copia la frase esatta che hai letto.
- Per i valori numerici, l'estratto deve contenere proprio il numero che proponi: una citazione che
  esiste ma non prova quel numero viene scartata.
- Un array vuoto è una risposta corretta e attesa quando non c'è nulla di verificabile. Non è un
  fallimento: è il risultato giusto quando le fonti non sono cambiate.
- Non proporre modifiche strutturali: non puoi cambiare il tipo di una regola, la sua
  applicabilità o il suo calcolo.

Elenco delle REGOLE STRUTTURALI attuali:
\`\`\`json
${bloccoRegole(config)}
\`\`\`

PARAMETRI ANNUALI attuali:
\`\`\`json
${bloccoParametri(parametri)}
\`\`\`

Rispondi ESCLUSIVAMENTE con un oggetto JSON puro, senza testo prima o dopo, in questa forma:
{
  "regole_aggiornate": [
    {
      "id": "<id della regola>",
      "campo_modificato": "<uno tra: giorno, mese, descrizione, titolo_breve, nota,
        split_acconto_percentuale, rateizzabile, max_rate, fonte_normativa, fonte_url,
        estratto_verificato, periodo_inizio, periodo_fine, slitta_a, date>",
      "valore_nuovo": <valore>,
      "fonte_url": "<URL della fonte ufficiale>",
      "estratto_testuale": "<frase copiata letteralmente dalla fonte>",
      "motivo_modifica": "<perché la norma è cambiata>"
    }
  ],
  "parametri_aggiornati": [
    {
      "campo": "<nome del campo di parametri.json>",
      "anno": <anno a cui si riferisce il valore>,
      "valore_nuovo": <numero>,
      "fonte_url": "<URL della fonte ufficiale>",
      "estratto_testuale": "<frase copiata letteralmente dalla fonte>"
    }
  ],
  "proroghe": [
    {
      "scadenza": "<id della regola interessata>",
      "data_originale": "<YYYY-MM-DD>",
      "data_nuova": "<YYYY-MM-DD>",
      "fonte_url": "<URL della fonte ufficiale>",
      "estratto_testuale": "<frase copiata letteralmente dalla fonte>"
    }
  ]
}`;
}

const STRUMENTO_RICERCA: DefinizioneStrumento = {
  type: "function",
  function: {
    name: "cerca_web",
    description:
      "Cerca segnali recenti sul web su fonti istituzionali italiane. Restituisce titolo, " +
      "data, testata ed eventuale estratto. Le URL restituite possono essere reindirizzamenti " +
      "non apribili: in quel caso individua la pagina ufficiale e leggila con apri_url.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Interrogazione di ricerca in italiano." },
      },
      required: ["query"],
    },
  },
};

const STRUMENTO_APRI_URL: DefinizioneStrumento = {
  type: "function",
  function: {
    name: "apri_url",
    description:
      "Scarica una pagina web pubblica e ne restituisce il testo. È lo strumento da usare " +
      "per leggere le pagine indice istituzionali e per copiare l'estratto letterale da citare.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completo della pagina da leggere." },
      },
      required: ["url"],
    },
  },
};

/* ------------------------------------------------------------------ *
 * Validazione delle proposte
 * ------------------------------------------------------------------ */

function eInteroInIntervallo(valore: unknown, minimo: number, massimo: number): boolean {
  return typeof valore === "number" && Number.isInteger(valore) && valore >= minimo && valore <= massimo;
}

function validaValoreRegola(campo: string, valore: unknown): string | null {
  switch (campo) {
    case "giorno":
      return eInteroInIntervallo(valore, 1, 31) ? null : "giorno deve essere un intero tra 1 e 31";
    case "mese":
      return eInteroInIntervallo(valore, 1, 12) ? null : "mese deve essere un intero tra 1 e 12";
    case "split_acconto_percentuale":
      return eInteroInIntervallo(valore, 0, 100)
        ? null
        : "split_acconto_percentuale deve essere un intero tra 0 e 100";
    case "max_rate":
      return eInteroInIntervallo(valore, 1, 12) ? null : "max_rate deve essere un intero tra 1 e 12";
    case "rateizzabile":
      return typeof valore === "boolean" ? null : "rateizzabile deve essere booleano";
    case "periodo_inizio":
    case "periodo_fine":
    case "slitta_a": {
      const oggetto = valore as { giorno?: unknown; mese?: unknown };
      const valido =
        oggetto &&
        typeof oggetto === "object" &&
        eInteroInIntervallo(oggetto.giorno, 1, 31) &&
        eInteroInIntervallo(oggetto.mese, 1, 12);
      return valido ? null : "la data deve avere giorno (1-31) e mese (1-12)";
    }
    case "date": {
      if (!Array.isArray(valore) || valore.length === 0) {
        return "date deve essere un array non vuoto di oggetti {giorno, mese}";
      }
      const tutteValide = valore.every((voce) => {
        const oggetto = voce as { giorno?: unknown; mese?: unknown };
        return (
          oggetto &&
          typeof oggetto === "object" &&
          eInteroInIntervallo(oggetto.giorno, 1, 31) &&
          eInteroInIntervallo(oggetto.mese, 1, 12)
        );
      });
      return tutteValide ? null : "ogni voce di date deve avere giorno (1-31) e mese (1-12)";
    }
    case "fonte_normativa":
    case "estratto_verificato":
    case "nota":
    case "titolo_breve":
    case "descrizione":
      return typeof valore === "string" && valore.trim().length > 0
        ? null
        : `${campo} deve essere una stringa non vuota`;
    case "fonte_url":
      return typeof valore === "string" && /^https?:\/\//.test(valore)
        ? null
        : "fonte_url deve essere un URL http(s)";
    default:
      return `campo non modificabile automaticamente: ${campo}`;
  }
}

function validaFormaRisposta(grezzo: unknown): RispostaModello {
  const oggetto = grezzo as Partial<RispostaModello>;
  if (!oggetto || typeof oggetto !== "object") {
    throw new Error("La risposta del modello non è un oggetto JSON.");
  }

  const comeArray = <T>(valore: unknown, nome: string): T[] => {
    if (valore === undefined || valore === null) return [];
    if (!Array.isArray(valore)) {
      throw new Error(`Il campo "${nome}" della risposta non è un array.`);
    }
    return valore as T[];
  };

  return {
    regole_aggiornate: comeArray<PropostaRegola>(oggetto.regole_aggiornate, "regole_aggiornate"),
    parametri_aggiornati: comeArray<PropostaParametro>(
      oggetto.parametri_aggiornati,
      "parametri_aggiornati",
    ),
    proroghe: comeArray<PropostaProroga>(oggetto.proroghe, "proroghe"),
  };
}

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(valore: string): boolean {
  if (!FORMATO_DATA.test(valore)) return false;
  const data = new Date(`${valore}T00:00:00Z`);
  return !Number.isNaN(data.getTime());
}

/* ------------------------------------------------------------------ *
 * Esecuzione
 * ------------------------------------------------------------------ */

export type OpzioniVerifica = {
  directory: string;
};

export async function eseguiVerificaFonti(opzioni: OpzioniVerifica): Promise<EsitoVerifica> {
  const percorsoRegole = join(opzioni.directory, "regole.json");
  const percorsoParametri = join(opzioni.directory, "parametri.json");

  const config = JSON.parse(readFileSync(percorsoRegole, "utf8")) as Regole;
  const parametri = JSON.parse(readFileSync(percorsoParametri, "utf8")) as Parametri;

  // Copia dello stato PRIMA di qualunque modifica. Le mutazioni avvengono in
  // place sugli stessi oggetti di `config.regole`, quindi serializzare `config`
  // più tardi produrrebbe uno snapshot contenente i valori NUOVI: ripristinarlo
  // non annullerebbe nulla, e la promessa di poter ricostruire "cosa diceva il
  // sistema prima" resterebbe lettera morta.
  const configPrima = structuredClone(config);

  const fallito = (dettaglio: string): EsitoVerifica => ({
    eseguita: false,
    esito: "fallito",
    dettaglio,
    modello: null,
    regoleModificate: [],
    parametriModificati: [],
    prorogheApplicate: [],
    scartatePerLimite: [],
    scartatePerVerifica: [],
  });

  const deepseek = configurazioneDeepSeek();
  const ricerca = configurazioneRicerca();

  if (!deepseek.apiKey) {
    return fallito("DEEPSEEK_API_KEY non configurata: verifica delle fonti non eseguita.");
  }
  // The default search provider is keyless on purpose; only the optional
  // keyed providers can make a run refuse to start.
  if (providerRichiedeChiave(ricerca.provider) && !ricerca.apiKey) {
    return fallito(
      `SEARCH_PROVIDER="${ricerca.provider}" richiede SEARCH_API_KEY. ` +
        `Rimuovi SEARCH_PROVIDER per usare il provider predefinito senza chiave ` +
        `("${PROVIDER_PREDEFINITO}").`,
    );
  }

  const fonti = caricaFonti(opzioni.directory);
  // Elenco dei domini accettati come prova, impostato PRIMA di qualunque
  // richiesta: da qui in poi nessun punto di chiamata può aggirarlo, perché il
  // controllo vive dentro `leggiFonte`.
  impostaDominiAmmessi(dominiPerLaVerifica(fonti, config, parametri));
  const annoCorrente = new Date().getUTCFullYear();

  const ricerchePreliminari = await raccogliRicerchePredefinite(fonti, ricerca);

  const messaggi: Messaggio[] = [
    {
      role: "system",
      content: costruisciPromptSistema(config, parametri, annoCorrente, fonti, ricerchePreliminari),
    },
    {
      role: "user",
      content:
        "Esegui la verifica trimestrale delle tre categorie e restituisci il JSON richiesto.",
    },
  ];

  let contenuto: string;
  let modello: string;
  try {
    const esito = await conversaConStrumenti(
      messaggi,
      [STRUMENTO_RICERCA, STRUMENTO_APRI_URL],
      async (nome, argomenti) => {
        if (nome === "cerca_web") {
          const query = String(argomenti.query ?? "").trim();
          if (!query) throw new Error("Query di ricerca vuota.");
          return { risultati: await cercaWeb(query, ricerca) };
        }
        if (nome === "apri_url") {
          const url = String(argomenti.url ?? "").trim();
          if (!url) throw new Error("URL mancante.");
          const lettura = await leggiFonte(url);
          if (!lettura.testo) {
            return { errore: lettura.dettaglio ?? "Pagina non leggibile." };
          }
          return {
            http_status: lettura.http_status,
            tipo_contenuto: lettura.tipo,
            testo: lettura.testo.replace(/\s+/g, " ").slice(0, 40_000),
          };
        }
        throw new Error(`Strumento "${nome}" non disponibile.`);
      },
      deepseek,
    );
    contenuto = esito.contenuto;
    modello = esito.modello;
  } catch (errore) {
    return fallito(
      `Chiamata al modello non riuscita: ${errore instanceof Error ? errore.message : String(errore)}`,
    );
  }

  let proposta: RispostaModello;
  try {
    proposta = validaFormaRisposta(estraiJson(contenuto));
  } catch (errore) {
    return fallito(
      `Risposta del modello non interpretabile come JSON valido: ` +
        `${errore instanceof Error ? errore.message : String(errore)}`,
    );
  }

  const scartatePerVerifica: { id_o_campo: string; motivo: string }[] = [];
  const regoleModificate: ModificaRegola[] = [];
  const parametriModificati: EsitoVerifica["parametriModificati"] = [];
  const prorogheApplicate: ProrogaPubblicata[] = [];
  const scartatePerLimite: string[] = [];

  /* ---------------- regole strutturali ---------------- */

  const regolePerId = new Map(
    config.regole.map((regola) => [regola.id, regola as unknown as Record<string, unknown>]),
  );
  const giaModificate = new Set<string>();

  for (const voce of proposta.regole_aggiornate) {
    const chiave = String(voce.id ?? "");

    if (!regolePerId.has(chiave)) {
      scartatePerVerifica.push({ id_o_campo: chiave, motivo: 'regola inesistente in regole.json' });
      continue;
    }

    const campo = String(voce.campo_modificato ?? "");
    if (CAMPI_REGOLA_VIETATI.has(campo)) {
      scartatePerVerifica.push({
        id_o_campo: `${chiave}.${campo}`,
        motivo: "campo strutturale non modificabile automaticamente",
      });
      continue;
    }
    if (!CAMPI_REGOLA_MODIFICABILI.has(campo)) {
      scartatePerVerifica.push({
        id_o_campo: `${chiave}.${campo}`,
        motivo: "campo fuori dall'allowlist delle modifiche automatiche",
      });
      continue;
    }

    const erroreValore = validaValoreRegola(campo, voce.valore_nuovo);
    if (erroreValore) {
      scartatePerVerifica.push({ id_o_campo: `${chiave}.${campo}`, motivo: erroreValore });
      continue;
    }

    // The hard cap on rule edits per run (section 3d): only the first two
    // distinct rules survive; the rest are reported, never applied silently.
    if (!giaModificate.has(chiave) && giaModificate.size >= MAX_MODIFICHE_REGOLE_PER_RUN) {
      scartatePerLimite.push(chiave);
      continue;
    }

    const estratto = String(voce.estratto_testuale ?? "");
    if (
      CAMPI_NUMERICI_CON_PROVA.has(campo) &&
      typeof voce.valore_nuovo === "number" &&
      !numeroPresenteNellEstratto(voce.valore_nuovo, estratto)
    ) {
      scartatePerVerifica.push({
        id_o_campo: `${chiave}.${campo}`,
        motivo:
          `il valore proposto (${voce.valore_nuovo}) non compare nell'estratto citato: ` +
          "la citazione esiste, ma non prova proprio quel numero.",
      });
      continue;
    }

    const verifica = await verificaEstratto(String(voce.fonte_url ?? ""), estratto);
    if (verifica.esito !== "confermato") {
      scartatePerVerifica.push({
        id_o_campo: `${chiave}.${campo}`,
        motivo: `${verifica.esito}: ${verifica.dettaglio}`,
      });
      continue;
    }

    const regola = regolePerId.get(chiave) as Record<string, unknown>;
    regoleModificate.push({
      id: chiave,
      campo_modificato: campo,
      valore_precedente: regola[campo] ?? null,
      valore_nuovo: voce.valore_nuovo,
      fonte_url: String(voce.fonte_url),
    });
    regola[campo] = voce.valore_nuovo;
    giaModificate.add(chiave);
  }

  /* ---------------- parametri annuali ---------------- */

  for (const voce of proposta.parametri_aggiornati) {
    const campo = String(voce.campo ?? "");
    const anno = Number(voce.anno);

    const insiemeAnno = parametri.anni[String(anno)];
    if (!insiemeAnno) {
      scartatePerVerifica.push({
        id_o_campo: `${anno}.${campo}`,
        motivo: "anno non presente in parametri.json",
      });
      continue;
    }

    // Only values that already exist may be updated: this prevents the model
    // from inventing a new parameter that the rules engine would then read.
    if (typeof insiemeAnno[campo] !== "number") {
      scartatePerVerifica.push({
        id_o_campo: `${anno}.${campo}`,
        motivo: "campo inesistente o non numerico in parametri.json",
      });
      continue;
    }

    if (typeof voce.valore_nuovo !== "number" || !Number.isFinite(voce.valore_nuovo)) {
      scartatePerVerifica.push({
        id_o_campo: `${anno}.${campo}`,
        motivo: "il nuovo valore non è un numero finito",
      });
      continue;
    }

    const estratto = String(voce.estratto_testuale ?? "");
    if (!numeroPresenteNellEstratto(voce.valore_nuovo, estratto)) {
      scartatePerVerifica.push({
        id_o_campo: `${anno}.${campo}`,
        motivo:
          `il valore proposto (${voce.valore_nuovo}) non compare nell'estratto citato: ` +
          "la citazione esiste, ma non prova proprio quel numero.",
      });
      continue;
    }

    const verifica = await verificaEstratto(String(voce.fonte_url ?? ""), estratto);
    if (verifica.esito !== "confermato") {
      scartatePerVerifica.push({
        id_o_campo: `${anno}.${campo}`,
        motivo: `${verifica.esito}: ${verifica.dettaglio}`,
      });
      continue;
    }

    parametriModificati.push({
      campo: `${anno}.${campo}`,
      valore_precedente: insiemeAnno[campo],
      valore_nuovo: voce.valore_nuovo,
      fonte_url: String(voce.fonte_url),
    });
    insiemeAnno[campo] = voce.valore_nuovo;
  }

  /* ---------------- proroghe ---------------- */

  const idRegoleValidi = new Set(config.regole.map((regola) => regola.id));

  for (const voce of proposta.proroghe) {
    const scadenza = String(voce.scadenza ?? "");
    if (!idRegoleValidi.has(scadenza)) {
      scartatePerVerifica.push({
        id_o_campo: `proroga:${scadenza}`,
        motivo: "scadenza riferita a una regola inesistente",
      });
      continue;
    }
    if (!dataValida(String(voce.data_originale ?? "")) || !dataValida(String(voce.data_nuova ?? ""))) {
      scartatePerVerifica.push({
        id_o_campo: `proroga:${scadenza}`,
        motivo: "date della proroga in formato non valido (atteso YYYY-MM-DD)",
      });
      continue;
    }

    const verifica = await verificaEstratto(String(voce.fonte_url ?? ""), String(voce.estratto_testuale ?? ""));
    if (verifica.esito !== "confermato") {
      scartatePerVerifica.push({
        id_o_campo: `proroga:${scadenza}`,
        motivo: `${verifica.esito}: ${verifica.dettaglio}`,
      });
      continue;
    }

    prorogheApplicate.push({
      scadenza,
      data_originale: String(voce.data_originale),
      data_nuova: String(voce.data_nuova),
      fonte_url: String(voce.fonte_url),
      estratto_testuale: String(voce.estratto_testuale),
      rilevata_il: new Date().toISOString(),
    });
  }

  /* ---------------- scrittura, con snapshot preventivo ---------------- */

  const qualcosaDaScrivere =
    regoleModificate.length > 0 || parametriModificati.length > 0 || prorogheApplicate.length > 0;

  if (qualcosaDaScrivere) {
    if (regoleModificate.length > 0 || prorogheApplicate.length > 0) {
      const cartellaStorico = join(opzioni.directory, "regole.json.storico");
      mkdirSync(cartellaStorico, { recursive: true });
      const istante = new Date().toISOString().replace(/[:.]/g, "-");
      const percorsoSnapshot = join(cartellaStorico, `${istante}.json`);

      // Lo snapshot è lo stato PRECEDENTE più una nota che dice cosa ha cambiato
      // questa run: così "cosa diceva il sistema prima" resta ricostruibile
      // anche in un flusso interamente automatico, e il file può davvero essere
      // ripristinato.
      writeFileSync(
        percorsoSnapshot,
        serializzaSnapshot(configPrima, regoleModificate, prorogheApplicate, modello, new Date()),
      );
    }

    config.versione_normativa_verificata = new Date().toISOString().slice(0, 7);
    config.proroghe = [...(config.proroghe ?? []), ...prorogheApplicate];

    if (regoleModificate.length > 0 || prorogheApplicate.length > 0) {
      writeFileSync(percorsoRegole, `${JSON.stringify(config, null, 2)}\n`);
    }
    if (parametriModificati.length > 0) {
      writeFileSync(percorsoParametri, `${JSON.stringify(parametri, null, 2)}\n`);
    }
  }

  return {
    eseguita: true,
    esito: "riuscito",
    dettaglio: null,
    modello,
    regoleModificate,
    parametriModificati,
    prorogheApplicate,
    scartatePerLimite,
    scartatePerVerifica,
  };
}

/**
 * Serializza lo snapshot dello stato PREVEDENTE alla run.
 *
 * È una funzione pura e separata perché la garanzia che offre — poter
 * ricostruire e ripristinare "cosa diceva il sistema prima" — va dimostrata con
 * un test, non affermata: le mutazioni avvengono in place sugli stessi oggetti
 * di `config.regole`, quindi passare qui l'oggetto vivo annullerebbe la garanzia.
 */
export function serializzaSnapshot(
  precedente: Regole,
  regoleModificate: ModificaRegola[],
  prorogheApplicate: ProrogaPubblicata[],
  modello: string | null,
  istante: Date,
): string {
  return `${JSON.stringify(
    {
      _meta: {
        istante: istante.toISOString(),
        motivo: "stato precedente alla modifica automatica",
        regole_modificate: regoleModificate,
        proroghe_applicate: prorogheApplicate,
        modello,
      },
      ...precedente,
    },
    null,
    2,
  )}\n`;
}

/** Merges a verification outcome into the persisted status file. */
export function aggiornaStatus(
  precedente: StatusFile,
  esito: EsitoVerifica,
  istante = new Date(),
): StatusFile {
  const adesso = istante.toISOString();

  return {
    schema_version: precedente.schema_version ?? 1,
    ultimo_tentativo: adesso,
    ultimo_tentativo_esito: esito.esito,
    ultimo_aggiornamento_riuscito:
      esito.esito === "riuscito" ? adesso : precedente.ultimo_aggiornamento_riuscito,
    dettaglio_fallimento: esito.esito === "riuscito" ? null : esito.dettaglio,
    regole_modificate_ultima_run: esito.regoleModificate,
    parametri_modificati_ultima_run: esito.parametriModificati,
    proroghe_applicate_ultima_run: esito.prorogheApplicate.map((p) => ({
      scadenza: p.scadenza,
      data_originale: p.data_originale,
      data_nuova: p.data_nuova,
      fonte_url: p.fonte_url,
      estratto_testuale: p.estratto_testuale,
    })),
    regole_proposte_ma_scartate_per_limite_sicurezza: esito.scartatePerLimite,
    proposte_scartate_per_verifica_fallita: esito.scartatePerVerifica,
    modello_utilizzato: esito.modello,
    verifica_eseguita: esito.eseguita,
  };
}

export function leggiStatus(directory: string): StatusFile {
  const percorso = join(directory, "status.json");
  if (!existsSync(percorso)) {
    return {
      schema_version: 1,
      ultimo_tentativo: new Date(0).toISOString(),
      ultimo_tentativo_esito: "fallito",
      ultimo_aggiornamento_riuscito: null,
      dettaglio_fallimento: "Nessuna verifica registrata.",
      regole_modificate_ultima_run: [],
      parametri_modificati_ultima_run: [],
      proroghe_applicate_ultima_run: [],
      regole_proposte_ma_scartate_per_limite_sicurezza: [],
      proposte_scartate_per_verifica_fallita: [],
      modello_utilizzato: null,
      verifica_eseguita: false,
    };
  }
  return JSON.parse(readFileSync(percorso, "utf8")) as StatusFile;
}

export function scriviStatus(directory: string, status: StatusFile): void {
  writeFileSync(join(directory, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
}

/** Copies the current regole.json aside before an external tool rewrites it. */
export function snapshotManuale(directory: string): string {
  const cartella = join(directory, "regole.json.storico");
  mkdirSync(cartella, { recursive: true });
  const destinazione = join(cartella, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  copyFileSync(join(directory, "regole.json"), destinazione);
  return destinazione;
}

/* ------------------------------------------------------------------ *
 * Esecuzione diretta: `node verificaFonti.ts`
 * ------------------------------------------------------------------ */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? ".";
  const esito = await eseguiVerificaFonti({ directory });
  const status = aggiornaStatus(leggiStatus(directory), esito);
  scriviStatus(directory, status);

  if (esito.esito === "riuscito") {
    console.log(`Verifica riuscita (modello: ${esito.modello ?? "n/d"}).`);
    console.log(`  regole modificate:   ${esito.regoleModificate.length}`);
    console.log(`  parametri modificati: ${esito.parametriModificati.length}`);
    console.log(`  proroghe applicate:  ${esito.prorogheApplicate.length}`);
    console.log(`  proposte scartate per limite:   ${esito.scartatePerLimite.join(", ") || "nessuna"}`);
    console.log(`  proposte scartate per verifica: ${esito.scartatePerVerifica.length}`);
    for (const scarto of esito.scartatePerVerifica) {
      console.log(`    - ${scarto.id_o_campo}: ${scarto.motivo}`);
    }
  } else {
    console.error(`Verifica fallita: ${esito.dettaglio}`);
    console.error("Nessuna modifica è stata applicata a regole.json o parametri.json.");
    process.exitCode = 1;
  }
}
