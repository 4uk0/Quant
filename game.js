'use strict';
// ============================================================
// QUANTUM REACTOR — Game Engine v2
// ============================================================

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ── Constants ──────────────────────────────────────────────
let COLS = 9, ROWS = 7;
const PT_COUNT = 5;
const PT = { ELECTRON:0, PROTON:1, NEUTRON:2, PHOTON:3, PRIME:4 };

let HR = 46, HW = 0, VG = 0;
let BOARD_X = 0, BOARD_Y = 0;
// Logical viewport size (CSS px) and device pixel ratio; the canvas backing
// store is VW*DPR x VH*DPR so rendering stays sharp on high-density screens
let VW = 0, VH = 0, DPR = 1;

const COL_DATA = [
  { name:'ELECTRON', main:'#44aaff', glow:'#0055ff' },
  { name:'PROTON',   main:'#ffcc44', glow:'#ff8800' },
  { name:'NEUTRON',  main:'#99bbcc', glow:'#667788' },
  { name:'PHOTON',   main:'#ffcc00', glow:'#ffaa00' },
  { name:'PRIME',    main:'#aa44ff', glow:'#6600cc' },
];

const SWAP_DUR = 280, MATCH_DUR = 420, FALL_DUR = 340;

// ── Game State ──────────────────────────────────────────────
let board = [];
let gameState = 'IDLE';
let selected = null;
let swapFrom = null, swapTo = null, swapT = 0;
let matchGroups = [], matchedSet = new Set(), matchT = 0;
let fallingCells = [];
let effects = [], stars = [];
let score = 0, combo = 0;
let reactorPower = 0;
let stability = 97.6, energyOutput = 3.42, coherence = 99.2, coreTemp = 4.2;
let stateTimer = 0, time = 0, lastTime = 0;
let logQueue = [];
let shake = 0;

// Settings (persisted)
let settings = { light: false, control: 'select', speed: 'standard' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('qr-settings') || '{}')); } catch(e) {}

// Core (level) system — each Core is a timed stage with a Reactor Power target.
// Odd Cores use the hexagonal lattice, even Cores the cubic (square) lattice.
const CORE_TIME = 90000;
let core = 1;
let totalPower = 0; // cumulative Reactor Power across all Cores (the main score)
try {
  const prog = JSON.parse(localStorage.getItem('qr-progress') || '{}');
  core = Math.max(1, (prog.core | 0) || 1);
  totalPower = Math.max(0, (prog.power | 0) || 0);
} catch(e) {}

// Every point earned feeds both the current Core's progress and the career total
function addPower(pts) { score += pts; totalPower += pts; }

// Coherence doubles as a luck stat: higher coherence = better odds that a
// special (match-4+, special particle, ability) pays out double
function coherenceBonusChance() { return Math.max(0, Math.min(50, (coherence - 90) * 5)); }
function rollCoherence() { return Math.random() * 100 < coherenceBonusChance(); }
function coherenceBonusFx(x, y) {
  addText(x, y - HR, 'COHERENCE ×2', '#7fe8ff', 20);
  addLog('Coherence bonus — output doubled', true);
  coherence = Math.min(100, coherence + 0.3);
}
let gridMode = 'hex';          // 'hex' | 'square'
let coreTarget = 3000;
let levelState = 'playing';    // 'playing' | 'timeup' | 'passed'
let timeLeft = CORE_TIME, gameOver = false;
let hudTick = 0;

function coreTargetFor(n) { return 500 * n * (n + 5); }
function saveProgress() {
  try { localStorage.setItem('qr-progress', JSON.stringify({ core, power: totalPower })); } catch(e) {}
}

const THEMES = {
  dark: {
    bgIn:'#03101f', bgOut:'#000305', star:'255,255,255',
    nebula: [[0.15,0.25,0.4,'rgba(0,30,80,0.09)'],[0.85,0.75,0.35,'rgba(50,0,100,0.08)'],[0.5,0.5,0.5,'rgba(0,20,60,0.06)']],
    cellFill:'rgba(1,8,24,0.72)', cellStroke:'rgba(0,110,170,0.22)',
    line:'rgba(0,90,160,0.13)', node:'190,235,255', nodeShadow:'rgba(120,210,255,0.9)',
    vignette:'rgba(0,0,0,0.65)', ringAlpha:0.045
  },
  light: {
    bgIn:'#f3f9fe', bgOut:'#c5d9e8', star:'30,90,150',
    nebula: [[0.15,0.25,0.4,'rgba(120,170,220,0.16)'],[0.85,0.75,0.35,'rgba(170,140,220,0.13)'],[0.5,0.5,0.5,'rgba(140,180,230,0.1)']],
    cellFill:'rgba(255,255,255,0.62)', cellStroke:'rgba(0,110,180,0.38)',
    line:'rgba(0,90,160,0.25)', node:'0,110,190', nodeShadow:'rgba(0,140,220,0.7)',
    vignette:'rgba(90,130,170,0.4)', ringAlpha:0.1
  }
};
let theme = settings.light ? THEMES.light : THEMES.dark;

// Drag input + HUD parallax
let drag = null; // {from, x, y, sx, sy, target, moved}
const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

// Cosmic events
let eventCharge = 0;            // 0..100
let cosmicEvent = null;         // {type, cell, t, cleared}
const EVENT_TYPES = ['blackhole','neutronstar','supernova','quantumstorm'];

// Abilities
const abilities = { charged:3, fusion:3, stability:3, lance:3, singularity:1 };
let armedAbility = null;

// ── Hex Math ────────────────────────────────────────────────
function hexToPixel(col, row) {
  if (gridMode === 'square') {
    return { x: HW * col + BOARD_X, y: VG * row + BOARD_Y };
  }
  return {
    x: HW * col + (row & 1 ? HW * 0.5 : 0) + BOARD_X,
    y: VG * row + BOARD_Y
  };
}
function cubeFromOffset(col, row) {
  const q = col - (row - (row & 1)) / 2;
  return { q, r: row, s: -q - row };
}
function offsetFromCube(q, r) {
  return { col: q + (r - (r & 1)) / 2, row: r };
}
function isValid(col, row) { return col >= 0 && col < COLS && row >= 0 && row < ROWS; }
function getCell(col, row) {
  if (!isValid(col, row) || !board[row]) return null;
  return board[row][col] || null;
}
function cubeDist(a, b) {
  return Math.max(Math.abs(a.q-b.q), Math.abs(a.r-b.r), Math.abs(a.s-b.s));
}
function hexDist(c1, r1, c2, r2) {
  if (gridMode === 'square') {
    return Math.max(Math.abs(c1-c2), Math.abs(r1-r2)); // Chebyshev
  }
  return cubeDist(cubeFromOffset(c1,r1), cubeFromOffset(c2,r2));
}

const CUBE_DIRS = [
  [+1,0,-1],[-1,0,+1], [0,+1,-1],[0,-1,+1], [+1,-1,0],[-1,+1,0]
];
const OFF_DIRS_EVEN = [[+1,0],[-1,0],[0,-1],[-1,-1],[0,+1],[-1,+1]];
const OFF_DIRS_ODD  = [[+1,0],[-1,0],[+1,-1],[0,-1],[+1,+1],[0,+1]];
const SQ_DIRS = [[+1,0],[-1,0],[0,+1],[0,-1]];

function getNeighbors(col, row) {
  const dirs = gridMode === 'square' ? SQ_DIRS
    : (row & 1) ? OFF_DIRS_ODD : OFF_DIRS_EVEN;
  return dirs.map(([dc,dr]) => ({col:col+dc, row:row+dr}))
             .filter(p => isValid(p.col, p.row));
}
function areNeighbors(a, b) {
  return getNeighbors(a.col, a.row).some(n => n.col===b.col && n.row===b.row);
}
function nearestHex(px, py) {
  let best = null, bestD = Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = hexToPixel(c, r);
    const d = (px-p.x)**2 + (py-p.y)**2;
    if (d < bestD) { bestD = d; best = {col:c, row:r}; }
  }
  return bestD < (HR * 0.92)**2 ? best : null;
}

// ── Particle Factory ─────────────────────────────────────────
function mkParticle(type, special=null) {
  return {
    type, special,
    phase: Math.random() * Math.PI * 2,
    rot: Math.random() * Math.PI * 2,
    scale: 1, alpha: 1,
    falling: false, fallFromY: 0, fallTargetY: 0, fallProgress: 0
  };
}

// ── Board Init ───────────────────────────────────────────────
function causesMatchAt(col, row, type) {
  if (gridMode === 'square') {
    // check runs of 2 to the left and 2 above
    for (const [dc, dr] of [[-1,0],[0,-1]]) {
      let count = 1;
      for (let i = 1; i <= 2; i++) {
        const p = getCell(col + dc*i, row + dr*i);
        if (!p || p.type !== type) break;
        count++;
      }
      if (count >= 3) return true;
    }
    return false;
  }
  const cube = cubeFromOffset(col, row);
  for (let axis = 0; axis < 3; axis++) {
    const d1 = CUBE_DIRS[axis*2], d2 = CUBE_DIRS[axis*2+1];
    let count = 1;
    for (const d of [d1, d2]) {
      let c = {q:cube.q+d[0], r:cube.r+d[1], s:cube.s+d[2]};
      for (let i = 0; i < 2; i++) {
        const o = offsetFromCube(c.q, c.r);
        const p = getCell(o.col, o.row);
        if (!p || p.type !== type) break;
        count++;
        c = {q:c.q+d[0], r:c.r+d[1], s:c.s+d[2]};
      }
    }
    if (count >= 3) return true;
  }
  return false;
}

function initBoard() {
  board = Array.from({length:ROWS}, () => Array(COLS).fill(null));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let type, tries = 0;
      do { type = Math.floor(Math.random() * PT_COUNT); tries++; }
      while (tries < 40 && causesMatchAt(col, row, type));
      board[row][col] = mkParticle(type);
    }
  }
}

// ── Match Detection ──────────────────────────────────────────
function findAllMatches() {
  const matched = new Map();
  if (gridMode === 'square') {
    // scan horizontal and vertical runs
    for (const [dc, dr] of [[1,0],[0,1]]) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const p = board[row][col];
          if (!p) continue;
          // only start a run at its head
          const prev = getCell(col - dc, row - dr);
          if (prev && prev.type === p.type) continue;
          const run = [{col, row}];
          let c = col + dc, r = row + dr;
          while (isValid(c, r) && board[r][c]?.type === p.type) {
            run.push({col: c, row: r});
            c += dc; r += dr;
          }
          if (run.length >= 3) run.forEach(cell => {
            const k = `${cell.col},${cell.row}`;
            if (!matched.has(k)) matched.set(k, cell);
          });
        }
      }
    }
    return groupMatches(matched);
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const p = board[row][col];
      if (!p) continue;
      const type = p.type;
      const cube = cubeFromOffset(col, row);
      for (let axis = 0; axis < 3; axis++) {
        const d1 = CUBE_DIRS[axis*2], d2 = CUBE_DIRS[axis*2+1];
        const line = [{col, row}];
        for (const d of [d1, d2]) {
          let c = {q:cube.q+d[0], r:cube.r+d[1], s:cube.s+d[2]};
          while (true) {
            const o = offsetFromCube(c.q, c.r);
            if (!isValid(o.col,o.row)) break;
            const cell = board[o.row][o.col];
            if (!cell || cell.type !== type) break;
            line.push({col:o.col, row:o.row});
            c = {q:c.q+d[0], r:c.r+d[1], s:c.s+d[2]};
          }
        }
        if (line.length >= 3) {
          line.forEach(({col:lc, row:lr}) => {
            const k = `${lc},${lr}`;
            if (!matched.has(k)) matched.set(k, {col:lc, row:lr});
          });
        }
      }
    }
  }
  return groupMatches(matched);
}

