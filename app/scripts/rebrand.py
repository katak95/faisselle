#!/usr/bin/env python3
"""
Yogurt's tree, renamed to Figolu: what .github/workflows/sync-yogurt.yml runs on every new Yogurt before merging it,
so a Yogurt change merges into Figolu without conflicting on the name. It does only the mechanical part of the
rename; everything else Figolu changed is in Figolu's own commits.

  python3 app/scripts/rebrand.py [repository root]   (prints how many files it changed)
  python3 app/scripts/rebrand.py --check            (changes nothing; lists what it would change, fails if any)

Rules:
- "Yogurt" as a whole word becomes "Figolu". Names inside identifiers (YogurtApi, AboutYogurt), YOGURT_ variables and
  the yogurt-* helpers are internal and stay.
- A line that already names Figolu, or says "rebrand: keep", is left alone: it is Figolu's own (credits, the folder
  migration). Yogurt's own lines never name Figolu, so this never keeps an old name by mistake. A line naming Frigade
  keeps the word Yogurt (it credits Yogurt).
- Yogurt's links (github.com/FrigadeHQ/yogurt, yogurt.so) become Figolu's repository.
- A file with "rebrand: keep-file" in it is left alone.
- so.yogurt.* (the app and its helpers) becomes com.katak95.figolu.*, and the few fixed points below follow.
- Running it twice changes nothing (test/rebrand.test.ts checks it on Figolu itself).
"""
import re
import sys
from pathlib import Path

GLOBS = ['app/src/**/*', 'app/e2e/**/*', 'app/test/**/*', 'app/native/**/*', 'app/scripts/**/*', 'app/build/*.sh', 'app/build/*.svg',
         'app/build/*.plist', 'app/resources/about/*', '.github/workflows/*', 'docs/**/*', 'README.md', 'THIRD_PARTY_NOTICES.md',
         'app/electron-builder.yml', 'app/playwright.config.ts']
SKIP_EXT = {'.png', '.icns', '.ttf', '.wav', '.zip', '.jpg', '.jpeg', '.webp', '.ico', '.lock', '.pdf', '.gif', '.mp4'}
SKIP_DIRS = {'node_modules', 'target', 'out', 'dist', '.git'}
# a whole word; an escape just before it (the n of \\n in a string) doesn't make it part of another word
WORD = re.compile(r'(?:(?<![A-Za-z0-9_])|(?<=\\[nrt]))Yogurt(?![A-Za-z0-9_])')
OURS = re.compile(r'Figolu|Frigade')

# exact replacements, file by file: the places where the name is not just the word
FIXED = {
    'app/electron-builder.yml': [
        ('  owner: FrigadeHQ\n  repo: yogurt', '  owner: katak95\n  repo: figolu'),
        ('extraMetadata:\n  name: yogurt', 'extraMetadata:\n  name: figolu'),
        ('# Linux: `yogurt` becomes a launcher', '# Linux: `figolu` becomes a launcher'),
        ('  executableName: yogurt\n', '  executableName: figolu\n'),
        ('but the window is "yogurt".', 'but the window is "figolu".'),
    ],
    'app/build/linux-launcher.sh': [('(yogurt-bin)', '(figolu-bin)'), ('exec "$here/yogurt-bin" "$@"', 'exec "$here/figolu-bin" "$@"')],
    'app/scripts/linux-launcher.cjs': [
        ('on Linux, `yogurt` becomes build/linux-launcher.sh and Electron moves to yogurt-bin', 'on Linux, `figolu` becomes build/linux-launcher.sh and Electron moves to figolu-bin'),
        ('on `yogurt`: they belong', 'on `figolu`: they belong'),
    ],
    'app/src/main/detect.ts': [("win32: ['yogurt-audio.exe', 'yogurt.exe'], linux: ['yogurt-audio', 'yogurt', 'Figolu'] }",
                                "win32: ['yogurt-audio.exe', 'figolu.exe'], linux: ['yogurt-audio', 'figolu', 'figolu-bin', 'Figolu'] }")],
    'app/test/detect.test.ts': [("[['win32', ['yogurt-audio.exe', 'yogurt.exe']], ['linux', ['yogurt-audio', 'yogurt', 'Figolu']]]",
                                 "[['win32', ['yogurt-audio.exe', 'figolu.exe']], ['linux', ['yogurt-audio', 'figolu', 'figolu-bin', 'Figolu']]]")],
    'app/src/shared/project.ts': [("export const projectWebsite = 'https://yogurt.so'", "export const projectWebsite = 'https://github.com/katak95/figolu'"),
                                  ("export const projectRepository = 'https://github.com/FrigadeHQ/yogurt'", "export const projectRepository = 'https://github.com/katak95/figolu'")],
    'app/src/shared/exportNotes.ts': [("'[Figolu](https://yogurt.so)'", "'[Figolu](https://github.com/katak95/figolu)'")],
    'app/test/exportNotes.test.ts': [(r'\(https:\/\/yogurt\.so\)', r'\(https:\/\/github\.com\/katak95\/figolu\)')],
    'app/test/aboutYogurt.test.ts': [('href="https://github.com/FrigadeHQ/yogurt"', 'href="https://github.com/katak95/figolu"')],
    'app/test/share.test.ts': [("urls: ['https://yogurt.so']", "urls: ['https://github.com/katak95/figolu']")],
}
# whole-file word swaps for files that name the Linux binary
FIXED_WORDS = {'app/test/linuxLauncher.test.ts': [("'yogurt'", "'figolu'")]}


REPO = 'https://github.com/katak95/figolu'


def rename_text(text: str, test: bool = False) -> str:
    out = []
    for line in text.split('\n'):
        # Figolu's own lines: they name Figolu, or say to keep them (the credits to Yogurt)
        if 'Figolu' in line or 'rebrand: keep' in line:
            out.append(line); continue
        # Yogurt's links are Figolu's: its repository and its website (Figolu has no website: the repository)
        line = line.replace('https://github.com/FrigadeHQ/yogurt', REPO).replace('https://yogurt.so', REPO)
        # a test expecting the website's name, as the app shows it, sees the repository's host
        if test:
            line = line.replace('yogurt.so', 'github.com')
        out.append(line if 'Frigade' in line else WORD.sub('Figolu', line))
    return '\n'.join(out).replace('so.yogurt.', 'com.katak95.figolu.')


def rebrand(root: Path, check: bool = False) -> list:
    changed = []
    for g in GLOBS:
        for p in sorted(root.glob(g)):
            rel = p.relative_to(root).as_posix()
            if not p.is_file() or p.suffix.lower() in SKIP_EXT or SKIP_DIRS & set(p.relative_to(root).parts):
                continue
            if rel in ('app/scripts/rebrand.py', 'app/scripts/brand.py'):
                continue
            try:
                s = p.read_text()
            except UnicodeDecodeError:
                continue
            if 'rebrand: keep-file' in s:
                continue
            t = rename_text(s, test=rel.startswith(('app/test/', 'app/e2e/')))
            for a, b in FIXED.get(rel, []):
                t = t.replace(a, b)
            for a, b in FIXED_WORDS.get(rel, []):
                t = t.replace(a, b)
            if t != s:
                if not check:
                    p.write_text(t)
                changed.append(rel)
    return changed


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--check']
    check = '--check' in sys.argv[1:]
    root = Path(args[0] if args else Path(__file__).resolve().parents[2])
    files = rebrand(root, check)
    # --check: what would change, and a failing exit when anything would
    if check:
        print('\n'.join(files))
        sys.exit(1 if files else 0)
    print(len(files))
