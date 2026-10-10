# Iron Meridian

A first-person tactical shooter that runs in the browser. Two four-operator squads, the Meridian Security Group and the Volk Group, fight team deathmatch through Old Town in the late-afternoon sun.

This is **Milestone 1 (the vertical slice)** of the Iron Meridian game design prompt, built in Three.js instead of Unreal Engine 5 so it runs anywhere with no install. All textures, models, animations and sounds are generated in code. The only dependency is Three.js r160, which is vendored in `vendor/three/`.

## Play

The game uses ES modules, so it has to be served over HTTP rather than opened as a file:

```sh
npx --yes http-server -c-1 -p 8090 shooter
# then open http://localhost:8090
```

Click **Deploy** to start. The game captures your mouse for aiming. Press **Esc** to pause and release it.

### Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Left click | Fire |
| Right click (hold) | Aim down sights |
| Shift (hold) | Sprint. Double-tap for tactical sprint. |
| C / Ctrl | Crouch. While sprinting: slide. |
| Z | Prone |
| Q / E (hold) | Lean left / right |
| Space | Jump, vault and mantle ledges |
| R | Reload. A tactical reload keeps one round in the chamber. |
| T | Mag check |
| B | Fire mode |
| 1 / 2 / mouse wheel | Switch weapon |
| G | Throw a frag |
| Tab (hold) | Scoreboard |
| Esc | Pause |

## What's in the slice

**Map: Old Town.** A 120 × 92 m town square with a fountain and statue, a church with a spire, rows of facades, streets of parked cars, a bus and a van, market stalls, sandbag and jersey-barrier cover, trees and street lamps. Two buildings are fully enterable:
- **Hotel Meridian** has three floors and a roof, connected by U-shaped stairs, with furnished rooms.
- **The Pharmacy** has two floors and roof access, with a shop counter and shelving downstairs and a flat upstairs.

**Guns, modelled part by part:**
- **KR-5 Kestrel** (5.56 assault rifle, 780 rpm): a working bolt and dust cover, folding iron sights, a selector, a magazine with a witness window, and receiver markings.
- **M12 Bastion** (12-gauge pump shotgun, 9-pellet 00 buck): a vent rib with a bead sight, a side saddle, a pump that cycles, and shells loaded one at a time.
- **P9 Warden** (9 mm pistol): a slide that cycles and locks back on empty, serrations, tritium night sights, and an optics cut.

Every gun has ejected brass and its own reload animations: tactical, empty, pistol, and shell-by-shell for the shotgun. The first-person gun is rendered in its own pass, so it never clips through walls.

**Gunsmith.** A lit turntable you can drag to rotate and scroll to zoom, with live stat bars that show the change from each part. There are 9 attachments across 5 slots:

| Slot | Attachments |
| --- | --- |
| Optic | Haldane red dot, Talon 4× scope (true picture-in-picture view with a mil-dot reticle) |
| Muzzle | Hush suppressor, Brace compensator, full choke |
| Underbarrel | Vertical grip, angled grip |
| Magazine | Extended magazine |
| Laser | LA-2 laser |

Three loadout slots (Rifleman, Marksman and Breacher) are saved in the browser.

**Ballistics.** Each bullet is a projectile with muzzle velocity and drop. It penetrates materials according to how much each one resists, ricochets at shallow angles, and leaves entry and exit holes. Damage depends on hit zone (head, chest, stomach, arms, legs), falls off with range, and is reduced by armour. Bullets that pass close to you make a supersonic crack.

**Characters and AI:**
- **Characters** are skinned humanoids built in code, with faction-specific kit: helmets, headsets, plate carriers, pouches and backpacks. Two-bone arm IK puts their hands on their guns, they react to hits, and they fall when they die.
- **Bots** detect you by sight, with a detection meter, and by sound. They share sightings by radio callouts, claim cover on a navigation graph, peek from cover, flank along routes that keep them out of sight, throw and dodge grenades, and fall back when they're hurt. There are three difficulty levels: Recruit, Regular and Veteran.

**Look and sound:**
- **Rendering:** a physical sky with image-based lighting, a low sun with soft shadows, ambient occlusion (GTAO), bloom, SMAA, ACES tone mapping and fog. Indoor lighting is adjusted as you move inside. There are three graphics presets: Medium, High and Ultra.
- **Audio** is synthesised with Web Audio: layered gunshots, outdoor slapback and indoor reverb, distant shots arriving at the speed of sound with their high end muffled, 3D positional sound, foley and footsteps on different surfaces.

**Match.** Team deathmatch, 4 v 4. The first team to 30 kills wins, or the leading team when the 8-minute clock runs out. It includes respawns with spawn protection, a kill feed, damage direction arcs, hit markers, a compass, a scoreboard, a death cam that shows who killed you, and an end-of-match screen.

## Project layout

```
index.html               page, HUD and menu markup, import map
css/style.css            UI styling
src/config.js            weapons, attachments, materials, hit zones, difficulty, presets, loadouts
src/main.js              boot, screen flow, pointer lock, main loop
src/core/                renderer, procedural textures and materials, geometry helpers, physics, audio, input
src/world/               Old Town layout, building generator, props, navigation graph, effects
src/weapons/             gun models, weapon state, ballistics, first-person viewmodel and animations
src/characters/          humanoid model and animation, hitboxes, bot AI, player controller
src/game/game.js         match rules, spawning, damage, grenades, noise and callouts
src/ui/                  HUD, menus, gunsmith turntable
vendor/three/            Three.js r160 and the add-ons used
```

## Known limitations

- No multiplayer. The slice is single-player against bots.
- In first person you see only your arms and gun, not your full body.
- Animations are procedural rather than motion-captured.
- The browser uses rasterised lighting with baked-style tricks. It has no Lumen, Nanite or ray tracing, which the full UE5 version in the prompt calls for.

The later milestones in the prompt (more maps, more weapons, more game modes, a progression system and multiplayer) are not built yet.
