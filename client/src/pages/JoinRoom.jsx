import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import api from '../services/api';
import './Auth.css';

export default function JoinRoom() {
  const [roomCode, setRoomCode] = useState('');

  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!roomCode.trim()) return toast.error('Enter a room code');
    setLoading(true);
    try {
      await api.post(`/rooms/${roomCode.toUpperCase()}/join`);
      navigate(`/room/${roomCode.toUpperCase()}/lobby`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join room');
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-card animate-fade-in">
        <div className="auth-header">
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎮</div>
          <h1>Join Quiz</h1>
          <p>Enter the room code from your teacher</p>
        </div>
        <form onSubmit={handleJoin} className="auth-form">
          <Input label="Room Code" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} placeholder="ABCD12" style={{textTransform:'uppercase', letterSpacing:'0.15em', fontWeight:700, fontSize:'1.25rem', textAlign:'center'}} />
          <Button type="submit" loading={loading} fullWidth size="lg">Join Room</Button>
        </form>
      </div>
    </div>
  );
}
