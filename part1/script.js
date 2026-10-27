/**
 * Part 0: NMR Signal Formation
 *
 * Interactive simulation showing how nuclear spins create the MR signal.
 * Based on the Bloch equations and fundamental NMR physics.
 *
 * Modules:
 * A - B0 Alignment (spin alignment with magnetic field)
 * B - FID Formation (RF excitation & dephasing)
 * C - Echo Formation (Spin Echo, Gradient Echo)
 * D - GRE Variants (Spoiled GRE vs SSFP, multi-TR steady-state)
 * E - RF & Precession (laboratory vs rotating frame, resonance condition)
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const GAMMA = 42.577; // Gyromagnetic ratio for 1H (MHz/T)
const GAMMA_RAD = 2.6752e8; // Gyromagnetic ratio for 1H (rad/s/T)
const HBAR = 1.054572e-34;  // J·s
const K_BOLTZMANN = 1.380649e-23; // J/K
const BODY_TEMP = 310;      // K
const DEFAULT_MAX_TIME = 1500; // Default simulation duration (ms) - long enough to see T1 recovery

// Playback: every run is scaled so its time window plays in ~10 s at 1x speed
// (previously a fixed 0.5 ms per frame, which made fast events like the FID
// flash by in a fraction of a second and slow ones like T1 take ~50 s).
const RUN_PLAYBACK_SECONDS = 10;

// Displayed Larmor precession is slowed by ~10^8: B0/3 revolutions per second
// at 1x speed (1.5 T → 0.5 rev/s, 3 T → 1 rev/s), so ω0 ∝ B0 stays visible.
const VIS_PRECESSION_REV_PER_S_PER_T = 1 / 3;

// Boltzmann picture (Module A): exaggerated μB0/kT so the excess is visible.
// Langevin mean cosθ = coth(β) - 1/β ≈ 0.44 → ~82% of spins point "up".
// The real value at 1.5 T is ~1e-5 (a few ppm excess).
const BOLTZMANN_BETA_VIS = 1.5;

const CONFIG = {
    // Animation
    animationSpeed: 1.0,
    isPlaying: false,
    currentTime: 0,       // ms
    maxTime: DEFAULT_MAX_TIME,
    dt: 0.5,              // Physics sub-step (ms)
    playbackRate: DEFAULT_MAX_TIME / RUN_PLAYBACK_SECONDS, // Simulated ms per real second at 1x
    slowUntil: 0,         // Slow motion before this time (ms), e.g. during the FID
    slowRate: 0,          // Simulated ms per real second while in slow motion

    // Module A: B0 Alignment
    // T1 = 500ms for educational demo (faster to observe recovery)
    // Real brain tissue: WM ~600-800ms, GM ~900-1200ms at 1.5T
    T1: 500,              // ms (shorter for faster demo)
    T2: 80,               // ms (used for transverse decay during alignment)
    B0: 1.5,              // Tesla
    alignModel: 'simple', // 'simple' (every spin aligns) or 'boltzmann' (slight excess)
    showPrecessionA: true,

    // Module B: FID
    flipAngle: 90,        // degrees (moved from Module A)

    // Module B: Ensemble
    numSpins: 100,
    freqSpread: 5,        // Hz, Lorentzian half-width of B0 inhomogeneity (1/T2' = 2π·Δf)
    T2ensemble: 100,      // ms (intrinsic T2)
    showIndividual: true,

    // Module C: Echo
    // Defaults for visible echo formation:
    // Spin Echo: 180° refocuses B0 inhomogeneity → echo at T2 envelope
    // Gradient Echo: gradient reversal does NOT refocus B0 → echo at T2* envelope
    // - TE = 60ms gives enough time to see dephasing and rephasing
    // - T2 = 200ms (long) so SE echo amplitude is high (74%)
    // - T2* = 50ms (short) so GRE echo is visibly lower (30%) yet well above
    //   the ~1/√N residual of 100 dephased spins
    echoType: 'spin',     // 'spin' or 'gradient'
    TE: 60,               // ms
    T2echo: 200,          // ms (long T2 for strong SE echo)
    T2starEcho: 50,       // ms (shorter than T2 - GRE echo visibly lower than SE; same tissue for both)

    // Module D: GRE Variants (Spoiled vs SSFP)
    // Multi-TR simulation to show steady-state magnetization
    greType: 'spoiled',   // 'spoiled' or 'ssfp'
    flipAngleD: 30,       // degrees
    TR: 25,               // ms (short TR typical for GRE)
    T1D: 600,             // ms (typical tissue T1)
    T2D: 80,              // ms (typical tissue T2)
    numTR: 8,             // Number of TR cycles to simulate

    // Module E: RF & Precession (single magnetization vector)
    frameE: 'lab',        // 'lab' or 'rot'
    flipAngleE: 90,       // degrees
    rfOffsetE: 0,         // Hz, RF frequency minus Larmor frequency (for a 1 ms pulse)

    // Current module
    currentModule: 'A'
};

// ============================================================================
// SPIN CLASS - Represents a single nuclear spin
// ============================================================================

class Spin {
    constructor(T1, T2, deltaOmega = 0, B0 = 1.5) {
        // Magnetization components (normalized to M0 = 1)
        this.Mx = 0;
        this.My = 0;
        this.Mz = 1.0;  // Equilibrium along B0

        // Relaxation times
        this.T1 = T1;
        this.T2 = T2;

        // B0 inhomogeneity offset (Hz) - causes T2* decay
        // This is FIXED and NOT refocused by gradient reversal
        this.deltaOmegaB0 = deltaOmega;

        // Gradient-induced frequency offset (Hz)
        // This IS refocused by gradient reversal (sign flip)
        this.deltaOmegaGrad = 0;
        this.gradientSign = 1;

        // B0 field strength (Tesla)
        this.B0 = B0;

        // Phase accumulation
        this.phase = 0;
    }

    /**
     * Get total frequency offset (B0 inhomogeneity + gradient)
     */
    getTotalDeltaOmega() {
        return this.deltaOmegaB0 + (this.deltaOmegaGrad * this.gradientSign);
    }

    /**
     * Apply RF pulse (instantaneous rotation)
     * @param {number} flipAngle - Flip angle in degrees
     * @param {number} phaseAngle - Phase of RF pulse in degrees (0 = along x)
     */
    applyRFPulse(flipAngle, phaseAngle = 0) {
        const alpha = flipAngle * Math.PI / 180;
        const phi = phaseAngle * Math.PI / 180;

        // Current magnetization
        const Mx0 = this.Mx;
        const My0 = this.My;
        const Mz0 = this.Mz;

        // Rotation about axis in xy-plane at angle phi from x-axis
        // Using rotation matrix for arbitrary axis
        const cosA = Math.cos(alpha);
        const sinA = Math.sin(alpha);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        // Rotation axis is (cos(phi), sin(phi), 0)
        // Apply Rodrigues' rotation formula
        const ux = cosPhi, uy = sinPhi, uz = 0;

        this.Mx = (cosA + ux * ux * (1 - cosA)) * Mx0 +
            (ux * uy * (1 - cosA) - uz * sinA) * My0 +
            (ux * uz * (1 - cosA) + uy * sinA) * Mz0;

        this.My = (uy * ux * (1 - cosA) + uz * sinA) * Mx0 +
            (cosA + uy * uy * (1 - cosA)) * My0 +
            (uy * uz * (1 - cosA) - ux * sinA) * Mz0;

        this.Mz = (uz * ux * (1 - cosA) - uy * sinA) * Mx0 +
            (uz * uy * (1 - cosA) + ux * sinA) * My0 +
            (cosA + uz * uz * (1 - cosA)) * Mz0;
    }

    /**
     * Evolve magnetization using Bloch equations
     * In rotating frame at Larmor frequency
     * @param {number} dt - Time step in ms
     */
    evolve(dt) {
        // Convert dt to seconds for calculation
        const dtSec = dt / 1000;

        // Precession due to total frequency offset (B0 inhomogeneity + gradient)
        // Both components contribute to phase accumulation
        const totalDeltaOmega = this.getTotalDeltaOmega();
        const dPhi = 2 * Math.PI * totalDeltaOmega * dtSec;
        this.phase += dPhi;

        // Rotation due to off-resonance
        const Mx0 = this.Mx;
        const My0 = this.My;
        this.Mx = Mx0 * Math.cos(dPhi) - My0 * Math.sin(dPhi);
        this.My = Mx0 * Math.sin(dPhi) + My0 * Math.cos(dPhi);

        // T2 relaxation (transverse decay)
        const E2 = Math.exp(-dt / this.T2);
        this.Mx *= E2;
        this.My *= E2;

        // T1 relaxation (longitudinal recovery)
        const E1 = Math.exp(-dt / this.T1);
        this.Mz = this.Mz * E1 + (1 - E1);
    }

    /**
     * Get transverse magnetization magnitude
     */
    getMxy() {
        return Math.sqrt(this.Mx * this.Mx + this.My * this.My);
    }

    /**
     * Get phase angle in xy-plane
     */
    getPhase() {
        return Math.atan2(this.My, this.Mx);
    }

    /**
     * Reset to equilibrium
     */
    reset() {
        this.Mx = 0;
        this.My = 0;
        this.Mz = 1.0;
        this.phase = 0;
        // Reset gradient state but keep B0 inhomogeneity
        this.deltaOmegaGrad = 0;
        this.gradientSign = 1;
    }

    /**
     * Invert phase (180° pulse effect on phase)
     * Used for spin echo - inverts ALL accumulated phase
     */
    invertPhase() {
        this.phase = -this.phase;
        // Also invert the actual magnetization phase
        const currentPhase = Math.atan2(this.My, this.Mx);
        const Mxy = this.getMxy();
        const newPhase = -currentPhase;
        this.Mx = Mxy * Math.cos(newPhase);
        this.My = Mxy * Math.sin(newPhase);
    }

    /**
     * Set gradient frequency offset (Hz)
     * For gradient echo, this creates additional dephasing that can be refocused
     */
    setGradient(gradFreq) {
        this.deltaOmegaGrad = gradFreq;
    }

    /**
     * Toggle gradient direction (for gradient echo refocusing)
     * ONLY affects gradient-induced offset, NOT B0 inhomogeneity
     */
    toggleGradient() {
        this.gradientSign *= -1;
    }

    /**
     * Restore gradient to original direction
     */
    restoreGradient() {
        this.gradientSign = 1;
    }
}

// ============================================================================
// SPIN ENSEMBLE - Collection of spins for FID simulation
// ============================================================================

class SpinEnsemble {
    /**
     * @param {string} distribution - 'gaussian' (freqSpread = σ) or
     *   'lorentzian' (freqSpread = half-width Δf). A Lorentzian line shape
     *   gives a truly exponential decay e^(-t/T2') with 1/T2' = 2π·Δf, so the
     *   simulated FID matches the textbook e^(-t/T2*) envelope.
     */
    constructor(numSpins, T1, T2, freqSpread, B0 = 1.5, distribution = 'gaussian') {
        this.numSpins = numSpins;
        this.T1 = T1;
        this.T2 = T2;
        this.freqSpread = freqSpread;
        this.B0 = B0;
        this.distribution = distribution;
        this.spins = [];

        this.createSpins();
    }

    createSpins() {
        this.spins = [];
        const lorentzian = this.distribution === 'lorentzian' ? this.lorentzianOffsets() : null;
        for (let i = 0; i < this.numSpins; i++) {
            let deltaOmega;
            if (lorentzian) {
                deltaOmega = lorentzian[i];
            } else {
                // Gaussian distribution of frequency offsets
                const u1 = Math.random();
                const u2 = Math.random();
                const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
                deltaOmega = z * this.freqSpread;
            }

            this.spins.push(new Spin(this.T1, this.T2, deltaOmega, this.B0));
        }
    }

