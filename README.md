# MR Physics Educational Tools

**[Live Demo](https://znee.github.io/MRphysics_simulation/)**

Interactive web-based educational tools for understanding MRI physics fundamentals, from signal generation to image reconstruction.

---

## Part 1: MR Signal & Contrast Simulator

**[Launch Part 1](https://znee.github.io/MRphysics_simulation/part1/)**

Demonstrates how MRI sequences produce different tissue contrasts based on T1, T2, and proton density.

### Features
- **Three MRI Sequences**: Spin Echo (SE), Gradient Echo (GRE), Inversion Recovery (IR)
- **Real-time Visualization**: Brain phantom with dynamic signal calculations
- **Signal vs Parameter Charts**: Explore how TR, TE, TI affect tissue contrast
- **Sequence Mechanics Tab**: Phase wheel, T2/T2* decay curves, RF timeline
- **Clinical Presets**: T1W, T2W, T2*W, FLAIR, STIR

### Physics Model
- **SE**: S = PD · (1 - e^(-TR/T1)) · e^(-TE/T2)
- **GRE**: Ernst angle steady-state with T2* effects
- **IR**: Steady-state inversion recovery

---

## Part 2: K-Space & Image Reconstruction

**[Launch Part 2](https://znee.github.io/MRphysics_simulation/part2/)**

Visualizes the relationship between spatial frequency domain (k-space) and image domain.

### Features
- **K-Space Visualization**: See how spatial frequencies combine to form images
- **Fourier Transform**: Interactive demonstration of 2D FFT
- **Sampling Patterns**: Explore different k-space trajectories
- **Artifact Demonstration**: Understand common MRI artifacts

---

## How to Use

### Online
Visit the [Live Demo](https://znee.github.io/MRphysics_simulation/) and select Part 1 or Part 2.

### Local
1. Clone this repository
2. Open `index.html` in a modern browser, or
3. Navigate directly to `part1/index.html` or `part2/index.html`

## Technologies

- Pure HTML/CSS/JavaScript (no frameworks)
- [Chart.js](https://www.chartjs.org/) for interactive plotting
- Canvas API for image processing
- SVG for anatomical visualization

## Browser Compatibility

Works best in modern browsers with ES6+ support:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

Educational use permitted. Created for medical physics teaching.

## Author

Jinhee Jang, MD, PhD
Department of Radiology, Seoul St. Mary's Hospital
