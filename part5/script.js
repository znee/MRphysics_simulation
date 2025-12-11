/**
 * QSM Simulation Script
 * Part 3 of MR Physics Educational Tools
 * Implements 3D FFT and Dipole convolution for QSM Forward/Inverse problems.
 *
 * Key improvement: Full 3D simulation with proper dipole kernel including kz,
 * which produces realistic streaking artifacts even in axial slices.
 */

// --- Math / FFT Helper Classes ---

class ComplexArray {
    constructor(size) {
        this.size = size;
        this.real = new Float32Array(size);
        this.imag = new Float32Array(size);
    }

    fill(val) {
        this.real.fill(val);
        this.imag.fill(0);
    }
}

const FFT = {
    // Radix-2 Cooley-Tukey FFT (1D)
    // In-place, recursive or iterative. Iterative is better for JS recursion limits?
    // Let's use Iterative.
    fft1D: function (re, im, n, inverse = false) {
        // Bit Reversal
        let j = 0;
        for (let i = 0; i < n - 1; i++) {
            if (i < j) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
            let k = n >> 1;
            while (k <= j) {
                j -= k;
                k >>= 1;
            }
            j += k;
        }

        // Butterfly updates
        let direction = inverse ? -1 : 1;
        for (let len = 2; len <= n; len <<= 1) {
            let halfLen = len >> 1;
            let ang = (2 * Math.PI) / len * direction;
            let wLenRe = Math.cos(ang);
            let wLenIm = Math.sin(ang);

            for (let i = 0; i < n; i += len) {
                let wRe = 1;
                let wIm = 0;
                for (let j = 0; j < halfLen; j++) {
                    let uRe = re[i + j];
                    let uIm = im[i + j];
                    let vRe = re[i + j + halfLen] * wRe - im[i + j + halfLen] * wIm;
                    let vIm = re[i + j + halfLen] * wIm + im[i + j + halfLen] * wRe;

                    re[i + j] = uRe + vRe;
                    im[i + j] = uIm + vIm;
                    re[i + j + halfLen] = uRe - vRe;
                    im[i + j + halfLen] = uIm - vIm;

                    let wTemp = wRe; // Rotate w
                    wRe = wRe * wLenRe - wIm * wLenIm;
                    wIm = wTemp * wLenIm + wIm * wLenRe;
                }
            }
        }

        // Scaling for inverse
        if (inverse) {
            for (let i = 0; i < n; i++) {
                re[i] /= n;
                im[i] /= n;
            }
        }
    },

    fft2D: function (complexArray, width, height, inverse = false) {
        // FFT Rows
        for (let y = 0; y < height; y++) {
            const offset = y * width;
            // Extract row
            const rowRe = new Float32Array(width);
            const rowIm = new Float32Array(width);
            for (let i = 0; i < width; i++) { rowRe[i] = complexArray.real[offset + i]; rowIm[i] = complexArray.imag[offset + i]; }

            this.fft1D(rowRe, rowIm, width, inverse);

            for (let i = 0; i < width; i++) { complexArray.real[offset + i] = rowRe[i]; complexArray.imag[offset + i] = rowIm[i]; }
        }

        // FFT Columns
        const cRe = new Float32Array(height);
        const cIm = new Float32Array(height);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                cRe[y] = complexArray.real[y * width + x];
                cIm[y] = complexArray.imag[y * width + x];
            }

            this.fft1D(cRe, cIm, height, inverse);

            for (let y = 0; y < height; y++) {
                complexArray.real[y * width + x] = cRe[y];
                complexArray.imag[y * width + x] = cIm[y];
            }
        }
    },

    // Shift zero frequency to center
    fftShift: function (complexArray, width, height) {
        // Swap quadrants
        const halfW = width / 2;
        const halfH = height / 2;

        for (let y = 0; y < halfH; y++) {
            for (let x = 0; x < halfW; x++) {
                const i1 = y * width + x;
                const i2 = (y + halfH) * width + (x + halfW);
                const i3 = y * width + (x + halfW);
                const i4 = (y + halfH) * width + x;

                // Swap 1 and 2
                [complexArray.real[i1], complexArray.real[i2]] = [complexArray.real[i2], complexArray.real[i1]];
                [complexArray.imag[i1], complexArray.imag[i2]] = [complexArray.imag[i2], complexArray.imag[i1]];

                // Swap 3 and 4
                [complexArray.real[i3], complexArray.real[i4]] = [complexArray.real[i4], complexArray.real[i3]];
                [complexArray.imag[i3], complexArray.imag[i4]] = [complexArray.imag[i4], complexArray.imag[i3]];
            }
        }
    },

    // 3D FFT - separable implementation (1D FFT along each axis)
    fft3D: function (complexArray, nx, ny, nz, inverse = false) {
        // FFT along X (fastest varying index)
        const rowRe = new Float32Array(nx);
        const rowIm = new Float32Array(nx);
        for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
                const offset = z * ny * nx + y * nx;
                for (let x = 0; x < nx; x++) {
                    rowRe[x] = complexArray.real[offset + x];
                    rowIm[x] = complexArray.imag[offset + x];
                }
                this.fft1D(rowRe, rowIm, nx, inverse);
                for (let x = 0; x < nx; x++) {
                    complexArray.real[offset + x] = rowRe[x];
                    complexArray.imag[offset + x] = rowIm[x];
                }
            }
        }

        // FFT along Y
        const colRe = new Float32Array(ny);
        const colIm = new Float32Array(ny);
        for (let z = 0; z < nz; z++) {
            for (let x = 0; x < nx; x++) {
                for (let y = 0; y < ny; y++) {
                    const idx = z * ny * nx + y * nx + x;
                    colRe[y] = complexArray.real[idx];
                    colIm[y] = complexArray.imag[idx];
                }
                this.fft1D(colRe, colIm, ny, inverse);
                for (let y = 0; y < ny; y++) {
                    const idx = z * ny * nx + y * nx + x;
                    complexArray.real[idx] = colRe[y];
                    complexArray.imag[idx] = colIm[y];
                }
            }
        }

        // FFT along Z (slowest varying index)
        const depRe = new Float32Array(nz);
        const depIm = new Float32Array(nz);
        for (let y = 0; y < ny; y++) {
            for (let x = 0; x < nx; x++) {
                for (let z = 0; z < nz; z++) {
                    const idx = z * ny * nx + y * nx + x;
                    depRe[z] = complexArray.real[idx];
                    depIm[z] = complexArray.imag[idx];
                }
                this.fft1D(depRe, depIm, nz, inverse);
                for (let z = 0; z < nz; z++) {
                    const idx = z * ny * nx + y * nx + x;
                    complexArray.real[idx] = depRe[z];
                    complexArray.imag[idx] = depIm[z];
                }
            }
        }
    },

    // 3D FFT shift - swap octants to center DC
    fftShift3D: function (complexArray, nx, ny, nz) {
        const halfX = nx / 2;
        const halfY = ny / 2;
        const halfZ = nz / 2;

        // Swap all 8 octants
        for (let z = 0; z < halfZ; z++) {
            for (let y = 0; y < halfY; y++) {
                for (let x = 0; x < halfX; x++) {
                    // Octant pairs to swap: (0,0,0)↔(1,1,1), (1,0,0)↔(0,1,1), (0,1,0)↔(1,0,1), (0,0,1)↔(1,1,0)
                    const idx000 = z * ny * nx + y * nx + x;
                    const idx111 = (z + halfZ) * ny * nx + (y + halfY) * nx + (x + halfX);
                    const idx100 = z * ny * nx + y * nx + (x + halfX);
                    const idx011 = (z + halfZ) * ny * nx + (y + halfY) * nx + x;
                    const idx010 = z * ny * nx + (y + halfY) * nx + x;
                    const idx101 = (z + halfZ) * ny * nx + y * nx + (x + halfX);
                    const idx001 = (z + halfZ) * ny * nx + y * nx + x;
                    const idx110 = z * ny * nx + (y + halfY) * nx + (x + halfX);

                    // Swap octants
                    [complexArray.real[idx000], complexArray.real[idx111]] = [complexArray.real[idx111], complexArray.real[idx000]];
                    [complexArray.imag[idx000], complexArray.imag[idx111]] = [complexArray.imag[idx111], complexArray.imag[idx000]];

                    [complexArray.real[idx100], complexArray.real[idx011]] = [complexArray.real[idx011], complexArray.real[idx100]];
                    [complexArray.imag[idx100], complexArray.imag[idx011]] = [complexArray.imag[idx011], complexArray.imag[idx100]];

                    [complexArray.real[idx010], complexArray.real[idx101]] = [complexArray.real[idx101], complexArray.real[idx010]];
                    [complexArray.imag[idx010], complexArray.imag[idx101]] = [complexArray.imag[idx101], complexArray.imag[idx010]];

                    [complexArray.real[idx001], complexArray.real[idx110]] = [complexArray.real[idx110], complexArray.real[idx001]];
                    [complexArray.imag[idx001], complexArray.imag[idx110]] = [complexArray.imag[idx110], complexArray.imag[idx001]];
                }
            }
        }
    }
};

// --- QSM Physics ---

