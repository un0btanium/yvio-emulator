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
- Volume (keys 13 −, 14 +: the apps step by ±4 of 0..255, `audio_set_volume(0, audio_get_param(0) ± 4)`;
  the emulator's OS widens a ±4 step to ±16):
  - `volume_default.json`: no saved volume (0): the game sets 200 at its first sound.
  - `volume_keys.json`: saved 204; 14, 14, 13 during the intro → 220, each change followed by the
    game's `system/key_down.wav` click.
  - `menu_volume_keys.json`: the console menu changes the volume with 13/14 during its boot
    animation (in the game selection they move the selection instead); it carries over into the
    game the menu starts (204 → 220).
- `goods_not_here.json`: one player (blue on Grain) starts on antenna 4, skips through the
  equipment prompts, then puts the ship on Tobacco, which that port doesn't take; the game
  says so twice. Keys are pressed 0.5 s into each prompt, which cuts the speech short, as a
  player would. The game polls the board in a tight loop while it repeats the message, so the
  run also shows whether the RFID calls take virtual time: about 3 s wall time when they do,
  about 30 s (below real time) when they don't.
- `goods_delivery.json`: the same start, then the ship stands on Wood (loads it) and on antenna
  12 (Prinzapolca, which sets the destination); key 6 after each month's announcement, and after
  two months the ship arrives and the game pays 500 ducats (`of1_500`, then `ph5` for the total).
- `goods_delivery_mod.json`: `goods_delivery` with a modified `pirates/app.elf` that doubles the
  trade reward, from a card folder you make yourself:
  `cards/freibeuter-der-karibik/modded-double-rewards/pirates/app.elf` (only that file; the
  script lays this folder over `original`). The same trip pays 1000 (`of1_1000`).
- `v1.1_join_two_players.json`, `v1.1_goods_not_here.json`, `v1.1_goods_delivery.json`: the same three
  games on version 1.1 (the same keys, waits and expected sounds). In 1.1 the delivery trip takes 6 days
  longer (68 instead of 62); it still arrives after the second month and pays 500.
  `v1.1_goods_delivery_en.json` plays it in English: the English reward text has no `of1gw`/`of1dke`
  around the amount and goes on with `p0079` and `ph5` (the total).
- Player against player (sail away), two ships, Normal game:
  - The setup: blue and green both load Wood in San Juan and sail to Prinzapolca (arriving on day 69). Both are paid 500 there.
    Then both load Grain and set Camarco (antenna 18).
  - Green sets out after day 50 towards the port blue is heading for, with arrival days less than 20 apart, so the ships meet
    ("ship on the horizon", `p0307` … `p0401`). Key 6 fights, key 5 avoids the fight.
  - The game draws who attacks. The attacker chooses 9 (fire), 10 (board) or 11 (sail away) at `ofNbtop1`.
  - Other prompts on the way: equipment offers (`p0095`, key 5) and quest offers (key 5, or 6 for a won game of chance).
  - The emulator's random numbers start from the same seed in every run, so each script plays the same game every time.
    A different choice in the battle changes the later draws, and with them the quest offers and who arrives first.
  - `v1.1_pvp_flee_steals.json`: blue attacks and sails away, and the flight succeeds (`of1btesc`, `of1pvp4`).
    In Camarco blue is paid 600 (`of1_600`) and green's goods are gone (`of2_001`): in 1.1 a flight takes the other ship's cargo.
  - `v1.1_pvp_avoid.json`: key 5 avoids the fight. Both ships are paid 300 (`of1_300`, `of2_300`).
  - `v1.1_pvp_fire.json`: blue fires instead and loses (`of1btcn`, `of1pvp2`). The winner takes the cargo, as it should:
    green is paid 700 (`of2_700`), and blue's goods are gone (`of1_001`).
  - `pvp_flee.json`: the flee script's keys on version 1.0 (arrival in Prinzapolca on day 63). Here green attacks and sails
    away (`of2btesc`, `of2pvp4`). No cargo moves, and both ships are paid 300 (`of2_300`, `of1_300`).

Ids for `place` and `key`:
- Ships: 1 = blue, 2 = green, 3 = red, 4 = yellow.
- Goods fields (join): antennas 17 Grain, 16 Wood, 15 Tobacco, 14 Rum.
- Ports: antennas 0, 4 (start), 5, 7, 10, 12, 18, 19.
- Keys (bit n of the `os_get_keys` mask): 5 and 6 the two choice keys (6 also means continue),
  7 skip, 8 repeat the announcement, 12 menu.
