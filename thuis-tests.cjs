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


/* ================= kern: bestand (stap 3) en samenvoegen (stap 4) ================= */
function kern() {
  const m = /\/\* == kern == \*\/([\s\S]*?)\/\* == einde kern == \*\//.exec(scripts);
  if (!m) throw new Error('kernblok ontbreekt');
  const ctx = vm.createContext({ TextDecoder, Intl, Map, Date });
  vm.runInContext(m[1] + '\n;this.__k = { normNaam, schoonTekst, schoonLink, leesBestand, schrijfBestand, pasToe, wekelijksTerug, opruimen, synchroniseer, laatsteMoment, tijdstipTekst, artikelLijst, winkelLijst, winkelIndeling, suggestie, suggestieTekst, zoekArtikelen, zoekVorm, winkelTellingen, teKoopIn, afdelingIn };', ctx);
  return ctx.__k;
}
const NU = new Date(2026, 10, 21, 10, 0); // za 21-11-2026 10:00 lokale tijd
const VOORBEELD = [
  'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-14T06:00',
  'winkel;Albert Heijn;route=Groente & fruit|Zuivel & eieren',
  'artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;gekocht=2026-11-07|2026-11-14',
  'artikel;Koffie;soort=regelmatig;gekocht=2026-10-03|2026-10-24',
  'artikel;Melk;soort=wekelijks;ligt=Albert Heijn:Zuivel & eieren;op=2026-11-14T06:00',
  'actie;Schilder bellen'
].join('\n') + '\n';
const { regelsNaarJson: J, jsonNaarRegels: R, FORMAAT } = require('./test-hulp.cjs');
const lees = (tekst) => { const r = kern().leesBestand(J(tekst)); if (!r.ok) throw new Error(r.reden); return r; };
const rec = (model, soort, naam) => { for (const r of model.records.values()) if (r.soort === soort && r.vast[0] === naam) return r; return null; };

