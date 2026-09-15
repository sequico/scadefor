# regole.json.storico

Questa cartella contiene gli snapshot di `regole.json` salvati **prima** di ogni modifica
automatica applicata dalla verifica trimestrale. Un file per run che ha cambiato qualcosa, con nome
`<timestamp ISO>.json`.

Ogni snapshot contiene lo stato precedente più un blocco `_meta` che descrive la run: istante,
regole modificate, proroghe applicate e modello utilizzato. Serve a rendere ricostruibile "cosa
diceva il sistema prima" anche in un flusso interamente automatico, e alimenta la sezione "Proroghe
rilevate" della pagina pubblica.

Se una run non modifica nulla, non viene salvato alcuno snapshot.

I file di questa cartella non vanno modificati a mano: sono un registro.
