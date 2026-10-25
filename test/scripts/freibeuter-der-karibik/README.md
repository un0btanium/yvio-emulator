# Freibeuter der Karibik

Card: `cards/freibeuter-der-karibik/original` (an `emulator/` folder in it doesn't matter here).

- `mode_choice.json`: boot, skip the intro, confirm the welcome, choose game mode Normal.
- `join_two_players.json`: the same, then the blue ship joins on Grain and the green one on Rum,
  and the game announces two players.

Ids for `place` and `key`:
- Ships: 1 = blue, 2 = green, 3 = red, 4 = yellow.
- Goods fields (join): antennas 17 Grain, 16 Wood, 15 Tobacco, 14 Rum.
- Ports: antennas 0, 4 (start), 5, 7, 10, 12, 18, 19.
- Keys (bit n of the `os_get_keys` mask): 5 and 6 the two choice keys (6 also means continue),
  7 skip, 8 repeat the announcement, 12 menu.
