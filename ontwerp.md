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

Eén bestand `thuis.json` in de gedeelde map, plus dagbackups
(`thuis_backup_JJJJMMDD.json`) en een submap `fotos/`. Niet bedoeld om met de
hand te bewerken.

- UTF-8, geldige JSON, en de opbouw hieronder. Klopt een van die drie niet,
  dan leest de app het bestand niet en schrijft hij er nooit in; hij werkt
  verder op de laatste goede kopie op de telefoon, met een melding. Een BOM
  gaat eruit.
- `versie`: datum en tijd van de laatste formaatwijziging in hex, zoals het
  versiestempel (`1352902-459` = 22-11-2026 11:13). Nieuwer dan de app kent:
  niets schrijven, melding om bij te werken. Ouder of ontbrekend: niet lezen
  (geen omzetting van oude formaten).
- **Vaste id's.** Winkels, afdelingen, artikelen en acties hebben een id van
  vijf willekeurige tekens (kleine letters en cijfers zonder 0 o 1 l i; via
  `crypto.getRandomValues`, uniek binnen het bestand). De naam is een gewoon
  veld: hernoemen verandert alleen de naam, verwijzingen blijven kloppen. Er
  is geen hernoem-spoor meer.
- Afdelingen horen bij één winkel, als lijst op volgorde (de looproute).
- De app schrijft één record per regel, op naam; wat leeg is, staat er niet.
  Onbekende delen en velden blijven bewaard (een oudere app op de andere
  telefoon gooit niets weg). Namen mogen elk teken bevatten.
- Onschuldige afwijkingen zet de app stil recht en logt ze (sync-overzicht,
  stap 9): een plek in een verwijderde winkel valt weg, een verwijderde
  afdeling wordt "onbekend".

```json
{
"versie": "1352902-459",
"instellingen": {
 "wekelijks": {"dag":"za","tijd":"06:00","teruggezet":"2026-11-21T06:00"},
 "archief": {"bewaren":"1m"}
},
"winkels": {
 "k7f2q": {"naam":"Albert Heijn","afdelingen":[{"id":"a3xm9","naam":"Groente & fruit"},{"id":"z8pd4","naam":"Zuivel"}]},
 "p4hw2": {"naam":"Plus","afdelingen":[{"id":"c2nt7","naam":"Koeling"}]}
},
"artikelen": {
 "e5gk8": {"naam":"Cadeau voor Eva","soort":"eenmalig","op":"2026-11-22T09:12"},
 "m9rb3": {"naam":"Melk","soort":"wekelijks","ligt":{"k7f2q":"z8pd4","p4hw2":"c2nt7"},"op":"2026-11-22T10:04","opdoor":"Mark","gekocht":["2026-11-08","2026-11-15"]}
},
"acties": {
 "f6jq2": {"naam":"Filter afzuigkap vervangen","datum":"2026-11-19","herhaal":"maand"}
}
}
```

| deel | velden |
|---|---|
| `instellingen` | `wekelijks`: `dag`, `tijd`, `teruggezet`; later `personen` |
| `winkels` | `naam`; `afdelingen`: lijst van `{id, naam}` in looproute |
| `artikelen` | `naam`; `soort` (eenmalig, wekelijks, regelmatig); `aantal` ("2" t/m "99"; zonder = 1, blijft staan na het kopen); `notitie` (vrije tekst, blijft staan); `link` (alleen https, zonder naam of wachtwoord, met een echte domeinnaam; getoond als het domein met ↗); `ligt` (winkel-id → afdeling-id; `""` = te koop daar, afdeling onbekend; geen `ligt` = nog nergens vastgelegd, staat in elke winkel bovenaan); `op` (sinds wanneer op de lijst); `opdoor`; `weg` (dag dat een eenmalig artikel van de lijst ging, voor wat nooit gekocht is); `gekocht` (laatste zes datums) |
| `acties` | `naam`, `datum`, `herhaal` (week, maand, kwartaal, jaar), `wie`, `notitie`, `link`, `foto`, `klaar`, `door` |

Datums: dag `2026-11-19`, maand `2026-12`, kwartaal `2027-K1`, jaar `2027`;
tijdstippen `2026-11-21T10:12` in lokale tijd (Europe/Amsterdam).

Opruimen door de app: afgeronde acties na 3 maanden; eenmalige artikelen in
het archief (niet op de lijst) die de ingestelde tijd niet gekocht zijn
(`instellingen.archief.bewaren`: `1w`, `1m` standaard, `3m`, `1j`; de laatste
dag is de laatste aankoop of `weg`; zonder datum blijft een artikel staan).

## 4. Samenvoegen

- Een **handeling** verwijst met een id naar wat ze raakt: aanmaken, een veld
  zetten (met oude en nieuwe waarde), verwijderen, ongedaan maken, gekocht of
  niet, plaatsen (artikel in winkel/afdeling), en voor een winkel: afdeling
  erbij, hernoemen, weghalen en volgorde.
