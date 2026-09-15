/**
 * DeepSeek chat-completions client with function calling.
 *
 * Data-protection policy of this repository (see README, "Trattamento dei
 * dati"): every request to the model provider carries explicit opt-out headers
 * and is issued against an account configured for zero retention and no
 * training. The headers are sent on *every* request from a single place below,
 * so a new call site cannot forget them.
 *
 * Honest limitation: the DeepSeek public API does not document a
 * zero-retention request parameter, so these headers may be ignored by the
 * provider; the binding control is the account-level setting, which must be
 * verified when the API key is issued. This is recorded as a known gap rather
 * than presented as an enforced technical guarantee.
 */

export const HEADER_PROTEZIONE_DATI: Record<string, string> = {
  "X-Data-Opt-Out": "true",
  "X-Zero-Retention": "true",
  "X-Training-Opt-Out": "true",
};

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const TIMEOUT_MS = 180_000;
const MODEL_PREDEFINITO = "deepseek-chat";

export type Messaggio =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ChiamataStrumento[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChiamataStrumento = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type DefinizioneStrumento = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type EsitoConversazione = {
  contenuto: string;
  modello: string;
  chiamateStrumento: number;
};

export type ConfigurazioneDeepSeek = {
  apiKey: string;
  modello: string;
  maxIterazioni: number;
  baseUrl: string;
};

export function configurazioneDaAmbiente(ambiente = process.env): ConfigurazioneDeepSeek {
  // Empty strings are treated as unset: an unset GitHub Actions variable expands
  // to "", and an empty model name or base URL would fail at request time with a
  // confusing error instead of falling back to the default.
  const testo = (valore: string | undefined, predefinito: string) => {
    const pulito = (valore ?? "").trim();
    return pulito === "" ? predefinito : pulito;
  };

  const iterazioni = Number.parseInt(testo(ambiente.DEEPSEEK_MAX_ITERAZIONI, "12"), 10);

  return {
    apiKey: (ambiente.DEEPSEEK_API_KEY ?? "").trim(),
    modello: testo(ambiente.DEEPSEEK_MODEL, MODEL_PREDEFINITO),
    maxIterazioni: Number.isInteger(iterazioni) && iterazioni > 0 ? iterazioni : 12,
    baseUrl: testo(ambiente.DEEPSEEK_BASE_URL, ENDPOINT),
  };
}

type RispostaChat = {
  model?: string;
  choices?: {
    message?: { content?: string | null; tool_calls?: ChiamataStrumento[] };
    finish_reason?: string;
  }[];
};

async function chiamaModello(
  messaggi: Messaggio[],
  strumenti: DefinizioneStrumento[],
  configurazione: ConfigurazioneDeepSeek,
  forzaRisposta = false,
): Promise<RispostaChat> {
  const corpo: Record<string, unknown> = {
    model: configurazione.modello,
    messages: messaggi,
    temperature: 0,
    stream: false,
  };

  // All'ultimo giro gli strumenti vengono tolti di mano: il modello deve
  // rispondere con quello che ha. Senza questo, un modello che continua a
  // cercare esaurisce le iterazioni e la run fallisce senza aver prodotto nulla,
  // che è il peggior esito possibile: né una risposta né un errore utile.
  if (!forzaRisposta) {
    corpo.tools = strumenti;
    corpo.tool_choice = "auto";
  } else {
    corpo.tool_choice = "none";
  }

  const risposta = await fetch(configurazione.baseUrl, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${configurazione.apiKey}`,
      ...HEADER_PROTEZIONE_DATI,
    },
    body: JSON.stringify(corpo),
  });

  if (!risposta.ok) {
    const corpoErrore = await risposta.text();
    throw new Error(`DeepSeek ha risposto ${risposta.status}: ${corpoErrore.slice(0, 500)}`);
  }

  return (await risposta.json()) as RispostaChat;
}

/**
 * Runs the tool-calling loop until the model returns a plain message.
 * `eseguiStrumento` is injected so the transport stays independent of the
 * search vendor.
 */
export async function conversaConStrumenti(
  messaggiIniziali: Messaggio[],
  strumenti: DefinizioneStrumento[],
  eseguiStrumento: (nome: string, argomenti: Record<string, unknown>) => Promise<unknown>,
  configurazione: ConfigurazioneDeepSeek,
): Promise<EsitoConversazione> {
  if (!configurazione.apiKey) {
    throw new Error("DEEPSEEK_API_KEY non configurata.");
  }

  const messaggi: Messaggio[] = [...messaggiIniziali];
  let chiamate = 0;
  let modello = configurazione.modello;

  for (let iterazione = 0; iterazione < configurazione.maxIterazioni; iterazione += 1) {
    const ultimaOccasione = iterazione === configurazione.maxIterazioni - 1;
    const risposta = await chiamaModello(
      messaggi,
      strumenti,
      configurazione,
      ultimaOccasione,
    );
    modello = risposta.model ?? modello;
    const messaggio = risposta.choices?.[0]?.message;

    if (!messaggio) {
      throw new Error("Risposta del modello priva di contenuto.");
    }

    messaggi.push({
      role: "assistant",
      content: messaggio.content ?? null,
      tool_calls: messaggio.tool_calls,
    });

    const chiamateStrumento = messaggio.tool_calls ?? [];
    if (chiamateStrumento.length === 0) {
      return {
        contenuto: messaggio.content ?? "",
        modello,
        chiamateStrumento: chiamate,
      };
    }

    for (const chiamata of chiamateStrumento) {
      chiamate += 1;
      let argomenti: Record<string, unknown> = {};
      try {
        argomenti = JSON.parse(chiamata.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        // A malformed argument payload is reported back to the model instead of
        // aborting the run; the model can retry with a well-formed call.
        argomenti = {};
      }

      let esito: unknown;
      try {
        esito = await eseguiStrumento(chiamata.function.name, argomenti);
      } catch (errore) {
        esito = {
          errore: errore instanceof Error ? errore.message : String(errore),
        };
      }

      messaggi.push({
        role: "tool",
        tool_call_id: chiamata.id,
        content: JSON.stringify(esito).slice(0, 60_000),
      });
    }
  }

  throw new Error(
    `Il modello ha esaurito le ${configurazione.maxIterazioni} iterazioni di chiamata ` +
      "strumenti senza produrre una risposta finale.",
  );
}

/**
 * Extracts the first complete JSON object from model output.
 *
 * Tolerates stray prose or a fenced code block around the payload, but still
 * requires a syntactically valid object: an unparsable answer must abort the
 * run rather than be guessed at.
 */
export function estraiJson(testo: string): unknown {
  const inizio = testo.indexOf("{");
  if (inizio === -1) {
    throw new Error("Nessun oggetto JSON trovato nella risposta del modello.");
  }

  let profondita = 0;
  let inStringa = false;
  let protetto = false;

  for (let indice = inizio; indice < testo.length; indice += 1) {
    const carattere = testo[indice];

    if (protetto) {
      protetto = false;
      continue;
    }
    if (carattere === "\\") {
      protetto = true;
      continue;
    }
    if (carattere === '"') {
      inStringa = !inStringa;
      continue;
    }
    if (inStringa) continue;

    if (carattere === "{") profondita += 1;
    if (carattere === "}") {
      profondita -= 1;
      if (profondita === 0) {
        return JSON.parse(testo.slice(inizio, indice + 1));
      }
    }
  }

  throw new Error("Oggetto JSON non bilanciato nella risposta del modello.");
}
