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
const N = 512; // Matrix size (512x512 for full resolution range)

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
let matrixSize = 256; // Effective matrix size (resolution)
let simulateSNR = true; // Whether to visually simulate SNR effect (default: on)
let currentLine = 0;

// Partial Fourier settings
let partialFourierFraction = 1.0; // 1.0 = full, 0.75, 0.625
let partialFourierRecon = 'zerofill'; // 'zerofill' or 'conjugate'

// Parallel Imaging settings (simplified demo)
let numCoils = 1; // 1 = no parallel imaging, 2 or 4 coils
let parallelAcceleration = 1; // R factor (1, 2, or 4)

// Displayed k-space (after PF/PI processing) for visualization
let displayedKSpace = null;
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

    // Initialize resolution info display
    updateResolutionInfo();

    // Bind events first (so UI is responsive during image load)
    bindEvents();

    // Generate initial phantom (will call renderAll when ready)
    generatePhantom(phantomType);
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

    if (type === 'brain-real' || type === 'mri-easter') {
        const img = new Image();
        img.onload = () => {
            console.log('Image loaded successfully');
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
            renderAll();
            updateStatus('Image loaded. Ready to acquire.');
        };
        img.onerror = (e) => {
            console.error("Failed to load image:", e);
            updateStatus('Error loading image. Try another phantom.');
        };
        // Set crossOrigin before src for CORS compatibility
        img.crossOrigin = 'anonymous';
        if (type === 'mri-easter') {
            img.src = 'MRI.png';
        } else {
            img.src = brainBase64;
        }
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
    updateStatus(`Ready. Lines acquired: 0/${matrixSize}`);
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

/**
 * Partial Fourier Reconstruction
 * Fills missing k-space using conjugate symmetry: S(-k) = S*(k) for real images
 */
function applyPartialFourierRecon(kspace, size) {
    const centerY = size / 2;
    const halfRes = matrixSize / 2;

    // Calculate the boundary of acquired data
    const acquiredFraction = partialFourierFraction;
    const overlapFraction = (acquiredFraction - 0.5) * 2;
    const minKyAcquired = Math.floor(centerY - halfRes * overlapFraction);

    if (partialFourierRecon === 'zerofill') {
        // Zero-fill: just leave missing data as zeros (already done during acquisition)
        return kspace;
    } else if (partialFourierRecon === 'conjugate') {
        // Conjugate synthesis: use S(-k) = S*(k) to fill missing data
        // This assumes the image is real (or nearly real)
        const result = new Array(size).fill(0).map((_, y) =>
            new Array(size).fill(0).map((_, x) =>
                new Complex(kspace[y][x].re, kspace[y][x].im)
            )
        );

        // Fill missing lines in top half using conjugate of bottom half
        for (let y = 0; y < size; y++) {
            const kyRelative = y - centerY;

            // Check if this line is in the missing region (top of k-space)
            if (kyRelative < -halfRes * overlapFraction) {
                for (let x = 0; x < size; x++) {
                    // Find conjugate point: (-ky, -kx) -> (size-y, size-x)
                    const conjY = (size - y) % size;
                    const conjX = (size - x) % size;

                    // Check if conjugate point was acquired
                    if (kspace[conjY][conjX].re !== 0 || kspace[conjY][conjX].im !== 0) {
                        // S(-k) = S*(k)
                        result[y][x] = new Complex(kspace[conjY][conjX].re, -kspace[conjY][conjX].im);
                    }
                }
            }
        }
        return result;
    }
    return kspace;
}

/**
 * Simplified Parallel Imaging Reconstruction (SENSE-like concept demo)
 * In real SENSE: aliased image is unfolded using coil sensitivity maps
 * Here we simulate the effect by reducing aliasing artifacts from undersampling
 *
 * Key physics: SNR_SENSE = SNR_full / (g * sqrt(R))
 * where g = geometry factor (typically 1.0-1.5 for modern coils)
 * We simulate g-factor noise penalty even when recovering aliasing
 */
function applyParallelImagingRecon(kspace, size) {
    // For the demo, we show the concept that parallel imaging can
    // recover information from undersampled data, but with SNR penalty
    //
    // Real SENSE: Combines aliased coil images using sensitivity maps
    // Our simplification: When parallel imaging is "on", we reduce the
    // aliasing effect by partially filling skipped lines from interpolation
    // BUT we add g-factor noise to show the SNR penalty

    if (numCoils <= 1) return kspace;

    // The acceleration factor from parallel imaging
    const R = parallelAcceleration;

    // If undersampling (skipY) is used, parallel imaging can help recover
    // For demo purposes, we interpolate missing lines when R >= skipY
    if (skipY > 1 && R >= skipY) {
        const result = new Array(size).fill(0).map((_, y) =>
            new Array(size).fill(0).map((_, x) =>
                new Complex(kspace[y][x].re, kspace[y][x].im)
            )
        );

        // Fill skipped lines using weighted average of neighbors
        // This simulates how SENSE can recover missing k-space lines
        const centerY = size / 2;
        const halfRes = matrixSize / 2;

        // g-factor: geometry factor that increases with R
        // Typical values: R=2 -> g~1.1, R=4 -> g~1.3
        const gFactor = 1.0 + 0.1 * (R - 1);

        // Calculate noise to add (simulates g-factor SNR penalty)
        // Find max magnitude for noise scaling
        let maxMag = 0;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const mag = Math.sqrt(kspace[y][x].re * kspace[y][x].re + kspace[y][x].im * kspace[y][x].im);
                if (mag > maxMag) maxMag = mag;
            }
        }
        // Noise level proportional to g-factor and sqrt(R)
        const noiseSigma = maxMag * 0.02 * gFactor * Math.sqrt(R);

        for (let y = 0; y < size; y++) {
            // Check if this line was skipped
            if (y % skipY !== 0) {
                const kyFromCenter = Math.abs(y - centerY);
                if (kyFromCenter < halfRes) {
                    // Find nearest acquired lines
                    const prevLine = Math.floor(y / skipY) * skipY;
                    const nextLine = Math.min(prevLine + skipY, size - 1);

                    // Interpolate
                    const t = (y - prevLine) / skipY;
                    for (let x = 0; x < size; x++) {
                        const re = (1 - t) * kspace[prevLine][x].re + t * kspace[nextLine][x].re;
                        const im = (1 - t) * kspace[prevLine][x].im + t * kspace[nextLine][x].im;

                        // Add g-factor noise to recovered lines
                        const noiseRe = gaussianRandom() * noiseSigma;
                        const noiseIm = gaussianRandom() * noiseSigma;

                        result[y][x] = new Complex(re + noiseRe, im + noiseIm);
                    }
                }
            } else {
                // Acquired lines also get some g-factor noise penalty
                const kyFromCenter = Math.abs(y - centerY);
                if (kyFromCenter < halfRes) {
                    for (let x = 0; x < size; x++) {
                        const noiseRe = gaussianRandom() * noiseSigma * 0.5; // Less noise on acquired lines
                        const noiseIm = gaussianRandom() * noiseSigma * 0.5;
                        result[y][x] = new Complex(
                            kspace[y][x].re + noiseRe,
                            kspace[y][x].im + noiseIm
                        );
                    }
                }
            }
        }
        return result;
    }

    return kspace;
}

