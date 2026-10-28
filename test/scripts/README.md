# Test scripts

One folder per game: `test/scripts/GAME/NAME.json`, with notes on that game's ids in its own
`README.md`. `node test/run.js test/scripts/GAME/NAME.json` boots the game headless and plays the
script.

- `cards`: card folders inside `cards/` (git-ignored; or the folder in `YVIO_CARDS`), as `GAME/VERSION`,
  e.g. `freibeuter-der-karibik/original`; later ones override earlier ones.
- `language`: optional, a language code of the game's `lang.txt` (e.g. `en`), selected before boot
  like the page's Language choice (`--language` on the command line overrides it).
- `app`: optional, the app to boot (default `pirates/app.elf`), e.g. `app.elf` for the console menu.
- `followExec`: optional, `true` reboots into the app an `os_exec` names (as the page does), e.g.
  when the menu starts the game; times run on across reboots (`--follow-exec` on the command line).
- `menuLanguage`: optional, a language code of the card root's `lang.txt` (the console menu's
  language, same format as a game's), selected before boot (`--menu-language`).
- `expectLanguage`: optional, `{"FOLDER": "code"}`: the language selected in `FOLDER/lang.txt` when
  the script ends (`""` = the card root), e.g. after choosing one in a menu.
- `steps`: run in order. Each step waits until a file matching `afterFile` (regex) is opened
  after the previous step (or until absolute virtual time `at`; with neither it starts when the
  previous step is done), waits `delay` ms, then holds
  `key` for `hold` ms (default 150), or performs `place: {"ship": 1..4, "antenna": 0..20 | null}`.
- `expectFiles`: regexes that must match successfully opened files, in this order.
- `timeoutMs`: virtual-time limit.