    /**
     * Evenly spaced quantiles of a Lorentzian (Cauchy) distribution.
     * Deterministic quantiles let ~100 spins reproduce e^(-t/T2') closely
     * (random draws would add large fluctuations). They are shuffled so the
     * offset is independent of the spin index, which Module C uses as the
     * position along the gradient.
     */
    lorentzianOffsets() {
        const n = this.numSpins;
        const offsets = [];
        for (let i = 0; i < n; i++) {
            const u = (i + 0.5) / n;
            offsets.push(this.freqSpread * Math.tan(Math.PI * (u - 0.5)));
        }
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
        }
        return offsets;
    }

    applyRFPulse(flipAngle, phaseAngle = 0) {
        this.spins.forEach(spin => spin.applyRFPulse(flipAngle, phaseAngle));
    }

    evolve(dt) {
        this.spins.forEach(spin => spin.evolve(dt));
    }

    reset() {
        this.spins.forEach(spin => spin.reset());
    }

    /**
     * Update T2 for all spins (for interactive control)
     */
    setT2(newT2) {
        this.T2 = newT2;
        this.spins.forEach(spin => {
            spin.T2 = newT2;
        });
    }

    /**
     * Update T1 for all spins
     */
    setT1(newT1) {
        this.T1 = newT1;
        this.spins.forEach(spin => {
            spin.T1 = newT1;
        });
    }

    /**
     * Update B0 for all spins (affects precession rate scaling)
     */
    setB0(newB0) {
        this.B0 = newB0;
        this.spins.forEach(spin => {
            spin.B0 = newB0;
        });
    }

    /**
     * Apply gradient to all spins
     * Gradient creates spatial-dependent frequency offset (independent of B0 inhomogeneity)
     * For simulation, we create a separate gradient offset distribution
     * @param {number} gradientStrength - Frequency spread for gradient (Hz)
     */
    applyGradient(gradientStrength = 1.0) {
        this.spins.forEach((spin, i) => {
            // Create gradient offset INDEPENDENT of B0 inhomogeneity
            // Use spin index to create a spread of gradient-induced offsets
            // This simulates spatial position along the gradient direction
            const normalizedPos = (i / (this.numSpins - 1)) * 2 - 1; // Range: -1 to +1
            const gradOffset = normalizedPos * this.freqSpread * gradientStrength;
            spin.setGradient(gradOffset);
        });
    }

    /**
     * Toggle gradient direction for all spins (for GRE refocusing)
     * Only affects gradient-induced offset, NOT B0 inhomogeneity
     */
    toggleGradient() {
        this.spins.forEach(spin => spin.toggleGradient());
    }

    /**
     * Restore gradient to original direction for all spins
     */
    restoreGradient() {
        this.spins.forEach(spin => spin.restoreGradient());
    }

    /**
     * Clear gradient offset (back to pure B0 inhomogeneity)
     */
    clearGradient() {
        this.spins.forEach(spin => spin.setGradient(0));
    }

    /**
     * Apply gradient with fixed frequency spread (Hz)
     * Independent of B0 inhomogeneity settings
     * @param {number} freqSpreadHz - Total frequency spread in Hz
     */
    applyGradientFixed(freqSpreadHz) {
        this.spins.forEach((spin, i) => {
            // Create linear gradient offset based on position
            const normalizedPos = (i / (this.numSpins - 1)) * 2 - 1; // Range: -1 to +1
            const gradOffset = normalizedPos * freqSpreadHz / 2; // ±freqSpreadHz/2
            spin.setGradient(gradOffset);
        });
    }

    /**
     * Get sum magnetization (macroscopic signal)
     */
    getSumMagnetization() {
        let sumMx = 0, sumMy = 0, sumMz = 0;
        this.spins.forEach(spin => {
            sumMx += spin.Mx;
            sumMy += spin.My;
            sumMz += spin.Mz;
        });
        return {
            Mx: sumMx / this.numSpins,
            My: sumMy / this.numSpins,
            Mz: sumMz / this.numSpins
        };
    }

    /**
     * Get phase coherence (0-100%)
     */
    getPhaseCoherence() {
        const sum = this.getSumMagnetization();
        const sumMxy = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);

        // Average individual Mxy
        let avgIndividualMxy = 0;
        this.spins.forEach(spin => {
            avgIndividualMxy += spin.getMxy();
        });
        avgIndividualMxy /= this.numSpins;

        if (avgIndividualMxy < 0.001) return 0;
        return Math.min(100, (sumMxy / avgIndividualMxy) * 100);
    }

    invertPhases() {
        this.spins.forEach(spin => spin.invertPhase());
    }

    /**
     * Randomize all spin orientations (B0 OFF state)
     * Each spin points in a random direction on the unit sphere.
     *
     * Spins are created in pairs with the same polar angle and opposite
     * azimuth, and cosθ is evenly stratified over (-1, 1). The ensemble is
     * therefore isotropic with net M exactly 0 - as for the ~10^23 spins of
     * a real sample - instead of the ~1/√N residual of 100 random arrows,
     * which would otherwise precess and fake a "signal" without any RF.
     *
     * Each spin also gets its equilibrium cosθ (this.targets): 1 in the
     * simplified picture, or a Boltzmann-distributed value matched by rank
     * in the "slight excess" picture. this.M0 is the resulting equilibrium
     * net magnetization used to normalize the plots.
     */
    randomizeOrientations(model = 'simple') {
        const n = this.numSpins;
        const pairs = Math.floor(n / 2);
        const beta = BOLTZMANN_BETA_VIS;
        const boltzmannQuantile = u =>
            Math.log(Math.exp(-beta) + u * (Math.exp(beta) - Math.exp(-beta))) / beta;

        this.targets = [];
        this.spins.forEach((spin, i) => {
            const k = Math.floor(i / 2);
            let cosTheta, azimuth, u;
            if (k < pairs) {
                u = (k + 0.5) / pairs;
                cosTheta = 2 * u - 1;
                azimuth = (i % 2 === 0) ? Math.random() * 2 * Math.PI : this.spins[i - 1].phase + Math.PI;
            } else {
                // Odd spin count: last spin on the equator
                u = 0.5;
                cosTheta = 0;
                azimuth = Math.random() * 2 * Math.PI;
            }
            const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
            spin.Mx = sinTheta * Math.cos(azimuth);
            spin.My = sinTheta * Math.sin(azimuth);
            spin.Mz = cosTheta;
            spin.phase = azimuth;
            this.targets.push(model === 'boltzmann' ? boltzmannQuantile(u) : 1.0);
        });
        this.M0 = this.targets.reduce((a, b) => a + b, 0) / n;
    }

    /**
     * Get average Mz (for alignment visualization)
     */
    getAverageMz() {
        let sumMz = 0;
        this.spins.forEach(spin => {
            sumMz += spin.Mz;
        });
        return sumMz / this.numSpins;
    }
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

// Module A: Ensemble for B0 alignment animation
let alignmentEnsemble = null;  // Created when Module A loads
let b0IsOn = false;            // Track B0 state
let alignmentArrows = [];      // Arrows for alignment visualization

// Module B/C: Ensemble for FID and Echo simulations
let ensemble = createFIDEnsemble();

function createFIDEnsemble() {
    return new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2ensemble, CONFIG.freqSpread, CONFIG.B0, 'lorentzian');
}

// Data arrays for plotting
let timeData = [];
let mxyData = [];
let mzData = [];
let signalReData = [];
let signalImData = [];

// Echo sequence state
let echoSequenceState = 'idle'; // 'idle', 'dephasing', 'refocusing', 'echo', 'done'
let echoSequenceTime = 0;
let gradientFlipped = false; // Track if gradient has been flipped

// Module D: GRE multi-TR state
let greSequenceState = 'idle'; // 'idle', 'running', 'done'
let currentTRIndex = 0;        // Which TR we're in (0 to numTR-1)
let timeInTR = 0;              // Time within current TR
let steadyStateMxy = [];       // Store Mxy at each TR for plotting approach to steady-state
let steadyStateMz = [];        // Store Mz at each TR

// Event markers for chart annotations (RF pulses, gradients)
let eventMarkers = []; // Array of { time, type, label }

// Theoretical curves drawn dashed behind the simulated data (textbook envelopes)
let theory = emptyTheory();
let lastRecordTime = -Infinity;  // Charts are sampled at ~maxTime/1200 intervals

function emptyTheory() {
    return {
        mxy: [], mxyLabel: '',     // e.g. T2 envelope
        mxy2: [], mxy2Label: '',   // e.g. T2* decay
        mz: [], mzLabel: '',
        markers: { mxy: [], mz: [] }  // { x, y, label, color }
    };
}

// Module E: single magnetization vector, simulated in the frame rotating at ω_RF
const RF_VIS = {
    pulseDuration: 300,       // display ms for the RF pulse (real pulse: 1 ms)
    freeDuration: 1500,       // display ms of free precession after the pulse
    T1: 1200,                 // display ms (relaxation is slowed together with ω0)
    T2: 400,                  // display ms
    larmorHzPerT: 10,         // displayed f0: 15 Hz at 1.5 T (true value 63.9 MHz)
    realPulseMs: 1,           // real pulse length used for B1 and the mismatch scale
    playbackRate: 150,        // display ms per real second at 1x
    maxTrail: 4000
};
let rfM = { x: 0, y: 0, z: 1 };   // Magnetization in the rotating frame
let rfPhase = 'idle';             // 'idle', 'pulse', 'free'
let rfTrail = [];                 // { t, x, y, z } in the rotating frame
let rfData = { labRe: [], labIm: [], rotRe: [], rotIm: [] };
let rfTipAngle = null;            // Angle of M from +z at the end of the pulse (deg)

// Three.js globals
let scene, camera, renderer;
let spinArrows = [];        // Individual spin arrows (ensemble for Module B/C)
let sumArrow = null;        // Sum magnetization arrow (white - total M)
let mxyArrow = null;        // Transverse component arrow (cyan - Mxy in xy plane)
let mzArrow = null;         // Longitudinal component arrow (blue - Mz along z)
let b0Arrow = null;         // B0 field indicator
let xyPlane = null;         // XY plane visualization
let netMagArrowA = null;    // Net magnetization arrow for Module A
let b1Arrow = null;         // RF B1 field (Module E)
let rfTrailLine = null;     // Path traced by M (Module E)
let axisLabels = {};        // Sprites: x', y' (rotating) and x, y (laboratory)

// Camera orbit state (z-up spherical coordinates, degrees)
const CAMERA_VIEWS = {
    '3d': { az: 35, el: 25, r: 4.2 },
    top: { az: -90, el: 89, r: 3.8 },
    side: { az: 0, el: 4, r: 4.0 }
};
let cameraOrbit = { ...CAMERA_VIEWS['3d'] };

// Chart.js instances
let chartMxy, chartMz, chartSignal;

// Animation
let animationId = null;
let lastTimestamp = 0;

// ============================================================================
// THREE.JS SETUP
// ============================================================================

function init3D() {
    const container = document.getElementById('canvas-3d');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    // Camera: z (B0) points up, as in textbook diagrams
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.up.set(0, 0, 1);
    updateCameraFromOrbit();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    // Coordinate axes (thin lines)
    const axesGroup = new THREE.Group();

    // X axis (red) - labeled as x'
    const xGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.5, 0, 0),
        new THREE.Vector3(1.5, 0, 0)
    ]);
    const xLine = new THREE.Line(xGeom, new THREE.LineBasicMaterial({ color: 0xff4444, opacity: 0.7, transparent: true }));
    axesGroup.add(xLine);

    // Y axis (green) - labeled as y'
    const yGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -1.5, 0),
        new THREE.Vector3(0, 1.5, 0)
    ]);
    const yLine = new THREE.Line(yGeom, new THREE.LineBasicMaterial({ color: 0x44ff44, opacity: 0.7, transparent: true }));
    axesGroup.add(yLine);

    // Z axis (blue) - B0 direction
    const zGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -1.5),
        new THREE.Vector3(0, 0, 1.5)
    ]);
    const zLine = new THREE.Line(zGeom, new THREE.LineBasicMaterial({ color: 0x4444ff, opacity: 0.7, transparent: true }));
    axesGroup.add(zLine);

    scene.add(axesGroup);

    // XY plane (semi-transparent) - transverse plane perpendicular to B0
    // CircleGeometry creates a circle in XY plane by default, which is correct
    // (z=0 plane, perpendicular to B0 which is along Z)
    // Use blue/purple color to distinguish from receiver coil
    const planeGeom = new THREE.CircleGeometry(1.2, 64);
    const planeMat = new THREE.MeshBasicMaterial({
        color: 0x6366f1,  // Indigo/purple - distinct from coil color
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide
    });
    xyPlane = new THREE.Mesh(planeGeom, planeMat);
    // No rotation needed - circle is already in XY plane (perpendicular to Z/B0)
    scene.add(xyPlane);

    // B0 arrow (pointing up along Z)
    const b0Dir = new THREE.Vector3(0, 0, 1);
    // Placed behind the scene (away from the default camera) so it reads as a field indicator
    b0Arrow = new THREE.ArrowHelper(b0Dir, new THREE.Vector3(0.3, -1.5, -0.7), 1.4, 0xffff00, 0.15, 0.1);
    scene.add(b0Arrow);

    // Create axis labels
    createAxisLabels();

    // Module E objects: B1 field arrow and the path traced by M
    b1Arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 0.9, 0xf59e0b, 0.12, 0.07);
    b1Arrow.visible = false;
    scene.add(b1Arrow);

    const trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RF_VIS.maxTrail * 3), 3));
    trailGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(RF_VIS.maxTrail * 3), 3));
    trailGeom.setDrawRange(0, 0);
    rfTrailLine = new THREE.Line(trailGeom, new THREE.LineBasicMaterial({ vertexColors: true }));
    rfTrailLine.visible = false;
    scene.add(rfTrailLine);

    // Orbit controls (simple mouse drag)
    setupOrbitControls(container);

    // Handle resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
}

/**
 * Text sprite with a constant on-screen size (labels near the camera don't balloon).
 * Optional subscript (e.g. M + "xy"); onTop draws it over everything else.
 */
function makeLabelSprite(text, color, { sub = '', position = null, onTop = false, height = 0.07 } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = sub ? 128 : 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const mainFont = 'bold 40px Inter, sans-serif';
    const subFont = 'bold 26px Inter, sans-serif';
    ctx.font = mainFont;
    const mainW = ctx.measureText(text).width;
    ctx.font = subFont;
    const subW = sub ? ctx.measureText(sub).width : 0;
    const x0 = (canvas.width - mainW - subW) / 2;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';  // dark outline: readable over the spin arrows
    ctx.fillStyle = color;
    ctx.font = mainFont;
    ctx.strokeText(text, x0, 32);
    ctx.fillText(text, x0, 32);
    if (sub) {
        ctx.font = subFont;
        ctx.strokeText(sub, x0 + mainW, 44);
        ctx.fillText(sub, x0 + mainW, 44);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: !onTop });
    const sprite = new THREE.Sprite(spriteMat);
    if (position) sprite.position.copy(position);
    sprite.scale.set(height * canvas.width / canvas.height, height, 1);
    if (onTop) sprite.renderOrder = 11;
    return sprite;
}