controle('bestand: lezen en terugschrijven verliest niets', () => gelijk(R(kern().schrijfBestand(lees(VOORBEELD).model)), VOORBEELD));
controle('bestand: precies deze opmaak (versie, één record per regel, lege delen kort)', () => {
  const k = kern();
  return gelijk(k.schrijfBestand(lees('winkel;AH;route=Zuivel|Brood\nartikel;Melk;soort=wekelijks;ligt=AH:Zuivel|Plus;gekocht=2026-11-14\nartikel;Kaas\n').model),
    '{\n"versie": "' + FORMAAT + '",\n"instellingen": {},\n"winkels": {\n "AH": {"afdelingen":["Zuivel","Brood"]}\n},\n' +
    '"artikelen": {\n "Kaas": {},\n "Melk": {"soort":"wekelijks","ligt":{"AH":"Zuivel","Plus":""},"gekocht":["2026-11-14"]}\n},\n"acties": {},\n"hernoemd": []\n}\n');
});
controle('bestand: schrijven is stabiel (nog een keer lezen en schrijven geeft hetzelfde)', () => {
  const k = kern(); const een = k.schrijfBestand(lees(VOORBEELD).model);
  return gelijk(k.schrijfBestand(k.leesBestand(een).model), een);
});
controle('bestand: een BOM wordt herkend (en gaat er bij schrijven uit)', () => {
  const r = kern().leesBestand('﻿' + J('winkel;Brood\n'));
  return gelijk(r.ok + '|' + r.model.bom + '|' + R(kern().schrijfBestand(r.model)), 'true|true|winkel;Brood\n');
});
controle('bestand: geen geldige UTF-8 wordt niet gelezen', () => {
  const r = kern().leesBestand(new Uint8Array([0x7B, 0x7D, 0xFF, 0x0A]));
  return gelijk(r.ok + '/' + r.reden, 'false/geen-utf8');
});
controle('bestand: kapotte JSON wordt niet gelezen', () => {
  const k = kern();
  return gelijk([k.leesBestand('{"versie": "' + FORMAAT + '", "artikelen": {').reden, k.leesBestand('[1,2]').reden].join(','), 'geen-json,geen-json');
});
controle('bestand: versie — nieuwer weigert, ontbrekend of ouder ook, leeg bestand is een begin', () => {
  const k = kern();
  return gelijk([k.leesBestand('{"versie": "1352902-400"}').reden, k.leesBestand('{"versie": "1352903-000"}').reden,
    k.leesBestand('{"artikelen": {}}').reden, k.leesBestand('{"versie": "1352902-3FE"}').reden, k.leesBestand('').ok].join(','),
    'nieuwer-formaat,nieuwer-formaat,onbekend-formaat,onbekend-formaat,true');
});
controle('bestand: onbekende delen en velden blijven staan, ook als het geen tekst is', () => {
  const k = kern();
  const t = '{"versie": "' + FORMAAT + '", "artikelen": {"Thee": {"soort": "regelmatig", "kleur": "groen", "maat": {"l": 2}}}, "boodschappenlijst2": [1, 2]}';
  const uit = JSON.parse(k.schrijfBestand(k.leesBestand(t).model));
  return gelijk(JSON.stringify([uit.artikelen.Thee, uit.boodschappenlijst2]), '[{"soort":"regelmatig","kleur":"groen","maat":{"l":2}},[1,2]]');
});
controle('bestand: namen op volgorde en velden in vaste volgorde', () => {
  const k = kern();
  const t = '{"versie": "' + FORMAAT + '", "artikelen": {"melk": {"op": "2026-11-20T10:00", "soort": "wekelijks"}, "Appels": {"soort": "eenmalig"}}}';
  return gelijk(R(k.schrijfBestand(k.leesBestand(t).model)), 'artikel;Appels;soort=eenmalig\nartikel;melk;soort=wekelijks;op=2026-11-20T10:00\n');
});
controle('bestand: lege velden verdwijnen', () => gelijk(R(kern().schrijfBestand(lees('artikel;Kaas;soort=wekelijks;ligt=;op=\n').model)), 'artikel;Kaas;soort=wekelijks\n'));
controle('bestand: dubbele naam (hoofdletters, spaties) wordt samengevoegd en gemeld', () => {
  const k = kern();
  const r = k.leesBestand('{"versie": "' + FORMAAT + '", "artikelen": {"Kaas": {"soort": "wekelijks"}, "  kaas ": {"ligt": {"AH": ""}}}}');
  return gelijk(R(k.schrijfBestand(r.model)) + '|' + r.meldingen.map((m) => m.soort).join(','), 'artikel;Kaas;soort=wekelijks;ligt=AH\n|dubbele-naam');
});
controle('bestand: ; | = en " in een naam zijn geen probleem', () => {
  const k = kern();
  const t = '{"versie": "' + FORMAAT + '", "artikelen": {"1+1=2; \\"actie\\" | x": {"soort": "eenmalig"}}}';
  return gelijk(Object.keys(JSON.parse(k.schrijfBestand(k.leesBestand(t).model)).artikelen).join(), '1+1=2; "actie" | x');
});
controle('invoer: ; en | en regeleindes worden opgeschoond', () => gelijk(kern().schoonTekst('  Melk;\nhalfvol | 1 L  '), 'Melk, halfvol 1 L'));
controle('link: ; en | gecodeerd', () => gelijk(kern().schoonLink(' https://x.nl/a;b|c '), 'https://x.nl/a%3Bb%7Cc'));
controle('naam vergelijken: hoofdletters, spaties en NFC', () => {
  const k = kern();
  return gelijk(k.normNaam('  Crème   Fraîche ') === k.normNaam('crème fraîche') &&
    k.normNaam('Crème') === k.normNaam('Crème'), true);
});

