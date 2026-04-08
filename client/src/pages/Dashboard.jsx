import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import api from '../services/api';
import './Dashboard.css';

export default function Dashboard() {
  const { user } = useAuth();
  return user?.role === 'educator' ? <EducatorDashboard /> : <StudentDashboard />;
}

function EducatorDashboard() {
  const [quizzes, setQuizzes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    Promise.all([api.get('/quizzes'), api.get('/rooms/my-rooms')])
      .then(([q, r]) => { setQuizzes(q.data.quizzes); setRooms(r.data.rooms); })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  const createQuiz = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const { data } = await api.post('/quizzes', { title: newTitle, description: newDesc });
      toast.success('Quiz created!');
      navigate(`/quiz/${data.quiz.id}/edit`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create quiz'); }
  };

  const deleteQuiz = async (id) => {
    if (!confirm('Delete this quiz?')) return;
    try {
      await api.delete(`/quizzes/${id}`);
      setQuizzes(q => q.filter(x => x.id !== id));
      toast.success('Quiz deleted');
    } catch { toast.error('Failed to delete'); }
  };

  if (loading) return <div className="page-container"><p style={{color:'var(--text-muted)'}}>Loading...</p></div>;

  return (
    <div className="page-container">
      <div className="dash-header">
        <div>
          <h1>My Quizzes</h1>
          <p className="dash-subtitle">Create, manage, and host your quizzes</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>+ New Quiz</Button>
      </div>

      {showCreate && (
        <form onSubmit={createQuiz} className="create-form animate-slide-up">
          <Input label="Quiz Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Chapter 5 Review" />
          <Input label="Description (optional)" type="textarea" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Brief description..." />
          <div style={{display:'flex',gap:'8px'}}>
            <Button type="submit" size="sm">Create Quiz</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {quizzes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📝</div>
          <h3>No quizzes yet</h3>
          <p>Create your first quiz to get started</p>
        </div>
      ) : (
        <div className="quiz-grid">
          {quizzes.map(q => (
            <div key={q.id} className="quiz-card">
              <div className="quiz-card-header">
                <span className={`quiz-status status-${q.status}`}>{q.status}</span>
                <span className="quiz-questions">{q.question_count} Q</span>
              </div>
              <h3 className="quiz-card-title">{q.title}</h3>
              {q.description && <p className="quiz-card-desc">{q.description}</p>}
              <div className="quiz-card-actions">
                <Link to={`/quiz/${q.id}/edit`}><Button variant="secondary" size="sm">Edit</Button></Link>
                {q.status === 'published' && (
                  <Link to={`/quiz/${q.id}/host`}><Button size="sm" variant="success">Host</Button></Link>
                )}
                <Button variant="ghost" size="sm" onClick={() => deleteQuiz(q.id)}>🗑</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rooms.length > 0 && (
        <div className="rooms-section">
          <h2>Recent Rooms</h2>
          <div className="rooms-grid">
            {rooms.slice(0, 6).map(r => (
              <div key={r.id} className="room-card-mini">
                <div className="room-card-mini-top">
                  <span className={`quiz-status status-${r.status}`}>{r.status}</span>
                  <span className="room-code-mini">{r.room_code}</span>
                </div>
                <h4>{r.quiz_title}</h4>
                <p>{r.participant_count} players</p>
                {r.status === 'waiting' && <Link to={`/room/${r.room_code}/host`}><Button size="sm" fullWidth>Manage</Button></Link>}
                {r.status === 'finished' && <Link to={`/room/${r.room_code}/results`}><Button variant="secondary" size="sm" fullWidth>Results</Button></Link>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StudentDashboard() {
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const joinRoom = async (e) => {
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
    <div className="page-container">
      <div className="student-dash">
        <div className="join-section animate-fade-in">
          <h1>Join a Quiz</h1>
          <p className="dash-subtitle">Enter the room code from your teacher</p>
          <form onSubmit={joinRoom} className="join-form">
            <Input label="Room Code" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} placeholder="ABCD12" style={{textTransform:'uppercase', letterSpacing:'0.15em', fontWeight:700, fontSize:'1.25rem', textAlign:'center'}} />
            <Button type="submit" loading={loading} fullWidth size="lg">Join Room</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
