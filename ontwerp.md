# thuis — ontwerp

Vierde app naast golf-score, trends en events. Boodschappen en acties voor twee
personen (Mark en zijn vrouw), elk op een eigen Android-telefoon (Edge of Chrome,
als PWA op het beginscherm). Vervangt Microsoft To Do.

Status (24-11-2026): in gebruik, versie 1352904-003. Dit document beschrijft
het ontwerp zoals het gebouwd is; §7a de bewuste keuzes uit de reviews.

Volgt `apps-basis/conventies.md`, behalve waar §8 een bewuste afwijking noemt.

---

## 1. Uitgangspunten

- Aantrekkelijk, praktisch, eenvoudig te bedienen, met één hand.
- Snel: één keer inlezen, één keer verwerken, alleen tekenen wat zichtbaar is.
- Gegevens in jullie eigen OneDrive, in één bestand `thuis.json`: één record per
  regel, met een teksteditor te lezen.
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
- Bij elke opslag van kopie of wachtrij verandert een klein kenmerk (`stand`).
  Komt een venster in beeld en is de stand anders, dan leest het kopie en
  wachtrij opnieuw: zo schrijft het geen oude wachtrij over die van het andere
  venster heen. Normaal is dat één kleine leesactie.

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
  sinds november 2026 niet meer.) Geeft het bestand 403 of 404, dan kijkt de
  app of de map zelf nog bereikbaar is. Zo niet: "Geen toegang meer tot de
  gedeelde map" met "Andere map koppelen" (Instellingen, deellinkvak); de lijst
  op de telefoon blijft staan. Is de map er wel en het bestand niet: de melding
  dat het bestand weg is, met terugzetten vanaf deze telefoon.
- **Lezen:** eerst het item (eTag, lastModifiedDateTime en de downloadUrl). Pas
  bij een andere eTag wordt de inhoud gedownload. Is het bestand gelijk, de
  wachtrij leeg, de dag dezelfde en het wekelijkse moment niet voorbij, dan wordt
  de ronde overgeslagen.
- **Scope:** `Files.ReadWrite.All offline_access User.Read` (User.Read voor de
  voornaam bij "nieuw").
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
(`thuis_backup_JJJJMMDD.json`) en `thuis_voor_terugzetten.json`. Niet bedoeld
om met de hand te bewerken.

- UTF-8, geldige JSON, en de opbouw hieronder. Klopt een van die drie niet,
  dan leest de app het bestand niet en schrijft hij er nooit in; hij werkt
  verder op de laatste goede kopie op de telefoon, met een melding. Een BOM
  wordt bij het lezen genegeerd en nooit geschreven (RFC 8259); hij verdwijnt
  bij de volgende wijziging, net als in de andere apps.
- `versie`: datum en tijd van de laatste formaatwijziging in hex, zoals het
  versiestempel (`1352902-459` = 22-11-2026 11:13). Nieuwer dan de app kent:
  niets schrijven, melding om bij te werken. Ontbrekend: niet lezen. Ouder: stap
  voor stap omzetten met de tabel `MIGRATIES` in de kern (ook bij een backup);
  ontbreekt een stap, dan niet lezen. Regel: een optioneel veld erbij is géén
  nieuw formaat (onbekende velden blijven bewaard). `FORMAAT` gaat alleen omhoog
  bij een andere opbouw, en dan komt er een omzetting bij.
- **Velden: één tabel.** `SCHEMA` in de kern zegt per soort welke velden er zijn,
  hun type (`VELDTYPEN`: lezen, schrijven, vergelijken), of ze met `zet` mogen
  veranderen (met controle) en wat er gebeurt als jullie ze allebei veranderden
  (`samen`: melden, lijst, nieuwste, stil). Lezen, schrijven, `zet` en het geheugen
  van de lijstregels (`recordSleutel`) volgen die tabel. Een nieuw veld: één regel
  in `SCHEMA`; daarna alleen nog tonen (artikelLijst/actieLijst, de regel) en
  bewerken (de editor). Alle records zijn plat (ook acties: geen apart bakje).
  Na een update met een nieuw formaat gaat de oude kopie op de telefoon weg, maar
  de wachtrij niet: die wordt alsnog verstuurd en elke handeling gecontroleerd;
  wat niet meer past, vervalt met de gewone melding.
- **Vaste id's.** Winkels, afdelingen, artikelen en acties hebben een id van
  vijf willekeurige tekens (kleine letters en cijfers zonder 0 o 1 l i; via
  `crypto.getRandomValues`, uniek binnen het bestand). De naam is een gewoon
  veld: hernoemen verandert alleen de naam, verwijzingen blijven kloppen. Er
  is geen hernoem-spoor meer.
- Afdelingen horen bij één winkel, als lijst op volgorde (de route).
- De app schrijft één record per regel, op naam; wat leeg is, staat er niet.
  Onbekende delen en velden blijven bewaard (een oudere app op de andere
  telefoon gooit niets weg). Namen mogen elk teken bevatten.
- Onschuldige afwijkingen zet de app stil recht en logt ze (Instellingen →
  Logboek): een plek in een verwijderde winkel valt weg, een verwijderde
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
| `instellingen` | `wekelijks`: `dag`, `tijd`, `teruggezet`, `auto` (ja/nee, standaard ja); `archief`: `bewaren` (1w, 1m, 3m, 1j); `aankopen`: `bewaren` ("0" t/m "1000"); `historie`: `bewaren` (1w, 1m, 3m, 1j); `opruimen`: `tot` (na terugzetten) |
| `winkels` | `naam`; `afdelingen`: lijst van `{id, naam}` in de route |
| `artikelen` | `naam`; `soort` (eenmalig, wekelijks, regelmatig); `aantal` ("2" t/m "99"; zonder = 1, blijft staan na het kopen); `notitie` (vrije tekst, blijft staan); `link` (alleen https, zonder naam of wachtwoord, met een echte domeinnaam; getoond als het domein met ↗); `ligt` (winkel-id → afdeling-id; `""` = te koop daar, afdeling onbekend; geen `ligt` = nog nergens vastgelegd, staat in elke winkel bovenaan); `op` (sinds wanneer op de lijst); `opdoor`; `weg` (dag dat een eenmalig artikel van de lijst ging, voor wat nooit gekocht is); `gekocht` (laatste zes datums) |
| `acties` | `naam`, `datum`, `herhaal` (week, maand, kwartaal, jaar), `maanddag`, `notitie`, `link`, `klaar`. Geen eigenaar of wie: ook niet in de handelingen |
| `aankopen` | per id `naam`, `tijd`, optioneel `winkel` (winkel-id) en `onzeker` ("1": afgevinkt onder Elders); niet wie |
| `historie` | per id `naam`, `tijd` (actie afgerond; niet wie) |

