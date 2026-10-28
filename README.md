# Yvio Emulator

> Unofficial fan project, not affiliated with or endorsed by the makers of Yvio or the game. All
> trademarks belong to their owners. Do not open issues or pull requests that contain game files,
> sounds, texts or pictures of the games.


![preview](/examples/preview.png)

A browser emulator for the 2008 Yvio boardgame console.

The emulator consists of a basic static webpage, running the game locally in your browser. There is no backend server; no data is uploaded, everything stays in your browser.

**Game files and artwork are *not* included.** You will need to provide your own SD-card copy containing the game files (folder or `.zip` containing the .elf and audio files).

For an immersive experience, you can **provide your own images of the board and console overlay**, which can be aligned manually in the Settings to fit the console buttons and LED screen perfectly.

You can also **adjust the locations of the RFID antenna sensors** on the board via an editor, to be able to play games with different layouts. All settings can be exported and imported for convenience.

See the Quickstart guide below on how to play.


## Technical Info

The website runs the game on Unicorn.js (ARM7) with a (partially) reimplemented kuma OS in JavaScript, an virtual LED display, console buttons and audio output, and a interactive RFID board on which to move the game figures between the virtual RF antennas.


## (Known) Supported Games 

 * Freibeuter der Karibik 1.0
 * Freibeuter der Karibik 1.1

Currently, only the board game **Freibeuter der Karibik** is supported by the project. Version 1.0 and 1.1 seem to work. Version 1.1 also speaks English: choose it under **Console → Language** before clicking Power on. Other games have not been tested yet, but might also work.

However, the project has already been designed in a modular and customizable way, 
so additional game support should be easy to add in the future.

Of course, you are free to already try out other games. The emulator will find the game folder at the
card root (any folder with an `app.elf` other than `emulator/`, `menu/`, `osup/` and `system/`; e.g.
`pirates/` for Freibeuter). If a card has several such folders, you will be able to choose one.

By default, this emulator boots directly into the game instead of the console menu. This is slightly different behaviour compared to playing on the original console. However, under **Settings → Console → Boot from** you can let it boot to the **console menu** (the card's root
`app.elf`), just like the real console does: it plays its boot animation and then
starts the game itself. For this purpose the console's OS keys are shown while the menu runs; it lets you choose between different languages and games first if there are more than one (select with the Volume buttons, confirm with the Menu button). The menu text will be in German unless the card has its own `lang.txt` at the root.

Feel free to reach out if you are having issues or can confirm that other games also work correctly.


## Supported Languages

A game with more than one language in its `lang.txt` will let you select one under **Console → Language** (this will be hidden if there is just one language). When booting from the console menu, the Game and Language choices are hidden: the menu lets you choose the game and its own language, and the games' menus their language.
Technical note: This choice is written into the card copy's `lang.txt` (as the game's own menu does) and will be loaded on the next load already preselected.

The emulator UI itself currently only comes in English. German might be supported in the future, if needed we recommend using the browser translation in the meantime.


## Quick Start - How to play

You need your game's SD card and a card reader.

0. **Preparation: Copy the SD card content:** 
   Put the SD card into your computer and copy everything on it into a new folder,
   e.g. `freibeuter/`. Keep the files and folders as they are.
   For mobile play, create a zip of the folder.
   Create separate folders for different games.
   Only ever play with the copy; do *not* play from the SD card itself!
   This step has to only be done once; once for each of your games. You can then always start with step 1 right away.

   ![setup_create_copy](/examples/setup01.png)
1. **Open the emulator** at **https://un0btanium.github.io/yvio-emulator/** in your browser.
2. **Load the game:** In the left panel, under **Console**, click **Choose folder** and pick your SD card folder,
   or **Choose .zip**. The browser might ask you to confirm (again: No files are actually uploaded, just loaded by the browser).
   Wait a few seconds. You will know it worked when it says "Loaded: … game files. Ready!".
   
   ![setup_load_files](/examples/setup02.png)
