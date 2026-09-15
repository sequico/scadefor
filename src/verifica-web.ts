/**
 * Independent web verification of a claim extracted by the model.
 *
 * The rule this module enforces is the one that makes the whole pipeline
 * trustworthy: a proposed change is applied only if the quoted excerpt is
 * *actually present* in the cited page. The model's word is never sufficient.
 *
 * Fail-closed by design: anything that cannot be positively verified —
 * unreachable URL, non-textual source, missing excerpt — results in the change
 * being discarded.
 */

const TIMEOUT_MS = 20_000;
const MAX_BYTE = 4_000_000;
const MAX_SALTI = 5;

/**
 * Host che non devono mai essere raggiungibili da questa pipeline.
 *
 * `leggiFonte` scarica URL scelti dal modello, e il modello legge contenuti
 * pubblicati da terzi: senza questo controllo, una pagina ostile può indurre il
 * sistema a leggere un servizio interno (loopback, rete privata, endpoint di
 * metadati cloud) e a riportarne il contenuto in conversazione, che è il canale
 * classico della prompt injection indiretta.
 *
 * Limite dichiarato: il controllo è sul nome host e sugli indirizzi IP
 * letterali. Non risolve il DNS, quindi non copre un nome pubblico che risolva a
 * un indirizzo privato (DNS rebinding).
 */
const NOMI_INTERNI = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?f[cd][0-9a-f]{2}:/i,
];

function hostInterno(host: string): string | null {
  const pulito = host.toLowerCase().replace(/:\d+$/, "");

  if (NOMI_INTERNI.some((espressione) => espressione.test(pulito))) {
    return "nome host interno o di loopback";
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(pulito);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0) return "indirizzo non instradabile (0.0.0.0/8)";
    if (a === 10) return "indirizzo di rete privata (10/8)";
    if (a === 127) return "indirizzo di loopback (127/8)";
    if (a === 169 && b === 254) return "indirizzo link-local, tipico dei metadati cloud (169.254/16)";
    if (a === 172 && b >= 16 && b <= 31) return "indirizzo di rete privata (172.16/12)";
    if (a === 192 && b === 168) return "indirizzo di rete privata (192.168/16)";
    if (a >= 224) return "indirizzo multicast o riservato";
  }

  return null;
}

/**
 * Domini considerati fonti ammissibili. Elenco vuoto = nessuna restrizione, che
 * è il comportamento dei test; in produzione `verificaFonti.ts` lo popola da
 * fonti.json prima di qualunque richiesta.
 *
 * È deliberatamente stato di modulo e non un parametro: così nessun punto di
 * chiamata, presente o futuro, può dimenticarsi di applicare il controllo.
 */
let dominiAmmessi: string[] = [];

export function impostaDominiAmmessi(domini: string[]): void {
  dominiAmmessi = domini
    .map((dominio) => dominio.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((dominio) => dominio !== "");
}

export function dominiAmmessiCorrenti(): string[] {
  return [...dominiAmmessi];
}

function hostAmmesso(url: URL): string | null {
  const interno = hostInterno(url.hostname);
  if (interno) return interno;

  if (dominiAmmessi.length === 0) return null;

  const host = url.hostname.toLowerCase();
  const ammesso = dominiAmmessi.some(
    (dominio) => host === dominio || host.endsWith(`.${dominio}`),
  );
  return ammesso
    ? null
    : `host non presente nell'elenco delle fonti ammesse (${host})`;
}

const USER_AGENT =
  "scadefor/1.0 (+https://github.com/sequico/scadefor) verifica-automatica-fonti";

export type EsitoVerificaWeb = {
  esito:
    | "confermato"
    | "estratto_non_trovato"
    | "fonte_non_testuale"
    | "errore_rete"
    | "url_non_valido";
  dettaglio: string;
  http_status?: number;
};

/**
 * Normalizes both the page text and the quoted excerpt before comparison:
 * lowercase, whitespace collapsed, non-breaking spaces and typographic
 * punctuation folded to ASCII, and whitespace removed before punctuation.
 *
 * Two of these steps exist for a measured reason rather than for convenience:
 *
 *  - Folded punctuation lets a quote typed with straight quotes match the same
 *    sentence rendered with curly quotes on an institutional page.
 *  - Removing the space before punctuation reconciles a real artifact of
 *    institutional pages. On the Agenzia delle Entrate page, for example, the
 *    source markup is `un'unica imposta <b>, nella misura del 15%</b>`; a naive
 *    tag strip yields "imposta , nella misura del 15% ," which would never match
 *    the sentence as a human reads it.
 *
 * Both widen matching slightly. That trade-off is deliberate: the excerpt still
 * has to come from the cited page, and every accepted change is recorded with
 * its source in git.
 */
export function normalizza(testo: string): string {
  return testo
    .toLowerCase()
    .replace(/\u00a0|\u2007|\u202f/g, " ")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%])/g, "$1")
    .trim();
}