// Simple Gaussian random number generator (Box-Muller, single value)
function gaussianRandom() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2);
}

function reconstructImage() {
    // Handle zero-padding for higher resolution (matrixSize > N)
    // or truncation for lower resolution (matrixSize < N)

    if (matrixSize <= N) {
        // Standard reconstruction at native or lower resolution
        // 1. Copy acquired K-space
        let temp = new Array(N).fill(0).map((_, y) =>
            new Array(N).fill(0).map((_, x) =>
                new Complex(acquiredKSpace[y][x].re, acquiredKSpace[y][x].im)
            )
        );

        // 1b. Apply Partial Fourier reconstruction if needed
        if (partialFourierFraction < 1.0) {
            temp = applyPartialFourierRecon(temp, N);
        }

        // 1c. Apply Parallel Imaging reconstruction if needed
        if (numCoils > 1) {
            temp = applyParallelImagingRecon(temp, N);
        }

        // Store displayed k-space (after PF/PI processing) for visualization
        displayedKSpace = new Array(N).fill(0).map((_, y) =>
            new Array(N).fill(0).map((_, x) =>
                new Complex(temp[y][x].re, temp[y][x].im)
            )
        );

        // 2. IFFT Shift (undo centering)
        const unshifted = ifftShift(temp);

        // 3. IFFT
        ifft2D(unshifted);

        reconstructedImage = unshifted;
    } else {
        // Zero-padding reconstruction for higher resolution (interpolation)
        // FFT requires power-of-2 sizes, so round up to next power of 2
        const nextPow2 = (n) => Math.pow(2, Math.ceil(Math.log2(n)));
        const fftSize = nextPow2(matrixSize);

        // Create FFT-sized k-space array with zeros
        const padded = new Array(fftSize).fill(0).map(() =>
            new Array(fftSize).fill(0).map(() => new Complex(0, 0))
        );

        // Copy acquired k-space data to center of padded array
        // This keeps the same FOV but adds interpolated samples between voxels
        const offset = (fftSize - N) / 2;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                padded[y + offset][x + offset] = new Complex(
                    acquiredKSpace[y][x].re,
                    acquiredKSpace[y][x].im
                );
            }
        }

        // Store displayedKSpace for visualization (use acquiredKSpace for N×N display)
        displayedKSpace = new Array(N).fill(0).map((_, y) =>
            new Array(N).fill(0).map((_, x) =>
                new Complex(acquiredKSpace[y][x].re, acquiredKSpace[y][x].im)
            )
        );

        // IFFT Shift on padded data
        const unshifted = ifftShiftVariable(padded, fftSize);

        // IFFT on padded data
        ifft2DVariable(unshifted, fftSize);

        // Compensate for zero-padding scaling
        // IFFT divides by fftSize^2, but we want signal level consistent with N^2
        // Scale factor = (fftSize/N)^2
        const scaleFactor = (fftSize / N) * (fftSize / N);
        for (let y = 0; y < fftSize; y++) {
            for (let x = 0; x < fftSize; x++) {
                unshifted[y][x].re *= scaleFactor;
                unshifted[y][x].im *= scaleFactor;
            }
        }

        // Store the full padded result
        reconstructedImagePadded = unshifted;
        reconstructedImagePaddedSize = fftSize;

        // Downsample to N×N for display using bilinear interpolation
        // Zero-padding keeps the same FOV, so we sample the full fftSize grid
        // and map it back to N×N display
        reconstructedImage = new Array(N).fill(0).map((_, y) =>
            new Array(N).fill(0).map((_, x) => {
                // Map display pixel [0,N) to padded grid [0,fftSize)
                const srcY = y * fftSize / N;
                const srcX = x * fftSize / N;

                // Bilinear interpolation
                const y0 = Math.floor(srcY);
                const x0 = Math.floor(srcX);
                const y1 = Math.min(y0 + 1, fftSize - 1);
                const x1 = Math.min(x0 + 1, fftSize - 1);
                const fy = srcY - y0;
                const fx = srcX - x0;

                // Interpolate real and imaginary parts separately
                const v00 = unshifted[y0][x0];
                const v01 = unshifted[y0][x1];
                const v10 = unshifted[y1][x0];
                const v11 = unshifted[y1][x1];

                const re = (1 - fy) * ((1 - fx) * v00.re + fx * v01.re) +
                           fy * ((1 - fx) * v10.re + fx * v11.re);
                const im = (1 - fy) * ((1 - fx) * v00.im + fx * v01.im) +
                           fy * ((1 - fx) * v10.im + fx * v11.im);

                return new Complex(re, im);
            })
        );
    }
}

