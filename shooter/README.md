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

### On a phone or tablet

Hold the phone sideways. Touch controls appear when you deploy, and nothing captures the pointer.

| Control | Action |
| --- | --- |
| Left thumb, anywhere on the left | Move. The stick is analog. Push it to the rim to sprint, or twice quickly for a tactical sprint. |
| Right thumb, anywhere on the right | Look |
| Fire (the big red button) | Fire. Keep your thumb on it and drag to aim while you shoot. |
| Small fire button (left) | Fire while your right thumb looks |
| Sights | Aim down sights (tap on, tap off) |
| Jump | Jump, vault and mantle ledges |
| Crouch | Tap: crouch, or slide while sprinting. Hold: prone. |
| Reload | Tap: reload. Hold: mag check. |
| Frag, Swap, Mode | Throw a frag, switch weapon, change fire mode |
| ☰ and II (top right) | Scoreboard and pause |

Phones start on the **Mobile** graphics preset, and the menus and HUD shrink to fit. In the gunsmith, drag to turn the gun and pinch to zoom. The match pauses when you switch apps or turn the phone upright. On Android, deploying also goes fullscreen and locks landscape where the browser allows it. iPhone Safari doesn't allow that for web pages.

## What's in the slice

**Map: Old Town.** A 120 × 92 m town square with a fountain and statue, a church with a spire, two five-storey Soviet panel blocks (one sunlit, one backlit by the low sun), rows of pre-war stucco buildings with green shutters and shopfronts, two barricaded side streets, parked and burnt-out cars, a minibus and two gutted buses, market stalls, sandbag and jersey-barrier cover, trees and street lamps. Two buildings are fully enterable:
- **Hotel Meridian** has three floors and a roof, connected by U-shaped stairs, with furnished rooms.
- **The Pharmacy** has two floors and roof access, with a shop counter and shelving downstairs and a flat upstairs.

**Guns, modelled part by part:**
- **KR-5 Kestrel** (5.56 assault rifle, 780 rpm): a working bolt and dust cover, folding iron sights, a selector, a magazine with a witness window, and receiver markings.
- **M12 Bastion** (12-gauge pump shotgun, 9-pellet 00 buck): a vent rib with a bead sight, a side saddle, a pump that cycles, and shells loaded one at a time.
- **P9 Warden** (9 mm pistol): a slide that cycles and locks back on empty, serrations, tritium night sights, and an optics cut.

Every gun has ejected brass and its own reload animations: tactical, empty, pistol, and shell-by-shell for the shotgun. The first-person gun is rendered in its own pass, so it never clips through walls.

**Gunsmith.** A lit turntable you can drag to rotate and scroll (or pinch) to zoom, with live stat bars that show the change from each part. There are 9 attachments across 5 slots:

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
- **Light and atmosphere:**
  - A low golden-hour sun with soft shadows, and warm bounce light from the sunlit facades into the shade.
  - A sky of drifting cumulus over the Preetham atmosphere. The clouds are self-shadowed with silver linings towards the sun, and they hide the sun disc when they pass in front of it.
  - Cloud shadows drift across the town. They are laid out in the sun's shadow-map space, so they line up with the clouds, and the god rays and the first-person weapon dim with them.
  - Raymarched volumetric light: height haze lit through the sun's shadow map, so god rays fall between buildings and through windows into rooms. It's smoothed over time and blurred without crossing edges, so it stays clean rather than grainy.
  - Screen-space sun shafts that streak through leaves and past rooflines when you face the sun.
  - Dust motes that only show up where sunlight reaches them, ash flakes drifting out of focus near the camera, and a flock of pigeons circling the square.
- **Surfaces** are baked on the GPU at load time: colour, normal, and AO/roughness maps at up to 2048² on Ultra.
  - Lime stucco with sand grain, hairline cracks and spalled patches.
  - Cast concrete with aggregate and bug holes.
  - Soviet wall panels with mastic-sealed joints and rust bleeding from the connectors.
  - Running-bond brick, granite setts, and worn asphalt with sealed cracks and oil stains.
  - Painted timber with crazed, chipped paint.
