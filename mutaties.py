"""Mutatieloop over thuis-tests.cjs: sloopt de kern op bekende plekken en laat zien
welke controles rood worden. Faalt (exitcode 1) als een mutatie niet meer aangrijpt
of door geen enkele controle wordt gevangen.   python3 mutaties.py"""
import subprocess, os, shutil, sys, tempfile
MUTATIES = [
  ("allebei op de lijst = botsing", "if (h.veld === 'op' && cur !== '' && nieuw !== '') return { status: 'al' };", ""),
  ("na het moment gekocht telt niet", "if (r.gekocht.some((d) => d >= mDatum)) continue;", ""),
  ("verwijderd artikel weer aanmaken", "  return r ? regel.doe(model, h, verz, r) : VERVALLEN;", "  return r ? regel.doe(model, h, verz, r) : { status: 'ok' };"),
  ("geen UTF-8-controle", "new TextDecoder('utf-8', { fatal: true })", "new TextDecoder('utf-8')"),
  ("nieuwer formaat toch lezen", "if (v > formaatGetal(FORMAAT)) return { ok: false, reden: 'nieuwer-formaat' };", ""),
  ("verkeerde opbouw stil overslaan", "    if (!isObject(deel)) throw new Error(k + ' is geen object');", "    if (!isObject(deel)) continue;"),
  ("dubbele naam niet samenvoegen", "const zelfde = verz.get(h.id) || zoekOpNaam(verz, v.naam);", "const zelfde = verz.get(h.id);"),
  ("afdeling-id niet vervangen", "    if (veld === 'afd.id') { if (isObject(h.afd) && typeof h.afd.id === 'string') n.afd = Object.assign({}, h.afd, { id: a(h.afd.id) }); continue; }", "    if (veld === 'afd.id') continue;"),
  ("melding met Sluiten verdwijnt vanzelf", "function sluitMelding(id, tekst, soort) { melding(", "function sluitMelding(id, tekst, soort) { setTimeout(() => meldingWeg(id), 9000); melding("),
  ("vervanging niet doorgeven", "    const h = vervangIds(h0, alias);", "    const h = h0;"),
  ("verwijderde winkel blijft bij artikelen", "  if (h.soort === 'winkel') for (const a of model.artikelen.values()) a.ligt.delete(h.id);", ""),
  ("patroon al bij twee aankopen", "if (d.length < 3 || gaten.length < 2) return { laatst, interval: null };", "if (gaten.length < 1) return { laatst, interval: null };"),
  ("zonder winkel bij onbekend", "    if (!a.plekken.length) { zonder.push(a); continue; }", ""),
  ("ook-elders maakt nodig", "    const alleen = hier.filter((a) => a.plekken.length === 1).map((a) => a.naam);", "    const alleen = hier.map((a) => a.naam);"),
  ("archief negeert weg", "  return (r.weg || '') > g ? r.weg : g;", "  return g;"),
  ("archief negeert de instelling", "    const dagen = BEWAREN[instelling(model, 'archief', 'bewaren')];", "    const dagen = BEWAREN['1j'];"),
  ("aantal niet gecontroleerd", "    aantal: { type: 'aantal', zet: true, geldig: OOK_LEEG((v) => AANTAL.test(v)) },", "    aantal: { type: 'aantal', zet: true },"),
  ("link: http toegestaan", "  if (u.protocol !== 'https:' || u.username || u.password) return null;", "  if (u.username || u.password) return null;"),
  ("herhalen slaat voorbije niet over", "  for (let i = 0; i < 1000 && voorbij(x); i++) x = verschuif(x, 1, herhaal, dagWens);", ""),
  ("te laat afgerond komt op vandaag", "periodeSoort(x) === 'dag' ? x <= vandaag :", "periodeSoort(x) === 'dag' ? x < vandaag :"),
  ("suggestie zonder bovengrens", "if (sinds < p.interval || sinds > 4 * p.interval) return null;", "if (sinds < p.interval) return null;"),
  ("deze week t/m zondag vergeten", "  return g.eind <= zondag ? 'week' : 'later';", "  return g.eind <= vandaag ? 'week' : 'later';"),
  ("maandfilter te ruim", "  if (filter === 'maand') return datumTekst(new Date(j, m + 1, 0));", "  if (filter === 'maand') return datumTekst(new Date(j, m + 2, 0));"),
  ("tag zoekt ook in de naam", "    return tagsVan(notitie).some((g) => g.sleutel.indexOf(k) === 0);", "    return tagsVan(notitie + ' ' + naam).some((g) => g.sleutel.indexOf(k) === 0);"),
  ("winkel-link niet gecontroleerd", "    link: { type: 'tekst', zet: true, geldig: OOK_LEEG((v) => veiligeLink(v) === v) }\n  },\n  artikel: {", "    link: { type: 'tekst', zet: true }\n  },\n  artikel: {"),
  ("afgerond: nieuwste wint niet meer", "    klaar: { type: 'tekst', zet: true, samen: 'nieuwste' }", "    klaar: { type: 'tekst', zet: true }"),
  ("regelsleutel mist plekken", "    sleutel: (m) => Array.from(m, ([w, a]) => w + ':' + a).join(',')", "    sleutel: (m) => String(m.size)"),
  ("leeg bestand weer geldig", "  if (tekst.trim() === '') return { ok: false, reden: 'leeg' };", "  if (tekst.trim() === '') return { ok: true, model };"),
  ("soortwissel zet geen weg", "&& String(h.t).slice(0, 10) > (r.weg || '')) r.weg = String(h.t).slice(0, 10);", "&& false) r.weg = '';"),
  ("pauze na terugzetten genegeerd", "  if (pauze && vandaag <= pauze) return 0;", ""),
  ("wekelijks-dag niet gecontroleerd", "    dag: { geldig: (v) => Object.prototype.hasOwnProperty.call(WEEKDAG, v), zet: true, standaard: 'za' },", "    dag: { geldig: (v) => true, zet: true, standaard: 'za' },"),
  ("instelling: standaard bij ongeldige waarde kwijt", "  return isTekst(v) && spec.geldig(v) ? v : (spec.standaard || '');", "  return v || (spec.standaard || '');"),
  ("constructor-veld kwijt", "if (!Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(", "if (!(k in o)) Object.defineProperty("),
  ("aankopen niet beperkt", "  if (model.aankopen.size <= n) return 0;", "  return 0;"),
  ("aankoop dubbel", "  if (verz.has(h.id)) return { status: 'al' };\n  try { verz.set(h.id, recordUitJson(h.soort", "  try { verz.set(h.id + 'x', recordUitJson(h.soort"),
  ("historie niet opgeruimd", "  for (const r of Array.from(model.historie.values())) if (r.tijd.slice(0, 10) < hg)", "  for (const r of []) if (r.tijd.slice(0, 10) < hg)"),
  ("maand vergeet de dag", "Math.min(dagWens || x.getDate(), laatste)", "Math.min(x.getDate(), laatste)"),
  ("B1: afvinken van vorige week haalt nieuwe week weg", "&& model.nu && wk.teruggezet <= model.nu && String(h.t || '').slice(0, 10) < wk.teruggezet.slice(0, 10)) return { status: 'al' };", "&& false) return { status: 'al' };"),
  ("B3: verdachte klok toch reset", "  const terug = verdacht ? 0 : wekelijksTerug(model, nu);", "  const terug = wekelijksTerug(model, nu);"),
  ("K2: terug met verdwenen winkel", "      if (!winkel) a.ligt.delete(w);\n", "      if (false) a.ligt.delete(w);\n"),
  ("K2: rechtzetten niet opgeslagen", "gewijzigd: tekst !== voor || rechtgezet > 0 || gelezen.omgezet };", "gewijzigd: tekst !== voor || gelezen.omgezet };"),
  ("omgezet bestand niet opgeslagen", "gewijzigd: tekst !== voor || rechtgezet > 0 || gelezen.omgezet };", "gewijzigd: tekst !== voor || rechtgezet > 0 };"),
  ("K3: weer 7 dagen afstand", "moment.getDate() - 4, moment.getHours()", "moment.getDate() - 7, moment.getHours()"),
  ("K6: alle <woord> weg", ".replace(/<\\/?(?:a|abbr|", ".replace(/<\\/?(?:[a-z]+|abbr|"),
  ("K10: bezette naam vervalt", "  if (zelfde && h.soort === 'artikel') return { status: 'samengevoegd', id: zelfde.id };", ""),
  ("twee resets per week", "  if (vorige !== '' && vorige > tijdstipTekst(vierEerder)) return 0;", ""),
  ("losse < weer weg", "    .replace(/<!--(?:[^-]|-(?!->))*-->/g, ' ')", "    .replace(/<!--(?:[^-]|-(?!->))*-->/g, ' ').replace(/[<>]/g, '')"),
  ("onzichtbare tekens blijven", "\\u180E\\u200B-\\u200F", "\\u180E\\u200C"),
  ("alle backups weg", "return lijstB.filter((b) => !(b.d >= grensDag || (b.maand >= grensMaand && eersteVanMaand.has(b.n)))).map((b) => b.n);", "return lijstB.map((b) => b.n);"),
  ("aanbod: zonder winkels telt mee", "    const p = a.plekken.find((x) => x.winkel === winkel.id);\n    if (!p) continue;", "    const p = a.plekken.find((x) => x.winkel === winkel.id) || { afd: '' };"),
  ("aanbod: verdwenen afdeling kwijt", "    if (p.afd && per.has(p.afd)) per.get(p.afd).push(a); else onbekend.push(a);", "    if (p.afd && per.has(p.afd)) per.get(p.afd).push(a); else if (!p.afd) onbekend.push(a);"),
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
