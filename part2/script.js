/**
 * K-Space Visualization App
 * 
 * Core components:
 * 1. Complex Number handling
 * 2. 2D FFT/IFFT implementation
 * 3. Phantom generation
 * 4. Visualization logic (Canvas rendering)
 */

// --- Constants ---
const N = 256; // Matrix size (256x256 for better resolution)

// --- State ---
let kSpaceData = null; // Full K-space (Ground Truth)
let acquiredKSpace = null; // Currently acquired K-space
let reconstructedImage = null; // Image from acquired K-space
let groundTruthImage = null; // Original phantom image
let phantomType = 'brain-real';
let isAnimating = false;
let animationSpeed = 5;
let noiseLevel = 0;
let motionLevel = 0;
let hasSpike = false;
let skipY = 1;
let currentLine = 0;
let globalMaxMag = 0;
let spikeX = 0;
let spikeY = 0;
let animationFrameId = null;
let isInspecting = false; // Is user hovering over K-space?

// --- Complex Number Class ---
class Complex {
    constructor(re, im) {
        this.re = re;
        this.im = im;
    }

    add(other) {
        return new Complex(this.re + other.re, this.im + other.im);
    }

    sub(other) {
        return new Complex(this.re - other.re, this.im - other.im);
    }

    mul(other) {
        return new Complex(
            this.re * other.re - this.im * other.im,
            this.re * other.im + this.im * other.re
        );
    }

    get magnitude() {
        return Math.sqrt(this.re * this.re + this.im * this.im);
    }

    get phase() {
        return Math.atan2(this.im, this.re);
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('K-Space App Initialized');
    initApp();
});

function initApp() {
    // Initialize data structures
    initDataStructures();

    // Generate initial phantom
    generatePhantom(phantomType);

    // Initial render
    renderAll();

    // Bind events
    bindEvents();
}

function initDataStructures() {
    // Create NxN arrays of Complex numbers
    kSpaceData = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
    acquiredKSpace = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
    reconstructedImage = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
    groundTruthImage = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
}

function generatePhantom(type) {
    // Reset acquisition
    resetAcquisition();

    if (type === 'brain-real') {
        const img = new Image();
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = N;
            tempCanvas.height = N;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0, N, N);
            const imgData = ctx.getImageData(0, 0, N, N);

            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    const idx = (y * N + x) * 4;
                    // Use red channel (grayscale image) and normalize to 0-1
                    const val = imgData.data[idx] / 255;
                    groundTruthImage[y][x] = new Complex(val, 0);
                }
            }
            computeFullKSpace();
            // Auto-acquire removed for initial empty state
            // acquireAllLines(); 
            renderAll();
            updateStatus('Brain image loaded. Ready to acquire.');
        };
        img.onerror = () => {
            console.error("Failed to load brain image");
            updateStatus('Error loading brain image.');
        };
        img.src = brainBase64;
        return; // Async update will trigger render
    }

    const cx = N / 2;
    const cy = N / 2;

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            let val = 0;

            if (type === 'circle') {
                const r = N / 4;
                if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) {
                    val = 1;
                }
            } else if (type === 'square') {
                const s = N / 4;
                if (Math.abs(x - cx) <= s && Math.abs(y - cy) <= s) {
                    val = 1;
                }
            } else if (type === 'brain') {
                // Simple simulated brain (ellipses)
                // Main ellipse
                if (((x - cx) / 40) ** 2 + ((y - cy) / 50) ** 2 <= 1) val += 0.5;
                // "Ventricles"
                if (((x - cx - 10) / 5) ** 2 + ((y - cy) / 15) ** 2 <= 1) val -= 0.3;
                if (((x - cx + 10) / 5) ** 2 + ((y - cy) / 15) ** 2 <= 1) val -= 0.3;
                val = Math.max(0, val);
            }

            groundTruthImage[y][x] = new Complex(val, 0);
        }
    }

    // Compute full K-space from the image
    computeFullKSpace();

    // Auto-acquire removed for initial empty state
    // acquireAllLines();
    renderAll(); // Ensure render happens for synchronous types
}

function resetAcquisition() {
    acquiredKSpace = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
    reconstructedImage = new Array(N).fill(0).map(() => new Array(N).fill(0).map(() => new Complex(0, 0)));
    currentLine = 0;
    updateStatus(`Ready. Lines acquired: 0/${N}`);
}

