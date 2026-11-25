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
/* Wachten tot elk geopend venster rustig is (geen geplande of lopende ronde), met een
   maximum: sneller dan een vaste tijd, en even betrouwbaar. */
const vensters = [];
/* Alleen een deel draaien: DEEL=doen node thuis-dom.cjs (of DEEL=5z30,winkel). Een deel
   draait als zijn nummer precies klopt (5z1 niet 5z10) of als een woord in zijn titel staat
   (hoofdletters maken niet uit). Zonder DEEL: alles. Het begin (1–5e) hoort bij "basis". */
const DELEN = (process.env.DEEL || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
function deel(naam) {
  /* Een nummer (5z1) telt alleen als het precies klopt; een woord zoekt in de titel. */
  const nummer = naam.split(' ')[0].toLowerCase(), titel = naam.toLowerCase();
  const ja = !DELEN.length || DELEN.some((x) => (/^\d[0-9a-z]*$/.test(x) ? x === nummer : titel.includes(x)));
  if (ja) vensters.length = 0;
  return ja;
}
async function rust(max) {
  const eind = Date.now() + max;
  await slaap(20);
  while (Date.now() < eind) {
    if (vensters.every((w) => { try { return !w.__gepland && !w.__loopt && !w.eval('sync.bezig'); } catch (e) { return true; } })) return;
    await slaap(20);
  }
  if (process.env.RUSTLOG) console.log('rust: max', max, vensters.map((w) => { try { return (w.__gepland ? 'G' : '-') + (w.eval('sync.bezig') ? 'B' : '-'); } catch (e) { return 'x'; } }).join(' '));
}

let goed = 0, fout = 0;
function controle(naam, ok, extra) {
  if (ok) { goed++; return; }
  fout++; console.log('FOUT  ' + naam + (extra ? ' — ' + extra : ''));
}

/* ---------- gesimuleerde OneDrive ---------- */
function onedrive(begintekst) {
  const od = { bestanden: {}, puts: 0, verzoeken: [], botsBijVolgendePut: null };
  let teller = 1;
  const zet = (naam, tekst) => { const id = od.bestanden[naam] ? od.bestanden[naam].id : 'id-' + naam + (od.nieuweIds ? '-' + teller : ''); od.bestanden[naam] = { tekst, eTag: '"e' + (teller++) + '"', id, gewijzigd: od.serverNu || new Date().toISOString() }; };
  if (begintekst !== null) zet('thuis.json', J(begintekst));
  od.zet = zet;
  const antwoord = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body,
    arrayBuffer: async () => (body instanceof Uint8Array ? body : new TextEncoder().encode(String(body))).buffer
  });
  /* od.zonderLinkBijSelectie: doen alsof de server bij $select geen downloadlink meegeeft (vangnet testen). */
  const metSelectie = (it, g) => { if (od.zonderLinkBijSelectie && /\$select/.test(g)) delete it['@microsoft.graph.downloadUrl']; return it; };
  const item = (naam) => ({ id: od.bestanden[naam].id, name: naam, eTag: od.bestanden[naam].eTag, lastModifiedDateTime: od.bestanden[naam].gewijzigd, '@microsoft.graph.downloadUrl': 'https://download.test/' + naam });
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
    if (od.geenToegang) return antwoord(404, {});
    let m = /^\/drives\/D\/items\/MAP:\/([^:?]+)(:\/content)?/.exec(g);
    if (m) {
      const naam = decodeURIComponent(m[1]);
      if (methode === 'GET') return od.bestanden[naam] ? antwoord(200, metSelectie(item(naam), g)) : antwoord(404, {});
      if (methode === 'PUT') {
        if (od.bestanden[naam] && /conflictBehavior=fail/.test(g)) return antwoord(409, {});
        zet(naam, String(init.body));
        return antwoord(201, item(naam));
      }
    }
    if (/^\/drives\/D\/items\/MAP(\?|$)/.test(g)) return antwoord(200, { id: 'MAP', name: 'thuis', folder: {} });
    if (/^\/drives\/D\/items\/MAP\/children/.test(g)) return antwoord(200, { value: Object.keys(od.bestanden).map((n) => ({ id: od.bestanden[n].id, name: n })) });
    m = /^\/drives\/D\/items\/([^/?]+)(\/content)?/.exec(g);
    if (m) {
      const naam = naamVanId(m[1]);
      if (!naam) return antwoord(404, {});
      if (methode === 'DELETE') { delete od.bestanden[naam]; od.gewist = (od.gewist || []).concat(naam); return antwoord(204, {}); }
      if (methode === 'GET') return antwoord(200, metSelectie(item(naam), g));
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
async function start(od, vooraf, gedeeld, adres) {
  const fakeIdb = require('fake-indexeddb');
  const idb = gedeeld || new fakeIdb.IDBFactory();
  // vooraf: aangemeld en een gekoppelde map
  await new Promise((resolve, reject) => {
    const req = idb.open('thuis', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const t = req.result.transaction('kv', 'readwrite');
      t.objectStore('kv').put({ access: 'a', accessTot: Date.now() + 3600e3, refresh: 'r', aangemeldOp: Date.now(), naam: 'Testspeler Een' }, 'auth');
      t.objectStore('kv').put({ driveId: 'D', itemId: 'MAP', naam: 'thuis' }, 'map');
      /* De meeste tests gaan uit van alle weergave-schakelaars aan (zoals het vroeger standaard was);
         een test die de echte standaard wil, geeft { weergave: undefined } mee. */
      const kv = Object.assign({ weergave: { winkelTal: true, artikelWinkels: true, aankoopWinkel: true } }, vooraf || {});
      for (const [k, v] of Object.entries(kv)) if (v !== undefined) t.objectStore('kv').put(v, k);
      t.oncomplete = () => { req.result.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
  const dom = new JSDOM(html, {
    url: adres || 'https://mv-systems-apps.github.io/thuis/thuis.html',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.indexedDB = idb;
      w.fetch = (...a) => od.fetch(...a);
      w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
      w.matchMedia = () => ({ matches: true, addEventListener() {} });
      w.scrollTo = () => {};
      w.console.error = () => {};
    }
  });
  const w = dom.window;
  /* Bijhouden of er een ronde gepland staat (planSync) die nog niet begon (voor rust()). */
  /* __gepland: een ronde staat gepland; __loopt: synchroniseerNu loopt (van begin tot eind,
     dus ook de leesacties vóór sync.bezig). Samen dekken ze het hele traject. */
  w.eval("window.__gepland = false; window.__loopt = 0; { const plan = planSync, nu = synchroniseerNu; planSync = function (ms) { window.__gepland = true; return plan(ms); }; synchroniseerNu = async function () { window.__gepland = false; window.__loopt++; try { return await nu.apply(this, arguments); } finally { window.__loopt--; } }; }");
  vensters.push(w);
  await slaap(600);
  return w;
}
function datumTekstT(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const zonderPauze = (s) => s.split('\n').filter((x) => !x.startsWith('instelling;opruimen;')).join('\n');
const overigeKop = (k) => [...k.querySelectorAll('.uitklapper')].find((u) => u.textContent.startsWith('Overige'));
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
  if (deel('basis 1–5e: openen, toevoegen, zoeken, tegelijk, winkel, winkels, instellingen')) {
  /* 1. Openen: lezen, wekelijks terug, wegschrijven met dagbackup. */
  let od = onedrive(BEGIN);
  /* oude backups: één van vorig jaar (weg) en één van gisteren (blijft) */
  const gisteren = new Date(Date.now() - 86400000);
  const naamGisteren = 'thuis_backup_' + gisteren.getFullYear() + String(gisteren.getMonth() + 1).padStart(2, '0') + String(gisteren.getDate()).padStart(2, '0') + '.json';
  od.zet('thuis_backup_20200105.json', '{}'); od.zet(naamGisteren, '{}'); od.zet('notities.txt', 'x');
  let w = await start(od);
  await rust(800);
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
  await rust(2500);
  controle('toevoegen: na de pauze in OneDrive, als eenmalig, door Testspeler',
    /artikel;pesto;soort=eenmalig;op=[\d-]+T[\d:]+;opdoor=Testspeler/.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));

  /* 3. Een bestaand artikel toevoegen zet het op de lijst, zonder dubbele. */
  await typ(w, 'KOFFIE');
  await plus(w);
  await rust(2500);
  const t3 = R(od.bestanden['thuis.json'].tekst);
  controle('toevoegen bestaand: Koffie op de lijst, geen tweede regel',
    /artikel;Koffie;soort=regelmatig;op=/.test(t3) && (t3.match(/^artikel;koffie/gim) || []).length === 1, t3);

  /* 4. Zoeken: typen toont Gevonden, zonder filterknoppen. */
  await typ(w, 'mel');
  controle('zoeken: Gevonden toont Melk', w.document.getElementById('lijstTitel').textContent === 'Gevonden' && namenInLijst(w).join() === 'Melk', namenInLijst(w).join());
  controle('kopregel: rechts het aantal artikelen', w.document.getElementById('lijstAantal').textContent === '1', w.document.getElementById('lijstAantal').textContent);
  {
    const fk = () => [...w.document.querySelectorAll('#filters .filter')];
    const aan = () => fk().map((b) => b.getAttribute('aria-pressed') === 'true' ? 1 : 0).join('');
    controle('zoeken: filterknoppen blijven, geen gekleurd, ze tellen de treffers', !w.document.getElementById('filters').hidden && aan() === '00000' && fk()[0].getAttribute('aria-label') === 'Op de lijst, ' + (namenInLijst(w).length ? w.eval("artikelen.filter((a) => a.op && zoekPast(a.naam, a.notitie, 'mel')).length") : 0), aan() + ' ' + fk()[0].getAttribute('aria-label'));
    const leeg = fk().find((b) => / 0$/.test(b.getAttribute('aria-label')));
    leeg.click();
    controle('zoeken: tik op een filter zoekt alleen daarin (hier niets)', w.document.getElementById('lijstTitel').textContent === 'Gevonden' && namenInLijst(w).length === 0 && leeg.isConnected === false && aan().indexOf('1') !== -1);
    fk()[aan().indexOf('1')].click();
    controle('zoeken: nog een tik = weer in alles', namenInLijst(w).join() === 'Melk' && aan() === '00000');
  }
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

  /* 5b. Van de lijst halen: meteen onder "Van de lijst gehaald" (geen wachttijd). */
  const rondjeVan = (naam) => [...w.document.querySelectorAll('.item')].find((r) => naamVanRij(r) === naam).querySelector('.rondje');
  rondjeVan('pesto').click();
  const inLijst = namenInLijst(w).includes('pesto');
  const weg = w.document.getElementById('weggehaald');
  controle('van de lijst: meteen onder "Van de lijst gehaald"', !inLijst && !!weg && weg.textContent.includes('pesto'), 'inLijst=' + inLijst + ' weg=' + (weg && weg.textContent));
  weg.querySelector('.kopbalk').click();
  const weg2 = w.document.getElementById('weggehaald');
  controle('van de lijst: kop inklapbaar (pijl, aantal blijft)', weg2.querySelector('.kopbalk').getAttribute('aria-expanded') === 'false' && !weg2.querySelector('.lijst') && /^\d+$/.test(weg2.querySelector('.kopbalk .tal').textContent), weg2.innerHTML.slice(0, 300));
  weg2.querySelector('.kopbalk').click();
  w.document.getElementById('lijstKop').click();
  controle('op de lijst: kop inklapbaar', w.document.getElementById('lijst').hidden && w.document.getElementById('lijstKop').getAttribute('aria-expanded') === 'false' && !!w.document.getElementById('weggehaald'));
  w.document.getElementById('lijstKop').click();
  rondjeVan('pesto').click();
  const wegNa = w.document.getElementById('weggehaald');
  controle('van de lijst: één tik zet hem terug', namenInLijst(w).includes('pesto') && !(wegNa && wegNa.textContent.includes('pesto')), JSON.stringify(namenInLijst(w)));
  await rust(2500);

  /* 5c. Het tabblad Winkel. */
  const d = w.document;
  d.getElementById('tab-winkel').click();
  await slaap(300);
  controle('winkel: tabblad open, tabbalk blijft', !d.getElementById('scherm-winkel').hidden && w.getComputedStyle(d.querySelector('nav')).display !== 'none');
  controle('winkel: zonder winkels en alles zonder winkel geen lege winkelkaart', !d.getElementById('winkelNaam') && !d.querySelector('#winkelLijst .winkelkaart:not(.zonder)'));
  const rijVan = (naam) => [...d.querySelectorAll('#winkelLijst .wrij')].find((r) => r.querySelector('.nm').textContent === naam);
  controle('winkel: voortgang bovenaan los van de winkel, Bananen onder "Zonder winkel" met winkelicoon',
    d.querySelector('#scherm-winkel > .voortgang h2').textContent === 'Boodschappen' && /^\d+ van \d+$/.test(d.getElementById('winkelTeller').textContent) &&
    rijVan('Bananen').closest('.winkelkaart.zonder').querySelector('h3').textContent === 'Winkel?' && /^\d+$/.test(rijVan('Bananen').closest('.winkelkaart.zonder').querySelector('.winkelkop .tal').textContent) &&
    !!rijVan('Bananen').querySelector('.naarwinkel') && !rijVan('Bananen').closest('.winkelkaart').contains(d.getElementById('winkelKies')));
  rijVan('Bananen').querySelector('.naarwinkel').click();
  let k = d.getElementById('keuze');
  controle('winkel: winkelicoon vraagt bij welke winkel het te koop is', !!k && k.getAttribute('aria-label') === 'Waar is Bananen te koop?');
  controle('keuzelijst: zoekvak zonder kopje, placeholder Winkel',
    !k.querySelector('.zoek label') && k.querySelector('#keuzeZoek').getAttribute('aria-label') === 'Zoeken of toevoegen' && k.querySelector('#keuzeZoek').placeholder === 'Winkel');
  k.querySelector('#keuzeZoek').value = 'Albert Heijn';
  k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkelicoon: nieuwe winkel gemaakt, Bananen staat er niet meer onder "Zonder winkel", geen vraag naar een afdeling',
    !d.getElementById('keuze') && !rijVan('Bananen').closest('.winkelkaart.zonder') && d.getElementById('winkelNaam').textContent === 'Winkel kiezen');
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((o) => o.textContent.startsWith('Albert Heijn')).click();
  await slaap(50);
  controle('winkel: AH gekozen; Bananen in de winkelkaart zonder kop of speld (geen afdelingen); kop gevuld paars',
    d.getElementById('winkelNaam').textContent === 'Albert Heijn' && rijVan('Bananen').closest('.winkelkaart').contains(d.getElementById('winkelKies')) &&
    !rijVan('Bananen').closest('.afd').querySelector('.afdkop') && !rijVan('Bananen').querySelector('.waar'));
  /* De eerste afdeling komt uit de Winkels-tab; daarna wel "Afdeling?" met de speld. */
  w.eval("handelen([{ actie: 'afdErbij', soort: 'winkel', id: winkels.find((x) => x.naam === 'Albert Heijn').id, afd: { id: nieuweId(), naam: 'Groente & fruit' } }])");
  await slaap(50);
  controle('winkel met afdelingen: "Afdeling?" in de winkelkaart, als afdeling, met speld',
    rijVan('Bananen').closest('.afd').querySelector('.afdkop span').textContent === 'Afdeling?' && !rijVan('Bananen').closest('.afd').classList.contains('grijs') && !!rijVan('Bananen').querySelector('.waar'));
  rijVan('Bananen').querySelector('.waar').click();
  k = d.getElementById('keuze');
  controle('keuzelijst afdeling: placeholder Afdeling', k.querySelector('#keuzeZoek').placeholder === 'Afdeling');
  [...k.querySelectorAll('.optie')].find((o) => o.textContent === 'Groente & fruit').click();
  await slaap(100);
  const kopjes = [...d.querySelectorAll('#winkelLijst .afdkop span')].map((h) => h.textContent);
  controle('winkel: Bananen staat nu onder Groente & fruit', kopjes.includes('Groente & fruit'), JSON.stringify(kopjes));
  await rust(2500);
  const t5c = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: afdeling alleen in de route van de winkel, artikel met ligt=winkel:afdeling',
    !/^afdeling;/m.test(t5c) && /^winkel;Albert Heijn;route=Groente & fruit$/m.test(t5c) && /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;/m.test(t5c), t5c);

  /* winkel kiezen: alleen waar iets is vastgelegd, met aantal; de rest onder "Overige winkels" */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  k.querySelector('#keuzeZoek').value = 'Lidl centrum'; k.querySelector('.plusknop').click();
  await slaap(100);
  controle('winkel: nieuwe winkel gekozen', d.getElementById('winkelNaam').textContent === 'Lidl centrum', d.getElementById('winkelNaam').textContent);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  const zicht = [...k.querySelectorAll('.opties > *')].map((o) => o.textContent.replace(/\s+/g, ' ').trim());
  controle('winkelkeuze: gekozen winkel bovenaan onder vaste kop Huidig (streep, geen pijl), AH onder "Nodig" (Bananen alleen daar), niet vet, met paars icoon; geen Overige als er niets over is, kruisje, zoekvak onderaan',
    JSON.stringify(zicht) === '["Huidig","Lidl centrum","Nodig1","Albert HeijnBananen1"]' && k.querySelector('.uitklapper.vast') && !k.querySelector('.uitklapper.vast svg') && k.querySelector('.optie').classList.contains('actief') && !k.querySelector('.sterk') && !!k.querySelector('.optie svg') && !!k.querySelector('.kop .kruis') && k.querySelector('.paneel').lastElementChild.classList.contains('zoek'), JSON.stringify(zicht));
  controle('winkelkeuze: elke winkel één keer', [...k.querySelectorAll('.optie .nm')].map((o) => o.firstChild.textContent).join() === 'Lidl centrum,Albert Heijn');
  k.querySelector('#keuzeZoek').value = 'alb'; k.querySelector('#keuzeZoek').dispatchEvent(new w.Event('input'));
  controle('keuzelijst: typen filtert (één keer, ook al staat hij in twee secties)', [...k.querySelectorAll('.optie .nm')].map((o) => o.firstChild.textContent).join() === 'Albert Heijn');
  k.querySelector('.kruis').click();
  controle('keuzelijst: kruisje sluit', !d.getElementById('keuze'));

  /* in de Lidl: Bananen ligt alleen bij de AH, dus niet hier; wat nog geen winkels heeft staat bovenaan */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Lidl')).click();
  await slaap(100);
  const eldersKop = (d.querySelector('#winkelLijst .elderspijl') || {}).parentNode;
  controle('winkel: in de Lidl staat Bananen onder "Elders", rechts "1"', !!eldersKop && eldersKop.querySelector('span').textContent === 'Elders' && eldersKop.querySelector('.tal').textContent === '1', eldersKop && eldersKop.textContent);
  if (eldersKop) { eldersKop.click(); await slaap(20); }
  const bananenElders = [...d.querySelectorAll('#winkelLijst .afd.grijs .wrij')].find((r) => r.querySelector('.nm').firstChild.textContent === 'Bananen');
  controle('winkel: onder de naam in grijs waar het wel te koop is', !!bananenElders && bananenElders.querySelector('.nm .winkels').textContent === 'Albert Heijn', bananenElders && bananenElders.textContent);
  if (eldersKop) { d.querySelector('#winkelLijst .elderspijl').click(); await slaap(20); }
  const losRij = d.querySelector('#winkelLijst .wrij .naarwinkel') && d.querySelector('#winkelLijst .wrij .naarwinkel').closest('.wrij');
  const losNaam = losRij ? losRij.querySelector('.nm').textContent : '';
  if (losRij) {
    losRij.querySelector('.naarwinkel').click();
    k = d.getElementById('keuze');
    [...k.querySelectorAll('.optie')].find((o) => o.textContent.startsWith('Lidl')).click();
    await rust(2500);
    const tl = R(od.bestanden['thuis.json'].tekst);
    controle('winkelicoon: ' + losNaam + ' te koop bij Lidl centrum (geen afdelingen, dus geen vraag)',
      !d.getElementById('keuze') && new RegExp('^artikel;' + losNaam + ';.*ligt=Lidl centrum(;|$)', 'm').test(tl) && /^winkel;Lidl centrum$/m.test(tl), tl);
  } else controle('bij deze winkel: er staat iets zonder winkel op de lijst', false);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Albert Heijn')).click();
  await slaap(100);

  rijVan('Bananen').querySelector('.vink').click();
  controle('winkel: afgevinkt blijft eerst op zijn plek', rijVan('Bananen').classList.contains('gedaan'));
  await rust(1800);
  const mandjeKop = [...d.querySelectorAll('#winkelLijst .afdkop')].find((h) => h.firstChild.textContent === 'Winkelmand');
  const mandje = mandjeKop ? mandjeKop.firstChild.textContent + ' | ' + mandjeKop.querySelector('.tal').textContent : '';
  controle('winkel: na 1,5 s in het mandje', mandje === 'Winkelmand | 1', mandje);
  controle('mandje: eerst dicht (alleen de kop), pijltje rechts', !!mandjeKop && !mandjeKop.parentNode.querySelector('.wrij') && mandjeKop.querySelector('.mandpijl').getAttribute('aria-expanded') === 'false');
  mandjeKop.querySelector('span').click(); await slaap(20);
  const mk2 = [...d.querySelectorAll('#winkelLijst .afdkop')].find((h) => h.firstChild.textContent === 'Winkelmand');
  controle('mandje: tik op de kop klapt open', !!mk2.parentNode.querySelector('.wrij') && mk2.querySelector('.mandpijl').getAttribute('aria-expanded') === 'true');
  controle('winkel: teller "1 van n"', /^1 van \d+$/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
  await rust(2500);
  const vandaag = new Date(); const dstr = vandaag.getFullYear() + '-' + String(vandaag.getMonth() + 1).padStart(2, '0') + '-' + String(vandaag.getDate()).padStart(2, '0');
  const t5d = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: in OneDrive van de lijst, met de aankoopdatum', new RegExp('^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;gekocht=2000-01-01\\|' + dstr + '$', 'm').test(t5d), t5d);
  [...d.querySelectorAll('#winkelLijst .wrij.gedaan .vink')].find((b) => b.textContent.includes('Bananen')).click();
  await rust(2500);
  const t5e = R(od.bestanden['thuis.json'].tekst);
  controle('winkel: terugtikken zet hem terug op de lijst, zonder de aankoopdatum',
    /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:Groente & fruit;op=[^;]+;(opdoor=[^;]*;)?gekocht=2000-01-01$/m.test(t5e), t5e);
  rijVan('Bananen').querySelector('.vink').click();
  await rust(1800);
  /* mandje per winkel: in een andere winkel begint de teller op 0 en is het mandje leeg */
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  (overigeKop(k) || { click() {} }).click();
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Lidl')).click();
  await slaap(50);
  const mk = () => [...d.querySelectorAll('#winkelLijst .afdkop')].find((h) => h.firstChild.textContent === 'Winkelmand');
  controle('winkelmand: in de Lidl ook het mandje van de AH (dicht), voortgang blijft 1', !!mk() && mk().querySelector('.tal').textContent === '1' && !mk().parentNode.querySelector('.wrij') && /^1 van/.test(d.getElementById('winkelTeller').textContent), d.getElementById('winkelTeller').textContent);
  mk().querySelector('span').click(); await slaap(20);
  const mrij = (n) => [...mk().parentNode.querySelectorAll('.wrij')].find((r) => r.querySelector('.nm').firstChild.textContent === n);
  controle('winkelmand open in de Lidl: geen subkoppen, Bananen met de winkel eronder', !d.querySelector('#winkelLijst .subkop') && !!mrij('Bananen') && mrij('Bananen').querySelector('.winkels').textContent === 'Albert Heijn', mk().parentNode.textContent);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze'); (overigeKop(k) || { click() {} }).click();
  [...k.querySelectorAll('.optie')].find((b) => b.textContent.startsWith('Albert Heijn')).click();
  await slaap(50);
  d.getElementById('winkelKies').click();
  k = d.getElementById('keuze');
  const koppen = [...k.querySelectorAll('.uitklapper')].map((u) => u.querySelector('span').textContent + ':' + u.getAttribute('aria-expanded')).join();
  controle('winkelkeuze: zonder iets nodigs heet de groep "Te koop bij" en staat open', /Te koop bij:true|Nodig:true/.test(koppen) && !/Alternatief/.test(koppen) || /Nodig:true,Alternatief:false/.test(koppen), koppen);
  k.querySelector('.kruis').click();
  controle('terug in de AH: mandje met 1 artikel', [...d.querySelectorAll('#winkelLijst .afdkop')].some((h) => h.firstChild.textContent === 'Winkelmand' && h.querySelector('.tal').textContent === '1'));
  const leeg = d.querySelector('#winkelLijst .icoonknop.mandleeg');
  controle('mandje: leegmaakknop (mandje met kruis) bij het mandje', !!leeg && leeg.getAttribute('aria-label') === 'Winkelmand leegmaken');
  leeg.click();
  controle('mandje: leeggemaakt', ![...d.querySelectorAll('#winkelLijst .afdkop span')].some((h) => h.textContent.startsWith('Winkelmand')));
  const mMandje = d.querySelector('[id^="m-mandje"]');
  controle('mandje leeg: melding met Ongedaan maken en aftelbalkje', !!mMandje && /Winkelmand leeggemaakt/.test(mMandje.textContent) && !!mMandje.querySelector('button .aftel'));
  mMandje.querySelector('button').click(); await slaap(20);
  controle('mandje leeg ongedaan: Bananen weer in het mandje', [...d.querySelectorAll('#winkelLijst .afdkop')].some((h) => h.firstChild.textContent === 'Winkelmand' && h.querySelector('.tal').textContent === '1'));
  d.querySelector('#winkelLijst .icoonknop.mandleeg').click();
  d.querySelector('[id^="m-mandje"]').remove();

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
  controle('winkels: alfabetisch; zonder favorieten heet de groep Winkels', winkelRijen().join() === 'Albert Heijn,Lidl centrum' && d.querySelector('#winkelsOverzicht .kop span').textContent === 'Winkels', winkelRijen().join());
  [...d.querySelectorAll('#winkelsOverzicht .winkelrij')][0].click();
  await slaap(50);
  controle('winkel: detail open met afdelingen', !d.getElementById('winkelDetail').hidden && d.querySelector('#winkelDetail h2').textContent === 'Albert Heijn' && d.getElementById('winkelsTekst').placeholder === 'Afdeling');
  for (const afd of ['Brood', 'Zuivel']) { d.getElementById('winkelsTekst').value = afd; d.getElementById('winkelsPlus').click(); await slaap(20); }
  controle('winkel: gewoon geen greepjes, wel afdelingen met aantal en pijltje', !d.querySelector('#afdelingen .greep') && [...d.querySelectorAll('#afdelingen .afdrij .nm')].map((x) => x.textContent).join() === 'Groente & fruit,Brood,Zuivel' &&
    d.querySelector('#winkelDetail .kopbalk .volgorde').getAttribute('aria-pressed') === 'false');
  d.querySelector('#winkelDetail .kopbalk .volgorde').click(); await slaap(20);
  controle('Volgorde aan: greepjes en potloden, knop ingedrukt', d.querySelectorAll('#afdelingen .arij .greep').length === 3 && d.querySelectorAll('#afdelingen .arij .potlood').length === 3 &&
    d.querySelector('#winkelDetail .kopbalk .volgorde').getAttribute('aria-pressed') === 'true');
  const afdNamen = () => [...d.querySelectorAll('#afdelingen .arij .nm')].map((x) => x.textContent).join();
  controle('afdelingen toevoegen, achteraan', afdNamen() === 'Groente & fruit,Brood,Zuivel', afdNamen());
  /* verslepen: Zuivel twee plekken omhoog */
  const greep = [...d.querySelectorAll('#afdelingen .arij')][2].querySelector('.greep');
  const pe = (type, y) => { const e = new w.MouseEvent(type, { bubbles: true, clientY: y }); return e; };
  greep.dispatchEvent(pe('pointerdown', 300)); greep.dispatchEvent(pe('pointermove', 300 - 112)); greep.dispatchEvent(pe('pointerup', 300 - 112));
  await slaap(20);
  controle('verslepen: Zuivel bovenaan', afdNamen() === 'Zuivel,Groente & fruit,Brood', afdNamen());
  /* L9: komt er tijdens het slepen een sync (hertekening), dan gaat het slepen gewoon door. */
  const greep2 = [...d.querySelectorAll('#afdelingen .arij')][2].querySelector('.greep');
  greep2.dispatchEvent(pe('pointerdown', 300)); greep2.dispatchEvent(pe('pointermove', 300 - 60));
  w.eval('tekenWinkels()');
  greep2.dispatchEvent(pe('pointermove', 300 - 112)); greep2.dispatchEvent(pe('pointerup', 300 - 112));
  await slaap(20);
  controle('verslepen tijdens een hertekening: gaat door en wordt bewaard (L9)', afdNamen() === 'Brood,Zuivel,Groente & fruit', afdNamen());
  const greep3 = [...d.querySelectorAll('#afdelingen .arij')][0].querySelector('.greep');
  greep3.dispatchEvent(pe('pointerdown', 100)); greep3.dispatchEvent(pe('pointermove', 100 + 112)); greep3.dispatchEvent(pe('pointerup', 100 + 112));
  await slaap(20);
  controle('tik op de naam van een afdeling opent het bewerkpaneel', (() => {
    d.querySelector('#afdelingen .arij .nm').click();
    const k = d.getElementById('keuze'); const ok = !!k && k.getAttribute('aria-label') === 'Afdeling bewerken' && k.querySelector('#bewerkNaam').value === 'Zuivel';
    if (k) k.querySelector('.kruis').click();
    return ok && !d.getElementById('keuze');
  })());
  /* hernoemen: tik op de naam (geen potloodje meer) */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.querySelector('.nm').textContent === 'Groente & fruit').querySelector('.nm').click();
  let p = d.getElementById('keuze');
  controle('tik op de naam opent "Afdeling bewerken" met de naam, prullenbak links van Opslaan',
    !!p && p.getAttribute('aria-label') === 'Afdeling bewerken' && p.querySelector('#bewerkNaam').value === 'Groente & fruit' && p.querySelector('.bewerkknoppen').firstElementChild.classList.contains('prul'));
  p.querySelector('#bewerkNaam').value = 'AGF'; p.querySelector('.knop').click();
  await rust(2500);
  const t5f = R(od.bestanden['thuis.json'].tekst);
  controle('afdeling hernoemd in route en bij Bananen', /^winkel;Albert Heijn;route=Zuivel\|AGF\|Brood$/m.test(t5f) && /^artikel;Bananen;soort=wekelijks;ligt=Albert Heijn:AGF;/m.test(t5f), t5f);
  /* verwijderen met ongedaan maken */
  [...d.querySelectorAll('#afdelingen .arij')].find((r) => r.querySelector('.nm').textContent === 'Brood').querySelector('.nm').click();
  d.getElementById('keuze').querySelector('.prul').click();
  controle('afdeling verwijderd: meteen weg, met Ongedaan maken', afdNamen() === 'Zuivel,AGF' && [...d.querySelectorAll('.melding button')].some((b) => b.textContent === 'Ongedaan maken'));
  const mWeg = [...d.querySelectorAll('.melding')].find((m) => m.textContent.includes('Brood verwijderd'));
  controle('melding: naam vet, Ongedaan maken als hoofdknop', mWeg.querySelector('p b').textContent === 'Brood' && !mWeg.querySelector('button').classList.contains('tweede'), mWeg.innerHTML);
  mWeg.querySelector('button').click();
  controle('ongedaan maken: Brood terug', afdNamen() === 'Zuivel,AGF,Brood', afdNamen());
  /* favoriet en hernoemen van de winkel */
  d.querySelector('#winkelDetail .ster').click();
  await slaap(50);
  d.querySelector('#winkelDetail .bewerk').click();
  p = d.getElementById('keuze');
  controle('potlood van de winkel: "Winkel bewerken"', p.getAttribute('aria-label') === 'Winkel bewerken' && p.querySelector('#bewerkNaam').value === 'Albert Heijn');
  p.querySelector('#bewerkNaam').value = 'AH'; p.querySelector('.knop').click();
  await rust(2500);
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
  await slaap(20);
  const bev = d.getElementById('keuze');
  controle('winkel verwijderen met artikelen: eerst bevestigen, met het aantal (K14)', !!bev && /AH verwijderen\?/.test(bev.textContent) && /\d+ artikel(en liggen| ligt) hier\./.test(bev.querySelector('.paneeltekst').textContent), bev && bev.textContent);
  [...bev.querySelectorAll('.bewerkknoppen .knop')].find((b) => b.textContent === 'Verwijderen').click();
  await rust(2500);
  const tWeg = R(od.bestanden['thuis.json'].tekst);
  controle('winkel verwijderen: meteen weg in OneDrive, ook bij Bananen', !/^winkel;AH/m.test(tWeg) && /^artikel;Bananen;soort=wekelijks;(op|gekocht)/m.test(tWeg) && !/Bananen;[^\n]*ligt=/.test(tWeg), tWeg);
  const ongedaan = [...d.querySelectorAll('.melding button')].find((b) => b.textContent === 'Ongedaan maken');
  ongedaan.click();
  await rust(2500);
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
  await rust(2500);

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
  controle('soort volgt het filter: Wekelijks gekozen → vergrootglas (soort wekelijks)', /wekelijks/.test(d.getElementById('invoerZoek').getAttribute('aria-label')));
  const vak2 = d.getElementById('invoerTekst');
  vak2.focus(); vak2.value = 'Kaas'; vak2.dispatchEvent(new w.Event('input', { bubbles: true }));
  controle('typen: links annuleren, vergrootglas weg, + in de kleur van wekelijks',
    !d.getElementById('invoerTerug').hidden && d.getElementById('invoerZoek').hidden && /rgb\(29, 63, 175\)|#1D3FAF/i.test(d.getElementById('invoerPlus').style.background), d.getElementById('invoerPlus').style.background);
  d.getElementById('invoerPlus').click();
  await rust(2500);
  controle('toevoegen in filter Wekelijks: nieuw artikel is wekelijks', /^artikel;Kaas;soort=wekelijks;/m.test(R(od.bestanden['thuis.json'].tekst)), R(od.bestanden['thuis.json'].tekst));
  vak2.value = 'ka'; vak2.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.getElementById('invoerTerug').click();
  controle('annuleren: vak leeg, lijst terug, vergrootglas terug', vak2.value === '' && d.getElementById('lijstTitel').textContent === 'Wekelijks' && !d.getElementById('invoerZoek').hidden);
  filterKnop('Op de lijst').click();
  controle('filter Op de lijst → soort eenmalig', /eenmalig/.test(d.getElementById('invoerZoek').getAttribute('aria-label')));

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
  /* Tijd via het eigen paneel: uur 18, minuten :30. */
  d.getElementById('wekTijd').click(); await slaap(20);
  [...d.querySelectorAll('#keuze .uren button')].find((b) => b.textContent === '18').click(); await slaap(20);
  [...d.querySelectorAll('#keuze .minuten button')].find((b) => b.textContent === ':30').click();
  controle('tijd kiezen: paneel met uren en minuten, sluit na de minuten', !d.getElementById('keuze'));
  await rust(2500);
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
    zonderPauze(R(od.bestanden['thuis.json'].tekst)) === BEGIN && /^instelling;opruimen;tot=\d{4}-\d{2}-\d{2}$/m.test(R(od.bestanden['thuis.json'].tekst)) && od.bestanden['thuis_voor_terugzetten.json'].tekst === voorTerug && !!d.getElementById('m-terug') && /Ongedaan maken/.test(d.getElementById('m-terug').textContent),
    R(od.bestanden['thuis.json'].tekst));
  [...d.getElementById('m-terug').querySelectorAll('button')].find((b) => b.textContent === 'Ongedaan maken').click();
  await slaap(500);
  controle('ongedaan maken: de stand van voor het terugzetten is terug (met dezelfde pauze voor opruimen)', zonderPauze(R(od.bestanden['thuis.json'].tekst)) === zonderPauze(R(voorTerug)) && /dag=vr;tijd=18:30/.test(R(od.bestanden['thuis.json'].tekst)));
  /* M4: twee keer kort na elkaar terugzetten: de stand van vóór de eerste poging blijft bewaard. */
  for (let keer = 0; keer < 2; keer++) {
    d.getElementById('naarBackups').click(); await slaap(300);
    d.querySelector('#backupScherm .backuprij').click(); await slaap(300);
    d.getElementById('keuze').querySelector('.knop').click(); await slaap(500);
    const mt = d.getElementById('m-terug'); if (mt) mt.remove();
    if (keer === 0) {
      /* Tussendoor schrijft een gewone ronde (hier: de ander voegt iets toe): telt niet als eigen wijziging (M4 ronde 4). */
      const jj = JSON.parse(od.bestanden['thuis.json'].tekst); jj.artikelen.tus01 = { naam: 'Tussendoor', soort: 'eenmalig' }; od.zet('thuis.json', JSON.stringify(jj));
      w.eval('planSync(0)'); await rust(800);
    }
  }
  controle('twee keer terugzetten binnen het uur: de stand van vóór de eerste poging blijft bewaard (M4)', od.bestanden['thuis_voor_terugzetten.json'].tekst === voorTerug);
  d.getElementById('tab-boodschappen').click();

  }
  /* 5f. Artikel bewerken: tik op de naam, kladversie, Opslaan, vraag bij sluiten. */
  if (deel('5f Artikel bewerken: tik op de naam, kladversie, Opslaan, vraag bij sluiten.')) {
    const od5 = onedrive([
      'instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00',
      'winkel;Albert Heijn;route=Zuivel|Brood',
      'winkel;Plus;route=Koeling',
      'artikel;Melk;soort=wekelijks;ligt=Albert Heijn:Zuivel|Plus;op=2026-11-14T06:00;gekocht=2026-10-25|2026-11-01|2026-11-08|2026-11-15',
      'artikel;Kaas;soort=wekelijks;op=2026-11-14T06:00'
    ].join('\n') + '\n');
    const w5 = await start(od5);
    await rust(800);
    const d5 = w5.document;
    const rij = (n) => [...d5.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === n);
    const open = () => !d5.getElementById('artikelScherm').hidden;
    const plekTekst = () => [...d5.querySelectorAll('#plekken .plekrij .nm')].map((x) => x.textContent).join('|');
    controle('artikellijst: winkels als grijs regeltje onder de naam, alfabetisch; zonder winkels geen regeltje',
      rij('Melk').querySelector('.winkels').textContent === 'Albert Heijn · Plus' && !rij('Kaas').querySelector('.winkels') && d5.getElementById('lijstAantal').textContent === '2');
    rij('Melk').querySelector('.rondje').click(); await slaap(20);
    controle('artikel: het rondje opent geen bewerkscherm', !open());
    [...d5.querySelectorAll('#weggehaald .item')].find((r) => naamVanRij(r) === 'Melk').querySelector('.rondje').click(); await slaap(20);
    rij('Melk').querySelector('.tekst').click(); await slaap(20);
    controle('artikel: tik op de naam opent het bewerkscherm, invoer weg, Opslaan-balk in beeld',
      open() && d5.getElementById('artikelNaam').value === 'Melk' && d5.getElementById('balk-boodschappen').hidden && !d5.getElementById('balk-artikel').hidden && d5.getElementById('lijst').offsetParent !== undefined);
    controle('artikel: soort Wekelijks gekozen', d5.querySelector('.soorten [aria-checked="true"]').textContent === 'Wekelijks');
    controle('artikel: te koop bij, onbekende afdeling als —, rechts "2"', plekTekst() === 'Albert HeijnZuivel|Plus—' && d5.getElementById('plekTal').textContent === '2', plekTekst());
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
    await rust(2500);
    const t5 = R(od5.bestanden['thuis.json'].tekst);
    controle('artikel opslaan: naam, soort en plekken in OneDrive, nieuwe winkel en afdeling',
      /^artikel;Halfvolle melk;soort=regelmatig;ligt=Albert Heijn:Zuivel\|Plus:Diepvries\|jumbo;/m.test(t5) && /^winkel;jumbo$/m.test(t5) && /^winkel;Plus;route=Koeling\|Diepvries$/m.test(t5) && !/^artikel;Melk;/m.test(t5), t5);
    controle('artikel opslaan: scherm dicht, lijst toont de nieuwe naam', !open() && !!rij('Halfvolle melk'));
    /* dubbele naam: melding, blijft open */
    rij('Kaas').querySelector('.tekst').click(); await slaap(20);
    const nm3 = d5.getElementById('artikelNaam'); nm3.value = 'halfvolle MELK'; nm3.dispatchEvent(new w5.Event('input'));
    d5.getElementById('artikelOpslaan').click(); await slaap(20);
    controle('artikel: bestaande naam geeft een melding en het scherm blijft open', open() && !!d5.getElementById('m-fout') && /Er is al een artikel/.test(d5.getElementById('m-fout').textContent));
    d5.getElementById('m-fout').querySelector('button').click();
    /* verwijderen met ongedaan maken */
    d5.getElementById('artikelWeg').click(); await slaap(20);
    const mw = [...d5.querySelectorAll('#meldingen .melding')].find((m) => /Kaas verwijderd/.test(m.textContent));
    controle('artikel verwijderen: dicht, weg uit de lijst, melding met Ongedaan maken', !open() && !rij('Kaas') && !!mw && /Ongedaan maken/.test(mw.textContent));
    controle('ongedaan maken: balkje in de knop dat in 6 s leegloopt', !!mw.querySelector('button .aftel') && mw.querySelector('button .aftel').style.animationDuration === '6000ms');
    mw.querySelector('button').click(); await rust(2500);
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
  if (deel('5g "nieuw": door de ander op de lijst gezet, weg zodra je het gezien hebt (per tele')) {
    const od6 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Thee;op=2026-11-01T10:00;opdoor=Natasja\nartikel;Kaas;op=2026-11-01T10:00;opdoor=Testspeler\n');
    let w6 = await start(od6);
    await rust(800);
    const label = (w, n) => { const r = [...w.document.querySelectorAll('#lijst .item')].find((x) => naamVanRij(x) === n); return !!(r && r.querySelector('.nieuw')); };
    controle('nieuw: van de ander wel, van jezelf niet, ook als het al dagen op de lijst staat', label(w6, 'Thee') && !label(w6, 'Kaas'));
    w6.document.getElementById('tab-winkel').click(); await slaap(20);
    w6.document.getElementById('tab-boodschappen').click(); await slaap(20);
    controle('nieuw: weg nadat je het scherm verlaten hebt', !label(w6, 'Thee'));
    const bewaard = await w6.eval("kvGet('gezien')");
    controle('nieuw: gezien bewaard op de telefoon, niet in het bestand',
      Array.isArray(bewaard) && bewaard.length === 1 && /\|2026-11-01T10:00$/.test(bewaard[0]) && !/gezien/.test(od6.bestanden['thuis.json'].tekst), JSON.stringify(bewaard));
  }

  /* 5h. Archief: eenmalig gekocht of van de lijst → archief; instelling bewaren. */
  if (deel('5h Archief: eenmalig gekocht of van de lijst → archief; instelling bewaren.')) {
    const od7 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Pesto;op=2026-11-20T10:00\nartikel;Hummus;gekocht=2026-11-19\nartikel;Zonnebrand;weg=2026-11-10\nartikel;Melk;soort=wekelijks\n');
    const w7 = await start(od7);
    await rust(800);
    const d7 = w7.document;
    const filterE = [...d7.querySelectorAll('#filters .filter')][1];
    controle('archief: filterknop Eenmalig telt alleen wat op de lijst staat', filterE.textContent === '1', filterE.textContent);
    filterE.click(); await slaap(20);
    const namen7 = () => [...d7.querySelectorAll('#lijst .item')].map(naamVanRij).join();
    const arch = () => d7.getElementById('archief');
    controle('archief: onder Eenmalig alleen Pesto; archief ingeklapt met "2", kopbalken',
      namen7() === 'Pesto' && !!arch() && arch().querySelector('.kopbalk .tal').textContent === '2' && !arch().querySelector('.lijst') && !!d7.querySelector('#lijstBlok > .kopbalk'), namen7());
    arch().querySelector('.kopbalk').click(); await slaap(20);
    const archNamen = [...arch().querySelectorAll('.item')].map((r) => naamVanRij(r) + ':' + r.querySelector('.hint').textContent).join();
    controle('archief uitgeklapt: nieuwste eerst, gekocht of van de lijst', archNamen === 'Hummus:gekocht 19 nov,Zonnebrand:van de lijst 10 nov', archNamen);
    [...arch().querySelectorAll('.item')][0].querySelector('.rondje').click(); await slaap(20);
    controle('archief: + zet Hummus terug op de lijst, onder Eenmalig', namen7() === 'Hummus,Pesto' && [...arch().querySelectorAll('.item')].length === 1, namen7());
    [...d7.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Pesto').querySelector('.rondje').click();
    await rust(1800);
    controle('archief: van de lijst gehaald gaat (na even grijs) naar het archief', namen7() === 'Hummus' && /Pesto/.test(arch().textContent), namen7());
    await slaap(1500);
    const t7 = R(od7.bestanden['thuis.json'].tekst);
    const vandaag = new Date(); const dstr7 = vandaag.getFullYear() + '-' + String(vandaag.getMonth() + 1).padStart(2, '0') + '-' + String(vandaag.getDate()).padStart(2, '0');
    controle('archief: "weg" met de datum van vandaag in het bestand', new RegExp('^artikel;Pesto;soort=eenmalig;weg=' + dstr7 + '$', 'm').test(t7), t7);
    d7.getElementById('tab-instellingen').click(); await slaap(50);
    const opties = [...d7.querySelectorAll('#archiefBewaren button')];
    controle('instelling archief: 1 week, 1 mnd, 3 mnd, 1 jaar; standaard 1 jaar', opties.map((b) => b.textContent).join() === '1 week,1 mnd,3 mnd,1 jaar' && opties[3].getAttribute('aria-checked') === 'true');
    opties[2].click(); await rust(2500);
    controle('instelling archief: 3 mnd in het bestand', /^instelling;archief;bewaren=3m$/m.test(R(od7.bestanden['thuis.json'].tekst)), R(od7.bestanden['thuis.json'].tekst));
  }

  /* 5i. Aantal: tik op het icoon opent de teller; "2×" achter de naam; blijft staan na kopen. */
  if (deel('5i Aantal: tik op het icoon opent de teller; "2×" achter de naam; blijft staan na k')) {
    const od8 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;soort=wekelijks;ligt=Plus;op=2026-11-20T10:00\n');
    const w8 = await start(od8);
    await rust(800);
    const d8 = w8.document;
    const melk = () => [...d8.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Melk');
    controle('aantal: bij 1 geen "×" en geen teller', !melk().querySelector('.aantal') && !d8.querySelector('.teller'));
    melk().querySelector('.icoon').click(); await slaap(20);
    controle('aantal: tik op het icoon opent de teller, minder kan niet onder 1', !!d8.querySelector('.teller') && d8.querySelector('.teller .n').textContent === '1' && d8.querySelector('.teller .min').disabled);
    d8.querySelector('.teller .meer').click(); await slaap(20);
    controle('aantal: + maakt er 2× van, teller blijft open', melk().querySelector('.aantal').textContent === '2×' && d8.querySelector('.teller .n').textContent === '2');
    melk().querySelector('.icoon').click(); await slaap(20);
    controle('aantal: nog een tik op het icoon sluit de teller', !d8.querySelector('.teller'));
    melk().querySelector('.icoon').click(); await slaap(20);
    d8.querySelector('.teller .n').click(); await slaap(20);
    controle('aantal: tik op het getal laat de teller open', !!d8.querySelector('.teller'));
    d8.querySelector('.teller > span').click(); await slaap(20);
    controle('aantal: tik elders op de regel (Aantal) sluit de teller', !d8.querySelector('.teller'));
    melk().querySelector('.icoon').click(); await slaap(20);
    d8.querySelector('.teller').click(); await slaap(20);
    controle('aantal: tik op de lege ruimte van de regel sluit de teller ook', !d8.querySelector('.teller'));
    melk().querySelector('.aantal').click(); await slaap(20);
    controle('aantal: tik op "2×" opent de teller ook (niet het bewerkscherm)', !!d8.querySelector('.teller') && d8.getElementById('artikelScherm').hidden);
    await rust(2500);
    controle('aantal: in het bestand', /^artikel;Melk;soort=wekelijks;aantal=2;/m.test(R(od8.bestanden['thuis.json'].tekst)), R(od8.bestanden['thuis.json'].tekst));
    d8.getElementById('tab-winkel').click(); await slaap(50);
    const wrij = [...d8.querySelectorAll('#winkelLijst .wrij')].find((r) => r.querySelector('.nm').firstChild.textContent === 'Melk');
    controle('aantal: in de winkel "2×" achter de naam', !!wrij && wrij.querySelector('.aantal').textContent === '2×');
    wrij.querySelector('.vink').click(); await rust(2500);
    controle('aantal: blijft staan na het kopen', /^artikel;Melk;soort=wekelijks;aantal=2;/m.test(R(od8.bestanden['thuis.json'].tekst)) && !/^artikel;Melk;.*;op=/m.test(R(od8.bestanden['thuis.json'].tekst)), R(od8.bestanden['thuis.json'].tekst));
  }

  /* 5j. Notitie: in het bewerkscherm, paars onder de winkels, blijft staan; HTML blijft tekst. */
  if (deel('5j Notitie: in het bewerkscherm, paars onder de winkels, blijft staan; HTML blijft ')) {
    const od9 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;soort=wekelijks;ligt=Plus;op=2026-11-20T10:00\n');
    const w9 = await start(od9);
    await rust(800);
    const d9 = w9.document;
    const melk = () => [...d9.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Melk');
    melk().querySelector('.tekst').click(); await slaap(20);
    const nt = d9.getElementById('artikelNotitie');
    controle('notitie: veld onder Naam, leeg', !!nt && nt.value === '' && nt.closest('.veld').previousElementSibling.querySelector('#artikelNaam'));
    nt.value = '  halfvol <b>x</b> '; nt.dispatchEvent(new w9.Event('input'));
    d9.getElementById('artikelOpslaan').click(); await slaap(50);
    const r = melk();
    controle('notitie: onder de winkels, alleen platte tekst (HTML eruit)', r.querySelector('.winkels').nextElementSibling === r.querySelector('.notitie') && r.querySelector('.notitie').textContent === 'halfvol x' && !r.querySelector('.notitie b'), r.querySelector('.notitie').textContent);
    await rust(2500);
    controle('notitie: in het bestand, opgeschoond', /^artikel;Melk;soort=wekelijks;notitie=halfvol x;/m.test(R(od9.bestanden['thuis.json'].tekst)), R(od9.bestanden['thuis.json'].tekst));
    d9.getElementById('tab-winkel').click(); await slaap(50);
    const wr = [...d9.querySelectorAll('#winkelLijst .wrij')].find((x) => x.querySelector('.nm').firstChild.textContent === 'Melk');
    controle('notitie: ook in de winkel onder de naam', !!wr && wr.querySelector('.notitie').textContent === 'halfvol x');
    wr.querySelector('.vink').click(); await rust(2500);
    controle('notitie: blijft staan na het kopen', /^artikel;Melk;soort=wekelijks;notitie=halfvol/m.test(R(od9.bestanden['thuis.json'].tekst)));
  }

  /* 5k. Toestand bovenaan Instellingen en het logboek. */
  if (deel('5k Toestand bovenaan Instellingen en het logboek.')) {
    const odA = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk\n');
    const wA = await start(odA);
    await slaap(900);
    const dA = wA.document;
    dA.getElementById('tab-instellingen').click(); await slaap(50);
    controle('toestand: Bijgewerkt om hh:mm, knop Nu synchroniseren', dA.getElementById('syncWoord').textContent === 'Bijgewerkt' && /^om \d{2}:\d{2}$/.test(dA.getElementById('syncSub').textContent) && dA.getElementById('btnSyncNu').textContent === 'Nu synchroniseren',
      dA.getElementById('syncWoord').textContent + ' / ' + dA.getElementById('syncSub').textContent);
    wA.eval("sync.offline = true; wachtrij.push({}, {}, {}); tekenWolk();"); await slaap(50);
    controle('toestand: Offline in oranje met wachtende wijzigingen', dA.getElementById('syncWoord').textContent === 'Offline' && /^3 wijzigingen wachten · laatst bijgewerkt \d{2}:\d{2}$/.test(dA.getElementById('syncSub').textContent) && dA.getElementById('syncToestand').classList.contains('warn'),
      dA.getElementById('syncSub').textContent);
    wA.eval("wachtrij.length = 0; sync.offline = false; sync.aanmelden = true; tekenWolk();"); await slaap(50);
    controle('toestand: opnieuw aanmelden wordt de knop', dA.getElementById('btnSyncNu').textContent === 'Opnieuw aanmelden');
    wA.eval("sync.aanmelden = false; tekenWolk();");
    await wA.eval("logboek(['Eerste regel', 'Tweede <b>regel</b>'])");
    dA.getElementById('tab-boodschappen').click(); dA.getElementById('tab-instellingen').click(); await slaap(50);
    controle('logboek: aantal bij de regel onder Gegevens', dA.getElementById('logboekAantal').textContent === '2');
    dA.getElementById('naarLogboek').click(); await slaap(50);
    const regels = [...dA.querySelectorAll('#backupScherm .logregel')];
    controle('logboek: nieuwste eerst, met "vandaag hh:mm", als tekst', regels.length === 2 && /Tweede <b>regel<\/b>$/.test(regels[0].textContent) && !regels[0].querySelector('b') && /^vandaag \d{2}:\d{2}/.test(regels[0].querySelector('.tijd').textContent),
      regels.map((r) => r.textContent).join(' | '));
    dA.querySelector('#backupScherm .terug').click(); await slaap(50);
  }

  /* 5l. Link: apart veld; zonder https:// wordt het aangevuld; onveilig geweigerd; tikken opent apart. */
  if (deel('5l Link: apart veld; zonder https:// wordt het aangevuld; onveilig geweigerd; tikke')) {
    const odB = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;soort=wekelijks;notitie=halfvol;ligt=Plus;op=2026-11-20T10:00\n');
    const wB = await start(odB);
    await rust(800);
    const dB = wB.document;
    const geopend = [];
    wB.open = (url, doel, opties) => { geopend.push([url, doel, opties].join(' ')); return null; };
    const melk = () => [...dB.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Melk');
    melk().querySelector('.tekst').click(); await slaap(20);
    const ln = dB.getElementById('artikelLink');
    controle('link: veld onder Notitie, plaatshouder "Link of zoekwoorden"', !!ln && ln.placeholder === 'Link of zoekwoorden' && ln.closest('.veld').previousElementSibling.querySelector('#artikelNotitie'));
    ln.value = 'javascript:alert(1)'; ln.dispatchEvent(new wB.Event('input'));
    dB.getElementById('artikelOpslaan').click(); await slaap(20);
    controle('link: onveilig geweigerd met melding, scherm blijft open', !dB.getElementById('artikelScherm').hidden && /Alleen links met https:\/\/ zijn toegestaan/.test((dB.getElementById('m-fout') || {}).textContent || ''));
    ln.value = 'www.ah.nl/melk'; ln.dispatchEvent(new wB.Event('input'));
    dB.getElementById('artikelOpslaan').click(); await slaap(50);
    const nr = melk().querySelector('.notitie');
    const regels = (el) => [...el.children].map((c) => [...c.childNodes].map((x) => x.textContent).join('+')).join(' / ');
    controle('link: aangevuld met https://, getoond als "ah.nl ↗" op een tweede regel onder de notitie; melding weg', !!nr && regels(nr) === 'halfvol / ah.nl ↗' && !!nr.querySelector('.link') && !dB.getElementById('m-fout'), nr && nr.textContent);
    nr.querySelector('.link').click(); await slaap(20);
    controle('link: tikken opent in een nieuw tabblad zonder verwijzer, niet het bewerkscherm', geopend[0] === 'https://www.ah.nl/melk _blank noopener,noreferrer' && dB.getElementById('artikelScherm').hidden, geopend.join());
    await rust(2500);
    controle('link: in het bestand', /^artikel;Melk;soort=wekelijks;notitie=halfvol;link=https:\/\/www\.ah\.nl\/melk;/m.test(R(odB.bestanden['thuis.json'].tekst)), R(odB.bestanden['thuis.json'].tekst));
    dB.getElementById('tab-winkel').click(); await slaap(50);
    const wr = [...dB.querySelectorAll('#winkelLijst .wrij')].find((x) => x.querySelector('.nm').firstChild.textContent === 'Melk');
    wr.querySelector('.link').click(); await slaap(20);
    controle('link: in de winkel opent tikken de link en vinkt niet af', geopend.length === 2 && !wr.classList.contains('gedaan') && !dB.querySelector('#winkelLijst .wrij.gedaan'));
    /* Zoekwoorden in plaats van een link */
    dB.getElementById('tab-boodschappen').click(); await slaap(30);
    melk().querySelector('.tekst').click(); await slaap(20);
    dB.getElementById('artikelLink').value = 'melk  halfvol 1l'; dB.getElementById('artikelLink').dispatchEvent(new wB.Event('input'));
    dB.getElementById('artikelOpslaan').click(); await slaap(50);
    controle('zoekwoorden: getoond tussen aanhalingstekens', melk().querySelector('.notitie .link').textContent === '"melk halfvol 1l" ↗', melk().querySelector('.notitie').textContent);
    melk().querySelector('.notitie .link').click(); await slaap(20);
    controle('zoekwoorden: tik opent Google met de zoekopdracht', geopend[2] === 'https://www.google.com/search?q=melk+halfvol+1l _blank noopener,noreferrer', geopend.join());
    melk().querySelector('.tekst').click(); await slaap(20);
    controle('zoekwoorden: in het bewerkveld weer als woorden', dB.getElementById('artikelLink').value === 'melk halfvol 1l');
    dB.getElementById('artikelDicht').click(); await slaap(20);
    controle('zoekwoorden: ongewijzigd sluiten vraagt niets', dB.getElementById('artikelScherm').hidden && !dB.getElementById('keuze'));
    await rust(2500);
    controle('zoekwoorden: in het bestand een gewone https-link', /^artikel;Melk;[^\n]*link=https:\/\/www\.google\.com\/search\?q=melk\+halfvol\+1l/m.test(R(odB.bestanden['thuis.json'].tekst)), R(odB.bestanden['thuis.json'].tekst));
  }

  /* 5m. Doen: toevoegen, groepen, afronden (herhalend schuift door), bewerken met periode en herhalen. */
  if (deel('5m Doen: toevoegen, groepen, afronden (herhalend schuift door), bewerken met period')) {
    const odC = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const wC = await start(odC);
    await rust(800);
    const dC = wC.document;
    wC.eval("doen.filter = 'alles'");
    dC.getElementById('tab-doen').click(); await slaap(50);
    controle('doen: invoer onderaan "Actie", leeg scherm "Geen acties"', !dC.getElementById('balk-doen').hidden && dC.getElementById('doenTekst').placeholder === 'Actie' && /Geen acties/.test(dC.getElementById('doenLijst').textContent));
    for (const n of ['Vuilnis buiten zetten', 'Lamp vervangen']) { dC.getElementById('doenTekst').value = n; dC.getElementById('doenPlus').click(); await slaap(30); }
    const groepen = () => [...dC.querySelectorAll('#doenLijst .kopbalk')].map((k) => k.textContent.replace(/\s+/g, ' ').trim()).join('|');
    controle('doen: nieuwe acties onder "Zonder periode"', groepen() === 'Zonder periode2', groepen());
    { const kop = () => [...dC.querySelectorAll('#doenLijst .kopbalk')].find((k) => /Zonder periode/.test(k.textContent));
      kop().click(); await slaap(20);
      const dicht = kop().getAttribute('aria-expanded') === 'false' && !dC.querySelector('#doenLijst .actierij') && kop().querySelector('.tal').textContent === '2';
      kop().click(); await slaap(20);
      controle('doen: "Zonder periode" inklapbaar, aantal blijft, weer open', dicht && kop().getAttribute('aria-expanded') === 'true' && dC.querySelectorAll('#doenLijst .actierij').length === 2); }
    const rijC = (n) => [...dC.querySelectorAll('#doenLijst .actierij')].find((r) => r.querySelector('.nm').textContent === n);
    rijC('Vuilnis buiten zetten').querySelector('.tekst').click(); await slaap(30);
    controle('doen: bewerkscherm met Actie, Notitie, Link, Wanneer (n.v.t. gekozen), geen Herhalen', !dC.getElementById('actieScherm').hidden && dC.getElementById('actieNaam').value === 'Vuilnis buiten zetten'
      && [...dC.querySelectorAll('#wanneerSoort button')].map((b) => b.textContent).join() === 'n.v.t.,Dag,Maand,Kw.,Jaar' && dC.querySelector('#wanneerSoort [aria-checked="true"]').textContent === 'n.v.t.' && dC.getElementById('herhaalVeld').hidden);
    [...dC.querySelectorAll('#wanneerSoort button')][1].click(); await slaap(10);
    const vandaag = wC.eval('datumTekst(new Date())');
    controle('doen: Dag kiezen begint bij vandaag, herhalen verschijnt met Nee/Week/Maand/Kwartaal/Jaar', !dC.getElementById('herhaalVeld').hidden && [...dC.querySelectorAll('#herhaalSoort button')].map((b) => b.textContent).join() === 'Nee,Week,Maand,Kw.,Jaar'
      && dC.querySelector('.blader label').textContent === wC.eval("periodeTekst(datumTekst(new Date()), '', true)"));
    dC.querySelectorAll('.blader button')[0].click(); await slaap(10);
    [...dC.querySelectorAll('#herhaalSoort button')][1].click(); await slaap(10);
    dC.getElementById('actieOpslaan').click(); await slaap(50);
    const gisteren = wC.eval("verschuif(datumTekst(new Date()), -1, 'dag')");
    controle('doen: gisteren is te laat, met herhaalteken', /^Te laat1(?!\d)/.test(groepen()) && /week$/.test(rijC('Vuilnis buiten zetten').querySelector('.wanneer').textContent), groepen());
    rijC('Vuilnis buiten zetten').querySelector('.rondje').click(); await slaap(50);
    const volgende = wC.eval("volgendeKeer('" + gisteren + "', 'week', datumTekst(new Date()))");
    const m = [...dC.querySelectorAll('#meldingen .melding')].find((x) => /Vuilnis buiten zetten afgerond/.test(x.textContent));
    controle('doen: herhalend afronden schuift door naar de volgende keer, met Ongedaan maken', !!m && !!rijC('Vuilnis buiten zetten') && !/Te laat/.test(groepen()) && !!m.querySelector('.aftel'), groepen());
    await rust(2500);
    controle('doen: in het bestand de volgende keer en wanneer (niet wie)', new RegExp('^actie;Vuilnis buiten zetten;datum=' + volgende + ';herhaal=week;klaar=[^;]+$', 'm').test(R(odC.bestanden['thuis.json'].tekst)), R(odC.bestanden['thuis.json'].tekst));
    m.querySelector('button').click(); await slaap(50);
    controle('doen: ongedaan maken zet het terug op gisteren', /^Te laat/.test(groepen()));
    rijC('Lamp vervangen').querySelector('.rondje').click(); await slaap(30);
    controle('doen: gewoon afronden blijft eerst grijs staan', rijC('Lamp vervangen').classList.contains('vertrekt'));
    await rust(1800);
    controle('doen: daarna onder "Afgerond" (ingeklapt)', /Afgerond1$/.test(groepen()) && !rijC('Lamp vervangen'), groepen());
    dC.querySelector('#afgerond .kopbalk').click(); await slaap(20);
    controle('doen: Afgerond uitgeklapt toont wanneer, niet wie', /^afgerond (vandaag|[a-z]{2} \d+ [a-z]+)$/.test(rijC('Lamp vervangen').querySelector('.wanneer').textContent), rijC('Lamp vervangen').textContent);
    rijC('Lamp vervangen').querySelector('.rondje').click(); await slaap(30);
    controle('doen: heropenen zet hem terug onder Zonder periode', /Zonder periode1$/.test(groepen()) && !dC.getElementById('afgerond'), groepen());
    rijC('Lamp vervangen').querySelector('.tekst').click(); await slaap(20);
    dC.getElementById('actieLink').value = 'javascript:alert(1)'; dC.getElementById('actieLink').dispatchEvent(new wC.Event('input'));
    dC.getElementById('actieOpslaan').click(); await slaap(20);
    controle('doen: onveilige link geweigerd', !dC.getElementById('actieScherm').hidden && !!dC.getElementById('m-fout'));
    dC.getElementById('actieDicht').click(); await slaap(20);
    [...dC.getElementById('keuze').querySelectorAll('.knop')][0].click(); await slaap(20);
    controle('doen: sluiten met wijzigingen vraagt; Weggooien sluit', dC.getElementById('actieScherm').hidden);
    const links = dC.getElementById('doenLinks'), vak = dC.getElementById('doenTekst');
    controle('balk links: in rust een vergrootglas; tik = gaan typen', links.getAttribute('aria-label') === 'Zoeken' && (links.click(), dC.activeElement === vak) && links.getAttribute('aria-label') === 'Annuleren');
    vak.value = 'lamp'; vak.dispatchEvent(new wC.Event('input')); await slaap(20);
    controle('balk links: typen filtert', [...dC.querySelectorAll('#doenLijst .actierij')].length === 1);
    links.click(); await slaap(20);
    controle('balk links: de pijl maakt leeg, sluit het toetsenbord en toont alles weer', vak.value === '' && dC.activeElement !== vak && links.getAttribute('aria-label') === 'Zoeken' && [...dC.querySelectorAll('#doenLijst .actierij')].length === 2);
  }

  /* 5n. Tags: # in een zoekvak toont de tags; kiezen zoekt op de tag; # voegt niets toe. Winkel met notitie en link. */
  if (deel('5n Tags: # in een zoekvak toont de tags; kiezen zoekt op de tag; # voegt niets toe.')) {
    const odD = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Gamma\nwinkel;Plus\nartikel;Kaarsen;notitie=voor #kerst;op=2026-11-20T10:00\nartikel;Lampjes #kerst;notitie=#buiten;op=2026-11-20T10:00\nartikel;Melk;op=2026-11-20T10:00\n');
    const wD = await start(odD);
    await rust(800);
    const dD = wD.document;
    const vak = dD.getElementById('invoerTekst');
    vak.focus(); vak.value = '#'; vak.dispatchEvent(new wD.Event('input')); await slaap(20);
    const opties = () => [...dD.querySelectorAll('#tagLijst .tagoptie')].map((b) => b.textContent).join(',');
    controle('tags: # toont de tags uit de notities (niet uit namen), met aantal', !dD.getElementById('tagLijst').hidden && opties() === '#buiten1,#kerst1', opties());
    vak.value = '#k'; vak.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('tags: verder typen filtert', opties() === '#kerst1', opties());
    vak.value = ' # k'; vak.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('tags: ook met een spatie ervoor en na de # (" # k")', !dD.getElementById('tagLijst').hidden && opties() === '#kerst1', opties());
    vak.value = '#k'; vak.dispatchEvent(new wD.Event('input')); await slaap(20);
    dD.querySelector('#tagLijst .tagoptie').click(); await slaap(20);
    controle('tags: kiezen zet #kerst in het vak, sluit de lijst, toont alleen wat de tag heeft (vet)', vak.value === '#kerst' && dD.getElementById('tagLijst').hidden
      && namenInLijst(wD).join() === 'Kaarsen' && dD.querySelector('#lijst .notitie .tag').textContent === '#kerst', namenInLijst(wD).join());
    const voor = R(odD.bestanden['thuis.json'].tekst);
    dD.getElementById('invoerPlus').click(); await rust(1800);
    controle('tags: + met een # vooraan maakt geen artikel', !/^artikel;#kerst/m.test(R(odD.bestanden['thuis.json'].tekst)) && !wD.eval("artikelen.some((a) => a.naam === '#kerst')"));
    vak.value = ''; vak.dispatchEvent(new wD.Event('input')); vak.blur();
    dD.getElementById('tab-winkels').click(); await slaap(50);
    [...dD.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma')).click(); await slaap(30);
    dD.querySelector('#winkelDetail .bewerk').click(); await slaap(20);
    const k = dD.getElementById('keuze');
    controle('winkel bewerken: Naam, Notitie en Link', !!k.querySelector('#bewerkNotitie') && k.querySelector('#bewerkLink').placeholder === 'Link of zoekwoorden');
    k.querySelector('#bewerkLink').value = 'http://gamma.nl'; k.querySelector('.knop').click(); await slaap(20);
    controle('winkel bewerken: onveilige link geweigerd, paneel blijft', !!dD.getElementById('keuze') && !!dD.querySelector('#keuze .paneelmeldingen .melding') && /https:\/\//.test(dD.querySelector('#keuze .paneelmeldingen').textContent));
    k.querySelector('#bewerkNotitie').value = 'za tot 17:00 #klussen'; k.querySelector('#bewerkLink').value = 'gamma.nl/openingstijden'; k.querySelector('.knop').click(); await slaap(30);
    dD.querySelector('#winkelDetail .terug').click(); await slaap(30);
    const gr = [...dD.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma'));
    const rg = (el) => [...el.children].map((c) => [...c.childNodes].map((x) => x.textContent).join('+')).join(' / ');
    controle('winkel: notitie, daaronder tags en link', !!gr.querySelector('.notitie') && rg(gr.querySelector('.notitie')) === 'za tot 17:00 / #klussen+gamma.nl ↗', gr && rg(gr.querySelector('.notitie')));
    const wv = dD.getElementById('winkelsTekst');
    wv.focus(); wv.value = '#kl'; wv.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('winkels: zoeken op een tag', [...dD.querySelectorAll('#winkelsOverzicht .winkelrij .nm')].map((x) => x.firstChild.textContent).join() === 'Gamma' && opties() === '#klussen1', opties());
    wv.blur();
    await rust(2500);
    controle('winkel: notitie en link in het bestand', /^winkel;Gamma;notitie=za tot 17:00 #klussen;link=https:\/\/gamma\.nl\/openingstijden$/m.test(R(odD.bestanden['thuis.json'].tekst)), R(odD.bestanden['thuis.json'].tekst));
    dD.getElementById('tab-boodschappen').click(); await slaap(30);
    [...dD.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Melk')).querySelector('.tekst').click(); await slaap(30);
    const nt = dD.getElementById('artikelNotitie');
    nt.focus(); nt.value = 'halfvol #'; nt.setSelectionRange(9, 9); nt.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('notitie: # toont alle tags (artikelen, winkels, acties)', !dD.getElementById('tagLijst').hidden && opties() === '#buiten1,#kerst1,#klussen1', opties());
    nt.value = 'halfvol #ke en vers'; nt.setSelectionRange(11, 11); nt.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('notitie: woord vóór de cursor filtert', opties() === '#kerst1', opties());
    dD.querySelector('#tagLijst .tagoptie').click(); await slaap(20);
    controle('notitie: kiezen maakt het woord af met een spatie, cursor erachter, vak blijft actief', nt.value === 'halfvol #kerst en vers' && nt.selectionStart === 15 && dD.activeElement === nt && dD.getElementById('tagLijst').hidden, JSON.stringify(nt.value) + nt.selectionStart);
    nt.value = 'halfvol'; nt.setSelectionRange(7, 7); nt.dispatchEvent(new wD.Event('input')); await slaap(20);
    controle('notitie: zonder # geen lijst', dD.getElementById('tagLijst').hidden);
    nt.blur(); dD.getElementById('artikelOpslaan').click(); await slaap(30);
  }

  /* 5z. H1: een kopie van een ouder formaat gaat weg, de wachtrij niet. */
  if (deel('5z H1: een kopie van een ouder formaat gaat weg, de wachtrij niet.')) {
    const odF = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const wF = await start(odF, {
      kopie: { formaat: '1352901-000', tekst: '{}', eTag: '"oud"', fileId: 'id-thuis.json' },
      wachtrij: [{ actie: 'nieuw', soort: 'artikel', id: 'pnd01', velden: { naam: 'Pindakaas', soort: 'eenmalig', op: '2026-11-23T09:00', opdoor: 'Testspeler' }, t: '2026-11-23T09:00', wie: 'Testspeler' },
                 { actie: 'zet', soort: 'artikel', id: 'bestaatniet', veld: 'notitie', oud: '', nieuw: 'x', t: '2026-11-23T09:00', wie: 'Testspeler' }]
    });
    await rust(2500);
    controle('formaatwissel: wachtrij blijft en wordt verstuurd (H1)', /Pindakaas/.test(R(odF.bestanden['thuis.json'].tekst)), R(odF.bestanden['thuis.json'].tekst));
    controle('formaatwissel: wat niet meer past, vervalt met een melding', [...wF.document.querySelectorAll('#meldingen .melding')].some((m) => /Niet doorgevoerd/.test(m.textContent)));
  }

  /* 5z2. M1: klok verdacht volgens de servertijd → wel schrijven, geen dagbackup (die ruimt op met de datum van de telefoon). */
  if (deel('5z2 M1: klok verdacht volgens de servertijd → wel schrijven, geen dagbackup (die rui')) {
    const odK = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    odK.serverNu = new Date(Date.now() - 90 * 864e5).toISOString();
    odK.zet('thuis.json', odK.bestanden['thuis.json'].tekst);
    odK.zet('thuis_backup_20200101.json', '{}');
    const wK = await start(odK);
    await rust(800);
    wK.eval("handelen([{ actie: 'nieuw', soort: 'artikel', id: 'kaa01', velden: { naam: 'Kaas', soort: 'eenmalig' } }])");
    await rust(2500);
    const backups = Object.keys(odK.bestanden).filter((n) => /^thuis_backup_/.test(n));
    controle('klok verdacht (servertijd): wijziging opgeslagen, geen dagbackup en niets opgeruimd (M1)', /Kaas/.test(R(odK.bestanden['thuis.json'].tekst)) && backups.join() === 'thuis_backup_20200101.json'
      && [...wK.document.querySelectorAll('#meldingen .melding')].some((m) => /datum van deze telefoon/.test(m.textContent)), backups.join());
  }

  /* 5z3. M3: twee vensters (PWA en browsertab) op dezelfde opslag: het venster dat in beeld komt, leest de wachtrij opnieuw. */
  if (deel('5z3 M3: twee vensters (PWA en browsertab) op dezelfde opslag: het venster dat in bee')) {
    const odV = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const echt = odV.fetch; let offline = false;
    odV.fetch = async (u, i) => { if (offline) throw new TypeError('Failed to fetch'); return echt(u, i); };
    const idbV = new (require('fake-indexeddb').IDBFactory)();
    const voeg = async (w, n) => { const i = w.document.getElementById('invoerTekst'); i.value = n; i.dispatchEvent(new w.Event('input')); w.document.getElementById('invoerPlus').click(); await slaap(300); };
    const A = await start(odV, null, idbV); await slaap(600);
    offline = true;
    await voeg(A, 'Appels');
    const Bv = await start(odV, null, idbV); await slaap(600);
    await voeg(A, 'Peren');
    Bv.document.dispatchEvent(new Bv.Event('visibilitychange')); await slaap(300);
    await voeg(Bv, 'Kaas');
    await slaap(500);
    A.close(); Bv.close();
    offline = false;
    const Cv = await start(odV, null, idbV); await rust(2500);
    const namen = R(odV.bestanden['thuis.json'].tekst).split('\n').filter((x) => x.startsWith('artikel')).map((x) => x.split(';')[1]).sort().join();
    controle('twee vensters: niets kwijt als het andere venster in beeld komt (M3)', namen === 'Appels,Kaas,Melk,Peren', namen);
    Cv.close();
  }

  /* 5z4. M6: geen toegang meer tot de map is iets anders dan een verdwenen bestand. */
  if (deel('5z4 M6: geen toegang meer tot de map is iets anders dan een verdwenen bestand.')) {
    const odT = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const wT = await start(odT); await rust(800);
    odT.geenToegang = true;
    wT.eval('planSync(0)'); await rust(800);
    const dT = wT.document;
    const mT = dT.getElementById('m-toegang');
    controle('geen toegang: eigen melding met Andere map koppelen, geen Leeg beginnen; lijst blijft (M6)', !!mT && /Andere map koppelen/.test(mT.textContent) && !dT.getElementById('m-weg') && wT.eval("artikelen.some((a) => a.naam === 'Melk')"), mT ? mT.textContent : 'geen melding');
    const knopT = mT && [...mT.querySelectorAll('button')].find((b) => /Andere map/.test(b.textContent));
    if (knopT) knopT.click(); await slaap(100);
    controle('geen toegang: Andere map koppelen opent Instellingen met het deellinkvak', !dT.getElementById('scherm-instellingen').hidden && !dT.getElementById('mapVeld').hidden);
    wT.close();
  }

  /* 5z5. M7: "nieuw" blijft staan als je op een ander tabblad was. */
  if (deel('5z5 M7: "nieuw" blijft staan als je op een ander tabblad was.')) {
    const odN = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks;op=2026-11-14T06:00\n');
    const wN = await start(odN); await rust(800);
    const dN = wN.document;
    dN.getElementById('tab-doen').click();
    const j = JSON.parse(odN.bestanden['thuis.json'].tekst); j.artikelen.brd01 = { naam: 'Brood', soort: 'eenmalig', op: '2026-11-23T09:00', opdoor: 'Natasja' };
    odN.zet('thuis.json', JSON.stringify(j));
    wN.eval('planSync(0)'); await rust(800);
    Object.defineProperty(dN, 'hidden', { configurable: true, get: () => true }); dN.dispatchEvent(new wN.Event('visibilitychange'));
    Object.defineProperty(dN, 'hidden', { configurable: true, get: () => false }); dN.dispatchEvent(new wN.Event('visibilitychange'));
    await rust(800);
    dN.getElementById('tab-instellingen').click();
    dN.getElementById('tab-boodschappen').click();
    const rij = [...dN.querySelectorAll('#lijst .item')].find((r) => /Brood/.test(r.textContent));
    controle('nieuw: blijft staan na terugkomen op een ander tabblad (M7)', !!rij && !!rij.querySelector('.nieuw'), rij ? rij.textContent : 'geen Brood');
    wN.close();
  }

  /* 5z6. M8: bewerkschermen na samenvoegen of verwijderen door de ander. */
  if (deel('5z6 M8: bewerkschermen na samenvoegen of verwijderen door de ander.')) {
    const odM = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus;route=Koeling\nartikel;Kaas;soort=eenmalig\n');
    const echt = odM.fetch; let offline = false;
    odM.fetch = async (u, i) => { if (offline) throw new TypeError('Failed to fetch'); return echt(u, i); };
    const wM = await start(odM); await rust(800); const dM = wM.document;
    offline = true;
    const iM = dM.getElementById('invoerTekst'); iM.value = 'Melk'; iM.dispatchEvent(new wM.Event('input')); dM.getElementById('invoerPlus').click(); await slaap(300);
    const lokaal = wM.eval("artikelen.find((a) => a.naam === 'Melk').id");
    const j = JSON.parse(odM.bestanden['thuis.json'].tekst); j.artikelen.mlk99 = { naam: 'Melk', soort: 'eenmalig', notitie: 'van Natasja', op: '2026-11-23T08:00', opdoor: 'Natasja' }; odM.zet('thuis.json', JSON.stringify(j));
    wM.eval("artikelOpenen('" + lokaal + "')");
    const lk = dM.getElementById('artikelLink'); lk.value = 'https://ah.nl/melk'; lk.dispatchEvent(new wM.Event('input'));
    offline = false; wM.eval('planSync(0)'); await slaap(1500);
    dM.getElementById('artikelOpslaan').click(); await rust(2500);
    const melk = R(odM.bestanden['thuis.json'].tekst).split('\n').filter((x) => /^artikel;Melk;/.test(x)).join(' / ');
    const meld = [...dM.querySelectorAll('#meldingen .melding')].map((m) => m.textContent).join(' | ');
    controle('samenvoegen tijdens bewerken: link opgeslagen bij het bestaande, notitie van de ander blijft, geen "iets" (M8)', /link=https:\/\/ah\.nl\/melk/.test(melk) && /notitie=van Natasja/.test(melk) && !/iets/.test(meld), melk + ' || ' + meld);
    /* Winkel bewerken terwijl de ander hem verwijdert. */
    dM.getElementById('tab-winkels').click(); await slaap(50);
    const wid = wM.eval("winkels.find((x) => x.naam === 'Plus').id");
    wM.eval("winkelOpenen('" + wid + "')"); dM.querySelector('#winkelDetail .bewerk').click();
    const nt = dM.getElementById('bewerkNotitie'); nt.value = 'open tot 22 uur'; nt.dispatchEvent(new wM.Event('input'));
    const j2 = JSON.parse(odM.bestanden['thuis.json'].tekst); delete j2.winkels[wid]; odM.zet('thuis.json', JSON.stringify(j2));
    wM.eval('planSync(0)'); await slaap(1000);
    dM.querySelector('#keuze .bewerkknoppen .knop').click(); await slaap(300);
    const mW = dM.getElementById('m-weg-' + wid);
    controle('winkel bewerken na verwijderen: paneel dicht, melding met Terugzetten (M8)', !dM.getElementById('keuze') && !!mW && /Plus is intussen verwijderd/.test(mW.textContent));
    [...mW.querySelectorAll('button')].find((b) => b.textContent === 'Terugzetten').click(); await rust(2500);
    controle('winkel terugzetten: met de notitie die je typte', /^winkel;Plus;[^\n]*notitie=open tot 22 uur/m.test(R(odM.bestanden['thuis.json'].tekst)), R(odM.bestanden['thuis.json'].tekst));
    wM.close();
  }

  /* 5z7. L3: archief korter bewaren vraagt eerst, met het aantal. */
  if (deel('5z7 L3: archief korter bewaren vraagt eerst, met het aantal.')) {
    const oud = datumTekstT(-20);
    const odA2 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Lampje;soort=eenmalig;gekocht=' + oud + '\nartikel;Kaars;soort=eenmalig;gekocht=' + datumTekstT(-2) + '\n');
    const wA2 = await start(odA2); await rust(800); const dA2 = wA2.document;
    dA2.getElementById('tab-instellingen').click(); await slaap(50);
    [...dA2.querySelectorAll('#archiefBewaren button')].find((b) => b.textContent === '1 week').click(); await slaap(50);
    const v = dA2.getElementById('keuze');
    controle('archief korter: eerst de vraag met het aantal (L3)', !!v && /1 artikel uit het archief verwijderen\?/.test(v.textContent), v ? v.textContent : 'geen vraag');
    v.querySelector('.knop.tweede').click(); await rust(2500);
    controle('archief korter, Annuleren: niets veranderd', !/archief/.test(R(odA2.bestanden['thuis.json'].tekst)) && /Lampje/.test(R(odA2.bestanden['thuis.json'].tekst)));
    wA2.close();
  }

  /* 5z8. L4: ?error= alleen bij een eigen aanmeldpoging met de juiste state. */
  if (deel('5z8 L4: ?error= alleen bij een eigen aanmeldpoging met de juiste state.')) {
    const odE2 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const wE2 = await start(odE2, { pkce: { verifier: 'v', state: 'echt1', t: Date.now() } }, null, 'https://mv-systems-apps.github.io/thuis/thuis.html?error=Bel+0612345678&state=nep');
    await slaap(300);
    controle('aanmeldfout zonder juiste state: stil genegeerd (L4)', !wE2.document.getElementById('m-aanmelden'));
    wE2.close();
    const wE3 = await start(odE2, { pkce: { verifier: 'v', state: 'echt1', t: Date.now() } }, null, 'https://mv-systems-apps.github.io/thuis/thuis.html?error=server_error&state=echt1');
    await slaap(300);
    const mE3 = wE3.document.getElementById('m-aanmelden');
    controle('aanmeldfout van de eigen poging: melding met de foutcode', !!mE3 && /server_error/.test(mE3.textContent));
    wE3.close();
  }

  /* 5z9. L5: Leeg beginnen wist ook de wachtrij en toont meteen de lege lijst. */
  if (deel('5z9 L5: Leeg beginnen wist ook de wachtrij en toont meteen de lege lijst.')) {
    const odL5 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;op=2026-11-20T10:00\n');
    const wL5 = await start(odL5); await rust(800); const dL5 = wL5.document;
    delete odL5.bestanden['thuis.json'];
    wL5.eval("handelen([{ actie: 'nieuw', soort: 'artikel', id: 'kaa01', velden: { naam: 'Kaas', soort: 'eenmalig' } }])");
    await rust(2500);
    [...dL5.getElementById('m-weg').querySelectorAll('button')].find((b) => b.textContent === 'Leeg beginnen').click(); await slaap(20);
    const vL5 = dL5.getElementById('keuze');
    controle('leeg beginnen: de vraag noemt de wachtende wijziging (L5)', !!vL5 && /ook 1 wijziging die nog niet is opgeslagen/.test(vL5.textContent), vL5 && vL5.textContent);
    [...vL5.querySelectorAll('.knop')].find((b) => b.textContent === 'Leeg beginnen').click(); await slaap(100);
    controle('leeg beginnen: meteen een lege lijst, wachtrij leeg', wL5.eval('artikelen.length') === 0 && wL5.eval('wachtrij.length') === 0);
    await rust(2500);
    controle('leeg beginnen: nieuw leeg bestand, zonder Kaas', !!odL5.bestanden['thuis.json'] && !/Kaas|Melk/.test(R(odL5.bestanden['thuis.json'].tekst)), odL5.bestanden['thuis.json'] ? R(odL5.bestanden['thuis.json'].tekst) : 'geen bestand');
    wL5.close();
  }

  /* 5z10. L8: een ronde zonder verandering rekent niets uit. */
  if (deel('5z10 L8: een ronde zonder verandering rekent niets uit.')) {
    const odR = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const wR = await start(odR); await rust(800);
    wR.eval('planSync(0)'); await slaap(400);
    wR.eval('window.__rondes = 0; const echteSync = synchroniseer; synchroniseer = function () { window.__rondes++; return echteSync.apply(this, arguments); };');
    wR.eval('planSync(0)'); await slaap(400);
    const na1 = wR.eval('window.__rondes');
    const j = JSON.parse(odR.bestanden['thuis.json'].tekst); j.artikelen.brd01 = { naam: 'Brood', soort: 'eenmalig' }; odR.zet('thuis.json', JSON.stringify(j));
    wR.eval('planSync(0)'); await slaap(400);
    const na2 = wR.eval('window.__rondes');
    controle('ronde zonder verandering: overgeslagen; bij een gewijzigd bestand wel (L8)', na1 === 0 && na2 === 1 && wR.eval("artikelen.some((a) => a.naam === 'Brood')"), na1 + ' ' + na2);
    wR.close();
  }

  /* 5z11. Historie: afronden komt in de gedeelde historie; een regel weggooien vraagt eerst. */
  if (deel('5z11 Historie: afronden komt in de gedeelde historie; een regel weggooien vraagt eers')) {
    const odH = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nactie;Afval;datum=2026-11-28;herhaal=week\nactie;Bellen\n');
    const wH2 = await start(odH); await rust(800); const dH2 = wH2.document;
    dH2.getElementById('tab-doen').click(); await slaap(30);
    wH2.eval("doen.filter = 'alles'; tekenDoen()");
    const rondje = (n) => [...dH2.querySelectorAll('#doenLijst .actierij')].find((r) => r.textContent.includes(n)).querySelector('.rondje');
    rondje('Afval').click(); rondje('Bellen').click(); await rust(2600);
    const tH = R(odH.bestanden['thuis.json'].tekst);
    controle('historie: afronden (ook herhalend) staat in het bestand, naam en tijd', (tH.match(/^historie;(Afval|Bellen);tijd=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/gm) || []).length === 2, tH);
    const kop = [...dH2.querySelectorAll('#doenLijst .naaraankopen')].find((k) => /Historie/.test(k.textContent));
    controle('historie: kop onderaan Doen met het aantal', !!kop && /2/.test(kop.textContent));
    kop.querySelector('button').click(); await slaap(50);
    const hs = dH2.getElementById('historieScherm');
    controle('historie: zonder tijdstip', !dH2.querySelector('#historieScherm .aankooprij .tijd'));
    controle('historie: scherm met de regels, zoekbalk onderaan, Doen-balk weg', !hs.hidden && hs.querySelectorAll('.aankooprij').length === 2 && !dH2.getElementById('balk-log').hidden && dH2.getElementById('balk-doen').hidden);
    [...hs.querySelectorAll('.aankooprij')].find((r) => /Bellen/.test(r.textContent)).click(); await slaap(20);
    const vH = dH2.getElementById('keuze');
    controle('historie: tik op een regel vraagt eerst', !!vH && /Bellen/.test(vH.textContent) && /Verwijderen/.test(vH.textContent));
    [...vH.querySelectorAll('.knop')].find((b) => b.textContent === 'Verwijderen').click(); await rust(2600);
    controle('historie: regel weg bij allebei, zonder Ongedaan maken', !/^historie;Bellen/m.test(R(odH.bestanden['thuis.json'].tekst)) && /^historie;Afval/m.test(R(odH.bestanden['thuis.json'].tekst)) && hs.querySelectorAll('.aankooprij').length === 1);
    hs.querySelector('.terug').click(); await slaap(30);
    controle('historie: terug naar Doen, balken goed', hs.hidden && !dH2.getElementById('balk-doen').hidden && dH2.getElementById('balk-log').hidden);
    wH2.close();
  }

  /* 5z12. L12: afmelden wist alles van deze telefoon. */
  if (deel('5z12 L12: afmelden wist alles van deze telefoon.')) {
    const odU = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;op=2026-11-20T10:00\n');
    const wU = await start(odU, { mandje: [{ id: 'x1234', naam: 'Kaas' }], favorieten: ['abc12'], doenStandaard: 'maand', logboek: ['2026-11-23 10:00 · test'] });
    await rust(800);
    wU.eval('sync.bezig = true; afmelden()'); await slaap(50);
    controle('afmelden tijdens een sync: eerst even geduld, niets gewist (L2 ronde 4)', /Even geduld/.test((wU.document.getElementById('m-afmelden') || {}).textContent || '') && !!(await wU.eval("kvLees('auth')")));
    wU.eval('sync.bezig = false; afmelden()'); await slaap(300);
    const over = await wU.eval("(async () => { const uit = []; for (const k of ALLE_SLEUTELS) if (await kvLees(k) !== null) uit.push(k); return uit.join(); })()");
    controle('afmelden: alle sleutels weg, ook mandje, favorieten en logboek (L12)', over === '' && wU.eval('winkel.mandje.size') === 0 && wU.eval('doen.standaard') === 'week', over);
    wU.close();
  }

  /* 5z13. H1 ronde 4: terugzetten met een verdachte klok weigert; backups blijven. */
  if (deel('5z13 H1 ronde 4: terugzetten met een verdachte klok weigert; backups blijven.')) {
    const odZ = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk\n');
    odZ.zet('thuis_backup_20261101.json', odZ.bestanden['thuis.json'].tekst);
    /* De klok van de telefoon loopt ruim een jaar voor: de server geeft steeds een tijd van 400 dagen eerder. */
    odZ.serverNu = new Date(Date.now() - 400 * 864e5).toISOString();
    odZ.zet('thuis.json', odZ.bestanden['thuis.json'].tekst);
    const wZ = await start(odZ); await rust(2500);
    const ok = await wZ.eval("terugzetten(" + JSON.stringify(odZ.bestanden['thuis_backup_20261101.json'].tekst) + ", true)");
    const mZ = wZ.document.getElementById('m-terug');
    controle('terugzetten met verdachte klok: geweigerd, backups blijven (H1 ronde 4)', ok === false && !!mZ && /datum van deze telefoon/.test(mZ.textContent) && !!odZ.bestanden['thuis_backup_20261101.json'] && !odZ.bestanden['thuis_voor_terugzetten.json'], mZ ? mZ.textContent : '');
    wZ.close();
  }

  /* 5z14. M1 ronde 4: actie- en winkeleditor draaien een wijziging van de ander niet terug. */
  if (deel('5z14 M1 ronde 4: actie- en winkeleditor draaien een wijziging van de ander niet terug')) {
    const d = (n) => datumTekstT(n);
    const odP = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Gamma\nactie;Filter;datum=' + d(-1) + ';herhaal=week\n');
    const wP = await start(odP); await rust(800); const dP = wP.document;
    const aid = wP.eval("acties.find((a) => a.naam === 'Filter').id");
    dP.getElementById('tab-doen').click(); await slaap(50);
    wP.eval("actieOpenen('" + aid + "')");
    const nt = dP.getElementById('actieNotitie'); nt.value = 'grote maat'; nt.dispatchEvent(new wP.Event('input'));
    const j = JSON.parse(odP.bestanden['thuis.json'].tekst); j.acties[aid].datum = d(6); j.acties[aid].klaar = d(0) + 'T09:00'; odP.zet('thuis.json', JSON.stringify(j));
    wP.eval('planSync(0)'); await slaap(1200);
    dP.getElementById('actieOpslaan').click(); await rust(2500);
    const regel = R(odP.bestanden['thuis.json'].tekst).split('\n').find((x) => x.startsWith('actie;Filter'));
    controle('actie-editor: alleen mijn notitie, de nieuwe datum van de ander blijft (M1 ronde 4)', regel.includes('datum=' + d(6)) && regel.includes('notitie=grote maat'), regel);
    dP.getElementById('tab-winkels').click(); await slaap(50);
    const wid = wP.eval("winkels.find((x) => x.naam === 'Gamma').id");
    wP.eval("winkelOpenen('" + wid + "')"); await slaap(50);
    dP.querySelector('#winkelDetail .bewerk').click(); await slaap(50);
    const j2 = JSON.parse(odP.bestanden['thuis.json'].tekst); j2.winkels[wid].notitie = 'za tot 17:00'; odP.zet('thuis.json', JSON.stringify(j2));
    wP.eval('planSync(0)'); await slaap(1200);
    dP.getElementById('bewerkNaam').value = 'Gamma Arnhem';
    dP.querySelector('#keuze .knop').click(); await rust(2500);
    const wr = R(odP.bestanden['thuis.json'].tekst).split('\n').find((x) => x.startsWith('winkel;'));
    controle('winkel-editor: alleen de naam, de notitie van de ander blijft', /^winkel;Gamma Arnhem;.*notitie=za tot 17:00/.test(wr), wr);
    wP.close();
  }

  /* 5z15. M2 ronde 4: bestand opnieuw aangemaakt met een nieuwe id → gewoon verder, geen "weg". */
  if (deel('5z15 M2 ronde 4: bestand opnieuw aangemaakt met een nieuwe id → gewoon verder, geen "')) {
    const odI = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk\n');
    const wI = await start(odI); await rust(800);
    const tekstI = odI.bestanden['thuis.json'].tekst;
    odI.nieuweIds = true; delete odI.bestanden['thuis.json']; odI.zet('thuis.json', tekstI.replace('"Melk"', '"Melk"').replace('"artikelen": {', '"artikelen": {\n "brd01": {"naam":"Brood","soort":"eenmalig"},'));
    wI.eval('planSync(0)'); await slaap(1000);
    controle('nieuwe id: geen melding "weg", nieuwe inhoud binnen (M2 ronde 4)', !wI.document.getElementById('m-weg') && wI.eval("artikelen.some((a) => a.naam === 'Brood')") && wI.eval('kopie.fileId') === odI.bestanden['thuis.json'].id);
    const mO = wI.document.getElementById('m-opnieuw');
    controle('nieuwe id: wel een melding "opnieuw aangemaakt" met Backups (M2 data)', !!mO && /opnieuw aangemaakt/.test(mO.textContent) && /Backups/.test(mO.textContent));
    wI.close();
  }

  /* 5z16. M3 ronde 4: na lang niet gebruiken één keer peilen; daarna gewoon (geen melding, wekelijks terug). */
  if (deel('5z16 M3 ronde 4: na lang niet gebruiken één keer peilen; daarna gewoon (geen melding,')) {
    const odV2 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=' + datumTekstT(-40) + 'T06:00\nartikel;Melk;soort=wekelijks;gekocht=' + datumTekstT(-40) + '\n');
    odV2.serverNu = new Date(Date.now() - 40 * 864e5).toISOString();
    odV2.zet('thuis.json', odV2.bestanden['thuis.json'].tekst);
    odV2.serverNu = undefined;
    const wV2 = await start(odV2); await rust(2500);
    controle('lang niet gebruikt: na één peiling geen klokmelding en wekelijks terug (M3 ronde 4)', !wV2.document.getElementById('m-klok') && /^artikel;Melk;[^\n]*op=/m.test(R(odV2.bestanden['thuis.json'].tekst)), R(odV2.bestanden['thuis.json'].tekst));
    wV2.close();
  }

  /* 5z17. Welke winkel? zonder iets nodig: toch een kop boven de overige winkels. */
  if (deel('5z17 Waar ga je heen? zonder iets nodig: toch een kop boven de overige winkels.')) {
    const odW = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nwinkel;Lidl\nartikel;Hhh;op=2026-11-20T10:00\n');
    const wW = await start(odW); await rust(800);
    wW.eval("winkel.id = winkels.find((w) => w.naam === 'Plus').id");
    wW.document.getElementById('tab-winkel').click(); await slaap(30);
    wW.eval('winkelKiezen()');
    const kop = wW.document.querySelector('#keuze').textContent;
    controle('welke winkel, niets nodig: kop Overige winkels onder Huidig', /Huidig/.test(kop) && /Overige winkels/.test(kop), kop);
    const kz = wW.document.getElementById('keuze');
    controle('titel "Welke winkel?"; ook overige winkels met het winkelsymbool', /Welke winkel\?/.test(kz.querySelector('.kop').textContent) && [...kz.querySelectorAll('.optie')].every((o) => !!o.querySelector('svg')), kz.innerHTML.slice(0, 200));
    wW.close();
    /* Veel artikelen alleen hier: een telling in plaats van namen. */
    const odV = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nwinkel;AH\n' +
      ['Aa', 'Bb', 'Cc'].map((n) => 'artikel;' + n + ';ligt=Plus;op=2026-11-20T10:00\n').join('') + 'artikel;Dd;ligt=Plus|AH;op=2026-11-20T10:00\nartikel;Ee;ligt=AH;op=2026-11-20T10:00\n');
    const wV = await start(odV); await rust(800);
    wV.eval("winkel.id = ''"); wV.eval('winkelKiezen()');
    const sub = (n) => { const o = [...wV.document.querySelectorAll('#keuze .optie')].find((x) => x.textContent.startsWith(n)); return o && o.querySelector('.sub') ? o.querySelector('.sub').textContent : ''; };
    controle('drie of meer alleen hier: "3 alleen hier"; één: de naam', sub('Plus') === '3 alleen hier' && sub('AH') === 'Ee', sub('Plus') + ' | ' + sub('AH'));
    wV.close();
  }

  /* 5z18. M5 ronde 4: herhalen uitzetten bij een eerder afgeronde actie → blijft open. */
  if (deel('5z18 M5 ronde 4: herhalen uitzetten bij een eerder afgeronde actie → blijft open.')) {
    const odH5 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nactie;Filter;datum=' + datumTekstT(7) + ';herhaal=week;klaar=' + datumTekstT(-1) + 'T09:00\n');
    const wH5 = await start(odH5); await rust(800);
    const aid = wH5.eval("acties[0].id");
    wH5.document.getElementById('tab-doen').click(); await slaap(30);
    wH5.eval("actieOpenen('" + aid + "')");
    [...wH5.document.querySelectorAll('#herhaalSoort button')].find((b) => b.textContent === 'Nee').click();
    wH5.document.getElementById('actieOpslaan').click(); await slaap(100);
    controle('herhalen uit bij een eerder afgeronde actie: blijft open (M5 ronde 4)', wH5.eval("acties[0].open") === true && !wH5.eval("acties[0].herhaal"));
    wH5.close();
  }

  /* 5z19. L3 ronde 4: venster op de achtergrond overschrijft de wachtrij van het andere niet. */
  if (deel('5z19 L3 ronde 4: venster op de achtergrond overschrijft de wachtrij van het andere ni')) {
    const odL3 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const idbL3 = new (require('fake-indexeddb').IDBFactory)();
    const voeg = (w, n) => { const i = w.document.getElementById('invoerTekst'); i.value = n; i.dispatchEvent(new w.Event('input')); w.document.getElementById('invoerPlus').click(); };
    const A = await start(odL3, null, idbL3); const Bw = await start(odL3, null, idbL3); await slaap(1500);
    voeg(A, 'Appels'); await slaap(100);
    Bw.document.dispatchEvent(new Bw.Event('visibilitychange')); await slaap(100);
    voeg(Bw, 'Kaas'); await slaap(1450);
    Bw.close(); A.close();
    const C = await start(odL3, null, idbL3); await rust(2500);
    const namen = R(odL3.bestanden['thuis.json'].tekst).split('\n').filter((x) => x.startsWith('artikel')).map((x) => x.split(';')[1]).sort().join();
    controle('twee vensters: de ronde van het achtergrondvenster laat de wachtrij van het andere staan (L3 ronde 4)', namen === 'Appels,Kaas,Melk', namen);
    C.close();
  }

  /* 5z20. M1 data: eerste keer koppelen neemt de wachtrij mee. */
  if (deel('5z20 M1 data: eerste keer koppelen neemt de wachtrij mee.')) {
    const odK1 = onedrive('artikel;Koffie;soort=regelmatig\n');
    const echtK1 = odK1.fetch;
    odK1.fetch = async (url, init) => url.includes('/shares/') ? { ok: true, status: 200, json: async () => ({ id: 'MAP', name: 'thuis', folder: {}, parentReference: { driveId: 'D' } }) } : echtK1(url, init);
    const wK1 = await start(odK1, { map: null }); await slaap(300);
    wK1.eval("handelen([{ actie: 'nieuw', soort: 'artikel', id: 'brd01', velden: { naam: 'Brood', soort: 'eenmalig', op: '2026-11-23T10:00' } }])"); await slaap(100);
    wK1.document.getElementById('deellink').value = 'https://1drv.ms/f/s!voorbeeld';
    await wK1.eval('mapKoppelen(false)'); await rust(2500);
    controle('eerste keer koppelen: geen vraag, wat je al deed staat in het bestand (M1 data)', !wK1.document.getElementById('m-koppelen') && /^artikel;Brood;/m.test(R(odK1.bestanden['thuis.json'].tekst)), R(odK1.bestanden['thuis.json'].tekst));
    wK1.close();
  }

  /* 5z21. M3 data: beschadigd bestand met een wachtende wijziging → Backups-knop, terugzetten mag, wijziging komt mee. */
  if (deel('5z21 M3 data: beschadigd bestand met een wachtende wijziging → Backups-knop, terugzet')) {
    const odB3 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Koffie;soort=regelmatig\n');
    odB3.zet('thuis_backup_20261122.json', J('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Koffie;soort=regelmatig\nartikel;Thee;soort=regelmatig\n'));
    const wB3 = await start(odB3); await slaap(1500);
    odB3.zet('thuis.json', '{"versie": "kapot');
    wB3.eval("handelen([{ actie: 'nieuw', soort: 'artikel', id: 'brd01', velden: { naam: 'Brood', soort: 'eenmalig', op: '2026-11-23T10:00' } }])"); await rust(2500);
    const mB = wB3.document.getElementById('m-bestand');
    controle('beschadigd bestand: melding met Backups (M3 data)', !!mB && /Backups/.test(mB.textContent));
    const ok = await wB3.eval('terugzetten(' + JSON.stringify(odB3.bestanden['thuis_backup_20261122.json'].tekst) + ', true)');
    await rust(2500);
    const tB3 = R(odB3.bestanden['thuis.json'].tekst);
    controle('beschadigd bestand: terugzetten lukt ondanks wachtende wijziging, die komt erbij', ok === true && /^artikel;Thee;/m.test(tB3) && /^artikel;Brood;/m.test(tB3) && wB3.eval('wachtrij.length') === 0, tB3);
    wB3.close();
  }

  /* 5z22. L3 data: naar de achtergrond met iets in de wachtrij → meteen versturen. */
  if (deel('5z22 L3 data: naar de achtergrond met iets in de wachtrij → meteen versturen.')) {
    const odA3 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const wA3 = await start(odA3); await rust(800);
    wA3.eval("handelen([{ actie: 'nieuw', soort: 'artikel', id: 'kaa01', velden: { naam: 'Kaas', soort: 'eenmalig' } }])");
    Object.defineProperty(wA3.document, 'hidden', { configurable: true, get: () => true }); wA3.document.dispatchEvent(new wA3.Event('visibilitychange'));
    await slaap(400);
    controle('naar de achtergrond: wachtrij meteen verstuurd (L3 data)', /^artikel;Kaas;/m.test(R(odA3.bestanden['thuis.json'].tekst)));
    wA3.close();
  }

  /* 5z23. H3 performance: na een eigen tik zonder iets van buiten niet opnieuw inlezen en tekenen. */
  if (deel('5z23 H3 performance: na een eigen tik zonder iets van buiten niet opnieuw inlezen en ')) {
    const odP3 = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;soort=wekelijks\n');
    const wP3 = await start(odP3); await slaap(1500);
    wP3.eval('window.__bouw = 0; const echtBouw = bouwModel; bouwModel = function () { window.__bouw++; return echtBouw.apply(this, arguments); };');
    wP3.eval("handelen([{ actie: 'zet', soort: 'artikel', id: artikelen[0].id, veld: 'notitie', oud: '', nieuw: 'halfvol' }])"); await rust(2500);
    const n1 = wP3.eval('window.__bouw');
    const j = JSON.parse(odP3.bestanden['thuis.json'].tekst); j.artikelen.brd01 = { naam: 'Brood', soort: 'eenmalig' }; odP3.zet('thuis.json', JSON.stringify(j));
    wP3.eval("handelen([{ actie: 'zet', soort: 'artikel', id: artikelen[0].id, veld: 'notitie', oud: 'halfvol', nieuw: 'vol' }])"); await rust(2500);
    controle('eigen tik zonder iets van buiten: niet opnieuw ingelezen; met iets van de ander wel (H3 perf)', n1 === 0 && wP3.eval('window.__bouw') === 1 && wP3.eval("artikelen.some((a) => a.naam === 'Brood')"), n1 + ' ' + wP3.eval('window.__bouw'));
    wP3.close();
  }

  /* 5o0. Openen met een lege lijst en een gekozen winkel: de winkelkop staat niet los onderaan. */
  if (deel('5o0 Openen met een lege lijst en een gekozen winkel: de winkelkop staat niet los ond')) {
    const odL = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;ligt=Plus\n');
    const wL = await start(odL);
    await rust(800);
    wL.eval("winkel.id = winkels[0].id");
    wL.document.getElementById('tab-winkel').click(); await slaap(30);
    controle('leeg bij openen: geen losse winkelkop (Plus) onderaan', !wL.document.getElementById('winkelKop') && /Geen artikelen/.test(wL.document.getElementById('winkelLijst').textContent));
  }

  /* 5o. Lege lijsten: overal dezelfde melding; bij Boodschappen dan geen winkel. */
  if (deel('5o Lege lijsten: overal dezelfde melding; bij Boodschappen dan geen winkel.')) {
    const odE = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;ligt=Plus;op=2026-11-20T10:00\n');
    const wE = await start(odE);
    await rust(800);
    const dE = wE.document;
    wE.eval("winkel.id = winkels[0].id");
    dE.getElementById('tab-winkel').click(); await slaap(30);
    const lijstE = dE.getElementById('winkelLijst');
    controle('leeg: eerst Melk bij de Plus', !!lijstE.querySelector('.winkelkaart') && /Melk/.test(lijstE.textContent));
    [...lijstE.querySelectorAll('.wrij .vink')].find((b) => b.textContent.includes('Melk')).click(); await rust(1800);
    controle('alleen het mandje over: geen lege winkelkaart, wel het mandje (dicht)', !lijstE.querySelector('.winkelkaart') && /Winkelmand/.test(lijstE.textContent) && !/Melk/.test(lijstE.textContent));
    wE.eval('winkel.mandjeOpen = true; tekenWinkel()');
    controle('mandje open: Melk zichtbaar', /Melk/.test(lijstE.textContent));
    lijstE.querySelector('.icoonknop.mandleeg').click(); await slaap(50);
    controle('leeg: Boodschappen zonder artikelen toont geen winkel, alleen "Geen artikelen"', !lijstE.querySelector('.winkelkaart') && lijstE.firstElementChild.textContent === 'Geen artikelen' && lijstE.firstElementChild.matches('.kaart.leegregel'), lijstE.innerHTML.slice(0, 200));
    controle('leeg: winkelkop niet los op het scherm', !dE.getElementById('winkelKop'));
    const mE = [...dE.querySelectorAll('#meldingen .melding')].find((m) => /Winkelmand leeggemaakt/.test(m.textContent));
    const vE = mE && mE.querySelector('.vinkknop[aria-label="Klaar"]');
    if (vE) vE.click();
    controle('melding met Ongedaan maken heeft rechts een vinkje; tikken sluit de melding', !!vE && !mE.isConnected);
    dE.getElementById('tab-boodschappen').click(); await slaap(20);
    dE.getElementById('invoerTekst').value = 'Kaas'; dE.getElementById('invoerPlus').click(); await slaap(50);
    dE.getElementById('tab-winkel').click(); await slaap(30);
    controle('leeg: alleen iets zonder winkel → kaart Winkel?, geen lege winkelkaart', !!lijstE.querySelector('.winkelkaart.zonder') && !dE.getElementById('winkelNaam') && /Kaas/.test(lijstE.textContent), lijstE.textContent);
    wE.eval("handelen([{ actie: 'zet', soort: 'artikel', id: artikelen.find((a) => a.naam === 'Melk').id, veld: 'op', oud: '', nieuw: '2026-11-23T10:00' }])"); await slaap(30);
    controle('leeg: komt er iets voor de winkel op de lijst, dan is de winkelkop er weer', !!lijstE.querySelector('.winkelkaart:not(.zonder)') && dE.getElementById('winkelNaam').textContent === 'Plus' && /Melk/.test(lijstE.textContent), lijstE.textContent);
    dE.getElementById('tab-doen').click(); await slaap(30);
    const doenE = dE.getElementById('doenLijst');
    controle('leeg: Doen in dezelfde stijl als Winkels, met daaronder Historie', doenE.firstElementChild.textContent === 'Geen acties' && doenE.firstElementChild.matches('.kaart.leegregel') && /Historie/.test(doenE.textContent), doenE.innerHTML);
  }

  /* 5p. 020: leeg bestand wint niet (B1); bij een fout niet blijven ophalen (B2); vervallen altijd melden (B3). */
  if (deel('5p 020: leeg bestand wint niet (B1); bij een fout niet blijven ophalen (B2); verval')) {
    const odL = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;op=2026-11-20T10:00\n');
    const wL = await start(odL);
    await rust(800);
    const dL = wL.document;
    wL.eval("handelen([{ actie: 'zet', soort: 'artikel', id: 'zzz01', veld: 'notitie', oud: '', nieuw: 'x' }])");
    await rust(2500);
    controle('vervallen: melding ook als er verder niets verandert (B3)', !!dL.getElementById('m-vervallen'));
    odL.zet('thuis.json', '');
    const downloads = () => odL.verzoeken.filter((v) => v.includes('download.test/thuis.json')).length;
    const voor = downloads();
    wL.eval("handelen([{ actie: 'zet', soort: 'artikel', id: artikelen[0].id, veld: 'notitie', oud: '', nieuw: 'halfvol' }])");
    await slaap(6000);
    controle('leeg bestand: niet overschreven, melding "is leeg", wolkje "niet gelukt" (B1)', odL.bestanden['thuis.json'].tekst === '' && /is leeg/.test((dL.getElementById('m-bestand') || {}).textContent || '') && dL.getElementById('wolkTekst').textContent === 'niet gelukt', dL.getElementById('wolkTekst').textContent);
    controle('fout in het bestand: niet elke 1,5 s opnieuw ophalen (B2)', downloads() - voor <= 1, String(downloads() - voor));
    controle('fout in het bestand: lokale lijst blijft (Melk, met de nieuwe notitie)', wL.eval("artikelen.map((a) => a.naam + ':' + a.notitie).join()") === 'Melk:halfvol');
  }

  /* 5q. 021: mandje loopt mee met de lijst (B6); gedeelde aankopen met zoeken; instelling bewaren. */
  if (deel('5q 021: mandje loopt mee met de lijst (B6); gedeelde aankopen met zoeken; instellin')) {
    const odA = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nartikel;Melk;soort=wekelijks;ligt=Plus;op=2026-11-20T10:00\nartikel;Brood;ligt=Plus;op=2026-11-20T10:00\n');
    const wA = await start(odA);
    await rust(800);
    const dA = wA.document;
    wA.eval("winkel.id = winkels[0].id");
    dA.getElementById('tab-winkel').click(); await slaap(30);
    const lijstA = dA.getElementById('winkelLijst');
    const vink = (naam) => [...lijstA.querySelectorAll('.wrij .vink')].find((b) => b.textContent.includes(naam)).click();
    vink('Melk'); await slaap(50); vink('Brood'); await rust(1800);
    controle('afvinken: twee in het mandje, teller 2 van 2', /Winkelmand/.test(lijstA.textContent) && dA.getElementById('winkelTeller').textContent === '2 van 2', dA.getElementById('winkelTeller').textContent);
    await rust(2500);
    const tA = R(odA.bestanden['thuis.json'].tekst);
    controle('afvinken: aankopen in het gedeelde bestand (naam, tijd en winkel, niet wie)', (tA.match(/^aankoop;(Melk|Brood);tijd=\d{4}-\d{2}-\d{2}T\d{2}:\d{2};winkel=\w+$/gm) || []).length === 2, tA);
    wA.eval('winkel.mandjeOpen = true; tekenWinkel()');
    const melk = wA.eval("artikelen.find((a) => a.naam === 'Melk').id");
    wA.eval("handelen([{ actie: 'zet', soort: 'artikel', id: '" + melk + "', veld: 'op', oud: '', nieuw: '2026-11-28T06:00' }])");
    await slaap(50);
    const mandjeTekst = [...lijstA.querySelectorAll('.afd')].filter((s) => /Winkelmand/.test(s.textContent)).map((s) => s.textContent).join();
    controle('mandje: weer op de lijst = uit het mandje, niet dubbel; teller telt alleen wat er nog ligt (B6)', !/Melk/.test(mandjeTekst) && /Brood/.test(mandjeTekst) && dA.getElementById('winkelTeller').textContent === '1 van 2', mandjeTekst + ' ' + dA.getElementById('winkelTeller').textContent);
    lijstA.querySelector('.naaraankopen button').click(); await slaap(30);
    const sch = dA.getElementById('aankopenScherm');
    const rijen = () => [...sch.querySelectorAll('.aankooprij .nm')].map((x) => x.firstChild.textContent).sort().join();
    const subs = () => [...sch.querySelectorAll('.aankooprij .sub')].map((x) => x.textContent).join();
    controle('aankopen: lijst per dag zonder tijdstip, kop "Vandaag", met de winkel eronder', !sch.hidden && rijen() === 'Brood,Melk' && /^Vandaag/.test(sch.querySelector('.kopbalk h3').textContent) && !sch.querySelector('.aankooprij .tijd') && subs() === [1, 2].map(() => wA.eval('winkels[0].naam')).join(), rijen() + ' | ' + subs());
    const zk = dA.getElementById('logZoek'); zk.value = 'bro'; zk.dispatchEvent(new wA.Event('input'));
    controle('aankopen: zoekvak onderaan in eigen balk', !dA.getElementById('balk-log').hidden && !sch.contains(zk));
    controle('aankopen: zoeken filtert', rijen() === 'Brood');
    sch.querySelector('.terug').click(); await slaap(50);
    controle('aankopen: terug naar Boodschappen, zoekbalk weg en leeg', sch.hidden && !dA.getElementById('midden').classList.contains('indeel') && dA.getElementById('balk-log').hidden && zk.value === '');
    [...lijstA.querySelectorAll('.wrij .vink')].find((b) => b.textContent.includes('Brood')).click(); await rust(2600);
    controle('terugtikken uit het mandje: ook uit de gedeelde aankopen', !/^aankoop;Brood;/m.test(R(odA.bestanden['thuis.json'].tekst)) && /^aankoop;Melk;/m.test(R(odA.bestanden['thuis.json'].tekst)), R(odA.bestanden['thuis.json'].tekst));
    dA.getElementById('tab-instellingen').click(); await slaap(50);
    const ab = dA.getElementById('aankopenBewaren');
    controle('instelling: aankopen bewaren standaard 500', ab.textContent.trim() === '500', ab.textContent);
    wA.eval("aankopenBewarenZetten('1500')");
    controle('instelling: buiten 0..1000 verandert niets', ab.textContent.trim() === '500');
    ab.click(); await slaap(20);
    [...dA.querySelectorAll('#keuze .optie')].find((b) => /^250/.test(b.textContent.trim())).click(); await rust(2600);
    controle('instelling: 250 in het bestand', /^instelling;aankopen;bewaren=250$/m.test(R(odA.bestanden['thuis.json'].tekst)), R(odA.bestanden['thuis.json'].tekst));
  }

  /* 5r. 022: terugknop sluit altijd het bovenste; Winkel bewerken vraagt eerst; keuzelijst met Huidig, Favorieten, loep. */
  if (deel('5r 022: terugknop sluit altijd het bovenste; Winkel bewerken vraagt eerst; keuzelij')) {
    const odT = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Gamma\nwinkel;Jumbo\nwinkel;Plus\nartikel;Kaars;op=2026-11-20T10:00\nartikel;Melk;ligt=Plus;op=2026-11-20T10:00\n');
    const wT = await start(odT);
    await rust(800);
    const dT = wT.document;
    const terug = async () => { wT.history.back(); await slaap(80); };
    const tab = () => [...dT.querySelectorAll('nav button')].find((b) => b.getAttribute('aria-current') === 'page').dataset.scherm;
    dT.getElementById('tab-winkels').click(); await slaap(30);
    [...dT.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma')).click(); await slaap(30);
    dT.querySelector('#winkelDetail .bewerk').click(); await slaap(20);
    await terug();
    controle('terug: eerst het paneel dicht, winkel blijft open', !dT.getElementById('keuze') && !dT.getElementById('winkelDetail').hidden);
    await terug();
    controle('terug: dan de winkel dicht (overzicht)', dT.getElementById('winkelDetail').hidden && tab() === 'winkels');
    await terug();
    controle('terug: dan naar Artikelen', tab() === 'boodschappen');
    /* paneel met het kruisje dicht: terug slaat die stap over */
    dT.getElementById('tab-winkels').click(); await slaap(30);
    [...dT.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma')).click(); await slaap(30);
    dT.querySelector('#winkelDetail .bewerk').click(); await slaap(20);
    dT.querySelector('#keuze .kruis').click(); await slaap(20);
    await terug(); await slaap(100);
    controle('terug na kruisje: de dode stap wordt overgeslagen, winkel dicht', dT.getElementById('winkelDetail').hidden && tab() === 'winkels', tab() + ' ' + dT.getElementById('winkelDetail').hidden);
    /* Winkel bewerken met wijzigingen */
    [...dT.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma')).click(); await slaap(30);
    dT.querySelector('#winkelDetail .bewerk').click(); await slaap(20);
    dT.getElementById('bewerkNotitie').value = 'za tot 17:00';
    dT.querySelector('#keuze .kruis').click(); await slaap(20);
    controle('winkel bewerken: sluiten met wijzigingen vraagt "Wijzigingen opslaan?" (K13)', /Wijzigingen opslaan/.test(dT.getElementById('keuze').textContent) && dT.getElementById('keuzeWacht').hidden);
    await terug(); await slaap(50);
    controle('vraag: terug = verder bewerken, notitie staat er nog', !!dT.getElementById('keuze') && dT.getElementById('bewerkNotitie').value === 'za tot 17:00');
    dT.getElementById('bewerkNaam').value = 'Plus';
    dT.querySelector('#keuze .knop').click(); await slaap(20);
    controle('winkel bewerken: bestaande naam = fout in het paneel, paneel blijft, notitie blijft (K13)', !!dT.getElementById('keuze') && /Er is al een winkel Plus/.test(dT.querySelector('#keuze .paneelmeldingen').textContent) && dT.getElementById('bewerkNotitie').value === 'za tot 17:00');
    dT.getElementById('bewerkNaam').value = 'Gamma';
    dT.querySelector('#keuze').click(); await slaap(20);
    [...dT.querySelectorAll('#keuze .bewerkknoppen .knop')].find((b) => b.textContent === 'Opslaan').click(); await slaap(30);
    controle('vraag: Opslaan bewaart en sluit', !dT.getElementById('keuze') && !dT.getElementById('keuzeWacht') && wT.eval("winkels.find((w) => w.naam === 'Gamma').notitie") === 'za tot 17:00');
    /* artikel-editor met wijzigingen: terug = vraag */
    dT.getElementById('tab-boodschappen').click(); await slaap(30);
    [...dT.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Kaars')).querySelector('.tekst').click(); await slaap(30);
    dT.getElementById('artikelNotitie').value = 'wit'; dT.getElementById('artikelNotitie').dispatchEvent(new wT.Event('input'));
    await terug();
    controle('terug in de artikel-editor met wijzigingen: vraag, editor blijft', !dT.getElementById('artikelScherm').hidden && /Wijzigingen opslaan/.test((dT.getElementById('keuze') || {}).textContent || ''));
    await terug();
    controle('terug op de vraag: verder bewerken', !dT.getElementById('keuze') && !dT.getElementById('artikelScherm').hidden && dT.getElementById('artikelNotitie').value === 'wit');
    dT.getElementById('artikelDicht').click(); await slaap(20);
    [...dT.querySelectorAll('#keuze .bewerkknoppen .knop')].find((b) => b.textContent === 'Weggooien').click(); await slaap(30);
    /* keuzelijst Bij welke winkel? */
    wT.eval("ws.favorieten = [winkels.find((w) => w.naam === 'Jumbo').id]; winkel.id = winkels.find((w) => w.naam === 'Plus').id");
    dT.getElementById('tab-winkel').click(); await slaap(30);
    dT.querySelector('#winkelLijst .naarwinkel').click(); await slaap(20);
    const kz = dT.getElementById('keuze');
    const koppen = [...kz.querySelectorAll('.uitklapper')].map((u) => u.firstChild.textContent + (u.classList.contains('vast') ? '(vast)' : '') + (u.getAttribute('aria-expanded') === 'false' ? '(dicht)' : '')).join();
    controle('bij welke winkel: Huidig (vast), Favorieten (inklapbaar, open), Overige winkels (dicht)', koppen === 'Huidig(vast),Favorieten,Overige winkels(dicht)' && [...kz.querySelectorAll('.optie .nm')].map((x) => x.firstChild.textContent).join() === 'Plus,Jumbo', koppen);
    const links = kz.querySelector('.zoeklinks');
    const zk = kz.querySelector('#keuzeZoek');
    const loep = links.getAttribute('aria-label');
    zk.value = 'ga'; zk.dispatchEvent(new wT.Event('input'));
    const pijl = links.getAttribute('aria-label');
    links.click();
    controle('keuzelijst: loep links, met tekst een terugpijl die leegmaakt', loep === 'Zoeken' && pijl === 'Leegmaken' && zk.value === '' && links.getAttribute('aria-label') === 'Zoeken');
    await terug();
    controle('terug sluit de keuzelijst, Boodschappen blijft', !dT.getElementById('keuze') && tab() === 'winkel');
  }

  /* 5s. 023: editor van iets dat intussen weg is (K12); bestaand toevoegen licht op (K15); maand onthoudt de dag (K5); archief terug ook na opruimen. */
  if (deel('5s 023: editor van iets dat intussen weg is (K12); bestaand toevoegen licht op (K15')) {
    const odK = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Kaars;op=2026-11-20T10:00\nartikel;Lampje;weg=2026-11-01\nactie;Huur;datum=2026-01-31;herhaal=maand\n');
    const wK = await start(odK);
    await rust(800);
    const dK = wK.document;
    [...dK.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Kaars')).querySelector('.tekst').click(); await slaap(30);
    dK.getElementById('artikelNotitie').value = 'wit'; dK.getElementById('artikelNotitie').dispatchEvent(new wK.Event('input'));
    const kid = wK.eval("artikelen.find((a) => a.naam === 'Kaars').id");
    wK.eval("handelen([{ actie: 'weg', soort: 'artikel', id: '" + kid + "' }])"); await slaap(50);
    const m = dK.getElementById('m-weg-' + kid);
    controle('editor: intussen verwijderd = melding met Terugzetten, niet stil (K12)', dK.getElementById('artikelScherm').hidden && !!m && /Kaars is intussen verwijderd/.test(m.textContent));
    [...m.querySelectorAll('button')].find((b) => /Terugzetten/.test(b.textContent)).click(); await slaap(50);
    controle('terugzetten met mijn wijzigingen: artikel terug, met de nieuwe notitie, op de lijst', wK.eval("(artikelen.find((a) => a.naam === 'Kaars') || {}).notitie") === 'wit' && wK.eval("!!(artikelen.find((a) => a.naam === 'Kaars') || {}).op"));
    dK.getElementById('invoerTekst').value = 'kaars'; dK.getElementById('invoerTekst').dispatchEvent(new wK.Event('input'));
    dK.getElementById('invoerPlus').click(); await slaap(30);
    const rij = dK.querySelector('#lijst .item[data-id="' + kid + '"]');
    controle('toevoegen van iets dat er al staat: de regel licht op (K15)', !!rij && rij.classList.contains('oplicht'));
    /* archief: terugzetten stuurt het hele artikel mee */
    const lid = wK.eval("artikelen.find((a) => a.naam === 'Lampje').id");
    [...dK.querySelectorAll('#filters .filter')][1].click(); await slaap(30);
    dK.querySelector('#archief .kopbalk').click(); await slaap(30);
    dK.querySelector('#archief .item[data-id="' + lid + '"] .rondje').click(); await slaap(30);
    const laatste = wK.eval("JSON.stringify(wachtrij.filter((h) => h.id === '" + lid + "').map((h) => h.actie))");
    controle('archief: terugzetten stuurt het hele artikel mee (komt terug als het intussen is opgeruimd)', laatste === '["terug","zet","zet"]', laatste);
    /* K5 */
    dK.getElementById('tab-doen').click(); await slaap(30);
    wK.eval("actieAfronden(actieLijst(model).find((a) => a.naam === 'Huur'))"); await slaap(30);
    const huur = wK.eval("JSON.stringify((({ datum, maanddag }) => ({ datum, maanddag }))(actieLijst(model).find((a) => a.naam === 'Huur')))");
    controle('maandelijks afronden: datum verschuift, dag 31 onthouden waar de maand korter is (K5)', /"maanddag":(0|31)/.test(huur) && (/"maanddag":31/.test(huur) ? !/-31"/.test(huur) : /-31"/.test(huur)), huur);
  }

  /* 5t. 024: filters bij Doen (Week/Maand/Kw./Jaar/Alles), standaard per telefoon in Instellingen. */
  if (deel('5t 024: filters bij Doen (Week/Maand/Kw./Jaar/Alles), standaard per telefoon in Ins')) {
    const nu = new Date(), dt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const gister = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1), vandaagD = dt(nu);
    const maand = vandaagD.slice(0, 7), jaar = vandaagD.slice(0, 4);
    const odF = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nactie;Te laat;datum=' + dt(gister) + '\nactie;Vandaag;datum=' + vandaagD + '\nactie;Volgend jaar;datum=' + (+jaar + 1) + '\nactie;Zomaar\nactie;Deze maand;datum=' + maand + '\n');
    const wF = await start(odF);
    await rust(800);
    const dF = wF.document;
    dF.getElementById('tab-doen').click(); await slaap(50);
    const knoppen = () => [...dF.querySelectorAll('#doenFilters .filter')].map((b) => b.firstChild.textContent + ':' + b.lastChild.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(',');
    const koppen = () => [...dF.querySelectorAll('#doenLijst .kopbalk')].map((k) => k.firstChild.textContent).join(',');
    controle('doen-filters: standaard Week; naam en aantal (te laat telt mee)', /^Week:\d\*,Maand:\d,Kw\.:\d,Jaar:\d,Alles:5$/.test(knoppen()) && /^Te laat(,Deze week)?$/.test(koppen()), knoppen() + ' ' + koppen());
    [...dF.querySelectorAll('#doenFilters .filter')][1].click(); await slaap(20);
    controle('doen-filters: Maand toont Te laat en Deze maand (met de maandactie)', koppen() === 'Te laat,Deze maand' && /Deze maand/.test(dF.getElementById('doenLijst').textContent.replace('Deze maand', '')), koppen());
    [...dF.querySelectorAll('#doenFilters .filter')][4].click(); await slaap(20);
    controle('doen-filters: Alles toont ook Zonder periode', /Zonder periode/.test(koppen()), koppen());
    dF.getElementById('tab-instellingen').click(); await slaap(30);
    const st = [...dF.querySelectorAll('#doenStandaard button')];
    controle('instelling: Doen standaard, Week gekozen', st.map((b) => b.textContent).join() === 'Week,Maand,Kw.,Jaar,Alles' && st[0].getAttribute('aria-checked') === 'true');
    st[1].click(); await slaap(30);
    dF.getElementById('tab-doen').click(); await slaap(30);
    controle('instelling: Doen opent op Maand; bewaard per telefoon (niet in het bestand)', /Maand:\d\*/.test(knoppen()) && !/doenStandaard|standaard/.test(R(odF.bestanden['thuis.json'].tekst)) && wF.eval('doen.standaard') === 'maand', knoppen());
  }

  /* 5u. 024: wekelijks terug ook offline, uit de kopie op de telefoon (K10). */
  if (deel('5u 024: wekelijks terug ook offline, uit de kopie op de telefoon (K10).')) {
    const odW = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const wW = await start(odW);
    await rust(800);
    const r = wW.eval("(() => { const vorige = tijdstipTekst(laatsteMoment(new Date(Date.now() - 8 * 86400000), 'za', '06:00')); kopie = { tekst: JSON.stringify({ versie: FORMAAT, instellingen: { wekelijks: { dag: 'za', tijd: '06:00', teruggezet: vorige } }, artikelen: { mel01: { naam: 'Melk', soort: 'wekelijks', gekocht: [vorige.slice(0, 10)] } } }) }; wachtrij = []; bouwModel(); return !!artikelen.find((a) => a.naam === 'Melk').op; })()");
    controle('wekelijks: ook zonder sync terug op de lijst, uit de kopie (K10)', r === true);
  }

  /* 5v. 024: twee verzoeken tegelijk met een verlopen token = één vernieuwing (B8). */
  if (deel('5v 024: twee verzoeken tegelijk met een verlopen token = één vernieuwing (B8).')) {
    const odV = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const wV = await start(odV);
    await rust(800);
    await wV.eval("(async () => { const a = await kvGet('auth'); a.accessTot = 0; await kvSet('auth', a); })()");
    const voor = odV.verzoeken.filter((v) => v.includes('/oauth2/')).length;
    await wV.eval('Promise.all([toegang(), toegang(), toegang()])');
    controle('aanmelding: gelijktijdige vernieuwing gebeurt één keer (B8)', odV.verzoeken.filter((v) => v.includes('/oauth2/')).length - voor === 1, String(odV.verzoeken.filter((v) => v.includes('/oauth2/')).length - voor));
  }

  /* 5w. 024: hernoemen naar een naam met # vooraan wordt geweigerd (net als toevoegen). */
  if (deel('5w 024: hernoemen naar een naam met # vooraan wordt geweigerd (net als toevoegen).')) {
    const odH = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Kaars;op=2026-11-20T10:00\n');
    const wH = await start(odH);
    await rust(800);
    const dH = wH.document;
    [...dH.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Kaars')).querySelector('.tekst').click(); await slaap(30);
    dH.getElementById('artikelNaam').value = '#kerst'; dH.getElementById('artikelNaam').dispatchEvent(new wH.Event('input'));
    dH.getElementById('artikelOpslaan').click(); await slaap(30);
    controle('hernoemen naar #… geweigerd: melding, editor blijft open', !dH.getElementById('artikelScherm').hidden && /niet met # beginnen/.test((dH.getElementById('m-fout') || {}).textContent || '') && wH.eval("artikelen[0].naam") === 'Kaars');
  }

  /* 5x. 005: bestand weg = terugzetten vanaf deze telefoon (B2); aankopen bewaren verlagen vraagt eerst (K9). */
  if (deel('5x 005: bestand weg = terugzetten vanaf deze telefoon (B2); aankopen bewaren verlag')) {
    const odB = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Melk;op=2026-11-20T10:00\nartikel;Brood\n');
    const wB = await start(odB);
    await rust(800);
    const dB = wB.document;
    delete odB.bestanden['thuis.json'];
    wB.eval("handelen([{ actie: 'zet', soort: 'artikel', id: artikelen[0].id, veld: 'notitie', oud: '', nieuw: 'x' }])");
    await rust(2500);
    const m = dB.getElementById('m-weg');
    const knoppen = m ? [...m.querySelectorAll('button')].map((b) => b.textContent).join() : '';
    controle('bestand weg: Terugzetten vanaf deze telefoon en Leeg beginnen (B2)', knoppen === 'Terugzetten vanaf deze telefoon,Leeg beginnen' && !odB.bestanden['thuis.json'], knoppen);
    [...m.querySelectorAll('button')].find((b) => b.textContent === 'Leeg beginnen').click(); await slaap(20);
    controle('leeg beginnen: eerst bevestigen', /Leeg beginnen\?/.test((dB.getElementById('keuze') || {}).textContent || ''));
    [...dB.querySelectorAll('#keuze .knop')].find((b) => b.textContent === 'Annuleren').click(); await slaap(20);
    [...dB.getElementById('m-weg').querySelectorAll('button')].find((b) => /Terugzetten/.test(b.textContent)).click();
    await slaap(3000);
    const tB = odB.bestanden['thuis.json'] ? R(odB.bestanden['thuis.json'].tekst) : '';
    controle('terugzetten vanaf deze telefoon: het bestand is terug met de hele lijst en de wachtende wijziging', /^artikel;Brood;[^\n]*notitie=x/m.test(tB) && /^artikel;Melk;/m.test(tB) && !dB.getElementById('m-weg'), tB);
    /* K9 */
    for (let i = 0; i < 5; i++) wB.eval("handelen([{ actie: 'aankoop', soort: 'aankoop', id: 'k" + (1111 + i) + "', naam: 'A" + i + "', tijd: '2026-11-2" + i + "T10:00' }])");
    dB.getElementById('tab-instellingen').click(); await slaap(30);
    const ab = dB.getElementById('aankopenBewaren');
    ab.click(); await slaap(20);
    controle('aankopen bewaren: eigen keuzelijst (50, 100, 250, 500), huidige gemarkeerd', [...dB.querySelectorAll('#keuze .optie')].map((o) => o.textContent.trim().split(' ')[0]).join() === '50,100,250,500');
    dB.querySelector('#keuze .kruis').click(); await slaap(20);
    for (let i = 5; i < 60; i++) wB.eval("handelen([{ actie: 'aankoop', soort: 'aankoop', id: 'k" + (1111 + i) + "', naam: 'A" + i + "', tijd: '2026-11-1" + (i % 10) + "T10:00' }])");
    ab.click(); await slaap(20);
    [...dB.querySelectorAll('#keuze .optie')].find((b) => /^50 /.test(b.textContent.trim())).click(); await slaap(20);
    const v = dB.getElementById('keuze');
    controle('aankopen bewaren verlagen: eerst bevestigen met het aantal (K9)', !!v && /10 oudste aankopen verwijderen\?/.test(v.textContent), v && v.textContent);
    [...v.querySelectorAll('.knop')].find((b) => b.textContent === 'Annuleren').click(); await slaap(20);
    controle('annuleren: waarde blijft, niets veranderd', ab.textContent.trim() === '500' && wB.eval('model.aankopen.size') === 60);
  }

  /* 5y. 006/007: zichtbaar na toevoegen (B4, B5); Aankopen ververst (B7); tab wisselen sluit winkel (K1); editor + verwijderde winkel (K4); aankopen 0 (K11). */
  if (deel('5y 006/007: zichtbaar na toevoegen (B4, B5); Aankopen ververst (B7); tab wisselen s')) {
    const odZ = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Gamma\nwinkel;Plus\nartikel;Kaars;ligt=Gamma|Plus;op=2026-11-20T10:00\nartikel;Lampje\n');
    const wZ = await start(odZ);
    await rust(800);
    const dZ = wZ.document;
    /* B5 */
    [...dZ.querySelectorAll('#filters .filter')][4].click(); await slaap(20);
    dZ.getElementById('invoerTekst').value = 'Lampje'; dZ.getElementById('invoerTekst').dispatchEvent(new wZ.Event('input'));
    dZ.getElementById('invoerPlus').click(); await slaap(30);
    const lid = wZ.eval("artikelen.find((a) => a.naam === 'Lampje').id");
    controle('artikelen: toevoegen in Suggesties springt naar Op de lijst en licht op (B5)', wZ.eval('scherm.filter') === 'L' && !!dZ.querySelector('#lijst .item[data-id="' + lid + '"].oplicht'));
    /* B4 */
    dZ.getElementById('tab-doen').click(); await slaap(30);
    controle('doen: standaard Week', wZ.eval('doen.filter') === 'week');
    dZ.getElementById('doenTekst').value = 'Lamp vervangen'; dZ.getElementById('doenPlus').click(); await slaap(30);
    controle('doen: nieuwe actie zonder periode → Alles, zichtbaar en oplichtend (B4)', wZ.eval('doen.filter') === 'alles' && !!dZ.querySelector('#doenLijst .actierij.oplicht'));
    /* K1 */
    dZ.getElementById('tab-winkels').click(); await slaap(30);
    [...dZ.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Gamma')).click(); await slaap(30);
    dZ.getElementById('tab-instellingen').click(); await slaap(30);
    wZ.history.back(); await slaap(120);
    const tabNu = [...dZ.querySelectorAll('nav button')].find((b) => b.getAttribute('aria-current') === 'page').dataset.scherm;
    controle('tab wisselen met een open winkel: winkel dicht, terug gaat meteen naar Artikelen (K1)', !wZ.eval('ws.open') && tabNu === 'boodschappen', tabNu);
    /* K4 */
    [...dZ.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Kaars')).querySelector('.tekst').click(); await slaap(30);
    const gid = wZ.eval("winkels.find((w) => w.naam === 'Gamma').id");
    wZ.eval("handelen([{ actie: 'weg', soort: 'winkel', id: '" + gid + "' }])"); await slaap(30);
    dZ.getElementById('artikelDicht').click(); await slaap(20);
    controle('editor: de ander verwijdert een winkel; sluiten zonder eigen wijziging vraagt niets (K4)', dZ.getElementById('artikelScherm').hidden && !dZ.getElementById('keuze'));
    /* B7 */
    wZ.eval("winkel.id = winkels.find((w) => w.naam === 'Plus').id");
    dZ.getElementById('tab-winkel').click(); await slaap(30);
    dZ.querySelector('.naaraankopen button') && dZ.querySelector('.naaraankopen button').click();
    if (!dZ.querySelector('.naaraankopen button')) wZ.eval('aankopenOpenen()');
    await slaap(20);
    wZ.eval("handelen([{ actie: 'aankoop', soort: 'aankoop', id: 'kzz12', naam: 'Nieuw', tijd: tijdstipTekst(new Date()) }])"); await slaap(30);
    controle('aankopen: open scherm ververst bij een nieuwe aankoop (B7)', [...dZ.querySelectorAll('.aankooprij .nm')].some((n) => n.textContent === 'Nieuw'));
    wZ.history.back(); await slaap(80);
    /* K11 */
    wZ.eval("handelen([{ actie: 'instelling', naam: 'aankopen', veld: 'bewaren', oud: '500', nieuw: '0' }])"); await slaap(20);
    const voor = wZ.eval('model.aankopen.size');
    const kid = wZ.eval("artikelen.find((a) => a.naam === 'Kaars').id");
    wZ.eval("afvinken(artikelen.find((a) => a.id === '" + kid + "'))"); await slaap(30);
    controle('aankopen bewaren 0: afvinken maakt geen aankoop (K11)', wZ.eval('model.aankopen.size') === voor);
  }

  /* 5z30. Review dagelijks gebruik (punt 1–12) en UI 11–15. */
  if (deel('5z30 Review dagelijks gebruik (punt 1–12) en UI 11–15.')) {
    const odD = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nwinkel;AH\nwinkel;Jumbo\nartikel;Kaas;ligt=AH;op=2026-11-20T10:00\nartikel;Brood;ligt=Plus;op=2026-11-20T10:00\nartikel;Melk;ligt=Plus;op=2026-11-20T10:00\nactie;Tandarts;datum=2026-03-10;klaar=2026-03-10T09:00\nactie;Bellen;datum=' + datumTekstT(3) + '\n');
    const wD = await start(odD);
    await rust(800);
    const dD = wD.document;
    /* Punt 1: andere dag → opnieuw uitrekenen en tekenen, zonder wijziging in het bestand. */
    wD.eval("window.__getekend = 0; const __t = tekenAlles; tekenAlles = function () { window.__getekend++; return __t.apply(this, arguments); };");
    wD.eval('dagNagaan()');
    controle('dag: zelfde dag → niets opnieuw (punt 1)', wD.eval('window.__getekend') === 0);
    wD.eval("getekend.sleutel = 'gisteren'; dagNagaan()");
    controle('dag: andere dag → opnieuw uitrekenen en tekenen (punt 1)', wD.eval('window.__getekend') === 1 && wD.eval('getekend.sleutel') === wD.eval('momentSleutel(new Date())'));
    /* Het mandje blijft staan, ook de volgende dag; alleen leegmaken of weer op de lijst haalt iets eruit. */
    wD.eval("winkel.id = winkels.find((w) => w.naam === 'Plus').id; const __b = artikelen.find((a) => a.naam === 'Brood'); afvinken(__b);");
    await slaap(30);
    wD.eval("const __m = winkel.mandje.get(artikelen.find((a) => a.naam === 'Brood').id); __m.datum = verschuif(datumTekst(new Date()), -1, 'dag'); mandjeOpschonen();");
    controle('mandje: afgevinkt op een eerdere dag blijft staan', wD.eval('winkel.mandje.size') === 1);
    const __bid = wD.eval("artikelen.find((a) => a.naam === 'Brood').id");
    wD.eval("handelen([{ actie: 'zet', soort: 'artikel', id: '" + __bid + "', veld: 'op', oud: '', nieuw: tijdstipTekst(new Date()) }])"); await slaap(30);
    controle('mandje: weer op de lijst (bv. wekelijks terug) = uit het mandje', wD.eval('winkel.mandje.size') === 0);
    /* Afvinken onder "Elders": niet vastleggen dat het hier te koop is; de aankoop krijgt "Plus?". */
    const kid = wD.eval("artikelen.find((a) => a.naam === 'Kaas').id");
    const pid = wD.eval('winkel.id');
    wD.eval("afvinken(artikelen.find((a) => a.id === '" + kid + "'))"); await slaap(30);
    const aank = wD.eval("JSON.stringify(Array.from(model.aankopen.values()).filter((x) => x.naam === 'Kaas').map((x) => [x.winkel, x.onzeker]))");
    controle('niet bij: afvinken legt niet vast dat het hier te koop is; aankoop met winkel en vraagteken', !wD.eval("model.artikelen.get('" + kid + "').ligt.has('" + pid + "')") && aank === JSON.stringify([[pid, '1']]), aank);
    await slaap(1700); wD.eval("winkel.mandjeOpen = true; toonScherm('winkel')"); await slaap(30);
    const mr = [...dD.querySelectorAll('#winkelLijst .wrij.gedaan')].find((r) => r.querySelector('.nm').firstChild.textContent === 'Kaas');
    controle('winkelmand: "Plus?" onder een artikel dat onder Elders is afgevinkt', !!mr && mr.querySelector('.winkels').textContent === wD.eval('huidigeWinkel().naam') + '?', mr && mr.textContent);
    wD.eval("logOpenen('aankoop')"); await slaap(30);
    const sub = [...dD.querySelectorAll('#aankopenScherm .aankooprij')].find((r) => r.querySelector('.nm').firstChild.textContent === 'Kaas').querySelector('.sub').textContent;
    controle('Aankopen: "Plus?" onder het artikel', sub === wD.eval('huidigeWinkel().naam') + '?', sub);
    wD.eval('logSluiten()'); await slaap(20);
    wD.eval("terugOpLijst('" + kid + "')"); await slaap(30);
    controle('niet bij: terugtikken laat de winkels van het artikel ongemoeid', !wD.eval("model.artikelen.get('" + kid + "').ligt.has('" + pid + "')") && wD.eval("model.artikelen.get('" + kid + "').ligt.size") === 1);
    /* Punt 10: typen wist "Van de lijst gehaald" niet. */
    dD.getElementById('tab-boodschappen').click(); await slaap(30);
    wD.eval("scherm.filter = 'L'; tekenBoodschappen()");
    [...dD.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Melk')).querySelector('.rondje').click();
    await slaap(1700);
    controle('van de lijst gehaald: zichtbaar na weghalen', !!dD.getElementById('weggehaald'));
    const inv = dD.getElementById('invoerTekst');
    inv.value = 'x'; inv.dispatchEvent(new wD.Event('input')); await slaap(10);
    controle('van de lijst gehaald: tijdens typen verborgen', !dD.getElementById('weggehaald'));
    inv.value = ''; inv.dispatchEvent(new wD.Event('input')); await slaap(10);
    controle('van de lijst gehaald: terug als het vak leeg is (punt 10)', !!dD.getElementById('weggehaald') && /Melk/.test(dD.getElementById('weggehaald').textContent));
    /* Punt 6: tijdens zoeken laat het rondje het vak niet los, en de zoektekst wordt geselecteerd. */
    inv.focus(); inv.value = 'Melk'; inv.dispatchEvent(new wD.Event('input')); await slaap(10);
    const rond = [...dD.querySelectorAll('#lijst .item')].find((r) => r.textContent.startsWith('Melk')).querySelector('.rondje');
    const pd = new wD.MouseEvent('mousedown', { bubbles: true, cancelable: true }); rond.dispatchEvent(pd);
    rond.click(); await slaap(20);
    controle('zoeken: rondje houdt het toetsenbord open en selecteert de zoektekst (punt 6)', pd.defaultPrevented && dD.activeElement === inv && inv.selectionStart === 0 && inv.selectionEnd === 4);
    inv.value = ''; inv.dispatchEvent(new wD.Event('input')); inv.blur();
    /* Punt 11: + bij Doen houdt het toetsenbord open. */
    dD.getElementById('tab-doen').click(); await slaap(30);
    const dt = dD.getElementById('doenTekst'); dt.focus();
    const pd2 = new wD.MouseEvent('mousedown', { bubbles: true, cancelable: true }); dD.getElementById('doenPlus').dispatchEvent(pd2);
    controle('doen: + laat het toetsenbord open (punt 11)', pd2.defaultPrevented);
    dt.blur();
    /* Punt 5: een afgeronde actie opnieuw intypen: de voorbije datum gaat eraf. */
    dt.value = 'Tandarts'; dD.getElementById('doenPlus').click(); await slaap(30);
    const tid = wD.eval("acties.find((a) => a.naam === 'Tandarts').id");
    controle('doen: afgeronde actie opnieuw intypen → open, zonder voorbije datum (punt 5)', wD.eval("acties.find((a) => a.id === '" + tid + "').open") && wD.eval("acties.find((a) => a.id === '" + tid + "').datum") === '');
    /* Punt 4: een gewone actie afronden heeft Ongedaan maken, ook voor de historie. */
    wD.eval("doen.filter = 'alles'; tekenDoen()");
    const bid = wD.eval("acties.find((a) => a.naam === 'Bellen').id");
    dD.querySelector('#doenLijst .actierij[data-id="' + bid + '"] .rondje').click(); await slaap(20);
    const knop = [...dD.querySelectorAll('.melding button')].find((b) => b.textContent === 'Ongedaan maken');
    controle('doen: gewone actie afronden geeft Ongedaan maken (punt 4)', !!knop && wD.eval('model.historie.size') === 1);
    knop.click(); await slaap(30);
    controle('doen: ongedaan maken → weer open en uit de historie (punt 4)', wD.eval("acties.find((a) => a.id === '" + bid + "').open") && wD.eval('model.historie.size') === 0, wD.eval("JSON.stringify([acties.find((a) => a.id === '" + bid + "'), model.historie.size, wachtrij.slice(-3)])"));
    /* Punt 4: zelf terugtikken binnen 1,5 s haalt de melding weg. */
    dD.querySelector('#doenLijst .actierij[data-id="' + bid + '"] .rondje').click(); await slaap(20);
    dD.querySelector('#doenLijst .actierij[data-id="' + bid + '"] .rondje').click(); await slaap(20);
    controle('doen: terugtikken binnen 1,5 s → melding weg, open (punt 4)', ![...dD.querySelectorAll('.melding')].some((m) => /Bellen/.test(m.textContent) && /afgerond/.test(m.textContent)) && wD.eval("acties.find((a) => a.id === '" + bid + "').open"));
    /* Punt 7 en UI 11: editor met "Naam", bij een dag een datumvak (kalender van de telefoon). */
    wD.eval("actieOpenen('" + bid + "')"); await slaap(30);
    const datumVak = dD.querySelector('.blader label input[type="date"]');
    controle('editor: label Naam en een datumvak bij een dag (UI 11, punt 7)', dD.querySelector('label[for="actieNaam"]').textContent === 'Naam' && !!datumVak);
    datumVak.value = datumTekstT(21); datumVak.dispatchEvent(new wD.Event('change')); await slaap(10);
    controle('editor: datum kiezen in de kalender zet de dag (punt 7)', wD.eval('bd.datum') === datumTekstT(21) && dD.querySelector('.blader label').textContent === wD.eval("periodeTekst('" + datumTekstT(21) + "', '', true)"));
    dD.getElementById('actieDicht').click(); await slaap(20);
    const vraag = dD.getElementById('keuze');
    if (vraag) { const w = [...vraag.querySelectorAll('.knop')].find((b) => /weggooien|Niet opslaan/i.test(b.textContent)); if (w) w.click(); await slaap(20); }
    /* UI 15: geen dubbel woord in de kop "Winkels". */
    dD.getElementById('tab-winkels').click(); await slaap(30);
    const kop = dD.querySelector('#winkelsOverzicht .kopbalk');
    controle('winkels: kop "Winkels" met alleen het getal (UI 15)', kop && kop.querySelector('.kopnaam').textContent === 'Winkels' && kop.querySelector('.tal').textContent === '3', kop && kop.textContent);
    /* UI 12: infomelding met een paarse streep links. */
    controle('infomelding: paarse streep links (UI 12)', /border-left:4px solid var\(--paars\)/.test(dD.querySelector('style').textContent.replace(/\s+/g, '')) || /\.melding\.info\{[^}]*border-left:4px solid var\(--paars\)/.test([...dD.querySelectorAll('style')].map((x) => x.textContent).join('')));
  }

  /* 5z31. Netwerk: naam hooguit eens per week opvragen; aantal backups zonder netwerkvraag. */
  if (deel('5z31 netwerk: naam eens per week, aantal backups onthouden')) {
    const odN = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n');
    const gedeeld = new (require('fake-indexeddb').IDBFactory)();
    const wN = await start(odN, null, gedeeld);
    await rust(1500);
    const eerste = odN.verzoeken.filter((v) => /\/me\b/.test(v)).length;
    /* start() zet een test-aanmelding neer; geef de bewaarde mee, zoals een echte tweede start die vindt. */
    const bewaard = await wN.eval("kvLees('auth')");
    controle('naam: tijdstip van opvragen bewaard', !!bewaard && bewaard.naam === 'Testspeler Een' && bewaard.naamOp > 0);
    const wN2 = await start(odN, { auth: bewaard }, gedeeld);
    await rust(1500);
    const tweede = odN.verzoeken.filter((v) => /\/me\b/.test(v)).length - eerste;
    controle('naam: bij de eerste start opgevraagd, bij de volgende niet', eerste === 1 && tweede === 0, eerste + '/' + tweede);
    const voor = odN.verzoeken.length;
    wN2.document.getElementById('tab-instellingen').click(); await slaap(50);
    controle('ronde: alleen de nodige velden van het bestand opgevraagd ($select)', odN.verzoeken.some((v) => /^GET .*thuis\.json\?\$select=id,eTag,lastModifiedDateTime,@microsoft\.graph\.downloadUrl$/.test(v)) && !odN.verzoeken.some((v) => /^GET https:\/\/graph.*thuis\.json$/.test(v)));
    /* Korter bewaren ruimt meteen op de telefoon op, nog vóór de sync. */
    await wN2.eval("handelen([{ actie: 'historie', soort: 'historie', id: 'houd1', naam: 'Oud', tijd: '" + datumTekstT(-60) + "T10:00' }, { actie: 'historie', soort: 'historie', id: 'hnie1', naam: 'Nieuw', tijd: '" + datumTekstT(-2) + "T10:00' }])");
    await wN2.eval("bewarenZetten('historie', '3m', '1m')");
    controle('korter bewaren: meteen opgeruimd op de telefoon, ook zonder sync', wN2.eval("Array.from(model.historie.values()).map((x) => x.naam).join()") === 'Nieuw', wN2.eval("Array.from(model.historie.values()).map((x) => x.naam).join()"));
    /* Bezig: een knop die even duurt, laat meteen zien dat hij werkt en kan niet dubbel. */
    wN2.eval("herlaadMetWachtendeWorker = () => {}; melding('m-versie', 'Nieuwe versie beschikbaar.', [{ tekst: 'Herladen', klasse: 'warn', actie: herlaadVoorUpdate }])");
    wN2.document.querySelector('#m-versie .knop').click(); await slaap(30);
    const hk = wN2.document.querySelector('#m-versie .knop');
    controle('herladen: knop meteen bezig (rondje, "Herladen…", uitgeschakeld)', hk.disabled && hk.classList.contains('bezig') && !!hk.querySelector('.draai') && hk.textContent === 'Herladen…');
    controle('Instellingen openen: geen netwerkvraag voor het aantal backups', odN.verzoeken.slice(voor).every((v) => !/children/.test(v)), odN.verzoeken.slice(voor).join(' | '));
  }

  /* 5z32. Vangnet: geeft de server bij $select geen downloadlink, dan één keer zonder selectie. */
  if (deel('5z32 netwerk: vangnet als de selectie geen downloadlink geeft')) {
    const odS = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nartikel;Thee;op=2026-11-20T10:00\n');
    odS.zonderLinkBijSelectie = true;
    const wS = await start(odS);
    await rust(1500);
    controle('vangnet: zonder downloadlink bij de selectie toch het bestand gelezen', wS.eval("artikelen.some((a) => a.naam === 'Thee')") && odS.verzoeken.some((v) => /^GET https:\/\/graph.*\/items\/[^/?]+$/.test(v)), odS.verzoeken.join(' | '));
    controle('vangnet: geen foutmelding', !wS.eval('sync.fout'), wS.eval('sync.fout'));
  }

  /* 5z33. Zoeken op winkel met @: winkels boven de balk, kiezen, per afdeling (route), verder typen, + voegt niets toe. */
  if (deel('5z33 zoeken op winkel met @ (artikelen)')) {
    const odW = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus;route=Groente|Zuivel\nwinkel;Albert Heijn\n' +
      'artikel;Appels;ligt=Plus:Groente\nartikel;Melk;ligt=Plus:Zuivel\nartikel;Kaas;ligt=Plus:Zuivel|Albert Heijn\nartikel;Stroopwafels;ligt=Plus\nartikel;Schroeven\n');
    const wW = await start(odW);
    await rust(1500);
    const dW = wW.document, vak = dW.getElementById('invoerTekst');
    controle('balk: links een vergrootglas, geen soortmenu', !dW.getElementById('soortMenu') && /Zoeken/.test(dW.getElementById('invoerZoek').getAttribute('aria-label')));
    vak.focus(); vak.value = '@'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    const opties = [...dW.querySelectorAll('#tagLijst .tagoptie')].map((b) => b.textContent);
    controle('@: de winkels boven de balk, met het aantal artikelen', !dW.getElementById('tagLijst').hidden && opties.join() === '@Albert Heijn1,@Plus4', opties.join());
    [...dW.querySelectorAll('#tagLijst .tagoptie')].find((b) => /Plus/.test(b.textContent)).click(); await slaap(20);
    const koppen = () => [...dW.querySelectorAll('#lijst .zoekgroep .kopnaam')].map((k) => k.textContent).join();
    const namen = () => [...dW.querySelectorAll('#lijst .item')].map((r) => r.querySelector('.naam > span').textContent).join();
    controle('@Plus: per afdeling in de volgorde van de route, onderaan zonder afdeling', vak.value === '@Plus ' && dW.getElementById('tagLijst').hidden && dW.activeElement === vak
      && dW.getElementById('lijstTitel').textContent === 'Plus' && koppen() === 'Groente,Zuivel,Afdeling?' && namen() === 'Appels,Kaas,Melk,Stroopwafels', koppen() + ' | ' + namen());
    vak.value = '@Plus zuiv'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('@Plus zuiv: alleen Zuivel', koppen() === 'Zuivel' && namen() === 'Kaas,Melk', koppen() + ' | ' + namen());
    const voor = wW.eval('artikelen.length');
    dW.getElementById('invoerPlus').click(); await slaap(20);
    controle('@…: de + voegt niets toe', wW.eval('artikelen.length') === voor);
    vak.value = '@Albert Heijn '; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('winkel zonder afdelingen: geen kop "Afdeling?", alleen de artikelen', koppen() === '' && namen() === 'Kaas', koppen() + ' | ' + namen());
    /* Het eerste teken beslist: "@#" zoekt een winkel die met # begint (geen), "#@" een tag die met @ begint (geen). */
    vak.focus(); vak.value = '@'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('@: winkellijst zichtbaar, ook nadat de tagcode reageerde', !dW.getElementById('tagLijst').hidden && dW.getElementById('tagLijst').getAttribute('aria-label') === 'Winkels');
    /* Omgekeerde volgorde nabootsen: een tagkeuze die ná de winkelkeuze luistert, mag het lijstje niet weghalen. */
    wW.eval("tagKeuze('invoerTekst', () => artikelen.map((a) => a.notitie))");
    vak.value = '@P'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('@ met de tagcode ná de winkelcode: winkellijst blijft zichtbaar', !dW.getElementById('tagLijst').hidden && /Plus/.test(dW.getElementById('tagLijst').textContent));
    vak.value = '@#'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('"@#": zoekt een winkel die met # begint → geen lijst', dW.getElementById('tagLijst').hidden);
    vak.value = '#@'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('"#@": zoekt een tag die met @ begint → geen lijst', dW.getElementById('tagLijst').hidden);
    /* Spatie na @: werkt ook. */
    vak.value = '@ plus zuiv'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('"@ plus zuiv" (spatie na @, kleine letters): zelfde als "@Plus zuiv"', koppen() === 'Zuivel' && namen() === 'Kaas,Melk', koppen() + ' | ' + namen());
    vak.value = '  @plus'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('"  @plus" (spaties ervoor): ook de Plus', dW.getElementById('lijstTitel').textContent === 'Plus' && namen() === 'Appels,Kaas,Melk,Stroopwafels', namen());
    /* Soort volgt het filter dat je tijdens het zoeken aantikt. */
    vak.focus(); vak.value = 'Peren'; vak.dispatchEvent(new wW.Event('input')); await slaap(20);
    [...dW.querySelectorAll('#filters .filter')][2].click(); await slaap(20);
    dW.getElementById('invoerPlus').click(); await slaap(30);
    controle('tijdens zoeken Wekelijks aangetikt → nieuw artikel wekelijks', wW.eval("(artikelen.find((a) => a.naam === 'Peren') || {}).soort") === 'wekelijks', wW.eval("(artikelen.find((a) => a.naam === 'Peren') || {}).soort"));
  }

  /* 5z34. Winkel: afdelingen als rijen; een afdeling opent een eigen scherm met de artikelen en "Artikel" om artikelen hierheen te halen of nieuw te maken. */
  if (deel('5z34 winkel: artikelen per afdeling')) {
    const odW = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus;route=Groente|Zuivel|Brood\nwinkel;Albert Heijn\nwinkel;Gamma\n' +
      'artikel;Appels;ligt=Plus:Groente\nartikel;Melk;ligt=Plus:Zuivel\nartikel;Kaas;ligt=Plus:Zuivel|Albert Heijn\nartikel;Stroopwafels;ligt=Plus|Albert Heijn\nartikel;Schroeven\n');
    const wW = await start(odW);
    await rust(1500);
    const dW = wW.document;
    dW.getElementById('tab-winkels').click(); await slaap(30);
    const open = (naam) => { [...dW.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith(naam)).click(); };
    open('Plus'); await slaap(30);
    const afd = () => [...dW.querySelectorAll('#afdelingen .afdrij')].map((r) => r.querySelector('.nm').textContent + r.querySelector('.tal').textContent).join();
    const items = () => [...dW.querySelectorAll('#afdArtikelen .item, #afdelingen .item')].map((r) => r.querySelector('.naam > span').textContent).join();
    controle('afdelingen in de route als rijen met aantal en pijltje, Afdeling? onderaan, geen knop "alles"', afd() === 'Groente1,Zuivel2,Brood0,Afdeling?1' && !dW.querySelector('#afdelingen .item') && !dW.querySelector('#afdelingen .greep') &&
      !dW.querySelector('#winkelDetail .alles') && !!dW.querySelector('#afdelingen .afdrij svg') && !dW.querySelector('#afdelingen .afdrij[aria-expanded]'), afd());
    const kop = (n) => [...dW.querySelectorAll('#afdelingen .afdrij')].find((r) => r.querySelector('.nm').textContent === n);
    kop('Zuivel').click(); await slaap(30);
    const scherm = () => (dW.querySelector('#winkelDetail h2 .nm') || {}).textContent + '/' + (dW.querySelector('#winkelDetail h2 .sub') || {}).textContent;
    controle('tik op Zuivel: eigen scherm met de artikelen, winkel eronder, invoer "Artikel"', scherm() === 'Zuivel/Plus' && items() === 'Kaas,Melk' && !dW.getElementById('afdelingen') &&
      dW.getElementById('winkelsTekst').placeholder === 'Artikel' && dW.querySelector('#winkelDetail .kopbalk h3').textContent === 'Artikelen' && dW.querySelector('#winkelDetail .kopbalk .tal').textContent === '2' && !!dW.querySelector('#winkelDetail .bewerk'), scherm() + ' | ' + items());
    const kaas = [...dW.querySelectorAll('#afdArtikelen .item')].find((r) => r.textContent.startsWith('Kaas'));
    controle('onder een artikel alleen de andere winkels', kaas.querySelector('.winkels').textContent === 'Albert Heijn', kaas.querySelector('.winkels').textContent);
    const rijA = (n) => [...dW.querySelectorAll('#afdArtikelen .item')].find((r) => r.textContent.startsWith(n));
    rijA('Melk').querySelector('.rondje').click(); await slaap(30);
    controle('rondje zet op de lijst; je blijft in de afdeling', wW.eval("!!artikelen.find((a) => a.naam === 'Melk').op") && scherm() === 'Zuivel/Plus' && rijA('Melk').querySelector('.rondje').getAttribute('aria-pressed') === 'true');
    rijA('Melk').querySelector('.rondje').click(); await slaap(30);
    controle('nog eens: weer eraf', wW.eval("!artikelen.find((a) => a.naam === 'Melk').op"));
    rijA('Kaas').querySelector('.tekst').click(); await slaap(30);
    controle('tik op de naam: editor open, op het tabblad Winkels', !dW.getElementById('artikelScherm').hidden && dW.getElementById('artikelScherm').parentNode.id === 'deel' && wW.getComputedStyle(dW.getElementById('scherm-winkels')).display === 'none' &&
      dW.getElementById('artikelNaam').value === 'Kaas' && dW.getElementById('balk-winkels').hidden && !dW.getElementById('balk-artikel').hidden);
    dW.getElementById('artikelDicht').click(); await slaap(30);
    controle('editor dicht: terug in de afdeling', dW.getElementById('artikelScherm').hidden && scherm() === 'Zuivel/Plus' && !dW.getElementById('balk-winkels').hidden && !dW.getElementById('midden').classList.contains('indeel'), scherm());
    /* terugknop: eerst het artikel, dan de afdeling, dan de winkel */
    rijA('Melk').querySelector('.tekst').click(); await slaap(30);
    wW.history.back(); await slaap(80);
    controle('terugknop vanuit het artikel: terug in de afdeling', dW.getElementById('artikelScherm').hidden && scherm() === 'Zuivel/Plus', scherm());
    wW.history.back(); await slaap(80);
    controle('nog eens terug: de route van de winkel', !!dW.getElementById('afdelingen') && dW.querySelector('#winkelDetail h2').textContent === 'Plus' && dW.getElementById('winkelsTekst').placeholder === 'Afdeling', dW.querySelector('#winkelDetail h2').textContent);
    wW.history.back(); await slaap(80);
    controle('nog eens terug: het overzicht van de winkels', dW.getElementById('winkelDetail').hidden && !dW.getElementById('winkelsOverzicht').hidden && !dW.getElementById('scherm-winkels').hidden);
    open('Plus'); await slaap(30);
    /* daarna op Artikelen: de editor opent daar weer gewoon */
    dW.getElementById('tab-boodschappen').click(); await slaap(30);
    const iv = dW.getElementById('invoerTekst'); iv.value = 'Appels'; iv.dispatchEvent(new wW.Event('input')); await slaap(20);
    const rij = [...dW.querySelectorAll('#lijst .item')][0];
    rij.querySelector('.tekst').click(); await slaap(30);
    controle('editor vanuit Artikelen: weer op Artikelen', !dW.getElementById('artikelScherm').hidden && !dW.getElementById('scherm-boodschappen').hidden && wW.getComputedStyle(dW.getElementById('scherm-boodschappen')).display === 'none');
    dW.getElementById('artikelDicht').click(); await slaap(30);
    iv.value = ''; iv.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('editor dicht: Artikelen terug met de balk', dW.getElementById('artikelScherm').hidden && !dW.getElementById('balk-boodschappen').hidden && !dW.getElementById('midden').classList.contains('indeel'));
    /* teller in de afdeling */
    dW.getElementById('tab-winkels').click(); await slaap(30);
    open('Plus'); await slaap(30); kop('Zuivel').click(); await slaap(20);
    const kaasRij = () => rijA('Kaas');
    kaasRij().querySelector('.icoon').click(); await slaap(30);
    const tl = () => dW.querySelector('#winkelDetail .teller');
    controle('tik op het icoon: de teller onder het artikel, niet de editor', !!tl() && tl().dataset.id === kaasRij().dataset.id && dW.getElementById('artikelScherm').hidden && kaasRij().querySelector('.icoon').getAttribute('aria-expanded') === 'true');
    tl().querySelector('.meer').click(); await slaap(30);
    controle('teller +: 2× achter de naam, teller blijft open, in de afdeling', kaasRij().querySelector('.aantal').textContent === '2×' && !!tl() && tl().querySelector('.n').textContent === '2' && scherm() === 'Zuivel/Plus', scherm());
    tl().querySelector('.n').click(); await slaap(20);
    controle('tik op het getal: teller blijft open', !!tl());
    tl().querySelector('span').click(); await slaap(20);
    controle('tik naast de knoppen: teller dicht', !tl());
    kaasRij().querySelector('.aantal').click(); await slaap(20);
    controle('tik op "2×": teller weer open', !!tl() && dW.getElementById('artikelScherm').hidden);
    kaasRij().querySelector('.icoon').click(); await slaap(20);
    controle('nog een tik op het icoon: teller dicht', !tl());
    controle('teller in de winkel raakt Artikelen niet', wW.eval('scherm.teller') === '');
    /* typen in de afdeling: artikelen van deze winkel die elders liggen, en + Nieuw */
    const vak = dW.getElementById('winkelsTekst');
    const typ = async (t) => { vak.focus(); vak.value = t; vak.dispatchEvent(new wW.Event('input')); await slaap(20); };
    const keuze = () => dW.getElementById('tagLijst').hidden ? '' : [...dW.querySelectorAll('#tagLijst .tagoptie')].map((b) => b.querySelector('.nm').firstChild.textContent + ':' + ((b.querySelector('.sub') || {}).textContent || '')).join(',');
    await typ('a');
    controle('typen: artikelen van deze winkel die elders liggen (met waar), en + Nieuw; andere winkels niet', keuze() === 'Appels:Groente,Stroopwafels:Afdeling?,+ Nieuw: "a":', keuze());
    controle('typen filtert ook de lijst van de afdeling, kop telt wat je ziet', items() === 'Kaas' && dW.querySelector('#winkelDetail .kopbalk .tal').textContent === '1', items());
    [...dW.querySelectorAll('#tagLijst .tagoptie')][0].click(); await slaap(30);
    controle('Appels kiezen: ligt nu in Zuivel, vak leeg, lijstje dicht', items() === 'Appels,Kaas,Melk' && vak.value === '' && dW.getElementById('tagLijst').hidden && wW.eval("artikelen.find((a) => a.naam === 'Appels').plekken.map((p) => winkelOpId.get(p.winkel).naam + ':' + p.afd).join()") === 'Plus:' + wW.eval("winkels.find((w) => w.naam === 'Plus').afdelingen[1].id"), items());
    await typ('schroeven');
    controle('Schroeven (nergens te koop): alleen + Nieuw', keuze() === '+ Nieuw: "schroeven":', keuze());
    dW.getElementById('winkelsPlus').click(); await slaap(30);
    controle('+ bij een bestaande naam: geen tweede artikel, het bestaande ligt nu hier', items() === 'Appels,Kaas,Melk,Schroeven' && wW.eval("artikelen.filter((a) => normNaam(a.naam) === 'schroeven').length") === 1, items());
    await typ('Yoghurt'); vak.dispatchEvent(new wW.KeyboardEvent('keydown', { key: 'Enter' })); await slaap(30);
    controle('Enter: nieuw artikel, regelmatig, meteen in deze afdeling', items() === 'Appels,Kaas,Melk,Schroeven,Yoghurt' && wW.eval("(artikelen.find((a) => a.naam === 'Yoghurt') || {}).soort") === 'regelmatig' && !wW.eval("artikelen.find((a) => a.naam === 'Yoghurt').op"), items());
    await typ('stroopwafels');
    controle('precieze naam in het lijstje: geen + Nieuw ernaast', keuze() === 'Stroopwafels:Afdeling?', keuze());
    await typ('kaas');
    controle('wat hier al ligt: geen + Nieuw', keuze() === '', keuze());
    await typ('');
    dW.querySelector('#winkelDetail .bewerk').click(); await slaap(20);
    controle('potlood: "Afdeling bewerken" met de naam', !!dW.getElementById('keuze') && dW.getElementById('keuze').getAttribute('aria-label') === 'Afdeling bewerken' && dW.getElementById('bewerkNaam').value === 'Zuivel');
    dW.querySelector('#keuze .kruis').click(); await slaap(20);
    dW.querySelector('#winkelDetail .terug').click(); await slaap(30);
    controle('terug: de route, met de nieuwe aantallen', afd() === 'Groente0,Zuivel5,Brood0,Afdeling?1', afd());
    kop('Afdeling?').click(); await slaap(30);
    controle('Afdeling?: de artikelen zonder afdeling, geen potlood', scherm() === 'Afdeling?/Plus' && items() === 'Stroopwafels' && !dW.querySelector('#winkelDetail .bewerk'), scherm() + ' | ' + items());
    rijA('Stroopwafels').querySelector('.tekst').click(); await slaap(30);
    dW.getElementById('tab-doen').click(); await slaap(30);
    controle('tabblad wisselen met de editor open: editor dicht, geen deelscherm meer', dW.getElementById('artikelScherm').hidden && !dW.getElementById('midden').classList.contains('indeel') && !dW.getElementById('scherm-doen').hidden && dW.getElementById('balk-winkels').hidden);
    /* Volgorde-knop */
    dW.getElementById('tab-winkels').click(); await slaap(30);
    if (!dW.getElementById('winkelsOverzicht').hidden) open('Plus');
    if (dW.querySelector('#winkelDetail h2 .sub')) dW.querySelector('#winkelDetail .terug').click();
    await slaap(30);
    dW.querySelector('#winkelDetail .kopbalk .volgorde').click(); await slaap(20);
    controle('Volgorde: greepjes en potloden, geen artikelen, geen Afdeling?', dW.querySelectorAll('#afdelingen .arij .greep').length === 3 && dW.querySelectorAll('#afdelingen .potlood').length === 3 &&
      !dW.querySelector('#afdelingen .afdrij') && !dW.querySelector('#afdelingen .item'));
    dW.querySelector('#afdelingen .potlood').click(); await slaap(20);
    controle('potlood: "Afdeling bewerken"', !!dW.getElementById('keuze') && dW.getElementById('keuze').getAttribute('aria-label') === 'Afdeling bewerken' && dW.getElementById('bewerkNaam').value === 'Groente');
    dW.querySelector('#keuze .kruis').click(); await slaap(20);
    dW.querySelector('#winkelDetail .kopbalk .volgorde').click(); await slaap(20);
    controle('ster: vaste naam, alleen ingedrukt wisselt', (() => { const st = dW.querySelector('#winkelDetail .ster'); const v = st.getAttribute('aria-pressed'); st.click();
      const st2 = dW.querySelector('#winkelDetail .ster'); const ok = st2.getAttribute('aria-label') === 'Favoriet' && st2.getAttribute('aria-pressed') !== v; st2.click(); return ok; })());
    controle('Volgorde-knop: vaste naam, alleen ingedrukt wisselt', dW.querySelector('#winkelDetail .volgorde').getAttribute('aria-label') === 'Volgorde wijzigen');
    controle('nog eens op de knop: weer gewoon', !dW.querySelector('#afdelingen .greep') && dW.querySelectorAll('#afdelingen .afdrij').length === 4);
    /* zoeken in de winkel: alleen passende afdelingen */
    const vk = dW.getElementById('winkelsTekst');
    vk.value = 'zui'; vk.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('zoeken in de winkel: alleen Zuivel', afd() === 'Zuivel5', afd());
    vk.value = 'afd'; vk.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('zoeken op "afd": de regel "Afdeling?" (zoekt op wat er staat)', afd() === 'Afdeling?1', afd());
    vk.value = 'xyz'; vk.dispatchEvent(new wW.Event('input')); await slaap(20);
    controle('zoeken zonder treffer: Niets gevonden', /Niets gevonden/.test(dW.getElementById('afdelingen').textContent) && !dW.querySelector('#afdelingen .afdrij'));
    vk.value = ''; vk.dispatchEvent(new wW.Event('input')); await slaap(20);
    /* een andere winkel: niets open, Volgorde uit */
    dW.querySelector('#winkelDetail .kopbalk .volgorde').click(); await slaap(20);
    dW.querySelector('#winkelDetail .terug').click(); await slaap(30);
    open('Albert Heijn'); await slaap(30);
    controle('winkel zonder afdelingen: meteen de artikelen onder "Artikelen", geen Volgorde- en alles-knop', dW.querySelector('#winkelDetail .kopbalk h3').textContent === 'Artikelen' &&
      dW.querySelector('#winkelDetail .kopbalk .tal').textContent === '2' && items() === 'Kaas,Stroopwafels' && !dW.querySelector('#winkelDetail .volgorde') && !dW.querySelector('#winkelDetail .alles'), items());
    dW.querySelector('#winkelDetail .terug').click(); await slaap(30);
    open('Gamma'); await slaap(30);
    controle('winkel zonder artikelen: "Geen artikelen"', /Geen artikelen/.test(dW.getElementById('afdelingen').textContent) && dW.querySelector('#winkelDetail .kopbalk .tal').textContent === '');
    dW.querySelector('#winkelDetail .terug').click(); await slaap(30);
    open('Plus'); await slaap(30);
    controle('opnieuw geopend: de route, Volgorde uit', afd() === 'Groente0,Zuivel5,Brood0,Afdeling?1' && dW.querySelector('#winkelDetail .volgorde').getAttribute('aria-pressed') === 'false', afd());
    wW.close();
  }

  /* 5z35. Deelschermen: het tabblad eronder tekent niet zolang er iets open is, wel bij sluiten; zelfde scrollpositie en balk. */
  if (deel('5z35 deelschermen: tabblad eronder en scrollpositie')) {
    const nu = new Date(); const tijd = datumTekstT(0) + 'T09:00';
    const odS = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nactie;Afval;herhaal=week;datum=' + datumTekstT(3) + '\nactie;Bellen\n' +
      'historie;Bellen;tijd=' + tijd + '\naankoop;Melk;tijd=' + tijd + '\nartikel;Melk;op=' + tijd + '\n');
    const wS = await start(odS); await rust(1500); const dS = wS.document;
    const midden = dS.getElementById('midden');
    dS.getElementById('tab-doen').click(); await slaap(30);
    wS.eval("doen.filter = 'alles'; tekenDoen()");
    midden.scrollTop = 150;
    const aid = wS.eval("acties.find((a) => a.naam === 'Afval').id");
    [...dS.querySelectorAll('#doenLijst .actierij')].find((r) => r.textContent.includes('Afval')).querySelector('.nm').click(); await slaap(30);
    controle('actie-editor open: in de laag, Doen verborgen, balk Opslaan', !dS.getElementById('actieScherm').hidden && midden.classList.contains('indeel') && dS.getElementById('balk-doen').hidden && !dS.getElementById('balk-actie').hidden && midden.scrollTop === 0);
    const lijstVoor = dS.getElementById('doenLijst').innerHTML;
    const j = JSON.parse(odS.bestanden['thuis.json'].tekst); j.acties.nwx01 = { naam: 'Ramen lappen' }; odS.zet('thuis.json', JSON.stringify(j));
    wS.eval('planSync(0)'); await rust(2500);
    controle('sync met de editor open: Doen eronder niet hertekend', wS.eval("acties.some((a) => a.naam === 'Ramen lappen')") && dS.getElementById('doenLijst').innerHTML === lijstVoor && !/Ramen lappen/.test(dS.getElementById('doenLijst').textContent));
    dS.getElementById('actieDicht').click(); await slaap(30);
    controle('editor dicht: Doen bijgewerkt, zelfde scrollpositie, balk Doen terug', /Ramen lappen/.test(dS.getElementById('doenLijst').textContent) && midden.scrollTop === 150 &&
      !midden.classList.contains('indeel') && dS.getElementById('deel').hidden && !dS.getElementById('balk-doen').hidden && dS.getElementById('balk-actie').hidden, midden.scrollTop);
    /* Historie */
    midden.scrollTop = 120;
    [...dS.querySelectorAll('#doenLijst .naaraankopen')].find((k) => /Historie/.test(k.textContent)).querySelector('button').click(); await slaap(30);
    controle('Historie open: balk zoeken, Doen-balk weg, bovenaan', !dS.getElementById('historieScherm').hidden && !dS.getElementById('balk-log').hidden && dS.getElementById('balk-doen').hidden && midden.scrollTop === 0);
    const doenVoor = dS.getElementById('doenLijst').innerHTML;
    const j2 = JSON.parse(odS.bestanden['thuis.json'].tekst); j2.acties.nwx02 = { naam: 'Gras maaien' }; odS.zet('thuis.json', JSON.stringify(j2));
    wS.eval('planSync(0)'); await rust(2500);
    controle('sync met Historie open: Doen eronder niet hertekend', wS.eval("acties.some((a) => a.naam === 'Gras maaien')") && dS.getElementById('doenLijst').innerHTML === doenVoor);
    dS.querySelector('#historieScherm .terug').click(); await slaap(30);
    controle('Historie dicht: Doen bijgewerkt', /Gras maaien/.test(dS.getElementById('doenLijst').textContent));
    controle('Historie dicht: zelfde plek, balk Doen terug, zoekbalk weg', midden.scrollTop === 120 && !dS.getElementById('balk-doen').hidden && dS.getElementById('balk-log').hidden && dS.getElementById('historieScherm').innerHTML === '');
    /* Aankopen (Boodschappen heeft geen eigen balk) */
    dS.getElementById('tab-winkel').click(); await slaap(50);
    midden.scrollTop = 80;
    dS.querySelector('#winkelLijst .naaraankopen button').click(); await slaap(30);
    controle('Aankopen open: zoekbalk, in de laag', !dS.getElementById('aankopenScherm').hidden && !dS.getElementById('balk-log').hidden && midden.classList.contains('indeel'));
    wS.history.back(); await slaap(100);
    controle('Aankopen dicht met terug: zelfde plek, geen balk', midden.scrollTop === 80 && dS.getElementById('balk-log').hidden && !midden.classList.contains('indeel') && !dS.getElementById('scherm-winkel').hidden);
    /* Historie open en dan een ander tabblad: alles dicht, nieuw tabblad bovenaan */
    dS.getElementById('tab-doen').click(); await slaap(30);
    [...dS.querySelectorAll('#doenLijst .naaraankopen')].find((k) => /Historie/.test(k.textContent)).querySelector('button').click(); await slaap(30);
    dS.getElementById('tab-boodschappen').click(); await slaap(30);
    controle('Historie open, ander tabblad: laag dicht, alleen de balk van Artikelen', dS.getElementById('deel').hidden && !midden.classList.contains('indeel') && !dS.getElementById('balk-boodschappen').hidden &&
      dS.getElementById('balk-log').hidden && dS.getElementById('balk-doen').hidden && midden.scrollTop === 0);
    wS.close();
  }

  /* 5z36. Aantallen: per afdeling in Boodschappen; Aankopen en Historie ook bij 0. */
  if (deel('5z36 aantallen bij afdelingen, Aankopen en Historie')) {
    const t = datumTekstT(0) + 'T09:00';
    const odT = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus;route=Groente|Zuivel\n' +
      'artikel;Appels;ligt=Plus:Groente;op=' + t + '\nartikel;Melk;ligt=Plus:Zuivel;op=' + t + '\nartikel;Kaas;ligt=Plus:Zuivel;op=' + t + '\nartikel;Stroop;notitie=za tot 17:00 (#klussen) [#pas "#op"];ligt=Plus;op=' + t + '\n');
    const wT = await start(odT); await rust(1500); const dT = wT.document;
    wT.eval("winkel.id = winkels.find((w) => w.naam === 'Plus').id");
    dT.getElementById('tab-winkel').click(); await slaap(50);
    const koppen = () => [...dT.querySelectorAll('#winkelLijst .afd .afdkop')].map((k) => k.firstChild.textContent + ':' + (k.querySelector('.tal') ? k.querySelector('.tal').textContent : '')).join();
    const nst = [...dT.querySelectorAll('#winkelLijst .wrij')].find((r) => r.textContent.startsWith('Stroop')).querySelector('.notitie');
    controle('notitie: tags op de tweede regel, lege haakjes en aanhalingstekens weg', [...nst.children].map((c) => c.textContent).join(' / ') === 'za tot 17:00 / #klussen#pas#op', [...nst.children].map((c) => c.textContent).join(' / '));
    controle('Boodschappen: aantal rechts in elke afdelingskop', koppen() === 'Afdeling?:1,Groente:1,Zuivel:2', koppen());
    const aank = dT.querySelector('#winkelLijst .naaraankopen .waarde');
    controle('Aankopen zonder aankopen: "0"', !!aank && aank.textContent === '0', aank && aank.textContent);
    dT.getElementById('tab-doen').click(); await slaap(30);
    const hist = [...dT.querySelectorAll('#doenLijst .naaraankopen')].find((k) => /Historie/.test(k.textContent));
    controle('Historie zonder regels: "0"', !!hist && hist.querySelector('.waarde').textContent === '0', hist && hist.textContent);
    wT.close();
  }

  /* 5z37. Filters op Artikelen uitzetten: nog een tik op het gekozen vakje = alle artikelen. */
  if (deel('5z37 filter uit: alle artikelen')) {
    const t = datumTekstT(0) + 'T09:00';
    const odF = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\n' +
      'artikel;Appels;soort=wekelijks;op=' + t + '\nartikel;Bananen;soort=wekelijks\nartikel;Kaas;soort=regelmatig\nartikel;Lamp;op=' + t + '\nartikel;Schroeven;gekocht=' + datumTekstT(-2) + '\n');
    const wF = await start(odF); await rust(1500); const dF = wF.document;
    const knop = (i) => [...dF.querySelectorAll('#filters .filter')][i];
    const namen = () => [...dF.querySelectorAll('#lijst .item')].map((r) => naamVanRij(r)).join();
    controle('standaard: Op de lijst aan', knop(0).getAttribute('aria-pressed') === 'true' && namen() === 'Appels,Bananen,Lamp', namen());  /* Bananen: wekelijks terug op de lijst */
    knop(0).click(); await slaap(30);
    controle('nog een tik: geen vakje aan, "Alle artikelen", gekochte eenmalige in het archief', [...dF.querySelectorAll('#filters .filter')].every((b) => b.getAttribute('aria-pressed') === 'false') &&
      dF.getElementById('lijstTitel').textContent === 'Alle artikelen' && namen() === 'Appels,Bananen,Kaas,Lamp' && !!dF.getElementById('archief') && dF.querySelector('#archief .kopbalk .tal').textContent === '1', namen() + ' | ' + ((dF.getElementById('archief') || {}).textContent || 'geen archief'));
    controle('alle artikelen: aantal rechts', dF.getElementById('lijstAantal').textContent === '4', dF.getElementById('lijstAantal').textContent);
    const iv = dF.getElementById('invoerTekst'); iv.value = 'Peren'; iv.dispatchEvent(new wF.Event('input')); dF.getElementById('invoerPlus').click(); await slaap(50);
    iv.value = ''; iv.dispatchEvent(new wF.Event('input')); iv.blur(); await slaap(30);
    controle('nieuw zonder vakje: eenmalig, op de lijst, filter blijft uit', wF.eval("(artikelen.find((a) => a.naam === 'Peren') || {}).soort") === 'eenmalig' && wF.eval('scherm.filter') === '' && /Peren/.test(namen()), wF.eval('scherm.filter') + ' ' + namen());
    knop(2).click(); await slaap(30);
    controle('een ander vakje: weer gewoon dat filter', knop(2).getAttribute('aria-pressed') === 'true' && namen() === 'Appels,Bananen', namen());
    knop(2).click(); await slaap(30);
    controle('en weer uit', wF.eval('scherm.filter') === '' && dF.getElementById('lijstTitel').textContent === 'Alle artikelen');
    wF.close();
  }

  /* 5z38. Boodschappen: "Elders" en "Winkelmand" dicht bij een andere winkel; open blijft open in dezelfde winkel. */
  if (deel('5z38 niet bij en winkelmand: dicht per winkel')) {
    const t = datumTekstT(0) + 'T09:00';
    const odM = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus\nwinkel;AH\n' +
      'artikel;Melk;ligt=Plus;op=' + t + '\nartikel;Brood;ligt=Plus;op=' + t + '\nartikel;Kaas;ligt=AH;op=' + t + '\n');
    const wM = await start(odM); await rust(1500); const dM = wM.document;
    const plus = wM.eval("winkels.find((w) => w.naam === 'Plus').id"), ah = wM.eval("winkels.find((w) => w.naam === 'AH').id");
    wM.eval("kiesWinkel('" + plus + "')");
    dM.getElementById('tab-winkel').click(); await slaap(30);
    const lijst = dM.getElementById('winkelLijst');
    [...lijst.querySelectorAll('.wrij .vink')].find((b) => b.textContent.includes('Melk')).click(); await rust(1800);
    const stand = () => [!!lijst.querySelector('.elderspijl[aria-expanded="true"]'), !!lijst.querySelector('.mandpijl[aria-expanded="true"]')].join();
    controle('na afvinken: Elders en Winkelmand dicht', stand() === 'false,false', stand());
    lijst.querySelector('.elderspijl').closest('.afdkop').querySelector('span').click(); await slaap(20);
    lijst.querySelector('.winkelkies').click(); await slaap(20);
    controle('winkelicoon bij Elders: opent "Welke winkel?", klapt niet', !!dM.getElementById('keuze') && /Welke winkel/.test(dM.querySelector('#keuze .kop').textContent) && stand().startsWith('true'), stand());
    dM.querySelector('#keuze .kruis').click(); await slaap(20);
    lijst.querySelector('.mandpijl').closest('.afdkop').querySelector('span').click(); await slaap(20);
    controle('allebei open', stand() === 'true,true', stand());
    dM.getElementById('tab-boodschappen').click(); await slaap(20); dM.getElementById('tab-winkel').click(); await slaap(30);
    controle('ander tabblad en terug: nog open', stand() === 'true,true', stand());
    wM.eval("kiesWinkel('" + plus + "')"); await slaap(20);
    controle('dezelfde winkel opnieuw kiezen: nog open', stand() === 'true,true', stand());
    wM.eval("kiesWinkel('" + ah + "')"); await slaap(20);
    controle('andere winkel: allebei weer dicht', stand().indexOf('true') === -1, stand());
    const kaartRijen = () => lijst.querySelector('.winkelkaart:not(.zonder)') ? lijst.querySelector('.winkelkaart:not(.zonder)').querySelectorAll('.wrij').length : -1;
    const voor = kaartRijen();
    dM.getElementById('winkelNaam').click(); await slaap(20);
    controle('winkelkop: tik klapt de winkel dicht (alleen de kop), pijltje dicht', voor > 0 && kaartRijen() === 0 && dM.getElementById('winkelPijl').getAttribute('aria-expanded') === 'false', voor + '/' + kaartRijen());
    dM.getElementById('winkelKies').click(); await slaap(20);
    controle('winkelicoon in de kop: opent "Welke winkel?", klapt niet', !!dM.getElementById('keuze') && kaartRijen() === 0);
    dM.querySelector('#keuze .kruis').click(); await slaap(20);
    wM.eval("kiesWinkel('" + plus + "')"); await slaap(20);
    controle('andere winkel kiezen: de winkel weer open', kaartRijen() > 0 && dM.getElementById('winkelPijl').getAttribute('aria-expanded') === 'true');
    wM.eval("kiesWinkel('" + ah + "')"); await slaap(20);
    /* In de AH ook iets afvinken: twee winkels in het mandje. */
    [...lijst.querySelectorAll('.wrij .vink')].find((b) => b.textContent.includes('Kaas')).click(); await rust(1800);
    lijst.querySelector('.mandpijl').closest('.afdkop').querySelector('span').click(); await slaap(20);
    const mw = () => [...lijst.querySelector('.mandpijl').closest('.afd').querySelectorAll('.wrij')].map((r) => r.querySelector('.nm').firstChild.textContent + ':' + r.querySelector('.winkels').textContent).join();
    controle('twee winkels: geen subkoppen; eerst deze winkel (AH), dan Plus, winkel onder elk artikel; kop telt alles', !lijst.querySelector('.subkop') && mw() === 'Kaas:AH,Melk:Plus' && lijst.querySelector('.mandpijl').closest('.afdkop').querySelector('.tal').textContent === '2', mw());
    controle('één knop leegmaken, op de hoofdkop', lijst.querySelectorAll('.mandleeg').length === 1);
    lijst.querySelector('.mandleeg').click(); await slaap(30);
    controle('leegmaken: het hele mandje', wM.eval('winkel.mandje.size') === 0 && !lijst.querySelector('.mandpijl'));
    const mm = [...dM.querySelectorAll('.melding')].find((m) => /Winkelmand leeggemaakt/.test(m.textContent));
    mm.querySelector('button').click(); await slaap(30);
    controle('ongedaan: allebei terug', wM.eval('winkel.mandje.size') === 2);
    wM.close();
  }

  /* 5z39. Weergave (per telefoon): aantallen bij een winkel, de winkels onder een artikel op Artikelen. */
  if (deel('5z39 weergave: aantallen bij winkel, winkels bij artikel')) {
    const t = datumTekstT(0) + 'T09:00';
    const odG = onedrive('instelling;wekelijks;dag=za;tijd=06:00;teruggezet=2999-01-01T06:00\nwinkel;Plus;route=Zuivel|Brood\nwinkel;AH\nwinkel;Gamma\n' +
      'artikel;Melk;ligt=Plus:Zuivel|AH;op=' + t + '\nartikel;Kaas;ligt=Plus:Zuivel\nartikel;Stroop;ligt=AH\n');
    const wG = await start(odG, { weergave: undefined }); await rust(1500); const dG = wG.document;
    dG.getElementById('tab-winkels').click(); await slaap(30);
    const subs = () => [...dG.querySelectorAll('#winkelsOverzicht .winkelrij .nm')].map((x) => x.firstChild.textContent + ':' + (x.querySelector('.sub') ? x.querySelector('.sub').textContent : '')).join('|');
    const melk = () => [...dG.querySelectorAll('#lijst .item')].find((r) => naamVanRij(r) === 'Melk');
    controle('standaard: winkels zonder aantallen', subs() === 'AH:|Gamma:|Plus:', subs());
    dG.getElementById('tab-boodschappen').click(); await slaap(30);
    controle('standaard: geen winkelsregel onder het artikel', !!melk() && !melk().querySelector('.winkels'));
    dG.getElementById('tab-winkels').click(); await slaap(30);
    [...dG.querySelectorAll('#winkelsOverzicht .winkelrij')].find((r) => r.textContent.startsWith('Plus')).click(); await slaap(30);
    wG.eval("afdelingOpenen(winkels.find((w) => w.naam === 'Plus').afdelingen[0].id)");
    const mw = () => [...dG.querySelectorAll('#winkelDetail .item')].find((r) => naamVanRij(r) === 'Melk');
    controle('standaard: in een winkel ook geen andere winkels onder het artikel', !!mw() && !mw().querySelector('.winkels'));
    dG.getElementById('tab-instellingen').click(); await slaap(30);
    const sw1 = dG.getElementById('swWinkelTal'), sw2 = dG.getElementById('swArtikelWinkels'), sw3 = dG.getElementById('swAankoopWinkel');
    controle('instellingen: eerst winkel dan artikel; standaard uit, uit, aan', sw1.getAttribute('aria-checked') === 'false' && sw2.getAttribute('aria-checked') === 'false' && sw3.getAttribute('aria-checked') === 'true' &&
      (sw1.compareDocumentPosition(sw2) & 4) && sw1.getAttribute('role') === 'switch');
    sw1.click(); sw2.click(); await slaap(30);
    controle('schakelaars aan', sw1.getAttribute('aria-checked') === 'true' && sw2.getAttribute('aria-checked') === 'true');
    controle('per telefoon bewaard', wG.eval("JSON.stringify(KEUZES.weergave.waarde())") === '{"winkelTal":true,"artikelWinkels":true,"aankoopWinkel":true}');
    dG.getElementById('tab-winkels').click(); await slaap(30);
    controle('aan: "2 afdelingen, 2 artikelen"; zonder afdelingen alleen artikelen', subs() === 'AH:2 artikelen|Gamma:0 artikelen|Plus:2 afdelingen, 2 artikelen', subs());
    dG.getElementById('tab-boodschappen').click(); await slaap(30);
    controle('aan: winkelsregel onder het artikel', !!melk().querySelector('.winkels') && melk().querySelector('.winkels').textContent === 'AH · Plus', melk().textContent);
    controle('opgeslagen waarde gaat voor de standaard', wG.eval("(KEUZES.weergave.lees({ winkelTal: true }), JSON.stringify(weergave))") === '{"winkelTal":true,"artikelWinkels":false,"aankoopWinkel":true}');
    wG.close();
  }

  if (deel('bestand: geen UTF-8, kapot, nieuwer formaat, nog geen bestand')) {
  let od, w;
  /* 6. Een bestand dat geen UTF-8 is: melding, niets geschreven. */
  od = onedrive(null);
  od.bestanden['thuis.json'] = { bytes: new Uint8Array([0x7B, 0x7D, 0xFF, 0x0A]), eTag: '"x1"', id: 'id-thuis.json' };
  w = await start(od);
  await rust(800);
  controle('geen UTF-8: melding en geen schrijfactie', !!w.document.getElementById('m-bestand') && od.puts === 0,
    'puts=' + od.puts + ' melding=' + !!w.document.getElementById('m-bestand'));

  /* 6b. Kapotte JSON en een nieuwer formaat: melding, niets geschreven. */
  for (const [naam, tekst, woord] of [['kapot', '{"versie": "' + FORMAAT + '", "artikelen": {', 'beschadigd'], ['nieuwer', '{"versie": "FFFFFFFF-FFFF"}', 'nieuwere versie'],
    ['verkeerde opbouw', '{"versie": "' + FORMAAT + '", "artikelen": []}', 'opbouw']]) {
    od = onedrive(null);
    od.bestanden['thuis.json'] = { tekst, eTag: '"x1"', id: 'id-thuis.json' };
    w = await start(od);
    await rust(800);
    const m = w.document.getElementById('m-bestand');
    controle(naam + ': melding en geen schrijfactie', !!m && m.textContent.includes(woord) && od.puts === 0, 'puts=' + od.puts + ' ' + (m && m.textContent));
  }

  /* 7. Nog geen thuis.json: de app maakt hem aan met de standaardinstelling. */
  od = onedrive(null);
  w = await start(od);
  await rust(800);
  controle('nieuwe map: thuis.json aangemaakt', !!od.bestanden['thuis.json'] && /instelling;wekelijks;dag=za;tijd=06:00/.test(R(od.bestanden['thuis.json'].tekst)),
    JSON.stringify(Object.keys(od.bestanden)));

  }
  /* Met DEEL en niets gedraaid (tikfout, onbekend nummer): niet stil "OK". */
  if (DELEN.length && goed + fout === 0) { console.log('FOUT: geen enkel deel gevonden voor DEEL=' + DELEN.join(',')); process.exit(1); }
  console.log((fout ? 'FOUT' : 'OK') + ': ' + goed + ' goed, ' + fout + ' fout  (' + path.basename(path.dirname(APP)) + '/' + path.basename(APP) + ')');
  process.exit(fout ? 1 : 0);
})().catch((e) => { console.log('FOUT  test kon niet draaien — ' + e.message + (process.env.STACK ? e.stack : '')); process.exit(1); });
