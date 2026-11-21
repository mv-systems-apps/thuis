#!/usr/bin/env python3
"""
Hoogt de cache-versie in sw-thuis.js met 1 op, zodat gebruikers na een update de
nieuwste bestanden krijgen.

Het VERSIESTEMPEL in thuis.html hoogt dit script niet op. Dat gaat met de hand,
zoals de gedeelde conventies het voorschrijven: een script verhoogt het stempel
ook bij een wijziging die niemand hoeft te zien, en dan staat er een
nieuwe-versie-melding tegenover niets.

Dit script deed dat eerder wél, met een goede reden: het stempel werd vergeten,
en dan ziet de updatecontrole geen nieuwe versie en blijft de melding uit. Die
reden is nu afgedekt door check_app.py in apps-basis, dat waarschuwt zodra
thuis.html is gewijzigd terwijl het stempel nog op de oude waarde staat --
zowel vóór het committen als wanneer de laatste commit het heeft laten staan.
Dus: dit script voor de cachenaam, check_app.py als vangnet voor het stempel.

Gebruik:
    python3 update_cache_version.py
    python3 ../apps-basis/check_app.py thuis.html --basis ../apps-basis

Verwacht dat dit script in dezelfde map staat als sw-thuis.js (of pas SW_PATH
hieronder aan).
"""

import re
import sys
from pathlib import Path

SW_PATH = Path(__file__).parent / "sw-thuis.js"
VERSION_RE = re.compile(r"const CACHE_VERSION = (\d+);")


def main():
    if not SW_PATH.exists():
        print(f"Kan {SW_PATH} niet vinden.", file=sys.stderr)
        sys.exit(1)

    text = SW_PATH.read_text(encoding="utf-8")
    match = VERSION_RE.search(text)
    if not match:
        print("Kon CACHE_VERSION niet vinden in sw-thuis.js.", file=sys.stderr)
        sys.exit(1)

    old_version = int(match.group(1))
    new_version = old_version + 1
    new_text = VERSION_RE.sub(f"const CACHE_VERSION = {new_version};", text, count=1)

    SW_PATH.write_text(new_text, encoding="utf-8")
    print(f"Cache-versie bijgewerkt: thuis-v{old_version} -> thuis-v{new_version}")
    print("Het versiestempel in thuis.html is NIET aangeraakt: dat gaat met de hand.")
    print("Vergeet niet thuis.html en sw-thuis.js samen opnieuw te uploaden.")


if __name__ == "__main__":
    main()