- Toepassen op de nieuwste versie van het bestand:
  - staat er de oude waarde, dan wordt het de nieuwe;
  - staat er al de nieuwe waarde (jullie deden hetzelfde), dan gebeurt er niets;
  - staat er iets anders, dan is het een **botsing**: de laatste wint; bij
    tekst met een rustige melding en "Andere terugzetten". Op of van de lijst:
    zonder melding.
- **Iets wat niet meer bestaat:** de handeling vervalt, met een melding. Een
  verwijderd artikel komt dus niet ongemerkt terug. Een naam die al bestaat
  (hernoemen) vervalt ook.
- **Twee keer hetzelfde aangemaakt** (jullie voegen offline allebei "Melk"
  toe, of dezelfde afdeling): de tweede gaat op in de eerste. De telefoon die
  dat merkt, zet in zijn wachtrij, mandje, favorieten en gekozen winkel de
  nieuwe id om naar de bestaande.
- **Verwijderen** gebeurt meteen, via de wachtrij. "Ongedaan maken" (6 s, met een aftellend balkje in de knop; zolang
  de melding staat) zet het terug met dezelfde id, inclusief de plekken van de
  artikelen.
- **Volgorde van afdelingen:** wat de ander intussen toevoegde, komt achteraan;
  wat hij weghaalde, blijft weg.
- **Wekelijks terugzetten** is geen handeling in de wachtrij. Elke telefoon
  berekent het bij het lezen: is `teruggezet` ouder dan de laatste dag/tijd uit
  de instelling, dan gaan de wekelijkse artikelen die sindsdien niet gekocht
  zijn op de lijst, en wordt `teruggezet` bijgewerkt. Zo zet een telefoon die
  offline was, net gekochte bananen niet opnieuw op de lijst.
- Acties (Doen, stap 8): een afgeronde actie opnieuw invoeren heropent hem —
  bij het bouwen van Doen uitwerken.

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
  Regelmatig, Suggesties (lampje). Eenmalig toont (en telt) alleen wat op de
  lijst staat; gekocht of van de lijst gehaald gaat een eenmalig artikel naar
  het "Archief" eronder (ingeklapt, nieuwste eerst, grijs, met "gekocht 19 nov"
  of "van de lijst 14 jul"; de + zet het terug). Zoeken vindt ook het archief.
  Elke lijst heeft een kopbalk (lichtpaars, paarse titel, rechts het aantal).
  Overal geldt de volgorde eenmalig,
  wekelijks, regelmatig. Suggesties: artikelen die langer geleden
  gekocht zijn dan gewoonlijk (minstens 3 aankopen nodig). Zonder historie
  staat er uitleg.
- Aantal: tik op het soorticoon (of op "2×") en onder de regel klapt de teller
  open (Aantal − n +, minimaal 1). Bij meer dan 1 staat "2×" achter de naam, ook
  in Boodschappen. Het aantal blijft staan na het kopen.
- Link: apart veld onder Notitie (type url, "https://…"). Zonder https:// komt
  dat er vanzelf voor; http, javascript, data, een naam of wachtwoord erin of
  geen echte domeinnaam: geweigerd met "Alleen links met https:// zijn
  toegestaan." In de lijsten "ah.nl ↗" achter de notitie; een tik opent een
  nieuw tabblad (noopener, noreferrer). Ook bij het tonen opnieuw gecontroleerd.
- Notitie: in het bewerkscherm onder Naam. In de lijsten paars onder de
  winkels (zelfde letter), in Boodschappen onder de naam. Blijft staan.
- Per regel: links het soorticoon (knop voor het aantal), de naam, rechts het
  rondje voor op of van de lijst. Tik op de naam opent het bewerkscherm; daar
  wissel je de soort. Een artikel dat alleen in bepaalde winkels ligt, krijgt
  onder de naam een grijs regeltje met die winkels ("Albert Heijn · Plus");
  zo ook onder "Niet bij <winkel>" in Boodschappen. Een getal rechts in een
  kop zegt altijd waarvan: "6 artikelen", "2 winkels", "3 afdelingen". Wat de ander op de lijst zette, krijgt "nieuw" tot
  je het gezien hebt (in beeld op Artikelen of Boodschappen en dat scherm
  verlaten); per telefoon bewaard, niet in het bestand.
- Geen knop "Naar de winkel": de winkel is een eigen tabblad.

### 5.0 Tabbladen
Winkels, Artikelen, Boodschappen, Doen, Instellingen (alleen iconen, vegen
rondom). De app opent op Artikelen. Invoervakken staan onderaan, boven de
tabbalk; het toetsenbord komt pas na een tik. Geen uitlegteksten in schermen.