3. **Click Power on.** The emulated console boots and the game starts. (If not, feel free to reach out.)
4. **Play.** 


**Controls:**
- Press buttons on the console.
- Drag-and-drop game figures onto a field on the board, or tap a figure once and then tap a field.
  - The game figures are initially in the **Off The Board** drawer (button in the bottom right
  corner).
- Access the settings anytime via the gear button in the bottom left corner.
  There are plenty of useful settings so have a look and explore them.


If you are playing a certain game, under **Settings** → **Figures** → **Show as**, you can select "Ships" for increased immersion. Have fun ;)

![figure_skins](/examples/setup03.png)


## Recommended: Add custom artwork, antenna layout and settings

Due to legal reasons, this project does not contain any game artwork itself, but you can provide your own for an immersive experience to also emulate the experience you would get from playing on the physical boardgame:

| File | What it is |
|---|---|
| `board.png` | A photo or scan of your game's board (as `.png`, `.jpg` or `.webp`). I recommend creating photos with your phone, and using a Perspective Cropping feature to just export the board. For higher resolution, you can take two photos, one of each half of the board and stitch them together as one final photo (e.g. in Paint). This should be an quadratic image with pixel size of multiples of 2, e.g. 1024x1024, 2048x2048. |
| `console_overlay.png` | A photo of the overlay sheet that lies on top of the game console. Once added, you can adjust its position in the Settings to fit exactly onto the console's buttons and LEDs. I recommend exporting the Settings once you managed to fit it perfectly (see below), so you can load these settings later and have to only align it once. |
| `board-antennas.json` | Defines where the RF antennas sensors sit on your board: Use the **Editor** under **Board & Pictures** (PC only) to define their locations, then export them to file. Different games have different antenna layouts. This is easier to do once you uploaded a board.png first. |
| `settings.json` | The settings can be saved and loaded at the top of the Settings section ([see example](examples/settings-default.json)) |

There are two ways to load these files:
- **Load them individually** in the Settings under **Board & Pictures** and **Settings → Load…**.
- **Recommended: Automatically load them together with your SD game card** by adding the files in a new folder `emulator/` inside your SD card folder, e.g. `freibeuter/emulator/board.png`. They will then be loaded together with the game every time. Each game (card SD folder) can come with its own files.
  ```
  freibeuter/
    pirates/  system/  …        (the game, unchanged)
    emulator/
      board.png  console_overlay.png  board-antennas.json  settings.json
  ```

Each file is optional. None of these files are uploaded anywhere, they stay in your browser.


# Development

This project was mostly vibe-coded with Claude.

## Run locally

ES modules don't load from `file://`, so serve this folder with any static server:

```sh
python3 -m http.server 8000     # then open http://localhost:8000/
```

## Folder Layout
- `index.html` — the page (`test/benchmark.html` is the speed benchmark of the core, for phones).
- `ui/` — the page's code:
  - `style.css`;
  - `app.js` — page logic (settings panel, drawer, card loading, power on/off, worker messages);
  - `console-ui.js` — the console (keys, LEDs, overlay);
  - `board-ui.js` — board and drawer surfaces with the ships;
  - `board-layout.js` (parsing) + `board-editor.js` — the antenna layout;
  - `settings.js` — the settings file (entries, defaults, checks).
- `examples/` — `board-antennas-example.json` (the default layout) and `settings-default.json`.
- `yvio-emulator/` — DOM-free emulator core, also used by the Node tests in `test/`:
  - `cpu.js` (interface), `cpu-unicorn.js`, `elf.js`
  - `machine.js` (memory map, syscall trap, scheduler loop, audio task)
  - `tnkernel.js`, `kuma.js` (syscalls)
  - `files.js` (virtual SD card), `display.js` (framebuffer decoding)
  - `syscalls.js` (syscall slot table, generated from the reverse-engineering notes)
  - `worker.js` (runs the machine in a Web Worker), `audio-worklet.js` (playback)
