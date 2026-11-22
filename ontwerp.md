# thuis — ontwerp

Vierde app naast golf-score, trends en events. Boodschappen en acties voor twee
personen (Mark en zijn vrouw), elk op een eigen Android-telefoon (Edge of Chrome,
als PWA op het beginscherm). Vervangt Microsoft To Do.

Status: ontwerp na review (21-11-2026). Mockups: het canvas "thuis – mockup
boodschappen" in claude.ai. Er is nog geen code.

Volgt `apps-basis/conventies.md`, behalve waar §9 een bewuste afwijking noemt.

---

## 1. Uitgangspunten

- Aantrekkelijk, praktisch, eenvoudig te bedienen, met één hand.
- Snel: één keer inlezen, één keer verwerken, alleen tekenen wat zichtbaar is.
- Gegevens in jullie eigen OneDrive, in één tekstbestand dat met een editor te
  lezen en te bewerken is.
- Synchroniseren gaat ongemerkt. Een vertraging van een halve minuut is
  geen probleem.
- Geen meldingen of herinneringen: een datum is een rustige markering.
- Bewust niet: subtaken, delen met anderen dan jullie twee, overzetten uit To Do.

## 2. Architectuur

### 2.1 App
Eén `thuis.html` met een eigen service worker `sw-thuis.js` (cache-prefix
`thuis-`), `manifest.json`, `icon.svg`, `index.html`, `update_cache_version.py`
en een versiestempel onderaan Instellingen, volgens conventies §3. Geen externe
scripts; de app gebruikt het systeemlettertype.

### 2.2 Lokaal eerst, met een wachtrij
- De app werkt altijd op een lokale kopie in IndexedDB, ook zonder netwerk en
  zonder geldige aanmelding.
- Elke wijziging is een **handeling** (zie §4) in een wachtrij in IndexedDB.
  De handeling wordt meteen lokaal toegepast en na 1 à 2 seconden rust gebundeld
  verstuurd.
- `navigator.locks` voorkomt dat twee vensters (de PWA en een browsertab)
  tegelijk de wachtrij versturen.

### 2.3 OneDrive
- **Aanmelden:** een eigen, kleine PKCE-flow tegen Microsoft (geen MSAL), met
  een app-registratie voor persoonlijke accounts. Redirect-URI is de GitHub
  Pages-URL. Scope: `Files.ReadWrite.All offline_access`.
- **Grens van 24 uur:** een webapp mag een aanmelding maar 24 uur vernieuwen.
  Daarom meldt de app bij het openen opnieuw aan als die grens nadert en er
  netwerk is (meestal zonder invoer: alleen even naar Microsoft en terug).
  Verlopen is nooit een blokkade: er verschijnt een rustige balk "Opnieuw
  aanmelden" en de wachtrij wacht.
- **De gedeelde map:** Mark maakt de map `thuis` en in de app een deellink.
  Zijn vrouw opent die link één keer; haar app zet hem om via
  `GET /shares/u!{base64url}/driveItem` naar driveId en itemId en bewaart die
  lokaal. Daarna altijd `/drives/{driveId}/items/{id}`. (`sharedWithMe` werkt
  sinds november 2026 niet meer.) Bij 403 of 404 meldt de app "geen toegang
  meer tot de gedeelde map", met de weg terug.
- **Lezen:** eerst alleen de metadata (`$select=eTag,cTag,size`). Pas bij een
  andere eTag wordt de inhoud gedownload.
- **Schrijven:** `PUT …/content` met `If-Match: <eTag>`. Bij 412 opnieuw
  lezen, de wachtrij opnieuw toepassen en opnieuw schrijven.
- **Verversen:** op het tabblad Winkel elke 30 s, elders elke 3 minuten, en bij
  openen of terugkeren uit de achtergrond. Alleen als de app in beeld is.
- **Netwerkgrenzen:** 10 s per verzoek, zoals in de andere apps.
- **De service worker** laat verzoeken naar Microsoft (andere origin) ongemoeid.

### 2.4 Server (niet nu)
In eerste instantie zonder server. Blijkt het dagelijks opnieuw aanmelden in de
praktijk hinderlijk, dan komt er een kleine token-server (bijvoorbeeld een
Cloudflare Worker, ~50 regels, bewaart niets). Die laat de aanmelding 90 dagen
meegaan. Nadeel: het geheim van de registratie verloopt na hooguit 2 jaar. De
app waarschuwt dan ruim van tevoren, met de stappen. De rest van de app hoeft
daarvoor niet te veranderen.