// Variable-size FFT shift
function ifftShiftVariable(data, size) {
    const shifted = new Array(size).fill(0).map(() => new Array(size));
    const half = size / 2;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const newY = (y + half) % size;
            const newX = (x + half) % size;
            shifted[newY][newX] = data[y][x];
        }
    }
    return shifted;
}

// Variable-size 2D IFFT
function ifft2DVariable(data, size) {
    // Conjugate
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            data[y][x].im = -data[y][x].im;
        }
    }

    // FFT
    fft2DVariable(data, size);

    // Conjugate again and Scale
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            data[y][x].im = -data[y][x].im;
            data[y][x].re /= (size * size);
            data[y][x].im /= (size * size);
        }
    }
}

// Variable-size 2D FFT
function fft2DVariable(data, size) {
    // FFT rows
    for (let y = 0; y < size; y++) {
        fft1DVariable(data[y], size);
    }

    // FFT columns
    const col = new Array(size);
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) col[y] = data[y][x];
        fft1DVariable(col, size);
        for (let y = 0; y < size; y++) data[y][x] = col[y];
    }
}

// Variable-size 1D FFT (Iterative Cooley-Tukey radix-2)
// Iterative version to avoid stack overflow for large sizes
function fft1DVariable(arr, n) {
    if (n <= 1) return;

    // Bit-reversal permutation
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
        const j = reverseBits(i, bits);
        if (j > i) {
            const temp = arr[i];
            arr[i] = arr[j];
            arr[j] = temp;
        }
    }

    // Iterative FFT
    for (let size = 2; size <= n; size *= 2) {
        const halfSize = size / 2;
        const tableStep = n / size;

        for (let i = 0; i < n; i += size) {
            for (let j = 0; j < halfSize; j++) {
                const angle = -2 * Math.PI * j / size;
                const twiddle = Complex.fromPolar(1, angle);
                const even = arr[i + j];
                const odd = arr[i + j + halfSize].mul(twiddle);

                arr[i + j] = even.add(odd);
                arr[i + j + halfSize] = even.sub(odd);
            }
        }
    }
}

