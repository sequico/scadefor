import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configurazioneDaAmbiente,
  PROVIDER_PREDEFINITO,
  providerRichiedeChiave,
  providerSupportati,
} from "../src/ricerca.ts";

test("senza configurazione si usa il provider predefinito, che non richiede chiave", () => {
  const config = configurazioneDaAmbiente({});
  assert.equal(config.provider, PROVIDER_PREDEFINITO);
  assert.equal(config.apiKey, "");
  assert.equal(providerRichiedeChiave(config.provider), false);
});

test("una variabile vuota equivale a non impostata", () => {
  // In GitHub Actions una variabile di repository non impostata arriva come
  // stringa vuota: trattarla come un provider valido farebbe fallire la run
  // proprio nel caso "install and forget", cioè senza alcuna configurazione.
  const config = configurazioneDaAmbiente({ SEARCH_PROVIDER: "", SEARCH_API_KEY: "" });
  assert.equal(config.provider, PROVIDER_PREDEFINITO);
  assert.equal(providerRichiedeChiave(config.provider), false);
});

test("spazi e maiuscole non impediscono il riconoscimento del provider", () => {
  assert.equal(configurazioneDaAmbiente({ SEARCH_PROVIDER: "  TAVILY  " }).provider, "tavily");
  assert.equal(configurazioneDaAmbiente({ SEARCH_PROVIDER: "Brave" }).provider, "brave");
});

test("solo i provider a chiave la richiedono", () => {
  for (const provider of providerSupportati()) {
    assert.equal(
      providerRichiedeChiave(provider),
      provider !== PROVIDER_PREDEFINITO,
      `atteso per ${provider}`,
    );
  }
});
