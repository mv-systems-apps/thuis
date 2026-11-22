# thuis

Boodschappen en acties voor twee personen, gesynchroniseerd via een gedeelde
OneDrive-map. Vierde app naast golf-score, trends en events.

De gedeelde afspraken voor alle apps staan in de repo
[apps-basis](https://github.com/mv-systems-apps/apps-basis): lees eerst
`conventies.md` en `README.md` daar. Het ontwerp van deze app staat in
`ontwerp.md`.

Stand: stap 7 van het bouwplan. Werkt: aanmelden, de gedeelde map koppelen,
synchroniseren met OneDrive via `thuis.json` (lokale kopie, wachtrij, If-Match, dagbackup) en het
boodschappenscherm (toevoegen, zoeken, filters, op en van de lijst) en de
tabblad Winkel (per artikel in welke winkels en waar het daar ligt, winkelkeuze met aantallen, afdelingen in looproute, afvinken, mandje dat bewaard blijft tot je het leegmaakt), vijf tabbladen (Winkels, Artikelen, Boodschappen, Doen, Instellingen) met vegen rondom; tabblad Winkels met afdelingen per winkel.

Tests:
- `node thuis-tests.cjs` — kern (bestand, samenvoegen) en opbouw; `APP=<pad>` voor een andere versie
- `NODE_PATH=<map> node thuis-dom.cjs` — rooktest in jsdom met een gesimuleerde
  OneDrive (`npm i jsdom fake-indexeddb` in die map). Geen echte browser.
- `test-hulp.cjs` — korte regelopmaak voor testgegevens, omgezet naar en van JSON (alleen voor de tests)
- `python3 mutaties.py` — sloopt de kern op bekende plekken; elke mutatie moet worden gevangen

Na elke wijziging aan de app ook:
`python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis`