const QSM = {
    // Generate 2D Dipole Kernel in K-Space
    //
    // Clinical MRI: B0 always points along +Z (S/I direction)
    // The dipole kernel depends on the scan plane orientation:
    //
    // 3D Dipole: D(k) = 1/3 - kz²/|k|² where kz is along B0
    //
    // For 2D slices:
    // - Axial (XY plane): B0 is perpendicular to slice (kz = 0 in-plane)
    //   → D = 1/3 for all k (no dipole pattern - this is the "magic angle" effect!)
    // - Coronal (XZ plane): B0 has in-plane component along Z
    //   → D = 1/3 - kz²/(kx² + kz²)
    // - Sagittal (YZ plane): B0 has in-plane component along Z
    //   → D = 1/3 - kz²/(ky² + kz²)

    generateDipoleKernel: function (size, scanPlane) {
        const kernel = new ComplexArray(size * size);
        const center = size / 2;

        for (let iy = 0; iy < size; iy++) {
            for (let ix = 0; ix < size; ix++) {
                // k-space coordinates in the 2D slice plane
                const k1 = (ix - center) / size; // First in-plane axis
                const k2 = (iy - center) / size; // Second in-plane axis

                const kMag2 = k1 * k1 + k2 * k2;
                const idx = iy * size + ix;

                if (kMag2 === 0) {
                    kernel.real[idx] = 0; // Singularity at DC
                } else {
                    let D;
                    switch (scanPlane) {
                        case 'axial':
                            // XY plane: B0 (along Z) is perpendicular to slice
                            // kz = 0 for all in-plane frequencies
                            // D = 1/3 - 0²/k² = 1/3 (constant - no dipole pattern!)
                            D = 1.0 / 3.0;
                            break;
                        case 'coronal':
                            // XZ plane: k1 = kx, k2 = kz (B0 direction)
                            // D = 1/3 - kz²/(kx² + kz²)
                            D = (1.0 / 3.0) - (k2 * k2) / kMag2;
                            break;
                        case 'sagittal':
                            // YZ plane: k1 = ky, k2 = kz (B0 direction)
                            // D = 1/3 - kz²/(ky² + kz²)
                            D = (1.0 / 3.0) - (k2 * k2) / kMag2;
                            break;
                        default:
                            D = 1.0 / 3.0;
                    }
                    kernel.real[idx] = D;
                }
            }
        }

        return kernel;
    },

    multiplyKSpace: function (kData, kKernel) {
        // Result = kData * kKernel (Element-wise complex multiply)
        // Since Kernel is Real-only (symmetric dipole), simplifies things.
        const size = kData.size;
        const result = new ComplexArray(size);
        for (let i = 0; i < size; i++) {
            const val = kKernel.real[i]; // Kernel is real
            result.real[i] = kData.real[i] * val;
            result.imag[i] = kData.imag[i] * val;
        }
        return result;
    },

    divideKSpace: function (kData, kKernel, lambda = 0, method = 'tikhonov') {
        const size = kData.size;
        const result = new ComplexArray(size);

        for (let i = 0; i < size; i++) {
            let d = kKernel.real[i];
            let invD = 0;

            if (method === 'tkd') {
                // Truncated K-Space Division
                // If |D| < threshold, replace D.
                // Threshold is lambda.
                const threshold = lambda || 0.05; // Default if lambda is 0? Or allow 0.
                if (Math.abs(d) < threshold) {
                    // Sign of d * threshold
                    const sign = d >= 0 ? 1 : -1;
                    d = sign * threshold;
                }
                invD = 1.0 / d; // Simple division after thresholding

            } else {
                // Tikhonov Regularization (Default)
                // inv = d / (d^2 + lambda)
                // If lambda is 0, behaves like 1/d (with slight singularity protection needed?)
                if (lambda === 0) {
                    if (Math.abs(d) > 1e-6) invD = 1.0 / d;
                    else invD = 0;
                } else {
                    invD = d / (d * d + lambda);
                }
            }

            result.real[i] = kData.real[i] * invD;
            result.imag[i] = kData.imag[i] * invD;
        }
        return result;
    },

    // Generate 3D Dipole Kernel in K-Space with rotatable B0 direction
    // D(k) = 1/3 - kb0²/|k|² where kb0 is the k-component along B0 direction
    // b0AngleDeg: tilt angle from Z-axis in degrees (0 = standard supine, 90 = transverse)
    // B0 rotates in the YZ plane (tilts toward anterior when angle > 0)
    generateDipoleKernel3D: function (nx, ny, nz, b0AngleDeg = 0) {
        const totalSize = nx * ny * nz;
        const kernel = new ComplexArray(totalSize);
        const centerX = nx / 2;
        const centerY = ny / 2;
        const centerZ = nz / 2;

        // B0 direction unit vector (rotated in YZ plane)
        const b0AngleRad = b0AngleDeg * Math.PI / 180;
        const b0y = Math.sin(b0AngleRad);  // Y component (anterior)
        const b0z = Math.cos(b0AngleRad);  // Z component (superior)
        // B0 direction: (0, sin(θ), cos(θ))

        for (let iz = 0; iz < nz; iz++) {
            for (let iy = 0; iy < ny; iy++) {
                for (let ix = 0; ix < nx; ix++) {
                    const kx = (ix - centerX) / nx;
                    const ky = (iy - centerY) / ny;
                    const kz = (iz - centerZ) / nz;

                    const kMag2 = kx * kx + ky * ky + kz * kz;
                    const idx = iz * ny * nx + iy * nx + ix;

                    if (kMag2 === 0) {
                        kernel.real[idx] = 0; // DC singularity
                    } else {
                        // k component along B0 direction: k·b0 = kx*0 + ky*b0y + kz*b0z
                        const kB0 = ky * b0y + kz * b0z;
                        // Full 3D dipole kernel: D = 1/3 - kB0²/|k|²
                        const D = (1.0 / 3.0) - (kB0 * kB0) / kMag2;
                        kernel.real[idx] = D;
                    }
                }
            }
        }

        return kernel;
    },

    // 3D k-space multiplication
    multiplyKSpace3D: function (kData, kKernel) {
        const size = kData.size;
        const result = new ComplexArray(size);
        for (let i = 0; i < size; i++) {
            const val = kKernel.real[i];
            result.real[i] = kData.real[i] * val;
            result.imag[i] = kData.imag[i] * val;
        }
        return result;
    },

    // 3D k-space division with regularization
    divideKSpace3D: function (kData, kKernel, lambda = 0.01, method = 'tikhonov') {
        const size = kData.size;
        const result = new ComplexArray(size);

        for (let i = 0; i < size; i++) {
            let d = kKernel.real[i];
            let invD = 0;

            if (method === 'tkd') {
                const threshold = lambda || 0.05;
                if (Math.abs(d) < threshold) {
                    const sign = d >= 0 ? 1 : -1;
                    d = sign * threshold;
                }
                invD = 1.0 / d;
            } else {
                // Tikhonov
                if (lambda === 0) {
                    if (Math.abs(d) > 1e-6) invD = 1.0 / d;
                    else invD = 0;
                } else {
                    invD = d / (d * d + lambda);
                }
            }

            result.real[i] = kData.real[i] * invD;
            result.imag[i] = kData.imag[i] * invD;
        }
        return result;
    },

    // Apply cone-of-silence artifact simulation
    // In real QSM, the dipole kernel D(k) = 0 when cos²θ = 1/3 (θ ≈ 54.7°)
    // This creates the "magic angle" where inversion is ill-conditioned
    // We simulate this by adding streaking noise near these k-space regions
    applyConeOfSilenceArtifacts: function (kData, nx, ny, nz, artifactStrength = 0.1) {
        const result = new ComplexArray(kData.size);
        result.real.set(kData.real);
        result.imag.set(kData.imag);

        const centerX = nx / 2;
        const centerY = ny / 2;
        const centerZ = nz / 2;

        // The magic angle where D(k) = 0: cos²θ = 1/3, θ ≈ 54.7°
        // This corresponds to kz²/|k|² = 1/3
        const targetAngle = Math.acos(Math.sqrt(1 / 3)); // ~54.7°

        for (let iz = 0; iz < nz; iz++) {
            for (let iy = 0; iy < ny; iy++) {
                for (let ix = 0; ix < nx; ix++) {
                    const kx = (ix - centerX) / nx;
                    const ky = (iy - centerY) / ny;
                    const kz = (iz - centerZ) / nz;

                    const kMag2 = kx * kx + ky * ky + kz * kz;
                    if (kMag2 === 0) continue;

                    const kMag = Math.sqrt(kMag2);
                    const cosTheta = Math.abs(kz) / kMag;
                    const theta = Math.acos(cosTheta);

                    // Distance from magic angle (in radians)
                    const distFromMagic = Math.abs(theta - targetAngle);

                    // Apply artifact in narrow band around magic angle
                    // Using Gaussian-like weighting
                    const bandwidth = 0.15; // radians
                    const weight = Math.exp(-distFromMagic * distFromMagic / (2 * bandwidth * bandwidth));

                    // Add noise proportional to proximity to magic angle
                    if (weight > 0.1) {
                        const noise = (Math.random() - 0.5) * artifactStrength * weight;
                        const idx = iz * ny * nx + iy * nx + ix;
                        result.real[idx] += noise * Math.abs(result.real[idx]);
                        result.imag[idx] += noise * Math.abs(result.imag[idx]);
                    }
                }
            }
        }

        return result;
    },
};

// --- Main Script ---

// Configuration
// Clinical MRI Coordinate System:
// X = Left-Right (L/R)
// Y = Anterior-Posterior (A/P)
// Z = Superior-Inferior (S/I) - B0 direction
const CONFIG = {
    gridSize: 128, // XY simulation grid size (reduced from 256 for 3D performance)
    gridSizeZ: 64, // Z simulation grid size (fixed for performance)
    canvasSize: 256, // Display size for 2D maps (upscaled from gridSize)
    scanPlane: 'axial', // 'axial' (XY), 'coronal' (XZ), 'sagittal' (YZ)
    simMode: 'forward', // 'forward' | 'inverse'
    lambda: 0.01, // Regularization parameter (match slider default)
    reconMethod: 'tikhonov', // 'tikhonov' | 'tkd'
    use3D: true, // Use full 3D simulation for realistic dipole artifacts
    b0Angle: 0, // B0 tilt angle from Z-axis in degrees (0 = standard supine)
    objects: [] // List of susceptibility sources {x, y, z, r, val}
};

