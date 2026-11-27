/* Controles voor thuis.html, met node:   node thuis-tests.cjs
   Met APP=<pad> een andere versie controleren (bijvoorbeeld de vorige), om te
   laten zien dat een nieuwe controle daar faalt. Exitcode 1 bij een fout.

   De functies worden uit de scripts van thuis.html geknipt en los uitgevoerd,
   zodat de tests geen browser nodig hebben. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = process.env.APP || path.join(__dirname, 'thuis.html');
const html = fs.readFileSync(APP, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');

let goed = 0, fout = 0;
/* Het oude regeltje ("3 + 4 Lasagne") als compacte vorm van wat voorVan teruggeeft (alleen voor de tests). */
const vt = (x) => !x.voor.length ? '' : (x.eigen ? x.eigen + ' + ' : '') + x.voor.map((v) => (x.voor.length === 1 && x.opvoor && v.aantal === x.opAantal ? '' : v.aantal + '\u00A0') + v.naam).join(' + ');
/* De receptnotities: [{ naam, notitie }] van de recepten waarvan het ingrediënt een notitie heeft. */
const rnotVan = (x) => x.voor.filter((v) => v.notitie).map((v) => ({ naam: v.naam, notitie: v.notitie }));
/* Ingrediënten als tekst; een lege notitie weggelaten (zoals in het bestand). */
const ingJ = (m) => JSON.stringify(Array.from(m, ([id, x]) => [id, x.notitie ? x : { naam: x.naam, aantal: x.aantal }]));
function controle(naam, fn) {
  try {
    const r = fn();
    if (r === true) { goed++; return; }
    fout++; console.log('FOUT  ' + naam + (r === false || r === undefined ? '' : ' — ' + r));
  } catch (e) {
    fout++; console.log('FOUT  ' + naam + ' — ' + e.message);
  }
}
function gelijk(a, b) { return a === b ? true : 'verwacht ' + JSON.stringify(b) + ', kreeg ' + JSON.stringify(a); }

/* Knipt "function naam(...) { ... }" uit de scripts, door accolades te tellen. */
function functieBron(naam) {
  const m = new RegExp('function\\s+' + naam + '\\s*\\(').exec(scripts);
  if (!m) throw new Error('functie ' + naam + ' niet gevonden');
  let i = scripts.indexOf('{', m.index), diep = 0;
  for (let j = i; j < scripts.length; j++) {
    if (scripts[j] === '{') diep++;
    else if (scripts[j] === '}' && --diep === 0) return scripts.slice(m.index, j + 1);
  }
  throw new Error('functie ' + naam + ' niet afgesloten');
}
function laad(...namen) {
  const ctx = vm.createContext({ btoa: (s) => Buffer.from(s, 'binary').toString('base64'), TextEncoder });
  vm.runInContext(namen.map(functieBron).join('\n'), ctx);
  return ctx;
}

/* ---------- browserherkenning ---------- */
const UA = {
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.2903.87',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  edgeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86'
};
controle('Edge op Android heet Edge (niet Chrome)', () => gelijk(laad('browserNaam').browserNaam(UA.edgeAndroid), 'Edge'));
controle('Chrome op Android heet Chrome', () => gelijk(laad('browserNaam').browserNaam(UA.chromeAndroid), 'Chrome'));
controle('Samsung Internet herkend', () => gelijk(laad('browserNaam').browserNaam(UA.samsung), 'Samsung Internet'));
controle('Edge op Windows heet Edge', () => gelijk(laad('browserNaam').browserNaam(UA.edgeDesktop), 'Edge'));

/* ---------- deellink naar /shares-sleutel ---------- */
controle('deellink wordt u!<base64url> zonder opvulling', () => {
  const link = 'https://1drv.ms/f/c/0123456789abcdef/IgBvoorbeeld?e=a1b2';
  const verwacht = 'u!' + Buffer.from(link).toString('base64url');
  return gelijk(laad('base64url', 'deelSleutel').deelSleutel('  ' + link + ' '), verwacht);
});

/* ---------- duur ---------- */
controle('duurTekst onder het uur', () => gelijk(laad('duurTekst').duurTekst(45 * 60000), '45 min'));
controle('duurTekst boven het uur', () => gelijk(laad('duurTekst').duurTekst(90 * 60000), '1 u 30 min'));
controle('duurTekst nooit negatief', () => gelijk(laad('duurTekst').duurTekst(-5 * 60000), '0 min'));

/* ---------- opbouw van de pagina ---------- */
controle('tabbalk heeft precies Winkels, Artikelen, Boodschappen, Doen en Instellingen', () => {
  const nav = (html.match(/<nav[\s\S]*?<\/nav>/) || [''])[0];
  const labels = [...nav.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  return gelijk(labels.join('|'), 'Winkels|Artikelen|Boodschappen|Doen|Instellingen');
});
controle('nieuwe-versie-melding aanwezig, alleen op de eigen cache (thuis-)', () => {
  if (!/async function checkAppUpdate\s*\(/.test(scripts)) return 'checkAppUpdate ontbreekt';
  return gelijk((scripts.match(/const CACHE_PREFIX = '([^']+)'/) || [])[1], 'thuis-');
});
controle('geen externe scripts', () => !/<script[^>]*\bsrc=/i.test(html) || 'er staat een <script src>');
controle('aanmelding niet in localStorage', () => !/localStorage\.setItem/.test(scripts) || 'localStorage.setItem gevonden');
controle('versiestempel aanwezig', () => /Versie [0-9A-F]{7}-[0-9A-F]{3}/.test(html));
controle('verborgen blijft verborgen, ook met een eigen display (deellinkvak na koppelen)', () =>
  /\[hidden\]\{display:none!important\}/.test(html) || 'regel [hidden]{display:none!important} ontbreekt');
controle('opslag wordt vastgezet (navigator.storage.persist), en getoond bij App', () =>
  (/navigator\.storage\.persist\(\)/.test(scripts) && /id="appOpslag"/.test(html)) || 'persist of de regel bij App ontbreekt');
controle('meldingen verdwijnen niet vanzelf, behalve Ongedaan maken (één timer, in ongedaanMelding)', () => {
  /* Elke setTimeout(…) met zijn volledige argumenten (haakjes geteld), in welke schrijfwijze ook. */
  const timers = [];
  for (let i = scripts.indexOf('setTimeout('); i !== -1; i = scripts.indexOf('setTimeout(', i + 1)) {
    let diepte = 0, j = i + 'setTimeout'.length;
    for (; j < scripts.length; j++) { if (scripts[j] === '(') diepte++; else if (scripts[j] === ')' && --diepte === 0) break; }
    const stuk = scripts.slice(i, j + 1);
    if (/meldingWeg/.test(stuk)) timers.push({ i, stuk });
  }
  if (timers.length !== 1) return 'verwacht 1 timer die een melding weghaalt, gevonden: ' + timers.map((t) => t.stuk.slice(0, 60)).join(' | ');
  const f = /function ongedaanMelding[\s\S]*?\n\}/.exec(scripts);
  return (!!f && timers[0].i >= f.index && timers[0].i < f.index + f[0].length) || 'de timer staat niet in ongedaanMelding';
});

/* ---------- service worker ---------- */
const swPad = path.join(path.dirname(APP), 'sw-thuis.js');
controle('service worker: eigen cachenaam en thuis.html in de verplichte lijst', () => {
  const sw = fs.readFileSync(swPad, 'utf8');
  if (!/const CACHE_NAME = 'thuis-v' \+ CACHE_VERSION;/.test(sw)) return 'cachenaam is niet thuis-v<n>';
  return /const VERPLICHT = \['\.\/thuis\.html'\];/.test(sw) || 'thuis.html staat niet in VERPLICHT';
});


/* ================= kern: bestand en samenvoegen ================= */
function kern() {
  const m = /\/\* == kern == \*\/([\s\S]*?)\/\* == einde kern == \*\//.exec(scripts);
  if (!m) throw new Error('kernblok ontbreekt');
  /* De klok staat vast op 26 nov 2026 (jaartal alleen als het niet dit jaar is), zodat de tests ook volgend jaar kloppen. */
  class VasteDatum extends Date { constructor(...a) { super(...(a.length ? a : [2026, 10, 26, 12, 0])); } static now() { return new VasteDatum().getTime(); } }
  const ctx = vm.createContext({ TextDecoder, Intl, Map, Set, Date: VasteDatum, JSON, URL });
  vm.runInContext(m[1] + '\n;this.__k = { FORMAAT, normNaam, zoekVorm, schoonTekst, schoonNotitie, leegModel, maakId, leesBestand, schrijfBestand, migreren, MIGRATIES, recordSleutel, HANDELINGEN, instelling, INSTELLINGEN, wekelijksMoment, recordUitJson, recordNaarJson, pasToe, pasAllesToe, vervangIds, wekelijksTerug, opruimen, synchroniseer, backupsWeg, laatsteMoment, tijdstipTekst, artikelLijst, winkelLijst, winkelIndeling, winkelAanbod, winkelTellingen, teKoopIn, afdelingIn, suggestie, suggestieTekst, gekochtTekst, zoekArtikelen, winkelZoek, veiligeLink, linkNaam, linkVanInvoer, linkTekst, periodeGrenzen, verschuif, volgendeKeer, actieGroep, inDoenFilter, naarSoort, periodeTekst, herhaalTekst, actieLijst, tagsVan, zoekPast, tagTelling, receptLijst, voorVan };', ctx);
  return ctx.__k;
}
const K = kern();
const NU = new Date(2026, 10, 21, 10, 0); // za 21-11-2026 10:00 lokale tijd
/* Een bestand opbouwen: B({ winkels, artikelen, ... }) → JSON-tekst met versie. */
const B = (delen) => JSON.stringify(Object.assign({ versie: K.FORMAAT }, delen));
const lees = (delen) => { const r = kern().leesBestand(typeof delen === 'string' ? delen : B(delen)); if (!r.ok) throw new Error(r.reden + ' ' + (r.detail || '')); return r.model; };
const uit = (k, m) => JSON.parse(k.schrijfBestand(m));
const H = (x) => Object.assign({ t: '2026-11-21T10:00' }, x);
const VB = {
  instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } },
  winkels: {
    ah001: { naam: 'Albert Heijn', afdelingen: [{ id: 'agf01', naam: 'Groente & fruit' }, { id: 'zui01', naam: 'Zuivel' }] },
    plu01: { naam: 'Plus', afdelingen: [{ id: 'koe02', naam: 'Koeling' }] },
    gam01: { naam: 'Gamma', afdelingen: [{ id: 'ijz03', naam: 'IJzerwaren' }] }
  },
  artikelen: {
    ban01: { naam: 'Bananen', soort: 'wekelijks', ligt: { ah001: 'agf01' }, gekocht: ['2026-11-07', '2026-11-14'] },
    mel01: { naam: 'Melk', soort: 'wekelijks', ligt: { ah001: 'zui01', plu01: 'koe02' }, op: '2026-11-14T06:00' },
    sch01: { naam: 'Schroeven', soort: 'eenmalig', ligt: { gam01: 'ijz03' }, op: '2026-11-20T09:00' },
    cad01: { naam: 'Cadeau', soort: 'eenmalig', op: '2026-11-20T09:00' },
    kof01: { naam: 'Koffie', soort: 'regelmatig', ligt: { ah001: '' }, gekocht: ['2026-10-03', '2026-10-24'] }
  },
  acties: { act01: { naam: 'Schilder bellen', notitie: 'na 17 uur' } }
};

/* ---------- bestand ---------- */
controle('bestand: lezen en terugschrijven verliest niets', () => {
  const o = uit(K, lees(VB));
  const opSleutel = (x) => Object.keys(x).sort().map((k) => k + JSON.stringify(x[k])).join();
  return gelijk(['winkels', 'artikelen', 'acties', 'instellingen'].map((d) => opSleutel(o[d])).join('|'), ['winkels', 'artikelen', 'acties', 'instellingen'].map((d) => opSleutel(VB[d])).join('|'));
});
controle('bestand: precies deze opmaak (versie, één record per regel op naam, lege delen kort)', () => gelijk(
  K.schrijfBestand(lees({ winkels: { w2222: { naam: 'Plus' }, w1111: { naam: 'AH', afdelingen: [{ id: 'a1111', naam: 'Zuivel' }] } }, artikelen: { p1111: { naam: 'Melk', soort: 'wekelijks', ligt: { w1111: 'a1111', w2222: '' }, gekocht: ['2026-11-14'] } } })),
  '{\n"versie": "' + K.FORMAAT + '",\n"instellingen": {},\n"winkels": {\n "w1111": {"naam":"AH","afdelingen":[{"id":"a1111","naam":"Zuivel"}]},\n "w2222": {"naam":"Plus"}\n},\n' +
  '"artikelen": {\n "p1111": {"naam":"Melk","soort":"wekelijks","ligt":{"w1111":"a1111","w2222":""},"gekocht":["2026-11-14"]}\n},\n"recepten": {},\n"acties": {}\n}\n'));
controle('bestand: schrijven is stabiel', () => { const een = K.schrijfBestand(lees(VB)); return gelijk(K.schrijfBestand(K.leesBestand(een).model), een); });
controle('bestand: BOM genegeerd bij lezen, nooit geschreven (L7)', () => { const r = K.leesBestand('﻿' + B({})); return gelijk(r.ok + '|' + (K.schrijfBestand(r.model).charCodeAt(0) === 0xFEFF), 'true|false'); });
controle('bestand: geen geldige UTF-8 wordt niet gelezen', () => gelijk(K.leesBestand(new Uint8Array([0x7B, 0x7D, 0xFF])).reden, 'geen-utf8'));
controle('bestand: kapotte JSON wordt niet gelezen', () => gelijk([K.leesBestand('{"versie": "' + K.FORMAAT + '", "artikelen": {').reden, K.leesBestand('[1]').reden].join(), 'geen-json,geen-json'));
controle('bestand: versie — nieuwer weigert (melding bijwerken), ouder of ontbrekend ook; leeg is niet geldig (B1)', () => gelijk(
  [K.leesBestand('{"versie": "FFFFFFFF-FFFF"}').reden, K.leesBestand('{"versie": "1352902-3FF"}').reden, K.leesBestand('{}').reden, K.leesBestand('').reden, K.leesBestand(' \n').reden].join(),
  'nieuwer-formaat,onbekend-formaat,onbekend-formaat,leeg,leeg'));
