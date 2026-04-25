import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import api from '../services/api';
import './HostRoom.css';

export default function HostRoom() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => { loadQuiz(); }, [id]);

  const loadQuiz = async () => {
    try {
      const { data } = await api.get(`/quizzes/${id}`);
      setQuiz(data.quiz);
    } catch { toast.error('Failed to load quiz'); }
    finally { setLoading(false); }
  };

  const createRoom = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data } = await api.post('/rooms', { quizId: id });
      setRoom(data.room);
      toast.success('Room created!');
      navigate(`/room/${data.room.room_code}/host`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create room'); }
    finally { setCreating(false); }
  };

  if (loading) return <div className="page-container"><p style={{color:'var(--text-muted)'}}>Loading...</p></div>;

  return (
    <div className="page-container">
      <div className="host-page animate-fade-in">
        <h1>Host Quiz</h1>
        <div className="host-quiz-info">
          <h2>{quiz?.title}</h2>
          <p>{quiz?.questions?.length || 0} questions • {quiz?.time_per_question}s each</p>
        </div>
        <Button onClick={createRoom} size="lg" loading={creating} disabled={creating}>Create Live Room</Button>
        <Button variant="ghost" onClick={() => navigate('/dashboard')} style={{marginTop:'0.5rem'}}>← Back to Dashboard</Button>
      </div>
    </div>
  );
}