function groupMatches(matched) {
  if (matched.size === 0) return [];

  const cells = [...matched.values()];
  const visited = new Set();
  const groups = [];
  for (const cell of cells) {
    const k = `${cell.col},${cell.row}`;
    if (visited.has(k)) continue;
    const group = [];
    const queue = [cell];
    const type = board[cell.row][cell.col].type;
    while (queue.length) {
      const cur = queue.shift();
      const ck = `${cur.col},${cur.row}`;
      if (visited.has(ck)) continue;
      visited.add(ck);
      if (!matched.has(ck)) continue;
      if (board[cur.row][cur.col]?.type !== type) continue;
      group.push(cur);
      getNeighbors(cur.col, cur.row).forEach(n => {
        if (!visited.has(`${n.col},${n.row}`) && matched.has(`${n.col},${n.row}`)) queue.push(n);
      });
    }
    if (group.length >= 3) groups.push({cells:group, type, size:group.length});
  }
  return groups;
}

// ── Gravity & Fill ───────────────────────────────────────────
function applyGravity() {
  fallingCells = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = ROWS-1; row >= 0; row--) {
      if (board[row][col] !== null) continue;
      for (let r = row-1; r >= 0; r--) {
        if (board[r][col] !== null) {
          const p = board[r][col];
          board[row][col] = p;
          board[r][col] = null;
          const from = hexToPixel(col, r), to = hexToPixel(col, row);
          p.falling = true; p.fallFromY = from.y; p.fallTargetY = to.y; p.fallProgress = 0;
          fallingCells.push({col, row});
          break;
        }
      }
    }
  }
}
function fillEmpty() {
  for (let col = 0; col < COLS; col++) {
    let above = 0;
    for (let row = 0; row < ROWS; row++) {
      if (board[row][col] === null) {
        above--;
        const p = mkParticle(Math.floor(Math.random() * PT_COUNT));
        board[row][col] = p;
        const to = hexToPixel(col, row);
        p.falling = true; p.fallFromY = hexToPixel(col, 0).y + above * VG;
        p.fallTargetY = to.y; p.fallProgress = 0;
        fallingCells.push({col, row});
      }
    }
  }
}

// ── Effects ──────────────────────────────────────────────────
function addEffect(type, x, y, opts={}) {
  effects.push({type, x, y, t:0, maxT: opts.duration||600, ...opts});
}
function addText(x, y, text, color='#fff', size=28) {
  effects.push({type:'floatText', x, y, text, color, size, t:0, maxT:900});
}
function addLightning(x1, y1, x2, y2, color='#44aaff') {
  effects.push({type:'lightning', x1, y1, x2, y2, t:0, maxT:380, color});
}

function spawnMatchEffects(group) {
  const btype = ['burst_electron','burst_proton','burst_neutron','burst_photon','burst_prime'][group.type];
  group.cells.forEach(({col,row}) => {
    const {x,y} = hexToPixel(col,row);
    addEffect(btype, x, y, {duration:580});
  });
  if (group.type === PT.ELECTRON && group.cells.length >= 2) {
    for (let i = 0; i < group.cells.length-1; i++) {
      const a = hexToPixel(group.cells[i].col, group.cells[i].row);
      const b = hexToPixel(group.cells[i+1].col, group.cells[i+1].row);
      addLightning(a.x, a.y, b.x, b.y);
    }
  }
  if (group.type === PT.PHOTON) {
    const mid = group.cells[Math.floor(group.cells.length/2)];
    const {x,y} = hexToPixel(mid.col, mid.row);
    addEffect('laser_h', x, y, {duration:500});
  }
  if (group.type === PT.PRIME) {
    const mid = group.cells[Math.floor(group.cells.length/2)];
    const {x,y} = hexToPixel(mid.col, mid.row);
    addEffect('singularity', x, y, {duration:700});
  }
}

// ── Banner ───────────────────────────────────────────────────
let bannerTimeout = null;
function showBanner(main, sub='') {
  const b = document.getElementById('banner');
  document.getElementById('banner-main').textContent = main;
  document.getElementById('banner-sub').textContent = sub;
  b.classList.add('show');
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => b.classList.remove('show'), 2200);
}

// ── Cosmic Events ────────────────────────────────────────────
function chargeEvent(amount) {
  if (cosmicEvent) return;
  eventCharge = Math.min(100, eventCharge + amount);
  const fill = document.getElementById('event-fill');
  const bar = document.getElementById('event-bar');
  fill.style.width = eventCharge + '%';
  bar.classList.toggle('charged', eventCharge >= 100);
}

function triggerCosmicEvent() {
  eventCharge = 0;
  document.getElementById('event-fill').style.width = '0%';
  document.getElementById('event-bar').classList.remove('charged');
  const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const cell = {
    col: 2 + Math.floor(Math.random() * (COLS-4)),
    row: 1 + Math.floor(Math.random() * (ROWS-2))
  };
  cosmicEvent = { type, cell, t: 0, cleared: false };
  setState('EVENT');
  playSound('event');
  const names = {
    blackhole: ['BLACK HOLE', 'Gravitational collapse detected'],
    neutronstar: ['NEUTRON STAR', 'Pulsar beams engaged'],
    supernova: ['SUPERNOVA', 'Stellar detonation imminent'],
    quantumstorm: ['QUANTUM STORM', 'Vacuum fluctuation cascade'],
  };
  showBanner(names[type][0], names[type][1]);
  addLog(names[type][0] + ' event triggered', true);
  coherence = Math.max(88, coherence - 3.5); // events disturb coherence
  // Reward an ability charge
  const keys = Object.keys(abilities);
  const k = keys[Math.floor(Math.random() * keys.length)];
  abilities[k]++;
  updateAbilityUI();
  addLog(`Ability recharged: ${k.toUpperCase()}`);
}

const EVENT_DUR = { blackhole: 2600, neutronstar: 2200, supernova: 2000, quantumstorm: 2400 };

function updateCosmicEvent(dt) {
  const ev = cosmicEvent;
  ev.t += dt;
  const dur = EVENT_DUR[ev.type];
  const prog = ev.t / dur;
  const {x, y} = hexToPixel(ev.cell.col, ev.cell.row);

  if (ev.type === 'blackhole') {
    shake = Math.min(6, prog * 8);
    // Pull particles visually then clear radius 2 at 60%
    if (!ev.cleared && prog > 0.6) {
      ev.cleared = true;
      let n = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c] && hexDist(c, r, ev.cell.col, ev.cell.row) <= 2) {
          board[r][c] = null; n++;
        }
      }
      addPower(n * 250);
      addText(x, y - HR, `+${n*250}`, '#c8f', 30);
    }
  } else if (ev.type === 'neutronstar') {
    if (!ev.cleared && prog > 0.45) {
      ev.cleared = true;
      shake = 7;
      let n = 0;
      if (gridMode === 'square') {
        // beams clear the full row and column through the cell
        for (let c = 0; c < COLS; c++) if (board[ev.cell.row][c]) { board[ev.cell.row][c] = null; n++; }
        for (let r = 0; r < ROWS; r++) if (board[r][ev.cell.col]) { board[r][ev.cell.col] = null; n++; }
      } else {
        // Fire beams along all 3 hex axes through the cell; clear those lines
        const cube = cubeFromOffset(ev.cell.col, ev.cell.row);
        for (let axis = 0; axis < 3; axis++) {
          for (const d of [CUBE_DIRS[axis*2], CUBE_DIRS[axis*2+1]]) {
            let c = {q:cube.q, r:cube.r, s:cube.s};
            while (true) {
              const o = offsetFromCube(c.q, c.r);
              if (!isValid(o.col, o.row)) break;
              if (board[o.row][o.col]) { board[o.row][o.col] = null; n++; }
              c = {q:c.q+d[0], r:c.r+d[1], s:c.s+d[2]};
            }
          }
        }
      }
      addPower(n * 200);
      addText(x, y - HR, `+${n*200}`, '#aef', 30);
      // Convert a few random survivors to neutrons (stabilization)
      for (let i = 0; i < 4; i++) {
        const rc = Math.floor(Math.random()*COLS), rr = Math.floor(Math.random()*ROWS);
        if (board[rr][rc]) board[rr][rc] = mkParticle(PT.NEUTRON);
      }
    }
  } else if (ev.type === 'supernova') {
    shake = prog < 0.5 ? prog * 4 : (1-prog) * 16;
    if (!ev.cleared && prog > 0.5) {
      ev.cleared = true;
      let n = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (board[r][c] && hexDist(c, r, ev.cell.col, ev.cell.row) <= 3) {
          board[r][c] = null; n++;
        }
      }
      addPower(n * 220);
      addText(x, y - HR, `+${n*220}`, '#fd8', 32);
    }
  } else if (ev.type === 'quantumstorm') {
    // Lightning strikes random cells over time
    if (Math.random() < dt / 90 && prog < 0.85) {
      const rc = Math.floor(Math.random()*COLS), rr = Math.floor(Math.random()*ROWS);
      if (board[rr][rc]) {
        const p = hexToPixel(rc, rr);
        addLightning(p.x, p.y - VH*0.4, p.x, p.y, '#9fdcff');
        addEffect('burst_electron', p.x, p.y, {duration:450});
        board[rr][rc] = null;
        addPower(180);
        shake = 4;
      }
    }
  }

  if (ev.t >= dur) {
    cosmicEvent = null;
    shake = 0;
    coreTemp = Math.max(0.8, coreTemp - 0.6);
    updateHUD();
    applyGravity(); fillEmpty();
    setState('FALLING');
  }
}

// ── Abilities ────────────────────────────────────────────────
function updateAbilityUI() {
  for (const k of Object.keys(abilities)) {
    const el = document.getElementById('ac-' + k);
    if (el) el.textContent = abilities[k];
    const wrap = document.querySelector(`.ability[data-ability="${k}"]`);
    if (wrap) wrap.classList.toggle('depleted', abilities[k] <= 0);
  }
}

function armAbility(name) {
  if (gameOver) return;
  if (gameState !== 'IDLE' && gameState !== 'SELECTED') return;
  if (abilities[name] <= 0) return;
  document.querySelectorAll('.ability').forEach(el => el.classList.remove('armed'));
  if (armedAbility === name) { armedAbility = null; return; }
  armedAbility = name;
  selected = null; setState('IDLE');
  document.querySelector(`.ability[data-ability="${name}"]`)?.classList.add('armed');
  addLog(`${name.toUpperCase()} armed — select target`);
  playSound('select');
}

function fireAbility(name, hex) {
  abilities[name]--;
  armedAbility = null;
  document.querySelectorAll('.ability').forEach(el => el.classList.remove('armed'));
  updateAbilityUI();
  const {x, y} = hexToPixel(hex.col, hex.row);
  let n = 0, gained = 0;

  if (name === 'charged') {
    [hex, ...getNeighbors(hex.col, hex.row)].forEach(t => {
      if (board[t.row]?.[t.col]) {
        const p = hexToPixel(t.col, t.row);
        addEffect('burst_proton', p.x, p.y, {duration:500});
        board[t.row][t.col] = null; n++;
      }
    });
    gained = n * 150; shake = 4;
  } else if (name === 'fusion') {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c] && hexDist(c, r, hex.col, hex.row) <= 2) {
        const p = hexToPixel(c, r);
        addEffect('burst_proton', p.x, p.y, {duration:550});
        board[r][c] = null; n++;
      }
    }
    addEffect('supernova_ring', x, y, {duration:700});
    gained = n * 170; shake = 6;
  } else if (name === 'stability') {
    const tgt = board[hex.row][hex.col]?.type ?? PT.NEUTRON;
    for (const t of [hex, ...getNeighbors(hex.col, hex.row)]) {
      if (board[t.row]?.[t.col]) {
        board[t.row][t.col] = mkParticle(tgt);
        const p = hexToPixel(t.col, t.row);
        addEffect('burst_neutron', p.x, p.y, {duration:500});
      }
    }
    addLog(`Field stabilized to ${COL_DATA[tgt].name}`);
  } else if (name === 'lance') {
    addEffect('laser_h', x, y, {duration:550});
    for (let c = 0; c < COLS; c++) {
      if (board[hex.row][c]) { board[hex.row][c] = null; n++; }
    }
    gained = n * 140; shake = 3;
  } else if (name === 'singularity') {
    const tgt = board[hex.row][hex.col]?.type;
    if (tgt == null) { abilities[name]++; updateAbilityUI(); return; }
    addEffect('singularity', x, y, {duration:800});
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c]?.type === tgt) {
        const p = hexToPixel(c, r);
        addEffect('burst_prime', p.x, p.y, {duration:520});
        board[r][c] = null; n++;
      }
    }
    gained = n * 220; shake = 5;
    addLog(`SINGULARITY: ${COL_DATA[tgt].name} erased`, true);
  }

  if (gained > 0) {
    if (rollCoherence()) { gained *= 2; coherenceBonusFx(x, y); }
    addPower(gained);
    addText(x, y, `+${gained}`, '#ffe9b0', 26);
  }
  chargeEvent(4);
  reactorPower = Math.min(100, reactorPower + 6);
  coreTemp = Math.min(9.9, coreTemp + 0.4);
  updateHUD(); playSound('special');
  selected = null;
  applyGravity(); fillEmpty(); setState('FALLING');
}

