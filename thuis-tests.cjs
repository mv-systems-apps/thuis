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
controle('melding bij nieuwe versie verdwijnt niet vanzelf (geen timer die hem weghaalt)', () =>
  !/setTimeout\([^)]*meldingWeg/.test(scripts) || 'een melding wordt met een timer weggehaald');

/* ---------- service worker ---------- */
const swPad = path.join(path.dirname(APP), 'sw-thuis.js');
controle('service worker: eigen cachenaam en thuis.html in de verplichte lijst', () => {
  const sw = fs.readFileSync(swPad, 'utf8');
  if (!/const CACHE_NAME = 'thuis-v' \+ CACHE_VERSION;/.test(sw)) return 'cachenaam is niet thuis-v<n>';
  return /const VERPLICHT = \['\.\/thuis\.html'\];/.test(sw) || 'thuis.html staat niet in VERPLICHT';
});

console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
process.exit(fout ? 1 : 0);
