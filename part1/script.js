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
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const GAMMA = 42.577; // Gyromagnetic ratio for 1H (MHz/T)
const DEFAULT_MAX_TIME = 1500; // Default simulation duration (ms) - long enough to see T1 recovery

const CONFIG = {
    // Animation
    animationSpeed: 1.0,
    isPlaying: false,
    currentTime: 0,       // ms
    maxTime: DEFAULT_MAX_TIME,
    dt: 0.5,              // Time step (ms)

    // Module A: B0 Alignment
    // T1 = 500ms for educational demo (faster to observe recovery)
    // Real brain tissue: WM ~600-800ms, GM ~900-1200ms at 1.5T
    T1: 500,              // ms (shorter for faster demo)
    T2: 80,               // ms (used for transverse decay during alignment)
    B0: 1.5,              // Tesla

    // Module B: FID
    flipAngle: 90,        // degrees (moved from Module A)

    // Module B: Ensemble
    numSpins: 100,
    freqSpread: 30,       // Hz (determines T2*)
    T2ensemble: 100,      // ms (intrinsic T2)
    showIndividual: true,

    // Module C: Echo
    // Defaults for visible echo formation:
    // Spin Echo: 180° refocuses B0 inhomogeneity → echo at T2 envelope
    // Gradient Echo: gradient reversal does NOT refocus B0 → echo at T2* envelope
    // - TE = 60ms gives enough time to see dephasing and rephasing
    // - T2 = 200ms (long) so SE echo amplitude is high
    // - T2* = 30ms (short) so GRE echo is visibly lower than SE (T2* weighting)
    echoType: 'spin',     // 'spin' or 'gradient'
    TE: 60,               // ms
    T2echo: 200,          // ms (long T2 for strong SE echo)
    T2starEcho: 30,       // ms (short T2* - shows GRE vs SE difference)
    T2starEchoSE: 30,     // Saved T2* for Spin Echo
    T2starEchoGRE: 100,   // Saved T2* for Gradient Echo (longer for visible echo)

    // Module D: GRE Variants (Spoiled vs SSFP)
    // Multi-TR simulation to show steady-state magnetization
    greType: 'spoiled',   // 'spoiled' or 'ssfp'
    flipAngleD: 30,       // degrees
    TR: 25,               // ms (short TR typical for GRE)
    T1D: 600,             // ms (typical tissue T1)
    T2D: 80,              // ms (typical tissue T2)
    numTR: 8,             // Number of TR cycles to simulate

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
    constructor(numSpins, T1, T2, freqSpread, B0 = 1.5) {
        this.numSpins = numSpins;
        this.T1 = T1;
        this.T2 = T2;
        this.freqSpread = freqSpread;
        this.B0 = B0;
        this.spins = [];

        this.createSpins();
    }

    createSpins() {
        this.spins = [];
        for (let i = 0; i < this.numSpins; i++) {
            // Gaussian distribution of frequency offsets
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
            const deltaOmega = z * this.freqSpread;

            this.spins.push(new Spin(this.T1, this.T2, deltaOmega, this.B0));
        }
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
     * Each spin points in a random direction on the unit sphere
     */
    randomizeOrientations() {
        this.spins.forEach(spin => {
            // Random point on unit sphere using spherical coordinates
            const theta = Math.random() * 2 * Math.PI;  // azimuthal angle
            const phi = Math.acos(2 * Math.random() - 1);  // polar angle (uniform on sphere)

            spin.Mx = Math.sin(phi) * Math.cos(theta);
            spin.My = Math.sin(phi) * Math.sin(theta);
            spin.Mz = Math.cos(phi);
            spin.phase = theta;
        });
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
let ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2ensemble, CONFIG.freqSpread, CONFIG.B0);

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
let rfPhase = 0;               // RF phase for spoiling (changes each TR)
let steadyStateMxy = [];       // Store Mxy at each TR for plotting approach to steady-state
let steadyStateMz = [];        // Store Mz at each TR

// Event markers for chart annotations (RF pulses, gradients)
let eventMarkers = []; // Array of { time, type, label }

// Previous Mxy for computing dMxy/dt (signal detection is EMF ∝ dMxy/dt)
let previousMxy = 0;

// Three.js globals
let scene, camera, renderer;
let spinArrows = [];        // Individual spin arrows (ensemble for Module B/C)
let sumArrow = null;        // Sum magnetization arrow (white - total M)
let mxyArrow = null;        // Transverse component arrow (cyan - Mxy in xy plane)
let mzArrow = null;         // Longitudinal component arrow (blue - Mz along z)
let b0Arrow = null;         // B0 field indicator
let xyPlane = null;         // XY plane visualization
let netMagArrowA = null;    // Net magnetization arrow for Module A

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

    // Camera
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(2.5, 2, 2);
    camera.lookAt(0, 0, 0);

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
    b0Arrow = new THREE.ArrowHelper(b0Dir, new THREE.Vector3(1.3, 0, 0), 1.2, 0xffff00, 0.15, 0.1);
    scene.add(b0Arrow);

    // Create axis labels
    createAxisLabels();

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

function createAxisLabels() {
    // Create text sprites for axis labels
    function createLabel(text, position, color = '#ffffff') {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.font = 'bold 40px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.position.copy(position);
        sprite.scale.set(0.4, 0.4, 1);
        return sprite;
    }

    scene.add(createLabel("x'", new THREE.Vector3(1.7, 0, 0), '#ff6666'));
    scene.add(createLabel("y'", new THREE.Vector3(0, 1.7, 0), '#66ff66'));
    scene.add(createLabel("B₀", new THREE.Vector3(0, 0, 1.7), '#6666ff'));
}

/**
 * Update signal panel glow based on detected signal strength
 * The Signal/FID chart panel border glows when signal is detected
 * This avoids the rotating frame vs lab frame confusion of showing a coil in 3D
 *
 * PHYSICS: Signal detection uses Faraday's law: EMF ∝ -dΦ/dt ∝ dMxy/dt
 * In lab frame, Mxy rotates at ω₀, so EMF ∝ ω₀ × Mxy × sin(ω₀t)
 * The envelope of detected signal is proportional to |dMxy/dt|
 *
 * For educational purposes, we use |dMxy/dt| to show:
 * - Strong glow during rapid changes (RF excitation, echo formation)
 * - Weak glow when Mxy is large but stable
 * - Fading glow during slow T2/T2* decay
 *
 * @param {number} mxy - Current transverse magnetization magnitude (0 to 1)
 * @param {number} dt - Time step in ms
 */
function updateSignalPanelGlow(mxy, dt) {
    const signalPanel = document.querySelector('.signal-panel:last-child');
    if (!signalPanel) return;

    // Compute |dMxy/dt| - rate of change of transverse magnetization
    // This is what a receiver coil actually detects (Faraday's law)
    const dMxyDt = Math.abs(mxy - previousMxy) / (dt || 0.5);  // units: 1/ms
    previousMxy = mxy;

    // Scale factor: dMxy/dt during RF pulse is very fast (~1/ms)
    // During echo rephasing, it's slower (~0.01-0.1/ms)
    // Normalize to 0-1 range with sensitivity to typical signal changes
    // Also include a small contribution from |Mxy| for continuous visibility
    const rateContribution = Math.min(dMxyDt * 5, 1.0);  // Fast changes → strong glow
    const steadyContribution = mxy * 0.3;  // Some glow when Mxy exists (rotating signal)
    const glowIntensity = Math.min(rateContribution + steadyContribution, 1.0);

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
        alignmentArrows.push(arrow);
        scene.add(arrow);
    }

    // Net magnetization arrow (white, larger)
    const netDir = new THREE.Vector3(0, 0, 0.01);
    netMagArrowA = new THREE.ArrowHelper(netDir, new THREE.Vector3(0, 0, 0), 0.01, 0xffffff, 0.12, 0.06);
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
    const sumLength = sumDir.length();

    // Show arrow based on Mz alignment (what we're visualizing)
    // Random spins: Mz ~ 0 (cancel out)
    // Aligned spins: Mz → 1.0 (all pointing +z)
    // Use sum.Mz as the visibility criterion since that's what the chart shows
    const VISIBILITY_THRESHOLD = 0.1;

    if (netMagArrowA) {
        // Use Mz for visibility check (matches the Mz chart)
        // But use full vector for direction
        if (sum.Mz > VISIBILITY_THRESHOLD) {
            sumDir.normalize();
            // Arrow length proportional to |M|, with minimum for visibility
            const displayLength = Math.max(sumLength, 0.15);
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
    const arrowLength = 0.8;
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
    mxyArrow = new THREE.ArrowHelper(mxyDir, new THREE.Vector3(0, 0, 0), mxyLen, 0x22d3ee, 0.12, 0.06);
    mxyArrow.visible = mxyMag > 0.02;
    scene.add(mxyArrow);

    // Mz arrow (blue) - longitudinal component along z
    const mzMag = Math.abs(sum.Mz);
    const mzDir = new THREE.Vector3(0, 0, sum.Mz >= 0 ? 1 : -1);
    const mzLen = Math.max(mzMag, 0.1);
    mzArrow = new THREE.ArrowHelper(mzDir, new THREE.Vector3(0, 0, 0), mzLen, 0x3b82f6, 0.12, 0.06);
    mzArrow.visible = mzMag > 0.02;
    scene.add(mzArrow);

    // Sum arrow (white) - total magnetization vector
    const sumMag = Math.sqrt(sum.Mx*sum.Mx + sum.My*sum.My + sum.Mz*sum.Mz);
    const sumDir = sumMag > 0.001 ? new THREE.Vector3(sum.Mx, sum.My, sum.Mz).normalize() : new THREE.Vector3(0, 0, 1);
    const sumLen = Math.max(sumMag, 0.1);
    sumArrow = new THREE.ArrowHelper(sumDir, new THREE.Vector3(0, 0, 0), sumLen, 0xffffff, 0.12, 0.06);
    sumArrow.visible = sumMag > 0.02;
    scene.add(sumArrow);
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
                spinArrows[i].setLength(length * 0.8, 0.08, 0.05);
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

        // Rotate camera around origin
        const spherical = new THREE.Spherical();
        spherical.setFromVector3(camera.position);

        spherical.theta -= deltaX * 0.01;
        spherical.phi += deltaY * 0.01;

        // Clamp phi to avoid flipping
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

        camera.position.setFromSpherical(spherical);
        camera.lookAt(0, 0, 0);

        previousMouse = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Zoom with wheel
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.001;
        const distance = camera.position.length();
        const newDistance = distance * (1 + e.deltaY * zoomSpeed);
        camera.position.setLength(Math.max(2, Math.min(10, newDistance)));
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

    // Mxy chart
    chartMxy = new Chart(document.getElementById('chart-mxy'), {
        type: 'line',
        data: {
            datasets: [{
                label: 'Mxy',
                data: [],
                borderColor: '#10b981',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: { ...chartOptions }
    });

    // Mz chart
    chartMz = new Chart(document.getElementById('chart-mz'), {
        type: 'line',
        data: {
            datasets: [{
                label: 'Mz',
                data: [],
                borderColor: '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.1
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                ...chartOptions.scales,
                y: { ...chartOptions.scales.y, min: -0.1, max: 1.1 }
            }
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
    const annotations = (CONFIG.currentModule === 'C' || CONFIG.currentModule === 'D') ? getChartAnnotations() : {};

    // Update Mxy chart with annotations
    chartMxy.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: mxyData[i] }));
    chartMxy.options.plugins.annotation = { annotations };
    chartMxy.update('none');

    // Update Mz chart with annotations
    chartMz.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: mzData[i] }));
    chartMz.options.plugins.annotation = { annotations };
    chartMz.update('none');

    // Update Signal chart with annotations
    chartSignal.data.datasets[0].data = timeData.map((t, i) => ({ x: t, y: signalReData[i] }));
    chartSignal.data.datasets[1].data = timeData.map((t, i) => ({ x: t, y: signalImData[i] }));
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
    eventMarkers = [];
    updateCharts();
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

    // Calculate delta time
    if (!lastTimestamp) lastTimestamp = timestamp;
    lastTimestamp = timestamp;

    // Update simulation if playing
    // When B0 is OFF (Module A), continue animation indefinitely for gradual randomization
    const shouldAnimate = CONFIG.isPlaying &&
        (CONFIG.currentTime < CONFIG.maxTime || (CONFIG.currentModule === 'A' && !b0IsOn));

    if (shouldAnimate) {
        const simDt = CONFIG.dt * CONFIG.animationSpeed;
        CONFIG.currentTime += simDt;

        // For B0 OFF mode, wrap time to prevent overflow (animation loops indefinitely)
        if (CONFIG.currentModule === 'A' && !b0IsOn && CONFIG.currentTime > CONFIG.maxTime) {
            CONFIG.currentTime = CONFIG.maxTime; // Keep at max, animation continues
        }

        // Update physics based on module
        switch (CONFIG.currentModule) {
            case 'A':
                updateModuleA(simDt);
                break;
            case 'B':
                updateModuleB(simDt);
                break;
            case 'C':
                updateModuleC(simDt);
                break;
            case 'D':
                updateModuleD(simDt);
                break;
        }

        // Update time display
        document.getElementById('time-val').textContent = CONFIG.currentTime.toFixed(1) + ' ms';
    }

    // Render 3D scene
    renderer.render(scene, camera);
}

function updateModuleA(dt) {
    if (!alignmentEnsemble) return;

    // B0 ON: spins align toward +z through T1 relaxation
    // B0 OFF: spins gradually return to random orientations (decay toward thermal equilibrium)
    alignmentEnsemble.spins.forEach(spin => {
        if (b0IsOn) {
            // T1 relaxation drives Mz toward equilibrium (M0 = 1)
            const E1 = Math.exp(-dt / spin.T1);
            spin.Mz = spin.Mz * E1 + (1 - E1);

            // Transverse components decay (but more slowly since no RF was applied)
            // In reality, random thermal motion causes some T2-like decay
            const E2 = Math.exp(-dt / spin.T2);
            spin.Mx *= E2;
            spin.My *= E2;

            // Normalize the magnetization vector (keep it on unit sphere during alignment)
            const mag = Math.sqrt(spin.Mx * spin.Mx + spin.My * spin.My + spin.Mz * spin.Mz);
            if (mag > 0.01) {
                spin.Mx /= mag;
                spin.My /= mag;
                spin.Mz /= mag;
            }
        } else {
            // B0 OFF: No preferred direction, spins gradually lose alignment
            // Use a much shorter time constant than T1 for visible de-alignment
            // (In reality, without B0, thermal fluctuations quickly randomize spins)
            const deAlignmentTimeConstant = 200; // ms - fast enough to see animation
            const E1 = Math.exp(-dt / deAlignmentTimeConstant);

            // Each spin drifts toward a random orientation
            // The random walk on a sphere: perturb direction, then normalize
            const driftStrength = (1 - E1) * 1.5;  // Stronger drift for visible effect
            spin.Mx = spin.Mx * E1 + (Math.random() - 0.5) * driftStrength;
            spin.My = spin.My * E1 + (Math.random() - 0.5) * driftStrength;
            spin.Mz = spin.Mz * E1 + (Math.random() - 0.5) * driftStrength;

            // Normalize to unit sphere (spins have constant magnitude)
            const mag = Math.sqrt(spin.Mx * spin.Mx + spin.My * spin.My + spin.Mz * spin.Mz);
            if (mag > 0.01) {
                spin.Mx /= mag;
                spin.My /= mag;
                spin.Mz /= mag;
            }
        }
    });

    // Get sum magnetization for plotting
    const sum = alignmentEnsemble.getSumMagnetization();
    const avgMz = alignmentEnsemble.getAverageMz();

    // Record data
    timeData.push(CONFIG.currentTime);
    mxyData.push(Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My));
    mzData.push(sum.Mz);
    signalReData.push(sum.Mx);
    signalImData.push(sum.My);

    // Update visualization
    updateAlignmentArrows();

    // Update alignment progress bar
    const alignmentPercent = Math.max(0, avgMz * 100);
    document.getElementById('alignment-fill').style.width = alignmentPercent + '%';
    document.getElementById('net-mz').textContent = alignmentPercent.toFixed(0) + '%';

    // Update vector display
    document.getElementById('Mx-val').textContent = sum.Mx.toFixed(2);
    document.getElementById('My-val').textContent = sum.My.toFixed(2);
    document.getElementById('Mz-val').textContent = sum.Mz.toFixed(2);

    updateCharts();
}

function updateModuleB(dt) {
    // Evolve ensemble
    ensemble.evolve(dt);

    // Get sum magnetization
    const sum = ensemble.getSumMagnetization();

    // Record data
    timeData.push(CONFIG.currentTime);
    mxyData.push(Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My));
    mzData.push(sum.Mz);
    signalReData.push(sum.Mx);
    signalImData.push(sum.My);

    // Update visualization
    updateEnsembleArrows();
    updateVectorDisplay({ Mx: sum.Mx, My: sum.My, Mz: sum.Mz, getMxy: () => Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My) });
    document.getElementById('coherent-count').textContent = ensemble.getPhaseCoherence().toFixed(0) + '%';
    updateCharts();

    // Update receiver coil glow based on dMxy/dt (detected signal - Faraday's law)
    const mxy = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);
    updateSignalPanelGlow(mxy, dt);
}

