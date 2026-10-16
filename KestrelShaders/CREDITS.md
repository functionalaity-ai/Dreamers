# Credits

Kestrel Shaders is original code. It implements published techniques; the papers, talks and
references behind each part are listed here. Where constants were taken from a reference
implementation, that implementation and its license are named.

## Atmosphere and sky
- Sébastien Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering
  Technique* (EGSR 2020), and the reference implementation sebh/UnrealEngineSkyAtmosphere
  (MIT): sky-view LUT parameterisation, Rayleigh/Mie/ozone coefficients, energy-conserving
  scattering integration (also in Hillaire, *Physically Based and Unified Volumetric
  Rendering in Frostbite*, SIGGRAPH 2015).
- Eric Bruneton and Fabrice Neyret, *Precomputed Atmospheric Scattering* (2008): the
  atmosphere model.
- Henyey-Greenstein and Rayleigh phase functions, standard.

## Lighting and materials
- Brian Karis, *Real Shading in Unreal Engine 4* (SIGGRAPH 2013): GGX, the environment BRDF
  approximation (mobile fit after Dimitar Lazarov), Karis luminance weighting.
- Eric Heitz, *Understanding the Masking-Shadowing Function in Microfacet-Based BRDFs*
  (2014): height-correlated Smith visibility.
- Christophe Schlick (1994): Fresnel approximation.
- Sébastien Lagarde and Charles de Rousiers, *Moving Frostbite to Physically Based
  Rendering* (2014): EV100 exposure model and specular occlusion.
- Tanner Helland: blackbody colour approximation (as a published fit).
- labPBR material standard (shaderLABS, github.com/rre36/lab-pbr): resource-pack channel
  layout.

## Shadows, AO and volumetrics
- shaderLABS shadow tutorial: shadow-map distortion for Minecraft.
- Randima Fernando, *Percentage-Closer Soft Shadows* (NVIDIA, 2005): PCSS.
- Jorge Jimenez et al., *Practical Real-Time Strategies for Accurate Indirect Occlusion*
  (Activision, 2016): GTAO. Jorge Jimenez, *Next Generation Post Processing in Call of Duty:
  Advanced Warfare* (2014): interleaved gradient noise.
- Kenny Mitchell, *Volumetric Light Scattering as a Post-Process* (GPU Gems 3, ch. 13):
  screen-space light shafts.

## Anti-aliasing and post-processing
- Marco Salvi, *An Excursion in Temporal Supersampling* (GDC 2016): variance clipping.
- Brian Karis, *High Quality Temporal Supersampling* (SIGGRAPH 2014): YCoCg clipping, history
  weighting.
- AMD FidelityFX Super Resolution 2 (MIT): jitter phase-count rule.
- Timothy Lottes, FXAA 3.11 (NVIDIA): the console-variant edge direction algorithm,
  reimplemented.
- AMD FidelityFX CAS (MIT): contrast-adaptive sharpening, reimplemented.
- Marius Bjørge, *Bandwidth-Efficient Rendering* (SIGGRAPH 2015): downsample-chain bloom.
- Troy Sobotka, AgX; minimal polynomial fit by Benjamin Wrensch (iolite engine). Constants as
  published in three.js (MIT) and Google Filament (Apache-2.0).
- Stephen Hill: ACES RRT+ODT fit (BakingLab, MIT).
- Khronos PBR Neutral tone mapper (Khronos Group, Apache-2.0).
- Martin Roberts, *The Unreasonable Effectiveness of Quasirandom Sequences* (2018): R2.
- Robert Ulichney, *The void-and-cluster method for dither array generation* (1993): the blue
  noise in `noise.png`.

## Platform knowledge
- The Iris shader loader (IrisShaders/Iris, LGPL-3.0) and its documentation
  (IrisShaders/docs): read to confirm pack-format behaviour. No Iris code is included.
- OptiFine `shaders.txt` and `shaders.properties` documentation: the pack format.
