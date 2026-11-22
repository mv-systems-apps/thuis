/* Rooktest van thuis.html in jsdom, met een gesimuleerde OneDrive:
     NODE_PATH=<map met jsdom en fake-indexeddb> node thuis-dom.cjs
   (npm i jsdom fake-indexeddb). Met APP=<pad> een andere versie controleren.
   Dit is géén echte browser: geen opmaak, geen service worker, geen aanmelden bij
   Microsoft. Het test de samenwerking van scherm, lokale kopie, wachtrij en de
   synchronisatie met OneDrive (lezen, If-Match, 412, dagbackup). Exitcode 1 bij een fout. */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = process.env.APP || path.join(__dirname, 'thuis.html');
const html = fs.readFileSync(APP, 'utf8');
const slaap = (ms) => new Promise((r) => setTimeout(r, ms));

let goed = 0, fout = 0;
function controle(naam, ok, extra) {
  if (ok) { goed++; return; }
  fout++; console.log('FOUT  ' + naam + (extra ? ' — ' + extra : ''));
}

/* ---------- gesimuleerde OneDrive ---------- */
function onedrive(begintekst) {
  const od = { bestanden: {}, puts: 0, verzoeken: [], botsBijVolgendePut: null };
  let teller = 1;
  const zet = (naam, tekst) => { od.bestanden[naam] = { tekst, eTag: '"e' + (teller++) + '"', id: 'id-' + naam }; };
  if (begintekst !== null) zet('thuis.txt', begintekst);
  od.zet = zet;
  const antwoord = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    arrayBuffer: async () => (body instanceof Uint8Array ? body : new TextEncoder().encode(String(body))).buffer
  });
  const item = (naam) => ({ id: od.bestanden[naam].id, name: naam, eTag: od.bestanden[naam].eTag, '@microsoft.graph.downloadUrl': 'https://download.test/' + naam });
  const naamVanId = (id) => Object.keys(od.bestanden).find((n) => od.bestanden[n].id === id);
  od.fetch = async (url, init) => {
    init = init || {};
    const methode = init.method || 'GET';
    od.verzoeken.push(methode + ' ' + url);
    if (url.startsWith('https://download.test/')) {
      const b = od.bestanden[decodeURIComponent(url.slice(22))];
      return b ? antwoord(200, b.bytes || b.tekst) : antwoord(404, {});
    }
    if (url.includes('/oauth2/')) return antwoord(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    const g = url.replace('https://graph.microsoft.com/v1.0', '');
    if (g.startsWith('/me')) return antwoord(200, { displayName: 'Testspeler Een' });
    let m = /^\/drives\/D\/items\/MAP:\/([^:?]+)(:\/content)?/.exec(g);
    if (m) {
      const naam = decodeURIComponent(m[1]);
      if (methode === 'GET') return od.bestanden[naam] ? antwoord(200, item(naam)) : antwoord(404, {});
      if (methode === 'PUT') {
        if (od.bestanden[naam] && /conflictBehavior=fail/.test(g)) return antwoord(409, {});
        zet(naam, String(init.body));
        return antwoord(201, item(naam));
      }
    }
    m = /^\/drives\/D\/items\/([^/?]+)(\/content)?/.exec(g);
    if (m) {
      const naam = naamVanId(m[1]);
      if (!naam) return antwoord(404, {});
      if (methode === 'GET') return antwoord(200, item(naam));
      if (methode === 'PUT') {
        od.puts++;
        if (od.botsBijVolgendePut) { const b = od.botsBijVolgendePut; od.botsBijVolgendePut = null; zet(naam, b(od.bestanden[naam].tekst)); }
        const h = init.headers || {};
        if (h['If-Match'] && h['If-Match'] !== od.bestanden[naam].eTag) return antwoord(412, {});
        zet(naam, String(init.body));
        return antwoord(200, item(naam));
      }
    }
    return antwoord(400, { error: { code: 'onbekend', message: g } });
  };
  return od;
}

