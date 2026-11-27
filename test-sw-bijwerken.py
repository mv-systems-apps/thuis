"""App bijwerken (het bestand is van een nieuwere versie): één tik is genoeg (review thuis, 27-11-2026).
De service worker bedient de pagina uit de cache (stale-while-revalidate). Gewoon herladen gaf daardoor
eerst nog de oude versie. appBijwerken haalt de pagina vers op, zet hem in de eigen cache als het stempel
nieuwer is, en herlaadt pas dan. Zonder nieuwere versie: een melding en geen herladen.

  python3 test-sw-bijwerken.py            (vanuit de map van de app)
  APP=<map> python3 test-sw-bijwerken.py  (een andere versie van de app)
"""
import asyncio, http.server, threading, functools, os, re, sys, shutil, tempfile
from playwright.async_api import async_playwright

MAP = os.environ.get('APP') or os.path.dirname(os.path.abspath(__file__))
if os.path.basename(MAP) == 'tests': MAP = os.path.dirname(MAP)
WERK = tempfile.mkdtemp(prefix='thuis-bijwerken-')
for f in os.listdir(MAP):
    if os.path.isfile(os.path.join(MAP, f)) and not f.endswith(('.py', '.cjs', '.md')): shutil.copy(os.path.join(MAP, f), WERK)
APP = os.path.join(WERK, 'thuis.html')
TEKST = open(APP, encoding='utf-8').read()
OUD = re.search(r'Versie (\d{7}-[0-9A-F]{3})', TEKST).group(1)
NIEUW = OUD[:8] + 'FFF'

fouten = []
def check(naam, echt, verwacht):
    ok = echt == verwacht
    print(f"  {'ok  ' if ok else 'FOUT'} {naam}: {echt!r}" + ('' if ok else f" — verwacht {verwacht!r}"))
    if not ok: fouten.append(naam)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=WERK)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASIS = f'http://127.0.0.1:{srv.server_address[1]}/'

STEMPEL = "() => (document.getElementById('app-version-stamp') || {}).textContent || ''"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.goto(BASIS + 'thuis.html')
        await pg.evaluate("() => navigator.serviceWorker.ready")
        await pg.reload(); await pg.wait_for_timeout(800)
        check('de service worker bedient de pagina', await pg.evaluate("() => !!navigator.serviceWorker.controller"), True)
        # Zonder nieuwere versie: melding, niet herladen.
        await pg.evaluate("() => { window.__blijft = 1; appBijwerken(); }")
        await pg.wait_for_timeout(11500)
        check('geen nieuwere versie: melding, geen herladen', await pg.evaluate("() => [window.__blijft, !!document.getElementById('m-bijwerken')]"), [1, True])
        # Nieuwere versie op de server: één keer appBijwerken geeft meteen de nieuwe.
        open(APP, 'w', encoding='utf-8').write(TEKST.replace('Versie ' + OUD, 'Versie ' + NIEUW))
        async with pg.expect_navigation(timeout=15000):
            await pg.evaluate("() => appBijwerken()")
        await pg.wait_for_timeout(500)
        check('nieuwere versie: na één keer bijwerken staat de nieuwe versie er', await pg.evaluate(STEMPEL), 'Versie ' + NIEUW)
        await b.close()
    srv.shutdown()
    shutil.rmtree(WERK, ignore_errors=True)
    print("\n" + ("GEEN FOUTEN" if not fouten else f"{len(fouten)} FOUT(EN): " + ', '.join(fouten)))
    sys.exit(1 if fouten else 0)

asyncio.run(main())
