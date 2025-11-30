# 
TITLE: MR physics simulation webapp


# background
I want to build an educational app for MR phuysics. There are bunch of physical principles arelated to the MRI signal generation and acquisition, contrast mechanism, and image processings. For medical doctors and medical students, those are not familar to mathmetical formulation and underlying physics principles, it would be good to have visual representation of spin behavior, contrast mechanism to signal, and image processing. THere are some resources about this topic, but mostly static. In this project, I want to build an interactive simulation approach to see how signal is processed and see the relationship between various parameters and tissue properties to signal. 


# key features
- dedicated to the NMR signal acquistion, on T1, T2, and PD NMR property. 
- quantitative comparison of B0 to signal
- see temporal relaionship between T1, T2, TR, TE, PD
- we can provide the several signal evoluation curves at the same time, those have different NMR property, T1 and T2, and it can demonstrat the effect of parameters to contrast of signals
- users can choose Spin echo vs GRE
- in GRE, we see the effect of local field inhomogeneity
- we can add inversion recovery
- need a sleek design with clear instructions and easy to use interface
- this is an educationa purpose webapp, and hosted by github.io
- IF this app goes well, we can proceed to part 2, such as spatial encoding and decoding, image processing (Fuerier transform) and k-space filling strategies.