function computeFullKSpace() {
    // 1. Copy image data to kSpaceData (as a starting point)
    // We want to transform Image -> K-Space (FFT)
    // Note: MRI usually considers K-space as the acquired data and Image as the IFFT.
    // But for simulation, we start with Image -> FFT -> K-Space.

    // Deep copy ground truth
    const temp = new Array(N).fill(0).map((_, y) =>
        new Array(N).fill(0).map((_, x) =>
            new Complex(groundTruthImage[y][x].re, groundTruthImage[y][x].im)
        )
    );

    // 2. Perform 2D FFT
    fft2D(temp);

    // 3. FFT Shift (center low frequencies)
    kSpaceData = fftShift(temp);

    // 4. Calculate Global Max Magnitude (for spike scaling)
    globalMaxMag = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const mag = kSpaceData[y][x].magnitude;
            if (mag > globalMaxMag) globalMaxMag = mag;
        }
    }
}

// --- FFT Implementation ---

function fft2D(data) {
    // FFT rows
    for (let y = 0; y < N; y++) {
        fft1D(data[y]);
    }

    // FFT columns
    const col = new Array(N);
    for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) col[y] = data[y][x];
        fft1D(col);
        for (let y = 0; y < N; y++) data[y][x] = col[y];
    }
}

function fft1D(arr) {
    const n = arr.length;
    if (n <= 1) return;

    const even = new Array(n / 2);
    const odd = new Array(n / 2);

    for (let i = 0; i < n / 2; i++) {
        even[i] = arr[2 * i];
        odd[i] = arr[2 * i + 1];
    }

    fft1D(even);
    fft1D(odd);

    for (let k = 0; k < n / 2; k++) {
        const t = odd[k].mul(Complex.fromPolar(1, -2 * Math.PI * k / n));
        arr[k] = even[k].add(t);
        arr[k + n / 2] = even[k].sub(t);
    }
}

// Helper for complex exponential
Complex.fromPolar = function (r, theta) {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
};

function fftShift(data) {
    const shifted = new Array(N).fill(0).map(() => new Array(N));
    const half = N / 2;

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const newY = (y + half) % N;
            const newX = (x + half) % N;
            shifted[newY][newX] = data[y][x];
        }
    }
    return shifted;
}

function ifft2D(data) {
    // IFFT is similar to FFT but with conjugate and scaling
    // 1. Conjugate
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            data[y][x].im = -data[y][x].im;
        }
    }

    // 2. FFT
    fft2D(data);

    // 3. Conjugate again and Scale
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            data[y][x].im = -data[y][x].im;
            data[y][x].re /= (N * N);
            data[y][x].im /= (N * N);
        }
    }
}

function ifftShift(data) {
    // Inverse shift is the same as shift for even N
    return fftShift(data);
}

function reconstructImage() {
    // 1. Copy acquired K-space
    const temp = new Array(N).fill(0).map((_, y) =>
        new Array(N).fill(0).map((_, x) =>
            new Complex(acquiredKSpace[y][x].re, acquiredKSpace[y][x].im)
        )
    );

    // 2. IFFT Shift (undo centering)
    const unshifted = ifftShift(temp);

    // 3. IFFT
    ifft2D(unshifted);

    reconstructedImage = unshifted;
}

// --- Animation ---

function startAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    animate();
}

function stopAnimation() {
    isAnimating = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
}

function animate() {
    if (!isAnimating) return;

    // Acquire lines based on speed
    const linesPerFrame = Math.max(1, Math.floor(animationSpeed / 2));

    for (let i = 0; i < linesPerFrame; i++) {
        if (currentLine >= N) {
            stopAnimation();
            updateStatus('Acquisition Complete');
            return;
        }

        acquireLine(currentLine);
        currentLine++;
    }

    reconstructImage();
    renderAll();
    updateStatus(`Acquiring... Line ${currentLine}/${N}`);

    animationFrameId = requestAnimationFrame(animate);
}

// Helper for Gaussian Noise (Box-Muller)
function gaussianNoise(sigma) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    return new Complex(z0 * sigma, z1 * sigma);
}

