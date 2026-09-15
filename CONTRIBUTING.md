# Come contribuire

Grazie per l'interesse. Il modo più utile per contribuire è **segnalare un dato sbagliato**, perché
è esattamente il rischio che questo progetto cerca di ridurre.

## Segnalare una scadenza o un importo sbagliato

Apri una issue indicando **tre cose**. Senza tutte e tre la segnalazione non è verificabile e non
può essere applicata:

1. **La scadenza interessata** — il nome della regola (l'`id` in `regole.json`, per esempio
   `saldo_primo_acconto`), oppure la data e il profilo che risulta sbagliato.
2. **La data o il valore atteso** — che cosa dovrebbe esserci al posto di quello pubblicato.
3. **La fonte a supporto** — l'URL di una fonte istituzionale (Agenzia delle Entrate, INPS,
   Gazzetta Ufficiale, Normattiva) e **la frase copiata letteralmente** dalla pagina che dimostra il
   punto.

La frase letterale è richiesta perché il sistema applica le modifiche solo se l'estratto citato
compare davvero nella pagina indicata. Una segnalazione con estratto esatto può essere trasformata
in una modifica verificata; una senza estratto no.

Se puoi, controlla prima che la fonte sia leggibile: apri l'URL con `curl` o con uno strumento che
non esegua JavaScript. Le pagine delle circolari INPS, per esempio, sono rese via JavaScript e non
espongono contenuti a una semplice richiesta HTTP.

## Proporre una modifica ai dati

`regole.json` e `parametri.json` sono dati, quindi una modifica normativa è una pull request su un
file JSON. Prima di aprirla:

```bash
npm test
npm run verifica:estratti     # verifica ogni estratto pubblicato sulla sua fonte
npm run genera:offline        # deve produrre un diff coerente con la modifica
```

Alcune regole del progetto da rispettare:

- **Ogni valore normativo porta la sua fonte**, con URL e estratto letterale. Nessuna eccezione.
- **Se una fonte ufficiale non è leggibile automaticamente**, non inventarne una: dichiara
  `stato_verifica` con il valore appropriato (`fonte_primaria_non_leggibile` o `da_verificare`) e
  scrivi una `nota` che spieghi il problema. I dati in questo stato vengono elencati nella pagina
  pubblica come non confermati.
- **Se una norma cambia, non riscrivere la regola esistente per gli anni passati**: aggiungi una
  voce in `varianti_validita` con l'intervallo di anni a cui si applica. Il calendario di ogni anno
  deve citare la norma valida per quell'anno.
- **Non introdurre date nel codice.** Se serve un nuovo comportamento, si descrive come dato in
  `regole.json` e si estende il motore con un tipo di regola generico.
- **Le date non si estendono all'indietro.** I calendari coprono l'anno corrente e il successivo.

## Modificare il motore

La logica normativa (calcolo delle date, applicazione degli slittamenti, interpretazione di
`regole.json`) è commentata in italiano; il resto in inglese.

I test girano con il runner integrato di Node, senza dipendenze:

```bash
npm test
```

Un cambiamento al motore dovrebbe arrivare con un test che lo copre. Sono particolarmente
apprezzati i test che verificano i casi limite delle date: scadenze che cadono di sabato, di
domenica, in un giorno festivo, nel periodo di sospensione feriale, o a cavallo di fine anno.

## Stile

- Nessuna dipendenza esterna, se non strettamente necessaria: il progetto deve restare
  installabile ed eseguibile senza `npm install`.
- Node 24 o superiore.
- Interfaccia, documentazione e commenti normativi in italiano.
