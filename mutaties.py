"""Mutatieloop over thuis-tests.cjs: sloopt de kern op bekende plekken en laat zien
welke controles rood worden. Faalt (exitcode 1) als een mutatie niet meer aangrijpt
of door geen enkele controle wordt gevangen.   python3 mutaties.py"""
import subprocess, os, shutil, sys, tempfile
MUTATIES = [
  ("BOM-markering vergeten", "  model.bom = tekst.charCodeAt(0) === 0xFEFF;", "  model.bom = false;"),
  ("allebei op de lijst = botsing", "if (h.veld === 'op' && cur !== '' && nieuw !== '') return { status: 'al' };", ""),
  ("na het moment gekocht telt niet", "if (r.gekocht.some((d) => d >= mDatum)) continue;", ""),
  ("verwijderd artikel weer aanmaken", "  return r ? regel.doe(model, h, verz, r) : VERVALLEN;", "  return r ? regel.doe(model, h, verz, r) : { status: 'ok' };"),
  ("geen UTF-8-controle", "new TextDecoder('utf-8', { fatal: true })", "new TextDecoder('utf-8')"),
  ("nieuwer formaat toch lezen", "if (v > formaatGetal(FORMAAT)) return { ok: false, reden: 'nieuwer-formaat' };", ""),
  ("verkeerde opbouw stil overslaan", "    if (!isObject(deel)) throw new Error(k + ' is geen object');", "    if (!isObject(deel)) continue;"),
  ("dubbele naam niet samenvoegen", "const zelfde = verz.get(h.id) || zoekOpNaam(verz, v.naam);", "const zelfde = verz.get(h.id);"),
  ("vervanging niet doorgeven", "    const h = vervangIds(h0, alias);", "    const h = h0;"),
  ("verwijderde winkel blijft bij artikelen", "  if (h.soort === 'winkel') for (const a of model.artikelen.values()) a.ligt.delete(h.id);", ""),
  ("patroon al bij twee aankopen", "if (d.length < 3 || gaten.length < 2) return { laatst, interval: null };", "if (gaten.length < 1) return { laatst, interval: null };"),
  ("zonder winkel bij onbekend", "    if (!a.plekken.length) { zonder.push(a); continue; }", ""),
  ("ook-elders maakt nodig", "    const alleen = hier.filter((a) => a.plekken.length === 1).map((a) => a.naam);", "    const alleen = hier.map((a) => a.naam);"),
  ("archief negeert weg", "  return (r.weg || '') > g ? r.weg : g;", "  return g;"),
  ("archief negeert de instelling", "    const dagen = Object.prototype.hasOwnProperty.call(BEWAREN, b) ? BEWAREN[b] : BEWAREN['1m'];", "    const dagen = BEWAREN['1m'];"),
  ("alle backups weg", "return lijstB.filter((b) => !(b.d >= grensDag || (b.maand >= grensMaand && eersteVanMaand.has(b.n)))).map((b) => b.n);", "return lijstB.map((b) => b.n);"),
]
hier = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(hier, 'thuis.html'), encoding='utf-8').read()
map_ = tempfile.mkdtemp(prefix='thuis-mut-'); shutil.copy(os.path.join(hier, 'sw-thuis.js'), map_)
slecht = 0
for naam, van, naar in MUTATIES:
    if van not in t:
        print(f'{naam}: grijpt niet meer aan (tekst niet gevonden)'); slecht += 1; continue
    open(os.path.join(map_, 'thuis.html'), 'w', encoding='utf-8').write(t.replace(van, naar, 1))
    r = subprocess.run(['node', os.path.join(hier, 'thuis-tests.cjs')], env=dict(os.environ, APP=os.path.join(map_, 'thuis.html')), capture_output=True, text=True)
    rood = [l.split(' — ')[0][6:] for l in r.stdout.splitlines() if l.startswith('FOUT ')]
    print(f"{naam}: {len(rood)} rood" + (' — ' + '; '.join(rood[:2]) if rood else ''))
    if not rood: slecht += 1
shutil.rmtree(map_)
sys.exit(1 if slecht else 0)