controle('ronde: een leeg bestand op OneDrive wordt niet overschreven (B1)', () => {
  const r = K.synchroniseer('', [{ actie: 'nieuw', soort: 'artikel', id: 'mel01', velden: { naam: 'Melk' } }], NU);
  return gelijk(r.ok + '|' + r.reden + '|' + (r.tekst === undefined), 'false|leeg|true');
});
const OPBOUW = [
  ['artikelen is een lijst', { artikelen: [] }],
  ['artikel is tekst', { artikelen: { p1111: 'Melk' } }],
  ['artikel zonder naam', { artikelen: { p1111: { soort: 'eenmalig' } } }],
  ['onbekende soort', { artikelen: { p1111: { naam: 'Melk', soort: 'maandelijks' } } }],
  ['op is een getal', { artikelen: { p1111: { naam: 'Melk', op: 5 } } }],
  ['gekocht geen datums', { artikelen: { p1111: { naam: 'Melk', gekocht: ['gisteren'] } } }],
  ['ligt is een lijst', { artikelen: { p1111: { naam: 'Melk', ligt: ['w1111'] } } }],
  ['afdelingen geen lijst', { winkels: { w1111: { naam: 'AH', afdelingen: 'Zuivel' } } }],
  ['dubbele afdeling-id', { winkels: { w1111: { naam: 'AH', afdelingen: [{ id: 'a1111', naam: 'X' }, { id: 'a1111', naam: 'Y' }] } } }],
  ['ongeldige id (__proto__)', { winkels: { __proto__x: { naam: 'AH' } } }],
  ['actie-veld geen tekst', { acties: { a1111: { naam: 'Bellen', notitie: 3 } } }],
  ['instelling geen object', { instellingen: { wekelijks: 'za' } }]
];
for (const [naam, delen] of OPBOUW) {
  controle('bestand: verkeerde opbouw wordt niet gelezen (dan schrijft de app niets) — ' + naam, () => gelijk(K.leesBestand(B(delen)).reden, 'onjuiste-opbouw'));
}
controle('bestand: een id "__proto__" (ook als sleutel in JSON) wordt geweigerd, niets vervuild', () => {
  const r = K.leesBestand('{"versie": "' + K.FORMAAT + '", "winkels": {"__proto__": {"naam": "X"}}}');
  return gelijk(r.reden + '|' + ({}).naam, 'onjuiste-opbouw|undefined');
});
controle('bestand: onbekende delen en velden blijven staan', () => {
  const o = uit(K, lees({ artikelen: { p1111: { naam: 'Thee', kleur: 'groen', maat: { l: 2 } } }, winkels: { w1111: { naam: 'AH', afdelingen: [{ id: 'a1111', naam: 'Z', kleur: 'rood' }], open: '8-20' } }, toekomst: [1, 2] }));
  return gelijk(JSON.stringify([o.artikelen.p1111, o.winkels.w1111, o.toekomst]),
    '[{"naam":"Thee","soort":"eenmalig","kleur":"groen","maat":{"l":2}},{"naam":"AH","afdelingen":[{"id":"a1111","naam":"Z","kleur":"rood"}],"open":"8-20"},[1,2]]');
});
controle('bestand: verwijzing naar een verdwenen winkel of afdeling wordt stil rechtgezet (en gelogd)', () => {
  const m = lees({ winkels: { w1111: { naam: 'AH', afdelingen: [{ id: 'a1111', naam: 'Z' }] } }, artikelen: { p1111: { naam: 'Melk', ligt: { w1111: 'a9999', w9999: '' } } } });
  return gelijk(JSON.stringify(uit(K, m).artikelen.p1111.ligt) + '|' + m.opgelost.length, '{"w1111":""}|2');
});
controle('bestand: ; | : = en " in namen zijn geen probleem', () => {
  const n = 'AH: 1+1=2; "x" | y';
  return gelijk(uit(K, K.leesBestand(K.schrijfBestand(lees({ winkels: { w1111: { naam: n } } }))).model).winkels.w1111.naam, n);
});
controle('id: vijf tekens zonder 0 o 1 l i, uniek binnen het model', () => {
  const m = lees({ winkels: { aaaaa: { naam: 'X' } } });
  let i = 0; const reeks = [[0, 0, 0, 0, 0], [1, 2, 3, 4, 5]];
  const id = K.maakId(m, () => reeks[i++]);
  return gelijk(id + '|' + /^[a-hj-km-np-z2-9]{5}$/.test(id), 'bcdef|true');
});
controle('id: ook uniek tegenover ingrediënten van recepten', () => {
  const m = lees({ recepten: { r2222: { naam: 'Soep', ingredienten: { aaaaa: { naam: 'Prei', aantal: '1' } } } } });
  let i = 0; const reeks = [[0, 0, 0, 0, 0], [1, 2, 3, 4, 5]];
  return gelijk(K.maakId(m, () => reeks[i++]), 'bcdef');
});
controle('notitie: meer regels blijven; per regel opgeschoond, geen lege regels aan begin/eind, hooguit één lege regel', () =>
  gelijk(JSON.stringify(K.schoonNotitie('\n\n  Halfvol  \r\nNiet  de grote\n\n\n\nVraag <b>Natasja</b>\n\n')), JSON.stringify('Halfvol\nNiet de grote\n\nVraag Natasja')));
controle('invoer: stuurtekens en spaties opgeschoond', () => gelijk(K.schoonTekst('  Melk;\nhalfvol | 1 L  '), 'Melk; halfvol | 1 L'));
controle('naam vergelijken: hoofdletters, spaties en NFC', () => gelijk(K.normNaam('  Crème   Fraîche ') === K.normNaam('crème fraîche'), true));

