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

**Map: Old Town.** A 120 × 92 m town square with a fountain under a bronze equestrian monument, a church with a spire, two five-storey Soviet panel blocks (one sunlit, one backlit by the low sun), rows of pre-war stucco buildings with green shutters and shopfronts, two barricaded side streets, parked and burnt-out cars, a minibus and two gutted buses, market stalls, sandbag and jersey-barrier cover, trees and street lamps. Two buildings are fully enterable:
- **Hotel Meridian** has three floors and a roof, connected by U-shaped stairs, with furnished rooms.
- **The Pharmacy** has two floors and roof access, with a shop counter and shelving downstairs and a flat upstairs.

**Guns, modelled part by part.** Every part is a bevelled extrusion of its real outline, with slots, ports and windows cut right through, so edges catch the light and nothing reads as a flat box. On High and Ultra the first-person gun and hands also shadow themselves.
- **Finish up close:**
  - The bevels roll smoothly from face to wall, and the polymer parts (stocks, grips, magazines, the pistol frame) are gently domed like real mouldings.
  - Sharp edges wear through the finish: anodising to bright aluminium, Cerakote to dark anodising and then metal, parkerised steel to bright steel. The wear is found from the surface's curvature, so it sits on real edges and stays put as the gun sways.
  - Specular anti-aliasing keeps rail teeth and small bevels from sparkling.
  - Engraved roll marks, serial numbers and selector markings (SAFE / SEMI / AUTO on both sides) sit on the actual surfaces.
- **KR-5 Kestrel** (5.56 assault rifle, 780 rpm), in Flat Dark Earth by default:
  - A split upper receiver with a real ejection port, a cycling bolt and a hinged dust cover, the forward assist and brass deflector.
  - A lower with a hollow, flared magwell, the mag-release fence, bolt catch, pins, and a trigger guard with its opening cut through.
  - A 15-inch M-LOK rail with cut-through slots, a toothed Picatinny top rail, the barrel and gas block visible through the slots, and an A2 birdcage.
  - Flip-up sights with see-through apertures, an SL-style stock with a recessed panel, sling slot and QD cups, a castle nut, and a textured grip.
  - A PMAG-style magazine whose witness window shows the brass left inside.
- **M12 Bastion** (12-gauge pump shotgun, 9-pellet 00 buck): a split receiver with a real ejection port and an optics rail, a vent rib on its posts, a grooved pump on action bars, a knurled magazine cap, a side saddle, and shells loaded one at a time.
- **P9 Warden** (9 mm pistol): a slide with chamfered edges, cut serrations and an open port showing the barrel hood. It cycles and locks back on empty. Also tritium night sights, an optics cut, and a polymer frame with a beavertail, stippled panels and an accessory rail.

Every gun has ejected brass and its own reload animations: tactical, empty, pistol, and shell-by-shell for the shotgun. The first-person gun is rendered in its own pass, so it never clips through walls.

**Gunsmith.** A lit, shadowed turntable you can drag to rotate and scroll (or pinch) to zoom, with live stat bars that show the change from each part. There are 9 attachments across 5 slots, plus three finishes for every gun (Black, Flat Dark Earth and OD Green):

| Slot | Attachments |
| --- | --- |
| Optic | Haldane red dot on a riser with knurled turrets, Talon 4× scope in rings (true picture-in-picture view with a mil-dot reticle) |
| Muzzle | Hush suppressor (fluted, with a knurled collar), Brace compensator (ports cut through), full choke |
| Underbarrel | Vertical grip, angled grip |
| Magazine | Extended magazine |
| Laser | LA-2 laser |

Three loadout slots (Rifleman, Marksman and Breacher) are saved in the browser.

**Ballistics.** Each bullet is a projectile with muzzle velocity and drop. It penetrates materials according to how much each one resists, ricochets at shallow angles, and leaves entry and exit holes. Damage depends on hit zone (head, chest, stomach, arms, legs), falls off with range, and is reduced by armour. Bullets that pass close to you make a supersonic crack.

**Characters and AI:**
- **Characters** are skinned humanoids built in code. Torso, arms and legs are lofted and bend smoothly across their joints. Each wears faction kit: a wrap-around plate carrier with MOLLE rows, straps, magazine, admin, radio and grenade pouches, a battle belt, a high-cut helmet with rails, an NVG shroud and a headset with a boom mic, eye protection, gloves shaped round the grip and handguard, knee pads, cargo pockets, a drop-leg holster and boots. Two-bone arm IK puts their hands on their guns, they react to hits, and they fall when they die.
  - **They shoulder their rifles:** the torso blades towards the support side, the butt seats in the shoulder pocket, and the head comes down onto the stock with the eye on the sight line. Out of reach, the support hand rides back along the rail or pump.
  - **Faces are sculpted:** brow ridge, eye sockets with eyes, nose, cheekbones, lips, jaw and chin. Operators vary between clean-shaven, stubble, beards and balaclavas, and between eye protection worn, pushed up on the helmet or left off.
  - **Uniforms crease:** cloth bunches at the elbows, knees and waist, with stitched seams down the sleeves and legs.
- **Bots** detect you by sight, with a detection meter, and by sound. They share sightings by radio callouts, claim cover on a navigation graph, peek from cover, flank along routes that keep them out of sight, throw and dodge grenades, and fall back when they're hurt. There are three difficulty levels: Recruit, Regular and Veteran.