## 3. Bestand

Eén bestand `thuis.txt` in de gedeelde map, plus een dagbackup en een submap
`fotos/`.

- UTF-8; een bestand dat geen geldige UTF-8 is, wordt niet gelezen en nooit
  overschreven. Een BOM gaat eruit (zoals trends; geen ander programma leest
  het bestand mee). CRLF/LF en het slotregeleinde blijven zoals ze waren.
- Eén regel per record, velden gescheiden door `;`.
- Vast zijn alleen het eerste veld (het soortwoord) en het tweede (de naam).
  Al het andere is `naam=waarde`, gesplitst op de eerste `=`. Wat leeg is,
  staat er niet.
- Lijsten binnen een waarde scheidt `|`.
- `;` en `|` mogen in geen enkel tekstveld voorkomen. Bij invoer worden ze een
  komma of spatie; in een link worden ze gecodeerd (`%3B`, `%7C`).
- De naam is de sleutel, uniek per soort record (een artikel en een actie mogen
  dezelfde naam hebben). Namen vergelijkt de app na normaliseren: trim,
  meervoudige spaties samenvoegen, NFC, hoofdletterongevoelig.
- De app schrijft de regels in een vaste volgorde (soortwoord, dan naam), zodat
  verschillen klein en leesbaar blijven.
- Onbekende regels en velden schrijft de app ongewijzigd terug.

```
instelling;personen;namen=Mark|Partner
instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-21T06:00
afdeling;Groente & fruit
afdeling;Zuivel & eieren
winkel;Albert Heijn;route=Groente & fruit|Brood|Zuivel & eieren
winkel;Lidl;route=Groente & fruit|Zuivel & eieren
artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit|Lidl:Groente & fruit;op=2026-11-21T06:00;gekocht=2026-11-07|2026-11-14
artikel;Hummus;soort=eenmalig;ligt=Lidl:Zuivel & eieren;op=2026-11-20T18:12;opdoor=Partner
artikel;Koffie;soort=regelmatig;niet=Gamma;gekocht=2026-09-12|2026-10-03|2026-10-24
actie;Filter afzuigkap vervangen;datum=2026-11-19;herhaal=maand
actie;Dakgoot laten reinigen;datum=2027-K1;herhaal=jaar
actie;Fietsband plakken;wie=Mark
actie;Fotolijst ophangen;foto=k7f2q.jpg
actie;Pakket ophalen;klaar=2026-11-20;door=Mark
hernoemd;artikel;Koffie;nieuw=Koffiebonen;op=2026-11-21
```

| woord | betekenis | velden |
|---|---|---|
| `instelling` | instelling voor beide | `personen`: `namen`; `wekelijks`: `dag`, `tijd`, `teruggezet` |
| `afdeling` | gedeelde afdeling | — |
| `winkel` | winkel | `route`: de afdelingen in looproute; een afdeling die er niet in staat, heeft die winkel niet |
| `artikel` | boodschap | `soort` (wekelijks, regelmatig, eenmalig), `ligt` (waar te koop: `winkel:afdeling` of alleen `winkel`, met `|` ertussen; leeg = overal), `niet` (winkels waar het niet te koop is), `afd` en `winkel` (oud, worden nog gelezen), `op` (sinds wanneer op de lijst; afwezig = niet op de lijst), `opdoor`, `gekocht` (laatste zes) |
| `actie` | taak | `datum`, `herhaal` (week, maand, kwartaal, jaar), `wie`, `notitie`, `link`, `foto`, `klaar`, `door` |
| `hernoemd` | spoor van een hernoeming, 30 dagen | soort record, oude naam, `nieuw`, `op` |

Datums: dag `2026-11-19`, maand `2026-12`, kwartaal `2027-K1`, jaar `2027`;
tijdstippen `2026-11-21T10:12` in lokale tijd (Europe/Amsterdam).

Opruimen door de app: afgeronde acties na 3 maanden; `hernoemd` na 30 dagen;
eenmalige artikelen die 12 maanden niet op de lijst stonden.

## 4. Samenvoegen