function updateModuleC(dt) {
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

    // Get sum magnetization
    const sum = ensemble.getSumMagnetization();

    // Record data
    timeData.push(CONFIG.currentTime);
    mxyData.push(Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My));
    mzData.push(sum.Mz);
    signalReData.push(sum.Mx);
    signalImData.push(sum.My);

    // Update visualization
    updateEnsembleArrows();
    updateVectorDisplay({ Mx: sum.Mx, My: sum.My, Mz: sum.Mz });
    document.getElementById('coherent-count').textContent = ensemble.getPhaseCoherence().toFixed(0) + '%';
    updateCharts();

    // Update receiver coil glow based on dMxy/dt (detected signal - Faraday's law)
    const mxy = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);
    updateSignalPanelGlow(mxy, dt);
}

/**
 * Module D: GRE Variants - Multi-TR steady-state simulation
 * Shows how magnetization evolves over repeated excitations
 * Spoiled GRE: RF spoiling destroys Mxy → T1-weighted
 * SSFP: Balanced gradients preserve Mxy → T2/T1-weighted
 */
function updateModuleD(dt) {
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

        // Prepare for next TR
        timeInTR = 0;

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

    // Get sum magnetization
    const sum = ensemble.getSumMagnetization();

    // Record data for continuous plotting
    timeData.push(CONFIG.currentTime);
    mxyData.push(Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My));
    mzData.push(sum.Mz);
    signalReData.push(sum.Mx);
    signalImData.push(sum.My);

    // Update visualization
    updateEnsembleArrows();
    updateVectorDisplay({ Mx: sum.Mx, My: sum.My, Mz: sum.Mz });
    updateCharts();

    // Update phase coherence display (reuse from Module B/C)
    const coherentEl = document.getElementById('coherent-count');
    if (coherentEl) {
        coherentEl.textContent = ensemble.getPhaseCoherence().toFixed(0) + '%';
    }

    // Update signal glow
    const mxy = Math.sqrt(sum.Mx * sum.Mx + sum.My * sum.My);
    updateSignalPanelGlow(mxy, dt);
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
 * Calculate theoretical steady-state signal for SSFP (bSSFP)
 * S = M0 * sin(α) / (1 + cos(α) + (1 - cos(α)) * T1/T2)
 * This is a simplified on-resonance formula
 */
