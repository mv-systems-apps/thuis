/* Hulp voor de rooktest (thuis-dom.cjs): een korte regelschrijfwijze met namen
   (soort;naam;veld=waarde) voor testgegevens, omgezet naar en van thuis.json met
   id's. Zo blijven de verwachtingen leesbaar. Alleen voor de tests.
     instelling;wekelijks;dag=za;tijd=06:00
     winkel;Albert Heijn;route=Groente & fruit|Zuivel
     artikel;Melk;soort=wekelijks;ligt=Albert Heijn:Zuivel|Plus;op=…;gekocht=a|b */
const FORMAAT = /const FORMAAT = '([^']+)'/.exec(require('fs').readFileSync(process.env.APP || require('path').join(__dirname, 'thuis.html'), 'utf8'))[1];

function regelsNaarJson(tekst) {
  const d = { versie: FORMAAT, instellingen: {}, winkels: {}, artikelen: {}, acties: {} };
  let n = 0;
  const id = (p) => p + String(++n).padStart(4, '0');
  const winkelId = new Map(), afdId = new Map();
  for (const regel of tekst.split(/\r?\n/)) {
    if (!regel.trim()) continue;
    const [soort, naam, ...rest] = regel.split(';');
    const v = {};
    for (const x of rest) { const i = x.indexOf('='); v[x.slice(0, i)] = x.slice(i + 1); }
    if (soort === 'instelling') { d.instellingen[naam] = v; continue; }
    if (soort === 'winkel') {
      const w = id('w'); winkelId.set(naam, w);
      const o = { naam };
      if (v.route) o.afdelingen = v.route.split('|').map((a) => { const ai = id('a'); afdId.set(naam + ':' + a, ai); return { id: ai, naam: a }; });
      d.winkels[w] = o;
      continue;
    }
    const o = { naam };
    for (const k of Object.keys(v)) {
      if (k === 'ligt') {
        o.ligt = {};
        for (const p of v.ligt.split('|').filter(Boolean)) {
          const j = p.indexOf(':'); const wn = j < 0 ? p : p.slice(0, j); const an = j < 0 ? '' : p.slice(j + 1);
          o.ligt[winkelId.get(wn)] = an ? afdId.get(wn + ':' + an) : '';
        }
      } else if (k === 'gekocht') o.gekocht = v.gekocht.split('|');
      else o[k] = v[k];
    }
    d[soort === 'artikel' ? 'artikelen' : 'acties'][id(soort === 'artikel' ? 'p' : 'c')] = o;
  }
  return JSON.stringify(d);
}

function jsonNaarRegels(tekst) {
  const d = JSON.parse(tekst);
  const uit = [];
  const wNaam = (w) => (d.winkels[w] ? d.winkels[w].naam : '?' + w);
  const aNaam = (w, a) => { const x = d.winkels[w] && (d.winkels[w].afdelingen || []).find((y) => y.id === a); return x ? x.naam : '?' + a; };
  for (const n of Object.keys(d.instellingen || {})) uit.push(['instelling', n].concat(Object.keys(d.instellingen[n]).map((k) => k + '=' + d.instellingen[n][k])).join(';'));
  for (const w of Object.keys(d.winkels || {})) {
    const o = d.winkels[w];
    uit.push(['winkel', o.naam].concat(o.afdelingen ? ['route=' + o.afdelingen.map((a) => a.naam).join('|')] : [],
      Object.keys(o).filter((k) => k !== 'naam' && k !== 'afdelingen').map((k) => k + '=' + o[k])).join(';'));
  }
  for (const deel of ['artikelen', 'acties']) {
    for (const id of Object.keys(d[deel] || {})) {
      const o = d[deel][id];
      const velden = Object.keys(o).filter((k) => k !== 'naam').map((k) => {
        if (k === 'ligt') return 'ligt=' + Object.keys(o.ligt).map((w) => o.ligt[w] ? wNaam(w) + ':' + aNaam(w, o.ligt[w]) : wNaam(w)).join('|');
        return k + '=' + (Array.isArray(o[k]) ? o[k].join('|') : o[k]);
      });
      uit.push([deel === 'artikelen' ? 'artikel' : 'actie', o.naam].concat(velden).join(';'));
    }
  }
  return uit.join('\n') + (uit.length ? '\n' : '');
}

module.exports = { regelsNaarJson, jsonNaarRegels, FORMAAT };
