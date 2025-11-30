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
    }

    init() {
        this.initUI();
        this.initCharts();
        this.initMechanicsVisualizations();
        this.renderParams();
        this.updateSimulation();
        this.makeDraggable();

        // Help button
        document.getElementById('helpBtn').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'flex';
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'none';
        });
    }

    applyPreset(type) {
        if (type === 'T1') {
            this.params.sequence = 'SE';
            this.params.tr = 500;
            this.params.te = 20;
        } else if (type === 'T2') {
            this.params.sequence = 'SE';
            this.params.tr = 3000;
            this.params.te = 100;
        } else if (type === 'PD') {
            this.params.sequence = 'SE';
            this.params.tr = 3000;
            this.params.te = 20;
        }

        // Update UI
        document.getElementById('sequenceType').value = this.params.sequence;
        this.renderParams();
        this.updateSimulation();
        this.updateInhomogeneityVisibility();
    }

    makeDraggable() {
        const overlay = document.getElementById('equation-overlay');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;

        overlay.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialX = e.clientX - overlay.offsetLeft;
            initialY = e.clientY - overlay.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;

            // Keep within container bounds
            const container = document.getElementById('brain-phantom-container');
            const containerRect = container.getBoundingClientRect();
            const overlayRect = overlay.getBoundingClientRect();

            const maxX = containerRect.width - overlayRect.width;
            const maxY = containerRect.height - overlayRect.height;

            currentX = Math.max(0, Math.min(currentX, maxX));
            currentY = Math.max(0, Math.min(currentY, maxY));

            overlay.style.left = currentX + 'px';
            overlay.style.top = currentY + 'px';
            overlay.style.bottom = 'auto';
            overlay.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
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

        // B0 Slider
        const b0Slider = document.getElementById('b0Field');
        b0Slider.addEventListener('input', (e) => {
            this.params.b0 = parseFloat(e.target.value);
            document.getElementById('b0Value').textContent = `${this.params.b0} T`;
            this.updateSimulation();
        });

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

        this.renderParams();
    }

    applyPreset(type) {
        if (type === 'T1') {
            this.params.sequence = 'SE';
            this.params.tr = 500;
            this.params.te = 20;
        } else if (type === 'T2') {
            this.params.sequence = 'SE';
            this.params.tr = 3000;
            this.params.te = 100;
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
            this.params.ti = 2200; // Null CSF (T1 ~4500ms -> TI ~ 0.69*T1 but usually 2000-2500ms at 1.5T)
            this.params.fa = 90; // Standard readout
        } else if (type === 'STIR') {
            this.params.sequence = 'IR';
            this.params.tr = 4000;
            this.params.te = 50;
            this.params.ti = 170; // Null Fat (T1 ~250ms -> TI ~ 0.69*T1)
            this.params.fa = 90; // Standard readout
        }

        // Update UI
        document.getElementById('sequenceType').value = this.params.sequence;

        // Update sliders if they exist (need to re-render params first to create elements)
        this.renderParams();

        // Update inhomogeneity slider if needed
        if (type === 'T2*') {
            const inhoSlider = document.getElementById('inhomogeneity');
            if (inhoSlider) {
                inhoSlider.value = this.params.inhomogeneity;
                document.getElementById('inhomogeneityValue').textContent = `${this.params.inhomogeneity} Hz`;
            }
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
            container.appendChild(createInput('ti', 'TI (ms)', this.params.ti || 150, 10, 2000, 10));
            this.params.ti = this.params.ti || 150;
        }

        // FA applies to all sequences now (SE, GRE, IR)
        if (this.params.sequence === 'GRE' || this.params.sequence === 'SE' || this.params.sequence === 'IR') {
            container.appendChild(createInput('fa', 'Flip Angle (°)', this.params.fa || 90, 1, 180, 1));
            this.params.fa = this.params.fa || 90;
        }
    }

    initCharts() {
        // Helper to create contrast charts
        const createContrastChart = (id, xLabel) => {
            const ctx = document.getElementById(id).getContext('2d');
            return new Chart(ctx, {
                type: 'line',
                data: { datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { type: 'linear', title: { display: true, text: xLabel } },
                        y: { title: { display: true, text: 'Signal Intensity' } }
                    },
                    animation: false,
                    elements: { point: { radius: 0 } },
                    plugins: { legend: { display: false } }
                }
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

        return b0Factor * pd * Math.abs(mz_ti) * Math.sin(fa) * Math.exp(-te / t2);
    }

    updatePhantom() {
        // Calculate signal for each tissue first
        const signals = this.tissues.map(tissue => {
            let s = 0;
            if (this.params.sequence === 'SE') {
                s = this.getSignalSE(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.fa);
            } else if (this.params.sequence === 'GRE') {
                s = this.getSignalGRE(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.fa, this.params.inhomogeneity);
            } else if (this.params.sequence === 'IR') {
                s = this.getSignalIR(tissue.t1, tissue.t2, tissue.pd, this.params.tr, this.params.te, this.params.ti, this.params.fa);
            }
            return { ...tissue, signal: Math.abs(s) };
        });

        // Find max signal for auto-scaling (Windowing)
        const maxSignal = Math.max(...signals.map(t => t.signal));

        // Avoid division by zero
        const scaleFactor = maxSignal > 0.001 ? (255 / maxSignal) : 0;

        // Update SVG fill
        signals.forEach(item => {
            // Apply scaling
            let intensity = item.signal * scaleFactor;
            let grayVal = Math.floor(Math.min(intensity, 255));

            const el = document.getElementById(item.regionId);
            if (el) {
                const fillColor = `rgb(${grayVal}, ${grayVal}, ${grayVal})`;

                // If it's a group element, update all children
                if (el.tagName === 'g') {
                    Array.from(el.children).forEach(child => {
                        child.setAttribute('fill', fillColor);
                    });
                } else {
                    el.setAttribute('fill', fillColor);
                }
            }
        });
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
                    data.push({ x: x, y: s });
                }
                return {
                    label: tissue.name,
                    data: data,
                    borderColor: tissue.color,
                    backgroundColor: tissue.color,
                    borderWidth: 2,
                    pointRadius: 0
                };
            });
        };

        // Helper to add vertical indicator line
        const addIndicator = (chart, value, color = '#ffffff') => {
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

            chart.data.datasets.push({
                label: 'Current Value',
                data: [{ x: value, y: 0 }, { x: value, y: indicatorHeight }],
                borderColor: color,
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                showLine: true,
                order: 0 // Draw on top
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
        // Initialize R2 Chart
        const r2Ctx = document.getElementById('r2Chart').getContext('2d');
        this.r2Chart = new Chart(r2Ctx, {
            type: 'bar',
            data: {
                labels: ['R2 (Intrinsic)', 'R2\' (Inhomogeneity)', 'R2* (Total)'],
                datasets: [{
                    label: 'Decay Rate (s⁻¹)',
                    data: [0, 0, 0],
                    backgroundColor: ['#3b82f6', '#ef4444', '#a855f7']
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Rate (s⁻¹)'
                        }
                    }
                }
            }
        });

        // Phase Wheel Controls
        document.getElementById('prev-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame - 1 + 3) % 3;
            this.updatePhaseWheel();
        });

        document.getElementById('next-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame + 1) % 3;
            this.updatePhaseWheel();
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
                    this.phaseWheelFrame = (this.phaseWheelFrame + 1) % 3;
                    this.updatePhaseWheel();
                }, 1000); // 1 second per frame
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

        // Update sequence-specific styling
        this.updateMechanicsColors(seq);

        // Update frame label
        document.getElementById('frame-label').textContent = `Frame ${frame + 1}/3`;

        // Clear SVG
        svg.innerHTML = '';

        // Circle background
        const ns = 'http://www.w3.org/2000/svg';
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '150');
        circle.setAttribute('cy', '150');
        circle.setAttribute('r', '100');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', '#cbd5e1');
        circle.setAttribute('stroke-width', '2');
        svg.appendChild(circle);

        // Add axes
        const xAxis = document.createElementNS(ns, 'line');
        xAxis.setAttribute('x1', '50');
        xAxis.setAttribute('y1', '150');
        xAxis.setAttribute('x2', '250');
        xAxis.setAttribute('y2', '150');
        xAxis.setAttribute('stroke', '#94a3b8');
        xAxis.setAttribute('stroke-width', '1');
        svg.appendChild(xAxis);

        const yAxis = document.createElementNS(ns, 'line');
        yAxis.setAttribute('x1', '150');
        yAxis.setAttribute('y1', '50');
        yAxis.setAttribute('x2', '150');
        yAxis.setAttribute('y2', '250');
        yAxis.setAttribute('stroke', '#94a3b8');
        yAxis.setAttribute('stroke-width', '1');
        svg.appendChild(yAxis);

        // Labels
        const labels = ['Mxy', 'Mz'];
        const label1 = document.createElementNS(ns, 'text');
        label1.setAttribute('x', '260');
        label1.setAttribute('y', '155');
        label1.setAttribute('font-size', '14');
        label1.setAttribute('fill', '#64748b');
        label1.textContent = labels[0];
        svg.appendChild(label1);

        const label2 = document.createElementNS(ns, 'text');
        label2.setAttribute('x', '155');
        label2.setAttribute('y', '40');
        label2.setAttribute('font-size', '14');
        label2.setAttribute('fill', '#64748b');
        label2.textContent = labels[1];
        svg.appendChild(label2);

        // Draw spin vectors
        const numSpins = 12;
        const angles = this.getSpinAngles(seq, frame, numSpins);

        for (let i = 0; i < numSpins; i++) {
            const angle = angles[i];
            const x2 = 150 + 80 * Math.cos(angle);
            const y2 = 150 - 80 * Math.sin(angle);

            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', '150');
            line.setAttribute('y1', '150');
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', '#3b82f6');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            svg.appendChild(line);
        }

        // Add arrowhead marker
        const defs = document.createElementNS(ns, 'defs');
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '5');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('points', '0 0, 6 3, 0 6');
        polygon.setAttribute('fill', '#3b82f6');
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.insertBefore(defs, svg.firstChild);

        // Frame description
        const desc = this.getFrameDescription(seq, frame);
        const descText = document.createElementNS(ns, 'text');
        descText.setAttribute('x', '150');
        descText.setAttribute('y', '280');
        descText.setAttribute('font-size', '13');
        descText.setAttribute('fill', '#475569');
        descText.setAttribute('text-anchor', 'middle');
        descText.textContent = desc;
        svg.appendChild(descText);

        // Update parameter badge
        const phaseBadge = document.getElementById('phase-params');
        if (phaseBadge) {
            phaseBadge.textContent = `${seq}: TE=${this.params.te}ms, TR=${this.params.tr}ms${seq === 'IR' ? `, TI=${this.params.ti}ms` : ''}`;
        }
    }

    getSpinAngles(seq, frame, numSpins) {
        const angles = [];

        if (seq === 'SE') {
            if (frame === 0) {
                // Frame 1: After 90° pulse, all aligned horizontally (0°)
                for (let i = 0; i < numSpins; i++) {
                    angles.push(0);
                }
            } else if (frame === 1) {
                // Frame 2: Dephasing - spread out
                for (let i = 0; i < numSpins; i++) {
                    angles.push((i / numSpins) * Math.PI * 2);
                }
            } else {
                // Frame 3: After 180° + rephasing - reconverge
                for (let i = 0; i < numSpins; i++) {
                    angles.push(0);
                }
            }
        } else if (seq === 'GRE') {
            if (frame === 0) {
                // Frame 1: After α pulse, aligned
                for (let i = 0; i < numSpins; i++) {
                    angles.push(0);
                }
            } else if (frame === 1) {
                // Frame 2: Partial rephasing - some spread
                for (let i = 0; i < numSpins; i++) {
                    angles.push((i / numSpins) * Math.PI); // Half spread of SE
                }
            } else {
                // Frame 3: Echo - incomplete rephasing, residual dispersion
                for (let i = 0; i < numSpins; i++) {
                    angles.push((i / numSpins) * Math.PI * 0.6);
                }
            }
        } else { // IR
            if (frame === 0) {
                // Frame 1: After 180° inversion, spins flipped to -z (represented as π)
                for (let i = 0; i < numSpins; i++) {
                    angles.push(Math.PI); // Inverted
                }
            } else if (frame === 1) {
                // Frame 2: At TI (null point for target tissue) - recovering toward zero
                for (let i = 0; i < numSpins; i++) {
                    angles.push(Math.PI * 0.5); // Passing through zero
                }
            } else {
                // Frame 3: After readout pulse (90°) - aligned in transverse plane
                for (let i = 0; i < numSpins; i++) {
                    angles.push(0);
                }
            }
        }

        return angles;
    }

    getFrameDescription(seq, frame) {
        if (seq === 'SE') {
            const descs = [
                'After 90° Pulse',
                'Dephasing (TE/2)',
                'After 180° + Rephasing (TE)'
            ];
            return descs[frame];
        } else if (seq === 'GRE') {
            const descs = [
                'After α° Pulse',
                'Gradient Rewind',
                'Echo (TE) - Incomplete Rephasing'
            ];
            return descs[frame];
        } else { // IR
            const descs = [
                'After 180° Inversion',
                `At TI=${this.params.ti}ms (Null Point)`,
                'After Readout Pulse'
            ];
            return descs[frame];
        }
    }

    updateR2Chart() {
        // Calculate R2, R2', R2*
        const t2 = 80; // Use white matter T2 as reference (ms)
        const r2 = 1000 / t2; // s^-1
        const r2prime = 2 * Math.PI * this.params.inhomogeneity; // s^-1
        const r2star = r2 + r2prime;

        // Update chart
        this.r2Chart.data.datasets[0].data = [r2, r2prime, r2star];
        this.r2Chart.update();

        // Update annotations visibility
        const seAnnotation = document.getElementById('se-annotation');
        const greAnnotation = document.getElementById('gre-annotation');
        if (this.params.sequence === 'SE') {
            seAnnotation.style.display = 'block';
            greAnnotation.style.display = 'none';
        } else {
            seAnnotation.style.display = 'none';
            greAnnotation.style.display = 'block';
        }

        // Update parameter badge
        const r2Badge = document.getElementById('r2-params');
        if (r2Badge) {
            r2Badge.textContent = `R2=${r2.toFixed(1)} s⁻¹, R2'=${r2prime.toFixed(1)} s⁻¹, R2*=${r2star.toFixed(1)} s⁻¹ (ΔB0=${this.params.inhomogeneity}Hz)`;
        }
    }

    updateRFTimeline() {
        const svg = document.getElementById('rf-gradient-timeline');
        const seq = this.params.sequence;
        const ns = 'http://www.w3.org/2000/svg';

        // Clear SVG
        svg.innerHTML = '';

        // Background
        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('width', '800');
        bg.setAttribute('height', '200');
        bg.setAttribute('fill', '#f8fafc');
        svg.appendChild(bg);

        // Row labels
        this.addTimelineText(svg, 60, 50, 'RF:', 'end');
        this.addTimelineText(svg, 60, 120, 'Gradient:', 'end');

        const startX = 100;
        const endX = 750;
        const totalWidth = endX - startX;

        if (seq === 'SE') {
            // Calculate actual positions based on TR and TE
            const te180X = startX + (this.params.te / 2 / this.params.tr) * totalWidth;
            const teX = startX + (this.params.te / this.params.tr) * totalWidth;

            // 90° pulse at t=0
            this.addRFBlock(svg, startX, 30, 40, 40, '#f59e0b', '90°');

            // Dephasing gradient
            const dephaseWidth = Math.min(100, (te180X - startX - 60) * 0.8);
            this.addGradientLobe(svg, startX + 60, 100, dephaseWidth, 40, '#60a5fa', 'down');

            // 180° pulse at TE/2
            this.addRFBlock(svg, Math.max(te180X, startX + 60), 30, 40, 40, '#a855f7', '180°');

            // Rephasing gradient
            const rephaseStart = Math.max(te180X + 60, startX + 140);
            const rephaseWidth = Math.min(100, (teX - rephaseStart) * 0.8);
            this.addGradientLobe(svg, rephaseStart, 100, rephaseWidth, 40, '#60a5fa', 'up');

            // Echo marker at TE
            this.addEchoMarker(svg, teX, 20, 140, 'TE');

        } else if (seq === 'GRE') {
            // Calculate actual TE position
            const teX = startX + (this.params.te / this.params.tr) * totalWidth;

            // α pulse at t=0
            const alphaLabel = `${Math.round(this.params.fa)}°`;
            this.addRFBlock(svg, startX, 30, 40, 40, '#f59e0b', alphaLabel);

            // Dephasing gradient
            const dephaseWidth = Math.min(80, (teX - startX - 60) * 0.4);
            this.addGradientLobe(svg, startX + 60, 100, dephaseWidth, 40, '#60a5fa', 'down');

            // Partial rephasing gradient
            const rephaseStart = startX + 60 + dephaseWidth + 20;
            const rephaseWidth = Math.min(50, dephaseWidth * 0.6);
            this.addGradientLobe(svg, rephaseStart, 100, rephaseWidth, 40, '#60a5fa', 'up');
            this.addTimelineText(svg, rephaseStart + rephaseWidth / 2, 165, 'Partial', 'middle', '11px');

            // Echo marker at TE
            this.addEchoMarker(svg, teX, 20, 140, 'TE');

        } else { // IR
            // Calculate actual positions based on TR, TI, TE
            const tiX = startX + (this.params.ti / this.params.tr) * totalWidth;
            const teX = tiX + ((this.params.te) / this.params.tr) * totalWidth;

            // 180° inversion pulse at t=0
            this.addRFBlock(svg, startX, 30, 40, 40, '#ef4444', '180°');
            this.addTimelineText(svg, startX + 20, 15, 'Inversion', 'middle', '11px');

            // Readout pulse at TI with actual FA value
            const readoutLabel = `${Math.round(this.params.fa)}°`;
            this.addRFBlock(svg, tiX, 30, 40, 40, '#f59e0b', readoutLabel);
            this.addTimelineText(svg, tiX + 20, 15, `TI=${this.params.ti}ms`, 'middle', '11px');

            // Echo marker at TI + TE
            this.addEchoMarker(svg, Math.min(teX, endX - 50), 20, 140, 'TE');
        }

        // Time axis
        const axis = document.createElementNS(ns, 'line');
        axis.setAttribute('x1', startX);
        axis.setAttribute('y1', '180');
        axis.setAttribute('x2', endX);
        axis.setAttribute('y2', '180');
        axis.setAttribute('stroke', '#94a3b8');
        axis.setAttribute('stroke-width', '2');
        svg.appendChild(axis);

        // Time labels with actual values
        this.addTimelineText(svg, startX, 195, '0', 'middle', '12px');
        this.addTimelineText(svg, endX, 195, `TR=${this.params.tr}ms`, 'middle', '12px');

        // Update parameter badge
        const timelineBadge = document.getElementById('timeline-params');
        if (timelineBadge) {
            const params = [`TR=${this.params.tr}ms`, `TE=${this.params.te}ms`];
            if (seq === 'IR') params.push(`TI=${this.params.ti}ms`);
            if (seq === 'GRE' || seq === 'IR') params.push(`FA=${Math.round(this.params.fa)}°`);
            timelineBadge.textContent = params.join(', ');
        }
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

    addTimelineText(svg, x, y, text, anchor = 'start', size = '14px') {
        const ns = 'http://www.w3.org/2000/svg';
        const textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('text-anchor', anchor);
        textEl.setAttribute('font-size', size);
        textEl.setAttribute('fill', '#475569');
        textEl.textContent = text;
        svg.appendChild(textEl);
    }
}

// Initialize
const app = new MRPhysics();
app.init();
