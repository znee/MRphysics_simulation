/**
 * Part 3: Spatial Encoding Visualization with Moon-Phase Spheres
 *
 * Reference: J Magn Reson Imaging 35:1038-1054 (2012)
 * "Physics of MRI: A Primer" - Figures 14-16
 *
 * MOON-PHASE VISUALIZATION MODEL:
 * Each spin's phase is represented as a sphere with illumination that changes
 * like lunar phases - NOT just rotation of a half-moon, but actual change in
 * the illuminated area.
 *
 *   Phase = 0:    Full moon (100% white, all illuminated)
 *   Phase = π/2:  First quarter (right half lit, 50%)
 *   Phase = π:    New moon (0% white, all dark)
 *   Phase = 3π/2: Last quarter (left half lit, 50%)
 *
 * Physics formula: illumination = (1 + cos(phase)) / 2
 * Terminator ellipse width = |cos(phase)| × radius
 *
 * Module A: Gradient Encoding
 *   - 2D array of moon-phase spheres showing spatial phase patterns
 *   - Toggle Gx (frequency) and Gy (phase) gradients
 *   - Readout signal graph shows signal vs kx (time during readout)
 *   - Lab Frame toggle animates the readout sweep
 *
 * Module B: K-Space & Cartesian Sampling
 *   - Shows how gradient areas determine k-space position
 *   - Demonstrates Cartesian trajectory through k-space
 *   - S(kx,ky) = Σ ρ(x,y) · e^(-i2π(kx·x + ky·y))
 */

class SpatialEncodingSimulator {
    constructor() {
        // Current module
        this.currentModule = 'A';

        // Module A: Gradient controls
        this.gxEnabled = false;
        this.gyEnabled = false;
        this.gxStrength = 10;  // Match HTML default
        this.gyStrength = 10;  // Match HTML default
        this.gridSize = 16;

        // Animation time for smooth phase evolution
        this.animationTime = 0;
        this.animationId = null;
        this.isAnimating = false;

        // Module B: K-space controls
        this.kxPosition = 0;
        this.kyPosition = 0;
        this.objectType = 'uniform';
        this.kspaceData = null;
        this.kspaceSize = 17;  // -8 to +8 = 17 positions
        this.initKSpaceData();

        // Canvas contexts
        this.spinCtx = null;
        this.legendCtx = null;
        this.kspaceCtx = null;
        this.objectCtx = null;

        // Random signal per voxel
        this.randomSignalEnabled = false;
        this.voxelSignals = [];
        this.generateRandomSignals();
    }

    generateRandomSignals() {
        const maxVoxels = 32 * 32;
        this.voxelSignals = [];
        for (let i = 0; i < maxVoxels; i++) {
            this.voxelSignals.push(0.2 + Math.random() * 0.8);
        }
    }

    initKSpaceData() {
        this.kspaceData = [];
        for (let ky = 0; ky < this.kspaceSize; ky++) {
            this.kspaceData[ky] = [];
            for (let kx = 0; kx < this.kspaceSize; kx++) {
                this.kspaceData[ky][kx] = null;
            }
        }
    }