- `vendor/unicorn/` — Unicorn.js v2.1.4 ARM build (GPL-2.0), see `vendor/unicorn/README.md`.

## Features
- `index.html` is one clean view: the board fills the screen and the console stands in its middle, as on the real game board.
  - **Settings** (gear, bottom left) open on load as a panel left of the board (above it in
    portrait), so changes to the console size or overlay show at once. Sections: **Console** (load
    the card, **Power on** / Power off, pause (below the drop box one line: "Loaded: N game files, M emulator files. Ready!" after
    loading, then "Playing…", "Paused." or "Ready!"), and the OS keys menu / volume −/+ (12–14) if "Show OS keys" is on in Settings → Console), **Board & Pictures** (antenna layout file, board and overlay pictures),
    **Settings** (groups Figures: shown as Basic circles or Ships; Console: boot from game/console menu, volume, console size, Show OS keys; Console
    Overlay: overlay adjustment; Additional Overlays & Views: antenna ids, console key ids, antenna
    areas never / on interact / always, unused antennas; Fullscreen: fullscreen, keep awake),
    **Status & Logs**, **About** (disclaimer, licenses). Hiding the unused antennas moves ships on them off the board.
  - **Drawer "Off The Board"** (bottom right): **Figures** (off the board) and **Unused
    Antennas** (antennas whose place on the board is unknown). It sits right of the board (next to
    its button) in landscape and below it in portrait.
    On a wide screen settings and drawer can both be open; on a phone (portrait or narrower than
    900 px) only one at a time, and closing the settings brings the drawer back. Ships can be
    dragged, or tapped and then a field tapped, between drawer and board.
  - Tap the LED display to enlarge the console (small screens); tap again or next to it to shrink it.
  - No keyboard controls: everything is pointer/touch. The Console section lists the controls.
  - The drawer state, open settings sections, console size, view options, opacity and overlay adjustments are
    remembered in the browser.
- **Your own files on the card**: an optional `emulator/` folder in your SD card
  folder may hold `board.png` (a photo of your board), `console_overlay.png` (a photo of the
  overlay sheet) and `board-antennas.json` (the antenna layout, e.g. from the built-in editor). Pictures may
  also be `.jpg`/`.jpeg`/`.webp`. A `settings.json` there sets the settings (see below). They are
  used every time the card (folder or zip) is loaded and are not passed to the game. The pictures
  are game artwork: never commit or publish them.
- **Settings file**: **Save** at the top of Settings downloads `settings.json` with every setting;
  **Load…** applies one (as does `emulator/settings.json` on the card, after the pictures).
  Sections and labels are the ones in the UI, choices are the option text, e.g.
  `{ "Figures": { "Show as": "Ships" }, "Console": { "Audio volume": 60 } }`.
  `examples/settings-default.json` lists every entry with its default. Entries a file leaves out keep
  their current value; unknown entries and values outside a slider's range are reported and
  skipped. Applied settings are remembered like changes in the UI. The Console Overlay values
  belong to the current overlay picture (or the next one, if none is loaded yet). The entries are
  defined in `ui/settings.js`; `node test/settings.js` checks them against `index.html` and
  `examples/settings-default.json`.
- **Antenna layout**: where the antennas sit on the board comes from the card's
  `emulator/board-antennas.json`, or a `.json` file loaded under Board & Pictures (remembered in
  the browser until **Reset**), else `examples/board-antennas-example.json` (our own measurements of the
  real board, no names). Other `board-antennas-*.json` files are git-ignored, so layouts with the
  game's place names stay local:
  ```json
  { "boardAntennas": [
    { "antennaId": 18, "boardCoords": { "x": 245, "y": 190 }, "fallbackName": "Port", "radius": 70 } ] }
  ```
  `antennaId` 0–20; `boardCoords` in pixels of the 1024 × 1024 board picture (origin top left);
  `fallbackName` (shown only without a board picture, default empty) and `radius` (area for hover
  and drop, default 60) are optional. Antennas not listed go to "Unused Antennas" in the drawer; a
  ship on an antenna that is no longer shown goes off the board. An invalid file shows the reason
  and keeps the current layout. Parsed by `ui/board-layout.js`.