const ENTITA: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  egrave: "è",
  eacute: "é",
  agrave: "à",
  ograve: "ò",
  ugrave: "ù",
  igrave: "ì",
  deg: "°",
  euro: "€",
  // Normattiva renders ordinal indicators as entities; without these the
  // extracted text would read "1&ordm;" and every quote around it would fail.
  ordm: "º",
  ordf: "ª",
  mdash: "-",
  ndash: "-",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function decodificaEntita(testo: string): string {
  return testo.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (intero, entita: string) => {
    if (entita.startsWith("#x") || entita.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entita.slice(2), 16));
    }
    if (entita.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entita.slice(1), 10));
    }
    return ENTITA[entita.toLowerCase()] ?? intero;
  });
}

/** Crude but dependency-free HTML-to-text conversion. */
export function testoDaHtml(html: string): string {
  return decodificaEntita(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function contenutoTestuale(tipo: string, corpo: string): string | null {
  if (tipo.includes("application/pdf")) return null;
  if (tipo.includes("text/html") || tipo.includes("application/xhtml")) {
    return testoDaHtml(corpo);
  }
  // text/plain, application/json, text/xml, ...
  return corpo;
}

/**
 * Legge il corpo con un tetto reale, senza materializzarlo tutto in memoria.
 * `risposta.text()` seguito da uno slice scaricava per intero il corpo prima di
 * applicare il limite: un host ostile che risponde con gigabyte esauriva la
 * memoria del runner.
 */
async function corpoLimitato(risposta: Response): Promise<string> {
  const lettore = risposta.body?.getReader();
  if (!lettore) return "";

  const decodificatore = new TextDecoder("utf-8");
  let testo = "";
  let octet = 0;

  for (;;) {
    const { done, value } = await lettore.read();
    if (done) break;
    if (!value) continue;
    octet += value.byteLength;
    testo += decodificatore.decode(value, { stream: true });
    if (octet >= MAX_BYTE) {
      await lettore.cancel();
      break;
    }
  }

  testo += decodificatore.decode();
  return testo;
}

/**
 * Descrive un errore di rete includendo la catena delle cause.
 *
 * `fetch` di Node riporta solo "fetch failed": senza la causa (codice DNS, TLS,
 * connessione azzerata) non si può capire se il problema è il sito, la rete o il
 * nome host. Succede davvero: dalle macchine di GitHub alcuni siti
 * istituzionali non sono raggiungibili, mentre da altre lo sono.
 */
function descriviErroreRete(errore: unknown): string {
  const parti: string[] = [];
  let corrente: unknown = errore;

  for (let livello = 0; livello < 4 && corrente; livello += 1) {
    if (corrente instanceof Error) {
      const codice = (corrente as { code?: unknown }).code;
      const testo = codice ? `${corrente.message} (${String(codice)})` : corrente.message;
      if (!parti.includes(testo)) parti.push(testo);
      corrente = (corrente as { cause?: unknown }).cause;
    } else {
      const testo = String(corrente);
      if (!parti.includes(testo)) parti.push(testo);
      break;
    }
  }

  return parti.join(" ← ");
}

export type EsitoLettura = {
  testo: string | null;
  tipo: string;
  http_status: number;
  motivo?: EsitoVerificaWeb["esito"];
  dettaglio?: string;
};

/** Fetches a URL and returns its plain text, or explains why it could not. */
export async function leggiFonte(fonteUrl: string): Promise<EsitoLettura> {
  let corrente: URL;
  try {
    corrente = new URL(fonteUrl);
  } catch {
    return {
      testo: null,
      tipo: "",
      http_status: 0,
      motivo: "url_non_valido",
      dettaglio: `URL non analizzabile: ${fonteUrl}`,
    };
  }

  try {
    for (let salto = 0; salto <= MAX_SALTI; salto += 1) {
      if (corrente.protocol !== "https:" && corrente.protocol !== "http:") {
        return {
          testo: null,
          tipo: "",
          http_status: 0,
          motivo: "url_non_valido",
          dettaglio: `Schema non supportato: ${corrente.protocol}`,
        };
      }

      const rifiuto = hostAmmesso(corrente);
      if (rifiuto) {
        return {
          testo: null,
          tipo: "",
          http_status: 0,
          motivo: "url_non_valido",
          dettaglio: `Richiesta bloccata: ${rifiuto}.`,
        };
      }

      // redirect manuale: ogni salto viene rivalidato, perché un host ammesso
      // può reindirizzare verso uno interno.
      const risposta = await fetch(corrente, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        },
      });

      if ([301, 302, 303, 307, 308].includes(risposta.status)) {
        const destinazione = risposta.headers.get("location");
        if (!destinazione) {
          return {
            testo: null,
            tipo: "",
            http_status: risposta.status,
            motivo: "errore_rete",
            dettaglio: `Reindirizzamento ${risposta.status} senza intestazione Location.`,
          };
        }
        corrente = new URL(destinazione, corrente);
        continue;
      }

      const tipo = risposta.headers.get("content-type") ?? "";
      const grezzo = await corpoLimitato(risposta);
      const testo = contenutoTestuale(tipo, grezzo);

      if (testo === null) {
        return {
          testo: null,
          tipo,
          http_status: risposta.status,
          motivo: "fonte_non_testuale",
          dettaglio: `Fonte in formato non testuale (${tipo || "tipo sconosciuto"}): la verifica automatica non è possibile.`,
        };
      }

      return { testo, tipo, http_status: risposta.status };
    }

    return {
      testo: null,
      tipo: "",
      http_status: 0,
      motivo: "errore_rete",
      dettaglio: `Troppi reindirizzamenti (oltre ${MAX_SALTI}).`,
    };
  } catch (errore) {
    return {
      testo: null,
      tipo: "",
      http_status: 0,
      motivo: "errore_rete",
      dettaglio: `Recupero fallito: ${descriviErroreRete(errore)}`,
    };
  }
}

