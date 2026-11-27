# thuis

Boodschappen en acties voor twee personen, gesynchroniseerd via een gedeelde
OneDrive-map. Vierde app naast golf-score, trends en events.

De gedeelde afspraken voor alle apps staan in de repo
[apps-basis](https://github.com/mv-systems-apps/apps-basis): lees eerst
`conventies.md` en `README.md` daar. Het ontwerp van deze app staat in
`ontwerp.md`.

Stand (26 november 2026, versie 1352906-007): in gebruik. Werkt: aanmelden
bij Microsoft, de gedeelde map koppelen, synchroniseren via `thuis.json`
(lokale kopie, wachtrij, If-Match, dagbackup, backups terugzetten), vijf
tabbladen met vegen rondom:
- **Winkels**: favorieten en overige, notitie en link per winkel; per winkel de
  route (afdelingen op volgorde, verslepen) en per afdeling een eigen scherm met
  de artikelen, waar je artikelen uit deze of andere winkels hierheen haalt of
  nieuw maakt; "Afdeling?" bovenaan met de speld; een winkel zonder afdelingen
  krijgt artikelen en de eerste afdeling via "Artikel of afdeling".
- **Artikelen**: toevoegen, zoeken (ook op #tags en @winkel), filters (ook allemaal
  uit), op en van de lijst, aantal, notitie (ook meer regels; in lijsten één regel per notitie) en link (of zoekwoorden), leesstand vanaf Op de lijst, bewerkscherm,
  archief voor eenmalige artikelen, suggesties onder Op de lijst, lijstaantal (deze keer, met
  doorgestreept het normale aantal), recepten als kladblok met eigen ingrediënten (met notitie, getoond op de receptregel onder het artikel) (per ingrediënt op de
  lijst; aantallen opgeteld met "3 + 4 Lasagne" eronder). Tags zijn tikbaar in de band onder de titel
  van een recept of winkel.
- **Boodschappen**: winkelkeuze (Huidig, Nodig, Alternatief), per afdeling
  afvinken (tik of naar rechts vegen), hele notitie (naar links vegen; vegen werkt in alle lijsten), Elders,
  één winkelmand voor alle winkels (per telefoon), gedeelde Aankopen (per dag, met zoeken; tik of vegen:
  Opnieuw op de lijst of verwijderen, met Ongedaan maken).
- **Doen**: acties met periode en herhalen, filters Alles/Week/Maand/Kw./Jaar (standaard Alles),
  inklapbare groepen, afronden met 1,5 s om terug te tikken, Afgerond (opgeruimd na de ingestelde tijd) en Gedaan
  (alles wat afgerond is, ook herhalend; Opnieuw of verwijderen); met notitie of link eerst een leesstand (potlood = bewerken).
- **Instellingen**: synchroniseren, wekelijks terug op de lijst (standaard met de hand),
  weergave, Doen, Bewaren (aankopen, archief, afgeronde acties, logboek), backups, logboek.

Tests:
- `node thuis-tests.cjs` — kern (bestand, samenvoegen) en opbouw; `APP=<pad>` voor een andere versie
- `NODE_PATH=<map> node thuis-dom.cjs` — rooktest in jsdom met een gesimuleerde
  OneDrive (`npm i jsdom fake-indexeddb` in die map). Geen echte browser.
  `DEEL=doen` (of `DEEL=5z30,winkel`) draait alleen de delen met dat woord in hun nummer of titel.
  De recepten staan in losse delen (`DEEL=recepten`, of `5z44a` t/m `5z44e`), elk met een eigen beginsituatie (`receptStart`).
- `test-hulp.cjs` — korte regelopmaak met namen voor de testgegevens van de rooktest, omgezet naar en van thuis.json met id's (alleen voor de tests)
- `python3 mutaties.py` — sloopt de kern op bekende plekken; elke mutatie moet worden gevangen
- `python3 test-sw-iconen.py`, `test-sw-vorige-cache.py`, `test-sw-ontbrekend-bijbestand.py`, `test-sw-trage-404.py` — service worker in een echte browser (Playwright), gelijk aan die van de andere apps (conventies.md §3)
- `python3 test-opmaak.py` — opmaak in een echte browser: meldingen in beeld, plek van de tagkeuze, scrollpositie (editor, afdeling), keuzelijstje na scrollen, afdeling slepen met aanraken, tikvlakken, lange winkelnaam, notitie met meer regels (lijst 1, band alles), vegen in Boodschappen, niets vet in notities

Na elke wijziging aan de app ook:
`python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis`
