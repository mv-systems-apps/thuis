/* Hulp voor de tests: de oude regelopmaak (soort;naam;veld=waarde) als korte
   schrijfwijze voor testgegevens, omgezet naar en van thuis.json. Zo blijven de
   verwachtingen in de tests op één regel leesbaar. Alleen voor de tests. */
const FORMAAT = '1352902-3FF';
const SECTIE = { instelling: 'instellingen', winkel: 'winkels', artikel: 'artikelen', actie: 'acties', hernoemd: 'hernoemd' };
const LIJST = { afdelingen: true, gekocht: true, namen: true };

function regelsNaarJson(tekst) {
  const d = { versie: FORMAAT, instellingen: {}, winkels: {}, artikelen: {}, acties: {}, hernoemd: [] };
  for (const regel of tekst.split(/\r?\n/)) {
    if (!regel.trim()) continue;
    const delen = regel.split(';');
    const soort = delen[0];
    const vast = soort === 'hernoemd' ? 2 : 1;
    const o = {};
    for (const v of delen.slice(1 + vast)) {
      const i = v.indexOf('=');
      let k = v.slice(0, i), w = v.slice(i + 1);
      if (soort === 'winkel' && k === 'route') k = 'afdelingen';
      if (k === 'ligt') {
        const l = {};
        for (const p of w.split('|').filter(Boolean)) { const j = p.indexOf(':'); if (j < 0) l[p] = ''; else l[p.slice(0, j)] = p.slice(j + 1); }
        o[k] = l;
      } else o[k] = LIJST[k] ? w.split('|').filter(Boolean) : w;
    }
    if (soort === 'hernoemd') d.hernoemd.push(Object.assign({ soort: delen[1], oud: delen[2] }, o));
    else d[SECTIE[soort]][delen[1]] = o;
  }
  return JSON.stringify(d);
}

function jsonNaarRegels(tekst) {
  const d = JSON.parse(tekst);
  const uit = [];
  const velden = (soort, o) => Object.keys(o).map((k) => {
    const w = o[k];
    const kk = soort === 'winkel' && k === 'afdelingen' ? 'route' : k;
    if (k === 'ligt') return kk + '=' + Object.keys(w).map((x) => w[x] ? x + ':' + w[x] : x).join('|');
    return kk + '=' + (Array.isArray(w) ? w.join('|') : typeof w === 'string' ? w : JSON.stringify(w));
  });
  for (const soort of ['instelling', 'winkel', 'artikel', 'actie']) {
    const deel = d[SECTIE[soort]] || {};
    for (const naam of Object.keys(deel)) uit.push([soort, naam].concat(velden(soort, deel[naam])).join(';'));
  }
  for (const h of d.hernoemd || []) {
    const rest = Object.assign({}, h); delete rest.soort; delete rest.oud;
    uit.push(['hernoemd', h.soort, h.oud].concat(velden('hernoemd', rest)).join(';'));
  }
  return uit.join('\n') + (uit.length ? '\n' : '');
}

module.exports = { regelsNaarJson, jsonNaarRegels, FORMAAT };
