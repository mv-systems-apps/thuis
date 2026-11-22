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
  if (begintekst !== null) zet('thuis.json', J(begintekst));
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

const { regelsNaarJson: J, jsonNaarRegels: R } = require('./test-hulp.cjs');
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
  controle('openen: teruggezet weggeschreven naar OneDrive', /artikel;Bananen;soort=wekelijks;op=/.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));
  controle('openen: dagbackup gemaakt met de versie van vóór het schrijven',
    Object.keys(od.bestanden).some((n) => /^thuis_backup_\d{8}\.json$/.test(n) && R(od.bestanden[n].tekst) === BEGIN));
  const wolk = w.document.getElementById('wolkTekst').textContent;
  controle('openen: het wolkje toont een tijd', /^\d{2}:\d{2}$/.test(wolk), wolk);

  /* 2. Toevoegen: lokaal meteen zichtbaar, na een pauze in OneDrive. */
  await typ(w, '  pesto ');
  await plus(w);
  controle('toevoegen: meteen op de lijst', namenInLijst(w).includes('pesto'), JSON.stringify(namenInLijst(w)));
  await slaap(2500);
  controle('toevoegen: na de pauze in OneDrive, als eenmalig, door Testspeler',
    /artikel;pesto;soort=eenmalig;op=[\d-]+T[\d:]+;opdoor=Testspeler/.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));

  /* 3. Een bestaand artikel toevoegen zet het op de lijst, zonder dubbele. */
  await typ(w, 'KOFFIE');
  await plus(w);
  await slaap(2500);
  const t3 = R(od.bestanden['thuis.json'].tekst);
  controle('toevoegen bestaand: Koffie op de lijst, geen tweede regel',
    /artikel;Koffie;soort=regelmatig;op=/.test(t3) && (t3.match(/^artikel;koffie/gim) || []).length === 1, t3);

  /* 4. Zoeken: typen toont Gevonden, zonder filterknoppen. */
  await typ(w, 'mel');
  controle('zoeken: Gevonden toont Melk', w.document.getElementById('lijstTitel').textContent === 'Gevonden' && namenInLijst(w).join() === 'Melk', namenInLijst(w).join());
  controle('zoeken: filterknoppen verborgen', w.document.getElementById('filters').hidden === true);
  await typ(w, '');

  /* 5. Tegelijk gewijzigd: de ander voegt Hagelslag toe vlak voor ons schrijven (412). */
  od.botsBijVolgendePut = (tekst) => J(R(tekst) + 'artikel;Hagelslag;soort=eenmalig;op=2026-11-21T09:00;opdoor=Medespeler\n');
  const melkRondje = [...w.document.querySelectorAll('#lijst .item')].find((r) => r.dataset.naam === 'Melk').querySelector('.rondje');
  melkRondje.click();
  await slaap(3000);
  const t5 = R(od.bestanden['thuis.json'].tekst);
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
  controle('winkel: "Waar ligt dit?" zonder winkel vraagt eerst de winkel', !!k && k.getAttribute('aria-label') === 'Waar ga je heen?');
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
  const t5c = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: afdeling alleen in de route van de winkel, artikel met ligt=winkel:afdeling',
    !/^afdeling;/m.test(t5c) && /^winkel;Albert Heijn;route=Groente & fruit$/m.test(t5c) && /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;/m.test(t5c), t5c);

  /* winkel kiezen: alleen waar iets is vastgelegd, met aantal; de rest onder "Alle winkels" */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  k.querySelector('#keuzeZoek').value = 'Lidl: centrum'; k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkel: : in een winkelnaam wordt een spatie', d.getElementById('winkelNaam').textContent === 'Lidl centrum', d.getElementById('winkelNaam').textContent);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  const zicht = [...k.querySelectorAll('.opties > *')].map((o) => o.textContent.replace(/\s+/g, ' ').trim());
  controle('winkelkeuze: AH met 1 (en wat), "Alle winkels · 2" ingeklapt, kruisje, zoekvak onderaan',
    JSON.stringify(zicht) === '["Albert HeijnBananen1","Alle winkels · 2"]' && !!k.querySelector('.kop .kruis') && k.querySelector('.paneel').lastElementChild.classList.contains('zoek'), JSON.stringify(zicht));
  k.querySelector('.uitklapper').click();
  controle('winkelkeuze: uitklappen toont alle winkels', k.querySelectorAll('.optie').length === 3);
  k.querySelector('#keuzeZoek').value = 'alb'; k.querySelector('#keuzeZoek').dispatchEvent(new w.Event('input'));
  controle('keuzelijst: typen filtert (één keer, ook al staat hij in twee secties)', [...k.querySelectorAll('.optie .nm')].map((o) => o.firstChild.textContent).join() === 'Albert Heijn');
  k.querySelector('.kruis').click();
  controle('keuzelijst: kruisje sluit', !d.getElementById('keuze'));

  /* in de Lidl: Bananen ligt alleen bij de AH, dus niet hier; wat nog geen winkels heeft staat bovenaan */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze'); k.querySelector('.uitklapper').click();
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Lidl')).click();
  await slaap(100);
  const eldersKop = d.querySelector('#winkelLijst .uitklap span');
  controle('winkel: in de Lidl staat Bananen onder "Niet bij Lidl centrum"', !!eldersKop && eldersKop.textContent === 'Niet bij Lidl centrum · 1', eldersKop && eldersKop.textContent);
  const losRij = d.querySelector('#winkelLijst .wrij .waar') && d.querySelector('#winkelLijst .wrij .waar').closest('.wrij');
  const losNaam = losRij ? losRij.querySelector('.nm').textContent : '';
  if (losRij) {
    losRij.querySelector('.waar').click();
    k = d.getElementById('keuze');
    controle('waar ligt dit: titel noemt de winkel, geen regel "Niet te koop"', k.getAttribute('aria-label') === 'Waar ligt ' + losNaam + ' bij Lidl centrum?' && !/Niet te koop/.test(k.textContent), k.getAttribute('aria-label'));
    k.querySelector('#keuzeZoek').value = 'Zuivel'; k.querySelector('.plusknop').click();
    await slaap(2500);
    const tl = R(od.bestanden['thuis.json'].tekst);
    controle('waar ligt dit: ' + losNaam + ' ligt nu bij Lidl centrum in Zuivel, de afdeling staat in de route',
      new RegExp('^artikel;' + losNaam + ';.*ligt=Lidl centrum:Zuivel', 'm').test(tl) && /^winkel;Lidl centrum;route=Zuivel$/m.test(tl) && !/niet=/.test(tl), tl);
  } else controle('waar ligt dit: er staat iets zonder plek op de lijst', false);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Albert Heijn')).click();
  await slaap(100);

  rijVan('Bananen').querySelector('.vink').click();
  controle('winkel: afgevinkt blijft eerst op zijn plek', rijVan('Bananen').classList.contains('gedaan'));
  await slaap(1800);
  const mandje = [...d.querySelectorAll('#winkelLijst .afdkop span')].map((h) => h.textContent).find((x) => x.startsWith('In het mandje'));
  controle('winkel: na 1,5 s in het mandje', mandje === 'In het mandje · 1', mandje);
  controle('winkel: teller "1 van n"', /^1 van \d+$/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
  await slaap(2500);
  const vandaag = new Date(); const dstr = vandaag.getFullYear() + '-' + String(vandaag.getMonth() + 1).padStart(2, '0') + '-' + String(vandaag.getDate()).padStart(2, '0');
  const t5d = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: in OneDrive van de lijst, met de aankoopdatum', new RegExp('^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;gekocht=2000-01-01\\|' + dstr + '$', 'm').test(t5d), t5d);
  [...d.querySelectorAll('#winkelLijst .wrij.gedaan .vink')].find((b) => b.textContent.includes('Bananen')).click();
  await slaap(2500);
  const t5e = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: terugtikken zet hem terug op de lijst, zonder de aankoopdatum',
    /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;op=[^;]+;(opdoor=[^;]*;)?gekocht=2000-01-01$/m.test(t5e), t5e);
  rijVan('Bananen').querySelector('.vink').click();
  await slaap(1800);
  const leeg = d.querySelector('#winkelLijst .icoonknop.amber');
  controle('mandje: leegmaakknop (mandje met kruis) bij het mandje', !!leeg && leeg.getAttribute('aria-label') === 'Mandje leegmaken');
  leeg.click();
  controle('mandje: leeggemaakt', ![...d.querySelectorAll('#winkelLijst .afdkop span')].some((h) => h.textContent.startsWith('In het mandje')));

  /* vegen: van Boodschappen naar links → Doen, van Artikelen naar rechts → Winkels, rondom van Winkels naar Instellingen */
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
  controle('vegen: van Artikelen naar Winkels', !d.getElementById('scherm-winkels').hidden);
  veeg(150, 300);
  controle('vegen: rondom van Winkels naar Instellingen', !d.getElementById('scherm-instellingen').hidden);
  d.getElementById('tab-boodschappen').click();
  veeg(10, 300);
  controle('vegen: niet vanaf de rand (terug-gebaar)', !d.getElementById('scherm-boodschappen').hidden);

  /* 5d. Het tabblad Winkels. */
  d.getElementById('tab-winkels').click();
  await slaap(100);
  controle('winkels: invoer onderaan heet Winkel, die van Artikelen is weg',
    !d.getElementById('balk-winkels').hidden && d.getElementById('balk-boodschappen').hidden && d.getElementById('winkelsTekst').placeholder === 'Winkel');
  const winkelRijen = () => [...d.querySelectorAll('#winkelsOverzicht .winkelrij .nm')].map((x) => x.firstChild.textContent);
  controle('winkels: alfabetisch onder Overige', winkelRijen().join() === 'Albert Heijn,Lidl centrum' && d.querySelector('#winkelsOverzicht .kop span').textContent === 'Overige', winkelRijen().join());
  [...d.querySelectorAll('#winkelsOverzicht .winkelrij')][0].click();
  await slaap(50);
  controle('winkel: detail open met afdelingen', !d.getElementById('winkelDetail').hidden && d.querySelector('#winkelDetail h2').textContent === 'Albert Heijn' && d.getElementById('winkelsTekst').placeholder === 'Afdeling');
  for (const afd of ['Brood', 'Zuivel']) { d.getElementById('winkelsTekst').value = afd; d.getElementById('winkelsPlus').click(); await slaap(20); }
  const afdNamen = () => [...d.querySelectorAll('#afdelingen .arij .nm')].map((x) => x.textContent).join();
  controle('afdelingen toevoegen, achteraan', afdNamen() === 'Groente & fruit,Brood,Zuivel', afdNamen());
  /* verslepen: Zuivel twee plekken omhoog */
  const greep = [...d.querySelectorAll('#afdelingen .arij')][2].querySelector('.greep');
  const pe = (type, y) => { const e = new w.MouseEvent(type, { bubbles: true, clientY: y }); return e; };
  greep.dispatchEvent(pe('pointerdown', 300)); greep.dispatchEvent(pe('pointermove', 300 - 112)); greep.dispatchEvent(pe('pointerup', 300 - 112));
  await slaap(20);
  controle('verslepen: Zuivel bovenaan', afdNamen() === 'Zuivel,Groente & fruit,Brood', afdNamen());
  controle('tik op de naam van een afdeling doet niets', (() => { d.querySelector('#afdelingen .arij .nm').click(); return !d.getElementById('keuze'); })());
  /* hernoemen via het potloodje */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.dataset.afd === 'Groente & fruit').querySelector('.potlood').click();
  let p = d.getElementById('keuze');
  controle('potloodje opent "Afdeling bewerken" met de naam, prullenbak links van Opslaan',
    !!p && p.getAttribute('aria-label') === 'Afdeling bewerken' && p.querySelector('#bewerkNaam').value === 'Groente & fruit' && p.querySelector('.bewerkknoppen').firstElementChild.classList.contains('prul'));
  p.querySelector('#bewerkNaam').value = 'AGF'; p.querySelector('.knop').click();
  await slaap(2500);
  const t5f = R(od.bestanden['thuis.json'].tekst);
  controle('afdeling hernoemd in route en bij Bananen', /^winkel;Albert Heijn;route=Zuivel\|AGF\|Brood$/m.test(t5f) && /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:AGF;/m.test(t5f), t5f);
  /* verwijderen met ongedaan maken */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.dataset.afd === 'Brood').querySelector('.potlood').click();
  d.getElementById('keuze').querySelector('.prul').click();
  controle('afdeling verwijderd: meteen weg, met Ongedaan maken', afdNamen() === 'Zuivel,AGF' && [...d.querySelectorAll('.melding button')].some((b) => b.textContent === 'Ongedaan maken'));
  [...d.querySelectorAll('.melding button')].find((b) => b.textContent === 'Ongedaan maken').click();
  controle('ongedaan maken: Brood terug', afdNamen() === 'Zuivel,AGF,Brood', afdNamen());
  /* favoriet en hernoemen van de winkel */
  d.querySelector('#winkelDetail .ster').click();
  await slaap(50);
  d.querySelector('#winkelDetail .bewerk').click();
  p = d.getElementById('keuze');
  controle('potlood van de winkel: "Winkel bewerken"', p.getAttribute('aria-label') === 'Winkel bewerken' && p.querySelector('#bewerkNaam').value === 'Albert Heijn');
  p.querySelector('#bewerkNaam').value = 'AH'; p.querySelector('.knop').click();
  await slaap(2500);
  const t5g = R(od.bestanden['thuis.json'].tekst);
  controle('winkel hernoemd, artikelen gaan mee', /^winkel;AH;route=Zuivel\|AGF\|Brood$/m.test(t5g) && /^artikel;Bananen;soort=wekelijks;ligt=AH:AGF;/m.test(t5g), t5g);
  d.querySelector('#winkelDetail .terug').click();
  await slaap(50);
  controle('terug: overzicht met AH onder Favorieten', d.getElementById('winkelDetail').hidden &&
    d.querySelector('#winkelsOverzicht .kop span').textContent === 'Favorieten' && winkelRijen()[0] === 'AH', winkelRijen().join());
  controle('favorieten staan niet in thuis.json', !/favoriet/i.test(R(od.bestanden['thuis.json'].tekst)));
  d.getElementById('tab-boodschappen').click();

  /* 6. Een bestand dat geen UTF-8 is: melding, niets geschreven. */
  od = onedrive(null);
  od.bestanden['thuis.json'] = { bytes: new Uint8Array([0x7B, 0x7D, 0xFF, 0x0A]), eTag: '"x1"', id: 'id-thuis.json' };
  w = await start(od);
  await slaap(800);
  controle('geen UTF-8: melding en geen schrijfactie', !!w.document.getElementById('m-utf8') && od.puts === 0,
    'puts=' + od.puts + ' melding=' + !!w.document.getElementById('m-utf8'));

  /* 6b. Kapotte JSON en een nieuwer formaat: melding, niets geschreven. */
  for (const [naam, tekst, woord] of [['kapot', '{"versie": "1352902-3FF", "artikelen": {', 'beschadigd'], ['nieuwer', '{"versie": "1352903-000"}', 'nieuwere versie']]) {
    od = onedrive(null);
    od.bestanden['thuis.json'] = { tekst, eTag: '"x1"', id: 'id-thuis.json' };
    w = await start(od);
    await slaap(800);
    const m = w.document.getElementById('m-utf8');
    controle(naam + ': melding en geen schrijfactie', !!m && m.textContent.includes(woord) && od.puts === 0, 'puts=' + od.puts + ' ' + (m && m.textContent));
  }

  /* 7. Nog geen thuis.json: de app maakt hem aan met de standaardinstelling. */
  od = onedrive(null);
  w = await start(od);
  await slaap(800);
  controle('nieuwe map: thuis.json aangemaakt', !!od.bestanden['thuis.json'] && /instelling;wekelijks;dag=za;tijd=06:00/.test(R(od.bestanden['thuis.json'].tekst)),
    JSON.stringify(Object.keys(od.bestanden)));

  console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
  process.exit(fout ? 1 : 0);
})().catch((e) => { console.log('FOUT  test kon niet draaien — ' + e.message); process.exit(1); });
