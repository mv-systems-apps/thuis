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
controle('melding bij nieuwe versie verdwijnt niet vanzelf (geen timer die hem weghaalt)', () =>
  !/setTimeout\([^)]*meldingWeg/.test(scripts) || 'een melding wordt met een timer weggehaald');

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
  const ctx = vm.createContext({ TextDecoder, Intl, Map, Set, Date, JSON });
  vm.runInContext(m[1] + '\n;this.__k = { FORMAAT, normNaam, zoekVorm, schoonTekst, leegModel, maakId, leesBestand, schrijfBestand, recordNaarJson, pasToe, pasAllesToe, vervangIds, wekelijksTerug, opruimen, synchroniseer, backupsWeg, laatsteMoment, tijdstipTekst, artikelLijst, winkelLijst, winkelIndeling, winkelTellingen, teKoopIn, afdelingIn, suggestie, suggestieTekst, gekochtTekst, zoekArtikelen };', ctx);
  return ctx.__k;
}
const K = kern();
const NU = new Date(2026, 10, 21, 10, 0); // za 21-11-2026 10:00 lokale tijd
/* Een bestand opbouwen: B({ winkels, artikelen, ... }) → JSON-tekst met versie. */
const B = (delen) => JSON.stringify(Object.assign({ versie: K.FORMAAT }, delen));
const lees = (delen) => { const r = kern().leesBestand(typeof delen === 'string' ? delen : B(delen)); if (!r.ok) throw new Error(r.reden + ' ' + (r.detail || '')); return r.model; };
const uit = (k, m) => JSON.parse(k.schrijfBestand(m));
const H = (x) => Object.assign({ t: '2026-11-21T10:00', wie: 'Mark' }, x);
const VB = {
  instellingen: { wekelijks: { dag: 'za', tijd: '06:00', teruggezet: '2026-11-14T06:00' } },
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
  '"artikelen": {\n "p1111": {"naam":"Melk","soort":"wekelijks","ligt":{"w1111":"a1111","w2222":""},"gekocht":["2026-11-14"]}\n},\n"acties": {}\n}\n'));
controle('bestand: schrijven is stabiel', () => { const een = K.schrijfBestand(lees(VB)); return gelijk(K.schrijfBestand(K.leesBestand(een).model), een); });
controle('bestand: BOM herkend', () => { const r = K.leesBestand('﻿' + B({})); return gelijk(r.ok + '|' + r.model.bom, 'true|true'); });
controle('bestand: geen geldige UTF-8 wordt niet gelezen', () => gelijk(K.leesBestand(new Uint8Array([0x7B, 0x7D, 0xFF])).reden, 'geen-utf8'));
controle('bestand: kapotte JSON wordt niet gelezen', () => gelijk([K.leesBestand('{"versie": "' + K.FORMAAT + '", "artikelen": {').reden, K.leesBestand('[1]').reden].join(), 'geen-json,geen-json'));
controle('bestand: versie — nieuwer weigert (melding bijwerken), ouder of ontbrekend ook, leeg is een begin', () => gelijk(
  [K.leesBestand('{"versie": "1352903-000"}').reden, K.leesBestand('{"versie": "1352902-3FF"}').reden, K.leesBestand('{}').reden, K.leesBestand('').ok].join(),
  'nieuwer-formaat,onbekend-formaat,onbekend-formaat,true'));
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
  const h = k.vervangIds({ actie: 'plaats', id: 'x', winkel: 'w', afd: 'a', volgorde: ['a'], artikelen: ['x'] }, new Map([['x', 'X'], ['w', 'W'], ['a', 'A']]));
  return gelijk([h.id, h.winkel, h.afd, h.volgorde[0], h.artikelen[0]].join(''), 'XWAAX');
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

controle('platte tekst: HTML-tags en losse < > gaan eruit', () => gelijk(K.schoonTekst(' Kaas <img src=x onerror=1> en <b>brood</b> 3 > 2 '), 'Kaas en brood 3 2'));