- Een **handeling** beschrijft één veldwijziging: record, veld, oude waarde,
  nieuwe waarde, tijdstip en wie. Daarnaast toevoegen en verwijderen.
- Toepassen op de nieuwste versie van het bestand:
  - staat er in het bestand de oude waarde, dan wordt het de nieuwe;
  - staat er al de nieuwe waarde (jullie deden hetzelfde), dan gebeurt er niets;
  - staat er iets anders, dan is het een **botsing**.
- **Botsingen:**
  - op of van de lijst: de laatste handeling wint (op tijdstip);
  - tekstvelden (naam, notitie, link): de laatste wint, met achteraf een rustige
    melding boven de lijst, met "andere versie terugzetten". Nooit een venster
    in de winkel.
- **Een record dat niet meer bestaat:** de handeling vervalt, met een melding.
  Alleen "toevoegen" maakt iets aan. Een verwijderd artikel komt dus niet
  ongemerkt terug.
- **Hernoemen:** de app herschrijft alle verwijzingen (afdeling in artikelen en
  routes, winkel in artikelen) en laat een regel `hernoemd` achter. Handelingen
  met de oude naam worden via die regel naar de nieuwe geleid.
- **Wekelijks terugzetten** is geen handeling in de wachtrij. Elke telefoon
  berekent het bij het lezen: is `teruggezet` ouder dan de laatste dag/tijd uit
  de instelling, dan gaan de wekelijkse artikelen die sindsdien niet gekocht
  zijn op de lijst, en wordt `teruggezet` bijgewerkt. Zo zet een telefoon die
  offline was, net gekochte bananen niet opnieuw op de lijst.
- **Een afgeronde actie opnieuw invoeren** (dezelfde naam) heropent die actie.

## 5. Schermen

Layout volgens de conventies: vaste kop, scrollend midden, vaste tabbalk. De
kop heeft een kleurverloop van kobalt naar paars, met rechts het sync-wolkje.
Tabbalk met alleen iconen, vier tabbladen: **Lijst** (klembord met lijst),
**Winkel** (winkelwagen), **Doen** (vinkvak) en **Instellingen** (tandwiel uit
events). Wisselen kan ook door te vegen, rondom (Lijst → Winkel → Doen →
Instellingen → Lijst, en terug); niet vanaf de rand van het scherm (terug-gebaar
van Android), niet tijdens typen en niet in een menu of keuzelijst.
Kleur per soort: wekelijks kobalt (een 7 in een cirkel), regelmatig turquoise
(voorraaddoos), eenmalig paars (vakje met een 1). Rechte hoeken; tekst nooit
kleiner dan 17 px; knoppen minstens 44 px.

Maten: het rondje (op/van de lijst, afvinken) is overal 28 px en krimpt nooit;
het gevulde rondje is even groot als de buitenkant van het open rondje (lijn
meegerekend). Soorticoon en iconen 24 px, lijndikte 2. Een icoonknop is een
vierkant van 44 px met een lichte tint en zonder rand (licht paars, zoals
"Waar ligt dit?"; amber alleen voor "Mandje leegmaken"). Een lange naam loopt door naar een volgende regel.

### 5.1 Boodschappen
- Invoervak "Zoeken of toevoegen" (placeholder "Artikel"). Links een
  soortknop met menu, standaard eenmalig; rechts een +. Typen zoekt in alle
  artikelen ("Gevonden"). Een + op een bestaand artikel zet dat op de lijst.
- Tijdens het typen verdwijnen de onderbalken, zodat er ruimte is voor de
  resultaten.
- Filterknoppen (icoon + aantal): Op de lijst, Eenmalig, Wekelijks,
  Regelmatig, Suggesties (lampje). Overal geldt de volgorde eenmalig,
  wekelijks, regelmatig. Suggesties: artikelen die langer geleden
  gekocht zijn dan gewoonlijk (minstens 3 aankopen nodig). Zonder historie
  staat er uitleg.
- Per regel: links het soorticoon (alleen weergave), de naam, rechts het
  rondje voor op of van de lijst. Tik op de naam opent het bewerkscherm; daar
  wissel je de soort. Een artikel dat alleen in bepaalde winkels ligt, krijgt
  een klein winkelsymbool.
- Geen knop "Naar de winkel": de winkel is een eigen tabblad.