// ── State Machine ────────────────────────────────────────────
function setState(s) { gameState = s; stateTimer = 0; }
function doSwap(a, b) {
  const tmp = board[a.row][a.col];
  board[a.row][a.col] = board[b.row][b.col];
  board[b.row][b.col] = tmp;
}

function beginMatching(groups) {
  matchGroups = groups;
  matchedSet = new Set(groups.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)));
  groups.forEach(spawnMatchEffects);
  combo++;
  if (combo > 1) addText(VW/2, VH/2-60, `CHAIN ×${combo}`, '#ffcc44', 32);
  setState('MATCHING');
  playSound('match');
}

function updateGame(dt) {
  stateTimer += dt;
  shake = Math.max(0, shake - dt * 0.012);

  for (const {col, row} of fallingCells) {
    const p = board[row]?.[col];
    if (!p || !p.falling) continue;
    p.fallProgress = Math.min(1, p.fallProgress + dt / FALL_DUR);
    if (p.fallProgress >= 1) p.falling = false;
  }
  effects = effects.filter(e => { e.t += dt; return e.t < e.maxT; });

  // Core countdown — when it expires, running cascades are allowed to finish
  // (the combo rule) before the level is evaluated.
  if (!gameOver && levelState === 'playing') {
    timeLeft -= dt;
    const pct = Math.max(0, timeLeft / CORE_TIME * 100);
    document.getElementById('timer-fill').style.width = pct + '%';
    document.getElementById('timer-num').textContent = Math.max(0, Math.ceil(timeLeft / 1000));
    document.getElementById('timer-bar').classList.toggle('low', timeLeft < 10000);
    if (timeLeft <= 0) {
      timeLeft = 0;
      levelState = 'timeup';
      document.getElementById('timer-num').textContent = '0';
      if (gameState === 'IDLE' || gameState === 'SELECTED') evaluateCore();
      else addLog('Window closed — chain reaction continuing', true);
    }
  }
  if (gameOver) return;

  // Live HUD dynamics: everything drifts unless you keep the reactor fed
  coreTemp = Math.max(0.8, coreTemp - dt * 0.00004);
  stability = Math.max(60, stability - dt * 0.0006);
  reactorPower = Math.max(0, reactorPower - dt * 0.0008);
  const cohTarget = 96 + reactorPower * 0.04;
  coherence += (cohTarget - coherence) * dt * 0.0004;
  hudTick += dt;
  if (hudTick > 400) { hudTick = 0; updateHUD(); }

  switch (gameState) {
    case 'IDLE': case 'SELECTED': break;

    case 'SWAPPING': {
      swapT = easeOut(Math.min(1, stateTimer / SWAP_DUR));
      if (stateTimer >= SWAP_DUR) {
        doSwap(swapFrom, swapTo);
        const groups = findAllMatches();
        if (groups.length) beginMatching(groups);
        else { doSwap(swapFrom, swapTo); setState('SWAP_BACK'); }
        swapT = 0;
      }
      break;
    }
    case 'SWAP_BACK': {
      if (stateTimer >= SWAP_DUR * 0.7) {
        swapFrom = swapTo = null; selected = null; setState('IDLE');
        stability = Math.max(60, stability - 1.2); // failed swap destabilizes
      }
      break;
    }
    case 'MATCHING': {
      matchT = Math.min(1, stateTimer / MATCH_DUR);
      matchedSet.forEach(k => {
        const [c, r] = k.split(',').map(Number);
        const p = board[r]?.[c];
        if (p) { p.scale = 1 - easeIn(matchT); p.alpha = 1 - easeIn(matchT); }
      });
      if (matchT >= 1) {
        let pts = 0;
        matchGroups.forEach(group => {
          let gpts = group.size * 100 * Math.max(1, combo);
          // match-4+ can trigger a coherence payout
          if (group.size >= 4 && rollCoherence()) {
            gpts *= 2;
            const mid = hexToPixel(group.cells[0].col, group.cells[0].row);
            coherenceBonusFx(mid.x, mid.y);
          }
          pts += gpts;
          let specialIdx = null;
          if (group.size >= 4) specialIdx = Math.floor(group.size / 2);
          group.cells.forEach(({col,row}) => { board[row][col] = null; });
          if (specialIdx !== null) {
            const sc = group.cells[specialIdx];
            const sp = group.size >= 5 ? 'singularity' : 'charged';
            board[sc.row][sc.col] = mkParticle(group.type, sp);
            addLog(`${sp.toUpperCase()} particle generated`, true);
          }
        });
        addPower(pts);
        reactorPower = Math.min(100, reactorPower + pts / 400);
        energyOutput = +(3.42 + reactorPower * 0.05).toFixed(2);
        stability = Math.min(100, stability + matchGroups.length * 0.4);
        coherence = Math.min(100, 96 + reactorPower * 0.04);
        coreTemp = Math.min(9.9, coreTemp + matchGroups.length * 0.15);
        chargeEvent(2 + matchGroups.reduce((s,g)=>s+g.size,0) * 0.7 + combo * 1.2);
        if (levelState === 'playing' && score >= coreTarget) {
          levelState = 'passed';
          document.getElementById('core-bar').classList.add('done');
          showBanner(`CORE ${core} STABILIZED`, 'Reactor power target reached');
          playSound('event');
        }
        if (pts > 0) addText(VW/2, VH/2, `+${pts}`, '#88ffcc', 30);
        updateHUD();
        addLog(`Energy surge +${Math.round(reactorPower)}%`);
        matchGroups = []; matchedSet = new Set(); matchT = 0;
        applyGravity(); fillEmpty();
        setState('FALLING');
      }
      break;
    }
    case 'FALLING': {
      const allDone = fallingCells.every(({col,row}) => !board[row]?.[col]?.falling);
      if (allDone && stateTimer > 80) {
        fallingCells = [];
        setState('CHECKING');
      }
      break;
    }
    case 'CHECKING': {
      const groups = findAllMatches();
      if (groups.length) beginMatching(groups);
      else if (eventCharge >= 100 && levelState === 'playing') triggerCosmicEvent();
      else {
        combo = 0; selected = null; setState('IDLE');
        if (levelState !== 'playing') evaluateCore();
      }
      break;
    }
    case 'EVENT': {
      updateCosmicEvent(dt);
      break;
    }
  }
}

// ── Input ────────────────────────────────────────────────────
canvas.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

function onPointerDown(e) {
  resumeAudio();
  if (gameOver || levelState !== 'playing') return;
  if (gameState !== 'IDLE' && gameState !== 'SELECTED') return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  if (settings.control === 'drag' && !armedAbility) {
    const hex = nearestHex(px, py);
    if (hex && board[hex.row][hex.col]) {
      drag = { from: hex, x: px, y: py, sx: px, sy: py, target: null, moved: false };
      return;
    }
  }
  handleTap(px, py);
}

function onPointerMove(e) {
  parallax.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  parallax.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  drag.x = e.clientX - rect.left; drag.y = e.clientY - rect.top;
  if (Math.hypot(drag.x - drag.sx, drag.y - drag.sy) > 7) drag.moved = true;
  drag.target = null;
  let bd = Infinity;
  for (const n of getNeighbors(drag.from.col, drag.from.row)) {
    const p = hexToPixel(n.col, n.row);
    const d = Math.hypot(drag.x - p.x, drag.y - p.y);
    if (d < HR * 1.15 && d < bd) { bd = d; drag.target = n; }
  }
}

function onPointerUp() {
  if (!drag) return;
  const d = drag; drag = null;
  if (gameState !== 'IDLE' && gameState !== 'SELECTED') return;
  if (d.moved && d.target) {
    selected = null;
    swapFrom = d.from; swapTo = d.target;
    setState('SWAPPING'); playSound('swap');
  } else if (!d.moved) {
    handleTap(d.sx, d.sy);
  }
}

function handleTap(px, py) {
  const hex = nearestHex(px, py);
  if (!hex) { selected = null; setState('IDLE'); return; }

  if (armedAbility) { fireAbility(armedAbility, hex); return; }

  const p = board[hex.row][hex.col];
  if (!p) return;
  if (p.special && gameState === 'IDLE') { activateSpecial(hex); return; }

  if (gameState === 'IDLE' || !selected) {
    selected = hex; setState('SELECTED'); playSound('select');
  } else if (selected.col === hex.col && selected.row === hex.row) {
    selected = null; setState('IDLE');
  } else if (areNeighbors(selected, hex)) {
    swapFrom = selected; swapTo = hex;
    setState('SWAPPING'); playSound('swap');
  } else {
    selected = hex;
  }
}

function activateSpecial(hex) {
  const p = board[hex.row][hex.col];
  if (!p?.special) return;
  board[hex.row][hex.col] = null;
  let gained = 0;
  const origin = hexToPixel(hex.col, hex.row);

  if (p.special === 'charged') {
    [hex, ...getNeighbors(hex.col, hex.row)].forEach(t => {
      if (!board[t.row]?.[t.col]) return;
      const pos = hexToPixel(t.col, t.row);
      addEffect('burst_proton', pos.x, pos.y, {duration:500});
      board[t.row][t.col] = null; gained += 150;
    });
    shake = 4;
    addLog('CHARGED PARTICLE detonated');
  } else if (p.special === 'singularity') {
    const tgt = p.type;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (board[r][c]?.type === tgt) {
        const pos = hexToPixel(c, r);
        addEffect('singularity', pos.x, pos.y, {duration:600});
        board[r][c] = null; gained += 200;
      }
    }
    shake = 5;
    addLog(`SINGULARITY: ${COL_DATA[tgt].name} eliminated`, true);
  }
  if (gained > 0) {
    if (rollCoherence()) { gained *= 2; coherenceBonusFx(origin.x, origin.y); }
    addPower(gained);
    addText(origin.x, origin.y, `+${gained}`, '#ffe9b0', 26);
  }

  chargeEvent(5);
  reactorPower = Math.min(100, reactorPower + 10);
  updateHUD(); playSound('special'); selected = null;
  applyGravity(); fillEmpty(); setState('FALLING');
}

