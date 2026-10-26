# MR Physics Educational Tools

**[Live Demo](https://znee.github.io/MRphysics_simulation/)**

Interactive web-based educational tools for understanding MRI physics fundamentals, from signal generation to image reconstruction.

---

## Part 1: NMR Signal Formation

**[Launch Part 1](https://znee.github.io/MRphysics_simulation/part1/)**

Watch how spinning protons create the MR signal. Visualize magnetization dynamics, FID formation, and echo mechanisms through real-time animations.

### Features
- **Module A - Spin Alignment**: Switch B₀ on and watch spins precess about B₀ (lab frame, slowed) while T1 relaxation builds net M along +z
  - Two pictures: *Simplified* (every spin aligns) or *Boltzmann* (spins stay spread; only a slight excess points up)
  - Real thermal polarization shown for the chosen B₀ (≈ 4.9 ppm at 1.5 T, ∝ B₀)
- **Module B - FID Formation**: See RF excitation tip magnetization and progressive dephasing create the FID (played in slow motion)
- **Module C - Echo Formation**: Compare Spin Echo (180° refocusing) vs Gradient Echo (gradient reversal) for the same tissue
- **Module D - GRE Variants**: Multi-TR steady-state visualization of Spoiled GRE vs SSFP
- **Module E - RF & Precession**: Laboratory vs rotating frame — M precesses at ω₀, B₁ spirals it down in the lab frame but simply tips it in the rotating frame; the coil voltage oscillates at ω₀ while the demodulated signal is the envelope; an RF frequency mismatch shows the resonance condition
- **3D Visualization**: Individual spins + net magnetization vector + Mxy/Mz component arrows, B₀ pointing up
  - Spins colored by precession speed (blue slow → red fast) — the "runners on a track" picture of dephasing and spin echoes
  - View presets: 3D, Top (look down B₀ onto the xy plane), Side
- **Real-time Charts**: Mxy decay, Mz recovery, and complex signal (Re, Im, magnitude) on a fixed time axis per run
  - Dashed theory curves: M₀(1−e^(−t/T1)), sin α·e^(−t/T2), sin α·e^(−t/T2*), expected echo amplitudes, steady-state levels; T1/T2/T2* markers
- **Signal Detection**: Panel glow proportional to |Mxy| — the envelope of the EMF induced at ω₀ (Faraday's law)

### Physics Model
- **Bloch Equations**: Full magnetization evolution with T1/T2 relaxation
- **T1 Alignment**: each spin's Mz relaxes toward its equilibrium value, so the ensemble follows Mz(t) = M₀(1 − e^(−t/T1)); azimuths are balanced, so there is no net Mxy (no signal) without RF
- **T2\***: B₀ inhomogeneity modeled as a Lorentzian line (half-width Δf), giving exponential decay with 1/T2* = 1/T2 + 2π·Δf
- **Spin Echo**: 180° pulse inverts phases → echo at T2 envelope (refocuses B₀ inhomogeneity); also inverts Mz
- **Gradient Echo**: Gradient reversal → echo at T2* envelope (does NOT refocus B₀)
- **Spoiled GRE**: S = sin(α)(1-E1)/(1-cos(α)E1) with Ernst angle optimization
- **SSFP (bSSFP)**: S = sin(α)/(1+cos(α)+(1-cos(α))T1/T2) for T2/T1-weighted contrast
- **RF Excitation (Module E)**: rotation about B_eff = (ω₁, 0, ω₀ − ω_RF) in the rotating frame; α = γB₁τ (B₁ ≈ 5.9 µT for a 1 ms 90° pulse)
- **Rotating Frame**: Modules B–D are shown in the frame rotating at ω₀ = γB₀; Modules A and E show the laboratory frame with precession slowed for display
- **Playback**: each run is scaled to play in ~10 s (time axis shows real ms); relaxation and precession in Modules A/E are slowed for display

---

## Part 2: MR Parameters & Contrast

**[Launch Part 2](https://znee.github.io/MRphysics_simulation/part2/)**

Demonstrates how MRI sequences produce different tissue contrasts based on T1, T2, and proton density.

### Features
- **Three MRI Sequences**: Spin Echo (SE), Gradient Echo (GRE), Inversion Recovery (IR)
- **Real-time Visualization**: Brain phantom with dynamic signal calculations
- **Signal vs Parameter Charts**: Explore how TR, TE, TI affect tissue contrast (IR charts plot only valid timings, TR ≥ TI + TE)
- **Field Strength**: B₀ changes tissue T1 and R2′; tissue cards show the field-adjusted T1 (and T2* in GRE)
- **Sequence Mechanics Tab**: Phase wheel, T2/T2* decay curves, pulse diagrams for SE, spoiled GRE and IR-SE (echo centered in the readout, TE/TI interval bars)
- **Clinical Presets**: T1W, T2W, T2*W, FLAIR, STIR

### Physics Model
- **SE**: S = PD · (1 - e^(-TR/T1)) · e^(-TE/T2)
- **GRE**: spoiled steady state (Ernst), T2* = 1/(R2 + R2′); R2′ in s⁻¹ set at 1.5 T (default 5 → WM T2* ≈ 57 ms) and ∝ B₀
- **IR** (inversion-recovery spin echo, as in FLAIR/STIR): S = PD·sinα·|1 − 2e^(−TI/T1) + e^(−TR/T1)| / (1 + e^(−TR/T1)cosα) · e^(−TE/T2); null point TI = T1·ln[2/(1 + e^(−TR/T1))]
- **B₀ dependence**: T1(B₀) ≈ T1(1.5 T)·(B₀/1.5)^b (b ≈ 0.38 WM/GM, approx. after Rooney et al., MRM 2007; ≈ 0.2 fat; ≈ 0 CSF); R2′ ∝ B₀; T2 field-independent (simplification); signal ∝ B₀

---

## Part 3: Spatial Encoding

**[Launch Part 3](https://znee.github.io/MRphysics_simulation/part3/)**

Understand how gradients encode spatial position into signal phase - the foundation of all MRI imaging.

> Reference: J Magn Reson Imaging 35:1038-1054 (2012) "Physics of MRI: A Primer"

### Features
- **Module A - Gradient Encoding**: Visualize frequency (Gx) and phase (Gy) encoding
- **Module B - K-Space & Signal**: See how k-space samples are formed (k in cycles/FOV, N×N Cartesian grid)
- **Module C - Readout → K-Space → Image**: Watch every voxel's own signal during each readout, the coil summing them into one k-space sample at a time, k-space filling line by line — then the inverse Fourier transform rebuilding the image one spatial-frequency pattern at a time (center of k-space first)
  - Receiver noise (σ per k-space sample, averages/NEX): noise enters at the coil, so after the inverse FT it spreads evenly over all voxels and the background is no longer black; SNR = mean(object)/SD(background) is compared with the expected N·√NEX/σ
- **Module D - Frequency Encoding → Image**: Each position "sings its own pitch" (f = γ̄·Gx·x); the received signal is the chord; its Fourier transform is the 1D profile. FOV = BW/(γ̄Gx), Δx = FOV/N, and objects wider than the FOV alias (wrap)
  - Receiver noise per sample ∝ √BW: narrowing the bandwidth (longer readout) raises SNR (relative SNR ∝ Δx·√T_acq); optional "Lock FOV" rescales Gx as a scanner does
- **Explanations**: Modules C–E each have a panel guide, "Try this" experiments, key points and a common misconception
- **Module E - Slice Selection**: Gz makes the Larmor frequency vary with z; the RF bandwidth selects a slab of thickness Δz = BW/(γ̄Gz); sinc pulse ↔ slice profile Fourier pair
- **Moon-Phase Spheres**: Each spin's phase is displayed as a moon-like illumination pattern
  - Phase 0 = Full moon (all white) → Phase π = New moon (all dark)
  - The illuminated area changes smoothly like lunar phases
- **Animate Readout**: Toggle to see phase evolution as kx sweeps from −N/2 to +N/2 during signal acquisition
- **Readout Signal**: Watch the signal graph form an echo (sinc-shaped peak at kx = 0) as spins rephase and dephase
- **Vector Sum**: Watch how individual spins combine into net signal

### Physics Model
- **Phase Equation**: φ(x,y) = γ · (Gx·x + Gy·y) · t
- **K-Space Units**: k in cycles per FOV — phase-encode step m puts m cycles of phase twist across the FOV; at k = N/2 neighboring voxels differ by π
- **Moon-Phase Visualization**: illumination = (1 + cos(φ)) / 2, with terminator ellipse width = |cos(φ)| · radius
- **K-Space Sampling**: S(kx,ky) = Σ ρ(x,y) · e^(-i2π(kx·x + ky·y)); reconstruction ρ = (1/N²) Σ S · e^(+i2π(kx·x + ky·y))
- **Frequency Encoding**: Applied during readout → continuous phase accumulation → oscillating signal
- **Phase Encoding**: Applied before readout → fixed phase imprint → constant magnitude shift
- **Slice Selection**: f(z) = γ̄·Gz·z; BW = TBW/T; Δz = BW/(γ̄Gz); profile ≈ |FT of B₁(t)| (small-tip approximation)

---

## Part 4: K-Space & Reconstruction

**[Launch Part 4](https://znee.github.io/MRphysics_simulation/part4/)**

Visualizes the relationship between spatial frequency domain (k-space) and image domain.

### Features
- **K-Space Visualization**: Watch k-space fill line-by-line with animated acquisition
- **Resolution & SNR Tradeoff**: Adjust matrix size (32-512) to see the fundamental MRI tradeoff
  - 256×256 baseline: SNR = 1.0
  - Lower resolution → larger voxels → higher SNR
  - Higher resolution → smaller voxels → lower SNR
- **K-Space Inspection**: Hover over k-space to see corresponding spatial frequency patterns
- **Artifact Simulation**:
  - Noise injection with SNR visualization
  - Motion artifacts (respiratory simulation)
  - Spike noise (bad pixel artifacts)
  - Undersampling (aliasing/ghosting; zero-filled with density compensation, so overlapping wraps add)
- **Acceleration Techniques**:
  - Partial Fourier (6/8, 5/8) with zero-fill or conjugate synthesis reconstruction
  - Parallel Imaging demo (SENSE R=2, R=4) with g-factor SNR penalty (active when Undersampling skip is 2…R)
- **Multiple Phantoms**: Circle, Square, Brain MRI (+ hidden easter egg)

### Physics Model
- 2D FFT/IFFT for image ↔ k-space transformation
- SNR ∝ voxel area × √(samples) → SNR ∝ 1/matrix at fixed FOV and bandwidth (doubling resolution halves SNR)
- K-space coverage scales as (matrix/N)² for area-based truncation
- Partial Fourier: Exploits conjugate symmetry S(-k) = S*(k) for real images
- Parallel Imaging SNR: SNR_PI = SNR_full / (g · √R) where g is geometry factor

### Simplifications (Parallel Imaging)
The parallel imaging demo idealizes the coil step: the skipped phase-encoding lines are recovered exactly (the information that coil sensitivities make available), and noise is raised so that SNR_PI = SNR_full / (g·√R), with g = 1 + 0.1·(R − 1) and R the undersampling factor. In real SENSE/GRAPPA:
1. Undersampled k-space is reconstructed directly, producing aliased (wrapped) images
2. Multiple coil sensitivity maps identify which pixels are superimposed
3. Linear algebra unfolding separates the overlapped signals (GRAPPA instead synthesizes the missing lines from neighboring coil data)

This simplified demo shows the **concept** that parallel imaging recovers the missing k-space data at the cost of SNR. It omits the coil sensitivity encoding itself, so it shows neither residual aliasing nor the spatially varying g-factor map of a real reconstruction.

---

## Part 5: QSM & Susceptibility

**[Launch Part 5](https://znee.github.io/MRphysics_simulation/part5/)**

Explores Quantitative Susceptibility Mapping (QSM) physics, including dipole field perturbation and solving the ill-posed inverse problem.

### Features
- **3D Phantom Visualization**: Interactive 3D view with slice plane navigation
- **Full 3D Simulation**: Complete 3D FFT with proper dipole kernel
- **B₀ Direction Control**: Adjustable B₀ angle (-90° to +90°) to visualize cone-of-silence rotation
- **Multiple Object Shapes**: Sphere, Cube, Cylinder, Ellipsoid with random orientations
- **Susceptibility Sources**: Paramagnetic (+χ, red) and Diamagnetic (-χ, blue) objects
- **Forward Model**: 3D dipole convolution generates realistic phase maps
- **Inverse Problem**: Tikhonov regularization and Truncated K-Space Division (TKD)
- **Realistic Artifacts**: Cone-of-silence streaking from ill-conditioned k-space regions

### Physics Model
- **3D Dipole Kernel**: D(k) = 1/3 - k_B₀²/|k|² where k_B₀ is the k-component along B₀
- **Forward Model**: field shift Δb = F⁻¹{D(k) · F{χ}} using 3D FFT (ppm); measured phase φ = γ·B₀·TE·Δb
- **Tikhonov**: χ = F⁻¹{D/(D² + λ) · F{Δb}}
- **TKD**: |D| below the threshold (slider value, typically 0.1–0.2) is clamped to the threshold before division
- **Cone of Silence**: Magic angle at θ ≈ 54.7° where D(k) = 0

### Volume Dimensions & Computational Notes
- **FOV**: 128×128×128 mm (isotropic physical space)
- **Resolution**: 128×128×64 voxels (fixed for performance)
- **3D FFT Complexity**: O(N³ log N) - full 3D simulation requires ~1M voxel operations
- **Why Z=64?**: Browser-based JavaScript has limited computational power. A 128³ volume would require 2M voxels and significantly longer processing time. The 128×128×64 configuration provides a good balance between realistic 3D dipole physics and interactive performance.
- **Anisotropic Voxels**: With Z=64, each Z voxel represents 2mm (vs 1mm in XY), simulating clinical thick-slice acquisitions. The dipole kernel uses physical k (cycles/mm), so the 2 mm slices do not distort the field pattern or the 54.7° cone

### Simplifications
Phase unwrapping, background field removal, and multi-echo combination are omitted.
See [QSM Consensus Organization Committee, MRM 2024](https://onlinelibrary.wiley.com/doi/full/10.1002/mrm.30006) for the complete clinical QSM pipeline.

---

## How to Use

### Online
Visit the [Live Demo](https://znee.github.io/MRphysics_simulation/) and select Part 1-5.

### Local
1. Clone this repository
2. Open `index.html` in a modern browser, or
3. Navigate directly to `part1/index.html`, `part2/index.html`, `part3/index.html`, `part4/index.html`, or `part5/index.html`

## Technologies

- Pure HTML/CSS/JavaScript (no frameworks)
- [Chart.js](https://www.chartjs.org/) for interactive plotting
- [Three.js](https://threejs.org/) for 3D visualization (Part 5)
- [MathJax](https://www.mathjax.org/) for LaTeX rendering
- Canvas API for image processing
- SVG for anatomical visualization

## Browser Compatibility

Works best in modern browsers with ES6+ support:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Safari Note
Safari's "Advanced Tracking and Fingerprinting Protection" adds noise to canvas elements, which may cause visible artifacts (stippling pattern) in the brain phantom visualization (Part 2). This is intentional browser behavior for privacy protection, not a bug. To disable: Safari → Settings → Advanced → set "Advanced Tracking and Fingerprinting Protection" to "Private Browsing" only. This protection is enabled by default in Private Browsing mode and will be enabled for all browsing in future macOS/iOS versions.

## License

Educational use permitted. Created for medical physics teaching.

## Author

Jinhee Jang, MD, PhD
Department of Radiology, Seoul St. Mary's Hospital

## Acknowledgment

This work was supported by the National Research Foundation of Korea (NRF) funded by the Korean government (MSIT) (RS-2023-00208409)
