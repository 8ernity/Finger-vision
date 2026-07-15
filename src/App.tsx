import React, { useEffect, useRef, useState } from 'react';
import { GlowCard } from './components/ui/spotlight-card';
import { Pencil, Trash2, RefreshCw } from 'lucide-react';
import { useLiquidGlass } from './hooks/useLiquidGlass';

declare const window: any;

const HAND_COLORS = {
  Left: { tip: '#00f5c4', glow: 'rgba(0,245,196,0.5)', skeleton1: 'rgba(123,97,255,0.8)', skeleton2: 'rgba(0,245,196,0.8)', trail: (t: number) => `hsl(${160 + (t / 20 % 40)}, 90%, 60%)` },
  Right: { tip: '#ff3d6e', glow: 'rgba(255,61,110,0.5)', skeleton1: 'rgba(255,61,110,0.8)', skeleton2: 'rgba(255,180,80,0.8)', trail: (t: number) => `hsl(${340 + (t / 20 % 40)}, 90%, 65%)` }
};

const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_BASES = [3, 6, 10, 14, 18];
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

function isFingerUp(lm: any, tip: number, base: number, isThumb: boolean, rawLabel: string) {
  if (isThumb) {
    const thumbTip = lm[4];
    const thumbMcp = lm[2];
    const thumbIp = lm[3];
    const xDiff = thumbTip.x - thumbMcp.x;
    const extendedSideways = rawLabel === 'Right' ? xDiff < -0.04 : xDiff > 0.04;
    const raisedUp = thumbTip.y < thumbIp.y - 0.02;
    return extendedSideways || raisedUp;
  }
  return lm[tip].y < lm[base].y;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [noHand, setNoHand] = useState(false);
  const [fingerCount, setFingerCount] = useState<number | string>('—');
  const [fingerLabel, setFingerLabel] = useState('Show hands to start');
  const [containerDims, setContainerDims] = useState({ width: 1920, height: 1080 });

  // UI state for hands
  const [leftUI, setLeftUI] = useState({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
  const [rightUI, setRightUI] = useState({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });

  const logoCardRef = useLiquidGlass<HTMLDivElement>(true, { scale: -120 });
  const statusBadgeRef = useLiquidGlass<HTMLDivElement>(true, { scale: -120 });
  const summaryPillRef = useLiquidGlass<HTMLDivElement>(isTracking, { scale: -120 });
  const dockRef = useLiquidGlass<HTMLDivElement>(true, { scale: -150 });
  const alertPillRef = useLiquidGlass<HTMLDivElement>(true, { scale: -120 });
  const noHandPillRef = useLiquidGlass<HTMLDivElement>(true, { scale: -120 });

  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastPointsRef = useRef<{ Left: any, Right: any }>({ Left: null, Right: null });
  const drawModeRef = useRef(drawMode);
  
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  useEffect(() => {
    const handleResize = () => {
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const aspect = 16 / 9;
      let w = winW;
      let h = winW / aspect;
      if (h < winH) {
        h = winH;
        w = winH * aspect;
      }
      const finalW = Math.round(w);
      const finalH = Math.round(h);

      setContainerDims({ width: finalW, height: finalH });

      if (canvasRef.current && canvasRef.current.width !== finalW) {
        canvasRef.current.width = finalW;
        canvasRef.current.height = finalH;
      }
      if (trailCanvasRef.current && trailCanvasRef.current.width !== finalW) {
        trailCanvasRef.current.width = finalW;
        trailCanvasRef.current.height = finalH;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initTracking = async () => {
    setIsLoading(true);
    try {
      if (!window.Hands || !window.Camera) {
        throw new Error("MediaPipe libraries not loaded");
      }

      const hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
      });

      hands.onResults((results: any) => {
        if (!canvasRef.current || !trailCanvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        const trailCtx = trailCanvasRef.current.getContext('2d');
        if (!ctx || !trailCtx) return;

        const w = canvasRef.current.width;
        const h = canvasRef.current.height;
        ctx.clearRect(0, 0, w, h);

        const detected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
        if (!detected) {
          setNoHand(true);
          setFingerCount('0');
          setFingerLabel('No hands in frame');
          setLeftUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
          setRightUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
          lastPointsRef.current = { Left: null, Right: null };
          return;
        }

        setNoHand(false);
        let totalCount = 0;
        const handsPresent = new Set();
        
        let newLeftUI = { count: '—', x: '—', y: '—', bars: [false, false, false, false, false] };
        let newRightUI = { count: '—', x: '—', y: '—', bars: [false, false, false, false, false] };

        results.multiHandLandmarks.forEach((lm: any, i: number) => {
          const rawLabel = results.multiHandedness[i].label;
          const handLabel = rawLabel === 'Left' ? 'Right' : 'Left';
          handsPresent.add(handLabel);

          const color = HAND_COLORS[handLabel as keyof typeof HAND_COLORS];

          // Draw skeleton
          HAND_CONNECTIONS.forEach(([a, b]) => {
            const ax = lm[a].x * w, ay = lm[a].y * h;
            const bx = lm[b].x * w, by = lm[b].y * h;
            const grad = ctx.createLinearGradient(ax, ay, bx, by);
            grad.addColorStop(0, color.skeleton1);
            grad.addColorStop(1, color.skeleton2);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
            ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.stroke();
          });
          lm.forEach((pt: any) => {
            ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, 4.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
          });

          // Count fingers
          let count = 0;
          let states = [];
          for (let f = 0; f < 5; f++) {
            const up = isFingerUp(lm, FINGER_TIPS[f], FINGER_BASES[f], f === 0, rawLabel);
            states.push(up);
            if (up) count++;
          }
          totalCount += count;

          const tip = lm[8];
          const tx = tip.x * w, ty = tip.y * h;
          const xStr = Math.round((1 - tip.x) * 1000) / 10 + '%';
          const yStr = Math.round(tip.y * 1000) / 10 + '%';
          
          if (handLabel === 'Left') {
             newLeftUI = { count: count.toString(), x: xStr, y: yStr, bars: states };
          } else {
             newRightUI = { count: count.toString(), x: xStr, y: yStr, bars: states };
          }

          // Draw tip
          const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
          const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, 38 * pulse);
          grad.addColorStop(0, color.glow); grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath(); ctx.arc(tx, ty, 38 * pulse, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
          ctx.beginPath(); ctx.arc(tx, ty, 11, 0, Math.PI * 2); ctx.strokeStyle = color.tip; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fillStyle = color.tip; ctx.fill();

          if (drawModeRef.current && states[1]) {
            const lp = lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current];
            if (lp) {
              trailCtx.beginPath(); trailCtx.moveTo(lp.x, lp.y); trailCtx.lineTo(tx, ty);
              const hue = color.trail(Date.now());
              trailCtx.strokeStyle = hue; trailCtx.lineWidth = 4; trailCtx.lineCap = 'round'; trailCtx.lineJoin = 'round';
              trailCtx.shadowColor = hue; trailCtx.shadowBlur = 16; trailCtx.stroke(); trailCtx.shadowBlur = 0;
            }
            lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current] = { x: tx, y: ty };
          } else {
            lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current] = null;
          }
        });
        
        if (handsPresent.has('Left')) setLeftUI(newLeftUI);
        if (handsPresent.has('Right')) setRightUI(newRightUI);

        setFingerCount(totalCount);
        const labels = ['✊ Fist', '☝️ 1 Finger', '✌️ 2 Fingers', '🤟 3 Fingers', '4 Fingers', '🖐 5 Fingers', '6 Fingers', '7 Fingers', '8 Fingers', '9 Fingers', '🙌 10 Fingers'];
        setFingerLabel(totalCount <= 10 ? (labels[totalCount] || totalCount + ' fingers') : totalCount + ' fingers');
      });

      handsRef.current = hands;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          if (handsRef.current && videoRef.current) {
            await handsRef.current.send({ image: videoRef.current });
          }
        },
        width: 1280, height: 720,
      });

      await camera.start();
      cameraRef.current = camera;
      setIsTracking(true);
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      alert('Could not access camera. Please allow camera permissions and try again.');
    }
  };

  const clearCanvas = () => {
    if (trailCanvasRef.current) {
      const ctx = trailCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, trailCanvasRef.current.width, trailCanvasRef.current.height);
    }
    lastPointsRef.current = { Left: null, Right: null };
  };

  const restartCamera = () => {
    if (cameraRef.current) { cameraRef.current.stop(); cameraRef.current = null; }
    if (handsRef.current) { handsRef.current.close(); handsRef.current = null; }
    setIsTracking(false);
    setDrawMode(false);
    if (canvasRef.current) canvasRef.current.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    clearCanvas();
    setFingerCount('—');
    setFingerLabel('Show hands to start');
    setLeftUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
    setRightUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
  };

  return (
    <>
      {/* Full-Screen Camera & HUD Overlay Viewport */}
      <div className="viewport-bg">
        {/* Cover Video + Canvases */}
        <div 
          className="camera-container" 
          style={{ width: `${containerDims.width}px`, height: `${containerDims.height}px` }}
        >
          <video ref={videoRef} playsInline autoPlay muted />
          <canvas ref={trailCanvasRef} className="trail-canvas" />
          <canvas ref={canvasRef} className="landmark-canvas" />
        </div>

        {/* HUD grid & vignette */}
        <div className="hud-grid-overlay" />
        <div className="hud-vignette" />

        {/* Viewport corner HUD brackets */}
        <div className="hud-corner hud-corner-tl" />
        <div className="hud-corner hud-corner-tr" />
        <div className="hud-corner hud-corner-bl" />
        <div className="hud-corner hud-corner-br" />
      </div>

      {/* Floating HUD Header Bar */}
      <header className="hud-header">
        <div className="hud-header-left">
          <div className="logo-card" ref={logoCardRef}>
            <div className="logo-icon">✋</div>
            <div className="logo-text">Finger<span>Vision</span></div>
          </div>
          <div className={`status-badge ${isTracking ? 'active' : ''}`} ref={statusBadgeRef}>
            <div className="status-dot" />
            <span>{isTracking ? 'HUD Tracking Active' : 'Standby Mode'}</span>
          </div>
        </div>

        <div className="hud-header-right">
          {isTracking && (
            <div className="hud-summary-pill" ref={summaryPillRef}>
              <span>Extended:</span>
              <strong>{fingerCount}</strong>
              <span style={{ color: 'var(--muted)' }}>({fingerLabel})</span>
            </div>
          )}
        </div>
      </header>

      {/* Floating Right HUD Sidebar overlaying camera */}
      <div className="hud-sidebar">
        <GlowCard customSize className="card" glowColor="green">
          <div className="card-label">
            <span>Extended Fingers</span>
            <span style={{ color: 'var(--accent)' }}>LIVE COUNT</span>
          </div>
          <div className="finger-count">{fingerCount}</div>
          <div className="finger-label">{fingerLabel}</div>
        </GlowCard>

        <GlowCard customSize className="card" glowColor="purple">
          <div className="card-label">
            <span style={{ color: 'var(--accent)' }}>🫲 Left Hand</span>
            <span>{leftUI.count !== '—' ? 'DETECTED' : 'OFFLINE'}</span>
          </div>
          <div className="hand-count-row">
            <div className="hand-mini-count">{leftUI.count}</div>
            <div className="coord-grid-small">
              <div className="coord-item-sm">
                <div className="coord-axis" style={{ color: 'var(--accent)' }}>POS X</div>
                <div className="coord-value-sm">{leftUI.x}</div>
              </div>
              <div className="coord-item-sm">
                <div className="coord-axis" style={{ color: 'var(--accent)' }}>POS Y</div>
                <div className="coord-value-sm">{leftUI.y}</div>
              </div>
            </div>
          </div>
          <div className="finger-states">
            {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((f, i) => (
              <div key={f} className="finger-pip">
                <div className={`finger-bar ${leftUI.bars[i] ? 'up' : ''}`} />
                <div className="finger-name">{f}</div>
              </div>
            ))}
          </div>
        </GlowCard>

        <GlowCard customSize className="card" glowColor="red">
          <div className="card-label">
            <span style={{ color: 'var(--accent2)' }}>🫱 Right Hand</span>
            <span>{rightUI.count !== '—' ? 'DETECTED' : 'OFFLINE'}</span>
          </div>
          <div className="hand-count-row">
            <div className="hand-mini-count" style={{ color: 'var(--accent2)', textShadow: '0 0 20px var(--glow2)' }}>{rightUI.count}</div>
            <div className="coord-grid-small">
              <div className="coord-item-sm">
                <div className="coord-axis" style={{ color: 'var(--accent2)' }}>POS X</div>
                <div className="coord-value-sm">{rightUI.x}</div>
              </div>
              <div className="coord-item-sm">
                <div className="coord-axis" style={{ color: 'var(--accent2)' }}>POS Y</div>
                <div className="coord-value-sm">{rightUI.y}</div>
              </div>
            </div>
          </div>
          <div className="finger-states">
            {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((f, i) => (
              <div key={f} className="finger-pip">
                <div className={`finger-bar right-bar ${rightUI.bars[i] ? 'up' : ''}`} />
                <div className="finger-name">{f}</div>
              </div>
            ))}
          </div>
        </GlowCard>
      </div>

      {/* Draw Mode Alert Pill */}
      <div ref={alertPillRef} className={`hud-alert-pill ${drawMode ? 'show' : ''}`}>
        ✏ Air Draw Mode Active — Raise Index Finger to Sketch
      </div>

      {/* No Hand Alert Pill */}
      <div ref={noHandPillRef} className={`hud-nohand-pill ${isTracking && noHand ? 'show' : ''}`}>
        Waiting for hands in frame...
      </div>

      {/* Floating Bottom HUD Dock Controls */}
      <div ref={dockRef} className="hud-dock">
        <button
          className={`btn-dock ${drawMode ? 'active' : ''}`}
          disabled={!isTracking}
          onClick={() => setDrawMode(!drawMode)}
        >
          <Pencil size={16} />
          <span>{drawMode ? 'Drawing Enabled' : 'Air Draw'}</span>
        </button>

        <button className="btn-dock" disabled={!isTracking} onClick={clearCanvas}>
          <Trash2 size={16} />
          <span>Clear Trail</span>
        </button>

        <button className="btn-dock" onClick={restartCamera}>
          <RefreshCw size={16} />
          <span>{isTracking ? 'Stop Camera' : 'Reset'}</span>
        </button>
      </div>

      {/* Splash Screen Overlay */}
      {!isTracking && !isLoading && (
        <div id="splash">
          <div className="splash-icon">🖐</div>
          <div className="splash-title">Real-Time HUD Hand Tracking</div>
          <div className="splash-sub">
            Full-screen camera overlay interface with MediaPipe hand landmark detection, 3D finger tracking, and air sketching.
          </div>
          <button className="btn-start" onClick={initTracking}>
            Initialize HUD Camera
          </button>
        </div>
      )}

      {/* Loading State Overlay */}
      {isLoading && (
        <div id="loading" className="show">
          <div className="spinner" />
          <div className="loading-text">Initializing MediaPipe Neural Models...</div>
        </div>
      )}
    </>
  );
}