/* ---------- samenvoegen ---------- */
const H = (x) => Object.assign({ t: '2026-11-21T10:00', wie: 'Mark' }, x);
controle('samenvoegen: nieuw artikel komt erin', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  const r = k.pasToe(m, H({ actie: 'nieuw', soort: 'artikel', naam: 'Pesto', velden: { soort: 'eenmalig', op: '2026-11-21T10:00', opdoor: 'Mark' } }), NU);
  return gelijk(r.status + '|' + rec(m, 'artikel', 'Pesto').velden.get('soort'), 'ok|eenmalig');
});
controle('samenvoegen: + op een bestaand artikel zet het op de lijst (geen dubbele)', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  const r = k.pasToe(m, H({ actie: 'nieuw', soort: 'artikel', naam: 'koffie', velden: { soort: 'eenmalig' } }), NU);
  const kof = rec(m, 'artikel', 'Koffie');
  return gelijk(r.status + '|' + kof.velden.get('op') + '|' + kof.velden.get('soort') + '|' + m.records.size, 'ok|2026-11-21T10:00|regelmatig|6');
});
controle('samenvoegen: allebei Melk op de lijst is geen botsing', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', naam: 'Melk', veld: 'op', oud: '', nieuw: '2026-11-21T09:58' }), NU);
  return gelijk(r.status, 'al');
});
controle('samenvoegen: ander veld van hetzelfde artikel botst niet', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  k.pasToe(m, H({ actie: 'zet', soort: 'artikel', naam: 'Melk', veld: 'op', oud: '2026-11-14T06:00', nieuw: '' }), NU);
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', naam: 'Melk', veld: 'soort', oud: 'wekelijks', nieuw: 'regelmatig' }), NU);
  const melk = rec(m, 'artikel', 'Melk');
  return gelijk(r.status + '|' + melk.velden.get('soort') + '|' + (melk.velden.get('op') || ''), 'ok|regelmatig|');
});
controle('samenvoegen: echte botsing in tekst wint de laatste, met de vorige waarde erbij', () => {
  const k = kern(); const m = lees('actie;Schilder bellen;notitie=na 17 uur\n').model;
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'actie', naam: 'Schilder bellen', veld: 'notitie', oud: '', nieuw: 'nummer in mail' }), NU);
  return gelijk(r.status + '|' + r.vorige + '|' + rec(m, 'actie', 'Schilder bellen').velden.get('notitie'), 'botsing|na 17 uur|nummer in mail');
});
controle('samenvoegen: handeling op een verwijderd artikel vervalt (geen zombie)', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  k.pasToe(m, H({ actie: 'weg', soort: 'artikel', naam: 'Koffie' }), NU);
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', naam: 'Koffie', veld: 'op', oud: '', nieuw: '2026-11-21T10:00' }), NU);
  return gelijk(r.status + '|' + (rec(m, 'artikel', 'Koffie') === null), 'vervallen|true');
});
controle('samenvoegen: hernoemen neemt verwijzingen mee en laat een spoor', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  k.pasToe(m, H({ actie: 'hernoem', soort: 'winkel', naam: 'Albert Heijn', nieuw: 'AH' }), NU);
  const uit = R(k.schrijfBestand(m));
  return (/winkel;AH;route=Groente & fruit\|Zuivel & eieren\n/.test(uit) && /artikel;Melk;soort=wekelijks;ligt=AH:Zuivel & eieren;/.test(uit) &&
    /hernoemd;winkel;Albert Heijn;nieuw=AH;op=2026-11-21/.test(uit)) || uit;
});
controle('samenvoegen: handeling met de oude naam vindt het hernoemde artikel', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  k.pasToe(m, H({ actie: 'hernoem', soort: 'artikel', naam: 'Koffie', nieuw: 'Koffiebonen' }), NU);
  const r = k.pasToe(m, H({ actie: 'zet', soort: 'artikel', naam: 'Koffie', veld: 'op', oud: '', nieuw: '2026-11-21T10:05' }), NU);
  return gelijk(r.status + '|' + rec(m, 'artikel', 'Koffiebonen').velden.get('op'), 'ok|2026-11-21T10:05');
});
controle('samenvoegen: hernoemen naar een bezette naam vervalt', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  const r = k.pasToe(m, H({ actie: 'hernoem', soort: 'artikel', naam: 'Koffie', nieuw: 'melk' }), NU);
  return gelijk(r.status + '|' + r.reden, 'vervallen|naam-bezet');
});
controle('samenvoegen: afgeronde actie opnieuw invoeren heropent hem', () => {
  const k = kern(); const m = lees('actie;Pakket ophalen;klaar=2026-11-20;door=Mark\n').model;
  const r = k.pasToe(m, H({ actie: 'nieuw', soort: 'actie', naam: 'pakket ophalen', velden: {} }), NU);
  return gelijk(r.status + '|' + R(k.schrijfBestand(m)), 'heropend|actie;Pakket ophalen\n');
});
controle('samenvoegen: gekocht houdt de laatste zes, gesorteerd, zonder dubbele', () => {
  const k = kern(); const m = lees('artikel;Kaas;gekocht=2026-01-01|2026-02-01|2026-03-01|2026-04-01|2026-05-01|2026-06-01\n').model;
  k.pasToe(m, H({ actie: 'gekocht', soort: 'artikel', naam: 'Kaas', datum: '2026-11-21' }), NU);
  k.pasToe(m, H({ actie: 'gekocht', soort: 'artikel', naam: 'Kaas', datum: '2026-11-21' }), NU);
  return gelijk(rec(m, 'artikel', 'Kaas').velden.get('gekocht'), '2026-02-01|2026-03-01|2026-04-01|2026-05-01|2026-06-01|2026-11-21');
});