// State - 2D slice maps (extracted from 3D volumes)
let chiMap = new Float32Array(CONFIG.gridSize * CONFIG.gridSize); // Current slice susceptibility
let fieldMap = new Float32Array(CONFIG.gridSize * CONFIG.gridSize); // Current slice phase
let reconMap = new Float32Array(CONFIG.gridSize * CONFIG.gridSize); // Current slice reconstruction
let cleanFieldMap = new Float32Array(CONFIG.gridSize * CONFIG.gridSize); // Field without noise
let cachedNoise = new Float32Array(CONFIG.gridSize * CONFIG.gridSize); // Cached noise for current slice
let needsForwardRecalc = true; // Flag to recalculate forward model (chi → field)
let needsInverseRecalc = true; // Flag to recalculate inverse model only (field → recon)

// 3D Volume state
let chiVolume = null; // 3D susceptibility volume
let fieldVolume = null; // 3D phase volume (after dipole convolution)
let reconVolume = null; // 3D reconstruction volume
let cachedNoiseVolume = null; // 3D noise volume
let kSpaceObj = null; // ComplexArray (Visualization)
let sliceTextureMode = 'chi'; // Which map to show on 3D slice: 'chi', 'phase', 'recon'

// DOM Elements
const scanPlaneSelect = document.getElementById('scan-plane');
const sliceAxisLabel = document.getElementById('slice-axis-label');
const lambdaSlider = document.getElementById('reg-lambda');
const lambdaLabel = document.getElementById('reg-lambda-val');
const reconControls = document.getElementById('recon-controls');
const reconMethodSelect = document.getElementById('recon-method');
const b0AngleSlider = document.getElementById('b0-angle');
const b0AngleLabel = document.getElementById('b0-angle-val');

// Object Controls
const objShapeSelect = document.getElementById('obj-shape');
const objSizeSlider = document.getElementById('obj-size');
const objSizeVal = document.getElementById('obj-size-val');
const objChiSlider = document.getElementById('obj-chi');
const objChiVal = document.getElementById('obj-chi-val');
const addObjectBtn = document.getElementById('add-object-btn');
const sliceSlider = document.getElementById('slice-slider');
const sliceVal = document.getElementById('slice-val');

// Three.js Globals
let scene, camera, renderer;
let objectMeshes = [];
let slicePlaneMesh = null; // Visual indicator of slice
let slicePlaneEdges = null; // Edge outline for slice plane
let sliceArrowRight = null; // Arrow pointing to Phase panel
let sliceArrowLeft = null; // Arrow pointing to Chi panel
let b0Arrow = null; // B0 Direction Indicator

// Initialization
// --- Simulation State ---
let ctxChi, ctxField, ctxRecon, ctx3DTexture;
let canvas3DTexture; // Hidden canvas for 3D texture (no rotation)

// --- Initialization ---
function init() {
    // Create hidden canvas for 3D texture (unrotated)
    canvas3DTexture = document.createElement('canvas');
    canvas3DTexture.width = CONFIG.gridSize;
    canvas3DTexture.height = CONFIG.gridSize;
    ctx3DTexture = canvas3DTexture.getContext('2d');

    init3D();

    // Get 2D Contexts
    const c1 = document.getElementById('simCanvasChi');
    const c2 = document.getElementById('simCanvasField');
    const c3 = document.getElementById('simCanvasRecon');

    // Ensure contexts are valid
    if (c1) ctxChi = c1.getContext('2d');
    if (c2) ctxField = c2.getContext('2d');
    if (c3) ctxRecon = c3.getContext('2d');

    setupEventListeners();
    update2DAxisLabels();  // Initialize axis labels based on default scan plane
    resetSimulation();

    // Add default object (smaller size for 128 grid)
    addObject('sphere', 12, 1.0);

    // Animation Loop
    animate();
}

