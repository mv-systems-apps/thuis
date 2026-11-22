# thuis

Boodschappen en acties voor twee personen, gesynchroniseerd via een gedeelde
OneDrive-map. Vierde app naast golf-score, trends en events.

De gedeelde afspraken voor alle apps staan in de repo
[apps-basis](https://github.com/mv-systems-apps/apps-basis): lees eerst
`conventies.md` en `README.md` daar. Het ontwerp van deze app staat in
`ontwerp.md`.

Stand (november 2026): boodschappen compleet. Werkt: aanmelden bij Microsoft,
de gedeelde map koppelen, synchroniseren via `thuis.json` (lokale kopie,
wachtrij, If-Match, dagbackup, backups terugzetten), vijf tabbladen met vegen
rondom:
- **Winkels**: favorieten en overige, afdelingen per winkel in looproute.
- **Artikelen**: toevoegen, zoeken, filters, op en van de lijst, aantal en
  notitie, bewerkscherm, archief voor eenmalige artikelen.
- **Boodschappen**: winkelkeuze (Nodig, Kan ook), per afdeling afvinken, mandje
  per winkel.
- **Doen**: nog te bouwen.
- **Instellingen**: wekelijks terug op de lijst, archief, backups.

Tests:
- `node thuis-tests.cjs` — kern (bestand, samenvoegen) en opbouw; `APP=<pad>` voor een andere versie
- `NODE_PATH=<map> node thuis-dom.cjs` — rooktest in jsdom met een gesimuleerde
  OneDrive (`npm i jsdom fake-indexeddb` in die map). Geen echte browser.
- `test-hulp.cjs` — korte regelopmaak met namen voor de testgegevens van de rooktest, omgezet naar en van thuis.json met id's (alleen voor de tests)
- `python3 mutaties.py` — sloopt de kern op bekende plekken; elke mutatie moet worden gevangen

Na elke wijziging aan de app ook:
`python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis`
