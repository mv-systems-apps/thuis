# thuis

Boodschappen en acties voor twee personen, gesynchroniseerd via een gedeelde
OneDrive-map. Vierde app naast golf-score, trends en events.

De gedeelde afspraken voor alle apps staan in de repo
[apps-basis](https://github.com/mv-systems-apps/apps-basis): lees eerst
`conventies.md` en `README.md` daar. Het ontwerp van deze app staat in
`ontwerp.md`.

Stand: app-shell (stap 2 van het bouwplan): indeling met tabbladen, aanmelden
bij Microsoft, de gedeelde map koppelen via een deellink en de melding bij een
nieuwe versie. De lijsten zelf volgen in de volgende stappen.

Tests: `node thuis-tests.cjs` (met `APP=<pad>` een andere versie controleren).
Na elke wijziging aan de app ook:
`python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis`
