/**
 * Part 3: Spatial Encoding Visualization with Phase Spheres
 *
 * Based on "Physics of MRI: A Primer" Figures 14-16
 * Each spin is represented as a sphere with black/white halves
 * The phase angle determines which side is visible
 *
 * Module A: Gradient Encoding
 *   - 2D array of phase spheres
 *   - Toggle on/off for Gx (frequency) and Gy (phase) gradients
 *   - Spheres rotate to show phase accumulation
 *
 * Module B: K-Space & Cartesian Sampling
 *   - Shows how gradient areas determine k-space position
 *   - Demonstrates Cartesian trajectory through k-space
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
        this.gridSize = 8;

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
        const maxVoxels = 16 * 16;
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

        // Module A: Gradient toggles
        const gxToggle = document.getElementById('gx-toggle');
        gxToggle?.addEventListener('change', (e) => {
            this.gxEnabled = e.target.checked;
            document.getElementById('gx-strength-container').style.display =
                this.gxEnabled ? 'flex' : 'none';
            this.updateExplanation();
            if (this.gxEnabled || this.gyEnabled) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
            this.render();
        });

        const gyToggle = document.getElementById('gy-toggle');
        gyToggle?.addEventListener('change', (e) => {
            this.gyEnabled = e.target.checked;
            document.getElementById('gy-strength-container').style.display =
                this.gyEnabled ? 'flex' : 'none';
            this.updateExplanation();
            if (this.gxEnabled || this.gyEnabled) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
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

        // Lab frame toggle (now controls sphere rotation animation)
        const labFrameToggle = document.getElementById('lab-frame-toggle');
        labFrameToggle?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startAnimation();
            } else {
                this.stopAnimation();
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
                '<strong>No gradient:</strong> All spheres show the same phase (white side facing you). ' +
                'Toggle gradients to see position-dependent phase encoding.';
        } else if (this.gxEnabled && !this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Gx (Frequency) active:</strong> Spheres rotate at different speeds based on x-position. ' +
                'Left spins accumulate negative phase (rotate one way), right spins positive phase (rotate other way).';
        } else if (!this.gxEnabled && this.gyEnabled) {
            explanation.innerHTML =
                '<strong>Gy (Phase) active:</strong> Each row gets a fixed phase offset. ' +
                'Top rows show one phase, bottom rows show another - creating horizontal stripes.';
        } else {
            explanation.innerHTML =
                '<strong>Both gradients:</strong> Phase varies in both x and y directions. ' +
                'This creates 2D spatial encoding - the foundation of MRI image formation.';
        }
    }

    // ===================== ANIMATION =====================

    startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.animationTime = 0;

        const animate = () => {
            this.animationTime += 0.02;  // Increment animation time
            this.render();
            if (this.isAnimating) {
                this.animationId = requestAnimationFrame(animate);
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

    // ===================== SPHERE RENDERING =====================

    /**
     * Draw a phase sphere - a circle with black/white halves
     * The phase determines the rotation of the black/white boundary
     *
     * Based on Figure 14 from "Physics of MRI: A Primer"
     *
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} x - Center x coordinate
     * @param {number} y - Center y coordinate
     * @param {number} radius - Sphere radius
     * @param {number} phase - Phase angle in radians (0 = white facing, π = black facing)
     * @param {number} intensity - Signal intensity (0-1) affects brightness
     */
    drawPhaseSphere(ctx, x, y, radius, phase, intensity = 1.0) {
        // Normalize phase to 0-2π range
        phase = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // Create the sphere appearance using a gradient
        // The gradient direction is perpendicular to the phase angle
        const gradAngle = phase + Math.PI / 2;
        const gradLength = radius * 1.2;

        const x1 = x - gradLength * Math.cos(gradAngle);
        const y1 = y + gradLength * Math.sin(gradAngle);  // Note: canvas y is inverted
        const x2 = x + gradLength * Math.cos(gradAngle);
        const y2 = y - gradLength * Math.sin(gradAngle);

        // Create linear gradient from white to black
        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);

        // Adjust colors based on intensity
        const white = Math.floor(220 * intensity + 35);
        const black = Math.floor(30 * intensity + 10);

        gradient.addColorStop(0, `rgb(${white}, ${white}, ${white})`);
        gradient.addColorStop(0.4, `rgb(${Math.floor((white + black) / 2)}, ${Math.floor((white + black) / 2)}, ${Math.floor((white + black) / 2)})`);
        gradient.addColorStop(1, `rgb(${black}, ${black}, ${black})`);

        // Draw the sphere (circle with gradient fill)
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Add a subtle border to define the sphere
        ctx.strokeStyle = `rgba(100, 100, 100, ${0.3 + intensity * 0.4})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Add 3D highlight effect (small white arc on top-left)
        ctx.beginPath();
        ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.15, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.2 * intensity})`;
        ctx.fill();
    }

    // ===================== OBJECT DENSITY =====================

    getVoxelSignal(ix, iy, n) {
        const voxelIndex = iy * 16 + ix;
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
            // Frequency encoding: phase accumulates with position * time
            if (this.gxEnabled) {
                const freqFactor = (this.gxStrength / 10) * Math.PI;
                phase += freqFactor * x * (1 + this.animationTime * 2);
            }
            // Phase encoding: fixed phase offset based on position
            if (this.gyEnabled) {
                const phaseFactor = (this.gyStrength / 10) * Math.PI;
                phase += phaseFactor * y;
            }
        } else {
            // Module B: k-space position determines phase
            phase = 2 * Math.PI * (this.kxPosition * x + this.kyPosition * y) / 16;
        }

        return phase;
    }

    calculateSignal() {
        const n = this.gridSize;
        const density = this.getObjectDensity();

        let realSum = 0;
        let imagSum = 0;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;

                const phase = this.calculatePhase(ix, iy, n);
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

        // Draw phase spheres
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                const cx = offsetX + (ix + 0.5) * cellSize;
                const cy = offsetY + (iy + 0.5) * cellSize;

                if (rho > 0.01) {
                    const phase = this.calculatePhase(ix, iy, n);
                    const sphereRadius = maxSphereRadius * (this.randomSignalEnabled ? Math.sqrt(rho) : 1);
                    this.drawPhaseSphere(ctx, cx, cy, sphereRadius, phase, rho);
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
        if (!this.legendCtx) return;
        const ctx = this.legendCtx;
        const canvas = ctx.canvas;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Title
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        ctx.fillText('Phase Sphere Legend', w / 2, 18);

        // Draw example spheres at different phases
        const cx = w / 2;
        const sphereRadius = Math.min(w * 0.15, 25);
        const phases = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
        const labels = ['0°', '90°', '180°', '270°'];
        const startY = 50;
        const spacing = 55;

        phases.forEach((phase, i) => {
            const y = startY + i * spacing;
            this.drawPhaseSphere(ctx, cx, y, sphereRadius, phase, 1.0);

            ctx.font = '10px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], cx, y + sphereRadius + 15);
        });

        // Explanation at bottom
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        const bottomY = h - 30;
        ctx.fillText('White side = positive phase', w / 2, bottomY);
        ctx.fillText('Black side = negative phase', w / 2, bottomY + 12);
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
        const margin = { top: 50, right: 30, bottom: 50, left: 50 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;

        const n = this.gridSize;

        // Title
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        ctx.fillText('1D Phase Pattern (middle row)', margin.left, 25);

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

        // Draw signal graph below (sum of all spins)
        const graphY = margin.top + plotH * 0.55;
        const graphH = plotH * 0.35;

        // Axes
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, graphY);
        ctx.lineTo(margin.left + plotW, graphY);
        ctx.moveTo(margin.left, graphY - graphH / 2);
        ctx.lineTo(margin.left, graphY + graphH / 2);
        ctx.stroke();

        // Calculate total signal vs time (or gradient area)
        const numPoints = 50;
        const signalData = [];

        // Store original animation time
        const originalTime = this.animationTime;

        for (let i = 0; i < numPoints; i++) {
            const t = (i / (numPoints - 1)) * 2 - 1;  // -1 to 1
            // Temporarily set animation time to calculate signal at this point
            this.animationTime = t;

            const signal = this.calculateSignal();
            signalData.push({ t, real: signal.real, imag: signal.imag, mag: signal.magnitude });
        }

        // Restore animation time
        this.animationTime = originalTime;

        // Find max for scaling
        const maxSig = Math.max(...signalData.map(s => s.mag), 1);

        // Draw real signal
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        signalData.forEach((s, i) => {
            const x = margin.left + (i / (numPoints - 1)) * plotW;
            const y = graphY - (s.real / maxSig) * (graphH / 2) * 0.9;
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
            const y = graphY - (s.imag / maxSig) * (graphH / 2) * 0.9;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Legend
        ctx.font = '10px Inter';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#10b981';
        ctx.fillText('Real', margin.left + plotW - 80, graphY - graphH / 2 + 15);
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Imag', margin.left + plotW - 40, graphY - graphH / 2 + 15);

        // Axis labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('Gradient Area (kx)', margin.left + plotW / 2, h - 15);
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
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.35;

        const signal = this.calculateSignal();
        const n = this.gridSize;
        const density = this.getObjectDensity();

        let maxSignal = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                maxSignal += density[iy][ix];
            }
        }
        maxSignal = Math.max(maxSignal, 1);

        const scaleFactor = radius / maxSignal;

        // Draw unit circle
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

        // Draw vector
        const vx = signal.real * scaleFactor;
        const vy = -signal.imag * scaleFactor;

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

        // Endpoint
        ctx.beginPath();
        ctx.arc(cx + vx, cy + vy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        // Magnitude
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`|S| = ${signal.magnitude.toFixed(2)}`, cx, h - 10);

        // Axis labels
        ctx.font = '10px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Real', cx + radius + 5, cy - 5);
        ctx.fillText('Imag', cx + 5, cy - radius - 5);
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