function init3D() {
    const container = document.getElementById('canvas-3d');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    // Camera - Z is up (clinical MRI convention: Z = Superior-Inferior)
    // Position camera closer for better view
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(-120, -200, 180);  // Higher angle with Z arrow pointing upward
    camera.lookAt(0, 0, 0);
    camera.up.set(0, 0, 1);  // Z is up (Superior direction)

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 100);
    scene.add(dirLight);

    // Bounding Box - physical space is always 128x128x128 (isotropic FOV)
    // Resolution (voxel count) varies, but FOV is constant
    const gridSize = CONFIG.gridSize;
    const boxGeo = new THREE.BoxGeometry(gridSize, gridSize, gridSize);
    const boxMat = new THREE.MeshBasicMaterial({ color: 0x444444, wireframe: true, transparent: true, opacity: 0.3 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.name = 'boundingBox';
    scene.add(box);

    // Grid Helper - lies in XY plane (ground plane when Z is up)
    // GridHelper is in XZ plane by default, rotate to XY plane
    const gridHelper = new THREE.GridHelper(gridSize, 8, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;  // Rotate to lie in XY plane
    gridHelper.position.z = -gridSize / 2; // Put it at the bottom of the volume (Z is up)
    gridHelper.name = 'gridHelper';
    scene.add(gridHelper);

    // Slice Plane Visual - Project the 2D Chi Map onto the 3D Slice
    // With Z-up convention:
    // - Axial (XY plane): horizontal, slices along Z (S/I)
    // - Coronal (XZ plane): vertical front-back, slices along Y (A/P)
    // - Sagittal (YZ plane): vertical left-right, slices along X (L/R)
    const chiTexture = new THREE.CanvasTexture(canvas3DTexture);
    chiTexture.minFilter = THREE.LinearFilter;

    // For axial: XY plane (gridSize x gridSize)
    // For coronal/sagittal: X/Y x Z (gridSize x gridSizeZ) - handled in updateSlicePlaneOrientation
    const planeGeo = new THREE.PlaneGeometry(gridSize, gridSize);
    const planeMat = new THREE.MeshBasicMaterial({
        map: chiTexture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    slicePlaneMesh = new THREE.Mesh(planeGeo, planeMat);
    slicePlaneMesh.name = 'slicePlane';
    // PlaneGeometry is created in XY plane by default - perfect for axial view
    // We'll apply orientation-specific rotations in updateSlicePlaneOrientation()
    scene.add(slicePlaneMesh);

    // Thick cyan border around slice plane (matches 2D panel borders)
    // Border created in XY plane (same as PlaneGeometry default)
    const half = gridSize / 2;
    const borderPoints = [
        new THREE.Vector3(-half, -half, 0),
        new THREE.Vector3(half, -half, 0),
        new THREE.Vector3(half, half, 0),
        new THREE.Vector3(-half, half, 0),
        new THREE.Vector3(-half, -half, 0)
    ];
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
    slicePlaneEdges = new THREE.Line(borderGeo, borderMat);
    slicePlaneEdges.name = 'slicePlaneEdges';
    scene.add(slicePlaneEdges);

    // Add axis labels to slice plane (X and Z, where Z maps to canvas Y)
    // Create text sprite helper
    function createTextSprite(text, color = '#00ffff') {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(30, 30, 1);
        return sprite;
    }

    // X axis label (left side of slice plane, negative X direction)
    const xLabel = createTextSprite('X');
    xLabel.position.set(-gridSize / 2 - 20, 0, 0);
    scene.add(xLabel);

    // Z axis label (back of slice plane, negative Z direction)
    const zLabel = createTextSprite('Y');  // Label as Y since it maps to canvas Y
    zLabel.position.set(0, 0, -gridSize / 2 - 20);
    scene.add(zLabel);

    // Store references for updating position with slice
    window.sliceAxisLabels = { x: xLabel, z: zLabel };

    // B0 Arrow Helper
    const dir = new THREE.Vector3(0, 1, 0);
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 140;
    const hex = 0xffff00;
    b0Arrow = new THREE.ArrowHelper(dir, origin, length, hex, 15, 10);
    scene.add(b0Arrow);

    updateB0Visual();
    updateSliceVisual();

    // Orbit Controls - Left click to rotate, Right click to pan
    let isDragging = false;
    let isPanning = false;
    let previousMousePosition = { x: 0, y: 0 };

    container.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable right-click menu

    container.addEventListener('mousedown', (e) => {
        if (e.button === 0) isDragging = true;  // Left click
        if (e.button === 2) isPanning = true;   // Right click
        previousMousePosition = { x: e.offsetX, y: e.offsetY };
    });

    container.addEventListener('mousemove', (e) => {
        const deltaMove = { x: e.offsetX - previousMousePosition.x, y: e.offsetY - previousMousePosition.y };

        if (isDragging) {
            // Rotate scene (Z-up: horizontal drag rotates around Z, vertical around X)
            scene.rotation.z -= deltaMove.x * 0.01;
            scene.rotation.x += deltaMove.y * 0.01;
        }
        if (isPanning) {
            // Pan camera (Z-up: horizontal moves X, vertical moves Z)
            camera.position.x -= deltaMove.x * 0.5;
            camera.position.z += deltaMove.y * 0.5;
        }
        previousMousePosition = { x: e.offsetX, y: e.offsetY };
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        isPanning = false;
    });
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });

    // Add Axes Helper for Orientation Truth
    // Red=X, Green=Y, Blue=Z
    const axesHelper = new THREE.AxesHelper(100);
    scene.add(axesHelper);

    // Initialize slice plane orientation based on default scan plane
    updateSlicePlaneOrientation();
}

function toRadians(angle) { return angle * (Math.PI / 180); }

function updateSliceVisual() {
    if (!slicePlaneMesh) return;
    const slicePos = parseInt(sliceSlider.value);
    const gridSize = CONFIG.gridSize;

    // Reset position
    slicePlaneMesh.position.set(0, 0, 0);
    if (slicePlaneEdges) slicePlaneEdges.position.set(0, 0, 0);

    // Physical FOV is always gridSize x gridSize x gridSize (128x128x128 mm)
    // Slider range is -128 to 128, maps to physical position -64 to +64 mm
    // (assuming gridSize=128, so half = 64)
    const physicalPos = slicePos * (gridSize / 256); // Scale slider to physical coordinates

    // Move along the slice axis based on scan plane
    switch (CONFIG.scanPlane) {
        case 'axial':
            // Slice moves along Z axis
            slicePlaneMesh.position.z = physicalPos;
            if (slicePlaneEdges) slicePlaneEdges.position.z = physicalPos;
            break;
        case 'coronal':
            // Slice moves along Y axis
            slicePlaneMesh.position.y = physicalPos;
            if (slicePlaneEdges) slicePlaneEdges.position.y = physicalPos;
            break;
        case 'sagittal':
            // Slice moves along X axis
            slicePlaneMesh.position.x = physicalPos;
            if (slicePlaneEdges) slicePlaneEdges.position.x = physicalPos;
            break;
    }

    // Update axis labels position (simplified - just hide for now as they need more work)
    if (window.sliceAxisLabels) {
        window.sliceAxisLabels.x.visible = false;
        window.sliceAxisLabels.z.visible = false;
    }

    sliceVal.innerText = slicePos;
}

function updateB0Visual() {
    if (!b0Arrow) return;
    // B0 direction rotates in YZ plane based on b0Angle
    // 0° = along +Z (Superior), 90° = along +Y (Anterior)
    const angleRad = CONFIG.b0Angle * Math.PI / 180;
    const dir = new THREE.Vector3(0, Math.sin(angleRad), Math.cos(angleRad));
    b0Arrow.setDirection(dir.normalize());
}

// Update slice axis label based on scan plane
function updateSliceAxisLabel() {
    if (!sliceAxisLabel) return;
    switch (CONFIG.scanPlane) {
        case 'axial':
            sliceAxisLabel.innerText = '(Z - S/I)';
            break;
        case 'coronal':
            sliceAxisLabel.innerText = '(Y - A/P)';
            break;
        case 'sagittal':
            sliceAxisLabel.innerText = '(X - L/R)';
            break;
    }
}

// Update 2D panel axis labels based on scan plane
function update2DAxisLabels() {
    const hLabels = document.querySelectorAll('.slice-axis-h');
    const vLabels = document.querySelectorAll('.slice-axis-v');

    let hAxis, vAxis;
    switch (CONFIG.scanPlane) {
        case 'axial':   // XY plane
            hAxis = 'X'; vAxis = 'Y';
            break;
        case 'coronal': // XZ plane
            hAxis = 'X'; vAxis = 'Z';
            break;
        case 'sagittal': // YZ plane
            hAxis = 'Y'; vAxis = 'Z';
            break;
    }

    hLabels.forEach(label => label.innerText = hAxis);
    vLabels.forEach(label => label.innerText = vAxis);
}

// Update slice plane orientation in 3D based on scan plane
// Z-up convention: Z = Superior/Inferior (B0), Y = Anterior/Posterior, X = Left/Right
// Physical FOV is always 128x128x128 mm (isotropic), only resolution changes
function updateSlicePlaneOrientation() {
    if (!slicePlaneMesh) return;

    const gridSize = CONFIG.gridSize; // Physical FOV is always gridSize x gridSize x gridSize

    // Reset rotation, scale, and rotation order for both mesh and edges
    slicePlaneMesh.rotation.order = 'XYZ';
    slicePlaneMesh.rotation.set(0, 0, 0);
    slicePlaneMesh.scale.set(1, 1, 1);
    if (slicePlaneEdges) {
        slicePlaneEdges.rotation.order = 'XYZ';
        slicePlaneEdges.rotation.set(0, 0, 0);
        slicePlaneEdges.scale.set(1, 1, 1);
    }

    // All slice planes are gridSize x gridSize (physical space is isotropic)
    const oldGeo = slicePlaneMesh.geometry;
    const newGeo = new THREE.PlaneGeometry(gridSize, gridSize);
    const half = gridSize / 2;

    // Border points (same for all orientations before rotation)
    const borderPoints = [
        new THREE.Vector3(-half, -half, 0),
        new THREE.Vector3(half, -half, 0),
        new THREE.Vector3(half, half, 0),
        new THREE.Vector3(-half, half, 0),
        new THREE.Vector3(-half, -half, 0)
    ];

    switch (CONFIG.scanPlane) {
        case 'axial':
            // XY plane (horizontal when Z is up), slicing through Z
            // Default PlaneGeometry is already in XY, no rotation needed
            break;
        case 'coronal':
            // XZ plane (vertical, slicing through Y)
            // Rotate plane from XY to XZ: rotate +90° around X (plane faces -Y)
            slicePlaneMesh.rotation.x = Math.PI / 2;
            if (slicePlaneEdges) slicePlaneEdges.rotation.x = Math.PI / 2;
            break;
        case 'sagittal':
            // YZ plane (vertical, slicing through X)
            // We need: plane normal along +X, texture U (horizontal) -> world +Y, texture V (vertical) -> world +Z
            // Use quaternion for reliable rotation: (0.5, 0.5, 0.5, 0.5) normalized
            // This rotates the XY plane so that: local X -> world Y, local Y -> world Z, normal -> world X
            const q = new THREE.Quaternion(0.5, 0.5, 0.5, 0.5);
            slicePlaneMesh.quaternion.copy(q);
            if (slicePlaneEdges) {
                slicePlaneEdges.quaternion.copy(q);
            }
            break;
    }

    // Update plane geometry
    slicePlaneMesh.geometry = newGeo;
    oldGeo.dispose();

    // Update border geometry
    if (slicePlaneEdges) {
        const oldBorderGeo = slicePlaneEdges.geometry;
        const newBorderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
        slicePlaneEdges.geometry = newBorderGeo;
        oldBorderGeo.dispose();
    }

    // Update slice position
    updateSliceVisual();
}

// Update 3D scene when Z resolution changes
// Note: Bounding box stays the same (physical FOV is always 128x128x128)
// Only the voxel resolution changes, which affects the simulation
function update3DBoundingBox() {
    // Physical FOV is constant, so no 3D scene updates needed for resolution change
    // The bounding box and grid helper stay at gridSize dimensions
}

function setupEventListeners() {
    // Scan Plane selector - changes slice orientation and dipole physics
    scanPlaneSelect.addEventListener('change', (e) => {
        CONFIG.scanPlane = e.target.value;
        updateSlicePlaneOrientation();
        updateSliceAxisLabel();
        update2DAxisLabels();
        updateChiMapFromObjects();
        needsForwardRecalc = true;
        runSimulation();
    });

    // Lambda - only needs inverse recalc (reuse existing noisy field)
    // Use 'change' event (on release) for computation, 'input' for label update
    lambdaSlider.addEventListener('input', (e) => {
        lambdaLabel.innerText = parseFloat(e.target.value).toFixed(3);
    });
    lambdaSlider.addEventListener('change', (e) => {
        CONFIG.lambda = parseFloat(e.target.value);
        lambdaLabel.innerText = CONFIG.lambda.toFixed(3);
        // Only inverse recalc needed - keeps same noise for fair comparison
        needsInverseRecalc = true;
        runSimulation();
    });

    // Recon Method - only needs inverse recalc (reuse existing noisy field)
    reconMethodSelect.addEventListener('change', (e) => {
        CONFIG.reconMethod = e.target.value;
        // Only inverse recalc needed - keeps same noise for fair comparison
        needsInverseRecalc = true;
        runSimulation();
    });

    // B0 Angle - needs full 3D recalc (dipole kernel changes)
    if (b0AngleSlider) {
        // Update label while dragging
        b0AngleSlider.addEventListener('input', (e) => {
            const angle = parseInt(e.target.value);
            const absAngle = Math.abs(angle);
            let label = `${angle}°`;
            if (angle === 0) label += " (Standard: B₀ ∥ Z)";
            else if (absAngle >= 53 && absAngle <= 57) label += " (Magic angle!)";
            else if (absAngle === 90) label += " (B₀ ⊥ Z)";
            b0AngleLabel.innerText = label;
            // Update B0 arrow in real-time
            CONFIG.b0Angle = angle;
            updateB0Visual();
        });
        // Run simulation only on release (heavy computation)
        b0AngleSlider.addEventListener('change', (e) => {
            const angle = parseInt(e.target.value);
            CONFIG.b0Angle = angle;
            // Forward model needs recalculation with new dipole kernel
            needsForwardRecalc = true;
            runSimulation();
        });
    }

    // Object Controls
    objSizeSlider.addEventListener('input', (e) => {
        objSizeVal.innerText = `${e.target.value} px`;
    });

    objChiSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        let text = `${val.toFixed(1)} ppm`;
        if (val > 0) text += " (Para)";
        else if (val < 0) text += " (Dia)";
        else text += " (0)";
        objChiVal.innerText = text;
    });

    addObjectBtn.addEventListener('click', () => {
        const shape = objShapeSelect.value;
        const size = parseInt(objSizeSlider.value);
        const chi = parseFloat(objChiSlider.value);
        addObject(shape, size, chi);
    });

    document.getElementById('add-random-btn').addEventListener('click', () => {
        const shapes = ['sphere', 'cube', 'cylinder', 'ellipsoid'];
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const size = Math.floor(Math.random() * 20) + 8; // 8-28 px
        const chi = (Math.random() * 2 - 1).toFixed(1); // -1.0 to 1.0
        addObject(shape, size, parseFloat(chi));
    });

    document.getElementById('clear-canvas').addEventListener('click', resetSimulation);

    // Slice Slider - physics change, needs forward recalc
    sliceSlider.addEventListener('input', () => {
        updateSliceVisual();
        if (CONFIG.use3D) {
            // In 3D mode, just extract new slice from precomputed volumes
            // No need to recalculate - volumes are already computed
            runSimulation(false);
        } else {
            // In 2D mode, each slice needs fresh calculation
            updateChiMapFromObjects();
            needsForwardRecalc = true;
            runSimulation();
        }
    });

    // Slice texture selector - choose which map to show on 3D plane
    document.getElementById('slice-texture-select').addEventListener('change', (e) => {
        sliceTextureMode = e.target.value;
        update3DTexture();
    });
}

