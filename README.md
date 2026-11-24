# thuis

Boodschappen en acties voor twee personen, gesynchroniseerd via een gedeelde
OneDrive-map. Vierde app naast golf-score, trends en events.

De gedeelde afspraken voor alle apps staan in de repo
[apps-basis](https://github.com/mv-systems-apps/apps-basis): lees eerst
`conventies.md` en `README.md` daar. Het ontwerp van deze app staat in
`ontwerp.md`.

Stand (24 november 2026, versie 1352904-003): in gebruik. Werkt: aanmelden
bij Microsoft, de gedeelde map koppelen, synchroniseren via `thuis.json`
(lokale kopie, wachtrij, If-Match, dagbackup, backups terugzetten), vijf
tabbladen met vegen rondom:
- **Winkels**: favorieten en overige, afdelingen per winkel in route,
  notitie en link per winkel.
- **Artikelen**: toevoegen, zoeken (ook op #tags), filters, op en van de lijst,
  aantal, notitie en link, bewerkscherm, archief voor eenmalige artikelen.
- **Boodschappen**: winkelkeuze (Huidig, Nodig, Kan ook), per afdeling
  afvinken, mandje per telefoon, gedeelde Aankopen (per dag, met zoeken).
- **Doen**: acties met periode en herhalen, filters Week/Maand/Kw./Jaar/Alles.
- **Instellingen**: synchroniseren, wekelijks terug op de lijst, archief,
  aankopen bewaren, standaard bij Doen, backups, logboek.

Tests:
- `node thuis-tests.cjs` — kern (bestand, samenvoegen) en opbouw; `APP=<pad>` voor een andere versie
- `NODE_PATH=<map> node thuis-dom.cjs` — rooktest in jsdom met een gesimuleerde
  OneDrive (`npm i jsdom fake-indexeddb` in die map). Geen echte browser.
  `DEEL=doen` (of `DEEL=5z30,winkel`) draait alleen de delen met dat woord in hun nummer of titel.
- `test-hulp.cjs` — korte regelopmaak met namen voor de testgegevens van de rooktest, omgezet naar en van thuis.json met id's (alleen voor de tests)
- `python3 mutaties.py` — sloopt de kern op bekende plekken; elke mutatie moet worden gevangen
- `python3 test-sw-iconen.py`, `test-sw-vorige-cache.py`, `test-sw-ontbrekend-bijbestand.py`, `test-sw-trage-404.py` — service worker in een echte browser (Playwright), gelijk aan die van de andere apps (conventies.md §3)

Na elke wijziging aan de app ook:
`python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis`