/* ---------- samenvoegen ---------- */
controle('nieuw: artikel komt erin met id', () => {
  const k = kern(); const m = lees(VB);
  const r = k.pasToe(m, H({ actie: 'nieuw', soort: 'artikel', id: 'pes01', velden: { naam: 'Pesto', soort: 'eenmalig', op: '2026-11-21T10:00', opdoor: 'Mark' } }));
  return gelijk(r.status + '|' + JSON.stringify(uit(k, m).artikelen.pes01), 'ok|{"naam":"Pesto","soort":"eenmalig","op":"2026-11-21T10:00","opdoor":"Mark"}');
});
controle('nieuw: twee telefoons maken offline allebei "melk" → samengevoegd, en hij komt op de lijst', () => {
  const k = kern(); const m = lees({ artikelen: { mel01: { naam: 'Melk' } } });
  const { resultaten, alias } = k.pasAllesToe(m, [
    H({ actie: 'nieuw', soort: 'artikel', id: 'xyz99', velden: { naam: ' melk ', op: '2026-11-21T10:00', opdoor: 'Mark' } }),
    H({ actie: 'gekocht', soort: 'artikel', id: 'xyz99', datum: '2026-11-21' })
  ]);
  return gelijk(resultaten.map((r) => r.status).join() + '|' + alias.get('xyz99') + '|' + JSON.stringify(uit(k, m).artikelen),
    'samengevoegd,ok|mel01|{"mel01":{"naam":"Melk","soort":"eenmalig","op":"2026-11-21T10:00","opdoor":"Mark","gekocht":["2026-11-21"]}}');
});
controle('nieuw: zelfde id nogmaals is "al"', () => {
  const k = kern(); const m = lees(VB);
  return gelijk(k.pasToe(m, H({ actie: 'nieuw', soort: 'winkel', id: 'ah001', velden: { naam: 'Albert Heijn' } })).status, 'al');
});
controle('zet: allebei op de lijst is geen botsing', () => gelijk(kern().pasToe(lees(VB), H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:58' })).status, 'al'));
controle('zet: echte botsing wint de laatste, met de vorige waarde', () => {
  const k = kern(); const m = lees(VB);
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'actie', id: 'act01', veld: 'notitie', oud: '', nieuw: 'nummer in mail' }));
  return gelijk(r.status + '|' + r.vorige + '|' + uit(k, m).acties.act01.notitie, 'botsing|na 17 uur|nummer in mail');
});
controle('zet: alleen bekende velden (geen afdelingen overschrijven met tekst)', () => {
  const k = kern(); const m = lees(VB);
  return gelijk([k.pasToe(m, H({ actie: 'zet', soort: 'winkel', id: 'ah001', veld: 'afdelingen', oud: '', nieuw: 'x' })).status,
    k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'soort', oud: 'wekelijks', nieuw: 'soms' })).status].join(), 'vervallen,vervallen');
});
controle('hernoemen: alleen de naam verandert, verwijzingen blijven kloppen (zelfde id)', () => {
  const k = kern(); const m = lees(VB);
  k.pasToe(m, H({ actie: 'zet', soort: 'winkel', id: 'ah001', veld: 'naam', oud: 'Albert Heijn', nieuw: 'AH' }));
  const o = uit(k, m);
  return gelijk(o.winkels.ah001.naam + '|' + JSON.stringify(o.artikelen.mel01.ligt), 'AH|{"ah001":"zui01","plu01":"koe02"}');
});
controle('hernoemen naar een bezette naam vervalt', () => gelijk(kern().pasToe(lees(VB), H({ actie: 'zet', soort: 'winkel', id: 'plu01', veld: 'naam', oud: 'Plus', nieuw: 'albert heijn' })).reden, 'naam-bezet'));
controle('handeling op een verwijderd artikel vervalt (geen zombie)', () => {
  const k = kern(); const m = lees(VB);
  k.pasToe(m, H({ actie: 'weg', soort: 'artikel', id: 'kof01' }));
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'kof01', veld: 'op', oud: '', nieuw: '2026-11-21T10:00' }));
  return gelijk(r.status + '|' + ('kof01' in uit(k, m).artikelen), 'vervallen|false');
});
controle('gekocht: laatste zes, gesorteerd, zonder dubbele; nietGekocht haalt weg', () => {
  const k = kern(); const m = lees({ artikelen: { kaa01: { naam: 'Kaas', gekocht: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'] } } });
  k.pasToe(m, H({ actie: 'gekocht', soort: 'artikel', id: 'kaa01', datum: '2026-11-21' }));
  k.pasToe(m, H({ actie: 'gekocht', soort: 'artikel', id: 'kaa01', datum: '2026-11-21' }));
  const a = uit(k, m).artikelen.kaa01.gekocht.join();
  k.pasToe(m, H({ actie: 'nietGekocht', soort: 'artikel', id: 'kaa01', datum: '2026-11-21' }));
  return gelijk(a + '|' + uit(k, m).artikelen.kaa01.gekocht.length, '2026-02-01,2026-03-01,2026-04-01,2026-05-01,2026-06-01,2026-11-21|5');
});

/* ---------- winkels en afdelingen ---------- */
controle('plaats: in een tweede winkel, afdeling vervangen; onbekende afdeling wordt leeg; verwijderde winkel vervalt', () => {
  const k = kern(); const m = lees(VB);
  const s = [k.pasToe(m, H({ actie: 'plaats', soort: 'artikel', id: 'ban01', winkel: 'plu01', afd: 'koe02' })).status,
    k.pasToe(m, H({ actie: 'plaats', soort: 'artikel', id: 'ban01', winkel: 'ah001', afd: 'bestaatniet' })).status,
    k.pasToe(m, H({ actie: 'plaats', soort: 'artikel', id: 'ban01', winkel: 'weg99', afd: '' })).status];
  return gelijk(s.join() + '|' + JSON.stringify(uit(k, m).artikelen.ban01.ligt), 'ok,ok,vervallen|{"ah001":"","plu01":"koe02"}');
});
controle('plaats: twee telefoons in verschillende winkels botst niet', () => {
  const k = kern(); const m = lees(VB);
  const s = k.pasAllesToe(m, [H({ actie: 'plaats', soort: 'artikel', id: 'cad01', winkel: 'ah001', afd: 'zui01' }), H({ actie: 'plaats', soort: 'artikel', id: 'cad01', winkel: 'plu01', afd: '' })]);
  return gelijk(s.resultaten.map((r) => r.status).join() + '|' + JSON.stringify(uit(k, m).artikelen.cad01.ligt), 'ok,ok|{"ah001":"zui01","plu01":""}');
});
controle('afdeling erbij: achteraan; dezelfde naam bestaat al → samengevoegd, de plaatsing erna gebruikt de bestaande', () => {
  const k = kern(); const m = lees(VB);
  const s = k.pasAllesToe(m, [
    H({ actie: 'afdErbij', soort: 'winkel', id: 'ah001', afd: { id: 'bro01', naam: 'Brood' } }),
    H({ actie: 'afdErbij', soort: 'winkel', id: 'ah001', afd: { id: 'zzz99', naam: 'zuivel' } }),
    H({ actie: 'plaats', soort: 'artikel', id: 'cad01', winkel: 'ah001', afd: 'zzz99' })]);
  const o = uit(k, m);
  return gelijk(s.resultaten.map((r) => r.status).join() + '|' + o.winkels.ah001.afdelingen.map((a) => a.naam).join() + '|' + o.artikelen.cad01.ligt.ah001,
    'ok,samengevoegd,ok|Groente & fruit,Zuivel,Brood|zui01');
});
controle('afdeling hernoemen: alleen in die winkel; bezette naam vervalt', () => {
  const k = kern(); const m = lees(VB);
  const r1 = k.pasToe(m, H({ actie: 'afdHernoem', soort: 'winkel', id: 'ah001', afd: 'zui01', naam: 'Zuivel & eieren' })).status;
  const r2 = k.pasToe(m, H({ actie: 'afdHernoem', soort: 'winkel', id: 'ah001', afd: 'agf01', naam: 'zuivel & eieren' })).reden;
  return gelijk(r1 + '|' + r2 + '|' + uit(k, m).winkels.ah001.afdelingen[1].naam + '|' + uit(k, m).winkels.plu01.afdelingen[0].naam, 'ok|naam-bezet|Zuivel & eieren|Koeling');
});
controle('afdeling weghalen: artikel blijft te koop in die winkel, afdeling onbekend; ongedaan maken zet het terug', () => {
  const k = kern(); const m = lees(VB);
  k.pasToe(m, H({ actie: 'afdWeg', soort: 'winkel', id: 'ah001', afd: 'zui01' }));
  const tussen = JSON.stringify(uit(k, m).artikelen.mel01.ligt);
  k.pasToe(m, H({ actie: 'terug', soort: 'afdeling', winkel: 'ah001', afd: { id: 'zui01', naam: 'Zuivel' }, plaats: 1, artikelen: ['mel01'] }));
  const o = uit(k, m);
  return gelijk(tussen + '|' + o.winkels.ah001.afdelingen.map((a) => a.id).join() + '|' + o.artikelen.mel01.ligt.ah001, '{"ah001":"","plu01":"koe02"}|agf01,zui01|zui01');
});
controle('volgorde: wat de ander intussen toevoegde blijft achteraan', () => {
  const k = kern(); const m = lees({ winkels: { w1111: { naam: 'AH', afdelingen: [{ id: 'aaaaa', naam: 'A' }, { id: 'bbbbb', naam: 'B' }, { id: 'ccccc', naam: 'C' }] } } });
  k.pasToe(m, H({ actie: 'afdErbij', soort: 'winkel', id: 'w1111', afd: { id: 'ddddd', naam: 'D' } }));
  const r = k.pasToe(m, H({ actie: 'volgorde', soort: 'winkel', id: 'w1111', volgorde: ['ccccc', 'aaaaa', 'bbbbb', 'xxxxx'] }));
  return gelijk(r.status + '|' + uit(k, m).winkels.w1111.afdelingen.map((a) => a.naam).join(''), 'ok|CABD');
});
controle('winkel verwijderen haalt hem ook weg bij de artikelen; ongedaan maken zet winkel en plekken terug (zelfde id)', () => {
  const k = kern(); const m = lees(VB);
  const record = k.recordNaarJson('winkel', m.winkels.get('plu01'));
  k.pasToe(m, H({ actie: 'weg', soort: 'winkel', id: 'plu01' }));
  const tussen = JSON.stringify(uit(k, m).artikelen.mel01.ligt);
  const r = k.pasToe(m, H({ actie: 'terug', soort: 'winkel', id: 'plu01', record, ligt: { mel01: 'koe02' } }));
  return gelijk(tussen + '|' + r.status + '|' + JSON.stringify(uit(k, m).artikelen.mel01.ligt) + '|' + uit(k, m).winkels.plu01.naam,
    '{"ah001":"zui01"}|ok|{"ah001":"zui01","plu01":"koe02"}|Plus');
});
controle('vervangIds: alle id-velden van een handeling', () => {
  const k = kern();
  const al = new Map([['x', 'X'], ['w', 'W'], ['a', 'A']]);
  const p = k.vervangIds({ actie: 'plaats', id: 'x', winkel: 'w', afd: 'a' }, al);
  const v = k.vervangIds({ actie: 'volgorde', id: 'w', volgorde: ['a', 'b'] }, al);
  const t = k.vervangIds({ actie: 'terug', soort: 'afdeling', winkel: 'w', afd: { id: 'a', naam: 'Zuivel' }, artikelen: ['x'] }, al);
  const e = k.vervangIds({ actie: 'afdErbij', id: 'w', afd: { id: 'a', naam: 'Zuivel' } }, al);
  return gelijk([p.id, p.winkel, p.afd, v.id, v.volgorde.join(''), t.winkel, t.afd.id, t.artikelen[0], e.id, e.afd.id].join(''), 'XWAWAbWAXWA');
});
controle('vervangIds: ook de sleutels en waarden van ligt bij terugzetten (winkel en artikel)', () => {
  const k = kern(); const al = new Map([['x', 'X'], ['w', 'W'], ['a', 'A']]);
  const tw = k.vervangIds({ actie: 'terug', soort: 'winkel', id: 'w', record: { naam: 'Plus' }, ligt: { x: 'a', y: '' } }, al);
  const ta = k.vervangIds({ actie: 'terug', soort: 'artikel', id: 'x', record: { naam: 'Melk', ligt: { w: 'a' } } }, al);
  return gelijk([tw.id, JSON.stringify(tw.ligt), ta.id, JSON.stringify(ta.record.ligt), ta.record.naam].join('|'), 'W|{"X":"A","y":""}|X|{"W":"A"}|Melk');
});
controle('handelingen: elke soort zegt welke velden een id bevatten', () => {
  const k = kern();
  const zonder = Object.keys(k.HANDELINGEN).filter((n) => !Array.isArray(k.HANDELINGEN[n].ids));
  return gelijk(zonder.join(), '');
});

controle('instelling: wekelijks dag en tijd zetten; ongeldige waarden vervallen', () => {
  const k = kern(); const m = lees(VB);
  const r = [k.pasToe(m, H({ actie: 'instelling', naam: 'wekelijks', veld: 'dag', oud: 'za', nieuw: 'vr' })).status,
    k.pasToe(m, H({ actie: 'instelling', naam: 'wekelijks', veld: 'tijd', oud: '06:00', nieuw: '18:30' })).status,
    k.pasToe(m, H({ actie: 'instelling', naam: 'wekelijks', veld: 'dag', nieuw: 'vrijdag' })).status,
    k.pasToe(m, H({ actie: 'instelling', naam: 'wekelijks', veld: 'tijd', nieuw: '25:00' })).status,
    k.pasToe(m, H({ actie: 'instelling', naam: 'iets', veld: 'x', nieuw: 'y' })).status];
  const w = uit(k, m).instellingen.wekelijks;
  return gelijk(r.join() + '|' + w.dag + ' ' + w.tijd, 'ok,ok,vervallen,vervallen,vervallen|vr 18:30');
});

/* ---------- wekelijks terug ---------- */
controle('wekelijks: laatste zaterdag 06:00 wordt goed berekend', () => gelijk(K.tijdstipTekst(K.laatsteMoment(NU, 'za', '06:00')), '2026-11-21T06:00'));
controle('wekelijks: vóór 06:00 telt nog de vorige zaterdag', () => gelijk(K.tijdstipTekst(K.laatsteMoment(new Date(2026, 10, 21, 5, 59), 'za', '06:00')), '2026-11-14T06:00'));
controle('wekelijks: niet-gekochte wekelijkse artikelen komen terug, één keer', () => {
  const k = kern(); const m = lees(VB);
  const n1 = k.wekelijksTerug(m, NU), n2 = k.wekelijksTerug(m, NU);
  return gelijk(n1 + '|' + n2 + '|' + uit(k, m).artikelen.ban01.op, '1|0|2026-11-21T06:00');
});
controle('wekelijks: na het moment gekocht komt niet terug (telefoon die offline was)', () => {
  const k = kern(); const vb = JSON.parse(JSON.stringify(VB)); vb.artikelen.ban01.gekocht = ['2026-11-14', '2026-11-21'];
  const m = lees(vb);
  return gelijk(k.wekelijksTerug(m, NU) + '|' + (uit(k, m).artikelen.ban01.op || ''), '0|');
});
controle('wekelijks: niet automatisch legt het moment vast maar zet niets op de lijst; zonder veld = niet automatisch (standaard uit)', () => {
  const k = kern(); const vb = JSON.parse(JSON.stringify(VB)); vb.instellingen.wekelijks.auto = 'nee';
  const m = lees(vb);
  const n = k.wekelijksTerug(m, NU);
  return gelijk(n + '|' + (uit(k, m).artikelen.ban01.op || '') + '|' + uit(k, m).instellingen.wekelijks.teruggezet + '|' + k.instelling(lees(B({})), 'wekelijks', 'auto'), '0||2026-11-21T06:00|nee');
});
controle('wekelijks: eerste keer legt alleen het moment vast', () => {
  const k = kern(); const m = lees({ instellingen: { wekelijks: { dag: 'za', tijd: '06:00' } }, artikelen: { bro01: { naam: 'Brood', soort: 'wekelijks' } } });
  return gelijk(k.wekelijksTerug(m, NU) + '|' + JSON.stringify(uit(k, m).instellingen.wekelijks), '0|{"dag":"za","tijd":"06:00","teruggezet":"2026-11-21T06:00"}');
});

controle('aantal: 2 t/m 99 als tekst; ongeldig aantal in het bestand of in een handeling wordt niet aangenomen', () => {
  const k = kern();
  const m = lees({ artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', aantal: '3' } } });
  const ok = k.pasToe(m, { actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'aantal', oud: '3', nieuw: '' }).status;
  const fout1 = k.pasToe(m, { actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'aantal', oud: '', nieuw: '1' }).status;
  const fout2 = k.leesBestand(JSON.stringify({ versie: k.FORMAAT, artikelen: { mel01: { naam: 'Melk', aantal: 2 } } })).ok;
  return gelijk(ok + '|' + fout1 + '|' + fout2 + '|' + JSON.stringify(uit(k, m).artikelen.mel01), 'ok|vervallen|false|{"naam":"Melk","soort":"wekelijks"}');
});

controle('platte tekst: HTML-tags gaan eruit, losse < > blijven (B9); onzichtbare en richting-tekens weg (K20)', () => gelijk([
  K.schoonTekst(' Kaas <img src=x onerror=1> en <b>brood</b> 3 > 2 '), K.schoonTekst('kip < 500 g en > 2 stuks'), K.schoonTekst('<3 <!-- x --> ok </div>'),
  K.schoonTekst('Me\u200Blk\u202Eabc\uFEFF'), K.schoonTekst('<script>alert(1)</script>')].join('|'),
  'Kaas en brood 3 > 2|kip < 500 g en > 2 stuks|<3 ok|Melkabc|alert(1)'));
controle('platte tekst: lange plak met veel < blijft snel (K10)', () => { const s = Date.now(); K.schoonTekst('<'.repeat(80000) + 'a'); return gelijk(Date.now() - s < 200, true); });
controle('herhalen: maandelijks onthoudt de dag: 31 jan → 28 feb → 31 mrt → 30 apr (K5)', () => gelijk([
  K.volgendeKeer('2026-01-31', 'maand', '2026-01-31', 31), K.volgendeKeer('2026-02-28', 'maand', '2026-02-28', 31), K.volgendeKeer('2026-03-31', 'maand', '2026-03-31', 31),
  K.volgendeKeer('2028-02-29', 'jaar', '2028-02-29', 29), K.volgendeKeer('2029-02-28', 'jaar', '2029-02-28', 29)].join(),
  '2026-02-28,2026-03-31,2026-04-30,2029-02-28,2030-02-28'));

controle('link: alleen https; zonder schema komt https:// ervoor; http, javascript, data, naam/wachtwoord en geen domein geweigerd', () => {
  const v = (x) => K.veiligeLink(x);
  return gelijk([v('ah.nl/melk'), v(' https://www.ah.nl/p?x=1 '), v('http://ah.nl'), v('javascript:alert(1)'), v('JavaScript:alert(1)'), v('data:text/html,x'),
    v('https://naam:geheim@ah.nl'), v('https://localhost'), v('https://192.168.1.1'), v('ah .nl'), v('//ah.nl'), v(''), v('https://' + 'a'.repeat(2000) + '.nl')].join('|'),
    'https://ah.nl/melk|https://www.ah.nl/p?x=1|||||||||https://ah.nl/||');
});
controle('link: korte naam is het domein zonder www', () => gelijk(K.linkNaam('https://www.ah.nl/x') + '|' + K.linkNaam('https://recepten.ah.nl/') , 'ah.nl|recepten.ah.nl'));
controle('link of zoekwoorden: alleen een adres als het er echt op lijkt (extensie of /); schema:// = moet een veilig adres zijn; de rest een Google-zoekopdracht', () => {
  const l = (x) => String(K.linkVanInvoer(x));
  const z = K.linkVanInvoer('  philips   hue e27 ');
  return gelijk([l('gamma.nl'), z, K.linkTekst(z), K.linkNaam(z), l('gamma'), l('http://ah.nl'), l('javascript:alert(1)'), l(''), l('x'.repeat(201)),
    K.linkTekst('https://ah.nl/'), K.linkNaam('https://www.google.com/search?q=a&tbm=isch'), l('tomaat & ui'),
    l('ah.nl/bonus'), l('Dr.Oetker'), l('AH:bonus'), K.linkTekst(K.linkVanInvoer('AH:bonus')), l('1/2'), l('ftp://ah.nl')].join('|'),
    'https://gamma.nl/|https://www.google.com/search?q=philips+hue+e27|philips hue e27|"philips hue e27"|https://www.google.com/search?q=gamma|null|https://www.google.com/search?q=javascript%3Aalert(1)||null|https://ah.nl/|google.com|https://www.google.com/search?q=tomaat+%26+ui|' +
    'https://ah.nl/bonus|https://www.google.com/search?q=Dr.Oetker|https://www.google.com/search?q=AH%3Abonus|AH:bonus|https://www.google.com/search?q=1%2F2|null');
});
controle('link: een onveilige link in een handeling of het bestand wordt niet aangenomen of niet getoond', () => {
  const k = kern();
  const m = lees({ artikelen: { mel01: { naam: 'Melk', link: 'javascript:alert(1)' } } });
  const st = k.pasToe(m, { actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'link', oud: 'javascript:alert(1)', nieuw: 'http://ah.nl' }).status;
  return gelijk(st + '|' + JSON.stringify(k.artikelLijst(m)[0].link), 'vervallen|""');
});

/* ---------- recepten ---------- */
const RB = { artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', aantal: '3' }, geh01: { naam: 'Gehakt', soort: 'eenmalig' }, bla01: { naam: 'Lasagnebladen', soort: 'eenmalig', weg: '2026-10-01' } },
  recepten: { las01: { naam: 'Lasagne', notitie: '#pasta', ingredienten: { mel01: { naam: 'Melk', aantal: '4' }, geh01: { naam: 'Gehakt', aantal: '2' }, bla01: { naam: 'Lasagnebladen', aantal: '1' } } },
    pan01: { naam: 'Pannenkoeken', ingredienten: { mel01: { naam: 'Melk', aantal: '2' } } } } };
const V = (m, id) => K.voorVan(m.artikelen.get(id));
controle('recepten: lezen en schrijven verliest niets; ongeldig aantal of artikel is onjuiste opbouw', () => {
  const o = uit(K, lees(RB));
  const fout1 = K.leesBestand(B({ recepten: { las01: { naam: 'Lasagne', ingredienten: { mel01: { naam: 'Melk', aantal: '0' } } } } })).reden;
  const fout2 = K.leesBestand(B({ artikelen: { mel01: { naam: 'Melk', op: '2026-11-21T10:00', voor: { las01: { naam: '', aantal: '4' } } } } })).reden;
  return gelijk(JSON.stringify(o.recepten) + '|' + fout1 + '|' + fout2, JSON.stringify(RB.recepten) + '|onjuiste-opbouw|onjuiste-opbouw');
});
controle('recepten: een bestand in het vorige formaat wordt omgezet (alleen het nummer)', () => {
  const r = K.leesBestand(JSON.stringify({ versie: '1352902-459', artikelen: { mel01: { naam: 'Melk' } } }));
  return gelijk(r.ok + '|' + r.omgezet + '|' + JSON.parse(K.schrijfBestand(r.model)).versie, 'true|true|' + K.FORMAAT);
});
controle('recepten: niet op de lijst → erop alleen voor het recept; regeltje en aantal', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'geh01', recept: 'las01', naam: 'Lasagne', aantal: '2', wie: 'Mark' }));
  const a = k.voorVan(m.artikelen.get('geh01'));
  return gelijk(m.artikelen.get('geh01').op + '|' + m.artikelen.get('geh01').opvoor + '|' + a.opAantal + '|' + vt(a), '2026-11-21T10:00|1|2|Lasagne');
});
controle('recepten: al op de lijst (3×) plus twee recepten → 9×, "3 + 4 Lasagne + 2 Pannenkoeken"', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'pan01', naam: 'Pannenkoeken', aantal: '2' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  const a = k.voorVan(m.artikelen.get('mel01'));
  return gelijk(a.opAantal + '|' + vt(a) + '|' + m.artikelen.get('mel01').opvoor, '9|3 + 4\u00A0Lasagne + 2\u00A0Pannenkoeken|');
});
controle('recepten: hernoemd → het regeltje noemt de nieuwe naam (en na verwijderen nog steeds)', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'recept', id: 'las01', veld: 'naam', oud: 'Lasagne', nieuw: 'Lasagne veggie' }));
  const a = vt(k.voorVan(m.artikelen.get('mel01'), m));
  k.pasToe(m, H({ actie: 'weg', soort: 'recept', id: 'las01' }));
  const b = vt(k.voorVan(m.artikelen.get('mel01'), m));
  return gelijk(a + '|' + b, 'Lasagne veggie|Lasagne veggie');
});
controle('recepten: eenmalig alleen voor een recept → geen normaal; wekelijks wel (vast + recepten = 7)', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'geh01', recept: 'las01', naam: 'Lasagne', aantal: '2' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  const g = k.voorVan(m.artikelen.get('geh01'), m), me = k.voorVan(m.artikelen.get('mel01'), m);
  return gelijk([g.opAantal, vt(g), g.normaal, me.opAantal, vt(me), me.normaal].join('|'), '2|Lasagne|0|4|Lasagne|7');
});
controle('lijstaantal: alleen deze keer; normaal 3 (doorgestreept), met recept normaal 7 en "2 + 4 Lasagne"; van de lijst = weg; vast aantal blijft', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '2' }));
  const a = k.voorVan(m.artikelen.get('mel01'), m);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  const b = k.voorVan(m.artikelen.get('mel01'), m);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-21T09:00', nieuw: '' }));
  const r = m.artikelen.get('mel01');
  return gelijk([a.opAantal, a.normaal, vt(a), b.opAantal, b.normaal, vt(b), r.opaantal, r.aantal].join('|'), '2|3||6|7|2 + 4\u00A0Lasagne||3');
});
controle('lijstaantal: niet op de lijst kan niet; eenmalig heeft geen lijstaantal; schrijven en lezen bewaart het; oud formaat wordt gelezen', () => {
  const k = kern(); const m = lees(RB);
  const niet = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '3' }));
  const na = m.artikelen.get('mel01').opaantal;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '5' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'geh01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'geh01', veld: 'opaantal', oud: '', nieuw: '3' }));
  const g = k.voorVan(m.artikelen.get('geh01'), m);
  const o = uit(k, m);
  const oud = k.leesBestand(JSON.stringify(Object.assign({}, o, { versie: '1352905-7DA' })));
  return gelijk([na, m.artikelen.get('geh01').opaantal, g.opAantal, g.normaal, o.artikelen.mel01.opaantal, oud.ok].join('|'), '||1|0|5|true');
});
controle('lijstaantal: ongeldig in het bestand (0, 150, tekst) wordt bij lezen rechtgezet naar leeg', () => {
  const m = lees({ artikelen: { a1111: { naam: 'Melk', soort: 'wekelijks', aantal: '3', op: '2026-11-21T09:00', opaantal: '150' }, a2222: { naam: 'Kaas', op: '2026-11-21T09:00', opaantal: '0' }, a3333: { naam: 'Brood', op: '2026-11-21T09:00', opaantal: 'x', opvoor: 'ja' } } });
  return gelijk(['a1111', 'a2222', 'a3333'].map((id) => m.artikelen.get(id).opaantal + '/' + m.artikelen.get(id).opvoor).join(',') + '|' + K.voorVan(m.artikelen.get('a1111'), m).opAantal, '/,/,/|3');
});
controle('lijstaantal: gelijktijdig gewijzigd → de laatste wint, zonder botsingsmelding', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '4' }));
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '5' }));
  return gelijk((r.status || r) + '|' + m.artikelen.get('mel01').opaantal, 'ok|5');
});
controle('alleen voor recepten en lijstaantal tegelijk: opvoor wist het lijstaantal, een later lijstaantal telt niet, + geeft het vaste aantal', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '5' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opvoor', oud: '', nieuw: '1' }));
  const na1 = m.artikelen.get('mel01').opaantal;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '6' }));
  const na2 = m.artikelen.get('mel01').opaantal;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-21T09:00', nieuw: '2026-11-21T09:05' }));
  const b = k.voorVan(m.artikelen.get('mel01'), m);
  const leesBeide = lees({ artikelen: { a1111: { naam: 'Melk', op: '2026-11-21T09:00', opvoor: '1', opaantal: '5', voor: { b2222: { naam: 'X', aantal: '2' } } } } }).artikelen.get('a1111').opaantal;
  return gelijk([na1, na2, b.opAantal, leesBeide].join('|'), '||7|');
});
controle('lijstaantal voor een eerdere keer (offline, intussen afgevinkt en opnieuw op de lijst) telt niet; voor deze keer wel', () => {
  const na = B({ artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', aantal: '2', op: '2026-11-25T09:00' } } });
  const r = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '3', keer: '2026-11-23T08:00' })], NU);
  const r2 = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '3', keer: '2026-11-25T09:00' })], NU);
  return gelijk((JSON.parse(r.tekst).artikelen.mel01.opaantal || '') + '|' + JSON.parse(r2.tekst).artikelen.mel01.opaantal, '|3');
});
controle('lijstaantal/alleen voor recepten van vóór het wekelijkse terugzetten, pas daarna binnen → vervalt (automatisch aan)', () => {
  const na = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } },
    artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', aantal: '3', op: '2026-11-18T09:00', voor: { las01: { naam: 'Lasagne', aantal: '4' } } } } });
  const r = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '1', t: '2026-11-20T17:00' }),
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opvoor', oud: '', nieuw: '1', t: '2026-11-20T17:05' })], NU);
  const m = JSON.parse(r.tekst).artikelen.mel01;
  const later = JSON.parse(K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opaantal', oud: '', nieuw: '2', t: '2026-11-21T09:00' })], NU).tekst).artikelen.mel01;
  return gelijk((m.opaantal || '') + '|' + (m.opvoor || '') + '|' + later.opaantal, '||2');
});
controle('recepten: zelf niet meer nodig (opvoor zetten) kan alleen als het voor een recept op de lijst staat', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' }));
  const zonder = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opvoor', oud: '', nieuw: '1' }));
  const na1 = m.artikelen.get('mel01').opvoor;
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'opvoor', oud: '', nieuw: '1' }));
  const a = k.voorVan(m.artikelen.get('mel01'), m);
  return gelijk(na1 + '|' + a.opAantal + '|' + a.opvoor, '|4|true');
});
controle('recepten: alleen voor een recept op de lijst, zelf erbij in dezelfde minuut → eigen aantal telt mee', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4', t: '2026-11-21T09:00' }));
  const op = m.artikelen.get('mel01').op;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: op, nieuw: op }));
  const a = k.voorVan(m.artikelen.get('mel01'), m);
  return gelijk(a.opAantal + '|' + vt(a) + '|' + a.opvoor, '7|3 + 4\u00A0Lasagne|false');
});
controle('recepten: wekelijks alleen voor twee recepten → 6×, "4 Lasagne + 2 Pannenkoeken", normaal 9 (doorgestreept); één eraf → alleen dat recept', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'pan01', naam: 'Pannenkoeken', aantal: '2' }));
  const a = k.voorVan(m.artikelen.get('mel01'));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', aantal: '' }));
  const b = k.voorVan(m.artikelen.get('mel01'));
  return gelijk(a.opAantal + '|' + vt(a) + '|' + b.opAantal + '|' + vt(b) + '|' + !!m.artikelen.get('mel01').op, '6|4\u00A0Lasagne + 2\u00A0Pannenkoeken|2|Pannenkoeken|true');
});
controle('recepten: laatste recept eraf terwijl het alleen daarvoor op de lijst stond → van de lijst; eenmalig naar het archief vanaf vandaag', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'bla01', recept: 'las01', naam: 'Lasagne', aantal: '1' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'bla01', recept: 'las01', aantal: '', t: '2026-11-22T10:00' }));
  const a = m.artikelen.get('bla01');
  return gelijk([a.op, a.opvoor, a.voor.size, a.weg].join('|'), '||0|2026-11-22');
});
controle('recepten: van de lijst of afgevinkt → recepten eraf; zelf op de lijst → eigen aantal telt weer mee', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4' }));
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T10:05' }));
  const zelf = k.voorVan(m.artikelen.get('mel01'));
  const op = m.artikelen.get('mel01').op;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: op, nieuw: '' }));
  const a = m.artikelen.get('mel01');
  return gelijk(zelf.opAantal + '|' + vt(zelf) + '|' + a.voor.size + '|' + a.opvoor + '|' + a.op, '7|3 + 4\u00A0Lasagne|0||');
});
controle('recepten: ingrediënt erbij, aantal en naam wijzigen, eruit; een artikel verwijderen raakt het recept niet', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'ei001', naam: 'Eieren', aantal: '3' }));
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'ei001', aantal: '4' }));
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'mel01', naam: 'Halfvolle melk' }));
  const a = ingJ(m.recepten.get('pan01').ingredienten);
  k.pasToe(m, H({ actie: 'weg', soort: 'artikel', id: 'geh01' }));
  const b = m.recepten.get('las01').ingredienten.has('geh01');
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'ei001', weg: true }));
  const ongeldig = [k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'mel01', aantal: '0' })).status, k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'nieuw', aantal: '2' })).status].join();
  return gelijk(a + '|' + b + '|' + m.recepten.get('pan01').ingredienten.size + '|' + ongeldig,
    '[["mel01",{"naam":"Halfvolle melk","aantal":"2"}],["ei001",{"naam":"Eieren","aantal":"4"}]]|true|1|vervallen,vervallen');
});
controle('recepten: twee keer dezelfde naam in één recept (tegelijk toegevoegd) → bij lezen samengevoegd, grootste aantal', () => {
  const m = lees({ recepten: { las01: { naam: 'Lasagne', ingredienten: { b2222: { naam: 'Eieren', aantal: '2' }, a1111: { naam: 'eieren', aantal: '1' }, c3333: { naam: 'Melk', aantal: '1' } } } } });
  return gelijk(ingJ(m.recepten.get('las01').ingredienten), '[["a1111",{"naam":"eieren","aantal":"2"}],["c3333",{"naam":"Melk","aantal":"1"}]]');
});
controle('recepten: verwijderen en Ongedaan maken (terug) zet het recept met zijn ingrediënten terug', () => {
  const k = kern(); const m = lees(RB);
  const record = k.recordNaarJson('recept', m.recepten.get('las01'));
  k.pasToe(m, H({ actie: 'weg', soort: 'recept', id: 'las01' }));
  const weg = m.recepten.has('las01');
  k.pasToe(m, H({ actie: 'terug', soort: 'recept', id: 'las01', record }));
  return gelijk(weg + '|' + Array.from(m.recepten.get('las01').ingredienten.values()).map((x) => x.naam + x.aantal).join(), 'false|Melk4,Gehakt2,Lasagnebladen1');
});
controle('ingrediënt: notitie zetten (opgeschoond, meer regels), gelijk = al, in het bestand alleen als er iets staat; geen tekst = ongeldig', () => {
  const k = kern(); const m = lees(RB);
  const st = [k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', notitie: '  Rundergehakt,  500 g\n\n\n#slager ' })).status,
    k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', notitie: 'Rundergehakt, 500 g\n\n#slager' })).status,
    k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', notitie: 5 })).status].join();
  const j = uit(k, m).recepten.las01.ingredienten;
  const m2 = lees(uit(k, m));
  return gelijk(st + '|' + JSON.stringify(j.geh01) + '|' + ('notitie' in j.mel01) + '|' + JSON.stringify(m2.recepten.get('las01').ingredienten.get('geh01').notitie),
    'ok,al,vervallen|{"naam":"Gehakt","aantal":"2","notitie":"Rundergehakt, 500 g\\n\\n#slager"}|false|"Rundergehakt, 500 g\\n\\n#slager"');
});
controle('ingrediënt: notitie die geen tekst is → bestand ongeldig; naam wijzigen houdt de notitie', () => {
  const r = K.leesBestand(JSON.stringify({ versie: K.FORMAAT, recepten: { las01: { naam: 'Lasagne', ingredienten: { geh01: { naam: 'Gehakt', aantal: '1', notitie: 3 } } } } }));
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', notitie: 'van de slager' }));
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', naam: 'Rundergehakt' }));
  const x = m.recepten.get('las01').ingredienten.get('geh01');
  return gelijk(r.ok + '|' + x.naam + '|' + x.notitie, 'false|Rundergehakt|van de slager');
});
controle('ingrediënt: dubbel bij lezen samengevoegd houdt een notitie', () => {
  const m = lees({ recepten: { las01: { naam: 'Lasagne', ingredienten: { a1111: { naam: 'Ei', aantal: '1' }, b2222: { naam: 'ei', aantal: '1', notitie: 'scharrel' } } } } });
  return gelijk(ingJ(m.recepten.get('las01').ingredienten), '[["a1111",{"naam":"Ei","aantal":"1","notitie":"scharrel"}]]');
});
controle('receptnotitie: op de lijst voor een recept → voor met receptnaam en notitie van het ingrediënt (via ing, anders op naam); # zoekt erin; van de lijst → weg', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'geh01', notitie: 'Rundergehakt #slager' }));
  k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'pan01', ingredient: 'mel01', notitie: 'Halfvol mag ook' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'geh01', recept: 'las01', naam: 'Lasagne', aantal: '2', ing: 'geh01' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'pan01', naam: 'Pannenkoeken', aantal: '2' }));
  const A = k.artikelLijst(m);
  const rn = (n) => JSON.stringify(rnotVan(A.find((a) => a.naam === n)));
  const z = k.zoekArtikelen(A, '#slag').map((a) => a.naam).join();
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'geh01', recept: 'las01', aantal: '', t: '2026-11-22T10:00' }));
  const na = k.artikelLijst(m).find((a) => a.naam === 'Gehakt');
  return gelijk(rn('Gehakt') + '|' + rn('Melk') + '|' + z + '|' + JSON.stringify(rnotVan(na)) + '|' + k.zoekArtikelen(k.artikelLijst(m), '#slag').length + '|' + m.artikelen.get('geh01').notitie,
    '[{"naam":"Lasagne","notitie":"Rundergehakt #slager"}]|[{"naam":"Pannenkoeken","notitie":"Halfvol mag ook"}]|Gehakt|[]|0|');
});
controle('migratie: 1352906-203 → huidig formaat zonder iets te veranderen', () => {
  const r = K.leesBestand(JSON.stringify({ versie: '1352906-203', recepten: { las01: { naam: 'Lasagne', ingredienten: { geh01: { naam: 'Gehakt', aantal: '1' } } } } }));
  return gelijk(r.ok + '|' + K.FORMAAT + '|' + ingJ(r.model.recepten.get('las01').ingredienten), 'true|1352906-59D|[["geh01",{"naam":"Gehakt","aantal":"1"}]]');
});
controle('recepten: voor onthoudt het ingrediënt (ing), ook na schrijven en lezen; zonder ing blijft het leeg', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4', ing: 'mel01' }));
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'pan01', naam: 'Pannenkoeken', aantal: '2' }));
  const m2 = lees(uit(k, m));
  return gelijk(Array.from(m2.artikelen.get('mel01').voor).map(([r, x]) => r + ':' + x.ing).join(), 'las01:mel01,pan01:');
});
controle('recepten: rondje op een artikel dat intussen elders is opgeruimd → het artikel komt terug en staat voor het recept op de lijst', () => {
  const na = B({ recepten: { las01: { naam: 'Lasagne', ingredienten: { bla01: { naam: 'Lasagnebladen', aantal: '1' } } } } });
  const record = { naam: 'Lasagnebladen', soort: 'eenmalig', weg: '2025-01-01' };
  const r = K.synchroniseer(na, [H({ actie: 'terug', soort: 'artikel', id: 'bla01', record }), H({ actie: 'voor', soort: 'artikel', id: 'bla01', recept: 'las01', naam: 'Lasagne', aantal: '1', ing: 'bla01', wat: 'Lasagnebladen' })], NU);
  const b = JSON.parse(r.tekst).artikelen.bla01;
  const bestaat = K.synchroniseer(B({ artikelen: { bla01: record } }), [H({ actie: 'terug', soort: 'artikel', id: 'bla01', record })], NU).resultaten.map((x) => x.status).join();
  return gelijk(!!b.op + '|' + JSON.stringify(b.voor) + '|' + bestaat, 'true|{"las01":{"naam":"Lasagne","aantal":"1","ing":"bla01"}}|al');
});
controle('recepten: tegelijk hetzelfde ingrediënt toegevoegd → meteen samengevoegd; latere wijziging volgt de bestaande id', () => {
  const k = kern(); const m = lees(RB);
  const r = k.pasAllesToe(m, [H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'x2222', naam: 'melk', aantal: '1' }),
    H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'x2222', aantal: '6' })]);
  return gelijk(r.resultaten.map((x) => x.status).join() + '|' + m.recepten.get('las01').ingredienten.size + '|' + m.recepten.get('las01').ingredienten.get('mel01').aantal, 'samengevoegd,ok|3|6');
});
controle('recepten: wijziging aan een ingrediënt dat de ander weghaalde → vervalt (zonder reden "ongeldig")', () => {
  const k = kern(); const m = lees(RB);
  const r = k.pasToe(m, H({ actie: 'ingredient', soort: 'recept', id: 'las01', ingredient: 'weg22', aantal: '3' }));
  return gelijk(r.status + '|' + (r.reden || ''), 'vervallen|');
});
controle('rechtzetten: "alleen voor recepten" zonder recept → weg', () => {
  const m = lees({ artikelen: { mel01: { naam: 'Melk', op: '2026-11-21T09:00', opvoor: '1' } } });
  return gelijk((m.artikelen.get('mel01').opvoor || '') + '|' + m.rechtgezet, '|1');
});
controle('recepten: recept verwijderen laat de lijst ongemoeid (naam blijft in het regeltje)', () => {
  const k = kern(); const m = lees(RB);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'geh01', recept: 'las01', naam: 'Lasagne', aantal: '2' }));
  k.pasToe(m, H({ actie: 'weg', soort: 'recept', id: 'las01' }));
  const a = k.voorVan(m.artikelen.get('geh01'));
  return gelijk(m.recepten.size + '|' + a.opAantal + '|' + vt(a), '1|2|Lasagne');
});
controle('recepten: wekelijks terug terwijl het alleen voor een recept op de lijst staat → eigen aantal erbij', () => {
  const k = kern(); const vb = JSON.parse(JSON.stringify(RB)); vb.instellingen = { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } };
  const m = lees(vb);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4', t: '2026-11-20T10:00' }));
  const n = k.wekelijksTerug(m, NU);
  const a = k.voorVan(m.artikelen.get('mel01'));
  return gelijk(n + '|' + a.opAantal + '|' + vt(a), '1|7|3 + 4\u00A0Lasagne');
});
controle('wekelijks terug: staat het er nog op, dan begint de week met het vaste aantal (lijstaantal weg); niet gekochte recepten blijven', () => {
  const k = kern(); const vb = JSON.parse(JSON.stringify(RB)); vb.instellingen = { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } };
  vb.artikelen.mel01.op = '2026-11-18T10:00'; vb.artikelen.mel01.opaantal = '6';
  const m = lees(vb);
  k.pasToe(m, H({ actie: 'voor', soort: 'artikel', id: 'mel01', recept: 'las01', naam: 'Lasagne', aantal: '4', t: '2026-11-20T10:00' }));
  const n = k.wekelijksTerug(m, NU);
  const a = k.voorVan(m.artikelen.get('mel01'), m);
  return gelijk([n, a.opAantal, vt(a), a.normaal, m.artikelen.get('mel01').opaantal].join('|'), '1|7|3 + 4\u00A0Lasagne|0|');
});
controle('wekelijks: laat binnenkomend afvinken van vorige week → blijft op de lijst, recepten van toen eraf (gekocht)', () => {
  const na = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } },
    recepten: { las01: { naam: 'Lasagne', artikelen: { mel01: '4' } } },
    artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', aantal: '2', op: '2026-11-21T06:00', voor: { las01: { naam: 'Lasagne', aantal: '4' } } } } });
  const r = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '', t: '2026-11-20T17:00' })], NU);
  const b = JSON.parse(r.tekst).artikelen.mel01;
  return gelijk([b.op, b.voor === undefined, b.opvoor || ''].join('|'), '2026-11-21T06:00|true|');
});
controle('recepten: oud formaat (artikel-id → aantal) wordt bij lezen omgezet naar ingrediënten met de artikelnaam; verdwenen artikel vervalt', () => {
  const oud = JSON.stringify({ versie: '1352905-7DA', artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks' } }, recepten: { las01: { naam: 'Lasagne', artikelen: { mel01: '4', wegxx: '1' } } } });
  const r = K.leesBestand(oud);
  return gelijk(r.ok + '|' + ingJ(r.model.recepten.get('las01').ingredienten) + '|' + (JSON.parse(K.schrijfBestand(r.model)).recepten.las01.artikelen === undefined),
    'true|[["mel01",{"naam":"Melk","aantal":"4"}]]|true');
});
controle('recepten: recepten-lijst op naam met zoekvorm', () => gelijk(K.receptLijst(lees(RB)).map((r) => r.naam + ':' + r.ingredienten.map((x) => x.naam + x.aantal).join('/')).join(), 'Lasagne:Gehakt2/Lasagnebladen1/Melk4,Pannenkoeken:Melk2'));
controle('recepten: rechtzetten — voor zonder op weg', () => {
  const m = lees({ artikelen: { mel01: { naam: 'Melk', voor: { las01: { naam: 'Lasagne', aantal: '4' } }, opvoor: '1' } }, recepten: { las01: { naam: 'Lasagne', ingredienten: { mel01: { naam: 'Melk', aantal: '4' } } } } });
  return gelijk(m.recepten.get('las01').ingredienten.size + '|' + m.artikelen.get('mel01').voor.size + '|' + m.artikelen.get('mel01').opvoor + '|' + m.rechtgezet, '1|0||1');
});

/* ---------- tags ---------- */
controle('tags: # met een letter, aan het begin of na spatie/haakje; _ is spatie; geen subtags; dubbel telt één keer', () => gelijk(
  K.tagsVan('voor #kerst en (#Groot_Feest) #kerst a#nee #1nee #ok-2').map((g) => g.naam + '/' + g.sleutel).join(), 'kerst/kerst,Groot Feest/groot feest,ok-2/ok-2'));
controle('tags: hoofdletters en accenten tellen niet; zoeken met of zonder accent', () => gelijk(
  JSON.stringify([K.tagTelling(['#café', '#Cafe', '#crème_brûlée']).map((g) => g.naam + '/' + g.aantal), K.zoekPast('x', '#café', '#CAFE'), K.zoekPast('x', '#Cafe', '#café'), K.zoekPast('x', '#crème_brûlée', '#creme b')]),
  JSON.stringify([['café/2', 'crème brûlée/1'], true, true, true])));
controle('zoeken: met # alleen op tags in de notitie (begint met), zonder # op de naam; # in een naam telt niet als tag', () => gelijk([
  K.zoekPast('Kaarsen', 'voor #kerst', '#ker'), K.zoekPast('Kaarsen', 'voor #kerst', '#erst'), K.zoekPast('Lampjes #kerst', '', '#kerst'), K.zoekPast('Kaarsen', '#kerst', 'kaars'),
  K.zoekPast('Crème', '', 'creme'), K.zoekPast('X', '#Groot_Feest', '#groot_f')].join(), 'true,false,false,true,true,true'));
controle('tags: telling per notitie, op naam', () => gelijk(K.tagTelling(['#kerst #kerst', 'voor #kerst #buiten', '', null]).map((x) => x.naam + ':' + x.aantal).join(), 'buiten:1,kerst:2'));
controle('winkel: notitie en link in het bestand; onveilige link vervalt en wordt niet getoond', () => {
  const k = kern();
  const m = lees({ winkels: { w1111: { naam: 'Gamma', notitie: 'za tot 17:00 #klussen', link: 'javascript:x' } } });
  const st = k.pasToe(m, { actie: 'zet', soort: 'winkel', id: 'w1111', veld: 'link', oud: 'javascript:x', nieuw: 'http://gamma.nl' }).status;
  const ok = k.pasToe(m, { actie: 'zet', soort: 'winkel', id: 'w1111', veld: 'link', oud: 'javascript:x', nieuw: 'https://www.gamma.nl/' }).status;
  return gelijk(st + '|' + ok + '|' + JSON.stringify(uit(k, m).winkels.w1111) + '|' + K.winkelLijst(lees({ winkels: { w1111: { naam: 'G', link: 'javascript:x' } } }))[0].link,
    'vervallen|ok|{"naam":"Gamma","notitie":"za tot 17:00 #klussen","link":"https://www.gamma.nl/"}|');
});

/* ---------- acties ---------- */
controle('periode: grenzen van dag, maand, kwartaal en jaar', () => gelijk(['2026-11-27', '2026-02', '2026-K4', '2027'].map((d) => { const g = K.periodeGrenzen(d); return g.begin + '/' + g.eind; }).join(),
  '2026-11-27/2026-11-27,2026-02-01/2026-02-28,2026-10-01/2026-12-31,2027-01-01/2027-12-31'));
controle('periode: verschuiven, ook over het jaar en de 31e naar een kortere maand', () => gelijk([K.verschuif('2026-11-27', 1, 'week'), K.verschuif('2026-01-31', 1, 'maand'), K.verschuif('2026-12', 1, 'maand'),
  K.verschuif('2026-K4', 1, 'kwartaal'), K.verschuif('2026-K2', 1, 'jaar'), K.verschuif('2026-11', 1, 'kwartaal'), K.verschuif('2026', -1, 'jaar'), K.verschuif('2026-03-01', -1, 'dag')].join(),
  '2026-12-04,2026-02-28,2027-01,2027-K1,2027-K2,2027-02,2025,2026-02-28'));
controle('schema: de regelsleutel verandert bij elk veld, ook plekken, aankoopdatums en onbekende soort', () => {
  const basis = { naam: 'Kaas', soort: 'eenmalig', ligt: { w1111: '' }, gekocht: ['2026-11-01'] };
  const sl = (o) => K.recordSleutel('artikel', K.recordUitJson('artikel', 'kaa01', Object.assign({}, basis, o)));
  const b = sl({});
  const anders = [{ naam: 'Kazen' }, { soort: 'wekelijks' }, { aantal: '2' }, { notitie: 'x' }, { link: 'https://a.nl/' }, { ligt: { w1111: 'a1111' } }, { ligt: { w2222: '' } },
    { op: '2026-11-23T10:00' }, { opdoor: 'Mark' }, { weg: '2026-11-23' }, { gekocht: ['2026-11-02'] }].filter((o) => sl(o) === b);
  const a = (o) => K.recordSleutel('actie', K.recordUitJson('actie', 'act01', Object.assign({ naam: 'Bellen' }, o)));
  const ac = ['datum', 'maanddag', 'herhaal', 'notitie', 'link', 'klaar'].filter((k) => a({ [k]: '1' }) === a({}));
  return gelijk(anders.length + '|' + ac.join(), '0|');
});
controle('instellingen: standaard als hij ontbreekt of niet klopt; zet alleen geldige, zetbare velden', () => {
  const k = kern(); const m = k.leegModel();
  const a = [k.instelling(m, 'wekelijks', 'dag'), k.instelling(m, 'historie', 'bewaren'), k.instelling(m, 'archief', 'bewaren'), k.instelling(m, 'aankopen', 'bewaren')];
  m.instellingen.historie = { bewaren: '9x' }; m.instellingen.wekelijks = { dag: 'vr', tijd: 7 };
  a.push(k.instelling(m, 'historie', 'bewaren'), k.instelling(m, 'wekelijks', 'dag'), k.instelling(m, 'wekelijks', 'tijd'));
  a.push(k.pasToe(m, H({ actie: 'instelling', naam: 'wekelijks', veld: 'teruggezet', nieuw: '2026-11-21T06:00' })).status, k.pasToe(m, H({ actie: 'instelling', naam: 'opruimen', veld: 'tot', nieuw: '2026-11-21' })).status);
  return gelijk(a.join(), 'za,3m,1j,500,3m,vr,06:00,vervallen,vervallen');
});
controle('wekelijks: ontbreekt dag of tijd, dan dezelfde standaard als Instellingen (za 06:00)', () => {
  const k = kern(); const m = k.leegModel();
  const geen = k.wekelijksMoment(m, new Date(2026, 10, 24, 12, 0));
  m.instellingen.wekelijks = { auto: 'ja', teruggezet: '2026-11-14T06:00' };
  const t = k.wekelijksMoment(m, new Date(2026, 10, 24, 12, 0));
  return gelijk(String(geen) + '|' + k.tijdstipTekst(t), 'null|2026-11-21T06:00');
});
controle('formaat: een omgezet bestand telt als gewijzigd en wordt in het nieuwe formaat geschreven', () => {
  const k = kern();
  k.MIGRATIES.push({ van: '1352902-458', naar: k.FORMAAT, doe: (d) => { d.artikelen = d.spullen; delete d.spullen; } });
  /* Met wekelijks al gezet (dit weekend teruggezet): zonder de omzetting zou er niets veranderen. */
  const r = k.synchroniseer('{"versie": "1352902-458", "instellingen": {"wekelijks": {"dag": "za", "tijd": "06:00", "teruggezet": "2026-11-21T06:00"}}, "spullen": {"mel01": {"naam": "Melk", "soort": "eenmalig"}}}', [], new Date(2026, 10, 24, 12, 0), null);
  return gelijk([r.ok, r.gewijzigd, JSON.parse(r.tekst).versie === k.FORMAAT, !!JSON.parse(r.tekst).artikelen.mel01].join(), 'true,true,true,true');
});
controle('zoeken op winkel: @Plus, @Albert Heijn, @Plus zuiv, @Plus afdeling? en @Plus?, niet meer @Plus onbekend; spaties en accenten; Albert/Albert Heijn; geen @', () => {
  const k = kern();
  const W = [{ id: 'pls', naam: 'Plus', afdelingen: [{ id: 'agf', naam: 'Groente & fruit' }, { id: 'zui', naam: 'Zuivel' }] }, { id: 'ahh', naam: 'Albert Heijn', afdelingen: [] }, { id: 'alb', naam: 'Albert', afdelingen: [] }];
  const A = [{ naam: 'Melk', notitie: '', plekken: [{ winkel: 'pls', afd: 'zui' }] }, { naam: 'Appels', notitie: '', plekken: [{ winkel: 'pls', afd: 'agf' }] },
    { naam: 'Stroopwafels', notitie: '', plekken: [{ winkel: 'pls', afd: '' }, { winkel: 'ahh', afd: '' }] }, { naam: 'Schroeven', notitie: '', plekken: [] }];
  const n = (t) => k.zoekArtikelen(A, t, W).map((a) => a.naam).join('+');
  const id = (t) => { const z = k.winkelZoek(t, W); return z ? (z.winkel ? z.winkel.id + ':' + z.afd : 'kies:' + z.kies) : 'null'; };
  return gelijk([n('@Plus'), n('@plus zuiv'), n('@Plus onbekend'), n('@Albert Heijn'), n('@Alb'), String(k.winkelZoek('melk', W)), n('mel'),
    id('@albert heijn'), id('@ALBERTHEIJN'), id('@Älbert  Héijn'), id('@Albert'), id('@Albert '), id('@Albert H'), id('@  plus groente'), n('@plus groente&fr'), n('@Plus afdeling?'), n('@Plus afd'), n('@plus?'), n('@Plus ?')].join('|'),
    'Melk+Appels+Stroopwafels|Melk||Stroopwafels||null|Melk|ahh:|ahh:|ahh:|kies:albert|alb:|kies:alberth|pls:groente|Appels|Stroopwafels|Stroopwafels|Stroopwafels|Stroopwafels');
});
controle('formaat: oude versies stap voor stap omzetten; onbekende tussenversie = niet lezen', () => {
  const tabel = [{ van: 'A-1', naar: 'A-2', doe: (d) => { d.stap = (d.stap || '') + '1'; } }, { van: 'A-2', naar: 'A-3', doe: (d) => { d.stap = (d.stap || '') + '2'; } }];
  const a = { versie: 'A-1' }, b = { versie: 'A-2' }, c = { versie: 'A-0' };
  return gelijk([K.migreren(a, tabel), a.versie, a.stap, K.migreren(b, tabel), b.stap, K.migreren(c, tabel)].join(), 'true,A-3,12,true,2,false');
});
controle('herhalen: te laat afgeronde dag komt niet op vandaag, een lopende maand wel (punt 3)', () => gelijk([K.volgendeKeer('2026-11-16', 'week', '2026-11-23'), K.volgendeKeer('2026-11-23', 'week', '2026-11-23'), K.volgendeKeer('2026-10', 'maand', '2026-11-23'), K.volgendeKeer('2026-11-20', 'week', '2026-11-23')].join(),
  '2026-11-30,2026-11-30,2026-11,2026-11-27'));
controle('suggestie: na vier keer de tussentijd niet meer (punt 12)', () => K.suggestie(['2026-01-01', '2026-01-08', '2026-01-15'], '2026-01-22') !== null && K.suggestie(['2026-01-01', '2026-01-08', '2026-01-15'], '2026-02-12') !== null
  && K.suggestie(['2026-01-01', '2026-01-08', '2026-01-15'], '2026-02-13') === null);
controle('herhalen: de volgende keer slaat voorbije over', () => gelijk([K.volgendeKeer('2026-11-20', 'week', '2026-11-21'), K.volgendeKeer('2026-08-10', 'week', '2026-11-21'),
  K.volgendeKeer('2026-10', 'maand', '2026-11-21'), K.volgendeKeer('2026-K3', 'kwartaal', '2026-11-21'), K.volgendeKeer('2026-11-21', 'jaar', '2026-11-21')].join(),
  '2026-11-27,2026-11-23,2026-11,2026-K4,2027-11-21'));
controle('groepen: te laat, deze week (t/m zondag), later, geen', () => gelijk(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11', '2026-10', '2026-K4', '2027', ''].map((d) => K.actieGroep(d, '2026-11-21')).join(),
  'laat,week,week,later,later,laat,later,later,geen'));
controle('doen-filters: binnen de termijn af (te laat altijd), Alles ook zonder periode (K6)', () => gelijk(
  ['week', 'maand', 'kwartaal', 'jaar', 'alles'].map((f) => ['2026-10', '2026-11-22', '2026-11-30', '2026-11', '2026-12', '2026-K4', '2026', '2027', ''].filter((d) => K.inDoenFilter(d, f, '2026-11-21')).length).join(),
  '2,4,7,7,9'));
controle('periode: andere soort kiezen houdt de plek; teksten kort en lang', () => gelijk([K.naarSoort('2026-11-27', 'kwartaal', '2026-11-21'), K.naarSoort('', 'maand', '2026-11-21'), K.naarSoort('2026-K2', 'dag', '2026-11-21'),
  K.periodeTekst('2026-11-27', '2026-11-21'), K.periodeTekst('2027-01-05', '2026-11-21'), K.periodeTekst('2026-12', '2026-11-21'), K.periodeTekst('2026-K4', '2026-11-21'), K.periodeTekst('2026-11-27', '2026-11-21', true)].join('|'),
  '2026-K4|2026-11|2026-04-01|vr 27 nov|di 5 jan 2027|december|K4|vr 27 november'));
controle('periode: vandaag en morgen in de lijst, niet in het lange formaat', () => gelijk([K.periodeTekst('2026-11-21', '2026-11-21'), K.periodeTekst('2026-11-22', '2026-11-21'), K.periodeTekst('2026-11-21', '2026-11-21', true)].join('|'),
  'vandaag|morgen|za 21 november'));
controle('acties: open = nooit afgerond of herhalend; ongeldige herhaling bij een periode telt niet; onveilige link niet', () => {
  const al = K.actieLijst(lees({ acties: { a1111: { naam: 'Vuilnis', datum: '2026-11-27', herhaal: 'week', klaar: '2026-11-20T08:00' }, a2222: { naam: 'Lamp', klaar: '2026-11-20T08:00' },
    a3333: { naam: 'Filter', datum: '2026-12', herhaal: 'week', link: 'javascript:x' } } }));
  return gelijk(al.map((a) => a.naam + ':' + a.open + ':' + a.herhaal + ':' + a.link).join(), 'Filter:true::,Lamp:false::,Vuilnis:true:week:');
});
controle('acties: ongeldige datum, herhaling of link in een handeling vervalt', () => {
  const k = kern(); const m = lees({ acties: { a1111: { naam: 'X' } } });
  return gelijk(['2026-13-40', '2026-02-30', '2026-13', 'morgen'].map((d) => k.pasToe(m, { actie: 'zet', soort: 'actie', id: 'a1111', veld: 'datum', oud: '', nieuw: d }).status).join() + '|' +
    k.pasToe(m, { actie: 'zet', soort: 'actie', id: 'a1111', veld: 'herhaal', oud: '', nieuw: 'dag' }).status + '|' + k.pasToe(m, { actie: 'zet', soort: 'actie', id: 'a1111', veld: 'link', oud: '', nieuw: 'http://x.nl' }).status,
    'vervallen,vervallen,vervallen,vervallen|vervallen|vervallen');
});

/* ---------- opruimen ---------- */
controle('opruimen: archief standaard 1 jaar: na 2 maanden nog bewaard, na 14 maanden weg', () => {
  const k = kern();
  const m = lees({ artikelen: { kaa01: { naam: 'Kaars', soort: 'eenmalig', weg: '2026-09-01' }, lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-09-01'] } } });
  k.opruimen(m, NU);
  return gelijk(Array.from(m.artikelen.keys()).join(), 'kaa01');
});
controle('opruimen: oude afgeronde actie; archief op 1 maand: weg na 1 maand niet gekocht (ook via "weg"); op de lijst of zonder datum blijft', () => {
  const k = kern();
  const m = lees({ instellingen: { archief: { bewaren: '1m' } }, artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-10-01'] }, lam02: { naam: 'Lampje2', soort: 'eenmalig', op: '2026-11-20T10:00', gekocht: ['2025-10-01'] },
      bat01: { naam: 'Batterij', soort: 'eenmalig', gekocht: ['2026-11-01'] }, kaa01: { naam: 'Kaars', soort: 'eenmalig', weg: '2026-09-01' }, tas01: { naam: 'Tas', soort: 'eenmalig' },
      mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2025-01-01'] } },
    acties: { a1111: { naam: 'Pakket', klaar: '2026-01-01' }, a2222: { naam: 'Filter', herhaal: 'maand', klaar: '2026-01-01' } } });
  const n = k.opruimen(m, NU);
  const o = uit(k, m);
  return gelijk(n + '|' + Object.keys(o.artikelen).sort().join() + '|' + Object.keys(o.acties).join(), '3|bat01,lam02,mel01,tas01|a2222');
});
controle('opruimen: een eenmalig artikel wordt opgeruimd; het recept houdt zijn ingrediënt', () => {
  const k = kern();
  const m = lees({ instellingen: { archief: { bewaren: '1w' } }, artikelen: { bla01: { naam: 'Lasagnebladen', soort: 'eenmalig', gekocht: ['2025-01-01'] } },
    recepten: { las01: { naam: 'Lasagne', ingredienten: { bla01: { naam: 'Lasagnebladen', aantal: '1' } } } } });
  const n = k.opruimen(m, NU);
  return gelijk(n + '|' + m.artikelen.size + '|' + m.recepten.get('las01').ingredienten.get('bla01').naam, '1|0|Lasagnebladen');
});
controle('opruimen: instelling archief bewaren (1 jaar) telt; ongeldige waarde wordt niet gelezen', () => {
  const k = kern();
  const m = lees({ instellingen: { archief: { bewaren: '1j' } }, artikelen: { bat01: { naam: 'Batterij', soort: 'eenmalig', gekocht: ['2026-01-01'] }, lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-10-01'] } } });
  k.opruimen(m, NU);
  const fout = k.leesBestand(JSON.stringify({ versie: k.FORMAAT, instellingen: { archief: { bewaren: 'toString' } } }));
  return gelijk(Object.keys(uit(k, m).artikelen).join() + '|' + fout.ok, 'bat01|false');
});

controle('opruimen: soort naar Eenmalig → bewaartijd loopt vanaf die dag, niet meteen weg (B5)', () => {
  const r = K.synchroniseer(B({ artikelen: { tan01: { naam: 'Tandpasta', soort: 'regelmatig', gekocht: ['2026-03-01'] } } }),
    [H({ actie: 'zet', soort: 'artikel', id: 'tan01', veld: 'soort', oud: 'regelmatig', nieuw: 'eenmalig', t: '2026-11-21T09:00' })], NU);
  const a = JSON.parse(r.tekst).artikelen.tan01;
  return gelijk(a && a.soort + '|' + a.weg, 'eenmalig|2026-11-21');
});
controle('opruimen: niet op de dag van een teruggezette backup (B5)', () => {
  const r = K.synchroniseer(B({ instellingen: { opruimen: { tot: '2026-11-21' } }, artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-10-01'] }, mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-20'] } } }), [], NU);
  const morgen = K.synchroniseer(r.tekst, [], new Date(2026, 10, 22, 10, 0));
  return gelijk(!!JSON.parse(r.tekst).artikelen.lam01 + '|' + !!JSON.parse(morgen.tekst).artikelen.lam01, 'true|false');
});
controle('opruimen: niet als de klok van de telefoon ver na de nieuwste datum staat; wel in het logboek (B5)', () => {
  const bestand = B({ instellingen: { archief: { bewaren: '1m' } }, artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2026-10-01'] }, mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-20'] } } });
  const ver = K.synchroniseer(bestand, [], new Date(2027, 5, 1, 10, 0));
  const goed = K.synchroniseer(bestand, [], NU);
  return gelijk(!!JSON.parse(ver.tekst).artikelen.lam01 + '|' + ver.opgelost.some((x) => /lijkt niet te kloppen/.test(x)) + '|' + !!JSON.parse(goed.tekst).artikelen.lam01, 'true|true|false');
});
controle('lezen: wekelijks-dag of -tijd die niet klopt maakt het bestand ongeldig (K7)', () => gelijk(
  ['toString', 'xx', 'za'].map((dag) => K.leesBestand(B({ instellingen: { wekelijks: { dag, tijd: '06:00' } } })).ok).join() + '|' + K.leesBestand(B({ instellingen: { wekelijks: { dag: 'za', tijd: '25:00' } } })).ok,
  'false,false,true|false'));
controle('lezen/schrijven: onbekende velden als "constructor" en "__proto__" blijven bewaard (K8)', () => {
  const tekst = '{"versie": "' + K.FORMAAT + '", "artikelen": {"mel01": {"naam": "Melk", "constructor": "x", "toString": 1, "__proto__": {"a": 1}}}}';
  const uitTekst = K.schrijfBestand(K.leesBestand(tekst).model);
  return gelijk(['"constructor":"x"', '"toString":1', '"__proto__":{"a":1}'].map((s) => uitTekst.includes(s)).join(), 'true,true,true');
});
controle('lezen: actie met onbekende datum komt in het logboek (K9)', () => gelijk(
  K.leesBestand(B({ acties: { a1111: { naam: 'APK', datum: '2026-13' } } })).model.opgelost.join(), 'APK: onbekende datum "2026-13", getoond zonder periode'));

controle('wekelijks: offline van de lijst vóór het moment, gesynct na de reset → blijft op de nieuwe lijst; aankoop blijft (B4)', () => {
  const na = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } },
    artikelen: { ban01: { naam: 'Bananen', soort: 'wekelijks', op: '2026-11-21T06:00', gekocht: ['2026-11-14'] } } });
  const r = K.synchroniseer(na, [
    H({ actie: 'zet', soort: 'artikel', id: 'ban01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '', t: '2026-11-20T17:00' }),
    H({ actie: 'gekocht', soort: 'artikel', id: 'ban01', datum: '2026-11-20', t: '2026-11-20T17:00' })], NU);
  const b = JSON.parse(r.tekst).artikelen.ban01;
  const laterAf = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'ban01', veld: 'op', oud: '2026-11-21T06:00', nieuw: '', t: '2026-11-21T09:00' })], NU);
  return gelijk(b.op + '|' + b.gekocht.join() + '|' + (JSON.parse(laterAf.tekst).artikelen.ban01.op || ''), '2026-11-21T06:00|2026-11-14,2026-11-20|');
});
controle('wekelijks niet automatisch: offline van de lijst vóór het moment, gesynct daarna → gewoon van de lijst', () => {
  const na = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00', auto: 'nee' } },
    artikelen: { ban01: { naam: 'Bananen', soort: 'wekelijks', op: '2026-11-14T06:00', gekocht: ['2026-11-14'] } } });
  const r = K.synchroniseer(na, [H({ actie: 'zet', soort: 'artikel', id: 'ban01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '', t: '2026-11-20T17:00' })], NU);
  return gelijk(JSON.parse(r.tekst).artikelen.ban01.op || '', '');
});
controle('wekelijks: hooguit één keer per week; tijd later zetten op dezelfde dag geeft geen tweede reset (K11)', () => {
  const k = kern();
  const m = lees({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '10:00', teruggezet: '2026-11-21T06:00' } },
    artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-14'] } } });
  const vandaag = k.wekelijksTerug(m, new Date(2026, 10, 21, 11, 0));
  const volgende = k.wekelijksTerug(m, new Date(2026, 10, 28, 11, 0));
  return gelijk(vandaag + '|' + volgende + '|' + m.instellingen.wekelijks.teruggezet, '0|1|2026-11-28T10:00');
});
controle('aankopen: toevoegen (dubbel = één), weghalen, nieuwste eerst in het bestand; standaard 500 bewaard', () => {
  const aankoop = (id, tijd) => H({ actie: 'aankoop', soort: 'aankoop', id, naam: 'Melk', tijd });
  const r = K.synchroniseer(B({ artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks' } } }),
    [aankoop('k1111', '2026-11-20T10:00'), aankoop('k2222', '2026-11-21T09:00'), aankoop('k1111', '2026-11-20T10:00'), aankoop('k3333', '2026-11-21T09:30'),
     H({ actie: 'weg', soort: 'aankoop', id: 'k3333' })], NU);
  const veel = [];
  for (let i = 0; i < 510; i++) veel.push(aankoop('x' + String(1000 + i), '2026-11-' + String(10 + (i % 10)) + 'T' + String(10 + (i % 12)) + ':' + String(10 + (i % 50))));
  const r2 = K.synchroniseer(B({}), veel, NU);
  return gelijk(Object.keys(JSON.parse(r.tekst).aankopen).join() + '|' + Object.keys(JSON.parse(r2.tekst).aankopen).length, 'k2222,k1111|500');
});
controle('aankopen: bewaren instelbaar 0 t/m 1000; ongeldig vervalt of maakt het bestand ongeldig', () => {
  const k = kern();
  const m = lees({});
  const st = ['0', '1000', '250', '1001', '-1', '05', 'toString'].map((v) => k.pasToe(m, H({ actie: 'instelling', naam: 'aankopen', veld: 'bewaren', nieuw: v })).status).join();
  const nul = K.synchroniseer(B({ instellingen: { aankopen: { bewaren: '0' } } }), [H({ actie: 'aankoop', soort: 'aankoop', id: 'k1111', naam: 'Melk', tijd: '2026-11-20T10:00' })], NU);
  return gelijk(st + '|' + (JSON.parse(nul.tekst).aankopen === undefined) + '|' + K.leesBestand(B({ instellingen: { aankopen: { bewaren: '2000' } } })).ok
    + '|' + K.leesBestand(B({ aankopen: { k1111: { naam: 'Melk', tijd: 'gisteren' } } })).ok, 'ok,ok,ok,vervallen,vervallen,vervallen,vervallen|true|false|false');
});

controle('wekelijks: gewoon geval — vrijdag offline afgevinkt, zaterdag na het moment gesynct: blijft op de nieuwe lijst (B1)', () => {
  const r = K.synchroniseer(B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } },
    artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', op: '2026-11-14T06:00', gekocht: ['2026-11-07'] } } }), [
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '', t: '2026-11-20T17:00' }),
    H({ actie: 'gekocht', soort: 'artikel', id: 'mel01', datum: '2026-11-20', t: '2026-11-20T17:00' })], NU);
  const m = JSON.parse(r.tekst).artikelen.mel01;
  const zaterdag = K.synchroniseer(B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } },
    artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', op: '2026-11-14T06:00' } } }), [
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '', t: '2026-11-21T09:00' })], NU);
  return gelijk(!!m.op + '|' + m.gekocht.join() + '|' + !!JSON.parse(zaterdag.tekst).artikelen.mel01.op, 'true|2026-11-07,2026-11-20|false');
});
controle('klok een jaar vooruit: twee rondes lang geen opruimen, geen wekelijkse reset, geen toekomstige datum in het bestand (B3)', () => {
  const ver = new Date(2027, 10, 20, 10, 0);
  const begin = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } },
    artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2026-10-01'] }, mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-21'] } } });
  const r1 = K.synchroniseer(begin, [], ver);
  const r2 = K.synchroniseer(r1.tekst, [], ver);
  const d = JSON.parse(r2.tekst);
  return gelijk(!!d.artikelen.lam01 + '|' + d.instellingen.wekelijks.teruggezet + '|' + !!d.artikelen.mel01.op + '|' + r1.klokVerdacht, 'true|2026-11-21T06:00|false|true');
});
controle('terugzetten: alleen winkels en afdelingen die nog bestaan; bij lezen rechtgezet = ook opgeslagen (K2)', () => {
  const r = K.synchroniseer(B({ winkels: { w1111: { naam: 'AH', afdelingen: [{ id: 'd1111', naam: 'Zuivel' }] } } }),
    [H({ actie: 'terug', soort: 'artikel', id: 'mel01', record: { naam: 'Melk', soort: 'wekelijks', ligt: { w1111: 'd9999', w2222: '' } } })], NU);
  const rec = K.synchroniseer(B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } }, winkels: { w1111: { naam: 'AH' } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', ligt: { w1111: '', w2222: '' } } } }), [], NU);
  return gelijk(JSON.stringify(JSON.parse(r.tekst).artikelen.mel01.ligt) + '|' + rec.gewijzigd + '|' + JSON.stringify(JSON.parse(rec.tekst).artikelen.mel01.ligt), '{"w1111":""}|true|{"w1111":""}');
});

