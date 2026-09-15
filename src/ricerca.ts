/**
 * Web search adapter — the `cerca_web` tool handed to the model.
 *
 * Design goal: **install and forget**. No search API key is required to run the
 * pipeline. The default provider is Google News RSS, which is keyless, stable
 * and reachable from a plain HTTP client.
 *
 * Verified empirically on 2026-09-15 (see README, "Motore di ricerca"):
 *   - google.com/search        -> HTTP 200 but a JavaScript-gated page, no results
 *                                 to a non-browser client. Keyless scraping of
 *                                 Google Search does not work.
 *   - html/lite.duckduckgo.com -> HTTP 202 anti-bot page, no results
 *   - mojeek.com               -> no results to a non-browser client
 *   - public SearXNG instances -> JSON API disabled (403 / HTML only)
 *   - news.google.com/rss      -> HTTP 200, structured XML, real results  ✅
 *
 * Google News RSS returns *news* items. Its links are JavaScript redirect
 * wrappers that a plain fetch cannot follow, so results are treated as a
 * discovery signal (title, date, publisher) rather than as citable sources.
 * Reading always happens through `apri_url` (see `verifica-web.ts`), which is
 * what ultimately authorizes a change.
 */

export type RisultatoRicerca = {
  titolo: string;
  url: string;
  data?: string;
  testata?: string;
  estratto: string;
};

const TIMEOUT_MS = 30_000;
const MAX_RISULTATI = 10;

export const PROVIDER_PREDEFINITO = "google-news";

export type ConfigurazioneRicerca = {
  provider: string;
  /** Optional. Only the keyed providers need it. */
  apiKey: string;
};

export function configurazioneDaAmbiente(ambiente = process.env): ConfigurazioneRicerca {
  // `||` and not `??`: in GitHub Actions an unset repository variable expands to
  // the empty string, which `??` would happily accept, overriding the keyless
  // default with an unsupported provider name and failing the run.
  const provider = (ambiente.SEARCH_PROVIDER ?? "").trim().toLowerCase();

  return {
    provider: provider === "" ? PROVIDER_PREDEFINITO : provider,
    apiKey: (ambiente.SEARCH_API_KEY ?? "").trim(),
  };
}

export function providerSupportati(): string[] {
  return ["google-news", "tavily", "brave"];
}

/** Providers requiring a credential; the default one deliberately does not. */
export function providerRichiedeChiave(provider: string): boolean {
  return provider === "tavily" || provider === "brave";
}

function tronca(testo: string, limite = 4000): string {
  return testo.length > limite ? `${testo.slice(0, limite)}…` : testo;
}

function pulisciXml(testo: string): string {
  return testo
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valoreTag(blocco: string, tag: string): string | undefined {
  const trovato = blocco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return trovato ? trovato[1] : undefined;
}

/**
 * Keyless default. `site:` and quoted phrases are honoured by Google News, which
 * lets the caller restrict discovery to institutional domains.
 */
async function cercaConGoogleNews(query: string): Promise<RisultatoRicerca[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "it");
  url.searchParams.set("gl", "IT");
  url.searchParams.set("ceid", "IT:it");

  const risposta = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "User-Agent":
        "scadefor/1.0 (+https://github.com/sequico/scadefor) verifica-automatica-fonti",
      Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
    },
  });

  if (!risposta.ok) {
    throw new Error(`Google News RSS ha risposto ${risposta.status}`);
  }

  const xml = await risposta.text();

  return xml
    .split("<item>")
    .slice(1)
    .map((blocco) => {
      const titolo = pulisciXml(valoreTag(blocco, "title") ?? "");
      const link = pulisciXml(valoreTag(blocco, "link") ?? "");
      const data = pulisciXml(valoreTag(blocco, "pubDate") ?? "");
      const testata = pulisciXml(valoreTag(blocco, "source") ?? "");
      return {
        titolo,
        url: link,
        data: data || undefined,
        testata: testata || undefined,
        estratto: tronca(pulisciXml(valoreTag(blocco, "description") ?? ""), 400),
      };
    })
    .filter((risultato) => risultato.titolo !== "")
    .slice(0, MAX_RISULTATI);
}

async function cercaConTavily(query: string, apiKey: string): Promise<RisultatoRicerca[]> {
  const risposta = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: MAX_RISULTATI,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!risposta.ok) {
    throw new Error(`Tavily ha risposto ${risposta.status}: ${await risposta.text()}`);
  }

  const dati = (await risposta.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };

  return (dati.results ?? []).map((r) => ({
    titolo: r.title ?? "",
    url: r.url ?? "",
    estratto: tronca(r.content ?? ""),
  }));
}

async function cercaConBrave(query: string, apiKey: string): Promise<RisultatoRicerca[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RISULTATI));

  const risposta = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });

  if (!risposta.ok) {
    throw new Error(`Brave ha risposto ${risposta.status}: ${await risposta.text()}`);
  }

  const dati = (await risposta.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };

  return (dati.web?.results ?? []).map((r) => ({
    titolo: r.title ?? "",
    url: r.url ?? "",
    estratto: tronca(r.description ?? ""),
  }));
}

export async function cercaWeb(
  query: string,
  configurazione: ConfigurazioneRicerca,
): Promise<RisultatoRicerca[]> {
  const provider = configurazione.provider;

  if (providerRichiedeChiave(provider) && !configurazione.apiKey) {
    throw new Error(
      `SEARCH_PROVIDER="${provider}" richiede SEARCH_API_KEY. ` +
        `Per funzionare senza chiave usa il provider predefinito "${PROVIDER_PREDEFINITO}", ` +
        `oppure non impostare SEARCH_PROVIDER.`,
    );
  }

  switch (provider) {
    case "google-news":
      return cercaConGoogleNews(query);
    case "tavily":
      return cercaConTavily(query, configurazione.apiKey);
    case "brave":
      return cercaConBrave(query, configurazione.apiKey);
    default:
      throw new Error(
        `SEARCH_PROVIDER "${provider}" non supportato. ` +
          `Valori ammessi: ${providerSupportati().join(", ")}.`,
      );
  }
}