function updateUIForMode() {
    // Deprecated
}

function resetSimulation() {
    CONFIG.objects = [];
    chiMap.fill(0);
    fieldMap.fill(0);
    reconMap.fill(0);
    cleanFieldMap.fill(0);
    cachedNoise.fill(0);

    // Clear 3D Objects
    objectMeshes.forEach(mesh => scene.remove(mesh));
    objectMeshes = [];

    updateChiMapFromObjects();
    needsForwardRecalc = true;
    runSimulation();
}

function addObject(shape, size, chi) {
    if (chi === 0) return;

    // Physical FOV is always gridSize x gridSize x gridSize (128x128x128 mm)
    // Objects are placed in physical coordinates, not voxel coordinates
    const padding = size + 5;
    const gridSize = CONFIG.gridSize;
    const range = Math.max(1, (gridSize / 2) - padding);

    // All coordinates use the same physical range (isotropic FOV)
    const x = (Math.random() * 2 * range) - range;
    const y = (Math.random() * 2 * range) - range;
    const z = (Math.random() * 2 * range) - range;

    // For ellipsoid, store aspect ratios (no rotation - just scaling)
    const aspectX = shape === 'ellipsoid' ? 0.5 + Math.random() * 1.0 : 1;
    const aspectY = shape === 'ellipsoid' ? 0.5 + Math.random() * 1.0 : 1;
    const aspectZ = shape === 'ellipsoid' ? 0.5 + Math.random() * 1.0 : 1;

    // For cylinder, compute axis vector from spherical coordinates
    // theta: polar angle from +Y axis (0 = pointing up, PI = pointing down)
    // phi: azimuthal angle in XZ plane from +X axis
    const cylTheta = Math.random() * Math.PI; // 0 to PI
    const cylPhi = Math.random() * 2 * Math.PI; // 0 to 2*PI
    // Physical FOV is isotropic, so use gridSize for cylinder length
    const cylLength = gridSize * 0.6;

    // Cylinder axis vector (consistent definition for both 3D and slicing)
    const cylAxisX = Math.sin(cylTheta) * Math.cos(cylPhi);
    const cylAxisY = Math.cos(cylTheta);
    const cylAxisZ = Math.sin(cylTheta) * Math.sin(cylPhi);

    // For cube, use Euler angles (simpler and more predictable)
    const cubeRotX = Math.random() * Math.PI;
    const cubeRotY = Math.random() * Math.PI;
    const cubeRotZ = Math.random() * Math.PI;

    const obj = {
        x, y, z, size, val: chi, shape,
        aspectX, aspectY, aspectZ,
        cylAxisX, cylAxisY, cylAxisZ, cylLength,
        cubeRotX, cubeRotY, cubeRotZ
    };
    CONFIG.objects.push(obj);

    // Add to 3D Scene
    let mesh;
    let color = chi > 0 ? 0xff0000 : 0x0000ff;

    const mat = new THREE.MeshPhongMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
        shininess: 80
    });

    if (shape === 'cube') {
        const s = size * 2;
        const geo = new THREE.BoxGeometry(s, s, s);
        mesh = new THREE.Mesh(geo, mat);
        // Apply Euler rotation (XYZ order - Three.js default)
        mesh.rotation.set(cubeRotX, cubeRotY, cubeRotZ, 'XYZ');
    } else if (shape === 'cylinder') {
        // Cylinder with random orientation using quaternion
        const geo = new THREE.CylinderGeometry(size, size, cylLength, 32);
        mesh = new THREE.Mesh(geo, mat);
        // Rotate from default +Y axis to target axis using quaternion
        const defaultAxis = new THREE.Vector3(0, 1, 0);
        const targetAxis = new THREE.Vector3(cylAxisX, cylAxisY, cylAxisZ);
        mesh.quaternion.setFromUnitVectors(defaultAxis, targetAxis);
    } else if (shape === 'ellipsoid') {
        const geo = new THREE.SphereGeometry(size, 32, 32);
        mesh = new THREE.Mesh(geo, mat);
        // Just scale, no rotation (simpler and matches slicing)
        mesh.scale.set(aspectX, aspectY, aspectZ);
    } else {
        // Default: sphere (no rotation needed)
        const geo = new THREE.SphereGeometry(size, 32, 32);
        mesh = new THREE.Mesh(geo, mat);
    }

    // Add Edges for better visibility
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }));
    mesh.add(line);

    mesh.position.set(x, y, z);
    scene.add(mesh);
    objectMeshes.push(mesh);

    // Update Maps - physics change, needs forward recalc
    updateChiMapFromObjects();
    needsForwardRecalc = true;
    runSimulation();
}

// Helper: Build inverse rotation matrix for Euler XYZ and apply to point
// Uses Three.js Matrix4 to ensure correctness
function buildInverseRotationMatrix(rotX, rotY, rotZ) {
    // Create Euler with XYZ order and convert to matrix
    const euler = new THREE.Euler(rotX, rotY, rotZ, 'XYZ');
    const matrix = new THREE.Matrix4().makeRotationFromEuler(euler);
    // Invert the matrix to get the inverse rotation
    matrix.invert();
    return matrix;
}

function applyInverseEulerXYZ(px, py, pz, rotX, rotY, rotZ) {
    // Use Three.js to compute the inverse rotation
    const euler = new THREE.Euler(rotX, rotY, rotZ, 'XYZ');
    const matrix = new THREE.Matrix4().makeRotationFromEuler(euler);
    matrix.invert();

    // Apply the inverse matrix to the point
    const vec = new THREE.Vector3(px, py, pz);
    vec.applyMatrix4(matrix);

    return { x: vec.x, y: vec.y, z: vec.z };
}

function updateChiMapFromObjects() {
    // Scan plane determines which axis we slice through and which 2D plane we see
    // Axial (XY): slice along Z, display X (horizontal) vs Y (vertical)
    // Coronal (XZ): slice along Y, display X (horizontal) vs Z (vertical)
    // Sagittal (YZ): slice along X, display Y (horizontal) vs Z (vertical)
    const slicePos = parseInt(sliceSlider.value);
    chiMap.fill(0);

    CONFIG.objects.forEach(obj => {
        // Get object center coordinates based on scan plane
        let c1, c2, sliceAxis;  // c1 = horizontal canvas axis, c2 = vertical canvas axis
        switch (CONFIG.scanPlane) {
            case 'axial':  // XY plane, slice along Z
                c1 = Math.floor(obj.x + 128);  // X -> horizontal
                c2 = Math.floor(obj.y + 128);  // Y -> vertical
                sliceAxis = obj.z;
                break;
            case 'coronal':  // XZ plane, slice along Y
                c1 = Math.floor(obj.x + 128);  // X -> horizontal
                c2 = Math.floor(obj.z + 128);  // Z -> vertical
                sliceAxis = obj.y;
                break;
            case 'sagittal':  // YZ plane, slice along X
                c1 = Math.floor(obj.y + 128);  // Y -> horizontal
                c2 = Math.floor(obj.z + 128);  // Z -> vertical
                sliceAxis = obj.x;
                break;
        }

        if (obj.shape === 'cylinder') {
            const ax = obj.cylAxisX;
            const ay = obj.cylAxisY;
            const az = obj.cylAxisZ;
            const halfLen = (obj.cylLength || 150) / 2;
            const radius = obj.size;

            for (let d2 = -80; d2 <= 80; d2++) {
                for (let d1 = -80; d1 <= 80; d1++) {
                    const p1 = c1 + d1;
                    const p2 = c2 + d2;
                    if (p1 < 0 || p1 >= 256 || p2 < 0 || p2 >= 256) continue;

                    // Map 2D delta + slice position to 3D point relative to object center
                    let pointX, pointY, pointZ;
                    switch (CONFIG.scanPlane) {
                        case 'axial':
                            pointX = d1; pointY = d2; pointZ = slicePos - obj.z;
                            break;
                        case 'coronal':
                            pointX = d1; pointY = slicePos - obj.y; pointZ = d2;
                            break;
                        case 'sagittal':
                            pointX = slicePos - obj.x; pointY = d1; pointZ = d2;
                            break;
                    }

                    const dotProduct = pointX * ax + pointY * ay + pointZ * az;
                    if (Math.abs(dotProduct) > halfLen) continue;

                    const projX = dotProduct * ax;
                    const projY = dotProduct * ay;
                    const projZ = dotProduct * az;
                    const distX = pointX - projX;
                    const distY = pointY - projY;
                    const distZ = pointZ - projZ;
                    const distFromAxis = Math.sqrt(distX * distX + distY * distY + distZ * distZ);

                    if (distFromAxis <= radius) {
                        chiMap[p2 * 256 + p1] += obj.val;
                    }
                }
            }
        } else if (obj.shape === 'ellipsoid') {
            const aspectX = obj.aspectX || 1;
            const aspectY = obj.aspectY || 1;
            const aspectZ = obj.aspectZ || 1;
            const rx = obj.size * aspectX;
            const ry = obj.size * aspectY;
            const rz = obj.size * aspectZ;
            const maxRadius = Math.max(rx, ry, rz);

            for (let d2 = -Math.ceil(maxRadius); d2 <= Math.ceil(maxRadius); d2++) {
                for (let d1 = -Math.ceil(maxRadius); d1 <= Math.ceil(maxRadius); d1++) {
                    const p1 = c1 + d1;
                    const p2 = c2 + d2;
                    if (p1 < 0 || p1 >= 256 || p2 < 0 || p2 >= 256) continue;

                    let pointX, pointY, pointZ;
                    switch (CONFIG.scanPlane) {
                        case 'axial':
                            pointX = d1; pointY = d2; pointZ = slicePos - obj.z;
                            break;
                        case 'coronal':
                            pointX = d1; pointY = slicePos - obj.y; pointZ = d2;
                            break;
                        case 'sagittal':
                            pointX = slicePos - obj.x; pointY = d1; pointZ = d2;
                            break;
                    }

                    const ellipDist = (pointX * pointX) / (rx * rx) +
                        (pointY * pointY) / (ry * ry) +
                        (pointZ * pointZ) / (rz * rz);

                    if (ellipDist <= 1) {
                        chiMap[p2 * 256 + p1] += obj.val;
                    }
                }
            }
        } else if (obj.shape === 'cube') {
            const half = obj.size;
            const rotX = obj.cubeRotX || 0;
            const rotY = obj.cubeRotY || 0;
            const rotZ = obj.cubeRotZ || 0;

            for (let d2 = -half * 2; d2 <= half * 2; d2++) {
                for (let d1 = -half * 2; d1 <= half * 2; d1++) {
                    const p1 = c1 + d1;
                    const p2 = c2 + d2;
                    if (p1 < 0 || p1 >= 256 || p2 < 0 || p2 >= 256) continue;

                    let pointX, pointY, pointZ;
                    switch (CONFIG.scanPlane) {
                        case 'axial':
                            pointX = d1; pointY = d2; pointZ = slicePos - obj.z;
                            break;
                        case 'coronal':
                            pointX = d1; pointY = slicePos - obj.y; pointZ = d2;
                            break;
                        case 'sagittal':
                            pointX = slicePos - obj.x; pointY = d1; pointZ = d2;
                            break;
                    }

                    const local = applyInverseEulerXYZ(pointX, pointY, pointZ, rotX, rotY, rotZ);
                    if (Math.abs(local.x) <= half && Math.abs(local.y) <= half && Math.abs(local.z) <= half) {
                        chiMap[p2 * 256 + p1] += obj.val;
                    }
                }
            }
        } else {
            // Default: Sphere
            let sliceDist;
            switch (CONFIG.scanPlane) {
                case 'axial': sliceDist = Math.abs(slicePos - obj.z); break;
                case 'coronal': sliceDist = Math.abs(slicePos - obj.y); break;
                case 'sagittal': sliceDist = Math.abs(slicePos - obj.x); break;
            }

            if (sliceDist < obj.size) {
                const radiusAtSlice = Math.sqrt(obj.size * obj.size - sliceDist * sliceDist);
                const r = Math.floor(radiusAtSlice);

                for (let d2 = -r; d2 <= r; d2++) {
                    for (let d1 = -r; d1 <= r; d1++) {
                        if (d1 * d1 + d2 * d2 <= r * r) {
                            const p1 = c1 + d1;
                            const p2 = c2 + d2;
                            if (p1 >= 0 && p1 < 256 && p2 >= 0 && p2 < 256) {
                                chiMap[p2 * 256 + p1] += obj.val;
                            }
                        }
                    }
                }
            }
        }
    });
}