controle('klok vooruit: tegen de servertijd blijft hij ook de tweede ronde verdacht (M1)', () => {
  const ver = new Date(2027, 1, 1, 10, 0);
  const begin = B({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-21T06:00' } },
    artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2026-10-01'] }, mel01: { naam: 'Melk', soort: 'wekelijks', op: '2026-11-21T09:00' } } });
  const r1 = K.synchroniseer(begin, [H({ actie: 'gekocht', soort: 'artikel', id: 'mel01', datum: '2027-02-01' })], ver, '2026-11-23');
  const r2 = K.synchroniseer(r1.tekst, [], ver, '2026-11-23');
  const d = JSON.parse(r2.tekst);
  return gelijk(r1.klokVerdacht + '|' + r2.klokVerdacht + '|' + !!d.artikelen.lam01 + '|' + d.instellingen.wekelijks.teruggezet, 'true|true|true|2026-11-21T06:00');
});
controle('lang niet gebruikt of oude backup: tegen de servertijd niet verdacht (M2)', () => {
  const r = K.synchroniseer(B({ artikelen: { tan01: { naam: 'Tandpasta', soort: 'regelmatig', gekocht: ['2026-03-01'] } } }), [], NU, '2026-11-21');
  return gelijk(r.klokVerdacht, false);
});
controle('wekelijks: moment in de toekomst (andere telefoon liep voor) telt niet; tijdzones wel (M1)', () => {
  const k = kern();
  const toekomst = lees({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-12-05T06:00' } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-14'] } } });
  const n1 = k.wekelijksTerug(toekomst, new Date(2026, 10, 21, 10, 0));
  const tz = lees({ instellingen: { wekelijks: { auto: 'ja', dag: 'za', tijd: '06:00', teruggezet: '2026-11-22T12:00' } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-14'] } } });
  const n2 = k.wekelijksTerug(tz, new Date(2026, 10, 21, 10, 0));
  return gelijk(n1 + '|' + toekomst.instellingen.wekelijks.teruggezet + '|' + n2, '1|2026-11-21T06:00|0');
});
controle('ongeldige handelingen vervallen; het bestand blijft leesbaar (M5)', () => {
  const begin = B({ winkels: { w1111: { naam: 'AH' } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks' } } });
  const fouten = [
    H({ actie: 'gekocht', soort: 'artikel', id: 'mel01' }),
    H({ actie: 'gekocht', soort: 'artikel', id: 'mel01', datum: 'gisteren' }),
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: 5 }),
    H({ actie: 'terug', soort: 'afdeling', winkel: 'w1111', afd: { id: 'd1111', naam: '' }, plaats: 0 })];
  const r = K.synchroniseer(begin, fouten, NU);
  return gelijk(r.resultaten.map((x) => x.status).join() + '|' + K.leesBestand(r.tekst).ok, 'vervallen,vervallen,vervallen,vervallen|true');
});
controle('technische velden: geen botsing, de nieuwste datum wint stil (L2)', () => {
  const begin = B({ artikelen: { cad01: { naam: 'Cadeau', soort: 'eenmalig', weg: '2026-11-24' } }, acties: { afv01: { naam: 'Afval', datum: '2026-11-28', herhaal: 'week', klaar: '2026-11-23T09:00' } } });
  const r = K.synchroniseer(begin, [
    H({ actie: 'zet', soort: 'artikel', id: 'cad01', veld: 'weg', oud: '', nieuw: '2026-11-23' }),
    H({ actie: 'zet', soort: 'actie', id: 'afv01', veld: 'klaar', oud: '', nieuw: '2026-11-23T10:00' })], NU);
  const d = JSON.parse(r.tekst);
  return gelijk(r.resultaten.map((x) => x.status).join() + '|' + d.artikelen.cad01.weg + '|' + d.acties.afv01.klaar, 'al,ok|2026-11-24|2026-11-23T10:00');
});
controle('afgeronde acties gaan weg na de ingestelde tijd (standaard 3 maanden); Gedaan (historie) nooit vanzelf', () => {
  const r = K.synchroniseer(B({ historie: { h0001: { naam: 'Afval', tijd: '2026-11-20T08:00' }, h0002: { naam: 'Bellen', tijd: '2025-07-01T10:00' } },
    acties: { a1111: { naam: 'Pakket', klaar: '2026-11-10T10:00' }, a2222: { naam: 'Oud', klaar: '2026-07-01T10:00' } } }), [], NU);
  const kort = K.synchroniseer(B({ instellingen: { historie: { bewaren: '1w' } }, historie: { h0001: { naam: 'Afval', tijd: '2026-11-20T08:00' }, h0003: { naam: 'Fiets', tijd: '2026-11-10T10:00' } },
    acties: { a1111: { naam: 'Pakket', klaar: '2026-11-10T10:00' }, a3333: { naam: 'Nieuw', klaar: '2026-11-20T10:00' }, a4444: { naam: 'Afval', herhaal: 'week', datum: '2026-11-28', klaar: '2026-01-01T10:00' } } }), [], NU);
  const d = JSON.parse(r.tekst), k = JSON.parse(kort.tekst);
  return gelijk([Object.keys(d.historie).join(), Object.keys(d.acties).join(), Object.keys(k.historie).join(), Object.keys(k.acties).join()].join('|'), 'h0001,h0002|a1111|h0001,h0003|a4444,a3333');
});
controle('namen als constructor en toString: deel bewaard, handeling vervalt netjes (L11)', () => {
  const r = K.leesBestand('{"versie":"' + K.FORMAAT + '","constructor":{"x":1}}');
  const h1 = K.pasToe(K.leegModel(), { actie: 'toString', soort: 'artikel', id: 'abc12' });
  const h2 = K.pasToe(K.leegModel(), { actie: 'instelling', naam: 'constructor', veld: 'name', nieuw: 'x' });
  return gelijk(r.ok + '|' + /"constructor"/.test(K.schrijfBestand(r.model)) + '|' + h1.status + '|' + h2.status, 'true|true|vervallen|vervallen');
});
controle('backups: vandaag ruim na de nieuwste andere backup (klok vooruit) → niets weg (H1 ronde 4)', () => {
  const namen = ['thuis_backup_20261014.json', 'thuis_backup_20261101.json', 'thuis_backup_20261120.json', 'thuis_backup_20261123.json', 'thuis_backup_20271228.json'];
  return gelijk(K.backupsWeg(namen, '2027-12-28').join(), '');
});
controle('klok gemeten tegen de server: meer dan een dag voor of achter is verdacht (M3/L4 ronde 4)', () => {
  const b = B({ artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks' } } });
  const v = (s) => K.synchroniseer(b, [], NU, { serverDag: '2026-11-21', scheef: s }).klokVerdacht;
  return gelijk([v(5 * 864e5), v(-3 * 864e5), v(2 * 3600e3), v(-2 * 3600e3)].join(), 'true,true,false,false');
});
controle('handeling met een onverwachte vorm vervalt, de rest gaat door (L2 data)', () => {
  const r = K.synchroniseer(B({ winkels: { w1111: { naam: 'AH' } } }), [
    H({ actie: 'volgorde', soort: 'winkel', id: 'w1111', volgorde: null }),
    H({ actie: 'nieuw', soort: 'artikel', id: 'kaa01', velden: { naam: 'Kaas', soort: 'eenmalig' } })], NU);
  return gelijk(r.ok + '|' + r.resultaten.map((x) => x.status).join() + '|' + !!JSON.parse(r.tekst).artikelen.kaa01, 'true|vervallen,ok|true');
});
controle('wekelijks: andere dag kiezen geeft geen gat van bijna twee weken (K3)', () => {
  const k = kern();
  const m = lees({ instellingen: { wekelijks: { auto: 'ja', dag: 'vr', tijd: '06:00', teruggezet: '2026-11-21T06:00' } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2026-11-21'] } } });
  return gelijk(String(k.wekelijksTerug(m, new Date(2026, 10, 27, 10, 0))), '1');
});
controle('platte tekst: open "<!--" blijft snel; "<jong>" en "<oud>" blijven staan (K6)', () => {
  const s = Date.now(); K.schoonTekst('<!--' + 'a'.repeat(130000)); const snel = Date.now() - s < 300;
  return gelijk(snel + '|' + K.schoonTekst('Kaas <jong> of <oud>') + '|' + K.schoonTekst('a <B>b</B> <iframe src=x>c'), 'true|Kaas <jong> of <oud>|a b c');
});
controle('archief terug: naam intussen opnieuw gebruikt → dat artikel komt op de lijst (K10)', () => {
  const r = K.synchroniseer(B({ artikelen: { mel02: { naam: 'Melk', soort: 'eenmalig' } } }), [
    H({ actie: 'terug', soort: 'artikel', id: 'mel01', record: { naam: 'Melk', soort: 'eenmalig', op: '2026-11-21T09:00' } }),
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '', nieuw: '2026-11-21T09:00' })], NU);
  const d = JSON.parse(r.tekst).artikelen;
  return gelijk(Object.keys(d).join() + '|' + d.mel02.op, 'mel02|2026-11-21T09:00');
});

/* ---------- een hele ronde ---------- */
controle('ronde: wachtrij toepassen op de nieuwste versie, met resultaten', () => {
  const r = K.synchroniseer(B(VB), [
    H({ actie: 'zet', soort: 'artikel', id: 'mel01', veld: 'op', oud: '2026-11-14T06:00', nieuw: '' }),
    H({ actie: 'gekocht', soort: 'artikel', id: 'mel01', datum: '2026-11-21' }),
    H({ actie: 'zet', soort: 'artikel', id: 'weg99', veld: 'op', oud: '', nieuw: '2026-11-21T10:00' })
  ], NU);
  return gelijk(r.resultaten.map((x) => x.status).join() + '|' + r.terug + '|' + r.gewijzigd, 'ok,ok,vervallen|1|true');
});
controle('ronde: zonder wachtrij en zonder terugzetten is er niets te schrijven', () => {
  const vb = JSON.parse(JSON.stringify(VB)); vb.instellingen.wekelijks.teruggezet = '2026-11-21T06:00';
  return gelijk(K.synchroniseer(B(vb), [], NU).gewijzigd, false);
});
controle('ronde: alleen een BOM is geen reden om te schrijven; bij een wijziging gaat hij eruit (L7)', () => {
  const vb = JSON.parse(JSON.stringify(VB)); vb.instellingen.wekelijks.teruggezet = '2026-11-21T06:00';
  return gelijk(String(K.synchroniseer('﻿' + B(vb), [], NU).gewijzigd), 'false');
});
controle('ronde: ontbreekt de instelling voor wekelijks, dan komt de standaard erin', () => {
  const r = K.synchroniseer(B({}), [], NU);
  return gelijk(r.gewijzigd + '|' + JSON.stringify(JSON.parse(r.tekst).instellingen.wekelijks), 'true|{"dag":"za","tijd":"06:00","teruggezet":"2026-11-21T06:00"}');
});
controle('ronde: een bestand dat geen UTF-8 is of een verkeerde opbouw heeft, wordt nooit verwerkt', () =>
  gelijk(K.synchroniseer(new Uint8Array([0xC3, 0x28]), [], NU).ok + '|' + K.synchroniseer(B({ artikelen: [] }), [], NU).reden, 'false|onjuiste-opbouw'));

/* ---------- backups ---------- */
controle('backups: laatste 14 dagen plus de eerste van elke maand (12 maanden); alleen exacte namen', () => {
  const namen = ['thuis_backup_20261122.json', 'thuis_backup_20261109.json', 'thuis_backup_20261108.json', 'thuis_backup_20261101.json', 'thuis_backup_20261102.json',
    'thuis_backup_20261015.json', 'thuis_backup_20261020.json', 'thuis_backup_20251201.json', 'thuis_backup_20251105.json', 'thuis.json', 'thuis_backup_20251105.json.bak', 'mijn_backup_20251105.json'];
  return gelijk(K.backupsWeg(namen, '2026-11-22').sort().join(), 'thuis_backup_20251105.json,thuis_backup_20261020.json,thuis_backup_20261102.json,thuis_backup_20261108.json');
});

/* ---------- weergave ---------- */
const AL = K.artikelLijst(lees(VB));
const WL = K.winkelLijst(lees(VB));
const win = (id) => WL.find((w) => w.id === id);
controle('winkel: AH — in de route, zonder winkels (Cadeau) apart, Koffie (afdeling onbekend) staat niet op de lijst', () => {
  const ind = K.winkelIndeling(AL, win('ah001'));
  return gelijk(ind.zonder.map((a) => a.naam).join() + '|' + ind.onbekend.map((a) => a.naam).join() + '|' + ind.groepen.map((g) => g.afd.naam + ':' + g.items.map((a) => a.naam)).join() + '|' + ind.elders.map((a) => a.naam).join(),
    'Cadeau||Zuivel:Melk|Schroeven');
});
controle('winkel: te koop hier maar afdeling onbekend staat onder onbekend, niet bij zonder winkel', () => {
  const ind = K.winkelIndeling(AL.map((a) => a.naam === 'Koffie' ? Object.assign({}, a, { op: '2026-11-20T09:00' }) : a), win('ah001'));
  return gelijk(ind.zonder.map((a) => a.naam).join() + '|' + ind.onbekend.map((a) => a.naam).join(), 'Cadeau|Koffie');
});
controle('winkel: Gamma — geen melk, wel schroeven', () => {
  const ind = K.winkelIndeling(AL, win('gam01'));
  return gelijk(ind.zonder.map((a) => a.naam).join() + '|' + ind.groepen.map((g) => g.afd.naam).join() + '|' + ind.elders.map((a) => a.naam).join(), 'Cadeau|IJzerwaren|Melk');
});
controle('aankoop met winkel (en vraagteken): bewaard in het bestand; zonder winkel (oud) ook goed; winkel-id volgt een samenvoeging', () => {
  const k = kern();
  const m = k.leegModel();
  k.pasToe(m, { actie: 'aankoop', soort: 'aankoop', id: 'aan01', naam: 'Melk', tijd: '2026-11-25T09:00', winkel: 'pls01', onzeker: '1' });
  k.pasToe(m, { actie: 'aankoop', soort: 'aankoop', id: 'aan02', naam: 'Brood', tijd: '2026-11-25T09:01' });
  const j = JSON.parse(k.schrijfBestand(m));
  const h = k.vervangIds({ actie: 'aankoop', soort: 'aankoop', id: 'aan03', naam: 'Kaas', tijd: '2026-11-25T09:02', winkel: 'oud01' }, new Map([['oud01', 'nie01']]));
  return gelijk([j.aankopen.aan01.winkel, j.aankopen.aan01.onzeker, String(j.aankopen.aan02.winkel), String(j.aankopen.aan02.onzeker), h.winkel].join('|'), 'pls01|1|undefined|undefined|nie01');
});
controle('winkel: aanbod per afdeling (ook niet op de lijst); verdwenen afdeling = onbekend; zonder winkels hoort er niet bij', () => {
  const W = { id: 'pls', afdelingen: [{ id: 'agf', naam: 'Groente' }, { id: 'zui', naam: 'Zuivel' }] };
  const A = [{ naam: 'Appels', op: '', plekken: [{ winkel: 'pls', afd: 'agf' }] }, { naam: 'Melk', op: 'x', plekken: [{ winkel: 'ahh', afd: '' }, { winkel: 'pls', afd: 'zui' }] },
    { naam: 'Kaas', op: '', plekken: [{ winkel: 'pls', afd: 'weg' }] }, { naam: 'Stroop', op: '', plekken: [{ winkel: 'pls', afd: '' }] },
    { naam: 'Schroeven', op: 'x', plekken: [] }, { naam: 'Brood', op: '', plekken: [{ winkel: 'ahh', afd: '' }] }];
  const r = K.winkelAanbod(A, W);
  return gelijk([...r.per].map(([id, l]) => id + ':' + l.map((a) => a.naam).join('+')).join() + '|' + r.onbekend.map((a) => a.naam).join('+'), 'agf:Appels,zui:Melk|Kaas+Stroop');
});
controle('winkelkeuze: nodig = iets dat nergens anders te koop is; ook elders telt mee maar maakt niet nodig', () => {
  const t = K.winkelTellingen(AL, WL).map((x) => x.naam + ':' + (x.moet ? 'nodig' : 'kan') + ':' + x.alleen.join('+') + '/' + x.ook.join('+')).join();
  return gelijk(t, 'Albert Heijn:kan:/Melk,Gamma:nodig:Schroeven/,Plus:kan:/Melk');
});
controle('winkelkeuze: alleen waar iets is vastgelegd, alfabetisch; na kopen valt een winkel weg', () => {
  const t1 = K.winkelTellingen(AL, WL).map((x) => x.naam + ' ' + x.aantal).join();
  const t2 = K.winkelTellingen(AL.map((a) => a.naam === 'Melk' ? Object.assign({}, a, { op: '' }) : a), WL).map((x) => x.naam).join();
  return gelijk(t1 + '|' + t2, 'Albert Heijn 1,Gamma 1,Plus 1|Gamma');
});
controle('suggestie: na drie aankopen en langer dan gewoonlijk geleden', () => {
  const s = K.suggestie(['2026-10-03', '2026-10-24', '2026-10-10', '2026-10-17'], '2026-11-21');
  return gelijk(s && K.suggestieTekst(s), '24 okt · elke week');
});
controle('jaartal alleen als het niet dit jaar is: lijst, leesstand/kiezer en "laatst gekocht"', () => gelijk([
  K.periodeTekst('2026-03-05', '2026-11-26'), K.periodeTekst('2026-03-05', '2026-11-26', true), K.periodeTekst('2027-03-05', '2026-11-26', true),
  K.periodeTekst('2026-12', '2026-11-26', true), K.periodeTekst('2027-01', '2026-11-26', true), K.periodeTekst('2027-K1', '2026-11-26', true),
  K.gekochtTekst(['2025-12-20']), K.gekochtTekst(['2026-01-03'])].join('|'),
  'do 5 mrt|do 5 maart|vr 5 maart 2027|december|januari 2027|K1 2027|Laatst gekocht 20 dec 2025|Laatst gekocht 3 jan'));
controle('herhaaltekst: hoe een herhaling uitpakt', () => gelijk([
  K.herhaalTekst('2026-11-29', 'week'), K.herhaalTekst('2026-12-05', 'maand'), K.herhaalTekst('2027-02-28', 'maand'), K.herhaalTekst('2026-12-31', 'maand'), K.herhaalTekst('2027-02-28', 'maand', 31),
  K.herhaalTekst('2026-12-05', 'kwartaal'), K.herhaalTekst('2026-12-31', 'kwartaal'), K.herhaalTekst('2026-12-05', 'jaar'), K.herhaalTekst('2028-02-29', 'jaar'),
  K.herhaalTekst('2026-12', 'maand'), K.herhaalTekst('2026-12', 'kwartaal'), K.herhaalTekst('2026-12', 'jaar'), K.herhaalTekst('2026-K4', 'kwartaal'), K.herhaalTekst('2026-K4', 'jaar'),
  K.herhaalTekst('2027', 'jaar'), K.herhaalTekst('2026-12', 'week'), K.herhaalTekst('', 'week'), K.herhaalTekst('2026-12-05', '')].join('|'),
  'Elke zondag|Elke maand op de 5e|Elke maand op de 28e|Elke maand op de 31e, in een kortere maand de laatste dag van de maand|Elke maand op de 31e, in een kortere maand de laatste dag van de maand|' +
  'Elk kwartaal: 5 mrt, 5 jun, 5 sep en 5 dec|Elk kwartaal: 31 mrt, 30 jun, 30 sep en 31 dec|Elk jaar op 5 december|Elk jaar op 29 februari, anders 28 februari|' +
  'Elke maand|Elk kwartaal: maart, juni, september en december|Elk jaar in december|Elk kwartaal|Elk jaar in K4|Elk jaar|||'));
controle('suggestie: niet bij te weinig aankopen of als het nog niet zo lang geleden is', () =>
  gelijk(K.suggestie(['2026-10-24', '2026-11-14'], '2026-11-21') === null && K.suggestie(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-18'], '2026-11-21') === null, true));
controle('gekocht: één regel; "meestal" pas vanaf drie aankopen', () => gelijk([
  K.gekochtTekst([]), K.gekochtTekst(['2026-11-08', '2026-11-15']), K.gekochtTekst(['2026-11-15', '2026-10-25', '2026-11-08', '2026-11-01'])].join('|'),
  'Nog niet gekocht|Laatst gekocht 15 nov|Laatst gekocht 15 nov · meestal elke week'));
controle('zoeken: deel van de naam, zonder hoofdletters en accenten', () => {
  const al = K.artikelLijst(lees({ artikelen: { a1111: { naam: 'Crème fraîche' }, a2222: { naam: 'Café-noir' }, a3333: { naam: 'Kaas' } } }));
  return gelijk(K.zoekArtikelen(al, 'creme FRAI').map((a) => a.naam).join() + '|' + K.zoekArtikelen(al, 'cafe').map((a) => a.naam).join(), 'Crème fraîche|Café-noir');
});

controle('invoer staat onderaan (boven de tabbalk), met een vergrootglas links (geen soortmenu meer)', () =>
  (/<\/main>\s*<div class="onderbalk" id="balk-boodschappen">/.test(html) && !/id="soortMenu"/.test(html)) || 'invoer niet onderaan, of nog een soortmenu');

controle('tabbalk staat altijd in beeld: body vast aan de schermranden, geen 100dvh; scherm krimpt met het toetsenbord', () =>
  (/body\{[^}]*position:fixed;inset:0\}/.test(html) && !/body\{[^}]*100dvh/.test(html) && /interactive-widget=resizes-content/.test(html)) || 'opbouw klopt niet');

controle('nieuwe versie: oranje melding bovenaan met gevulde knop Herladen (zoals events)', () =>
  (/melding\('m-versie', 'Nieuwe versie beschikbaar\.', \[\{ tekst: 'Herladen', klasse: 'warn'/.test(scripts) && /\$\('meldingen'\)\.prepend\(\$\('m-versie'\)\)/.test(scripts) &&
   /\.melding \.knop\.warn\{background:#E0A458/.test(html) && !/update-bar/.test(html)) || 'niet zoals events');
controle('veiligheid: CSP — alleen eigen bestanden en Microsoft, geen scripts van buiten, geen formulieren of base', () => {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (!m) return 'CSP ontbreekt';
  const c = m[1];
  const regels = ["default-src 'none'", "script-src 'self' 'unsafe-inline'", "base-uri 'none'", "form-action 'none'", 'connect-src \'self\' https://login.microsoftonline.com https://graph.microsoft.com'];
  const mist = regels.filter((r) => c.indexOf(r) === -1);
  const vreemd = (/connect-src([^;]*)/.exec(c)[1].match(/https:\/\/[^\s;]+/g) || []).filter((h) => !/(microsoftonline\.com|graph\.microsoft\.com|1drv\.com|microsoftpersonalcontent\.com|sharepoint\.com|livefilestore\.com)$/.test(h));
  return (!mist.length && !vreemd.length) || JSON.stringify({ mist, vreemd });
});
controle('veiligheid: geen verwijzer meesturen', () => /<meta name="referrer" content="no-referrer">/.test(html) || 'referrer-regel ontbreekt');
controle('veiligheid: gegevens nooit via innerHTML (alleen vaste tekst, iconen en getallen)', () => {
  const verdacht = (scripts.match(/innerHTML\s*[+]?=\s*[^;]+;/g) || []).filter((r) => /\.naam|\.tekst|\.notitie|\.link|titel\b|opt\.(titel|naam)|naam\s*\+|\+\s*naam/.test(r));
  return !verdacht.length || verdacht.join(' | ');
});

controle('meldingen: systeemknoppen over de breedte en omrand (zoals Afmelden), niet gevuld', () =>
  (/\.melding \.knoppen \.knop\{flex:1 1 0/.test(html) && /\.melding \.knop\{background:#FFFFFF;color:var\(--paars\);border:2px solid var\(--paars\)\}/.test(html)) || 'stijl ontbreekt');

controle('rondjes: één definitie, gevuld even groot als de buitenkant van open (13,5 = 12,4 + 2,2/2)', () => {
  const r = (scripts.match(/const RONDJE = \{[\s\S]*?\n\};/) || [''])[0];
  if (!r) return 'RONDJE ontbreekt';
  const gevuld = [...r.matchAll(/r="([\d.]+)" fill="#/g)].map((m) => +m[1]);
  const open = [...r.matchAll(/r="([\d.]+)" fill="none" stroke="#[0-9A-F]+" stroke-width="([\d.]+)"/g)].map((m) => +m[1] + m[2] / 2);
  return (gevuld.length >= 2 && open.length >= 2 && gevuld.concat(open).every((x) => Math.abs(x - 13.5) < 0.01)) || JSON.stringify({ gevuld, open });
});
controle('rondjes: krimpen nooit (flex-shrink:0)', () => /\.rondsvg\{flex-shrink:0\}/.test(html) || 'regel ontbreekt');

controle('tabbalk: alleen weg als het toetsenbord echt open is (niet op focus alleen)', () =>
  /visualViewport/.test(scripts) && !/addEventListener\('focus', \(\) => document\.body\.classList\.add\('typen'\)\)/.test(scripts) || 'tabbalk verdwijnt al bij focus');

console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
process.exit(fout ? 1 : 0);
