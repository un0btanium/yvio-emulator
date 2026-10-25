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
