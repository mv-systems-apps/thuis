"""Mutatieloop over thuis-tests.cjs: sloopt de kern op bekende plekken en laat zien
welke controles rood worden. Faalt (exitcode 1) als een mutatie niet meer aangrijpt
of door geen enkele controle wordt gevangen.   python3 mutaties.py"""
import subprocess, os, shutil, sys, tempfile
MUTATIES = [
  ("BOM-markering vergeten", "  const bom = tekst.charCodeAt(0) === 0xFEFF;", "  const bom = false;"),
  ("allebei op de lijst = botsing", "if (h.veld === 'op' && cur !== '' && nieuw !== '') return { status: 'al' };", ""),
  ("na het moment gekocht telt niet", "if (lijst(r.velden.get('gekocht')).some((d) => d >= mDatum)) continue;", ""),
  ("hernoemd-spoor genegeerd", "if (!spoor || !spoor.velden.get('nieuw')) return null;", "return null;"),
  ("verwijderd artikel weer aanmaken", "  if (!r) return { status: 'vervallen' };", "  if (!r) return { status: 'ok' };"),
  ("geen UTF-8-controle", "new TextDecoder('utf-8', { fatal: true })", "new TextDecoder('utf-8')"),
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