### 5.2 Winkel (tabblad)
- Per artikel leg je vast in welke winkels het te koop is, en per winkel in
  welke afdeling het daar ligt (`ligt=`). Geen winkels = overal te koop, behalve
  bij de winkels in `niet=`. Een winkelnaam bevat geen `:`.
- Bovenin de winkelnaam; een tik opent de keuzelijst "Waar ga je heen?": de
  winkels waar je iets van de lijst kunt halen (alleen wat bij die winkel is
  vastgelegd telt), met het aantal, meeste eerst, bij gelijk aantal de laatst
  gekozen bovenaan; bij een of twee artikelen staan ze eronder. Winkels met 0
  staan er niet in; ingeklapt "Alle winkels". Kruisje rechtsboven; onderaan
  "Zoeken of toevoegen" (placeholder "Winkel", + voegt toe). De laatste keuze
  geldt per telefoon. Winkels beheren komt bij Instellingen (stap 9).
  Daaronder de voortgangsbalk met "2 van 8".
- Bovenaan, zonder kopje: wat in deze winkel nog geen afdeling heeft, met de
  icoonknop "Waar ligt dit?" (kaartspeld, licht paars). Die vraagt naar de
  afdelingen van déze winkel (looproute; andere afdelingen ingeklapt; zoeken of
  toevoegen onderaan) en heeft de regel "Niet te koop bij <winkel>". Kiezen
  legt vast: te koop hier, in die afdeling; een nieuwe afdeling komt achteraan
  de route.
- Daarna de afdelingen in looproute.
- Elke vink is direct een handeling (van de lijst, aankoopdatum erbij). Het
  item blijft 1,5 s grijs op zijn plek en schuift dan naar "In het mandje".
  Terugtikken zet het terug en haalt de aankoopdatum weg.
- "Niet bij <winkel>": artikelen die hier niet te koop zijn, ingeklapt
  en grijs, wel af te vinken.
- Het mandje blijft staan tot je het leegmaakt: rechts naast het kopje "In het
  mandje" staat een icoonknop (mandje met kruis, "Mandje leegmaken"). Het mandje hoort bij de telefoon (niet in
  thuis.txt) en blijft bewaard als de app sluit. Leegmaken haalt alleen het
  groepje uit beeld; de aankoopdatums blijven. Er is geen "Klaar". Later
  eventueel een instelling "na x dagen vanzelf leeg".
- Geen toevoegen op dit tabblad: dat gaat via Lijst.
- Een artikel dat de ander net toevoegde, krijgt een paar minuten "nieuw".
- Verversen elke 30 s zolang dit tabblad open is.

### 5.3 Doen
- Invoervak "Zoeken of toevoegen" (placeholder "Actie").
- Filter Alle / Voor mij; Voor mij is uitgeschakeld als geen actie aan jou is
  toegewezen.
- Groepen: Te laat, Deze week, Later, Zonder datum. Een actie zonder datum en
  zonder extra's is één regel.
- Links het rondje om af te ronden; tik op de titel opent het bewerkscherm.
- Onderaan "Afgerond" met aantal; het Afgerond-scherm toont wie het deed en
  wanneer, met heropenen.

### 5.4 Bewerken
- **Artikel:** naam, soort, afdeling, te koop bij (vinkjes per winkel; niets
  uitgevinkt = overal), op de lijst, gekocht (gebruikelijk interval en de
  laatste datums), verwijderen.
- **Actie:** titel, wanneer (geen, dag, maand, kwartaal, jaar, met bladeren),
  herhalen, wie (Mark of partner; niets gekozen = voor wie het oppakt), notitie, link (met openen), foto,
  verwijderen.
- Onderaan [Annuleren] [Opslaan].

### 5.5 Instellingen
- Winkels (lijst, per winkel naam en looproute met slepen én ↑/↓, vinkjes voor
  welke afdelingen er zijn).
- Afdelingen (gedeeld; hernoemen geldt overal; aantal artikelen).
- Wekelijks terug op (dag en tijd).
- Synchroniseren: zie 5.6.
- Versiestempel onderaan.

### 5.6 Sync-overzicht (tik op het wolkje)
- Toestand: bijgewerkt (tijd), bezig, offline met n wachtende wijzigingen,
  opnieuw aanmelden nodig, geen toegang tot de gedeelde map.