/* ---------- app starten ---------- */
async function start(od) {
  const fakeIdb = require('fake-indexeddb');
  const idb = new fakeIdb.IDBFactory();
  // vooraf: aangemeld en een gekoppelde map
  await new Promise((resolve, reject) => {
    const req = idb.open('thuis', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const t = req.result.transaction('kv', 'readwrite');
      t.objectStore('kv').put({ access: 'a', accessTot: Date.now() + 3600e3, refresh: 'r', aangemeldOp: Date.now(), naam: 'Testspeler Een' }, 'auth');
      t.objectStore('kv').put({ driveId: 'D', itemId: 'MAP', naam: 'thuis' }, 'map');
      t.oncomplete = () => { req.result.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
  const dom = new JSDOM(html, {
    url: 'https://mv-systems-apps.github.io/thuis/thuis.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.indexedDB = idb;
      w.fetch = od.fetch;
      w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
      w.matchMedia = () => ({ matches: true, addEventListener() {} });
      w.scrollTo = () => {};
      w.console.error = () => {};
    }
  });
  await slaap(600);
  return dom.window;
}
const namenInLijst = (w) => [...w.document.querySelectorAll('#lijst .item')].map((r) => r.dataset.naam);
async function typ(w, tekst) {
  const i = w.document.getElementById('invoerTekst');
  i.value = tekst;
  i.dispatchEvent(new w.Event('input'));
}
async function plus(w) { w.document.getElementById('invoerPlus').click(); }

const BEGIN = [
  'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2000-01-01T06:00',
  'artikel;Bananen;soort=wekelijks;gekocht=2000-01-01',
  'artikel;Koffie;soort=regelmatig',
  'artikel;Melk;soort=wekelijks;op=2026-11-14T06:00'
].join('\n') + '\n';

(async () => {
  /* 1. Openen: lezen, wekelijks terug, wegschrijven met dagbackup. */
  let od = onedrive(BEGIN);
  let w = await start(od);
  await slaap(800);
  const lijst1 = namenInLijst(w);
  controle('openen: de lijst toont wat in OneDrive op de lijst staat', lijst1.includes('Melk'), JSON.stringify(lijst1));
  controle('openen: wekelijks terug (Bananen weer op de lijst)', lijst1.includes('Bananen'), JSON.stringify(lijst1));
  controle('openen: Koffie (niet op de lijst) staat er niet bij', !lijst1.includes('Koffie'));
  controle('openen: teruggezet weggeschreven naar OneDrive', /artikel;Bananen;soort=wekelijks;op=/.test(od.bestanden['thuis.txt'].tekst), od.bestanden['thuis.txt'].tekst);
  controle('openen: dagbackup gemaakt met de versie van vóór het schrijven',
    Object.keys(od.bestanden).some((n) => /^thuis_backup_\d{8}\.txt$/.test(n) && od.bestanden[n].tekst === BEGIN));
  const wolk = w.document.getElementById('wolkTekst').textContent;
  controle('openen: het wolkje toont een tijd', /^\d{2}:\d{2}$/.test(wolk), wolk);

  /* 2. Toevoegen: lokaal meteen zichtbaar, na een pauze in OneDrive. */
  await typ(w, '  pesto ');
  await plus(w);
  controle('toevoegen: meteen op de lijst', namenInLijst(w).includes('pesto'), JSON.stringify(namenInLijst(w)));
  await slaap(2500);
  controle('toevoegen: na de pauze in OneDrive, als eenmalig, door Testspeler',
    /artikel;pesto;soort=eenmalig;op=[\d-]+T[\d:]+;opdoor=Testspeler/.test(od.bestanden['thuis.txt'].tekst), od.bestanden['thuis.txt'].tekst);

  /* 3. Een bestaand artikel toevoegen zet het op de lijst, zonder dubbele. */
  await typ(w, 'KOFFIE');
  await plus(w);
  await slaap(2500);
  const t3 = od.bestanden['thuis.txt'].tekst;
  controle('toevoegen bestaand: Koffie op de lijst, geen tweede regel',
    /artikel;Koffie;soort=regelmatig;op=/.test(t3) && (t3.match(/^artikel;koffie/gim) || []).length === 1, t3);

  /* 4. Zoeken: typen toont Gevonden, zonder filterknoppen. */
  await typ(w, 'mel');
  controle('zoeken: Gevonden toont Melk', w.document.getElementById('lijstTitel').textContent === 'Gevonden' && namenInLijst(w).join() === 'Melk', namenInLijst(w).join());
  controle('zoeken: filterknoppen verborgen', w.document.getElementById('filters').hidden === true);
  await typ(w, '');

  /* 5. Tegelijk gewijzigd: de ander voegt Hagelslag toe vlak voor ons schrijven (412). */
  od.botsBijVolgendePut = (tekst) => tekst + 'artikel;Hagelslag;soort=eenmalig;op=2026-11-21T09:00;opdoor=Medespeler\n';
  const melkRondje = [...w.document.querySelectorAll('#lijst .item')].find((r) => r.dataset.naam === 'Melk').querySelector('.rondje');
  melkRondje.click();
  await slaap(3000);
  const t5 = od.bestanden['thuis.txt'].tekst;
  controle('botsing 412: opnieuw gelezen, beide wijzigingen staan erin',
    /artikel;Hagelslag;/.test(t5) && /artikel;Melk;soort=wekelijks\n/.test(t5), t5);
  controle('botsing 412: Hagelslag ook in de lijst', namenInLijst(w).includes('Hagelslag'));
  controle('botsing 412: Melk van de lijst', !namenInLijst(w).includes('Melk'));

  /* 5b. Van de lijst halen: even grijs op zijn plek, dan onder "Van de lijst gehaald". */
  const rondjeVan = (naam) => [...w.document.querySelectorAll('.item')].find((r) => r.dataset.naam === naam).querySelector('.rondje');
  rondjeVan('pesto').click();
  const direct = [...w.document.querySelectorAll('#lijst .item')].find((r) => r.dataset.naam === 'pesto');
  controle('van de lijst: blijft eerst grijs op zijn plek', !!direct && direct.classList.contains('vertrekt'));
  await slaap(1800);
  const inLijst = namenInLijst(w).includes('pesto');
  const weg = w.document.getElementById('weggehaald');
  controle('van de lijst: na 1,5 s onder "Van de lijst gehaald"', !inLijst && !!weg && weg.textContent.includes('pesto'), 'inLijst=' + inLijst + ' weg=' + (weg && weg.textContent));
  rondjeVan('pesto').click();
  const wegNa = w.document.getElementById('weggehaald');
  controle('van de lijst: één tik zet hem terug', namenInLijst(w).includes('pesto') && !(wegNa && wegNa.textContent.includes('pesto')), JSON.stringify(namenInLijst(w)));
  await slaap(2500);

  /* 5c. Het tabblad Winkel. */
  const d = w.document;
  d.getElementById('tab-winkel').click();
  await slaap(300);
  controle('winkel: tabblad open, tabbalk blijft', !d.getElementById('scherm-winkel').hidden && w.getComputedStyle(d.querySelector('nav')).display !== 'none');
  controle('winkel: zonder winkels de vraag om er een te kiezen', d.getElementById('winkelNaam').textContent === 'Winkel kiezen');
  const rijVan = (naam) => [...d.querySelectorAll('#winkelLijst .wrij')].find((r) => r.querySelector('.nm').textContent === naam);
  rijVan('Bananen').querySelector('.waar').click();
  let k = d.getElementById('keuze');
  controle('winkel: "Waar ligt dit?" zonder winkel vraagt eerst de winkel', !!k && k.getAttribute('aria-label') === 'Winkel kiezen');
  controle('keuzelijst: kopje "Zoeken of toevoegen" en placeholder Winkel',
    k.querySelector('.zoek label').textContent === 'Zoeken of toevoegen' && k.querySelector('#keuzeZoek').placeholder === 'Winkel');
  k.querySelector('#keuzeZoek').value = 'Albert Heijn';
  k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkel: nieuwe winkel gekozen', d.getElementById('winkelNaam').textContent === 'Albert Heijn');
  rijVan('Bananen').querySelector('.waar').click();
  k = d.getElementById('keuze');
  controle('keuzelijst afdeling: placeholder Afdeling', k.querySelector('#keuzeZoek').placeholder === 'Afdeling');
  k.querySelector('#keuzeZoek').value = 'Groente & fruit';
  k.querySelector('.plusknop').click();
  await slaap(100);
  const kopjes = [...d.querySelectorAll('#winkelLijst .afdkop span')].map((h) => h.textContent);
  controle('winkel: Bananen staat nu onder Groente & fruit', kopjes.includes('Groente & fruit'), JSON.stringify(kopjes));
  await slaap(2500);
  const t5c = od.bestanden['thuis.txt'].tekst;
  controle('winkel: afdeling, winkel met route en artikel in OneDrive',
    /^afdeling;Groente & fruit$/m.test(t5c) && /^winkel;Albert Heijn;route=Groente & fruit$/m.test(t5c) && /^artikel;Bananen;soort=wekelijks;afd=Groente & fruit;/m.test(t5c), t5c);

  /* favorieten per telefoon */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  k.querySelector('#keuzeZoek').value = 'Lidl'; k.querySelector('.plusknop').click();
  await slaap(100);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((o) => o.textContent.includes('Lidl')).querySelector('.ster').click();
  await slaap(100);
  const groepen = [...k.querySelectorAll('.groep')].map((g) => g.textContent);
  const eerste = k.querySelector('.optie > button').textContent;
  controle('favorieten: Lidl als favoriet bovenaan', groepen[0] === 'Favorieten' && eerste === 'Lidl', JSON.stringify({ groepen, eerste }));
  k.querySelector('#keuzeZoek').value = 'alb'; k.querySelector('#keuzeZoek').dispatchEvent(new w.Event('input'));
  controle('keuzelijst: typen filtert', [...k.querySelectorAll('.optie')].map((o) => o.textContent).join() === 'Albert Heijn');
  [...k.querySelectorAll('.optie > button')].find((b) => b.textContent === 'Albert Heijn').click();
  await slaap(2500);
  controle('favorieten staan niet in thuis.txt', !/favoriet/i.test(od.bestanden['thuis.txt'].tekst));

  rijVan('Bananen').querySelector('.vink').click();
  controle('winkel: afgevinkt blijft eerst op zijn plek', rijVan('Bananen').classList.contains('gedaan'));
  await slaap(1800);
  const mandje = [...d.querySelectorAll('#winkelLijst .afdkop span')].map((h) => h.textContent).find((x) => x.startsWith('In het mandje'));
  controle('winkel: na 1,5 s in het mandje', mandje === 'In het mandje · 1', mandje);
  controle('winkel: teller "1 van n"', /^1 van \d+$/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
  await slaap(2500);
  const vandaag = new Date(); const dstr = vandaag.getFullYear() + '-' + String(vandaag.getMonth() + 1).padStart(2, '0') + '-' + String(vandaag.getDate()).padStart(2, '0');
  const t5d = od.bestanden['thuis.txt'].tekst;
  controle('winkel: in OneDrive van de lijst, met de aankoopdatum', new RegExp('^artikel;Bananen;soort=wekelijks;afd=Groente & fruit;gekocht=2000-01-01\\|' + dstr + '$', 'm').test(t5d), t5d);
  [...d.querySelectorAll('#winkelLijst .wrij.gedaan .vink')].find((b) => b.textContent.includes('Bananen')).click();
  await slaap(2500);
  const t5e = od.bestanden['thuis.txt'].tekst;
  controle('winkel: terugtikken zet hem terug op de lijst, zonder de aankoopdatum',
    /^artikel;Bananen;soort=wekelijks;afd=Groente & fruit;op=[^;]+;(opdoor=[^;]*;)?gekocht=2000-01-01$/m.test(t5e), t5e);
  rijVan('Bananen').querySelector('.vink').click();
  await slaap(1800);
  const leeg = d.querySelector('#winkelLijst .icoonknop.amber');
  controle('mandje: leegmaakknop (mandje met kruis) bij het mandje', !!leeg && leeg.getAttribute('aria-label') === 'Mandje leegmaken');
  leeg.click();
  controle('mandje: leeggemaakt', ![...d.querySelectorAll('#winkelLijst .afdkop span')].some((h) => h.textContent.startsWith('In het mandje')));

  /* vegen: van Winkel naar links → Doen, en rondom van Lijst naar rechts → Instellingen */
  const veeg = (x1, x2) => {
    const m = d.getElementById('midden');
    const ev = (type, x) => { const e = new w.Event(type); e.touches = type === 'touchstart' ? [{ clientX: x, clientY: 300 }] : []; e.changedTouches = [{ clientX: x, clientY: 300 }]; return e; };
    m.dispatchEvent(ev('touchstart', x1)); m.dispatchEvent(ev('touchend', x2));
  };
  Object.defineProperty(w, 'innerWidth', { value: 400, configurable: true });
  veeg(300, 150);
  controle('vegen: van Winkel naar Doen', !d.getElementById('scherm-doen').hidden);
  d.getElementById('tab-boodschappen').click();
  veeg(150, 300);
  controle('vegen: rondom van Lijst naar Instellingen', !d.getElementById('scherm-instellingen').hidden);
  d.getElementById('tab-boodschappen').click();
  veeg(10, 300);
  controle('vegen: niet vanaf de rand (terug-gebaar)', !d.getElementById('scherm-boodschappen').hidden);

  /* 6. Een bestand dat geen UTF-8 is: melding, niets geschreven. */
  od = onedrive(null);
  od.bestanden['thuis.txt'] = { bytes: new Uint8Array([0x61, 0x72, 0x74, 0xFF, 0x0A]), eTag: '"x1"', id: 'id-thuis.txt' };
  w = await start(od);
  await slaap(800);
  controle('geen UTF-8: melding en geen schrijfactie', !!w.document.getElementById('m-utf8') && od.puts === 0,
    'puts=' + od.puts + ' melding=' + !!w.document.getElementById('m-utf8'));

  /* 7. Nog geen thuis.txt: de app maakt hem aan met de standaardinstelling. */
  od = onedrive(null);
  w = await start(od);
  await slaap(800);
  controle('nieuwe map: thuis.txt aangemaakt', !!od.bestanden['thuis.txt'] && /instelling;wekelijks;dag=za;tijd=06:00/.test(od.bestanden['thuis.txt'].tekst),
    JSON.stringify(Object.keys(od.bestanden)));

  console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
  process.exit(fout ? 1 : 0);
})().catch((e) => { console.log('FOUT  test kon niet draaien — ' + e.message); process.exit(1); });