### 5.1b Winkels (tabblad)
- Favorieten en Overige, inklapbaar, alfabetisch; favorieten per telefoon.
  Onderaan "Winkel": typen filtert, + voegt toe (of opent de bestaande).
- Eén winkel: terug, naam, ster (favoriet), potlood (Winkel bewerken: naam,
  prullenbak links van Opslaan). Afdelingen horen bij deze winkel alleen
  (de route, op volgorde): greep vooraan om te verslepen; tik op de naam
  opent Afdeling bewerken (geen potloodje, net als bij artikelen). Onderaan "Afdeling".
  Hernoemen gaat mee in `ligt=`; weghalen laat het artikel te koop in die
  winkel zonder afdeling. Verwijderen meteen, 6 s Ongedaan maken.
- Artikelen koppelen gebeurt hier niet, maar bij het artikel (stap 8).

### 5.2 Winkel (tabblad)
- Per artikel leg je vast in welke winkels het te koop is, en per winkel in
  welke afdeling het daar ligt (`ligt`).
- Van boven naar beneden: "Boodschappen" met de voortgang van de hele lijst
  ("1 van 7 artikelen"; wat in een van de mandjes ligt telt als gehaald);
  "Zonder winkel" (kaart met een grijze kop en een doorgestreept winkeltje;
  per artikel een winkelicoon dat vraagt bij welke winkel het te koop is,
  zoeken of toevoegen; het komt daar onder "Afdeling onbekend" met de speld,
  zonder meteen naar de afdeling te vragen); de gekozen winkel als één kaart
  (kop gevuld paars met winkelicoon en de winkelkeuze, rechts "4 artikelen", dan "Afdeling onbekend" met de speld en de afdelingen
  in looproute); los en grijs "Niet bij <winkel>" en "In het mandje".
- Heeft een winkel geen afdelingen, dan staan de artikelen zonder kop in de
  winkelkaart en vraagt de app nergens naar een afdeling (ook niet in het
  bewerkscherm). Afdelingen maak je in de Winkels-tab.
- Bovenin de winkelnaam; een tik opent de keuzelijst "Waar ga je heen?" met
  gelijke koppen (paars op lichtpaars, rechts het aantal winkels): "Nodig"
  (winkels met iets dat nergens anders te koop is; onder de naam die
  artikelen op één regel, afgekapt met "…", en grijs "+n" voor wat ook elders
  kan), "Kan ook" (alles ook elders; geen namen, rechts het aantal; ingeklapt; is er niets nodig, dan heet die groep "Te koop bij" en staat hij open); alle winkels vet met een
  paars icoon en ingeklapt "Overige winkels". De
  gekozen winkel heeft een lichtpaarse regel met een paarse streep links.
  Alleen wat bij een winkel is vastgelegd telt, met het aantal; binnen elke
  groep alfabetisch (de volgorde van je route hangt niet van de lijst af); bij een of twee artikelen staan ze eronder. Rechts "2
  artikelen". Winkels met 0 staan er niet in; ingeklapt "Overige winkels"
  (alleen wat er niet al boven staat, rechts "2 winkels"). Kruisje rechtsboven; onderaan
  een zoekvak zonder kopje (placeholder "Winkel", + voegt toe). De laatste keuze
  geldt per telefoon. Winkels beheren komt bij Instellingen (stap 9).
- "Afdeling onbekend": wat hier te koop is maar nog geen afdeling heeft, met de
  icoonknop "Waar ligt dit?" (kaartspeld). Die vraagt naar de
  afdelingen van déze winkel (looproute; zoeken of toevoegen onderaan). Kiezen
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
  thuis.json) en blijft bewaard als de app sluit. Leegmaken haalt alleen het
  groepje uit beeld; de aankoopdatums blijven; 6 s Ongedaan maken. Er is geen "Klaar". Later
  eventueel een instelling "na x dagen vanzelf leeg".
- Het mandje is per winkel: "In het mandje" toont alleen wat je in déze winkel afvinkte; leegmaken geldt voor deze winkel. Wat
  je elders afvinkte, staat daar weer als je die winkel kiest.