function calculateSSFPSignal(flipAngleDeg, T1, T2) {
    const alpha = flipAngleDeg * Math.PI / 180;
    const ratio = T1 / T2;
    const signal = Math.sin(alpha) / (1 + Math.cos(alpha) + (1 - Math.cos(alpha)) * ratio);
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
        signal = calculateSSFPSignal(CONFIG.flipAngleD, CONFIG.T1D, CONFIG.T2D);
    }
    document.getElementById('steady-state-val').textContent = (signal * 100).toFixed(1) + '%';
}

/**
 * Run the GRE multi-TR sequence
 */
function runGRESequence() {
    resetSimulation();

    // Create ensemble with minimal frequency spread (on-resonance for SSFP)
    // Use small spread for spoiled GRE to show T2* effects
    const freqSpread = CONFIG.greType === 'ssfp' ? 5 : 20;
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

    // Update displays
    updateErnstAngleDisplay();

    CONFIG.isPlaying = true;
}

function updateVectorDisplay(spin) {
    document.getElementById('Mx-val').textContent = spin.Mx.toFixed(2);
    document.getElementById('My-val').textContent = spin.My.toFixed(2);
    document.getElementById('Mz-val').textContent = spin.Mz.toFixed(2);
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
    }

    // Update signal panel glow for Module B/C/D
    updateSignalPanelGlow(0, 0.5);
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
    alignmentEnsemble.randomizeOrientations();
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
    const sum = alignmentEnsemble.getSumMagnetization();
    const avgMz = alignmentEnsemble.getAverageMz();
    document.getElementById('alignment-fill').style.width = Math.max(0, avgMz * 100) + '%';
    document.getElementById('net-mz').textContent = Math.max(0, avgMz * 100).toFixed(0) + '%';
    document.getElementById('Mx-val').textContent = sum.Mx.toFixed(2);
    document.getElementById('My-val').textContent = sum.My.toFixed(2);
    document.getElementById('Mz-val').textContent = sum.Mz.toFixed(2);
}

