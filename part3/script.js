/**
 * Part 1.5: Spatial Encoding Visualization
 *
 * Educational tool demonstrating how gradients encode spatial position into signal phase.
 *
 * Module A: Gradient Encoding
 *   - 2D spin array visualization
 *   - Toggle on/off for Gx (frequency) and Gy (phase) gradients
 *   - Shows static phase patterns when gradients are applied
 *
 * Module B: K-Space & Signal
 *   - Interactive k-space position exploration
 *   - Shows phase pattern for selected k-space position
 *   - Calculates cumulative signal from all spins
 */

class SpatialEncodingSimulator {
    constructor() {
        // Current module
        this.currentModule = 'A';

        // Module A: Gradient controls
        this.gxEnabled = false;
        this.gyEnabled = false;
        this.gxStrength = 5;
        this.gyStrength = 5;
        this.gridSize = 4;

        // Module B: K-space controls
        this.kxPosition = 0;
        this.kyPosition = 0;
        this.objectType = 'uniform';
        this.kspaceData = null;  // Stored k-space magnitude map
        this.kspaceSize = 17;    // -8 to +8 = 17 positions
        this.initKSpaceData();

        // Canvas contexts
        this.spinCtx = null;
        this.legendCtx = null;
        this.kspaceCtx = null;
        this.objectCtx = null;

        // Time-domain signal visualization
        this.timePoints = 200;  // Number of time points to calculate
        this.minTime = -20;     // Minimum time in ms
        this.maxTime = 20;      // Maximum time in ms
        this.signalHistory = []; // Cached signal over time

        // Lab frame animation
        this.labFrameMode = false;
        this.animationTime = 0;
        this.animationId = null;
        this.baseFrequency = 2.0; // Base precession frequency (rotations per second) for visualization

        // Random signal per voxel
        this.randomSignalEnabled = false;
        this.voxelSignals = []; // Array of random signal intensities per voxel
        this.generateRandomSignals();
    }

    generateRandomSignals() {
        // Generate random signal intensities for each voxel
        const maxVoxels = 16 * 16; // Support up to 16x16 grid
        this.voxelSignals = [];
        for (let i = 0; i < maxVoxels; i++) {
            // Random value between 0.2 and 1.0 (avoid zero signal)
            this.voxelSignals.push(0.2 + Math.random() * 0.8);
        }
    }

    initKSpaceData() {
        // Initialize k-space data array (stores magnitude at each kx, ky)
        this.kspaceData = [];
        for (let ky = 0; ky < this.kspaceSize; ky++) {
            this.kspaceData[ky] = [];
            for (let kx = 0; kx < this.kspaceSize; kx++) {
                this.kspaceData[ky][kx] = null; // null = not yet sampled
            }
        }
    }

