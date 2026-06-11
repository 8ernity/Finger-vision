// ─── State ────────────────────────────────────────────────────────────────────
let hands = null;
let camera = null;
let drawMode = false;
let isTracking = false;
let lastPoints = { Left: null, Right: null }; // per-hand draw trails
let noHandTimer = null;

const video       = document.getElementById('video');
const canvas      = document.getElementById('canvas');
const trailCanvas = document.getElementById('trailCanvas');
const ctx         = canvas.getContext('2d');
const trailCtx    = trailCanvas.getContext('2d');

const splash      = document.getElementById('splash');
const loading     = document.getElementById('loading');
const statusBadge = document.getElementById('statusBadge');
const statusText  = document.getElementById('statusText');
const fingerCount = document.getElementById('fingerCount');
const fingerLabel = document.getElementById('fingerLabel');
const drawInd     = document.getElementById('drawIndicator');
const noHandEl    = document.getElementById('noHand');
const btnStart    = document.getElementById('btnStart');
const btnDraw     = document.getElementById('btnDraw');
const btnClear    = document.getElementById('btnClear');
const btnReset    = document.getElementById('btnReset');

// Per-hand UI element IDs
const HAND_UI = {
  Left:  { prefix: 'l', countEl: 'count-left',  xEl: 'lx', yEl: 'ly',  bars: ['lbar-thumb','lbar-index','lbar-middle','lbar-ring','lbar-pinky'] },
  Right: { prefix: 'r', countEl: 'count-right', xEl: 'rx', yEl: 'ry',  bars: ['rbar-thumb','rbar-index','rbar-middle','rbar-ring','rbar-pinky'] }
};

// Hand colors (teal = left, pink = right)
const HAND_COLORS = {
  Left:  { tip: '#00f5c4', glow: 'rgba(0,245,196,0.5)',  skeleton1: 'rgba(123,97,255,0.8)', skeleton2: 'rgba(0,245,196,0.8)',  trail: (t) => `hsl(${160 + (t/20 % 40)}, 90%, 60%)` },
  Right: { tip: '#ff3d6e', glow: 'rgba(255,61,110,0.5)', skeleton1: 'rgba(255,61,110,0.8)', skeleton2: 'rgba(255,180,80,0.8)', trail: (t) => `hsl(${340 + (t/20 % 40)}, 90%, 65%)` }
};

// ─── Canvas resize ─────────────────────────────────────────────────────────
function resizeCanvases() {
  const panel = document.getElementById('cameraPanel');
  const w = panel.clientWidth, h = panel.clientHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (trailCanvas.width !== w || trailCanvas.height !== h) { trailCanvas.width = w; trailCanvas.height = h; }
}
window.addEventListener('resize', resizeCanvases);

// ─── Finger landmark indices ──────────────────────────────────────────────
const FINGER_TIPS  = [4, 8, 12, 16, 20];
const FINGER_BASES = [3, 6, 10, 14, 18];

function isFingerUp(lm, tip, base, isThumb, rawLabel) {
  if (isThumb) {
    // Thumb direction is chirality-dependent (rawLabel = MediaPipe's camera-space label).
    // Right hand (camera): thumb tip extends LEFT of MCP (lower X).
    // Left  hand (camera): thumb tip extends RIGHT of MCP (higher X).
    const thumbTip = lm[4];
    const thumbMcp = lm[2]; // joint 2 is a stable palm-side baseline
    const thumbIp  = lm[3];
    const xDiff = thumbTip.x - thumbMcp.x;
    const extendedSideways = rawLabel === 'Right'
      ? xDiff < -0.04   // right hand (camera): tip to the left
      : xDiff >  0.04;  // left  hand (camera): tip to the right
    // Also count thumb as up when pointing upward
    const raisedUp = thumbTip.y < thumbIp.y - 0.02;
    return extendedSideways || raisedUp;
  }
  return lm[tip].y < lm[base].y;
}

// ─── MediaPipe hand connections ──────────────────────────────────────────
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

function drawSkeleton(ctx, lm, w, h, color) {
  HAND_CONNECTIONS.forEach(([a, b]) => {
    const ax = lm[a].x * w, ay = lm[a].y * h;
    const bx = lm[b].x * w, by = lm[b].y * h;
    const grad = ctx.createLinearGradient(ax, ay, bx, by);
    grad.addColorStop(0, color.skeleton1);
    grad.addColorStop(1, color.skeleton2);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });
  // Draw joint dots
  lm.forEach(pt => {
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  });
}

function drawTip(ctx, x, y, color) {
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
  // Glow
  const grad = ctx.createRadialGradient(x, y, 0, x, y, 34 * pulse);
  grad.addColorStop(0, color.glow);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(x, y, 34 * pulse, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();
  // Ring
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = color.tip; ctx.lineWidth = 2; ctx.stroke();
  // Centre
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color.tip; ctx.fill();
  // Crosshair
  ctx.strokeStyle = color.glow; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - 20); ctx.lineTo(x, y + 20); ctx.stroke();
  ctx.setLineDash([]);
}

