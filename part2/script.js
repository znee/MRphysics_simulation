/**
 * MR Physics Simulation Logic
 */

class MRPhysics {
    constructor() {
        // Fixed Tissues for Brain Schematic
        this.tissues = [
            { id: 'fat', name: 'Fat', t1: 250, t2: 60, pd: 0.9, color: '#fbbf24', regionId: 'region-fat' },
            { id: 'gm', name: 'Gray Matter', t1: 950, t2: 100, pd: 0.8, color: '#94a3b8', regionId: 'region-gm' },
            { id: 'wm', name: 'White Matter', t1: 600, t2: 80, pd: 0.7, color: '#e2e8f0', regionId: 'region-wm' },
            { id: 'csf', name: 'CSF', t1: 4500, t2: 2200, pd: 1.0, color: '#38bdf8', regionId: 'region-csf' }
        ];

        this.params = {
            sequence: 'SE',
            b0: 1.5,
            inhomogeneity: 0, // Hz
            tr: 500,    // ms
            te: 20,     // ms
            ti: 0,      // ms (for IR)
            fa: 90      // degrees (for GRE/SE)
        };

        this.charts = {};

        // Phase Wheel State
        this.phaseWheelFrame = 0;
        this.phaseWheelPlaying = false;
        this.phaseWheelInterval = null;

        // Chart State
        this.showSigned = false;

        // Brain segmentation data
        this.brainSegData = null;
        this.canvasSize = 512;
    }

