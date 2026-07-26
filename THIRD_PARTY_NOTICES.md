# Third-party notices

## Eric Bruneton — black_hole_shader

The Gaia BH1 visualization implements a Schwarzschild beam-tracing approach —
including the precomputed master-trajectory tables behind the opt-in
illustrative accretion disk — informed by Eric Bruneton's
[paper](https://ebruneton.github.io/black_hole_shader/paper.pdf)
and [reference implementation](https://github.com/ebruneton/black_hole_shader).
The upstream project is distributed under the BSD 3-Clause License, reproduced
below for attribution and license compatibility. This notice does not assert
that its source code was copied verbatim.

```text
Copyright (c) 2020 Eric Bruneton

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
may be used to endorse or promote products derived from this software without
specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Yale Bright Star Catalogue (BSC5)

The foreground starfield (`js/starcatalog.js`) is generated at build time by
`tools/generate_starcatalog.mjs` from the Yale Bright Star Catalogue, 5th
edition (Hoffleit & Warren 1991), obtained via the Harvard-Smithsonian
Telescope Data Center mirror. The catalogue is in the public domain.

## Self-hosted fonts — Orbitron & Inter

The `fonts/` directory contains woff2 subsets of
[Orbitron](https://fonts.google.com/specimen/Orbitron) (© The Orbitron Project
Authors) and [Inter](https://rsms.me/inter/) (© The Inter Project Authors),
both distributed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
The subsets (latin for Orbitron; latin + vietnamese for Inter) were produced by
Google Fonts' css2 API and are redistributed here unmodified.

## three.js

`lib/` vendors [three.js](https://threejs.org) r160 and required addons,
© 2010–2024 three.js authors, distributed under the MIT License.