    computeFullKSpace() {
        // Compute signal at all k-space positions for current object
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                const kx = ikx - 8; // -8 to +8
                const ky = iky - 8;
                const signal = this.calculateSignalAtKSpace(kx, ky);
                this.kspaceData[iky][ikx] = signal.magnitude;
            }
        }
    }

    calculateSignalAtKSpace(kx, ky) {
        const n = this.gridSize;
        const density = this.getObjectDensity();

        let realSum = 0;
        let imagSum = 0;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;

                // Normalize positions to -1 to 1
                const x = (ix / (n - 1)) * 2 - 1;
                const y = (iy / (n - 1)) * 2 - 1;

                // Phase from k-space position
                const phase = 2 * Math.PI * (kx * x + ky * y) / 16;

                realSum += rho * Math.cos(phase);
                imagSum += rho * Math.sin(phase);
            }
        }

        // Return raw signal without normalization
        // This shows true amplitude relationships in k-space:
        // - k=0 has highest magnitude (sum of all spins in phase)
        // - Higher k values have lower magnitude due to phase cancellation
        return {
            real: realSum,
            imag: imagSum,
            magnitude: Math.sqrt(realSum * realSum + imagSum * imagSum),
            phase: Math.atan2(imagSum, realSum)
        };
    }

    init() {
        this.setupCanvases();
        this.setupEventListeners();
        this.render();
    }

    setupCanvases() {
        // Main spin array canvas
        const spinCanvas = document.getElementById('spin-canvas');
        if (spinCanvas) {
            this.spinCtx = spinCanvas.getContext('2d');
            this.resizeCanvas(spinCanvas);
        }

        // Phase legend canvas
        const legendCanvas = document.getElementById('legend-canvas');
        if (legendCanvas) {
            this.legendCtx = legendCanvas.getContext('2d');
            this.resizeCanvas(legendCanvas);
        }

        // K-space / cumulative signal canvas
        const kspaceCanvas = document.getElementById('kspace-canvas');
        if (kspaceCanvas) {
            this.kspaceCtx = kspaceCanvas.getContext('2d');
            this.resizeCanvas(kspaceCanvas);
        }

        // Object / vector sum canvas
        const objectCanvas = document.getElementById('object-canvas');
        if (objectCanvas) {
            this.objectCtx = objectCanvas.getContext('2d');
            this.resizeCanvas(objectCanvas);
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            if (spinCanvas) this.resizeCanvas(spinCanvas);
            if (legendCanvas) this.resizeCanvas(legendCanvas);
            if (kspaceCanvas) this.resizeCanvas(kspaceCanvas);
            if (objectCanvas) this.resizeCanvas(objectCanvas);
            this.render();
        });
    }

    resizeCanvas(canvas) {
        const container = canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';

        const ctx = canvas.getContext('2d');
        // Reset transform before scaling to prevent cumulative scaling on resize
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
    }

    setupEventListeners() {
        // Module tabs
        document.querySelectorAll('.module-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchModule(tab.dataset.module);
            });
        });

        // Module A: Gradient toggles
        const gxToggle = document.getElementById('gx-toggle');
        gxToggle?.addEventListener('change', (e) => {
            this.gxEnabled = e.target.checked;
            document.getElementById('gx-strength-container').style.display =
                this.gxEnabled ? 'flex' : 'none';
            this.updateExplanation();
            this.render();
        });

        const gyToggle = document.getElementById('gy-toggle');
        gyToggle?.addEventListener('change', (e) => {
            this.gyEnabled = e.target.checked;
            document.getElementById('gy-strength-container').style.display =
                this.gyEnabled ? 'flex' : 'none';
            this.updateExplanation();
            this.render();
        });

        const gxStrength = document.getElementById('gx-strength');
        gxStrength?.addEventListener('input', (e) => {
            this.gxStrength = parseInt(e.target.value);
            document.getElementById('gx-strength-val').textContent = this.gxStrength;
            this.render();
        });

        const gyStrength = document.getElementById('gy-strength');
        gyStrength?.addEventListener('input', (e) => {
            this.gyStrength = parseInt(e.target.value);
            document.getElementById('gy-strength-val').textContent = this.gyStrength;
            this.render();
        });

        const gridSize = document.getElementById('grid-size');
        gridSize?.addEventListener('change', (e) => {
            this.gridSize = parseInt(e.target.value);
            this.render();
        });

        // Random signal toggle
        const randomSignalToggle = document.getElementById('random-signal-toggle');
        randomSignalToggle?.addEventListener('change', (e) => {
            this.randomSignalEnabled = e.target.checked;
            document.getElementById('random-seed-container').style.display =
                this.randomSignalEnabled ? 'flex' : 'none';
            this.render();
        });

        // Reshuffle button
        const reshuffleBtn = document.getElementById('reshuffle-btn');
        reshuffleBtn?.addEventListener('click', () => {
            this.generateRandomSignals();
            this.render();
        });

        // Lab frame toggle
        const labFrameToggle = document.getElementById('lab-frame-toggle');
        labFrameToggle?.addEventListener('change', (e) => {
            this.labFrameMode = e.target.checked;
            if (this.labFrameMode) {
                this.startLabFrameAnimation();
            } else {
                this.stopLabFrameAnimation();
                this.render();
            }
        });

        // Module B: K-space controls
        const kxPosition = document.getElementById('kx-position');
        kxPosition?.addEventListener('input', (e) => {
            this.kxPosition = parseInt(e.target.value);
            document.getElementById('kx-val').textContent = this.kxPosition;
            this.render();
        });

        const kyPosition = document.getElementById('ky-position');
        kyPosition?.addEventListener('input', (e) => {
            this.kyPosition = parseInt(e.target.value);
            document.getElementById('ky-val').textContent = this.kyPosition;
            this.render();
        });

        const objectSelect = document.getElementById('object-select');
        objectSelect?.addEventListener('change', (e) => {
            this.objectType = e.target.value;
            this.computeFullKSpace(); // Recompute k-space for new object
            this.render();
        });

        // Module B: Grid size
        const gridSizeB = document.getElementById('grid-size-b');
        gridSizeB?.addEventListener('change', (e) => {
            this.gridSize = parseInt(e.target.value);
            // Sync with Module A grid size
            const gridSizeA = document.getElementById('grid-size');
            if (gridSizeA) gridSizeA.value = e.target.value;
            this.computeFullKSpace();
            this.render();
        });

        // Module B: Random signal toggle
        const randomSignalToggleB = document.getElementById('random-signal-toggle-b');
        randomSignalToggleB?.addEventListener('change', (e) => {
            this.randomSignalEnabled = e.target.checked;
            document.getElementById('random-seed-container-b').style.display =
                this.randomSignalEnabled ? 'flex' : 'none';
            // Sync with Module A
            const randomToggleA = document.getElementById('random-signal-toggle');
            if (randomToggleA) randomToggleA.checked = this.randomSignalEnabled;
            document.getElementById('random-seed-container').style.display =
                this.randomSignalEnabled ? 'flex' : 'none';
            this.computeFullKSpace();
            this.render();
        });

        // Module B: Reshuffle button
        const reshuffleBtnB = document.getElementById('reshuffle-btn-b');
        reshuffleBtnB?.addEventListener('click', () => {
            this.generateRandomSignals();
            this.computeFullKSpace();
            this.render();
        });

        // Sync Module A grid size changes to Module B
        gridSize?.addEventListener('change', (e) => {
            const gridSizeB = document.getElementById('grid-size-b');
            if (gridSizeB) gridSizeB.value = e.target.value;
        });

        // Sync Module A random toggle to Module B
        randomSignalToggle?.addEventListener('change', (e) => {
            const randomToggleB = document.getElementById('random-signal-toggle-b');
            if (randomToggleB) {
                randomToggleB.checked = this.randomSignalEnabled;
                document.getElementById('random-seed-container-b').style.display =
                    this.randomSignalEnabled ? 'flex' : 'none';
            }
        });
    }

    switchModule(module) {
        this.currentModule = module;

        // Update tab styles
        document.querySelectorAll('.module-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.module === module);
        });

        // Show/hide module controls
        document.querySelectorAll('.module-controls').forEach(ctrl => {
            ctrl.style.display = 'none';
        });
        const controls = document.getElementById('controls-' + module);
        if (controls) controls.style.display = 'block';

        // When entering Module B, compute full k-space
        if (module === 'B') {
            this.computeFullKSpace();
        }

        // Update panel titles based on module
        this.updatePanelTitles();
        this.render();
    }

    updatePanelTitles() {
        const kspaceTitle = document.getElementById('kspace-title');
        const kspaceBadge = document.getElementById('kspace-badge');
        const objectTitle = document.getElementById('object-title');
        const spinBadge = document.getElementById('spin-badge');

        if (this.currentModule === 'A') {
            if (kspaceTitle) kspaceTitle.textContent = 'Signal Over Time';
            if (kspaceBadge) kspaceBadge.textContent = 'Rotating Frame';
            if (objectTitle) objectTitle.textContent = 'Vector Sum';
            if (spinBadge) spinBadge.textContent = 'Phase Pattern';
        } else {
            if (kspaceTitle) kspaceTitle.textContent = 'K-Space Position';
            if (kspaceBadge) kspaceBadge.textContent = 'Spatial Frequency';
            if (objectTitle) objectTitle.textContent = 'Object Density';
            if (spinBadge) spinBadge.textContent = 'Phase Encoding';
        }
    }

    updateExplanation() {
        const explanation = document.getElementById('encoding-explanation');
        if (!explanation) return;

        if (!this.gxEnabled && !this.gyEnabled) {
            explanation.innerHTML =
                'Without gradients, all spins have the same phase (pointing same direction). ' +
                'Toggle gradients to see how they create position-dependent phase patterns.';
        } else if (this.gxEnabled && !this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Frequency encoding (G<sub>x</sub>) active:</strong> ' +
                'Applied <em>during</em> readout. Phase continuously accumulates → ' +
                'spins at different x positions oscillate at different frequencies. ' +
                'Signal shows oscillation (decaying sinc pattern).';
        } else if (!this.gxEnabled && this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Phase encoding (G<sub>y</sub>) active:</strong> ' +
                'Applied <em>before</em> readout (then turned off). Creates a one-time ' +
                'phase imprint. Signal magnitude is constant over time, but phase varies with y.';
        } else {
            explanation.innerHTML =
                '<strong>Sequential encoding:</strong> ' +
                'G<sub>y</sub> applied first (before readout) → fixed phase offset per row. ' +
                'Then G<sub>x</sub> during readout → spins oscillate at different frequencies. ' +
                '<em>They are NOT applied simultaneously.</em>';
        }
    }

    // Get voxel signal intensity (combines object shape with optional random variation)
    getVoxelSignal(ix, iy, n) {
        const voxelIndex = iy * 16 + ix; // Use consistent indexing for random values
        const randomFactor = this.randomSignalEnabled ? this.voxelSignals[voxelIndex] : 1.0;

        // For Module A, all voxels are active (uniform)
        if (this.currentModule === 'A') {
            return randomFactor;
        }

        // For Module B, use object shapes
        // Normalize to -0.5 to 0.5 range
        const x = (ix / (n - 1)) - 0.5;
        const y = (iy / (n - 1)) - 0.5;

        let baseRho = 0;
        switch (this.objectType) {
            case 'uniform':
                // Fill ALL boxes
                baseRho = 1;
                break;
            case 'circle':
                // Adjusted radius to work with 4x4 grid (include more voxels)
                if (x * x + y * y < 0.3) baseRho = 1;
                break;
            case 'two-dots':
                // Two dots on left and right - adjusted for small grids
                const d1 = Math.sqrt((x + 0.25) ** 2 + y ** 2);
                const d2 = Math.sqrt((x - 0.25) ** 2 + y ** 2);
                if (d1 < 0.2 || d2 < 0.2) baseRho = 1;
                break;
            case 'line-h':
                // Horizontal line - middle rows
                if (Math.abs(y) < 0.2) baseRho = 1;
                break;
            case 'line-v':
                // Vertical line - middle columns
                if (Math.abs(x) < 0.2) baseRho = 1;
                break;
            default:
                baseRho = 1;
        }

        return baseRho * randomFactor;
    }

    // Get object density for a 2D grid
    getObjectDensity() {
        const n = this.gridSize;
        const density = [];

        for (let iy = 0; iy < n; iy++) {
            const row = [];
            for (let ix = 0; ix < n; ix++) {
                row.push(this.getVoxelSignal(ix, iy, n));
            }
            density.push(row);
        }
        return density;
    }

    // Calculate phase for a spin at position (ix, iy) given gradient settings
    calculatePhase(ix, iy, n, gxStrength, gyStrength) {
        // Normalize positions to -1 to 1
        const x = (ix / (n - 1)) * 2 - 1;
        const y = (iy / (n - 1)) * 2 - 1;

        // Phase = gamma * (Gx * x + Gy * y) * t
        // Simplified: phase proportional to gradient strength and position
        let phase = 0;
        if (this.currentModule === 'A') {
            if (this.gxEnabled) phase += (gxStrength / 10) * x * Math.PI;
            if (this.gyEnabled) phase += (gyStrength / 10) * y * Math.PI;
        } else {
            // Module B: Use k-space position
            phase = 2 * Math.PI * (this.kxPosition * x + this.kyPosition * y) / 16;
        }

        return phase;
    }

    // Calculate cumulative signal from all spins at a given time
    // Key difference:
    // - Frequency encoding (Gx): Applied DURING readout - continuous phase evolution
    // - Phase encoding (Gy): Applied BEFORE readout - fixed phase imprint
    calculateSignalAtTime(time) {
        const n = this.gridSize;
        const density = this.getObjectDensity();

        let realSum = 0;
        let imagSum = 0;
        let totalDensity = 0;

        // Scaling factor for visualization
        const gamma = 0.8;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;

                // Normalize positions to -1 to 1
                const x = (ix / (n - 1)) * 2 - 1;
                const y = (iy / (n - 1)) * 2 - 1;

                let phase = 0;
                if (this.currentModule === 'A') {
                    // FREQUENCY ENCODING (Gx): Phase accumulates continuously with time
                    // This causes spins at different x positions to oscillate at different frequencies
                    // Signal = sum of oscillating signals → frequency content encodes x position
                    if (this.gxEnabled) {
                        const freqX = (this.gxStrength / 10) * x * Math.PI * gamma;
                        phase += freqX * time;  // Continuous accumulation
                    }

                    // PHASE ENCODING (Gy): ONE-TIME phase imprint (doesn't change with time)
                    // Applied before readout, then turned off
                    // Each row gets a fixed phase offset based on y position
                    if (this.gyEnabled) {
                        const phaseY = (this.gyStrength / 10) * y * Math.PI;
                        phase += phaseY;  // Fixed phase (not multiplied by time)
                    }
                } else {
                    // Module B uses static k-space position
                    phase = 2 * Math.PI * (this.kxPosition * x + this.kyPosition * y) / 16;
                }

                realSum += rho * Math.cos(phase);
                imagSum += rho * Math.sin(phase);
            }
        }

        // Return raw signal without normalization
        // This shows true amplitude relationships:
        // - At t=0 or k=0, maximum magnitude (all spins in phase)
        // - As time/k increases, phase cancellation reduces magnitude
        return {
            real: realSum,
            imag: imagSum,
            magnitude: Math.sqrt(realSum * realSum + imagSum * imagSum),
            phase: Math.atan2(imagSum, realSum)
        };
    }

    // Calculate cumulative signal from all spins (current state, t=1)
    calculateSignal() {
        return this.calculateSignalAtTime(1.0);
    }

    // Calculate signal over time for visualization
    calculateSignalOverTime() {
        this.signalHistory = [];
        const timeRange = this.maxTime - this.minTime;
        for (let i = 0; i <= this.timePoints; i++) {
            const t = this.minTime + (i / this.timePoints) * timeRange;
            const signal = this.calculateSignalAtTime(t);
            this.signalHistory.push({
                time: t,
                real: signal.real,
                imag: signal.imag,
                magnitude: signal.magnitude
            });
        }
        return this.signalHistory;
    }

    // ==================== ANIMATION ====================

    startLabFrameAnimation() {
        this.animationTime = 0;
        const animate = () => {
            this.animationTime += 0.016; // ~60fps, increment by 16ms
            this.render();
            if (this.labFrameMode) {
                this.animationId = requestAnimationFrame(animate);
            }
        };
        this.animationId = requestAnimationFrame(animate);
    }

    stopLabFrameAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.animationTime = 0;
    }

    // ==================== RENDERING ====================

    render() {
        this.renderSpinArray();
        this.renderPhaseLegend();
        this.renderCumulativeSignal();
        this.renderVectorSum();
    }

    // Phase to color conversion (HSL color wheel)
    phaseToColor(phase, alpha = 1) {
        // Map phase (-PI to PI) to hue (0 to 360)
        const hue = ((phase + Math.PI) / (2 * Math.PI)) * 360;
        return `hsla(${hue}, 80%, 55%, ${alpha})`;
    }

    renderSpinArray() {
        if (!this.spinCtx) return;
        const ctx = this.spinCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        // Clear
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        const n = this.gridSize;
        const density = this.getObjectDensity();

        const margin = 50;
        const gridWidth = Math.min(w - 2 * margin, h - 2 * margin);
        const cellSize = gridWidth / n;
        const offsetX = (w - gridWidth) / 2;
        const offsetY = (h - gridWidth) / 2;

        const maxSpinRadius = Math.min(cellSize * 0.35, 18);
        const maxArrowLength = maxSpinRadius * 1.5;

        // Draw grid lines
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let i = 0; i <= n; i++) {
            ctx.beginPath();
            ctx.moveTo(offsetX + i * cellSize, offsetY);
            ctx.lineTo(offsetX + i * cellSize, offsetY + gridWidth);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + i * cellSize);
            ctx.lineTo(offsetX + gridWidth, offsetY + i * cellSize);
            ctx.stroke();
        }

        // Draw spins - different logic for Module A vs Module B
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                const cx = offsetX + (ix + 0.5) * cellSize;
                const cy = offsetY + (iy + 0.5) * cellSize;

                // Normalized positions
                const xNorm = (ix / (n - 1)) * 2 - 1;  // -1 to 1
                const yNorm = (iy / (n - 1)) * 2 - 1;

                let totalPhase;

                if (this.currentModule === 'B') {
                    // Module B: Phase is determined by k-space position
                    totalPhase = 2 * Math.PI * (this.kxPosition * xNorm + this.kyPosition * yNorm) / 16;
                } else {
                    // Module A: Phase from gradient encoding
                    const freqPhase = this.gxEnabled ? (this.gxStrength / 10) * xNorm * Math.PI : 0;
                    const phaseOffset = this.gyEnabled ? (this.gyStrength / 10) * yNorm * Math.PI : 0;

                    // In LAB FRAME: Add base precession + frequency-dependent precession
                    // In ROTATING FRAME: Only show gradient-induced phase differences
                    if (this.labFrameMode) {
                        // Lab frame: all spins precess at base frequency + gradient-induced offset
                        const basePhase = 2 * Math.PI * this.baseFrequency * this.animationTime;
                        // Frequency encoding adds to precession rate (spins at different x precess at different speeds)
                        const freqContribution = this.gxEnabled ? freqPhase * this.animationTime * 2 : 0;
                        // Phase encoding is a one-time offset (applied before readout)
                        totalPhase = basePhase + freqContribution + phaseOffset;
                    } else {
                        // Rotating frame: subtract base frequency, only see differences
                        totalPhase = freqPhase + phaseOffset;
                    }
                }

                if (rho > 0.01) {
                    // Scale spin size based on signal intensity (rho)
                    const spinRadius = maxSpinRadius * (this.randomSignalEnabled ? Math.sqrt(rho) : 1);
                    const arrowLength = maxArrowLength * (this.randomSignalEnabled ? Math.sqrt(rho) : 1);

                    if (this.currentModule === 'B') {
                        // === MODULE B: K-space encoding visualization ===
                        // The phase at each spin is φ = 2π(kx·x + ky·y) - BOTH contribute
                        // CIRCLE COLOR = kx contribution (Purple to Cyan gradient based on x)
                        // ARROW COLOR = ky contribution (Red to Yellow gradient based on y)
                        // ARROW DIRECTION = FULL phase from both kx AND ky (physically correct)

                        // Calculate circle color based on kx contribution (x position effect)
                        const freqIntensity = (xNorm + 1) / 2; // 0 to 1 based on x
                        let circleHue, circleSat, circleLightness;
                        if (this.kxPosition !== 0) {
                            circleHue = 270 - freqIntensity * 90; // Purple → Cyan
                            circleSat = 80;
                            circleLightness = 35 + freqIntensity * 25;
                        } else {
                            circleHue = 220;
                            circleSat = 10;
                            circleLightness = 30;
                        }

                        // Calculate arrow color based on ky contribution (y position effect)
                        const phaseIntensity = (yNorm + 1) / 2; // 0 to 1 based on y
                        let arrowHue, arrowSat, arrowLightness;
                        if (this.kyPosition !== 0) {
                            arrowHue = phaseIntensity * 60; // Red → Yellow
                            arrowSat = 100;
                            arrowLightness = 45 + phaseIntensity * 15;
                        } else {
                            arrowHue = 0;
                            arrowSat = 0;
                            arrowLightness = 100;
                        }

                        // Draw circle (color encodes kx/Frequency contribution)
                        ctx.beginPath();
                        ctx.arc(cx, cy, spinRadius, 0, 2 * Math.PI);
                        ctx.fillStyle = `hsla(${circleHue}, ${circleSat}%, ${circleLightness}%, ${0.4 + rho * 0.4})`;
                        ctx.fill();
                        ctx.strokeStyle = `hsl(${circleHue}, ${circleSat}%, ${circleLightness + 20}%)`;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();

                        // Arrow direction: FULL phase φ = 2π(kx·x + ky·y)
                        // Both kx and ky contribute to the actual spin phase
                        // This is physically correct - the sampled signal depends on both
                        const arrowPhase = totalPhase; // totalPhase already includes both kx and ky

                        // Draw arrow (direction shows actual phase, color encodes ky contribution)
                        const ax = cx + arrowLength * Math.cos(arrowPhase);
                        const ay = cy - arrowLength * Math.sin(arrowPhase);

                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.lineTo(ax, ay);
                        ctx.strokeStyle = `hsl(${arrowHue}, ${arrowSat}%, ${arrowLightness}%)`;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();

                        // Arrowhead
                        const angle = Math.atan2(-(ay - cy), ax - cx);
                        ctx.beginPath();
                        ctx.moveTo(ax, ay);
                        ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay + 6 * Math.sin(angle - 0.4));
                        ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay + 6 * Math.sin(angle + 0.4));
                        ctx.closePath();
                        ctx.fillStyle = `hsl(${arrowHue}, ${arrowSat}%, ${arrowLightness}%)`;
                        ctx.fill();

                    } else {
                        // === MODULE A: Separate Frequency/Phase encoding ===
                        // CIRCLE COLOR = FREQUENCY (Gx) - Purple to Cyan gradient
                        // ARROW COLOR = PHASE (Gy) - Red to Yellow gradient

                        const freqPhase = this.gxEnabled ? (this.gxStrength / 10) * xNorm * Math.PI : 0;
                        const phaseOffset = this.gyEnabled ? (this.gyStrength / 10) * yNorm * Math.PI : 0;

                        // Calculate circle color based on frequency (x position)
                        const freqIntensity = (xNorm + 1) / 2; // 0 to 1
                        let circleHue, circleSat, circleLightness;
                        if (this.gxEnabled) {
                            circleHue = 270 - freqIntensity * 90; // Purple → Cyan
                            circleSat = 80;
                            circleLightness = 35 + freqIntensity * 25;
                        } else {
                            circleHue = 220;
                            circleSat = 10;
                            circleLightness = 30;
                        }

                        // Calculate arrow color based on phase (y position)
                        const phaseIntensity = (yNorm + 1) / 2; // 0 to 1
                        let arrowHue, arrowSat, arrowLightness;
                        if (this.gyEnabled) {
                            arrowHue = phaseIntensity * 60; // Red → Yellow
                            arrowSat = 100;
                            arrowLightness = 45 + phaseIntensity * 15;
                        } else {
                            arrowHue = 0;
                            arrowSat = 0;
                            arrowLightness = 100;
                        }

                        // Draw circle
                        ctx.beginPath();
                        ctx.arc(cx, cy, spinRadius, 0, 2 * Math.PI);
                        ctx.fillStyle = `hsla(${circleHue}, ${circleSat}%, ${circleLightness}%, ${0.4 + rho * 0.4})`;
                        ctx.fill();
                        ctx.strokeStyle = `hsl(${circleHue}, ${circleSat}%, ${circleLightness + 20}%)`;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();

                        // Calculate arrow direction
                        // In rotating frame: arrows show accumulated phase from gradients
                        // - Gx creates a phase ramp across x: φ = γ·Gx·x·t
                        // - Gy creates a phase offset: φ = γ·Gy·y·t
                        let arrowPhase;
                        if (this.labFrameMode) {
                            // Lab frame: show precession + gradient effects
                            const basePhase = 2 * Math.PI * this.baseFrequency * this.animationTime;
                            const freqContribution = this.gxEnabled ? freqPhase * this.animationTime * 2 : 0;
                            arrowPhase = basePhase + freqContribution + phaseOffset;
                        } else {
                            // Rotating frame: show phase from both Gx and Gy
                            // Use fixed readout time (1.0) so Gx phase ramp is visible even when animation stopped
                            // This represents the phase at a snapshot during readout
                            const readoutTime = 1.0;
                            const freqContribution = this.gxEnabled ? freqPhase * readoutTime * 2 : 0;
                            arrowPhase = freqContribution + phaseOffset;
                        }

                        // Draw arrow
                        const ax = cx + arrowLength * Math.cos(arrowPhase);
                        const ay = cy - arrowLength * Math.sin(arrowPhase);

                        ctx.beginPath();
                        ctx.moveTo(cx, cy);
                        ctx.lineTo(ax, ay);
                        ctx.strokeStyle = `hsl(${arrowHue}, ${arrowSat}%, ${arrowLightness}%)`;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();

                        // Arrowhead
                        const angle = Math.atan2(-(ay - cy), ax - cx);
                        ctx.beginPath();
                        ctx.moveTo(ax, ay);
                        ctx.lineTo(ax - 6 * Math.cos(angle - 0.4), ay + 6 * Math.sin(angle - 0.4));
                        ctx.lineTo(ax - 6 * Math.cos(angle + 0.4), ay + 6 * Math.sin(angle + 0.4));
                        ctx.closePath();
                        ctx.fillStyle = `hsl(${arrowHue}, ${arrowSat}%, ${arrowLightness}%)`;
                        ctx.fill();
                    }

                } else {
                    // Empty spin (ghost)
                    ctx.beginPath();
                    ctx.arc(cx, cy, maxSpinRadius * 0.5, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#334155';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // Frame indicator (top-right)
        ctx.font = 'bold 13px Inter';
        ctx.textAlign = 'right';
        if (this.labFrameMode) {
            ctx.fillStyle = '#ef4444'; // Red for lab frame
            ctx.fillText('LAB FRAME', w - 10, 18);
            ctx.font = '11px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('All spins precessing', w - 10, 34);
        } else {
            ctx.fillStyle = '#10b981'; // Green for rotating frame
            ctx.fillText('ROTATING FRAME', w - 10, 18);
            ctx.font = '11px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('Base precession removed', w - 10, 34);
        }

        // Color key in top-left (larger, more readable)
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#a855f7';
        ctx.fillText('Circle color = x position (Gx)', 10, 18);
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(' →', 175, 18);

        ctx.fillStyle = '#ef4444';
        ctx.fillText('Arrow color = y position (Gy)', 10, 34);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(' →', 175, 34);

        // Clarify arrow direction meaning
        ctx.font = '11px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Arrow direction = total phase (Gx + Gy)', 10, 50);

        // Show current state - explain temporal sequence
        ctx.font = '11px Inter';
        ctx.fillStyle = '#10b981';  // Green for active state
        let stateText = 'No gradients active';
        if (this.gxEnabled && this.gyEnabled) {
            stateText = 'Active: Gy first → then Gx during readout';
        } else if (this.gxEnabled) {
            stateText = 'Active: Gx during readout → phase ramp across x';
        } else if (this.gyEnabled) {
            stateText = 'Active: Gy before readout → fixed offset per row';
        }
        ctx.fillText(stateText, 10, 66);

        // X-axis label at bottom center
        ctx.font = '12px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('X (Frequency Encode Direction)', offsetX + gridWidth / 2, h - 8);

        // X-axis frequency hints at grid corners
        if (this.gxEnabled) {
            ctx.font = '11px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#a855f7';
            ctx.fillText('Low freq', offsetX, h - 24);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#22d3ee';
            ctx.fillText('High freq', offsetX + gridWidth, h - 24);
        }

        // Y-axis label (rotated, on left side outside grid)
        ctx.save();
        ctx.translate(12, offsetY + gridWidth / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Y (Phase Encode Direction)', 0, 0);
        ctx.restore();

        // Y-axis phase hints
        if (this.gyEnabled) {
            ctx.font = '11px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('Phase +', offsetX - 50, offsetY + 10);
            ctx.fillStyle = '#ef4444';
            ctx.fillText('Phase -', offsetX - 50, offsetY + gridWidth - 5);
        }
    }

    renderPhaseLegend() {
        if (!this.legendCtx) return;
        const ctx = this.legendCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        const margin = 15;
        const barHeight = 22;
        const barWidth = w - 2 * margin;

        if (this.currentModule === 'B') {
            // === MODULE B: Same legend style as Module A ===

            // kx (FREQUENCY) LEGEND
            let y = 20;
            ctx.fillStyle = '#a855f7';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillText('kx (FREQUENCY)', margin, y);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px Inter';
            ctx.fillText(' - Circle', margin + 85, y);

            y += 10;
            const freqGradient = ctx.createLinearGradient(margin, 0, margin + barWidth, 0);
            freqGradient.addColorStop(0, 'hsl(270, 80%, 35%)');
            freqGradient.addColorStop(0.5, 'hsl(225, 80%, 50%)');
            freqGradient.addColorStop(1, 'hsl(180, 80%, 55%)');
            ctx.fillStyle = freqGradient;
            ctx.fillRect(margin, y, barWidth, barHeight);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(margin, y, barWidth, barHeight);

            y += barHeight + 14;
            ctx.font = '9px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#a855f7';
            ctx.fillText('-x position', margin, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#22d3ee';
            ctx.fillText('+x position', margin + barWidth, y);

            // ky (PHASE) LEGEND
            y += 28;
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillText('ky (PHASE)', margin, y);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px Inter';
            ctx.fillText(' - Arrow', margin + 60, y);

            y += 10;
            const phaseGradient = ctx.createLinearGradient(margin, 0, margin + barWidth, 0);
            phaseGradient.addColorStop(0, 'hsl(0, 100%, 45%)');
            phaseGradient.addColorStop(0.5, 'hsl(30, 100%, 50%)');
            phaseGradient.addColorStop(1, 'hsl(60, 100%, 55%)');
            ctx.fillStyle = phaseGradient;
            ctx.fillRect(margin, y, barWidth, barHeight);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(margin, y, barWidth, barHeight);

            y += barHeight + 14;
            ctx.font = '9px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ef4444';
            ctx.fillText('-y position', margin, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('+y position', margin + barWidth, y);

            // Current k position
            y += 25;
            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(`k = (${this.kxPosition}, ${this.kyPosition})`, w / 2, y);

            // SIGNAL SIZE LEGEND (if random enabled)
            if (this.randomSignalEnabled) {
                y += 20;
                ctx.fillStyle = '#10b981';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'left';
                ctx.fillText('SIGNAL', margin, y);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '9px Inter';
                ctx.fillText(' - Size', margin + 45, y);

                y += 15;
                const sizes = [0.4, 0.7, 1.0];
                const maxR = 10;
                let xPos = margin + 20;
                sizes.forEach((s, i) => {
                    ctx.beginPath();
                    ctx.arc(xPos, y, maxR * s, 0, 2 * Math.PI);
                    ctx.fillStyle = `rgba(16, 185, 129, ${0.3 + s * 0.4})`;
                    ctx.fill();
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    xPos += 45;
                });
            }

        } else {
            // === MODULE A: Frequency/Phase gradients ===

            // FREQUENCY LEGEND
            let y = 20;
            ctx.fillStyle = '#a855f7';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillText('FREQUENCY (Gx)', margin, y);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px Inter';
            ctx.fillText(' - Circle', margin + 85, y);

            y += 10;
            const freqGradient = ctx.createLinearGradient(margin, 0, margin + barWidth, 0);
            freqGradient.addColorStop(0, 'hsl(270, 80%, 35%)');
            freqGradient.addColorStop(0.5, 'hsl(225, 80%, 50%)');
            freqGradient.addColorStop(1, 'hsl(180, 80%, 55%)');
            ctx.fillStyle = freqGradient;
            ctx.fillRect(margin, y, barWidth, barHeight);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(margin, y, barWidth, barHeight);

            y += barHeight + 14;
            ctx.font = '9px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#a855f7';
            ctx.fillText('Low freq (-x)', margin, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#22d3ee';
            ctx.fillText('High freq (+x)', margin + barWidth, y);

            // PHASE LEGEND
            y += 28;
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillText('PHASE (Gy)', margin, y);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '9px Inter';
            ctx.fillText(' - Arrow', margin + 65, y);

            y += 10;
            const phaseGradient = ctx.createLinearGradient(margin, 0, margin + barWidth, 0);
            phaseGradient.addColorStop(0, 'hsl(0, 100%, 45%)');
            phaseGradient.addColorStop(0.5, 'hsl(30, 100%, 50%)');
            phaseGradient.addColorStop(1, 'hsl(60, 100%, 55%)');
            ctx.fillStyle = phaseGradient;
            ctx.fillRect(margin, y, barWidth, barHeight);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(margin, y, barWidth, barHeight);

            y += barHeight + 14;
            ctx.font = '9px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ef4444';
            ctx.fillText('-Phase (-y)', margin, y);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('+Phase (+y)', margin + barWidth, y);

            // SIGNAL SIZE LEGEND
            if (this.randomSignalEnabled) {
                y += 28;
                ctx.fillStyle = '#10b981';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'left';
                ctx.fillText('SIGNAL STRENGTH', margin, y);
                ctx.fillStyle = '#94a3b8';
                ctx.font = '9px Inter';
                ctx.fillText(' - Size', margin + 100, y);

                y += 18;
                const sizes = [0.4, 0.7, 1.0];
                const maxR = 12;
                let xPos = margin + 25;
                sizes.forEach((s, i) => {
                    ctx.beginPath();
                    ctx.arc(xPos, y, maxR * s, 0, 2 * Math.PI);
                    ctx.fillStyle = `rgba(16, 185, 129, ${0.3 + s * 0.4})`;
                    ctx.fill();
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    xPos += 50;
                });

                y += maxR + 14;
                ctx.fillStyle = '#94a3b8';
                ctx.font = '9px Inter';
                ctx.textAlign = 'center';
                ctx.fillText('Weak     Medium     Strong', w / 2, y);
            }
        }
    }

    renderCumulativeSignal() {
        if (!this.kspaceCtx) return;
        const ctx = this.kspaceCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        const n = this.gridSize;
        const density = this.getObjectDensity();

        if (this.currentModule === 'A') {
            // Module A: Show time-domain signal evolution
            this.renderTimeDomainSignal(ctx, w, h);
        } else {
            // Module B: Show k-space grid with current position highlighted
            this.renderKSpaceGrid(ctx, w, h);
        }
    }

    renderTimeDomainSignal(ctx, w, h) {
        // Calculate signal over time
        const signals = this.calculateSignalOverTime();

        const margin = { top: 30, right: 20, bottom: 40, left: 50 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;

        // Draw background grid
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;

        // Vertical grid lines (time)
        for (let i = 0; i <= 5; i++) {
            const x = margin.left + (i / 5) * plotW;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, margin.top + plotH);
            ctx.stroke();
        }

        // Horizontal grid lines (signal amplitude)
        for (let i = 0; i <= 4; i++) {
            const y = margin.top + (i / 4) * plotH;
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + plotW, y);
            ctx.stroke();
        }

        // Draw axes
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;

        // X-axis
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top + plotH / 2);
        ctx.lineTo(margin.left + plotW, margin.top + plotH / 2);
        ctx.stroke();

        // Y-axis
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + plotH);
        ctx.stroke();

        // Scale factors
        const timeRange = this.maxTime - this.minTime;
        const xScale = plotW / timeRange;

        // Calculate max signal for proper scaling (sum of all spin densities)
        const n = this.gridSize;
        const density = this.getObjectDensity();
        let maxSignal = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                maxSignal += density[iy][ix];
            }
        }
        maxSignal = Math.max(maxSignal, 1); // Avoid division by zero

        // Scale to fit plot, normalized by max possible signal
        const yScale = (plotH / 2 * 0.9) / maxSignal;
        const gamma = 0.8;

        // Draw individual spin signals (semi-transparent)
        // (reuse n and density from above)

        // Collect active spins
        const activeSpins = [];
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho > 0.01) {
                    const x = (ix / (n - 1)) * 2 - 1;
                    const y = (iy / (n - 1)) * 2 - 1;
                    activeSpins.push({ ix, iy, x, y, rho });
                }
            }
        }

        // Draw each individual spin's signal contribution
        // Color each spin based on its position in the grid (matching the spin array colors)
        activeSpins.forEach((spin, idx) => {
            // Calculate colors matching the spin array (frequency = purple-cyan, phase = red-yellow)
            const freqIntensity = (spin.x + 1) / 2; // 0 to 1 based on x position
            const phaseIntensity = (spin.y + 1) / 2; // 0 to 1 based on y position

            // Use frequency (x) for hue when Gx is enabled, phase (y) when Gy is enabled
            let hue, sat;
            if (this.gxEnabled && this.gyEnabled) {
                // Both enabled: blend colors
                hue = 270 - freqIntensity * 90 + phaseIntensity * 30;
                sat = 80;
            } else if (this.gxEnabled) {
                // Purple to Cyan based on x position
                hue = 270 - freqIntensity * 90;
                sat = 80;
            } else if (this.gyEnabled) {
                // Red to Yellow based on y position
                hue = phaseIntensity * 60;
                sat = 100;
            } else {
                hue = 200;
                sat = 30;
            }

            // Line opacity and width - keep individual signals subtle
            const opacity = this.randomSignalEnabled ? 0.15 + spin.rho * 0.25 : 0.25;
            const lineWidth = this.randomSignalEnabled ? 0.8 + spin.rho * 1.2 : 1;

            ctx.beginPath();
            ctx.strokeStyle = `hsla(${hue}, ${sat}%, 55%, ${opacity})`;
            ctx.lineWidth = lineWidth;

            for (let i = 0; i <= this.timePoints; i++) {
                const t = this.minTime + (i / this.timePoints) * timeRange;

                // Calculate this spin's phase at time t
                let phase = 0;
                if (this.gxEnabled) {
                    const freqX = (this.gxStrength / 10) * spin.x * Math.PI * gamma;
                    phase += freqX * t;
                }
                if (this.gyEnabled) {
                    const phaseY = (this.gyStrength / 10) * spin.y * Math.PI;
                    phase += phaseY;
                }

                // Individual signal contribution (real part) - raw value, yScale handles display
                const signalReal = spin.rho * Math.cos(phase);

                const px = margin.left + (t - this.minTime) * xScale;
                const py = margin.top + plotH / 2 - signalReal * yScale;

                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
        });

        // Draw cumulative Real component (green, bold)
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.5;
        signals.forEach((s, i) => {
            const x = margin.left + (s.time - this.minTime) * xScale;
            const y = margin.top + plotH / 2 - s.real * yScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw cumulative Imaginary component (orange/amber, bold)
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        signals.forEach((s, i) => {
            const x = margin.left + (s.time - this.minTime) * xScale;
            const y = margin.top + plotH / 2 - s.imag * yScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Magnitude envelope (white, dashed)
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        signals.forEach((s, i) => {
            const x = margin.left + (s.time - this.minTime) * xScale;
            const y = margin.top + plotH / 2 - s.magnitude * yScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // Axis labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';

        // X-axis label
        ctx.fillText('Time (ms)', margin.left + plotW / 2, h - 8);

        // Y-axis label
        ctx.save();
        ctx.translate(12, margin.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Signal (a.u.)', 0, 0);
        ctx.restore();

        // Y-axis tick labels
        ctx.textAlign = 'right';
        ctx.fillText('+1', margin.left - 5, margin.top + 5);
        ctx.fillText('0', margin.left - 5, margin.top + plotH / 2 + 4);
        ctx.fillText('-1', margin.left - 5, margin.top + plotH - 2);

        // X-axis tick labels
        ctx.textAlign = 'center';
        ctx.fillText(this.minTime.toString(), margin.left, margin.top + plotH + 15);
        ctx.fillText('0', margin.left + plotW / 2, margin.top + plotH + 15);
        ctx.fillText(this.maxTime.toString(), margin.left + plotW, margin.top + plotH + 15);

        // Draw vertical line at t=0
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const zeroX = margin.left + (0 - this.minTime) * xScale;
        ctx.moveTo(zeroX, margin.top);
        ctx.lineTo(zeroX, margin.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Legend
        ctx.font = '10px Inter';
        const legendX = margin.left + plotW - 95;
        const legendY = margin.top + 8;

        // Background for legend
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(legendX - 5, legendY - 6, 100, 60);

        // Individual spins legend - show gradient to indicate position-based coloring
        const indGrad = ctx.createLinearGradient(legendX, 0, legendX + 15, 0);
        if (this.gxEnabled) {
            indGrad.addColorStop(0, 'hsla(270, 80%, 55%, 0.6)');
            indGrad.addColorStop(1, 'hsla(180, 80%, 55%, 0.6)');
        } else if (this.gyEnabled) {
            indGrad.addColorStop(0, 'hsla(0, 100%, 55%, 0.6)');
            indGrad.addColorStop(1, 'hsla(60, 100%, 55%, 0.6)');
        } else {
            indGrad.addColorStop(0, 'hsla(200, 30%, 55%, 0.5)');
            indGrad.addColorStop(1, 'hsla(200, 30%, 55%, 0.5)');
        }
        ctx.strokeStyle = indGrad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(legendX, legendY + 2);
        ctx.lineTo(legendX + 15, legendY + 2);
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText('Individual', legendX + 20, legendY + 5);

        // Real legend (sum)
        ctx.fillStyle = '#10b981';
        ctx.fillRect(legendX, legendY + 14, 15, 3);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('Sum Real', legendX + 20, legendY + 17);

        // Imag legend (sum)
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(legendX, legendY + 26, 15, 3);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('Sum Imag', legendX + 20, legendY + 29);

        // Magnitude legend
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(legendX, legendY + 40);
        ctx.lineTo(legendX + 15, legendY + 40);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('|S| Mag', legendX + 20, legendY + 42);

        // Title showing current gradient state
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'left';
        let title = 'Signal vs Time (Rotating Frame)';
        if (this.gxEnabled || this.gyEnabled) {
            const parts = [];
            if (this.gxEnabled) parts.push(`Gx=${this.gxStrength}`);
            if (this.gyEnabled) parts.push(`Gy=${this.gyStrength}`);
            title += ` [${parts.join(', ')}]`;
        }
        ctx.fillText(title, margin.left, margin.top - 10);
    }

    renderKSpaceGrid(ctx, w, h) {
        const margin = { top: 30, right: 20, bottom: 30, left: 30 };
        const size = Math.min(w - margin.left - margin.right, h - margin.top - margin.bottom);
        const offsetX = margin.left + (w - margin.left - margin.right - size) / 2;
        const offsetY = margin.top + (h - margin.top - margin.bottom - size) / 2;

        const cellSize = size / this.kspaceSize;

        // Find max magnitude for normalization
        let maxMag = 0;
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                if (this.kspaceData[iky][ikx] !== null) {
                    maxMag = Math.max(maxMag, this.kspaceData[iky][ikx]);
                }
            }
        }
        if (maxMag === 0) maxMag = 1;

        // Draw k-space magnitude as image
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                const mag = this.kspaceData[iky][ikx];
                const x = offsetX + ikx * cellSize;
                const y = offsetY + (this.kspaceSize - 1 - iky) * cellSize; // Flip y for display

                if (mag !== null) {
                    // Use log scale for better visualization
                    const logMag = Math.log10(mag * 100 + 1) / Math.log10(maxMag * 100 + 1);
                    const brightness = Math.floor(logMag * 255);
                    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
                } else {
                    ctx.fillStyle = '#1a1a2e';
                }
                ctx.fillRect(x, y, cellSize, cellSize);
            }
        }

        // Draw grid lines
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= this.kspaceSize; i++) {
            ctx.beginPath();
            ctx.moveTo(offsetX + i * cellSize, offsetY);
            ctx.lineTo(offsetX + i * cellSize, offsetY + size);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + i * cellSize);
            ctx.lineTo(offsetX + size, offsetY + i * cellSize);
            ctx.stroke();
        }

        // Draw main axes (at center)
        const centerX = offsetX + 8 * cellSize + cellSize / 2;
        const centerY = offsetY + 8 * cellSize + cellSize / 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(offsetX, centerY);
        ctx.lineTo(offsetX + size, centerY);
        ctx.moveTo(centerX, offsetY);
        ctx.lineTo(centerX, offsetY + size);
        ctx.stroke();

        // Highlight current ky LINE (phase encoding line) - this is the key concept!
        const currentIky = this.kyPosition + 8;
        const lineY = offsetY + (this.kspaceSize - 1 - currentIky) * cellSize;

        // Draw the entire ky line highlight (the readout sweeps across this line)
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.fillRect(offsetX, lineY, size, cellSize);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(offsetX, lineY, size, cellSize);

        // Draw "readout direction" arrow along the ky line
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(offsetX + 10, lineY + cellSize / 2);
        ctx.lineTo(offsetX + size - 10, lineY + cellSize / 2);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(offsetX + size - 10, lineY + cellSize / 2);
        ctx.lineTo(offsetX + size - 18, lineY + cellSize / 2 - 5);
        ctx.lineTo(offsetX + size - 18, lineY + cellSize / 2 + 5);
        ctx.closePath();
        ctx.fillStyle = '#a855f7';
        ctx.fill();

        // Highlight current kx position within the line
        const currentIkx = this.kxPosition + 8;
        const highlightX = offsetX + currentIkx * cellSize;

        // Draw current point marker
        ctx.beginPath();
        ctx.arc(highlightX + cellSize / 2, lineY + cellSize / 2, cellSize / 2 + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Vertical line showing kx position
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(highlightX + cellSize / 2, offsetY);
        ctx.lineTo(highlightX + cellSize / 2, lineY);
        ctx.moveTo(highlightX + cellSize / 2, lineY + cellSize);
        ctx.lineTo(highlightX + cellSize / 2, offsetY + size);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.fillStyle = '#a855f7';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('kx (Frequency/Readout)', offsetX + size / 2, h - 5);
        ctx.save();
        ctx.translate(12, offsetY + size / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillText('ky (Phase Encode)', 0, 0);
        ctx.restore();

        // Current position info
        const signal = this.calculateSignalAtKSpace(this.kxPosition, this.kyPosition);
        ctx.textAlign = 'left';

        // ky line info
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 10px Inter';
        ctx.fillText(`ky line: ${this.kyPosition}`, 10, 15);

        // kx position info
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`kx point: ${this.kxPosition}`, 10, 28);

        // Signal value
        ctx.fillStyle = '#10b981';
        ctx.font = '10px Inter';
        ctx.fillText(`Signal |S| = ${signal.magnitude.toFixed(3)}`, 10, 43);

        // Title
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'right';
        ctx.fillText('K-Space (Filled by Readouts)', w - 10, 15);

        // Readout label on the line
        ctx.fillStyle = '#a855f7';
        ctx.font = '9px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('← Readout direction →', offsetX + size / 2, lineY - 3);
    }

    renderVectorSum() {
        if (!this.objectCtx) return;
        const ctx = this.objectCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        if (this.currentModule === 'A') {
            // Module A: Show resultant vector
            this.renderResultantVector(ctx, w, h);
        } else {
            // Module B: Show object density
            this.renderObjectDensity(ctx, w, h);
        }

        // Update signal display for Module B
        if (this.currentModule === 'B') {
            const signal = this.calculateSignal();
            const realEl = document.getElementById('signal-real');
            const imagEl = document.getElementById('signal-imag');
            const magEl = document.getElementById('signal-mag');

            if (realEl) realEl.textContent = signal.real.toFixed(2);
            if (imagEl) imagEl.textContent = signal.imag.toFixed(2);
            if (magEl) magEl.textContent = signal.magnitude.toFixed(2);
        }
    }

    renderResultantVector(ctx, w, h) {
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.35;

        const signal = this.calculateSignal();

        // Calculate max signal for proper scaling
        const n = this.gridSize;
        const density = this.getObjectDensity();
        let maxSignal = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                maxSignal += density[iy][ix];
            }
        }
        maxSignal = Math.max(maxSignal, 1);

        // Scale factor so max signal fits within radius
        const scaleFactor = radius / maxSignal;

        // Draw unit circle (represents max possible signal)
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.stroke();

        // Draw axes
        ctx.beginPath();
        ctx.moveTo(cx - radius - 10, cy);
        ctx.lineTo(cx + radius + 10, cy);
        ctx.moveTo(cx, cy - radius - 10);
        ctx.lineTo(cx, cy + radius + 10);
        ctx.stroke();

        // Calculate vector position
        let vx = signal.real * scaleFactor;
        let vy = -signal.imag * scaleFactor;

        // In lab frame mode, rotate the entire vector at the base frequency
        if (this.labFrameMode) {
            const basePhase = 2 * Math.PI * this.baseFrequency * this.animationTime;
            const mag = Math.sqrt(vx * vx + vy * vy);
            const currentAngle = Math.atan2(-vy, vx); // Note: vy is negated for screen coords
            const newAngle = currentAngle + basePhase;
            vx = mag * Math.cos(newAngle);
            vy = -mag * Math.sin(newAngle);
        }

        // Draw resultant vector
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + vx, cy + vy);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(vy, vx);
        ctx.beginPath();
        ctx.moveTo(cx + vx, cy + vy);
        ctx.lineTo(cx + vx - 8 * Math.cos(angle - 0.4), cy + vy - 8 * Math.sin(angle - 0.4));
        ctx.lineTo(cx + vx - 8 * Math.cos(angle + 0.4), cy + vy - 8 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        // Endpoint dot
        ctx.beginPath();
        ctx.arc(cx + vx, cy + vy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        // Magnitude text and frame indicator
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`|S| = ${signal.magnitude.toFixed(2)}`, cx, h - 10);

        // Show frame indicator
        ctx.fillStyle = this.labFrameMode ? '#ef4444' : '#94a3b8';
        ctx.font = '10px Inter';
        ctx.fillText(this.labFrameMode ? 'Lab Frame' : 'Rotating Frame', cx, 15);
    }

    renderObjectDensity(ctx, w, h) {
        const n = this.gridSize;
        const density = this.getObjectDensity();

        const margin = 15;
        const size = Math.min(w, h) - 2 * margin;
        const cellSize = size / n;
        const offsetX = (w - size) / 2;
        const offsetY = (h - size) / 2;

        // Draw density as grayscale image
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                const gray = Math.floor(rho * 255);

                ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
                ctx.fillRect(
                    offsetX + ix * cellSize,
                    offsetY + iy * cellSize,
                    cellSize,
                    cellSize
                );
            }
        }

        // Grid lines
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= n; i++) {
            ctx.beginPath();
            ctx.moveTo(offsetX + i * cellSize, offsetY);
            ctx.lineTo(offsetX + i * cellSize, offsetY + size);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(offsetX, offsetY + i * cellSize);
            ctx.lineTo(offsetX + size, offsetY + i * cellSize);
            ctx.stroke();
        }

        // Label
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Object: ' + this.objectType, w / 2, h - 5);
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    const simulator = new SpatialEncodingSimulator();
    simulator.init();

    // Initial MathJax render
    if (window.MathJax) {
        MathJax.typesetPromise();
    }
});
