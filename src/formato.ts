/**
 * Italian-locale number formatting used in calendar descriptions and pages.
 * No normative logic lives here.
 */

export function formattaEuro(valore: number): string {
  const arrotondato = Math.round(valore * 100) / 100;
  const [intero, decimali] = arrotondato.toFixed(2).split(".");
  const interoFormattato = intero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimali === "00" ? `${interoFormattato} €` : `${interoFormattato},${decimali} €`;
}

/** Percentage with up to `decimali` digits, Italian comma separator. */
export function formattaPercentuale(quota: number, decimali = 2): string {
  let valore = (quota * 100).toFixed(decimali);
  // Trailing zeros are only cosmetic *after* a decimal point. Stripping them
  // unconditionally would turn "50" into "5" — a factor-of-ten error in a
  // document about money.
  if (decimali > 0) {
    valore = valore.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  return `${valore.replace(".", ",")}%`;
}

export function formattaDataItaliana(data: Date): string {
  const mesi = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  ];
  return `${data.getUTCDate()} ${mesi[data.getUTCMonth()]} ${data.getUTCFullYear()}`;
}

export function formattaDataIso(data: Date): string {
  return data.toISOString().replace(/\.\d{3}Z$/, "Z");
}