- Geen toevoegen op dit tabblad: dat gaat via Lijst.
- Een artikel dat de ander op de lijst zette, krijgt "nieuw" tot je het gezien hebt.
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
- **Artikel** (tik op de naam in de lijst; geen potloodje): volledig scherm met
  kruisje rechtsboven. Naam (loopt door over meer regels), soort (drie knoppen),
  te koop bij (per winkel de afdeling of een grijs "—"; tik = afdeling kiezen,
  ✕ = weghalen; "Winkel toevoegen": zoeken of toevoegen zoals in de Winkels-tab,
  daarna meteen de afdeling), gekocht in één regel ("Laatst gekocht 15 nov ·
  meestal elke week"; "meestal" pas vanaf drie aankopen). Onderaan prullenbak
  (6 s Ongedaan maken) en Opslaan. Wijzigingen zijn een kladversie tot Opslaan;
  nieuwe winkels en afdelingen bestaan wel meteen. Sluiten (kruisje, terugknop
  van de telefoon of een ander tabblad) met wijzigingen vraagt "Wijzigingen
  opslaan?" [Weggooien] [Opslaan]; het kruisje van die vraag = verder bewerken.
- **Actie:** titel, wanneer (geen, dag, maand, kwartaal, jaar, met bladeren),
  herhalen, wie (Mark of partner; niets gekozen = voor wie het oppakt), notitie, link (met openen), foto,
  verwijderen.
- Onderaan [Annuleren] [Opslaan].

### 5.5 Instellingen
- Synchroniseren: aangemeld als, gedeelde map, aanmelden/afmelden (rode rand,
  volle breedte).
- Wekelijks terug op de lijst: de dag als knoppen (ma–zo), de tijd. Geldt voor
  beiden (in thuis.json).
- Gegevens › Backups: lijst (laatste 14 dagen, eerste van de maand) met datum
  en grootte. Een tik downloadt die ene backup en toont winkels, artikelen, op
  de lijst en acties, met "Terugzetten" (geen extra bevestiging). Eerst bewaart
  de app de huidige stand als `thuis_voor_terugzetten.json`; daarna een melding
  met "Ongedaan maken". Alleen als er geen wijzigingen klaarstaan, met
  If-Match. Een backup in een ouder formaat is niet terug te zetten.
- Archief: "Verwijderen als niet gekocht in" 1 week, 1 mnd (standaard), 3 mnd,
  1 jaar. Geldt voor beiden (in thuis.json).
- App: browser, aanmelding geldig, opslag vastgezet; versiestempel onderaan.
- Winkels en afdelingen: tabblad Winkels (5.1b). Later: personen (Doen).

### 5.6 Synchronisatie (in Instellingen; het wolkje opent Instellingen)
- Bovenaan de kaart Synchroniseren de toestand: icoon, één woord (Bijgewerkt,
  Bezig…, Offline, Niet gelukt, Opnieuw aanmelden, Gekoppeld) en wat het betekent
  ("om 20:14", "3 wijzigingen wachten · laatst bijgewerkt 18:40", de reden), in
  oranje als er iets is. Daaronder de omrande knop "Nu synchroniseren" (of
  "Opnieuw aanmelden").
- Gegevens › Logboek: wat de app zelf oploste of deed (rechtgezette verwijzingen,
  samengevoegde namen, tegelijk gewijzigd, een mislukte synchronisatie — één
  keer per nieuwe fout), per telefoon, de laatste 100, nieuwste eerst.

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

- Dagbackup `thuis_backup_JJJJMMDD.json`: de versie van vóór het eerste
  schrijven die dag, gemaakt met `conflictBehavior=fail`, zodat maar één
  telefoon hem maakt.
- Bewaren: de laatste 14 dagen plus de eerste van elke maand van de laatste 12
  maanden. De app ruimt op na het maken van de dagbackup (hooguit één keer per
  dag) en verwijdert alleen bestanden met precies die naam. De termijnen komen
  later als instelling.
- Terugzetten (Instellingen, stap 9): lijst met backups, per backup de datum en
  het aantal winkels, artikelen en acties; vóór het terugzetten eerst een backup
  van de huidige stand.
- Een `thuis.json` die er was en nu weg is, wordt niet stil opnieuw gemaakt.
- Opslaan op de telefoon mislukt (wachtrij, mandje, keuzes): melding "Opslaan
  niet gelukt" met "Opnieuw proberen", tot het weer lukt.
- Een andere map koppelen met wijzigingen in de wachtrij: eerst bevestigen; de
  wachtrij, kopie, het mandje en de keuzes horen bij de oude map en gaan weg.

## 7b. Veiligheid

- Geen code van anderen (geen bibliotheken, CDN, analytics). Gegevens alleen via
  `textContent` in de pagina, nooit als HTML.
- Content-Security-Policy in de pagina: alleen eigen bestanden; verbindingen
  alleen met Microsoft (aanmelden, Graph, OneDrive-downloads). Geen verwijzer.
- Rechten: `Files.ReadWrite.All` blijft, bewust: nodig voor de gedeelde map
  van de ander. De map wordt alleen gedeeld met specifieke personen, niet met
  "iedereen met de koppeling".
- Bekend risico: de vier apps delen het domein mv-systems-apps.github.io en dus
  de opslag in de browser. Later een eigen subdomein per app. Tot dan: CSP in
  alle apps en geen code van anderen; tweestapsverificatie op GitHub.
- Links bij acties (stap 8) alleen als ze met `https://` beginnen.

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