/**
 * Verifies that `estratto` appears verbatim in the page at `fonteUrl`.
 * Only a "confermato" result authorizes a change.
 */
export async function verificaEstratto(
  fonteUrl: string,
  estratto: string,
): Promise<EsitoVerificaWeb> {
  if (!estratto || estratto.trim().length < 12) {
    return {
      esito: "estratto_non_trovato",
      dettaglio: "Estratto assente o troppo corto per costituire una prova.",
    };
  }

  const lettura = await leggiFonte(fonteUrl);
  if (!lettura.testo) {
    return {
      esito: lettura.motivo ?? "errore_rete",
      dettaglio: lettura.dettaglio ?? "Fonte non leggibile.",
      http_status: lettura.http_status,
    };
  }

  if (lettura.http_status >= 400) {
    return {
      esito: "errore_rete",
      dettaglio: `La fonte ha risposto con stato HTTP ${lettura.http_status}.`,
      http_status: lettura.http_status,
    };
  }

  const pagina = normalizza(lettura.testo);
  const citazione = normalizza(estratto);

  if (pagina.includes(citazione)) {
    return {
      esito: "confermato",
      dettaglio: `Estratto trovato nella fonte (${lettura.tipo || "testo"}).`,
      http_status: lettura.http_status,
    };
  }

  return {
    esito: "estratto_non_trovato",
    dettaglio:
      "L'estratto citato non compare letteralmente nella pagina indicata: " +
      "la modifica viene scartata.",
    http_status: lettura.http_status,
  };
}
