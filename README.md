# Golden Hour Valley

A cosy pixel-art farming game set in a valley where the sun has been setting for a hundred years.

Grandma Juniper has left you her farm. The village's **Great Lantern**, which holds the valley in its endless golden hour, is fading. Grow crops, gather glowcaps and make the old offering to light it again.

It runs in any modern browser, on desktop or phone. It uses no build step and no image files: all the art is drawn in code and all the sound is synthesised.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npm start          # http://localhost:8080
```

Progress saves in the browser automatically each night, when you quit to the title screen, and when you switch tabs.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD / arrow keys | Left stick |
| Use tool, talk, harvest, interact | Space / Enter / left click | **Use** button, or tap a tile next to you |
| Eat held item | F / right click | **Eat** |
| Pick hotbar slot | 1–0, Q / E, mouse wheel | Tap the slot |
| Bag | I / Tab | **Bag** |
| Menu (save, sound, quit) | Esc | ☰ |
| Toggle music | M | Menu |

### How it plays

- **Days** run from 6 AM to 2 AM, about 10 real minutes. Go to bed at the farmhouse door. If you stay up past 2 AM you pass out and lose 10% of your gold (capped at 500g).
- **Farming:** till farm grass with the hoe, plant seeds, and water them every day. A crop only grows on nights after it was watered. **Sunshowers** water everything for you.
- **Crops:** Sunwheat (3 days), Amber Carrot (4), Duskberry (5, then regrows every 2), Honey Melon (7), Ember Pumpkin (9).
- **Money:** hold anything and use the shipping bin beside the house. You're paid overnight.
- **Mabel's Stall** (village, 8 AM–8 PM) sells seeds, food, Brass Sprinklers (water the 8 tiles around them every morning), watering-can upgrades and a max-energy upgrade.
- **Energy:** tools cost energy. Eat food or sleep to restore it.
- **Foraging:** golden poppies grow wild everywhere, and glowcaps grow in the meadow south of the river.
- **The goal:** offer 20 Sunwheat, 12 Amber Carrots, 15 Duskberries, 5 Honey Melons, 3 Ember Pumpkins and 6 Glowcaps at the Great Lantern. Lighting it pays 1,000g and blesses your fields so crops sometimes grow an extra day overnight. After that you can keep farming as long as you like.

## Project layout

```
index.html        page, HUD and menu markup
css/style.css     UI styling
src/config.js     items, crops, shop stock, offering list, tuning numbers
src/util.js       RNG, colour and time helpers
src/world.js      the valley map, collision and zones
src/inventory.js  inventory slots and stacking
src/game.js       game rules and state (no DOM, fully testable)
src/sprites.js    procedural pixel art for tiles, objects, crops, people and icons
src/render.js     camera, golden-hour lighting, long shadows, particles, weather
src/audio.js      Web Audio sound effects and generative music
src/input.js      keyboard, mouse and touch input
src/ui.js         HUD, dialogue, shop, bag, offering and end-of-day screens
src/main.js       boot, main loop, saving and screen flow
tests/            headless tests for the game core
```

The game core (`src/game.js`) never touches the DOM. It emits events such as `toast`, `sfx`, `dialog` and `dayEnd`, and the UI and renderer listen for them. That separation is what lets the rules be tested headlessly.

## Tests

```sh
npm test
```

Runs the core rules headlessly in Node: map reachability, inventory, farming and growth, regrowing crops, tools, energy, shipping, the shop, sprinklers, passing out, the Lantern offering, save/load round-trips and collision.