/* ---------- wekelijks terug ---------- */
controle('wekelijks: laatste zaterdag 06:00 wordt goed berekend', () =>
  gelijk(kern().tijdstipTekst(kern().laatsteMoment(NU, 'za', '06:00')), '2026-11-21T06:00'));
controle('wekelijks: vóór 06:00 telt nog de vorige zaterdag', () =>
  gelijk(kern().tijdstipTekst(kern().laatsteMoment(new Date(2026, 10, 21, 5, 59), 'za', '06:00')), '2026-11-14T06:00'));
controle('wekelijks: niet-gekochte wekelijkse artikelen komen terug, één keer', () => {
  const k = kern(); const m = lees(VOORBEELD).model;
  const n1 = k.wekelijksTerug(m, NU), n2 = k.wekelijksTerug(m, NU);
  return gelijk(n1 + '|' + n2 + '|' + rec(m, 'artikel', 'Bananen').velden.get('op'), '1|0|2026-11-21T06:00');
});
controle('wekelijks: na het moment gekocht komt niet terug (telefoon die offline was)', () => {
  const k = kern(); const m = lees(VOORBEELD.replace('gekocht=2026-11-07|2026-11-14', 'gekocht=2026-11-14|2026-11-21')).model;
  return gelijk(k.wekelijksTerug(m, NU) + '|' + (rec(m, 'artikel', 'Bananen').velden.get('op') || ''), '0|');
});
controle('wekelijks: eerste keer legt alleen het moment vast', () => {
  const k = kern(); const m = lees('instelling;wekelijks;dag=za;tijd=06:00\nartikel;Brood;soort=wekelijks\n').model;
  return gelijk(k.wekelijksTerug(m, NU) + '|' + R(k.schrijfBestand(m)), '0|instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-21T06:00\nartikel;Brood;soort=wekelijks\n');
});

/* ---------- opruimen ---------- */
controle('opruimen: oud spoor, oude afgeronde actie en oud eenmalig artikel', () => {
  const k = kern();
  const m = lees([
    'hernoemd;artikel;Thee;nieuw=Groene thee;op=2026-10-01',
    'hernoemd;artikel;Cola;nieuw=Cola zero;op=2026-11-10',
    'actie;Oud klusje;klaar=2026-08-01',
    'actie;Filter;herhaal=maand;klaar=2026-01-01',
    'artikel;Batterijen;soort=eenmalig;gekocht=2025-10-01',
    'artikel;Lampje;soort=eenmalig;gekocht=2025-10-01;op=2026-11-20T10:00'
  ].join('\n') + '\n').model;
  const n = k.opruimen(m, NU);
  return gelijk(n + '|' + R(k.schrijfBestand(m)), '3|artikel;Lampje;soort=eenmalig;op=2026-11-20T10:00;gekocht=2025-10-01\nactie;Filter;herhaal=maand;klaar=2026-01-01\nhernoemd;artikel;Cola;nieuw=Cola zero;op=2026-11-10\n');
});