// Shared unit geometry for the thick vector arrows (scaled per arrow)
const VECTOR_SHAFT_GEOM = new THREE.CylinderGeometry(1, 1, 1, 12);
const VECTOR_HEAD_GEOM = new THREE.ConeGeometry(1, 1, 16);

/**
 * Thick, labelled arrow for a summed vector (M, Mxy, Mz). Drawn on top of the
 * thin spin-packet arrows, so the sum never gets lost among them.
 * Same calls as THREE.ArrowHelper: setDirection(dir), setLength(length), setColor(color).
 * The label sits beyond the tip, or beside the shaft (labelAlong < 1, labelSide ≠ 0) for
 * arrows that can coincide with M; it hides while the arrow is short, where labels would pile up.
 */
class VectorArrow extends THREE.Group {
    constructor(dir, length, color, { label = '', sub = '', radius = 0.022, labelSide = 0, labelAlong = 1 } = {}) {
        super();
        this.radius = radius;
        this.labelSide = labelSide;
        this.labelAlong = labelAlong;
        this.material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
        this.shaft = new THREE.Mesh(VECTOR_SHAFT_GEOM, this.material);
        this.head = new THREE.Mesh(VECTOR_HEAD_GEOM, this.material);
        // Thinner arrows draw last, so a thin M stays visible on a thicker, coinciding Mz
        this.shaft.renderOrder = this.head.renderOrder = 10 + (0.03 - radius) * 100;
        this.add(this.shaft, this.head);
        if (label) {
            this.label = makeLabelSprite(label, '#' + new THREE.Color(color).getHexString(), { sub, onTop: true, height: 0.045 });
            this.add(this.label);
        }
        this.setDirection(dir);
        this.setLength(length);
    }

    setDirection(dir) {
        this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    }

    // ArrowHelper's head-size arguments are ignored: the head scales with the arrow
    setLength(length) {
        const head = Math.min(0.14, 0.45 * length);
        const shaft = Math.max(1e-3, length - head);
        this.shaft.scale.set(this.radius, shaft, this.radius);
        this.shaft.position.y = shaft / 2;
        this.head.scale.set(this.radius * 2.8, head, this.radius * 2.8);
        this.head.position.y = length - head / 2;
        if (this.label) {
            const along = this.labelAlong < 1 ? this.labelAlong * length : length + 0.08;
            this.label.position.set(this.labelSide, along, 0);
            this.label.visible = length >= 0.25;
        }
    }

    setColor(color) {
        this.material.color.set(color);
    }
}

// Thin spin-packet arrows are drawn slightly transparent, so the thick sums stand out
function fadeSpinArrow(arrow) {
    [arrow.line.material, arrow.cone.material].forEach(m => {
        m.transparent = true;
        m.opacity = 0.7;
    });
}

function createAxisLabels() {
    axisLabels.xRot = makeLabelSprite("x'", '#ff6666', { position: new THREE.Vector3(1.7, 0, 0) });
    // y at 1.35 (not 1.7): in the narrow desktop view 1.7 falls outside the canvas
    axisLabels.yRot = makeLabelSprite("y'", '#66ff66', { position: new THREE.Vector3(0, 1.35, 0) });
    axisLabels.xLab = makeLabelSprite("x", '#ff6666', { position: new THREE.Vector3(1.7, 0, 0) });
    axisLabels.yLab = makeLabelSprite("y", '#66ff66', { position: new THREE.Vector3(0, 1.35, 0) });
    axisLabels.z = makeLabelSprite("z", '#8888ff', { position: new THREE.Vector3(0, 0, 1.6) });
    // B₀ is labelled on its own (yellow) arrow; the z axis is just its direction
    axisLabels.b0 = makeLabelSprite("B₀", '#ffff00', { position: new THREE.Vector3(0.3, -1.5, 0.88) });
    Object.values(axisLabels).forEach(label => scene.add(label));
    setAxisFrame('rot');
}

/**
 * Show x', y' (rotating frame) or x, y (laboratory frame) axis labels
 * and the matching view label.
 */
function setAxisFrame(frame, labelText) {
    const lab = frame === 'lab';
    axisLabels.xRot.visible = !lab;
    axisLabels.yRot.visible = !lab;
    axisLabels.xLab.visible = lab;
    axisLabels.yLab.visible = lab;
    const viewLabel = document.getElementById('view-label');
    if (viewLabel) {
        viewLabel.textContent = labelText || (lab ? 'Laboratory Frame (slowed)' : 'Rotating Frame (ω₀)');
    }
}

function updateCameraFromOrbit() {
    const az = cameraOrbit.az * Math.PI / 180;
    const el = cameraOrbit.el * Math.PI / 180;
    camera.position.set(
        cameraOrbit.r * Math.cos(el) * Math.cos(az),
        cameraOrbit.r * Math.cos(el) * Math.sin(az),
        cameraOrbit.r * Math.sin(el)
    );
    camera.lookAt(0, 0, 0);
    // Looking straight down z, its label would sit on top of the spins
    if (axisLabels.z) axisLabels.z.visible = cameraOrbit.el < 75;
}

function setCameraView(view) {
    cameraOrbit = { ...CAMERA_VIEWS[view] };
    updateCameraFromOrbit();
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
}

/**
 * Color for a spin by its precession-speed rank (0 = slowest, 1 = fastest):
 * blue → magenta → red. Makes the "runners on a track" picture visible:
 * fast spins lead, slow spins lag, and the 180° pulse swaps their order.
 * (The map skips cyan, green and yellow, which belong to Mxy, Module A's spins and B₀.)
 */
function speedRankColor(rank) {
    const color = new THREE.Color();
    color.setHSL(((240 + 120 * rank) % 360) / 360, 0.85, 0.6);
    return color;
}

function colorEnsembleArrows() {
    const offsets = ensemble.spins.map(spin => spin.getTotalDeltaOmega());
    const order = offsets.map((f, i) => i).sort((a, b) => offsets[a] - offsets[b]);
    const rank = new Array(offsets.length);
    order.forEach((spinIndex, r) => { rank[spinIndex] = offsets.length > 1 ? r / (offsets.length - 1) : 0.5; });
    spinArrows.forEach((arrow, i) => arrow.setColor(speedRankColor(rank[i])));
}

/**
 * Update signal panel glow based on detected signal strength
 * The Signal/FID chart panel border glows when signal is detected
 * This avoids the rotating frame vs lab frame confusion of showing a coil in 3D
 *
 * PHYSICS: Signal detection uses Faraday's law: EMF ∝ -dΦ/dt
 * In the lab frame Mxy rotates at ω₀, so EMF ∝ ω₀ · Mxy · sin(ω₀t + φ).
 * Because ω₀ (MHz range) dwarfs the relaxation rates, the ENVELOPE of the
 * detected signal is proportional to |Mxy| itself: a large, steadily
 * precessing Mxy induces the strongest voltage. Slow changes of Mxy
 * (T2 decay, echo rephasing) contribute negligibly to dΦ/dt compared
 * with the ω₀ rotation.
 *
 * Glow ∝ |Mxy|: bright right after excitation and at echo peaks,
 * fading as dephasing/relaxation shrink Mxy.
 *
 * @param {number} mxy - Current transverse magnetization magnitude (0 to 1)
 */
function updateSignalPanelGlow(mxy) {
    const signalPanel = document.querySelector('.signal-panel:last-child');
    if (!signalPanel) return;

    // Envelope of induced EMF ∝ ω₀ · |Mxy| → glow tracks |Mxy| directly
    const glowIntensity = Math.min(mxy, 1.0);

    if (glowIntensity > 0.05) {
        // Glow color: orange to yellow based on intensity
        const r = 255;
        const g = Math.floor(150 + glowIntensity * 105);
        const b = Math.floor(glowIntensity * 50);
        const glowSize = 5 + glowIntensity * 15; // 5-20px glow
        signalPanel.style.boxShadow = `0 0 ${glowSize}px rgba(${r}, ${g}, ${b}, ${glowIntensity * 0.8})`;
        signalPanel.style.borderColor = `rgb(${r}, ${g}, ${b})`;
    } else {
        signalPanel.style.boxShadow = 'none';
        signalPanel.style.borderColor = 'var(--border-color)';
    }
}

/**
 * Create arrows for Module A alignment visualization
 * Shows individual spins aligning with B0 when turned on
 */
function createAlignmentArrows(numSpins) {
    // Remove existing arrows
    alignmentArrows.forEach(arrow => scene.remove(arrow));
    alignmentArrows = [];

    if (netMagArrowA) {
        scene.remove(netMagArrowA);
        netMagArrowA = null;
    }

    // Create individual spin arrows (green, smaller)
    for (let i = 0; i < numSpins; i++) {
        // Random initial direction
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);
        const dir = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        );

        const arrow = new THREE.ArrowHelper(
            dir,
            new THREE.Vector3(0, 0, 0),
            0.75,
            0x10b981,
            0.08,
            0.05
        );
        arrow.name = 'alignmentSpin';
        fadeSpinArrow(arrow);
        alignmentArrows.push(arrow);
        scene.add(arrow);
    }

    // Net magnetization arrow (white, thick, labelled M)
    const netDir = new THREE.Vector3(0, 0, 0.01);
    netMagArrowA = new VectorArrow(netDir, 0.01, 0xffffff, { label: 'M' });
    netMagArrowA.name = 'netMagA';
    netMagArrowA.visible = false;
    scene.add(netMagArrowA);
}

/**
 * Update alignment arrows to match ensemble spin orientations
 */
function updateAlignmentArrows() {
    if (!alignmentEnsemble) return;

    // Update individual arrows
    alignmentEnsemble.spins.forEach((spin, i) => {
        if (alignmentArrows[i]) {
            const dir = new THREE.Vector3(spin.Mx, spin.My, spin.Mz);
            const length = dir.length();
            if (length > 0.001) {
                dir.normalize();
                alignmentArrows[i].setDirection(dir);
                alignmentArrows[i].setLength(length * 0.75, 0.08, 0.05);
            }
        }
    });

    // Update net magnetization arrow
    // The true net magnetization from random spins is ~1/√N (very small)
    // For N=100 random spins: |M| ~ 0.1
    // After alignment: |M| approaches 1.0 (all spins along +z)
    const sum = alignmentEnsemble.getSumMagnetization();
    const sumDir = new THREE.Vector3(sum.Mx, sum.My, sum.Mz);
    const M0 = alignmentEnsemble.M0 || 1;
    // Length shown as M/M0 so the arrow reaches full length at equilibrium
    // in both the simplified and the Boltzmann (slight excess) pictures
    const sumLength = sumDir.length() / M0;

    // Show arrow based on Mz alignment (what we're visualizing)
    // Random spins: Mz = 0 (cancel out)
    // Aligned spins: Mz → M0
    // Use Mz/M0 as the visibility criterion since that's what the chart shows
    const VISIBILITY_THRESHOLD = 0.1;

    if (netMagArrowA) {
        // Use Mz for visibility check (matches the Mz chart)
        // But use full vector for direction
        if (sum.Mz / M0 > VISIBILITY_THRESHOLD) {
            sumDir.normalize();
            // Arrow length proportional to |M|/M0, with minimum for visibility
            const displayLength = Math.max(Math.min(sumLength, 1.0), 0.15);
            netMagArrowA.setDirection(sumDir);
            netMagArrowA.setLength(displayLength, 0.12, 0.06);
            netMagArrowA.visible = true;
        } else {
            netMagArrowA.visible = false;
        }
    }
}

function createEnsembleArrows() {
    // Clear existing
    spinArrows.forEach(arrow => scene.remove(arrow));
    spinArrows = [];

    if (sumArrow) scene.remove(sumArrow);
    if (mxyArrow) scene.remove(mxyArrow);
    if (mzArrow) scene.remove(mzArrow);

    // Create individual spin arrows
    const arrowLength = 0.95;
    ensemble.spins.forEach((spin) => {
        const dir = new THREE.Vector3(spin.Mx, spin.My, spin.Mz).normalize();
        const arrow = new THREE.ArrowHelper(
            dir,
            new THREE.Vector3(0, 0, 0),
            arrowLength,
            0x10b981,
            0.08,
            0.05
        );
        arrow.visible = CONFIG.showIndividual;
        fadeSpinArrow(arrow);
        spinArrows.push(arrow);
        scene.add(arrow);
    });

    // Get sum magnetization for component arrows
    // Note: getSumMagnetization returns normalized values (0-1 range for coherent spins)
    const sum = ensemble.getSumMagnetization();

    // Always create all three arrows (they'll be updated in updateEnsembleArrows)
    // Mxy arrow (cyan) - transverse component in xy plane
    const mxyMag = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);
    const mxyDir = mxyMag > 0.001 ? new THREE.Vector3(sum.Mx, sum.My, 0).normalize() : new THREE.Vector3(1, 0, 0);
    const mxyLen = Math.max(mxyMag, 0.1); // Minimum visible length
    // Label beside the shaft: right after a 90° pulse M and Mxy coincide
    mxyArrow = new VectorArrow(mxyDir, mxyLen, 0x22d3ee, { label: 'M', sub: 'xy', radius: 0.03, labelSide: 0.1, labelAlong: 0.55 });
    mxyArrow.visible = mxyMag > 0.02;
    scene.add(mxyArrow);

    // Mz arrow (blue) - longitudinal component along z
    const mzMag = Math.abs(sum.Mz);
    const mzDir = new THREE.Vector3(0, 0, sum.Mz >= 0 ? 1 : -1);
    const mzLen = Math.max(mzMag, 0.1);
    // Label beside the shaft, so it doesn't collide with M's label when M lies along z
    mzArrow = new VectorArrow(mzDir, mzLen, 0x3b82f6, { label: 'M', sub: 'z', radius: 0.03, labelSide: 0.1, labelAlong: 0.55 });
    mzArrow.visible = mzMag > 0.02;
    scene.add(mzArrow);

    // Sum arrow (white) - total magnetization vector
    const sumMag = Math.sqrt(sum.Mx*sum.Mx + sum.My*sum.My + sum.Mz*sum.Mz);
    const sumDir = sumMag > 0.001 ? new THREE.Vector3(sum.Mx, sum.My, sum.Mz).normalize() : new THREE.Vector3(0, 0, 1);
    const sumLen = Math.max(sumMag, 0.1);
    sumArrow = new VectorArrow(sumDir, sumLen, 0xffffff, { label: 'M', radius: 0.018 });
    sumArrow.visible = sumMag > 0.02;
    scene.add(sumArrow);

    colorEnsembleArrows();
}