**Look and sound:**
- **Light and atmosphere:**
  - A low golden-hour sun with soft shadows.
  - Bounce light, baked at load: a volume of light probes 2 m apart, one layer per storey, traced against the town. The shade picks up the colour of the sunlit walls and streets around it, alleys and rooms darken by how little sky they see, and the indoor lamps bounce off the walls.
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
- **Stonework:** carved limestone over the stucco. That means modillion cornices with dentils, string courses, rusticated plinths and quoins, and pedimented window surrounds with keystones and sills on corbels. Doors get banded frames with voussoirs and steps, and the roofs are gabled clay tile with eaves, gutters and chimneys. Stucco peels back to the brick beneath it. On High and Ultra, cobbles, brick and plaster are parallax-mapped, so the relief holds up at an angle.
- **Street dressing:** wall lanterns, geranium window boxes, drainpipes, sagging cables across the streets, and posters, tags, street signs and house numbers. Shopfronts have striped canvas awnings with scalloped valances on folding arms.
- **Streets:** granite kerbstones over cobbled gutters, cast-iron ACQUA, GAS and TELEFONI covers with raised lettering, drain grates, tar patches, trench cuts, tyre wear and oil, soot under the burnt-out cars, broken glass, drifts of leaves and litter, with cans, bottles and paper on the pavements.
- **Trees:** tapered trunks that branch into limbs and twigs, with leaf sprigs clustered at the tips. Light glows through the leaves, and the crowns and their shadows sway in the wind.
- **The monument:** a bronze officer on a walking horse, sabre raised, lofted so it reads as a casting. It has a verdigris patina and stands on a moulded pedestal in a basin with four water jets.
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

  **Supersampling** (Settings) draws above your screen's resolution and scales down: 150% or 200%. Ultra at 200% on a 4K screen renders every frame at 7680 × 4320 (8K), capped there. The settings screen shows the resolution actually drawn. It needs a very strong graphics card, and the Mobile preset ignores it.
- **Effects:** muzzle flashes with a star-shaped core, flame petals and a glow, and smoke curling from the barrel after a burst. Impacts throw dust in the colour of the surface hit, lit by the sun or the shade, plus chips, sparks off metal, glass shards and splinters. Grenades go off in a fireball with a fire-lit smoke column, a dust ring, sparks and debris, and leave a scorch.
- **HUD:** gun silhouettes in the kill feed, the weapon panel and the death screen, rendered from the real models with their attachments.
- **Loading screen:** letterboxed key art rendered at load with the game's own operators and guns: three MSG operators pushing up a burning street at dusk. It has a wet-street mirror, bokeh depth of field, bloom and a teal-and-amber grade. A red progress line runs along its foot, with a ring and percentage beside the tip, embers drift over it, and the muzzle flash strobes in bursts.
- **Audio** is synthesised with Web Audio: layered gunshots, outdoor slapback and indoor reverb, distant shots arriving at the speed of sound with their high end muffled, 3D positional sound, foley and footsteps on different surfaces.

**Match.** Team deathmatch, 4 v 4. The first team to 30 kills wins, or the leading team when the 8-minute clock runs out. It includes respawns with spawn protection, a kill feed, damage direction arcs, hit markers, a compass, a scoreboard, a death cam that shows who killed you, and an end-of-match screen. Your kills pop up under the crosshair with the name and points. Quick kills chain into double, triple and multi-kill medals. Matches open on a title card and close on Victory or Defeat.

## Project layout

```
index.html               page, HUD and menu markup, import map
css/style.css            UI styling
src/config.js            weapons, attachments, materials, hit zones, difficulty, presets, loadouts
src/main.js              boot, screen flow, pointer lock or touch mode, main loop, dynamic resolution
src/core/                renderer and post chain, volumetric light, baked bounce light, colour grade, GPU texture
                         baker and surface recipes, material shader patches, materials, geometry helpers, physics,
                         audio, input, touch controls
src/world/               Old Town layout, facades and windows, carved stonework and roofs, street dressing and
                         awnings, road detail, the monument, Soviet panel block, vehicles, building generator,
                         props and trees, navigation graph, effects
src/weapons/             gun models, edge wear, weapon state, ballistics, first-person viewmodel and animations
src/characters/          operator body, skeleton and animation, hitboxes, bot AI, player controller
src/game/game.js         match rules, spawning, damage, grenades, noise and callouts
src/ui/                  HUD and gun silhouettes, menus, gunsmith turntable, loading-screen key art
vendor/three/            Three.js r160 and the add-ons used
```

## Known limitations

- No multiplayer. The slice is single-player against bots.
- In first person you see only your arms and gun, not your full body.
- Animations are procedural rather than motion-captured.
- This is still rasterised WebGL, not Unreal: the "ray-traced" reflections come from a box-projected reflection probe, and the bounce light is a probe volume baked once at load (tree canopies and awnings don't block it). There's no Lumen, Nanite or hardware ray tracing.
- Smoke seen against the sky looks washed out, because the haze is laid over the effects.
- The carved facades, cars and characters are heavy, around 2.8 million triangles a frame. Use Medium on integrated graphics.
- Phones get the same town, so they need a recent, fast GPU. The touch controls and phone layout were tested in an emulated phone in a desktop browser, not on real handsets, so frame rates on real phones haven't been measured.

The later milestones in the prompt (more maps, more weapons, more game modes, a progression system and multiplayer) are not built yet.