// Ability buttons
document.querySelectorAll('.ability').forEach(el => {
  el.addEventListener('click', () => armAbility(el.dataset.ability));
});
// Cog / drawer
document.getElementById('cog-btn').addEventListener('click', () => {
  document.getElementById('drawer').classList.toggle('open');
  document.getElementById('cog-btn').classList.toggle('open');
});
// Settings
function applySettings() {
  document.body.classList.toggle('light', settings.light);
  theme = settings.light ? THEMES.light : THEMES.dark;
  document.querySelectorAll('.seg-btn[data-vision]').forEach(b =>
    b.classList.toggle('on', (b.dataset.vision === 'white') === settings.light));
  document.querySelectorAll('.seg-btn[data-mode]').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === settings.control));
  try { localStorage.setItem('qr-settings', JSON.stringify(settings)); } catch(e) {}
}
document.querySelectorAll('.seg-btn[data-vision]').forEach(b => b.addEventListener('click', () => {
  settings.light = b.dataset.vision === 'white';
  applySettings();
  addLog(settings.light ? 'Vision: WHITE — laboratory illumination' : 'Vision: DARK — deep-space mode');
}));
document.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.addEventListener('click', () => {
  settings.control = b.dataset.mode;
  applySettings();
  addLog('Control mode: ' + b.dataset.mode.toUpperCase());
}));
// Accordion: only one drawer section open at a time
document.querySelectorAll('.expand-toggle').forEach(h => h.addEventListener('click', () => {
  const body = document.getElementById(h.dataset.acc);
  const wasOpen = body.classList.contains('open');
  document.querySelectorAll('.expand-body').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.expand-toggle').forEach(x => x.classList.remove('open'));
  if (!wasOpen) { body.classList.add('open'); h.classList.add('open'); }
}));
// ── Core (level) flow ────────────────────────────────────────
function startCore(n) {
  core = n;
  gridMode = (n % 2 === 1) ? 'hex' : 'square';
  coreTarget = coreTargetFor(n);
  levelState = 'playing';
  timeLeft = CORE_TIME;
  score = 0; combo = 0; reactorPower = 0;
  stability = 97.6; coherence = 99.2; coreTemp = 4.2; energyOutput = 3.42;
  eventCharge = 0; cosmicEvent = null; effects = [];
  matchGroups = []; matchedSet = new Set(); fallingCells = [];
  selected = null; swapFrom = swapTo = null; drag = null; armedAbility = null;
  shake = 0; gameOver = false;
  Object.assign(abilities, { charged:3, fusion:3, stability:3, lance:3, singularity:1 });
  updateAbilityUI();
  resize();
  initBoard();
  document.getElementById('gameover').classList.remove('show');
  document.getElementById('event-fill').style.width = '0%';
  document.getElementById('event-bar').classList.remove('charged');
  document.getElementById('core-bar').classList.remove('done');
  updateHUD();
  setState('IDLE');
  saveProgress();
  const lattice = gridMode === 'hex' ? 'Hexagonal lattice' : 'Cubic lattice';
  showBanner(`CORE ${n}`, `${lattice} — target ${coreTarget.toLocaleString()} RP`);
  addLog(`CORE ${n} online — ${lattice.toLowerCase()}`, true);
  addLog(`Target: ${coreTarget.toLocaleString()} reactor power`);
}

function evaluateCore() {
  if (gameOver) return;
  if (score >= coreTarget) {
    addLog(`CORE ${core} stabilized at ${score.toLocaleString()} RP`, true);
    showBanner(`CORE ${core} STABILIZED`, `Advancing to Core ${core + 1}`);
    playSound('event');
    core++;
    saveProgress();
    setState('GAMEOVER'); gameOver = true; // freeze input during transition
    setTimeout(() => { startCore(core); }, 2300);
  } else {
    endGame();
  }
}

function endGame() {
  gameOver = true;
  setState('GAMEOVER');
  drag = null; selected = null; armedAbility = null;
  document.querySelectorAll('.ability').forEach(el => el.classList.remove('armed'));
  document.getElementById('go-main').textContent = `Core ${core} Failure`;
  document.getElementById('go-sub').textContent =
    `Reached ${score.toLocaleString()} of ${coreTarget.toLocaleString()} reactor power`;
  document.getElementById('go-score').textContent = totalPower.toLocaleString();
  document.getElementById('go-restart').textContent = `RETRY CORE ${core}`;
  document.getElementById('gameover').classList.add('show');
  addLog(`CORE ${core} failure — target missed`, true);
  saveProgress();
  playSound('event');
}
document.getElementById('go-restart').addEventListener('click', () => startCore(core));

// ── Easings ──────────────────────────────────────────────────
function easeOut(t) { return t*(2-t); }
function easeIn(t)  { return t*t; }
function lerp(a, b, t) { return a + (b-a)*t; }