    computeFullKSpace() {
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                const kx = ikx - 8;
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

                const x = (ix / (n - 1)) * 2 - 1;
                const y = (iy / (n - 1)) * 2 - 1;

                const phase = 2 * Math.PI * (kx * x + ky * y) / 16;

                realSum += rho * Math.cos(phase);
                imagSum += rho * Math.sin(phase);
            }
        }

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
        const spinCanvas = document.getElementById('spin-canvas');
        if (spinCanvas) {
            this.spinCtx = spinCanvas.getContext('2d');
            this.resizeCanvas(spinCanvas);
        }

        const legendCanvas = document.getElementById('legend-canvas');
        if (legendCanvas) {
            this.legendCtx = legendCanvas.getContext('2d');
            this.resizeCanvas(legendCanvas);
        }

        const kspaceCanvas = document.getElementById('kspace-canvas');
        if (kspaceCanvas) {
            this.kspaceCtx = kspaceCanvas.getContext('2d');
            this.resizeCanvas(kspaceCanvas);
        }

        const objectCanvas = document.getElementById('object-canvas');
        if (objectCanvas) {
            this.objectCtx = objectCanvas.getContext('2d');
            this.resizeCanvas(objectCanvas);
        }

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

        // Module A: Gradient toggles (no animation - just static phase patterns)
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

        const reshuffleBtn = document.getElementById('reshuffle-btn');
        reshuffleBtn?.addEventListener('click', () => {
            this.generateRandomSignals();
            this.render();
        });

        // Animate Readout toggle
        const labFrameToggle = document.getElementById('lab-frame-toggle');
        if (labFrameToggle) {
            labFrameToggle.addEventListener('change', (e) => {
                console.log('Animation toggle:', e.target.checked);
                if (e.target.checked) {
                    this.startAnimation();
                } else {
                    this.stopAnimation();
                    this.render();
                }
            });
        } else {
            console.error('lab-frame-toggle element not found!');
        }

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
            this.computeFullKSpace();
            this.render();
        });

        const gridSizeB = document.getElementById('grid-size-b');
        gridSizeB?.addEventListener('change', (e) => {
            this.gridSize = parseInt(e.target.value);
            const gridSizeA = document.getElementById('grid-size');
            if (gridSizeA) gridSizeA.value = e.target.value;
            this.computeFullKSpace();
            this.render();
        });

        const randomSignalToggleB = document.getElementById('random-signal-toggle-b');
        randomSignalToggleB?.addEventListener('change', (e) => {
            this.randomSignalEnabled = e.target.checked;
            document.getElementById('random-seed-container-b').style.display =
                this.randomSignalEnabled ? 'flex' : 'none';
            const randomToggleA = document.getElementById('random-signal-toggle');
            if (randomToggleA) randomToggleA.checked = this.randomSignalEnabled;
            document.getElementById('random-seed-container').style.display =
                this.randomSignalEnabled ? 'flex' : 'none';
            this.computeFullKSpace();
            this.render();
        });

        const reshuffleBtnB = document.getElementById('reshuffle-btn-b');
        reshuffleBtnB?.addEventListener('click', () => {
            this.generateRandomSignals();
            this.computeFullKSpace();
            this.render();
        });

        // Sync grid size
        gridSize?.addEventListener('change', (e) => {
            const gridSizeB = document.getElementById('grid-size-b');
            if (gridSizeB) gridSizeB.value = e.target.value;
        });

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

        document.querySelectorAll('.module-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.module === module);
        });

        document.querySelectorAll('.module-controls').forEach(ctrl => {
            ctrl.style.display = 'none';
        });
        const controls = document.getElementById('controls-' + module);
        if (controls) controls.style.display = 'block';

        if (module === 'B') {
            this.computeFullKSpace();
        }

        this.updatePanelTitles();
        this.render();
    }

    updatePanelTitles() {
        const kspaceTitle = document.getElementById('kspace-title');
        const kspaceBadge = document.getElementById('kspace-badge');
        const objectTitle = document.getElementById('object-title');
        const spinBadge = document.getElementById('spin-badge');

        if (this.currentModule === 'A') {
            if (kspaceTitle) kspaceTitle.textContent = 'Phase Pattern (1D View)';
            if (kspaceBadge) kspaceBadge.textContent = 'Gradient Effect';
            if (objectTitle) objectTitle.textContent = 'Vector Sum';
            if (spinBadge) spinBadge.textContent = 'Phase Spheres';
        } else {
            if (kspaceTitle) kspaceTitle.textContent = 'K-Space (Cartesian)';
            if (kspaceBadge) kspaceBadge.textContent = '';
            if (objectTitle) objectTitle.textContent = 'Object Density';
            if (spinBadge) spinBadge.textContent = 'Phase Spheres';
        }
    }

    updateExplanation() {
        const explanation = document.getElementById('encoding-explanation');
        if (!explanation) return;

        if (!this.gxEnabled && !this.gyEnabled) {
            explanation.innerHTML =
                '<strong>No gradient:</strong> All spheres show the same phase (full moon = phase 0). ' +
                'Toggle gradients to see position-dependent phase encoding.';
        } else if (this.gxEnabled && !this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Gx (Frequency) active:</strong> Phase varies with x-position. ' +
                'Toggle "Animate Readout" to see phases evolve as kx sweeps during signal acquisition.';
        } else if (!this.gxEnabled && this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Gy (Phase) active:</strong> Each row gets a fixed phase offset (applied before readout). ' +
                'This creates horizontal stripe patterns - different ky lines in k-space.';
        } else {
            explanation.innerHTML =
                '<strong>Both gradients:</strong> Gy sets the ky line (phase encode step), ' +
                'Gx creates x-dependent phase during readout. Together they fill 2D k-space.';
        }
    }

    // ===================== ANIMATION =====================
    // Animation simulates the readout process:
    // - When Gx is on: phase accumulates over time, sweeping through kx
    // - animationTime represents position during readout (0 to 1)

    startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.animationTime = 0;

        const self = this;  // Ensure proper binding
        const animate = function() {
            // Cycle animation time for continuous loop
            // One full cycle = readout sweep from -kx_max to +kx_max
            self.animationTime += 0.006;  // Animation speed (slower for clarity)
            if (self.animationTime > 1) {
                self.animationTime = 0;  // Reset for loop
            }
            try {
                self.render();
            } catch (e) {
                console.error('Render error:', e);
            }
            if (self.isAnimating) {
                self.animationId = requestAnimationFrame(animate);
            }
        };
        this.animationId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.animationTime = 0;
    }

    // Get current kx position during animated readout
    getAnimatedKx() {
        // During readout, kx sweeps from -max to +max
        // animationTime: 0 → 1 maps to kx: -max → +max
        const kxMax = (this.gxStrength / 10) * 8;
        return (this.animationTime * 2 - 1) * kxMax;
    }

    // ===================== SPHERE RENDERING =====================

    /**
     * Draw a phase sphere with moon-phase shading
     * The illuminated area changes like moon phases (not just rotation)
     *
     * phase = 0: Full moon (100% white)
     * phase = π/2: First quarter (50% white, right side)
     * phase = π: New moon (0% white, all dark)
     * phase = 3π/2: Last quarter (50% white, left side)
     *
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} x - Center x coordinate
     * @param {number} y - Center y coordinate
     * @param {number} radius - Sphere radius
     * @param {number} phase - Phase angle in radians
     * @param {number} intensity - Signal intensity (0-1) affects brightness
     * @param {object} colorTint - Optional color tint {r, g, b} for the bright side
     */
    drawPhaseSphere(ctx, x, y, radius, phase, intensity = 1.0, colorTint = null) {
        // Normalize phase to 0-2π range
        phase = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // Bright side color (can be tinted)
        let brightR = 240, brightG = 240, brightB = 245;
        if (colorTint) {
            brightR = Math.floor(240 * 0.4 + colorTint.r * 0.6);
            brightG = Math.floor(240 * 0.4 + colorTint.g * 0.6);
            brightB = Math.floor(245 * 0.4 + colorTint.b * 0.6);
        }

        // Apply intensity
        brightR = Math.floor(brightR * intensity);
        brightG = Math.floor(brightG * intensity);
        brightB = Math.floor(brightB * intensity);

        // Dark side
        const darkR = Math.floor(35 * intensity);
        const darkG = Math.floor(35 * intensity);
        const darkB = Math.floor(40 * intensity);

        const brightColor = `rgb(${brightR}, ${brightG}, ${brightB})`;
        const darkColor = `rgb(${darkR}, ${darkG}, ${darkB})`;

        // Moon phase calculations
        // Illumination: 1 = full white, 0 = full black
        const illumination = (1 + Math.cos(phase)) / 2;

        // Terminator ellipse width (the shadow boundary)
        // This is the key: use cos(phase) for correct moon-phase geometry
        const termWidth = Math.abs(Math.cos(phase)) * radius;

        // Which side is lit? sin(phase) determines this
        const sinPhase = Math.sin(phase);
        const cosPhase = Math.cos(phase);

        ctx.save();

        // Clip to circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.clip();

        // Fill with dark background first
        ctx.fillStyle = darkColor;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

        // Draw the lit portion based on moon phase
        if (illumination > 0.001) {
            ctx.fillStyle = brightColor;
            ctx.beginPath();

            if (illumination > 0.999) {
                // Full moon - draw entire circle
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
            } else if (sinPhase >= 0) {
                // Phase 0 to π: lit side on RIGHT
                if (cosPhase >= 0) {
                    // Gibbous (more than half lit): right semicircle + left bulge
                    // Path: top → right edge → bottom → left side of ellipse → top
                    ctx.moveTo(x, y - radius);  // Top
                    ctx.arc(x, y, radius, -Math.PI/2, Math.PI/2, false);  // Right semicircle (top to bottom)
                    ctx.ellipse(x, y, termWidth, radius, 0, Math.PI/2, -Math.PI/2, false);  // Left of ellipse (bottom to top)
                } else {
                    // Crescent (less than half lit): thin sliver on right
                    // Path: top → right side of ellipse → bottom → right edge of circle → top
                    ctx.moveTo(x, y - radius);  // Top
                    ctx.ellipse(x, y, termWidth, radius, 0, -Math.PI/2, Math.PI/2, false);  // Right of ellipse (top to bottom)
                    ctx.arc(x, y, radius, Math.PI/2, -Math.PI/2, true);  // Right of circle (bottom to top)
                }
            } else {
                // Phase π to 2π: lit side on LEFT
                if (cosPhase >= 0) {
                    // Gibbous (more than half lit): left semicircle + right bulge
                    ctx.moveTo(x, y - radius);  // Top
                    ctx.arc(x, y, radius, -Math.PI/2, Math.PI/2, true);  // Left semicircle (top to bottom via left)
                    ctx.ellipse(x, y, termWidth, radius, 0, Math.PI/2, -Math.PI/2, true);  // Right of ellipse (bottom to top)
                } else {
                    // Crescent (less than half lit): thin sliver on left
                    ctx.moveTo(x, y - radius);  // Top
                    ctx.ellipse(x, y, termWidth, radius, 0, -Math.PI/2, Math.PI/2, true);  // Left of ellipse (top to bottom)
                    ctx.arc(x, y, radius, Math.PI/2, -Math.PI/2, false);  // Left of circle (bottom to top)
                }
            }

            ctx.closePath();
            ctx.fill();
        }

        // Add subtle 3D shading overlay
        const shadeGradient = ctx.createRadialGradient(
            x - radius * 0.3, y - radius * 0.3, 0,
            x, y, radius * 1.1
        );
        shadeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
        shadeGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.04)');
        shadeGradient.addColorStop(1, 'rgba(0, 0, 0, 0.15)');
        ctx.fillStyle = shadeGradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);

        ctx.restore();

        // Subtle border
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(60, 60, 80, ${0.25 + intensity * 0.15})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Small highlight
        if (radius > 4 && illumination > 0.2) {
            ctx.beginPath();
            ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.1, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.2 * intensity * illumination})`;
            ctx.fill();
        }
    }

    /**
     * Get color tint based on grid position
     * Creates visual distinction between different regions
     */
    getPositionColor(ix, iy, n) {
        // Normalize position to -1 to 1
        const nx = (ix / (n - 1)) * 2 - 1;
        const ny = (iy / (n - 1)) * 2 - 1;

        // Create color based on position
        // X position: cyan (left) to orange (right)
        // Y position: affects saturation
        const r = Math.floor(200 + nx * 55);        // More red/orange on right
        const g = Math.floor(180 - Math.abs(nx) * 30 - Math.abs(ny) * 20);  // Less green at edges
        const b = Math.floor(200 - nx * 55);        // More blue/cyan on left

        return { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) };
    }

    // ===================== OBJECT DENSITY =====================

    getVoxelSignal(ix, iy, n) {
        const voxelIndex = iy * n + ix;
        const randomFactor = this.randomSignalEnabled ? this.voxelSignals[voxelIndex] : 1.0;

        if (this.currentModule === 'A') {
            return randomFactor;
        }

        const x = (ix / (n - 1)) - 0.5;
        const y = (iy / (n - 1)) - 0.5;

        let baseRho = 0;
        switch (this.objectType) {
            case 'uniform':
                baseRho = 1;
                break;
            case 'circle':
                if (x * x + y * y < 0.3) baseRho = 1;
                break;
            case 'two-dots':
                const d1 = Math.sqrt((x + 0.25) ** 2 + y ** 2);
                const d2 = Math.sqrt((x - 0.25) ** 2 + y ** 2);
                if (d1 < 0.2 || d2 < 0.2) baseRho = 1;
                break;
            case 'line-h':
                if (Math.abs(y) < 0.2) baseRho = 1;
                break;
            case 'line-v':
                if (Math.abs(x) < 0.2) baseRho = 1;
                break;
            default:
                baseRho = 1;
        }

        return baseRho * randomFactor;
    }

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

    // ===================== PHASE CALCULATION =====================

    calculatePhase(ix, iy, n) {
        const x = (ix / (n - 1)) * 2 - 1;  // -1 to 1
        const y = (iy / (n - 1)) * 2 - 1;

        let phase = 0;

        if (this.currentModule === 'A') {
            // Phase encoding (Gy): Applied BEFORE readout, creates fixed phase offset
            if (this.gyEnabled) {
                const phaseFactor = (this.gyStrength / 10) * Math.PI;
                phase += phaseFactor * y;
            }

            // Frequency encoding (Gx): Applied DURING readout
            if (this.gxEnabled) {
                if (this.isAnimating) {
                    // During animated readout: phase accumulates with time
                    // kx(t) sweeps from -max to +max as animationTime goes 0→1
                    // Phase at position x: φ = 2π·kx·x / FOV_norm
                    const kxMax = 8;
                    const currentKx = (this.animationTime * 2 - 1) * kxMax;
                    phase += 2 * Math.PI * currentKx * x / 16;
                } else {
                    // Static view: show phase pattern at "end of readout" (kx = max)
                    const freqFactor = (this.gxStrength / 10) * Math.PI;
                    phase += freqFactor * x;
                }
            }
        } else {
            // Module B: k-space position determines phase
            phase = 2 * Math.PI * (this.kxPosition * x + this.kyPosition * y) / 16;
        }

        return phase;
    }

    calculateSignal() {
        // Calculate the net signal (sum of all spin vectors)
        // Uses Fourier convention: S = Σ ρ·e^(-i·phase)
        const n = this.gridSize;
        const density = this.getObjectDensity();

        let realSum = 0;
        let imagSum = 0;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;

                const phase = this.calculatePhase(ix, iy, n);
                // Fourier convention: e^(-iφ) = cos(φ) - i·sin(φ)
                realSum += rho * Math.cos(phase);
                imagSum -= rho * Math.sin(phase);
            }
        }

        return {
            real: realSum,
            imag: imagSum,
            magnitude: Math.sqrt(realSum * realSum + imagSum * imagSum),
            phase: Math.atan2(imagSum, realSum)
        };
    }

    // ===================== RENDERING =====================

    render() {
        this.renderSpinArray();
        this.renderPhaseLegend();
        this.renderKSpaceOrSignal();
        this.renderVectorSum();
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

        const margin = 60;
        const gridWidth = Math.min(w - 2 * margin, h - 2 * margin);
        const cellSize = gridWidth / n;
        const offsetX = (w - gridWidth) / 2;
        const offsetY = (h - gridWidth) / 2;

        const maxSphereRadius = Math.min(cellSize * 0.4, 25);

        // Draw grid lines (subtle)
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

        // Draw phase spheres with position-based color tinting
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                const cx = offsetX + (ix + 0.5) * cellSize;
                const cy = offsetY + (iy + 0.5) * cellSize;

                if (rho > 0.01) {
                    const phase = this.calculatePhase(ix, iy, n);
                    const sphereRadius = maxSphereRadius * (this.randomSignalEnabled ? Math.sqrt(rho) : 1);
                    // Get position-based color tint
                    const colorTint = this.getPositionColor(ix, iy, n);
                    this.drawPhaseSphere(ctx, cx, cy, sphereRadius, phase, rho, colorTint);
                } else {
                    // Empty voxel - just a faint outline
                    ctx.beginPath();
                    ctx.arc(cx, cy, maxSphereRadius * 0.5, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#334155';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        // Title/info overlay
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f59e0b';

        if (this.currentModule === 'A') {
            let status = 'No gradient active';
            if (this.gxEnabled && this.gyEnabled) {
                status = `Gx=${this.gxStrength}, Gy=${this.gyStrength}`;
            } else if (this.gxEnabled) {
                status = `Gx=${this.gxStrength} (Frequency Encoding)`;
            } else if (this.gyEnabled) {
                status = `Gy=${this.gyStrength} (Phase Encoding)`;
            }
            ctx.fillText(status, 10, 18);
        } else {
            ctx.fillText(`k = (${this.kxPosition}, ${this.kyPosition})`, 10, 18);
        }

        // Axis labels
        ctx.font = '11px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';

        // X-axis label
        ctx.fillText('X (Frequency Direction)', offsetX + gridWidth / 2, h - 10);

        // Y-axis label (rotated)
        ctx.save();
        ctx.translate(15, offsetY + gridWidth / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Y (Phase Direction)', 0, 0);
        ctx.restore();

        // Position markers at corners
        ctx.font = '10px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('-x', offsetX, offsetY + gridWidth + 20);
        ctx.textAlign = 'right';
        ctx.fillText('+x', offsetX + gridWidth, offsetY + gridWidth + 20);
        ctx.textAlign = 'left';
        ctx.fillText('+y', offsetX - 25, offsetY + 10);
        ctx.fillText('-y', offsetX - 25, offsetY + gridWidth);
    }

    renderPhaseLegend() {
        // Renders a pulse sequence diagram connected to current encoding state
        if (!this.legendCtx) return;
        const ctx = this.legendCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Show animation indicator
        if (this.isAnimating) {
            ctx.fillStyle = '#22d3ee';
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'right';
            ctx.fillText(`▶ ANIMATING (${(this.animationTime * 100).toFixed(0)}%)`, w - 5, 12);
        }

        // Margins and layout
        const margin = { left: 45, right: 15, top: 20, bottom: 15 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;

        // Define channels (from top to bottom)
        const channels = [
            { name: 'RF', color: '#f59e0b', waveform: 'rf' },
            { name: 'Gz', color: '#10b981', waveform: 'slice' },
            { name: 'Gy', color: '#ef4444', waveform: 'phase' },
            { name: 'Gx', color: '#a855f7', waveform: 'read' },
            { name: 'Signal', color: '#22d3ee', waveform: 'signal' }
        ];

        const channelHeight = plotH / channels.length;
        const baselineOffset = channelHeight * 0.5;

        // Determine current time position for Module A animation
        // animationTime is 0→1, representing kx sweep from -max to +max
        const isModuleA = this.currentModule === 'A';
        const animProgress = isModuleA ? this.animationTime : 0;

        // Gx width varies with strength (more area = more k-space coverage)
        // But TE (echo center) stays at a fixed position
        const tePosition = margin.left + plotW * 0.725;  // Fixed TE position
        const gxWidthFactor = isModuleA && this.gxEnabled ?
            (Math.abs(this.gxStrength) / 20 + 0.3) : 1.0;  // 0.3 to 1.3
        const readoutWidth = plotW * 0.35 * gxWidthFactor;
        // Gx expands from center (TE) - starts earlier, ends later
        const readoutStart = tePosition - readoutWidth / 2;

        // Draw each channel
        channels.forEach((ch, i) => {
            const y = margin.top + i * channelHeight + baselineOffset;

            // Channel label - highlight if active in Module A
            ctx.font = '9px Inter';
            let labelColor = ch.color;
            if (isModuleA) {
                if (ch.waveform === 'phase' && !this.gyEnabled) labelColor = '#334155';
                if (ch.waveform === 'read' && !this.gxEnabled) labelColor = '#334155';
            }
            ctx.fillStyle = labelColor;
            ctx.textAlign = 'right';
            ctx.fillText(ch.name, margin.left - 5, y + 3);

            // Baseline
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + plotW, y);
            ctx.stroke();

            // Draw waveform
            const amp = channelHeight * 0.35;
            const xStart = margin.left;

            switch (ch.waveform) {
                case 'rf':
                    ctx.strokeStyle = ch.color;
                    ctx.fillStyle = ch.color;
                    ctx.lineWidth = 2;
                    this.drawRFPulse(ctx, xStart + plotW * 0.15, y, plotW * 0.08, amp);
                    break;

                case 'slice':
                    ctx.strokeStyle = ch.color;
                    ctx.fillStyle = ch.color;
                    ctx.lineWidth = 2;
                    this.drawTrapezoid(ctx, xStart + plotW * 0.1, y, plotW * 0.18, amp, ch.color);
                    this.drawTrapezoid(ctx, xStart + plotW * 0.28, y, plotW * 0.06, -amp * 0.5, ch.color);
                    break;

                case 'phase':
                    // Phase encoding gradient
                    if (isModuleA) {
                        // Module A: Show on/off state and strength
                        if (this.gyEnabled) {
                            const phaseAmp = amp * (this.gyStrength / 10);
                            ctx.strokeStyle = ch.color;
                            ctx.fillStyle = ch.color;
                            ctx.lineWidth = 2;
                            this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.12, phaseAmp, ch.color);
                            // "ON" indicator
                            ctx.font = 'bold 7px Inter';
                            ctx.fillStyle = '#10b981';
                            ctx.textAlign = 'center';
                            ctx.fillText('ON', xStart + plotW * 0.41, y - amp - 3);
                        } else {
                            // Show dimmed placeholder
                            ctx.globalAlpha = 0.2;
                            ctx.strokeStyle = ch.color;
                            ctx.lineWidth = 1;
                            this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.12, amp * 0.5, ch.color);
                            ctx.globalAlpha = 1.0;
                            ctx.font = '7px Inter';
                            ctx.fillStyle = '#64748b';
                            ctx.textAlign = 'center';
                            ctx.fillText('OFF', xStart + plotW * 0.41, y - amp * 0.5 - 3);
                        }
                    } else {
                        // Module B: Show current ky position
                        const phaseAmp = amp * (this.kyPosition / 8);
                        ctx.strokeStyle = ch.color;
                        ctx.fillStyle = ch.color;
                        ctx.lineWidth = 2;
                        this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.12, phaseAmp, ch.color);
                        // Show stepped lines
                        ctx.globalAlpha = 0.15;
                        for (let step = -4; step <= 4; step += 2) {
                            const stepAmp = amp * (step / 4);
                            this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.12, stepAmp, ch.color);
                        }
                        ctx.globalAlpha = 1.0;
                        // ky label
                        ctx.font = 'bold 7px Inter';
                        ctx.fillStyle = ch.color;
                        ctx.textAlign = 'center';
                        ctx.fillText(`ky=${this.kyPosition}`, xStart + plotW * 0.41, y - Math.abs(phaseAmp) - 5);
                    }
                    break;

                case 'read':
                    // Frequency encoding gradient
                    // k-space coverage = gradient AREA (amplitude × time)
                    // For educational clarity: amplitude fixed, duration varies with strength
                    if (isModuleA) {
                        // Module A: Show on/off state
                        if (this.gxEnabled) {
                            const readAmp = amp;  // Fixed amplitude
                            const dephaserWidth = plotW * 0.08 * gxWidthFactor;

                            ctx.strokeStyle = ch.color;
                            ctx.fillStyle = ch.color;
                            ctx.lineWidth = 2;
                            // Dephaser (half area, opposite polarity)
                            this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, dephaserWidth, -readAmp * 0.5, ch.color);
                            // Readout gradient - fixed timing (TE constant)
                            this.drawTrapezoid(ctx, readoutStart, y, readoutWidth, readAmp, ch.color);
                            // Animation time marker - shows current position during readout
                            if (this.isAnimating && animProgress > 0) {
                                const timeX = readoutStart + readoutWidth * animProgress;
                                // Vertical line
                                ctx.strokeStyle = '#22d3ee';
                                ctx.lineWidth = 2;
                                ctx.setLineDash([3, 2]);
                                ctx.beginPath();
                                ctx.moveTo(timeX, y - readAmp - 12);
                                ctx.lineTo(timeX, y + 5);
                                ctx.stroke();
                                ctx.setLineDash([]);
                                // Dot
                                ctx.beginPath();
                                ctx.arc(timeX, y - readAmp - 5, 5, 0, 2 * Math.PI);
                                ctx.fillStyle = '#22d3ee';
                                ctx.fill();
                                ctx.strokeStyle = '#fff';
                                ctx.lineWidth = 1.5;
                                ctx.stroke();
                                // kx label
                                const kxMax = 8;
                                const currentKx = (animProgress * 2 - 1) * kxMax;
                                ctx.font = 'bold 7px Inter';
                                ctx.fillStyle = '#22d3ee';
                                ctx.textAlign = 'center';
                                ctx.fillText(`kx=${currentKx.toFixed(1)}`, timeX, y - readAmp - 16);
                            }
                            ctx.font = 'bold 7px Inter';
                            ctx.fillStyle = '#10b981';
                            ctx.textAlign = 'center';
                            ctx.fillText('ON', readoutStart + readoutWidth / 2, y - amp - 3);
                        } else {
                            // Show dimmed placeholder
                            ctx.globalAlpha = 0.2;
                            ctx.strokeStyle = ch.color;
                            ctx.lineWidth = 1;
                            this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.08, -amp * 0.25, ch.color);
                            this.drawTrapezoid(ctx, xStart + plotW * 0.55, y, plotW * 0.35, amp * 0.5, ch.color);
                            ctx.globalAlpha = 1.0;

                            // Still show animation marker even when Gx is off (to show readout timing)
                            if (this.isAnimating && animProgress > 0) {
                                const timeX = xStart + plotW * 0.55 + plotW * 0.35 * animProgress;
                                ctx.strokeStyle = '#22d3ee';
                                ctx.lineWidth = 2;
                                ctx.setLineDash([3, 2]);
                                ctx.beginPath();
                                ctx.moveTo(timeX, y - amp * 0.5 - 8);
                                ctx.lineTo(timeX, y + 5);
                                ctx.stroke();
                                ctx.setLineDash([]);
                                ctx.beginPath();
                                ctx.arc(timeX, y - amp * 0.5 - 3, 4, 0, 2 * Math.PI);
                                ctx.fillStyle = '#22d3ee';
                                ctx.fill();
                            }

                            ctx.font = '7px Inter';
                            ctx.fillStyle = '#64748b';
                            ctx.textAlign = 'center';
                            ctx.fillText('OFF', xStart + plotW * 0.725, y - amp * 0.5 - 3);
                        }
                    } else {
                        // Module B: Show kx position during readout
                        ctx.strokeStyle = ch.color;
                        ctx.fillStyle = ch.color;
                        ctx.lineWidth = 2;
                        this.drawTrapezoid(ctx, xStart + plotW * 0.35, y, plotW * 0.08, -amp * 0.5, ch.color);
                        this.drawTrapezoid(ctx, xStart + plotW * 0.55, y, plotW * 0.35, amp, ch.color);
                        // kx marker
                        const kxPos = (this.kxPosition + 8) / 16;
                        const markerX = xStart + plotW * 0.55 + plotW * 0.35 * kxPos;
                        ctx.beginPath();
                        ctx.arc(markerX, y - amp - 5, 4, 0, 2 * Math.PI);
                        ctx.fill();
                        // kx label
                        ctx.font = 'bold 7px Inter';
                        ctx.textAlign = 'center';
                        ctx.fillText(`kx=${this.kxPosition}`, markerX, y - amp - 12);
                    }
                    break;

                case 'signal':
                    ctx.strokeStyle = ch.color;
                    ctx.fillStyle = ch.color;
                    ctx.lineWidth = 2;
                    // Signal spans same duration as readout gradient - echo at center
                    this.drawEcho(ctx, readoutStart, y, readoutWidth, amp * 0.8);
                    break;
            }
        });

        // Time axis
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, h - margin.bottom);
        ctx.lineTo(margin.left + plotW, h - margin.bottom);
        ctx.stroke();

        // Arrow
        ctx.beginPath();
        ctx.moveTo(margin.left + plotW, h - margin.bottom);
        ctx.lineTo(margin.left + plotW - 6, h - margin.bottom - 3);
        ctx.lineTo(margin.left + plotW - 6, h - margin.bottom + 3);
        ctx.closePath();
        ctx.fillStyle = '#475569';
        ctx.fill();

        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('time', margin.left + plotW - 15, h - 3);

        // TE marker (at center of readout = echo position)
        const teX = readoutStart + readoutWidth / 2;
        const signalY = margin.top + 4 * channelHeight + baselineOffset;  // Signal channel position
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 7px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('TE', teX, signalY + channelHeight * 0.4 + 10);

        // Module indicator
        ctx.font = 'bold 8px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText(isModuleA ? 'Gradient Encoding' : 'K-Space Sampling', margin.left, margin.top - 8);
    }

    // Helper: Draw RF pulse (sinc-like)
    drawRFPulse(ctx, x, y, width, amp) {
        ctx.beginPath();
        const numPoints = 30;
        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * 2 - 1;  // -1 to 1
            const sinc = t === 0 ? 1 : Math.sin(t * Math.PI * 2) / (t * Math.PI * 2);
            const envelope = Math.cos(t * Math.PI / 2);  // Smooth envelope
            const px = x + (i / numPoints) * width;
            const py = y - sinc * envelope * amp;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    // Helper: Draw trapezoid gradient
    drawTrapezoid(ctx, x, y, width, amp, color) {
        const ramp = width * 0.15;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + ramp, y - amp);
        ctx.lineTo(x + width - ramp, y - amp);
        ctx.lineTo(x + width, y);
        ctx.strokeStyle = color;
        ctx.stroke();

        // Fill with transparency
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }

    // Helper: Draw echo signal
    drawEcho(ctx, x, y, width, amp) {
        ctx.beginPath();
        const numPoints = 50;
        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * 2 - 1;  // -1 to 1
            // Gaussian envelope centered at middle
            const envelope = Math.exp(-t * t * 4);
            // Oscillation
            const osc = Math.cos(t * Math.PI * 6);
            const px = x + (i / numPoints) * width;
            const py = y - envelope * osc * amp;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    renderKSpaceOrSignal() {
        if (!this.kspaceCtx) return;
        const ctx = this.kspaceCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        if (this.currentModule === 'A') {
            this.render1DPhasePattern(ctx, w, h);
        } else {
            this.renderKSpaceGrid(ctx, w, h);
        }
    }

    render1DPhasePattern(ctx, w, h) {
        // Show the 1D phase pattern along x-axis (like Figure 15)
        // Physics: Signal S(kx) = Σ ρ(x,y) · e^(-i·2π·kx·x)
        const margin = { top: 50, right: 30, bottom: 50, left: 50 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;

        const n = this.gridSize;

        // Title - explain what we're showing
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';

        let title = '1D Phase Pattern (middle row)';
        if (!this.gxEnabled && !this.gyEnabled) {
            title = 'No gradient - all spins aligned';
        } else if (this.gxEnabled && !this.gyEnabled) {
            title = 'Gx creates x-dependent phase';
        } else if (!this.gxEnabled && this.gyEnabled) {
            title = 'Gy creates y-dependent phase (rows)';
        } else {
            title = 'Gx + Gy: 2D phase encoding';
        }
        ctx.fillText(title, margin.left, 25);

        // Draw sphere array representing middle row (like Figure 15)
        const sphereRadius = Math.min(plotW / (n * 2.5), 20);
        const sphereY = margin.top + plotH * 0.3;
        const sphereSpacing = plotW / n;

        // Get middle row index
        const midRow = Math.floor(n / 2);

        for (let ix = 0; ix < n; ix++) {
            const cx = margin.left + sphereSpacing * (ix + 0.5);
            const phase = this.calculatePhase(ix, midRow, n);
            this.drawPhaseSphere(ctx, cx, sphereY, sphereRadius, phase, 1.0);
        }

        // X position labels
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('-x', margin.left + sphereSpacing * 0.5, sphereY + sphereRadius + 15);
        ctx.fillText('+x', margin.left + sphereSpacing * (n - 0.5), sphereY + sphereRadius + 15);

        // Draw signal graph below (sum of all spins vs k-space position)
        const graphY = margin.top + plotH * 0.6;
        const graphH = plotH * 0.32;

        // Axes
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, graphY);
        ctx.lineTo(margin.left + plotW, graphY);
        ctx.moveTo(margin.left + plotW / 2, graphY - graphH / 2);
        ctx.lineTo(margin.left + plotW / 2, graphY + graphH / 2);
        ctx.stroke();

        // Calculate signal S(kx, ky) using proper Fourier transform
        // S(kx, ky) = Σ ρ(x,y) · e^(-i·2π·(kx·x + ky·y))
        const numPoints = 80;
        const signalData = [];
        const density = this.getObjectDensity();

        // Determine ky based on Gy setting (phase encode step)
        const kyValue = this.gyEnabled ? (this.gyStrength / 10) * 8 : 0;

        // Sweep through kx values (like during readout)
        for (let i = 0; i < numPoints; i++) {
            const t = (i / (numPoints - 1)) * 2 - 1;  // -1 to 1
            const kx = t * 8;  // k-space position: -8 to +8

            let realSum = 0;
            let imagSum = 0;

            for (let iy = 0; iy < n; iy++) {
                for (let ix = 0; ix < n; ix++) {
                    const rho = density[iy][ix];
                    if (rho < 0.01) continue;

                    const x = (ix / (n - 1)) * 2 - 1;  // -1 to 1
                    const y = (iy / (n - 1)) * 2 - 1;

                    // Standard k-space phase: φ = 2π(kx·x + ky·y) / FOV_norm
                    // FOV normalization: divide by 16 since k ranges -8 to +8 and x ranges -1 to +1
                    const phase = 2 * Math.PI * (kx * x + kyValue * y) / 16;

                    realSum += rho * Math.cos(phase);
                    imagSum -= rho * Math.sin(phase);  // Negative for e^(-iφ)
                }
            }

            signalData.push({
                kx,
                real: realSum,
                imag: imagSum,
                mag: Math.sqrt(realSum * realSum + imagSum * imagSum)
            });
        }

        // Find max for scaling - scale each component independently for visibility
        const maxReal = Math.max(...signalData.map(s => Math.abs(s.real)), 1);
        const maxImag = Math.max(...signalData.map(s => Math.abs(s.imag)), 0.1);

        // Check if imaginary is significant relative to real
        const imagIsSignificant = maxImag > maxReal * 0.05;

        // Use common scale if both are similar magnitude, otherwise scale independently
        const realScale = maxReal;
        const imagScale = imagIsSignificant ? maxReal : maxImag;  // Scale imag to fill space if it's small

        // Draw real signal
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        signalData.forEach((s, i) => {
            const x = margin.left + (i / (numPoints - 1)) * plotW;
            const y = graphY - (s.real / realScale) * (graphH / 2) * 0.85;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw imaginary signal
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        signalData.forEach((s, i) => {
            const x = margin.left + (i / (numPoints - 1)) * plotW;
            const y = graphY - (s.imag / imagScale) * (graphH / 2) * 0.85;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Add note if imaginary is scaled differently
        if (!imagIsSignificant && maxImag > 0.01) {
            ctx.font = '7px Inter';
            ctx.fillStyle = '#f59e0b';
            ctx.textAlign = 'right';
            ctx.fillText('(scaled ×' + (realScale/imagScale).toFixed(0) + ')', margin.left + plotW, graphY + graphH/2 - 2);
        }

        // Draw animated kx position marker ONLY during animation
        // This shows time progression during readout, NOT gradient strength change
        if (this.gxEnabled && this.isAnimating) {
            // kx sweeps from -max to +max as time progresses during readout
            // animationTime: 0→1 maps to kx: -kxMax → +kxMax
            const kxMax = 8;  // Full k-space range
            const currentKx = (this.animationTime * 2 - 1) * kxMax;
            const markerX = margin.left + this.animationTime * plotW;

            // Vertical line at current kx (time position)
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(markerX, graphY - graphH / 2);
            ctx.lineTo(markerX, graphY + graphH / 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Marker dot on the signal curve
            const currentIdx = Math.round(this.animationTime * (numPoints - 1));
            if (currentIdx >= 0 && currentIdx < signalData.length) {
                const s = signalData[currentIdx];
                const dotY = graphY - (s.real / realScale) * (graphH / 2) * 0.85;
                ctx.beginPath();
                ctx.arc(markerX, dotY, 6, 0, 2 * Math.PI);
                ctx.fillStyle = '#22d3ee';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Label showing current kx (time during readout)
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = '#22d3ee';
            ctx.textAlign = 'center';
            ctx.fillText(`kx=${currentKx.toFixed(1)} (readout)`, markerX, graphY - graphH / 2 - 5);
        }

        // When NOT animating but Gx is on, show informative text
        if (this.gxEnabled && !this.isAnimating) {
            ctx.font = '9px Inter';
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'center';
            ctx.fillText('Toggle "Lab Frame" to animate readout sweep →', margin.left + plotW / 2, graphY - graphH / 2 - 5);
        }

        // Legend
        ctx.font = '9px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#10b981';
        ctx.fillText('● Real', margin.left + plotW - 75, graphY - graphH / 2 + 12);
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('● Imag', margin.left + plotW - 35, graphY - graphH / 2 + 12);

        // Readout label (prominent)
        ctx.font = 'bold 10px Inter';
        ctx.fillStyle = '#a855f7';
        ctx.textAlign = 'left';
        ctx.fillText('← READOUT SIGNAL →', margin.left, graphY - graphH / 2 - 8);

        // Axis labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('kx (time during readout)', margin.left + plotW / 2, h - 10);

        // K-space extremes with time correspondence
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('-kx (t=0)', margin.left, graphY + graphH / 2 + 12);
        ctx.textAlign = 'right';
        ctx.fillText('+kx (t=TE)', margin.left + plotW, graphY + graphH / 2 + 12);
        ctx.textAlign = 'center';
        ctx.fillText('0 (echo)', margin.left + plotW / 2, graphY + graphH / 2 + 12);

        // Show ky value if Gy is active
        if (this.gyEnabled) {
            ctx.font = '9px Inter';
            ctx.fillStyle = '#ef4444';
            ctx.textAlign = 'right';
            ctx.fillText(`ky = ${kyValue.toFixed(1)} (phase encode)`, margin.left + plotW, 25);
        }
    }

    renderKSpaceGrid(ctx, w, h) {
        const margin = { top: 30, right: 20, bottom: 30, left: 30 };
        const size = Math.min(w - margin.left - margin.right, h - margin.top - margin.bottom);
        const offsetX = margin.left + (w - margin.left - margin.right - size) / 2;
        const offsetY = margin.top + (h - margin.top - margin.bottom - size) / 2;

        const cellSize = size / this.kspaceSize;

        // Find max magnitude
        let maxMag = 0;
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                if (this.kspaceData[iky][ikx] !== null) {
                    maxMag = Math.max(maxMag, this.kspaceData[iky][ikx]);
                }
            }
        }
        if (maxMag === 0) maxMag = 1;

        // Draw k-space as image
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                const mag = this.kspaceData[iky][ikx];
                const x = offsetX + ikx * cellSize;
                const y = offsetY + (this.kspaceSize - 1 - iky) * cellSize;

                if (mag !== null) {
                    const logMag = Math.log10(mag * 100 + 1) / Math.log10(maxMag * 100 + 1);
                    const brightness = Math.floor(logMag * 255);
                    ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
                } else {
                    ctx.fillStyle = '#1a1a2e';
                }
                ctx.fillRect(x, y, cellSize, cellSize);
            }
        }

        // Draw grid
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

        // Draw axes at center
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

        // Highlight current ky LINE (Cartesian sampling line)
        const currentIky = this.kyPosition + 8;
        const lineY = offsetY + (this.kspaceSize - 1 - currentIky) * cellSize;

        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
        ctx.fillRect(offsetX, lineY, size, cellSize);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(offsetX, lineY, size, cellSize);

        // Readout direction arrow
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(offsetX + 10, lineY + cellSize / 2);
        ctx.lineTo(offsetX + size - 10, lineY + cellSize / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(offsetX + size - 10, lineY + cellSize / 2);
        ctx.lineTo(offsetX + size - 18, lineY + cellSize / 2 - 5);
        ctx.lineTo(offsetX + size - 18, lineY + cellSize / 2 + 5);
        ctx.closePath();
        ctx.fillStyle = '#a855f7';
        ctx.fill();

        // Highlight current kx position
        const currentIkx = this.kxPosition + 8;
        const highlightX = offsetX + currentIkx * cellSize;

        ctx.beginPath();
        ctx.arc(highlightX + cellSize / 2, lineY + cellSize / 2, cellSize / 2 + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#a855f7';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('kx (Readout)', offsetX + size / 2, h - 5);
        ctx.save();
        ctx.translate(12, offsetY + size / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillText('ky (Phase Encode)', 0, 0);
        ctx.restore();

        // Title
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'right';
        ctx.fillText('Cartesian K-Space', w - 10, 15);

        // Info
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ef4444';
        ctx.font = '10px Inter';
        ctx.fillText(`ky=${this.kyPosition}`, 10, 15);
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`kx=${this.kxPosition}`, 10, 28);
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
            this.renderResultantVector(ctx, w, h);
        } else {
            this.renderObjectDensity(ctx, w, h);
            // Update signal display
            const signal = this.calculateSignalAtKSpace(this.kxPosition, this.kyPosition);
            const realEl = document.getElementById('signal-real');
            const imagEl = document.getElementById('signal-imag');
            const magEl = document.getElementById('signal-mag');
            if (realEl) realEl.textContent = signal.real.toFixed(2);
            if (imagEl) imagEl.textContent = signal.imag.toFixed(2);
            if (magEl) magEl.textContent = signal.magnitude.toFixed(2);
        }
    }

    renderResultantVector(ctx, w, h) {
        // Simplified visualization for medical students:
        // Show sample spin arrows and their sum → demonstrates constructive/destructive interference
        const n = this.gridSize;
        const density = this.getObjectDensity();

        // Get current kx for animation
        const kyValue = this.gyEnabled ? (this.gyStrength / 10) * 8 : 0;
        const currentKx = this.isAnimating ? (this.animationTime * 2 - 1) * 8 :
                          (this.gxEnabled ? (this.gxStrength / 10) * 8 : 0);

        // Calculate current signal
        let realSum = 0, imagSum = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;
                const x = (ix / (n - 1)) * 2 - 1;
                const y = (iy / (n - 1)) * 2 - 1;
                const phase = 2 * Math.PI * (currentKx * x + kyValue * y) / 16;
                realSum += rho * Math.cos(phase);
                imagSum -= rho * Math.sin(phase);
            }
        }
        const magnitude = Math.sqrt(realSum * realSum + imagSum * imagSum);

        // Calculate max signal (at kx=0, ky=0) for normalization
        let maxSignal = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                maxSignal += density[iy][ix];
            }
        }
        maxSignal = Math.max(maxSignal, 1);
        const signalPercent = (magnitude / maxSignal) * 100;

        // Layout
        const margin = 10;
        const barHeight = 25;
        const arrowAreaHeight = h - barHeight - margin * 4 - 35;

        // Title
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Why Signal Changes', w / 2, 14);

        // Draw sample arrows showing phase spread
        const arrowCx = w / 2;
        const arrowCy = margin + 25 + arrowAreaHeight / 2;
        const arrowRadius = Math.min(arrowAreaHeight / 2 - 10, w / 2 - 20);

        // Sample 8 positions across x to show phase variation
        const numArrows = 8;
        const arrowLength = arrowRadius * 0.7;

        // Draw faint circle for reference
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(arrowCx, arrowCy, arrowRadius * 0.85, 0, 2 * Math.PI);
        ctx.stroke();

        // Draw individual spin arrows (sample from middle row)
        const midRow = Math.floor(n / 2);
        const sampleIndices = [];
        for (let i = 0; i < numArrows; i++) {
            sampleIndices.push(Math.floor(i * (n - 1) / (numArrows - 1)));
        }

        // Draw each sample arrow
        sampleIndices.forEach((ix, i) => {
            const x = (ix / (n - 1)) * 2 - 1;
            const phase = 2 * Math.PI * (currentKx * x + kyValue * 0) / 16;

            const dx = Math.cos(phase) * arrowLength * 0.4;
            const dy = -Math.sin(phase) * arrowLength * 0.4;

            // Arrow color based on position (left=cyan, right=orange)
            const t = i / (numArrows - 1);
            const r = Math.floor(80 + t * 175);
            const g = Math.floor(200 - t * 50);
            const b = Math.floor(220 - t * 150);

            ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(arrowCx, arrowCy);
            ctx.lineTo(arrowCx + dx, arrowCy + dy);
            ctx.stroke();

            // Arrowhead
            const angle = Math.atan2(dy, dx);
            ctx.beginPath();
            ctx.moveTo(arrowCx + dx, arrowCy + dy);
            ctx.lineTo(arrowCx + dx - 6 * Math.cos(angle - 0.4), arrowCy + dy - 6 * Math.sin(angle - 0.4));
            ctx.lineTo(arrowCx + dx - 6 * Math.cos(angle + 0.4), arrowCy + dy - 6 * Math.sin(angle + 0.4));
            ctx.closePath();
            ctx.fill();
        });

        // Draw resultant vector (sum) - thick white arrow
        const sumDx = (realSum / maxSignal) * arrowLength;
        const sumDy = -(imagSum / maxSignal) * arrowLength;

        if (magnitude > 0.1) {
            ctx.strokeStyle = '#fff';
            ctx.fillStyle = '#fff';
            ctx.lineWidth = 3;

            ctx.beginPath();
            ctx.moveTo(arrowCx, arrowCy);
            ctx.lineTo(arrowCx + sumDx, arrowCy + sumDy);
            ctx.stroke();

            // Arrowhead
            const sumAngle = Math.atan2(sumDy, sumDx);
            ctx.beginPath();
            ctx.moveTo(arrowCx + sumDx, arrowCy + sumDy);
            ctx.lineTo(arrowCx + sumDx - 10 * Math.cos(sumAngle - 0.4), arrowCy + sumDy - 10 * Math.sin(sumAngle - 0.4));
            ctx.lineTo(arrowCx + sumDx - 10 * Math.cos(sumAngle + 0.4), arrowCy + sumDy - 10 * Math.sin(sumAngle + 0.4));
            ctx.closePath();
            ctx.fill();
        }

        // Signal strength bar at bottom
        const barY = h - barHeight - margin - 15;
        const barWidth = w - margin * 4;
        const barX = margin * 2;

        // Bar background
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // Filled portion based on signal strength
        const fillWidth = (magnitude / maxSignal) * barWidth;
        const barColor = signalPercent > 50 ? '#10b981' : (signalPercent > 20 ? '#f59e0b' : '#ef4444');
        ctx.fillStyle = barColor;
        ctx.fillRect(barX, barY, fillWidth, barHeight);

        // Signal percentage text
        ctx.font = 'bold 12px Inter';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(`${signalPercent.toFixed(0)}%`, barX + barWidth / 2, barY + barHeight / 2 + 4);

        // Label
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('Signal Strength', w / 2, h - 5);

        // Explanation text
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        if (signalPercent > 70) {
            ctx.fillStyle = '#10b981';
            ctx.fillText('Arrows aligned → Strong signal', w / 2, barY - 5);
        } else if (signalPercent < 30) {
            ctx.fillStyle = '#ef4444';
            ctx.fillText('Arrows spread → Weak signal (cancel)', w / 2, barY - 5);
        } else {
            ctx.fillText('Partial alignment → Medium signal', w / 2, barY - 5);
        }

        // Show kx value during animation
        if (this.isAnimating) {
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = '#22d3ee';
            ctx.textAlign = 'right';
            ctx.fillText(`kx=${currentKx.toFixed(1)}`, w - 5, 14);
        }
    }

    renderObjectDensity(ctx, w, h) {
        const n = this.gridSize;
        const density = this.getObjectDensity();

        const margin = 15;
        const size = Math.min(w, h) - 2 * margin;
        const cellSize = size / n;
        const offsetX = (w - size) / 2;
        const offsetY = (h - size) / 2;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                const gray = Math.floor(rho * 255);
                ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
                ctx.fillRect(offsetX + ix * cellSize, offsetY + iy * cellSize, cellSize, cellSize);
            }
        }

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

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Object: ' + this.objectType, w / 2, h - 5);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const simulator = new SpatialEncodingSimulator();
    simulator.init();

    if (window.MathJax) {
        MathJax.typesetPromise();
    }
});
