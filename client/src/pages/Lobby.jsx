import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import './Lobby.css';

export default function Lobby() {
  const { code } = useParams();
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roomInfo, setRoomInfo] = useState(null);
  const [players, setPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const isHost = user?.role === 'educator';

  useEffect(() => {
    if (!socket) return;

    if (isHost) {
      socket.emit('room:hostJoin', { roomCode: code });
      socket.on('room:hostJoined', (data) => {
        setRoomInfo({ roomCode: data.roomCode, status: data.status });
        setPlayers(data.players || []);
        setTotalPlayers(data.totalPlayers);
        // If quiz already started, go directly to play
        if (data.status === 'active' || data.status === 'starting') {
          navigate(`/room/${code}/play`, { replace: true });
          return;
        }
      });
    } else {
      socket.emit('room:join', { roomCode: code });
    }

    socket.on('room:joined', (data) => {
      setRoomInfo(data);
      setTotalPlayers(data.totalPlayers);
    });

    // If the quiz is already in progress when we join
    socket.on('room:lateJoin', (data) => {
      navigate(`/room/${code}/play`, { replace: true });
    });

    socket.on('room:playerJoined', (data) => {
      setPlayers(data.players || []);
      setTotalPlayers(data.totalPlayers);
    });

    socket.on('room:playerLeft', (data) => {
      setTotalPlayers(data.totalPlayers);
    });

    // Quiz is starting — show countdown then navigate
    socket.on('room:quizStarted', (data) => {
      setCountdown(data.countdown);
      let c = data.countdown;
      const interval = setInterval(() => {
        c--;
        setCountdown(c);
        if (c <= 0) {
          clearInterval(interval);
          // Navigate to play page after countdown finishes
          navigate(`/room/${code}/play`, { replace: true });
        }
      }, 1000);
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data.message);
    });

    return () => {
      socket.off('room:joined');
      socket.off('room:hostJoined');
      socket.off('room:playerJoined');
      socket.off('room:playerLeft');
      socket.off('room:quizStarted');
      socket.off('room:lateJoin');
      socket.off('error');
    };
  }, [socket, code, isHost, navigate]);

  const startQuiz = () => {
    if (socket) socket.emit('room:start', { roomCode: code });
  };

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
        <div className="lobby-header">
          <h1>Waiting Room</h1>
          <div className="lobby-room-info">
            <div className="lobby-code-box">
              <span className="lobby-code-label">Room Code</span>
              <span className="lobby-code-value">{code}</span>
            </div>
          </div>
        </div>

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