// ── Rendering: background ────────────────────────────────────
function drawBackground() {
  const g = ctx.createRadialGradient(VW/2, VH/2, 0, VW/2, VH/2, Math.max(VW, VH));
  g.addColorStop(0, theme.bgIn); g.addColorStop(1, theme.bgOut);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

  theme.nebula.forEach(([nx,ny,nr,nc]) => {
    const ng = ctx.createRadialGradient(nx*VW, ny*VH, 0, nx*VW, ny*VH, nr*VW);
    ng.addColorStop(0, nc); ng.addColorStop(1, 'transparent');
    ctx.fillStyle = ng; ctx.fillRect(0, 0, VW, VH);
  });

  // Starfield with mouse parallax (deeper stars move less)
  stars.forEach(s => {
    const blink = 0.6 + 0.4 * Math.sin(time * 0.001 * s.speed + s.phase);
    const depth = s.size / 1.9;
    const ox = -parallax.x * 14 * depth, oy = -parallax.y * 10 * depth;
    ctx.globalAlpha = s.brightness * blink;
    ctx.fillStyle = `rgb(${theme.star})`;
    ctx.beginPath(); ctx.arc(s.x*VW + ox, s.y*VH + oy, s.size, 0, Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Holographic concentric rings behind the board (mid-depth parallax)
  const cx = VW/2 - parallax.x*7, cy = VH/2 + 10 - parallax.y*5;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    const rr = 160 + i * 130;
    ctx.strokeStyle = `rgba(0,140,255,${theme.ringAlpha - i*0.008})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI*2); ctx.stroke();
  }
  ctx.rotate(time * 0.00006);
  ctx.strokeStyle = `rgba(0,160,255,${theme.ringAlpha + 0.005})`;
  ctx.setLineDash([3, 22]);
  ctx.beginPath(); ctx.arc(0, 0, 300, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  const v = ctx.createRadialGradient(VW/2, VH/2, VH*0.25, VW/2, VH/2, VH*0.9);
  v.addColorStop(0, 'transparent'); v.addColorStop(1, theme.vignette);
  ctx.fillStyle = v; ctx.fillRect(0, 0, VW, VH);
}

// ── Rendering: board ─────────────────────────────────────────
function hexCorner(x, y, r, i) {
  const a = Math.PI/6 + i*Math.PI/3;
  return [x + r*Math.cos(a), y + r*Math.sin(a)];
}

function drawBoard() {
  const sel = (drag && drag.moved) ? drag.from : selected;
  const tgt = (drag && drag.moved) ? drag.target : null;
  const selNeighbors = sel
    ? new Set(getNeighbors(sel.col, sel.row).map(n => `${n.col},${n.row}`))
    : new Set();

  // connection lines
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const pos = hexToPixel(col, row);
    const dirs = gridMode === 'square' ? [[1,0],[0,1]]
      : ((row & 1) ? OFF_DIRS_ODD : OFF_DIRS_EVEN).slice(0,3);
    dirs.forEach(([dc,dr]) => {
      const nc = col+dc, nr = row+dr;
      if (!isValid(nc,nr)) return;
      const np = hexToPixel(nc, nr);
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(np.x, np.y);
      ctx.strokeStyle = theme.line; ctx.lineWidth = 0.5; ctx.stroke();
    });
  }

  // cells
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const isSel = (sel?.col===col && sel?.row===row) || (tgt?.col===col && tgt?.row===row);
    drawHexCell(col, row, isSel,
      selNeighbors.has(`${col},${row}`),
      matchedSet.has(`${col},${row}`));
  }

  // glowing vertex nodes (lattice dots like the concept art)
  ctx.save();
  const nodeAlpha = 0.5 + 0.25 * Math.sin(time * 0.0015);
  ctx.fillStyle = `rgba(${theme.node},${nodeAlpha})`;
  ctx.shadowBlur = 5; ctx.shadowColor = theme.nodeShadow;
  const seen = new Set();
  const nCorners = gridMode === 'square' ? 4 : 6;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const {x, y} = hexToPixel(col, row);
    for (let i = 0; i < nCorners; i++) {
      const [vx, vy] = gridMode === 'square'
        ? [x + (i%2 ? 1 : -1)*HW/2, y + (i<2 ? -1 : 1)*VG/2]
        : hexCorner(x, y, HR, i);
      const key = `${Math.round(vx)},${Math.round(vy)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tw = 0.6 + 0.4 * Math.sin(time*0.002 + vx*0.05 + vy*0.07);
      ctx.globalAlpha = tw;
      ctx.beginPath(); ctx.arc(vx, vy, 1.4, 0, Math.PI*2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawHexCell(col, row, isSel, isNbr, isMatch) {
  const {x, y} = hexToPixel(col, row);
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  if (gridMode === 'square') {
    const s = HW * 0.46, cr = s * 0.22; // rounded square
    ctx.moveTo(-s + cr, -s);
    ctx.arcTo(s, -s, s, s, cr); ctx.arcTo(s, s, -s, s, cr);
    ctx.arcTo(-s, s, -s, -s, cr); ctx.arcTo(-s, -s, s, -s, cr);
    ctx.closePath();
  } else {
    const r = HR * 0.91;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI/6 + i*Math.PI/3;
      i===0 ? ctx.moveTo(r*Math.cos(a), r*Math.sin(a)) : ctx.lineTo(r*Math.cos(a), r*Math.sin(a));
    }
    ctx.closePath();
  }

  ctx.fillStyle = isSel ? 'rgba(0,100,200,0.28)' : isNbr ? 'rgba(0,70,150,0.18)' : isMatch ? 'rgba(0,180,255,0.1)' : theme.cellFill;
  ctx.fill();

  if (isSel) {
    ctx.shadowBlur = 22; ctx.shadowColor = '#00aaff';
    ctx.strokeStyle = 'rgba(0,210,255,0.95)'; ctx.lineWidth = 1.8;
  } else if (isMatch) {
    ctx.shadowBlur = 14; ctx.shadowColor = '#00ccff';
    ctx.strokeStyle = `rgba(0,200,255,${0.5+0.5*Math.sin(time*0.008)})`; ctx.lineWidth = 1.2;
  } else if (isNbr) {
    ctx.strokeStyle = 'rgba(0,150,220,0.45)'; ctx.lineWidth = 1;
  } else {
    ctx.strokeStyle = theme.cellStroke; ctx.lineWidth = 0.7;
  }
  ctx.stroke();
  ctx.restore();
}

// ── Rendering: particles ─────────────────────────────────────
function drawAllParticles() {
  const dragging = drag && drag.moved;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (dragging && col === drag.from.col && row === drag.from.row) continue;
    const p = board[row]?.[col];
    if (!p || p.alpha <= 0.01) continue;
    let {x, y} = hexToPixel(col, row);

    if (swapFrom && swapTo) {
      if (col===swapFrom.col && row===swapFrom.row) {
        const t2 = hexToPixel(swapTo.col, swapTo.row);
        x = lerp(x, t2.x, swapT); y = lerp(y, t2.y, swapT);
      } else if (col===swapTo.col && row===swapTo.row) {
        const t2 = hexToPixel(swapFrom.col, swapFrom.row);
        x = lerp(x, t2.x, swapT); y = lerp(y, t2.y, swapT);
      }
    }
    if (p.falling) y = lerp(p.fallFromY, p.fallTargetY, easeOut(p.fallProgress));

    // Black hole pull distortion
    if (cosmicEvent?.type === 'blackhole' && !cosmicEvent.cleared) {
      const bh = hexToPixel(cosmicEvent.cell.col, cosmicEvent.cell.row);
      const prog = cosmicEvent.t / EVENT_DUR.blackhole;
      const dx = bh.x - x, dy = bh.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist < HR * 6 && dist > 1) {
        const pull = Math.min(1, prog / 0.6) * Math.max(0, 1 - dist/(HR*6)) * HR * 1.2;
        x += dx/dist * pull; y += dy/dist * pull;
      }
    }
    drawParticle(p, x, y, HR, time);
  }

  // Dragged particle rides the pointer with a magnetic snap toward valid targets
  if (dragging) {
    const p = board[drag.from.row][drag.from.col];
    if (p) {
      const o = hexToPixel(drag.from.col, drag.from.row);
      let dx = drag.x, dy = drag.y;
      const ddx = dx - o.x, ddy = dy - o.y, dd = Math.hypot(ddx, ddy);
      const maxD = HW * 1.4;
      if (dd > maxD) { dx = o.x + ddx/dd*maxD; dy = o.y + ddy/dd*maxD; }
      if (drag.target) {
        const tp = hexToPixel(drag.target.col, drag.target.row);
        const td = Math.hypot(dx - tp.x, dy - tp.y);
        const pull = Math.max(0, 1 - td/(HR*1.15)) * 0.6;
        dx = lerp(dx, tp.x, pull); dy = lerp(dy, tp.y, pull);
        // magnetic field lines between particle and snap target
        ctx.save();
        ctx.globalAlpha = pull;
        ctx.strokeStyle = 'rgba(0,220,255,0.7)'; ctx.lineWidth = 1;
        ctx.shadowBlur = 8; ctx.shadowColor = '#0cf';
        ctx.beginPath();
        ctx.moveTo(dx, dy); ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.shadowBlur = 28; ctx.shadowColor = 'rgba(0,200,255,0.85)';
      drawParticle(p, dx, dy, HR * 1.12, time);
      ctx.restore();
    }
  }
}

function drawParticle(p, x, y, radius, t) {
  const r = radius * 0.7 * p.scale;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.translate(x, y);
  if (p.special) drawSpecialOverlayBase(p, r, t);
  else drawByType(p.type, p, r, t);
  ctx.restore();
}

function drawByType(type, p, r, t) {
  switch (type) {
    case PT.ELECTRON: drawElectron(p, r, t); break;
    case PT.PROTON:   drawProton(p, r, t); break;
    case PT.NEUTRON:  drawNeutron(p, r, t); break;
    case PT.PHOTON:   drawPhoton(p, r, t); break;
    case PT.PRIME:    drawPrime(p, r, t); break;
  }
}

function drawElectron(p, r, t) {
  const rot = p.rot + t * 0.0012, ph = p.phase;
  ctx.shadowBlur = r*0.55; ctx.shadowColor = '#0044ff';
  const g = ctx.createRadialGradient(0,0,0,0,0,r*0.6);
  g.addColorStop(0,'#bbddff'); g.addColorStop(0.5,'#44aaff'); g.addColorStop(1,'rgba(0,60,180,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0,r*0.6,0,Math.PI*2); ctx.fill();

  ctx.save(); ctx.rotate(rot);
  ctx.shadowBlur=r*0.25; ctx.shadowColor='#44aaff';
  ctx.strokeStyle='rgba(100,200,255,0.88)'; ctx.lineWidth=Math.max(0.9, r*0.05);
  ctx.beginPath(); ctx.ellipse(0,0,r*0.92,r*0.28,0,0,Math.PI*2); ctx.stroke();
  const ea = t*0.003+ph;
  ctx.fillStyle='#fff'; ctx.shadowBlur=r*0.3;
  ctx.beginPath(); ctx.arc(r*0.92*Math.cos(ea), r*0.28*Math.sin(ea), Math.max(1.3, r*0.08), 0, Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.save(); ctx.rotate(-rot*0.7+1.2);
  ctx.strokeStyle='rgba(80,150,255,0.55)'; ctx.lineWidth=Math.max(0.7, r*0.033);
  ctx.beginPath(); ctx.ellipse(0,0,r*0.78,r*0.22,Math.PI/3,0,Math.PI*2); ctx.stroke();
  ctx.restore();
  ctx.shadowBlur=0;
}

function drawProton(p, r, t) {
  const rot = p.rot + t*0.0008;
  ctx.save(); ctx.rotate(rot);
  ctx.shadowBlur=r*0.55; ctx.shadowColor='#ff8800';
  ctx.strokeStyle='rgba(255,200,60,0.9)'; ctx.lineWidth=Math.max(0.9, r*0.05);
  ctx.beginPath();
  for(let i=0;i<6;i++){const a=i*Math.PI/3; i===0?ctx.moveTo(r*0.92*Math.cos(a),r*0.92*Math.sin(a)):ctx.lineTo(r*0.92*Math.cos(a),r*0.92*Math.sin(a));}
  ctx.closePath(); ctx.stroke();
  ctx.rotate(Math.PI/6);
  ctx.strokeStyle='rgba(255,180,40,0.38)'; ctx.lineWidth=Math.max(0.6, r*0.025);
  ctx.beginPath();
  for(let i=0;i<6;i++){const a=i*Math.PI/3; i===0?ctx.moveTo(r*0.52*Math.cos(a),r*0.52*Math.sin(a)):ctx.lineTo(r*0.52*Math.cos(a),r*0.52*Math.sin(a));}
  ctx.closePath(); ctx.stroke();
  ctx.restore();
  const g=ctx.createRadialGradient(0,0,0,0,0,r*0.52);
  g.addColorStop(0,'#fff'); g.addColorStop(0.35,'#ffee88'); g.addColorStop(0.7,'#ff9900'); g.addColorStop(1,'rgba(255,60,0,0)');
  ctx.shadowBlur=r*0.8; ctx.shadowColor='#ffaa00';
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,r*0.52,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
}

function drawNeutron(p, r, t) {
  const pulse = 1 + 0.05*Math.sin(t*0.002+p.phase);
  ctx.save(); ctx.rotate(p.rot + t*0.0005);
  ctx.shadowBlur=r*0.37; ctx.shadowColor='#8899bb';
  ctx.strokeStyle='rgba(180,210,240,0.8)'; ctx.fillStyle='rgba(100,150,200,0.1)';
  ctx.lineWidth=Math.max(0.8, r*0.04);
  ctx.beginPath();
  ctx.moveTo(0,-r*0.88*pulse); ctx.lineTo(r*0.72*pulse,0); ctx.lineTo(0,r*0.88*pulse); ctx.lineTo(-r*0.72*pulse,0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle='rgba(200,220,255,0.4)'; ctx.lineWidth=Math.max(0.5, r*0.022);
  ctx.beginPath(); ctx.moveTo(0,-r*0.88*pulse); ctx.lineTo(0,r*0.88*pulse);
  ctx.moveTo(-r*0.72*pulse,0); ctx.lineTo(r*0.72*pulse,0); ctx.stroke();
  ctx.restore();
  const g=ctx.createRadialGradient(0,0,0,0,0,r*0.42);
  g.addColorStop(0,'#eef5ff'); g.addColorStop(0.5,'#99bbcc'); g.addColorStop(1,'rgba(60,100,140,0)');
  ctx.shadowBlur=r*0.3; ctx.shadowColor='#aabbcc';
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,r*0.42,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
}

function drawPhoton(p, r, t) {
  const off = t*0.004+p.phase, w=r*1.75, h=r*0.33;
  ctx.shadowBlur=r*0.55; ctx.shadowColor='#ffaa00';
  ctx.strokeStyle='rgba(255,220,40,0.94)'; ctx.lineWidth=Math.max(1.1, r*0.065);
  ctx.beginPath();
  for(let i=0;i<=50;i++){const px=-w/2+w*i/50, py=h*Math.sin((i/50)*Math.PI*3.5+off); i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
  ctx.stroke();
  ctx.shadowBlur=r*0.3;
  for(let i=0;i<5;i++){
    const frac=(i/5+((t*0.003+p.phase*0.1)%1))%1;
    const dx=-w/2+w*frac, dy=h*Math.sin(frac*Math.PI*3.5+off);
    const a=0.4+0.6*Math.sin(t*0.006+i*1.5);
    ctx.globalAlpha=p.alpha*a; ctx.fillStyle='#fffbe0';
    ctx.beginPath(); ctx.arc(dx,dy,Math.max(1.4, r*0.09),0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=p.alpha; ctx.shadowBlur=0;
}

function drawPrime(p, r, t) {
  const rot = p.rot+t*0.001;
  ctx.save(); ctx.rotate(rot);
  ctx.shadowBlur=r*0.7; ctx.shadowColor='#7700ee';
  ctx.strokeStyle='rgba(160,60,255,0.92)'; ctx.lineWidth=Math.max(0.9, r*0.05);
  for(let i=0;i<6;i++){const a=i*Math.PI/3; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(r*0.9*Math.cos(a),r*0.9*Math.sin(a)); ctx.stroke();}
  ctx.save(); ctx.rotate(-rot*2);
  ctx.shadowBlur=r*0.55; ctx.shadowColor='#00ccff';
  ctx.strokeStyle='rgba(0,200,255,0.9)'; ctx.lineWidth=Math.max(0.9, r*0.05);
  ctx.beginPath();
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3+Math.PI/6; i===0?ctx.moveTo(r*0.55*Math.cos(a),r*0.55*Math.sin(a)):ctx.lineTo(r*0.55*Math.cos(a),r*0.55*Math.sin(a));}
  ctx.closePath(); ctx.stroke();
  ctx.restore(); ctx.restore();
  const g=ctx.createRadialGradient(0,0,0,0,0,r*0.38);
  g.addColorStop(0,'#cc88ff'); g.addColorStop(0.4,'#8800ff'); g.addColorStop(1,'rgba(80,0,150,0)');
  ctx.shadowBlur=r*0.63; ctx.shadowColor='#aa44ff';
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(0,0,r*0.38,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
}

function drawSpecialOverlayBase(p, r, t) {
  drawByType(p.type, p, r*0.72, t);
  ctx.save(); ctx.rotate(t*0.0018);
  const pulse = 1+0.15*Math.sin(t*0.005+p.phase);
  if (p.special === 'charged') {
    ctx.shadowBlur=22; ctx.shadowColor='#ff8800';
    ctx.strokeStyle='rgba(255,180,30,0.92)'; ctx.lineWidth=2;
    for(let i=0;i<4;i++){const a=i*Math.PI/2;
      ctx.beginPath(); ctx.moveTo(r*0.55*Math.cos(a),r*0.55*Math.sin(a));
      ctx.lineTo(r*1.18*pulse*Math.cos(a),r*1.18*pulse*Math.sin(a)); ctx.stroke();}
    ctx.beginPath(); ctx.arc(0,0,r*1.12*pulse,0,Math.PI*2);
    ctx.strokeStyle='rgba(255,140,0,0.45)'; ctx.lineWidth=1; ctx.stroke();
  } else if (p.special === 'singularity') {
    ctx.shadowBlur=28; ctx.shadowColor='#8800ff';
    for(let i=0;i<3;i++){
      const a=i*Math.PI*2/3+t*0.003;
      ctx.strokeStyle=`rgba(${140+i*30},0,${255-i*50},0.88)`; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,r*(0.65+i*0.22)*pulse,a,a+Math.PI*1.3); ctx.stroke();}
    ctx.beginPath(); ctx.arc(0,0,r*1.25*pulse,0,Math.PI*2);
    ctx.strokeStyle='rgba(0,200,255,0.55)'; ctx.lineWidth=1; ctx.stroke();
  }
  ctx.restore();
}

// ── Rendering: effects ───────────────────────────────────────
function drawEffects() {
  effects.forEach(e => {
    const prog = e.t/e.maxT, inv = 1-prog;
    ctx.save();
    switch(e.type) {
      case 'burst_electron': {
        ctx.globalAlpha=inv;
        ctx.shadowBlur=20; ctx.shadowColor='#44aaff';
        for(let i=0;i<8;i++){
          const a=i*Math.PI/4, len=HR*prog*2;
          ctx.strokeStyle=`rgba(80,180,255,${inv})`;
          ctx.lineWidth=2.5-prog*2;
          ctx.beginPath(); ctx.moveTo(e.x,e.y);
          const mx=e.x+len*0.55*Math.cos(a)+(Math.random()-0.5)*12;
          const my=e.y+len*0.55*Math.sin(a)+(Math.random()-0.5)*12;
          ctx.bezierCurveTo(mx,my,mx,my,e.x+len*Math.cos(a),e.y+len*Math.sin(a)); ctx.stroke();}
        break;
      }
      case 'burst_proton': {
        ctx.globalAlpha=inv; ctx.shadowBlur=28; ctx.shadowColor='#ff8800';
        ctx.strokeStyle=`rgba(255,${170+60*inv},0,${inv})`; ctx.lineWidth=3.5*inv;
        ctx.beginPath(); ctx.arc(e.x,e.y,HR*prog*2.6,0,Math.PI*2); ctx.stroke();
        for(let i=0;i<7;i++){const a=i*Math.PI*2/7, sp=prog*HR*2.2;
          ctx.fillStyle=`rgba(255,200,50,${inv})`;
          ctx.beginPath(); ctx.arc(e.x+sp*Math.cos(a),e.y+sp*Math.sin(a),3.5*inv,0,Math.PI*2); ctx.fill();}
        break;
      }
      case 'burst_neutron': {
        ctx.globalAlpha=inv*0.85; ctx.shadowBlur=14; ctx.shadowColor='#aabbcc';
        ctx.strokeStyle=`rgba(190,215,245,${inv})`; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(e.x,e.y,HR*prog*2.2,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle=`rgba(210,230,255,${inv*0.35})`; ctx.lineWidth=8*inv;
        ctx.beginPath(); ctx.arc(e.x,e.y,HR*prog*1.2,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'burst_photon': {
        ctx.globalAlpha=inv; ctx.shadowBlur=22; ctx.shadowColor='#ffaa00';
        ctx.strokeStyle=`rgba(255,220,50,${inv})`; ctx.lineWidth=3.5*inv;
        const blen=Math.max(VW,VH)*prog*0.8;
        [0,Math.PI/2,Math.PI,Math.PI*1.5].forEach(a=>{
          ctx.beginPath(); ctx.moveTo(e.x,e.y); ctx.lineTo(e.x+blen*Math.cos(a),e.y+blen*Math.sin(a)); ctx.stroke();});
        break;
      }
      case 'burst_prime': {
        ctx.globalAlpha=inv; ctx.shadowBlur=32; ctx.shadowColor='#8800ff';
        for(let ring=0;ring<3;ring++){
          const rr=HR*(0.3+ring*0.45)*(0.4+prog*1.6);
          ctx.strokeStyle=`rgba(${160-ring*45},0,${255-ring*55},${inv*(1-ring*0.2)})`; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(e.x,e.y,rr,0,Math.PI*2); ctx.stroke();}
        break;
      }
      case 'lightning': {
        ctx.globalAlpha=inv; ctx.shadowBlur=14; ctx.shadowColor=e.color;
        ctx.strokeStyle=e.color; ctx.lineWidth=2.2*inv;
        const segs=8;
        ctx.beginPath(); ctx.moveTo(e.x1,e.y1);
        for(let i=1;i<segs;i++){
          const t2=i/segs;
          ctx.lineTo(lerp(e.x1,e.x2,t2)+(Math.random()-0.5)*22, lerp(e.y1,e.y2,t2)+(Math.random()-0.5)*22);}
        ctx.lineTo(e.x2,e.y2); ctx.stroke();
        break;
      }
      case 'laser_h': {
        ctx.globalAlpha=inv*0.92; ctx.shadowBlur=28; ctx.shadowColor='#ffcc00';
        ctx.strokeStyle=`rgba(255,220,50,${inv})`; ctx.lineWidth=4*inv;
        ctx.beginPath(); ctx.moveTo(0,e.y); ctx.lineTo(VW,e.y); ctx.stroke();
        ctx.lineWidth=14*inv; ctx.strokeStyle=`rgba(255,240,160,${inv*0.3})`; ctx.stroke();
        break;
      }
      case 'singularity': {
        ctx.globalAlpha=inv; ctx.shadowBlur=38; ctx.shadowColor='#aa00ff';
        const sr=HR*0.6*Math.sin(prog*Math.PI);
        const sg=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,sr*3.5);
        sg.addColorStop(0,`rgba(0,0,0,${inv})`); sg.addColorStop(0.5,`rgba(70,0,140,${inv*0.7})`); sg.addColorStop(1,'transparent');
        ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(e.x,e.y,sr*3.5,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=`rgba(180,50,255,${inv})`; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(e.x,e.y,Math.max(1,sr),0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'supernova_ring': {
        ctx.globalAlpha=inv; ctx.shadowBlur=30; ctx.shadowColor='#ffaa44';
        ctx.strokeStyle=`rgba(255,210,120,${inv})`; ctx.lineWidth=5*inv;
        ctx.beginPath(); ctx.arc(e.x,e.y,HR*prog*5,0,Math.PI*2); ctx.stroke();
        ctx.strokeStyle=`rgba(255,255,220,${inv*0.5})`; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(e.x,e.y,HR*prog*3.4,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'floatText': {
        ctx.globalAlpha=inv;
        ctx.font=`600 ${e.size}px Bahnschrift, 'Segoe UI', sans-serif`;
        ctx.textAlign='center'; ctx.fillStyle=e.color;
        ctx.shadowBlur=18; ctx.shadowColor=e.color;
        ctx.fillText(e.text, e.x, e.y - prog*70);
        break;
      }
    }
    ctx.restore();
  });
}

// ── Rendering: cosmic event visuals ──────────────────────────
function drawCosmicEvent() {
  if (!cosmicEvent) return;
  const ev = cosmicEvent;
  const dur = EVENT_DUR[ev.type];
  const prog = Math.min(1, ev.t / dur);
  const {x, y} = hexToPixel(ev.cell.col, ev.cell.row);
  ctx.save();

  if (ev.type === 'blackhole') {
    const grow = Math.sin(Math.min(prog/0.6,1) * Math.PI/2);
    const fade = prog > 0.75 ? (1-prog)/0.25 : 1;
    const R = HR * 1.6 * grow;
    ctx.globalAlpha = fade;
    // accretion disk
    ctx.save(); ctx.translate(x,y); ctx.rotate(ev.t*0.004);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(${190-i*40},${90+i*30},255,${0.7*fade})`;
      ctx.lineWidth = 2.5 - i*0.6;
      ctx.shadowBlur = 24; ctx.shadowColor = '#a050ff';
      ctx.beginPath(); ctx.ellipse(0,0,R*(1.3+i*0.5),R*(0.42+i*0.18),i*0.5,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
    // event horizon
    const bg = ctx.createRadialGradient(x,y,0,x,y,R*1.1);
    bg.addColorStop(0,'#000'); bg.addColorStop(0.75,'#000');
    bg.addColorStop(0.92,`rgba(140,60,255,${0.9*fade})`); bg.addColorStop(1,'transparent');
    ctx.fillStyle = bg;
    ctx.shadowBlur = 36; ctx.shadowColor = '#8030ff';
    ctx.beginPath(); ctx.arc(x,y,R*1.1,0,Math.PI*2); ctx.fill();
    // infall streaks
    ctx.shadowBlur = 8;
    for (let i = 0; i < 10; i++) {
      const a = i*Math.PI/5 + ev.t*0.005;
      const d1 = R*(3.6 - 2.2*((ev.t*0.001+i*0.37)%1));
      ctx.strokeStyle = `rgba(160,200,255,${0.4*fade})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, d1, a, a+0.45); ctx.stroke();
    }
  } else if (ev.type === 'neutronstar') {
    const flash = prog < 0.45 ? prog/0.45 : 1;
    const fade = prog > 0.8 ? (1-prog)/0.2 : 1;
    ctx.globalAlpha = fade;
    // star core
    const R = HR*(0.5 + 0.45*flash) * (1 + 0.08*Math.sin(ev.t*0.03));
    const sg = ctx.createRadialGradient(x,y,0,x,y,R*2.4);
    sg.addColorStop(0,'#ffffff'); sg.addColorStop(0.25,'#cfeaff');
    sg.addColorStop(0.6,`rgba(90,170,255,0.5)`); sg.addColorStop(1,'transparent');
    ctx.fillStyle = sg; ctx.shadowBlur = 44; ctx.shadowColor = '#bfe2ff';
    ctx.beginPath(); ctx.arc(x,y,R*2.4,0,Math.PI*2); ctx.fill();
    // pulsar beams along 3 hex axes after firing
    if (prog > 0.4) {
      const bi = Math.min(1,(prog-0.4)/0.15);
      ctx.lineCap = 'round';
      for (let axis = 0; axis < 3; axis++) {
        const a = axis*Math.PI/3 + Math.PI/6;
        const L = Math.max(VW, VH) * bi;
        ctx.strokeStyle = `rgba(220,240,255,${0.85*fade})`;
        ctx.lineWidth = 4; ctx.shadowBlur = 26; ctx.shadowColor = '#aaddff';
        ctx.beginPath();
        ctx.moveTo(x-L*Math.cos(a), y-L*Math.sin(a));
        ctx.lineTo(x+L*Math.cos(a), y+L*Math.sin(a)); ctx.stroke();
        ctx.strokeStyle = `rgba(140,200,255,${0.3*fade})`; ctx.lineWidth = 12;
        ctx.stroke();
      }
    }
  } else if (ev.type === 'supernova') {
    if (prog < 0.5) {
      // collapse: star shrinks and brightens
      const ip = prog/0.5;
      const R = HR*(1.6 - 1.1*ip);
      const sg = ctx.createRadialGradient(x,y,0,x,y,R*2);
      sg.addColorStop(0,'#fff'); sg.addColorStop(0.4,'#ffd890');
      sg.addColorStop(1,'transparent');
      ctx.fillStyle = sg; ctx.shadowBlur = 30+ip*40; ctx.shadowColor = '#ffcc66';
      ctx.beginPath(); ctx.arc(x,y,R*2,0,Math.PI*2); ctx.fill();
    } else {
      // detonation: expanding shells + screen flash
      const ep = (prog-0.5)/0.5;
      const flash = Math.max(0, 1 - ep*2.5);
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,240,210,${flash*0.5})`;
        ctx.fillRect(0,0,VW,VH);
      }
      for (let s = 0; s < 3; s++) {
        const rr = HR * (1 + ep*9) * (1 - s*0.18);
        ctx.strokeStyle = `rgba(255,${200-s*35},${110-s*30},${(1-ep)*(1-s*0.25)})`;
        ctx.lineWidth = 4-s; ctx.shadowBlur = 28; ctx.shadowColor = '#ff9944';
        ctx.beginPath(); ctx.arc(x,y,rr,0,Math.PI*2); ctx.stroke();
      }
      // ejecta
      for (let i = 0; i < 14; i++) {
        const a = i*Math.PI*2/14 + (i%2)*0.2;
        const d = HR*(1+ep*8.4);
        ctx.fillStyle = `rgba(255,210,140,${1-ep})`;
        ctx.beginPath(); ctx.arc(x+d*Math.cos(a), y+d*Math.sin(a), 3*(1-ep)+1, 0, Math.PI*2); ctx.fill();
      }
    }
  } else if (ev.type === 'quantumstorm') {
    // ambient storm glow + drifting energy filaments
    const fade = prog > 0.85 ? (1-prog)/0.15 : Math.min(1, prog/0.15);
    ctx.globalAlpha = fade * 0.5;
    const sg = ctx.createLinearGradient(0,0,0,VH*0.5);
    sg.addColorStop(0, 'rgba(80,150,255,0.16)'); sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg; ctx.fillRect(0,0,VW,VH*0.5);
    ctx.globalAlpha = fade;
    for (let i = 0; i < 4; i++) {
      const fx = (Math.sin(ev.t*0.0008+i*2.1)*0.5+0.5)*VW;
      ctx.strokeStyle = `rgba(150,210,255,${0.18*fade})`;
      ctx.lineWidth = 1;
      ctx.shadowBlur = 10; ctx.shadowColor = '#88ccff';
      ctx.beginPath();
      ctx.moveTo(fx, 0);
      for (let yy = 0; yy < VH; yy += 40) {
        ctx.lineTo(fx + Math.sin(yy*0.02 + ev.t*0.003+i)*30, yy);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Rendering: reactor core ──────────────────────────────────
function drawReactorCore() {
  const cx = Math.floor(COLS/2), cy = Math.floor(ROWS/2);
  const {x, y} = hexToPixel(cx, cy);
  const pw = reactorPower/100, t = time;
  ctx.save(); ctx.translate(x, y);
  const baseR = HR*0.58;
  const pulse = 1+0.1*Math.sin(t*0.003);

  ctx.shadowBlur=20+pw*25; ctx.shadowColor=`rgba(0,${140+pw*115},255,0.7)`;
  ctx.strokeStyle=`rgba(0,${140+pw*80},255,${0.25+pw*0.45})`; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(0,0,baseR*1.9*pulse,0,Math.PI*2); ctx.stroke();

  ctx.save(); ctx.rotate(t*0.0012*(1+pw));
  for(let i=0;i<6;i++){const a=i*Math.PI/3;
    ctx.strokeStyle=`rgba(0,${180+pw*60},255,${0.35+pw*0.35})`; ctx.lineWidth=1.8;
    ctx.beginPath(); ctx.arc(0,0,baseR*1.45,a,a+Math.PI*0.28); ctx.stroke();}
  ctx.restore();

  ctx.save(); ctx.rotate(-t*0.0018*(1+pw*0.7));
  for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4;
    ctx.strokeStyle=`rgba(${80+pw*120},40,255,${0.28+pw*0.32})`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(0,0,baseR*0.95,a,a+Math.PI*0.35); ctx.stroke();}
  ctx.restore();

  const cg=ctx.createRadialGradient(0,0,0,0,0,baseR*0.75);
  cg.addColorStop(0,`rgba(${80+pw*175},${200-pw*50},255,${0.12+pw*0.22})`);
  cg.addColorStop(1,'transparent');
  ctx.fillStyle=cg; ctx.beginPath(); ctx.arc(0,0,baseR*0.75,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ── Reactor mini (drawer) ────────────────────────────────────
function drawReactorMini() {
  if (!document.getElementById('drawer').classList.contains('open')) return;
  const mc = document.getElementById('reactor-mini');
  const c = mc.getContext('2d');
  const t=time, pw=reactorPower/100;
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,mc.width,mc.height);
  c.setTransform(2,0,0,2,0,0); // 2x backing store for sharpness
  const w=mc.width/2, h=mc.height/2;
  const cx=w/2, cy=h/2;

  c.save(); c.translate(cx,cy); c.rotate(t*0.001);
  c.shadowBlur=10; c.shadowColor='#0af';
  c.strokeStyle=`rgba(0,180,255,${0.35+pw*0.45})`; c.lineWidth=1.5;
  c.beginPath(); c.arc(0,0,52,0,Math.PI*2); c.stroke();
  for(let i=0;i<6;i++){const a=i*Math.PI/3;
    c.strokeStyle=`rgba(0,200,255,${0.6+pw*0.4})`; c.lineWidth=2.5;
    c.beginPath(); c.arc(0,0,52,a,a+Math.PI/4.5); c.stroke();}
  c.restore();

  c.save(); c.translate(cx,cy); c.rotate(-t*0.002);
  c.strokeStyle=`rgba(${70+pw*130},40,255,${0.45+pw*0.35})`; c.lineWidth=1;
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;
    c.beginPath(); c.arc(0,0,34,a,a+Math.PI*0.55); c.stroke();}
  c.restore();

  c.save(); c.translate(cx,cy);
  const cg=c.createRadialGradient(0,0,0,0,0,22);
  cg.addColorStop(0,`rgba(${140+pw*115},${220-pw*60},255,${0.75+pw*0.25})`);
  cg.addColorStop(0.5,`rgba(0,${90+pw*110},255,0.5)`); cg.addColorStop(1,'transparent');
  c.fillStyle=cg; c.shadowBlur=18; c.shadowColor='#0af';
  c.beginPath(); c.arc(0,0,22,0,Math.PI*2); c.fill();

  c.strokeStyle=`rgba(0,200,255,${0.18+pw*0.65})`; c.lineWidth=4;
  c.beginPath(); c.arc(0,0,64,-Math.PI/2,-Math.PI/2+pw*Math.PI*2); c.stroke();

  c.font='600 12px Bahnschrift, sans-serif'; c.textAlign='center';
  c.fillStyle=`rgba(0,${180+pw*75},255,${0.55+pw*0.45})`;
  c.shadowBlur=6; c.shadowColor='#0af';
  c.fillText(`${Math.round(reactorPower)}%`, 0, 4);
  c.restore();
}

// ── HUD icons (animated) ─────────────────────────────────────
function drawHudIcons() {
  const t = time;
  // stability: atom
  iconCanvas('hi-stability', c => {
    c.strokeStyle='rgba(120,210,255,0.9)'; c.lineWidth=2; c.shadowBlur=6; c.shadowColor='#0af';
    for (let i=0;i<3;i++){ c.save(); c.rotate(i*Math.PI/3 + t*0.001); c.beginPath(); c.ellipse(0,0,22,8,0,0,Math.PI*2); c.stroke(); c.restore(); }
    c.fillStyle='#cfeaff'; c.beginPath(); c.arc(0,0,4,0,Math.PI*2); c.fill();
  });
  // energy: pulse waveform
  iconCanvas('hi-energy', c => {
    c.strokeStyle='rgba(255,210,80,0.95)'; c.lineWidth=2.4; c.shadowBlur=7; c.shadowColor='#fa0';
    c.beginPath();
    const pts=[-26,-18,-12,-6,0,6,12,18,26];
    const hs=[0,0,-6,16,-22,16,-6,0,0];
    pts.forEach((px,i)=>{ const hh=hs[i]*(0.7+0.3*Math.sin(t*0.005)); i===0?c.moveTo(px,hh):c.lineTo(px,hh); });
    c.stroke();
  });
  // coherence: snowflake / lattice
  iconCanvas('hi-coherence', c => {
    c.strokeStyle='rgba(160,225,255,0.9)'; c.lineWidth=1.8; c.shadowBlur=6; c.shadowColor='#0cf';
    c.rotate(t*0.0004);
    for(let i=0;i<6;i++){ c.save(); c.rotate(i*Math.PI/3);
      c.beginPath(); c.moveTo(0,0); c.lineTo(0,-22); c.moveTo(0,-13); c.lineTo(-5,-18); c.moveTo(0,-13); c.lineTo(5,-18); c.stroke(); c.restore(); }
  });
  // temp: thermal rings
  iconCanvas('hi-temp', c => {
    c.strokeStyle='rgba(140,220,255,0.85)'; c.lineWidth=1.8; c.shadowBlur=6; c.shadowColor='#0cf';
    for(let i=0;i<3;i++){ const rr=8+i*7, a=t*0.002*(i%2?-1:1);
      c.beginPath(); c.arc(0,0,rr,a,a+Math.PI*1.4); c.stroke(); }
    c.fillStyle='#bfe6ff'; c.beginPath(); c.arc(0,0,3,0,Math.PI*2); c.fill();
  });
  // score: target rings
  iconCanvas('hi-score', c => {
    c.strokeStyle='rgba(255,225,140,0.9)'; c.lineWidth=2; c.shadowBlur=7; c.shadowColor='#fc6';
    c.beginPath(); c.arc(0,0,20,0,Math.PI*2); c.stroke();
    c.lineWidth=1.2; c.beginPath(); c.arc(0,0,12,0,Math.PI*2); c.stroke();
    const pp = 0.85+0.15*Math.sin(t*0.004);
    c.fillStyle='#fff3cf'; c.beginPath(); c.arc(0,0,5*pp,0,Math.PI*2); c.fill();
  });
}

function iconCanvas(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = el.getContext('2d');
  c.clearRect(0,0,el.width,el.height);
  c.save(); c.translate(el.width/2, el.height/2);
  fn(c);
  c.restore();
}

// ── Ability icons (static-ish, drawn once per second) ────────
function drawAbilityIcons() {
  const t = time;
  iconCanvas('ab-charged', c => {
    c.scale(1.7,1.7);
    c.strokeStyle='rgba(120,210,255,0.95)'; c.lineWidth=1.6; c.shadowBlur=5; c.shadowColor='#0af';
    c.rotate(t*0.0008);
    c.beginPath(); c.ellipse(0,0,15,5.5,0,0,Math.PI*2); c.stroke();
    c.beginPath(); c.ellipse(0,0,15,5.5,Math.PI/3,0,Math.PI*2); c.stroke();
    c.fillStyle='#cfeaff'; c.beginPath(); c.arc(0,0,3,0,Math.PI*2); c.fill();
  });
  iconCanvas('ab-fusion', c => {
    c.scale(1.7,1.7);
    c.strokeStyle='rgba(255,200,80,0.95)'; c.lineWidth=1.6; c.shadowBlur=6; c.shadowColor='#fa0';
    c.rotate(t*0.0006);
    for(let i=0;i<8;i++){ c.save(); c.rotate(i*Math.PI/4);
      c.beginPath(); c.moveTo(0,5); c.lineTo(0,15); c.stroke(); c.restore(); }
    c.fillStyle='#ffe9b0'; c.beginPath(); c.arc(0,0,4.5,0,Math.PI*2); c.fill();
  });
  iconCanvas('ab-stability', c => {
    c.scale(1.7,1.7);
    c.strokeStyle='rgba(190,220,250,0.9)'; c.lineWidth=1.4; c.shadowBlur=5; c.shadowColor='#9cf';
    c.beginPath(); c.ellipse(0,2,15,5,0,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(0,-2,6,0,Math.PI*2); c.stroke();
  });
  iconCanvas('ab-lance', c => {
    c.scale(1.7,1.7);
    c.strokeStyle='rgba(255,220,90,0.95)'; c.lineWidth=2; c.shadowBlur=6; c.shadowColor='#fc0';
    c.rotate(-Math.PI/4);
    c.beginPath(); c.moveTo(-13,0); c.lineTo(13,0); c.stroke();
    c.beginPath(); c.moveTo(13,0); c.lineTo(7,-4); c.moveTo(13,0); c.lineTo(7,4); c.stroke();
    c.lineWidth=0.8; c.beginPath(); c.moveTo(-9,4); c.lineTo(2,4); c.stroke();
  });
  iconCanvas('ab-singularity', c => {
    c.scale(1.7,1.7);
    c.shadowBlur=7; c.shadowColor='#a0f';
    c.rotate(t*0.0015);
    for(let i=0;i<3;i++){
      c.strokeStyle=`rgba(${170-i*30},${80+i*40},255,0.9)`; c.lineWidth=1.5;
      c.beginPath(); c.arc(0,0,6+i*4.5,i*2,i*2+Math.PI*1.4); c.stroke(); }
    c.fillStyle='#1a0030'; c.beginPath(); c.arc(0,0,4,0,Math.PI*2); c.fill();
    c.strokeStyle='rgba(200,140,255,0.9)'; c.lineWidth=1; c.stroke();
  });
}

// ── Drawer particle index icons ──────────────────────────────
function drawParticleIcons() {
  if (!document.getElementById('drawer').classList.contains('open')) return;
  const defs = [
    ['pi-electron', drawElectron], ['pi-proton', drawProton],
    ['pi-neutron', drawNeutron], ['pi-photon', drawPhoton], ['pi-prime', drawPrime],
  ];
  defs.forEach(([id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.width !== 60) { el.width = el.height = 60; } // 2x backing for sharpness
  });
  // Render each via the main draw functions on their own contexts
  const fake = {phase:0.5, rot:0.4, scale:1, alpha:1};
  defs.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    const c = el.getContext('2d');
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,60,60);
    c.setTransform(2,0,0,2,0,0);
    c.translate(15,15);
    renderMini(c, fn, fake, 11, time);
  });
}

function renderMini(c, fn, p, r, t) {
  const rot = p.rot+t*0.0008, ph = p.phase;
  if (fn === drawElectron) {
    c.shadowBlur=8; c.shadowColor='#0055ff';
    const g=c.createRadialGradient(0,0,0,0,0,r*0.6);
    g.addColorStop(0,'#bbddff'); g.addColorStop(1,'rgba(0,60,180,0)');
    c.fillStyle=g; c.beginPath(); c.arc(0,0,r*0.6,0,Math.PI*2); c.fill();
    c.save(); c.rotate(t*0.0012);
    c.strokeStyle='rgba(100,200,255,0.88)'; c.lineWidth=1.2;
    c.beginPath(); c.ellipse(0,0,r*0.92,r*0.28,0,0,Math.PI*2); c.stroke();
    c.restore();
  } else if (fn === drawProton) {
    c.save(); c.rotate(rot);
    c.shadowBlur=10; c.shadowColor='#ff8800';
    c.strokeStyle='rgba(255,200,60,0.9)'; c.lineWidth=1.2;
    c.beginPath();
    for(let i=0;i<6;i++){const a=i*Math.PI/3; i===0?c.moveTo(r*0.9*Math.cos(a),r*0.9*Math.sin(a)):c.lineTo(r*0.9*Math.cos(a),r*0.9*Math.sin(a));}
    c.closePath(); c.stroke(); c.restore();
    const g=c.createRadialGradient(0,0,0,0,0,r*0.52);
    g.addColorStop(0,'#fff'); g.addColorStop(1,'rgba(255,100,0,0)');
    c.fillStyle=g; c.beginPath(); c.arc(0,0,r*0.52,0,Math.PI*2); c.fill();
  } else if (fn === drawNeutron) {
    c.save(); c.rotate(rot*0.5);
    c.shadowBlur=7; c.shadowColor='#8899bb';
    c.strokeStyle='rgba(180,210,240,0.82)'; c.lineWidth=1;
    c.beginPath(); c.moveTo(0,-r*0.9); c.lineTo(r*0.72,0); c.lineTo(0,r*0.9); c.lineTo(-r*0.72,0); c.closePath(); c.stroke();
    c.restore();
  } else if (fn === drawPhoton) {
    c.shadowBlur=10; c.shadowColor='#ffaa00';
    c.strokeStyle='rgba(255,220,40,0.92)'; c.lineWidth=1.5;
    const w=r*1.75, h=r*0.32, off=t*0.004+ph;
    c.beginPath();
    for(let i=0;i<=24;i++){const px=-w/2+w*i/24, py=h*Math.sin((i/24)*Math.PI*3.5+off); i===0?c.moveTo(px,py):c.lineTo(px,py);}
    c.stroke();
  } else if (fn === drawPrime) {
    c.save(); c.rotate(t*0.001);
    c.shadowBlur=12; c.shadowColor='#7700ee';
    c.strokeStyle='rgba(160,60,255,0.92)'; c.lineWidth=1.2;
    for(let i=0;i<6;i++){const a=i*Math.PI/3; c.beginPath(); c.moveTo(0,0); c.lineTo(r*0.9*Math.cos(a),r*0.9*Math.sin(a)); c.stroke();}
    c.restore();
    const g=c.createRadialGradient(0,0,0,0,0,r*0.38);
    g.addColorStop(0,'#cc88ff'); g.addColorStop(1,'rgba(80,0,150,0)');
    c.fillStyle=g; c.beginPath(); c.arc(0,0,r*0.38,0,Math.PI*2); c.fill();
  }
}

// ── HUD updates ──────────────────────────────────────────────
function updateHUD() {
  energyOutput = +(3.42 + reactorPower * 0.05).toFixed(2);
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('hv-stability', stability.toFixed(1)+'<span class="hud-unit">%</span>');
  set('hv-energy', energyOutput.toFixed(2)+'<span class="hud-unit">TW</span>');
  set('hv-coherence', coherence.toFixed(1)+'<span class="hud-unit">%</span>');
  set('hv-temp', coreTemp.toFixed(1)+'<span class="hud-unit">K</span>');
  set('hv-score', totalPower.toLocaleString());
  const pw = reactorPower/100;
  const bw = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = v+'%'; };
  bw('bar-em', 50+pw*45); bw('bar-sf', 38+pw*52); bw('bar-wf', 28+pw*56); bw('bar-gv', 18+pw*62);
  // Core progress
  const cl = document.getElementById('core-label');
  if (cl) {
    cl.textContent = `CORE ${core}`;
    document.getElementById('core-fill').style.width = Math.min(100, score / coreTarget * 100) + '%';
    document.getElementById('core-num').textContent =
      `${score.toLocaleString()}/${coreTarget.toLocaleString()}`;
  }
}

function addLog(msg, gold=false) {
  logQueue.push({msg, gold});
  if (logQueue.length > 30) logQueue.shift();
  const el = document.getElementById('sys-log');
  if (el) el.innerHTML = logQueue.slice(-7).map(m =>
    `<div class="log-entry${m.gold?' gold':''}">${m.msg}</div>`).join('');
}

// ── Audio ────────────────────────────────────────────────────
let audio = null;
function initAudio() {
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
function resumeAudio() { if (audio && audio.state === 'suspended') audio.resume(); }

function playSound(type) {
  if (!audio) return;
  try {
    const o=audio.createOscillator(), g=audio.createGain(), f=audio.createBiquadFilter();
    o.connect(f); f.connect(g); g.connect(audio.destination);
    f.type='bandpass'; f.frequency.value=1200; f.Q.value=1.5;
    const now=audio.currentTime;
    switch(type) {
      case 'select':
        o.type='sine'; o.frequency.setValueAtTime(700,now); o.frequency.linearRampToValueAtTime(900,now+0.07);
        g.gain.setValueAtTime(0.1,now); g.gain.linearRampToValueAtTime(0,now+0.1);
        o.start(now); o.stop(now+0.1); break;
      case 'swap':
        o.type='sine'; o.frequency.setValueAtTime(480,now); o.frequency.linearRampToValueAtTime(600,now+0.06);
        g.gain.setValueAtTime(0.08,now); g.gain.linearRampToValueAtTime(0,now+0.09);
        o.start(now); o.stop(now+0.09); break;
      case 'match':
        o.type='sine'; o.frequency.setValueAtTime(520,now); o.frequency.linearRampToValueAtTime(1040,now+0.22);
        g.gain.setValueAtTime(0.18,now); g.gain.linearRampToValueAtTime(0,now+0.32);
        o.start(now); o.stop(now+0.32); break;
      case 'special':
        o.type='sawtooth'; f.frequency.value=800;
        o.frequency.setValueAtTime(180,now); o.frequency.exponentialRampToValueAtTime(720,now+0.3);
        g.gain.setValueAtTime(0.2,now); g.gain.linearRampToValueAtTime(0,now+0.45);
        o.start(now); o.stop(now+0.45); break;
      case 'event': {
        o.type='sine'; f.type='lowpass'; f.frequency.value=600;
        o.frequency.setValueAtTime(70,now); o.frequency.exponentialRampToValueAtTime(220,now+0.8);
        g.gain.setValueAtTime(0.28,now); g.gain.linearRampToValueAtTime(0,now+1.4);
        o.start(now); o.stop(now+1.4);
        const o2=audio.createOscillator(), g2=audio.createGain();
        o2.connect(g2); g2.connect(audio.destination);
        o2.type='sine'; o2.frequency.setValueAtTime(880,now+0.2);
        o2.frequency.exponentialRampToValueAtTime(1760,now+0.7);
        g2.gain.setValueAtTime(0.06,now+0.2); g2.gain.linearRampToValueAtTime(0,now+0.9);
        o2.start(now+0.2); o2.stop(now+0.9); break;
      }
    }
  } catch(e) {}
}

// ── Resize & Init ─────────────────────────────────────────────
function resize() {
  VW = window.innerWidth;
  VH = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';

  // Orientation-aware grid: tall screens get a tall board
  const portrait = VH > VW * 1.05;
  const wantCols = portrait ? 7 : 9, wantRows = portrait ? 9 : 7;
  const dimsChanged = wantCols !== COLS;
  COLS = wantCols; ROWS = wantRows;
  if (dimsChanged && board.length) {
    selected = null; drag = null; swapFrom = swapTo = null;
    matchGroups = []; matchedSet = new Set(); fallingCells = []; effects = [];
    cosmicEvent = null; shake = 0;
    initBoard();
    if (gameState !== 'GAMEOVER') setState('IDLE');
    addLog(portrait ? 'Lattice reconfigured: portrait' : 'Lattice reconfigured: landscape');
  }

  // Measure the real UI chrome instead of assuming margins
  let topEdge = 130, bottomEdge = 120;
  const coreEl = document.getElementById('core-bar');
  const barEl = document.getElementById('bottom-bar');
  if (coreEl && barEl) {
    topEdge = coreEl.getBoundingClientRect().bottom + 14;
    bottomEdge = VH - barEl.getBoundingClientRect().top + 6;
  }
  const sideEdge = Math.max(8, VW * 0.02);
  const freeW = VW - sideEdge*2;
  const freeH = VH - topEdge - bottomEdge;
  let bw, bh;
  if (gridMode === 'square') {
    const cell = Math.max(28, Math.min(104, Math.min(freeW/(COLS+0.3), freeH/(ROWS+0.3)) * 0.99));
    HW = cell; VG = cell; HR = cell * 0.52;
    bw = (COLS-1)*HW; bh = (ROWS-1)*VG;
  } else {
    HR = Math.min(freeW/((COLS+0.5)*Math.sqrt(3)), freeH/((ROWS-1)*1.5+2)) * 0.97;
    HR = Math.max(13, Math.min(56, HR));
    HW = HR * Math.sqrt(3); VG = HR * 1.5;
    bw = (COLS-1+0.5)*HW; bh = (ROWS-1)*VG;
  }
  BOARD_X = sideEdge + (freeW - bw)/2;
  BOARD_Y = topEdge + (freeH - bh)/2;
}

function init() {
  resize();
  stars = Array.from({length:220}, () => ({
    x:Math.random(), y:Math.random(),
    size:Math.random()*1.6+0.3,
    brightness:Math.random()*0.65+0.35,
    phase:Math.random()*Math.PI*2,
    speed:Math.random()*2.5+0.5
  }));
  applySettings();
  addLog('Quantum Reactor initialized');
  addLog('Cosmic event monitor online');
  startCore(core);
  initAudio();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  canvas.addEventListener('mousedown', resumeAudio, {once:true});
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// ── Game Loop ─────────────────────────────────────────────────
function loop(now) {
  const dt = Math.min(now - lastTime, 50);
  lastTime = now; time = now;
  updateGame(dt);

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  ctx.save();
  if (shake > 0.2) {
    ctx.translate((Math.random()-0.5)*shake*2, (Math.random()-0.5)*shake*2);
  }
  drawBackground();
  drawReactorCore();
  drawBoard();
  drawAllParticles();
  drawCosmicEvent();
  drawEffects();
  ctx.restore();

  // Fake-3D HUD: panels tilt in perspective and follow the pointer (desktop only —
  // on phones the CSS media query owns the layout and there is no hover pointer)
  parallax.x = lerp(parallax.x, parallax.tx, 0.05);
  parallax.y = lerp(parallax.y, parallax.ty, 0.05);
  const hudEl = document.getElementById('hud');
  if (window.innerWidth > 620) {
    hudEl.style.transform =
      `translateX(-50%) perspective(900px) rotateX(${7 - parallax.y*2.5}deg) rotateY(${parallax.x*3.5}deg) translateZ(0)`;
    document.getElementById('event-bar').style.transform =
      `translateX(-50%) perspective(900px) rotateX(${6 - parallax.y*2}deg) rotateY(${parallax.x*2.5}deg)`;
    document.getElementById('bottom-bar').style.transform =
      `translateX(-50%) perspective(900px) rotateX(${-7 - parallax.y*2.5}deg) rotateY(${parallax.x*3.5}deg)`;
  } else if (hudEl.style.transform) {
    hudEl.style.transform = '';
    document.getElementById('event-bar').style.transform = '';
    document.getElementById('bottom-bar').style.transform = '';
  }

  drawHudIcons();
  drawAbilityIcons();
  drawReactorMini();
  drawParticleIcons();
  requestAnimationFrame(loop);
}

init();