// Build full 3D chi volume from objects
function build3DChiVolume() {
    const nx = CONFIG.gridSize;
    const ny = CONFIG.gridSize;
    const nz = CONFIG.gridSizeZ;
    const totalSize = nx * ny * nz;
    const physicalSize = CONFIG.gridSize; // Physical FOV is always gridSize (128mm)

    chiVolume = new Float32Array(totalSize);

    // Physical space: gridSize x gridSize x gridSize (128x128x128 mm)
    // Voxel resolution: nx x ny x nz (e.g., 128x128x64)
    // Voxel size: physicalSize/nx, physicalSize/ny, physicalSize/nz
    // Object coordinates are in physical space: [-gridSize/2, +gridSize/2] for all axes

    // Scale factors to convert physical coords to voxel indices
    const scaleXY = nx / physicalSize;  // 1.0 when nx=128, physicalSize=128
    const scaleZ = nz / physicalSize;   // 0.5 when nz=64, physicalSize=128

    CONFIG.objects.forEach(obj => {
        // Map object physical coords to volume indices
        // Physical range: [-64, +64] -> Voxel range: [0, nx-1] or [0, nz-1]
        const cx = (obj.x + physicalSize / 2) * scaleXY;
        const cy = (obj.y + physicalSize / 2) * scaleXY;
        const cz = (obj.z + physicalSize / 2) * scaleZ;

        // Voxel sizes in physical units (mm)
        const voxelSizeXY = physicalSize / nx;  // 1.0 mm when nx=128
        const voxelSizeZ = physicalSize / nz;   // 2.0 mm when nz=64

        if (obj.shape === 'sphere') {
            // Object size is in physical units (mm), need to compare in physical space
            const radiusPhys = obj.size;
            for (let iz = 0; iz < nz; iz++) {
                for (let iy = 0; iy < ny; iy++) {
                    for (let ix = 0; ix < nx; ix++) {
                        // Convert voxel distances to physical distances
                        const dxPhys = (ix - cx) * voxelSizeXY;
                        const dyPhys = (iy - cy) * voxelSizeXY;
                        const dzPhys = (iz - cz) * voxelSizeZ;
                        const dist2 = dxPhys * dxPhys + dyPhys * dyPhys + dzPhys * dzPhys;
                        if (dist2 <= radiusPhys * radiusPhys) {
                            const idx = iz * ny * nx + iy * nx + ix;
                            chiVolume[idx] += obj.val;
                        }
                    }
                }
            }
        } else if (obj.shape === 'ellipsoid') {
            const rx = obj.size * (obj.aspectX || 1);
            const ry = obj.size * (obj.aspectY || 1);
            const rz = obj.size * (obj.aspectZ || 1);

            for (let iz = 0; iz < nz; iz++) {
                for (let iy = 0; iy < ny; iy++) {
                    for (let ix = 0; ix < nx; ix++) {
                        const dxPhys = (ix - cx) * voxelSizeXY;
                        const dyPhys = (iy - cy) * voxelSizeXY;
                        const dzPhys = (iz - cz) * voxelSizeZ;
                        const ellipDist = (dxPhys * dxPhys) / (rx * rx) + (dyPhys * dyPhys) / (ry * ry) + (dzPhys * dzPhys) / (rz * rz);
                        if (ellipDist <= 1) {
                            const idx = iz * ny * nx + iy * nx + ix;
                            chiVolume[idx] += obj.val;
                        }
                    }
                }
            }
        } else if (obj.shape === 'cube') {
            const half = obj.size;
            const rotX = obj.cubeRotX || 0;
            const rotY = obj.cubeRotY || 0;
            const rotZ = obj.cubeRotZ || 0;

            for (let iz = 0; iz < nz; iz++) {
                for (let iy = 0; iy < ny; iy++) {
                    for (let ix = 0; ix < nx; ix++) {
                        const dxPhys = (ix - cx) * voxelSizeXY;
                        const dyPhys = (iy - cy) * voxelSizeXY;
                        const dzPhys = (iz - cz) * voxelSizeZ;
                        const local = applyInverseEulerXYZ(dxPhys, dyPhys, dzPhys, rotX, rotY, rotZ);
                        if (Math.abs(local.x) <= half && Math.abs(local.y) <= half && Math.abs(local.z) <= half) {
                            const idx = iz * ny * nx + iy * nx + ix;
                            chiVolume[idx] += obj.val;
                        }
                    }
                }
            }
        } else if (obj.shape === 'cylinder') {
            const ax = obj.cylAxisX;
            const ay = obj.cylAxisY;
            const az = obj.cylAxisZ;
            const halfLen = (obj.cylLength || physicalSize * 0.6) / 2;
            const radius = obj.size;

            for (let iz = 0; iz < nz; iz++) {
                for (let iy = 0; iy < ny; iy++) {
                    for (let ix = 0; ix < nx; ix++) {
                        const dxPhys = (ix - cx) * voxelSizeXY;
                        const dyPhys = (iy - cy) * voxelSizeXY;
                        const dzPhys = (iz - cz) * voxelSizeZ;

                        const dotProduct = dxPhys * ax + dyPhys * ay + dzPhys * az;
                        if (Math.abs(dotProduct) > halfLen) continue;

                        const projX = dotProduct * ax;
                        const projY = dotProduct * ay;
                        const projZ = dotProduct * az;
                        const distX = dxPhys - projX;
                        const distY = dyPhys - projY;
                        const distZ = dzPhys - projZ;
                        const distFromAxis = Math.sqrt(distX * distX + distY * distY + distZ * distZ);

                        if (distFromAxis <= radius) {
                            const idx = iz * ny * nx + iy * nx + ix;
                            chiVolume[idx] += obj.val;
                        }
                    }
                }
            }
        }
    });

    return chiVolume;
}

