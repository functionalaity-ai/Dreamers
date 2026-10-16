# Known issues

- **Untested on real hardware.** Every program compiles and links for every profile,
  dimension and vendor macro set (glslang), and a Mesa harness renders the main passes. But
  nobody has run the pack inside Minecraft on a real GPU yet. Follow
  [TESTING.md](TESTING.md) and report problems with `logs/latest.log`.
- **Iris's macOS stance.** Iris's driver documentation lists Apple Silicon Macs as "not
  supported, drivers have known crash issues with common shaders", and says Mac issues
  aren't investigated upstream. Kestrel avoids every known trigger: GLSL 330 only, no
  compute or geometry shaders, no SSBOs or images, ≤ 12 samplers, no `switch` on samplers,
  no integer render targets. A Mac driver bug can still appear.
- **OpenGL only.** Iris runs only on Minecraft's OpenGL backend. The pack will need a port
  when Mojang removes OpenGL; Iris's successor (Aperture) doesn't load this pack format.
- **No Distant Horizons or Voxy support.**
- **OptiFine is unsupported and untested.**
- **TAA ghosting on fast-moving entities.** Iris provides no motion vectors. Entities and
  the hand use a higher blend weight to limit it.
- **Opaque reflections use last frame's image:** one frame of lag, possible ghosting on fast
  camera turns, and the held item can briefly appear in puddle reflections.
- **Water refraction and water reflections see only opaque geometry**, not entities or
  particles behind the water.
- **Modded dimensions use the Overworld programs.** A skyless modded dimension still gets
  the Overworld sky model.
- **Retina / HiDPI cost on Mac.** Render scale shrinks only the pre-TAA work; use a 1x
  display mode for full speed (README).
- **Vanilla AO stays baked into the vertex colour** (`separateAo` isn't used, see
  DECISIONS.md), so vanilla corner darkening also slightly darkens direct sunlight. SSAO
  only darkens ambient light.
- **`smooth()` timing in custom uniforms**: the Iris documentation says ticks, while the
  Iris source multiplies by 0.1 s. The biome fades take a few seconds either way.
- **Block outlines and fishing lines** draw through `gbuffers_basic` (no `gbuffers_line` is
  shipped), so Iris widens them itself.
- **Volumetric clouds and parallax occlusion mapping are not included** in this release
  (see DECISIONS.md).
- **Glyph text without normals** (some sign and name-tag render types) is lit as if facing
  the camera.