/* ---------- een hele ronde ---------- */
controle('ronde: wachtrij toepassen op de nieuwste versie, met resultaten', () => {
  const k = kern();
  const r = k.synchroniseer(J(VOORBEELD), [
    H({ actie: 'zet', soort: 'artikel', naam: 'Melk', veld: 'op', oud: '2026-11-14T06:00', nieuw: '' }),
    H({ actie: 'gekocht', soort: 'artikel', naam: 'Melk', datum: '2026-11-21' }),
    H({ actie: 'zet', soort: 'artikel', naam: 'Pindakaas', veld: 'op', oud: '', nieuw: '2026-11-21T10:00' })
  ], NU);
  return gelijk(r.resultaten.map((x) => x.status).join(',') + '|' + r.terug + '|' + r.gewijzigd, 'ok,ok,vervallen|1|true');
});
controle('ronde: zonder wachtrij en zonder terugzetten is er niets te schrijven', () => {
  const k = kern();
  const t = VOORBEELD.replace('teruggezet=2026-11-14T06:00', 'teruggezet=2026-11-21T06:00');
  return gelijk(k.synchroniseer(J(t), [], NU).gewijzigd, false);
});
controle('ronde: alleen een BOM is reden om te schrijven (dan gaat hij eruit)', () => {
  const t = VOORBEELD.replace('teruggezet=2026-11-14T06:00', 'teruggezet=2026-11-21T06:00');
  const r = kern().synchroniseer('\uFEFF' + J(t), [], NU);
  return gelijk(r.gewijzigd + '|' + (R(r.tekst) === t), 'true|true');
});
controle('ronde: ontbreekt de instelling voor wekelijks, dan komt de standaard erin', () => {
  const r = kern().synchroniseer('', [], NU);
  return gelijk(r.gewijzigd + '|' + R(r.tekst).split('\n')[0], 'true|instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-21T06:00');
});
controle('ronde: een bestand dat geen UTF-8 is, wordt nooit verwerkt', () =>
  gelijk(kern().synchroniseer(new Uint8Array([0xC3, 0x28]), [], NU).ok, false));