// Helper function to reverse bits
function reverseBits(x, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
        result = (result << 1) | (x & 1);
        x >>= 1;
    }
    return result;
}

// Storage for padded reconstruction
let reconstructedImagePadded = null;
let reconstructedImagePaddedSize = N;

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

    // Calculate the k-space region to acquire based on current resolution
    // Only acquire lines within the matrixSize boundary (centered)
    const halfRes = matrixSize / 2;
    const startLine = Math.floor(N / 2 - halfRes);
    const endLine = Math.floor(N / 2 + halfRes);
    const totalLines = endLine - startLine;

    // Calculate actual acquired lines considering undersampling
    const acquiredLines = Math.ceil(totalLines / skipY);

    // Acquire lines based on speed
    const linesPerFrame = Math.max(1, Math.floor(animationSpeed / 2));

    for (let i = 0; i < linesPerFrame; i++) {
        // Map currentLine (0 to totalLines) to actual k-space line (startLine to endLine)
        if (currentLine >= totalLines) {
            stopAnimation();
            const completionMsg = skipY > 1
                ? `Acquisition Complete (${acquiredLines}/${totalLines} lines, ${skipY}x undersampling)`
                : 'Acquisition Complete';
            updateStatus(completionMsg);
            return;
        }

        const actualLine = startLine + currentLine;
        acquireLine(actualLine);
        currentLine++;
    }

    reconstructImage();
    renderAll();

    // Show progress with undersampling info
    const currentAcquired = Math.ceil(currentLine / skipY);
    const progressMsg = skipY > 1
        ? `Acquiring... ${currentAcquired}/${acquiredLines} lines (${skipY}x skip)`
        : `Acquiring... Line ${currentLine}/${totalLines}`
    updateStatus(progressMsg);

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
    // Use effective noise level (considers SNR simulation)
    const effectiveNoise = getEffectiveNoiseLevel();
    // Calibrated: Reduced factor from 0.002 to 0.0005 based on user feedback
    const sigma = (effectiveNoise / 100) * (referenceSignal * 0.0005);

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

    // Is this line acquired? (undersampling)
    const isAcquired = (lineIndex % skipY === 0);

    // Resolution mask: only acquire within the effective matrix size
    // K-space center is at N/2, so we mask based on distance from center
    // For matrixSize > N: acquire all k-space (will be zero-padded in reconstruction)
    // For matrixSize <= N: truncate outer k-space for lower resolutions
    const effectiveMatrixForAcquisition = Math.min(matrixSize, N);
    const halfRes = effectiveMatrixForAcquisition / 2;
    const centerY = N / 2;
    const centerX = N / 2;

    // Check if this line is within the resolution boundary
    const kyFromCenter = Math.abs(lineIndex - centerY);
    const lineInResolution = kyFromCenter < halfRes;

    // Partial Fourier: only acquire fraction of ky (asymmetric about center)
    // Acquire from center to +ky edge, plus small margin into -ky for phase estimation
    let lineInPartialFourier = true;
    if (partialFourierFraction < 1.0) {
        const kyRelative = lineIndex - centerY; // Negative = top half, positive = bottom half
        // Acquire: full positive ky + small overlap into negative ky
        // e.g., 75% = acquire from -25% to +50% (relative to halfRes)
        const acquiredFraction = partialFourierFraction;
        const overlapFraction = (acquiredFraction - 0.5) * 2; // Overlap into negative ky
        const minKy = -halfRes * overlapFraction;
        const maxKy = halfRes;
        lineInPartialFourier = (kyRelative >= minKy && kyRelative < maxKy);
    }

    for (let x = 0; x < N; x++) {
        let val = new Complex(0, 0);

        // Check if this x position is within resolution boundary
        const kxFromCenter = Math.abs(x - centerX);
        const pointInResolution = lineInResolution && (kxFromCenter < halfRes);

        // Combined check: undersampling + resolution + partial Fourier
        const shouldAcquire = isAcquired && pointInResolution && lineInPartialFourier;

        if (shouldAcquire) {
            val = kSpaceData[lineIndex][x];

            // Apply Motion: Phase Ramp in Y
            if (motionLevel > 0) {
                const ky = lineIndex - N / 2;
                const phaseShift = -2 * Math.PI * ky * dy / N;
                val = val.mul(Complex.fromPolar(1, phaseShift));
            }
        }

        // Add Gaussian Noise only to actually acquired samples
        if (effectiveNoise > 0 && shouldAcquire) {
            val = val.add(gaussianNoise(sigma));
        }

        acquiredKSpace[lineIndex][x] = val;
    }

    // Spike Noise: Inject a single bad point (only if within resolution)
    if (hasSpike) {
        if (lineIndex === spikeY) {
            const kxFromCenter = Math.abs(spikeX - centerX);
            const kyFromCenter = Math.abs(spikeY - centerY);
            if (kxFromCenter < halfRes && kyFromCenter < halfRes) {
                // Scale spike relative to TRUE global max
                // Calibrated: Reduced from 2 to 0.5 to prevent image corruption
                const spikeAmp = globalMaxMag * 0.5;
                // Add to existing value
                acquiredKSpace[lineIndex][spikeX] = acquiredKSpace[lineIndex][spikeX].add(new Complex(spikeAmp, spikeAmp));
            }
        }
    }
}

