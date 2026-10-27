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
 *
 * K-SPACE UNITS (Modules A & B): k is in cycles per FOV (Δk = 1/FOV).
 *   Phase-encode step m twists the phase by m full cycles across the FOV;
 *   k_max = N/2 makes neighbouring voxels differ by π (Nyquist).
 *
 * Module C: Readout → K-Space → Image
 *   - Stage 1: every voxel contributes ρ·e^(-iφ); the coil records only the sum,
 *     one k-space sample per readout point, one ky line per phase-encode step
 *   - Stage 2: inverse FT adds the spatial-frequency patterns back, either
 *     centre-out (coarse → fine) or in scan order; the sum, and so the final
 *     image, is the same either way (a scanner does it all at once with an FFT)
 *
 * Module D: Frequency Encoding → Fourier
 *   - Readout gradient: each x precesses at f(x) = γ̄·Gx·x
 *   - Received signal = sum of all frequencies; DFT recovers the 1D profile
 *   - FOV = BW / (γ̄·Gx), Δx = FOV / N; objects outside the FOV wrap (alias)
 *
 * Module E: Slice Selection
 *   - f(z) = γ̄·Gz·z; RF bandwidth BW excites Δz = BW / (γ̄·Gz)
 *   - Sinc RF pulse ↔ slice profile (Fourier pair, small-tip approximation)
 */