// ─── Main results handler ─────────────────────────────────────────────────
function onResults(results) {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const detected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

  if (!detected) {
    setNoHand(true);
    fingerCount.textContent = '—';
    fingerLabel.textContent = 'show both hands';
    resetHandUI('Left'); resetHandUI('Right');
    lastPoints = { Left: null, Right: null };
    return;
  }

  setNoHand(false);

  let totalCount = 0;
  const handsPresent = new Set();

  results.multiHandLandmarks.forEach((lm, i) => {
    // MediaPipe labels hands as seen from camera — "Left" in image = user's Right hand
    // We swap so the label matches the user's actual hand
    const rawLabel = results.multiHandedness[i].label; // "Left" or "Right" from MP
    const handLabel = rawLabel === 'Left' ? 'Right' : 'Left'; // flip to match user's perspective
    handsPresent.add(handLabel);

    const color = HAND_COLORS[handLabel];
    const ui    = HAND_UI[handLabel];

    // Draw skeleton
    drawSkeleton(ctx, lm, w, h, color);

    // Count fingers
    let count = 0;
    let states = [];
    for (let f = 0; f < 5; f++) {
      const up = isFingerUp(lm, FINGER_TIPS[f], FINGER_BASES[f], f === 0, rawLabel);
      states.push(up);
      if (up) count++;
      document.getElementById(ui.bars[f]).classList.toggle('up', up);
    }
    totalCount += count;

    // Update per-hand UI
    document.getElementById(ui.countEl).textContent = count;
    
    // Index tip
    const tip = lm[8];
    const tx = tip.x * w, ty = tip.y * h;
    document.getElementById(ui.xEl).textContent = Math.round((1 - tip.x) * 1000) / 10 + '%';
    document.getElementById(ui.yEl).textContent = Math.round(tip.y * 1000) / 10 + '%';

    // Draw tip indicator
    drawTip(ctx, tx, ty, color);

    // Draw mode trail (track per hand)
    if (drawMode && states[1]) {
      const lp = lastPoints[handLabel];
      if (lp) {
        trailCtx.beginPath();
        trailCtx.moveTo(lp.x, lp.y);
        trailCtx.lineTo(tx, ty);
        const hue = color.trail(Date.now());
        trailCtx.strokeStyle = hue;
        trailCtx.lineWidth = 3.5;
        trailCtx.lineCap = 'round';
        trailCtx.lineJoin = 'round';
        trailCtx.shadowColor = hue;
        trailCtx.shadowBlur = 14;
        trailCtx.stroke();
        trailCtx.shadowBlur = 0;
      }
      lastPoints[handLabel] = { x: tx, y: ty };
    } else {
      lastPoints[handLabel] = null;
    }
  });

  // Reset UI for hands not currently detected
  if (!handsPresent.has('Left'))  { resetHandUI('Left');  lastPoints.Left  = null; }
  if (!handsPresent.has('Right')) { resetHandUI('Right'); lastPoints.Right = null; }

  fingerCount.textContent = totalCount;
  const labels = ['✊','☝️','✌️','🤟','🤘','🖐','6','7','8','9','🙌'];
  fingerLabel.textContent = totalCount <= 10 ? (labels[totalCount] || totalCount + ' fingers') : totalCount + ' fingers';
}

function resetHandUI(hand) {
  const ui = HAND_UI[hand];
  document.getElementById(ui.countEl).textContent = '—';
  document.getElementById(ui.xEl).textContent = '—';
  document.getElementById(ui.yEl).textContent = '—';
  ui.bars.forEach(id => document.getElementById(id).classList.remove('up'));
}

// ─── No-hand UX ────────────────────────────────────────────────────────────
function setNoHand(state) {
  clearTimeout(noHandTimer);
  if (state) { noHandTimer = setTimeout(() => noHandEl.classList.add('show'), 800); }
  else { noHandEl.classList.remove('show'); }
}

// ─── Init MediaPipe ────────────────────────────────────────────────────────
async function initTracking() {
  splash.classList.add('hidden');
  loading.classList.add('show');

  try {
    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,          // ← both hands
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    hands.onResults(onResults);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' }
    });
    video.srcObject = stream;

    camera = new Camera(video, {
      onFrame: async () => {
        resizeCanvases();
        await hands.send({ image: video });
      },
      width: 1280, height: 720,
    });

    await camera.start();
    isTracking = true;
    loading.classList.remove('show');
    statusBadge.classList.add('active');
    statusText.textContent = 'Tracking';
    btnDraw.disabled = false;
    btnClear.disabled = false;

  } catch (err) {
    console.error(err);
    loading.classList.remove('show');
    splash.classList.remove('hidden');
    alert('Could not access camera. Please allow permissions and try again.');
  }
}

// ─── Buttons ───────────────────────────────────────────────────────────────
btnStart.addEventListener('click', initTracking);

btnDraw.addEventListener('click', () => {
  drawMode = !drawMode;
  btnDraw.classList.toggle('active', drawMode);
  btnDraw.innerHTML = `<span>${drawMode ? '🔴' : '✏️'}</span> ${drawMode ? 'Disable Draw Mode' : 'Enable Draw Mode'}`;
  drawInd.classList.toggle('active', drawMode);
  if (!drawMode) lastPoints = { Left: null, Right: null };
});

btnClear.addEventListener('click', () => {
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  lastPoints = { Left: null, Right: null };
});

btnReset.addEventListener('click', () => {
  if (camera) { camera.stop(); camera = null; }
  if (hands)  { hands.close(); hands  = null; }
  isTracking = false; drawMode = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  statusBadge.classList.remove('active');
  statusText.textContent = 'Standby';
  fingerCount.textContent = '—';
  fingerLabel.textContent = 'show both hands';
  resetHandUI('Left'); resetHandUI('Right');
  lastPoints = { Left: null, Right: null };
  btnDraw.disabled = true; btnClear.disabled = true;
  splash.classList.remove('hidden');
  drawInd.classList.remove('active');
  noHandEl.classList.remove('show');
});