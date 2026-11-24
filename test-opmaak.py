"""Opmaak in een echte browser: wat de schermtests (jsdom, zonder opmaak) niet kunnen zien.
  1. Een melding blijft bovenaan in beeld, ook als je ver naar beneden gescrold bent.
  2. De tagkeuze staat direct boven het notitieveld, en direct boven de balk onderaan
     (ook als de tabbalk tijdens het typen verdwijnt).
  3. Na het sluiten van een artikel sta je weer op dezelfde plek in de winkel.
  4. Een afdeling verslepen met aanraken (touch) verandert de volgorde.

  python3 test-opmaak.py            (vanuit de map van de app)
  APP=<map> python3 test-opmaak.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, os, sys
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)

fouten = []
def check(naam, ok, info=''):
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}" + ('' if ok else f" — {info}"))
    if not ok: fouten.append(naam)

H = type('S', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None})
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=MAP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASIS = f'http://127.0.0.1:{srv.server_address[1]}/'

# Een kleine verzameling: winkel Plus met 15 afdelingen, wat artikelen, twee acties met een tag.
DATA = r"""() => {
  const m = leegModel(); const nu = tijdstipTekst(new Date());
  const afd = [['agf', 'Groente'], ['zui', 'Zuivel'], ['brd', 'Brood']];
  for (let i = 0; i < 12; i++) afd.push(['x' + String(i).padStart(2, '0'), 'Afdeling ' + i]);
  m.winkels.set('pls', { id: 'pls', naam: 'Plus', notitie: '', link: '', afdelingen: afd.map(([id, naam]) => ({ id, naam, extra: Object.create(null) })), extra: Object.create(null) });
  const A = (id, naam, af, op) => m.artikelen.set(id, { id, naam, soort: 'eenmalig', ligt: new Map([['pls', af]]), op: op ? nu : '', opdoor: '', aantal: '', notitie: id === 'a00' ? '#zuivel' : '', link: '', weg: '', gekocht: [], extra: Object.create(null) });
  for (let i = 0; i < 20; i++) A('a' + String(i).padStart(2, '0'), 'Artikel ' + String(i).padStart(2, '0'), i < 10 ? 'zui' : 'agf', i % 2);
  model = leesBestand(schrijfBestand(m)).model; afgeleid(); gekoppeld = true;
  handelen([{ actie: 'nieuw', soort: 'actie', id: 'ac1', velden: { naam: 'Keuken', notitie: '#Ronnie' } }, { actie: 'nieuw', soort: 'actie', id: 'ac2', velden: { naam: 'Schilderen', notitie: '#Ronnie' } }]);
  toonScherm('boodschappen');
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 360, 'height': 700}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page()
        pagefout = []
        pg.on('pageerror', lambda e: pagefout.append(str(e)))
        await pg.goto(BASIS + 'thuis.html'); await pg.wait_for_timeout(600)
        await pg.evaluate(DATA); await pg.wait_for_timeout(100)

        # 1. Melding in beeld na verwijderen onderaan een lange lijst
        await pg.evaluate("() => { toonScherm('winkels'); winkelOpenen('pls'); ws.volgorde = true; tekenWinkels(); document.getElementById('midden').scrollTop = 99999; }")
        await pg.wait_for_timeout(100)
        scroll = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.click('#afdelingen .arij:last-child .potlood'); await pg.wait_for_timeout(100)
        await pg.click('#keuze .prul'); await pg.wait_for_timeout(700)
        r = await pg.evaluate("() => { const m = document.querySelector('.melding'); if (!m) return null; const r = m.getBoundingClientRect(); return [r.top, r.bottom, innerHeight, document.getElementById('midden').scrollTop]; }")
        check('melding: ver gescrold (' + str(scroll) + ' px) en toch helemaal in beeld', scroll > 100 and r is not None and r[0] >= 0 and r[1] <= r[2] and r[3] > 100, r)
        await pg.evaluate("() => { for (const m of document.querySelectorAll('.melding')) m.remove(); ws.volgorde = false; winkelSluiten(); }")

        # 2. Tagkeuze direct boven het notitieveld, en boven de balk onderaan
        await pg.evaluate("() => { toonScherm('doen'); actieOpenen('ac1'); }"); await pg.wait_for_timeout(100)
        await pg.click('#actieNotitie'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('#'); await pg.wait_for_timeout(150)
        t = await pg.evaluate("() => { const l = document.getElementById('tagLijst'), v = document.getElementById('actieNotitie'); return [l.hidden, l.getBoundingClientRect().bottom, v.getBoundingClientRect().top, l.getBoundingClientRect().top]; }")
        check('tagkeuze: zichtbaar en direct boven het notitieveld', not t[0] and abs(t[1] - t[2]) <= 2 and t[3] >= 0, t)
        await pg.evaluate("() => actieDicht()")
        await pg.evaluate("() => toonScherm('boodschappen')"); await pg.wait_for_timeout(100)
        await pg.click('#invoerTekst'); await pg.keyboard.type('#'); await pg.wait_for_timeout(150)
        boven = "() => { const l = document.getElementById('tagLijst'), b = document.getElementById('balk-boodschappen'); return [l.hidden, Math.round(b.getBoundingClientRect().top - l.getBoundingClientRect().bottom)]; }"
        t1 = await pg.evaluate(boven)
        await pg.evaluate("() => { volleHoogte.h = 2000; typenBijwerken(); }")  # zoals een open toetsenbord: de tabbalk gaat weg; await pg.wait_for_timeout(100)
        t2 = await pg.evaluate(boven)
        tb = await pg.evaluate("() => document.body.classList.contains('typen')")
        check('tagkeuze: 6 px boven de balk, ook als de tabbalk verdwijnt', not t1[0] and t1[1] == 6 and tb and not t2[0] and t2[1] == 6, (t1, tb, t2))
        await pg.evaluate("() => { volleHoogte.h = innerHeight; document.body.classList.remove('typen'); const v = document.getElementById('invoerTekst'); v.value = ''; v.dispatchEvent(new Event('input')); v.blur(); }")

        # 3. Scrollpositie terug na het sluiten van een artikel uit de winkel
        await pg.evaluate("() => { toonScherm('winkels'); winkelOpenen('pls'); ws.afdOpen.add('zui'); ws.afdOpen.add('agf'); tekenWinkels(); document.getElementById('midden').scrollTop = 300; }")
        await pg.wait_for_timeout(100)
        voor = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.evaluate("() => { const r = [...document.querySelectorAll('#winkelDetail .item')].find((x) => x.getBoundingClientRect().top > 150); r.querySelector('.tekst').click(); }")
        await pg.wait_for_timeout(100)
        open_ = await pg.evaluate("() => !document.getElementById('artikelScherm').hidden && document.getElementById('midden').scrollTop")
        await pg.click('#artikelDicht'); await pg.wait_for_timeout(100)
        na = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        check('scrollpositie: editor bovenaan, na sluiten weer op dezelfde plek', voor == 300 and open_ == 0 and na == voor, (voor, open_, na))

        # 4. Afdeling verslepen met aanraken
        await pg.evaluate("() => { ws.afdOpen.clear(); ws.volgorde = true; tekenWinkels(); document.getElementById('midden').scrollTop = 0; }")
        await pg.wait_for_timeout(100)
        namen = "() => [...document.querySelectorAll('#afdelingen .arij .nm')].slice(0, 3).map((x) => x.textContent).join()"
        n1 = await pg.evaluate(namen)
        x, y, h = await pg.evaluate("() => { const r = [...document.querySelectorAll('#afdelingen .greep')][2].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, document.querySelector('#afdelingen .arij').getBoundingClientRect().height]; }")
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 21):
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y - 2 * h * i / 20}]})
            await pg.wait_for_timeout(16)
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        await pg.wait_for_timeout(200)
        n2 = await pg.evaluate(namen)
        check('slepen met aanraken: Brood twee plekken omhoog', n1 == 'Groente,Zuivel,Brood' and n2 == 'Brood,Groente,Zuivel', (n1, n2))

        check('geen fouten op de pagina', not pagefout, pagefout)
        await b.close()

asyncio.run(main())
print('\n' + ('GEEN FOUTEN' if not fouten else f'{len(fouten)} FOUT(EN): ' + ', '.join(fouten)))
sys.exit(1 if fouten else 0)