// Gyromagnetic ratio γ̄ = γ/2π for 1H in Hz per (mT/m · mm): f = 42.58 · G[mT/m] · x[mm]
const GAMMA_BAR_HZ_PER_MT_M_MM = 42.58;

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
        this.kspaceSize = this.gridSize;  // k = -N/2 .. N/2-1 (cycles per FOV)
        this.initKSpaceData();

        // Module C: Readout → k-space → image
        this.recon = {
            object: 'L',
            n: 8,
            stage: 'acquire',   // 'acquire' → 'decompose' → 'done'
            line: 0,            // phase-encode line index (ky = line - N/2)
            sample: -1,         // last acquired sample on the current line (-1 = none yet)
            kspace: [],         // N×N complex samples (null = not acquired)
            order: [],          // stage-2 component order (see orderMode)
            orderMode: 'centre', // 'centre': increasing |k| (rings) | 'scan': line by line, as acquired
            compIndex: 0,       // number of components added back
            image: [],          // N×N complex partial reconstruction
            flash: null,        // {ikx, iky, time} for the k-space "write" flash
            pauseUntil: 0,      // short hold between stages
            noiseSigma: 0.4,    // receiver noise σ per k-space sample (one voxel's signal = 1)
            nex: 1,             // number of averages: σ_eff = σ/√NEX
            noise: [],          // N×N standard-normal draws {re, im} (fixed until "New noise")
            speed: 1,
            playing: false,
            animationId: null,
            lastTime: 0,
            accumulator: 0
        };
        this.resetRecon();

        // Module E: Slice selection
        this.slice = {
            gz: 10,         // mT/m
            duration: 2,    // ms (RF pulse length T)
            tbw: 4,         // time-bandwidth product (sinc zero crossings)
            fcKHz: 0,       // RF center frequency offset (kHz) → slice position
            flip: 90        // nominal flip angle (degrees)
        };

        // Module D: Frequency encoding → Fourier
        this.freq = {
            object: 'two',
            gx: 5,          // mT/m
            bwKHz: 32,      // receiver bandwidth (kHz) = 1/Δt
            numSamples: 64, // N
            t: -0.5,        // readout cursor: -0.5 (start) → 0 (echo) → +0.5 (end)
            playing: false,
            animationId: null,
            noise: 'off',   // receiver noise level: 'off' | 'low' | 'high'
            noiseZ: [],     // standard-normal draws per sample (fixed until "New noise")
            lockFov: false, // true: Gx is rescaled with BW so the FOV stays fixed
            fovLock: 150
        };
        this.drawFreqNoise();

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
        this.kspaceSize = this.gridSize;
        this.kspaceData = [];
        for (let ky = 0; ky < this.kspaceSize; ky++) {
            this.kspaceData[ky] = [];
            for (let kx = 0; kx < this.kspaceSize; kx++) {
                this.kspaceData[ky][kx] = null;
            }
        }
    }

    computeFullKSpace() {
        if (this.kspaceSize !== this.gridSize) this.initKSpaceData();
        const half = this.kspaceSize / 2;
        for (let iky = 0; iky < this.kspaceSize; iky++) {
            for (let ikx = 0; ikx < this.kspaceSize; ikx++) {
                const kx = ikx - half;
                const ky = iky - half;
                const signal = this.calculateSignalAtKSpace(kx, ky);
                this.kspaceData[iky][ikx] = signal.magnitude;
            }
        }
    }

    /**
     * Phase of voxel (ix, iy) at k-space position (kx, ky), k in cycles per FOV:
     * φ = 2π(kx·x + ky·y), with x, y the voxel-center positions in FOV units.
     * Symmetric centering keeps symmetric objects' k-space real, and a uniform
     * object gives exactly zero signal at every integer k ≠ 0.
     */
    kPhase(kx, ky, ix, iy, n) {
        const xc = (ix - (n - 1) / 2) / n;
        const yc = (iy - (n - 1) / 2) / n;
        return 2 * Math.PI * (kx * xc + ky * yc);
    }

    /**
     * Net signal S(kx, ky) = Σ ρ(x,y) · e^(-iφ) (convention of the UI equation)
     */
    signalAt(kx, ky, density = this.getObjectDensity()) {
        const n = this.gridSize;
        let realSum = 0;
        let imagSum = 0;

        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = density[iy][ix];
                if (rho < 0.01) continue;
                const phase = this.kPhase(kx, ky, ix, iy, n);
                realSum += rho * Math.cos(phase);
                imagSum -= rho * Math.sin(phase);  // e^(-iφ)
            }
        }

        return {
            real: realSum,
            imag: imagSum,
            magnitude: Math.sqrt(realSum * realSum + imagSum * imagSum),
            phase: Math.atan2(imagSum, realSum)
        };
    }

    calculateSignalAtKSpace(kx, ky) {
        return this.signalAt(kx, ky);
    }

    /**
     * Module A k-space position (cycles per FOV) implied by the gradient controls.
     * Static view: kx = Gx/10, ky = Gy/10 (strength 10 = one cycle across FOV).
     * Animated readout: kx sweeps -N/2 → +N/2 (echo at kx = 0).
     */
    getModuleAK() {
        const ky = this.gyEnabled ? this.gyStrength / 10 : 0;
        let kx = 0;
        if (this.gxEnabled) {
            kx = this.isAnimating ? this.getAnimatedKx() : this.gxStrength / 10;
        }
        return { kx, ky };
    }

    /**
     * Clamp Module B k sliders to the k-space of the current grid: -N/2 .. N/2-1
     */
    updateKSliderRanges() {
        const half = this.gridSize / 2;
        const sliders = [
            ['kx-position', 'kx-val', 'kxPosition'],
            ['ky-position', 'ky-val', 'kyPosition']
        ];
        sliders.forEach(([sliderId, labelId, key]) => {
            const slider = document.getElementById(sliderId);
            this[key] = Math.max(-half, Math.min(half - 1, this[key]));
            if (slider) {
                slider.min = -half;
                slider.max = half - 1;
                slider.value = this[key];
            }
            const label = document.getElementById(labelId);
            if (label) label.textContent = this[key];
        });
    }

    init() {
        this.setupCanvases();
        this.setupEventListeners();
        this.updateKSliderRanges();
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

        // Module C has its own two-row layout (① Acquire / ② Reconstruct)
        this.reconCtx = {};
        ['voxels', 'acquire', 'seq', 'phasor', 'decompose', 'image', 'weight'].forEach(key => {
            const canvas = document.getElementById(`recon-${key}-canvas`);
            if (canvas) this.reconCtx[key] = canvas.getContext('2d');
        });

        window.addEventListener('resize', () => {
            this.resizeVisibleCanvases();
            this.render();
        });
    }

    // Size the canvases of whichever layout is visible (the other one has no box while hidden)
    resizeVisibleCanvases() {
        const canvases = this.currentModule === 'C'
            ? Object.values(this.reconCtx).map(ctx => ctx.canvas)
            : [this.spinCtx, this.legendCtx, this.kspaceCtx, this.objectCtx].filter(Boolean).map(ctx => ctx.canvas);
        canvases.forEach(canvas => this.resizeCanvas(canvas));
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
            this.updateKSliderRanges();
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
            this.updateKSliderRanges();
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

        // Module C: Readout → k-space → image controls
        const resetReconView = () => {
            this.stopReconAnimation();
            this.resetRecon();
            this.stopReconAnimation();  // refresh the Play label for the new state
            this.updatePanelTitles();
            this.render();
        };
        document.getElementById('recon-object')?.addEventListener('change', (e) => {
            this.recon.object = e.target.value;
            resetReconView();
        });
        document.getElementById('recon-n')?.addEventListener('change', (e) => {
            this.recon.n = parseInt(e.target.value);
            resetReconView();
            this.updateReconNoiseLabel();
        });
        document.getElementById('recon-order')?.addEventListener('change', (e) => {
            const r = this.recon;
            r.orderMode = e.target.value;
            if (r.stage === 'acquire') {
                this.render();
                return;
            }
            // K-space is already full: restart the decomposition in the new order
            const wasPlaying = r.playing;
            this.stopReconAnimation();
            this.startDecompose();
            r.pauseUntil = 0;
            if (wasPlaying) this.startReconAnimation();
            else this.stopReconAnimation();  // refresh the Play label
            this.render();
        });
        document.getElementById('recon-reset')?.addEventListener('click', resetReconView);
        document.getElementById('recon-play')?.addEventListener('click', () => {
            if (this.recon.playing) {
                this.stopReconAnimation();
                this.render();
            } else {
                this.startReconAnimation();
            }
        });
        document.getElementById('recon-step')?.addEventListener('click', () => {
            this.stopReconAnimation();
            if (this.recon.stage !== 'done') this.reconStep();
            this.stopReconAnimation();
            this.render();
        });
        document.getElementById('recon-skip')?.addEventListener('click', () => {
            if (this.recon.stage === 'acquire') {
                this.startDecompose();
                this.recon.pauseUntil = 0;
                this.render();
            }
        });
        document.getElementById('recon-speed')?.addEventListener('input', (e) => {
            this.recon.speed = parseFloat(e.target.value);
            document.getElementById('recon-speed-val').textContent = `${this.recon.speed.toFixed(2)}×`;
        });
        const noiseChanged = () => {
            this.updateReconNoiseLabel();
            this.recomputeReconImage();
            this.render();
        };
        document.getElementById('recon-noise')?.addEventListener('input', (e) => {
            this.recon.noiseSigma = parseFloat(e.target.value);
            noiseChanged();
        });
        document.getElementById('recon-nex')?.addEventListener('change', (e) => {
            this.recon.nex = parseInt(e.target.value);
            noiseChanged();
        });
        document.getElementById('recon-newnoise')?.addEventListener('click', () => {
            this.drawReconNoise();
            noiseChanged();
        });

        // Module E: Slice selection controls
        const sliceSliders = [
            ['slice-gz', 'gz', v => `${v} mT/m`],
            ['slice-duration', 'duration', v => `${v.toFixed(1)} ms`],
            ['slice-tbw', 'tbw', v => `TBW = ${v}`],
            ['slice-fc', 'fcKHz', v => `${v.toFixed(1)} kHz`]
        ];
        sliceSliders.forEach(([id, key, fmt]) => {
            document.getElementById(id)?.addEventListener('input', (e) => {
                this.slice[key] = parseFloat(e.target.value);
                document.getElementById(id + '-val').textContent = fmt(this.slice[key]);
                this.render();
            });
        });

        // Module D: Frequency encoding controls
        document.getElementById('freq-object')?.addEventListener('change', (e) => {
            this.freq.object = e.target.value;
            this.render();
        });
        document.getElementById('freq-gx')?.addEventListener('input', (e) => {
            this.freq.gx = parseFloat(e.target.value);
            document.getElementById('freq-gx-val').textContent = `${this.freq.gx.toFixed(1)} mT/m`;
            if (this.freq.lockFov) this.freq.fovLock = this.getFreqParams().fov;
            this.render();
        });
        document.getElementById('freq-bw')?.addEventListener('input', (e) => {
            this.freq.bwKHz = parseFloat(e.target.value);
            document.getElementById('freq-bw-val').textContent = `${this.freq.bwKHz} kHz`;
            if (this.freq.lockFov) {
                // Scanner behaviour: keep the FOV by rescaling Gx = BW / (γ̄·FOV)
                const gx = this.freq.bwKHz * 1000 / (GAMMA_BAR_HZ_PER_MT_M_MM * this.freq.fovLock);
                this.freq.gx = Math.max(0.5, Math.min(20, gx));
                document.getElementById('freq-gx').value = this.freq.gx;
                document.getElementById('freq-gx-val').textContent = `${this.freq.gx.toFixed(2)} mT/m (auto)`;
            }
            this.render();
        });
        document.getElementById('freq-noise')?.addEventListener('change', (e) => {
            this.freq.noise = e.target.value;
            this.render();
        });
        document.getElementById('freq-newnoise')?.addEventListener('click', () => {
            this.drawFreqNoise();
            this.render();
        });
        document.getElementById('freq-lockfov')?.addEventListener('change', (e) => {
            this.freq.lockFov = e.target.checked;
            this.freq.fovLock = this.getFreqParams().fov;
            this.render();
        });
        document.getElementById('freq-n')?.addEventListener('change', (e) => {
            this.freq.numSamples = parseInt(e.target.value);
            this.render();
        });
        document.getElementById('freq-time')?.addEventListener('input', (e) => {
            this.freq.t = parseInt(e.target.value) / 1000;
            this.render();
        });
        document.getElementById('freq-play-btn')?.addEventListener('click', () => {
            if (this.freq.playing) {
                this.stopFreqAnimation();
            } else {
                this.startFreqAnimation();
            }
        });
    }

    switchModule(module) {
        const previous = this.currentModule;
        this.currentModule = module;

        // Only the visible module may animate
        if (previous === 'C' && module !== 'C') this.stopReconAnimation();
        if (previous === 'D' && module !== 'D') this.stopFreqAnimation();
        if (previous === 'A' && module !== 'A' && this.isAnimating) this.stopAnimation();
        const labFrameToggle = document.getElementById('lab-frame-toggle');
        if (module === 'A' && labFrameToggle?.checked && !this.isAnimating) this.startAnimation();

        document.querySelectorAll('.module-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.module === module);
        });

        document.querySelectorAll('.module-controls').forEach(ctrl => {
            ctrl.style.display = 'none';
        });
        const controls = document.getElementById('controls-' + module);
        if (controls) controls.style.display = 'block';

        // Module C uses its own two-row layout; the others share the 4-panel grid
        const reconLayout = document.getElementById('recon-layout');
        const sharedGrid = document.querySelector('.viz-grid');
        if (reconLayout && sharedGrid) {
            reconLayout.style.display = module === 'C' ? 'flex' : 'none';
            sharedGrid.style.display = module === 'C' ? 'none' : '';
            sharedGrid.parentElement.classList.toggle('recon-mode', module === 'C');
        }
        this.resizeVisibleCanvases();

        if (module === 'B') {
            this.computeFullKSpace();
        }

        this.updatePanelTitles();
        this.render();

        if (window.MathJax && MathJax.typesetPromise && controls) {
            MathJax.typesetPromise([controls]).catch(() => {});
        }
    }

    updatePanelTitles() {
        const kspaceTitle = document.getElementById('kspace-title');
        const kspaceBadge = document.getElementById('kspace-badge');
        const objectTitle = document.getElementById('object-title');
        const spinBadge = document.getElementById('spin-badge');
        const spinTitle = document.getElementById('spin-title');
        const legendBadge = document.getElementById('legend-badge');

        const titles = {
            A: { spin: '2D Spin Array', legend: 'Cartesian' },
            B: { spin: '2D Spin Array', legend: 'Cartesian' },
            C: this.recon.stage === 'acquire'
                ? { spin: 'Voxel Signals → Σ (Coil)', spinBadge: 'Stage 1: Acquire', legend: 'Readout',
                    kspace: 'Summed Readout → K-Space', kspaceBadge: 'One sample per Σ', object: 'Phasor Sum = S(kx, ky)' }
                : { spin: 'Reconstructed Image', spinBadge: 'Stage 2: Decompose', legend: 'Done',
                    kspace: 'K-Space → Spatial-Frequency Patterns', kspaceBadge: 'Inverse FT', object: 'Component Weight' },
            D: { spin: 'Object & Spin Phase', spinBadge: 'f(x) = γ̄·Gx·x', legend: 'Readout',
                 kspace: 'Signal → FFT → Profile', kspaceBadge: '1D Imaging', object: 'Phasor Sum' },
            E: { spin: 'Resonance vs Position', spinBadge: 'f(z) = γ̄·Gz·z', legend: 'Slice Select',
                 kspace: 'RF Pulse ↔ Slice Profile', kspaceBadge: 'Fourier Pair', object: 'Slice Geometry' }
        }[this.currentModule];
        if (spinTitle) spinTitle.textContent = titles.spin;
        if (legendBadge) legendBadge.textContent = titles.legend;

        if (['C', 'D', 'E'].includes(this.currentModule)) {
            if (spinBadge) spinBadge.textContent = titles.spinBadge;
            if (kspaceTitle) kspaceTitle.textContent = titles.kspace;
            if (kspaceBadge) kspaceBadge.textContent = titles.kspaceBadge;
            if (objectTitle) objectTitle.textContent = titles.object;
            return;
        }

        if (this.currentModule === 'A') {
            if (kspaceTitle) kspaceTitle.textContent = 'Phase Pattern (1D View)';
            if (kspaceBadge) kspaceBadge.textContent = 'Gradient Effect';
            if (objectTitle) objectTitle.textContent = 'Vector Sum';
            if (spinBadge) spinBadge.textContent = 'Phase Spheres';
        } else {
            if (kspaceTitle) kspaceTitle.textContent = 'K-Space (Cartesian)';
            if (kspaceBadge) kspaceBadge.textContent = '';
            if (objectTitle) objectTitle.textContent = 'Signal Vector';
            if (spinBadge) spinBadge.textContent = 'Phase Encoding';
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
        // During readout, kx sweeps from -kmax to +kmax (cycles per FOV)
        // animationTime: 0 → 1 maps to kx: -N/2 → +N/2 (echo at the middle)
        const kxMax = this.gridSize / 2;
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
        if (this.currentModule === 'A') {
            // Gy (phase encoding): applied BEFORE readout → fixed phase imprint (ky)
            // Gx (frequency encoding): applied DURING readout → kx grows with time
            const { kx, ky } = this.getModuleAK();
            return this.kPhase(kx, ky, ix, iy, n);
        }
        // Module B: k-space position determines phase
        return this.kPhase(this.kxPosition, this.kyPosition, ix, iy, n);
    }

    calculateSignal() {
        // Net signal (sum of all spin vectors), Fourier convention S = Σ ρ·e^(-i·phase)
        if (this.currentModule === 'A') {
            const { kx, ky } = this.getModuleAK();
            return this.signalAt(kx, ky);
        }
        return this.signalAt(this.kxPosition, this.kyPosition);
    }

    // ===================== RENDERING =====================

    render() {
        if (this.currentModule === 'C') {
            this.renderReconModule();
            return;
        }
        if (this.currentModule === 'E') {
            this.renderSliceModule();
            return;
        }
        if (this.currentModule === 'D') {
            this.renderFreqModule();
            return;
        }
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
                        const phaseAmp = amp * (this.kyPosition / (this.gridSize / 2));
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
                                const currentKx = this.getAnimatedKx();
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
                        const kxPos = (this.kxPosition + this.gridSize / 2) / this.gridSize;
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
        // S(kx, ky) = Σ ρ(x,y) · e^(-i·2π·(kx·x + ky·y)), k in cycles per FOV
        const kxMax = n / 2;
        const numPoints = Math.max(81, 20 * kxMax + 1);  // ~10 points per k unit → smooth sinc echo
        const signalData = [];
        const density = this.getObjectDensity();

        // Determine ky based on Gy setting (phase encode step)
        const kyValue = this.gyEnabled ? this.gyStrength / 10 : 0;

        // Sweep through kx values (like during readout): -N/2 → +N/2
        for (let i = 0; i < numPoints; i++) {
            const t = (i / (numPoints - 1)) * 2 - 1;  // -1 to 1
            const kx = t * kxMax;
            const s = this.signalAt(kx, kyValue, density);
            signalData.push({ kx, real: s.real, imag: s.imag, mag: s.magnitude });
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

        // Add note if imaginary is scaled differently (skip when Imag is numerically zero)
        const trueMaxImag = Math.max(...signalData.map(s => Math.abs(s.imag)));
        if (!imagIsSignificant && trueMaxImag > maxReal * 1e-6) {
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
            const currentKx = this.getAnimatedKx();
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
            ctx.fillText('Toggle "Animate Readout" to sweep kx →', margin.left + plotW / 2, graphY - graphH / 2 - 5);
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
        ctx.fillText(`kx = -${kxMax} (start)`, margin.left, graphY + graphH / 2 + 12);
        ctx.textAlign = 'right';
        ctx.fillText(`kx = +${kxMax} (end)`, margin.left + plotW, graphY + graphH / 2 + 12);
        ctx.textAlign = 'center';
        ctx.fillText('0 (echo, t = TE)', margin.left + plotW / 2, graphY + graphH / 2 + 12);

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
        // DC (k = 0) sits at index N/2 of the -N/2 .. N/2-1 grid
        const half = this.kspaceSize / 2;
        const centerX = offsetX + half * cellSize + cellSize / 2;
        const centerY = offsetY + (this.kspaceSize - 1 - half) * cellSize + cellSize / 2;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(offsetX, centerY);
        ctx.lineTo(offsetX + size, centerY);
        ctx.moveTo(centerX, offsetY);
        ctx.lineTo(centerX, offsetY + size);
        ctx.stroke();

        // Highlight current ky LINE (Cartesian sampling line)
        const currentIky = this.kyPosition + half;
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
        const currentIkx = this.kxPosition + half;
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
            // Module B: Show k-space sample as vector in complex plane
            this.renderKSpaceVector(ctx, w, h);
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

    renderKSpaceVector(ctx, w, h) {
        // Module B: Show the k-space sample as a phasor/vector in complex plane
        // This matches Figure 16 in "Physics of MRI: A Primer"
        const signal = this.calculateSignalAtKSpace(this.kxPosition, this.kyPosition);

        // Calculate max signal for scaling (at k=0)
        const signalAtZero = this.calculateSignalAtKSpace(0, 0);
        const maxSignal = Math.max(signalAtZero.magnitude, 1);

        // Layout
        const cx = w / 2;
        const cy = h / 2 + 10;
        const radius = Math.min(w, h) * 0.38;

        // Title
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`K-Space Sample (${this.kxPosition}, ${this.kyPosition})`, cx, 14);

        // Draw complex plane axes
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        // Real axis
        ctx.beginPath();
        ctx.moveTo(cx - radius - 10, cy);
        ctx.lineTo(cx + radius + 10, cy);
        ctx.stroke();
        // Imag axis
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius - 10);
        ctx.lineTo(cx, cy + radius + 10);
        ctx.stroke();

        // Axis labels
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('Re', cx + radius + 2, cy - 3);
        ctx.textAlign = 'center';
        ctx.fillText('Im', cx + 8, cy - radius - 2);

        // Draw reference circle (unit circle scaled)
        ctx.strokeStyle = '#334155';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.8, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);

        // Scale factor for the vector
        const scale = (radius * 0.8) / maxSignal;

        // Draw the signal vector
        const vx = signal.real * scale;
        const vy = -signal.imag * scale;  // Flip for screen coordinates (y up)

        // Vector line
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + vx, cy + vy);
        ctx.stroke();

        // Arrowhead
        if (signal.magnitude > 0.1) {
            const angle = Math.atan2(vy, vx);
            ctx.fillStyle = '#22d3ee';
            ctx.beginPath();
            ctx.moveTo(cx + vx, cy + vy);
            ctx.lineTo(cx + vx - 10 * Math.cos(angle - 0.4), cy + vy - 10 * Math.sin(angle - 0.4));
            ctx.lineTo(cx + vx - 10 * Math.cos(angle + 0.4), cy + vy - 10 * Math.sin(angle + 0.4));
            ctx.closePath();
            ctx.fill();
        }

        // Draw endpoint marker
        ctx.beginPath();
        ctx.arc(cx + vx, cy + vy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Show magnitude as arc
        if (signal.magnitude > 0.5) {
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const magRadius = signal.magnitude * scale;
            ctx.arc(cx, cy, magRadius, 0, 2 * Math.PI);
            ctx.stroke();
        }

        // Phase angle indicator
        if (signal.magnitude > 0.5) {
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + 15, cy);
            ctx.arc(cx, cy, 15, 0, -signal.phase, signal.phase > 0);
            ctx.stroke();
        }

        // Info text
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('Signal = Σ spins × e^(-i·phase)', cx, h - 8);

        // Show k-space position context
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        if (this.kxPosition === 0 && this.kyPosition === 0) {
            ctx.fillStyle = '#10b981';
            ctx.fillText('Center (DC): Max signal', 5, h - 22);
        } else {
            ctx.fillText(`kx=${this.kxPosition}, ky=${this.kyPosition}`, 5, h - 22);
        }
    }

    renderResultantVector(ctx, w, h) {
        // Simplified visualization for medical students:
        // Show sample spin arrows and their sum → demonstrates constructive/destructive interference
        const n = this.gridSize;
        const density = this.getObjectDensity();

        // Current k-space position (same as the phase spheres)
        const { kx: currentKx, ky: kyValue } = this.getModuleAK();

        // Current signal S = Σ ρ·e^(-iφ)
        const signal = this.signalAt(currentKx, kyValue, density);
        const realSum = signal.real;
        const imagSum = signal.imag;
        const magnitude = signal.magnitude;

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

        // Draw spin arrows showing phase spread
        const arrowCx = w / 2;
        const arrowCy = margin + 25 + arrowAreaHeight / 2;
        const arrowRadius = Math.min(arrowAreaHeight / 2 - 10, w / 2 - 20);
        const arrowLength = arrowRadius * 0.7;

        // Draw faint circle for reference
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(arrowCx, arrowCy, arrowRadius * 0.85, 0, 2 * Math.PI);
        ctx.stroke();

        // One arrow per voxel of the middle row (sampling fewer voxels would alias at high k:
        // arrows would look aligned while their true sum cancels)
        const midRow = Math.floor(n / 2);
        for (let ix = 0; ix < n; ix++) {
            if (density[midRow][ix] < 0.01) continue;
            const phase = this.kPhase(currentKx, kyValue, ix, midRow, n);

            // Screen y points down: spin phasor e^(-iφ) drawn with Im up → dy = +sin(φ)
            const dx = Math.cos(phase) * arrowLength * 0.4;
            const dy = Math.sin(phase) * arrowLength * 0.4;

            // Arrow color based on position (left=cyan, right=orange)
            const t = ix / (n - 1);
            const r = Math.floor(80 + t * 175);
            const g = Math.floor(200 - t * 50);
            const b = Math.floor(220 - t * 150);

            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
            ctx.lineWidth = n > 16 ? 1.2 : 2;

            ctx.beginPath();
            ctx.moveTo(arrowCx, arrowCy);
            ctx.lineTo(arrowCx + dx, arrowCy + dy);
            ctx.stroke();

            // Arrowhead
            const angle = Math.atan2(dy, dx);
            const head = n > 16 ? 4 : 6;
            ctx.beginPath();
            ctx.moveTo(arrowCx + dx, arrowCy + dy);
            ctx.lineTo(arrowCx + dx - head * Math.cos(angle - 0.4), arrowCy + dy - head * Math.sin(angle - 0.4));
            ctx.lineTo(arrowCx + dx - head * Math.cos(angle + 0.4), arrowCy + dy - head * Math.sin(angle + 0.4));
            ctx.closePath();
            ctx.fill();
        }

        // Draw resultant vector (sum) - thick white arrow (Im up on screen)
        const sumDx = (realSum / maxSignal) * arrowLength;
        const sumDy = (-imagSum / maxSignal) * arrowLength;

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

    // ===================== SHARED HELPERS (MODULES C, D & E) =====================

    // Clear a panel canvas and return its CSS-pixel size
    beginPanel(ctx) {
        const dpr = window.devicePixelRatio || 1;
        const w = ctx.canvas.width / dpr;
        const h = ctx.canvas.height / dpr;
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);
        return { w, h };
    }

    // Arrow from (x0, y0) to (x1, y1)
    drawArrow(ctx, x0, y0, x1, y1, color, lineWidth = 2, head = 7) {
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len < 2) return;
        const angle = Math.atan2(y1 - y0, x1 - x0);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle - 0.4), y1 - head * Math.sin(angle - 0.4));
        ctx.lineTo(x1 - head * Math.cos(angle + 0.4), y1 - head * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
    }

    // Channel layout shared by the Module C/D/E pulse sequence diagrams
    drawSequenceChannels(ctx, w, h, title, active) {
        const margin = { left: 45, right: 15, top: 20, bottom: 15 };
        const plotW = w - margin.left - margin.right;
        const plotH = h - margin.top - margin.bottom;
        const names = [['RF', '#f59e0b'], ['Gz', '#10b981'], ['Gy', '#ef4444'], ['Gx', '#a855f7'], ['Signal', '#22d3ee']];
        const channelHeight = plotH / names.length;
        const rows = {};
        names.forEach(([name, color], i) => {
            const y = margin.top + i * channelHeight + channelHeight * 0.5;
            rows[name] = { y, color, amp: channelHeight * 0.35 };
            ctx.font = '9px Inter';
            ctx.fillStyle = active.includes(name) ? color : '#334155';
            ctx.textAlign = 'right';
            ctx.fillText(name, margin.left - 5, y + 3);
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + plotW, y);
            ctx.stroke();
        });

        // Time axis
        ctx.strokeStyle = '#475569';
        ctx.beginPath();
        ctx.moveTo(margin.left, h - margin.bottom);
        ctx.lineTo(margin.left + plotW, h - margin.bottom);
        ctx.stroke();
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('time', margin.left + plotW - 15, h - 3);

        ctx.font = 'bold 8px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText(title, margin.left, margin.top - 8);
        return { margin, plotW, rows };
    }

    // Position colour (left = cyan, right = orange), same direction as the vector-sum arrows
    xColor(t, alpha = 1) {
        t = Math.max(0, Math.min(1, t));
        return `hsla(${190 - t * 160}, 85%, 60%, ${alpha})`;
    }

    // ===================== MODULE C: READOUT → K-SPACE → IMAGE =====================

    // Small objects on an N×N grid (asymmetric ones show that k-space phase matters)
    getReconDensity() {
        const n = this.recon.n;
        const rho = [];
        for (let iy = 0; iy < n; iy++) {
            const row = [];
            for (let ix = 0; ix < n; ix++) {
                const u = (ix + 0.5) / n;
                const v = (iy + 0.5) / n;
                let value = 0;
                switch (this.recon.object) {
                    case 'L':
                        if ((u > 0.2 && u < 0.38 && v > 0.15 && v < 0.82) ||
                            (u > 0.2 && u < 0.75 && v > 0.7 && v < 0.82)) value = 1;
                        break;
                    case 'dots2':
                        if (Math.abs(u - 0.3) < 0.12 && Math.abs(v - 0.3) < 0.12) value = 1;
                        if (Math.abs(u - 0.7) < 0.12 && Math.abs(v - 0.62) < 0.12) value = 0.5;
                        break;
                    case 'point':
                        if (ix === Math.round(0.62 * n) && iy === Math.round(0.3 * n)) value = 1;
                        break;
                    case 'circle':
                        if ((u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.32 ** 2) value = 1;
                        break;
                    case 'line-v':
                        if (Math.abs(u - 0.5) < 0.1 && v > 0.1 && v < 0.9) value = 1;
                        break;
                }
                row.push(value);
            }
            rho.push(row);
        }
        return rho;
    }

    resetRecon() {
        const r = this.recon;
        const n = r.n;
        r.stage = 'acquire';
        r.line = 0;
        r.sample = -1;
        r.kspace = Array.from({ length: n }, () => new Array(n).fill(null));
        r.image = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: 0, im: 0 })));
        r.order = [];
        r.compIndex = 0;
        r.flash = null;
        r.accumulator = 0;
        r.pauseUntil = 0;
        r.density = this.getReconDensity();
        r.total = r.density.reduce((acc, row) => acc + row.reduce((a, v) => a + v, 0), 0);
        this.drawReconNoise();
    }

    // Standard normal deviate (Box-Muller)
    gaussian() {
        let u = 0;
        while (u === 0) u = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    }

    // New thermal-noise realization: one complex Gaussian per k-space sample
    drawReconNoise() {
        const n = this.recon.n;
        this.recon.noise = Array.from({ length: n }, () =>
            Array.from({ length: n }, () => ({ re: this.gaussian(), im: this.gaussian() })));
    }

    // Noise SD per real/imaginary component of each k-space sample after NEX averages
    getReconNoiseSD() {
        return this.recon.noiseSigma / Math.sqrt(this.recon.nex);
    }

    /**
     * Measured k-space sample = noiseless voxel sum + receiver noise.
     * The noise is added at the coil, independent of the object.
     */
    measuredSample(iky, ikx) {
        const r = this.recon;
        const S = r.kspace[iky][ikx];
        if (!S) return null;
        const sd = this.getReconNoiseSD();
        const z = r.noise[iky][ikx];
        return { re: S.re + sd * z.re, im: S.im + sd * z.im };
    }

    // Expected image SNR for ρ = 1: each pixel's noise SD = σ_eff/N (N² samples averaged)
    getReconExpectedSNR() {
        const sd = this.getReconNoiseSD();
        return sd > 0 ? this.recon.n / sd : Infinity;
    }

    // Rebuild the partial image after the noise changes during stage 2
    recomputeReconImage() {
        const r = this.recon;
        if (r.stage === 'acquire') return;
        const n = r.n;
        r.image = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: 0, im: 0 })));
        for (let i = 0; i < r.compIndex; i++) this.addReconComponent(r.order[i]);
    }

    updateReconNoiseLabel() {
        const label = document.getElementById('recon-noise-val');
        if (!label) return;
        const r = this.recon;
        label.innerHTML = r.noiseSigma === 0
            ? 'σ = 0 → noiseless (black background)'
            : `σ = ${r.noiseSigma.toFixed(2)}${r.nex > 1 ? ` / √${r.nex}` : ''} → expected image SNR ≈ ${this.getReconExpectedSNR().toFixed(0)}`;
    }

    // One coil sample: S(kx, ky) = Σ ρ·e^(-iφ) (same convention as Module B)
    reconSignal(kx, ky) {
        const r = this.recon;
        const n = r.n;
        let re = 0, im = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = r.density[iy][ix];
                if (rho === 0) continue;
                const phase = this.kPhase(kx, ky, ix, iy, n);
                re += rho * Math.cos(phase);
                im -= rho * Math.sin(phase);
            }
        }
        return { re, im };
    }

    isAcquisitionComplete() {
        const r = this.recon;
        return r.line === r.n - 1 && r.sample === r.n - 1;
    }

    // k-space position of the readout cursor (before the first sample: start of line)
    getReconCursorK() {
        const r = this.recon;
        const half = r.n / 2;
        return { kx: Math.max(0, r.sample) - half, ky: r.line - half };
    }

    startDecompose() {
        const r = this.recon;
        const n = r.n;
        const half = n / 2;
        // Fill any samples not yet acquired ("Skip to decompose")
        for (let iky = 0; iky < n; iky++) {
            for (let ikx = 0; ikx < n; ikx++) {
                if (!r.kspace[iky][ikx]) r.kspace[iky][ikx] = this.reconSignal(ikx - half, iky - half);
            }
        }
        r.line = n - 1;
        r.sample = n - 1;
        r.stage = 'decompose';
        r.compIndex = 0;
        r.image = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: 0, im: 0 })));
        r.order = this.buildReconOrder();
        this.updatePanelTitles();
    }

    /**
     * Order in which stage 2 adds the components back. The inverse FT is a plain sum,
     * so this changes only the intermediate images, never the final one.
     *   'centre': increasing |k|, then by angle → rings from the centre (coarse → fine)
     *   'scan':   same order as acquired (ky = -N/2 … N/2-1, kx swept along each line)
     */
    buildReconOrder() {
        const r = this.recon;
        const n = r.n;
        const half = n / 2;
        const order = [];
        for (let iky = 0; iky < n; iky++) {
            for (let ikx = 0; ikx < n; ikx++) {
                const kx = ikx - half, ky = iky - half;
                order.push({ ikx, iky, kx, ky, k2: kx * kx + ky * ky, angle: Math.atan2(ky, kx) });
            }
        }
        if (r.orderMode === 'centre') order.sort((a, b) => a.k2 - b.k2 || a.angle - b.angle);
        return order;
    }

    // Inverse FT, one term: image += S(k)·e^(+iφ) / N² (S = measured sample, noise included)
    addReconComponent(c) {
        const r = this.recon;
        const n = r.n;
        const S = this.measuredSample(c.iky, c.ikx);
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const phase = this.kPhase(c.kx, c.ky, ix, iy, n);
                const cos = Math.cos(phase), sin = Math.sin(phase);
                r.image[iy][ix].re += (S.re * cos - S.im * sin) / (n * n);
                r.image[iy][ix].im += (S.re * sin + S.im * cos) / (n * n);
            }
        }
    }

    // Advance by one event: one readout sample (stage 1) or one component (stage 2)
    reconStep(now = performance.now()) {
        const r = this.recon;
        const n = r.n;
        if (r.stage === 'acquire') {
            if (this.isAcquisitionComplete()) {
                this.startDecompose();
                r.pauseUntil = now + 700 / r.speed;
                return;
            }
            r.sample++;
            if (r.sample >= n) {
                r.line++;
                r.sample = 0;
            }
            const { kx, ky } = this.getReconCursorK();
            r.kspace[r.line][r.sample] = this.reconSignal(kx, ky);
            r.flash = { ikx: r.sample, iky: r.line, time: now };
            if (this.isAcquisitionComplete()) r.pauseUntil = now + 1200 / r.speed;
        } else if (r.stage === 'decompose') {
            this.addReconComponent(r.order[r.compIndex]);
            r.compIndex++;
            if (r.compIndex >= n * n) r.stage = 'done';
        }
    }

    // Events per second at 1× speed: slow at first so each step can be followed, then fast-forward
    getReconRate() {
        const r = this.recon;
        if (r.stage === 'acquire') {
            if (r.line < 2) return 7;
            return r.n > 8 ? 70 : 40;
        }
        if (r.compIndex < 10) return 4;
        return r.n > 8 ? 25 : 15;
    }

    isReconFastForward() {
        const r = this.recon;
        return (r.stage === 'acquire' && r.line >= 2 && !this.isAcquisitionComplete()) ||
               (r.stage === 'decompose' && r.compIndex >= 10);
    }

    startReconAnimation() {
        const r = this.recon;
        if (r.playing) return;
        if (r.stage === 'done') {
            this.resetRecon();
            this.updatePanelTitles();
        }
        r.playing = true;
        r.lastTime = performance.now();
        r.accumulator = 0;
        const btn = document.getElementById('recon-play');
        if (btn) btn.innerHTML = '&#10074;&#10074; Pause';
        const loop = (now) => {
            if (!r.playing) return;
            const dt = Math.min(0.1, (now - r.lastTime) / 1000);
            r.lastTime = now;
            if (now >= r.pauseUntil) {
                r.accumulator += dt * this.getReconRate() * r.speed;
                let guard = 0;
                while (r.accumulator >= 1 && r.stage !== 'done' && guard++ < 50) {
                    r.accumulator -= 1;
                    this.reconStep(now);
                    if (r.pauseUntil > now) {
                        r.accumulator = 0;
                        break;
                    }
                }
            }
            if (r.stage === 'done') {
                this.stopReconAnimation();
                this.render();
                return;
            }
            this.render();
            r.animationId = requestAnimationFrame(loop);
        };
        r.animationId = requestAnimationFrame(loop);
    }

    stopReconAnimation() {
        const r = this.recon;
        r.playing = false;
        if (r.animationId) {
            cancelAnimationFrame(r.animationId);
            r.animationId = null;
        }
        const btn = document.getElementById('recon-play');
        if (btn) btn.innerHTML = r.stage === 'done' ? '&#8635; Replay' : '&#9654; Play';
    }

    updateReconStageText() {
        const el = document.getElementById('recon-stage');
        if (!el) return;
        const r = this.recon;
        const n = r.n;
        const ff = this.isReconFastForward() && r.playing ? ' <em>&#9193; fast-forward</em>' : '';
        const { kx, ky } = this.getReconCursorK();
        if (r.stage === 'acquire') {
            if (r.sample < 0 && r.line === 0) {
                el.innerHTML = `Ready: press Play to acquire line k<sub>y</sub> = ${-n / 2}`;
            } else if (this.isAcquisitionComplete()) {
                el.innerHTML = `K-space full: ${n * n} samples from ${n} readouts. Next: decompose`;
            } else {
                el.innerHTML = `Acquiring line k<sub>y</sub> = ${ky} (${r.line + 1}/${n})<br>` +
                    `sample k<sub>x</sub> = ${kx} (${r.sample + 1}/${n})${ff}`;
            }
        } else if (r.stage === 'decompose') {
            const c = r.order[Math.max(0, r.compIndex - 1)];
            const mode = r.orderMode === 'centre' ? 'centre-out' : 'scan order';
            el.innerHTML = r.compIndex === 0
                ? `Decomposing (${mode}): inverse FT, 0 / ${n * n} components`
                : `Decomposing (${mode}): ${r.compIndex} / ${n * n} components<br>adding k = (${c.kx}, ${c.ky})${ff}`;
        } else {
            el.innerHTML = `Done: image rebuilt from all ${n * n} k-space components &#10003;`;
        }
    }

    renderReconModule() {
        this.updateReconStageText();
        this.updateReconRowLabels();
        const c = this.reconCtx;
        // Row ①: live while acquiring, frozen in its final state afterwards
        if (c.voxels) this.renderReconVoxels(c.voxels);
        if (c.acquire) this.renderReconAcquire(c.acquire);
        if (c.seq) this.renderReconSequence(c.seq);
        if (c.phasor) this.renderReconPhasors(c.phasor);
        // Row ②: calm placeholders until k-space is full, then the inverse FT builds up
        const acquiring = this.recon.stage === 'acquire';
        if (c.decompose) acquiring ? this.renderReconPlaceholder(c.decompose, 'decompose') : this.renderReconDecompose(c.decompose);
        if (c.image) acquiring ? this.renderReconPlaceholder(c.image, 'image') : this.renderReconImage(c.image);
        if (c.weight) acquiring ? this.renderReconPlaceholder(c.weight, 'weight') : this.renderReconWeight(c.weight);
    }

    // Highlight the active stage and keep the row captions in step with it
    updateReconRowLabels() {
        const r = this.recon;
        const acquiring = r.stage === 'acquire';
        const state = `${r.stage}|${this.isAcquisitionComplete()}|${r.orderMode}`;
        if (this.reconLabelState === state) return;
        this.reconLabelState = state;
        const row1 = document.getElementById('recon-row1-label');
        const row2 = document.getElementById('recon-row2-label');
        row1?.classList.toggle('active', acquiring);
        row2?.classList.toggle('active', !acquiring);
        const cap1 = document.getElementById('recon-row1-caption');
        const cap2 = document.getElementById('recon-row2-caption');
        if (cap1) {
            cap1.textContent = acquiring
                ? 'every voxel\'s signal is summed by the coil; each sum is one k-space sample'
                : 'scan finished ✓ (frozen: full k-space, last readout line, last phasor sum)';
        }
        if (cap2) {
            cap2.textContent = acquiring
                ? 'starts when k-space is full'
                : r.orderMode === 'centre'
                    ? 'the k-space filled above is decomposed here, centre first (ring above = component being added)'
                    : 'the k-space filled above is decomposed here, line by line in scan order (ring above = component being added)';
        }
    }

    // Row ② before the scan is complete: explain what will happen instead of a blank box
    renderReconPlaceholder(ctx, kind) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const acquired = r.line * n + (r.sample + 1);
        const lines = {
            decompose: ['Reconstruction starts when k-space is full', 'each k-space sample will become', 'one stripe pattern (spatial frequency)'],
            image: ['The image is rebuilt here', 'by adding the stripe patterns',
                    r.orderMode === 'centre' ? 'centre of k-space first' : 'line by line, in scan order'],
            weight: ['Each pattern\'s weight', '= one k-space value', '(magnitude + phase)']
        }[kind];
        ctx.textAlign = 'center';
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#64748b';
        ctx.fillText(lines[0], w / 2, h / 2 - 22);
        ctx.font = '10px Inter';
        ctx.fillStyle = '#475569';
        ctx.fillText(lines[1], w / 2, h / 2 - 4);
        ctx.fillText(lines[2], w / 2, h / 2 + 10);

        // Progress of the scan
        const barW = Math.min(220, w - 40);
        const barX = (w - barW) / 2, barY = h / 2 + 28;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(barX, barY, barW, 6);
        ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
        ctx.fillRect(barX, barY, barW * acquired / (n * n), 6);
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.fillText(`k-space: ${acquired} / ${n * n} samples acquired`, w / 2, barY + 20);

        // The target the reconstruction should reach (faint)
        if (kind === 'image') {
            const thumb = Math.min(60, h / 4);
            const tc = thumb / n;
            const tx = (w - thumb) / 2, ty = h / 2 - 40 - thumb - 12;
            if (ty > 4) {
                for (let iy = 0; iy < n; iy++) {
                    for (let ix = 0; ix < n; ix++) {
                        const g = Math.floor(40 + 60 * r.density[iy][ix]);
                        ctx.fillStyle = `rgb(${g}, ${g}, ${g + 6})`;
                        ctx.fillRect(tx + ix * tc, ty + iy * tc, tc, tc);
                    }
                }
                ctx.font = '8px Inter';
                ctx.fillStyle = '#475569';
                ctx.fillText('target (true object)', w / 2, ty - 4);
            }
        }
    }

    // Draw the N×N k-space matrix (log magnitude), ky up; returns layout for overlays
    drawReconKSpace(ctx, x0, y0, size, options = {}) {
        const r = this.recon;
        const n = r.n;
        const cell = size / n;
        const sMax = Math.max(1e-9, r.total);
        const cellX = ikx => x0 + ikx * cell;
        const cellY = iky => y0 + (n - 1 - iky) * cell;
        for (let iky = 0; iky < n; iky++) {
            for (let ikx = 0; ikx < n; ikx++) {
                const S = this.measuredSample(iky, ikx);
                if (S) {
                    const mag = Math.sqrt(S.re * S.re + S.im * S.im) / sMax;
                    const b = Math.floor(255 * Math.log10(1 + 100 * mag) / Math.log10(101));
                    ctx.fillStyle = `rgb(${b}, ${b}, ${b})`;
                } else {
                    ctx.fillStyle = '#141b2d';
                }
                ctx.fillRect(cellX(ikx), cellY(iky), cell, cell);
                if (options.dim && options.dim(ikx, iky)) {
                    ctx.fillStyle = 'rgba(10, 10, 10, 0.72)';
                    ctx.fillRect(cellX(ikx), cellY(iky), cell, cell);
                }
            }
        }
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= n; i++) {
            ctx.beginPath();
            ctx.moveTo(x0 + i * cell, y0);
            ctx.lineTo(x0 + i * cell, y0 + size);
            ctx.moveTo(x0, y0 + i * cell);
            ctx.lineTo(x0 + size, y0 + i * cell);
            ctx.stroke();
        }
        // k = 0 cross-hair
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cellX(n / 2) + cell / 2, y0);
        ctx.lineTo(cellX(n / 2) + cell / 2, y0 + size);
        ctx.moveTo(x0, cellY(n / 2) + cell / 2);
        ctx.lineTo(x0 + size, cellY(n / 2) + cell / 2);
        ctx.stroke();
        ctx.font = '9px Inter';
        ctx.fillStyle = '#a855f7';
        ctx.textAlign = 'center';
        ctx.fillText(`kx → (${-n / 2} … ${n / 2 - 1})`, x0 + size / 2, y0 + size + 12);
        ctx.save();
        ctx.translate(x0 - 6, y0 + size * 0.2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillText('ky →', 0, 0);
        ctx.restore();
        return { cell, cellX, cellY };
    }

    renderReconVoxels(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const half = n / 2;
        const { kx: curKx, ky } = this.getReconCursorK();
        const now = performance.now();
        const flashAge = r.flash ? now - r.flash.time : Infinity;

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        ctx.fillText(w < 640 ? `Each voxel's signal (ky = ${ky})` : `Each voxel's own signal during this readout (Re part), line ky = ${ky}`, 14, 18);

        const gridTop = 30;
        const gridSize = Math.min(h - gridTop - 26, w * 0.6);
        const gridLeft = 24;
        const cell = gridSize / n;
        const freeW = w - gridLeft - gridSize;
        const nodeX = freeW < 240 ? gridLeft + gridSize + freeW / 2 + 6
                                  : gridLeft + gridSize + Math.max(60, freeW * 0.38);
        const nodeY = gridTop + gridSize / 2;

        // Lines from every voxel to the Σ node (brighten briefly when a sample is taken)
        const pulse = flashAge < 350 ? 1 - flashAge / 350 : 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                if (r.density[iy][ix] === 0) continue;
                ctx.strokeStyle = this.xColor(ix / (n - 1), 0.12 + 0.45 * pulse);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(gridLeft + (ix + 0.5) * cell, gridTop + (iy + 0.5) * cell);
                ctx.lineTo(nodeX, nodeY);
                ctx.stroke();
            }
        }

        // Voxels with their mini time series: Re{ρ·e^(-i2π(kx·x + ky·y))} along the readout
        const pad = Math.max(2, cell * 0.08);
        const numPts = Math.max(24, 4 * n);
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = r.density[iy][ix];
                const cx0 = gridLeft + ix * cell;
                const cy0 = gridTop + iy * cell;
                ctx.fillStyle = rho > 0 ? `rgba(148, 163, 184, ${0.08 + 0.12 * rho})` : '#0d1117';
                ctx.fillRect(cx0 + 0.5, cy0 + 0.5, cell - 1, cell - 1);
                if (rho === 0) continue;
                const midY = cy0 + cell / 2;
                const amp = (cell / 2 - pad) * rho;
                const kxToX = kx => cx0 + pad + (kx + half) / (n - 1) * (cell - 2 * pad);
                const value = kx => rho * Math.cos(this.kPhase(kx, ky, ix, iy, n));
                const color = this.xColor(ix / (n - 1));
                // Full line faint, acquired part bright
                [[-half, half - 1, 0.3], [-half, Math.max(-half, curKx), 1]].forEach(([k0, k1, alpha]) => {
                    if (alpha === 1 && r.sample < 0) return;
                    ctx.beginPath();
                    const steps = Math.max(2, Math.round(numPts * (k1 - k0) / (n - 1)));
                    for (let i = 0; i <= steps; i++) {
                        const kx = k0 + (k1 - k0) * i / steps;
                        const py = midY - (value(kx) / rho) * amp;
                        if (i === 0) ctx.moveTo(kxToX(kx), py); else ctx.lineTo(kxToX(kx), py);
                    }
                    ctx.strokeStyle = this.xColor(ix / (n - 1), alpha);
                    ctx.lineWidth = alpha === 1 ? 1.4 : 1;
                    ctx.stroke();
                });
                if (r.sample >= 0) {
                    ctx.beginPath();
                    ctx.arc(kxToX(curKx), midY - (value(curKx) / rho) * amp, Math.max(1.5, cell * 0.06), 0, 2 * Math.PI);
                    ctx.fillStyle = color;
                    ctx.fill();
                }
            }
        }

        // Σ node (the receiver coil only measures the sum)
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, 22, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(34, 211, 238, ${0.15 + 0.5 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = 'bold 20px Inter';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('Σ', nodeX, nodeY + 7);
        // Receiver noise enters at the coil, not at the voxels
        const noiseSD = this.getReconNoiseSD();
        if (noiseSD > 0) {
            this.drawArrow(ctx, nodeX, nodeY - 66, nodeX, nodeY - 25, '#f472b6', 1.8, 6);
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = '#f472b6';
            ctx.textAlign = 'center';
            ctx.fillText('+ receiver noise', nodeX, nodeY - 80);
            ctx.font = '8px Inter';
            ctx.fillText(w < 640 ? '(body + coil)' : '(body + electronics, every sample)', nodeX, nodeY - 70);
        }
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        if (w < 640) {
            ctx.textAlign = 'center';
            ctx.fillText('coil = sum only', nodeX, nodeY + 86);
        } else {
            ctx.textAlign = 'left';
            // Backing box so the converging voxel lines don't run through the text
            ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
            ctx.fillRect(nodeX + 23, nodeY - 32, 62, 25);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('coil records', nodeX + 26, nodeY - 22);
            ctx.fillText('only the sum', nodeX + 26, nodeY - 11);
        }
        ctx.textAlign = 'center';

        // Arrow to the k-space sample value
        this.drawArrow(ctx, nodeX + 24, nodeY, Math.min(w - 14, nodeX + 70), nodeY, '#22d3ee', 2, 6);
        ctx.font = 'bold 10px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'center';
        if (r.sample >= 0) {
            const S = this.measuredSample(r.line, r.sample);
            ctx.fillText(`S(${curKx}, ${ky})`, nodeX, nodeY + 44);
            ctx.font = '9px Inter';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(`${S.re.toFixed(2)} ${S.im < 0 ? '−' : '+'} ${Math.abs(S.im).toFixed(2)}i`, nodeX, nodeY + 57);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(noiseSD > 0 && w >= 640 ? '→ one measured k-space sample' : '→ one k-space sample', nodeX, nodeY + 72);
        } else {
            ctx.fillText('press Play', nodeX, nodeY + 44);
        }

        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText(w < 640 ? 'traces: clean voxel signals (noise is added at Σ)'
                             : '−x … +x: frequency ∝ x · starting phase ∝ ky·y · amplitude ∝ ρ · traces are noise-free (noise is added at Σ)',
                     gridLeft, h - 8);
    }

    renderReconSequence(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const half = n / 2;
        const acquiring = r.stage === 'acquire';
        const { margin, plotW, rows } = this.drawSequenceChannels(ctx, w, h, '2D Cartesian Acquisition',
            acquiring ? ['RF', 'Gz', 'Gy', 'Gx', 'Signal'] : []);
        if (!acquiring) ctx.globalAlpha = 0.25;
        const xStart = margin.left;
        const { kx, ky } = this.getReconCursorK();

        ctx.strokeStyle = rows.RF.color;
        ctx.lineWidth = 2;
        this.drawRFPulse(ctx, xStart + plotW * 0.06, rows.RF.y, plotW * 0.08, rows.RF.amp);
        this.drawTrapezoid(ctx, xStart + plotW * 0.03, rows.Gz.y, plotW * 0.14, rows.Gz.amp * 0.8, rows.Gz.color);
        this.drawTrapezoid(ctx, xStart + plotW * 0.17, rows.Gz.y, plotW * 0.06, -rows.Gz.amp * 0.4, rows.Gz.color);

        // Phase-encode table: all steps faint, current step bold
        const gy = rows.Gy;
        ctx.globalAlpha = acquiring ? 0.15 : 0.08;
        for (let step = -half; step < half; step += Math.max(1, n / 8)) {
            this.drawTrapezoid(ctx, xStart + plotW * 0.27, gy.y, plotW * 0.12, gy.amp * step / half, gy.color);
        }
        ctx.globalAlpha = acquiring ? 1 : 0.25;
        ctx.lineWidth = 2;
        this.drawTrapezoid(ctx, xStart + plotW * 0.27, gy.y, plotW * 0.12, gy.amp * ky / half, gy.color);
        ctx.font = 'bold 7px Inter';
        ctx.fillStyle = gy.color;
        ctx.textAlign = 'center';
        ctx.fillText(`ky = ${ky}`, xStart + plotW * 0.33, gy.y - gy.amp - 3);

        // Readout with ADC samples and cursor
        const gx = rows.Gx;
        const roStart = xStart + plotW * 0.45;
        const roW = plotW * 0.5;
        this.drawTrapezoid(ctx, xStart + plotW * 0.27, gx.y, roW * 0.5, -gx.amp * 0.7, gx.color);
        this.drawTrapezoid(ctx, roStart, gx.y, roW, gx.amp * 0.7, gx.color);
        const flatStart = roStart + roW * 0.15;
        const flatW = roW * 0.7;
        for (let s = 0; s < n; s++) {
            const px = flatStart + (s + 0.5) / n * flatW;
            const done = acquiring && s <= r.sample;
            ctx.strokeStyle = done ? '#22d3ee' : 'rgba(148, 163, 184, 0.5)';
            ctx.lineWidth = done ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(px, rows.Signal.y + rows.Signal.amp + 1);
            ctx.lineTo(px, rows.Signal.y + rows.Signal.amp + 6);
            ctx.stroke();
        }
        ctx.strokeStyle = rows.Signal.color;
        ctx.lineWidth = 2;
        this.drawEcho(ctx, flatStart, rows.Signal.y, flatW, rows.Signal.amp * 0.8);
        if (acquiring && r.sample >= 0) {
            const cursorX = flatStart + (kx + half + 0.5) / n * flatW;
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(cursorX, gx.y - gx.amp * 0.7 - 8);
            ctx.lineTo(cursorX, rows.Signal.y + rows.Signal.amp);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = 'bold 7px Inter';
            ctx.fillStyle = '#22d3ee';
            ctx.textAlign = 'center';
            ctx.fillText(`kx = ${kx}`, cursorX, gx.y - gx.amp * 0.7 - 11);
        }
        ctx.globalAlpha = 1;
        if (!acquiring) {
            ctx.fillStyle = 'rgba(10, 10, 10, 0.96)';
            ctx.fillRect(w / 2 - 80, h / 2 - 20, 180, 36);
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
            ctx.strokeRect(w / 2 - 80, h / 2 - 20, 180, 36);
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = '#10b981';
            ctx.textAlign = 'center';
            ctx.fillText('Scan done: the computer runs', w / 2 + 10, h / 2 - 5);
            ctx.fillText('the inverse Fourier transform', w / 2 + 10, h / 2 + 8);
        }
    }

    renderReconAcquire(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const half = n / 2;
        const { kx: curKx, ky } = this.getReconCursorK();
        const sMax = Math.max(1e-9, r.total);
        const narrow = w < 640;

        // ---- Left: summed signal for the current line ----
        const left = 40;
        const ksSize = Math.min(h - 64, w * (w < 640 ? 0.46 : 0.38));
        const sigW = w - ksSize - left - (w < 640 ? 56 : 70);
        const top = 34, bottom = h - 34;
        const mid = (top + bottom) / 2;
        const amp = (bottom - top) / 2 * 0.9;
        const kxToX = kx => left + (kx + half) / (n - 1) * sigW;

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        ctx.fillText(narrow ? `Coil signal, line ky = ${ky}` : `Coil signal for line ky = ${ky} = sum of all voxel signals`, left, 18);

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, mid);
        ctx.lineTo(left + sigW, mid);
        ctx.stroke();

        if (r.sample >= 0) {
            // Continuous signal up to the cursor, then the acquired samples as dots
            const drawPart = (key, color, width) => {
                ctx.beginPath();
                const steps = Math.max(2, Math.round(8 * (curKx + half)));
                for (let i = 0; i <= steps; i++) {
                    const kx = -half + (curKx + half) * i / steps;
                    const v = this.reconSignal(kx, ky)[key];
                    const py = mid - (v / sMax) * amp;
                    if (i === 0) ctx.moveTo(kxToX(kx), py); else ctx.lineTo(kxToX(kx), py);
                }
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.stroke();
            };
            const noisy = this.getReconNoiseSD() > 0;
            drawPart('im', `rgba(245, 158, 11, ${noisy ? 0.35 : 0.7})`, 1.2);
            drawPart('re', `rgba(255, 255, 255, ${noisy ? 0.4 : 0.8})`, 1.6);
            for (let s = 0; s <= r.sample; s++) {
                const S = this.measuredSample(r.line, s);
                const px = kxToX(s - half);
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.arc(px, mid - (S.im / sMax) * amp, 2.2, 0, 2 * Math.PI);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(px, mid - (S.re / sMax) * amp, s === r.sample ? 4.5 : 2.8, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        for (let s = 0; s < n; s += Math.max(1, n / 8)) ctx.fillText(s - half, kxToX(s - half), bottom + 12);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(narrow ? 'sample kx (time →)' : 'readout sample kx (time →)   ● Re (white)  ● Im (amber)', left + sigW / 2, bottom + 26);
        if (this.getReconNoiseSD() > 0 && r.sample >= 0) {
            ctx.font = '8px Inter';
            ctx.fillStyle = '#f472b6';
            ctx.textAlign = 'left';
            ctx.fillText(narrow ? 'line: clean · dots: measured' : 'faint line = noiseless sum · dots = measured samples (sum + noise)', left, 32);
        }

        // ---- Right: k-space matrix filling row by row (vertically centred on the signal axis) ----
        const ksX = w - ksSize - 22;
        const ksY = Math.max(30, mid - ksSize / 2);
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.fillText('K-space (log |S|)', ksX + ksSize / 2, ksY - 8);
        const { cell, cellX, cellY } = this.drawReconKSpace(ctx, ksX, ksY, ksSize);

        // Frozen after the scan: mirror the component currently being added in row ②
        if (r.stage !== 'acquire') {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(ksX, cellY(r.line), ksSize, cell);
            const c = r.compIndex > 0 ? r.order[r.compIndex - 1] : null;
            if (c) {
                ctx.strokeStyle = '#22d3ee';
                ctx.lineWidth = 2.5;
                ctx.strokeRect(cellX(c.ikx) - 1, cellY(c.iky) - 1, cell + 2, cell + 2);
            }
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = '#22d3ee';
            ctx.textAlign = 'center';
            ctx.fillText(c ? `↓ decomposed below: k = (${c.kx}, ${c.ky})` : '↓ decomposed below', ksX + ksSize / 2, ksY + ksSize + 26);
            this.drawArrow(ctx, left + sigW + 12, mid, ksX - 18, mid, 'rgba(34, 211, 238, 0.4)', 1.5, 6);
            return;
        }

        // Current line + write flash
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ksX, cellY(r.line), ksSize, cell);
        if (r.sample >= 0) {
            const age = r.flash ? performance.now() - r.flash.time : Infinity;
            if (age < 400) {
                ctx.fillStyle = `rgba(34, 211, 238, ${0.8 * (1 - age / 400)})`;
                ctx.fillRect(cellX(r.sample), cellY(r.line), cell, cell);
            }
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(cellX(r.sample) - 1, cellY(r.line) - 1, cell + 2, cell + 2);
        }

        // Arrow from the signal to k-space
        this.drawArrow(ctx, left + sigW + 12, mid, ksX - 18, mid, '#22d3ee', 1.5, 6);
        ctx.font = '8px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'center';
        ctx.fillText('write', (left + sigW + ksX) / 2 - 3, mid - 6);
    }

    renderReconPhasors(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const { kx, ky } = this.getReconCursorK();
        const sMax = Math.max(1e-9, r.total);

        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Σ voxel phasors (head-to-tail)', w / 2, 14);

        const compact = h < 230;
        const R = compact ? Math.min((h - 34) / 2, w * 0.27) : Math.min(w / 2 - 16, (h - 110) / 2);
        const cx = compact ? 14 + R : w / 2;
        const cy = compact ? 22 + (h - 22) / 2 : 30 + (h - 110) / 2;
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - R - 6, cy);
        ctx.lineTo(cx + R + 6, cy);
        ctx.moveTo(cx, cy - R - 6);
        ctx.lineTo(cx, cy + R + 6);
        ctx.stroke();
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('Re', cx + R + 2, cy - 3);
        ctx.fillText('Im', cx + 3, cy - R - 2);

        // Each voxel phasor ρ·e^(-iφ) chained (Re right, Im up)
        let px = cx, py = cy, re = 0, im = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const rho = r.density[iy][ix];
                if (rho === 0) continue;
                const phase = this.kPhase(kx, ky, ix, iy, n);
                const dre = rho * Math.cos(phase), dim = -rho * Math.sin(phase);
                const nx = px + (dre / sMax) * R;
                const ny = py - (dim / sMax) * R;
                this.drawArrow(ctx, px, py, nx, ny, this.xColor(ix / (n - 1), 0.9), 1.4, n > 8 ? 3 : 5);
                px = nx;
                py = ny;
                re += dre;
                im += dim;
            }
        }
        const tipX = cx + (re / sMax) * R, tipY = cy - (im / sMax) * R;
        this.drawArrow(ctx, cx, cy, tipX, tipY, '#ffffff', 2.2, 8);

        // Receiver noise: a random vector added to the clean sum → the measured sample
        const noisy = this.getReconNoiseSD() > 0 && r.sample >= 0;
        let measured = { re, im };
        if (noisy) {
            measured = this.measuredSample(r.line, r.sample);
            const mx = cx + (measured.re / sMax) * R, my = cy - (measured.im / sMax) * R;
            this.drawArrow(ctx, tipX, tipY, mx, my, '#f472b6', 2, 6);
            ctx.setLineDash([4, 3]);
            this.drawArrow(ctx, cx, cy, mx, my, '#22d3ee', 1.6, 7);
            ctx.setLineDash([]);
        }

        const pct = Math.sqrt(measured.re * measured.re + measured.im * measured.im) / sMax * 100;
        const pctColor = pct > 50 ? '#10b981' : (pct > 20 ? '#f59e0b' : '#ef4444');
        if (compact) {
            // Text block to the right of the circle
            const tx = cx + R + 16;
            let ty = cy - 30;
            ctx.textAlign = 'left';
            ctx.font = 'bold 10px Inter';
            ctx.fillStyle = pctColor;
            ctx.fillText(`|S(${kx}, ${ky})|`, tx, ty);
            ctx.fillText(`= ${pct.toFixed(0)}% of max`, tx, ty + 13);
            ty += 34;
            ctx.font = '9px Inter';
            const legend = noisy
                ? [['white: Σ voxels', '#94a3b8'], ['magenta: noise', '#f472b6'], ['cyan: measured', '#22d3ee']]
                : [['white: this k-space', '#94a3b8'], ['value', '#94a3b8'], ['aligned → big |S|', '#94a3b8']];
            legend.forEach(([text, color], i) => {
                ctx.fillStyle = color;
                ctx.fillText(text, tx, ty + i * 13);
            });
            return;
        }
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = pctColor;
        ctx.fillText(`|S(${kx}, ${ky})| = ${pct.toFixed(0)}% of max`, w / 2, h - 58);
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        if (noisy) {
            ctx.fillText('white = Σ voxels (clean)', w / 2, h - 42);
            ctx.fillStyle = '#f472b6';
            ctx.fillText('magenta = noise', w / 2, h - 28);
            ctx.fillStyle = '#22d3ee';
            ctx.fillText('cyan = measured k-space value', w / 2, h - 15);
        } else {
            ctx.fillText(r.sample >= 0 ? 'white arrow = this k-space value' : 'cursor at the start of the readout', w / 2, h - 42);
            ctx.fillText('aligned phasors → big |S|', w / 2, h - 28);
            ctx.fillText('spread phasors → they cancel', w / 2, h - 15);
        }
    }

    renderReconImage(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const narrow = w < 640;

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#10b981';
        ctx.textAlign = 'left';
        ctx.fillText(narrow ? 'Image = Σ weight × pattern'
                            : `Image = Σ (k-space weight × stripe pattern), added ${r.orderMode === 'centre' ? 'centre-first' : 'in scan order'}`, 14, 18);

        const gridTop = 30;
        const size = Math.min(h - gridTop - 30, w * 0.55);
        const gridLeft = 24;
        const cell = size / n;
        // Real part. Noiseless: 0 → black. With noise: window −0.3 … 1.2 so background noise (±) stays visible
        const noisy = this.getReconNoiseSD() > 0;
        const wMin = noisy ? -0.3 : 0, wMax = noisy ? 1.2 : 1;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const v = (r.image[iy][ix].re - wMin) / (wMax - wMin);
                const g = Math.floor(255 * Math.max(0, Math.min(1, v)));
                ctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
                ctx.fillRect(gridLeft + ix * cell, gridTop + iy * cell, cell, cell);
            }
        }
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(gridLeft, gridTop, size, size);
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.fillText(noisy ? 'display: real part, window −0.3 … 1.2 (0 = dark grey)' : 'display: real part, 0 = black',
                     gridLeft, gridTop + size + 12);

        // Object / background statistics of the current image (real part)
        const objVals = [], bgVals = [];
        let sq = 0;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const v = r.image[iy][ix].re;
                (r.density[iy][ix] > 0 ? objVals : bgVals).push(v);
                sq += (v - r.density[iy][ix]) ** 2;
            }
        }
        const mean = a => a.reduce((acc, v) => acc + v, 0) / Math.max(1, a.length);
        const bgMean = mean(bgVals);
        const bgSD = Math.sqrt(bgVals.reduce((acc, v) => acc + (v - bgMean) ** 2, 0) / Math.max(1, bgVals.length - 1));

        // Right side: true object and progress
        const sideX = gridLeft + size + 30;
        const sideW = w - sideX - 16;
        const objSize = Math.min(sideW, size * 0.45);
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText('True object', sideX, gridTop + 8);
        const oc = objSize / n;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const g = Math.floor(255 * r.density[iy][ix]);
                ctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
                ctx.fillRect(sideX + ix * oc, gridTop + 14 + iy * oc, oc, oc);
            }
        }
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(sideX, gridTop + 14, objSize, objSize);

        let y = gridTop + 14 + objSize + 26;
        ctx.font = 'bold 18px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(`${r.compIndex} / ${n * n}`, sideX, y);
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('components added', sideX, y + 14);
        y += 34;
        if (r.compIndex > 0 && r.compIndex < n * n) {
            const c = r.order[r.compIndex - 1];
            ctx.fillText(`latest k = (${c.kx}, ${c.ky}), |k| = ${Math.sqrt(c.k2).toFixed(1)}`, sideX, y);
            y += 14;
            const lowK = Math.sqrt(c.k2) < 0.3 * n;
            ctx.fillStyle = lowK ? '#f59e0b' : '#10b981';
            if (narrow) {
                ctx.fillText(lowK ? 'low k → shape' : 'high k → edges', sideX, y);
            } else {
                ctx.fillText(lowK ? 'low k → overall shape & contrast' : 'high k → edges & fine detail', sideX, y);
            }
            y += 18;
        }
        if (r.stage === 'done' && !noisy) {
            let err = 0;
            for (let iy = 0; iy < n; iy++) {
                for (let ix = 0; ix < n; ix++) err = Math.max(err, Math.abs(r.image[iy][ix].re - r.density[iy][ix]));
            }
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 10px Inter';
            ctx.fillText('Exact match ✓', sideX, y);
            ctx.font = '9px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(`max |error| = ${err.toExponential(1)}`, sideX, y + 14);
        } else if (r.stage === 'done') {
            const snr = mean(objVals) / Math.max(1e-12, bgSD);
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 12px Inter';
            ctx.fillText(`SNR = ${snr.toFixed(1)}`, sideX, y);
            ctx.font = '9px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(narrow ? 'mean(object) / SD(bkg)' : 'mean(object) / SD(background)', sideX, y + 13);
            ctx.fillText(`expected ≈ ${this.getReconExpectedSNR().toFixed(0)} (N·√NEX/σ)`, sideX, y + 26);
            const rms = Math.sqrt(sq / (n * n)).toFixed(3);
            ctx.fillText(narrow ? `RMS err = ${rms}` : `RMS error vs noiseless = ${rms}`, sideX, y + 39);
        } else if (noisy && r.compIndex > 0) {
            // Each added component carries independent noise of SD σ/N² into every pixel → σ·√m/N² after m
            const noiseSoFar = this.getReconNoiseSD() * Math.sqrt(r.compIndex) / (n * n);
            ctx.fillStyle = '#f472b6';
            ctx.fillText(narrow ? `noise SD ≈ ${noiseSoFar.toFixed(3)}` : `noise SD so far ≈ σ√m/N² = ${noiseSoFar.toFixed(3)}`, sideX, y);
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(narrow ? 'grows ∝ √m' : 'every component adds noise everywhere', sideX, y + 13);
        }
    }

    renderReconDecompose(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const narrow = w < 640;
        const current = r.compIndex > 0 ? r.order[r.compIndex - 1] : null;

        // ---- Left: k-space with used components bright, the rest dimmed ----
        const ksSize = Math.min(h - 70, w * 0.4);
        const ksX = 40, ksY = 34;
        const used = new Set(r.order.slice(0, r.compIndex).map(c => c.iky * n + c.ikx));
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.fillText(narrow ? 'K-space (used = bright)' : 'K-space: components used so far (bright)', ksX + ksSize / 2, 18);
        const { cell, cellX, cellY } = this.drawReconKSpace(ctx, ksX, ksY, ksSize,
            { dim: (ikx, iky) => !used.has(iky * n + ikx) });
        if (current) {
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2.5;
            ctx.strokeRect(cellX(current.ikx) - 1, cellY(current.iky) - 1, cell + 2, cell + 2);
        }

        // ---- Right: the basis pattern of the latest component ----
        const patX = ksX + ksSize + 70;
        const patSize = Math.min(ksSize, w - patX - 20);
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        ctx.fillText(current ? `Pattern for k = (${current.kx}, ${current.ky})` : 'Pattern', patX + patSize / 2, 18);
        this.drawArrow(ctx, ksX + ksSize + 14, ksY + ksSize / 2, patX - 14, ksY + ksSize / 2, '#22d3ee', 1.5, 6);
        if (!current) {
            ctx.font = '10px Inter';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('press Play or Step', patX + patSize / 2, ksY + patSize / 2);
            return;
        }
        // Re{S·e^(+iφ)} = |S|·cos(φ + ∠S): a 2D cosine grating; ∠S shifts it, |S| scales it (shown normalized)
        const S = this.measuredSample(current.iky, current.ikx);
        const clean = r.kspace[current.iky][current.ikx];
        const magS = Math.sqrt(S.re * S.re + S.im * S.im);
        const absent = magS < 1e-6 * Math.max(1e-9, r.total);
        const noiseSD = this.getReconNoiseSD();
        const mostlyNoise = noiseSD > 0 && Math.hypot(clean.re, clean.im) < 2 * noiseSD;
        const angle = absent ? 0 : Math.atan2(S.im, S.re);
        const pc = patSize / n;
        for (let iy = 0; iy < n; iy++) {
            for (let ix = 0; ix < n; ix++) {
                const v = Math.cos(this.kPhase(current.kx, current.ky, ix, iy, n) + angle);
                const g = Math.floor(128 + (absent ? 50 : 127) * v);
                ctx.fillStyle = `rgb(${g}, ${g}, ${g})`;
                ctx.fillRect(patX + ix * pc, ksY + iy * pc, pc, pc);
            }
        }
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.strokeRect(patX, ksY, patSize, patSize);
        ctx.font = '9px Inter';
        ctx.fillStyle = absent ? '#ef4444' : '#94a3b8';
        const phaseText = `${(angle * 180 / Math.PI).toFixed(0)}°`;
        ctx.fillText(absent ? (narrow ? 'weight ≈ 0 (absent)' : 'weight ≈ 0: this pattern is not in the object')
                            : (narrow ? `|S|/N² ${(magS / (n * n)).toFixed(3)}, ∠${phaseText}`
                                      : `weight |S|/N² = ${(magS / (n * n)).toFixed(3)} · phase ${phaseText}`),
                     patX + patSize / 2, ksY + patSize + 13);
        ctx.fillStyle = mostlyNoise ? '#f472b6' : '#94a3b8';
        ctx.fillText(mostlyNoise ? (narrow ? 'mostly noise here' : 'mostly noise: the object has ~no content at this k')
                                 : 'image += weight × pattern', patX + patSize / 2, ksY + patSize + 26);
    }

    renderReconWeight(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const r = this.recon;
        const n = r.n;
        const current = r.compIndex > 0 ? r.order[r.compIndex - 1] : null;
        const sMax = Math.max(1e-9, r.total);

        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Weight of the latest pattern', w / 2, 14);

        const cx = w / 2;
        const cy = 30 + (h - 110) / 2;
        const R = Math.min(w / 2 - 16, (h - 110) / 2);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - R - 6, cy);
        ctx.lineTo(cx + R + 6, cy);
        ctx.moveTo(cx, cy - R - 6);
        ctx.lineTo(cx, cy + R + 6);
        ctx.stroke();
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('Re', cx + R + 2, cy - 3);
        ctx.fillText('Im', cx + 3, cy - R - 2);

        if (current) {
            const S = this.measuredSample(current.iky, current.ikx);
            if (this.getReconNoiseSD() > 0) {
                const clean = r.kspace[current.iky][current.ikx];
                this.drawArrow(ctx, cx, cy, cx + (clean.re / sMax) * R, cy - (clean.im / sMax) * R, 'rgba(255, 255, 255, 0.55)', 1.2, 6);
                ctx.font = '8px Inter';
                ctx.fillStyle = '#94a3b8';
                ctx.textAlign = 'left';
                ctx.fillText('white: noiseless · cyan: measured', 6, 28);
            }
            this.drawArrow(ctx, cx, cy, cx + (S.re / sMax) * R, cy - (S.im / sMax) * R, '#22d3ee', 2.5, 8);
            const magS = Math.sqrt(S.re * S.re + S.im * S.im);
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#22d3ee';
            ctx.fillText(`S(${current.kx}, ${current.ky}) = ${(magS / sMax * 100).toFixed(0)}% of DC`, w / 2, h - 58);
        }
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('magnitude → contrast of the stripes', w / 2, h - 42);
        ctx.fillText('phase → where the stripes sit', w / 2, h - 28);
        ctx.fillText(r.stage === 'done' ? `all ${n * n} patterns added` : 'center of k-space = biggest weights', w / 2, h - 15);
    }

    // ===================== MODULE E: SLICE SELECTION =====================

    /**
     * Slice geometry from the controls (real units).
     * f(z) = γ̄·Gz·z ; BW = TBW / T ; Δz = BW / (γ̄·Gz) ; z_c = Δf_c / (γ̄·Gz)
     */
    getSliceParams() {
        const s = this.slice;
        const gammaGz = GAMMA_BAR_HZ_PER_MT_M_MM * s.gz;   // Hz per mm
        const bwHz = s.tbw / (s.duration / 1000);
        const fcHz = s.fcKHz * 1000;
        return { gammaGz, bwHz, fcHz, dz: bwHz / gammaGz, zc: fcHz / gammaGz };
    }

    // Hann-windowed sinc RF envelope, t in seconds within [-T/2, T/2]
    rfEnvelope(t, T, tbw) {
        const x = tbw * t / T;
        const sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const hann = 0.5 * (1 + Math.cos(2 * Math.PI * t / T));
        return sinc * hann;
    }

    /**
     * Excitation profile vs frequency offset from the RF center (Hz).
     * Small-tip approximation: profile(f) = |FT{B1(t)}(f)| / |FT{B1(t)}(0)|
     */
    sliceProfile(freqs) {
        const T = this.slice.duration / 1000;
        const numT = 200;
        const ts = [];
        const b1 = [];
        let area = 0;
        for (let i = 0; i < numT; i++) {
            const t = ((i + 0.5) / numT - 0.5) * T;
            ts.push(t);
            const b = this.rfEnvelope(t, T, this.slice.tbw);
            b1.push(b);
            area += b;
        }
        // Beyond a few bandwidths the true profile is ~0; skipping it also avoids the
        // spectral replicas (every numT/T Hz) of the sampled pulse
        const fLimit = 4 * this.slice.tbw / T;
        return freqs.map(f => {
            if (Math.abs(f) > fLimit) return 0;
            let re = 0, im = 0;
            for (let i = 0; i < numT; i++) {
                const a = 2 * Math.PI * f * ts[i];
                re += b1[i] * Math.cos(a);
                im -= b1[i] * Math.sin(a);
            }
            return Math.sqrt(re * re + im * im) / area;
        });
    }

    renderSliceModule() {
        const p = this.getSliceParams();
        document.getElementById('slice-bw-out').textContent = `${(p.bwHz / 1000).toFixed(1)} kHz`;
        document.getElementById('slice-dz-out').textContent = p.dz >= 100 ? `${p.dz.toFixed(0)} mm` : `${p.dz.toFixed(1)} mm`;
        document.getElementById('slice-zc-out').textContent = `${p.zc.toFixed(1)} mm`;

        if (this.spinCtx) this.renderSliceResonance(this.spinCtx, p);
        if (this.legendCtx) this.renderSliceSequence(this.legendCtx);
        if (this.kspaceCtx) this.renderSliceFourier(this.kspaceCtx, p);
        if (this.objectCtx) this.renderSliceSummary(this.objectCtx, p);
    }

    renderSliceResonance(ctx, p) {
        const { w, h } = this.beginPanel(ctx);
        const zMax = 100;  // mm
        const margin = { left: 58, right: 22, top: 30 };
        const plotW = w - margin.left - margin.right;
        const plotTop = margin.top;
        const plotBottom = h - 112;
        const plotH = plotBottom - plotTop;
        const fMax = p.gammaGz * zMax;  // Hz at the edge of the view

        const zToX = z => margin.left + (z + zMax) / (2 * zMax) * plotW;
        const fToY = f => plotTop + (1 - (f + fMax) / (2 * fMax)) * plotH;

        // Profile along z (pixel resolution) for the shaded slab and the spins
        const numZ = Math.max(200, Math.floor(plotW));
        const zs = [];
        for (let i = 0; i < numZ; i++) zs.push(-zMax + (i + 0.5) / numZ * 2 * zMax);
        const profile = this.sliceProfile(zs.map(z => p.gammaGz * z - p.fcHz));

        // Excited slab: column shading ∝ actual profile
        const colW = plotW / numZ;
        zs.forEach((z, i) => {
            if (profile[i] < 0.01) return;
            ctx.fillStyle = `rgba(16, 185, 129, ${0.4 * Math.min(1, profile[i])})`;
            ctx.fillRect(zToX(z) - colW / 2, plotTop, colW + 0.5, plotH);
        });

        // Axes
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.strokeRect(margin.left, plotTop, plotW, plotH);
        ctx.beginPath();
        ctx.moveTo(margin.left, fToY(0));
        ctx.lineTo(margin.left + plotW, fToY(0));
        ctx.moveTo(zToX(0), plotTop);
        ctx.lineTo(zToX(0), plotBottom);
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
        ctx.stroke();

        // f-axis ticks (kHz)
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        [-1, -0.5, 0, 0.5, 1].forEach(frac => {
            const f = frac * fMax;
            ctx.fillText((f / 1000).toFixed(f === 0 ? 0 : 1), margin.left - 5, fToY(f) + 3);
        });
        ctx.save();
        ctx.translate(14, plotTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Δf = f − f₀ (kHz)', 0, 0);
        ctx.restore();

        // z-axis ticks (mm)
        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748b';
        [-100, -50, 0, 50, 100].forEach(z => ctx.fillText(z, zToX(z), plotBottom + 12));

        // RF band (horizontal stripe)
        const bandTop = fToY(Math.min(fMax, p.fcHz + p.bwHz / 2));
        const bandBottom = fToY(Math.max(-fMax, p.fcHz - p.bwHz / 2));
        if (bandBottom > bandTop) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
            ctx.fillRect(margin.left, bandTop, plotW, Math.max(1.5, bandBottom - bandTop));
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(margin.left, bandTop, plotW, Math.max(1.5, bandBottom - bandTop));
        }
        ctx.font = 'bold 9px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        const bandLabelY = Math.min(plotBottom - 6, Math.max(plotTop + 10, bandTop - 4));
        ctx.fillText(`RF band: Δf_c ± BW/2 (BW = ${(p.bwHz / 1000).toFixed(1)} kHz)`, margin.left + 6, bandLabelY);

        // Resonance line f(z) = γ̄·Gz·z
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(zToX(-zMax), fToY(-fMax));
        ctx.lineTo(zToX(zMax), fToY(fMax));
        ctx.stroke();
        ctx.font = 'bold 10px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'left';
        ctx.fillText(`f(z) = γ̄·Gz·z  (${p.gammaGz.toFixed(0)} Hz/mm)`, margin.left + 6, plotTop + 14);

        // Ideal slab edges: project the band/line intersections down to the z axis
        const z1 = p.zc - p.dz / 2;
        const z2 = p.zc + p.dz / 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.lineWidth = 1;
        [z1, z2].forEach(z => {
            if (Math.abs(z) > zMax) return;
            ctx.beginPath();
            ctx.moveTo(zToX(z), fToY(p.gammaGz * z));
            ctx.lineTo(zToX(z), plotBottom);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // Slice label
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        if (Math.abs(p.zc) <= zMax) {
            ctx.fillStyle = '#10b981';
            const labelX = Math.min(margin.left + plotW - 60, Math.max(margin.left + 60, zToX(p.zc)));
            ctx.fillText(`Excited slice: Δz = ${p.dz >= 100 ? p.dz.toFixed(0) : p.dz.toFixed(1)} mm`, labelX, plotBottom - 8);
        } else {
            ctx.fillStyle = '#ef4444';
            ctx.fillText(`Slice center outside view (z_c = ${p.zc.toFixed(0)} mm)`, margin.left + plotW / 2, plotBottom - 8);
        }

        // Title
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        const narrow = w < 640;
        ctx.fillText(narrow ? 'Only spins in the RF band are tipped (resonance)'
                            : 'Only spins whose Larmor frequency matches the RF band are tipped (resonance)', margin.left, 18);

        // ---- Spins along z ----
        const rowY = plotBottom + 52;
        const arrowLen = 26;
        // Faint body outline (patient lying along z)
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const bodyL = zToX(-95), bodyR = zToX(95);
        const bodyH = arrowLen + 18;
        ctx.roundRect ? ctx.roundRect(bodyL, rowY - bodyH / 2, bodyR - bodyL, bodyH, bodyH / 2)
                      : ctx.rect(bodyL, rowY - bodyH / 2, bodyR - bodyL, bodyH);
        ctx.fill();
        ctx.stroke();

        const numArrows = Math.min(61, Math.floor(plotW / 11));
        const binW = 2 * zMax / numArrows;
        for (let a = 0; a < numArrows; a++) {
            const zLo = -zMax + a * binW;
            const zHi = zLo + binW;
            // Bin-average of the profile = net tip of the spins in that bin
            let sum = 0, count = 0;
            zs.forEach((z, i) => { if (z >= zLo && z < zHi) { sum += profile[i]; count++; } });
            const prof = count ? sum / count : 0;
            const tip = Math.min(1, prof) * this.slice.flip * Math.PI / 180;
            const x = zToX((zLo + zHi) / 2);
            const dx = Math.sin(tip) * arrowLen;
            const dy = -Math.cos(tip) * arrowLen;
            const mix = Math.min(1, prof * 1.5);
            const r = Math.floor(100 + mix * (16 - 100));
            const g = Math.floor(116 + mix * (185 - 116));
            const b = Math.floor(139 + mix * (129 - 139));
            const color = `rgb(${r}, ${g}, ${b})`;
            const baseY = rowY + arrowLen / 2 - 4;
            this.drawArrow(ctx, x - dx / 2, baseY, x + dx / 2, baseY + dy, color, 1.6, 5);
        }
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(narrow ? 'z (mm) — spins tipped only inside the slice'
                            : 'z (mm) — spins along the patient: tipped only inside the slice (B₀ ↑)', margin.left + plotW / 2, h - 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#64748b';
        ctx.font = '8px Inter';
        if (!narrow) ctx.fillText('f₀ = γ̄B₀ ≈ 63.87 MHz at 1.5 T — plotted as offsets', margin.left + plotW, plotTop - 4);
    }

    renderSliceSequence(ctx) {
        const { w, h } = this.beginPanel(ctx);
        const { margin, plotW, rows } = this.drawSequenceChannels(ctx, w, h, 'Slice Selection', ['RF', 'Gz']);
        const s = this.slice;
        const xStart = margin.left;

        // RF: sinc with TBW zero crossings, width ∝ pulse duration
        const rfW = plotW * (0.06 + 0.24 * s.duration / 8);
        const rfX = xStart + plotW * 0.08 + plotW * 0.15 - rfW / 2;
        const rf = rows.RF;
        ctx.strokeStyle = rf.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
            const u = i / 80 - 0.5;
            const v = this.rfEnvelope(u, 1, s.tbw);
            const px = rfX + (i / 80) * rfW;
            const py = rf.y - v * rf.amp;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Gz: slice-select lobe during the RF (amplitude ∝ Gz) + half-area rephaser
        const gz = rows.Gz;
        const gzAmp = gz.amp * (0.2 + 0.8 * s.gz / 40);
        const ramp = rfW * 0.15 / 0.7;
        const gzW = rfW + 2 * ramp;
        this.drawTrapezoid(ctx, rfX - ramp, gz.y, gzW, gzAmp, gz.color);
        this.drawTrapezoid(ctx, rfX - ramp + gzW, gz.y, gzW * 0.5, -gzAmp, gz.color);
        ctx.font = 'bold 7px Inter';
        ctx.fillStyle = gz.color;
        ctx.textAlign = 'center';
        ctx.fillText(`Gz = ${s.gz} mT/m`, rfX + rfW / 2, gz.y - gzAmp - 4);
        ctx.fillStyle = rf.color;
        ctx.fillText(`T = ${s.duration.toFixed(1)} ms`, rfX + rfW / 2, rf.y - rf.amp - 4);

        // Dimmed encoding/readout channels
        ctx.globalAlpha = 0.2;
        const afterX = rfX - ramp + gzW * 1.5;
        const rest = xStart + plotW - afterX;
        this.drawTrapezoid(ctx, afterX + rest * 0.05, rows.Gy.y, rest * 0.18, rows.Gy.amp * 0.5, rows.Gy.color);
        this.drawTrapezoid(ctx, afterX + rest * 0.05, rows.Gx.y, rest * 0.12, -rows.Gx.amp * 0.4, rows.Gx.color);
        this.drawTrapezoid(ctx, afterX + rest * 0.35, rows.Gx.y, rest * 0.55, rows.Gx.amp * 0.6, rows.Gx.color);
        ctx.strokeStyle = rows.Signal.color;
        ctx.lineWidth = 1.5;
        this.drawEcho(ctx, afterX + rest * 0.35, rows.Signal.y, rest * 0.55, rows.Signal.amp * 0.7);
        ctx.globalAlpha = 1.0;
    }

    renderSliceFourier(ctx, p) {
        const { w, h } = this.beginPanel(ctx);
        const s = this.slice;
        const top = 40, bottom = h - 46;
        const plotH = bottom - top;
        const gap = 46;
        const halfW = (w - 60 - gap) / 2;
        const leftX = 40;
        const rightX = leftX + halfW + gap;

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        const narrow = w < 640;
        ctx.fillText('RF envelope B₁(t)', leftX, 22);
        ctx.fillText(narrow ? 'Profile = |FT{B₁}|' : 'Excitation profile (|Fourier transform|)', rightX, 22);

        // ---- Left: B1(t) on a fixed ±4 ms axis so pulse length changes are visible ----
        const tMax = 4;  // ms
        const tToX = t => leftX + (t + tMax) / (2 * tMax) * halfW;
        const baseY = top + plotH * 0.72;
        const ampPx = plotH * 0.65;
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftX, baseY);
        ctx.lineTo(leftX + halfW, baseY);
        ctx.stroke();
        const T = s.duration;
        ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
            const t = (i / 200 - 0.5) * T;
            const v = this.rfEnvelope(t, T, s.tbw);
            const px = tToX(t), py = baseY - v * ampPx;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(tToX(T / 2), baseY);
        ctx.lineTo(tToX(-T / 2), baseY);
        ctx.closePath();
        ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
        ctx.fill();
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        [-4, -2, 0, 2, 4].forEach(t => ctx.fillText(t, tToX(t), bottom + 12));
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('time (ms)', leftX + halfW / 2, bottom + 26);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 9px Inter';
        ctx.fillText(`T = ${T.toFixed(1)} ms, ${s.tbw} zero crossings`, leftX + halfW / 2, top - 4);

        // FT arrow between the halves
        ctx.font = 'bold 12px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'center';
        ctx.fillText('FT', leftX + halfW + gap / 2, top + plotH / 2 - 8);
        this.drawArrow(ctx, leftX + halfW + 8, top + plotH / 2, leftX + halfW + gap - 8, top + plotH / 2, '#22d3ee', 2, 6);

        // ---- Right: profile vs (f − f_c), axis widens only when BW is very large ----
        const fRange = Math.max(10000, p.bwHz);  // Hz, half-width of the axis
        const fToX = f => rightX + (f + fRange) / (2 * fRange) * halfW;
        const numF = Math.floor(halfW);
        const fs = [];
        for (let i = 0; i <= numF; i++) fs.push(-fRange + (i / numF) * 2 * fRange);
        const prof = this.sliceProfile(fs);
        const profBase = top + plotH * 0.85;
        const profAmp = plotH * 0.75;

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rightX, profBase);
        ctx.lineTo(rightX + halfW, profBase);
        ctx.stroke();

        // Ideal rectangle (dashed)
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(rightX, profBase);
        ctx.lineTo(fToX(-p.bwHz / 2), profBase);
        ctx.lineTo(fToX(-p.bwHz / 2), profBase - profAmp);
        ctx.lineTo(fToX(p.bwHz / 2), profBase - profAmp);
        ctx.lineTo(fToX(p.bwHz / 2), profBase);
        ctx.lineTo(rightX + halfW, profBase);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        fs.forEach((f, i) => {
            const px = fToX(f), py = profBase - Math.min(1.2, prof[i]) * profAmp;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(rightX + halfW, profBase);
        ctx.lineTo(rightX, profBase);
        ctx.closePath();
        ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
        ctx.fill();

        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        const tick = fRange / 2;
        [-fRange, -tick, 0, tick, fRange].forEach(f => ctx.fillText((f / 1000).toFixed(0), fToX(f), bottom + 12));
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('f − f_c (kHz)', rightX + halfW / 2, bottom + 26);

        // Mapping to position via Gz
        ctx.font = 'bold 9px Inter';
        ctx.fillStyle = '#10b981';
        const dzText = p.dz >= 100 ? p.dz.toFixed(0) : p.dz.toFixed(1);
        ctx.fillText(narrow ? `BW ${(p.bwHz / 1000).toFixed(1)} kHz → Δz ${dzText} mm`
                            : `BW = ${(p.bwHz / 1000).toFixed(1)} kHz  →  Δz = BW/(γ̄Gz) = ${dzText} mm`, rightX + halfW / 2, top - 4);
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('- - ideal slab', rightX + 4, top + 10);

        // Bottom note
        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText(narrow ? 'Shorter pulse → wider BW → thicker slice'
                            : 'Shorter pulse → wider bandwidth → thicker slice. More lobes → sharper slice edges.', w / 2, h - 6);
    }

    renderSliceSummary(ctx, p) {
        const { w, h } = this.beginPanel(ctx);
        const lines = [
            ['γ̄ (¹H)', '42.58 MHz/T', '#94a3b8'],
            ['γ̄·Gz', `${p.gammaGz.toFixed(0)} Hz/mm`, '#22d3ee'],
            ['RF BW = TBW/T', `${(p.bwHz / 1000).toFixed(2)} kHz`, '#f59e0b'],
            ['Δz = BW/(γ̄Gz)', `${p.dz >= 100 ? p.dz.toFixed(0) : p.dz.toFixed(2)} mm`, '#10b981'],
            ['z_c = Δf_c/(γ̄Gz)', `${p.zc.toFixed(1)} mm`, '#10b981']
        ];
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Slice Geometry', w / 2, 16);

        let y = 40;
        lines.forEach(([label, value, color]) => {
            ctx.font = '10px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(label, 14, y);
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'right';
            ctx.fillStyle = color;
            ctx.fillText(value, w - 14, y);
            y += 22;
        });

        y += 8;
        ctx.strokeStyle = '#334155';
        ctx.beginPath();
        ctx.moveTo(14, y - 12);
        ctx.lineTo(w - 14, y - 12);
        ctx.stroke();

        const tips = [
            ['Thinner slice:', '#e2e8f0'],
            ['  ↑ Gz (steeper f(z) line)', '#22d3ee'],
            ['  ↓ BW (longer RF pulse)', '#f59e0b'],
            ['Move the slice:', '#e2e8f0'],
            ['  shift the RF center frequency', '#10b981'],
            ['Sharper edges:', '#e2e8f0'],
            ['  more sinc lobes (higher TBW)', '#f59e0b']
        ];
        tips.forEach(([text, color]) => {
            if (y > h - 6) return;
            ctx.font = text.startsWith('  ') ? '10px Inter' : 'bold 10px Inter';
            ctx.textAlign = 'left';
            ctx.fillStyle = color;
            ctx.fillText(text, 14, y);
            y += 17;
        });
    }

    // ===================== MODULE D: FREQUENCY ENCODING → FOURIER =====================

    // 1D objects as tubes/blocks {x0, x1 (mm), rho}
    getFreqObject() {
        switch (this.freq.object) {
            case 'three':
                return [{ x0: -58, x1: -42, rho: 1.0 }, { x0: -12, x1: 12, rho: 0.5 }, { x0: 40, x1: 52, rho: 0.8 }];
            case 'wide':
                return [{ x0: -30, x1: 30, rho: 1.0 }];
            case 'wider':
                return [{ x0: -115, x1: -85, rho: 0.6 }, { x0: -25, x1: -5, rho: 1.0 }, { x0: 90, x1: 110, rho: 0.8 }];
            case 'two':
            default:
                return [{ x0: -50, x1: -30, rho: 1.0 }, { x0: 20, x1: 50, rho: 0.6 }];
        }
    }

    /**
     * Readout geometry (real units): γ̄Gx in Hz/mm, Δt = 1/BW,
     * FOV = BW/(γ̄Gx), Δx = FOV/N, Δk = 1/FOV (cycles/mm)
     */
    getFreqParams() {
        const f = this.freq;
        const gammaGx = GAMMA_BAR_HZ_PER_MT_M_MM * f.gx;
        const bwHz = f.bwKHz * 1000;
        const dt = 1 / bwHz;
        const N = f.numSamples;
        const fov = bwHz / gammaGx;
        return { gammaGx, bwHz, dt, N, fov, dx: fov / N, dk: 1 / fov, tacq: N * dt, tNow: f.t * N * dt };
    }

    /**
     * Signal of one tube at spatial frequency k (cycles/mm), exact for a uniform block:
     * ∫ ρ·e^(-i2πkx) dx over [x0, x1]
     */
    segmentPhasor(seg, k) {
        const a = 2 * Math.PI * k;
        if (Math.abs(a) < 1e-12) return { re: seg.rho * (seg.x1 - seg.x0), im: 0 };
        return {
            re: seg.rho * (Math.sin(a * seg.x1) - Math.sin(a * seg.x0)) / a,
            im: seg.rho * (Math.cos(a * seg.x1) - Math.cos(a * seg.x0)) / a
        };
    }

    // Total received signal at time t (s, 0 = echo): S(t) = Σ ρ(x)·e^(-i2π γ̄Gx x t)
    freqSignal(segs, k) {
        let re = 0, im = 0;
        segs.forEach(seg => {
            const s = this.segmentPhasor(seg, k);
            re += s.re;
            im += s.im;
        });
        return { re, im };
    }

    /**
     * Reconstruction: N samples S_n at k_n = (n - N/2)·Δk, N-point inverse DFT
     * ρ̂(x_m) = Δk · Σ S_n e^(+i2π k_n x_m),  x_m = (m - N/2)·Δx  (wraps outside the FOV)
     */
    drawFreqNoise() {
        this.freq.noiseZ = Array.from({ length: 128 }, () => ({ re: this.gaussian(), im: this.gaussian() }));
    }

    /**
     * Receiver noise per sample (ρ·mm units). White noise of fixed spectral density,
     * filtered to the receiver bandwidth → σ ∝ √BW. Scaled so that at the reference
     * (32 kHz, 5 mT/m, N = 64) the profile noise SD is 0.06 (low) or 0.15 (high).
     */
    getFreqNoiseSigma(p) {
        const sdRef = { off: 0, low: 0.06, high: 0.15 }[this.freq.noise];
        const fovRef = 32000 / (GAMMA_BAR_HZ_PER_MT_M_MM * 5);
        const sigmaRef = sdRef * fovRef / Math.sqrt(64);  // profile SD = Δk·√N·σ
        return sigmaRef * Math.sqrt(p.bwHz / 32000);
    }

    // SNR ∝ voxel size × √(readout time), relative to 32 kHz, 5 mT/m, N = 64
    getFreqRelativeSNR(p) {
        const dxRef = 32000 / (GAMMA_BAR_HZ_PER_MT_M_MM * 5) / 64;
        const tRef = 64 / 32000;
        return (p.dx / dxRef) * Math.sqrt(p.tacq / tRef);
    }

    reconstructFreq(segs, p) {
        const samples = [];
        const sigma = this.getFreqNoiseSigma(p);
        for (let n = 0; n < p.N; n++) {
            const k = (n - p.N / 2) * p.dk;
            const clean = this.freqSignal(segs, k);
            const z = this.freq.noiseZ[n];
            samples.push({ k, re: clean.re + sigma * z.re, im: clean.im + sigma * z.im });
        }
        const recon = [];
        for (let m = 0; m < p.N; m++) {
            const x = (m - p.N / 2) * p.dx;
            let re = 0, im = 0;
            samples.forEach(s => {
                const a = 2 * Math.PI * s.k * x;
                re += s.re * Math.cos(a) - s.im * Math.sin(a);
                im += s.re * Math.sin(a) + s.im * Math.cos(a);
            });
            recon.push({ x, mag: Math.sqrt(re * re + im * im) * p.dk });
        }
        return { samples, recon };
    }

    startFreqAnimation() {
        if (this.freq.playing) return;
        this.freq.playing = true;
        const btn = document.getElementById('freq-play-btn');
        if (btn) btn.innerHTML = '&#10074;&#10074; Pause Readout';
        const step = () => {
            if (!this.freq.playing) return;
            this.freq.t += 1 / (60 * 5);  // ~5 s per readout sweep
            if (this.freq.t > 0.5) this.freq.t = -0.5;
            const slider = document.getElementById('freq-time');
            if (slider) slider.value = Math.round(this.freq.t * 1000);
            this.render();
            this.freq.animationId = requestAnimationFrame(step);
        };
        this.freq.animationId = requestAnimationFrame(step);
    }

    stopFreqAnimation() {
        this.freq.playing = false;
        if (this.freq.animationId) {
            cancelAnimationFrame(this.freq.animationId);
            this.freq.animationId = null;
        }
        const btn = document.getElementById('freq-play-btn');
        if (btn) btn.innerHTML = '&#9654; Play Readout';
    }

    renderFreqModule() {
        const p = this.getFreqParams();
        const segs = this.getFreqObject();
        const { samples, recon } = this.reconstructFreq(segs, p);
        const kNow = p.gammaGx * p.tNow;  // cycles/mm at the cursor time

        document.getElementById('freq-fov-out').textContent = `${p.fov.toFixed(0)} mm`;
        document.getElementById('freq-dx-out').textContent = `${p.dx.toFixed(p.dx < 10 ? 1 : 0)} mm`;
        document.getElementById('freq-tacq-out').textContent = `${(p.tacq * 1000).toFixed(2)} ms`;
        const snrOut = document.getElementById('freq-snr-out');
        if (snrOut) {
            snrOut.innerHTML = `Relative SNR <b>${this.getFreqRelativeSNR(p).toFixed(2)}×</b> (∝ Δx·√T<sub>acq</sub>; ref. 32 kHz, 5 mT/m, N = 64)` +
                (this.freq.lockFov ? ` · FOV locked at ${this.freq.fovLock.toFixed(0)} mm` : ' · G<sub>x</sub> fixed');
        }
        const tLabel = document.getElementById('freq-time-val');
        if (tLabel) {
            const tms = p.tNow * 1000;
            tLabel.textContent = Math.abs(this.freq.t) < 0.004 ? 't = 0 (echo)' : `t = ${tms >= 0 ? '+' : ''}${tms.toFixed(2)} ms`;
        }

        if (this.spinCtx) this.renderFreqObject(this.spinCtx, p, segs, kNow);
        if (this.legendCtx) this.renderFreqSequence(this.legendCtx, p);
        if (this.kspaceCtx) this.renderFreqSignal(this.kspaceCtx, p, segs, samples, recon);
        if (this.objectCtx) this.renderFreqPhasors(this.objectCtx, p, segs, kNow);
    }

    renderFreqObject(ctx, p, segs, kNow) {
        const { w, h } = this.beginPanel(ctx);
        const xView = 150;  // mm, half-width of the displayed x range
        const margin = { left: 40, right: 24 };
        const plotW = w - margin.left - margin.right;
        const xToPx = x => margin.left + (x + xView) / (2 * xView) * plotW;

        // Title
        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        const narrow = w < 640;
        ctx.fillText(narrow ? 'Each position has its own pitch' : 'Each position precesses at its own frequency ("pitch")', margin.left, 18);
        ctx.font = 'bold 10px Inter';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'right';
        const tms = p.tNow * 1000;
        ctx.fillText(Math.abs(this.freq.t) < 0.004 ? 't = 0 (echo: all in phase)' : `t = ${tms >= 0 ? '+' : ''}${tms.toFixed(2)} ms`, w - margin.right, 18);

        // ---- Object profile ----
        const objTop = 44, objBottom = h * 0.42;
        const objH = objBottom - objTop;

        // Outside-FOV shading
        const fovL = Math.max(margin.left, xToPx(-p.fov / 2));
        const fovR = Math.min(margin.left + plotW, xToPx(p.fov / 2));
        ctx.fillStyle = 'rgba(100, 116, 139, 0.12)';
        if (fovL > margin.left) ctx.fillRect(margin.left, objTop - 6, fovL - margin.left, objH + 6);
        if (fovR < margin.left + plotW) ctx.fillRect(fovR, objTop - 6, margin.left + plotW - fovR, objH + 6);

        // Tubes
        segs.forEach(seg => {
            const xc = (seg.x0 + seg.x1) / 2;
            const col = this.xColor((xc + xView) / (2 * xView));
            const x0 = xToPx(Math.max(-xView, seg.x0));
            const x1 = xToPx(Math.min(xView, seg.x1));
            const top = objBottom - seg.rho * objH;
            ctx.fillStyle = this.xColor((xc + xView) / (2 * xView), 0.35);
            ctx.fillRect(x0, top, x1 - x0, objBottom - top);
            ctx.strokeStyle = col;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x0, top, x1 - x0, objBottom - top);
        });

        // Baseline and FOV markers
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, objBottom);
        ctx.lineTo(margin.left + plotW, objBottom);
        ctx.stroke();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#f59e0b';
        ctx.font = '9px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        [-p.fov / 2, p.fov / 2].forEach(x => {
            if (Math.abs(x) > xView) return;
            ctx.beginPath();
            ctx.moveTo(xToPx(x), objTop - 8);
            ctx.lineTo(xToPx(x), objBottom);
            ctx.stroke();
        });
        ctx.setLineDash([]);
        const fovText = p.fov / 2 > xView ? `FOV = ${p.fov.toFixed(0)} mm (wider than view)` : `FOV = ${p.fov.toFixed(0)} mm`;
        ctx.fillText(fovText, xToPx(0), objTop - 10);
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('ρ(x)', margin.left + 2, objTop + 4);

        // Top frequency axis (kHz): f = γ̄·Gx·x
        ctx.font = '8px Inter';
        ctx.fillStyle = '#a855f7';
        ctx.textAlign = 'center';
        [-150, -75, 0, 75, 150].forEach(x => {
            ctx.fillText(`${(p.gammaGx * x / 1000).toFixed(1)} kHz`, xToPx(x), objBottom + 12);
        });

        // ---- Phase strip: hue = phase φ(x, t) = -2π·k(t)·x ----
        const stripTop = objBottom + 24, stripH = Math.max(14, h * 0.09);
        const object = x => segs.some(seg => x >= seg.x0 && x <= seg.x1);
        for (let px = 0; px < plotW; px++) {
            const x = -xView + (px + 0.5) / plotW * 2 * xView;
            const phase = -2 * Math.PI * kNow * x;
            const hue = ((phase / (2 * Math.PI)) % 1 + 1) % 1 * 360;
            ctx.fillStyle = `hsl(${hue}, 80%, ${object(x) ? 55 : 14}%)`;
            ctx.fillRect(margin.left + px, stripTop, 1.5, stripH);
        }
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(margin.left, stripTop, plotW, stripH);
        ctx.font = '8px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'left';
        ctx.fillText('spin phase along x (colour = phase; bright where there is tissue)', margin.left, stripTop + stripH + 11);

        // ---- One clock per tube: its net phasor (hand) spins at f = γ̄Gx·x_center ----
        const clockY = stripTop + stripH + 26 + (h - (stripTop + stripH + 26) - 30) / 2;
        const clockR = Math.min(22, (h - clockY - 24));
        segs.forEach(seg => {
            const xc = (seg.x0 + seg.x1) / 2;
            if (Math.abs(xc) > xView) return;
            const cx = xToPx(xc);
            const col = this.xColor((xc + xView) / (2 * xView));
            const ph = this.segmentPhasor(seg, kNow);
            const full = seg.rho * (seg.x1 - seg.x0);
            const coherence = Math.sqrt(ph.re * ph.re + ph.im * ph.im) / full;
            const angle = Math.atan2(ph.im, ph.re);
            const centerPhase = -2 * Math.PI * kNow * xc;

            ctx.beginPath();
            ctx.arc(cx, clockY, clockR, 0, 2 * Math.PI);
            ctx.fillStyle = '#111827';
            ctx.fill();
            ctx.strokeStyle = col;
            ctx.lineWidth = 2;
            ctx.stroke();
            // Thin hand: phase at the tube centre, turning at f = γ̄Gx·x (Re right, Im up)
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, clockY);
            ctx.lineTo(cx + Math.cos(centerPhase) * clockR * 0.95, clockY - Math.sin(centerPhase) * clockR * 0.95);
            ctx.stroke();
            // Arrow: the tube's net signal (shrinks as spins inside the tube dephase)
            this.drawArrow(ctx, cx, clockY,
                cx + Math.cos(angle) * clockR * 0.85 * coherence,
                clockY - Math.sin(angle) * clockR * 0.85 * coherence, col, 2.5, 6);
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = col;
            ctx.textAlign = 'center';
            ctx.fillText(`${(p.gammaGx * xc / 1000).toFixed(1)} kHz`, cx, clockY + clockR + 12);
        });

        // x axis
        ctx.font = '9px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText(narrow ? 'thin hand: phase at tube centre · arrow: tube\'s net signal'
                            : 'Clocks: thin hand = phase at tube centre (its pitch) · arrow = tube\'s net signal (shrinks as the tube dephases)',
                     margin.left + plotW / 2, h - 6);
    }

    renderFreqSequence(ctx, p) {
        const { w, h } = this.beginPanel(ctx);
        const { margin, plotW, rows } = this.drawSequenceChannels(ctx, w, h, 'Frequency Encoding (1D)', ['RF', 'Gz', 'Gx', 'Signal']);
        const xStart = margin.left;

        // Excitation (slice-selective)
        ctx.strokeStyle = rows.RF.color;
        ctx.lineWidth = 2;
        this.drawRFPulse(ctx, xStart + plotW * 0.06, rows.RF.y, plotW * 0.08, rows.RF.amp);
        this.drawTrapezoid(ctx, xStart + plotW * 0.03, rows.Gz.y, plotW * 0.14, rows.Gz.amp * 0.8, rows.Gz.color);
        this.drawTrapezoid(ctx, xStart + plotW * 0.17, rows.Gz.y, plotW * 0.06, -rows.Gz.amp * 0.4, rows.Gz.color);

        // No phase encoding in 1D
        ctx.font = '7px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('off (1D)', xStart + plotW * 0.35, rows.Gy.y - 4);

        // Gx dephaser (−half area) + readout; amplitude ∝ Gx
        const gx = rows.Gx;
        const gxAmp = gx.amp * (0.3 + 0.7 * this.freq.gx / 20);
        const roStart = xStart + plotW * 0.42;
        const roW = plotW * 0.52;
        this.drawTrapezoid(ctx, xStart + plotW * 0.25, gx.y, roW * 0.5, -gxAmp, gx.color);
        this.drawTrapezoid(ctx, roStart, gx.y, roW, gxAmp, gx.color);

        // ADC samples on the flat top (one tick per sample)
        const flatStart = roStart + roW * 0.15;
        const flatW = roW * 0.7;
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
        ctx.lineWidth = p.N > 64 ? 0.5 : 1;
        for (let n = 0; n < p.N; n++) {
            const px = flatStart + (n + 0.5) / p.N * flatW;
            ctx.beginPath();
            ctx.moveTo(px, rows.Signal.y + rows.Signal.amp + 2);
            ctx.lineTo(px, rows.Signal.y + rows.Signal.amp + 6);
            ctx.stroke();
        }
        ctx.font = '7px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`ADC: N = ${p.N}, Δt = ${(p.dt * 1e6).toFixed(0)} µs`, flatStart + flatW / 2, rows.Signal.y + rows.Signal.amp + 14);

        // Echo
        ctx.strokeStyle = rows.Signal.color;
        ctx.lineWidth = 2;
        this.drawEcho(ctx, flatStart, rows.Signal.y, flatW, rows.Signal.amp * 0.8);

        // Time cursor
        const cursorX = flatStart + (this.freq.t + 0.5) * flatW;
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(cursorX, gx.y - gxAmp - 10);
        ctx.lineTo(cursorX, rows.Signal.y + rows.Signal.amp);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cursorX, gx.y - gxAmp - 6, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#22d3ee';
        ctx.fill();

        ctx.font = 'bold 7px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        ctx.fillText('TE', flatStart + flatW / 2 + 10, rows.Signal.y - rows.Signal.amp * 0.8);
    }

    renderFreqSignal(ctx, p, segs, samples, recon) {
        const { w, h } = this.beginPanel(ctx);
        const margin = { left: 40, right: 24 };
        const plotW = w - margin.left - margin.right;
        const xView = 150;

        // ---------- Top: signal vs time ----------
        const sigTop = 30, sigBottom = h * 0.44;
        const sigMid = (sigTop + sigBottom) / 2;
        const sigAmp = (sigBottom - sigTop) / 2 * 0.92;
        const tHalf = p.N / 2 * p.dt;  // s
        const tToPx = t => margin.left + (t + tHalf) / (2 * tHalf) * plotW;
        const sMax = Math.max(1e-9, segs.reduce((acc, seg) => acc + seg.rho * (seg.x1 - seg.x0), 0));

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        const narrow = w < 640;
        ctx.fillText(narrow ? 'Received signal ("chord")' : 'Received signal = the "chord" of all positions', margin.left, 18);
        ctx.font = '8px Inter';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(narrow ? 'white: Re · amber: Im · dots: samples'
                            : (this.freq.noise === 'off' ? 'thin: each tube (Re)   white: total Re   amber: total Im   dots: ADC samples'
                                                         : 'lines: noiseless signal   dots: measured samples (with noise)'), w - margin.right, 18);

        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, sigMid);
        ctx.lineTo(margin.left + plotW, sigMid);
        ctx.moveTo(tToPx(0), sigTop);
        ctx.lineTo(tToPx(0), sigBottom);
        ctx.stroke();

        const numPts = Math.floor(plotW);
        const drawTrace = (fn, color, width) => {
            ctx.beginPath();
            for (let i = 0; i <= numPts; i++) {
                const t = -tHalf + (i / numPts) * 2 * tHalf;
                const v = fn(p.gammaGx * t);
                const py = sigMid - (v / sMax) * sigAmp;
                if (i === 0) ctx.moveTo(tToPx(t), py); else ctx.lineTo(tToPx(t), py);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.stroke();
        };
        if (segs.length > 1) {
            segs.forEach(seg => {
                const xc = (seg.x0 + seg.x1) / 2;
                drawTrace(k => this.segmentPhasor(seg, k).re, this.xColor((xc + xView) / (2 * xView), 0.75), 1);
            });
        }
        drawTrace(k => this.freqSignal(segs, k).im, 'rgba(245, 158, 11, 0.8)', 1.2);
        drawTrace(k => this.freqSignal(segs, k).re, '#ffffff', 2);

        // ADC samples
        const dotR = p.N > 64 ? 1.4 : 2.2;
        ctx.fillStyle = '#e2e8f0';
        samples.forEach((s, n) => {
            const t = (n - p.N / 2) * p.dt;
            ctx.beginPath();
            ctx.arc(tToPx(t), sigMid - (s.re / sMax) * sigAmp, dotR, 0, 2 * Math.PI);
            ctx.fill();
        });

        // Cursor
        const cx = tToPx(p.tNow);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, sigTop);
        ctx.lineTo(cx, sigBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText(`${(-tHalf * 1000).toFixed(2)} ms`, margin.left, sigBottom + 10);
        ctx.textAlign = 'right';
        ctx.fillText(`+${(tHalf * 1000).toFixed(2)} ms`, margin.left + plotW, sigBottom + 10);
        ctx.textAlign = 'center';
        ctx.fillText('0 (echo)', tToPx(0), sigBottom + 10);

        // ---------- Bottom: |DFT| = profile vs x ----------
        const recTop = h * 0.56, recBottom = h - 30;
        const recH = recBottom - recTop;
        const xToPx = x => margin.left + (x + xView) / (2 * xView) * plotW;
        const maxRho = Math.max(...segs.map(seg => seg.rho));
        const maxRecon = Math.max(...recon.map(r => r.mag));
        const yScale = Math.max(1.15 * maxRho, maxRecon);

        ctx.font = 'bold 11px Inter';
        ctx.fillStyle = '#10b981';
        ctx.textAlign = 'left';
        ctx.fillText(narrow ? 'FFT → spectrum = profile' : 'FFT of the samples → frequency spectrum = position profile', margin.left, recTop - 12);

        // Outside FOV shading
        const fovL = Math.max(margin.left, xToPx(-p.fov / 2));
        const fovR = Math.min(margin.left + plotW, xToPx(p.fov / 2));
        ctx.fillStyle = 'rgba(100, 116, 139, 0.12)';
        if (fovL > margin.left) ctx.fillRect(margin.left, recTop, fovL - margin.left, recH);
        if (fovR < margin.left + plotW) ctx.fillRect(fovR, recTop, margin.left + plotW - fovR, recH);

        // Reconstructed bars (width Δx)
        recon.forEach(r => {
            const x0 = r.x - p.dx / 2, x1 = r.x + p.dx / 2;
            if (x1 < -xView || x0 > xView) return;
            const px0 = xToPx(Math.max(-xView, x0)), px1 = xToPx(Math.min(xView, x1));
            const top = recBottom - (r.mag / yScale) * recH;
            ctx.fillStyle = this.xColor((r.x + xView) / (2 * xView), 0.75);
            ctx.fillRect(px0 + 0.3, top, Math.max(0.8, px1 - px0 - 0.6), recBottom - top);
        });

        // True object (dashed)
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(margin.left, recBottom);
        segs.slice().sort((a, b) => a.x0 - b.x0).forEach(seg => {
            const y = recBottom - (seg.rho / yScale) * recH;
            ctx.lineTo(xToPx(seg.x0), recBottom);
            ctx.lineTo(xToPx(seg.x0), y);
            ctx.lineTo(xToPx(seg.x1), y);
            ctx.lineTo(xToPx(seg.x1), recBottom);
        });
        ctx.lineTo(margin.left + plotW, recBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Axes, FOV edges ↔ ±BW/2
        ctx.strokeStyle = '#475569';
        ctx.beginPath();
        ctx.moveTo(margin.left, recBottom);
        ctx.lineTo(margin.left + plotW, recBottom);
        ctx.stroke();
        ctx.font = '8px Inter';
        ctx.textAlign = 'center';
        [-p.fov / 2, p.fov / 2].forEach((x, i) => {
            if (Math.abs(x) > xView) return;
            ctx.strokeStyle = '#f59e0b';
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(xToPx(x), recTop);
            ctx.lineTo(xToPx(x), recBottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#f59e0b';
            ctx.fillText(i === 0 ? '−BW/2 ↔ −FOV/2' : '+BW/2 ↔ +FOV/2', xToPx(x), recTop - 2);
        });
        ctx.fillStyle = '#64748b';
        [-150, -100, -50, 0, 50, 100, 150].forEach(x => ctx.fillText(x, xToPx(x), recBottom + 11));
        ctx.fillStyle = '#94a3b8';
        if (this.freq.noise !== 'off') {
            // Theory: profile noise SD = Δk·√N·σ with σ ∝ √BW
            const sd = p.dk * Math.sqrt(p.N) * this.getFreqNoiseSigma(p);
            ctx.fillStyle = '#f472b6';
            ctx.fillText(narrow ? `noise SD ≈ ${sd.toFixed(3)} · rel. SNR ${this.getFreqRelativeSNR(p).toFixed(2)}×`
                                : `x (mm) — bars = |FFT| (noise = grass-like floor) · noise SD ≈ ${sd.toFixed(3)} · relative SNR ${this.getFreqRelativeSNR(p).toFixed(2)}×`,
                         margin.left + plotW / 2, h - 6);
        } else {
            ctx.fillText(narrow ? `x (mm) — dashed: truth, bars: recon` : `x (mm)   — dashed: true object, bars: reconstruction (Δx = ${p.dx.toFixed(1)} mm)`,
                         margin.left + plotW / 2, h - 6);
        }

        // Aliasing warning
        const aliased = segs.some(seg => seg.x0 < -p.fov / 2 || seg.x1 > p.fov / 2);
        if (aliased) {
            ctx.font = 'bold 10px Inter';
            ctx.fillStyle = '#ef4444';
            ctx.textAlign = 'right';
            ctx.fillText(narrow ? 'Aliasing (wrap)' : 'Aliasing: tissue outside the FOV wraps to the other side', margin.left + plotW, recTop - 12);
        }
    }

    renderFreqPhasors(ctx, p, segs, kNow) {
        const { w, h } = this.beginPanel(ctx);
        const xView = 150;
        const total = this.freqSignal(segs, kNow);
        const sMax = Math.max(1e-9, segs.reduce((acc, seg) => acc + seg.rho * (seg.x1 - seg.x0), 0));
        const mag = Math.sqrt(total.re * total.re + total.im * total.im);

        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('Signal = Σ tube phasors (head-to-tail)', w / 2, 14);

        const cx = w / 2;
        const cy = 34 + (h - 120) / 2;
        const R = Math.min(w / 2 - 16, (h - 120) / 2);

        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cx - R - 6, cy);
        ctx.lineTo(cx + R + 6, cy);
        ctx.moveTo(cx, cy - R - 6);
        ctx.lineTo(cx, cy + R + 6);
        ctx.stroke();
        ctx.font = '8px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText('Re', cx + R + 2, cy - 3);
        ctx.fillText('Im', cx + 3, cy - R - 2);

        // Head-to-tail chain (Re right, Im up)
        let px = cx, py = cy;
        segs.forEach(seg => {
            const xc = (seg.x0 + seg.x1) / 2;
            const ph = this.segmentPhasor(seg, kNow);
            const nx = px + (ph.re / sMax) * R;
            const ny = py - (ph.im / sMax) * R;
            this.drawArrow(ctx, px, py, nx, ny, this.xColor((xc + xView) / (2 * xView)), 2.5, 6);
            px = nx;
            py = ny;
        });
        // Resultant
        this.drawArrow(ctx, cx, cy, cx + (total.re / sMax) * R, cy - (total.im / sMax) * R, '#ffffff', 2, 8);

        const pct = (mag / sMax) * 100;
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillStyle = pct > 50 ? '#10b981' : (pct > 20 ? '#f59e0b' : '#ef4444');
        ctx.fillText(`|S| = ${pct.toFixed(0)}% of max`, w / 2, h - 70);

        ctx.font = '9px Inter';
        ctx.fillStyle = '#94a3b8';
        const lines = [
            `FOV = BW/(γ̄Gx) = ${p.fov.toFixed(0)} mm`,
            `Δx = FOV/N = ${p.dx.toFixed(2)} mm`,
            `T_acq = N/BW = ${(p.tacq * 1000).toFixed(2)} ms`
        ];
        lines.forEach((line, i) => ctx.fillText(line, w / 2, h - 46 + i * 14));
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