function acquireLine(lineIndex) {
    // 1. Noise Sigma (Object-Independent)
    // Reference signal is N*N (theoretical max for all-ones image).
    // We scale noise relative to this fixed reference.
    const referenceSignal = N * N;
    // Calibrated: Reduced factor from 0.002 to 0.0005 based on user feedback
    const sigma = (noiseLevel / 100) * (referenceSignal * 0.0005);

    // 2. Motion Parameters (Deterministic/Periodic)
    // Simulate respiration: Sine wave displacement in Y
    let dy = 0;
    if (motionLevel > 0) {
        // Calibrated: Increased max displacement from 5 to 15 pixels
        const maxDisp = (motionLevel / 100) * 15;
        const period = N / 4; // 4 cycles per image
        // Phase of respiration depends on time (lineIndex)
        dy = maxDisp * Math.sin(2 * Math.PI * lineIndex / period);
    }

    // Is this line acquired?
    const isAcquired = (lineIndex % skipY === 0);

    for (let x = 0; x < N; x++) {
        let val = new Complex(0, 0);

        if (isAcquired) {
            val = kSpaceData[lineIndex][x];

            // Apply Motion: Phase Ramp in Y
            if (motionLevel > 0) {
                const ky = lineIndex - N / 2;
                const phaseShift = -2 * Math.PI * ky * dy / N;
                val = val.mul(Complex.fromPolar(1, phaseShift));
            }
        }

        // Add Gaussian Noise (to ALL lines)
        if (noiseLevel > 0) {
            val = val.add(gaussianNoise(sigma));
        }

        acquiredKSpace[lineIndex][x] = val;
    }

    // Spike Noise: Inject a single bad point
    if (hasSpike) {
        if (lineIndex === spikeY) {
            // Scale spike relative to TRUE global max
            // Calibrated: Reduced from 2 to 0.5 to prevent image corruption
            const spikeAmp = globalMaxMag * 0.5;
            // Add to existing value
            acquiredKSpace[lineIndex][spikeX] = acquiredKSpace[lineIndex][spikeX].add(new Complex(spikeAmp, spikeAmp));
        }
    }
}

function acquireAllLines() {
    for (let i = 0; i < N; i++) acquireLine(i);
    currentLine = N;
    reconstructImage();
}

function updateStatus(text) {
    document.getElementById('statusText').innerText = text;
}

function renderAll() {
    if (!isInspecting) {
        renderImage();
    }
    renderKSpace();
}

function renderImage() {
    // Render Original Object (Ground Truth Magnitude)
    const origCanvas = document.getElementById('originalCanvas');
    const origCtx = origCanvas.getContext('2d');
    const origImgData = origCtx.createImageData(N, N);

    // Render Reconstructed Image (Magnitude)
    const reconCanvas = document.getElementById('reconstructedCanvas');
    const reconCtx = reconCanvas.getContext('2d');
    const reconImgData = reconCtx.createImageData(N, N);

    // Find max for normalization (use Ground Truth max for consistency)
    let maxMag = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const mag = groundTruthImage[y][x].magnitude;
            if (mag > maxMag) maxMag = mag;
        }
    }

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const idx = (y * N + x) * 4;

            // Original
            const origMag = groundTruthImage[y][x].magnitude;
            const origNorm = maxMag > 0 ? (origMag / maxMag) * 255 : 0;
            origImgData.data[idx] = origNorm;
            origImgData.data[idx + 1] = origNorm;
            origImgData.data[idx + 2] = origNorm;
            origImgData.data[idx + 3] = 255;

            // Reconstructed
            const reconMag = reconstructedImage[y][x].magnitude;
            const reconNorm = maxMag > 0 ? (reconMag / maxMag) * 255 : 0;
            reconImgData.data[idx] = reconNorm;
            reconImgData.data[idx + 1] = reconNorm;
            reconImgData.data[idx + 2] = reconNorm;
            reconImgData.data[idx + 3] = 255;
        }
    }

    origCtx.putImageData(origImgData, 0, 0);
    reconCtx.putImageData(reconImgData, 0, 0);
}

function renderKSpace() {
    // Render Magnitude
    const magCanvas = document.getElementById('kspaceMagCanvas');
    const magCtx = magCanvas.getContext('2d');
    const magImgData = magCtx.createImageData(N, N);

    // Render Phase
    const phaseCanvas = document.getElementById('kspacePhaseCanvas');
    const phaseCtx = phaseCanvas.getContext('2d');
    const phaseImgData = phaseCtx.createImageData(N, N);

    let maxMag = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const mag = kSpaceData[y][x].magnitude;
            if (mag > maxMag) maxMag = mag;
        }
    }

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const idx = (y * N + x) * 4;

            // Magnitude (Log scaled)
            const magVal = acquiredKSpace[y][x].magnitude;
            const magNorm = maxMag > 0 ? (Math.log(1 + magVal) / Math.log(1 + maxMag)) * 255 : 0;
            magImgData.data[idx] = magNorm;
            magImgData.data[idx + 1] = magNorm;
            magImgData.data[idx + 2] = magNorm;
            magImgData.data[idx + 3] = 255;

            // Phase
            const phaseVal = acquiredKSpace[y][x].phase;
            const phaseNorm = ((phaseVal + Math.PI) / (2 * Math.PI)) * 255;
            phaseImgData.data[idx] = phaseNorm;
            phaseImgData.data[idx + 1] = phaseNorm;
            phaseImgData.data[idx + 2] = phaseNorm;
            phaseImgData.data[idx + 3] = 255;
        }
    }

    magCtx.putImageData(magImgData, 0, 0);
    phaseCtx.putImageData(phaseImgData, 0, 0);

    // Visual Marker for Spike Noise
    if (hasSpike) {
        magCtx.beginPath();
        magCtx.arc(spikeX, spikeY, 5, 0, 2 * Math.PI);
        magCtx.strokeStyle = 'red';
        magCtx.lineWidth = 2;
        magCtx.stroke();

        // Smart Label Positioning
        magCtx.fillStyle = 'red';
        magCtx.font = '10px Inter';

        let labelX = spikeX + 8;
        let labelY = spikeY + 3;
        const text = `Spike (${spikeX}, ${spikeY})`;
        const textWidth = magCtx.measureText(text).width;

        // Check bounds
        if (labelX + textWidth > N) {
            labelX = spikeX - textWidth - 8;
        }
        if (labelY < 10) {
            labelY = spikeY + 15;
        } else if (labelY > N - 5) {
            labelY = spikeY - 5;
        }

        magCtx.fillText(text, labelX, labelY);
    }
}