function updateEnsembleArrows() {
    // Update individual arrows
    ensemble.spins.forEach((spin, i) => {
        if (spinArrows[i]) {
            const dir = new THREE.Vector3(spin.Mx, spin.My, spin.Mz);
            const length = dir.length();
            if (length > 0.001) {
                dir.normalize();
                spinArrows[i].setDirection(dir);
                spinArrows[i].setLength(length * 0.95, 0.08, 0.05);
            }
            spinArrows[i].visible = CONFIG.showIndividual;
        }
    });

    // Get sum magnetization
    const sum = ensemble.getSumMagnetization();

    // Update Mxy arrow (cyan) - transverse component
    const mxyMag = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);
    if (mxyArrow) {
        if (mxyMag > 0.02) {
            const mxyDir = new THREE.Vector3(sum.Mx, sum.My, 0).normalize();
            mxyArrow.setDirection(mxyDir);
            mxyArrow.setLength(Math.min(mxyMag, 1.0), 0.12, 0.06);
            mxyArrow.visible = true;
        } else {
            mxyArrow.visible = false;
        }
    }

    // Update Mz arrow (blue) - longitudinal component
    const mzMag = Math.abs(sum.Mz);
    if (mzArrow) {
        if (mzMag > 0.02) {
            const mzDir = new THREE.Vector3(0, 0, sum.Mz >= 0 ? 1 : -1);
            mzArrow.setDirection(mzDir);
            mzArrow.setLength(Math.min(mzMag, 1.0), 0.12, 0.06);
            mzArrow.visible = true;
        } else {
            mzArrow.visible = false;
        }
    }

    // Update sum arrow (white) - total magnetization
    const sumMag = Math.sqrt(sum.Mx*sum.Mx + sum.My*sum.My + sum.Mz*sum.Mz);
    if (sumArrow) {
        if (sumMag > 0.02) {
            const sumDir = new THREE.Vector3(sum.Mx, sum.My, sum.Mz).normalize();
            sumArrow.setDirection(sumDir);
            sumArrow.setLength(Math.min(sumMag, 1.0), 0.12, 0.06);
            sumArrow.visible = true;
        } else {
            sumArrow.visible = false;
        }
    }
}

function setupOrbitControls(container) {
    let isDragging = false;
    let previousMouse = { x: 0, y: 0 };

    container.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMouse = { x: e.clientX, y: e.clientY };
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - previousMouse.x;
        const deltaY = e.clientY - previousMouse.y;

        // Orbit around the B0 (z) axis; clamp elevation to avoid flipping
        cameraOrbit.az -= deltaX * 0.5;
        cameraOrbit.el = Math.max(-85, Math.min(89, cameraOrbit.el + deltaY * 0.5));
        updateCameraFromOrbit();
        document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));

        previousMouse = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Zoom with wheel
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.001;
        cameraOrbit.r = Math.max(2, Math.min(10, cameraOrbit.r * (1 + e.deltaY * zoomSpeed)));
        updateCameraFromOrbit();
    });
}

// ============================================================================
// CHART.JS SETUP
// ============================================================================

function initCharts() {
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
            x: {
                type: 'linear',
                title: { display: true, text: 'Time (ms)', color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                ticks: { color: '#94a3b8' }
            },
            y: {
                title: { display: true, text: 'Magnitude', color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                ticks: { color: '#94a3b8' },
                min: 0,
                max: 1.1
            }
        },
        plugins: {
            legend: { display: false }
        }
    };

    // Dashed theory curves are drawn behind the simulation; the legend only
    // lists datasets that currently have data
    const theoryDataset = (label, color) => ({
        label, data: [], borderColor: color, borderWidth: 1.5, borderDash: [6, 4],
        pointRadius: 0, tension: 0, order: 2
    });
    const theoryLegend = {
        display: true,
        position: 'top',
        labels: {
            color: '#94a3b8', boxWidth: 12, padding: 6, font: { size: 10 },
            filter: (item, data) => data.datasets[item.datasetIndex].data.length > 0
        }
    };

    // Mxy chart
    chartMxy = new Chart(document.getElementById('chart-mxy'), {
        type: 'line',
        data: {
            datasets: [{
                label: '|Mxy| (simulated)',
                data: [],
                borderColor: '#10b981',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                order: 1
            },
            theoryDataset('T2 envelope', '#94a3b8'),
            theoryDataset('T2* decay', '#f59e0b')]
        },
        options: { ...chartOptions, plugins: { legend: theoryLegend } }
    });

    // Mz chart
    chartMz = new Chart(document.getElementById('chart-mz'), {
        type: 'line',
        data: {
            datasets: [{
                label: 'Mz (simulated)',
                data: [],
                borderColor: '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1,
                order: 1
            },
            theoryDataset('Theory', '#94a3b8')]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: { ...chartOptions.scales.y, min: -0.1, max: 1.1 }
            },
            plugins: { legend: theoryLegend }
        }
    });

    // Signal chart (Re and Im)
    chartSignal = new Chart(document.getElementById('chart-signal'), {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Re(S)',
                    data: [],
                    borderColor: '#ef4444',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'Im(S)',
                    data: [],
                    borderColor: '#22c55e',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: '|S|',
                    data: [],
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1
                }
            ]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: { ...chartOptions.scales.y, min: -1.1, max: 1.1 }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: '#94a3b8', boxWidth: 12, padding: 8 }
                }
            }
        }
    });
}

function updateCharts() {
    // Get annotations for Module C and D (both use event markers)
    const annotations = ['C', 'D', 'E'].includes(CONFIG.currentModule) ? getChartAnnotations() : {};

    // Update Mxy chart with annotations
    chartMxy.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: mxyData[i] }));
    chartMxy.data.datasets[1].data = theory.mxy;
    chartMxy.data.datasets[1].label = theory.mxyLabel;
    chartMxy.data.datasets[2].data = theory.mxy2;
    chartMxy.data.datasets[2].label = theory.mxy2Label;
    chartMxy.options.plugins.annotation = { annotations: { ...annotations, ...getTheoryMarkers('mxy') } };
    chartMxy.update('none');

    // Update Mz chart with annotations
    chartMz.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: mzData[i] }));
    chartMz.data.datasets[1].data = theory.mz;
    chartMz.data.datasets[1].label = theory.mzLabel;
    chartMz.options.plugins.annotation = { annotations: { ...annotations, ...getTheoryMarkers('mz') } };
    chartMz.update('none');

    // Module E can show the signal in either frame (both are recorded)
    let re = signalReData, im = signalImData;
    if (CONFIG.currentModule === 'E') {
        re = CONFIG.frameE === 'lab' ? rfData.labRe : rfData.rotRe;
        im = CONFIG.frameE === 'lab' ? rfData.labIm : rfData.rotIm;
    }

    // Update Signal chart with annotations
    chartSignal.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: re[i] }));
    chartSignal.data.datasets[1].data = timeData.map((t, i) => ({ x: t, y: im[i] }));
    chartSignal.data.datasets[2].data = timeData.map((t, i) => ({ x: t, y: mxyData[i] }));
    chartSignal.options.plugins.annotation = { annotations };
    chartSignal.update('none');
}

function clearChartData() {
    timeData = [];
    mxyData = [];
    mzData = [];
    signalReData = [];
    signalImData = [];
    rfData = { labRe: [], labIm: [], rotRe: [], rotIm: [] };
    eventMarkers = [];
    lastRecordTime = -Infinity;
    updateCharts();
}

/**
 * Fix the time axis to the run's window so curves are drawn progressively
 * (an auto-scaling axis always fills the plot and hides how much changed).
 * Also sets the Mz axis floor so inverted magnetization (180°, α > 90°) shows.
 */
function setChartWindow(maxTime, mzMin = -0.1, xLabel = 'Time (ms)') {
    [chartMxy, chartMz, chartSignal].forEach(chart => {
        chart.options.scales.x.min = 0;
        chart.options.scales.x.max = maxTime;
        chart.options.scales.x.title.text = xLabel;
    });
    chartMz.options.scales.y.min = mzMin;
}

/** Sample f(t) on [0, maxTime] for a dashed theory curve */
function sampleCurve(f, maxTime, points = 300) {
    const data = [];
    for (let i = 0; i <= points; i++) {
        const t = maxTime * i / points;
        data.push({ x: t, y: f(t) });
    }
    return data;
}

/** Point + label annotations marking T1/T2/T2* on the theory curves */
function getTheoryMarkers(chartKey) {
    const annotations = {};
    theory.markers[chartKey].forEach((m, i) => {
        if (m.x > CONFIG.maxTime) return;
        annotations[`theory${i}`] = {
            type: 'point', xValue: m.x, yValue: m.y, radius: 3.5,
            backgroundColor: m.color, borderColor: '#0f172a', borderWidth: 1
        };
        annotations[`theoryLabel${i}`] = {
            type: 'label', xValue: m.x, yValue: m.y, content: m.label,
            color: m.color, font: { size: 10, weight: 'bold' },
            xAdjust: 6, yAdjust: -12, position: { x: 'start', y: 'center' }
        };
    });
    return annotations;
}

/**
 * Add an event marker for chart annotations
 * @param {number} time - Time in ms when event occurs
 * @param {string} type - 'rf90', 'rf180', 'gradient_flip', 'gradient_restore', 'echo'
 * @param {string} label - Label to show on chart
 */
function addEventMarker(time, type, label) {
    eventMarkers.push({ time, type, label });
}

/**
 * Generate Chart.js annotation config from event markers
 */
function getChartAnnotations() {
    const annotations = {};

    eventMarkers.forEach((event, i) => {
        let color, borderDash;

        switch (event.type) {
            case 'rf90':
                color = '#f59e0b'; // amber
                borderDash = [];
                break;
            case 'rf180':
                color = '#ef4444'; // red
                borderDash = [];
                break;
            case 'gradient_flip':
                color = '#8b5cf6'; // purple
                borderDash = [5, 5];
                break;
            case 'gradient_restore':
                color = '#8b5cf6'; // purple
                borderDash = [2, 2];
                break;
            case 'echo':
                color = '#22c55e'; // green
                borderDash = [];
                break;
            default:
                color = '#94a3b8';
                borderDash = [];
        }

        annotations[`event${i}`] = {
            type: 'line',
            xMin: event.time,
            xMax: event.time,
            borderColor: color,
            borderWidth: 2,
            borderDash: borderDash,
            label: {
                display: true,
                content: event.label,
                position: 'start',
                backgroundColor: 'rgba(0,0,0,0.7)',
                color: color,
                font: { size: 10, weight: 'bold' },
                padding: 3
            }
        };
    });

    return annotations;
}

// ============================================================================
// ANIMATION LOOP
// ============================================================================

function animate(timestamp) {
    animationId = requestAnimationFrame(animate);

    // Real time since the last frame (clamped so a background tab doesn't jump)
    const elapsedSec = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.1) : 0;
    lastTimestamp = timestamp;

    // Module A: Larmor precession keeps going after the T1 window has ended
    const precessingA = CONFIG.currentModule === 'A' && b0IsOn && CONFIG.isPlaying && CONFIG.showPrecessionA;
    if (precessingA) {
        precessAlignmentSpins(elapsedSec * CONFIG.animationSpeed);
    }

    // Update simulation if playing
    if (CONFIG.isPlaying && CONFIG.currentTime < CONFIG.maxTime) {
        // Each run plays its window in ~RUN_PLAYBACK_SECONDS; physics uses
        // sub-steps of at most CONFIG.dt so fast precession stays accurate
        const slowMotion = CONFIG.currentTime < CONFIG.slowUntil;
        const rate = slowMotion ? CONFIG.slowRate : CONFIG.playbackRate;
        let remaining = Math.min(elapsedSec * rate * CONFIG.animationSpeed,
            CONFIG.maxTime - CONFIG.currentTime);
        const recordInterval = CONFIG.maxTime / 1200;
        while (remaining > 1e-9) {
            const step = Math.min(CONFIG.dt, remaining);
            CONFIG.currentTime += step;
            remaining -= step;
            stepModule(step);
            if (CONFIG.currentTime - lastRecordTime >= recordInterval) {
                recordSample();
                lastRecordTime = CONFIG.currentTime;
            }
        }
        renderModule();

        // Update time display
        document.getElementById('time-val').textContent = CONFIG.currentTime.toFixed(1) + ' ms' +
            (slowMotion ? ' (slow-mo)' : '');
    } else if (precessingA) {
        updateAlignmentArrows();
    }

    // Render 3D scene
    renderer.render(scene, camera);
}