Datums: dag `2026-11-19`, maand `2026-12`, kwartaal `2027-K1`, jaar `2027`;
tijdstippen `2026-11-21T10:12` in lokale tijd (Europe/Amsterdam).

Opruimen door de app: afgeronde acties na 3 maanden; historie na de ingestelde
tijd (standaard 3 maanden); aankopen boven het ingestelde aantal; eenmalige artikelen in
het archief (niet op de lijst) die de ingestelde tijd niet gekocht zijn
(`instellingen.archief.bewaren`: `1w`, `1m`, `3m`, `1j` standaard; de laatste
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
  De melding valt op: paars verloop met witte tekst, een witte knop en een lichte schaduw
  (dezelfde kleuren als de winkelkop).
- **Volgorde van afdelingen:** wat de ander intussen toevoegde, komt achteraan;
  wat hij weghaalde, blijft weg.
- **Wekelijks terugzetten** is geen handeling in de wachtrij. Elke telefoon
  berekent het bij het lezen: is `teruggezet` ouder dan de laatste dag/tijd uit
  de instelling, dan gaan de wekelijkse artikelen die sindsdien niet gekocht
  zijn op de lijst, en wordt `teruggezet` bijgewerkt. Zo zet een telefoon die
  offline was, net gekochte bananen niet opnieuw op de lijst.
- Acties (Doen): een afgeronde actie opnieuw invoeren heropent hem —
  bij het bouwen van Doen uitwerken.

## 5. Schermen

Layout volgens de conventies: vaste kop, scrollend midden, vaste tabbalk. De
kop heeft een kleurverloop van kobalt naar paars, met rechts het sync-wolkje.
Tabbalk met alleen iconen, vijf tabbladen: **Winkels** (winkelpui),
**Artikelen** (klembord), **Boodschappen** (winkelwagen), **Doen** (vinkvak) en
**Instellingen** (tandwiel). Wisselen kan ook door te vegen, rondom; niet vanaf
de rand van het scherm (terug-gebaar van Android), niet tijdens typen en niet in
een menu of keuzelijst. De terugknop: zie §7a (Bewerken, terugknop en meldingen).
Kleur en vorm per soort: eenmalig orchidee #8E33A6 (vierkant met 1), wekelijks kobalt (rondje met 7),
regelmatig turquoise (zeshoek met n, "n keer"); het teken staat precies in het midden, 9 hoog.
Ook zonder kleur te onderscheiden aan de vorm. Rechte hoeken; tekst nooit
kleiner dan 17 px; knoppen minstens 44 px.

Maten: het rondje (op/van de lijst, afvinken) is overal 28 px en krimpt nooit;
het gevulde rondje is even groot als de buitenkant van het open rondje (lijn
meegerekend). Soorticoon en iconen 24 px, lijndikte 2. Een icoonknop is een
vierkant van 44 px met een lichte tint en zonder rand (licht paars, zoals
"Waar ligt dit?"; turquoise voor "Winkelmand leegmaken", 36 px). Een lange naam loopt door naar een volgende regel.

### 5.1 Artikelen (tabblad; in de code scherm-boodschappen)
- Invoervak "Zoeken of toevoegen" (placeholder "Artikel"). Links een
  vergrootglas (de soort van een nieuw artikel volgt het filter); rechts een +. Typen zoekt in alle
  artikelen ("Gevonden"). Een + op een bestaand artikel zet dat op de lijst.
- Tijdens het typen verdwijnen de onderbalken, zodat er ruimte is voor de
  resultaten.
- Filterknoppen (icoon + aantal): Op de lijst, Eenmalig, Wekelijks,
  Regelmatig, Suggesties (lampje). Eenmalig toont (en telt) alleen wat op de
  lijst staat; gekocht of van de lijst gehaald gaat een eenmalig artikel naar
  het "Archief" eronder (ingeklapt, nieuwste eerst, grijs, met "gekocht 19 nov"
  of "van de lijst 14 jul"; de + zet het terug). Zoeken vindt ook het archief.
  Nog een tik op het gekozen vakje zet het uit: "Alle artikelen" (alles behalve
  het archief, dat eronder staat; een nieuw artikel wordt eenmalig). Bij het
  openen van de app staat "Op de lijst" aan.
  Elke lijst heeft een kopbalk (lichtpaars, paarse titel, rechts het aantal).
  Overal geldt de volgorde eenmalig,
  wekelijks, regelmatig. Suggesties: artikelen die langer geleden
  gekocht zijn dan gewoonlijk (minstens 3 aankopen nodig). Zonder historie
  staat er uitleg.
- Aantal: tik op het soorticoon (of op "2×") en onder de regel klapt de teller
  open (Aantal − n +, minimaal 1). Bij meer dan 1 staat "2×" achter de naam (vet paars, 18 px, geen badge), ook
  in Boodschappen. Het aantal blijft staan na het kopen.
- Link: apart veld onder Notitie ("Link of zoekwoorden"). Een adres is één woord met
  een bekende extensie (.nl, .com, .be, .de, .eu, .org, .net, .shop, .info, …) of een "/"
  ("gamma.nl", "ah.nl/bonus"); dat krijgt https:// vanzelf. Met "schema://" ervoor
  (http://, ftp://, …), een naam of wachtwoord erin: geweigerd met "Alleen links met
  https:// zijn toegestaan." Al het andere ("philips hue e27", "Dr.Oetker", "AH:bonus",
  ook "javascript:…") wordt een Google-zoekopdracht (gewone https-link in het bestand);
  in het bewerkveld staan dan weer de woorden.
  In de lijsten "ah.nl" of «"philips hue e27"», onderstreept, met erachter het icoon "pijl uit een vierkantje" (rechte hoeken); een tik opent een nieuw
  tabblad (noopener, noreferrer). Ook bij het tonen opnieuw gecontroleerd.
- Notitie: in het bewerkscherm onder Naam, één tekst. In de lijsten paars onder
  de winkels (zelfde letter), in Boodschappen onder de naam: eerst de tekst,
  daaronder de tags (vet) met de link erachter. Blijft staan.
- Tagkeuze: zwevend boven het vak waarin je typt (notitie: 6 px, het toetsenbord zit
  eronder; zoekvak: 9 px, zodat ook de focusrand zichtbaar blijft), even breed, met een
  paarse rand en een lichte schaduw; schuift mee als het scherm verschuift.
- Per regel: links het soorticoon (knop voor het aantal), de naam, rechts het
  rondje voor op of van de lijst. Tik op de naam opent het bewerkscherm; daar
  wissel je de soort. Een artikel dat alleen in bepaalde winkels ligt, krijgt
  onder de naam een grijs regeltje met die winkels ("Albert Heijn · Plus");
  zo ook onder "Elders" in Boodschappen. Een getal rechts in een
  kop is altijd alleen het getal ("6"), zonder woord. Voortgang: "2 van 13". Subregels houden hun woorden ("3 afdelingen, 8 artikelen"). Wat de ander op de lijst zette, krijgt "nieuw" tot
  je het gezien hebt (in beeld op Artikelen of Boodschappen en dat scherm
  verlaten); per telefoon bewaard, niet in het bestand.
- Geen knop "Naar de winkel": de winkel is een eigen tabblad.

### 5.0 Tabbladen
Winkels, Artikelen, Boodschappen, Doen, Instellingen (alleen iconen, vegen
rondom). De app opent op Artikelen. Invoervakken staan onderaan, boven de
tabbalk; het toetsenbord komt pas na een tik. Geen uitlegteksten in schermen.

### 5.1b Winkels (tabblad)
- Favorieten en Overige, inklapbaar, alfabetisch; favorieten per telefoon.
  Onder een winkel "3 afdelingen, 8 artikelen" (zonder afdelingen alleen de artikelen;
  alles wat bij die winkel is vastgelegd), aan te zetten bij Instellingen → Weergave (standaard uit).
  Onderaan "Winkel": typen filtert, + voegt toe (of opent de bestaande).
- Eén winkel: terug, naam, ster (favoriet), potlood (Winkel bewerken: naam,
  notitie, link (alleen https), prullenbak links van Opslaan). In het overzicht
  staan notitie en link paars onder de regel, net als bij artikelen. Afdelingen horen bij deze winkel alleen
  (de route, op volgorde). Gewoon: per afdeling een rij (zwart, niet vet) met het aantal artikelen en
  een pijltje ›. Onderaan "Afdeling?" (zelfde uiterlijk) als er hier artikelen zonder afdeling liggen.
  De kop heet "Route", rechts het aantal afdelingen (alleen het getal) en "Volgorde" (pijltjes):
  dan een greep vooraan om te verslepen en een potlood (ook tik op de naam) voor Afdeling bewerken;
  aan = gevuld paars met een vinkje, nog een tik zet het terug. Een winkel zonder afdelingen toont
  meteen de artikelen onder "Artikelen". Een andere winkel openen: Volgorde uit. Onderaan "Afdeling".
  Hernoemen gaat mee in `ligt=`; weghalen laat het artikel te koop in die
  winkel zonder afdeling. Verwijderen meteen, 6 s Ongedaan maken.
- Eén afdeling (tik op een rij): eigen scherm met terug (naar de route, op dezelfde plek; ook de
  terugknop), de naam met de winkel eronder, en een potlood (Afdeling bewerken: naam, verwijderen;
  niet bij "Afdeling?"). Daaronder "Artikelen" met het aantal: rondje = op de lijst; icoon of "2×"
  opent de teller; tik op de naam opent het artikel (sluiten brengt je terug in de afdeling, op
  dezelfde plek). Onder een artikel alleen de andere winkels.
- Onderaan "Artikel": typen filtert de artikelen van de afdeling en toont boven de balk eerst de
  artikelen van deze winkel die in een andere afdeling of onder "Afdeling?" liggen (grijs eronder
  waar; een tik verplaatst het hierheen), dan artikelen uit andere winkels (grijs winkelicoon erachter;
  een tik opent een paneel met de winkels en afdelingen waar het ligt en als laatste regel, paars,
  "+ <deze winkel>" met deze afdeling; Annuleren of Voeg toe, de andere winkels blijven), dan
  "+ Nieuw: "…"" (niet als de precieze naam al in het lijstje staat). Nergens vastgelegd: geen
  icoon, een tik legt het meteen hier. + of Enter: bestaat
  de naam al (ook in een andere winkel), dan krijgt dat artikel deze winkel en afdeling erbij;
  anders een nieuw artikel, soort regelmatig (niet op de lijst), meteen hier.

### 5.2 Boodschappen (tabblad; in de code scherm-winkel)
- Per artikel leg je vast in welke winkels het te koop is, en per winkel in
  welke afdeling het daar ligt (`ligt`).
- Van boven naar beneden: "Boodschappen" met de voortgang van de hele lijst
  ("1 van 7"; wat in een van de mandjes ligt telt als gehaald);
  "Winkel?" (kaart met een grijze kop en een doorgestreept winkeltje;
  per artikel een winkelicoon dat vraagt bij welke winkel het te koop is,
  zoeken of toevoegen; het komt daar onder "Afdeling?" met de speld,
  zonder meteen naar de afdeling te vragen); de gekozen winkel als één kaart
  (kop gevuld paars, de winkelnaam groot en turquoise (20 px, mag op twee regels), rechts "4", het winkelicoon en de pijl, dan "Afdeling?" met de speld en de afdelingen, elk met rechts het aantal dat er nog te halen is
  in de route); los en grijs "Elders" (met een winkelicoon dat "Welke winkel?" opent) en "Winkelmand", allebei
  inklapbaar en dicht bij het kiezen van een andere winkel; open blijft open zolang
  je in dezelfde winkel bent (ook na een ander tabblad). "Winkelmand" toont het hele
  mandje (alle winkels), met één knop om alles leeg te maken; geen subkoppen, maar onder
  elk artikel grijs de winkel ("Plus?" als het onder Elders is afgevinkt), net als in
  Aankopen. Eerst deze winkel, dan de andere alfabetisch.
- Heeft een winkel geen afdelingen, dan staan de artikelen zonder kop in de
  winkelkaart en vraagt de app nergens naar een afdeling (ook niet in het
  bewerkscherm). Afdelingen maak je in de Winkels-tab.
- Vier hoofdgroepen, even hoog (46 px), paars verloop met witte letters: de gekozen winkel,
  "Elders", "Winkelmand" en "Aankopen". De winkelkop klapt de winkel open en dicht
  (open bij het kiezen van een winkel); het winkelicoon erin opent de keuzelijst. De afdelingen
  eronder zijn lichtpaars.
- De winkelnaam; een tik op het winkelicoon opent de keuzelijst "Welke winkel?" met
  gelijke koppen (paars op lichtpaars, rechts alleen het aantal winkels, zonder woord): "Nodig"
  (winkels met iets dat nergens anders te koop is; daaronder grijs die artikelen
  bij naam als het er één of twee zijn, anders "26 alleen hier"; rechts het totaal), "Alternatief" (alles ook elders; geen namen, rechts het aantal; ingeklapt; is er niets nodig, dan heet die groep "Te koop bij" en staat hij open); alle winkels met een
  paars icoon (niet vet) en ingeklapt "Overige winkels". De
  gekozen winkel staat bovenaan onder de vaste kop "Huidig" (geen pijl), met een
  paarse streep links, en niet nog eens in een groep.
- Staat er niets op de lijst, dan geen winkelkaart: alleen "Geen artikelen"
  (de gekozen winkel blijft bewaard).
  Alleen wat bij een winkel is vastgelegd telt, met het aantal; binnen elke
  groep alfabetisch (de volgorde van je route hangt niet van de lijst af); bij een of twee artikelen staan ze eronder. Rechts alleen het aantal
  artikelen ("2"). Winkels met 0 staan er niet in; ingeklapt "Overige winkels"
  (alleen wat er niet al boven staat, rechts "2"). Kruisje rechtsboven; onderaan
  een zoekvak zonder kopje (placeholder "Winkel", + voegt toe). De laatste keuze
  geldt per telefoon. Winkels beheren gebeurt op het tabblad Winkels.
- "Afdeling?": wat hier te koop is maar nog geen afdeling heeft, met de
  icoonknop "Waar ligt dit?" (kaartspeld). Die vraagt naar de
  afdelingen van déze winkel (route; zoeken of toevoegen onderaan). Kiezen
  legt vast: te koop hier, in die afdeling; een nieuwe afdeling komt achteraan
  de route.
- Daarna de afdelingen in de route.
- Elke vink is direct een handeling (van de lijst, aankoopdatum erbij). Het
  item blijft 1,5 s grijs op zijn plek en schuift dan naar "Winkelmand".
  Terugtikken zet het terug en haalt de aankoopdatum weg.
- "Elders": artikelen die hier niet te koop zijn, ingeklapt
  en grijs, wel af te vinken.
- Het mandje blijft staan tot je het leegmaakt, ook de volgende dag (boodschappen over twee dagen
  verdeeld); wat weer op de lijst komt (bv. wekelijks terug) gaat eruit. Rechts naast het kopje "Winkelmand" staat een icoonknop
  (mandje met kruis, "Winkelmand leegmaken"). Het mandje hoort bij de telefoon (niet in
  thuis.json) en blijft bewaard als de app sluit. Leegmaken haalt alleen het
  groepje uit beeld; de aankoopdatums blijven; 6 s Ongedaan maken. Er is geen "Klaar".
- Elk afgevinkt artikel onthoudt in welke winkel het in het mandje kwam; "Winkelmand"
  toont ze allemaal, met de winkel onder het artikel.
  Leegmaken geldt voor het hele mandje (6 s Ongedaan maken).
- Geen toevoegen op dit tabblad: dat gaat via Artikelen.
- Een artikel dat de ander op de lijst zette, krijgt "nieuw" tot je het gezien hebt.
- Verversen elke 30 s zolang dit tabblad open is.

### 5.3 Doen
- Links in de invoerbalk van Winkels en Doen: een loep; met tekst in het vak een
  terugpijl die het vak leegmaakt. Tik op de loep = invoeren.
- Invoervak "Actie" onderaan: typen filtert, + voegt toe (een afgeronde actie
  met dezelfde naam wordt heropend). Een nieuwe actie heeft geen periode.
- Filters bovenaan: Week · Maand · Kw. · Jaar · Alles, naam met het aantal
  eronder. Een filter toont Te laat en wat binnen de termijn af moet ("Deze week",
  "Deze maand", …); een maand-, kwartaal- of jaaractie dus pas in de week/maand
  waarin die eindigt. Alles toont Te laat, Deze week, Later, Zonder periode en
  Afgerond. Standaard Week; in Instellingen per telefoon te kiezen. Tijdens
  zoeken is geen filter actief; een tik zoekt alleen daarin.
- Groepen met inklapbare kopbalken (open; dicht blijft dicht tot je hem weer opent, tijdens zoeken open), vroegste eerst; vandaag en morgen heten zo. Per regel het rondje en de
  naam; eronder grijs de periode ("vr 27 nov", "december", "K4", "2027"; het
  jaar alleen als het niet dit jaar is) en het herhaalteken met "week"; daaronder
  paars de notitie en de link.
- Afronden: een herhalende actie schuift door naar de volgende keer (melding met
  Ongedaan maken, 6 s); een gewone blijft 1,5 s grijs en gaat naar "Afgerond"
  (ingeklapt, met wanneer; het rondje heropent). Wie het deed wordt niet bewaard.
- Geen eigenaar (later eventueel).

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
- **Actie:** zoals een artikel (kruisje, kladversie, Opslaan, prullenbak met
  Ongedaan maken, vraag bij sluiten). Actie, Notitie, Link (alleen https),
  Wanneer (n.v.t., Dag, Maand, Kwartaal, Jaar, met ‹ › bladeren; een andere soort
  houdt de plek), Herhalen (alleen met een periode; Nee en niet fijner dan de
  periode: bij Dag week/maand/kwartaal/jaar, bij Maand maand/kwartaal/jaar, …).

### 5.5 Instellingen
- Synchroniseren: aangemeld als, gedeelde map, aanmelden/afmelden (rode rand,
  volle breedte).
- Wekelijks terug op de lijst: schakelaar "Automatisch" (standaard aan), daaronder de dag
  als knoppen (ma–zo) en de tijd; uit = dag en tijd weg. Geldt voor beiden (in thuis.json).
  Uit: het moment wordt wel bijgehouden (aanzetten midden in de week zet dus niet meteen
  alles terug), maar niets gaat vanzelf op de lijst. Dan staat op Artikelen, filter
  Wekelijks, in de kop een icoon (vinkjeslijst met +) zolang er een wekelijks artikel niet
  op de lijst staat: één tik zet ze er allemaal op, met Ongedaan maken.
- Gegevens › Backups: lijst (laatste 14 dagen, eerste van de maand) met datum
  en grootte. Een tik downloadt die ene backup en toont winkels, artikelen, op
  de lijst en acties, met "Terugzetten" (geen extra bevestiging). Eerst bewaart
  de app de huidige stand als `thuis_voor_terugzetten.json`; daarna een melding
  met "Ongedaan maken". Alleen als er geen wijzigingen klaarstaan, met
  If-Match. Een backup in een ouder formaat is niet terug te zetten.
  Vóór het terugzetten ook de dagbackup van vandaag (als die er nog niet is).
  Zet je meteen nog een backup terug (binnen een uur en zonder wijzigingen
  ertussen), dan blijft `thuis_voor_terugzetten.json` de stand van vóór de
  eerste poging.
- Volgorde van de blokken: Synchroniseren, Wekelijks terug op de lijst, Aankopen,
  Weergave, Doen, Gegevens, App.
- Aankopen: eerst "Bijhouden" (aantal), dan "Verwijderen als niet
  gekocht in" (eenmalige artikelen in het archief) 1 week, 1 mnd, 3 mnd, 1 jaar (standaard).
  Geldt voor beiden (in thuis.json).
- App: browser, aanmelding geldig, opslag vastgezet; versiestempel onderaan.
- Winkels en afdelingen: tabblad Winkels (5.1b). Later: personen (Doen).

- Weergave (per telefoon, schakelaars met rechte hoeken): "Aantallen bij winkel",
  "Winkels bij artikel" en "Winkel bij aankoop" (in Aankopen in Boodschappen).
  Standaard uit, uit, aan; een keuze die je zelf maakte blijft staan.
  "Winkels bij artikel" gaat over de grijze regel onder een
  artikel: op Artikelen, ook bij zoeken met @, en in een winkel op het tabblad Winkels;
  bij "Elders" in Boodschappen blijft hij staan, daar zie je waar je heen moet.

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
- Aanmelden bij Microsoft, dan de deellink van de gedeelde map plakken. Staat er
  nog geen `thuis.json`, dan maakt de app een leeg bestand. De voornaam komt uit
  het Microsoft-account (geen aparte "Ik ben").
- Misschien later: een nieuwe lijst met standaardafdelingen, de deellink vanuit de app maken.

### 5.8 Meldingen en ongedaan maken
- Eén melding per regel met de knoppen eronder. Twee stijlen: lichtpaars met paarse
  streep (gelukt, terug te draaien) en lichtoranje (let op of fout). Een fout in een
  editor staat bovenaan; in een paneel bovenin dat paneel.
- Een melding verdwijnt niet vanzelf, met één bewuste uitzondering: "Ongedaan maken"
  (na verwijderen, afronden, mandje leegmaken) staat 6 s in beeld met een aftelbalkje
  en een ✓ om hem weg te tikken (ongedaanMelding; zie §8). Ongedaan maken is een
  nieuwe handeling, dus het werkt ook na synchroniseren.

### 5.9 Tags
- Een tag is `#woord` in een notitie (artikel, winkel, actie), zoals in events
  maar zonder subtags; `_` wordt getoond als spatie. In de lijst vet.
- In elk zoekvak: `#` toont de tags met aantal boven de balk; verder typen
  filtert, tikken kiest. Met `#` zoekt het vak alleen op tags in de notitie
  (begint met); zonder `#` op de naam. Een `#` in een naam mag, maar telt niet als tag.
- Met `#` vooraan doet + niets (een tag is geen naam).
- In een notitie (artikel, winkel, actie): `#` typen toont direct onder het vak
  alle tags uit alle notities; verder typen filtert, tikken maakt het woord af met
  een spatie en je typt door. Hoofdletters en accenten tellen niet mee.

### 5.9b Zoeken op winkel (@)
- Artikelen: links in de balk een vergrootglas (geen soortmenu meer); een nieuw artikel krijgt de soort
  van het filter, een andere soort zet je in de editor.
- "@" in het zoekvak toont de winkels boven de balk, met hoeveel artikelen er te koop zijn. Kiezen zet
  "@Winkel " in het vak (toetsenbord blijft open). De lijst toont dan alles wat daar te koop is, per
  afdeling in de volgorde van de route, onderaan "Afdeling?". Verder typen zoekt in de
  afdelingen ("@Plus zuiv"; "@Plus?" of "@Plus afd" voor zonder afdeling). Winkelnamen met spaties mogen.
- Met "@" vooraan voegt de + niets toe (zoals bij "#"). De filterknoppen tellen en zoeken mee; tik je
  tijdens het zoeken Eenmalig/Wekelijks/Regelmatig aan, dan krijgt een nieuw artikel die soort.
- Spaties, hoofdletters en accenten tellen niet ("@albertheijn", "@ plus zuiv", ook een spatie ervoor).
  Begint een winkelnaam met een andere ("Albert", "Albert Heijn"), dan blijft de keuzelijst staan; de
  langere wint bij doortypen.
- Weergave zoals de winkelkaart op Boodschappen: paarse kop met de winkelnaam, lichtpaarse
  afdelingskoppen; een winkel zonder afdelingen zonder koppen. Onder een artikel alleen de andere winkels.
- Bewust: artikelen zonder winkel ("Winkel?") komen niet mee bij "@Winkel" (anders loopt elke winkel vol
  met wat nog geen winkel heeft).

### 5.10 Letters
- Lege lijsten overal hetzelfde: een witte kaart, links, grijs, 18 px.
- Namen in lijsten en invoervelden 20 px, gewoon (niet vet).
- Kopbalken en uitklappers 18 px vet.
- Al het overige (winkels, notitie, wanneer, aantal, knoppen) 17 px; nergens kleiner.
  Kwartaal heet in de knoppen "Kw.".

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
- Terugzetten (Instellingen): lijst met backups, per backup de datum en
  het aantal winkels, artikelen en acties; vóór het terugzetten eerst een backup
  van de huidige stand.
- Een `thuis.json` die er was en nu weg is, wordt niet stil opnieuw gemaakt.
- Opslaan op de telefoon mislukt (wachtrij, mandje, keuzes): melding "Opslaan
  niet gelukt" met "Opnieuw proberen", tot het weer lukt.
- Een andere map koppelen met wijzigingen in de wachtrij: eerst bevestigen; de
  wachtrij, kopie, het mandje en de keuzes horen bij de oude map en gaan weg.

## 7a. Bewuste keuzes
Wat uit de reviews is overgebleven als vaste regel, per onderwerp. De geschiedenis per ronde staat in git.

### Bestand en synchroniseren
- Een leeg, onleesbaar, nieuwer of verdwenen thuis.json: niets schrijven, melding, verder op de kopie van
  de telefoon; niet steeds opnieuw proberen tot er iets verandert (app openen, Nu synchroniseren, de
  gewone ronde). Nieuwer formaat: knop "App bijwerken". Beschadigd: knop "Backups"; terugzetten mag dan
  ook met wachtende wijzigingen (die gaan op de backup); geen dagbackup van het beschadigde bestand.
- Bestand weg: "Terugzetten vanaf deze telefoon" (de kopie wordt het nieuwe bestand) of "Leeg beginnen"
  na bevestiging (wist ook de wachtrij). Niet gevonden op id: eerst op naam zoeken; opnieuw aangemaakt
  (andere id): melding met "Backups", de app gaat door met het nieuwe bestand.
- Een wijziging die vervalt, wordt altijd gemeld. Een handeling met een onverwachte vorm vervalt.
  Technische velden (weg, klaar, maanddag) geven geen botsingsmelding; de nieuwste datum wint.
- Wat bij het lezen rechtgezet wordt, wordt ook opgeslagen; het logboek herhaalt geen regels; een
  mislukte dagbackup komt in het logboek. Hulpgegevens (gezien, logboek, backupDag) geven geen opslagmelding.
- Meerdere vensters: na een ronde haalt een venster alleen zijn verstuurde handelingen (`hid`) uit de
  opgeslagen wachtrij; het stand-kenmerk wijzigt pas na gelukt opslaan. Aanmelding en map opnieuw lezen
  bij terugkomen. Naar de achtergrond met een wachtrij: meteen versturen; offline met een wachtrij: nog
  eens om vaste opslag vragen.
- Map koppelen, afmelden en terugzetten niet tijdens een synchronisatie; koppelen blokkeert rondes. De
  eerste keer koppelen neemt de wachtrij mee; een andere map wist wachtrij, kopie en keuzes (met melding).
- Twee keer terugzetten: alleen eigen wijzigingen tellen (Ongedaan maken gaat naar de stand van vóór de
  eerste poging). Na terugzetten ruimt de app die dag niets op (instelling opruimen.tot).
- Werkwijze: deel de map alleen met "Specifieke personen", niet met "Iedereen met de link".

### Klok
- Na elke eigen schrijfactie geeft de opslag de servertijd; de app bewaart de afwijking van de
  telefoonklok (`kopie.scheef`). Meer dan een dag voor of achter = verdacht: wijzigingen worden
  opgeslagen, maar geen opruimen, geen wekelijks terug, geen dagbackup en geen terugzetten (melding).
- Nog niets gemeten: verdacht als de telefoon meer dan een maand na de laatste wijziging van het bestand
  staat; dan schrijft de app één keer hetzelfde bestand terug om te meten. Backups worden nooit
  opgeruimd als vandaag meer dan een maand na de nieuwste andere backup ligt.
- Nieuwe dag of wekelijks moment voorbij (na middernacht, of 's ochtends weer geopend): opnieuw
  uitrekenen en tekenen, ook als het bestand niet veranderde (`dagNagaan`).

### Wekelijks, mandje, Aankopen en Gedaan
- Wekelijks gaat hooguit één keer per week terug op de lijst, minstens 4 dagen na de vorige keer; een
  andere dag of tijd geldt vanaf de volgende week; een moment meer dan twee dagen na nu telt als vorige
  week. De sync doet eerst wekelijks terug, dan de wachtrij; de telefoon rekent het ook zelf (offline).
  Een "van de lijst" van vóór het moment dat pas daarna binnenkomt, haalt het niet van de nieuwe lijst.
- Mandje: per telefoon, alle winkels samen. Wat weer op de lijst staat of verwijderd is, gaat er
  vanzelf uit; verder blijft het staan tot je het leegmaakt (ook de volgende dag). De voortgang
  telt wat in het mandje ligt als gehaald.
- Afvinken maakt een aankoop (gedeeld, naam, tijd en winkel, niet wie); terugtikken haalt hem weg. Afvinken
  onder "Elders" legt níet vast dat het daar te koop is; de aankoop krijgt wel de
  winkel met een vraagteken (in Aankopen "Plus?"; veld `onzeker`).
  Aankopen bijhouden: 50, 100, 250 of 500 (standaard); lager dan het huidige aantal vraagt eerst; 0 (uit
  een oudere versie) = geen aankopen.
- Gedaan (Doen; in de code en het bestand `historie`): elke afgeronde actie (ook herhalend), naam en moment. Ongedaan maken of meteen terugtikken
  haalt de regel weg; later heropenen niet. "Afgeronde acties verwijderen na" 1 week t/m 1 jaar (standaard 3 maanden); korter vraagt eerst ("12 afgeronde acties verwijderen?").
- Aankopen (Boodschappen) en Gedaan (Doen): een tik op een regel vraagt "Verwijderen?", zonder Ongedaan maken.
  Zonder tijdstip (de dag zegt genoeg). Bij een aankoop grijs de winkel eronder (een
  aankoop onthoudt de winkel, optioneel veld `winkel`; oudere aankopen hebben hem niet),
  uit te zetten bij Instellingen → Weergave.
  De regels Aankopen onder Boodschappen en Gedaan onder Doen tonen ook "0". Het woord "Historie" komt in de app niet meer voor.
- Archief (eenmalig, niet op de lijst): standaard 1 jaar; korter vraagt eerst met het aantal. Wordt
  een artikel eenmalig, dan loopt de bewaartijd vanaf die dag. Terugzetten uit het archief stuurt het
  hele artikel mee.
- Suggestie: na minstens drie aankopen, als de gebruikelijke tussentijd voorbij is; stopt na vier keer
  die tussentijd.

### Bewerken, terugknop en meldingen
- Eén stapel lagen (paneel, subscherm, ander tabblad dan Artikelen), elk een stap in de geschiedenis.
  Terug sluit altijd de bovenste; op Artikelen zonder lagen sluit terug de app.
- Met wijzigingen: terug, kruisje of tik ernaast vraagt "Wijzigingen opslaan?"; terug of het kruisje van
  die vraag = verder bewerken. Editors versturen alleen wat je zelf veranderde t.o.v. de stand bij het
  openen. Intussen verwijderd: melding met "Terugzetten met mijn wijzigingen".
- Een fout (bestaande naam, onveilige link, naam met #) is een melding bovenaan; in een paneel bovenin
  het paneel. Hij gaat weg met de editor.
- Winkel verwijderen waar artikelen liggen: eerst bevestigen met het aantal.
- Afvinken in de winkel en bij Doen: 1,5 s om een mis-tik terug te zetten. Van de lijst halen op
  Artikelen gaat meteen naar "Van de lijst gehaald" (daar tik je hem terug). Ongedaan maken (6 s) alleen waar iets uit beeld gaat
  (§5.8). Herhalen uitzetten houdt de actie open.

### Doen
- Herhalen per maand/kwartaal/jaar onthoudt de oorspronkelijke dag (maanddag): 31 jan, 28 feb, 31 mrt.
  Een te laat afgeronde actie op een vaste dag komt niet op vandaag; een lopende maand of kwartaal wel.
- Een afgeronde actie opnieuw intypen: een voorbije datum gaat eraf. Datum bij een vaste dag: tik op de
  datum opent de kalender van de telefoon.

### Zichtbaarheid en invoer
- Toevoegen maakt altijd zichtbaar: buiten het filter springt Artikelen naar Op de lijst en Doen naar
  Alles; de regel springt in beeld en licht op. Iets dat er al staat, licht op.
- Na + blijft het toetsenbord open (Artikelen, Doen, afdelingen); een nieuwe winkel opent zijn pagina.
  Tijdens zoeken: een rondje laat het toetsenbord open en selecteert de zoektekst. Typen verbergt "Van
  de lijst gehaald"; een ander filter wist het.
- Tab wisselen sluit een open winkel en Backups/Logboek. Tijdens het typen blijven de filters bovenaan.
- Platte tekst: alleen bekende HTML-tags en afgesloten <!-- --> weg; losse < en > en "<jong>" blijven;
  onzichtbare en richting-tekens weg.

### Uiterlijk
- Elke knop reageert zichtbaar op indrukken (iets donkerder; kleine knoppen ook iets kleiner). Knoppen die
  even duren (Herladen, Aanmelden, Map koppelen, Nu synchroniseren, Terugzetten, Ongedaan maken van
  terugzetten) tonen na de tik een draaiend rondje en "…" en kunnen niet dubbel (`bezigKnop`).
- Koppen 46 px met 14 px rechts; pijltjes op één lijn; tekstkolom op alle tabs op 72 px.
- Filterknoppen even breed; past een naam niet, dan voor de hele rij korter (Wk, Mnd, Jr), gemeten.
- "Winkel?" als eigen kaart; voortgangsbalk altijd, ook bij 0 van 0. Lege schermen: "Geen …".
  Een kop die het woord al noemt, toont alleen het getal. Winkelmand leegmaken: kleine turquoise knop.
- Tijd (wekelijks) en Aankopen bijhouden: eigen keuzepanelen in de stijl van de app.

### Performance
- Netwerk: een ronde vraagt alleen id, eTag, tijd en downloadlink op (`$select`); de inhoud alleen als
  de eTag anders is. De naam bij Microsoft hooguit eens per week (en na opnieuw aanmelden). Het aantal
  backups bij Instellingen is onthouden van de laatste keer dat de lijst toch al werd opgehaald.
- Opruimen en aankopen beperken gebeuren ook op de telefoon (bouwModel, zelfde regels en klokcontrole):
  korter bewaren is meteen te zien, ook offline.
- Regels buiten beeld worden niet opgemaakt (`content-visibility:auto`). Lijstregels worden hergebruikt
  zolang hun sleutel gelijk is (`recordSleutel` plus wat het scherm erbij toont).
- Een ronde zonder verandering rekent en tekent niets; na een eigen ronde zonder iets van buiten niet
  opnieuw inlezen. Tijdens het verslepen van een afdeling niet tekenen.
- Bewust zo gelaten: afgeleid() bouwt de lijsten helemaal opnieuw (±4 ms bij 800 artikelen) en
  zoekOpNaam is lineair (alleen bij nieuw/terug).
- Bewust zo gelaten: in een winkel worden de artikelregels van de open afdelingen bij elke tekening
  opnieuw gemaakt, niet hergebruikt. Het zijn er weinig (alleen open afdelingen), en een regel uit het
  geheugen van Artikelen kan niet op twee plekken tegelijk staan.

### Opbouw van de code (uitbreiden)
- Formaat: `MIGRATIES` zet een ouder bestand (ook een backup) stap voor stap om; een optioneel veld
  erbij is geen nieuw formaat (§3).
- Velden: één tabel `SCHEMA` (§3); alle records plat.
- Handelingen: `HANDELINGEN` zegt per soort welke velden een id bevatten (`ids`, `nieuweId`).
- Ongedaan maken: `omkeren(hs)` op het moment van de wijziging; één `ongedaanMelding`.
- Per telefoon: `KEUZES`. Gedeelde instellingen: `INSTELLINGEN` en `instelling()`.
- Editors: gedeelde `naamFout`, `linkVanInvoer`, `foutMelding`; de editors zelf blijven apart.
- Schermbouwstenen: `bevestigPaneel`, `klapbareKop` (elke kop die open en dicht gaat: kopbalken,
  afdelingen, Elders en Winkelmand; met of zonder knop erin), `sluitMelding`;
  alle iconen in één blok.
- Deelschermen (artikel- en actie-editor, Aankopen, Gedaan, Backups, Logboek): `deelOpen(el, balk)`
  en `deelDicht()`. Ze openen in één laag (`#deel`) boven het tabblad waar je bent; dat tabblad blijft
  staan, dus bij sluiten zijn open afdelingen en scrollpositie er nog. Een editor kan zo vanaf elk
  tabblad openen. Met een deelscherm open tekent alleen dat; het tabblad tekent bij sluiten.
- Opslag: alles met de gedeelde map via `OPSLAG` (nu `ONEDRIVE`): koppel, ophalen, schrijven (met
  voorwaarde), maken (alleen als nieuw), vervangen, lijst, inhoud, inhoudOpNaam, weg. Geen verbinding
  is een kenmerk van de fout (`geenVerbinding`). `nieuweKopie` maakt de kopie.
- Tests: schermtests in benoemde delen (`DEEL=…`), wachten tot de sync rustig is.
- Service worker volgens conventies.md §3: voorvoegsel afgeleid uit CACHE_NAME, oude caches op nummer,
  een fout antwoord bij de installatie wordt afgebroken (body.cancel: de verbinding komt meteen vrij, ook als de server traag is), alle iconen uit het manifest in de cache;
  registreren bij `isSecureContext` (https of lokaal). Tests: `test-sw-*.py`, gelijk aan de andere apps.
- Een omgezet bestand (ouder formaat) wordt meteen in het nieuwe formaat teruggeschreven.
- Commentaar in de code legt uit waarom, zonder verwijzingen naar reviewpunten.

### Google Drive later (voorbereid, niet gebouwd)
Een tweede object met dezelfde functies naast `ONEDRIVE`, plus een keuze bij het koppelen. Na te gaan:
- Schrijven met een voorwaarde: Drive API v3 kent geen eTag/If-Match meer (v2 wel). Zonder voorwaarde
  is samen bewerken niet veilig; dus v2 of een andere veilige vorm.
- Aanmelden: nagaan of een browser-app zonder server een vernieuwbare aanmelding krijgt (Microsoft: 24 uur).
- Toegang tot een map van de ander met beperkte rechten (alleen eigen of gekozen bestanden).
- CSP (connect-src) en de aanmeldknop; `aanmelden`, `toegang` en `wieBenIk` zijn nu Microsoft-specifiek.

### Bewust niet
- Een CSP-hash (de CSP is voor alle apps gelijk, check_app bewaakt dat); seconden in de aankooptijd.
- Een verloren antwoord bij exact gelijktijdig dezelfde wijziging (zeldzaam, één artikel).
- Eigenaren of "wie" bij artikelen, acties en handelingen (alleen "opdoor" voor "nieuw").
- "Gekocht vandaag" in plaats van de winkelmand: de mand wordt niet vanzelf leeg (een deel
  vrijdag, de rest zaterdag), dus "vandaag" past niet; de winkelmand blijft.

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
- Links bij acties alleen als ze met `https://` beginnen.

## 8. Bewuste afwijkingen van conventies.md (op te nemen in §4)

- Gegevens gaan naar de eigen OneDrive: netwerk en aanmelden.
- De app voegt wijzigingen van twee personen samen (events doet dat bewust
  niet).
- Lokaal eerst met een wachtrij, in plaats van "de tabel is het bestand".
- Toevoegen op een bestaande naam zet het bestaande artikel op de lijst, of
  heropent een afgeronde actie (events ontdubbelt bewust niet).
- Een soorticoon per rij.
- ISO-datums in plaats van de D-sleutel: geen andere app leest dit bestand.
- Drie accentkleuren met een kleurverloop in plaats van één kleur per app.
- Meldingen met Ongedaan maken verdwijnen na 6 s vanzelf (met aftelbalkje en een
  vinkje om meteen te sluiten); alle andere meldingen blijven tot je ze wegtikt.

Ook: aanvullen in `maak_zips.py`, `README.md` en `nieuwe-chat.txt`, en
controleren of `check_app.py` de app herkent. Token, wachtrij, "Ik ben", de
laatste winkel en de koppeling met de map horen in de reset.

## 9. Performance

- Eén keer parsen naar een Map op genormaliseerde naam.
- Na verversen alleen opnieuw tekenen als de eTag veranderde.
- Alleen de gefilterde, zichtbare lijst tekenen.
- Zoeken op een vooraf genormaliseerd veld.
- Het interval voor suggesties alleen herberekenen bij een nieuwe aankoop (per
  dag onthouden).
- Regels van Artikelen hergebruiken: alleen wat veranderde, opnieuw maken.
- Zoeken één keer per toets; acties één keer per wijziging berekenen.
- Na een sync zonder verandering niets opnieuw tekenen.
- Gemeten (telefoon-benadering, 5× trager): 300 artikelen ±30 ms per tik;
  1500 artikelen ±45 ms per tik, zoeken ±80 ms.
- Schrijfacties bundelen.

## 10. Risico's en de proef

Het grootste risico is het aanmelden in een geïnstalleerde PWA op Edge en
Android: komt de redirect van Microsoft terug in de app, en niet in een losse
browsertab? Daarom is stap 1 van de bouw een proef: aanmelden, de gedeelde map
via een deellink openen, een bestand lezen en met If-Match schrijven (en
controleren dat er 412 komt bij een tussentijdse wijziging), op Marks telefoon.
Pas daarna wordt de rest gebouwd.