function renderGrating(kx, ky) {
    // Render grating to Original Object canvas (temporarily overlaying)
    const canvas = document.getElementById('originalCanvas');
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(N, N);

    // kx, ky are indices in 0..N-1
    // Center is N/2
    // Normalized freq: (k - N/2) / N

    const fx = (kx - N / 2) / N;
    const fy = (ky - N / 2) / N;

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const idx = (y * N + x) * 4;

            // Grating equation: cos(2*pi*(fx*x + fy*y))
            // Map -1..1 to 0..255
            const val = Math.cos(2 * Math.PI * (fx * x + fy * y));
            const norm = ((val + 1) / 2) * 255;

            imgData.data[idx] = norm;
            imgData.data[idx + 1] = norm;
            imgData.data[idx + 2] = norm;
            imgData.data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Also add text overlay
    ctx.fillStyle = "white";
    ctx.font = "14px Inter";
    ctx.shadowColor = "black";
    ctx.shadowBlur = 4;
    ctx.fillText(`Spatial Frequency: (${(kx - N / 2)}, ${(ky - N / 2)})`, 10, 20);
}

function bindEvents() {
    document.getElementById('phantomSelect').addEventListener('change', (e) => {
        phantomType = e.target.value;
        generatePhantom(phantomType);
        renderAll();
    });

    document.getElementById('btnStartFill').addEventListener('click', () => {
        if (currentLine >= N) {
            resetAcquisition();
        }
        startAnimation();
    });
    document.getElementById('btnStopFill').addEventListener('click', stopAnimation);

    document.getElementById('btnAcquireAll').addEventListener('click', () => {
        stopAnimation();
        for (let i = 0; i < N; i++) acquireLine(i);
        currentLine = N;
        reconstructImage();
        renderAll();
        updateStatus('Acquisition Complete');
    });

    document.getElementById('btnClear').addEventListener('click', () => {
        stopAnimation();
        resetAcquisition();
        renderAll();
    });

    document.getElementById('speedRange').addEventListener('input', (e) => {
        animationSpeed = parseInt(e.target.value);
    });

    document.getElementById('noiseRange').addEventListener('input', (e) => {
        noiseLevel = parseInt(e.target.value);
        // Re-acquire to show noise effect immediately if static
        if (!isAnimating && currentLine === N) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('motionRange').addEventListener('input', (e) => {
        motionLevel = parseInt(e.target.value);
        if (!isAnimating && currentLine === N) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('spikeCheck').addEventListener('change', (e) => {
        hasSpike = e.target.checked;
        if (hasSpike) {
            // Randomize spike location
            spikeX = Math.floor(Math.random() * N);
            spikeY = Math.floor(Math.random() * N);
        }
        if (!isAnimating && currentLine === N) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('skipYRange').addEventListener('input', (e) => {
        skipY = parseInt(e.target.value);
        document.getElementById('skipYVal').innerText = skipY;
        if (!isAnimating && currentLine === N) {
            acquireAllLines();
            renderAll();
        }
    });

    // K-Space Hover (on Magnitude canvas)
    const kCanvas = document.getElementById('kspaceMagCanvas');

    kCanvas.addEventListener('mousemove', (e) => {
        const rect = kCanvas.getBoundingClientRect();
        const scaleX = N / rect.width;
        const scaleY = N / rect.height;

        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);

        if (x >= 0 && x < N && y >= 0 && y < N) {
            isInspecting = true;
            renderGrating(x, y);
            updateStatus(`Inspecting K-Space: (${x - N / 2}, ${y - N / 2})`);
        }
    });

    kCanvas.addEventListener('mouseleave', () => {
        isInspecting = false;
        renderImage();
        updateStatus(isAnimating ? `Acquiring... Line ${currentLine}/${N}` : 'Ready');
    });
}
