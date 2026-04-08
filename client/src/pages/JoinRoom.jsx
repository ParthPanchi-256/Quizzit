import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import api from '../services/api';
import './JoinRoom.css';

const PIN_LENGTH = 6;

export default function JoinRoom() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('pin'); // 'pin' | 'scan'
  const [pinDigits, setPinDigits] = useState(Array(PIN_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [autoJoining, setAutoJoining] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [scanError, setScanError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const digitRefs = useRef([]);
  const scannerRef = useRef(null);
  const scannerInstanceRef = useRef(null);

  // ─── Auto-join from URL (?room=XXXXXX) ────────────────────────
  useEffect(() => {
    const roomCode = searchParams.get('room');
    if (roomCode && roomCode.trim()) {
      setAutoJoining(true);
      joinRoom(roomCode.toUpperCase());
    }
  }, [searchParams]);

  const joinRoom = useCallback(async (code) => {
    setLoading(true);
    try {
      await api.post(`/rooms/${code}/join`);
      navigate(`/room/${code}/lobby`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join room');
      setAutoJoining(false);
    } finally { setLoading(false); }
  }, [navigate, toast]);

  // ─── OTP-style PIN input ──────────────────────────────────────
  const handleDigitChange = (index, value) => {
    if (!/^[a-zA-Z0-9]?$/.test(value)) return;
    const newDigits = [...pinDigits];
    newDigits[index] = value.toUpperCase();
    setPinDigits(newDigits);

    if (value && index < PIN_LENGTH - 1) {
      digitRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits filled
    if (value && index === PIN_LENGTH - 1) {
      const code = newDigits.join('');
      if (code.length === PIN_LENGTH) {
        joinRoom(code);
      }
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      const code = pinDigits.join('');
      if (code.length === PIN_LENGTH) joinRoom(code);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\s/g, '').toUpperCase().slice(0, PIN_LENGTH);
    if (pasted.length > 0) {
      const newDigits = Array(PIN_LENGTH).fill('');
      pasted.split('').forEach((ch, i) => { if (i < PIN_LENGTH) newDigits[i] = ch; });
      setPinDigits(newDigits);
      if (pasted.length === PIN_LENGTH) {
        setTimeout(() => joinRoom(pasted), 200);
      } else {
        digitRefs.current[pasted.length]?.focus();
      }
    }
  };

  // ─── QR Scanner ───────────────────────────────────────────────
  const startScanner = useCallback(async () => {
    setScanError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (scannerInstanceRef.current) {
        try { await scannerInstanceRef.current.stop(); } catch {}
      }
      const scanner = new Html5Qrcode('qr-reader');
      scannerInstanceRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
        (decodedText) => {
          // Extract room code from URL or use raw text
          let code = decodedText;
          try {
            const url = new URL(decodedText);
            const roomParam = url.searchParams.get('room');
            if (roomParam) code = roomParam;
          } catch { /* not a URL, use raw text */ }
          scanner.stop().catch(() => {});
          scannerInstanceRef.current = null;
          joinRoom(code.toUpperCase());
        },
        () => {} // ignore scan failure frames
      );
      setScannerReady(true);
    } catch (err) {
      console.error('QR scanner error:', err);
      setScanError(
        err?.toString().includes('NotAllowed')
          ? 'Camera access denied. Please allow camera permission.'
          : err?.toString().includes('NotFound')
          ? 'No camera found on this device.'
          : 'Could not start camera. Try entering the PIN instead.'
      );
    }
  }, [joinRoom]);

  const stopScanner = useCallback(async () => {
    if (scannerInstanceRef.current) {
      try { await scannerInstanceRef.current.stop(); } catch {}
      scannerInstanceRef.current = null;
    }
    setScannerReady(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'scan') startScanner();
    else stopScanner();
    return () => { stopScanner(); };
  }, [activeTab, startScanner, stopScanner]);

  // ─── Auto-join loading screen ─────────────────────────────────
  if (autoJoining) {
    return (
      <div className="join-page">
        <div className="join-card animate-fade-in">
          <div className="join-loading">
            <div className="join-spinner" />
            <h2>Joining quiz...</h2>
            <p>Please wait while we connect you</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card animate-fade-in">
        <div className="join-header">
          <div className="join-icon">🎮</div>
          <h1>Join a Quiz</h1>
          <p>Choose how you'd like to join</p>
        </div>

        {/* Tab selector */}
        <div className="join-tabs">
          <button className={`join-tab ${activeTab === 'pin' ? 'join-tab-active' : ''}`} onClick={() => setActiveTab('pin')}>
            <span className="join-tab-icon">🔢</span>
            <span>Enter PIN</span>
          </button>
          <button className={`join-tab ${activeTab === 'scan' ? 'join-tab-active' : ''}`} onClick={() => setActiveTab('scan')}>
            <span className="join-tab-icon">📷</span>
            <span>Scan QR</span>
          </button>
        </div>

        {/* ── PIN Tab ── */}
        {activeTab === 'pin' && (
          <div className="join-tab-content animate-fade-in">
            <p className="join-tab-desc">Enter the 6-character room code</p>
            <div className="pin-input-row" onPaste={handlePaste}>
              {pinDigits.map((d, i) => (
                <input
                  key={i}
                  ref={el => digitRefs.current[i] = el}
                  className={`pin-digit-input ${d ? 'pin-digit-filled' : ''}`}
                  type="text"
                  maxLength={1}
                  value={d}
                  onChange={e => handleDigitChange(i, e.target.value)}
                  onKeyDown={e => handleDigitKeyDown(i, e)}
                  autoFocus={i === 0}
                  inputMode="text"
                  autoComplete="off"
                />
              ))}
            </div>
            <Button
              onClick={() => joinRoom(pinDigits.join(''))}
              loading={loading}
              disabled={pinDigits.join('').length < PIN_LENGTH}
              fullWidth
              size="lg"
            >
              Join Room
            </Button>
          </div>
        )}

        {/* ── Scan Tab ── */}
        {activeTab === 'scan' && (
          <div className="join-tab-content animate-fade-in">
            <p className="join-tab-desc">Point your camera at the QR code</p>
            <div className="qr-scanner-container">
              <div id="qr-reader" className="qr-reader-viewport" />
              {!scannerReady && !scanError && (
                <div className="qr-loading">
                  <div className="join-spinner" />
                  <p>Starting camera...</p>
                </div>
              )}
              {scanError && (
                <div className="qr-error">
                  <span className="qr-error-icon">⚠️</span>
                  <p>{scanError}</p>
                  <button className="share-copy-btn" onClick={startScanner}>Retry</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* URL hint */}
        <div className="join-url-hint">
          <span>💡</span>
          <span>You can also join by clicking a shared link directly</span>
        </div>
      </div>
    </div>
  );
}
