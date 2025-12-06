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
            this.params.ti = 2200; // Null CSF (T1 ~4500ms -> TI ~ 0.69*T1 but usually 2000-2500ms at 1.5T)
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

        // Update UI
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
            container.appendChild(createInput('ti', 'TI (ms)', this.params.ti || 150, 10, 2500, 10));
            this.params.ti = this.params.ti || 150;
        }

        // FA only applies to GRE and IR (SE uses fixed 90°/180° pulses)
        if (this.params.sequence === 'GRE' || this.params.sequence === 'IR') {
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

        // Return SIGNED value (caller handles magnitude if needed)
        return b0Factor * pd * mz_ti * Math.sin(fa) * Math.exp(-te / t2);
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

                    // Apply magnitude unless "Show Signed" is enabled (only relevant for IR)
                    if (!this.showSigned) {
                        s = Math.abs(s);
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
                            font: { size: 11 }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Time (ms)', font: { size: 11 } },
                        grid: { color: 'rgba(148, 163, 184, 0.1)' }
                    },
                    y: {
                        title: { display: true, text: 'Signal', font: { size: 11 } },
                        min: 0,
                        max: 1,
                        grid: { color: 'rgba(148, 163, 184, 0.1)' }
                    }
                }
            }
        });

        // Phase Wheel Controls - now with 6 frames for smoother animation
        this.totalFrames = 6;

        document.getElementById('prev-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame - 1 + this.totalFrames) % this.totalFrames;
            this.updatePhaseWheel();
        });

        document.getElementById('next-frame').addEventListener('click', () => {
            this.phaseWheelFrame = (this.phaseWheelFrame + 1) % this.totalFrames;
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
                    this.phaseWheelFrame = (this.phaseWheelFrame + 1) % this.totalFrames;
                    this.updatePhaseWheel();
                }, 800); // Slightly faster for smoother feel
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

        // Sequence colors
        const seqColors = {
            'SE': { primary: '#3b82f6', secondary: '#93c5fd' },
            'GRE': { primary: '#10b981', secondary: '#6ee7b7' },
            'IR': { primary: '#a855f7', secondary: '#c4b5fd' }
        };
        const colors = seqColors[seq] || seqColors['SE'];

        // Update frame label with step indicator
        const stepLabels = this.getStepLabels(seq);
        document.getElementById('frame-label').textContent = `${frame + 1}/${this.totalFrames}: ${stepLabels[frame]}`;

        // Clear SVG
        svg.innerHTML = '';

        const ns = 'http://www.w3.org/2000/svg';

        // Add gradient definitions
        const defs = document.createElementNS(ns, 'defs');

        // Radial gradient for background
        const bgGrad = document.createElementNS(ns, 'radialGradient');
        bgGrad.setAttribute('id', 'bgGradient');
        bgGrad.innerHTML = `
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#f1f5f9"/>
        `;
        defs.appendChild(bgGrad);

        // Arrow marker for individual spins (uses secondary/lighter color)
        const marker = document.createElementNS(ns, 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS(ns, 'polygon');
        polygon.setAttribute('points', '0 0, 8 3, 0 6');
        polygon.setAttribute('fill', colors.secondary);
        marker.appendChild(polygon);
        defs.appendChild(marker);

        svg.appendChild(defs);

        // Background circle
        const bgCircle = document.createElementNS(ns, 'circle');
        bgCircle.setAttribute('cx', '150');
        bgCircle.setAttribute('cy', '140');
        bgCircle.setAttribute('r', '110');
        bgCircle.setAttribute('fill', 'url(#bgGradient)');
        svg.appendChild(bgCircle);

        // Reference circle
        const refCircle = document.createElementNS(ns, 'circle');
        refCircle.setAttribute('cx', '150');
        refCircle.setAttribute('cy', '140');
        refCircle.setAttribute('r', '90');
        refCircle.setAttribute('fill', 'none');
        refCircle.setAttribute('stroke', '#e2e8f0');
        refCircle.setAttribute('stroke-width', '2');
        refCircle.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(refCircle);

        // Center point
        const center = document.createElementNS(ns, 'circle');
        center.setAttribute('cx', '150');
        center.setAttribute('cy', '140');
        center.setAttribute('r', '4');
        center.setAttribute('fill', '#64748b');
        svg.appendChild(center);

        // Draw spin vectors with improved styling
        const numSpins = 8;
        const angles = this.getSpinAngles(seq, frame, numSpins);
        const coherence = this.getCoherence(seq, frame);

        // Individual spin arrows - keep constant length, show dephasing through spread
        const spinLen = 65; // Fixed length for individual spins

        for (let i = 0; i < numSpins; i++) {
            const angle = angles[i];
            const x2 = 150 + spinLen * Math.cos(angle);
            const y2 = 140 - spinLen * Math.sin(angle);

            // Vector line
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', '150');
            line.setAttribute('y1', '140');
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', colors.secondary);
            line.setAttribute('stroke-width', '2.5');
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('marker-end', 'url(#arrowhead)');
            line.setAttribute('opacity', '0.7');
            svg.appendChild(line);
        }

        // Net magnetization vector (thicker, brighter) - this one scales with coherence
        const netAngle = this.getNetAngle(seq, frame);
        const netLen = 75 * coherence;
        if (coherence > 0.05) {
            const netX = 150 + netLen * Math.cos(netAngle);
            const netY = 140 - netLen * Math.sin(netAngle);

            // Glow effect
            const glow = document.createElementNS(ns, 'line');
            glow.setAttribute('x1', '150');
            glow.setAttribute('y1', '140');
            glow.setAttribute('x2', netX);
            glow.setAttribute('y2', netY);
            glow.setAttribute('stroke', '#ef4444');
            glow.setAttribute('stroke-width', '10');
            glow.setAttribute('stroke-linecap', 'round');
            glow.setAttribute('opacity', '0.3');
            svg.appendChild(glow);

            const netLine = document.createElementNS(ns, 'line');
            netLine.setAttribute('x1', '150');
            netLine.setAttribute('y1', '140');
            netLine.setAttribute('x2', netX);
            netLine.setAttribute('y2', netY);
            netLine.setAttribute('stroke', '#ef4444');
            netLine.setAttribute('stroke-width', '5');
            netLine.setAttribute('stroke-linecap', 'round');
            svg.appendChild(netLine);

            // Net vector tip
            const netTip = document.createElementNS(ns, 'circle');
            netTip.setAttribute('cx', netX);
            netTip.setAttribute('cy', netY);
            netTip.setAttribute('r', '6');
            netTip.setAttribute('fill', '#ef4444');
            svg.appendChild(netTip);

            // Label for net magnetization
            const netLabel = document.createElementNS(ns, 'text');
            netLabel.setAttribute('x', netX + 15);
            netLabel.setAttribute('y', netY - 5);
            netLabel.setAttribute('font-size', '11');
            netLabel.setAttribute('font-weight', '600');
            netLabel.setAttribute('fill', '#ef4444');
            netLabel.textContent = 'M';
            svg.appendChild(netLabel);
        }

        // Coherence indicator bar
        const barY = 270;
        const barBg = document.createElementNS(ns, 'rect');
        barBg.setAttribute('x', '50');
        barBg.setAttribute('y', barY);
        barBg.setAttribute('width', '200');
        barBg.setAttribute('height', '8');
        barBg.setAttribute('rx', '4');
        barBg.setAttribute('fill', '#e2e8f0');
        svg.appendChild(barBg);

        const barFill = document.createElementNS(ns, 'rect');
        barFill.setAttribute('x', '50');
        barFill.setAttribute('y', barY);
        barFill.setAttribute('width', 200 * coherence);
        barFill.setAttribute('height', '8');
        barFill.setAttribute('rx', '4');
        barFill.setAttribute('fill', colors.primary);
        svg.appendChild(barFill);

        // Coherence label
        const cohLabel = document.createElementNS(ns, 'text');
        cohLabel.setAttribute('x', '150');
        cohLabel.setAttribute('y', barY + 22);
        cohLabel.setAttribute('font-size', '11');
        cohLabel.setAttribute('fill', '#64748b');
        cohLabel.setAttribute('text-anchor', 'middle');
        cohLabel.setAttribute('font-weight', '500');
        cohLabel.textContent = `Signal: ${Math.round(coherence * 100)}%`;
        svg.appendChild(cohLabel);

        // Update parameter badge
        const phaseBadge = document.getElementById('phase-params');
        if (phaseBadge) {
            phaseBadge.textContent = `${seq}: TE=${this.params.te}ms, TR=${this.params.tr}ms${seq === 'IR' ? `, TI=${this.params.ti}ms` : ''}`;
        }
    }

    getStepLabels(seq) {
        if (seq === 'SE') return [
            '90° Excitation',
            'Free Precession',
            'T2 Dephasing',
            '180° Refocus',
            'Rephasing',
            'Spin Echo'
        ];
        if (seq === 'GRE') return [
            'α° Excitation',
            'Free Precession',
            'Gradient Dephase',
            'Gradient Rephase',
            'Partial Rephase',
            'Gradient Echo'
        ];
        return [
            '180° Inversion',
            'T1 Recovery (early)',
            'T1 Recovery (mid)',
            'Null Point',
            '90° Readout',
            'Signal Acquisition'
        ];
    }

    getCoherence(seq, frame) {
        // 6 frames: gradual transitions for each sequence
        if (seq === 'SE') return [1.0, 0.85, 0.4, 0.35, 0.7, 0.95][frame];
        if (seq === 'GRE') return [1.0, 0.8, 0.5, 0.55, 0.6, 0.65][frame];
        return [0.0, 0.15, 0.35, 0.02, 0.85, 0.9][frame]; // IR: starts inverted
    }

    getNetAngle(seq, frame) {
        if (seq === 'SE') return [0, 0, 0, Math.PI, 0, 0][frame];
        if (seq === 'GRE') return [0, 0, 0, 0, 0, 0][frame];
        // IR: inverted (-z) -> recovering -> null -> positive -> readout
        return [Math.PI, Math.PI * 0.75, Math.PI * 0.4, Math.PI * 0.5, 0, 0][frame];
    }

    getSpinAngles(seq, frame, numSpins) {
        const angles = [];

        if (seq === 'SE') {
            // 6-frame Spin Echo sequence
            const spreadFactors = [0, 0.2, 1.0, 1.0, 0.4, 0.1]; // How spread out the spins are
            const spread = spreadFactors[frame];

            for (let i = 0; i < numSpins; i++) {
                const baseAngle = (i / numSpins) * Math.PI * 2 * spread;
                // After 180° pulse (frame 3), flip the direction
                if (frame >= 3) {
                    angles.push(-baseAngle);
                } else {
                    angles.push(baseAngle);
                }
            }
        } else if (seq === 'GRE') {
            // 6-frame Gradient Echo sequence
            const spreadFactors = [0, 0.25, 0.8, 0.6, 0.5, 0.45]; // GRE never fully rephases
            const spread = spreadFactors[frame];

            for (let i = 0; i < numSpins; i++) {
                angles.push((i / numSpins) * Math.PI * 2 * spread);
            }
        } else { // IR
            // 6-frame Inversion Recovery sequence
            // Frames 0-3: longitudinal recovery (spins point along z-axis, shown as π or 0)
            // Frame 4-5: after readout pulse, transverse magnetization
            if (frame < 4) {
                // During T1 recovery, all spins aligned (but in z-direction)
                const recoveryAngle = [Math.PI, Math.PI * 0.7, Math.PI * 0.35, Math.PI / 2][frame];
                for (let i = 0; i < numSpins; i++) {
                    angles.push(recoveryAngle);
                }
            } else {
                // After 90° readout - coherent in transverse plane
                const spreadFactors = [0.15, 0.1];
                const spread = spreadFactors[frame - 4];
                for (let i = 0; i < numSpins; i++) {
                    angles.push((i / numSpins) * Math.PI * 2 * spread);
                }
            }
        }

        return angles;
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

        // Background with subtle gradient
        const defs = document.createElementNS(ns, 'defs');
        const bgGrad = document.createElementNS(ns, 'linearGradient');
        bgGrad.setAttribute('id', 'timelineBg');
        bgGrad.setAttribute('x1', '0%');
        bgGrad.setAttribute('y1', '0%');
        bgGrad.setAttribute('x2', '0%');
        bgGrad.setAttribute('y2', '100%');
        bgGrad.innerHTML = `
            <stop offset="0%" stop-color="#f8fafc"/>
            <stop offset="100%" stop-color="#f1f5f9"/>
        `;
        defs.appendChild(bgGrad);
        svg.appendChild(defs);

        const bg = document.createElementNS(ns, 'rect');
        bg.setAttribute('width', '800');
        bg.setAttribute('height', '200');
        bg.setAttribute('fill', 'url(#timelineBg)');
        bg.setAttribute('rx', '8');
        svg.appendChild(bg);

        // Row configuration
        const rfY = 45;
        const gradY = 110;
        const signalY = 155;
        const axisY = 180;

        // Row labels with icons
        this.addTimelineLabel(svg, 25, rfY, 'RF', seqColor);
        this.addTimelineLabel(svg, 25, gradY, 'Gx', '#60a5fa');
        this.addTimelineLabel(svg, 25, signalY, 'Signal', '#ef4444');

        // Horizontal guide lines
        [rfY, gradY, signalY].forEach(y => {
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', '70');
            line.setAttribute('y1', y);
            line.setAttribute('x2', '780');
            line.setAttribute('y2', y);
            line.setAttribute('stroke', '#e2e8f0');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        });

        const startX = 100;
        const endX = 750;
        const totalWidth = endX - startX;

        if (seq === 'SE') {
            const te180X = startX + Math.max(0.1, this.params.te / 2 / this.params.tr) * totalWidth;
            const teX = startX + Math.max(0.2, this.params.te / this.params.tr) * totalWidth;

            // 90° excitation pulse
            this.addRFPulse(svg, startX, rfY, 35, '90°', '#f59e0b');

            // 180° refocusing pulse
            this.addRFPulse(svg, Math.min(te180X, endX - 150), rfY, 45, '180°', '#a855f7');

            // Gradient lobes
            const g1X = startX + 50;
            const g1W = Math.min(60, (te180X - g1X - 20) * 0.6);
            this.addGradientLobe(svg, g1X, gradY, g1W, 25, '#60a5fa', 'down');

            const g2X = Math.min(te180X, endX - 150) + 50;
            this.addGradientLobe(svg, g2X, gradY, g1W, 25, '#60a5fa', 'up');

            // Signal echo
            this.addSignalEcho(svg, Math.min(teX, endX - 50), signalY, seqColor);

            // TE marker
            this.addTimeMarker(svg, Math.min(teX, endX - 50), 25, axisY, `TE=${this.params.te}ms`);

        } else if (seq === 'GRE') {
            const teX = startX + Math.max(0.15, this.params.te / this.params.tr) * totalWidth;

            // α excitation pulse (smaller)
            const pulseHeight = 20 + (this.params.fa / 180) * 25;
            this.addRFPulse(svg, startX, rfY, pulseHeight, `${Math.round(this.params.fa)}°`, '#f59e0b');

            // Bipolar gradient (dephase then rephase)
            this.addGradientLobe(svg, startX + 50, gradY, 50, 25, '#60a5fa', 'down');
            this.addGradientLobe(svg, startX + 110, gradY, 40, 20, '#60a5fa', 'up');

            // Signal echo (smaller due to T2*)
            this.addSignalEcho(svg, Math.min(teX, endX - 50), signalY, seqColor, 0.7);

            // TE marker
            this.addTimeMarker(svg, Math.min(teX, endX - 50), 25, axisY, `TE=${this.params.te}ms`);

        } else { // IR
            const tiX = startX + Math.max(0.15, this.params.ti / this.params.tr) * totalWidth;
            const teX = tiX + Math.max(0.05, this.params.te / this.params.tr) * totalWidth;

            // 180° inversion pulse
            this.addRFPulse(svg, startX, rfY, 50, '180°', '#ef4444');
            this.addTimelineText(svg, startX + 17, rfY - 40, 'Inversion', 'middle', '10px', '#64748b');

            // Readout pulse at TI
            const readoutX = Math.min(tiX, endX - 200);
            this.addRFPulse(svg, readoutX, rfY, 35, `${Math.round(this.params.fa)}°`, '#f59e0b');

            // Gradient for readout
            this.addGradientLobe(svg, readoutX + 50, gradY, 40, 20, '#60a5fa', 'down');
            this.addGradientLobe(svg, readoutX + 100, gradY, 40, 20, '#60a5fa', 'up');

            // Signal echo
            const echoX = Math.min(teX, endX - 50);
            this.addSignalEcho(svg, echoX, signalY, seqColor);

            // TI and TE markers
            this.addTimeMarker(svg, readoutX + 17, 25, axisY, `TI=${this.params.ti}ms`);
            this.addTimeMarker(svg, echoX, 25, axisY, `TE`, '#ef4444');
        }

        // Time axis
        const axis = document.createElementNS(ns, 'line');
        axis.setAttribute('x1', startX - 10);
        axis.setAttribute('y1', axisY);
        axis.setAttribute('x2', endX + 10);
        axis.setAttribute('y2', axisY);
        axis.setAttribute('stroke', '#94a3b8');
        axis.setAttribute('stroke-width', '2');
        svg.appendChild(axis);

        // Arrow at end
        const arrow = document.createElementNS(ns, 'polygon');
        arrow.setAttribute('points', `${endX + 10},${axisY} ${endX + 5},${axisY - 4} ${endX + 5},${axisY + 4}`);
        arrow.setAttribute('fill', '#94a3b8');
        svg.appendChild(arrow);

        // Time labels
        this.addTimelineText(svg, startX, axisY + 15, '0', 'middle', '11px', '#64748b');
        this.addTimelineText(svg, endX - 30, axisY + 15, `TR=${this.params.tr}ms`, 'middle', '11px', '#64748b');

        // Update parameter badge
        const timelineBadge = document.getElementById('timeline-params');
        if (timelineBadge) {
            const params = [`TR=${this.params.tr}ms`, `TE=${this.params.te}ms`];
            if (seq === 'IR') params.push(`TI=${this.params.ti}ms`);
            if (seq === 'GRE' || seq === 'IR') params.push(`FA=${Math.round(this.params.fa)}°`);
            timelineBadge.textContent = params.join(' | ');
        }
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