// Calculate and update resolution info display
function updateResolutionInfo() {
    // SNR baseline is 256×256 for educational clarity
    const SNR_BASELINE = 256;

    // Pixel size ratio relative to baseline (256×256)
    const pixelSizeRatio = SNR_BASELINE / matrixSize;

    // Calculate total acceleration factor
    // R_total = R_undersampling × R_partial_fourier
    const R_undersampling = skipY;
    const R_partial_fourier = 1 / partialFourierFraction;
    const R_total = R_undersampling * R_partial_fourier;

    // K-space coverage: percentage of k-space AREA relative to full N×N
    // Must account for undersampling factor (skipY) and partial Fourier
    const kspaceCoverageArea = (matrixSize / N) * (matrixSize / N) * partialFourierFraction * (1 / skipY) * 100;

    // SNR relationship for 2D imaging with constant FOV:
    // Signal per voxel ∝ voxel_area = (pixel_size)^2
    // Noise per voxel is constant (thermal noise in receiver)
    // Therefore: SNR ∝ (pixel_size)^2 = (baseline/matrixSize)^2
    //
    // With acceleration (undersampling + partial Fourier):
    // SNR_accelerated = SNR_full / √R_total
    //
    // Parallel imaging can recover some SNR loss (g-factor dependent)
    // For demo: assume perfect recovery up to R = numCoils
    //
    // Lower resolution (128x128): 2x pixels vs baseline → SNR = 4.00
    // Baseline resolution (256x256): 1x pixels → SNR = 1.00
    // Higher resolution (512x512): 0.5x pixels → SNR = 0.25
    // With 4x undersampling: SNR reduced by factor of 2 (√4)
    //
    // This demonstrates the fundamental resolution-SNR tradeoff!
    const resolutionSNR = pixelSizeRatio * pixelSizeRatio;

    // SNR penalty from acceleration:
    // - Undersampling alone (no PI): SNR ∝ 1/√R (fewer samples = more noise)
    // - With Parallel Imaging: SNR ∝ 1/(g·√R) where g is geometry factor
    //   PI reduces aliasing but doesn't recover the lost SNR from fewer samples
    //   In fact, g-factor adds additional penalty (g ≥ 1)
    //
    // g-factor: geometry factor that increases with R
    // Typical values: R=2 -> g~1.1, R=4 -> g~1.3
    const gFactor = numCoils > 1 ? (1.0 + 0.1 * (numCoils - 1)) : 1.0;

    // Total acceleration penalty (always present regardless of PI)
    // PI helps with aliasing artifacts but SNR penalty remains
    const accelerationPenalty = 1 / (gFactor * Math.sqrt(R_total));
    const relativeSNR = resolutionSNR * accelerationPenalty;

    document.getElementById('matrixSizeVal').innerText = matrixSize;
    document.getElementById('matrixSizeVal2').innerText = matrixSize;
    document.getElementById('pixelSizeVal').innerText = pixelSizeRatio.toFixed(2) + 'x';

    // Show coverage as area percentage of full k-space (N×N), accounting for undersampling
    document.getElementById('kspaceCoverageVal').innerText = kspaceCoverageArea.toFixed(1) + '%';

    document.getElementById('snrVal').innerText = relativeSNR.toFixed(2);

    // Update SNR bar visualization
    // Map SNR from range 0.25 (512) to 64 (32) to bar width
    // Use log scale: log2(SNR) maps 0.25->-2, 1->0, 64->6
    // Normalize to 0-100% range
    const logSNR = Math.log2(relativeSNR);
    const snrBarWidth = Math.min(100, Math.max(5, ((logSNR + 2) / 8) * 100));
    const snrBar = document.getElementById('snrBar');
    snrBar.style.width = snrBarWidth + '%';

    // Color code: green for high SNR, cyan for baseline, red for low
    if (relativeSNR >= 4) {
        snrBar.style.backgroundColor = 'rgba(74, 222, 128, 0.8)'; // Green - high SNR
    } else if (relativeSNR >= 0.5) {
        snrBar.style.backgroundColor = 'rgba(56, 189, 248, 0.8)'; // Cyan - baseline
    } else {
        snrBar.style.backgroundColor = 'rgba(248, 113, 113, 0.8)'; // Red - low SNR
    }
}

