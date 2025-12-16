# MR Physics Educational Tools

**[Live Demo](https://znee.github.io/MRphysics_simulation/)**

Interactive web-based educational tools for understanding MRI physics fundamentals, from signal generation to image reconstruction.

---

## Part 1: NMR Signal Formation

**[Launch Part 1](https://znee.github.io/MRphysics_simulation/part1/)**

Watch how spinning protons create the MR signal. Visualize magnetization dynamics, FID formation, and echo mechanisms through real-time animations.

### Features
- **Module A - Spin Alignment**: Watch random spins align with B₀ through T1 relaxation
- **Module B - FID Formation**: See RF excitation tip magnetization and progressive dephasing create the FID
- **Module C - Echo Formation**: Compare Spin Echo (180° refocusing) vs Gradient Echo (gradient reversal)
- **Module D - GRE Variants**: Multi-TR steady-state visualization of Spoiled GRE vs SSFP
- **3D Visualization**: Individual spins + net magnetization vector + Mxy/Mz component arrows
- **Real-time Charts**: Mxy decay, Mz recovery, and complex signal (Re, Im, magnitude)
- **Signal Detection**: Panel glow based on dMxy/dt (Faraday's law)

### Physics Model
- **Bloch Equations**: Full magnetization evolution with T1/T2 relaxation
- **Spin Echo**: 180° pulse inverts phases → echo at T2 envelope (refocuses B₀ inhomogeneity)
- **Gradient Echo**: Gradient reversal → echo at T2* envelope (does NOT refocus B₀)
- **Spoiled GRE**: S = sin(α)(1-E1)/(1-cos(α)E1) with Ernst angle optimization
- **SSFP (bSSFP)**: S = sin(α)/(1+cos(α)+(1-cos(α))T1/T2) for T2/T1-weighted contrast
- **Rotating Frame**: Visualization at Larmor frequency ω₀ = γB₀

---

## Part 2: MR Parameters & Contrast

**[Launch Part 2](https://znee.github.io/MRphysics_simulation/part2/)**

Demonstrates how MRI sequences produce different tissue contrasts based on T1, T2, and proton density.

### Features
- **Three MRI Sequences**: Spin Echo (SE), Gradient Echo (GRE), Inversion Recovery (IR)
- **Real-time Visualization**: Brain phantom with dynamic signal calculations
- **Signal vs Parameter Charts**: Explore how TR, TE, TI affect tissue contrast
- **Sequence Mechanics Tab**: Phase wheel, T2/T2* decay curves, RF timeline
- **Clinical Presets**: T1W, T2W, T2*W, FLAIR, STIR

### Physics Model
- **SE**: S = PD · (1 - e^(-TR/T1)) · e^(-TE/T2)
- **GRE**: Ernst angle steady-state with T2* effects
- **IR**: Steady-state inversion recovery

---

## Part 3: Spatial Encoding

**[Launch Part 3](https://znee.github.io/MRphysics_simulation/part3/)**

Understand how gradients encode spatial position into signal phase - the foundation of all MRI imaging.

> Reference: J Magn Reson Imaging 35:1038-1054 (2012) "Physics of MRI: A Primer"

### Features
- **Module A - Gradient Encoding**: Visualize frequency (Gx) and phase (Gy) encoding
- **Module B - K-Space & Signal**: See how k-space samples are formed
- **Moon-Phase Spheres**: Each spin's phase is displayed as a moon-like illumination pattern
  - Phase 0 = Full moon (all white) → Phase π = New moon (all dark)
  - The illuminated area changes smoothly like lunar phases
- **Animate Readout**: Toggle to see phase evolution as kx sweeps during signal acquisition
- **Readout Signal**: Watch the signal graph as spins dephase during frequency encoding
- **Vector Sum**: Watch how individual spins combine into net signal

### Physics Model
- **Phase Equation**: φ(x,y) = γ · (Gx·x + Gy·y) · t
- **Moon-Phase Visualization**: illumination = (1 + cos(φ)) / 2, with terminator ellipse width = |cos(φ)| · radius
- **K-Space Sampling**: S(kx,ky) = Σ ρ(x,y) · e^(-i2π(kx·x + ky·y))
- **Frequency Encoding**: Applied during readout → continuous phase accumulation → oscillating signal
- **Phase Encoding**: Applied before readout → fixed phase imprint → constant magnitude shift

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
  - Undersampling (aliasing/ghosting)
- **Acceleration Techniques**:
  - Partial Fourier (6/8, 5/8) with zero-fill or conjugate synthesis reconstruction
  - Parallel Imaging demo (SENSE R=2, R=4) with g-factor SNR penalty
- **Multiple Phantoms**: Circle, Square, Brain MRI (+ hidden easter egg)

### Physics Model
- 2D FFT/IFFT for image ↔ k-space transformation
- SNR ∝ (voxel size)² - quadratic relationship with pixel area
- K-space coverage scales as (matrix/N)² for area-based truncation
- Partial Fourier: Exploits conjugate symmetry S(-k) = S*(k) for real images
- Parallel Imaging SNR: SNR_PI = SNR_full / (g · √R) where g is geometry factor

### Simplifications (Parallel Imaging)
The parallel imaging demo uses k-space interpolation to fill skipped phase-encoding lines, demonstrating the SNR penalty (g-factor noise) but not true wrap-around aliasing artifacts. In real SENSE/GRAPPA:
1. Undersampled k-space is reconstructed directly, producing aliased (wrapped) images
2. Multiple coil sensitivity maps identify which pixels are superimposed
3. Linear algebra unfolding separates the overlapped signals

This simplified demo shows the **concept** that parallel imaging can recover missing k-space data at the cost of SNR, but omits the coil sensitivity encoding that enables true alias unfolding. Without actual coil sensitivity maps, the demo cannot produce or unwrap the characteristic N/R-fold image wrap-around.

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
- **Forward Model**: φ = F⁻¹{D(k) · F{χ}} using 3D FFT
- **Tikhonov**: χ = F⁻¹{D/(D² + λ) · F{φ}}
- **TKD**: Threshold small D values to avoid division instability
- **Cone of Silence**: Magic angle at θ ≈ 54.7° where D(k) = 0

### Volume Dimensions & Computational Notes
- **FOV**: 128×128×128 mm (isotropic physical space)
- **Resolution**: 128×128×64 voxels (fixed for performance)
- **3D FFT Complexity**: O(N³ log N) - full 3D simulation requires ~1M voxel operations
- **Why Z=64?**: Browser-based JavaScript has limited computational power. A 128³ volume would require 2M voxels and significantly longer processing time. The 128×128×64 configuration provides a good balance between realistic 3D dipole physics and interactive performance.
- **Anisotropic Voxels**: With Z=64, each Z voxel represents 2mm (vs 1mm in XY), simulating clinical thick-slice acquisitions

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

## License

Educational use permitted. Created for medical physics teaching.

## Author

Jinhee Jang, MD, PhD
Department of Radiology, Seoul St. Mary's Hospital
