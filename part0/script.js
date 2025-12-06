/**
 * Part 0: NMR Signal Formation
 *
 * Interactive simulation showing how nuclear spins create the MR signal.
 * Based on the Bloch equations and fundamental NMR physics.
 *
 * Modules:
 * A - Single Spin Dynamics (Bloch equations)
 * B - Multi-Spin Ensemble (FID formation) - CENTRAL MODULE
 * C - Echo Formation (Spin Echo, Gradient Echo)
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

    // Module A: Single Spin
    // T1 = 500ms for educational demo (faster to observe recovery)
    // Real brain tissue: WM ~600-800ms, GM ~900-1200ms at 1.5T
    flipAngle: 90,        // degrees
    T1: 500,              // ms (shorter for faster demo)
    T2: 80,               // ms
    B0: 1.5,              // Tesla

    // Module B: Ensemble
    numSpins: 50,
    freqSpread: 30,       // Hz (determines T2*)
    T2ensemble: 100,      // ms (intrinsic T2)
    showIndividual: true,

    // Module C: Echo
    echoType: 'spin',     // 'spin' or 'gradient'
    TE: 80,               // ms
    T2echo: 120,          // ms
    T2starEcho: 30,       // ms

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

        // Base frequency offset from Larmor (Hz) - for T2* effects
        // This is the "intrinsic" offset due to field inhomogeneity
        this.baseDeltaOmega = deltaOmega;
        this.deltaOmega = deltaOmega;

        // B0 field strength (Tesla) - affects Larmor frequency
        this.B0 = B0;

        // Phase accumulation
        this.phase = 0;

        // Gradient state (for gradient echo)
        this.gradientSign = 1;
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

        // Precession due to frequency offset (in rotating frame)
        // deltaOmega represents field inhomogeneity in Hz at reference B0 (1.5T)
        // Scale with B0: higher field = larger frequency spread (linear with B0)
        // This simulates how field inhomogeneity effects scale with main field
        const B0scale = this.B0 / 1.5; // Scale relative to 1.5T reference
        const effectiveDeltaOmega = this.deltaOmega * B0scale;
        const dPhi = 2 * Math.PI * effectiveDeltaOmega * dtSec;
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
     * Reset to equilibrium (preserves base frequency offset)
     */
    reset() {
        this.Mx = 0;
        this.My = 0;
        this.Mz = 1.0;
        this.phase = 0;
        // Restore original frequency offset
        this.deltaOmega = this.baseDeltaOmega;
        this.gradientSign = 1;
    }

    /**
     * Invert phase (180° pulse effect on phase)
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
     * Toggle gradient direction (for gradient echo)
     */
    toggleGradient() {
        this.gradientSign *= -1;
        this.deltaOmega = this.baseDeltaOmega * this.gradientSign;
    }

    /**
     * Restore gradient to original direction
     */
    restoreGradient() {
        this.gradientSign = 1;
        this.deltaOmega = this.baseDeltaOmega;
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
     * Toggle gradient for all spins
     */
    toggleGradient() {
        this.spins.forEach(spin => spin.toggleGradient());
    }

    /**
     * Restore gradient for all spins
     */
    restoreGradient() {
        this.spins.forEach(spin => spin.restoreGradient());
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
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

let singleSpin = new Spin(CONFIG.T1, CONFIG.T2, 0, CONFIG.B0);
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

// Event markers for chart annotations (RF pulses, gradients)
let eventMarkers = []; // Array of { time, type, label }

// Three.js globals
let scene, camera, renderer;
let spinArrows = [];        // Individual spin arrows (ensemble)
let sumArrow = null;        // Sum magnetization arrow
let singleSpinArrow = null; // Single spin arrow (main, white)
let helperSpinArrows = [];  // Helper spin arrows for Module A (green, following main spin)
let b0Arrow = null;         // B0 field indicator
let xyPlane = null;         // XY plane visualization

// Number of helper spins to show in Module A
const NUM_HELPER_SPINS = 8;

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
    const planeGeom = new THREE.CircleGeometry(1.2, 64);
    const planeMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.15,
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

    // Single spin arrow (for Module A)
    createSingleSpinArrow();

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

function createSingleSpinArrow() {
    // Remove existing if any
    if (singleSpinArrow) {
        scene.remove(singleSpinArrow);
    }
    helperSpinArrows.forEach(arrow => scene.remove(arrow));
    helperSpinArrows = [];

    // Main spin arrow (white, larger) - represents the net magnetization
    const dir = new THREE.Vector3(0, 0, 1);
    singleSpinArrow = new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 1, 0xffffff, 0.2, 0.12);
    singleSpinArrow.name = 'singleSpin';
    scene.add(singleSpinArrow);

    // Create helper spin arrows (green, smaller) - represent individual protons
    // These all point in the same direction as the main spin in Module A
    // (no frequency spread, so they stay coherent)
    for (let i = 0; i < NUM_HELPER_SPINS; i++) {
        const helperArrow = new THREE.ArrowHelper(
            dir.clone(),
            new THREE.Vector3(0, 0, 0),
            0.85,
            0x10b981,
            0.1,
            0.06
        );
        helperArrow.name = 'helperSpin';
        helperSpinArrows.push(helperArrow);
        scene.add(helperArrow);
    }
}

function createEnsembleArrows() {
    // Clear existing
    spinArrows.forEach(arrow => scene.remove(arrow));
    spinArrows = [];

    if (sumArrow) scene.remove(sumArrow);

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

    // Sum arrow (thicker, brighter)
    const sum = ensemble.getSumMagnetization();
    const sumDir = new THREE.Vector3(sum.Mx, sum.My, sum.Mz);
    const sumLength = sumDir.length();
    if (sumLength > 0.01) {
        sumDir.normalize();
        sumArrow = new THREE.ArrowHelper(sumDir, new THREE.Vector3(0, 0, 0), sumLength, 0xffffff, 0.2, 0.12);
        scene.add(sumArrow);
    }
}

function updateSingleSpinArrow() {
    if (!singleSpinArrow) return;

    const dir = new THREE.Vector3(singleSpin.Mx, singleSpin.My, singleSpin.Mz);
    const length = dir.length();

    if (length > 0.001) {
        dir.normalize();
        singleSpinArrow.setDirection(dir);
        singleSpinArrow.setLength(length, 0.2 * length, 0.12 * length);

        // Update helper spin arrows - all point in same direction (coherent spins)
        // Slightly different lengths to show they're individual spins
        helperSpinArrows.forEach((arrow) => {
            arrow.setDirection(dir);
            const helperLength = length * (0.75 + 0.15 * Math.random());
            arrow.setLength(helperLength, 0.1 * helperLength, 0.06 * helperLength);
        });
    }
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

    // Update sum arrow
    const sum = ensemble.getSumMagnetization();
    const sumDir = new THREE.Vector3(sum.Mx, sum.My, sum.Mz);
    const sumLength = sumDir.length();

    if (sumArrow) {
        if (sumLength > 0.01) {
            sumDir.normalize();
            sumArrow.setDirection(sumDir);
            sumArrow.setLength(sumLength, 0.2, 0.12);
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
    // Get annotations for Module C
    const annotations = CONFIG.currentModule === 'C' ? getChartAnnotations() : {};

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
    if (CONFIG.isPlaying && CONFIG.currentTime < CONFIG.maxTime) {
        const simDt = CONFIG.dt * CONFIG.animationSpeed;
        CONFIG.currentTime += simDt;

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
        }

        // Update time display
        document.getElementById('time-val').textContent = CONFIG.currentTime.toFixed(1) + ' ms';
    }

    // Render 3D scene
    renderer.render(scene, camera);
}

function updateModuleA(dt) {
    // Evolve single spin
    singleSpin.evolve(dt);

    // Record data
    timeData.push(CONFIG.currentTime);
    mxyData.push(singleSpin.getMxy());
    mzData.push(singleSpin.Mz);
    signalReData.push(singleSpin.Mx);
    signalImData.push(singleSpin.My);

    // Update visualization
    updateSingleSpinArrow();
    updateVectorDisplay(singleSpin);
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
        // Gradient Echo: gradient reversal at TE/2, restore at TE
        if (echoSequenceState === 'dephasing' && echoSequenceTime >= halfTE && !gradientFlipped) {
            // Toggle gradient direction
            ensemble.toggleGradient();
            gradientFlipped = true;
            // Add event marker for gradient flip
            addEventMarker(CONFIG.currentTime, 'gradient_flip', 'G flip');
            echoSequenceState = 'refocusing';
        }
        // Restore gradient after echo (at TE)
        if (echoSequenceState === 'refocusing' && echoSequenceTime >= CONFIG.TE && gradientFlipped) {
            ensemble.restoreGradient();
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
    document.getElementById('coherent-count').textContent = ensemble.getPhaseCoherence().toFixed(0) + '%';
    updateCharts();
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

    // Update info panel
    updateInfoPanel(module);

    // Reset and setup for module
    resetSimulation();

    // Setup 3D view for module
    if (module === 'A') {
        // Show single spin and helper spins
        if (singleSpinArrow) singleSpinArrow.visible = true;
        helperSpinArrows.forEach(a => a.visible = true);
        spinArrows.forEach(a => a.visible = false);
        if (sumArrow) sumArrow.visible = false;
    } else {
        // Show ensemble, hide single spin and helpers
        if (singleSpinArrow) singleSpinArrow.visible = false;
        helperSpinArrows.forEach(a => a.visible = false);
        createEnsembleArrows();
    }
}

function updateInfoPanel(module) {
    const infoTitle = document.querySelector('#info-panel h4');
    const infoText = document.getElementById('info-text');

    switch (module) {
        case 'A':
            infoTitle.textContent = 'Module A: Bloch Equations';
            infoText.innerHTML = `
                <strong>Arrow Direction:</strong> RF pulse rotates M from z-axis into xy-plane (flip angle α).<br>
                <strong>Arrow Length:</strong> T2 decay shrinks Mxy; T1 recovery restores Mz toward equilibrium (M₀=1).<br>
                <em>Green circle = transverse (xy) plane where signal is detected.</em>
            `;
            break;
        case 'B':
            infoTitle.textContent = 'Module B: FID Formation';
            infoText.innerHTML = `
                <strong>Arrow Direction (Phase):</strong> Each spin precesses at ω₀ + Δω (field inhomogeneity). Different Δω → different phases → dephasing.<br>
                <strong>Arrow Length (Mxy):</strong> Individual Mxy decays by T2. Sum shrinks faster (T2*) due to destructive interference.<br>
                <strong>White arrow:</strong> Vector sum of all spins = detected signal.
            `;
            break;
        case 'C':
            infoTitle.textContent = 'Module C: Echo Formation';
            infoText.innerHTML = `
                <strong>Spin Echo:</strong> 180° pulse flips phase (φ → -φ). Fast spins now "behind" → catch up → rephase at TE.<br>
                <strong>Gradient Echo:</strong> Gradient reversal (G → -G) reverses Δω sign. Phase unwinding → echo at TE.<br>
                <strong>Key difference:</strong> Spin Echo refocuses B₀ inhomogeneity (T2 weighting); Gradient Echo does not (T2* weighting).
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
    document.getElementById('flip-angle').addEventListener('input', (e) => {
        CONFIG.flipAngle = parseInt(e.target.value);
        document.getElementById('flip-angle-val').textContent = CONFIG.flipAngle + '°';
    });

    document.getElementById('T1-val').addEventListener('input', (e) => {
        CONFIG.T1 = parseInt(e.target.value);
        document.getElementById('T1-display').textContent = CONFIG.T1 + ' ms';
        singleSpin.T1 = CONFIG.T1;
    });

    document.getElementById('T2-val').addEventListener('input', (e) => {
        CONFIG.T2 = parseInt(e.target.value);
        document.getElementById('T2-display').textContent = CONFIG.T2 + ' ms';
        singleSpin.T2 = CONFIG.T2;
    });

    document.getElementById('B0-val').addEventListener('input', (e) => {
        CONFIG.B0 = parseFloat(e.target.value);
        const freq = (GAMMA * CONFIG.B0).toFixed(1);
        document.getElementById('B0-display').textContent = `${CONFIG.B0} T (${freq} MHz)`;
        // Update B0 for single spin and ensemble (affects precession rate scaling)
        singleSpin.B0 = CONFIG.B0;
        ensemble.setB0(CONFIG.B0);
    });

    document.getElementById('btn-rf-pulse').addEventListener('click', () => {
        singleSpin.applyRFPulse(CONFIG.flipAngle, 0);
        updateSingleSpinArrow();
        updateVectorDisplay(singleSpin);
        if (!CONFIG.isPlaying) {
            CONFIG.isPlaying = true;
        }
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

    document.getElementById('btn-excite').addEventListener('click', () => {
        resetSimulation();
        ensemble.applyRFPulse(90, 0);
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
    });

    document.getElementById('btn-run-sequence').addEventListener('click', runEchoSequence);
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
    singleSpin.reset();
    ensemble.reset();

    // Reset echo state
    echoSequenceState = 'idle';
    echoSequenceTime = 0;
    gradientFlipped = false;

    // Update UI
    document.getElementById('time-val').textContent = '0.00 ms';
    updateVectorDisplay(singleSpin);

    if (CONFIG.currentModule === 'A') {
        updateSingleSpinArrow();
    } else {
        updateEnsembleArrows();
        document.getElementById('coherent-count').textContent = '0%';
    }
}

function runEchoSequence() {
    resetSimulation();

    // Create ensemble with T2* based on freq spread
    // T2* ≈ 1/(π * freqSpread) in seconds
    const T2star = CONFIG.T2starEcho;
    const freqSpread = 1000 / (Math.PI * T2star); // Convert T2* to freq spread

    ensemble = new SpinEnsemble(CONFIG.numSpins, CONFIG.T1, CONFIG.T2echo, freqSpread, CONFIG.B0);
    createEnsembleArrows();

    // Apply initial 90° pulse and add marker
    ensemble.applyRFPulse(90, 0);
    addEventMarker(0, 'rf90', '90°');

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
