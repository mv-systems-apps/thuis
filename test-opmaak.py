"""Opmaak in een echte browser: wat de schermtests (jsdom, zonder opmaak) niet kunnen zien.
  1. Een melding blijft bovenaan in beeld, ook als je ver naar beneden gescrold bent.
  2. De tagkeuze zweeft net boven het notitieveld en boven het zoekvak, zonder de
     randen van het vak te bedekken (ook als de tabbalk tijdens het typen verdwijnt).
  3. Na het sluiten van een artikel sta je weer op dezelfde plek in de afdeling, en terug uit
     een afdeling op dezelfde plek in de route.
  3b. De eerste letter na scrollen sluit het keuzelijstje niet; zelf scrollen wel.
  4. Een afdeling verslepen met aanraken (touch) verandert de volgorde.
  5. Tikvlakken in Boodschappen (winkelicoon, leegknop) en elders (Volgorde, ster, potlood,
     soorticoon, schakelaarregels) zijn minstens 44 px; tik op de tekst zet een schakelaar om.
  6. Een lange winkelnaam loopt door op een tweede regel in plaats van afgekapt te worden.
  7–10. Niet vet, gemeten knoppenrij, geen knijpzoom, tabbalk op een laptop.
  15. Regelafstand: leesstand, notitiepaneel en receptregels in het bewerkscherm gelijk aan de lijsten (17 px, geen extra ruimte).
  14. Kleur: gewone notitie paars, alles uit een recept (receptnotitie, ingrediëntnotitie, receptregel) bruinrood, recht.
  13. Vegen in Boodschappen: rechts = afvinken, links = notitie, schuin = scrollen; tabwissel alleen via de tabbalk.
  12. Laptop: ruimte voor de scrollbalk blijft vrij (beeld verspringt niet); Wanneer: knop terug naar nu.
  11. Een notitie met meer regels: in een lijst één regel (met …), in de band onder de titel alles.

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
  const A = (id, naam, af, op) => m.artikelen.set(id, { id, naam, soort: 'eenmalig', ligt: new Map([['pls', af]]), op: op ? nu : '', opdoor: '', aantal: '', notitie: id === 'a00' ? '#zuivel' : '', link: '', weg: '', gekocht: [], voor: new Map(), opvoor: '', extra: Object.create(null) });
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
        check('tagkeuze: zichtbaar, 6 px boven het notitieveld (paarse rand blijft zichtbaar)', not t[0] and round(t[2] - t[1]) == 6 and t[3] >= 0, t)
        await pg.evaluate("() => actieDicht()")
        await pg.evaluate("() => toonScherm('boodschappen')"); await pg.wait_for_timeout(100)
        await pg.click('#invoerTekst'); await pg.keyboard.type('#'); await pg.wait_for_timeout(150)
        boven = "() => { const l = document.getElementById('tagLijst'), b = document.querySelector('#balk-boodschappen .invoerbalk'); return [l.hidden, Math.round(b.getBoundingClientRect().top - l.getBoundingClientRect().bottom)]; }"
        t1 = await pg.evaluate(boven)
        await pg.evaluate("() => { volleHoogte.h = 2000; typenBijwerken(); }")  # zoals een open toetsenbord: de tabbalk gaat weg; await pg.wait_for_timeout(100)
        t2 = await pg.evaluate(boven)
        tb = await pg.evaluate("() => document.body.classList.contains('typen')")
        check('tagkeuze: 9 px boven het zoekvak (paarse en blauwe rand zichtbaar), ook als de tabbalk verdwijnt', not t1[0] and t1[1] == 9 and tb and not t2[0] and t2[1] == 9, (t1, tb, t2))
        await pg.evaluate("() => { volleHoogte.h = innerHeight; document.body.classList.remove('typen'); const v = document.getElementById('invoerTekst'); v.value = ''; v.dispatchEvent(new Event('input')); v.blur(); }")

        # 3. Scrollpositie terug: na het sluiten van een artikel in een afdeling, en na terug uit de afdeling naar de route
        await pg.evaluate("() => { toonScherm('winkels'); winkelOpenen('pls'); document.getElementById('midden').scrollTop = 300; }")
        await pg.wait_for_timeout(100)
        route = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.evaluate("() => { [...document.querySelectorAll('#afdelingen .afdrij')].find((r) => r.querySelector('.nm').textContent === 'Zuivel').click(); }")
        await pg.wait_for_timeout(100)
        inafd = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.evaluate("() => { document.getElementById('midden').scrollTop = 200; }")
        voor = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.evaluate("() => { const r = [...document.querySelectorAll('#winkelDetail .item')].find((x) => x.getBoundingClientRect().top > 150); r.querySelector('.tekst').click(); }")
        await pg.wait_for_timeout(100)
        open_ = await pg.evaluate("() => !document.getElementById('artikelScherm').hidden && document.getElementById('midden').scrollTop")
        await pg.click('#artikelDicht'); await pg.wait_for_timeout(100)
        na = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        check('scrollpositie: editor bovenaan, na sluiten weer op dezelfde plek in de afdeling', voor > 100 and open_ == 0 and na == voor, (voor, open_, na))
        await pg.evaluate("() => document.querySelector('#winkelDetail .terug').click()")
        await pg.wait_for_timeout(100)
        terug = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        check('scrollpositie: afdeling begint bovenaan, terug naar de route op dezelfde plek', route == 300 and inafd == 0 and terug == route, (route, inafd, terug))

        # 3b. Eerste letter na scrollen: het keuzelijstje blijft staan (het scherm gaat naar boven, dat sluit het niet)
        await pg.evaluate("""() => { const h = []; for (let i = 0; i < 20; i++) h.push({ actie: 'nieuw', soort: 'artikel', id: 'zz' + String(i).padStart(3, '0'), velden: { naam: 'Zuivel ' + i, ligt: { pls: 'zui' } } });
          handelen(h); afdelingOpenen('zui'); document.getElementById('midden').scrollTop = 400; }""")
        await pg.wait_for_timeout(100)
        gescrold = await pg.evaluate("() => document.getElementById('midden').scrollTop")
        await pg.click('#winkelsTekst'); await pg.keyboard.type('z'); await pg.wait_for_timeout(400)
        zicht = await pg.evaluate("() => !document.getElementById('tagLijst').hidden && document.querySelectorAll('#tagLijst .tagoptie').length")
        check('eerste letter na scrollen: keuzelijstje blijft staan', gescrold > 100 and bool(zicht), (gescrold, zicht))
        await pg.mouse.move(195, 300); await pg.mouse.wheel(0, 200); await pg.wait_for_timeout(150)
        dicht = await pg.evaluate("() => document.getElementById('tagLijst').hidden")
        check('zelf scrollen sluit het keuzelijstje', dicht, dicht)
        await pg.evaluate("() => { const v = document.getElementById('winkelsTekst'); v.value = ''; v.dispatchEvent(new Event('input')); v.blur(); afdelingDicht(true); }")

        # 4. Afdeling verslepen met aanraken
        await pg.evaluate("() => { ws.volgorde = true; tekenWinkels(); document.getElementById('midden').scrollTop = 0; }")
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

        # 5. Tikvlakken in Boodschappen minstens 44 px (winkelicoon, leegknop)
        await pg.evaluate("""() => { const d = datumTekst(new Date());
          winkel.mandje.set('a00', { id: 'a00', naam: 'Artikel 00', winkel: 'pls', op: '', opdoor: '', datum: d });
          winkel.mandje.set('a02', { id: 'a02', naam: 'Artikel 02', winkel: 'ahh', op: '', opdoor: '', datum: d });
          handelen([{ actie: 'nieuw', soort: 'winkel', id: 'ahh', velden: { naam: 'AH' } }, { actie: 'nieuw', soort: 'artikel', id: 'nb1', velden: { naam: 'Elders', ligt: { ahh: '' } } }]);
          handelen([{ actie: 'zet', soort: 'artikel', id: 'nb1', veld: 'op', oud: '', nieuw: tijdstipTekst(new Date()) }]);
          winkel.id = 'pls'; winkel.mandjeOpen = true; toonScherm('winkel'); }""")
        await pg.wait_for_timeout(150)
        maten = await pg.evaluate("() => [...document.querySelectorAll('#winkelLijst .winkelkies, #winkelLijst .mandleeg')].map((e) => [e.className, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])")
        check('tikvlakken in Boodschappen minstens 44 px', len(maten) >= 2 and all(m[2] >= 44 and (m[1] >= 44) for m in maten), maten)

        # 5b. Tikvlakken elders: Volgorde, ster, potlood, soorticoon; schakelaars over de hele regel
        await pg.evaluate("() => { toonScherm('winkels'); winkelOpenen('pls'); }"); await pg.wait_for_timeout(100)
        m2 = await pg.evaluate("() => [...document.querySelectorAll('#winkelDetail .kopknop, #winkelDetail .icoonknop')].map((e) => [e.className, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])")
        await pg.evaluate("() => afdelingOpenen('zui')"); await pg.wait_for_timeout(100)
        m2 += await pg.evaluate("() => [...document.querySelectorAll('#winkelDetail .item .icoon')].slice(0, 1).map((e) => [e.className, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)])")
        await pg.evaluate("() => { afdelingDicht(true); winkelDicht(); toonScherm('instellingen'); }"); await pg.wait_for_timeout(100)
        m2 += await pg.evaluate("() => ['swWinkelTal', 'swAankoopWinkel'].map((id) => { const r = document.getElementById(id).closest('.rij').getBoundingClientRect(); return [id, Math.round(r.width), Math.round(r.height)]; })")
        check('tikvlakken elders minstens 44 px (Volgorde, ster, potlood, soorticoon, schakelaarregels)', len(m2) >= 6 and all(x[1] >= 44 and x[2] >= 44 for x in m2), m2)
        aan = await pg.evaluate("() => { const v = weergave.winkelTal; document.getElementById('lblWinkelTal').click(); const n = weergave.winkelTal; document.getElementById('lblWinkelTal').click(); return v !== n && weergave.winkelTal === v; }")
        check('tik op de tekst van een schakelaar zet hem om', aan, aan)
        await pg.evaluate("() => toonScherm('winkel')")

        # 6. Lange winkelnaam: niet afgekapt maar op twee regels, aantal en knoppen blijven rechts
        await pg.evaluate("() => { handelen([{ actie: 'zet', soort: 'winkel', id: 'pls', veld: 'naam', oud: 'Plus', nieuw: 'Albert Heijn XL Arnhem Centrum' }]); winkel.kaartOpen = true; tekenWinkel(); }")
        await pg.wait_for_timeout(100)
        kop = await pg.evaluate("""() => { const k = document.getElementById('winkelKop'), n = document.getElementById('winkelNaam'), r = (e) => e.getBoundingClientRect();
          return { tekst: n.textContent, hoog: Math.round(r(n).height), vol: n.scrollWidth <= n.clientWidth, kop: Math.round(r(k).height),
            rechts: Math.round(r(k).right - r(document.getElementById('winkelPijl')).right), tal: document.getElementById('winkelHier').textContent }; }""")
        await pg.screenshot(path='/tmp/langenaam-echt.png', clip={'x': 0, 'y': 0, 'width': 390, 'height': 300})
        check('lange winkelnaam op twee regels, niet afgekapt', kop['tekst'] == 'Albert Heijn XL Arnhem Centrum' and kop['vol'] and 40 <= kop['hoog'] <= 56 and kop['kop'] >= 46 and 0 <= kop['rechts'] <= 20 and kop['tal'].isdigit(), kop)

        # 7. Niets vet in notities (tags, link) en bij namen van winkels: vet suggereert tikbaar
        await pg.evaluate("() => { winkel.kaartOpen = false; toonScherm('winkels'); }"); await pg.wait_for_timeout(100)
        gew = await pg.evaluate("""() => { const d = document.createElement('div'); d.className = 'item'; d.appendChild(notitieRegel({ notitie: 'Tekst #tag', link: 'https://www.plus.nl' }));
          document.getElementById('scherm-winkels').appendChild(d); const w = (e) => e ? getComputedStyle(e).fontWeight : 'geen';
          const r = [w(d.querySelector('.tag')), w(d.querySelector('.link')), w(document.querySelector('#scherm-winkels .winkelrij .nm'))]; d.remove(); return r; }""")
        check('tags, link en winkelnaam niet vet', gew == ['400', '400', '400'], gew)

        # 8. Knoppenrij gemeten: smal kort (Wk, Mnd), breed voluit; bij een ander formaat opnieuw
        await pg.evaluate("() => toonScherm('instellingen')"); await pg.wait_for_timeout(150)
        smal = await pg.evaluate("() => [...document.querySelectorAll('#doenStandaard button')].map((b) => b.textContent).join(' ')")
        await pg.set_viewport_size({'width': 600, 'height': 700}); await pg.wait_for_timeout(400)
        breed = await pg.evaluate("() => [...document.querySelectorAll('#doenStandaard button')].map((b) => b.textContent).join(' ')")
        lucht = await pg.evaluate("() => [...document.querySelectorAll('#doenStandaard button')].every((b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect().width <= b.clientWidth - 12; })")
        await pg.set_viewport_size({'width': 360, 'height': 700}); await pg.wait_for_timeout(400)
        check('Standaard tonen: op 360 px Wk/Mnd/Jr, op 600 px voluit, overal lucht', smal == 'Alles Wk Mnd Kw. Jr' and breed == 'Alles Week Maand Kw. Jaar' and lucht, [smal, breed, lucht])

        # 9. Geen knijpzoom: touchpad (wiel + Ctrl) tegengehouden, viewport met maximum-scale=1, touch-action op html
        kz = await pg.evaluate("""() => { const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, cancelable: true, bubbles: true }); document.getElementById('midden').dispatchEvent(e);
          const g = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true }); document.getElementById('midden').dispatchEvent(g);
          return [e.defaultPrevented, g.defaultPrevented, /maximum-scale=1/.test(document.querySelector('meta[name=viewport]').content), getComputedStyle(document.documentElement).touchAction]; }""")
        check('knijpzoom uit: Ctrl+wiel tegengehouden, gewoon scrollen niet; maximum-scale=1; touch-action pan', kz[0] and not kz[1] and kz[2] and kz[3] == 'pan-x pan-y', kz)

        # 10. Laptop: tabknoppen even breed als de inhoud; telefoon: over de hele breedte
        await pg.set_viewport_size({'width': 1280, 'height': 700}); await pg.wait_for_timeout(300)
        tb = await pg.evaluate("() => { const b = [...document.querySelectorAll('nav button')]; const v = document.querySelector('.onderbalk .invoerbalk') || document.querySelector('.invoerbalk'); return [Math.round(b[0].getBoundingClientRect().left), Math.round(b[4].getBoundingClientRect().right), innerWidth]; }")
        await pg.set_viewport_size({'width': 360, 'height': 700}); await pg.wait_for_timeout(300)
        tm = await pg.evaluate("() => { const b = [...document.querySelectorAll('nav button')]; return [Math.round(b[0].getBoundingClientRect().left), Math.round(b[4].getBoundingClientRect().right)]; }")
        check('tabknoppen: op 1280 px binnen 612 px in het midden, op 360 px de hele breedte', tb[0] == (1280 - 612) // 2 and tb[1] == (1280 + 612) // 2 and tm == [0, 360], [tb, tm])

        # 11. Notitie met meer regels: in een lijst 2 regels, in de band onder de titel alles
        nr = await pg.evaluate("""() => { toonScherm('boodschappen'); const s = document.getElementById('scherm-boodschappen'); const uit = [];
          for (const [kl, tekst] of [['item', 'Eén'], ['item', 'Een\\nTwee\\nDrie\\nVier'], ['kopnotitie', 'Een\\nTwee\\nDrie\\nVier']]) {
            const d = document.createElement('div'); d.className = kl; d.appendChild(notitieRegel({ notitie: tekst + ' #tag', link: 'https://www.plus.nl' })); s.appendChild(d);
            const n = d.querySelector('.ntekst'); uit.push([Math.round(n.getBoundingClientRect().height), n.scrollHeight > n.clientHeight + 1, !!d.querySelector('.ntags .tag'), !!d.querySelector('.link')]); d.remove(); }
          return uit; }""")
        een = nr[0][0]
        check('notitie met meer regels: lijst 1 regel (rest afgekapt), band alles; tags en link eronder', een > 10 and abs(nr[1][0] - een) <= 2 and nr[1][1] and abs(nr[2][0] - 4 * een) <= 4 and not nr[2][1] and all(x[2] and x[3] for x in nr), nr)

        # 12. Scrollbalk verspringt niet; label Weergave; knop terug naar nu onder de datum
        sg = await pg.evaluate("() => [getComputedStyle(document.querySelector('main')).scrollbarGutter, document.getElementById('lblWinkelTal').textContent]")
        await pg.evaluate("() => { toonScherm('doen'); actieOpenen('ac1'); bd.datum = verschuif(datumTekst(new Date()), 3, 'dag'); tekenWanneer(); }"); await pg.wait_for_timeout(100)
        nu = await pg.evaluate("() => { const k = document.querySelector('#wanneerNu button'), b = document.getElementById('wanneerBlader').getBoundingClientRect(), r = k.getBoundingClientRect(); return [k.textContent, Math.round(b.right - r.right) <= 12, r.top >= b.bottom - 6, r.height >= 44]; }")
        await pg.evaluate("() => actieDicht()")
        check('scrollbalk: ruimte blijft vrij; label "Aantal afdelingen en artikelen bij winkel"; Vandaag rechts onder de datum, 44 px', sg == ['stable', 'Aantal afdelingen en artikelen bij winkel'] and nu == ['Vandaag', True, True, True], [sg, nu])

        # 13. Vegen over een rij in Boodschappen
        await pg.set_viewport_size({'width': 360, 'height': 700}); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { for (const m of document.querySelectorAll('.melding')) m.remove(); winkel.id = 'pls'; winkel.kaartOpen = true; toonScherm('winkel'); }"); await pg.wait_for_timeout(300)
        cdp2 = await ctx.new_cdp_session(pg)
        async def veeg(sel, dx, dy=0):
            x, y = await pg.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }", sel)
            await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
            for i in range(1, 13):
                await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / 12, 'y': y + dy * i / 12}]})
                await pg.wait_for_timeout(16)
            await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            await pg.wait_for_timeout(250)
        rij0 = "() => [...document.querySelectorAll('#winkelLijst .wrij')].filter((r) => !r.classList.contains('gedaan')).map((r) => r.querySelector('.nm').firstChild.textContent)"
        voor = await pg.evaluate(rij0)
        mstart = await pg.evaluate("() => winkel.mandje.size")
        eerste = voor[0]
        await pg.evaluate("(n) => { const r = [...document.querySelectorAll('#winkelLijst .wrij')].find((x) => x.querySelector('.nm').firstChild.textContent === n); r.id = 'veegrij'; }", eerste)
        await veeg('#veegrij', 60)
        kort = [await pg.evaluate("() => winkel.mandje.size"), await pg.evaluate("() => !!document.querySelector('#winkelLijst .wrij.vegen')")]
        await veeg('#veegrij', 200)
        recht = await pg.evaluate("() => winkel.mandje.size")
        await pg.wait_for_timeout(1700)
        # gewoon tikken (echte aanraking) op een rij met een notitie vinkt af (de tik na lang indrukken niet)
        await pg.evaluate("() => { handelen([{ actie: 'zet', soort: 'artikel', id: 'a03', veld: 'notitie', oud: '', nieuw: 'Tik' }]); tekenWinkel(); }"); await pg.wait_for_timeout(100)
        tx, ty = await pg.evaluate("() => { const r = [...document.querySelectorAll('#winkelLijst .wrij')].find((x) => x.querySelector('.nm').firstChild.textContent === 'Artikel 03'); const b = r.querySelector('.ntekst').getBoundingClientRect(); return [b.x + 10, b.y + b.height / 2]; }")
        mt = await pg.evaluate("() => winkel.mandje.size")
        await pg.touchscreen.tap(tx, ty); await pg.wait_for_timeout(100)
        tik = await pg.evaluate("() => winkel.mandje.size") == mt + 1
        await pg.wait_for_timeout(1700)
        # links: een rij met een notitie (a00 heeft #zuivel)
        await pg.evaluate("() => { handelen([{ actie: 'zet', soort: 'artikel', id: 'a01', veld: 'notitie', oud: '', nieuw: 'Halfvol' }]); tekenWinkel(); const r = [...document.querySelectorAll('#winkelLijst .wrij')].find((x) => x.querySelector('.nm').firstChild.textContent === 'Artikel 01'); r.id = 'veegnot'; }")
        await pg.wait_for_timeout(100)
        await veeg('#veegnot', -200)
        links = await pg.evaluate("() => { const k = document.getElementById('keuze'); const v = !!k && /Halfvol/.test(k.textContent); if (k) k.querySelector('.kruis').click(); return v; }")
        await pg.wait_for_timeout(100)
        m0 = await pg.evaluate("() => winkel.mandje.size")
        await veeg('#veegnot', 80, 200)
        schuin = [await pg.evaluate("() => winkel.mandje.size") == m0, await pg.evaluate("() => !document.getElementById('keuze')")]
        # tabwissel: niet in de lijst van Boodschappen, wel op de tabbalk
        await pg.evaluate("() => { const r = document.querySelector('#winkelLijst .wrij:not(.gedaan)'); r.id = 'tabveeg'; }")
        x0, y0 = await pg.evaluate("() => { const r = document.querySelector('.afdkop, #winkelLijst .naaraankopen').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0}]})
        for i in range(1, 9): await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 - 15 * i, 'y': y0}]})
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await pg.wait_for_timeout(200)
        nogWinkel = await pg.evaluate("() => !document.getElementById('scherm-winkel').hidden")
        xn, yn = await pg.evaluate("() => { const r = document.querySelector('nav').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': xn, 'y': yn}]})
        for i in range(1, 9): await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': xn - 15 * i, 'y': yn}]})
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await pg.wait_for_timeout(200)
        naarDoen = await pg.evaluate("() => !document.getElementById('scherm-doen').hidden")
        panY = await pg.evaluate("() => { const r = document.querySelector('#winkelLijst .wrij'); return r ? getComputedStyle(r).touchAction : 'pan-y'; }")
        sel = await pg.evaluate("() => [...document.querySelectorAll('#winkelLijst .wrij .vink')].every((v) => getComputedStyle(v).userSelect === 'none')")
        check('vegen (rij: touch-action pan-y, geen wachten bij scrollen; geen tekstselectie op elke rij): kort = terug, tikken op een rij met notitie vinkt af, ver naar rechts = afgevinkt, naar links = notitie, schuin = niets; in Boodschappen tabwissel alleen op de tabbalk',
              kort == [mstart, False] and recht == mstart + 1 and tik and links and schuin == [True, True] and nogWinkel and naarDoen and panY == 'pan-y' and sel, [kort, recht, tik, links, schuin, nogWinkel, naarDoen, panY, sel])

        # 13b. Vegen in de andere lijsten (Artikelen, Doen, Gedaan); lang indrukken doet niets
        await pg.evaluate("() => { toonScherm('boodschappen'); scherm.filter = 'W'; tekenBoodschappen(); }"); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { handelen([{ actie: 'nieuw', soort: 'artikel', id: 'vga01', velden: { naam: 'Veegartikel', soort: 'wekelijks' } }, { actie: 'nieuw', soort: 'artikel', id: 'vga02', velden: { naam: 'Veegleeg', soort: 'wekelijks' } }]); tekenBoodschappen(); }"); await pg.wait_for_timeout(100)
        await pg.evaluate("() => { const r = document.querySelector('#lijst .item[data-id=vga01]'); r.id = 'aveeg'; window.__aid = 'vga01'; }")
        await veeg('#aveeg', 200)
        art_r = await pg.evaluate("() => !!artikelOpId.get(window.__aid).op && document.getElementById('artikelScherm').hidden")
        await pg.evaluate("() => { const a = artikelOpId.get(window.__aid); handelen([{ actie: 'zet', soort: 'artikel', id: a.id, veld: 'notitie', oud: a.notitie, nieuw: 'Veegnotitie' }]); tekenBoodschappen(); const r = document.querySelector('#lijst .item[data-id=\"' + a.id + '\"]'); r.id = 'aveeg'; }"); await pg.wait_for_timeout(100)
        await veeg('#aveeg', -200)
        art_l = await pg.evaluate("() => { const k = document.getElementById('keuze'); const v = !!k && /Veegnotitie/.test(k.textContent); if (k) k.querySelector('.kruis').click(); return v && document.getElementById('artikelScherm').hidden; }")
        await pg.evaluate("() => { document.querySelector('#lijst .item[data-id=vga02]').id = 'aleeg'; }")
        x, y = await pg.evaluate("() => { const r = document.getElementById('aleeg').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }")
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
        for i in range(1, 9): await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x - 15 * i, 'y': y}]}); await pg.wait_for_timeout(16)
        grijs = await pg.evaluate("() => { const o = document.querySelector('#aleeg > .vonder'); return !!o && o.classList.contains('leeg') && /#A7A2C4/.test(o.innerHTML); }")
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await pg.wait_for_timeout(300)
        leeg = await pg.evaluate("() => !document.getElementById('keuze') && document.getElementById('artikelScherm').hidden && !document.querySelector('#aleeg.vegen')")
        tab = await pg.evaluate("() => !document.getElementById('scherm-boodschappen').hidden")
        # lang indrukken op een artikel met notitie: geen paneel meer (vegen is er); de tik erna opent het artikel zoals gewoon
        x, y = await pg.evaluate("() => { const r = document.querySelector('#lijst .item[data-id=\"' + window.__aid + '\"] .naam').getBoundingClientRect(); return [r.x + 10, r.y + r.height / 2]; }")
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]}); await pg.wait_for_timeout(650)
        await cdp2.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); await pg.wait_for_timeout(300)
        lang = await pg.evaluate("() => { const v = !document.getElementById('keuze'); if (!document.getElementById('artikelScherm').hidden) artikelDicht(); return v; }")
        # Op de lijst: naar links = de teller ("− +"), niet de notitie
        await pg.evaluate("() => { scherm.filter = 'L'; scherm.teller = ''; tekenBoodschappen(); document.querySelector('#lijst .item[data-id=\"' + window.__aid + '\"]').id = 'lveeg'; document.getElementById('lveeg').scrollIntoView({ block: 'center' }); }"); await pg.wait_for_timeout(150)
        await veeg('#lveeg', -200)
        lijst_l = await pg.evaluate("() => { const v = scherm.teller === window.__aid && !!document.querySelector('#lijst .teller') && !document.getElementById('keuze') && document.getElementById('artikelScherm').hidden; scherm.teller = ''; scherm.filter = 'W'; tekenBoodschappen(); return v; }")
        # Doen: naar rechts = afronden (1,5 s grijs)
        await pg.evaluate("() => { handelen([{ actie: 'nieuw', soort: 'actie', id: 'vg001', velden: { naam: 'Veegactie' } }]); toonScherm('doen'); doen.filter = 'alles'; tekenDoen(); document.querySelector('#doenLijst .actierij[data-id=vg001]').id = 'dveeg'; }"); await pg.wait_for_timeout(150)
        await veeg('#dveeg', 200)
        doen_r = await pg.evaluate("() => doen.vertrekt.has('vg001')")
        await pg.wait_for_timeout(1800)
        # Gedaan: naar links = weg, met Ongedaan maken; die zet hem terug
        await pg.evaluate("() => { logOpenen('historie'); }"); await pg.wait_for_timeout(300)
        await pg.evaluate("() => { const r = [...document.querySelectorAll('#historieScherm .aankooprij')].find((x) => /Veegactie/.test(x.textContent)); r.id = 'hveeg'; window.__hid = r.dataset.id; }")
        await veeg('#hveeg', -200)
        weg = await pg.evaluate("() => !model.historie.has(window.__hid) && [...document.querySelectorAll('.melding')].some((m) => /Veegactie/.test(m.textContent) && /Ongedaan maken/.test(m.textContent))")
        await pg.evaluate("() => [...document.querySelectorAll('.melding button')].find((b) => /Ongedaan maken/.test(b.textContent)).click()"); await pg.wait_for_timeout(200)
        terug = await pg.evaluate("() => model.historie.has(window.__hid)")
        await pg.evaluate("() => logSluiten()")
        # recept: naar links op een ingrediënt met een notitie = die notitie
        await pg.evaluate("() => { handelen([{ actie: 'nieuw', soort: 'recept', id: 'rcv01', velden: { naam: 'Veegrecept' } }, { actie: 'ingredient', soort: 'recept', id: 'rcv01', ingredient: 'ivg01', naam: 'Bloem', aantal: '1', notitie: 'Zelfrijzend' }, { actie: 'ingredient', soort: 'recept', id: 'rcv01', ingredient: 'ivg02', naam: 'Suiker', aantal: '1' }]); toonScherm('boodschappen'); receptOpenen('rcv01'); }"); await pg.wait_for_timeout(200)
        await pg.evaluate("() => { document.querySelector('#ingredienten .item[data-ing=ivg01]').id = 'iveeg'; }")
        await veeg('#iveeg', -200)
        ing = await pg.evaluate("() => { const k = document.getElementById('keuze'); const v = !!k && /Zelfrijzend/.test(k.textContent) && /Bloem/.test(k.querySelector('h3').textContent); if (k) k.querySelector('.kruis').click(); receptDicht(true); return v; }")
        check('vegen in de andere lijsten: Artikelen rechts = op de lijst, links = notitie, zonder notitie grijs en niets (geen tabwissel), lang indrukken = geen paneel; Doen rechts = afronden; Gedaan links = weg met Ongedaan maken; recept links = notitie van het ingrediënt; Op de lijst links = teller',
              [art_r, art_l, grijs, leeg, tab, lang, doen_r, weg, terug, ing, lijst_l] == [True] * 11, [art_r, art_l, grijs, leeg, tab, lang, doen_r, weg, terug, ing, lijst_l])

        # 14. Kleur van notities
        kl = await pg.evaluate("""async () => {
          handelen([{ actie: 'nieuw', soort: 'recept', id: 'rc1', velden: { naam: 'Lasagne', notitie: 'Voor 4 #pasta' } },
            { actie: 'ingredient', soort: 'recept', id: 'rc1', ingredient: 'a00', naam: 'Artikel 00', aantal: '2', notitie: 'Halfvol #melk' },
            { actie: 'voor', soort: 'artikel', id: 'a00', recept: 'rc1', naam: 'Lasagne', aantal: '2', ing: 'a00' },
            { actie: 'zet', soort: 'artikel', id: 'a00', veld: 'notitie', oud: '#zuivel', nieuw: 'Eigen #zuivel' }]);
          toonScherm('boodschappen'); receptOpenen('rc1'); await new Promise((r) => setTimeout(r, 100));
          const c = (e) => e ? getComputedStyle(e).color + '/' + getComputedStyle(e).fontStyle : 'geen';
          const uit = [c(document.querySelector('#receptBlok .kopnotitie .ntekst')), c(document.querySelector('#ingredienten .notitie .ntekst')), c(document.querySelector('#ingredienten .notitie .tag'))];
          receptDicht(true); scherm.filter = 'L'; tekenBoodschappen(); await new Promise((r) => setTimeout(r, 100));
          const rij = document.querySelector('#lijst .item[data-id="a00"]');
          uit.push(c(rij && rij.querySelector('.rregel')), c(rij && rij.querySelector('.ntekst')));
          const vol = (box) => { const r = box ? box.querySelectorAll(':scope > .nregel') : [];
            return [c(r[0] && r[0].querySelector('.ntekst')), c(r[1] && r[1].querySelector('.rtekst')), c(r[2] && r[2].querySelector('.ntekst')), c(r[2] && r[2].querySelector('.tag'))]; };
          artikelOpenen('a00', true); await new Promise((r) => setTimeout(r, 100));
          uit.push(...vol(document.querySelector('#artikelScherm > .notitievol'))); artikelDicht();
          notitiePaneel(artikelen.find((a) => a.id === 'a00')); await new Promise((r) => setTimeout(r, 100));
          uit.push(...vol(document.querySelector('#keuze .notitievol'))); sluitKeuze();
          return uit; }""")
        br, pa = 'rgb(142, 58, 34)/normal', 'rgb(75, 60, 192)/normal'
        check('kleur: receptnotitie, ingrediëntnotitie (en tags) en receptregel bruinrood en recht; eigen notitie paars (lijst, leesstand, paneel)', kl == [br, br, br, br, pa] + [pa, br, br, br] * 2, kl)

        # 15. Regelafstand in de detailschermen gelijk aan de lijsten
        maat = await pg.evaluate("""async () => {
          const meet = (box) => { if (!box) return 'geen'; const r = [...box.querySelectorAll(':scope > .nregel')].map((x) => x.getBoundingClientRect());
            const gaps = []; for (let i = 1; i < r.length; i++) gaps.push(Math.round(r[i].top - r[i - 1].bottom));
            const f = getComputedStyle(box.querySelector('.nregel')); return f.fontSize + '/' + f.lineHeight + '/' + [...new Set(gaps)].join(','); };
          scherm.filter = 'L'; tekenBoodschappen(); artikelOpenen('a00', true); await new Promise((r) => setTimeout(r, 100));
          const lees = meet(document.querySelector('#artikelScherm > .notitievol'));
          document.getElementById('artikelBewerk').click(); await new Promise((r) => setTimeout(r, 100));
          const bewerk = meet(document.getElementById('artikelRnot')); artikelDicht();
          notitiePaneel(artikelen.find((a) => a.id === 'a00')); await new Promise((r) => setTimeout(r, 100));
          const paneel = meet(document.querySelector('#keuze .notitievol')); sluitKeuze();
          return [lees, bewerk, paneel]; }""")
        check('regelafstand: leesstand, bewerkscherm en paneel 17 px, regelhoogte 22,1 px, geen extra ruimte', all(m == '17px/22.1px/0' for m in maat), maat)

        # 16. Potlood op een touchscherm: focus op de kop, geen invoerveld (dus geen toetsenbord)
        fc = await pg.evaluate("""async () => {
          artikelOpenen('a00', true); await new Promise((r) => setTimeout(r, 100));
          document.getElementById('artikelBewerk').click(); await new Promise((r) => setTimeout(r, 50));
          const e = document.activeElement; const uit = e.tagName + '/' + e.textContent; artikelDicht(); return uit; }""")
        check('potlood op touch: focus op de kop "Artikel", niet in een invoerveld', fc == 'H2/Artikel', fc)

        # 18. Randen van invoervelden: licht (bewuste keuze, zie ontwerp §7a); versiestempel grijs als de andere grijze tekst
        rand = await pg.evaluate("""async () => { artikelOpenen('a00', false); await new Promise((r) => setTimeout(r, 100));
          const c = getComputedStyle(document.getElementById('artikelNotitie')).borderTopColor; artikelDicht();
          return [c, getComputedStyle(document.querySelector('.stempel')).color]; }""")
        check('randen invoervelden licht #CFCBE6 (bewuste keuze), versiestempel var(--grijs)', rand == ['rgb(207, 203, 230)', 'rgb(90, 100, 114)'], rand)

        check('geen fouten op de pagina', not pagefout, pagefout)
        await b.close()

asyncio.run(main())
print('\n' + ('GEEN FOUTEN' if not fouten else f'{len(fouten)} FOUT(EN): ' + ', '.join(fouten)))
sys.exit(1 if fouten else 0)