/** Advance the current module's physics by dt (ms) */
function stepModule(dt) {
    switch (CONFIG.currentModule) {
        case 'A':
            stepModuleA(dt);
            break;
        case 'B':
            ensemble.evolve(dt);
            break;
        case 'C':
            stepModuleC(dt);
            break;
        case 'D':
            stepModuleD(dt);
            break;
        case 'E':
            stepModuleE(dt);
            break;
    }
}

/** Append one sample of the net magnetization to the chart data */
function recordSample() {
    let Mx, My, Mz;
    switch (CONFIG.currentModule) {
        case 'A': {
            if (!alignmentEnsemble || !b0IsOn) return;
            // Normalized to the equilibrium magnetization M0
            const sum = alignmentEnsemble.getSumMagnetization();
            const M0 = alignmentEnsemble.M0 || 1;
            Mx = sum.Mx / M0;
            My = sum.My / M0;
            Mz = sum.Mz / M0;
            break;
        }
        case 'D':
            if (greSequenceState !== 'running') return;
        // falls through
        case 'B':
        case 'C': {
            const sum = ensemble.getSumMagnetization();
            Mx = sum.Mx;
            My = sum.My;
            Mz = sum.Mz;
            break;
        }
        case 'E': {
            Mx = rfM.x;
            My = rfM.y;
            Mz = rfM.z;
            const [labX, labY] = rotatingToLab(rfM.x, rfM.y, CONFIG.currentTime);
            rfData.rotRe.push(rfM.x);
            rfData.rotIm.push(rfM.y);
            rfData.labRe.push(labX);
            rfData.labIm.push(labY);
            break;
        }
    }

    timeData.push(CONFIG.currentTime);
    mxyData.push(Math.sqrt(Mx * Mx + My * My));
    mzData.push(Mz);
    signalReData.push(Mx);
    signalImData.push(My);
}

/** Update 3D view, readouts, charts and signal glow once per frame */
function renderModule() {
    const module = CONFIG.currentModule;

    if (module === 'A') {
        if (!alignmentEnsemble) return;
        updateAlignmentArrows();
        updateAlignmentReadouts();
        updateCharts();
        return;
    }

    if (module === 'E') {
        updateRFVisuals();
        updateCharts();
        updateSignalPanelGlow(Math.sqrt(rfM.x * rfM.x + rfM.y * rfM.y));
        return;
    }

    const sum = ensemble.getSumMagnetization();
    updateEnsembleArrows();
    updateVectorDisplay(sum);
    document.getElementById('coherent-count').textContent = ensemble.getPhaseCoherence().toFixed(0) + '%';
    updateCharts();

    // Update signal panel glow: detected EMF envelope ∝ |Mxy| (Faraday's law at ω₀)
    updateSignalPanelGlow(Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My));
}

/**
 * Module A: T1 relaxation after B0 is switched on.
 * Each spin's longitudinal component relaxes toward its equilibrium value
 * (1, or its Boltzmann share): Mz(t) = Mz_eq + (Mz(0) - Mz_eq)·e^(-t/T1),
 * so the ensemble average follows M0(1 - e^(-t/T1)) exactly.
 * Spins stay unit vectors: the transverse part shrinks, the azimuth is kept.
 */
function stepModuleA(dt) {
    if (!alignmentEnsemble || !b0IsOn) return;

    const E1 = Math.exp(-dt / CONFIG.T1);
    alignmentEnsemble.spins.forEach((spin, i) => {
        const target = alignmentEnsemble.targets[i];
        spin.Mz = target + (spin.Mz - target) * E1;
        const mxy = Math.sqrt(Math.max(0, 1 - spin.Mz * spin.Mz));
        spin.Mx = mxy * Math.cos(spin.phase);
        spin.My = mxy * Math.sin(spin.phase);
    });
}

/**
 * Module A: precession of every spin about B0 at the (slowed) Larmor
 * frequency. Spins precess at any angle; the net M stays along z because
 * the azimuths are balanced, so no signal is produced without RF.
 * @param {number} realSec - Real seconds elapsed (already scaled by speed)
 */
function precessAlignmentSpins(realSec) {
    if (!alignmentEnsemble) return;
    const dAngle = 2 * Math.PI * VIS_PRECESSION_REV_PER_S_PER_T * CONFIG.B0 * realSec;
    alignmentEnsemble.spins.forEach(spin => {
        spin.phase += dAngle;
        const mxy = Math.sqrt(spin.Mx * spin.Mx + spin.My * spin.My);
        spin.Mx = mxy * Math.cos(spin.phase);
        spin.My = mxy * Math.sin(spin.phase);
    });
}

function updateAlignmentReadouts() {
    if (!alignmentEnsemble) return;
    const sum = alignmentEnsemble.getSumMagnetization();
    const M0 = alignmentEnsemble.M0 || 1;
    const percent = Math.max(0, sum.Mz / M0 * 100);
    document.getElementById('alignment-fill').style.width = Math.min(100, percent) + '%';
    document.getElementById('net-mz').textContent = percent.toFixed(0) + '%';

    const up = alignmentEnsemble.spins.filter(spin => spin.Mz > 0).length / alignmentEnsemble.numSpins * 100;
    document.getElementById('up-down').textContent = `${up.toFixed(0)}% / ${(100 - up).toFixed(0)}%`;

    updateVectorDisplay({ Mx: sum.Mx / M0, My: sum.My / M0, Mz: sum.Mz / M0 });
}

function stepModuleC(dt) {
    echoSequenceTime += dt;

    // Handle echo sequence timing
    const halfTE = CONFIG.TE / 2;

    if (CONFIG.echoType === 'spin') {
        // Spin Echo: 90° at t=0, 180° at t=TE/2, echo at t=TE
        if (echoSequenceState === 'dephasing' && echoSequenceTime >= halfTE) {
            // Apply 180° pulse
            ensemble.spins.forEach(spin => {
                spin.applyRFPulse(180, 0);
            });
            // Add event marker for 180° pulse
            addEventMarker(CONFIG.currentTime, 'rf180', '180°');
            echoSequenceState = 'refocusing';
        }
    } else {
        // Gradient Echo: gradient reversal at TE/2, turn off at TE
        if (echoSequenceState === 'dephasing' && echoSequenceTime >= halfTE && !gradientFlipped) {
            // Toggle gradient direction (flip sign)
            ensemble.toggleGradient();
            gradientFlipped = true;
            // Add event marker for gradient flip
            addEventMarker(CONFIG.currentTime, 'gradient_flip', 'G flip');
            echoSequenceState = 'refocusing';
        }
        // Turn off gradient at echo (TE) - readout complete
        if (echoSequenceState === 'refocusing' && echoSequenceTime >= CONFIG.TE && gradientFlipped) {
            // Clear gradient completely - only B0 inhomogeneity remains
            ensemble.clearGradient();
            echoSequenceState = 'done';
        }
    }

    // Evolve ensemble
    ensemble.evolve(dt);
}

/**
 * Module D: GRE Variants - Multi-TR steady-state simulation
 * Shows how magnetization evolves over repeated excitations
 * Spoiled GRE: RF spoiling destroys Mxy → T1-weighted
 * SSFP: Balanced gradients preserve Mxy → T2/T1-weighted
 */
function stepModuleD(dt) {
    if (greSequenceState !== 'running') return;

    timeInTR += dt;

    // Check if we've completed a TR
    if (timeInTR >= CONFIG.TR) {
        // End of TR: record steady-state signal and prepare for next TR
        const sum = ensemble.getSumMagnetization();
        const mxy = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);

        // Store signal at end of TR (just before next RF pulse)
        steadyStateMxy.push(mxy);
        steadyStateMz.push(sum.Mz);

        currentTRIndex++;

        // Check if we've done all TRs
        if (currentTRIndex >= CONFIG.numTR) {
            greSequenceState = 'done';
            updateSteadyStateDisplay();
            return;
        }

        // Prepare for next TR (carry the overshoot so TRs don't drift longer)
        timeInTR -= CONFIG.TR;

        // Apply RF pulse at start of new TR
        if (CONFIG.greType === 'spoiled') {
            // Spoiled GRE: Apply spoiler gradient to destroy Mxy before RF
            // Then apply RF with incrementing phase (RF spoiling)
            // Simplified: just zero out Mxy (perfect spoiling)
            ensemble.spins.forEach(spin => {
                spin.Mx = 0;
                spin.My = 0;
            });
            // Apply RF pulse
            ensemble.applyRFPulse(CONFIG.flipAngleD, 0);
        } else {
            // SSFP: Balanced gradients mean Mxy is preserved
            // Alternate RF phase by 180° each TR (typical bSSFP)
            const phase = (currentTRIndex % 2) * 180;
            ensemble.applyRFPulse(CONFIG.flipAngleD, phase);
        }

        // Add RF marker
        addEventMarker(CONFIG.currentTime, 'rf90', `α${currentTRIndex + 1}`);
    }

    // Evolve ensemble (T1 recovery, T2 decay, precession)
    ensemble.evolve(dt);
}

// ============================================================================
// MODULE E: RF EXCITATION & PRECESSION (LAB vs ROTATING FRAME)
// ============================================================================

/**
 * Angular rates for Module E in rad per display-ms.
 * The pulse is drawn over RF_VIS.pulseDuration display-ms but stands for a
 * real 1 ms pulse; the RF frequency mismatch keeps its real ratio to the RF
 * strength (Δω/ω1), so the rotating-frame trajectory is exactly the real one.
 */
function rfRates() {
    const alpha = CONFIG.flipAngleE * Math.PI / 180;
    const omega1 = alpha / RF_VIS.pulseDuration;
    const omega1Real = alpha / RF_VIS.realPulseMs;                 // rad per real ms
    const mismatchReal = 2 * Math.PI * CONFIG.rfOffsetE / 1000;    // ω_RF − ω0, rad per real ms
    const mismatch = mismatchReal * omega1 / omega1Real;
    const omega0 = 2 * Math.PI * RF_VIS.larmorHzPerT * CONFIG.B0 / 1000;
    return { omega1, omega0, omegaRF: omega0 + mismatch };
}

/** Rotating-frame (x', y') → laboratory (x, y): the frame turns at ω_RF */
function rotatingToLab(x, y, t) {
    const angle = rfRates().omegaRF * t;
    const c = Math.cos(angle), s = Math.sin(angle);
    return [x * c - y * s, x * s + y * c];
}

/**
 * Rotate vector M about axis w by |w|·dt (right-handed, the same sense as
 * Spin.applyRFPulse: a pulse about +x' tips +z toward -y')
 */
function rotateAboutAxis(M, wx, wy, wz, dt) {
    const w = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (w < 1e-12) return;
    const ux = wx / w, uy = wy / w, uz = wz / w;
    const c = Math.cos(w * dt), s = Math.sin(w * dt);
    const dot = ux * M.x + uy * M.y + uz * M.z;
    const cx = uy * M.z - uz * M.y;
    const cy = uz * M.x - ux * M.z;
    const cz = ux * M.y - uy * M.x;
    const x = M.x * c + cx * s + ux * dot * (1 - c);
    const y = M.y * c + cy * s + uy * dot * (1 - c);
    const z = M.z * c + cz * s + uz * dot * (1 - c);
    M.x = x;
    M.y = y;
    M.z = z;
}

/**
 * Module E physics, solved in the frame rotating at ω_RF:
 * during the pulse M rotates about B_eff = (ω1, 0, ω0 − ω_RF); afterwards it
 * precesses at ω0 − ω_RF (zero on resonance) while T2 and T1 relax it.
 * Relaxation is ignored during the pulse (real pulse ≪ T1, T2).
 */
function stepModuleE(dt) {
    if (rfPhase === 'idle') return;

    const { omega1, omega0, omegaRF } = rfRates();
    const wz = omega0 - omegaRF;
    const tStart = CONFIG.currentTime - dt;
    const pulseDt = rfPhase === 'pulse' ? Math.max(0, Math.min(dt, RF_VIS.pulseDuration - tStart)) : 0;

    if (pulseDt > 0) {
        rotateAboutAxis(rfM, omega1, 0, wz, pulseDt);
    }
    if (rfPhase === 'pulse' && CONFIG.currentTime >= RF_VIS.pulseDuration) {
        rfPhase = 'free';
        const mag = Math.sqrt(rfM.x * rfM.x + rfM.y * rfM.y + rfM.z * rfM.z);
        rfTipAngle = Math.acos(Math.max(-1, Math.min(1, rfM.z / mag))) * 180 / Math.PI;
        updateRFReadouts();
    }

    const freeDt = dt - pulseDt;
    if (freeDt > 0) {
        rotateAboutAxis(rfM, 0, 0, wz, freeDt);
        const E2 = Math.exp(-freeDt / RF_VIS.T2);
        const E1 = Math.exp(-freeDt / RF_VIS.T1);
        rfM.x *= E2;
        rfM.y *= E2;
        rfM.z = 1 + (rfM.z - 1) * E1;
    }

    rfTrail.push({ t: CONFIG.currentTime, x: rfM.x, y: rfM.y, z: rfM.z });
    if (rfTrail.length > RF_VIS.maxTrail) rfTrail.shift();
}

/** Point p = {t, x, y, z} (rotating frame) in the currently viewed frame */
function rfDisplayVector(p) {
    if (CONFIG.frameE !== 'lab') return new THREE.Vector3(p.x, p.y, p.z);
    const [x, y] = rotatingToLab(p.x, p.y, p.t);
    return new THREE.Vector3(x, y, p.z);
}

