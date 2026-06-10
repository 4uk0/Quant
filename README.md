# QUANTUM REACTOR

A premium futuristic hex-grid Match-3 game. Operate the experimental quantum reactor of the
deep-space vessel **ASC Prometheus**: align unstable particles into resonant triads, feed the
core, and survive the cosmic events the void throws back at you.

![Genre](https://img.shields.io/badge/genre-match--3-blue) ![Tech](https://img.shields.io/badge/tech-HTML5%20Canvas-orange) ![Deps](https://img.shields.io/badge/dependencies-none-green)

## Play

No build step, no dependencies. Serve the folder with any static server and open it:

```sh
# PHP
php -S localhost:4173

# or Python
python -m http.server 4173

# or Node
npx serve -l 4173
```

Then open `http://localhost:4173`. Works on desktop and mobile (touch supported).

## Features

- **Hexagonal match-3 board** rendered as a holographic lattice with glowing vertex nodes
- **Five particle types** — Electron, Proton, Neutron, Photon, Prime — each procedurally drawn
  and animated, each with its own destruction effect (chain lightning, fusion burst,
  stabilization wave, row laser, mini black hole)
- **Special particles**: match-4 creates a Charged Particle, match-5 a Quantum Singularity
- **Cosmic events** — Black Hole, Neutron Star, Supernova, Quantum Storm — triggered by a
  charge meter filled through matches and chains
- **Five activatable abilities**: Charged Particle, Fusion Burst, Stability Field, Photon
  Lance, Singularity
- **Live reactor HUD**: Quantum Stability, Energy Output, Coherence, Core Temperature and
  Score all react to play — and decay when the reactor is starved
- **LIGHTSPEED mode**: timed survival — matches and cosmic events extend the reactor window
- **Two visions**: deep-space dark and laboratory white, persisted across sessions
- **Two control schemes**: click-to-select or drag with magnetic snapping
- **Fake-3D HUD**: perspective-tilted instrument panels with mouse parallax
- **Synthesized audio** via Web Audio API — no sound files

## Controls

| Action | How |
|---|---|
| Swap particles | Click one, then an adjacent one — or drag (switchable in Settings) |
| Activate a special particle | Click it |
| Fire an ability | Click its icon in the bottom dock, then click a target cell |
| Systems panel | Gear button, top right |

## Tech

Plain HTML5 + Canvas 2D + vanilla JavaScript in two files: [index.html](index.html) (UI shell
and styling) and [game.js](game.js) (engine: cube-coordinate hex math, match detection, state
machine, particle renderer, effects system, cosmic events, audio synth). Offline-capable,
60 FPS, no frameworks.