// Extract 2D slice from 3D volume based on current scan plane and slice position
// Physical FOV is always 128x128x128, but Z resolution may be lower (anisotropic voxels)
// For coronal/sagittal views, we stretch/interpolate Z data to fill the full display
function extractSliceFromVolume(volume, slicePos) {
    const nx = CONFIG.gridSize;
    const ny = CONFIG.gridSize;
    const nz = CONFIG.gridSizeZ;
    const displaySize = CONFIG.gridSize; // Output is always gridSize x gridSize
    const slice = new Float32Array(displaySize * displaySize);

    // Return empty slice if volume doesn't exist
    if (!volume) {
        return slice;
    }

    // Slider range is -128 to 128 (256 steps), map to volume indices
    // slicePos: -128 to 128 → normalized: 0 to 1
    const sliderNorm = (slicePos + 128) / 256;

    switch (CONFIG.scanPlane) {
        case 'axial': {
            // XY slice at Z position
            // Output: displaySize x displaySize (X horizontal, Y vertical)
            const zIdx = Math.floor(sliderNorm * nz);
            const clampedZ = Math.max(0, Math.min(nz - 1, zIdx));
            for (let iy = 0; iy < ny; iy++) {
                for (let ix = 0; ix < nx; ix++) {
                    const volIdx = clampedZ * ny * nx + iy * nx + ix;
                    slice[iy * displaySize + ix] = volume[volIdx];
                }
            }
            break;
        }
        case 'coronal': {
            // XZ slice at Y position
            // Output: displaySize x displaySize (X horizontal, Z vertical - stretched to fill)
            const yIdx = Math.floor(sliderNorm * ny);
            const clampedY = Math.max(0, Math.min(ny - 1, yIdx));

            // Map display rows to Z voxels (stretch nz to fill displaySize)
            // Each display row maps to a Z voxel using nearest-neighbor interpolation
            for (let outRow = 0; outRow < displaySize; outRow++) {
                // Map display row [0, displaySize-1] to Z index [0, nz-1]
                const zFloat = (outRow / (displaySize - 1)) * (nz - 1);
                const iz = Math.round(zFloat);
                const clampedIz = Math.max(0, Math.min(nz - 1, iz));

                for (let ix = 0; ix < nx; ix++) {
                    const volIdx = clampedIz * ny * nx + clampedY * nx + ix;
                    slice[outRow * displaySize + ix] = volume[volIdx];
                }
            }
            break;
        }
        case 'sagittal': {
            // YZ slice at X position
            // Output: displaySize x displaySize (Y horizontal, Z vertical - stretched to fill)
            const xIdx = Math.floor(sliderNorm * nx);
            const clampedX = Math.max(0, Math.min(nx - 1, xIdx));

            // Map display rows to Z voxels (stretch nz to fill displaySize)
            for (let outRow = 0; outRow < displaySize; outRow++) {
                const zFloat = (outRow / (displaySize - 1)) * (nz - 1);
                const iz = Math.round(zFloat);
                const clampedIz = Math.max(0, Math.min(nz - 1, iz));

                for (let iy = 0; iy < ny; iy++) {
                    const volIdx = clampedIz * ny * nx + iy * nx + clampedX;
                    slice[outRow * displaySize + iy] = volume[volIdx];
                }
            }
            break;
        }
    }

    return slice;
}

// Cached k-space data for inverse-only recalculation
let cachedKKernel = null;
let cachedFieldVolumeClean = null; // Field without noise (for reusing with same noise)

// Run 3D forward model: chi → field (with noise)
function run3DForwardModel() {
    const nx = CONFIG.gridSize;
    const ny = CONFIG.gridSize;
    const nz = CONFIG.gridSizeZ;
    const totalSize = nx * ny * nz;

    // 1. Build 3D chi volume from objects
    build3DChiVolume();

    // 2. Forward FFT of chi volume
    const chiComplex = new ComplexArray(totalSize);
    chiComplex.real.set(chiVolume);
    FFT.fft3D(chiComplex, nx, ny, nz);
    FFT.fftShift3D(chiComplex, nx, ny, nz);

    // 3. Generate 3D dipole kernel with current B0 angle
    cachedKKernel = QSM.generateDipoleKernel3D(nx, ny, nz, CONFIG.b0Angle);

    // 4. Multiply in k-space (forward model)
    const kField = QSM.multiplyKSpace3D(chiComplex, cachedKKernel);

    // 5. Inverse FFT to get field (phase)
    const fieldComplex = new ComplexArray(totalSize);
    fieldComplex.real.set(kField.real);
    fieldComplex.imag.set(kField.imag);
    FFT.fftShift3D(fieldComplex, nx, ny, nz);
    FFT.fft3D(fieldComplex, nx, ny, nz, true);

    // Store clean field (without noise)
    cachedFieldVolumeClean = new Float32Array(totalSize);
    cachedFieldVolumeClean.set(fieldComplex.real);

    // 6. Add noise to field volume (reduced to 2% for cleaner reconstruction)
    let maxVal = 0;
    for (let i = 0; i < totalSize; i++) {
        const absVal = Math.abs(cachedFieldVolumeClean[i]);
        if (absVal > maxVal) maxVal = absVal;
    }
    const sigma = maxVal * 0.02;

    cachedNoiseVolume = new Float32Array(totalSize);
    for (let i = 0; i < totalSize; i++) {
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2);
        cachedNoiseVolume[i] = z0 * sigma;
    }

    // Create noisy field volume
    fieldVolume = new Float32Array(totalSize);
    for (let i = 0; i < totalSize; i++) {
        fieldVolume[i] = cachedFieldVolumeClean[i] + cachedNoiseVolume[i];
    }

    needsForwardRecalc = false;
}

// Run 3D inverse model: field → recon (reuses existing noisy field)
function run3DInverseModel() {
    const nx = CONFIG.gridSize;
    const ny = CONFIG.gridSize;
    const nz = CONFIG.gridSizeZ;
    const totalSize = nx * ny * nz;

    // Ensure we have the dipole kernel (regenerate if B0 angle changed)
    if (!cachedKKernel) {
        cachedKKernel = QSM.generateDipoleKernel3D(nx, ny, nz, CONFIG.b0Angle);
    }

    // 7. Reconstruction - FFT of noisy field
    const reconComplex = new ComplexArray(totalSize);
    reconComplex.real.set(fieldVolume);
    FFT.fft3D(reconComplex, nx, ny, nz);
    FFT.fftShift3D(reconComplex, nx, ny, nz);

    // 8. Divide by dipole kernel with regularization
    const kRecon = QSM.divideKSpace3D(reconComplex, cachedKKernel, CONFIG.lambda, CONFIG.reconMethod);

    // Note: Cone-of-silence artifacts naturally arise from the ill-conditioned dipole inversion
    // The regularization/TKD handles this - no need for artificial noise injection

    // 9. Inverse FFT to get reconstruction
    const spatialRecon = new ComplexArray(totalSize);
    spatialRecon.real.set(kRecon.real);
    spatialRecon.imag.set(kRecon.imag);
    FFT.fftShift3D(spatialRecon, nx, ny, nz);
    FFT.fft3D(spatialRecon, nx, ny, nz, true);

    reconVolume = new Float32Array(totalSize);
    reconVolume.set(spatialRecon.real);

    needsInverseRecalc = false;
}

// Run full 3D simulation (forward + inverse)
function run3DSimulation() {
    run3DForwardModel();
    run3DInverseModel();
}

function runSimulation(forceForwardRecalc = false) {
    const N = CONFIG.gridSize;
    const totalSize = N * N;
    const slicePos = parseInt(sliceSlider.value);

    if (CONFIG.use3D) {
        // 3D simulation mode
        // Run full forward+inverse if forward model needs recalculation
        if (needsForwardRecalc || forceForwardRecalc || !chiVolume || !fieldVolume) {
            try {
                run3DSimulation();
            } catch (e) {
                console.error('3D simulation error:', e);
            }
        }
        // Run inverse-only if just λ or recon method changed (keeps same noise)
        else if (needsInverseRecalc && fieldVolume && cachedKKernel) {
            try {
                run3DInverseModel();
            } catch (e) {
                console.error('3D inverse model error:', e);
            }
        }

        // Extract current slice from 3D volumes
        chiMap = extractSliceFromVolume(chiVolume, slicePos);
        fieldMap = extractSliceFromVolume(fieldVolume, slicePos);

        // Extract reconstruction from 3D volume (using proper 3D physics)
        // Lambda/method changes now reuse same noisy field for fair comparison
        reconMap = extractSliceFromVolume(reconVolume, slicePos);

    } else {
        // Original 2D simulation mode (kept for comparison)
        if (needsForwardRecalc || forceForwardRecalc) {
            const chiComplex = new ComplexArray(totalSize);
            chiComplex.real.set(chiMap);

            FFT.fft2D(chiComplex, N, N);
            FFT.fftShift(chiComplex, N, N);

            const kKernel = QSM.generateDipoleKernel(N, CONFIG.scanPlane);
            const kField = QSM.multiplyKSpace(chiComplex, kKernel);
            kSpaceObj = kField;

            const spatialFieldComplex = new ComplexArray(totalSize);
            spatialFieldComplex.real.set(kField.real);
            spatialFieldComplex.imag.set(kField.imag);
            FFT.fftShift(spatialFieldComplex, N, N);
            FFT.fft2D(spatialFieldComplex, N, N, true);
            cleanFieldMap.set(spatialFieldComplex.real);

            const maxVal = Math.max(...cleanFieldMap.map(Math.abs));
            const sigma = maxVal * 0.05;

            for (let i = 0; i < totalSize; i++) {
                const u1 = Math.random();
                const u2 = Math.random();
                const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.001)) * Math.cos(2.0 * Math.PI * u2);
                cachedNoise[i] = z0 * sigma;
            }

            needsForwardRecalc = false;
        }

        const noisyFieldMap = new Float32Array(totalSize);
        for (let i = 0; i < totalSize; i++) {
            noisyFieldMap[i] = cleanFieldMap[i] + cachedNoise[i];
        }
        fieldMap = noisyFieldMap;

        const kKernel = QSM.generateDipoleKernel(N, CONFIG.scanPlane);
        const fieldComplex = new ComplexArray(totalSize);
        fieldComplex.real.set(noisyFieldMap);
        FFT.fft2D(fieldComplex, N, N);
        FFT.fftShift(fieldComplex, N, N);

        const kRecon = QSM.divideKSpace(fieldComplex, kKernel, CONFIG.lambda, CONFIG.reconMethod);

        const spatialRecon = new ComplexArray(totalSize);
        spatialRecon.real.set(kRecon.real);
        spatialRecon.imag.set(kRecon.imag);
        FFT.fftShift(spatialRecon, N, N);
        FFT.fft2D(spatialRecon, N, N, true);

        reconMap = new Float32Array(spatialRecon.real);
    }

    // Fixed dynamic range for both chi and recon maps: -1.5 to +1.5 ppm
    const fixedAbsMax = 1.5;

    // Render all maps (with colorbar IDs for dynamic labels)
    if (ctxChi) drawMap(ctxChi, chiMap, false, 'chi', fixedAbsMax);
    if (ctxField) drawMap(ctxField, fieldMap, true);
    if (ctxRecon) drawMap(ctxRecon, reconMap, false, 'recon', fixedAbsMax);

    // Update the 3D texture with selected map
    update3DTexture();
}

