/**
 * Generatore di `public/index.html`.
 *
 * La pagina è una funzione pura dello stato committato: dati gli stessi
 * regole.json, parametri.json, status.json e insieme di scadenze, produce lo
 * stesso HTML. Non porta un proprio timestamp di generazione, così l'unica cosa
 * che può far cambiare la pagina è un cambiamento reale dello stato — cioè
 * esattamente ciò che merita un commit.
 *
 * Direzione visiva: un almanacco fiscale. Le date sono il materiale del
 * soggetto, quindi stanno in monospaziato tabulare su una linea del tempo che
 * raggruppa per mese; lo stato di verifica di ogni dato è reso come un timbro,
 * che è il modo in cui questo mondo segnala davvero le cose. Nessun JavaScript:
 * gli accordion sono <details> nativi, quindi funzionano in ogni client.
 */

import { formattaDataItaliana, formattaEuro, formattaPercentuale } from "./formato.ts";
import { nomeFileAnno } from "./generazione.ts";
import type { EventoGenerato, ParametriAnno } from "./motore.ts";
import { risolviParametriAnno } from "./motore.ts";
import type { Parametri, Profilo, Regole, StatusFile } from "./tipi.ts";

/** Link per le donazioni. */
export const URL_DONAZIONI = "https://paypal.me/sequi";

const URL_SEQUI = "https://sequi.company";

export const TESTO_DISCLAIMER = `AVVISO IMPORTANTE — SERVIZIO NON VERIFICATO

Questo calendario è generato in modo interamente automatico, incluse le regole di calcolo e di scadenza stesse, che possono essere aggiornate dal sistema senza intervento umano qualora rilevi modifiche normative. Le date, gli importi e i criteri di calcolo mostrati sono prodotti da un sistema software che elabora regole normative e interroga periodicamente fonti pubbliche tramite un modello di intelligenza artificiale.

NESSUNA VERIFICA UMANA viene effettuata sui contenuti generati né sulle eventuali modifiche alle regole, prima o dopo la pubblicazione. La citazione di fonti ufficiali (Agenzia delle Entrate, INPS, Gazzetta Ufficiale) accanto a ciascun dato NON costituisce garanzia di correttezza, completezza o aggiornamento: il sistema che estrae e verifica tali citazioni può commettere errori, richiamare fonti non più valide, interpretare in modo scorretto un testo normativo, o non rilevare modifiche intervenute.

I contenuti hanno esclusivamente valore informativo e indicativo. NON costituiscono consulenza fiscale, contributiva, legale o professionale di alcun tipo, e non sostituiscono in alcun modo il parere di un commercialista, di un consulente del lavoro o di un professionista abilitato.

L'utente riconosce ed accetta che:
- L'utilizzo del servizio avviene interamente a proprio rischio.
- Prima di effettuare qualsiasi versamento, adempimento o decisione fiscale, è tenuto a verificare autonomamente le informazioni direttamente sui portali ufficiali o tramite un professionista abilitato.
- Sequi Company, il titolare del servizio e chiunque abbia contribuito al codice sorgente non forniscono alcuna garanzia, esplicita o implicita, circa l'accuratezza, l'affidabilità, la completezza o l'idoneità delle informazioni fornite per uno scopo particolare.
- Nella massima misura consentita dalla legge applicabile, Sequi Company e i contributori del progetto declinano ogni responsabilità per sanzioni, interessi, more, danni diretti, indiretti, incidentali o consequenziali derivanti dall'uso, dal mancato uso, o dall'affidamento sulle informazioni contenute in questo servizio.
- Il servizio è fornito 'così com'è' ('as is') e 'come disponibile' ('as available'), senza alcun impegno di continuità, aggiornamento tempestivo o assenza di interruzioni.

Il codice sorgente è pubblico e consultabile: chiunque può ispezionare la logica di calcolo, le regole applicate e le fonti utilizzate, ma questa trasparenza non costituisce revisione professionale né certificazione di correttezza.`;