// Get the effective noise level considering SNR simulation
function getEffectiveNoiseLevel() {
    if (!simulateSNR) return noiseLevel;

    // SNR baseline is 256×256
    const SNR_BASELINE = 256;

    // When simulating SNR, noise scales inversely with voxel area
    // SNR ∝ (pixel_size)^2 = (baseline/matrixSize)^2
    // Noise ∝ 1/SNR = (matrixSize/baseline)^2
    const snrFactor = (matrixSize / SNR_BASELINE) * (matrixSize / SNR_BASELINE);

    // At 256x256 (baseline), snrFactor = 1, noise = base
    // At 128x128, snrFactor = 0.25 (less noise, 4x SNR)
    // At 512x512, snrFactor = 4 (more noise, 0.25x SNR)
    //
    // Higher resolution = smaller voxels = less signal = more visible noise
    const baseSimulatedNoise = 25;
    const simulatedNoise = baseSimulatedNoise * snrFactor;

    // Combine with user-set noise level
    return Math.max(noiseLevel, simulatedNoise);
}

function acquireAllLines() {
    // Only acquire lines within the matrixSize boundary (centered)
    const halfRes = matrixSize / 2;
    const startLine = Math.floor(N / 2 - halfRes);
    const endLine = Math.floor(N / 2 + halfRes);

    for (let i = startLine; i < endLine; i++) {
        acquireLine(i);
    }
    currentLine = endLine - startLine; // Total lines acquired
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

    // Use displayedKSpace if available (shows PF/PI processing), otherwise acquiredKSpace
    const kspaceToShow = displayedKSpace || acquiredKSpace;

    // Calculate max from displayed k-space
    let maxMag = 0;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const mag = kspaceToShow[y][x].magnitude;
            if (mag > maxMag) maxMag = mag;
        }
    }

    // Define acquired region boundary
    const halfRes = matrixSize / 2;
    const centerX = N / 2;
    const centerY = N / 2;

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const idx = (y * N + x) * 4;

            // Check if this point is within the acquired region
            const inAcquiredRegion = Math.abs(x - centerX) < halfRes && Math.abs(y - centerY) < halfRes;

            // Check if this line was actually acquired (for undersampling visualization)
            const lineAcquired = (y % skipY === 0);
            // When PI is on and can recover, show interpolated lines differently
            const lineRecovered = (numCoils > 1 && skipY > 1 && numCoils >= skipY);

            if (inAcquiredRegion && maxMag > 0) {
                // Magnitude (Log scaled)
                const magVal = kspaceToShow[y][x].magnitude;
                const magNorm = (Math.log(1 + magVal) / Math.log(1 + maxMag)) * 255;

                // Color coding for k-space visualization:
                // - White: directly acquired lines
                // - Cyan: PI-interpolated lines (recovered by parallel imaging)
                // - Dark: skipped lines (when PI is off or can't recover)
                if (!lineAcquired && !lineRecovered) {
                    // Skipped line without PI recovery - show as dark/zero
                    magImgData.data[idx] = 0;
                    magImgData.data[idx + 1] = 0;
                    magImgData.data[idx + 2] = 0;
                    magImgData.data[idx + 3] = 255;

                    phaseImgData.data[idx] = 0;
                    phaseImgData.data[idx + 1] = 0;
                    phaseImgData.data[idx + 2] = 0;
                    phaseImgData.data[idx + 3] = 255;
                } else if (!lineAcquired && lineRecovered) {
                    // PI-interpolated line - show in cyan tint
                    magImgData.data[idx] = magNorm * 0.3;      // Less red
                    magImgData.data[idx + 1] = magNorm * 0.8;  // Moderate green
                    magImgData.data[idx + 2] = magNorm;        // Full blue (cyan tint)
                    magImgData.data[idx + 3] = 255;

                    const phaseVal = kspaceToShow[y][x].phase;
                    const phaseNorm = ((phaseVal + Math.PI) / (2 * Math.PI)) * 255;
                    phaseImgData.data[idx] = phaseNorm * 0.3;
                    phaseImgData.data[idx + 1] = phaseNorm * 0.8;
                    phaseImgData.data[idx + 2] = phaseNorm;
                    phaseImgData.data[idx + 3] = 255;
                } else {
                    // Directly acquired line - show in white/gray
                    magImgData.data[idx] = magNorm;
                    magImgData.data[idx + 1] = magNorm;
                    magImgData.data[idx + 2] = magNorm;
                    magImgData.data[idx + 3] = 255;

                    // Phase
                    const phaseVal = kspaceToShow[y][x].phase;
                    const phaseNorm = ((phaseVal + Math.PI) / (2 * Math.PI)) * 255;
                    phaseImgData.data[idx] = phaseNorm;
                    phaseImgData.data[idx + 1] = phaseNorm;
                    phaseImgData.data[idx + 2] = phaseNorm;
                    phaseImgData.data[idx + 3] = 255;
                }
            } else {
                // Outside acquired region - pure black
                magImgData.data[idx] = 0;
                magImgData.data[idx + 1] = 0;
                magImgData.data[idx + 2] = 0;
                magImgData.data[idx + 3] = 255;

                phaseImgData.data[idx] = 0;
                phaseImgData.data[idx + 1] = 0;
                phaseImgData.data[idx + 2] = 0;
                phaseImgData.data[idx + 3] = 255;
            }
        }
    }

    magCtx.putImageData(magImgData, 0, 0);
    phaseCtx.putImageData(phaseImgData, 0, 0);

    // Visual Marker for Resolution Boundary (k-space coverage)
    // SNR baseline is 256×256; show color-coded boundary
    // (centerX, centerY, halfRes already defined above)
    const SNR_BASELINE = 256;
    const snr = (SNR_BASELINE / matrixSize) * (SNR_BASELINE / matrixSize);

    // Color based on SNR relative to baseline (256×256 = 1.0)
    let strokeColor, fillColor;
    if (snr >= 4) {
        // High SNR (low resolution, e.g., 128×128 or smaller)
        strokeColor = 'rgba(74, 222, 128, 0.8)';
        fillColor = 'rgba(74, 222, 128, 0.9)';
    } else if (snr >= 1) {
        // Baseline or slightly above (e.g., 256×256)
        strokeColor = 'rgba(56, 189, 248, 0.8)';
        fillColor = 'rgba(56, 189, 248, 0.9)';
    } else if (snr >= 0.5) {
        // Below baseline (e.g., 384×384)
        strokeColor = 'rgba(251, 191, 36, 0.8)';
        fillColor = 'rgba(251, 191, 36, 0.9)';
    } else {
        // Low SNR (high resolution, e.g., 512×512)
        strokeColor = 'rgba(248, 113, 113, 0.8)';
        fillColor = 'rgba(248, 113, 113, 0.9)';
    }

    const label = matrixSize + '×' + matrixSize + ' (SNR ' + snr.toFixed(2) + 'x)';

    // Draw rectangle showing acquired k-space region
    magCtx.strokeStyle = strokeColor;
    magCtx.lineWidth = 2;
    if (matrixSize < N) {
        magCtx.setLineDash([5, 5]);
    }
    magCtx.strokeRect(centerX - halfRes, centerY - halfRes, matrixSize, matrixSize);
    magCtx.setLineDash([]);

    // Add label
    magCtx.fillStyle = fillColor;
    magCtx.font = '10px Inter';
    magCtx.shadowColor = 'black';
    magCtx.shadowBlur = 2;
    magCtx.fillText(label, 5, 12);
    magCtx.shadowBlur = 0;

    // Also draw on phase canvas
    phaseCtx.strokeStyle = strokeColor;
    phaseCtx.lineWidth = 2;
    if (matrixSize < N) {
        phaseCtx.setLineDash([5, 5]);
    }
    phaseCtx.strokeRect(centerX - halfRes, centerY - halfRes, matrixSize, matrixSize);
    phaseCtx.setLineDash([]);

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
        // Check if acquisition is complete for current resolution
        const totalLines = matrixSize;
        if (currentLine >= totalLines) {
            resetAcquisition();
        }
        startAnimation();
    });
    document.getElementById('btnStopFill').addEventListener('click', stopAnimation);

    document.getElementById('btnAcquireAll').addEventListener('click', () => {
        stopAnimation();
        acquireAllLines();
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
        // Re-acquire to show noise effect immediately if any data acquired
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('motionRange').addEventListener('input', (e) => {
        motionLevel = parseInt(e.target.value);
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('spikeCheck').addEventListener('change', (e) => {
        hasSpike = e.target.checked;
        if (hasSpike) {
            // Randomize spike location within current resolution's k-space boundary
            const halfRes = matrixSize / 2;
            const centerX = N / 2;
            const centerY = N / 2;
            spikeX = Math.floor(centerX - halfRes + Math.random() * matrixSize);
            spikeY = Math.floor(centerY - halfRes + Math.random() * matrixSize);
        }
        // Always re-acquire when spike changes (to inject or remove spike)
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('skipYRange').addEventListener('input', (e) => {
        skipY = parseInt(e.target.value);
        document.getElementById('skipYVal').innerText = skipY;
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });

    // Matrix Size (Resolution) slider
    document.getElementById('matrixSizeRange').addEventListener('input', (e) => {
        matrixSize = parseInt(e.target.value);
        updateResolutionInfo();
        // Reset spike position if it's now outside the new boundary
        if (hasSpike) {
            const halfRes = matrixSize / 2;
            const centerX = N / 2;
            const centerY = N / 2;
            const minX = centerX - halfRes;
            const maxX = centerX + halfRes;
            const minY = centerY - halfRes;
            const maxY = centerY + halfRes;
            if (spikeX < minX || spikeX >= maxX || spikeY < minY || spikeY >= maxY) {
                // Relocate spike within new boundary
                spikeX = Math.floor(centerX - halfRes + Math.random() * matrixSize);
                spikeY = Math.floor(centerY - halfRes + Math.random() * matrixSize);
            }
        }
        // Clear and re-acquire with new resolution if any data was acquired
        if (!isAnimating && currentLine > 0) {
            // Clear acquired k-space to remove data outside new boundary
            resetAcquisition();
            acquireAllLines();
            renderAll();
        }
    });

    // Simulate SNR checkbox
    document.getElementById('simulateSNRCheck').addEventListener('change', (e) => {
        simulateSNR = e.target.checked;
        if (!isAnimating && currentLine > 0) {
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
        updateStatus(isAnimating ? `Acquiring... Line ${currentLine}/${matrixSize}` : 'Ready');
    });

    // Partial Fourier controls
    document.getElementById('partialFourierSelect').addEventListener('change', (e) => {
        partialFourierFraction = parseFloat(e.target.value);
        // Show/hide reconstruction method selector
        document.getElementById('pfReconControl').style.display =
            partialFourierFraction < 1.0 ? 'block' : 'none';
        updateResolutionInfo();
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });

    document.getElementById('pfReconSelect').addEventListener('change', (e) => {
        partialFourierRecon = e.target.value;
        if (!isAnimating && currentLine > 0) {
            reconstructImage();
            renderAll();
        }
    });

    // Parallel Imaging controls
    document.getElementById('parallelImagingSelect').addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        numCoils = val;
        parallelAcceleration = val; // R = number of coils for simplified demo
        updateResolutionInfo();
        if (!isAnimating && currentLine > 0) {
            acquireAllLines();
            renderAll();
        }
    });
}