- **Antenna editor** (PC only, **Editor** under Board & Pictures, `ui/board-editor.js`): starts with the
  current layout; **Clear All** (next to **Save Antennas**, while editing) empties the board. Click the board for the centre, move the mouse and click again for the radius (min
  30, 10 px steps, previewed; Escape cancels); a dialog then asks for the antenna id and optional
  name, with position and radius editable. Clicking a placed antenna changes or deletes it.
  **Save Antennas** downloads `board-antennas.json` and uses it like a loaded file; **Cancel**
  restores the previous layout.
- `test/benchmark.html` measures the speed of the emulator core, e.g. on a phone (also on the
  published site).
- The board shows the card's `emulator/board.png` or a picture you load; otherwise a drawn map.
- The console shows the card's `emulator/console_overlay.png` or a picture you load over the keys
  at 60 % opacity. The "Console Overlay" settings set the opacity and rotates (90° steps and fine), zooms, stretches
  and moves it, and resizes the LED display to fit the sheet's display window; the adjustment is remembered per picture name. The alignment of the local photo
  is `OVERLAY_DEFAULT` in `ui/console-ui.js`.


## Tests (Node ≥ 18)
The tests run the real game, so they need an SD-card copy in `cards/` (git-ignored), one folder
per game and version: `cards/GAME/VERSION/`, e.g. `cards/freibeuter-der-karibik/original/` with
`pirates/`, `system/`, … (and optionally `emulator/`) inside. `YVIO_CARDS` points them at another
folder.

```sh
node test/run.js --trace --quiet-time --until-wav   # syscall trace up to the first sound file
node test/run.js --ms 15000 --wav build/boot.wav     # 15 s headless, dump the mixed audio
node test/run.js test/scripts/freibeuter-der-karibik/mode_choice.json   # scripted run with assertions
node test/run.js --files --display --press 3000:7     # file log, ASCII display, press key 7 at 3 s
node test/run.js --app OTHER/app.elf --card cards/OTHER-GAME/original   # another game folder
node test/run.js --language en --card cards/freibeuter-der-karibik/original-v1.1   # a language of lang.txt
node test/run.js --app app.elf --follow-exec --files   # boot the console menu, follow it into the game
```
Browser smoke test: serve this folder on port 8765 (`python3 -m http.server 8765`), start a
headless Chromium-based browser with `--remote-debugging-port=9333` (it must be able to read the
zip), then `node test/browser/ui-smoke.js http://127.0.0.1:8765/index.html CARD.zip --join`
(boot, intro, mode choice, ships from the drawer onto the goods fields, power off and on). With
`--extras` it also checks that the zip's `emulator/` pictures and layout are used,
`--card-settings` its `settings.json`, and `--settings FILE` loads FILE with Load… and compares
what Save writes. `node test/settings.js` and `node test/files.js` (card root, game folders, lang.txt) need no card (they also run in the Pages workflow).
`test/browser/bench.html?card=/cards/freibeuter-der-karibik/original/` measures the speed of the core in a browser.

## Deployment
`.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main` (or by hand from the
Actions tab). It checks the JS syntax, copies only the page files (not `test/`) and stops if the
site would contain any other file type, e.g. a picture or a game file.
Repo setting: Settings → Pages → Source: **GitHub Actions**.

## License
GPL-2.0-or-later (`LICENSE`). The vendored Unicorn.js build is GPL-2.0, see `vendor/unicorn/README.md`.