- Nu synchroniseren, opnieuw aanmelden, afmelden.
- Ingelogd als, "Ik ben", gedeelde map, deellink maken (alleen bij de maker).
- Backups: lijst met datum en aantal regels, met herstellen.

### 5.7 Eerste start
- **Mark:** aanmelden → nieuwe lijst maken (map `thuis` met standaardafdelingen) → "Ik ben" → deellink maken.
- **Zijn vrouw:** deellink openen → aanmelden → "Ik ben".
- "Plakken als lijst": één artikel per regel, als eenmalig op de lijst.

### 5.8 Meldingen en ongedaan maken
- Volgens de gedeelde conventies: één melding per regel met de knoppen eronder,
  en een melding verdwijnt niet vanzelf.
- Na verwijderen, afronden of soort wisselen staat er een melding met
  "Ongedaan maken" en een ✕. Die blijft tot de volgende handeling of tot je hem
  wegtikt. (De review stelde 5 s voor; dat botst met de conventie.) Ongedaan
  maken is een nieuwe handeling, dus het werkt ook na synchroniseren.

## 6. Datums en herhalen

- Deze week = maandag tot en met zondag van de huidige week.
- Een maand, kwartaal of jaar is te laat na afloop van die periode.
- Herhalen rekent vanaf de vervaldatum; een datum die al voorbij is, wordt
  overgeslagen tot de eerstvolgende in de toekomst. Herhalen zonder datum kan
  niet.
- Bij een herhalende actie onthoudt `klaar=` de laatste keer.

## 7. Backup en herstel

- Dagbackup `thuis_backup_<jjjjmmdd>.txt`, gemaakt met
  `conflictBehavior=fail`, zodat maar één telefoon hem maakt.
- Bewaren: 14 dagen plus de eerste van elke maand.
- Is een nieuwe dagbackup veel kleiner dan de vorige (leeg, of van 10 of meer
  naar minder dan de helft), dan gaat de vorige eerst naar
  `thuis_backup_groot.txt`.
- Een `thuis.txt` die er was en nu weg is, wordt niet stil opnieuw gemaakt.
- Herstellen gaat via het sync-overzicht.

## 8. Foto's
Verkleind tot ±1600 px JPEG voordat ze worden opgeslagen, onder een vrije naam
in `fotos/` (niet afgeleid van de titel). Kleine voorbeeldjes worden bewaard in
IndexedDB voor offline gebruik. Bij verwijderen ruimt de app de foto op.

## 9. Bewuste afwijkingen van conventies.md (op te nemen in §4)

- Gegevens gaan naar de eigen OneDrive: netwerk en aanmelden.
- De app voegt wijzigingen van twee personen samen (events doet dat bewust
  niet).
- Lokaal eerst met een wachtrij, in plaats van "de tabel is het bestand".
- Toevoegen op een bestaande naam zet het bestaande artikel op de lijst, of
  heropent een afgeronde actie (events ontdubbelt bewust niet).
- Een soorticoon per rij.
- ISO-datums in plaats van de D-sleutel: geen andere app leest dit bestand.
- Drie accentkleuren met een kleurverloop in plaats van één kleur per app.

Ook: aanvullen in `maak_zips.py`, `README.md` en `nieuwe-chat.txt`, en
controleren of `check_app.py` de app herkent. Token, wachtrij, "Ik ben", de
laatste winkel en de koppeling met de map horen in de reset.

## 10. Performance

- Eén keer parsen naar een Map op genormaliseerde naam.
- Na verversen alleen opnieuw tekenen als de eTag veranderde.
- Alleen de gefilterde, zichtbare lijst tekenen.
- Zoeken op een vooraf genormaliseerd veld.
- Het interval voor suggesties alleen herberekenen bij een nieuwe aankoop.
- Schrijfacties bundelen.

## 11. Risico's en de proef

Het grootste risico is het aanmelden in een geïnstalleerde PWA op Edge en
Android: komt de redirect van Microsoft terug in de app, en niet in een losse
browsertab? Daarom is stap 1 van de bouw een proef: aanmelden, de gedeelde map
via een deellink openen, een bestand lezen en met If-Match schrijven (en
controleren dat er 412 komt bij een tussentijdse wijziging), op Marks telefoon.
Pas daarna wordt de rest gebouwd.
