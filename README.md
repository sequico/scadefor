# scadefor

**⚠️ Servizio NON verificato da un professionista. Solo a titolo indicativo. Vedi sezione [Disclaimer](#disclaimer).**

Generatore di calendari `.ics` sottoscrivibili con le scadenze fiscali e contributive italiane del
regime forfettario, per l'anno corrente e per il successivo. Architettura statica e
zero-manutenzione: nessun database, nessun server applicativo, nessuna dipendenza da installare.
Tutto lo stato vive nei file versionati, e la cronologia dei commit è il registro delle modifiche.

Sito: <https://sequico.github.io/scadefor/>

---

## Iscriviti

Tre calendari, tutti per il regime forfettario:

- **Gestione Separata** — `webcal://sequico.github.io/scadefor/gestione-separata.ics`
- **Artigiani, riduzione 35%** — `webcal://sequico.github.io/scadefor/artigiani-ridotto-35.ics`
- **Commercianti, riduzione 35%** — `webcal://sequico.github.io/scadefor/commercianti-ridotto-35.ics`

Per la Gestione Separata la riduzione contributiva non è applicabile, quindi non compare fra le
opzioni. Per artigiani e commercianti la riduzione del 35% è già applicata nei calcoli: i calendari
rappresentano la situazione di chi ha presentato l'opzione all'INPS.

### Iscrizione o scaricamento: sono due cose diverse

- **Iscritto è dinamico.** Il calendario vive nel tuo client e si aggiorna da solo: ad ogni verifica
  trimestrale le date cambiano nella tua agenda, proroghe comprese. È la scelta consigliata.
- **Scaricato è statico.** Il file `-<anno>.ics` (per esempio `artigiani-ridotto-35-2026.ics`) è una
  fotografia del momento in cui l'hai preso. Se una scadenza cambia, la tua copia non lo saprà e
  nessuno te lo verrà a dire. È comodo per stamparlo o per tenere sotto mano un solo anno.

Il file senza suffisso è quello che si sottoscrive e copre anno corrente e successivo; i file con
l'anno sono quelli che si scaricano.

Ogni evento porta due promemoria, a 15 e a 3 giorni dalla scadenza. **Google Calendar non applica i
promemoria contenuti nei calendari sottoscritti via URL**: dopo la sottoscrizione vanno impostati a
mano. Gli altri client (Apple Calendario, Thunderbird, Outlook nella maggior parte delle
configurazioni) li leggono correttamente.

---

## Come funziona

Il progetto si regge su tre scelte.

**Le regole sono dati, non codice.** Le regole che governano le scadenze vivono in `regole.json`
come oggetti dichiarativi; il motore (`src/motore.ts`) è un interprete generico che non contiene
nessuna data, nessuna aliquota e nessuna soglia. Anche l'elenco delle festività nazionali è un dato,
non una tabella nel codice. Una modifica normativa si legge quindi come un diff su un file di dati,
non come una modifica a un programma.

**La verifica è trimestrale e automatica.** Il primo di gennaio, aprile, luglio e ottobre il
workflow chiama `verificaFonti.ts`, che interroga un modello di intelligenza artificiale con due
strumenti: la ricerca web e la lettura diretta di una pagina. Il modello verifica tre categorie: le
**regole strutturali** (le fonti normative citate sono state modificate, abrogate o sostituite?), i
**parametri annuali** (valori aggiornati per l'anno corrente e il successivo, contro circolari INPS
e Legge di Bilancio) e le **proroghe** del trimestre.

**Il modello propone, il codice decide.** Nessuna proposta viene applicata sulla parola del modello.
Per ogni voce proposta il sistema scarica la `fonte_url` e controlla che l'`estratto_testuale`
citato compaia **letteralmente** nella pagina, e che contenga proprio il valore che si vuole
scrivere. Se una delle due cose non torna, la modifica viene scartata e il motivo finisce in
`status.json`. Se la chiamata al modello fallisce, va in timeout o non produce JSON valido, **non
viene modificato nulla**: l'errore viene registrato e i calendari restano quelli dell'ultima
verifica riuscita.

La pagina pubblica mostra sempre lo stato dell'ultima verifica, le modifiche applicate, e — in una
sezione dedicata — i dati che l'IA non è riuscita a confermare.

### Limiti di sicurezza sulle modifiche automatiche

Le regole sono il punto in cui un errore si propaga a tutti i calendari, quindi sono protette da più
meccanismi indipendenti:

- **Allowlist dei campi.** Il modello può modificare solo campi di contenuto (date, percentuali,
  descrizioni, fonti). Non può toccare `id`, `tipo`, `attivo`, `categoria`, `applicabile_a`,
  `calcolo` né `pianificazione_rate`, nemmeno se glielo si chiedesse: il motore rifiuta la proposta.
- **Massimo due regole modificabili per run.** Le proposte eccedenti vengono registrate come
  "richiede attenzione", mai applicate in silenzio.
- **Elenco dei domini ammessi.** Una modifica si può giustificare solo con una pagina di un ente
  istituzionale dichiarato in `fonti.json`, o già citato fra le fonti pubblicate. Senza questo
  elenco, la pagina citata come prova la sceglierebbe il modello, e una pagina qualsiasi potrebbe
  diventare "fonte verificata".
- **Verifica dell'estratto e del valore.** Non basta che la frase citata esista: per i campi numerici
  deve contenere proprio il numero che si vuole scrivere, altrimenti viene scartata.
- **Snapshot preventivo.** Prima di sovrascrivere `regole.json`, la versione precedente viene salvata
  in `regole.json.storico/<timestamp>.json` con una nota che elenca cosa è cambiato in quella run.
- **Validazione prima dell'uso.** `regole.json` viene validato ad ogni run; una configurazione
  incoerente fa fallire la run invece di produrre un calendario sbagliato.
- **UID e date controllati.** La generazione si interrompe se due eventi condividono lo stesso UID o
  se una scadenza cade in un anno precedente a quello corrente.

### Perché gli altri anni non ci sono

I calendari coprono l'anno corrente e il successivo, e vengono rigenerati ad ogni run. Le scadenze
di anni precedenti non compaiono: gli eventi pubblicati sono solo quelli rilevanti da adesso in
avanti. È un vincolo applicato dal codice, non una convenzione.

Se i parametri dell'anno successivo non sono ancora stati pubblicati — come accade per il 2027 prima
della Legge di Bilancio — il calendario usa i valori dell'ultimo anno disponibile e **lo dice
esplicitamente** nella descrizione dell'evento e nella pagina. Non vengono inventati valori
provvisori.

---

## Disclaimer

Testo integrale, riportato anche in evidenza sul sito:

> AVVISO IMPORTANTE — SERVIZIO NON VERIFICATO
>
> Questo calendario è generato in modo interamente automatico, incluse le regole di calcolo e di
> scadenza stesse, che possono essere aggiornate dal sistema senza intervento umano qualora rilevi
> modifiche normative. Le date, gli importi e i criteri di calcolo mostrati sono prodotti da un
> sistema software che elabora regole normative e interroga periodicamente fonti pubbliche tramite
> un modello di intelligenza artificiale.
>
> NESSUNA VERIFICA UMANA viene effettuata sui contenuti generati né sulle eventuali modifiche alle
> regole, prima o dopo la pubblicazione. La citazione di fonti ufficiali (Agenzia delle Entrate,
> INPS, Gazzetta Ufficiale) accanto a ciascun dato NON costituisce garanzia di correttezza,
> completezza o aggiornamento: il sistema che estrae e verifica tali citazioni può commettere errori,
> richiamare fonti non più valide, interpretare in modo scorretto un testo normativo, o non rilevare
> modifiche intervenute.
>
> I contenuti hanno esclusivamente valore informativo e indicativo. NON costituiscono consulenza
> fiscale, contributiva, legale o professionale di alcun tipo, e non sostituiscono in alcun modo il
> parere di un commercialista, di un consulente del lavoro o di un professionista abilitato.
>
> L'utente riconosce ed accetta che:
>
> - L'utilizzo del servizio avviene interamente a proprio rischio.
> - Prima di effettuare qualsiasi versamento, adempimento o decisione fiscale, è tenuto a verificare
>   autonomamente le informazioni direttamente sui portali ufficiali o tramite un professionista
>   abilitato.
> - Sequi Company, il titolare del servizio e chiunque abbia contribuito al codice sorgente non
>   forniscono alcuna garanzia, esplicita o implicita, circa l'accuratezza, l'affidabilità, la
>   completezza o l'idoneità delle informazioni fornite per uno scopo particolare.
> - Nella misura massima consentita dalla legge applicabile, Sequi Company e i contributori del
>   progetto declinano ogni responsabilità per sanzioni, interessi, more, danni diretti, indiretti,
>   incidentali o consequenziali derivanti dall'uso, dal mancato uso, o dall'affidamento sulle
>   informazioni contenute in questo servizio.
> - Il servizio è fornito 'così com'è' ('as is') e 'come disponibile' ('as available'), senza alcun
>   impegno di continuità, aggiornamento tempestivo o assenza di interruzioni.
>
> Il codice sorgente è pubblico e consultabile: chiunque può ispezionare la logica di calcolo, le
> regole applicate e le fonti utilizzate, ma questa trasparenza non costituisce revisione
> professionale né certificazione di correttezza.

---

## Stato attuale dei dati

Il progetto pubblica sia ciò che l'intelligenza artificiale è riuscita a confermare sia ciò che non
ci è riuscita.

**Confermati automaticamente.** L'estratto citato è stato ritrovato letteralmente nella pagina
indicata; il controllo si esegue con `npm run verifica:estratti` e oggi copre 19 estratti su 19.

- la riduzione contributiva del 35% — legge 190/2014, art. 1, comma 77;
- la data del 30 giugno per saldo e primo acconto e il secondo acconto a novembre — D.P.R.
  435/2001, art. 17;
- **la ripartizione dell'acconto in due rate di pari importo** — risoluzione Agenzia delle Entrate
  n. 93/E del 12 novembre 2019, che estende ai forfettari l'art. 58 del D.L. 124/2019;
- la sospensione feriale dei versamenti dall'1 al 20 agosto — D.L. 223/2006, art. 37, comma 11-bis;
- lo slittamento al primo giorno lavorativo successivo — D.Lgs. 241/1997, art. 18, comma 1;
- il giorno 16 e i mesi delle rate contributive — D.Lgs. 241/1997, art. 18, commi 1 e 2;
- la rateizzazione in massimo sei rate e il differimento di 30 giorni — scheda informativa INPS;
- la soglia di 85.000 euro e le aliquote dell'imposta sostitutiva — scheda Agenzia delle Entrate;
- le aliquote IVS 2026 (24% artigiani, 24,48% commercianti) — comunicato INPS;
- **tutte le festività nazionali**, ciascuna con la sua norma: D.P.R. 792/1985, art. 1 per le
  religiose; legge 260/1949, art. 2 per le civili non soppresse; legge 54/1977, art. 1 per quelle
  soppresse; legge 336/2000 per il ripristino del 2 giugno.

Sulle festività vale una nota, perché è il punto su cui è facile sbagliare: **l'art. 2 della legge
260/1949 elenca molti più giorni di quanti siano festivi oggi.** San Giuseppe, Ascensione, Corpus
Domini e i Santi Pietro e Paolo sono ancora scritti lì, ma la legge 54/1977 li ha soppressi;
l'Epifania e il 2 giugno, soppressi nel 1977, sono stati poi ripristinati. La lista operativa è il
risultato incrociato di quattro norme, non la lettura di un solo articolo.

**Confermati leggendo, ma non ricontrollabili ad ogni run.** La ripartizione 50/50 poggia su un PDF
dell'Agenzia delle Entrate: è stato letto e confermato, ma la pipeline dichiara i PDF non testuali
invece di fingere di saperli leggere, quindi quel dato non viene ricontrollato automaticamente.

**Non confermati dall'IA.** Elencati anche sulla pagina pubblica, con il motivo:

- il **minimale contributivo 2026** (18.808 euro) e le **aliquote della Gestione Separata 2026**
  (26,07% e 24%). Le circolari INPS n. 14 e n. 8 del 2026 esistono, ma il corpo delle pagine
  ufficiali è reso via JavaScript e non espone alcun contenuto a una richiesta HTTP semplice; la
  scheda informativa INPS rimanda alla circolare senza riportare gli importi. I valori provengono da
  riproduzioni non ufficiali e vanno confermati a mano.

**Discrepanza annotata, non nascosta.** Per la rata contributiva di novembre la scheda informativa
INPS indica il 17 novembre 2026, mentre la regola generale (giorno 16, spostato se non lavorativo)
dà il **16 novembre 2026**, che è un lunedì. Il 16 novembre 2025 era invece domenica, e il 17 era la
data corretta per quell'anno: il 17 del 2026 somiglia a un residuo rimasto nella pagina. Il
calendario pubblica il **16**, cioè la data anteriore, perché pagare prima è sempre tempestivo e
pagare dopo no.

---

## Struttura del repository

```
.github/workflows/genera-scadenze.yml   cron trimestrale, test, generazione, commit, pubblicazione
genera.ts                               punto di ingresso della run
verificaFonti.ts                        verifica trimestrale delle fonti
regole.json                             regole strutturali, profili, proroghe
regole.json.storico/                    snapshot di regole.json prima di ogni modifica
parametri.json                          parametri annuali, con stato di verifica per campo
fonti.json                              pagine indice istituzionali e domini ammessi come prova
status.json                             esito dell'ultima verifica, in chiaro
public/
  gestione-separata.ics                 i tre calendari da ISCRIVERE (anno corrente + successivo)
  artigiani-ridotto-35.ics
  commercianti-ridotto-35.ics
  gestione-separata-2026.ics            i sei calendari da SCARICARE (uno per anno, statici)
  artigiani-ridotto-35-2026.ics
  commercianti-ridotto-35-2026.ics
  index.html                            pagina pubblica, rigenerata ad ogni run
  og-image.png                          anteprima per la condivisione
  robots.txt, sitemap.xml               file per i motori di ricerca
src/                                    motore, lettura/scrittura ICS, validazione, pagina
script/                                 verifica degli estratti, controllo geometrico, anteprima
test/                                   test con il runner integrato di Node
```

### Scelte di progetto

Alcune decisioni meritano una riga, perché non sono ovvie leggendo il codice.

- **Nessuna dipendenza esterna.** Node 24 esegue i file `.ts` direttamente: non c'è niente da
  installare, e non c'è una filiera di pacchetti da sorvegliare.
- **Generazione deterministica.** A parità di dati, calendari e pagina escono identici byte per
  byte, timestamp compresi. Una run senza novità non produce alcun diff, quindi il workflow può
  davvero concludere "nessuna modifica" invece di produrre rumore. Quando un evento cambia
  davvero, ne viene incrementato `SEQUENCE`, così i client lo aggiornano invece di duplicarlo.
- **Numeri verificati meccanicamente.** `npm run verifica:estratti` riapre ogni fonte citata e
  ricontrolla che l'estratto dichiarato ci sia davvero. È lo stesso controllo che la pipeline applica
  alle proposte del modello.
- **Controllo geometrico della pagina.** `npm run verifica:geometria` misura con Chrome headless la
  posizione dei bottoni e la larghezza del documento a cinque schermate, da telefono a schermo largo.
  Certi difetti di impaginazione non si vedono nel markup: i bottoni possono stare a quote diverse
  pur essendo tutti presenti e ben formati.
- **`stato_verifica` su regole e parametri.** Ogni dato dichiara quanto è supportato: `verificato`,
  `verificato_manualmente`, `fonte_primaria_non_leggibile` o `da_verificare`. Gli stati diversi da
  `verificato` richiedono una nota esplicativa e vengono mostrati sulla pagina.
- **`varianti_validita` sulle regole.** Permette di dichiarare la versione di una norma in vigore per
  un intervallo di anni, così il calendario di ogni anno cita la norma applicabile a quell'anno
  invece di una citazione unica retro-applicata.

---

## Uso in locale

Serve Node 24 o superiore. **Non ci sono dipendenze da installare.**

```bash
npm test                     # 63 test, nessuna rete
npm run genera:offline       # rigenera calendari e pagina senza chiamare il modello
npm run verifica             # esegue solo la verifica delle fonti (richiede DEEPSEEK_API_KEY)
npm run genera               # verifica + generazione, come in CI
npm run verifica:estratti    # ricontrolla ogni estratto pubblicato sulla sua fonte (richiede rete)
npm run verifica:geometria   # misura impaginazione con Chrome headless (richiede Chrome)
npm run genera:og-image      # rigenera l'anteprima per la condivisione (richiede Chrome)
```

I due comandi che richiedono Chrome lo dichiarano e terminano senza errore se non lo trovano: sono
controlli in più, non requisiti del progetto.

---

## Motore di ricerca

La verifica **non richiede alcuna chiave di ricerca**. Il provider predefinito è Google News RSS,
che è senza chiave, stabile e raggiungibile da un semplice client HTTP. Gli altri provider
(`tavily`, `brave`) sono facoltativi.

La scelta è il risultato di prove dirette, non di preferenze:

- `google.com/search` — risponde 200 ma restituisce una pagina che richiede JavaScript: a un client
  non-browser non arriva alcun risultato. Lo scraping di Google Search senza chiave non funziona.
- `html.duckduckgo.com` e `lite.duckduckgo.com` — pagina anti-bot (HTTP 202), nessun risultato.
- `mojeek.com`, `startpage.com` — nessun risultato a un client non-browser.
- `ecosia.org` — 403; `search.brave.com` — 429.
- Istanze pubbliche SearXNG — API JSON disabilitata (403 oppure solo HTML).
- `news.google.com/rss` — 200, XML strutturato, risultati reali. **Questo funziona.**

I link restituiti da Google News sono reindirizzamenti JavaScript che un semplice `fetch` non può
seguire. Per questo la ricerca è trattata come **segnale di scoperta** e la lettura avviene sempre
con uno strumento di apertura pagina, che è anche ciò che autorizza una modifica. L'architettura
regge quindi su due gambe indipendenti: `fonti.json` elenca pagine indice istituzionali
raggiungibili con una semplice richiesta HTTP, e le query predefinite vengono eseguite prima della
conversazione con il modello.

Un'osservazione utile per chi estende il progetto: le pagine di Normattiva sono leggibili da un
semplice `fetch` se si usa il permalink con `!vig=`, ad esempio
`https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2014-12-23;190!vig=`. Vale anche per i
singoli articoli (`...;435~art17!vig=`). Le pagine di dettaglio delle circolari INPS, invece, non lo
sono.

---

## Trattamento dei dati

L'unica credenziale richiesta è la chiave del modello:

- `DEEPSEEK_API_KEY` — **obbligatoria**;
- `SEARCH_API_KEY` — facoltativa, serve solo se si sceglie un provider di ricerca a chiave.

I segreti vanno configurati fra i *Secrets* del repository su GitHub e non sono mai versionati.

Ogni richiesta al provider del modello viene inviata con header espliciti di opt-out
(`X-Data-Opt-Out`, `X-Zero-Retention`, `X-Training-Opt-Out`), applicati in un unico punto
(`src/deepseek.ts`) perché nessun nuovo punto di chiamata possa dimenticarli. **Limite dichiarato:**
l'API pubblica del provider non documenta un parametro di mancata conservazione per singola
richiesta, quindi quegli header possono essere ignorati; il controllo effettivo è l'impostazione a
livello di account, da verificare quando si ottiene la chiave.

Al modello vengono inviati `regole.json`, `parametri.json` e il testo delle pagine pubbliche
consultate: sono dati pubblici e normativi, nessun dato personale.

Il sito non usa cookie, non carica risorse di terze parti e non ha sistemi di analisi delle visite.

---

## Pubblicare una copia propria

Il sito è statico. Serve un repository tuo, la cartella `public/` pubblicata con GitHub Pages, e il
secret `DEEPSEEK_API_KEY`. Il workflow trimestrale è già pronto e si occupa del resto.

---

## Come contribuire

Vedi [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Licenza

MIT — vedi [LICENSE](LICENSE).

---

## Sostieni il progetto

Se questo servizio ti è utile, puoi offrire un caffè per sostenerne la manutenzione:
<https://paypal.me/sequi>
