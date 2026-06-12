import React, { useEffect, useRef, useState } from 'react';
import { GlowCard } from './components/ui/spotlight-card';
import { Pencil, Trash2, RefreshCw, Hand } from 'lucide-react';

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
  const cameraPanelRef = useRef<HTMLDivElement>(null);

  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [noHand, setNoHand] = useState(false);
  const [fingerCount, setFingerCount] = useState<number | string>('—');
  const [fingerLabel, setFingerLabel] = useState('show both hands');

  // UI state for hands
  const [leftUI, setLeftUI] = useState({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
  const [rightUI, setRightUI] = useState({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });

  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastPointsRef = useRef<{ Left: any, Right: any }>({ Left: null, Right: null });
  const drawModeRef = useRef(drawMode);
  
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  useEffect(() => {
    const handleResize = () => {
      if (cameraPanelRef.current && canvasRef.current && trailCanvasRef.current) {
        const w = cameraPanelRef.current.clientWidth;
        const h = cameraPanelRef.current.clientHeight;
        if (canvasRef.current.width !== w) canvasRef.current.width = w;
        if (canvasRef.current.height !== h) canvasRef.current.height = h;
        if (trailCanvasRef.current.width !== w) trailCanvasRef.current.width = w;
        if (trailCanvasRef.current.height !== h) trailCanvasRef.current.height = h;
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
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
          setFingerCount('—');
          setFingerLabel('show both hands');
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
            ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.stroke();
          });
          lm.forEach((pt: any) => {
            ctx.beginPath(); ctx.arc(pt.x * w, pt.y * h, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
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
          const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, 34 * pulse);
          grad.addColorStop(0, color.glow); grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath(); ctx.arc(tx, ty, 34 * pulse, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
          ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.strokeStyle = color.tip; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fillStyle = color.tip; ctx.fill();

          if (drawModeRef.current && states[1]) {
            const lp = lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current];
            if (lp) {
              trailCtx.beginPath(); trailCtx.moveTo(lp.x, lp.y); trailCtx.lineTo(tx, ty);
              const hue = color.trail(Date.now());
              trailCtx.strokeStyle = hue; trailCtx.lineWidth = 3.5; trailCtx.lineCap = 'round'; trailCtx.lineJoin = 'round';
              trailCtx.shadowColor = hue; trailCtx.shadowBlur = 14; trailCtx.stroke(); trailCtx.shadowBlur = 0;
            }
            lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current] = { x: tx, y: ty };
          } else {
            lastPointsRef.current[handLabel as keyof typeof lastPointsRef.current] = null;
          }
        });
        
        if (handsPresent.has('Left')) setLeftUI(newLeftUI);
        if (handsPresent.has('Right')) setRightUI(newRightUI);

        setFingerCount(totalCount);
        const labels = ['✊', '☝️', '✌️', '🤟', '🤘', '🖐', '6', '7', '8', '9', '🙌'];
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
      alert('Could not access camera. Please allow permissions and try again.');
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
    setFingerLabel('show both hands');
    setLeftUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
    setRightUI({ count: '—', x: '—', y: '—', bars: [false, false, false, false, false] });
  };

  return (
    <>
      <div className="blob2"></div>

      <header>
        <div className="logo">
          <div className="logo-icon">✋</div>
          <div className="logo-text">Finger<span>Vision</span></div>
        </div>
        <div className={`status-badge ${isTracking ? 'active' : ''}`}>
          <div className="status-dot"></div>
          <span>{isTracking ? 'Tracking' : 'Standby'}</span>
        </div>
      </header>

      <main>
        <div className="left-column" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Camera Panel */}
          <div className="camera-panel" ref={cameraPanelRef}>
            <div className="corner corner-tl"></div>
            <div className="corner corner-tr"></div>
            <div className="corner corner-bl"></div>
            <div className="corner corner-br"></div>

            <video ref={videoRef} playsInline autoPlay muted style={{ display: 'none' }}></video>
            <canvas ref={trailCanvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', zIndex: 3, pointerEvents: 'none' }}></canvas>
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', zIndex: 2 }}></canvas>

            <div className={`draw-indicator ${drawMode ? 'active' : ''}`}>✏ Draw Mode</div>
            <div className={`no-hand ${noHand ? 'show' : ''}`}>No hand detected</div>

            {!isTracking && !isLoading && (
              <div id="splash" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', zIndex: 10, background: 'rgba(5,8,16,0.9)', backdropFilter: 'blur(8px)' }}>
                <div className="splash-icon" style={{ fontSize: '60px', filter: 'drop-shadow(0 0 20px rgba(0,245,196,0.5))', animation: 'float 3s ease infinite' }}>🖐</div>
                <div className="splash-title" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '1.6rem', color: 'var(--text)' }}>Real-time Hand Tracking</div>
                <div className="splash-sub" style={{ fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', maxWidth: '300px', lineHeight: 1.7 }}>Show your hand to the camera to detect fingers, track movement, and draw in the air.</div>
                <button className="btn-start" onClick={initTracking}>Initialise Camera</button>
              </div>
            )}

            {isLoading && (
              <div id="loading" className="show" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', zIndex: 9, background: 'rgba(5,8,16,0.9)' }}>
                <div className="spinner"></div>
                <div className="loading-text">Loading MediaPipe...</div>
              </div>
            )}
          </div>

          {/* Controls wrapped in GlowCard */}
          <GlowCard customSize className="card" glowColor="blue">
            <div className="card-label">Controls</div>
            <div className="controls" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              <button className={`btn-control ${drawMode ? 'active' : ''}`} disabled={!isTracking} onClick={() => setDrawMode(!drawMode)}>
                <Pencil size={18} /> {drawMode ? 'Disable Draw Mode' : 'Enable Draw Mode'}
              </button>
              <button className="btn-control" disabled={!isTracking} onClick={clearCanvas}>
                <Trash2 size={18} /> Clear Canvas
              </button>
              <button className="btn-control" onClick={restartCamera}>
                <RefreshCw size={18} /> Restart Camera
              </button>
            </div>
          </GlowCard>
        </div>

        {/* Sidebar */}
        <div className="sidebar">
          <GlowCard customSize className="card" glowColor="green">
            <div className="card-label">Total Fingers Extended</div>
            <div className="finger-count">{fingerCount}</div>
            <div className="finger-label">{fingerLabel}</div>
          </GlowCard>

          <GlowCard customSize className="card hand-card" glowColor="purple">
            <div className="card-label" style={{ color: 'var(--accent)' }}>🫲 Left Hand</div>
            <div className="hand-count-row">
              <div className="hand-mini-count">{leftUI.count}</div>
              <div className="coord-grid-small">
                <div className="coord-item-sm"><div className="coord-axis" style={{ color: 'var(--accent)' }}>X</div><div className="coord-value-sm">{leftUI.x}</div></div>
                <div className="coord-item-sm"><div className="coord-axis" style={{ color: 'var(--accent)' }}>Y</div><div className="coord-value-sm">{leftUI.y}</div></div>
              </div>
            </div>
            <div className="finger-states">
              {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((f, i) => (
                <div key={f} className="finger-pip">
                  <div className={`finger-bar ${leftUI.bars[i] ? 'up' : ''}`}></div>
                  <div className="finger-name">{f}</div>
                </div>
              ))}
            </div>
          </GlowCard>

          <GlowCard customSize className="card hand-card" glowColor="red">
            <div className="card-label" style={{ color: 'var(--accent2)' }}>🫱 Right Hand</div>
            <div className="hand-count-row">
              <div className="hand-mini-count" style={{ color: 'var(--accent2)', textShadow: '0 0 20px var(--glow2)' }}>{rightUI.count}</div>
              <div className="coord-grid-small">
                <div className="coord-item-sm"><div className="coord-axis" style={{ color: 'var(--accent2)' }}>X</div><div className="coord-value-sm">{rightUI.x}</div></div>
                <div className="coord-item-sm"><div className="coord-axis" style={{ color: 'var(--accent2)' }}>Y</div><div className="coord-value-sm">{rightUI.y}</div></div>
              </div>
            </div>
            <div className="finger-states">
              {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((f, i) => (
                <div key={f} className="finger-pip">
                  <div className={`finger-bar right-bar ${rightUI.bars[i] ? 'up' : ''}`}></div>
                  <div className="finger-name">{f}</div>
                </div>
              ))}
            </div>
          </GlowCard>
        </div>
      </main>
    </>
  );
}