function setArrowVector(arrow, vec, headLength = 0.12, headWidth = 0.06) {
    const length = vec.length();
    if (length > 0.02) {
        arrow.setDirection(vec.clone().normalize());
        arrow.setLength(Math.min(length, 1.0), headLength, headWidth);
        arrow.visible = true;
    } else {
        arrow.visible = false;
    }
}

function updateRFVisuals() {
    if (!sumArrow) return;
    const t = CONFIG.currentTime;
    const M = rfDisplayVector({ t, x: rfM.x, y: rfM.y, z: rfM.z });

    setArrowVector(sumArrow, M);
    setArrowVector(mxyArrow, new THREE.Vector3(M.x, M.y, 0));
    setArrowVector(mzArrow, new THREE.Vector3(0, 0, M.z));

    // B1 is static along x' in the rotating frame and turns at ω_RF in the lab
    if (rfPhase === 'pulse') {
        b1Arrow.setDirection(rfDisplayVector({ t, x: 1, y: 0, z: 0 }).normalize());
        b1Arrow.visible = true;
    } else {
        b1Arrow.visible = false;
    }

    // Path traced by the tip of M, fading toward older points
    const positions = rfTrailLine.geometry.attributes.position.array;
    const colors = rfTrailLine.geometry.attributes.color.array;
    const n = rfTrail.length;
    rfTrail.forEach((p, i) => {
        const v = rfDisplayVector(p);
        const fade = 0.15 + 0.85 * (i / Math.max(1, n - 1));
        positions[3 * i] = v.x;
        positions[3 * i + 1] = v.y;
        positions[3 * i + 2] = v.z;
        colors[3 * i] = 0.957 * fade;
        colors[3 * i + 1] = 0.447 * fade;
        colors[3 * i + 2] = 0.714 * fade;
    });
    rfTrailLine.geometry.setDrawRange(0, n);
    rfTrailLine.geometry.attributes.position.needsUpdate = true;
    rfTrailLine.geometry.attributes.color.needsUpdate = true;
}

function updateRFReadouts() {
    const alpha = CONFIG.flipAngleE * Math.PI / 180;
    // α = γ·B1·τ  →  B1 = α / (γ τ), for a 1 ms pulse
    const b1 = alpha / (GAMMA_RAD * RF_VIS.realPulseMs / 1000);
    const f1 = alpha / (2 * Math.PI * RF_VIS.realPulseMs / 1000);
    document.getElementById('b1-val').textContent = `${(b1 * 1e6).toFixed(1)} µT (γB₁/2π = ${f1.toFixed(0)} Hz)`;
    document.getElementById('b0-val-E-inline').textContent = CONFIG.B0;
    document.getElementById('tip-angle-val').textContent = rfTipAngle === null ? '--' : `${rfTipAngle.toFixed(0)}°`;
}

function resetRF() {
    rfM = { x: 0, y: 0, z: 1 };
    rfPhase = 'idle';
    rfTrail = [];
    rfTipAngle = null;
    updateRFReadouts();
    if (CONFIG.currentModule === 'E') updateRFVisuals();
}

function runRFSequence() {
    resetSimulation();
    rfPhase = 'pulse';
    CONFIG.maxTime = RF_VIS.pulseDuration + RF_VIS.freeDuration;
    CONFIG.playbackRate = RF_VIS.playbackRate;
    setChartWindow(CONFIG.maxTime, CONFIG.flipAngleE > 90 ? -1.1 : -0.1, 'Display time (precession & relaxation slowed)');
    addEventMarker(0, 'rf90', 'RF on');
    addEventMarker(RF_VIS.pulseDuration, 'rf90', 'RF off');
    CONFIG.isPlaying = true;
}

/**
 * Calculate Ernst angle: optimal flip angle for maximum signal in spoiled GRE
 * α_Ernst = arccos(exp(-TR/T1))
 */
function calculateErnstAngle(TR, T1) {
    const E1 = Math.exp(-TR / T1);
    const ernstRad = Math.acos(E1);
    return ernstRad * 180 / Math.PI;
}

/**
 * Calculate theoretical steady-state signal for spoiled GRE
 * S = M0 * sin(α) * (1 - E1) / (1 - cos(α) * E1)
 * where E1 = exp(-TR/T1)
 */
function calculateSpoiledGRESignal(flipAngleDeg, TR, T1) {
    const alpha = flipAngleDeg * Math.PI / 180;
    const E1 = Math.exp(-TR / T1);
    const signal = Math.sin(alpha) * (1 - E1) / (1 - Math.cos(alpha) * E1);
    return signal;
}

/**
 * Calculate theoretical steady-state signal for SSFP (bSSFP), on resonance
 * with the RF phase alternated each TR, right after each α pulse
 * (where the simulated |Mxy| peaks and the dashed line is drawn):
 * S = M0 * sin(α)(1 - E1) / (1 - (E1 - E2)cos(α) - E1·E2)
 * For TR ≪ T1, T2 this tends to sin(α) / (1 + cos(α) + (1 - cos(α)) * T1/T2)
 */
function calculateSSFPSignal(flipAngleDeg, TR, T1, T2) {
    const alpha = flipAngleDeg * Math.PI / 180;
    const E1 = Math.exp(-TR / T1);
    const E2 = Math.exp(-TR / T2);
    const signal = Math.sin(alpha) * (1 - E1) / (1 - (E1 - E2) * Math.cos(alpha) - E1 * E2);
    return signal;
}

/**
 * Update the Ernst angle and steady-state signal displays
 */
function updateErnstAngleDisplay() {
    const ernst = calculateErnstAngle(CONFIG.TR, CONFIG.T1D);
    document.getElementById('ernst-angle-val').textContent = ernst.toFixed(1) + '°';
}

/**
 * Update steady-state signal display after sequence completes
 */
function updateSteadyStateDisplay() {
    let signal;
    if (CONFIG.greType === 'spoiled') {
        signal = calculateSpoiledGRESignal(CONFIG.flipAngleD, CONFIG.TR, CONFIG.T1D);
    } else {
        signal = calculateSSFPSignal(CONFIG.flipAngleD, CONFIG.TR, CONFIG.T1D, CONFIG.T2D);
    }
    document.getElementById('steady-state-val').textContent = (signal * 100).toFixed(1) + '%';
}

/**
 * Run the GRE multi-TR sequence
 */
function runGRESequence() {
    resetSimulation();

    // Create ensemble with minimal frequency spread (on-resonance for SSFP:
    // 1 Hz keeps the off-resonance phase per TR small, so the ensemble matches
    // the on-resonance steady state; 5 Hz gave ~4% less at the defaults)
    // Use small spread for spoiled GRE to show T2* effects
    const freqSpread = CONFIG.greType === 'ssfp' ? 1 : 20;
    ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1D, CONFIG.T2D, freqSpread, CONFIG.B0);
    createEnsembleArrows();

    // Initialize state
    greSequenceState = 'running';
    currentTRIndex = 0;
    timeInTR = 0;
    steadyStateMxy = [];
    steadyStateMz = [];

    // Apply initial RF pulse
    ensemble.applyRFPulse(CONFIG.flipAngleD, 0);
    addEventMarker(0, 'rf90', 'α1');

    // Set max time based on number of TRs
    CONFIG.maxTime = CONFIG.TR * CONFIG.numTR + 50;
    CONFIG.playbackRate = CONFIG.maxTime / RUN_PLAYBACK_SECONDS;
    setChartWindow(CONFIG.maxTime);

    // Dashed target: theoretical steady-state signal right after each α pulse
    if (CONFIG.greType === 'spoiled') {
        const Sss = calculateSpoiledGRESignal(CONFIG.flipAngleD, CONFIG.TR, CONFIG.T1D);
        const E1 = Math.exp(-CONFIG.TR / CONFIG.T1D);
        const MzSS = (1 - E1) / (1 - Math.cos(CONFIG.flipAngleD * Math.PI / 180) * E1);
        theory.mxy = sampleCurve(() => Sss, CONFIG.maxTime, 2);
        theory.mxyLabel = `Steady state after α (${(Sss * 100).toFixed(1)}%)`;
        theory.mz = sampleCurve(() => MzSS, CONFIG.maxTime, 2);
        theory.mzLabel = 'Steady-state Mz before α';
    } else {
        const Sss = calculateSSFPSignal(CONFIG.flipAngleD, CONFIG.TR, CONFIG.T1D, CONFIG.T2D);
        theory.mxy = sampleCurve(() => Sss, CONFIG.maxTime, 2);
        theory.mxyLabel = `bSSFP steady state, on resonance (${(Sss * 100).toFixed(1)}%)`;
    }

    // Update displays
    updateErnstAngleDisplay();

    CONFIG.isPlaying = true;
}

function updateVectorDisplay(spin) {
    // Avoid showing "-0.00" for tiny negative values
    const fmt = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
    document.getElementById('Mx-val').textContent = fmt(spin.Mx);
    document.getElementById('My-val').textContent = fmt(spin.My);
    document.getElementById('Mz-val').textContent = fmt(spin.Mz);
}

/**
 * Modules B, C and D share one spin count (CONFIG.numSpins): keep the
 * Module B and Module C sliders and labels showing the value actually used
 */
function setNumSpins(numSpins) {
    CONFIG.numSpins = numSpins;
    ['num-spins', 'num-spins-C'].forEach(id => {
        document.getElementById(id).value = numSpins;
        document.getElementById(`${id}-val`).textContent = numSpins + ' spins';
    });
}

// ============================================================================
// MODULE SWITCHING
// ============================================================================

function switchModule(module) {
    CONFIG.currentModule = module;

    // Update tab UI
    document.querySelectorAll('.module-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.module === module);
    });

    // Show/hide controls
    document.querySelectorAll('.module-controls').forEach(ctrl => {
        ctrl.style.display = 'none';
    });
    document.getElementById(`controls-${module}`).style.display = 'block';

    // Sync checkbox states across modules
    const showIndividualB = document.getElementById('show-individual');
    const showIndividualC = document.getElementById('show-individual-C');
    const showIndividualD = document.getElementById('show-individual-D');
    if (showIndividualB) showIndividualB.checked = CONFIG.showIndividual;
    if (showIndividualC) showIndividualC.checked = CONFIG.showIndividual;
    if (showIndividualD) showIndividualD.checked = CONFIG.showIndividual;

    // Update info panel
    updateInfoPanel(module);

    // Reset and setup for module
    resetSimulation();

    // Setup 3D view for module
    rfTrailLine.visible = module === 'E';
    b1Arrow.visible = false;
    if (module === 'A') {
        // Initialize Module A alignment ensemble
        initModuleA();
        // Hide Module B/C/D ensemble arrows
        spinArrows.forEach(a => a.visible = false);
        if (sumArrow) sumArrow.visible = false;
        if (mxyArrow) mxyArrow.visible = false;
        if (mzArrow) mzArrow.visible = false;
    } else {
        // Hide Module A arrows
        alignmentArrows.forEach(a => a.visible = false);
        if (netMagArrowA) netMagArrowA.visible = false;
        // Show ensemble with component arrows
        createEnsembleArrows();

        // Module D specific initialization
        if (module === 'D') {
            updateErnstAngleDisplay();
            document.getElementById('steady-state-val').textContent = '--';
        }

        // Module E shows a single magnetization vector instead of the ensemble
        if (module === 'E') {
            spinArrows.forEach(a => a.visible = false);
            updateRFVisuals();
        }
    }
    updateFrameDisplay();

    // Update signal panel glow for Module B/C/D
    updateSignalPanelGlow(0);
}

/**
 * Axis labels, view label, spin legend and signal badge for the current
 * module: Module A (precession on) and Module E (lab view) are drawn in the
 * laboratory frame, everything else in the rotating frame.
 */
function updateFrameDisplay() {
    const module = CONFIG.currentModule;
    const legendText = document.getElementById('spin-legend-text');
    const legendNote = document.getElementById('spin-legend-note');
    const legendDot = document.querySelector('.spin-color-dot');
    const badge = document.getElementById('signal-frame-badge');
    // Module E shows a single vector, so there is no individual-spin legend row
    legendText.closest('.legend-row').style.display = module === 'E' ? 'none' : '';

    if (module === 'A') {
        if (CONFIG.showPrecessionA) {
            setAxisFrame('lab', 'Lab Frame: B₀ only (slowed ~10⁸×)');
        } else {
            setAxisFrame('rot');
        }
        legendText.textContent = 'Spin packets';
        legendNote.textContent = 'each = many protons; equal length = direction only';
        legendDot.style.background = '#10b981';
        badge.textContent = 'no RF → no signal';
    } else if (module === 'E') {
        setAxisFrame(CONFIG.frameE === 'lab' ? 'lab' : 'rot',
            CONFIG.frameE === 'lab' ? 'Lab Frame (slowed ~10⁷×)' : 'Rotating Frame (at ω_RF)');
        badge.textContent = CONFIG.frameE === 'lab' ? 'lab frame: coil voltage at ω₀' : 'rotating frame: demodulated';
    } else {
        setAxisFrame('rot');
        legendText.textContent = 'Spin packets (blue slow → red fast)';
        legendNote.textContent = 'speed vs the rotating frame (ω₀); equal length = direction only';
        legendDot.style.background = '';
        badge.textContent = 'rotating frame';
    }
}

/**
 * Initialize Module A: B0 Alignment Animation
 * Creates ensemble with random orientations to visualize effect of B0 turning on
 */
