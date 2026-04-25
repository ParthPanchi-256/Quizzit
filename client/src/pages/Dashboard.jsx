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
        <div style={{display:'flex', gap:'8px'}}>
          <Button onClick={() => navigate('/quiz/ai-generate')} variant="secondary">✨ AI Generate</Button>
          <Button onClick={() => setShowCreate(!showCreate)}>+ New Quiz</Button>
        </div>
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
  const [joinLoading, setJoinLoading] = useState(false);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAttempt, setSelectedAttempt] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const digitRefs = useRef([]);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    api.get('/rooms/my-attempts')
      .then(r => setAttempts(r.data.attempts))
      .catch(() => toast.error('Failed to load quiz history'))
      .finally(() => setLoading(false));
  }, []);

  const joinRoom = async (code) => {
    if (code.length < PIN_LENGTH) return toast.error('Enter a complete room code');
    setJoinLoading(true);
    try {
      await api.post(`/rooms/${code}/join`);
      navigate(`/room/${code}/lobby`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to join room');
    } finally { setJoinLoading(false); }
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

  const openDetail = async (attempt) => {
    setSelectedAttempt(attempt);
    setDetailLoading(true);
    setAnswers([]);
    try {
      const { data } = await api.get(`/rooms/${attempt.room_code}/my-answers`);
      setAnswers(data.answers);
    } catch {
      toast.error('Failed to load answers');
    } finally { setDetailLoading(false); }
  };

  const closeDetail = () => {
    setSelectedAttempt(null);
    setAnswers([]);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (ms) => {
    if (!ms) return '—';
    const s = (ms / 1000).toFixed(1);
    return `${s}s`;
  };

  const getOptionLabel = (idx) => {
    return String.fromCharCode(65 + idx); // A, B, C, D…
  };

  return (
    <div className="page-container">
      {/* ── Join Section ────────────────────────────────────────── */}
      <div className="stu-join-bar animate-fade-in">
        <div className="stu-join-left">
          <h2>Join a Quiz</h2>
          <p className="dash-subtitle">Enter room PIN from your teacher</p>
        </div>
        <div className="stu-join-right">
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
          <div className="stu-join-actions">
            <Button onClick={() => joinRoom(pinDigits.join(''))} loading={joinLoading} size="sm"
              disabled={pinDigits.join('').length < PIN_LENGTH}>Join</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/join')}>📷 QR</Button>
          </div>
        </div>
      </div>

      {/* ── Quiz History ────────────────────────────────────────── */}
      <div className="stu-history-section animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <h2>My Quiz History</h2>
        <p className="dash-subtitle">Review your past quiz attempts and answers</p>

        {loading ? (
          <div className="stu-loading">
            {[1,2,3].map(i => <div key={i} className="stu-card-skeleton" />)}
          </div>
        ) : attempts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📚</div>
            <h3>No quizzes yet</h3>
            <p>Join a quiz to see your history here</p>
          </div>
        ) : (
          <div className="stu-history-grid">
            {attempts.map((a, idx) => (
              <div
                key={a.room_code}
                className="stu-quiz-card"
                onClick={() => openDetail(a)}
                style={{ animationDelay: `${idx * 0.05}s` }}
              >
                <div className="stu-card-top">
                  <span className="stu-card-date">{formatDate(a.ended_at)}</span>
                  <span className="stu-rank-badge">
                    #{a.rank} <span className="stu-rank-of">of {a.total_players}</span>
                  </span>
                </div>
                <h3 className="stu-card-title">{a.quiz_title}</h3>
                {a.quiz_description && <p className="stu-card-desc">{a.quiz_description}</p>}
                <div className="stu-card-host">by {a.host_name}</div>
                <div className="stu-card-stats">
                  <div className="stu-stat">
                    <span className="stu-stat-value">{a.score}</span>
                    <span className="stu-stat-label">Score</span>
                  </div>
                  <div className="stu-stat">
                    <span className="stu-stat-value">{a.correct_count}/{a.total_questions}</span>
                    <span className="stu-stat-label">Correct</span>
                  </div>
                  <div className="stu-stat">
                    <span className="stu-stat-value">🔥 {a.best_streak}</span>
                    <span className="stu-stat-label">Streak</span>
                  </div>
                </div>
                <div className="stu-card-accuracy">
                  <div className="stu-accuracy-bar">
                    <div
                      className="stu-accuracy-fill"
                      style={{ width: `${a.total_questions > 0 ? ((a.correct_count / a.total_questions) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="stu-accuracy-text">
                    {a.total_questions > 0 ? Math.round((a.correct_count / a.total_questions) * 100) : 0}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail Modal ────────────────────────────────────────── */}
      {selectedAttempt && (
        <div className="stu-modal-overlay" onClick={closeDetail}>
          <div className="stu-modal" onClick={e => e.stopPropagation()}>
            <button className="stu-modal-close" onClick={closeDetail}>✕</button>

            <div className="stu-modal-header">
              <h2>{selectedAttempt.quiz_title}</h2>
              <div className="stu-modal-meta">
                <span className="stu-rank-badge stu-rank-badge-lg">
                  #{selectedAttempt.rank} of {selectedAttempt.total_players}
                </span>
                <span className="stu-modal-score">{selectedAttempt.score} pts</span>
                <span className="stu-modal-correct">
                  {selectedAttempt.correct_count}/{selectedAttempt.total_questions} correct
                </span>
              </div>
            </div>

            <div className="stu-modal-body">
              {detailLoading ? (
                <div className="stu-detail-loading">
                  <div className="btn-spinner" style={{ width: 28, height: 28, borderWidth: 3, borderColor: 'var(--border)', borderTopColor: 'var(--purple)' }} />
                  <p>Loading answers…</p>
                </div>
              ) : answers.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>No answer data available</p>
              ) : (
                <div className="stu-answers-list">
                  {answers.map((ans, qi) => {
                    const qType = ans.question_type || 'single';
                    return (
                      <div key={qi} className={`stu-answer-card ${ans.is_correct ? 'stu-answer-correct' : 'stu-answer-wrong'}`}>
                        <div className="stu-answer-header">
                          <span className="stu-q-num">Q{qi + 1}</span>
                          <span className={`stu-verdict ${ans.is_correct ? 'stu-verdict-correct' : 'stu-verdict-wrong'}`}>
                            {ans.is_correct ? '✓ Correct' : '✗ Wrong'}
                          </span>
                          <span className="stu-q-points">+{ans.points_awarded} pts</span>
                        </div>
                        <p className="stu-q-text">{ans.question_text}</p>

                        {qType === 'fill_blank' ? (
                          <div className="stu-fill-answer">
                            <div className="stu-your-answer">
                              <span className="stu-answer-label">Your answer:</span>
                              <span className={`stu-answer-text ${ans.is_correct ? 'stu-text-correct' : 'stu-text-wrong'}`}>
                                {ans.text_answer || '(no answer)'}
                              </span>
                            </div>
                            {!ans.is_correct && ans.options && (
                              <div className="stu-correct-answer">
                                <span className="stu-answer-label">Accepted:</span>
                                <span className="stu-answer-text stu-text-correct">
                                  {ans.options.filter(o => o.is_correct).map(o => o.option_text).join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="stu-options-list">
                            {(ans.options || []).map((opt, oi) => {
                              const isSelected = qType === 'multiple'
                                ? (ans.selected_option_ids || []).includes(opt.id)
                                : opt.id === ans.selected_option_id;
                              const isCorrectOpt = opt.is_correct;
                              let optClass = 'stu-opt';
                              if (isSelected && isCorrectOpt) optClass += ' stu-opt-correct-selected';
                              else if (isSelected && !isCorrectOpt) optClass += ' stu-opt-wrong-selected';
                              else if (isCorrectOpt) optClass += ' stu-opt-correct-unselected';

                              return (
                                <div key={opt.id} className={optClass}>
                                  <span className="stu-opt-letter">{getOptionLabel(oi)}</span>
                                  <span className="stu-opt-text">{opt.option_text}</span>
                                  {isSelected && <span className="stu-opt-badge">{isCorrectOpt ? '✓' : '✗'}</span>}
                                  {!isSelected && isCorrectOpt && <span className="stu-opt-badge stu-opt-badge-correct">✓</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="stu-answer-footer">
                          <span className="stu-time-taken">⏱ {formatTime(ans.time_taken_ms)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