- **Weathering, in world space:** grime and splash-back at street level, rain streaks down the walls, moss on the lower floors and ledges, puddles that reflect the street, and a soft "subsurface" wrap of light on stone and stucco.
- **Windows:**
  - Real recessed reveals with multi-pane timber or brushed-aluminium frames. The aluminium has anisotropic highlights.
  - Louvred green shutters, built slat by slat and set open, ajar or closed. Their paint is chipped and they cast real shadows.
  - Stucco surrounds, pediments, sills, string courses and cornices.
  - Behind every pane there's a room: interior mapping with wallpaper, parquet, rugs, furniture, net curtains and drapes, and sun patches on the floor that match the real sun. The glass is dusty and slightly wavy, and reflects the street.
- **Reflections:** a reflection probe of the finished town, box-projected so glass, car paint, chrome and puddles reflect the right buildings.
- **Cars:**
  - An 80s Eastern-bloc saloon with a rounded body shell and panel gaps.
  - Clear-coated metallic paint over flake normals, with road dirt on the sills.
  - Chrome bumpers, belt mouldings and drip rails.
  - Square headlamps with chrome reflectors and fluted lenses, and segmented tail-lights.
  - Tyres with tread and moulded sidewall lettering, alloy wheels with brake discs and calipers.
  - A full interior seen through the glass, a dusty windscreen with two clean wiper arcs, and licence plates.
  - Burnt-out versions sit on their rusted rims.
- **First-person weapon:** lit by the real sun and sky as you turn. It darkens when a building or cloud blocks the sun. The arms have a ripstop sleeve and a fabric-and-suede glove with jointed fingers and a knuckle guard.
- **Grade:** an ACES filmic curve, a warm golden split tone, warm-tinted bloom, a vignette, fine film grain and dithering, then SMAA. Also ambient occlusion (GTAO).
- **Presets:**

  | Preset | Volumetric light | Textures | Extras |
  | --- | --- | --- | --- |
  | Mobile | 16 steps at 40% resolution | 512² | One pixel per screen point, FXAA, no window shadows, AO or bloom. Shadows are redrawn every other frame, and the resolution drops to as low as 55% when frames run slow. |
  | Medium | 24 steps | 512² | No window shadows, AO or bloom |
  | High | 40 steps | 1024² | AO and bloom |
  | Ultra | 64 steps | 2048² | AO, bloom and 4096² shadows |
- **Audio** is synthesised with Web Audio: layered gunshots, outdoor slapback and indoor reverb, distant shots arriving at the speed of sound with their high end muffled, 3D positional sound, foley and footsteps on different surfaces.

**Match.** Team deathmatch, 4 v 4. The first team to 30 kills wins, or the leading team when the 8-minute clock runs out. It includes respawns with spawn protection, a kill feed, damage direction arcs, hit markers, a compass, a scoreboard, a death cam that shows who killed you, and an end-of-match screen.

## Project layout

```
index.html               page, HUD and menu markup, import map
css/style.css            UI styling
src/config.js            weapons, attachments, materials, hit zones, difficulty, presets, loadouts
src/main.js              boot, screen flow, pointer lock or touch mode, main loop, dynamic resolution
src/core/                renderer and post chain, volumetric light, colour grade, GPU texture baker and surface
                         recipes, material shader patches, materials, geometry helpers, physics, audio, input,
                         touch controls
src/world/               Old Town layout, facades and windows, Soviet panel block, vehicles, building generator,
                         props, navigation graph, effects
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
- This is still rasterised WebGL, not Unreal: the "ray-traced" reflections come from a box-projected reflection probe, and the bounce light is approximated. There's no Lumen, Nanite or hardware ray tracing.
- The richer facades and cars are heavy, around 0.8 million triangles a frame. Use Medium on integrated graphics.
- Phones get the same town, so they need a recent, fast GPU. The touch controls and phone layout were tested in an emulated phone in a desktop browser, not on real handsets, so frame rates on real phones haven't been measured.

The later milestones in the prompt (more maps, more weapons, more game modes, a progression system and multiplayer) are not built yet.