// Update 3D slice texture based on selected mode
function update3DTexture() {
    if (!ctx3DTexture) return;

    // Choose which map to display based on mode
    let mapData, isField;
    switch (sliceTextureMode) {
        case 'phase':
            mapData = fieldMap;
            isField = true;
            break;
        case 'recon':
            mapData = reconMap;
            isField = false;
            break;
        case 'chi':
        default:
            mapData = chiMap;
            isField = false;
            break;
    }

    drawMapUnrotated(ctx3DTexture, mapData, isField);

    // Update the 3D texture
    if (slicePlaneMesh && slicePlaneMesh.material.map) {
        slicePlaneMesh.material.map.needsUpdate = true;
    }
}

// Draw map with vertical flip to match 3D coordinates (Y/Z increases upward)
// forcedAbsMax: optional - use this value for normalization instead of calculating from data
function drawMap(ctx, dataMap, isField, colorbarId = null, forcedAbsMax = null) {
    const size = CONFIG.gridSize;
    const canvasSize = CONFIG.canvasSize;

    // Create temporary canvas at simulation resolution
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = size;
    tempCanvas.height = size;
    const tempCtx = tempCanvas.getContext('2d');
    const imgData = tempCtx.createImageData(size, size);

    // Use forced absMax if provided, otherwise calculate from data
    let absMax;
    if (forcedAbsMax !== null) {
        absMax = forcedAbsMax;
    } else {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < dataMap.length; i++) {
            const v = dataMap[i];
            if (v < min) min = v;
            if (v > max) max = v;
        }
        absMax = Math.max(Math.abs(min), Math.abs(max));
        if (absMax === 0) absMax = 1;
    }

    // Update colorbar labels if provided (for chi maps, not field)
    if (colorbarId && !isField) {
        const minLabel = document.getElementById(colorbarId + '-min-label');
        const maxLabel = document.getElementById(colorbarId + '-max-label');
        if (minLabel) minLabel.innerText = (-absMax).toFixed(1);
        if (maxLabel) maxLabel.innerText = '+' + absMax.toFixed(1);
    }

    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            // Read from dataMap (row 0 = low coordinate)
            const srcIdx = row * size + col;
            const val = dataMap[srcIdx];

            // Write to canvas with vertical flip (canvas row 0 = top = high coordinate)
            const dstRow = size - 1 - row;
            const dstIdx = (dstRow * size + col) * 4;

            const norm = val / absMax;
            let isBackground = false;
            let r, g, b;

            if (isField) {
                // Phase Map: Grayscale (Black -> White)
                const gray = Math.floor(((norm + 1) / 2) * 255);
                r = g = b = gray;
            } else {
                // Chi Map: Blue -> Black -> Red (High Contrast)
                const t = norm;

                if (t > 0.02) {
                    // Positive (Paramagnetic) -> Red
                    r = Math.floor(Math.sqrt(t) * 255);
                    g = 0;
                    b = 0;
                } else if (t < -0.02) {
                    // Negative (Diamagnetic) -> Blue
                    r = 0;
                    g = 0;
                    b = Math.floor(Math.sqrt(-t) * 255);
                } else {
                    // Background (Near 0) -> Cyan tint with transparency
                    r = 0;
                    g = 255;
                    b = 255;
                    isBackground = true;
                }
            }

            imgData.data[dstIdx] = r;
            imgData.data[dstIdx + 1] = g;
            imgData.data[dstIdx + 2] = b;

            if (isBackground && !isField) {
                imgData.data[dstIdx + 3] = 40; // Semi-transparent
            } else {
                imgData.data[dstIdx + 3] = 255; // Opaque
            }
        }
    }

    // Put image on temp canvas, then scale to main canvas
    tempCtx.putImageData(imgData, 0, 0);

    // Disable smoothing for pixelated look
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.drawImage(tempCanvas, 0, 0, size, size, 0, 0, canvasSize, canvasSize);
}

// Draw map for 3D texture with proper orientation for each scan plane
// The texture needs to map correctly to the 3D plane geometry
function drawMapUnrotated(ctx, dataMap, isField) {
    const size = CONFIG.gridSize;
    const canvasSize = size; // Use actual size for 3D texture canvas

    // For 3D texture, we use the simulation size canvas (not upscaled)
    const imgData = ctx.createImageData(size, size);

    // Normalize
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < dataMap.length; i++) {
        const v = dataMap[i];
        if (v < min) min = v;
        if (v > max) max = v;
    }

    let absMax = Math.max(Math.abs(min), Math.abs(max));
    if (absMax === 0) absMax = 1;

    // Data layout in dataMap (gridSize x gridSize):
    // Axial: col=X, row=Y (index = row * gridSize + col)
    // Coronal: col=X, row=Z (centered)
    // Sagittal: col=Y, row=Z (centered)
    //
    // Three.js PlaneGeometry UV mapping:
    // U (texture horizontal) = local X of geometry (left to right)
    // V (texture vertical) = local Y of geometry (bottom to top)
    //
    // After rotation:
    // Axial: local X→world X, local Y→world Y (no rotation)
    // Coronal: local X→world X, local Y→world Z (rotated around X)
    // Sagittal: local X→world Y, local Y→world Z (rotated around Y)
    //
    // So for the texture to show correctly:
    // Axial: U→col(X), V→row(Y) - need vertical flip since row 0 is low Y but canvas row 0 is top
    // Coronal: U→col(X), V→row(Z) - need vertical flip since row 0 is low Z
    // Sagittal: U→col(Y), V→row(Z) - need vertical flip since row 0 is low Z

    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            const srcIdx = row * size + col;
            const val = dataMap[srcIdx];

            // Vertical flip for all views (V increases upward in texture, but row 0 is at top in canvas)
            const dstRow = size - 1 - row;
            const dstIdx = (dstRow * size + col) * 4;

            const norm = val / absMax;
            let isBackground = false;
            let r, g, b;

            if (isField) {
                const gray = Math.floor(((norm + 1) / 2) * 255);
                r = g = b = gray;
            } else {
                const t = norm;
                if (t > 0.02) {
                    r = Math.floor(Math.sqrt(t) * 255);
                    g = 0;
                    b = 0;
                } else if (t < -0.02) {
                    r = 0;
                    g = 0;
                    b = Math.floor(Math.sqrt(-t) * 255);
                } else {
                    r = 0;
                    g = 255;
                    b = 255;
                    isBackground = true;
                }
            }

            imgData.data[dstIdx] = r;
            imgData.data[dstIdx + 1] = g;
            imgData.data[dstIdx + 2] = b;

            if (isBackground && !isField) {
                imgData.data[dstIdx + 3] = 40;
            } else {
                imgData.data[dstIdx + 3] = 255;
            }
        }
    }

    ctx.putImageData(imgData, 0, 0);
}

function animate() {
    requestAnimationFrame(animate);

    // Render 3D Scene
    if (renderer && scene && camera) {
        // Auto-rotate scene slightly if not interacting?
        // scene.rotation.y += 0.002;
        renderer.render(scene, camera);
    }

    // Render 2D Maps
    // Render 2D Maps
    // 1. Chi Map (or Recon Result if Inverse)
    let map1 = chiMap;
    // Note: We always run recon now, but sticking to logic... 
    // In Unified mode, we probably want to show Chi (Ref) in one panel and Recon in another.
    // The animate function logic here seems outdated compared to runSimulation calls.
    // runSimulation calls drawMap directly on ctxChi, ctxField, ctxRecon!
    // So animate() re-drawing might be redundant OR conflicting if it only draws 2 maps.
    // Let's look at the DOM. We have 3 canvases: simCanvasChi, simCanvasField, simCanvasRecon.
    // animate() only draws to ctxChi and ctxField? And using 'drawCanvas' which doesn't exist.
    // It's safer to remove the drawing from animate() if runSimulation handles it, 
    // OR update animate() to draw all 3 correct maps using drawMap.
    // runSimulation updates the data buffers. animate() should render them to keep 3D sync? 
    // Actually runSimulation calls drawMap at the end. So we don't strictly need it in animate unless we want continuous redraw (e.g. for window resizing or if maps change without sim run?).
    // Given the user edits, runSimulation is called on interaction.
    // But let's fix the calls to be safe and correct.

    // Actually, looking at the code: ctxChi, ctxField, ctxRecon are 3 contexts.
    // animate() tries to draw to ctxChi and ctxField strategies.

    // Correct logic - use fixed range 1.5 ppm for both chi and recon
    const fixedAbsMax = 1.5;
    if (ctxChi) drawMap(ctxChi, chiMap, false, 'chi', fixedAbsMax);
    if (ctxField) drawMap(ctxField, fieldMap, true);
    if (ctxRecon && window.reconResult) drawMap(ctxRecon, window.reconResult, false, 'recon', fixedAbsMax);

    updateB0Visual();
}

// Start
init();