function initModuleA() {
    const numSpins = parseInt(document.getElementById('num-spins-A').value);
    const T1 = CONFIG.T1;
    const T2 = CONFIG.T2;

    // Create alignment ensemble
    alignmentEnsemble = new SpinEnsemble(numSpins, T1, T2, 0, CONFIG.B0);

    // Randomize spin orientations (B0 OFF state)
    alignmentEnsemble.randomizeOrientations(CONFIG.alignModel);
    b0IsOn = false;

    // Create 3D arrows
    createAlignmentArrows(numSpins);

    // Sync arrow directions with ensemble
    alignmentEnsemble.spins.forEach((spin, i) => {
        if (alignmentArrows[i]) {
            const dir = new THREE.Vector3(spin.Mx, spin.My, spin.Mz);
            alignmentArrows[i].setDirection(dir.normalize());
        }
    });

    // Update UI
    updateAlignmentReadouts();
}

/** Real thermal polarization (N↑ − N↓)/N ≈ γħB0 / 2kT, in parts per million */
function updatePolarizationNote() {
    const ppm = GAMMA_RAD * HBAR * CONFIG.B0 / (2 * K_BOLTZMANN * BODY_TEMP) * 1e6;
    document.getElementById('polarization-note').textContent =
        `Real spin excess at ${CONFIG.B0} T ≈ ${ppm.toFixed(1)} per million (310 K, ∝ B₀) - exaggerated here; plots normalized to M₀ = 1`;
}

function updateInfoPanel(module) {
    const infoTitle = document.querySelector('#info-panel h4');
    const infoText = document.getElementById('info-text');

    switch (module) {
        case 'A':
            infoTitle.textContent = 'Module A: B₀ Alignment';
            infoText.innerHTML = `
                <strong>Arrows:</strong> thin green = spin packets (each the magnetization of many protons, drawn at equal length: direction only); thick white M = their sum, length |M|/M₀.<br>
                <strong>Without B₀:</strong> Spins point in random directions. Net M = 0.<br>
                <strong>With B₀:</strong> Every spin precesses about B₀ at ω₀ = γB₀ (faster at higher B₀), and T1 relaxation slowly biases them toward +z. Net M grows along +z: M<sub>z</sub>(t) = M₀(1 - e<sup>-t/T1</sup>), 63% at t = T1.<br>
                <strong>No signal yet:</strong> the spins' azimuths are random, so there is no net M<sub>xy</sub> - an RF pulse is needed (Module E, B).<br>
                <strong>Alignment picture:</strong> "Simplified" lets every spin align; "Boltzmann" is closer to reality - spins stay spread and only a slight excess points up (real excess: a few per million, exaggerated here).
            `;
            break;
        case 'B':
            infoTitle.textContent = 'Module B: FID & Signal Detection';
            infoText.innerHTML = `
                <strong>Arrows:</strong> thin = spin packets (direction only), thick = their sum: M (white) and its parts M<sub>xy</sub> (cyan, in the xy plane) and M<sub>z</sub> (blue, along z).<br>
                <strong>Dephasing:</strong> Spins precess at ω₀ + Δω (field inhomogeneity). The view rotates at ω₀, so colors show speed relative to it: red spins run ahead, blue lag behind → phases fan out → destructive interference → FID decay.<br>
                <strong>Signal:</strong> In lab frame, rotating Mxy induces EMF ∝ ω₀|Mxy|. Signal panel glows with signal strength.<br>
                <strong>T2* decay:</strong> Mxy(t) = M₀ sin α·e<sup>-t/T2*</sup> with 1/T2* = 1/T2 + 1/T2′ (dashed curves). Length of the cyan M<sub>xy</sub> arrow = signal envelope.<br>
                <em style="color: #f59e0b;">Tip: use the "Top" view to watch the spins spread around the xy plane like runners on a track.</em>
            `;
            break;
        case 'C':
            infoTitle.textContent = 'Module C: Echo Formation';
            infoText.innerHTML = `
                <strong>Arrows:</strong> thin = spin packets (blue slower, red faster than ω₀), thick = their sum M, M<sub>xy</sub> (cyan) and M<sub>z</sub> (blue).<br>
                <strong>Spin Echo:</strong> 180° pulse inverts phases → the fast (red) spins are now behind and catch up → echo at TE. Refocuses B₀ inhomogeneity: echo peak on the T2 envelope.<br>
                <strong>Gradient Echo:</strong> Gradient reversal → rephasing → echo. Does NOT refocus B₀: echo peak on the T2* envelope.<br>
                <strong>Signal:</strong> Watch the Signal/FID panel glow brighten at echo! The 180° also inverts M<sub>z</sub> (Mz panel).<br>
                <em style="color: #f59e0b;">Tip: "Top" view shows the racetrack picture of the echo.</em>
            `;
            break;
        case 'D':
            infoTitle.textContent = 'Module D: GRE Variants';
            infoText.innerHTML = `
                <strong>Arrows:</strong> thin = spin packets, thick = their sum M, M<sub>xy</sub> (cyan, sampled as signal) and M<sub>z</sub> (blue, what the next α tips).<br>
                <strong>Spoiled GRE (SPGR/FLASH):</strong> Mxy destroyed each TR → only T1 recovery matters → <strong>T1-weighted</strong>.<br>
                <strong>SSFP (bSSFP/TrueFISP):</strong> Mxy preserved → builds to steady-state → <strong>T2/T1-weighted</strong> (bright fluid).<br>
                <strong>Ernst Angle:</strong> α<sub>E</sub> = arccos(e<sup>-TR/T1</sup>) gives maximum signal for spoiled GRE.<br>
                <em style="color: #f59e0b;">Watch Mxy and Mz approach the dashed steady-state lines over multiple TRs.</em>
            `;
            break;
        case 'E':
            infoTitle.textContent = 'Module E: RF Excitation & Frames';
            infoText.innerHTML = `
                <strong>Lab frame:</strong> M precesses about B₀ at ω₀ = γB₀ (63.9 MHz at 1.5 T). The RF field B₁ rotates at ω<sub>RF</sub>; on resonance it pushes M down a spiral. The coil voltage oscillates at ω₀.<br>
                <strong>Rotating frame:</strong> Rotate with B₁ and both the precession and the oscillation disappear: B₁ looks static and simply tips M by α = γB₁τ - the view used in Modules B-D. The demodulated signal is the slow envelope.<br>
                <strong>Resonance:</strong> Set an RF mismatch comparable to γB₁/2π or larger: B₁ no longer keeps pace, M tips about a tilted effective field and falls short of the xy plane - only spins near the RF frequency are excited (the basis of slice selection).<br>
                <em style="color: #f59e0b;">Precession and relaxation are slowed for display; B₁ is µT while B₀ is T.</em>
            `;
            break;
    }

    // Re-render MathJax
    if (window.MathJax) {
        MathJax.typesetPromise([infoText]);
    }
}

// ============================================================================
// CONTROL HANDLERS
// ============================================================================

function setupEventListeners() {
    // Animation controls
    document.getElementById('btn-play').addEventListener('click', () => {
        CONFIG.isPlaying = true;
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
        CONFIG.isPlaying = false;
    });

    document.getElementById('btn-reset').addEventListener('click', resetSimulation);

    document.getElementById('speed-slider').addEventListener('input', (e) => {
        CONFIG.animationSpeed = parseFloat(e.target.value);
        document.getElementById('speed-val').textContent = CONFIG.animationSpeed.toFixed(1) + 'x';
    });

    // Module tabs
    document.querySelectorAll('.module-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchModule(tab.dataset.module);
        });
    });

    // Module A controls
    document.getElementById('num-spins-A').addEventListener('input', (e) => {
        const numSpins = parseInt(e.target.value);
        document.getElementById('num-spins-A-val').textContent = numSpins + ' spins';
    });

    document.getElementById('num-spins-A').addEventListener('change', () => {
        if (CONFIG.currentModule === 'A') {
            // New spins: stop the run and clear its curves, as for a new picture
            resetSimulation();
            initModuleA();
        }
    });

    document.getElementById('T1-val').addEventListener('input', (e) => {
        CONFIG.T1 = parseInt(e.target.value);
        document.getElementById('T1-display').textContent = CONFIG.T1 + ' ms';
        if (alignmentEnsemble) {
            alignmentEnsemble.setT1(CONFIG.T1);
        }
        // A run (and its 5·T1 window and theory) belongs to the old T1: start over
        if (CONFIG.currentModule === 'A' && b0IsOn) {
            resetSimulation();
            initModuleA();
        }
    });

    // B0 sliders (Module A and E share one value)
    const onB0Input = (e) => {
        CONFIG.B0 = parseFloat(e.target.value);
        const freq = (GAMMA * CONFIG.B0).toFixed(1);
        document.getElementById('B0-val').value = CONFIG.B0;
        document.getElementById('B0-val-E').value = CONFIG.B0;
        document.getElementById('B0-display').textContent = `${CONFIG.B0} T (${freq} MHz)`;
        document.getElementById('B0-display-E').textContent = `${CONFIG.B0} T → f₀ = ${freq} MHz`;
        // NOTE: In the rotating frame at ω₀ = γB₀ the main field drops out of
        // Modules B-D; what matters there is the off-resonance (ΔB₀ spread).
        // B0 sets the displayed precession speed (Modules A, E) and the
        // real thermal polarization quoted in Module A.
        updatePolarizationNote();
        updateRFReadouts();
        if (alignmentEnsemble) {
            alignmentEnsemble.setB0(CONFIG.B0);
        }
        ensemble.setB0(CONFIG.B0);
    };
    document.getElementById('B0-val').addEventListener('input', onB0Input);
    document.getElementById('B0-val-E').addEventListener('input', onB0Input);

    document.getElementById('align-model').addEventListener('change', (e) => {
        CONFIG.alignModel = e.target.value;
        if (CONFIG.currentModule === 'A') {
            resetSimulation();
            initModuleA();
        }
    });

    document.getElementById('show-precession-A').addEventListener('change', (e) => {
        CONFIG.showPrecessionA = e.target.checked;
        if (CONFIG.currentModule === 'A') updateFrameDisplay();
    });

    document.getElementById('btn-b0-on').addEventListener('click', () => {
        if (!alignmentEnsemble) {
            initModuleA();
        }
        // Turn B0 ON - starts alignment animation
        b0IsOn = true;
        CONFIG.isPlaying = true;
        clearChartData();
        CONFIG.currentTime = 0;

        // Window of 5·T1 played in ~12 s; theory starts from the current Mz
        CONFIG.maxTime = 5 * CONFIG.T1;
        CONFIG.playbackRate = CONFIG.maxTime / 12;
        setChartWindow(CONFIG.maxTime);
        const sum = alignmentEnsemble.getSumMagnetization();
        alignmentStartMz = sum.Mz / (alignmentEnsemble.M0 || 1);
        setAlignmentTheory();
    });

    document.getElementById('btn-b0-off').addEventListener('click', () => {
        // Turn B0 OFF - randomize spins
        b0IsOn = false;
        CONFIG.isPlaying = false;
        CONFIG.currentTime = 0;
        clearChartData();

        if (alignmentEnsemble) {
            alignmentEnsemble.randomizeOrientations(CONFIG.alignModel);

            // Sync arrow directions with ensemble
            updateAlignmentArrows();
            updateAlignmentReadouts();

            if (netMagArrowA) netMagArrowA.visible = false;
        }
    });

    // Module B controls
    document.getElementById('num-spins').addEventListener('input', (e) => {
        setNumSpins(parseInt(e.target.value));
    });

    document.getElementById('num-spins').addEventListener('change', () => {
        ensemble = createFIDEnsemble();
        if (CONFIG.currentModule === 'B') createEnsembleArrows();
    });

    document.getElementById('freq-spread').addEventListener('input', (e) => {
        CONFIG.freqSpread = parseInt(e.target.value);
        document.getElementById('freq-spread-val').textContent = CONFIG.freqSpread + ' Hz';
        updateT2starBDisplay();
    });

    document.getElementById('freq-spread').addEventListener('change', () => {
        ensemble = createFIDEnsemble();
        if (CONFIG.currentModule === 'B') createEnsembleArrows();
    });

    document.getElementById('T2-ensemble').addEventListener('input', (e) => {
        CONFIG.T2ensemble = parseInt(e.target.value);
        document.getElementById('T2-ensemble-val').textContent = CONFIG.T2ensemble + ' ms';
        // FIX: Update T2 for all spins in the ensemble
        ensemble.setT2(CONFIG.T2ensemble);
        updateT2starBDisplay();
    });

    // Module B flip angle control
    document.getElementById('flip-angle').addEventListener('input', (e) => {
        CONFIG.flipAngle = parseInt(e.target.value);
        document.getElementById('flip-angle-val').textContent = CONFIG.flipAngle + '°';
    });

    document.getElementById('btn-excite').addEventListener('click', () => {
        resetSimulation();
        // Modules C and D replace the shared ensemble: rebuild Module B's own
        // (Lorentzian Δf, T2, spin count) so it matches the T2* readout and theory
        ensemble = createFIDEnsemble();
        createEnsembleArrows();
        ensemble.applyRFPulse(CONFIG.flipAngle, 0);
        setFIDTheory();
        updateEnsembleArrows();
        CONFIG.isPlaying = true;
    });

    document.getElementById('show-individual').addEventListener('change', (e) => {
        CONFIG.showIndividual = e.target.checked;
        spinArrows.forEach(a => a.visible = CONFIG.showIndividual);
    });

    // Module C controls
    document.getElementById('echo-type').addEventListener('change', (e) => {
        CONFIG.echoType = e.target.value;
    });

    document.getElementById('TE-val').addEventListener('input', (e) => {
        CONFIG.TE = parseInt(e.target.value);
        document.getElementById('TE-display').textContent = CONFIG.TE + ' ms';
    });

    document.getElementById('T2-echo').addEventListener('input', (e) => {
        CONFIG.T2echo = parseInt(e.target.value);
        document.getElementById('T2-echo-val').textContent = CONFIG.T2echo + ' ms';
    });

    document.getElementById('T2star-echo').addEventListener('input', (e) => {
        CONFIG.T2starEcho = parseInt(e.target.value);
        document.getElementById('T2star-echo-val').textContent = CONFIG.T2starEcho + ' ms';
        updateT2starEchoNote();
    });

    document.getElementById('T2-echo').addEventListener('input', updateT2starEchoNote);

    document.getElementById('num-spins-C').addEventListener('input', (e) => {
        setNumSpins(parseInt(e.target.value));
    });

    document.getElementById('btn-run-sequence').addEventListener('click', runEchoSequence);

    document.getElementById('show-individual-C').addEventListener('change', (e) => {
        CONFIG.showIndividual = e.target.checked;
        spinArrows.forEach(a => a.visible = CONFIG.showIndividual);
    });

    // Module D controls
    document.getElementById('gre-type').addEventListener('change', (e) => {
        CONFIG.greType = e.target.value;
        updateErnstAngleDisplay();
    });

    document.getElementById('flip-angle-D').addEventListener('input', (e) => {
        CONFIG.flipAngleD = parseInt(e.target.value);
        document.getElementById('flip-angle-D-val').textContent = CONFIG.flipAngleD + '°';
    });

    document.getElementById('TR-val').addEventListener('input', (e) => {
        CONFIG.TR = parseInt(e.target.value);
        document.getElementById('TR-display').textContent = CONFIG.TR + ' ms';
        updateErnstAngleDisplay();
    });

    document.getElementById('T1-D').addEventListener('input', (e) => {
        CONFIG.T1D = parseInt(e.target.value);
        document.getElementById('T1-D-val').textContent = CONFIG.T1D + ' ms';
        updateErnstAngleDisplay();
    });

    document.getElementById('T2-D').addEventListener('input', (e) => {
        CONFIG.T2D = parseInt(e.target.value);
        document.getElementById('T2-D-val').textContent = CONFIG.T2D + ' ms';
    });

    document.getElementById('num-TR').addEventListener('input', (e) => {
        CONFIG.numTR = parseInt(e.target.value);
        document.getElementById('num-TR-val').textContent = CONFIG.numTR + ' TRs';
    });

    document.getElementById('btn-run-gre').addEventListener('click', runGRESequence);

    document.getElementById('show-individual-D').addEventListener('change', (e) => {
        CONFIG.showIndividual = e.target.checked;
        spinArrows.forEach(a => a.visible = CONFIG.showIndividual);
    });

    // Module E controls
    document.getElementById('frame-E').addEventListener('change', (e) => {
        CONFIG.frameE = e.target.value;
        updateFrameDisplay();
        updateRFVisuals();
        updateCharts();
    });

    document.getElementById('flip-angle-E').addEventListener('input', (e) => {
        CONFIG.flipAngleE = parseInt(e.target.value);
        document.getElementById('flip-angle-E-val').textContent = CONFIG.flipAngleE + '°';
        updateRFReadouts();
    });

    document.getElementById('rf-offset-E').addEventListener('input', (e) => {
        CONFIG.rfOffsetE = parseInt(e.target.value);
        const sign = CONFIG.rfOffsetE > 0 ? '+' : '';
        document.getElementById('rf-offset-E-val').textContent = CONFIG.rfOffsetE === 0
            ? '0 Hz (on resonance)'
            : `${sign}${CONFIG.rfOffsetE} Hz (off resonance)`;
    });

    document.getElementById('btn-run-rf').addEventListener('click', runRFSequence);

    // 3D view presets
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => setCameraView(btn.dataset.view));
    });
}