/* ---------- opruimen ---------- */
controle('opruimen: oude afgeronde actie; archief standaard na 1 maand niet gekocht (ook via "weg"); op de lijst of zonder datum blijft', () => {
  const k = kern();
  const m = lees({ artikelen: { lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-10-01'] }, lam02: { naam: 'Lampje2', soort: 'eenmalig', op: '2026-11-20T10:00', gekocht: ['2025-10-01'] },
      bat01: { naam: 'Batterij', soort: 'eenmalig', gekocht: ['2026-11-01'] }, kaa01: { naam: 'Kaars', soort: 'eenmalig', weg: '2026-09-01' }, tas01: { naam: 'Tas', soort: 'eenmalig' },
      mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: ['2025-01-01'] } },
    acties: { a1111: { naam: 'Pakket', klaar: '2026-01-01' }, a2222: { naam: 'Filter', herhaal: 'maand', klaar: '2026-01-01' } } });
  const n = k.opruimen(m, NU);
  const o = uit(k, m);
  return gelijk(n + '|' + Object.keys(o.artikelen).sort().join() + '|' + Object.keys(o.acties).join(), '3|bat01,lam02,mel01,tas01|a2222');
});
controle('opruimen: instelling archief bewaren (1 jaar) telt; ongeldige waarde wordt niet gelezen', () => {
  const k = kern();
  const m = lees({ instellingen: { archief: { bewaren: '1j' } }, artikelen: { bat01: { naam: 'Batterij', soort: 'eenmalig', gekocht: ['2026-01-01'] }, lam01: { naam: 'Lampje', soort: 'eenmalig', gekocht: ['2025-10-01'] } } });
  k.opruimen(m, NU);
  const fout = k.leesBestand(JSON.stringify({ versie: k.FORMAAT, instellingen: { archief: { bewaren: 'toString' } } }));
  return gelijk(Object.keys(uit(k, m).artikelen).join() + '|' + fout.ok, 'bat01|false');
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
controle('ronde: alleen een BOM is reden om te schrijven', () => {
  const vb = JSON.parse(JSON.stringify(VB)); vb.instellingen.wekelijks.teruggezet = '2026-11-21T06:00';
  return gelijk(K.synchroniseer('﻿' + B(vb), [], NU).gewijzigd, true);
});
controle('ronde: ontbreekt de instelling voor wekelijks, dan komt de standaard erin', () => {
  const r = K.synchroniseer('', [], NU);
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
controle('winkel: AH — in looproute, zonder winkels (Cadeau) apart, Koffie (afdeling onbekend) staat niet op de lijst', () => {
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
  return gelijk(s && K.suggestieTekst(s), 'laatst 24 okt · meestal elke week');
});
controle('suggestie: niet bij te weinig aankopen of als het nog niet zo lang geleden is', () =>
  gelijk(K.suggestie(['2026-10-24', '2026-11-14'], '2026-11-21') === null && K.suggestie(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-18'], '2026-11-21') === null, true));
controle('gekocht: één regel; "meestal" pas vanaf drie aankopen', () => gelijk([
  K.gekochtTekst([]), K.gekochtTekst(['2026-11-08', '2026-11-15']), K.gekochtTekst(['2026-11-15', '2026-10-25', '2026-11-08', '2026-11-01'])].join('|'),
  'Nog niet gekocht|Laatst gekocht 15 nov|Laatst gekocht 15 nov · meestal elke week'));
controle('zoeken: deel van de naam, zonder hoofdletters en accenten', () => {
  const al = K.artikelLijst(lees({ artikelen: { a1111: { naam: 'Crème fraîche' }, a2222: { naam: 'Café-noir' }, a3333: { naam: 'Kaas' } } }));
  return gelijk(K.zoekArtikelen(al, 'creme FRAI').map((a) => a.naam).join() + '|' + K.zoekArtikelen(al, 'cafe').map((a) => a.naam).join(), 'Crème fraîche|Café-noir');
});

controle('invoer staat onderaan (boven de tabbalk), soortmenu klapt naar boven', () =>
  (/<\/main>\s*<div class="onderbalk" id="balk-boodschappen">/.test(html) && /\.menu\{position:absolute;z-index:10;bottom:/.test(html)) || 'invoer niet onderaan');

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
