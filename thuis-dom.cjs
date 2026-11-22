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
    if (/^\/drives\/D\/items\/MAP\/children/.test(g)) return antwoord(200, { value: Object.keys(od.bestanden).map((n) => ({ id: od.bestanden[n].id, name: n })) });
    m = /^\/drives\/D\/items\/([^/?]+)(\/content)?/.exec(g);
    if (m) {
      const naam = naamVanId(m[1]);
      if (!naam) return antwoord(404, {});
      if (methode === 'DELETE') { delete od.bestanden[naam]; od.gewist = (od.gewist || []).concat(naam); return antwoord(204, {}); }
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
const naamVanRij = (r) => r.querySelector('.naam > span').textContent;
const namenInLijst = (w) => [...w.document.querySelectorAll('#lijst .item')].map(naamVanRij);
async function typ(w, tekst) {
  const i = w.document.getElementById('invoerTekst');
  i.value = tekst;
  i.dispatchEvent(new w.Event('input'));
}
async function plus(w) { w.document.getElementById('invoerPlus').click(); }

const { regelsNaarJson: J, jsonNaarRegels: R, FORMAAT } = require('./test-hulp.cjs');
const BEGIN = [
  'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2000-01-01T06:00',
  'artikel;Bananen;soort=wekelijks;gekocht=2000-01-01',
  'artikel;Koffie;soort=regelmatig',
  'artikel;Melk;soort=wekelijks;op=2026-11-14T06:00'
].join('\n') + '\n';

(async () => {
  /* 1. Openen: lezen, wekelijks terug, wegschrijven met dagbackup. */
  let od = onedrive(BEGIN);
  /* oude backups: één van vorig jaar (weg) en één van gisteren (blijft) */
  const gisteren = new Date(Date.now() - 86400000);
  const naamGisteren = 'thuis_backup_' + gisteren.getFullYear() + String(gisteren.getMonth() + 1).padStart(2, '0') + String(gisteren.getDate()).padStart(2, '0') + '.json';
  od.zet('thuis_backup_20200105.json', '{}'); od.zet(naamGisteren, '{}'); od.zet('notities.txt', 'x');
  let w = await start(od);
  await slaap(800);
  const lijst1 = namenInLijst(w);
  controle('openen: de lijst toont wat in OneDrive op de lijst staat', lijst1.includes('Melk'), JSON.stringify(lijst1));
  controle('openen: wekelijks terug (Bananen weer op de lijst)', lijst1.includes('Bananen'), JSON.stringify(lijst1));
  controle('openen: Koffie (niet op de lijst) staat er niet bij', !lijst1.includes('Koffie'));
  controle('openen: teruggezet weggeschreven naar OneDrive', /artikel;Bananen;soort=wekelijks;op=/.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));
  controle('openen: dagbackup gemaakt met de versie van vóór het schrijven',
    Object.keys(od.bestanden).some((n) => /^thuis_backup_\d{8}\.json$/.test(n) && R(od.bestanden[n].tekst) === BEGIN));
  controle('backups: oude opgeruimd, recente en andere bestanden blijven',
    JSON.stringify(od.gewist) === '["thuis_backup_20200105.json"]' && !!od.bestanden[naamGisteren] && !!od.bestanden['notities.txt'], JSON.stringify(od.gewist));
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
  controle('kopregel: rechts het aantal artikelen', w.document.getElementById('lijstAantal').textContent === '1 artikel', w.document.getElementById('lijstAantal').textContent);
  controle('zoeken: filterknoppen verborgen', w.document.getElementById('filters').hidden === true);
  await typ(w, '');

  /* 5. Tegelijk gewijzigd: de ander voegt Hagelslag toe vlak voor ons schrijven (412). */
  od.botsBijVolgendePut = (tekst) => { const d = JSON.parse(tekst); d.artikelen.hag01 = { naam: 'Hagelslag', soort: 'eenmalig', op: '2026-11-21T09:00', opdoor: 'Medespeler' }; return JSON.stringify(d); };
  const melkRondje = [...w.document.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Melk').querySelector('.rondje');
  melkRondje.click();
  await slaap(3000);
  const t5 = R(od.bestanden['thuis.json'].tekst);
  controle('botsing 412: opnieuw gelezen, beide wijzigingen staan erin',
    /artikel;Hagelslag;/.test(t5) && /artikel;Melk;soort=wekelijks\n/.test(t5), t5);
  controle('botsing 412: Hagelslag ook in de lijst', namenInLijst(w).includes('Hagelslag'));
  controle('botsing 412: Melk van de lijst', !namenInLijst(w).includes('Melk'));

  /* 5b. Van de lijst halen: even grijs op zijn plek, dan onder "Van de lijst gehaald". */
  const rondjeVan = (naam) => [...w.document.querySelectorAll('.item')].find((r) => naamVanRij(r) === naam).querySelector('.rondje');
  rondjeVan('pesto').click();
  const direct = [...w.document.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'pesto');
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
  controle('winkel: voortgang bovenaan los van de winkel, Bananen onder "Zonder winkel" met winkelicoon',
    d.querySelector('#scherm-winkel > .voortgang h2').textContent === 'Boodschappen' && / artikelen?$/.test(d.getElementById('winkelTeller').textContent) &&
    rijVan('Bananen').closest('.afd').querySelector('.afdkop span').textContent === 'Zonder winkel' && !!rijVan('Bananen').querySelector('.naarwinkel') && !rijVan('Bananen').closest('.winkelkaart'));
  rijVan('Bananen').querySelector('.naarwinkel').click();
  let k = d.getElementById('keuze');
  controle('winkel: winkelicoon zonder gekozen winkel vraagt eerst de winkel', !!k && k.getAttribute('aria-label') === 'Waar ga je heen?');
  controle('keuzelijst: kopje "Zoeken of toevoegen" en placeholder Winkel',
    k.querySelector('.zoek label').textContent === 'Zoeken of toevoegen' && k.querySelector('#keuzeZoek').placeholder === 'Winkel');
  k.querySelector('#keuzeZoek').value = 'Albert Heijn';
  k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkel: nieuwe winkel gekozen, de winkelkop staat in de winkelkaart', d.getElementById('winkelNaam').textContent === 'Albert Heijn' && !!d.getElementById('winkelKies').closest('.winkelkaart'));
  rijVan('Bananen').querySelector('.naarwinkel').click();
  await slaap(50);
  controle('winkel zonder afdelingen: winkelicoon zet het in de winkel, zonder naar een afdeling te vragen, en zonder kop of speld',
    !d.getElementById('keuze') && !!rijVan('Bananen').closest('.winkelkaart') && !rijVan('Bananen').closest('.afd').querySelector('.afdkop') && !rijVan('Bananen').querySelector('.waar'));
  /* De eerste afdeling komt uit de Winkels-tab; daarna wel "Afdeling onbekend" met de speld. */
  w.eval("handelen([{ actie: 'afdErbij', soort: 'winkel', id: winkels.find((x) => x.naam === 'Albert Heijn').id, afd: { id: nieuweId(), naam: 'Groente & fruit' } }])");
  await slaap(50);
  controle('winkel met afdelingen: "Afdeling onbekend" in de winkelkaart, als afdeling, met speld',
    rijVan('Bananen').closest('.afd').querySelector('.afdkop span').textContent === 'Afdeling onbekend' && !rijVan('Bananen').closest('.afd').classList.contains('grijs') && !!rijVan('Bananen').querySelector('.waar'));
  rijVan('Bananen').querySelector('.waar').click();
  k = d.getElementById('keuze');
  controle('keuzelijst afdeling: placeholder Afdeling', k.querySelector('#keuzeZoek').placeholder === 'Afdeling');
  [...k.querySelectorAll('.optie')].find((o) => o.textContent === 'Groente & fruit').click();
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
  k.querySelector('#keuzeZoek').value = 'Lidl centrum'; k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkel: nieuwe winkel gekozen', d.getElementById('winkelNaam').textContent === 'Lidl centrum', d.getElementById('winkelNaam').textContent);
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
  const eldersKop = d.querySelector('#winkelLijst .uitklap');
  controle('winkel: in de Lidl staat Bananen onder "Niet bij Lidl centrum", rechts "1 artikel"', !!eldersKop && eldersKop.querySelector('span').textContent === 'Niet bij Lidl centrum' && eldersKop.querySelector('.tal').textContent === '1 artikel', eldersKop && eldersKop.textContent);
  if (eldersKop) { eldersKop.click(); await slaap(20); }
  const bananenElders = [...d.querySelectorAll('#winkelLijst .afd.grijs .wrij')].find((r) => r.querySelector('.nm').firstChild.textContent === 'Bananen');
  controle('winkel: onder de naam in grijs waar het wel te koop is', !!bananenElders && bananenElders.querySelector('.nm .winkels').textContent === 'Albert Heijn', bananenElders && bananenElders.textContent);
  if (eldersKop) { d.querySelector('#winkelLijst .uitklap').click(); await slaap(20); }
  const losRij = d.querySelector('#winkelLijst .wrij .naarwinkel') && d.querySelector('#winkelLijst .wrij .naarwinkel').closest('.wrij');
  const losNaam = losRij ? losRij.querySelector('.nm').textContent : '';
  if (losRij) {
    losRij.querySelector('.naarwinkel').click();
    await slaap(2500);
    const tl = R(od.bestanden['thuis.json'].tekst);
    controle('bij deze winkel: ' + losNaam + ' te koop bij Lidl centrum (geen afdelingen, dus geen vraag)',
      !d.getElementById('keuze') && new RegExp('^artikel;' + losNaam + ';.*ligt=Lidl centrum(;|$)', 'm').test(tl) && /^winkel;Lidl centrum$/m.test(tl), tl);
  } else controle('bij deze winkel: er staat iets zonder winkel op de lijst', false);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Albert Heijn')).click();
  await slaap(100);

  rijVan('Bananen').querySelector('.vink').click();
  controle('winkel: afgevinkt blijft eerst op zijn plek', rijVan('Bananen').classList.contains('gedaan'));
  await slaap(1800);
  const mandjeKop = [...d.querySelectorAll('#winkelLijst .afdkop')].find((h) => h.firstChild.textContent === 'In het mandje');
  const mandje = mandjeKop ? mandjeKop.firstChild.textContent + ' | ' + mandjeKop.querySelector('.tal').textContent : '';
  controle('winkel: na 1,5 s in het mandje', mandje === 'In het mandje | 1 artikel', mandje);
  controle('winkel: teller "1 van n artikelen"', /^1 van \d+ artikelen$/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
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
  /* mandje per winkel: in een andere winkel begint de teller op 0 en is het mandje leeg */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  k.querySelector('.uitklapper').click();
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Lidl')).click();
  await slaap(50);
  controle('mandje per winkel: in de Lidl geen mandje van de AH; de voortgang (hele lijst) blijft 1',
    ![...d.querySelectorAll('#winkelLijst .afdkop span')].some((h) => h.textContent.startsWith('In het mandje')) && /^1 van/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze'); k.querySelector('.uitklapper').click();
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Albert Heijn')).click();
  await slaap(50);
  controle('mandje per winkel: terug in de AH staat het er nog', [...d.querySelectorAll('#winkelLijst .afdkop')].some((h) => h.firstChild.textContent === 'In het mandje' && h.querySelector('.tal').textContent === '1 artikel'));
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
  controle('tik op de naam van een afdeling opent het bewerkpaneel', (() => {
    d.querySelector('#afdelingen .arij .nm').click();
    const k = d.getElementById('keuze'); const ok = !!k && k.getAttribute('aria-label') === 'Afdeling bewerken' && k.querySelector('#bewerkNaam').value === 'Zuivel';
    if (k) k.querySelector('.kruis').click();
    return ok && !d.getElementById('keuze');
  })());
  /* hernoemen: tik op de naam (geen potloodje meer) */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.querySelector('.nm').textContent === 'Groente & fruit').querySelector('.nm').click();
  let p = d.getElementById('keuze');
  controle('tik op de naam opent "Afdeling bewerken" met de naam, prullenbak links van Opslaan; geen potloodje in de regel',
    !!p && p.getAttribute('aria-label') === 'Afdeling bewerken' && p.querySelector('#bewerkNaam').value === 'Groente & fruit' && p.querySelector('.bewerkknoppen').firstElementChild.classList.contains('prul') && !d.querySelector('#afdelingen .potlood'));
  p.querySelector('#bewerkNaam').value = 'AGF'; p.querySelector('.knop').click();
  await slaap(2500);
  const t5f = R(od.bestanden['thuis.json'].tekst);
  controle('afdeling hernoemd in route en bij Bananen', /^winkel;Albert Heijn;route=Zuivel\|AGF\|Brood$/m.test(t5f) && /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:AGF;/m.test(t5f), t5f);
  /* verwijderen met ongedaan maken */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.querySelector('.nm').textContent === 'Brood').querySelector('.nm').click();
  d.getElementById('keuze').querySelector('.prul').click();
  controle('afdeling verwijderd: meteen weg, met Ongedaan maken', afdNamen() === 'Zuivel,AGF' && [...d.querySelectorAll('.melding button')].some((b) => b.textContent === 'Ongedaan maken'));
  const mWeg = [...d.querySelectorAll('.melding')].find((m) => m.textContent.includes('Ongedaan maken'));
  controle('melding: naam vet, Ongedaan maken als hoofdknop', mWeg.querySelector('p b').textContent === 'Brood' && !mWeg.querySelector('button').classList.contains('tweede'), mWeg.innerHTML);
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

  /* winkel verwijderen: meteen echt weg (ook in OneDrive), Ongedaan maken zet hem terug met de plekken */
  [...d.querySelectorAll('#winkelsOverzicht .winkelrij')].find((b) => b.textContent.startsWith('AH')).click();
  await slaap(50);
  d.querySelector('#winkelDetail .bewerk').click();
  d.getElementById('keuze').querySelector('.prul').click();
  await slaap(2500);
  const tWeg = R(od.bestanden['thuis.json'].tekst);
  controle('winkel verwijderen: meteen weg in OneDrive, ook bij Bananen', !/^winkel;AH/m.test(tWeg) && /^artikel;Bananen;soort=wekelijks;(op|gekocht)/m.test(tWeg) && !/Bananen;[^\n]*ligt=/.test(tWeg), tWeg);
  const ongedaan = [...d.querySelectorAll('.melding button')].find((b) => b.textContent === 'Ongedaan maken');
  ongedaan.click();
  await slaap(2500);
  const tTerug = R(od.bestanden['thuis.json'].tekst);
  controle('ongedaan maken: AH terug met afdelingen, Bananen weer in AGF', /^winkel;AH;route=Zuivel\|AGF\|Brood$/m.test(tTerug) && /^artikel;Bananen;soort=wekelijks;ligt=AH:AGF;/m.test(tTerug), tTerug);

  /* opslaan op de telefoon mislukt: melding, en weg zodra het weer lukt */
  const echtKvSet = w.kvSet;
  w.kvSet = async () => { throw new Error('vol'); };
  d.getElementById('winkelsTekst').value = 'Kruidvat'; d.getElementById('winkelsPlus').click();
  await slaap(50);
  const mOpslag = d.getElementById('m-opslag');
  controle('opslaan mislukt: melding "Opslaan niet gelukt" met Opnieuw proberen', !!mOpslag && mOpslag.querySelector('p').textContent === 'Opslaan niet gelukt' && mOpslag.querySelector('button').textContent === 'Opnieuw proberen');
  w.kvSet = echtKvSet;
  mOpslag.querySelector('button').click();
  await slaap(100);
  controle('opslaan weer gelukt: melding weg', !d.getElementById('m-opslag'));
  await slaap(2500);

  /* andere map koppelen met wijzigingen in de wachtrij: eerst bevestigen */
  w.eval("wachtrij.push({ actie: 'zet', soort: 'artikel', id: 'nietbestaand', veld: 'op', oud: '', nieuw: 'x' })");
  await w.mapKoppelen(false);
  controle('andere map koppelen met openstaande wijzigingen: eerst een vraag', !!d.getElementById('m-koppelen') && /1 wijziging staat nog niet in OneDrive/.test(d.getElementById('m-koppelen').textContent));
  w.meldingWeg('m-koppelen');
  w.eval('wachtrij.pop()');
  d.getElementById('tab-boodschappen').click();

  /* soort volgt het filter; tijdens typen links annuleren en een + in de kleur van de soort */
  d.getElementById('tab-boodschappen').click();
  const filterKnop = (naam) => [...d.querySelectorAll('#filters .filter')].find((b) => b.getAttribute('aria-label').startsWith(naam));
  filterKnop('Wekelijks').click();
  controle('soort volgt het filter: Wekelijks gekozen → soortknop wekelijks', /wekelijks/.test(d.getElementById('invoerSoort').getAttribute('aria-label')));
  const vak2 = d.getElementById('invoerTekst');
  vak2.focus(); vak2.value = 'Kaas'; vak2.dispatchEvent(new w.Event('input', { bubbles: true }));
  controle('typen: links annuleren, soortknop weg, + in de kleur van wekelijks',
    !d.getElementById('invoerTerug').hidden && d.getElementById('invoerSoort').hidden && /rgb\(29, 63, 175\)|#1D3FAF/i.test(d.getElementById('invoerPlus').style.background), d.getElementById('invoerPlus').style.background);
  d.getElementById('invoerPlus').click();
  await slaap(2500);
  controle('toevoegen in filter Wekelijks: nieuw artikel is wekelijks', /^artikel;Kaas;soort=wekelijks;/m.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));
  vak2.value = 'ka'; vak2.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('invoerTerug').click();
  controle('annuleren: vak leeg, lijst terug, soortknop terug', vak2.value === '' && d.getElementById('lijstTitel').textContent === 'Wekelijks' && !d.getElementById('invoerSoort').hidden);
  filterKnop('Op de lijst').click();
  controle('filter Op de lijst → soortknop eenmalig', /eenmalig/.test(d.getElementById('invoerSoort').getAttribute('aria-label')));

  /* zoekvak leegmaken met het kruisje */
  d.getElementById('tab-boodschappen').click();
  const vak = d.getElementById('invoerTekst');
  const wisKnop = vak.parentNode.querySelector('.wis');
  controle('kruisje: verborgen zolang het vak leeg is', wisKnop.hidden);
  vak.value = 'mel'; vak.dispatchEvent(new w.Event('input', { bubbles: true }));
  controle('kruisje: zichtbaar met tekst, zoeken toont Gevonden', !wisKnop.hidden && d.getElementById('lijstTitel').textContent === 'Gevonden');
  wisKnop.click();
  controle('kruisje: vak leeg, lijst terug, kruisje weer weg', vak.value === '' && d.getElementById('lijstTitel').textContent === 'Op de lijst' && wisKnop.hidden);

  /* 5e. Instellingen: wekelijks, backups en terugzetten. */
  d.getElementById('tab-instellingen').click();
  await slaap(300);
  const dagKnop = (dag) => [...d.querySelectorAll('#wekDagen button')].find((b) => b.textContent === dag);
  controle('instellingen: zaterdag gekozen', dagKnop('za').getAttribute('aria-checked') === 'true');
  dagKnop('vr').click();
  const tijd = d.getElementById('wekTijd'); tijd.value = '18:30'; tijd.dispatchEvent(new w.Event('change'));
  await slaap(2500);
  controle('instellingen: dag en tijd in OneDrive', /^instelling;wekelijks;dag=vr;tijd=18:30;/m.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst).split('\n')[0]);
  const voorTerug = od.bestanden['thuis.json'].tekst;
  d.getElementById('naarBackups').click();
  await slaap(300);
  const brijen = [...d.querySelectorAll('#backupScherm .backuprij')];
  controle('backups: lijst met de backup van vandaag bovenaan', brijen.length >= 1 && /^Vandaag · /.test(brijen[0].textContent), brijen.map((b) => b.textContent).join(' | '));
  brijen[0].click();
  await slaap(300);
  const paneel = d.getElementById('keuze');
  controle('backup bekijken: inhoud geteld, Terugzetten beschikbaar', /Artikelen\s*3/.test(paneel.textContent) && !paneel.querySelector('.knop').disabled, paneel.textContent);
  paneel.querySelector('.knop').click();
  await slaap(500);
  controle('terugzetten: backup staat in thuis.json, huidige stand bewaard, melding met Ongedaan maken',
    R(od.bestanden['thuis.json'].tekst) === BEGIN && od.bestanden['thuis_voor_terugzetten.json'].tekst === voorTerug && !!d.getElementById('m-terug') && /Ongedaan maken/.test(d.getElementById('m-terug').textContent),
    R(od.bestanden['thuis.json'].tekst));
  [...d.getElementById('m-terug').querySelectorAll('button')].find((b) => b.textContent === 'Ongedaan maken').click();
  await slaap(500);
  controle('ongedaan maken: de stand van voor het terugzetten is terug', od.bestanden['thuis.json'].tekst === voorTerug && /dag=vr;tijd=18:30/.test(R(od.bestanden['thuis.json'].tekst)));
  d.getElementById('tab-boodschappen').click();

  /* 5f. Artikel bewerken: tik op de naam, kladversie, Opslaan, vraag bij sluiten. */
  {
    const od5 = onedrive([
      'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00',
      'winkel;Albert Heijn;route=Zuivel|Brood',
      'winkel;Plus;route=Koeling',
      'artikel;Melk;soort=wekelijks;ligt=Albert Heijn:Zuivel|Plus;op=2026-11-14T06:00;gekocht=2026-10-25|2026-11-01|2026-11-08|2026-11-15',
      'artikel;Kaas;soort=wekelijks;op=2026-11-14T06:00'
    ].join('\n') + '\n');
    const w5 = await start(od5);
    await slaap(800);
    const d5 = w5.document;
    const rij = (n) => [...d5.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === n);
    const open = () => !d5.getElementById('artikelScherm').hidden;
    const plekTekst = () => [...d5.querySelectorAll('#plekken .plekrij .nm')].map((x) => x.textContent).join('|');
    controle('artikellijst: winkels als grijs regeltje onder de naam, alfabetisch; zonder winkels geen regeltje',
      rij('Melk').querySelector('.winkels').textContent === 'Albert Heijn · Plus' && !rij('Kaas').querySelector('.winkels') && d5.getElementById('lijstAantal').textContent === '2 artikelen');
    rij('Melk').querySelector('.rondje').click(); await slaap(20);
    controle('artikel: het rondje opent geen bewerkscherm', !open());
    rij('Melk').querySelector('.rondje').click(); await slaap(20);
    rij('Melk').querySelector('.tekst').click(); await slaap(20);
    controle('artikel: tik op de naam opent het bewerkscherm, invoer weg, Opslaan-balk in beeld',
      open() && d5.getElementById('artikelNaam').value === 'Melk' && d5.getElementById('balk-boodschappen').hidden && !d5.getElementById('balk-artikel').hidden && d5.getElementById('lijst').offsetParent !== undefined);
    controle('artikel: soort Wekelijks gekozen', d5.querySelector('.soorten [aria-checked="true"]').textContent === 'Wekelijks');
    controle('artikel: te koop bij, onbekende afdeling als —, rechts "2 winkels"', plekTekst() === 'Albert HeijnZuivel|Plus—' && d5.getElementById('plekTal').textContent === '2 winkels', plekTekst());
    controle('artikel: gekocht in één regel', d5.getElementById('gekochtRegel').textContent === 'Laatst gekocht 15 nov · meestal elke week', d5.getElementById('gekochtRegel').textContent);
    /* zonder wijzigingen: meteen dicht */
    d5.getElementById('artikelDicht').click(); await slaap(20);
    controle('artikel: sluiten zonder wijzigingen gaat meteen', !open() && !d5.getElementById('keuze') && !d5.getElementById('balk-boodschappen').hidden);
    /* wijzigen en sluiten: vraag; kruisje = verder bewerken; Weggooien = niets bewaard */
    rij('Melk').querySelector('.tekst').click(); await slaap(20);
    const nm = d5.getElementById('artikelNaam');
    nm.value = 'Halfvolle melk'; nm.dispatchEvent(new w5.Event('input'));
    d5.getElementById('artikelDicht').click(); await slaap(20);
    let k = d5.getElementById('keuze');
    controle('artikel: sluiten met wijzigingen vraagt "Wijzigingen opslaan?"', !!k && k.getAttribute('aria-label') === 'Wijzigingen opslaan?' && [...k.querySelectorAll('.knop')].map((b) => b.textContent).join() === 'Weggooien,Opslaan');
    k.querySelector('.kruis').click(); await slaap(20);
    controle('artikel: kruisje van de vraag = verder bewerken', open() && d5.getElementById('artikelNaam').value === 'Halfvolle melk');
    d5.getElementById('artikelDicht').click(); await slaap(20);
    [...d5.getElementById('keuze').querySelectorAll('.knop')][0].click(); await slaap(20);
    controle('artikel: Weggooien sluit zonder iets te bewaren', !open() && !!rij('Melk') && !rij('Halfvolle melk'));
    /* tabblad wisselen met wijzigingen: ook de vraag */
    rij('Melk').querySelector('.tekst').click(); await slaap(20);
    [...d5.querySelectorAll('.soorten button')][2].click();
    d5.getElementById('tab-winkels').click(); await slaap(20);
    controle('artikel: ander tabblad met wijzigingen vraagt eerst', !!d5.getElementById('keuze') && d5.getElementById('scherm-winkels').hidden);
    [...d5.getElementById('keuze').querySelectorAll('.knop')][1].click(); await slaap(50);
    controle('artikel: Opslaan in de vraag bewaart en gaat naar het tabblad', !d5.getElementById('scherm-winkels').hidden && !open());
    d5.getElementById('tab-boodschappen').click(); await slaap(20);
    /* naam, plek weghalen, winkel toevoegen (nieuw) met nieuwe afdeling */
    rij('Melk').querySelector('.tekst').click(); await slaap(20);
    controle('artikel: soort Regelmatig is bewaard', d5.querySelector('.soorten [aria-checked="true"]').textContent === 'Regelmatig');
    nm.value; const nm2 = d5.getElementById('artikelNaam'); nm2.value = 'Halfvolle melk'; nm2.dispatchEvent(new w5.Event('input'));
    [...d5.querySelectorAll('#plekken .plekrij')].find((r) => /Plus/.test(r.textContent)).querySelector('.icoonknop').click(); await slaap(20);
    controle('artikel: plek weghalen (nog niet bewaard)', plekTekst() === 'Albert HeijnZuivel', plekTekst());
    d5.querySelector('#plekken .toevoegrij').click(); await slaap(20);
    k = d5.getElementById('keuze');
    const opties = [...k.querySelectorAll('.optie .nm')].map((x) => x.textContent).join();
    controle('artikel: winkel kiezen toont alleen winkels waar het nog niet ligt', opties === 'Plus', opties + ' / ' + k.textContent);
    [...k.querySelectorAll('.optie')].find((o) => o.textContent === 'Plus').click(); await slaap(50);
    k = d5.getElementById('keuze');
    controle('artikel: winkel met afdelingen gekozen, meteen door naar de afdeling', !!k && /Waar ligt Halfvolle melk bij Plus\?/.test(k.getAttribute('aria-label')), k && k.getAttribute('aria-label'));
    const za = k.querySelector('#keuzeZoek'); za.value = 'Diepvries'; za.dispatchEvent(new w5.Event('input'));
    k.querySelector('.plusknop').click(); await slaap(50);
    controle('artikel: nieuwe afdeling ingevuld', plekTekst() === 'Albert HeijnZuivel|PlusDiepvries', plekTekst());
    d5.querySelector('#plekken .toevoegrij').click(); await slaap(20);
    k = d5.getElementById('keuze');
    const zk = k.querySelector('#keuzeZoek'); zk.value = 'jumbo'; zk.dispatchEvent(new w5.Event('input'));
    k.querySelector('.plusknop').click(); await slaap(50);
    controle('artikel: nieuwe winkel (zonder afdelingen) gemaakt, geen vraag naar de afdeling, geen —',
      !d5.getElementById('keuze') && plekTekst() === 'Albert HeijnZuivel|jumbo|PlusDiepvries', plekTekst());
    d5.getElementById('artikelOpslaan').click();
    await slaap(2500);
    const t5 = R(od5.bestanden['thuis.json'].tekst);
    controle('artikel opslaan: naam, soort en plekken in OneDrive, nieuwe winkel en afdeling',
      /^artikel;Halfvolle melk;soort=regelmatig;ligt=Albert Heijn:Zuivel\|Plus:Diepvries\|jumbo;/m.test(t5) && /^winkel;jumbo$/m.test(t5) && /^winkel;Plus;route=Koeling\|Diepvries$/m.test(t5) && !/^artikel;Melk;/m.test(t5), t5);
    controle('artikel opslaan: scherm dicht, lijst toont de nieuwe naam', !open() && !!rij('Halfvolle melk'));
    /* dubbele naam: melding, blijft open */
    rij('Kaas').querySelector('.tekst').click(); await slaap(20);
    const nm3 = d5.getElementById('artikelNaam'); nm3.value = 'halfvolle MELK'; nm3.dispatchEvent(new w5.Event('input'));
    d5.getElementById('artikelOpslaan').click(); await slaap(20);
    controle('artikel: bestaande naam geeft een melding en het scherm blijft open', open() && !!d5.getElementById('m-naam') && /Er is al een artikel/.test(d5.getElementById('m-naam').textContent));
    d5.getElementById('m-naam').querySelector('button').click();
    /* verwijderen met ongedaan maken */
    d5.getElementById('artikelWeg').click(); await slaap(20);
    const mw = [...d5.querySelectorAll('#meldingen .melding')].find((m) => /Kaas verwijderd/.test(m.textContent));
    controle('artikel verwijderen: dicht, weg uit de lijst, melding met Ongedaan maken', !open() && !rij('Kaas') && !!mw && /Ongedaan maken/.test(mw.textContent));
    controle('ongedaan maken: balkje in de knop dat in 6 s leegloopt', !!mw.querySelector('button .aftel') && mw.querySelector('button .aftel').style.animationDuration === '6000ms');
    mw.querySelector('button').click(); await slaap(2500);
    controle('ongedaan maken: Kaas terug, ook in OneDrive', !!rij('Kaas') && /^artikel;Kaas;/m.test(R(od5.bestanden['thuis.json'].tekst)));
    /* terugknop van de telefoon met wijzigingen: blijft open en vraagt */
    rij('Kaas').querySelector('.tekst').click(); await slaap(20);
    const nm4 = d5.getElementById('artikelNaam'); nm4.value = 'Oude kaas'; nm4.dispatchEvent(new w5.Event('input'));
    w5.dispatchEvent(new w5.PopStateEvent('popstate', { state: null }));
    await slaap(20);
    controle('terugknop met wijzigingen: scherm blijft, vraag verschijnt', open() && !!d5.getElementById('keuze') && d5.getElementById('keuze').getAttribute('aria-label') === 'Wijzigingen opslaan?');
    [...d5.getElementById('keuze').querySelectorAll('.knop')][0].click(); await slaap(20);
    controle('Weggooien na terugknop: dicht, Kaas ongewijzigd', !open() && !!rij('Kaas'));
  }

  /* 5g. "nieuw": door de ander op de lijst gezet, weg zodra je het gezien hebt (per telefoon). */
  {
    const od6 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Thee;op=2026-11-01T10:00;opdoor=Natasja\nartikel;Kaas;op=2026-11-01T10:00;opdoor=Testspeler\n');
    let w6 = await start(od6);
    await slaap(800);
    const label = (w, n) => { const r = [...w.document.querySelectorAll('#lijst .item')].find((x) => naamVanRij(x) === n); return !!(r && r.querySelector('.nieuw')); };
    controle('nieuw: van de ander wel, van jezelf niet, ook als het al dagen op de lijst staat', label(w6, 'Thee') && !label(w6, 'Kaas'));
    w6.document.getElementById('tab-winkel').click(); await slaap(20);
    w6.document.getElementById('tab-boodschappen').click(); await slaap(20);
    controle('nieuw: weg nadat je het scherm verlaten hebt', !label(w6, 'Thee'));
    const bewaard = await w6.eval("kvGet('gezien')");
    controle('nieuw: gezien bewaard op de telefoon, niet in het bestand',
      Array.isArray(bewaard) && bewaard.length === 1 && /\|2026-11-01T10:00$/.test(bewaard[0]) && !/gezien/.test(od6.bestanden['thuis.json'].tekst), JSON.stringify(bewaard));
  }

  /* 6. Een bestand dat geen UTF-8 is: melding, niets geschreven. */
  od = onedrive(null);
  od.bestanden['thuis.json'] = { bytes: new Uint8Array([0x7B, 0x7D, 0xFF, 0x0A]), eTag: '"x1"', id: 'id-thuis.json' };
  w = await start(od);
  await slaap(800);
  controle('geen UTF-8: melding en geen schrijfactie', !!w.document.getElementById('m-bestand') && od.puts === 0,
    'puts=' + od.puts + ' melding=' + !!w.document.getElementById('m-bestand'));

  /* 6b. Kapotte JSON en een nieuwer formaat: melding, niets geschreven. */
  for (const [naam, tekst, woord] of [['kapot', '{"versie": "' + FORMAAT + '", "artikelen": {', 'beschadigd'], ['nieuwer', '{"versie": "1352903-000"}', 'nieuwere versie'],
    ['verkeerde opbouw', '{"versie": "' + FORMAAT + '", "artikelen": []}', 'opbouw']]) {
    od = onedrive(null);
    od.bestanden['thuis.json'] = { tekst, eTag: '"x1"', id: 'id-thuis.json' };
    w = await start(od);
    await slaap(800);
    const m = w.document.getElementById('m-bestand');
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
