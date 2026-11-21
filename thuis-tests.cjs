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
controle('tabbalk heeft precies Boodschappen, Doen en Instellingen', () => {
  const nav = (html.match(/<nav[\s\S]*?<\/nav>/) || [''])[0];
  const labels = [...nav.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  return gelijk(labels.join('|'), 'Boodschappen|Doen|Instellingen');
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
  vm.runInContext(m[1] + '\n;this.__k = { normNaam, schoonTekst, schoonLink, leesBestand, schrijfBestand, pasToe, wekelijksTerug, opruimen, synchroniseer, laatsteMoment, tijdstipTekst };', ctx);
  return ctx.__k;
}
const NU = new Date(2026, 10, 21, 10, 0); // za 21-11-2026 10:00 lokale tijd
const VOORBEELD = [
  'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-14T06:00',
  'afdeling;Groente & fruit',
  'afdeling;Zuivel & eieren',
  'winkel;Albert Heijn;route=Groente & fruit|Zuivel & eieren',
  'artikel;Bananen;soort=wekelijks;afd=Groente & fruit;gekocht=2026-11-07|2026-11-14',
  'artikel;Koffie;soort=regelmatig;gekocht=2026-10-03|2026-10-24',
  'artikel;Melk;soort=wekelijks;afd=Zuivel & eieren;op=2026-11-14T06:00',
  'actie;Schilder bellen'
].join('\n') + '\n';
const lees = (tekst) => { const r = kern().leesBestand(tekst); if (!r.ok) throw new Error(r.reden); return r; };
const rec = (model, soort, naam) => { for (const r of model.records.values()) if (r.soort === soort && r.vast[0] === naam) return r; return null; };

controle('bestand: lezen en ongewijzigd terugschrijven', () => {
  const k = kern();
  return gelijk(k.schrijfBestand(lees(VOORBEELD).model), VOORBEELD);
});
controle('bestand: CRLF en geen slotregeleinde blijven zo', () => {
  const k = kern();
  const t = 'afdeling;Brood\r\nafdeling;Kaas';
  return gelijk(k.schrijfBestand(lees(t).model), t);
});
controle('bestand: een BOM gaat eruit', () => {
  const k = kern();
  return gelijk(k.schrijfBestand(lees('﻿afdeling;Brood\n').model), 'afdeling;Brood\n');
});
controle('bestand: geen geldige UTF-8 wordt niet gelezen', () => {
  const r = kern().leesBestand(new Uint8Array([0x61, 0x72, 0xFF, 0x0A]));
  return gelijk(r.ok + '/' + r.reden, 'false/geen-utf8');
});
controle('bestand: onbekende regels en velden blijven staan', () => {
  const k = kern();
  const t = 'artikel;Thee;soort=regelmatig;kleur=groen;los veld\nnotitie van Mark zonder soortwoord\n';
  const uit = k.schrijfBestand(lees(t).model);
  return gelijk(uit, 'artikel;Thee;soort=regelmatig;kleur=groen;los veld\nnotitie van Mark zonder soortwoord\n');
});
controle('bestand: vaste volgorde (soortwoord, dan naam) en velden op volgorde', () => {
  const k = kern();
  const t = 'artikel;melk;op=2026-11-20T10:00;soort=wekelijks\nafdeling;Brood\nartikel;Appels;soort=eenmalig\n';
  return gelijk(k.schrijfBestand(lees(t).model), 'afdeling;Brood\nartikel;Appels;soort=eenmalig\nartikel;melk;soort=wekelijks;op=2026-11-20T10:00\n');
});
controle('bestand: lege velden en lege regels verdwijnen', () => {
  const k = kern();
  return gelijk(k.schrijfBestand(lees('artikel;Kaas;soort=wekelijks;afd=\n\n   \n').model), 'artikel;Kaas;soort=wekelijks\n');
});
controle('bestand: dubbele naam (hoofdletters, spaties) wordt samengevoegd en gemeld', () => {
  const r = lees('artikel;Kaas;soort=wekelijks\nartikel;  kaas ;afd=Zuivel\n');
  const k = kern();
  return gelijk(k.schrijfBestand(r.model) + '|' + r.meldingen.map((m) => m.soort).join(','),
    'artikel;Kaas;soort=wekelijks;afd=Zuivel\n|dubbele-naam');
});
controle('bestand: een = in de naam breekt de regel niet', () => {
  const k = kern();
  const t = 'artikel;1+1=2 aanbieding;soort=eenmalig\n';
  return gelijk(k.schrijfBestand(lees(t).model), t);
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
  return gelijk(r.status + '|' + kof.velden.get('op') + '|' + kof.velden.get('soort') + '|' + m.records.size, 'ok|2026-11-21T10:00|regelmatig|8');
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
  k.pasToe(m, H({ actie: 'hernoem', soort: 'afdeling', naam: 'Zuivel & eieren', nieuw: 'Zuivel' }), NU);
  const uit = k.schrijfBestand(m);
  return (/winkel;Albert Heijn;route=Groente & fruit\|Zuivel\n/.test(uit) && /artikel;Melk;soort=wekelijks;afd=Zuivel;/.test(uit) &&
    /hernoemd;afdeling;Zuivel & eieren;nieuw=Zuivel;op=2026-11-21/.test(uit)) || uit;
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
  return gelijk(r.status + '|' + k.schrijfBestand(m), 'heropend|actie;Pakket ophalen\n');
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
  return gelijk(k.wekelijksTerug(m, NU) + '|' + k.schrijfBestand(m), '0|instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2026-11-21T06:00\nartikel;Brood;soort=wekelijks\n');
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
  return gelijk(n + '|' + k.schrijfBestand(m), '3|artikel;Lampje;soort=eenmalig;op=2026-11-20T10:00;gekocht=2025-10-01\nactie;Filter;herhaal=maand;klaar=2026-01-01\nhernoemd;artikel;Cola;nieuw=Cola zero;op=2026-11-10\n');
});

/* ---------- een hele ronde ---------- */
controle('ronde: wachtrij toepassen op de nieuwste versie, met resultaten', () => {
  const k = kern();
  const r = k.synchroniseer(VOORBEELD, [
    H({ actie: 'zet', soort: 'artikel', naam: 'Melk', veld: 'op', oud: '2026-11-14T06:00', nieuw: '' }),
    H({ actie: 'gekocht', soort: 'artikel', naam: 'Melk', datum: '2026-11-21' }),
    H({ actie: 'zet', soort: 'artikel', naam: 'Pindakaas', veld: 'op', oud: '', nieuw: '2026-11-21T10:00' })
  ], NU);
  return gelijk(r.resultaten.map((x) => x.status).join(',') + '|' + r.terug + '|' + r.gewijzigd, 'ok,ok,vervallen|1|true');
});
controle('ronde: zonder wachtrij en zonder terugzetten is er niets te schrijven', () => {
  const k = kern();
  const t = VOORBEELD.replace('teruggezet=2026-11-14T06:00', 'teruggezet=2026-11-21T06:00');
  return gelijk(k.synchroniseer(t, [], NU).gewijzigd, false);
});
controle('ronde: alleen een BOM is reden om te schrijven (dan gaat hij eruit)', () => {
  const t = VOORBEELD.replace('teruggezet=2026-11-14T06:00', 'teruggezet=2026-11-21T06:00');
  const r = kern().synchroniseer('\uFEFF' + t, [], NU);
  return gelijk(r.gewijzigd + '|' + (r.tekst === t), 'true|true');
});
controle('ronde: een bestand dat geen UTF-8 is, wordt nooit verwerkt', () =>
  gelijk(kern().synchroniseer(new Uint8Array([0xC3, 0x28]), [], NU).ok, false));

console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
process.exit(fout ? 1 : 0);