// ============================================================================
// THEORY OVERLAYS (dashed textbook curves)
// ============================================================================

let alignmentStartMz = 0;  // Normalized Mz when B0 was switched on

function setAlignmentTheory() {
    const T1 = CONFIG.T1;
    const m0 = alignmentStartMz;
    theory = emptyTheory();
    theory.mz = sampleCurve(t => 1 - (1 - m0) * Math.exp(-t / T1), CONFIG.maxTime);
    theory.mzLabel = `M₀(1 − e^(−t/T1)), T1 = ${T1} ms`;
    theory.markers.mz = [{ x: T1, y: 1 - (1 - m0) / Math.E, label: '63% at T1', color: '#f59e0b' }];
}

/** Effective T2* for Module B: 1/T2* = 1/T2 + 2π·Δf (Lorentzian half-width Δf) */
function fidT2star() {
    return 1 / (1 / CONFIG.T2ensemble + 2 * Math.PI * CONFIG.freqSpread / 1000);
}

function updateT2starBDisplay() {
    document.getElementById('T2star-B-val').textContent = fidT2star().toFixed(0);
}

function setFIDTheory() {
    const alpha = CONFIG.flipAngle * Math.PI / 180;
    const s = Math.abs(Math.sin(alpha));
    const c = Math.cos(alpha);
    const T1 = CONFIG.T1;
    const T2 = CONFIG.T2ensemble;
    const T2star = fidT2star();

    // Window of 5·T2 (≥ 300 ms): the FID (first 4·T2*) plays in slow motion
    // over ~4 s so the spins can be seen fanning out, the rest in ~6 s
    CONFIG.maxTime = Math.max(5 * T2, 300);
    CONFIG.slowUntil = Math.min(4 * T2star, CONFIG.maxTime);
    CONFIG.slowRate = CONFIG.slowUntil / 4;
    CONFIG.playbackRate = Math.max(CONFIG.maxTime - CONFIG.slowUntil, 1) / 6;
    setChartWindow(CONFIG.maxTime, c < -0.05 ? -1.1 : -0.1);

    theory = emptyTheory();
    theory.mxy = sampleCurve(t => s * Math.exp(-t / T2), CONFIG.maxTime);
    theory.mxyLabel = `sin α·e^(−t/T2), T2 = ${T2} ms`;
    theory.mxy2 = sampleCurve(t => s * Math.exp(-t / T2star), CONFIG.maxTime);
    theory.mxy2Label = `sin α·e^(−t/T2*), T2* = ${T2star.toFixed(0)} ms`;
    theory.mz = sampleCurve(t => 1 - (1 - c) * Math.exp(-t / T1), CONFIG.maxTime);
    theory.mzLabel = `1 − (1 − cos α)e^(−t/T1), T1 = ${T1} ms`;
    theory.markers.mxy = [
        { x: T2star, y: s / Math.E, label: 'T2*', color: '#f59e0b' },
        { x: T2, y: s / Math.E, label: 'T2', color: '#94a3b8' }
    ];
    theory.markers.mz = [{ x: T1, y: 1 - (1 - c) / Math.E, label: 'T1', color: '#94a3b8' }];
}

function updateT2starEchoNote() {
    const note = document.getElementById('T2star-echo-note');
    if (CONFIG.T2starEcho >= CONFIG.T2echo) {
        note.innerHTML = 'T2* cannot exceed T2 (1/T2* = 1/T2 + 1/T2′): using T2* = T2, i.e. a perfectly uniform B₀';
    } else {
        note.innerHTML = 'Same tissue for both echoes: SE echo follows e<sup>-t/T2</sup>, GRE echo follows e<sup>-t/T2*</sup>';
    }
}

function setEchoTheory(T2, T2star) {
    const T1 = CONFIG.T1;
    const halfTE = CONFIG.TE / 2;
    const spinEcho = CONFIG.echoType === 'spin';
    const mzBefore180 = 1 - Math.exp(-halfTE / T1);

    theory = emptyTheory();
    theory.mxy = sampleCurve(t => Math.exp(-t / T2), CONFIG.maxTime);
    theory.mxyLabel = `e^(−t/T2): SE echo peak, T2 = ${T2} ms`;
    theory.mxy2 = sampleCurve(t => Math.exp(-t / T2star), CONFIG.maxTime);
    theory.mxy2Label = `e^(−t/T2*): GRE echo peak, T2* = ${T2star} ms`;
    // The 180° pulse also inverts Mz, which then recovers with T1
    theory.mz = sampleCurve(t => {
        if (!spinEcho || t < halfTE) return 1 - Math.exp(-t / T1);
        return 1 - (1 + mzBefore180) * Math.exp(-(t - halfTE) / T1);
    }, CONFIG.maxTime, 600);
    theory.mzLabel = spinEcho ? 'Mz theory (inverted by 180°)' : 'Mz theory';

    const echoPeak = spinEcho ? Math.exp(-CONFIG.TE / T2) : Math.exp(-CONFIG.TE / T2star);
    theory.markers.mxy = [{
        x: CONFIG.TE, y: echoPeak,
        label: `expected echo ${(echoPeak * 100).toFixed(0)}%`,
        color: spinEcho ? '#94a3b8' : '#f59e0b'
    }];
    return spinEcho ? Math.min(-0.1, Math.floor((-mzBefore180 - 0.1) * 10) / 10) : -0.1;
}

function resetSimulation() {
    CONFIG.isPlaying = false;
    CONFIG.currentTime = 0;
    lastTimestamp = 0;

    // FIX: Always restore maxTime to default
    CONFIG.maxTime = DEFAULT_MAX_TIME;
    CONFIG.playbackRate = DEFAULT_MAX_TIME / RUN_PLAYBACK_SECONDS;
    CONFIG.slowUntil = 0;
    theory = emptyTheory();
    setChartWindow(DEFAULT_MAX_TIME);

    // Clear data
    clearChartData();

    // Reset spins
    ensemble.reset();

    // Reset echo state
    echoSequenceState = 'idle';
    echoSequenceTime = 0;
    gradientFlipped = false;

    // Reset GRE multi-TR state
    greSequenceState = 'idle';
    currentTRIndex = 0;
    timeInTR = 0;
    steadyStateMxy = [];
    steadyStateMz = [];

    // Reset Module E (single vector back to equilibrium)
    resetRF();

    // Reset B0 state for Module A
    b0IsOn = false;

    // Update UI
    document.getElementById('time-val').textContent = '0.00 ms';

    if (CONFIG.currentModule === 'A') {
        // Module A resets are handled by initModuleA()
        // Don't auto-reinitialize here to preserve user's choice
        updateAlignmentReadouts();
    } else if (CONFIG.currentModule === 'E') {
        updateRFVisuals();
    } else {
        updateEnsembleArrows();
        document.getElementById('coherent-count').textContent = '0%';
    }
}

function runEchoSequence() {
    resetSimulation();

    // T2* determines the B0 inhomogeneity spread (the same tissue for SE and GRE):
    // 1/T2* = 1/T2 + 1/T2', and a Lorentzian of half-width Δf = 1/(2π·T2')
    // decays exactly as e^(-t/T2'). SE refocuses it (echo on the T2 envelope),
    // GRE does not (echo on the T2* envelope).
    const T2 = CONFIG.T2echo;
    const T2star = Math.min(CONFIG.T2starEcho, T2);
    const invT2prime = Math.max(0, 1 / T2star - 1 / T2) * 1000;  // 1/s
    const freqSpread = invT2prime / (2 * Math.PI);                // Hz

    ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, T2, freqSpread, CONFIG.B0, 'lorentzian');

    // Apply initial 90° pulse and add marker
    ensemble.applyRFPulse(90, 0);
    addEventMarker(0, 'rf90', '90°');

    // For Gradient Echo, apply gradient for controlled dephasing/rephasing
    // Gradient causes fast dephasing that IS refocused
    // B0 inhomogeneity causes slow decay that is NOT refocused
    if (CONFIG.echoType === 'gradient') {
        // Strong gradient (300 Hz spread) for rapid, complete dephasing: its
        // residual ripple (~1/(π·300 Hz·t)) stays well below the T2*-limited echo.
        // N evenly spaced spins rephase every (N−1)/spread, so for few spins the
        // spread is capped at (N−1)/TE: that false echo then falls beyond the
        // TE/2 of dephasing (100 spins always get the full 300 Hz)
        const gradSpread = Math.min(300, (CONFIG.numSpins - 1) / (CONFIG.TE / 1000));
        ensemble.applyGradientFixed(gradSpread);
    }
    // Arrows colored by total precession speed (B0 offset + gradient)
    createEnsembleArrows();

    // Add echo marker at TE
    addEventMarker(CONFIG.TE, 'echo', 'Echo');

    // Start sequence
    echoSequenceState = 'dephasing';
    echoSequenceTime = 0;
    gradientFlipped = false;
    CONFIG.isPlaying = true;

    // Set maxTime to show echo and more time after for longer observation
    // At least 3x TE or 300ms, whichever is larger
    CONFIG.maxTime = Math.max(CONFIG.TE * 3, 300);
    CONFIG.playbackRate = CONFIG.maxTime / RUN_PLAYBACK_SECONDS;
    setChartWindow(CONFIG.maxTime, setEchoTheory(T2, T2star));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    init3D();
    initCharts();
    setupEventListeners();

    updatePolarizationNote();
    updateT2starBDisplay();
    updateRFReadouts();

    // Start with Module A
    switchModule('A');

    // Start animation loop
    animate(0);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