function updateInfoPanel(module) {
    const infoTitle = document.querySelector('#info-panel h4');
    const infoText = document.getElementById('info-text');

    switch (module) {
        case 'A':
            infoTitle.textContent = 'Module A: B₀ Alignment';
            infoText.innerHTML = `
                <strong>Without B₀:</strong> Spins point in random directions (thermal equilibrium). Net M ≈ 0.<br>
                <strong>With B₀:</strong> Spins gradually align with field through T1 relaxation. Net M grows along +z.<br>
                <strong>T1 (spin-lattice):</strong> Time constant for alignment. Mz(t) = M₀(1 - e<sup>-t/T1</sup>)<br>
                <em style="color: #f59e0b;">Rotating frame: Simulation at Larmor frequency ω₀. B₀ slider shows clinical field strength but physics is normalized (M₀=1).</em>
            `;
            break;
        case 'B':
            infoTitle.textContent = 'Module B: FID & Signal Detection';
            infoText.innerHTML = `
                <strong>Dephasing:</strong> Spins precess at ω₀ + Δω (field inhomogeneity). Different phases → destructive interference → FID decay.<br>
                <strong>Signal:</strong> In lab frame, rotating Mxy induces EMF ∝ ω₀|Mxy|. Signal panel glows with signal strength.<br>
                <strong>T2* decay:</strong> Mxy(t) = M₀·e<sup>-t/T2*</sup>. White arrow = net magnetization = signal envelope.<br>
                <em style="color: #f59e0b;">Note: 3D shows rotating frame. Net M ~1/√N, shown normalized.</em>
            `;
            break;
        case 'C':
            infoTitle.textContent = 'Module C: Echo Formation';
            infoText.innerHTML = `
                <strong>Spin Echo:</strong> 180° pulse inverts phases → rephasing → echo at TE. Refocuses B₀ inhomogeneity (T2 weighting).<br>
                <strong>Gradient Echo:</strong> Gradient reversal → rephasing → echo. Does NOT refocus B₀ (T2* weighting).<br>
                <strong>Signal:</strong> Watch the Signal/FID panel glow brighten at echo!<br>
                <em style="color: #f59e0b;">Note: 3D shows rotating frame. Net M ~1/√N, shown normalized.</em>
            `;
            break;
        case 'D':
            infoTitle.textContent = 'Module D: GRE Variants';
            infoText.innerHTML = `
                <strong>Spoiled GRE (SPGR/FLASH):</strong> Mxy destroyed each TR → only T1 recovery matters → <strong>T1-weighted</strong>.<br>
                <strong>SSFP (bSSFP/TrueFISP):</strong> Mxy preserved → builds to steady-state → <strong>T2/T1-weighted</strong> (bright fluid).<br>
                <strong>Ernst Angle:</strong> α<sub>E</sub> = arccos(e<sup>-TR/T1</sup>) gives maximum signal for spoiled GRE.<br>
                <em style="color: #f59e0b;">Watch Mxy and Mz approach steady-state over multiple TRs.</em>
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
            initModuleA();
        }
    });

    document.getElementById('T1-val').addEventListener('input', (e) => {
        CONFIG.T1 = parseInt(e.target.value);
        document.getElementById('T1-display').textContent = CONFIG.T1 + ' ms';
        if (alignmentEnsemble) {
            alignmentEnsemble.setT1(CONFIG.T1);
        }
    });

    document.getElementById('B0-val').addEventListener('input', (e) => {
        CONFIG.B0 = parseFloat(e.target.value);
        const freq = (GAMMA * CONFIG.B0).toFixed(1);
        document.getElementById('B0-display').textContent = `${CONFIG.B0} T (${freq} MHz)`;
        // NOTE: B0 slider is primarily cosmetic/educational in this simulation.
        // In the rotating frame at ω₀ = γB₀, the main field effect is removed.
        // What matters is the off-resonance (ΔB₀ inhomogeneity), which is controlled
        // by the "Frequency Spread" parameter and determines T2* decay.
        // The B0 value is stored for reference but doesn't change the physics
        // because we're simulating relative frequencies, not absolute precession.
        if (alignmentEnsemble) {
            alignmentEnsemble.setB0(CONFIG.B0);
        }
        ensemble.setB0(CONFIG.B0);
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
    });

    document.getElementById('btn-b0-off').addEventListener('click', () => {
        // Turn B0 OFF - gradually randomize spins (not instant)
        // This simulates the loss of alignment when the external field is removed
        b0IsOn = false;

        // Continue playing to show gradual de-alignment animation
        CONFIG.isPlaying = true;
        clearChartData();
        CONFIG.currentTime = 0;

        // The actual randomization happens gradually in updateModuleA()
        // when b0IsOn is false - spins drift toward random orientations over time
    });

    // Module B controls
    document.getElementById('num-spins').addEventListener('input', (e) => {
        CONFIG.numSpins = parseInt(e.target.value);
        document.getElementById('num-spins-val').textContent = CONFIG.numSpins + ' spins';
    });

    document.getElementById('num-spins').addEventListener('change', () => {
        ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2ensemble, CONFIG.freqSpread, CONFIG.B0);
        if (CONFIG.currentModule === 'B') createEnsembleArrows();
    });

    document.getElementById('freq-spread').addEventListener('input', (e) => {
        CONFIG.freqSpread = parseInt(e.target.value);
        document.getElementById('freq-spread-val').textContent = CONFIG.freqSpread + ' Hz';
    });

    document.getElementById('freq-spread').addEventListener('change', () => {
        ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2ensemble, CONFIG.freqSpread, CONFIG.B0);
        if (CONFIG.currentModule === 'B') createEnsembleArrows();
    });

    document.getElementById('T2-ensemble').addEventListener('input', (e) => {
        CONFIG.T2ensemble = parseInt(e.target.value);
        document.getElementById('T2-ensemble-val').textContent = CONFIG.T2ensemble + ' ms';
        // FIX: Update T2 for all spins in the ensemble
        ensemble.setT2(CONFIG.T2ensemble);
    });

    // Module B flip angle control
    document.getElementById('flip-angle').addEventListener('input', (e) => {
        CONFIG.flipAngle = parseInt(e.target.value);
        document.getElementById('flip-angle-val').textContent = CONFIG.flipAngle + '°';
    });

    document.getElementById('btn-excite').addEventListener('click', () => {
        resetSimulation();
        ensemble.applyRFPulse(CONFIG.flipAngle, 0);
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
        updateT2starSliderForEchoType();
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
        // Save to appropriate storage based on current echo type
        if (CONFIG.echoType === 'gradient') {
            CONFIG.T2starEchoGRE = CONFIG.T2starEcho;
        } else {
            CONFIG.T2starEchoSE = CONFIG.T2starEcho;
        }
    });

    document.getElementById('num-spins-C').addEventListener('input', (e) => {
        const numSpins = parseInt(e.target.value);
        document.getElementById('num-spins-C-val').textContent = numSpins + ' spins';
        CONFIG.numSpins = numSpins;
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
}

/**
 * Update T2* slider based on echo type selection
 * Saves current value before switching and restores saved value for new type
 */
function updateT2starSliderForEchoType() {
    const slider = document.getElementById('T2star-echo');
    const display = document.getElementById('T2star-echo-val');
    const previousType = CONFIG.echoType === 'gradient' ? 'spin' : 'gradient';

    // Save current slider value to the PREVIOUS echo type (before user switched)
    if (previousType === 'spin') {
        CONFIG.T2starEchoSE = CONFIG.T2starEcho;
    } else {
        CONFIG.T2starEchoGRE = CONFIG.T2starEcho;
    }

    // Restore saved value for the NEW echo type
    if (CONFIG.echoType === 'gradient') {
        CONFIG.T2starEcho = CONFIG.T2starEchoGRE;
    } else {
        CONFIG.T2starEcho = CONFIG.T2starEchoSE;
    }

    // Update UI
    slider.value = CONFIG.T2starEcho;
    display.textContent = CONFIG.T2starEcho + ' ms';
}

function resetSimulation() {
    CONFIG.isPlaying = false;
    CONFIG.currentTime = 0;
    lastTimestamp = 0;

    // FIX: Always restore maxTime to default
    CONFIG.maxTime = DEFAULT_MAX_TIME;

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
    rfPhase = 0;
    steadyStateMxy = [];
    steadyStateMz = [];

    // Reset signal detection state
    previousMxy = 0;

    // Reset B0 state for Module A
    b0IsOn = false;

    // Update UI
    document.getElementById('time-val').textContent = '0.00 ms';

    if (CONFIG.currentModule === 'A') {
        // Module A resets are handled by initModuleA()
        // Don't auto-reinitialize here to preserve user's choice
        if (alignmentEnsemble) {
            const sum = alignmentEnsemble.getSumMagnetization();
            document.getElementById('Mx-val').textContent = sum.Mx.toFixed(2);
            document.getElementById('My-val').textContent = sum.My.toFixed(2);
            document.getElementById('Mz-val').textContent = sum.Mz.toFixed(2);
        }
    } else {
        updateEnsembleArrows();
        document.getElementById('coherent-count').textContent = '0%';
    }
}

function runEchoSequence() {
    resetSimulation();

    // T2* determines B0 inhomogeneity spread
    // SE: user's T2* setting (will be refocused by 180°)
    // GRE: slider auto-set to 100ms for visible echo
    const T2star = CONFIG.T2starEcho;
    const freqSpread = 1000 / (Math.PI * T2star); // Convert T2* to freq spread

    ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2echo, freqSpread, CONFIG.B0);
    createEnsembleArrows();

    // Apply initial 90° pulse and add marker
    ensemble.applyRFPulse(90, 0);
    addEventMarker(0, 'rf90', '90°');

    // For Gradient Echo, apply gradient for controlled dephasing/rephasing
    // Gradient causes fast dephasing that IS refocused
    // B0 inhomogeneity causes slow decay that is NOT refocused
    if (CONFIG.echoType === 'gradient') {
        // Strong gradient (100 Hz) for rapid, visible dephasing
        ensemble.applyGradientFixed(100);
    }

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
}

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    init3D();
    initCharts();
    setupEventListeners();

    // Start with Module A
    switchModule('A');

    // Start animation loop
    animate(0);
}

// Start when DOM is ready
document.addEventListener('DOMContentLoaded', init);