function esc(testo: string): string {
  return testo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ *
 * Sistema visivo
 * ------------------------------------------------------------------ */

const CSS = `
:root{
  --inchiostro:#0d1b21; --tenue:#5c6d72; --carta:#eef2f1; --superficie:#fff;
  --bordo:#d0dbd9; --bordo-tenue:#e4ebe9;
  --petrolio:#0d5a63; --petrolio-scuro:#093f46; --petrolio-velo:#0d5a6314;
  --scadenza:#ad1140; --ambra:#8f6206; --ambra-velo:#8f620614; --ok:#176340;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --raggio:10px; --raggio-g:16px;
  --ombra:0 1px 2px #0d1b2108,0 8px 24px -16px #0d1b2126;
}
@media (prefers-color-scheme:dark){
  :root{
    --inchiostro:#e6ecec; --tenue:#9aa9ab; --carta:#0c1417; --superficie:#131d21;
    --bordo:#26343a; --bordo-tenue:#1d282c;
    --petrolio:#5cc0c3; --petrolio-scuro:#8ad6d8; --petrolio-velo:#5cc0c315;
    --scadenza:#f2688c; --ambra:#d9a94e; --ambra-velo:#d9a94e15; --ok:#63bf92;
    --ombra:0 1px 2px #0006,0 8px 24px -16px #000a;
  }
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--carta); color:var(--inchiostro);
  font-family:var(--sans); font-size:16.5px; line-height:1.62;
  -webkit-font-smoothing:antialiased;
}
@media (prefers-reduced-motion:no-preference){
  body{animation:entra .5s ease-out both}
  @keyframes entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
}
.guscio{max-width:60rem;margin:0 auto;padding:0 1.15rem}
a{color:var(--petrolio);text-underline-offset:.18em}
a:hover{color:var(--petrolio-scuro)}
:focus-visible{outline:2.5px solid var(--petrolio);outline-offset:2px;border-radius:4px}
h1,h2,h3,h4{font-family:var(--sans);text-wrap:balance;margin:0}
p{margin:0 0 .85rem}
code{font-family:var(--mono);font-size:.85em;overflow-wrap:anywhere}

/* --- tipografia --- */
.occhiello{
  font-family:var(--mono);font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;
  color:var(--tenue);display:flex;align-items:center;gap:.6rem;margin:0 0 .9rem;
}
.occhiello::after{content:"";flex:1;height:1px;background:var(--bordo)}
.titolo-1{
  font-size:clamp(2rem,6vw,3.1rem);line-height:1.02;letter-spacing:-.035em;font-weight:800;
}
.titolo-1 em{font-style:normal;color:var(--petrolio)}
.titolo-2{font-size:clamp(1.25rem,2.6vw,1.6rem);letter-spacing:-.02em;font-weight:750;line-height:1.15}
.titolo-3{font-size:1rem;letter-spacing:-.01em;font-weight:700}
.sommario{font-size:1.06rem;color:var(--tenue);max-width:52ch}

/* --- sezioni --- */
section{margin:0 0 3.2rem}
@media (min-width:64rem){section{margin-bottom:4rem}}

/* --- testata --- */
.testata{
  border-bottom:1px solid var(--bordo);
  background:
    radial-gradient(80rem 24rem at 12% -30%,var(--petrolio-velo),transparent 70%),
    var(--superficie);
  padding:2.4rem 0 2.2rem;
}
.testata .guscio{display:grid;gap:1.6rem}
@media (min-width:56rem){.testata .guscio{grid-template-columns:1.35fr .95fr;align-items:start;gap:2.6rem}}
.marchio{
  display:flex;flex-wrap:wrap;align-items:baseline;gap:.2rem .75rem;margin-bottom:1.5rem;
}
.marchio .acronimo{
  font-family:var(--sans);font-size:1.28rem;letter-spacing:-.02em;line-height:1;
  color:var(--tenue);font-weight:350;
}
.marchio .acronimo b{
  font-weight:800;color:var(--inchiostro);letter-spacing:-.03em;
}
.marchio .acronimo::after{
  content:"";display:inline-block;width:.42rem;height:.42rem;background:var(--scadenza);
  border-radius:1px;margin-left:.42rem;vertical-align:baseline;
}
.marchio .spiegazione{
  font-family:var(--mono);font-size:.68rem;letter-spacing:.13em;text-transform:uppercase;
  color:var(--tenue);
}
.promessa{display:flex;flex-wrap:wrap;gap:.45rem;margin:1.15rem 0 0;padding:0;list-style:none}
.promessa li{
  font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;
  border:1px solid var(--bordo);border-radius:99px;padding:.3rem .7rem;color:var(--tenue);
  background:var(--superficie);
}
.bollo{
  border:1px solid var(--bordo);border-left:3px solid var(--petrolio);border-radius:var(--raggio);
  background:var(--superficie);padding:.9rem 1.05rem;box-shadow:var(--ombra);
}
.bollo.ok{border-left-color:var(--ok)}
.bollo.ko{border-left-color:var(--ambra)}
.bollo p{margin:.35rem 0 0;font-size:.9rem;color:var(--tenue)}
.bollo .riga{display:flex;align-items:baseline;gap:.55rem;font-weight:650;font-size:.97rem;margin:0}

/* --- avviso --- */
.avviso{border:1px solid var(--ambra);border-left:3px solid var(--ambra);border-radius:var(--raggio);
  background:var(--ambra-velo);padding:.85rem 1.05rem;margin:0 0 1.1rem}
.salta{
  position:absolute;left:-9999px;top:0;z-index:10;background:var(--petrolio);color:#fff;
  padding:.6rem 1rem;border-radius:0 0 var(--raggio) 0;text-decoration:none;font-weight:650;
}
.salta:focus{left:0}
.indice{margin:0 0 2rem;border-bottom:1px solid var(--bordo);padding-bottom:.7rem}
.indice ul{display:flex;flex-wrap:wrap;gap:.4rem .9rem;margin:0;padding:0;list-style:none}
.indice a{
  font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;
  color:var(--tenue);text-decoration:none;
}
.indice a:hover,.indice a:focus{color:var(--petrolio);text-decoration:underline}
.avviso .riga{display:flex;gap:.55rem;align-items:baseline;margin:0;font-weight:650;font-size:.95rem;color:var(--ambra)}
.avviso p.nota{margin:.4rem 0 0;font-size:.86rem;color:var(--tenue)}
details.testo-integrale{margin-top:.55rem;border-top:1px dashed color-mix(in srgb,var(--ambra) 45%,transparent);padding-top:.5rem}
details.testo-integrale>summary{cursor:pointer;font-size:.86rem;color:var(--ambra);font-weight:600}
details.testo-integrale[open]>summary{margin-bottom:.6rem}
details.testo-integrale p{white-space:pre-line;font-size:.85rem;color:var(--tenue)}

/* --- calendari --- */
.calendari{display:grid;gap:1rem;margin-top:1.5rem}
@media (min-width:52rem){.calendari{grid-template-columns:repeat(3,1fr)}}
.calendario{
  position:relative;display:flex;flex-direction:column;gap:.7rem;min-width:0;
  border:1px solid var(--bordo);border-radius:var(--raggio-g);background:var(--superficie);
  padding:1.25rem 1.25rem 1.35rem;box-shadow:var(--ombra);
  transition:transform .18s ease,border-color .18s ease;
}
@media (prefers-reduced-motion:no-preference){.calendario:hover{transform:translateY(-3px)}}
.calendario:hover{border-color:var(--petrolio)}
.calendario .ruolo{
  font-family:var(--mono);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--tenue);
}
.calendario h3{font-size:1.18rem;letter-spacing:-.02em;line-height:1.15}
.calendario .descrizione{font-size:.9rem;color:var(--tenue);margin:0}
/* Il blocco azioni sta in fondo alla carta e ha altezza costante fra le tre
   carte: è quello che fa cadere i tre bottoni alla stessa quota verticale,
   anche se descrizione e pillole sopra occupano spazio diverso. */
.azioni{margin-top:auto;display:flex;flex-direction:column;gap:.55rem;min-width:0}
.pulsante{
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  background:var(--petrolio);color:#fff;text-decoration:none;font-weight:650;font-size:.95rem;
  padding:.7rem 1rem;border-radius:var(--raggio);margin-top:.2rem;
}
.pulsante:hover{background:var(--petrolio-scuro);color:#fff}
@media (prefers-color-scheme:dark){.pulsante{color:#06222a}}
.indirizzo{
  font-family:var(--mono);font-size:.68rem;color:var(--tenue);
  border-top:1px dashed var(--bordo);padding-top:.6rem;
  /* Una sola riga sempre: la lunghezza dell'indirizzo cambia fra i profili e,
     mandandolo a capo, sposterebbe il bottone più in alto proprio nella carta
     con l'URL più lungo.

     La proprietà nowrap da sola però allarga la colonna della griglia, perché
     il min-width di un elemento di griglia vale auto: la pagina finiva fuori
     dallo schermo di 153px. Servono min-width:0 sul contenitore (sopra) e il
     taglio con i puntini qui, così altezza e larghezza restano sotto controllo. */
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
}
.alternative{margin:.1rem 0 0;font-size:.78rem;color:var(--tenue)}
.alternativa a{font-weight:600}
.pulsante .formato{font-family:var(--mono);font-size:.82em;opacity:.85;font-weight:500}
.scarica{
  display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;margin-top:.15rem;
  border-top:1px dashed var(--bordo);padding-top:.7rem;
}
.scarica .etichetta{
  font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--tenue);
  width:100%;
}
.scarica a{
  border:1px solid var(--bordo);border-radius:99px;padding:.28rem .8rem;text-decoration:none;
  font-family:var(--mono);font-size:.82rem;font-variant-numeric:tabular-nums;color:var(--inchiostro);
}
.scarica a:hover{border-color:var(--petrolio);color:var(--petrolio)}
.scarica .formato-riga{font-size:.72rem;color:var(--tenue);margin-left:auto}
.dinamico-statico{
  display:grid;gap:1rem;margin-top:1.2rem;border:1px solid var(--bordo);
  border-radius:var(--raggio);background:var(--superficie);padding:1rem 1.15rem;
}
@media (min-width:44rem){.dinamico-statico{grid-template-columns:1fr 1fr;gap:1.6rem}}
.dinamico-statico p{font-size:.87rem;color:var(--tenue);margin:.45rem 0 0}

/* --- passi --- */
.passi{display:grid;gap:1.1rem;margin-top:1.4rem;counter-reset:p}
@media (min-width:52rem){.passi{grid-template-columns:repeat(3,1fr)}}
.passo{border-top:2px solid var(--inchiostro);padding-top:.7rem}
.passo::before{
  counter-increment:p;content:counter(p,decimal-leading-zero);
  font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;color:var(--petrolio);display:block;margin-bottom:.3rem;
}
.passo p{font-size:.9rem;color:var(--tenue);margin:0}
.nota-ia{
  margin-top:1.6rem;border:1px solid var(--bordo);border-left:3px solid var(--petrolio);
  border-radius:var(--raggio);background:var(--superficie);padding:1rem 1.15rem;box-shadow:var(--ombra);
}
.nota-ia h3{margin-bottom:.45rem}
.nota-ia p{font-size:.9rem;color:var(--tenue);margin:0 0 .6rem}
.nota-ia p:last-child{margin-bottom:0}

/* --- linea del tempo --- */
.anno{border:1px solid var(--bordo);border-radius:var(--raggio-g);background:var(--superficie);margin-top:1.1rem;overflow:hidden}
.anno>summary,.profilo>summary{
  cursor:pointer;list-style:none;padding:1rem 1.15rem;display:flex;align-items:center;gap:.8rem;
}
.anno>summary::-webkit-details-marker,.profilo>summary::-webkit-details-marker{display:none}
.anno>summary{font-weight:750;font-size:1.15rem;letter-spacing:-.015em}
.anno>summary .cifra{font-family:var(--mono);font-size:1.35rem;letter-spacing:-.03em}
.anno>summary .conteggio,.profilo>summary .conteggio{
  margin-left:auto;font-family:var(--mono);font-size:.7rem;color:var(--tenue);white-space:nowrap;
}
.anno>summary::after,.profilo>summary::after{
  content:"";width:.5rem;height:.5rem;border-right:2px solid var(--tenue);border-bottom:2px solid var(--tenue);
  transform:rotate(45deg);transition:transform .2s ease;flex:none;
}
.anno[open]>summary::after,.profilo[open]>summary::after{transform:rotate(-135deg)}
.anno[open]>summary,.profilo[open]>summary{border-bottom:1px solid var(--bordo)}
.profilo{border-top:1px solid var(--bordo-tenue)}
.profilo:first-of-type{border-top:0}
.profilo>summary{font-weight:650;font-size:.98rem}
.profilo>summary .pallino{width:.5rem;height:.5rem;background:var(--petrolio);border-radius:50%;flex:none}
.corpo-profilo{padding:.4rem 1.15rem 1.2rem}
.mese{
  font-family:var(--mono);font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--tenue);
  margin:1.1rem 0 .2rem;display:flex;align-items:center;gap:.6rem;
}
.mese::after{content:"";flex:1;height:1px;background:var(--bordo-tenue)}

.scadenza{position:relative;display:grid;grid-template-columns:auto 1fr;gap:0 1rem;padding:.85rem 0}
.rail{position:relative;display:flex;flex-direction:column;align-items:center;padding-top:.15rem}
.giorno{
  font-family:var(--mono);font-size:1.55rem;line-height:1;font-weight:600;letter-spacing:-.04em;
  font-variant-numeric:tabular-nums;color:var(--scadenza);
}
.rail .filo{flex:1;width:1px;background:var(--bordo);margin-top:.5rem;min-height:.6rem}
.contorno{min-width:0}
.contorno h3{font-size:.99rem;letter-spacing:-.01em;margin-bottom:.15rem}
.quando{font-family:var(--mono);font-size:.72rem;color:var(--tenue);letter-spacing:.04em;font-variant-numeric:tabular-nums}
.spostata{color:var(--scadenza)}
details.dettagli{margin-top:.5rem}
details.dettagli>summary{
  cursor:pointer;font-family:var(--mono);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;
  color:var(--petrolio);list-style:none;
}
details.dettagli>summary::-webkit-details-marker{display:none}
details.dettagli>summary::before{content:"+ ";font-weight:700}
details.dettagli[open]>summary::before{content:"– "}
.dettagli dl{margin:.6rem 0 0;border-left:2px solid var(--bordo-tenue);padding-left:.9rem}
.dettagli dt{
  font-family:var(--mono);font-size:.66rem;letter-spacing:.13em;text-transform:uppercase;
  color:var(--tenue);margin-top:.7rem;
}
.dettagli dt:first-child{margin-top:0}
.dettagli dd{margin:.18rem 0 0;font-size:.88rem;overflow-wrap:anywhere}
.timbro{
  display:inline-block;font-family:var(--mono);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ambra);border:1.5px solid var(--ambra);border-radius:4px;padding:.14rem .45rem;
  transform:rotate(-2.2deg);margin-left:.5rem;white-space:nowrap;
}
.timbro.ok{color:var(--ok);border-color:var(--ok)}
.timbro.mano{color:var(--petrolio);border-color:var(--petrolio);transform:rotate(1.4deg)}

/* --- accordion generici --- */
.blocco{border:1px solid var(--bordo);border-radius:var(--raggio);background:var(--superficie);margin-top:.7rem}
.blocco>summary{cursor:pointer;list-style:none;padding:.85rem 1.05rem;display:flex;align-items:center;gap:.7rem}
.blocco>summary::-webkit-details-marker{display:none}
.blocco>summary::before{content:"";width:.45rem;height:.45rem;border-right:1.8px solid var(--tenue);border-bottom:1.8px solid var(--tenue);transform:rotate(45deg);flex:none;transition:transform .2s ease}
.blocco[open]>summary::before{transform:rotate(-135deg)}
.blocco>summary .et{font-weight:650;font-size:.95rem;letter-spacing:-.005em}
.blocco>summary .misura{margin-left:auto;font-family:var(--mono);font-size:.68rem;color:var(--tenue)}
.blocco .interno{padding:0 1.05rem 1.05rem;border-top:1px solid var(--bordo-tenue);padding-top:.9rem}
.blocco .interno>*:last-child{margin-bottom:0}

/* --- tabelle e dati --- */
.tabella{width:100%;border-collapse:collapse;font-size:.87rem}
/* Una tabella a cinque colonne non entra in un telefono: senza questo
   contenitore faceva sforare l'intera pagina di 115px a 360px di larghezza.
   Così scorre dentro il suo riquadro e la pagina resta larga quanto lo schermo. */
.tabella-scorrevole{overflow-x:auto;min-width:0;-webkit-overflow-scrolling:touch}
.tabella-scorrevole:focus-visible{outline:2.5px solid var(--petrolio);outline-offset:3px}
.tabella th{
  text-align:left;font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;
  color:var(--tenue);font-weight:500;padding:0 .55rem .45rem 0;border-bottom:1px solid var(--bordo);
}
.tabella td{padding:.55rem .55rem .55rem 0;border-bottom:1px solid var(--bordo-tenue);vertical-align:top}
.tabella td:last-child,.tabella th:last-child{padding-right:0}
.tabella .numero{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.tabella tr:last-child td{border-bottom:0}
.dato{font-family:var(--mono);font-size:.8rem;font-variant-numeric:tabular-nums}
.citazione{
  margin:.5rem 0 0;padding:.5rem .8rem;border-left:2px solid var(--bordo);
  color:var(--tenue);font-size:.85rem;
}
.url{font-family:var(--mono);font-size:.7rem;overflow-wrap:anywhere;margin-top:.3rem}
.elenco-dati{margin:.3rem 0 0;padding:0;list-style:none;display:grid;gap:.25rem}
.elenco-dati li{
  display:flex;flex-wrap:wrap;justify-content:space-between;gap:.2rem 1rem;min-width:0;
  border-bottom:1px dashed var(--bordo-tenue);padding-bottom:.25rem;font-size:.86rem;
}
.elenco-dati .k{
  font-family:var(--mono);font-size:.76rem;color:var(--tenue);
  /* Identificatori come minimale_inps_artigiani_commercianti non hanno spazi su
     cui andare a capo: senza queste due proprietà allargavano la riga e facevano
     sforare la pagina di 40px su uno schermo da 320px. */
  min-width:0;overflow-wrap:anywhere;
}

/* --- non verificati --- */
.non-verificato{border-left:3px solid var(--ambra);padding:.15rem 0 .15rem 1rem;margin:1.1rem 0}
.non-verificato .intestazione{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.3rem}
.non-verificato .intestazione code{font-size:.8rem;font-weight:600}
.non-verificato p{margin:0;font-size:.87rem;color:var(--tenue)}

/* --- piè di pagina --- */
footer{
  border-top:1px solid var(--bordo);background:var(--superficie);padding:2.2rem 0 3rem;margin-top:1rem;
  font-size:.88rem;color:var(--tenue);
}
footer .colonne{display:grid;gap:1.4rem}
@media (min-width:52rem){footer .colonne{grid-template-columns:1.4fr 1fr}}
footer p{margin:0 0 .5rem}
.firma{font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tenue)}
.donazione{
  display:inline-block;border:1px solid var(--bordo);border-radius:99px;padding:.5rem 1rem;
  text-decoration:none;font-size:.87rem;font-weight:600;
}
.donazione:hover{border-color:var(--petrolio)}
@media print{.calendario,.blocco{break-inside:avoid}}
`;

/* ------------------------------------------------------------------ *
 * Utilità di composizione
 * ------------------------------------------------------------------ */

type StatoRegola = "verificato" | "verificato_manualmente" | "fonte_primaria_non_leggibile" | "da_verificare";

/** Stato di verifica per regola, per poter timbrare ogni scadenza. */
function mappaStati(config: Regole): Map<string, StatoRegola> {
  const mappa = new Map<string, StatoRegola>();
  for (const regola of config.regole) {
    mappa.set(regola.id, (regola.stato_verifica ?? "verificato") as StatoRegola);
  }
  return mappa;
}

function timbro(stato: StatoRegola): string {
  if (stato === "verificato") return `<span class="timbro ok">confermato dall'IA</span>`;
  if (stato === "verificato_manualmente") {
    return `<span class="timbro mano">letto dall'IA, non ricontrollabile</span>`;
  }
  const testo =
    stato === "da_verificare" ? "non confermato dall'IA" : "fonte non leggibile dall'IA";
  return `<span class="timbro">${esc(testo)}</span>`;
}

function accordion(opzioni: {
  etichetta: string;
  misura?: string;
  aperto?: boolean;
  interno: string;
  classe?: string;
}): string {
  const classe = opzioni.classe ? ` ${opzioni.classe}` : "";
  return `<details class="blocco${classe}"${opzioni.aperto ? " open" : ""}>
  <summary><span class="et">${esc(opzioni.etichetta)}</span>${
    opzioni.misura ? `<span class="misura">${esc(opzioni.misura)}</span>` : ""
  }</summary>
  <div class="interno">
  ${opzioni.interno}
  </div>
</details>`;
}

/** Divide la descrizione memorizzata nei due blocchi etichettati. */
function blocchiDescrizione(descrizione: string): { etichetta: string; testo: string }[] {
  const etichette = ["CRITERI DI CALCOLO", "CRITERI DI SCADENZA"];
  const blocchi: { etichetta: string; testo: string }[] = [];

  for (const etichetta of etichette) {
    const marcatore = `${etichetta}: `;
    const inizio = descrizione.indexOf(marcatore);
    if (inizio === -1) continue;
    const dopo = inizio + marcatore.length;
    const successivi = etichette
      .filter((altra) => altra !== etichetta)
      .map((altra) => descrizione.indexOf(`\n\n${altra}: `, dopo))
      .filter((posizione) => posizione !== -1);
    const fine = successivi.length > 0 ? Math.min(...successivi) : descrizione.length;
    blocchi.push({ etichetta, testo: descrizione.slice(dopo, fine).trim() });
  }

  return blocchi;
}

const NOMI_MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

/* ------------------------------------------------------------------ *
 * Sezioni
 * ------------------------------------------------------------------ */

function sezioneCalendari(config: Regole, eventi: EventoGenerato[], anni: number[]): string {
  const anniTesto = anni.length > 1 ? `${anni[0]} e ${anni[1]}` : String(anni[0]);

  const carte = config.profili
    .map((profilo: Profilo) => {
      const descrizione = profilo.descrizione_pagina ?? profilo.descrizione;
      const quante = eventi.filter((evento) => evento.profilo_id === profilo.id).length;
      const punti = (profilo.punti_chiave ?? [])
        .map((punto) => `<li>${esc(punto)}</li>`)
        .join("");
      return `<article class="calendario">
    <span class="ruolo">${quante} scadenze · ${esc(anniTesto)}</span>
    <h3>${esc(profilo.nome.replace(/\s*\(riduzione 35%\)/, ""))}${
      profilo.applica_riduzione_forfettario ? ' <span class="timbro ok">−35%</span>' : ""
    }</h3>
    <p class="descrizione">${esc(descrizione)}</p>
    ${punti ? `<ul class="promessa">${punti}</ul>` : ""}
    <div class="azioni">
      <a class="pulsante" href="webcal://${esc(config.metadati.dominio)}/${esc(profilo.file)}">Iscriviti al calendario</a>
      <p class="alternativa">Si sottoscrive nel client che usi già e da quel momento si aggiorna da solo.</p>
      <div class="scarica">
        <span class="etichetta">Oppure scarica l'anno</span>
        ${anni
          .map((anno) => `<a href="${esc(nomeFileAnno(profilo, anno))}">${anno}</a>`)
          .join("\n        ")}
        <span class="formato-riga">file <code>.ics</code>, statico</span>
      </div>
      <div class="indirizzo">webcal://${esc(config.metadati.dominio)}/${esc(profilo.file)}</div>
    </div>
  </article>`;
    })
    .join("\n  ");

  return `<section id="calendari">
  <p class="occhiello">Aggiungi il calendario</p>
  <h2 class="titolo-2">Tre calendari, uno per il tuo profilo</h2>
  <p class="sommario">Scegli il tuo profilo e sottoscriviti al calendario nel client che usi già.
  Da quel momento le scadenze compaiono da sole nella tua agenda, e si aggiornano da sole quando
  cambiano. Se preferisci, scarichi l'anno che ti serve: ma allora è una copia ferma.</p>
  <div class="calendari">
  ${carte}
  </div>
  <div class="dinamico-statico">
    <div>
      <span class="timbro ok">iscritto</span>
      <p><strong>Dinamico.</strong> Il calendario si aggiorna da solo: ad ogni verifica trimestrale
      le date cambiano nella tua agenda, proroghe comprese, senza che tu debba fare nulla.</p>
    </div>
    <div>
      <span class="timbro">scaricato</span>
      <p><strong>Statico.</strong> Il file è una fotografia di oggi e resta fermo. Se una scadenza
      cambia, la tua copia non lo saprà: buono per stamparlo, non per fidarsi a lungo.</p>
    </div>
  </div>
  ${accordion({
    etichetta: "Iscritto si aggiorna, scaricato no: la differenza",
    misura: "dinamico o statico",
    aperto: true,
    interno: `<p>È l'unica scelta che conta davvero, quindi vale la pena dirla chiara.</p>
    <p><strong>Se ti iscrivi</strong> il calendario vive nel tuo client e si aggiorna da solo: ad
    ogni verifica trimestrale le date cambiano nella tua agenda, e le proroghe arrivano senza che
    tu debba rifare niente. È la scelta consigliata.</p>
    <p><strong>Se scarichi</strong> il file ottieni una fotografia di oggi, che resta ferma. È
    comodo per stamparlo, per allegarlo o per avere un solo anno sotto mano, ma se una scadenza
    cambia la tua copia non lo saprà: nessuno te lo verrà a dire.</p>
    <p>Il <code>webcal://</code> è il gesto diretto per iscriversi, ma il browser lo passa al
    sistema operativo e <strong>funziona solo se hai un'app di calendario registrata come
    gestore</strong>: su macOS e iOS succede, su Windows e Android spesso no. In quel caso copia
    l'indirizzo <code>webcal://</code> e usalo nella funzione «aggiungi calendario da URL» del tuo
    client.</p>
    <p>Nota per chi guarda questa pagina <em>in locale</em>: i link <code>webcal://</code> puntano
    al dominio di produzione, quindi finché il sito non è pubblicato lì non c'è nulla da
    raggiungere; i link di scaricamento, invece, sono relativi e funzionano anche sul server
    locale.</p>`,
  })}

  ${accordion({
    etichetta: "Google Calendar non mostra i promemoria dei calendari sottoscritti",
    misura: "come rimediare",
    interno: `<p>Ogni evento porta due promemoria, a 15 e a 3 giorni dalla scadenza. Google Calendar
    però <strong>non applica i promemoria</strong> contenuti nei calendari sottoscritti via URL:
    dopo la sottoscrizione vanno impostati a mano nelle impostazioni del calendario.</p>
    <p>Apple Calendario, Thunderbird e Outlook nella maggior parte delle configurazioni li leggono
    invece correttamente.</p>`,
  })}
</section>`;
}

function sezioneComeFunziona(): string {
  return `<section id="come-funziona">
  <p class="occhiello">Come funziona</p>
  <h2 class="titolo-2">Tutto automatico, dall'inizio alla fine</h2>
  <p class="sommario">Il servizio <strong>si aggiorna automaticamente tramite intelligenza
  artificiale</strong>: nessuno riscrive a mano le date quando cambia una norma.</p>
  <div class="passi">
    <div class="passo">
      <h3 class="titolo-3">Le regole non sono scritte nel programma</h3>
      <p>Date, aliquote e soglie stanno in un file di regole, leggibile come un documento. Quando
      una norma cambia, si vede che cosa è cambiato e perché.</p>
    </div>
    <div class="passo">
      <h3 class="titolo-3">Ogni trimestre l'IA ricontrolla le fonti</h3>
      <p>Il primo di gennaio, aprile, luglio e ottobre un modello di intelligenza artificiale
      rilegge circolari, leggi e comunicati, cerca modifiche e proroghe, e riscrive da sé regole e
      date. I calendari si rigenerano di conseguenza.</p>
    </div>
    <div class="passo">
      <h3 class="titolo-3">Una modifica passa solo con la prova</h3>
      <p>L'IA non decide niente da sola: ogni valore che propone viene applicato solo se la frase
      citata a sostegno compare davvero nella pagina della fonte. Altrimenti viene scartato, e il
      motivo resta scritto.</p>
    </div>
  </div>
  <div class="nota-ia">
    <h3 class="titolo-3">Un esempio di come l'intelligenza artificiale può essere utile</h3>
    <p>Non serve a inventare risposte: serve a <strong>leggere e controllare una fonte che
    cambia</strong>. Un commercialista sa fare questo lavoro meglio di un modello, ma non può
    rileggere ogni trimestre tutte le circolari INPS e le leggi di Bilancio per un calendario
    gratuito. Il modello sì, e il codice gli impone di mostrare la prova di ciò che afferma.</p>
    <p>È un uso deliberatamente limitato: l'IA propone, il codice verifica, e tutto quello che non
    è confermato resta dichiarato in fondo a questa pagina.</p>
  </div>
  <p style="margin-top:1.4rem;font-size:.9rem;color:var(--tenue)">Diciamo sempre quanto è
  verificato e quanto no: ogni scadenza inaffidabile porta un timbro, e c'è una sezione finale che
  le elenca tutte.</p>
</section>`;
}

function sezioneScadenze(
  eventi: EventoGenerato[],
  config: Regole,
  anni: number[],
  stati: Map<string, StatoRegola>,
): string {
  const anniBlocchi = anni
    .map((anno) => {
      const dellAnno = eventi.filter((evento) => evento.data.getUTCFullYear() === anno);
      if (dellAnno.length === 0) return "";

      const profili = config.profili
        .map((profilo) => {
          const eventiProfilo = dellAnno
            .filter((evento) => evento.profilo_id === profilo.id)
            .sort((a, b) => a.data.getTime() - b.data.getTime());
          if (eventiProfilo.length === 0) return "";

          let meseCorrente = -1;
          const righeVoci: string[] = [];

          for (const evento of eventiProfilo) {
            const mese = evento.data.getUTCMonth();
            if (mese !== meseCorrente) {
              meseCorrente = mese;
              righeVoci.push(
                `<p class="mese">${esc(NOMI_MESI[mese])} ${anno}</p>`,
              );
            }

            const spostata =
              evento.data.getTime() !== evento.data_ordinaria.getTime()
                ? `<span class="spostata"> · spostata da ${esc(formattaDataItaliana(evento.data_ordinaria))}</span>`
                : "";

            const dettagli = blocchiDescrizione(evento.descrizione)
              .map(
                (blocco) => `<dt>${esc(blocco.etichetta)}</dt><dd>${esc(blocco.testo)}</dd>`,
              )
              .join("\n          ");

            righeVoci.push(`<article class="scadenza">
        <div class="rail">
          <span class="giorno">${String(evento.data.getUTCDate()).padStart(2, "0")}</span>
          <span class="filo"></span>
        </div>
        <div class="contorno">
          <h3>${esc(evento.titolo.split(" — ")[0])}${timbro(stati.get(evento.regola_id) ?? "verificato")}</h3>
          <p class="quando">${esc(formattaDataItaliana(evento.data))}${spostata}</p>
          <details class="dettagli">
            <summary>Calcolo e criteri della data</summary>
            <dl>
          ${dettagli}
            </dl>
          </details>
        </div>
      </article>`);
          }

          const voci = righeVoci.join("\n      ");

          const mesi = new Set(eventiProfilo.map((e) => e.data.getUTCMonth())).size;

          return `<details class="profilo">
      <summary><span class="pallino"></span>${esc(profilo.nome)}<span class="conteggio">${eventiProfilo.length} scadenze</span></summary>
      <div class="corpo-profilo">
    ${voci}
      </div>
    </details>`;
        })
        .filter(Boolean)
        .join("\n  ");

      return `<details class="anno" open>
    <summary><span class="cifra">${anno}</span><span class="conteggio">${dellAnno.length} scadenze</span></summary>
  ${profili}
  </details>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<section id="scadenze">
  <p class="occhiello">Lo scadenzario</p>
  <h2 class="titolo-2">Anno corrente e successivo, per profilo</h2>
  <p class="sommario">Sono esattamente le date che finiscono nei file <code>.ics</code>. Apri un
  profilo per vedere il suo anno, e una scadenza per leggere il calcolo e i criteri della data.</p>
  ${anniBlocchi}
</section>`;
}

function sezioneCalcoli(parametri: Parametri, config: Regole, anni: number[]): string {
  const anno = anni[0];
  const insieme: ParametriAnno = risolviParametriAnno(parametri, anno);
  const minimale = insieme.valori["minimale_inps_artigiani_commercianti"] as number | undefined;
  const riduzione = parametri.comuni["riduzione_forfettario"];

  const righe = ["aliquota_artigiani", "aliquota_commercianti"]
    .map((campo) => {
      const aliquota = insieme.valori[campo];
      if (typeof aliquota !== "number" || typeof minimale !== "number") return "";
      const piena = minimale * aliquota;
      const ridotta = piena * (1 - riduzione);
      const etichetta = campo === "aliquota_artigiani" ? "Artigiani" : "Commercianti";
      return `<tr>
        <td>${etichetta}</td>
        <td class="numero">${formattaPercentuale(aliquota)}</td>
        <td class="numero">${formattaEuro(piena)}</td>
        <td class="numero">${formattaPercentuale(aliquota * (1 - riduzione))}<br><span style="color:var(--tenue)">${formattaEuro(ridotta)}</span></td>
        <td class="numero">${formattaEuro(ridotta / 4)}</td>
      </tr>`;
    })
    .join("\n      ");

  const aliquotaGs = insieme.valori["aliquota_gestione_separata"];
  const redditoEsempio = parametri.comuni["reddito_esempio"];
  const nomeGs = config.profili.find((p) => p.id === "gestione-separata")?.nome ?? "Gestione Separata";

  return `<section id="calcoli">
  <p class="occhiello">I numeri</p>
  <h2 class="titolo-2">Come si calcola quanto versi</h2>
  <p class="sommario">Artigiani e commercianti versano su un minimale di reddito, non sul reddito
  effettivo: sotto quella soglia il contributo è comunque dovuto. Nel ${anno} il minimale è
  <span class="dato">${esc(formattaEuro(minimale ?? 0))}</span>.</p>

  ${accordion({
    etichetta: "Tariffa piena e tariffa ridotta, affiancate",
    misura: `${anno}`,
    aperto: true,
    interno: `<div class="tabella-scorrevole" tabindex="0" role="region" aria-label="Confronto fra tariffa piena e ridotta">
    <table class="tabella">
      <thead><tr><th>Profilo</th><th>Aliquota</th><th>Senza riduzione</th><th>Con riduzione ${formattaPercentuale(riduzione, 0)}</th><th>Rata trimestrale</th></tr></thead>
      <tbody>
      ${righe}
      </tbody>
    </table>
    </div>
    <p style="margin-top:.9rem;font-size:.85rem;color:var(--tenue)">La rata trimestrale è il
    contributo annuo diviso in quattro: le scadenze sono a febbraio, maggio, agosto e novembre.</p>`,
  })}

  ${accordion({
    etichetta: "Come ottenere la riduzione del 35%",
    misura: "entro il 28 febbraio",
    interno: `<ul>
      <li>Riguarda solo gli imprenditori iscritti alle gestioni artigiani e commercianti. Chi è
      nella Gestione Separata non può accedervi.</li>
      <li>L'opzione va comunicata all'INPS <strong>entro il 28 febbraio</strong> dell'anno per cui
      la si chiede. Non è automatica.</li>
      <li>Si applica alla sola aliquota IVS, sia sul contributo calcolato sul minimale sia su quello
      sull'eventuale reddito eccedente.</li>
    </ul>`,
  })}

  ${accordion({
    etichetta: "Cosa comporta per la pensione",
    misura: "effetto sull'accredito",
    interno: `<p>La riduzione non è neutrale ai fini della pensione. La norma che la istituisce
    richiama, per l'accredito della contribuzione, l'articolo 2, comma 29, della legge 8 agosto
    1995, n. 335: versando di meno si accredita proporzionalmente di meno.</p>
    <p>Nella pratica, chi versa solo il minimale ridotto del 35% vede ridursi i mesi accreditati
    nell'anno. Chi ha una posizione contributiva da completare dovrebbe valutare questo effetto con
    il proprio consulente prima di scegliere la riduzione.</p>`,
  })}

  ${accordion({
    etichetta: `${nomeGs}: aliquota sul reddito, senza minimale`,
    misura: "calcolo standard",
    interno: `<p>Per la Gestione Separata il contributo si calcola sul reddito effettivamente
    prodotto: nessun minimale, e nessuna riduzione opzionale.
    ${typeof aliquotaGs === "number" ? `Aliquota <span class="dato">${esc(formattaPercentuale(aliquotaGs))}</span>.` : ""}</p>
    ${
      typeof aliquotaGs === "number" && typeof redditoEsempio === "number"
        ? `<p>Su un reddito di <span class="dato">${esc(formattaEuro(redditoEsempio))}</span> sono
           <span class="dato">${esc(formattaEuro(redditoEsempio * aliquotaGs))}</span>/anno.
           Il valore è illustrativo, non un dato normativo.</p>`
        : ""
    }`,
  })}
</section>`;
}

function rigaFonte(
  ambito: string,
  campo: string,
  fonte: {
    fonte_normativa: string;
    fonte_url: string;
    estratto_verificato: string;
    stato_verifica?: string;
    nota?: string;
  },
): string {
  const stato = fonte.stato_verifica ?? "verificato";
  const marchio = timbro(stato as StatoRegola);
  const estratto = fonte.estratto_verificato
    ? `<p class="citazione">“${esc(fonte.estratto_verificato)}”</p>`
    : fonte.nota
      ? `<p style="margin-top:.4rem;font-size:.83rem;color:var(--tenue)">${esc(fonte.nota)}</p>`
      : "";
  const url = fonte.fonte_url
    ? `<div class="url"><a href="${esc(fonte.fonte_url)}">${esc(fonte.fonte_url)}</a></div>`
    : "";

  return `<tr>
        <td>${esc(ambito)}</td>
        <td><code>${esc(campo)}</code><br>${marchio}</td>
        <td>${esc(fonte.fonte_normativa)}${url}${estratto}</td>
      </tr>`;
}

function sezioneFonti(parametri: Parametri): string {
  const righe = [
    ...(parametri.fonti_comuni ?? []).map((f) => rigaFonte("comune", f.campo, f)),
    ...Object.entries(parametri.anni).flatMap(([anno, insieme]) =>
      (insieme.fonti ?? []).map((f) => rigaFonte(anno, f.campo, f)),
    ),
  ].join("\n      ");

  const comuni = Object.entries(parametri.comuni)
    .map(
      ([campo, valore]) =>
        `<li><span class="k">${esc(campo)}</span><span class="dato">${esc(String(valore))}</span></li>`,
    )
    .join("");

  const anniBlocchi = Object.entries(parametri.anni)
    .map(([anno, insieme]) => {
      const valori = Object.entries(insieme)
        .filter(([, valore]) => typeof valore === "number")
        .map(
          ([campo, valore]) =>
            `<li><span class="k">${esc(campo)}</span><span class="dato">${esc(String(valore))}</span></li>`,
        )
        .join("");
      return accordion({
        etichetta: `Valori dell'anno ${anno}`,
        misura: insieme.valori_provvisori ? "provvisori" : "definitivi",
        interno: `<ul class="elenco-dati">${valori}</ul>${
          insieme.nota ? `<p style="margin-top:.7rem;font-size:.84rem;color:var(--tenue)">${esc(insieme.nota)}</p>` : ""
        }`,
      });
    })
    .join("\n  ");

  return `<section id="fonti">
  <p class="occhiello">Fonti</p>
  <h2 class="titolo-2">Cosa ha trovato l'IA, numero per numero</h2>
  <p class="sommario">Ogni valore rivalutabile è elencato con la fonte che l'IA ha trovato e con la
  frase esatta che ha estratto da quella fonte. Dove c'è un estratto, il sistema ha confrontato
  automaticamente quel testo con la pagina citata: se non combaciava, il valore non sarebbe qui.</p>

  ${accordion({
    etichetta: "Valori validi per tutti gli anni",
    misura: `${Object.keys(parametri.comuni).length} voci`,
    interno: `<ul class="elenco-dati">${comuni}</ul>`,
  })}
  ${anniBlocchi}

  ${accordion({
    etichetta: "Riscontri sulle fonti, valore per valore",
    misura: `${parametri.fonti_comuni?.length ?? 0} + ${Object.keys(parametri.anni).length} annuali`,
    interno: `<div class="tabella-scorrevole" tabindex="0" role="region" aria-label="Riscontri sulle fonti">
    <table class="tabella">
      <thead><tr><th>Ambito</th><th>Campo e stato</th><th>Fonte e estratto</th></tr></thead>
      <tbody>
      ${righe}
      </tbody>
    </table>
    </div>`,
  })}
</section>`;
}

function sezioneRegole(config: Regole, stati: Map<string, StatoRegola>): string {
  const blocchi = config.regole
    .map((regola) => {
      const varianti = (regola.varianti_validita ?? [])
        .map(
          (variante) =>
            `<li>Anni ${variante.da_anno}–${variante.a_anno}: ${esc(variante.fonte_normativa)}${
              variante.estratto_verificato
                ? `<p class="citazione">“${esc(variante.estratto_verificato)}”</p>`
                : ""
            }</li>`,
        )
        .join("");

      const stato = stati.get(regola.id) ?? "verificato";
      return accordion({
        etichetta: regola.descrizione,
        misura: stato === "verificato" ? "confermata dall'IA" : "da verificare",
        interno: `<p class="occhiello" style="margin-bottom:.7rem">${esc(regola.id)}${
          regola.categoria ? ` · ${esc(regola.categoria)}` : ""
        }</p>
        <dl style="margin:0">
          <dt style="font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tenue)">Fonte normativa</dt>
          <dd style="margin:.2rem 0 0">${esc(regola.fonte_normativa)}</dd>
        </dl>
        ${regola.fonte_url ? `<div class="url"><a href="${esc(regola.fonte_url)}">${esc(regola.fonte_url)}</a></div>` : ""}
        ${regola.estratto_verificato ? `<p class="citazione">“${esc(regola.estratto_verificato)}”</p>` : ""}
        ${(regola.fonti_aggiuntive ?? [])
          .map(
            (fonte) => `<div style="margin-top:.9rem">
          <p style="font-family:var(--mono);font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--tenue);margin:0">${esc(fonte.aspetto)} ${timbro((fonte.stato_verifica ?? "verificato") as StatoRegola)}</p>
          <p style="margin:.25rem 0 0;font-size:.9rem">${esc(fonte.fonte_normativa)}</p>
          ${fonte.fonte_url ? `<div class="url"><a href="${esc(fonte.fonte_url)}">${esc(fonte.fonte_url)}</a></div>` : ""}
          ${fonte.estratto_verificato ? `<p class="citazione">“${esc(fonte.estratto_verificato)}”</p>` : ""}
          ${fonte.nota ? `<p style="margin:.4rem 0 0;font-size:.83rem;color:var(--tenue)">${esc(fonte.nota)}</p>` : ""}
        </div>`,
          )
          .join("")}
        ${varianti ? `<div style="margin-top:.8rem"><strong style="font-size:.87rem">Varianti per periodo</strong><ul style="margin:.35rem 0 0;padding-left:1.1rem;font-size:.87rem">${varianti}</ul></div>` : ""}
        ${regola.nota ? `<p style="margin-top:.85rem;font-size:.84rem;color:var(--tenue)">${esc(regola.nota)}</p>` : ""}`,
      });
    })
    .join("\n  ");

  return `<section id="regole">
  <p class="occhiello">Le regole</p>
  <h2 class="titolo-2">Le regole che l'IA controlla ogni trimestre</h2>
  <p class="sommario">Le regole non sono scritte nel programma: stanno in un file di dati che il
  motore interpreta. Qui sotto c'è quello che l'IA ha trovato per ciascuna, con la fonte e la frase
  citata. Le modifiche che applica restano ricostruibili dalla cronologia dei commit e dagli
  snapshot in <code>regole.json.storico/</code>.</p>
  ${blocchi}
</section>`;
}

function sezioneProroghe(config: Regole): string {
  const proroghe = config.proroghe ?? [];

  if (proroghe.length === 0) {
    return `<section id="proroghe">
  <p class="occhiello">Proroghe</p>
  <h2 class="titolo-2">Nessuna proroga applicata</h2>
  <p class="sommario">Una proroga entra nei calendari solo quando l'IA trova un decreto o un
  comunicato <em>e</em> la frase citata a sostegno viene ritrovata nella pagina della fonte. Al
  momento non ce ne sono.</p>
</section>`;
  }

  const voci = proroghe
    .map(
      (proroga) => `<article class="scadenza">
        <div class="rail"><span class="giorno">${esc(proroga.data_nuova.slice(8, 10))}</span><span class="filo"></span></div>
        <div class="contorno">
          <h3>${esc(proroga.scadenza)}</h3>
          <p class="quando">${esc(proroga.data_originale)} → <span class="spostata">${esc(proroga.data_nuova)}</span></p>
          <p class="citazione">“${esc(proroga.estratto_testuale)}”</p>
          <div class="url"><a href="${esc(proroga.fonte_url)}">${esc(proroga.fonte_url)}</a></div>
        </div>
      </article>`,
    )
    .join("\n    ");

  return `<section id="proroghe">
  <p class="occhiello">Proroghe</p>
  <h2 class="titolo-2">${proroghe.length} confermate con fonte</h2>
  ${voci}
</section>`;
}

function sezioneNonVerificati(
  campi: { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[],
  aMano: { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[],
): string {
  const bloccoAMano =
    aMano.length === 0
      ? ""
      : `<h3 class="titolo-3" style="margin-top:2rem">Letto dall'IA, ma non ricontrollabile ad ogni run</h3>
  <p class="sommario">Questi dati sono solidi: l'IA li ha letti e confermati sulla fonte ufficiale
  indicata. Non può però ricontrollarli ad ogni trimestre, quasi sempre perché la fonte è un PDF e
  il sistema preferisce dichiararlo invece di fingere di saperlo leggere.</p>
  ${aMano
    .map(
      (campo) => `<div class="non-verificato" style="border-left-color:var(--petrolio)">
    <div class="intestazione">
      <code>${esc(campo.campo)}</code>
      <span class="timbro mano">letto dall'IA, non ricontrollabile</span>
    </div>
    <p>${esc(campo.nota)}</p>
    ${campo.fonte_url ? `<div class="url"><a href="${esc(campo.fonte_url)}" rel="noopener">${esc(campo.fonte_url)}</a></div>` : ""}
  </div>`,
    )
    .join("\n  ")}`;

  if (campi.length === 0) {
    return `<section id="non-verificati">
  <p class="occhiello">Trasparenza</p>
  <h2 class="titolo-2">L'IA ha confermato tutto</h2>
  <p class="sommario">Nessun dato pubblicato è privo di riscontro: ogni valore e ogni riferimento ha
  superato il confronto automatico con la fonte citata.</p>
  ${bloccoAMano}
</section>`;
  }

  const voci = campi
    .map(
      (campo) => `<div class="non-verificato">
    <div class="intestazione">
      <code>${esc(campo.campo)}</code>
      <span class="timbro">${esc(campo.stato === "da_verificare" ? "non confermato dall'IA" : "fonte non leggibile dall'IA")}</span>
    </div>
    <p>${esc(campo.nota)}</p>
    ${campo.fonte_url ? `<div class="url"><a href="${esc(campo.fonte_url)}" rel="noopener">${esc(campo.fonte_url)}</a></div>` : ""}
  </div>`,
    )
    .join("\n  ");

  return `<section id="non-verificati">
  <p class="occhiello">Trasparenza</p>
  <h2 class="titolo-2">Cosa l'IA non ha potuto confermare</h2>
  <p class="sommario">Questi ${campi.length} dati sono pubblicati ma la loro fonte non ha superato il
  controllo dell'IA: o la pagina ufficiale non si lascia leggere in modo automatico, o la norma non
  è stata individuata. Sono qui perché tu possa verificarli, non perché siano accertati.
  <strong>È un'intelligenza artificiale: può sbagliare.</strong></p>
  ${voci}
  ${bloccoAMano}
</section>`;
}

function sezioneStatoCompatta(status: StatusFile): { riga: string; nota: string; classe: string } {
  const formatta = (valore: string | null) =>
    valore ? new Date(valore).toISOString().slice(0, 16).replace("T", " ") : null;

  if (status.ultimo_tentativo_esito === "riuscito") {
    return {
      riga: `Ultimo aggiornamento: ${formatta(status.ultimo_aggiornamento_riuscito) ?? "non disponibile"} UTC`,
      nota: "I calendari pubblicati e questa pagina derivano da quella verifica.",
      classe: "ok",
    };
  }

  if (!status.ultimo_aggiornamento_riuscito) {
    return {
      riga: "Nessuna verifica è ancora andata a buon fine",
      nota:
        status.dettaglio_fallimento ??
        "I calendari sono generati dai dati del repository, ma nessuna run ha ancora ricevuto risposta valida dal modello.",
      classe: "ko",
    };
  }

  return {
    riga: `Ultimo tentativo non riuscito: ${formatta(status.ultimo_tentativo) ?? "sconosciuto"} UTC`,
    nota: `${status.dettaglio_fallimento ?? "Motivo non registrato."} Restano pubblicati i calendari dell'ultima verifica riuscita (${formatta(status.ultimo_aggiornamento_riuscito)} UTC).`,
    classe: "ko",
  };
}

function pièDiPagina(config: Regole, status: StatusFile): string {
  return `<footer>
  <div class="guscio">
    <div class="colonne">
      <div>
        <p class="firma">scadefor</p>
        <p>Un servizio di <a href="${esc(URL_SEQUI)}">Sequi Company</a>. Codice sorgente pubblico su
        <a href="${esc(config.metadati.url_repository)}">GitHub</a>, licenza MIT.</p>
        <p>È anche un esempio di come l'intelligenza artificiale può essere utile: non a inventare
        risposte, ma a sorvegliare una fonte che cambia, con l'obbligo di mostrarne la prova.</p>
      </div>
      <div>
        <p class="firma">Stato</p>
        <p>${esc(sezioneStatoCompatta(status).riga)}.</p>
        <p><a href="#disclaimer">Torna all'avviso importante</a></p>
      </div>
    </div>
    <p style="margin-top:2rem">
      <a class="donazione" href="${esc(URL_DONAZIONI)}">Offrimi un caffè per la manutenzione</a>
    </p>
    <p style="margin-top:.7rem;font-size:.82rem">Se questo calendario ti ha evitato una sanzione,
    o semplicemente ti ha risparmiato una ricerca, il caffè è il modo più semplice per dire
    grazie.</p>
  </div>
</footer>`;
}

/* ------------------------------------------------------------------ *
 * Pagina
 * ------------------------------------------------------------------ */

export type OpzioniPagina = {
  config: Regole;
  parametri: Parametri;
  status: StatusFile;
  eventi: EventoGenerato[];
  anni: number[];
  fileGenerati: { nome: string; modificato: boolean }[];
  campiDaVerificare: { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[];
  fontiAMano: { dove: string; campo: string; stato: string; nota: string; fonte_url: string }[];
};

/**
 * Sezione domande frequenti.
 *
 * Non è decorazione: è il blocco che i motori di ricerca usano per i risultati
 * arricchiti, ed è anche la parte che una persona legge per prima quando arriva
 * da una ricerca. Per questo le risposte sono brevi, concrete e coerenti con i
 * dati pubblicati.
 */
function sezioneDomande(
  config: Regole,
  parametri: Parametri,
  anni: number[],
  eventi: EventoGenerato[],
): { html: string; domande: { domanda: string; risposta: string }[] } {
  const anno = anni[0];
  const insieme = risolviParametriAnno(parametri, anno);
  const minimale = insieme.valori["minimale_inps_artigiani_commercianti"];
  const riduzione = parametri.comuni["riduzione_forfettario"];
  const dominio = config.metadati.dominio;

  const dateArtigiani = eventi
    .filter((e) => e.profilo_id === "artigiani-ridotto-35" && e.anno === anno)
    .sort((a, b) => a.data.getTime() - b.data.getTime())
    .map((e) => formattaDataItaliana(e.data));

  const domande = [
    {
      domanda: `Quali sono le scadenze del regime forfettario nel ${anno}?`,
      risposta:
        `Nel ${anno} un forfettario affronta due scadenze d'imposta — il 30 giugno per saldo e primo ` +
        `acconto e il 30 novembre per il secondo acconto — più, se è artigiano o commerciante, quattro ` +
        `rate contributive (febbraio, maggio, agosto e novembre) e l'opzione per la riduzione del 35% ` +
        `entro il 28 febbraio. Le date esatte, comprese le variazioni quando la scadenza cade di sabato ` +
        `o in un giorno festivo, sono elencate in questa pagina e nei calendari.`,
    },
    {
      domanda: "Quando si paga il saldo e il primo acconto dell'imposta sostitutiva?",
      risposta:
        `Il saldo dell'anno precedente e il primo acconto dell'anno corrente si versano entro il 30 ` +
        `giugno, il secondo acconto entro il 30 novembre. Per il regime forfettario l'acconto è in due ` +
        `rate di pari importo, quindi metà a giugno e metà a novembre: la ripartizione 50 e 50 viene ` +
        `dalla risoluzione dell'Agenzia delle Entrate n. 93/E del 12 novembre 2019, che estende ai ` +
        `forfettari quanto previsto dall'art. 58 del D.L. 124/2019.`,
    },
    {
      domanda: "Quando si versano i contributi INPS di artigiani e commercianti?",
      risposta:
        `Il contributo minimo obbligatorio si paga in quattro rate, nei mesi di febbraio, maggio, agosto ` +
        `e novembre, entro il giorno 16 di ciascun mese; se il 16 non è un giorno lavorativo la scadenza ` +
        `slitta al primo giorno lavorativo successivo. La rata di agosto cade al 20 per la sospensione ` +
        `feriale dei versamenti dall'1 al 20 agosto. Il contributo eccedente il minimale si versa in due ` +
        `acconti di pari importo alle scadenze delle imposte sui redditi.`,
    },
    {
      domanda: "Come si ottiene la riduzione contributiva del 35% per il regime forfettario?",
      risposta:
        `La riduzione del 35% della contribuzione IVS spetta agli artigiani e ai commercianti in regime ` +
        `forfettario. Va chiesta all'INPS entro il 28 febbraio dell'anno per cui la si richiede: non è ` +
        `automatica. Riduce i contributi ma riduce anche l'accredito pensionistico, in proporzione a ` +
        `quanto si versa. Chi è nella Gestione Separata non può accedervi.`,
    },
    {
      domanda: "Quanto si paga di contributi nel regime forfettario?",
      risposta:
        `Artigiani e commercianti calcolano i contributi su un minimale di reddito, non sul reddito ` +
        `effettivo` +
        (typeof minimale === "number" ? `: nel ${anno} il minimale è ${formattaEuro(minimale)}` : "") +
        `. Con la riduzione del ${formattaPercentuale(riduzione, 0)} il contributo annuo scende a circa ` +
        `i due terzi. Nella sezione «Come si calcola quanto versi» di questa pagina trovi gli importi ` +
        `per ciascun profilo, con la tariffa piena e quella ridotta affiancate.`,
    },
    {
      domanda: "Il calendario si aggiorna da solo?",
      risposta:
        `Se lo sottoscrivi sì: il calendario si aggiorna automaticamente ogni trimestre, quando ` +
        `l'intelligenza artificiale che gestisce il servizio ricontrolla le fonti ufficiali, e ` +
        `le date cambiano da sole nella tua agenda. Se invece scarichi il file, quello è una ` +
        `fotografia di oggi e resta fermo.`,
    },
    {
      domanda: "Come si sottoscrive il calendario su Google Calendar o su iPhone?",
      risposta:
        `Scegli il tuo profilo e usa il link webcal:// oppure l'indirizzo .ics nella funzione «aggiungi ` +
        `calendario da URL» del tuo client. Su Google Calendar tieni presente che i promemoria ` +
        `contenuti nei calendari sottoscritti via URL non vengono applicati e vanno impostati a mano; ` +
        `su Apple Calendario, Thunderbird e Outlook funzionano invece da soli.`,
    },
    {
      domanda: "Questo calendario è affidabile? Chi lo verifica?",
      risposta:
        `Nessun professionista lo verifica, e questo è dichiarato in evidenza. Il servizio è ` +
        `interamente automatico: un modello di intelligenza artificiale cerca le fonti, propone le date ` +
        `e gli importi, e il sistema applica una modifica solo se la frase citata a sostegno compare ` +
        `davvero nella pagina della fonte. Ogni scadenza porta un timbro che dice se l'IA è riuscita a ` +
        `confermarla, e i dati non confermati sono elencati qui sotto. È un'intelligenza artificiale: ` +
        `può sbagliare. Prima di versare, verifica sui portali ufficiali o con il tuo consulente.`,
    },
  ];

  const html = `<section id="domande">
  <p class="occhiello">Domande frequenti</p>
  <h2 class="titolo-2">Le domande che ci fanno più spesso</h2>
  <p class="sommario">Risposte brevi alle domande che portano qui la maggior parte delle persone:
  quando si paga, quanto si paga, come ci si iscrive e di chi ci si può fidare.</p>
  ${domande
    .map((voce) =>
      accordion({
        etichetta: voce.domanda,
        interno: `<p>${esc(voce.risposta)}</p>`,
      }),
    )
    .join("\n  ")}
  <p style="margin-top:1.2rem;font-size:.88rem;color:var(--tenue)">Altre domande?
  <a href="${esc(config.metadati.url_repository)}">Apri una issue sul repository</a>: è il canale
  giusto anche per segnalare una data sbagliata, purché con la fonte a supporto.</p>
</section>`;

  return { html, domande };
}

/** Voci di navigazione, usate sia dal menu sia dai dati strutturati. */
const SEZIONI: { id: string; etichetta: string }[] = [
  { id: "calendari", etichetta: "Sottoscrivi il calendario" },
  { id: "scadenze", etichetta: "Scadenze del forfettario" },
  { id: "calcoli", etichetta: "Come si calcolano gli importi" },
  { id: "domande", etichetta: "Domande frequenti" },
  { id: "fonti", etichetta: "Fonti dei numeri" },
  { id: "regole", etichetta: "Regole e norme" },
  { id: "non-verificati", etichetta: "Cosa l'IA non ha confermato" },
];

export function generaSitemap(config: Regole, status: StatusFile, anni: number[]): string {
  const base = `https://${config.metadati.dominio}`;
  // `lastmod` è la data dell'ultima verifica riuscita: cambia solo quando cambia
  // qualcosa di sostanziale, così la sitemap non produce diff ad ogni run. Se
  // non c'è ancora stata una verifica riuscita, il tag si omette: una data
  // inventata sarebbe peggio di nessuna data.
  const lastmod = status.ultimo_aggiornamento_riuscito?.slice(0, 10) ?? null;

  const url = [
    { loc: `${base}/`, priorita: "1.0", frequenza: "monthly" },
    ...config.profili.flatMap((profilo) => [
      { loc: `${base}/${profilo.file}`, priorita: "0.8", frequenza: "monthly" },
      ...anni.map((anno) => ({
        loc: `${base}/${nomeFileAnno(profilo, anno)}`,
        priorita: "0.5",
        frequenza: "yearly",
      })),
    ]),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url
  .map(
    (voce) => `  <url>
    <loc>${voce.loc}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}    <changefreq>${voce.frequenza}</changefreq>
    <priority>${voce.priorita}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
}

export function generaRobots(config: Regole): string {
  return `# scadefor — calendari di scadenze per il regime forfettario
User-agent: *
Allow: /

# I file .ics sono pensati per essere letti dai client di calendario, non indicizzati.
# Restano raggiungibili: qui si chiede solo di non sprecarci budget di scansione.
Disallow: /*.ics$

Sitemap: https://${config.metadati.dominio}/sitemap.xml
`;
}

export function generaPagina(opzioni: OpzioniPagina): string {
  const { config, parametri, status, eventi, anni, campiDaVerificare, fontiAMano } = opzioni;

  const stati = mappaStati(config);
  const stato = sezioneStatoCompatta(status);
  const anniTesto = anni.length > 1 ? `${anni[0]} e ${anni[1]}` : String(anni[0]);
  const totale = eventi.length;
  const nonVerificati = campiDaVerificare.length;
  const dominio = config.metadati.dominio;
  const base = `https://${dominio}`;

  const titolo = `Scadenze forfettario ${anniTesto} — calendario ICS da sottoscrivere`;
  const descrizione =
    `Le scadenze fiscali e contributive del regime forfettario per il ${anniTesto}: saldo e acconti ` +
    `dell'imposta sostitutiva, rate INPS di artigiani e commercianti, riduzione del 35%, importi ` +
    `calcolati e fonti di legge. Tre calendari ICS da sottoscrivere, aggiornati dall'intelligenza ` +
    `artificiale ogni trimestre.`;

  const { html: sezioneDomandeHtml, domande } = sezioneDomande(config, parametri, anni, eventi);

  const datiStrutturati = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}/#sito`,
        url: `${base}/`,
        name: "scadefor — Scadenze Forfettari",
        alternateName: "Scadenze del regime forfettario",
        inLanguage: "it-IT",
        description: descrizione,
        publisher: { "@id": `${base}/#organizzazione` },
      },
      {
        "@type": "Organization",
        "@id": `${base}/#organizzazione`,
        name: "Sequi Company",
        url: "https://sequi.company",
      },
      {
        "@type": "WebPage",
        "@id": `${base}/#pagina`,
        url: `${base}/`,
        name: titolo,
        description: descrizione,
        inLanguage: "it-IT",
        isPartOf: { "@id": `${base}/#sito` },
        publisher: { "@id": `${base}/#organizzazione` },
        isAccessibleForFree: true,
        keywords: [
          "scadenze forfettario",
          `scadenze forfettario ${anniTesto}`,
          "calendario scadenze forfettario",
          "regime forfettario",
          "imposta sostitutiva acconto",
          "contributi INPS artigiani e commercianti",
          "riduzione contributiva 35 per cento",
          "calendario ICS",
        ],
        ...(status.ultimo_aggiornamento_riuscito
          ? { dateModified: status.ultimo_aggiornamento_riuscito }
          : {}),
      },
      {
        "@type": "ItemList",
        name: "Calendari di scadenze per il regime forfettario",
        numberOfItems: config.profili.length,
        itemListElement: config.profili.map((profilo, indice) => ({
          "@type": "ListItem",
          position: indice + 1,
          name: profilo.nome_calendario,
          description: profilo.descrizione,
          url: `${base}/${profilo.file}`,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: domande.map((voce) => ({
          "@type": "Question",
          name: voce.domanda,
          acceptedAnswer: { "@type": "Answer", text: voce.risposta },
        })),
      },
    ],
  };

  // `<` va neutralizzato, altrimenti una stringa che contiene `</script>`
  // chiuderebbe il blocco e romperebbe la pagina.
  const jsonLd = JSON.stringify(datiStrutturati).replace(/</g, "\\u003c");

  const collegamentiCalendario = config.profili
    .map(
      (profilo) =>
        `  <link rel="alternate" type="text/calendar" href="${esc(profilo.file)}" title="${esc(profilo.nome)}" hreflang="it">`,
    )
    .join("\n");

  const indice = SEZIONI.map(
    (sezione) => `      <li><a href="#${sezione.id}">${esc(sezione.etichetta)}</a></li>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titolo)}</title>
<meta name="description" content="${esc(descrizione)}">
<link rel="canonical" href="${base}/">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="author" content="Sequi Company">
<meta name="theme-color" content="#0d5a63">

<!-- Anteprima quando il link viene condiviso -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="scadefor — Scadenze Forfettari">
<meta property="og:locale" content="it_IT">
<meta property="og:title" content="${esc(titolo)}">
<meta property="og:description" content="${esc(descrizione)}">
<meta property="og:url" content="${base}/">
<meta property="og:image" content="${base}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Scadenze del regime forfettario in un calendario da sottoscrivere">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titolo)}">
<meta name="twitter:description" content="${esc(descrizione)}">
<meta name="twitter:image" content="${base}/og-image.png">

<link rel="alternate" hreflang="it" href="${base}/">
<link rel="alternate" hreflang="x-default" href="${base}/">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
${collegamentiCalendario}
<script type="application/ld+json">${jsonLd}</script>
<style>${CSS}</style>
</head>
<body>
<a class="salta" href="#calendari">Salta alle iscrizioni</a>

<header class="testata">
  <div class="guscio">
    <div>
      <p class="marchio">
        <span class="acronimo"><b>Scade</b>nze <b>For</b>fettari</span>
        <span class="spiegazione">scadenze fiscali e contributive del regime forfettario</span>
      </p>
      <h1 class="titolo-1">Il fisco non ti manda<br>un promemoria. <em>Questo sì.</em></h1>
      <p class="sommario" style="margin-top:1.1rem">
        Le scadenze fiscali e contributive del regime forfettario, che finiscono direttamente
        nell'agenda che usi già. Tre profili, due anni, e un'intelligenza artificiale che
        ricontrolla le fonti ufficiali ogni trimestre. Gratis, senza account, senza installare
        niente.
      </p>
      <ul class="promessa">
        <li>${totale} scadenze</li>
        <li>3 profili</li>
        <li>promemoria a 15 e 3 giorni</li>
        <li>si aggiorna da solo con l'IA</li>
      </ul>
    </div>
    <div>
      <div class="avviso" id="disclaimer">
        <p class="riga">⚠️ Servizio non verificato da un professionista</p>
        <p class="nota">Solo a titolo indicativo. Date, importi e criteri sono prodotti
        dall'intelligenza artificiale, anche le regole stesse possono cambiare senza intervento
        umano, e <strong>nessuna verifica umana</strong> viene fatta prima o dopo la
        pubblicazione.</p>
        <details class="testo-integrale">
          <summary>Leggi l'avviso completo</summary>
          <p>${esc(TESTO_DISCLAIMER)}</p>
        </details>
      </div>
      <div class="bollo ${stato.classe}">
        <p class="riga">${stato.classe === "ok" ? "✅" : "⚠️"} ${esc(stato.riga)}</p>
        <p>${esc(stato.nota)}</p>
        ${
          nonVerificati > 0
            ? `<p><a href="#non-verificati">${nonVerificati} dati che l'IA non ha potuto confermare</a></p>`
            : ""
        }
      </div>
    </div>
  </div>
</header>

<main class="guscio" id="contenuto" style="padding-top:2.6rem">

  <nav class="indice" aria-label="Sezioni della pagina">
    <ul>
${indice}
    </ul>
  </nav>

  ${sezioneCalendari(config, eventi, anni)}
  ${sezioneComeFunziona()}
  ${sezioneScadenze(eventi, config, anni, stati)}
  ${sezioneCalcoli(parametri, config, anni)}
  ${sezioneDomandeHtml}
  ${sezioneFonti(parametri)}
  ${sezioneRegole(config, stati)}
  ${sezioneProroghe(config)}
  ${sezioneNonVerificati(campiDaVerificare, fontiAMano)}

</main>

${pièDiPagina(config, status)}

</body>
</html>
`;
}
