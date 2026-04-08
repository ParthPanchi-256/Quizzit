import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { QRCodeSVG } from 'qrcode.react';
import Button from '../components/ui/Button';
import './Lobby.css';

export default function Lobby() {
  const { code } = useParams();
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [roomInfo, setRoomInfo] = useState(null);
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const [quizMeta, setQuizMeta] = useState({ title: '', description: '', questionCount: 0, timePerQuestion: 30 });
  const isHost = user?.role === 'educator';

  const joinUrl = `${window.location.origin}/join?room=${code}`;
  const appUrl = window.location.origin;

  useEffect(() => {
    if (!socket) return;

    if (isHost) {
      socket.emit('room:hostJoin', { roomCode: code });
      socket.on('room:hostJoined', (data) => {
        setRoomInfo({ roomCode: data.roomCode, status: data.status });
        setPlayers(data.players || []);
        setTotalPlayers(data.totalPlayers);
        setQuizMeta({
          title: data.quizTitle || 'Untitled Quiz',
          description: data.quizDescription || '',
          questionCount: data.questionCount || 0,
          timePerQuestion: data.timePerQuestion || 30,
        });
        if (data.status === 'active' || data.status === 'starting') {
          navigate(`/room/${code}/play`, { replace: true });
        }
      });
    } else {
      socket.emit('room:join', { roomCode: code });
    }

    socket.on('room:joined', (data) => {
      setRoomInfo(data);
      setTotalPlayers(data.totalPlayers);
      setQuizMeta(prev => ({ ...prev, title: data.quizTitle || prev.title }));
    });
    socket.on('room:lateJoin', () => navigate(`/room/${code}/play`, { replace: true }));
    socket.on('room:playerJoined', (data) => { setPlayers(data.players || []); setTotalPlayers(data.totalPlayers); });
    socket.on('room:playerLeft', (data) => setTotalPlayers(data.totalPlayers));

    socket.on('room:quizStarted', (data) => {
      setCountdown(data.countdown);
      let c = data.countdown;
      const interval = setInterval(() => {
        c--;
        setCountdown(c);
        if (c <= 0) { clearInterval(interval); navigate(`/room/${code}/play`, { replace: true }); }
      }, 1000);
    });

    socket.on('error', (data) => console.error('Socket error:', data.message));

    return () => {
      socket.off('room:joined'); socket.off('room:hostJoined'); socket.off('room:playerJoined');
      socket.off('room:playerLeft'); socket.off('room:quizStarted'); socket.off('room:lateJoin'); socket.off('error');
    };
  }, [socket, code, isHost, navigate]);

  const startQuiz = () => { if (socket) socket.emit('room:start', { roomCode: code }); };

  const copyToClipboard = useCallback((text, label) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied!`)).catch(() => toast.error('Copy failed'));
  }, [toast]);

  const inviteMessage = `Join our quiz: ${quizMeta.title}!\n🔗 Link: ${joinUrl}\n🔢 PIN: ${code}\n🌐 Or go to ${appUrl}/join`;

  // ─── Countdown overlay ─────────────────────────────────────────
  if (countdown !== null && countdown > 0) {
    return (
      <div className="lobby-page">
        <div className="countdown-overlay">
          <div className="countdown-number" key={countdown}>{countdown}</div>
          <p className="countdown-text">Get Ready!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-page">
      <div className="lobby-content animate-fade-in">
        {/* ═══ HOST: Share & Join Panel ═══ */}
        {isHost && (
          <div className="share-panel">
            {/* Quiz info header */}
            <div className="share-quiz-info">
              <h1 className="share-quiz-title">{quizMeta.title}</h1>
              {quizMeta.description && <p className="share-quiz-desc">{quizMeta.description}</p>}
              <div className="share-quiz-meta">
                <span>{quizMeta.questionCount} questions</span>
                <span>•</span>
                <span>{quizMeta.timePerQuestion}s each</span>
              </div>
              <button className="share-invite-btn" onClick={() => copyToClipboard(inviteMessage, 'Invite message')}>
                📋 Copy Invite Message
              </button>
            </div>

            {/* Three join methods */}
            <div className="share-methods">
              {/* QR Code */}
              <div className="share-method share-qr">
                <h3 className="share-method-label">📱 Scan to Join</h3>
                <div className="share-qr-wrapper">
                  <QRCodeSVG
                    value={joinUrl}
                    size={220}
                    bgColor="transparent"
                    fgColor="#ffffff"
                    level="M"
                    includeMargin={false}
                  />
                </div>
              </div>

              <div className="share-right-col">
                {/* PIN Code */}
                <div className="share-method share-pin-method">
                  <h3 className="share-method-label">🔢 Room PIN</h3>
                  <div className="share-pin-display">
                    {code.split('').map((ch, i) => (
                      <span key={i} className="share-pin-digit">{ch}</span>
                    ))}
                  </div>
                  <button className="share-copy-btn" onClick={() => copyToClipboard(code, 'PIN')}>
                    Copy PIN
                  </button>
                </div>

                {/* Direct URL */}
                <div className="share-method share-url-method">
                  <h3 className="share-method-label">🔗 Direct Link</h3>
                  <div className="share-url-box">
                    <span className="share-url-text">{joinUrl}</span>
                  </div>
                  <button className="share-copy-btn" onClick={() => copyToClipboard(joinUrl, 'Link')}>
                    Copy Link
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ NON-HOST: Simple header ═══ */}
        {!isHost && (
          <div className="lobby-header">
            <h1>Waiting Room</h1>
            {quizMeta.title && <p className="lobby-quiz-name">{quizMeta.title}</p>}
            <div className="lobby-room-info">
              <div className="lobby-code-box">
                <span className="lobby-code-label">Room Code</span>
                <span className="lobby-code-value">{code}</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Player count + grid ═══ */}
        <div className="lobby-player-count">
          <span className="player-count-num">{totalPlayers}</span>
          <span className="player-count-label">{totalPlayers === 1 ? 'player' : 'players'} joined</span>
        </div>

        <div className="lobby-players-grid">
          {players.map((p, i) => (
            <div key={i} className="lobby-player" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="lobby-player-avatar" style={{ background: p.avatarColor || 'var(--purple)' }}>
                {p.displayName?.charAt(0).toUpperCase()}
              </div>
              <span className="lobby-player-name">{p.displayName}</span>
            </div>
          ))}
        </div>

        {isHost ? (
          <div className="lobby-host-controls">
            <Button onClick={startQuiz} size="lg" disabled={totalPlayers === 0}>
              Start Quiz ({totalPlayers} players)
            </Button>
          </div>
        ) : (
          <div className="lobby-waiting">
            <div className="waiting-dots"><span /><span /><span /></div>
            <p>Waiting for the host to start the quiz...</p>
          </div>
        )}
      </div>
    </div>
  );
}
