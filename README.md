# MR Physics Simulator

**[Live Demo](https://znee.github.io/MRphysics_simulation/)**

An interactive web-based educational tool for understanding MRI physics fundamentals. This simulator demonstrates how Spin Echo (SE), Gradient Echo (GRE), and Inversion Recovery (IR) sequences produce different tissue contrasts based on T1, T2, and proton density.

## Features

### Interactive Simulation
- Real-time brain phantom visualization with anatomically accurate tissue segmentation
- Dynamic signal calculations based on Bloch equations
- Live parameter adjustments with instant visual feedback

### Three MRI Sequences
- **Spin Echo (SE)**: Classic 90°/180° refocused sequence
- **Gradient Echo (GRE)**: Fast imaging with T2* weighting  
- **Inversion Recovery (IR)**: Null-point imaging (FLAIR, STIR)

### Educational Visualizations
- **Signal vs Parameter Charts**: Explore how TR, TE, TI affect tissue contrast
- **Sequence Mechanics Tab**: Understand the physics behind each sequence
  - Phase wheel showing dephasing/rephasing mechanisms
  - R2/R2* decay rate comparison
  - RF/gradient pulse sequence timeline

### Clinical Presets
- T1-Weighted (SE)
- T2-Weighted (SE)
- T2*-Weighted (GRE)
- FLAIR (IR) - CSF suppression
- STIR (IR) - Fat suppression

## How to Use

1. **Visit the [Live Demo](https://znee.github.io/MRphysics_simulation/)** or open `index.html` locally in a modern browser
2. **Select a sequence** (SE, GRE, or IR) from the dropdown
3. **Adjust parameters** using the sliders:
   - TR (Repetition Time)
   - TE (Echo Time)
   - TI (Inversion Time, for IR)
   - FA (Flip Angle, for GRE/IR)
   - B0 (Field Strength)
   - Field Inhomogeneity (for GRE)
4. **Try presets** to see common clinical weightings
5. **Explore the Sequence Mechanics tab** to understand the underlying physics

## Physics Model

- **SE**: S = PD · (1 - e^(-TR/T1)) · e^(-TE/T2)
- **GRE**: Ernst angle steady-state with T2* = T2 + ΔB0 effects
- **IR**: Steady-state inversion recovery with variable readout

Tissue properties (T1, T2, PD) are based on 1.5T field strength values for:
- White Matter
- Gray Matter  
- CSF
- Fat/Scalp

## Technologies

- Pure HTML/CSS/JavaScript (no frameworks)
- [Chart.js](https://www.chartjs.org/) for interactive plotting
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

Jinhee Jang