/* ================= stap 6 en 7: weergave, winkelstand ================= */
const WINKELS = [
  'winkel;Albert Heijn;route=Groente & fruit|Brood|Zuivel',
  'winkel;Lidl;route=Zuivel',
  'artikel;Bananen;ligt=Albert Heijn:Groente & fruit;op=2026-11-21T06:00',
  'artikel;Brood;ligt=Albert Heijn:Brood|Lidl;op=2026-11-21T06:00',
  'artikel;Hummus;ligt=Lidl:Zuivel;op=2026-11-21T06:00',
  'artikel;Kattenvoer;ligt=Albert Heijn;op=2026-11-21T06:00',
  'artikel;Afwasborstel;op=2026-11-21T06:00',
  'artikel;Melk;ligt=Albert Heijn:Zuivel|Lidl:Zuivel;op=2026-11-21T06:00',
  'artikel;Rijst;ligt=Albert Heijn:Brood'
].join('\n') + '\n';
controle('winkel: indeling in looproute, zonder afdeling of winkels bovenaan, elders apart', () => {
  const k = kern(); const m = lees(WINKELS).model;
  const ah = k.winkelLijst(m).find((w) => w.naam === 'Albert Heijn');
  const ind = k.winkelIndeling(k.artikelLijst(m), ah);
  return gelijk(ind.boven.map((a) => a.naam).join(',') + '|' + ind.groepen.map((g) => g.afd + ':' + g.items.map((a) => a.naam).join('+')).join(',') + '|' + ind.elders.map((a) => a.naam).join(','),
    'Afwasborstel,Kattenvoer|Groente & fruit:Bananen,Brood:Brood,Zuivel:Melk|Hummus');
});
controle('winkel: in de Lidl Hummus en Melk in de route, Brood (afdeling onbekend) en Afwasborstel (geen winkels) bovenaan', () => {
  const k = kern(); const m = lees(WINKELS).model;
  const lidl = k.winkelLijst(m).find((w) => w.naam === 'Lidl');
  const ind = k.winkelIndeling(k.artikelLijst(m), lidl);
  return gelijk(ind.boven.map((a) => a.naam).join(',') + '|' + ind.groepen.map((g) => g.afd + ':' + g.items.map((a) => a.naam).join('+')).join(','),
    'Afwasborstel,Brood|Zuivel:Hummus+Melk');
});
controle('winkel: een afdeling aan de route toevoegen botst niet en geeft geen dubbele', () => {
  const k = kern(); const m = lees(WINKELS).model;
  const r1 = k.pasToe(m, H({ actie: 'lijstErbij', soort: 'winkel', naam: 'Lidl', veld: 'route', waarde: 'Brood' }), NU);
  const r2 = k.pasToe(m, H({ actie: 'lijstErbij', soort: 'winkel', naam: 'Lidl', veld: 'route', waarde: 'brood' }), NU);
  return gelijk(r1.status + '|' + r2.status + '|' + k.winkelLijst(m).find((w) => w.naam === 'Lidl').route.join('|'), 'ok|al|Zuivel|Brood');
});
controle('winkel: terugzetten haalt de aankoopdatum weer weg', () => {
  const k = kern(); const m = lees('artikel;Kaas;gekocht=2026-11-14\n').model;
  k.pasToe(m, H({ actie: 'gekocht', soort: 'artikel', naam: 'Kaas', datum: '2026-11-21' }), NU);
  k.pasToe(m, H({ actie: 'nietGekocht', soort: 'artikel', naam: 'Kaas', datum: '2026-11-21' }), NU);
  return gelijk(R(k.schrijfBestand(m)), 'artikel;Kaas;gekocht=2026-11-14\n');
});
controle('suggestie: na drie aankopen en langer dan gewoonlijk geleden', () => {
  const k = kern();
  const s = k.suggestie(['2026-10-03', '2026-10-24', '2026-10-10', '2026-10-17'], '2026-11-21');
  return gelijk(s && k.suggestieTekst(s), 'laatst 24 okt · meestal elke week');
});
controle('suggestie: niet bij te weinig aankopen of als het nog niet zo lang geleden is', () => {
  const k = kern();
  return gelijk(k.suggestie(['2026-10-24', '2026-11-14'], '2026-11-21') === null &&
    k.suggestie(['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-18'], '2026-11-21') === null, true);
});
controle('zoeken: deel van de naam, zonder hoofdletters', () => {
  const k = kern();
  const al = k.artikelLijst(lees(WINKELS).model);
  return gelijk(k.zoekArtikelen(al, 'RO').map((a) => a.naam).join(',') + '|' + k.zoekArtikelen(al, ' BORST').map((a) => a.naam).join(','), 'Brood|Afwasborstel');
});