    init() {
        this.initUI();
        this.initCharts();
        this.initMechanicsVisualizations();
        this.renderParams();
        this.loadBrainSegmentation();

        // Help button
        document.getElementById('helpBtn').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'flex';
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'none';
        });
    }

    loadBrainSegmentation() {
        // Load the brain segmentation image
        const img = new Image();
        img.onload = () => {
            // Extract pixel data from segmentation at original size
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.canvasSize;
            tempCanvas.height = this.canvasSize;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.imageSmoothingEnabled = false;
            tempCtx.drawImage(img, 0, 0, this.canvasSize, this.canvasSize);

            const imageData = tempCtx.getImageData(0, 0, this.canvasSize, this.canvasSize);
            this.brainSegData = new Uint8Array(this.canvasSize * this.canvasSize);

            // Extract tissue labels from red channel
            // The PNG stores grayscale values - need to map to discrete labels
            // First, collect all unique values to understand the encoding
            const uniqueValues = new Set();
            for (let i = 0; i < this.canvasSize * this.canvasSize; i++) {
                uniqueValues.add(imageData.data[i * 4]);
            }
            console.log('Unique pixel values in segmentation:', Array.from(uniqueValues).sort((a,b) => a-b));

            // Map raw grayscale values to tissue labels
            // Expected: 0=background, distinct values for CSF, GM, WM, Fat
            const sortedValues = Array.from(uniqueValues).sort((a, b) => a - b);
            const valueToLabel = {};
            sortedValues.forEach((val, idx) => {
                valueToLabel[val] = Math.min(idx, 4); // Map to 0-4
            });
            console.log('Value to label mapping:', valueToLabel);

            for (let i = 0; i < this.brainSegData.length; i++) {
                const rawValue = imageData.data[i * 4]; // Red channel
                // Map the raw grayscale value to a tissue label
                this.brainSegData[i] = valueToLabel[rawValue] !== undefined ? valueToLabel[rawValue] : 0;
            }

            console.log('Brain segmentation loaded');
            this.updateSimulation();
        };
        img.onerror = () => {
            console.error('Failed to load brain segmentation');
            this.updateSimulation();
        };
        img.src = brainSegBase64;
    }

    initUI() {
        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetTab = e.target.getAttribute('data-tab');

                // Update active tab button
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');

                // Update active tab content
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                document.getElementById(`tab-${targetTab}`).classList.add('active');
            });
        });

        // Presets
        document.getElementById('preset-t1').addEventListener('click', () => this.applyPreset('T1'));
        document.getElementById('preset-t2').addEventListener('click', () => this.applyPreset('T2'));
        document.getElementById('preset-t2star').addEventListener('click', () => this.applyPreset('T2*'));
        document.getElementById('preset-flair').addEventListener('click', () => this.applyPreset('FLAIR'));
        document.getElementById('preset-stir').addEventListener('click', () => this.applyPreset('STIR'));

        // Sequence Selector
        document.getElementById('sequenceType').addEventListener('change', (e) => {
            this.params.sequence = e.target.value;
            this.renderParams();
            this.updateSimulation();
            this.updateInhomogeneityVisibility();
        });

        // B0 Slider with frequency update
        const b0Slider = document.getElementById('b0Field');
        b0Slider.addEventListener('input', (e) => {
            this.params.b0 = parseFloat(e.target.value);
            document.getElementById('b0Value').textContent = `${this.params.b0} T`;
            this.updateB0Frequency();
            this.updateSimulation();
        });
        // Initialize frequency display
        this.updateB0Frequency();

        // Inhomogeneity Slider
        const inhoSlider = document.getElementById('inhomogeneity');
        inhoSlider.addEventListener('input', (e) => {
            this.params.inhomogeneity = parseFloat(e.target.value);
            document.getElementById('inhomogeneityValue').textContent = `${this.params.inhomogeneity} Hz`;
            this.updateSimulation();
        });

        // Help Modal
        const modal = document.getElementById('helpModal');
        const btn = document.getElementById('helpBtn');
        const span = document.getElementsByClassName('close-modal')[0];

        btn.onclick = () => modal.style.display = 'block';
        span.onclick = () => modal.style.display = 'none';
        window.onclick = (event) => {
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        }

        // Signed Signal Toggle
        const signedToggle = document.getElementById('signedSignalToggle');
        if (signedToggle) {
            signedToggle.addEventListener('change', (e) => {
                this.showSigned = e.target.checked;
                this.updateContrastCharts();
            });
        }

        this.renderParams();
    }

    applyPreset(type) {
        if (type === 'T1') {
            this.params.sequence = 'SE';
            this.params.tr = 500;
            this.params.te = 20;
            this.params.inhomogeneity = 0; // SE doesn't use inhomogeneity
        } else if (type === 'T2') {
            this.params.sequence = 'SE';
            this.params.tr = 3000;
            this.params.te = 100;
            this.params.inhomogeneity = 0; // SE doesn't use inhomogeneity
        } else if (type === 'T2*') {
            this.params.sequence = 'GRE';
            this.params.tr = 500;
            this.params.te = 20;
            this.params.fa = 20; // Low flip angle for GRE T2*
            this.params.inhomogeneity = 20; // Add some inhomogeneity to show T2* effect
        } else if (type === 'FLAIR') {
            this.params.sequence = 'IR';
            this.params.tr = 9000;
            this.params.te = 100;
            // CSF nulling: TI = T1_CSF * ln(2) = 4500 * 0.693 ≈ 3120ms
            this.params.ti = 3120;
            this.params.fa = 90; // Standard readout
            this.params.inhomogeneity = 0; // IR doesn't use inhomogeneity
        } else if (type === 'STIR') {
            this.params.sequence = 'IR';
            this.params.tr = 4000;
            this.params.te = 50;
            this.params.ti = 170; // Null Fat (T1 ~250ms -> TI ~ 0.69*T1)
            this.params.fa = 90; // Standard readout
            this.params.inhomogeneity = 0; // IR doesn't use inhomogeneity
        }

        // Update UI - highlight active preset
        document.querySelectorAll('.preset-buttons .btn').forEach(btn => btn.classList.remove('active'));
        const presetMap = { 'T1': 'preset-t1', 'T2': 'preset-t2', 'T2*': 'preset-t2star', 'FLAIR': 'preset-flair', 'STIR': 'preset-stir' };
        const activeBtn = document.getElementById(presetMap[type]);
        if (activeBtn) {
            activeBtn.classList.add('active');
            // Add pulse animation
            activeBtn.style.animation = 'pulse 0.3s ease-out';
            setTimeout(() => activeBtn.style.animation = '', 300);
        }

        document.getElementById('sequenceType').value = this.params.sequence;

        // Update sliders if they exist (need to re-render params first to create elements)
        this.renderParams();

        // Always sync inhomogeneity slider with current params
        const inhoSlider = document.getElementById('inhomogeneity');
        if (inhoSlider) {
            inhoSlider.value = this.params.inhomogeneity;
            document.getElementById('inhomogeneityValue').textContent = `${this.params.inhomogeneity} Hz`;
        }

        this.updateSimulation();
        this.updateInhomogeneityVisibility();
    }

    updateInhomogeneityVisibility() {
        const inhoCtrl = document.getElementById('inhomogeneity-control');
        if (this.params.sequence === 'GRE') {
            inhoCtrl.style.display = 'block';
        } else {
            inhoCtrl.style.display = 'none';
        }
    }

    updateB0Frequency() {
        // Larmor frequency: f = gamma * B0
        // gamma for 1H = 42.576 MHz/T
        const gamma = 42.576;
        const freq = (gamma * this.params.b0).toFixed(2);
        const freqEl = document.getElementById('b0Freq');
        if (freqEl) {
            freqEl.textContent = `${freq} MHz`;
        }
    }

    renderParams() {
        const container = document.getElementById('params-container');
        container.innerHTML = '';

        const createInput = (id, label, value, min, max, step) => {
            const div = document.createElement('div');
            div.innerHTML = `
                <label for="${id}">${label}</label>
                <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
                <span id="${id}-val">${value}</span>
            `;
            const input = div.querySelector('input');
            input.addEventListener('input', (e) => {
                let newValue = parseFloat(e.target.value);

                // Safeguard: TI must be less than TR
                if (id === 'ti' && newValue >= this.params.tr) {
                    newValue = Math.max(10, this.params.tr - 10);
                    e.target.value = newValue;
                }
                // Also check when TR changes - adjust TI if needed
                if (id === 'tr' && this.params.ti && this.params.ti >= newValue) {
                    this.params.ti = Math.max(10, newValue - 10);
                    const tiInput = document.querySelector('input[type="range"][step="10"][min="10"][max="2000"]');
                    if (tiInput) {
                        tiInput.value = this.params.ti;
                        const tiSpan = tiInput.parentElement.querySelector('span');
                        if (tiSpan) tiSpan.textContent = this.params.ti;
                    }
                }

                this.params[id] = newValue;
                div.querySelector('span').textContent = newValue;
                this.updateSimulation();
            });
            return div;
        };

        // TR and TE are common
        container.appendChild(createInput('tr', 'TR (ms)', this.params.tr, 10, 12000, 10));
        container.appendChild(createInput('te', 'TE (ms)', this.params.te, 1, 300, 1));

        if (this.params.sequence === 'IR') {
            // Extended TI range to 4000ms to support FLAIR (CSF nulling ~3100ms at 3T)
            container.appendChild(createInput('ti', 'TI (ms)', this.params.ti || 150, 10, 4000, 10));
            this.params.ti = this.params.ti || 150;
        }

        // FA only applies to GRE and IR (SE uses fixed 90°/180° pulses)
        if (this.params.sequence === 'GRE' || this.params.sequence === 'IR') {
            container.appendChild(createInput('fa', 'Flip Angle (°)', this.params.fa || 90, 1, 180, 1));
            this.params.fa = this.params.fa || 90;
        }
    }

    initCharts() {
        // Modern dark theme for charts
        const darkTheme = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            elements: {
                point: { radius: 0 },
                line: { borderWidth: 2.5 }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 15,
                        font: { size: 10 }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)',
                        drawBorder: false
                    },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    title: {
                        display: true,
                        color: '#94a3b8',
                        font: { size: 11, weight: '500' }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)',
                        drawBorder: false
                    },
                    ticks: { color: '#94a3b8', font: { size: 10 } },
                    title: {
                        display: true,
                        text: 'Signal',
                        color: '#94a3b8',
                        font: { size: 11, weight: '500' }
                    }
                }
            }
        };

        // Helper to create contrast charts with dark theme
        const createContrastChart = (id, xLabel) => {
            const ctx = document.getElementById(id).getContext('2d');
            const options = JSON.parse(JSON.stringify(darkTheme));
            options.scales.x.title.text = xLabel;
            return new Chart(ctx, {
                type: 'line',
                data: { datasets: [] },
                options: options
            });
        };

        this.charts.tr = createContrastChart('chartTR', 'TR (ms)');
        this.charts.te = createContrastChart('chartTE', 'TE (ms)');
        this.charts.ti = createContrastChart('chartTI', 'TI (ms)');
        this.charts.fa = createContrastChart('chartFA', 'Flip Angle (°)');
    }

    updateSimulation() {
        this.updatePhantom();
        this.updateContrastCharts();
        this.updateVisibility();
        this.updateEquation();

        // Update mechanics visualizations
        this.updatePhaseWheel();
        this.updateR2Chart();
        this.updateRFTimeline();
    }

    updateVisibility() {
        const seq = this.params.sequence;

        // Helper to show/hide
        const setVisible = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? 'block' : 'none';
        };

        // TR and TE are always relevant
        setVisible('container-tr', true);
        setVisible('container-te', true);

        // TI only for IR
        setVisible('container-ti', seq === 'IR');

        // FA for GRE and IR only (not SE - we use fixed 90°/180°)
        setVisible('container-fa', seq === 'GRE' || seq === 'IR');
    }

    // Physics Equations
    getSignalSE(t1, t2, pd, tr, te, faDeg = 90) {
        const b0Factor = this.params.b0 / 1.5;

        // True 90°/180° Spin Echo
        // T1 recovery is INDEPENDENT of TE (no Ernst angle effects)
        // S = PD * (1 - exp(-TR/T1)) * exp(-TE/T2)
        const t1Factor = (1 - Math.exp(-tr / t1));
        const t2Factor = Math.exp(-te / t2);

        return b0Factor * pd * t1Factor * t2Factor;
    }

    getSignalGRE(t1, t2, pd, tr, te, faDeg, inhomogeneity = this.params.inhomogeneity) {
        const fa = faDeg * Math.PI / 180;
        const e1 = Math.exp(-tr / t1);

        // T2* calculation
        // R2* = R2 + R2'
        // R2' = 2 * PI * delta_f
        const r2 = 1000 / t2; // s^-1
        const r2prime = 2 * Math.PI * inhomogeneity; // s^-1
        const r2star = r2 + r2prime;
        const t2star = 1000 / r2star; // ms

        const b0Factor = this.params.b0 / 1.5;

        // Steady state GRE (SPGR/FLASH)
        // S = PD * sin(α) * (1-E1) / (1 - E1*cos(α)) * exp(-TE/T2*)
        const t1Factor = (1 - e1) / (1 - e1 * Math.cos(fa));
        const t2starFactor = Math.exp(-te / t2star);

        return b0Factor * pd * Math.sin(fa) * t1Factor * t2starFactor;
    }

    getSignalIR(t1, t2, pd, tr, te, ti, faDeg = 90) {
        const b0Factor = this.params.b0 / 1.5;
        const fa = faDeg * Math.PI / 180;

        // General Steady State IR with readout alpha
        // Sequence: 180 -> TI -> alpha -> (TR-TI)
        const e_ti = Math.exp(-ti / t1);
        const e_rem = Math.exp(-(tr - ti) / t1);
        const e1 = Math.exp(-tr / t1); // e_ti * e_rem

        // M_ss (just before 180)
        // M_ss = M0 * [1 - E_rem + (E_rem - E1)*cos(alpha)] / (1 + E1*cos(alpha))
        const num = 1 - e_rem + (e_rem - e1) * Math.cos(fa);
        const den = 1 + e1 * Math.cos(fa);
        const m_ss_start = num / den;

        // M(TI) just before readout
        // M(TI) = M0*(1 - E_ti) - M_ss_start * E_ti
        const mz_ti = (1 - e_ti) - m_ss_start * e_ti;

        // Return SIGNED value (caller handles magnitude if needed)
        return b0Factor * pd * mz_ti * Math.sin(fa) * Math.exp(-te / t2);
    }

    updatePhantom() {
        // Calculate signal for each tissue
        // Tissue mapping: segmentation label -> tissue
        // 0=background, 1=CSF, 2=GM, 3=WM, 4=Fat
        const tissueByLabel = {
            1: this.tissues.find(t => t.id === 'csf'),
            2: this.tissues.find(t => t.id === 'gm'),
            3: this.tissues.find(t => t.id === 'wm'),
            4: this.tissues.find(t => t.id === 'fat')
        };

        // Calculate signal for each tissue type
        const signals = {};
        const signalDebug = {};
        for (const [label, tissue] of Object.entries(tissueByLabel)) {
            if (!tissue) continue;
            let s = 0;
            if (this.params.sequence === 'SE') {
                s = this.getSignalSE(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.fa);
            } else if (this.params.sequence === 'GRE') {
                s = this.getSignalGRE(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.fa, this.params.inhomogeneity);
            } else if (this.params.sequence === 'IR') {
                s = this.getSignalIR(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.ti, this.params.fa);
            }
            signalDebug[tissue.id] = { raw: s, abs: Math.abs(s) };
            signals[label] = Math.abs(s);

            // Update signal display in tissue card
            const signalEl = document.getElementById(`signal-${tissue.id}`);
            if (signalEl) {
                const absSignal = Math.abs(s);
                signalEl.textContent = `S: ${absSignal.toFixed(3)}`;
                // Also update the color intensity based on signal
                signalEl.style.opacity = Math.max(0.5, Math.min(1, absSignal + 0.3));
            }
        }
        console.log('Tissue signals:', signalDebug, 'Params:', this.params);

        // Find max signal for auto-scaling (Windowing)
        const maxSignal = Math.max(...Object.values(signals));
        const scaleFactor = maxSignal > 0.001 ? (255 / maxSignal) : 0;

        // Render to canvas
        this.renderBrainCanvas(signals, scaleFactor);
    }

    renderBrainCanvas(signals, scaleFactor) {
        const canvas = document.getElementById('brain-canvas');
        if (!canvas) return;

        const srcSize = this.canvasSize; // 512

        // If segmentation not loaded yet, show loading
        if (!this.brainSegData) {
            canvas.width = srcSize;
            canvas.height = srcSize;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, srcSize, srcSize);
            ctx.fillStyle = '#333';
            ctx.font = '16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Loading brain...', srcSize / 2, srcSize / 2);
            return;
        }

        // Create/reuse offscreen canvas at native 512×512
        if (!this.offscreenCanvas) {
            this.offscreenCanvas = document.createElement('canvas');
            this.offscreenCanvas.width = srcSize;
            this.offscreenCanvas.height = srcSize;
        }

        // Render grayscale image at native resolution
        const offCtx = this.offscreenCanvas.getContext('2d');
        const imageData = offCtx.createImageData(srcSize, srcSize);
        const data = imageData.data;

        for (let i = 0; i < this.brainSegData.length; i++) {
            const label = this.brainSegData[i]; // Already mapped to 0-4 in loadBrainSegmentation
            const signal = signals[label] || 0;
            const grayVal = Math.floor(Math.min(signal * scaleFactor, 255));
            const idx = i * 4;
            data[idx] = grayVal;
            data[idx + 1] = grayVal;
            data[idx + 2] = grayVal;
            data[idx + 3] = 255;
        }
        offCtx.putImageData(imageData, 0, 0);

        // Set display canvas to fixed 512×512 - let browser handle scaling with CSS
        canvas.width = srcSize;
        canvas.height = srcSize;

        // Draw offscreen canvas to display canvas
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.offscreenCanvas, 0, 0);
    }

    updateContrastCharts() {
        // We need to update ALL visible charts
        // Helper to generate data for a specific varying parameter
        const generateData = (paramKey, min, max, step) => {
            return this.tissues.map(tissue => {
                const data = [];
                for (let x = min; x <= max; x += step) {
                    let s = 0;
                    let p = { ...this.params };
                    p[paramKey] = x; // Override

                    if (p.sequence === 'SE') {
                        s = this.getSignalSE(tissue.t1, tissue.t2, tissue.pd, p.tr, p.te, p.fa);
                    } else if (p.sequence === 'GRE') {
                        s = this.getSignalGRE(tissue.t1, tissue.t2, tissue.pd, p.tr, p.te, p.fa, p.inhomogeneity);
                    } else if (p.sequence === 'IR') {
                        s = this.getSignalIR(tissue.t1, tissue.t2, tissue.pd, p.tr, p.te, p.ti, p.fa);
                    }

                    // Apply magnitude unless "Show Signed" is enabled (only relevant for IR)
                    if (!this.showSigned) {
                        s = Math.abs(s);
                    }

                    data.push({ x: x, y: s });
                }
                // Create semi-transparent version of color for fill
                const hexToRgba = (hex, alpha) => {
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                };

                return {
                    label: tissue.name,
                    data: data,
                    borderColor: tissue.color,
                    backgroundColor: hexToRgba(tissue.color, 0.1),
                    borderWidth: 2.5,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.1
                };
            });
        };

        // Helper to add vertical indicator line with glow effect
        const addIndicator = (chart, value, color = '#ef4444') => {
            // Find max Y in current datasets to scale the indicator
            let maxY = 0;
            chart.data.datasets.forEach(ds => {
                if (ds.data) {
                    const dsMax = Math.max(...ds.data.map(p => p.y));
                    if (dsMax > maxY) maxY = dsMax;
                }
            });

            // If no data or max is 0, default to 1.0
            if (maxY === 0) maxY = 1.0;

            // Add a margin (e.g. 10%)
            const indicatorHeight = maxY * 1.1;

            // Add glow line (thicker, semi-transparent)
            chart.data.datasets.push({
                label: '',
                data: [{ x: value, y: 0 }, { x: value, y: indicatorHeight }],
                borderColor: 'rgba(239, 68, 68, 0.3)',
                borderWidth: 8,
                pointRadius: 0,
                showLine: true,
                order: -1,
                fill: false
            });

            // Add main indicator line
            chart.data.datasets.push({
                label: 'Current',
                data: [{ x: value, y: 0 }, { x: value, y: indicatorHeight }],
                borderColor: color,
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                showLine: true,
                order: 0,
                fill: false
            });
        };

        // Update TR Chart
        const maxTR = Math.max(5000, this.params.tr * 1.1);
        this.charts.tr.data.datasets = generateData('tr', 0, maxTR, maxTR / 100);
        addIndicator(this.charts.tr, this.params.tr);
        // Update scale to match data
        this.charts.tr.options.scales.x.max = maxTR;
        this.charts.tr.update();

        // Update TE Chart
        this.charts.te.data.datasets = generateData('te', 0, 300, 5);

        // If GRE, add T2 reference curve (dotted) for White Matter (or first tissue)
        if (this.params.sequence === 'GRE' && this.tissues.length > 0) {
            const refTissue = this.tissues[0]; // Use first tissue as reference
            const data = [];
            for (let x = 0; x <= 300; x += 5) {
                // Pure T2 decay: PD * exp(-TE/T2) * (saturation term)
                // Saturation term depends on TR/T1/FA.
                // S_GRE_steady = M0 * sin(a)*(1-E1)/(1-E1*cos(a)) * exp(-TE/T2)
                // We use T2 instead of T2*
                const s = this.getSignalGRE(refTissue.t1, refTissue.t2, refTissue.pd, this.params.tr, x, this.params.fa, 0); // Inhomogeneity = 0
                data.push({ x: x, y: s });
            }
            this.charts.te.data.datasets.push({
                label: `${refTissue.name} (Pure T2)`,
                data: data,
                borderColor: refTissue.color,
                borderWidth: 2,
                borderDash: [2, 2], // Dotted
                pointRadius: 0
            });
        }

        addIndicator(this.charts.te, this.params.te);
        this.charts.te.update();

        // Update TI Chart (only if IR)
        if (this.params.sequence === 'IR') {
            const maxTI = Math.max(2000, this.params.ti * 1.1);
            this.charts.ti.data.datasets = generateData('ti', 0, maxTI, maxTI / 100);
            addIndicator(this.charts.ti, this.params.ti);
            // Update scale to match data
            this.charts.ti.options.scales.x.max = maxTI;
            this.charts.ti.update();
        }

        // Update FA Chart (for all sequences)
        this.charts.fa.data.datasets = generateData('fa', 0, 180, 1);
        addIndicator(this.charts.fa, this.params.fa);
        this.charts.fa.update();
    }

    updateEquation() {
        const el = document.getElementById('equation-overlay');
        let eqHtml = '';
        let legendHtml = '';

        const commonLegend = `
            <span class="legend-term">S</span><span>Signal Intensity</span>
            <span class="legend-term">PD</span><span>Proton Density</span>
        `;

        if (this.params.sequence === 'SE') {
            eqHtml = `
        S &approx; PD &middot;
        <span style="color: #2563eb;">(T1 Recovery)</span> &middot;
        <span style="color: #dc2626;">(T2 Decay)</span>
        `;
            legendHtml = `
                ${commonLegend}
                <span class="legend-term" style="color: #2563eb;">T1 Recovery</span><span>Depends on TR & T1</span>
                <span class="legend-term" style="color: #dc2626;">T2 Decay</span><span>Depends on TE & T2</span>
        `;
        } else if (this.params.sequence === 'GRE') {
            eqHtml = `
        S &approx; PD &middot;
        <span style="color: #2563eb;">(Steady State T1)</span> &middot;
        <span style="color: #dc2626;">(T2* Decay)</span>
        `;
            legendHtml = `
                ${commonLegend}
                <span class="legend-term" style="color: #2563eb;">Steady State T1</span><span>Depends on TR, T1 & &alpha;</span>
                <span class="legend-term" style="color: #dc2626;">T2* Decay</span><span>Depends on TE & T2*</span>
        `;
        } else if (this.params.sequence === 'IR') {
            eqHtml = `
        S &approx; PD &middot;
        <span style="color: #2563eb;">(Inversion Recovery)</span> &middot;
        <span style="color: #dc2626;">(T2 Decay)</span>
        `;
            legendHtml = `
                ${commonLegend}
                <span class="legend-term" style="color: #2563eb;">Inversion Recovery</span><span>Depends on TI, TR & T1</span>
                <span class="legend-term" style="color: #dc2626;">T2 Decay</span><span>Depends on TE & T2</span>
        `;
        }

        el.innerHTML = `
            <div class="equation-main">${eqHtml}</div>
                <div class="equation-legend">${legendHtml}</div>
        `;
    }

    // ========================================
    // Sequence Mechanics Visualizations
    // ========================================

    initMechanicsVisualizations() {
        // Initialize R2 Chart as line chart showing decay curves
        const r2Ctx = document.getElementById('r2Chart').getContext('2d');
        this.r2Chart = new Chart(r2Ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'T2 Decay (SE)',
                        data: [],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0
                    },
                    {
                        label: 'T2* Decay (GRE)',
                        data: [],
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 11 },
                            color: '#94a3b8'
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Time (ms)', font: { size: 11 }, color: '#94a3b8' },
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        title: { display: true, text: 'Signal', font: { size: 11 }, color: '#94a3b8' },
                        min: 0,
                        max: 1,
                        grid: { color: 'rgba(148, 163, 184, 0.1)' },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });

        // Phase Wheel Controls - 16 frames for smooth animation
        this.totalFrames = 16;

        document.getElementById('prev-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame - 1 + this.totalFrames) % this.totalFrames;
            this.updatePhaseWheel();
            this.updateRFTimeline(); // Sync timeline
        });

        document.getElementById('next-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame + 1) % this.totalFrames;
            this.updatePhaseWheel();
            this.updateRFTimeline(); // Sync timeline
        });

        document.getElementById('play-animation').addEventListener('click', () => {
            if (this.phaseWheelPlaying) {
                clearInterval(this.phaseWheelInterval);
                this.phaseWheelPlaying = false;
                document.getElementById('play-animation').textContent = '▶ Play';
            } else {
                this.phaseWheelPlaying = true;
                document.getElementById('play-animation').textContent = '⏸ Pause';
                this.phaseWheelInterval = setInterval(() => {
                    this.phaseWheelFrame = (this.phaseWheelFrame + 1) % this.totalFrames;
                    this.updatePhaseWheel();
                    this.updateRFTimeline(); // Sync timeline
                }, 400); // Faster for 16 frames
            }
        });

        // Initial render
        this.updatePhaseWheel();
        this.updateR2Chart();
        this.updateRFTimeline();
    }

    updatePhaseWheel() {
        const svg = document.getElementById('phase-wheel');
        const seq = this.params.sequence;
        const frame = this.phaseWheelFrame;
        const t = frame / (this.totalFrames - 1); // Normalized time 0-1

        // Update sequence-specific styling
        this.updateMechanicsColors(seq);

        // Sequence colors
        const seqColors = {
            'SE': { primary: '#3b82f6', secondary: '#93c5fd' },
            'GRE': { primary: '#10b981', secondary: '#6ee7b7' },
            'IR': { primary: '#a855f7', secondary: '#c4b5fd' }
        };
        const colors = seqColors[seq] || seqColors['SE'];

        // Get step info for current frame
        const stepInfo = this.getStepInfo(seq, frame);
        document.getElementById('frame-label').textContent = `${frame + 1}/${this.totalFrames}: ${stepInfo.label}`;

        // Clear SVG
        svg.innerHTML = '';
        const ns = 'http://www.w3.org/2000/svg';

        // Add gradient definitions
        const defs = document.createElementNS(ns, 'defs');

        // Dark gradient background
        const bgGrad = document.createElementNS(ns, 'radialGradient');
        bgGrad.setAttribute('id', 'bgGradient');
        bgGrad.innerHTML = `
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        `;
        defs.appendChild(bgGrad);

        // Glow filter
        const glowFilter = document.createElementNS(ns, 'filter');
        glowFilter.setAttribute('id', 'glow');
        glowFilter.innerHTML = `
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        `;
        defs.appendChild(glowFilter);

        // Arrow markers
        ['spin', 'net', 'mz'].forEach((type, idx) => {
            const markerColors = [colors.secondary, '#ef4444', '#22c55e'];
            const marker = document.createElementNS(ns, 'marker');
            marker.setAttribute('id', `arrow-${type}`);
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('refX', '6');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            const polygon = document.createElementNS(ns, 'polygon');
            polygon.setAttribute('points', '0 0, 8 3, 0 6');
            polygon.setAttribute('fill', markerColors[idx]);
            marker.appendChild(polygon);
            defs.appendChild(marker);
        });

        svg.appendChild(defs);

        // Background
        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('width', '300');
        bg.setAttribute('height', '300');
        bg.setAttribute('fill', 'url(#bgGradient)');
        bg.setAttribute('rx', '12');
        svg.appendChild(bg);

        // --- DUAL VIEW: Transverse (Mxy) on left, Longitudinal (Mz) on right ---
        const leftCx = 100, leftCy = 130; // Transverse plane center
        const rightCx = 220, rightCy = 130; // Longitudinal view center
        const radius = 60;

        // Labels
        this.addSvgText(svg, leftCx, 30, 'Mxy (Transverse)', 'middle', '10px', '#94a3b8', '600');
        this.addSvgText(svg, rightCx, 30, 'Mz (Longitudinal)', 'middle', '10px', '#94a3b8', '600');

        // --- Transverse Plane View ---
        // Reference circle
        const refCircle = document.createElementNS(ns, 'circle');
        refCircle.setAttribute('cx', leftCx);
        refCircle.setAttribute('cy', leftCy);
        refCircle.setAttribute('r', radius);
        refCircle.setAttribute('fill', 'none');
        refCircle.setAttribute('stroke', 'rgba(148, 163, 184, 0.3)');
        refCircle.setAttribute('stroke-width', '1');
        refCircle.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(refCircle);

        // Center dot
        const centerDot = document.createElementNS(ns, 'circle');
        centerDot.setAttribute('cx', leftCx);
        centerDot.setAttribute('cy', leftCy);
        centerDot.setAttribute('r', '3');
        centerDot.setAttribute('fill', '#64748b');
        svg.appendChild(centerDot);

        // Axis labels for transverse
        this.addSvgText(svg, leftCx + radius + 10, leftCy + 4, "x'", 'start', '10px', '#64748b');
        this.addSvgText(svg, leftCx, leftCy - radius - 8, "y'", 'middle', '10px', '#64748b');

        // --- Longitudinal View (Mz bar) ---
        const barX = rightCx - 15;
        const barW = 30;
        const barH = 100;
        const barTop = rightCy - barH / 2;

        // Background bar
        const mzBg = document.createElementNS(ns, 'rect');
        mzBg.setAttribute('x', barX);
        mzBg.setAttribute('y', barTop);
        mzBg.setAttribute('width', barW);
        mzBg.setAttribute('height', barH);
        mzBg.setAttribute('fill', 'rgba(148, 163, 184, 0.1)');
        mzBg.setAttribute('stroke', 'rgba(148, 163, 184, 0.3)');
        mzBg.setAttribute('rx', '4');
        svg.appendChild(mzBg);

        // Zero line
        const zeroLine = document.createElementNS(ns, 'line');
        zeroLine.setAttribute('x1', barX - 5);
        zeroLine.setAttribute('y1', rightCy);
        zeroLine.setAttribute('x2', barX + barW + 5);
        zeroLine.setAttribute('y2', rightCy);
        zeroLine.setAttribute('stroke', '#64748b');
        zeroLine.setAttribute('stroke-width', '1');
        zeroLine.setAttribute('stroke-dasharray', '2,2');
        svg.appendChild(zeroLine);

        // Mz labels
        this.addSvgText(svg, barX - 10, barTop + 5, '+M₀', 'end', '9px', '#22c55e');
        this.addSvgText(svg, barX - 10, barTop + barH - 2, '-M₀', 'end', '9px', '#ef4444');
        this.addSvgText(svg, barX - 10, rightCy + 3, '0', 'end', '9px', '#64748b');

        // Get magnetization state
        const state = this.getMagnetizationState(seq, frame);
        const numSpins = 12;
        const spinLen = 40;

        // Draw individual spins in transverse plane
        for (let i = 0; i < numSpins; i++) {
            const spreadAngle = state.spread * Math.PI * 2;
            const baseAngle = state.baseAngle + (i - numSpins / 2) * (spreadAngle / numSpins);
            const spinMxy = state.mxy * 0.8; // Scale for visibility

            if (spinMxy > 0.05) {
                const x2 = leftCx + spinLen * spinMxy * Math.cos(baseAngle);
                const y2 = leftCy - spinLen * spinMxy * Math.sin(baseAngle);

                const line = document.createElementNS(ns, 'line');
                line.setAttribute('x1', leftCx);
                line.setAttribute('y1', leftCy);
                line.setAttribute('x2', x2);
                line.setAttribute('y2', y2);
                line.setAttribute('stroke', colors.secondary);
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('opacity', '0.6');
                svg.appendChild(line);
            }
        }

        // Net Mxy vector
        if (state.mxy > 0.05) {
            const netLen = radius * 0.85 * state.mxy * state.coherence;
            const netX = leftCx + netLen * Math.cos(state.baseAngle);
            const netY = leftCy - netLen * Math.sin(state.baseAngle);

            // Glow
            const glow = document.createElementNS(ns, 'line');
            glow.setAttribute('x1', leftCx);
            glow.setAttribute('y1', leftCy);
            glow.setAttribute('x2', netX);
            glow.setAttribute('y2', netY);
            glow.setAttribute('stroke', '#ef4444');
            glow.setAttribute('stroke-width', '8');
            glow.setAttribute('stroke-linecap', 'round');
            glow.setAttribute('opacity', '0.3');
            glow.setAttribute('filter', 'url(#glow)');
            svg.appendChild(glow);

            // Main vector
            const netLine = document.createElementNS(ns, 'line');
            netLine.setAttribute('x1', leftCx);
            netLine.setAttribute('y1', leftCy);
            netLine.setAttribute('x2', netX);
            netLine.setAttribute('y2', netY);
            netLine.setAttribute('stroke', '#ef4444');
            netLine.setAttribute('stroke-width', '4');
            netLine.setAttribute('stroke-linecap', 'round');
            svg.appendChild(netLine);

            // Tip circle
            const tip = document.createElementNS(ns, 'circle');
            tip.setAttribute('cx', netX);
            tip.setAttribute('cy', netY);
            tip.setAttribute('r', '5');
            tip.setAttribute('fill', '#ef4444');
            tip.setAttribute('filter', 'url(#glow)');
            svg.appendChild(tip);

            // Label
            this.addSvgText(svg, netX + 10, netY - 8, 'Mxy', 'start', '10px', '#ef4444', '600');
        }

        // --- Mz bar fill ---
        const mzValue = state.mz; // -1 to +1
        const mzHeight = Math.abs(mzValue) * (barH / 2);
        const mzY = mzValue >= 0 ? rightCy - mzHeight : rightCy;
        const mzColor = mzValue >= 0 ? '#22c55e' : '#ef4444';

        const mzFill = document.createElementNS(ns, 'rect');
        mzFill.setAttribute('x', barX + 2);
        mzFill.setAttribute('y', mzY);
        mzFill.setAttribute('width', barW - 4);
        mzFill.setAttribute('height', mzHeight);
        mzFill.setAttribute('fill', mzColor);
        mzFill.setAttribute('opacity', '0.7');
        mzFill.setAttribute('rx', '2');
        svg.appendChild(mzFill);

        // Mz value indicator line
        const mzIndicatorY = rightCy - mzValue * (barH / 2);
        const mzIndicator = document.createElementNS(ns, 'line');
        mzIndicator.setAttribute('x1', barX - 3);
        mzIndicator.setAttribute('y1', mzIndicatorY);
        mzIndicator.setAttribute('x2', barX + barW + 3);
        mzIndicator.setAttribute('y2', mzIndicatorY);
        mzIndicator.setAttribute('stroke', mzColor);
        mzIndicator.setAttribute('stroke-width', '3');
        mzIndicator.setAttribute('filter', 'url(#glow)');
        svg.appendChild(mzIndicator);

        // Mz value text
        this.addSvgText(svg, rightCx + 30, mzIndicatorY + 4, `${(mzValue * 100).toFixed(0)}%`, 'start', '10px', mzColor, '600');

        // --- Signal Bar (bottom) ---
        const signalBarY = 250;
        const signalBarW = 200;
        const signalValue = state.mxy * state.coherence;

        // Background
        const sigBg = document.createElementNS(ns, 'rect');
        sigBg.setAttribute('x', 50);
        sigBg.setAttribute('y', signalBarY);
        sigBg.setAttribute('width', signalBarW);
        sigBg.setAttribute('height', '8');
        sigBg.setAttribute('rx', '4');
        sigBg.setAttribute('fill', 'rgba(148, 163, 184, 0.2)');
        svg.appendChild(sigBg);

        // Fill
        const sigFill = document.createElementNS(ns, 'rect');
        sigFill.setAttribute('x', 50);
        sigFill.setAttribute('y', signalBarY);
        sigFill.setAttribute('width', signalBarW * signalValue);
        sigFill.setAttribute('height', '8');
        sigFill.setAttribute('rx', '4');
        sigFill.setAttribute('fill', colors.primary);
        sigFill.setAttribute('filter', 'url(#glow)');
        svg.appendChild(sigFill);

        // Signal label
        this.addSvgText(svg, 150, signalBarY + 22, `Signal: ${Math.round(signalValue * 100)}%`, 'middle', '11px', '#f1f5f9', '500');

        // --- Educational Info Box ---
        const infoBox = document.getElementById('phase-info');
        if (infoBox) {
            infoBox.innerHTML = `<strong>${stepInfo.label}</strong><br>${stepInfo.description}`;
        }

        // Update parameter badge
        const phaseBadge = document.getElementById('phase-params');
        if (phaseBadge) {
            phaseBadge.textContent = `${seq}: TE=${this.params.te}ms, TR=${this.params.tr}ms${seq === 'IR' ? `, TI=${this.params.ti}ms` : ''}`;
        }
    }

    addSvgText(svg, x, y, text, anchor = 'middle', size = '11px', fill = '#f1f5f9', weight = '400') {
        const ns = 'http://www.w3.org/2000/svg';
        const textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('text-anchor', anchor);
        textEl.setAttribute('font-size', size);
        textEl.setAttribute('font-weight', weight);
        textEl.setAttribute('fill', fill);
        textEl.setAttribute('font-family', 'Inter, sans-serif');
        textEl.textContent = text;
        svg.appendChild(textEl);
    }

    getMagnetizationState(seq, frame) {
        const t = frame / (this.totalFrames - 1);

        if (seq === 'SE') {
            // Spin Echo: 16 frames
            // 0-1: 90° pulse (Mz->Mxy)
            // 2-7: Dephasing (T2* decay + spread)
            // 8: 180° pulse (flip phase)
            // 9-14: Rephasing
            // 15: Echo peak
            if (frame === 0) {
                return { mz: 1, mxy: 0, spread: 0, coherence: 1, baseAngle: 0 };
            } else if (frame === 1) {
                return { mz: 0, mxy: 1, spread: 0, coherence: 1, baseAngle: 0 };
            } else if (frame <= 7) {
                const dephaseT = (frame - 1) / 6;
                const spread = dephaseT * 0.8;
                const decay = Math.exp(-dephaseT * 1.5);
                return { mz: 0, mxy: 1, spread: spread, coherence: decay, baseAngle: dephaseT * Math.PI * 0.5 };
            } else if (frame === 8) {
                // 180° pulse - flip phases
                return { mz: 0, mxy: 1, spread: 0.8, coherence: 0.3, baseAngle: -Math.PI * 0.25 };
            } else if (frame <= 14) {
                const rephaseT = (frame - 8) / 6;
                const spread = 0.8 * (1 - rephaseT);
                const recovery = 0.3 + rephaseT * 0.65;
                return { mz: 0, mxy: 1, spread: spread, coherence: recovery, baseAngle: -Math.PI * 0.25 * (1 - rephaseT) };
            } else {
                // Echo
                return { mz: 0, mxy: 1, spread: 0.05, coherence: 0.95, baseAngle: 0 };
            }
        } else if (seq === 'GRE') {
            // Gradient Echo: 16 frames
            // 0: Equilibrium
            // 1: α° pulse
            // 2-7: Dephasing (gradient + T2*)
            // 8-14: Rephasing (gradient reversal) - partial
            // 15: Echo (partial refocus)
            const fa = this.params.fa * Math.PI / 180;
            const mxyMax = Math.sin(fa);
            const mzAfter = Math.cos(fa);

            if (frame === 0) {
                return { mz: 1, mxy: 0, spread: 0, coherence: 1, baseAngle: 0 };
            } else if (frame === 1) {
                return { mz: mzAfter, mxy: mxyMax, spread: 0, coherence: 1, baseAngle: 0 };
            } else if (frame <= 7) {
                const dephaseT = (frame - 1) / 6;
                const spread = dephaseT * 1.0;
                const decay = Math.exp(-dephaseT * 2);
                return { mz: mzAfter, mxy: mxyMax, spread: spread, coherence: decay, baseAngle: dephaseT * Math.PI * 0.7 };
            } else if (frame <= 14) {
                const rephaseT = (frame - 7) / 7;
                const spread = 1.0 * (1 - rephaseT * 0.7); // Partial rephase
                const recovery = 0.15 + rephaseT * 0.45;
                return { mz: mzAfter, mxy: mxyMax, spread: spread, coherence: recovery, baseAngle: Math.PI * 0.7 * (1 - rephaseT) };
            } else {
                return { mz: mzAfter, mxy: mxyMax, spread: 0.3, coherence: 0.6, baseAngle: 0 };
            }
        } else { // IR
            // Inversion Recovery: 16 frames
            // 0: Equilibrium
            // 1: 180° inversion (Mz = -1)
            // 2-9: T1 recovery (Mz: -1 -> varies based on TI)
            // 10: 90° readout pulse
            // 11-15: Signal decay with T2
            const ti = this.params.ti;
            const t1 = 1000; // Approximate T1 for visualization
            const mzAtTI = 1 - 2 * Math.exp(-ti / t1);

            if (frame === 0) {
                return { mz: 1, mxy: 0, spread: 0, coherence: 1, baseAngle: 0 };
            } else if (frame === 1) {
                return { mz: -1, mxy: 0, spread: 0, coherence: 0, baseAngle: 0 };
            } else if (frame <= 9) {
                const recoveryT = (frame - 1) / 8;
                const mz = -1 + (1 + mzAtTI) * recoveryT * recoveryT; // Curved recovery
                return { mz: Math.max(-1, Math.min(1, mz)), mxy: 0, spread: 0, coherence: 0, baseAngle: 0 };
            } else if (frame === 10) {
                // 90° readout - Mz goes to Mxy
                return { mz: 0, mxy: Math.abs(mzAtTI), spread: 0, coherence: 1, baseAngle: 0 };
            } else {
                const decayT = (frame - 10) / 5;
                const spread = decayT * 0.3;
                const decay = Math.exp(-decayT * 1.2);
                return { mz: 0, mxy: Math.abs(mzAtTI), spread: spread, coherence: decay, baseAngle: decayT * Math.PI * 0.3 };
            }
        }
    }

    getStepInfo(seq, frame) {
        const steps = {
            'SE': [
                { label: 'Equilibrium', description: 'Mz aligned with B0, no transverse magnetization' },
                { label: '90° Excitation', description: 'RF pulse tips Mz into transverse plane (Mxy)' },
                { label: 'Free Precession', description: 'Spins precess, begin to dephase due to T2* effects' },
                { label: 'Dephasing', description: 'Field inhomogeneities cause progressive phase spread' },
                { label: 'Dephasing', description: 'Signal decreases as spins lose coherence' },
                { label: 'Dephasing', description: 'T2* decay continues, spins spread across phase wheel' },
                { label: 'Max Dephase', description: 'Maximum dephasing before 180° pulse' },
                { label: 'Pre-180° Pulse', description: 'Preparing for refocusing pulse' },
                { label: '180° Refocus', description: 'Refocusing pulse flips spin phases - fast spins now behind' },
                { label: 'Rephasing', description: 'Spins begin to reconverge as fast ones catch up' },
                { label: 'Rephasing', description: 'Phase coherence increasing' },
                { label: 'Rephasing', description: 'Spins approaching alignment' },
                { label: 'Rephasing', description: 'Nearly rephased - signal recovering' },
                { label: 'Rephasing', description: 'Almost at echo peak' },
                { label: 'Near Echo', description: 'Spins nearly fully rephased' },
                { label: 'Spin Echo!', description: 'Maximum signal - T2* effects cancelled, only T2 decay remains' }
            ],
            'GRE': [
                { label: 'Equilibrium', description: 'Mz aligned with B0, ready for excitation' },
                { label: 'α° Excitation', description: `${this.params.fa}° pulse tips partial Mz into Mxy` },
                { label: 'Free Precession', description: 'Spins precess and dephase due to gradients + T2*' },
                { label: 'Dephasing', description: 'Gradient dephasing + field inhomogeneity effects' },
                { label: 'Dephasing', description: 'Rapid signal loss from gradient and T2*' },
                { label: 'Dephasing', description: 'Continued dephasing - low signal' },
                { label: 'Max Dephase', description: 'Maximum gradient-induced dephasing' },
                { label: 'Gradient Reversal', description: 'Readout gradient polarity reversed' },
                { label: 'Rephasing', description: 'Gradient rephasing begins - spins reconverging' },
                { label: 'Rephasing', description: 'Partial recovery of phase coherence' },
                { label: 'Rephasing', description: 'T2* effects remain - incomplete refocus' },
                { label: 'Rephasing', description: 'Approaching gradient echo' },
                { label: 'Rephasing', description: 'Nearly at echo center' },
                { label: 'Near Echo', description: 'Gradient-induced dephasing cancelled' },
                { label: 'Near Echo', description: 'T2* effects persist - lower signal than SE' },
                { label: 'Gradient Echo', description: 'Partial refocus - T2* decay remains (no 180° pulse)' }
            ],
            'IR': [
                { label: 'Equilibrium', description: 'Mz at maximum (+M0), aligned with B0' },
                { label: '180° Inversion', description: 'Inversion pulse flips Mz to -M0' },
                { label: 'T1 Recovery', description: 'Mz recovering toward +M0 via T1 relaxation' },
                { label: 'T1 Recovery', description: 'Longitudinal magnetization increasing' },
                { label: 'T1 Recovery', description: 'Mz approaching null point' },
                { label: 'T1 Recovery', description: 'Recovery continues - Mz may cross zero' },
                { label: 'T1 Recovery', description: 'Tissue-specific recovery rates create contrast' },
                { label: 'T1 Recovery', description: 'Near TI - time for readout' },
                { label: 'T1 Recovery', description: 'Mz value determines signal magnitude' },
                { label: 'At TI', description: `TI=${this.params.ti}ms reached - readout pulse applied` },
                { label: '90° Readout', description: 'Readout pulse converts Mz to Mxy signal' },
                { label: 'Signal Decay', description: 'Transverse magnetization begins T2 decay' },
                { label: 'Signal Decay', description: 'T2-weighted decay of the IR signal' },
                { label: 'Signal Decay', description: 'Signal decreasing with T2 relaxation' },
                { label: 'Signal Decay', description: 'Continued T2 decay' },
                { label: 'Signal Acquired', description: 'IR signal acquired with T1 and T2 contrast' }
            ]
        };
        return steps[seq][frame] || { label: 'Unknown', description: '' };
    }


    updateR2Chart() {
        // Calculate T2 and T2* decay curves
        const t2 = 80; // White matter T2 (ms)
        const r2 = 1000 / t2; // s^-1
        const r2prime = 2 * Math.PI * this.params.inhomogeneity; // s^-1
        const r2star = r2 + r2prime;
        const t2star = 1000 / r2star; // ms

        // Generate decay curve data
        const t2Data = [];
        const t2starData = [];
        const maxTime = 200; // ms

        for (let t = 0; t <= maxTime; t += 2) {
            t2Data.push({ x: t, y: Math.exp(-t / t2) });
            t2starData.push({ x: t, y: Math.exp(-t / t2star) });
        }

        // Update chart data
        this.r2Chart.data.datasets[0].data = t2Data;
        this.r2Chart.data.datasets[1].data = t2starData;

        // Highlight current sequence's curve
        const isSE = this.params.sequence === 'SE';
        this.r2Chart.data.datasets[0].borderWidth = isSE ? 4 : 2;
        this.r2Chart.data.datasets[1].borderWidth = isSE ? 2 : 4;
        this.r2Chart.data.datasets[0].borderDash = isSE ? [] : [5, 5];
        this.r2Chart.data.datasets[1].borderDash = isSE ? [5, 5] : [];

        // Add TE indicator line
        if (this.r2Chart.data.datasets.length > 2) {
            this.r2Chart.data.datasets.pop();
        }
        this.r2Chart.data.datasets.push({
            label: 'Current TE',
            data: [{ x: this.params.te, y: 0 }, { x: this.params.te, y: 1 }],
            borderColor: '#ef4444',
            borderWidth: 2,
            borderDash: [3, 3],
            pointRadius: 0,
            fill: false
        });

        this.r2Chart.update();

        // Update annotations
        const seAnnotation = document.getElementById('se-annotation');
        const greAnnotation = document.getElementById('gre-annotation');
        if (this.params.sequence === 'SE' || this.params.sequence === 'IR') {
            seAnnotation.style.display = 'block';
            greAnnotation.style.display = 'none';
        } else {
            seAnnotation.style.display = 'none';
            greAnnotation.style.display = 'block';
        }

        // Update parameter badge with T2 values
        const r2Badge = document.getElementById('r2-params');
        if (r2Badge) {
            r2Badge.textContent = `T2=${t2}ms → T2*=${t2star.toFixed(0)}ms (ΔB₀=${this.params.inhomogeneity}Hz)`;
        }
    }

    updateRFTimeline() {
        const svg = document.getElementById('rf-gradient-timeline');
        const seq = this.params.sequence;
        const frame = this.phaseWheelFrame;
        const ns = 'http://www.w3.org/2000/svg';

        // Sequence colors
        const seqColors = {
            'SE': '#3b82f6',
            'GRE': '#10b981',
            'IR': '#a855f7'
        };
        const seqColor = seqColors[seq];

        // Clear SVG
        svg.innerHTML = '';

        // Dark background with gradient
        const defs = document.createElementNS(ns, 'defs');
        const bgGrad = document.createElementNS(ns, 'linearGradient');
        bgGrad.setAttribute('id', 'timelineBg');
        bgGrad.setAttribute('x1', '0%');
        bgGrad.setAttribute('y1', '0%');
        bgGrad.setAttribute('x2', '0%');
        bgGrad.setAttribute('y2', '100%');
        bgGrad.innerHTML = `
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        `;
        defs.appendChild(bgGrad);

        // Glow filter
        const glowFilter = document.createElementNS(ns, 'filter');
        glowFilter.setAttribute('id', 'timelineGlow');
        glowFilter.innerHTML = `
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        `;
        defs.appendChild(glowFilter);
        svg.appendChild(defs);

        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('width', '800');
        bg.setAttribute('height', '200');
        bg.setAttribute('fill', 'url(#timelineBg)');
        bg.setAttribute('rx', '8');
        svg.appendChild(bg);

        // Row configuration - 5 rows now: RF, Gz, Gy, Gx, Signal
        const rfY = 30;
        const gzY = 60;
        const gyY = 95;
        const gxY = 130;
        const signalY = 160;
        const axisY = 185;

        // Row labels
        this.addTimelineLabel(svg, 25, rfY, 'RF', seqColor);
        this.addTimelineLabel(svg, 25, gzY, 'Gz', '#22c55e');  // Slice select
        this.addTimelineLabel(svg, 25, gyY, 'Gy', '#eab308');  // Phase encode
        this.addTimelineLabel(svg, 25, gxY, 'Gx', '#60a5fa');  // Frequency encode
        this.addTimelineLabel(svg, 25, signalY, 'Sig', '#ef4444');

        // Horizontal guide lines
        [rfY, gzY, gyY, gxY, signalY].forEach(y => {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', '50');
            line.setAttribute('y1', y);
            line.setAttribute('x2', '780');
            line.setAttribute('y2', y);
            line.setAttribute('stroke', 'rgba(148, 163, 184, 0.2)');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        const startX = 70;
        const endX = 760;
        const totalWidth = endX - startX;

        // Calculate current time position based on frame
        const currentTimeX = startX + (frame / (this.totalFrames - 1)) * totalWidth;

        // Draw current time indicator (vertical line synced with phase wheel)
        const timeIndicator = document.createElementNS(ns, 'line');
        timeIndicator.setAttribute('x1', currentTimeX);
        timeIndicator.setAttribute('y1', 15);
        timeIndicator.setAttribute('x2', currentTimeX);
        timeIndicator.setAttribute('y2', axisY);
        timeIndicator.setAttribute('stroke', '#ef4444');
        timeIndicator.setAttribute('stroke-width', '2');
        timeIndicator.setAttribute('stroke-dasharray', '4,2');
        timeIndicator.setAttribute('filter', 'url(#timelineGlow)');
        svg.appendChild(timeIndicator);

        // Time indicator dot
        const timeDot = document.createElementNS(ns, 'circle');
        timeDot.setAttribute('cx', currentTimeX);
        timeDot.setAttribute('cy', axisY);
        timeDot.setAttribute('r', '5');
        timeDot.setAttribute('fill', '#ef4444');
        timeDot.setAttribute('filter', 'url(#timelineGlow)');
        svg.appendChild(timeDot);

        if (seq === 'SE') {
            // Spin Echo timing
            const te180Frac = 0.3;  // 180° at ~30% of TR
            const teFrac = 0.6;     // Echo at ~60% of TR
            const te180X = startX + te180Frac * totalWidth;
            const teX = startX + teFrac * totalWidth;

            // RF: 90° excitation
            this.addRFPulseDark(svg, startX, rfY, 20, '90°', '#f59e0b');
            // RF: 180° refocusing
            this.addRFPulseDark(svg, te180X, rfY, 28, '180°', '#a855f7');

            // Gz: Slice select during RF pulses
            this.addGradientLobeDark(svg, startX - 5, gzY, 40, 18, '#22c55e', 'up');
            this.addGradientLobeDark(svg, startX + 35, gzY, 20, 10, '#22c55e', 'down'); // Rephaser
            this.addGradientLobeDark(svg, te180X - 5, gzY, 40, 18, '#22c55e', 'up');

            // Gy: Phase encoding (short blip)
            this.addGradientLobeDark(svg, startX + 60, gyY, 30, 15, '#eab308', 'up');

            // Gx: Frequency encode (dephase + readout)
            this.addGradientLobeDark(svg, startX + 60, gxY, 40, 18, '#60a5fa', 'down');
            this.addGradientLobeDark(svg, te180X + 40, gxY, 80, 18, '#60a5fa', 'up'); // Readout

            // Signal echo
            this.addSignalEchoDark(svg, teX, signalY, seqColor);

            // TE/2 and TE markers
            this.addTimeMarkerDark(svg, te180X + 17, 12, axisY, 'TE/2');
            this.addTimeMarkerDark(svg, teX, 12, axisY, 'TE', seqColor);

        } else if (seq === 'GRE') {
            // Gradient Echo timing
            const teFrac = 0.4;
            const teX = startX + teFrac * totalWidth;

            // RF: α excitation
            const pulseHeight = 12 + (this.params.fa / 180) * 16;
            this.addRFPulseDark(svg, startX, rfY, pulseHeight, `${Math.round(this.params.fa)}°`, '#f59e0b');

            // Gz: Slice select
            this.addGradientLobeDark(svg, startX - 5, gzY, 40, 16, '#22c55e', 'up');
            this.addGradientLobeDark(svg, startX + 35, gzY, 20, 8, '#22c55e', 'down');

            // Gy: Phase encoding
            this.addGradientLobeDark(svg, startX + 50, gyY, 25, 12, '#eab308', 'up');

            // Gx: Bipolar (dephase then rephase)
            this.addGradientLobeDark(svg, startX + 50, gxY, 35, 16, '#60a5fa', 'down');
            this.addGradientLobeDark(svg, startX + 90, gxY, 60, 16, '#60a5fa', 'up'); // Readout

            // Signal echo (smaller due to T2*)
            this.addSignalEchoDark(svg, teX, signalY, seqColor, 0.7);

            // TE marker
            this.addTimeMarkerDark(svg, teX, 12, axisY, 'TE', seqColor);

        } else { // IR
            // Inversion Recovery timing
            const tiFrac = 0.5;
            const readoutFrac = 0.55;
            const teFrac = 0.75;
            const tiX = startX + tiFrac * totalWidth;
            const readoutX = startX + readoutFrac * totalWidth;
            const teX = startX + teFrac * totalWidth;

            // RF: 180° inversion
            this.addRFPulseDark(svg, startX, rfY, 28, '180°', '#ef4444');
            this.addTimelineText(svg, startX + 17, rfY - 22, 'Inv', 'middle', '8px', '#ef4444');

            // RF: Readout pulse at TI
            this.addRFPulseDark(svg, readoutX, rfY, 20, `${Math.round(this.params.fa)}°`, '#f59e0b');

            // Gz: Slice select during inversion and readout
            this.addGradientLobeDark(svg, startX - 5, gzY, 40, 16, '#22c55e', 'up');
            this.addGradientLobeDark(svg, readoutX - 5, gzY, 35, 14, '#22c55e', 'up');
            this.addGradientLobeDark(svg, readoutX + 30, gzY, 18, 7, '#22c55e', 'down');

            // Gy: Phase encoding after readout
            this.addGradientLobeDark(svg, readoutX + 45, gyY, 25, 12, '#eab308', 'up');

            // Gx: Frequency encode
            this.addGradientLobeDark(svg, readoutX + 45, gxY, 30, 14, '#60a5fa', 'down');
            this.addGradientLobeDark(svg, readoutX + 80, gxY, 55, 14, '#60a5fa', 'up');

            // Signal echo
            this.addSignalEchoDark(svg, teX, signalY, seqColor);

            // TI and TE markers
            this.addTimeMarkerDark(svg, tiX, 12, axisY, 'TI', '#a855f7');
            this.addTimeMarkerDark(svg, teX, 12, axisY, 'TE', seqColor);
        }

        // Time axis
        const axis = document.createElementNS(ns, 'line');
        axis.setAttribute('x1', startX - 10);
        axis.setAttribute('y1', axisY);
        axis.setAttribute('x2', endX + 10);
        axis.setAttribute('y2', axisY);
        axis.setAttribute('stroke', '#64748b');
        axis.setAttribute('stroke-width', '1');
        svg.appendChild(axis);

        // Arrow at end
        const arrow = document.createElementNS(ns, 'polygon');
        arrow.setAttribute('points', `${endX + 10},${axisY} ${endX + 5},${axisY - 3} ${endX + 5},${axisY + 3}`);
        arrow.setAttribute('fill', '#64748b');
        svg.appendChild(arrow);

        // Time labels
        this.addTimelineText(svg, startX, axisY + 12, '0', 'middle', '9px', '#64748b');
        this.addTimelineText(svg, endX - 20, axisY + 12, 'TR', 'middle', '9px', '#64748b');

        // Update parameter badge
        const timelineBadge = document.getElementById('timeline-params');
        if (timelineBadge) {
            const params = [`TR=${this.params.tr}ms`, `TE=${this.params.te}ms`];
            if (seq === 'IR') params.push(`TI=${this.params.ti}ms`);
            if (seq === 'GRE' || seq === 'IR') params.push(`FA=${Math.round(this.params.fa)}°`);
            timelineBadge.textContent = params.join(' | ');
        }
    }

    // Dark theme versions of timeline helpers
    addRFPulseDark(svg, x, y, height, label, color) {
        const ns = 'http://www.w3.org/2000/svg';
        const width = 30;

        // Sinc-like pulse shape
        const path = document.createElementNS(ns, 'path');
        const d = `M ${x} ${y} Q ${x + width * 0.25} ${y - height} ${x + width * 0.5} ${y - height} Q ${x + width * 0.75} ${y - height} ${x + width} ${y}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('filter', 'url(#timelineGlow)');
        svg.appendChild(path);

        // Label
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x + width / 2);
        text.setAttribute('y', y - height - 5);
        text.setAttribute('font-size', '9');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', color);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-family', 'Inter, sans-serif');
        text.textContent = label;
        svg.appendChild(text);
    }

    addGradientLobeDark(svg, x, y, w, h, color, direction) {
        const ns = 'http://www.w3.org/2000/svg';
        const yOffset = direction === 'up' ? -h : 0;
        const points = direction === 'up'
            ? `${x},${y} ${x + w * 0.15},${y + yOffset} ${x + w * 0.85},${y + yOffset} ${x + w},${y}`
            : `${x},${y} ${x + w * 0.15},${y + h} ${x + w * 0.85},${y + h} ${x + w},${y}`;

        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('points', points);
        polygon.setAttribute('fill', color);
        polygon.setAttribute('fill-opacity', '0.3');
        polygon.setAttribute('stroke', color);
        polygon.setAttribute('stroke-width', '1.5');
        svg.appendChild(polygon);
    }

    addSignalEchoDark(svg, x, y, color, scale = 1) {
        const ns = 'http://www.w3.org/2000/svg';
        const width = 50 * scale;
        const height = 18 * scale;

        // Echo shape
        const path = document.createElementNS(ns, 'path');
        const d = `M ${x - width / 2} ${y} Q ${x - width / 4} ${y - height * 0.3} ${x} ${y - height} Q ${x + width / 4} ${y - height * 0.3} ${x + width / 2} ${y}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', color);
        path.setAttribute('fill-opacity', '0.4');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('filter', 'url(#timelineGlow)');
        svg.appendChild(path);
    }

    addTimeMarkerDark(svg, x, y1, y2, label, color = '#94a3b8') {
        const ns = 'http://www.w3.org/2000/svg';

        // Vertical dashed line
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '1');
        line.setAttribute('stroke-dasharray', '3,2');
        line.setAttribute('opacity', '0.6');
        svg.appendChild(line);

        // Label
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y1 - 3);
        text.setAttribute('font-size', '8');
        text.setAttribute('font-weight', '500');
        text.setAttribute('fill', color);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-family', 'Inter, sans-serif');
        text.textContent = label;
        svg.appendChild(text);
    }

    addTimelineLabel(svg, x, y, text, color) {
        const ns = 'http://www.w3.org/2000/svg';
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y + 4);
        label.setAttribute('font-size', '12');
        label.setAttribute('font-weight', '600');
        label.setAttribute('fill', color);
        label.textContent = text;
        svg.appendChild(label);
    }

    addRFPulse(svg, x, y, height, label, color) {
        const ns = 'http://www.w3.org/2000/svg';
        const width = 35;

        // Sinc-like pulse shape
        const path = document.createElementNS(ns, 'path');
        const d = `M ${x} ${y}
                   Q ${x + width * 0.25} ${y - height} ${x + width * 0.5} ${y - height}
                   Q ${x + width * 0.75} ${y - height} ${x + width} ${y}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '4');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);

        // Label
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x + width / 2);
        text.setAttribute('y', y - height - 8);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-weight', '700');
        text.setAttribute('fill', color);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = label;
        svg.appendChild(text);
    }

    addSignalEcho(svg, x, y, color, scale = 1) {
        const ns = 'http://www.w3.org/2000/svg';
        const width = 60 * scale;
        const height = 25 * scale;

        // Echo shape (Gaussian-like)
        const path = document.createElementNS(ns, 'path');
        const d = `M ${x - width / 2} ${y}
                   Q ${x - width / 4} ${y - height * 0.3} ${x} ${y - height}
                   Q ${x + width / 4} ${y - height * 0.3} ${x + width / 2} ${y}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', color);
        path.setAttribute('fill-opacity', '0.3');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2');
        svg.appendChild(path);
    }

    addTimeMarker(svg, x, y1, y2, label, color = '#64748b') {
        const ns = 'http://www.w3.org/2000/svg';

        // Vertical dashed line
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '4,3');
        svg.appendChild(line);

        // Label
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y1 - 5);
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', color);
        text.setAttribute('text-anchor', 'middle');
        text.textContent = label;
        svg.appendChild(text);
    }

    updateMechanicsColors(seq) {
        // Set sequence-specific colors for mechanics tab
        const colors = {
            'SE': '#3b82f6',   // Blue
            'GRE': '#10b981',  // Green
            'IR': '#a855f7'    // Purple
        };
        const color = colors[seq] || '#3b82f6';

        // Update panel title colors via CSS custom property
        document.documentElement.style.setProperty('--seq-color', color);
    }

    addRFBlock(svg, x, y, w, h, color, label) {
        const ns = 'http://www.w3.org/2000/svg';
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('fill', color);
        rect.setAttribute('stroke', '#1e293b');
        rect.setAttribute('stroke-width', '1');
        rect.setAttribute('rx', '4');
        svg.appendChild(rect);

        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x + w / 2);
        text.setAttribute('y', y + h / 2 + 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '14');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('fill', '#fff');
        text.textContent = label;
        svg.appendChild(text);
    }

    addGradientLobe(svg, x, y, w, h, color, direction) {
        const ns = 'http://www.w3.org/2000/svg';
        const points = direction === 'down'
            ? `${x},${y} ${x + w / 2},${y + h} ${x + w},${y}`
            : `${x},${y + h} ${x + w / 2},${y} ${x + w},${y + h}`;

        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('points', points);
        polygon.setAttribute('fill', color);
        polygon.setAttribute('stroke', '#1e40af');
        polygon.setAttribute('stroke-width', '1.5');
        svg.appendChild(polygon);
    }

    addEchoMarker(svg, x, y1, y2, label) {
        const ns = 'http://www.w3.org/2000/svg';
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', '#ef4444');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-dasharray', '5,5');
        svg.appendChild(line);

        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', x);
        text.setAttribute('y', y1 - 5);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-size', '13');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', '#ef4444');
        text.textContent = label;
        svg.appendChild(text);
    }

    addTimelineText(svg, x, y, text, anchor = 'start', size = '14px', color = '#475569') {
        const ns = 'http://www.w3.org/2000/svg';
        const textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('text-anchor', anchor);
        textEl.setAttribute('font-size', size);
        textEl.setAttribute('fill', color);
        textEl.textContent = text;
        svg.appendChild(textEl);
    }
}

// Initialize
const app = new MRPhysics();
app.init();
