import { useState, useEffect, useRef } from 'react';
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
  const PIN_LENGTH = 6;
  const [pinDigits, setPinDigits] = useState(Array(PIN_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const digitRefs = useRef([]);
  const navigate = useNavigate();
  const toast = useToast();

  const joinRoom = async (code) => {
    if (code.length < PIN_LENGTH) return toast.error('Enter a complete room code');
    setLoading(true);
    try {
      await api.post(`/rooms/${code}/join`);
      navigate(`/room/${code}/lobby`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join room');
    } finally { setLoading(false); }
  };

  const handleDigitChange = (index, value) => {
    if (!/^[a-zA-Z0-9]?$/.test(value)) return;
    const newDigits = [...pinDigits];
    newDigits[index] = value.toUpperCase();
    setPinDigits(newDigits);
    if (value && index < PIN_LENGTH - 1) digitRefs.current[index + 1]?.focus();
    if (value && index === PIN_LENGTH - 1) {
      const code = newDigits.join('');
      if (code.length === PIN_LENGTH) joinRoom(code);
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) digitRefs.current[index - 1]?.focus();
    if (e.key === 'Enter') { const code = pinDigits.join(''); if (code.length === PIN_LENGTH) joinRoom(code); }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\s/g, '').toUpperCase().slice(0, PIN_LENGTH);
    if (pasted.length > 0) {
      const newDigits = Array(PIN_LENGTH).fill('');
      pasted.split('').forEach((ch, i) => { if (i < PIN_LENGTH) newDigits[i] = ch; });
      setPinDigits(newDigits);
      if (pasted.length === PIN_LENGTH) setTimeout(() => joinRoom(pasted), 200);
      else digitRefs.current[pasted.length]?.focus();
    }
  };

  return (
    <div className="page-container">
      <div className="student-dash">
        <div className="join-section animate-fade-in">
          <h1>Join a Quiz</h1>
          <p className="dash-subtitle">Enter the room PIN from your teacher</p>
          <div className="student-pin-row" onPaste={handlePaste}>
            {pinDigits.map((d, i) => (
              <input
                key={i}
                ref={el => digitRefs.current[i] = el}
                className={`student-pin-digit ${d ? 'student-pin-filled' : ''}`}
                type="text" maxLength={1} value={d}
                onChange={e => handleDigitChange(i, e.target.value)}
                onKeyDown={e => handleDigitKeyDown(i, e)}
                autoFocus={i === 0} inputMode="text" autoComplete="off"
              />
            ))}
          </div>
          <Button onClick={() => joinRoom(pinDigits.join(''))} loading={loading} fullWidth size="lg"
            disabled={pinDigits.join('').length < PIN_LENGTH}>Join Room</Button>
          <div className="student-alt-join">
            <span>or</span>
            <Button variant="ghost" size="sm" onClick={() => navigate('/join')}>📷 Scan QR Code</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