const PLEKKEN = [
  'winkel;Albert Heijn;route=Zuivel', 'winkel;Plus;route=Koeling', 'winkel;Gamma;route=IJzerwaren', 'winkel;Lidl',
  'artikel;Melk;ligt=Albert Heijn:Zuivel|Plus:Koeling;op=1',
  'artikel;Schroeven;ligt=Gamma:IJzerwaren;op=1',
  'artikel;Cadeau;op=1',
  'artikel;Hummus;ligt=Lidl;op=1',
  'artikel;Brood;ligt=Albert Heijn|Plus;op=1'
].join('\n') + '\n';
controle('plekken: melk ligt bij de AH in Zuivel en bij de Plus in Koeling', () => {
  const k = kern(); const m = lees(PLEKKEN).model; const ws = k.winkelLijst(m); const as = k.artikelLijst(m);
  const ah = k.winkelIndeling(as, ws.find((w) => w.naam === 'Albert Heijn'));
  const plus = k.winkelIndeling(as, ws.find((w) => w.naam === 'Plus'));
  return gelijk(JSON.stringify([ah.groepen.map((g) => g.afd + ':' + g.items.map((a) => a.naam)), plus.groepen.map((g) => g.afd + ':' + g.items.map((a) => a.naam))]),
    '[["Zuivel:Melk"],["Koeling:Melk"]]');
});
controle('plekken: in de Gamma geen melk en brood, wel schroeven; zonder winkels staat bovenaan', () => {
  const k = kern(); const m = lees(PLEKKEN).model; const ws = k.winkelLijst(m);
  const g = k.winkelIndeling(k.artikelLijst(m), ws.find((w) => w.naam === 'Gamma'));
  return gelijk(JSON.stringify({ boven: g.boven.map((a) => a.naam), groepen: g.groepen.map((x) => x.afd), elders: g.elders.map((a) => a.naam) }),
    '{"boven":["Cadeau"],"groepen":["IJzerwaren"],"elders":["Brood","Hummus","Melk"]}');
});
controle('winkelkeuze: alleen winkels waar iets is vastgelegd, meeste eerst; overal-artikelen tellen niet', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  return gelijk(k.winkelTellingen(k.artikelLijst(m), k.winkelLijst(m)).map((x) => x.naam + ' ' + x.aantal).join(', '),
    'Albert Heijn 2, Plus 2, Gamma 1, Lidl 1');
});
controle('winkelkeuze: na het kopen bij de AH valt de Plus weg', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  const as = k.artikelLijst(m).map((a) => a.naam === 'Melk' || a.naam === 'Brood' ? Object.assign({}, a, { op: '' }) : a);
  return gelijk(k.winkelTellingen(as, k.winkelLijst(m)).map((x) => x.naam).join(','), 'Gamma,Lidl');
});
controle('plaats: in een tweede winkel erbij, afdeling vervangen', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  k.pasToe(m, { actie: 'plaats', soort: 'artikel', naam: 'Hummus', winkel: 'Plus', afd: 'Koeling' });
  k.pasToe(m, { actie: 'plaats', soort: 'artikel', naam: 'Melk', winkel: 'Plus', afd: 'Zuivel' });
  const t2 = R(k.schrijfBestand(m));
  return gelijk([/^artikel;Hummus;.*$/m.exec(t2)[0], /^artikel;Melk;.*$/m.exec(t2)[0]].join('\n'),
    'artikel;Hummus;ligt=Lidl|Plus:Koeling;op=1\nartikel;Melk;ligt=Albert Heijn:Zuivel|Plus:Zuivel;op=1');
});
controle('plaats: twee telefoons plaatsen in verschillende winkels, botst niet', () => {
  const k = kern(); const m = lees('artikel;Melk;op=1\n').model;
  const r1 = k.pasToe(m, { actie: 'plaats', soort: 'artikel', naam: 'Melk', winkel: 'AH', afd: 'Zuivel' });
  const r2 = k.pasToe(m, { actie: 'plaats', soort: 'artikel', naam: 'Melk', winkel: 'Plus', afd: '' });
  return gelijk(r1.status + r2.status + ' ' + R(k.schrijfBestand(m)), 'okok artikel;Melk;ligt=AH:Zuivel|Plus;op=1\n');
});
controle('hernoemen van winkel en afdeling gaat mee in ligt=', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  k.pasToe(m, { actie: 'hernoem', soort: 'winkel', naam: 'Plus', nieuw: 'Plus Oost' });
  k.pasToe(m, { actie: 'afdHernoem', soort: 'winkel', naam: 'Albert Heijn', afd: 'Zuivel', nieuw: 'Zuivel & eieren' });
  const t2 = R(k.schrijfBestand(m));
  return gelijk([/^artikel;Melk;.*$/m.exec(t2)[0], /^artikel;Brood;.*$/m.exec(t2)[0]].join('\n'),
    'artikel;Melk;ligt=Albert Heijn:Zuivel & eieren|Plus Oost:Koeling;op=1\nartikel;Brood;ligt=Albert Heijn|Plus Oost;op=1');
});
controle('afdelingen per winkel: volgorde, met wat de ander intussen toevoegde achteraan', () => {
  const k = kern(); const m = lees('winkel;AH;route=A|B|C\n').model;
  k.pasToe(m, { actie: 'lijstErbij', soort: 'winkel', naam: 'AH', veld: 'route', waarde: 'D' });
  const r = k.pasToe(m, { actie: 'volgorde', soort: 'winkel', naam: 'AH', volgorde: ['C', 'A', 'B', 'X'] });
  return gelijk(r.status + ' ' + R(k.schrijfBestand(m)), 'ok winkel;AH;route=C|A|B|D\n');
});
controle('afdeling hernoemen: alleen in die winkel, artikelen gaan mee', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  k.pasToe(m, { actie: 'afdHernoem', soort: 'winkel', naam: 'Albert Heijn', afd: 'Zuivel', nieuw: 'Zuivel & eieren' });
  const t2 = R(k.schrijfBestand(m));
  return gelijk([/^winkel;Albert Heijn.*$/m.exec(t2)[0], /^artikel;Melk;.*$/m.exec(t2)[0]].join('\n'),
    'winkel;Albert Heijn;route=Zuivel & eieren\nartikel;Melk;ligt=Albert Heijn:Zuivel & eieren|Plus:Koeling;op=1');
});
controle('afdeling hernoemen naar een naam die de winkel al heeft vervalt', () => {
  const k = kern(); const m = lees('winkel;AH;route=A|B\n').model;
  return gelijk(k.pasToe(m, { actie: 'afdHernoem', soort: 'winkel', naam: 'AH', afd: 'A', nieuw: 'b' }).status, 'vervallen');
});
controle('afdeling weghalen: artikel blijft te koop in die winkel, afdeling onbekend', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  k.pasToe(m, { actie: 'afdWeg', soort: 'winkel', naam: 'Plus', afd: 'Koeling' });
  const t2 = R(k.schrijfBestand(m));
  return gelijk([/^winkel;Plus.*$/m.exec(t2)[0], /^artikel;Melk;.*$/m.exec(t2)[0]].join('\n'),
    'winkel;Plus\nartikel;Melk;ligt=Albert Heijn:Zuivel|Plus;op=1');
});
controle('winkel verwijderen haalt hem ook weg bij de artikelen', () => {
  const k = kern(); const m = lees(PLEKKEN).model;
  k.pasToe(m, { actie: 'weg', soort: 'winkel', naam: 'Plus' });
  k.pasToe(m, { actie: 'weg', soort: 'winkel', naam: 'Lidl' });
  const t2 = R(k.schrijfBestand(m));
  return gelijk([/^artikel;Melk;.*$/m.exec(t2)[0], /^artikel;Hummus;.*$/m.exec(t2)[0], /^artikel;Brood;.*$/m.exec(t2)[0], String(/^winkel;Plus/m.test(t2))].join('\n'),
    'artikel;Melk;ligt=Albert Heijn:Zuivel;op=1\nartikel;Hummus;op=1\nartikel;Brood;ligt=Albert Heijn;op=1\nfalse');
});
controle('invoer staat onderaan (boven de tabbalk), soortmenu klapt naar boven', () =>
  (/<\/main>\s*<div class="onderbalk" id="balk-boodschappen">/.test(html) && /\.menu\{position:absolute;z-index:10;bottom:/.test(html)) || 'invoer niet onderaan');

controle('tabbalk staat altijd in beeld: body vast aan de schermranden, geen 100dvh; scherm krimpt met het toetsenbord', () =>
  (/body\{[^}]*position:fixed;inset:0\}/.test(html) && !/body\{[^}]*100dvh/.test(html) && /interactive-widget=resizes-content/.test(html)) || 'opbouw klopt niet');

controle('zoeken zonder accenten: creme vindt Crème fraîche, cafe vindt Café', () => {
  const k = kern();
  const al = k.artikelLijst(lees('artikel;Crème fraîche\nartikel;Café-noir\nartikel;Kaas\n').model);
  return gelijk(k.zoekArtikelen(al, 'creme FRAI').map((a) => a.naam).join() + '|' + k.zoekArtikelen(al, 'cafe').map((a) => a.naam).join(), 'Crème fraîche|Café-noir');
});

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
