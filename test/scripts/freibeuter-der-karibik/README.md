# Freibeuter der Karibik

Cards: `cards/freibeuter-der-karibik/original` (version 1.0, German only) and
`cards/freibeuter-der-karibik/original-v1.1` (version 1.1, German and English). An `emulator/`
folder in them doesn't matter here.

- `mode_choice.json`: boot, skip the intro, confirm the welcome, choose game mode Normal.
- `join_two_players.json`: the same, then the blue ship joins on Grain and the green one on Rum,
  and the game announces two players.
- `v1.1_language_de.json`, `v1.1_language_en.json`: `mode_choice` on version 1.1, with the card's
  default language (de) and with `"language": "en"`; the game then reads `texts_en.txt`,
  `files_en.txt` and plays `sounds/en/`.
- `menu_boot.json`, `v1.1_menu_boot.json`: boot the console menu (root `app.elf`) instead of the
  game. It plays a ~6 s boot animation (a tick sound per frame), reads root `lang.txt` (missing:
  German) and `menu/de_menu.txt`, looks for `NAME/app.elf` in the root folders, and as there is
  only one game it reads `PIRATES/info.txt` and starts it 1 s later with `os_exec`; the game then
  plays its intro.
- On `cards/freibeuter-der-karibik/original-v1.0-and-v1.1` (two games: version 1.0 in `pirates/`,
  1.1 in `pirates2/`, plus a root `lang.txt` with de and en for the menu, a copy of
  `pirates2/lang.txt`) the menu waits in its game selection: 13/14 (volume −/+) move between the
  two games and an entry that leads one level up, 12 (menu) chooses. One level up are the game
  selection and, with two or more languages in the root `lang.txt`, the language selection.
  - `menu_two_games_first.json`: 12 starts the first game (`pirates/`).
  - `menu_two_games_second.json`: 13, 12 start the second one (`pirates2/`).
  - `menu_up_back.json`: 14, 12 go one level up, 12 back into the game selection, 12 starts the first game.
  - `menu_language_en.json`: English selected in the root `lang.txt` → `menu/en_menu.txt`.
  - `menu_choose_language.json`: 14, 12 (up), 13, 12 (language selection), 13, 12 (English): the
    menu writes byte 1 of the root `lang.txt` (opened with mode "a", then fseek 1) and reads
    `menu/en_menu.txt`.
  With only one game (the other cards) the menu starts it about 1 s after reading its `info.txt`.
- `goods_not_here.json`: one player (blue on Grain) starts on antenna 4, skips through the
  equipment prompts, then puts the ship on Tobacco, which that port doesn't take; the game
  says so twice. Keys are pressed 0.5 s into each prompt, which cuts the speech short, as a
  player would. The game polls the board in a tight loop while it repeats the message, so the
  run also shows whether the RFID calls take virtual time: about 3 s wall time when they do,
  about 30 s (below real time) when they don't.

Ids for `place` and `key`:
- Ships: 1 = blue, 2 = green, 3 = red, 4 = yellow.
- Goods fields (join): antennas 17 Grain, 16 Wood, 15 Tobacco, 14 Rum.
- Ports: antennas 0, 4 (start), 5, 7, 10, 12, 18, 19.
- Keys (bit n of the `os_get_keys` mask): 5 and 6 the two choice keys (6 also means continue),
  7 skip, 8 repeat the announcement, 12 menu.
