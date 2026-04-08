import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import api from '../services/api';
import './QuizBuilder.css';

export default function QuizBuilder() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddQ, setShowAddQ] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [qForm, setQForm] = useState({
    questionText: '',
    points: 10,
    options: [
      { optionText: '', isCorrect: true },
      { optionText: '', isCorrect: false },
      { optionText: '', isCorrect: false },
      { optionText: '', isCorrect: false },
    ],
  });
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => { loadQuiz(); }, [id]);

  const loadQuiz = async () => {
    try {
      const { data } = await api.get(`/quizzes/${id}`);
      setQuiz(data.quiz);
    } catch { toast.error('Failed to load quiz'); navigate('/dashboard'); }
    finally { setLoading(false); }
  };

  const updateQuizMeta = async (field, value) => {
    try {
      const { data } = await api.put(`/quizzes/${id}`, { [field]: value });
      setQuiz(prev => ({ ...prev, ...data.quiz }));
    } catch { toast.error('Failed to update'); }
  };

  const resetForm = () => {
    setQForm({
      questionText: '',
      points: 10,
      options: [
        { optionText: '', isCorrect: true },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
      ],
    });
    setEditingQ(null);
    setShowAddQ(false);
  };

  const addQuestion = async (e) => {
    e.preventDefault();
    if (!qForm.questionText.trim()) return toast.error('Question text required');
    const filledOpts = qForm.options.filter(o => o.optionText.trim());
    if (filledOpts.length < 2) return toast.error('At least 2 options required');
    if (!filledOpts.some(o => o.isCorrect)) return toast.error('Mark a correct answer');

    const pts = Math.max(1, parseInt(qForm.points) || 10);

    setSaving(true);
    try {
      if (editingQ) {
        await api.put(`/quizzes/${id}/questions/${editingQ}`, { questionText: qForm.questionText, points: pts, options: filledOpts });
        toast.success('Question updated');
      } else {
        await api.post(`/quizzes/${id}/questions`, { questionText: qForm.questionText, points: pts, options: filledOpts });
        toast.success('Question added');
      }
      await loadQuiz();
      resetForm();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const deleteQuestion = async (qid) => {
    try {
      await api.delete(`/quizzes/${id}/questions/${qid}`);
      await loadQuiz();
      toast.success('Question deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const startEdit = (q) => {
    setEditingQ(q.id);
    setQForm({
      questionText: q.question_text,
      points: q.points || 10,
      options: q.options.map(o => ({ optionText: o.option_text, isCorrect: o.is_correct })),
    });
    setShowAddQ(true);
  };

  const publishQuiz = async () => {
    try {
      await api.put(`/quizzes/${id}/publish`);
      toast.success('Quiz published!');
      await loadQuiz();
    } catch (err) { toast.error(err.response?.data?.error || 'Cannot publish'); }
  };

  if (loading) return <div className="page-container"><p style={{color:'var(--text-muted)'}}>Loading...</p></div>;
  if (!quiz) return null;

  return (
    <div className="page-container">
      <div className="builder-header">
        <div>
          <input className="builder-title-input" value={quiz.title} onChange={e => setQuiz(prev => ({...prev, title: e.target.value}))} onBlur={e => updateQuizMeta('title', e.target.value)} />
          <div className="builder-meta">
            <span className={`quiz-status status-${quiz.status}`}>{quiz.status}</span>
            <span className="builder-meta-text">{quiz.questions?.length || 0} questions</span>
            <span className="builder-meta-text">{quiz.time_per_question}s per question</span>
          </div>
        </div>
        <div className="builder-actions">
          {quiz.status === 'draft' && quiz.questions?.length > 0 && <Button onClick={publishQuiz}>Publish</Button>}
          {quiz.status === 'published' && <Button onClick={() => navigate(`/quiz/${id}/host`)} variant="success">Host Live</Button>}
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>← Back</Button>
        </div>
      </div>

      <div className="builder-settings">
        <label className="setting-item">
          <span>Time per question (seconds)</span>
          <input type="number" min="5" max="120" value={quiz.time_per_question} onChange={e => { setQuiz(prev => ({...prev, time_per_question: +e.target.value})); }} onBlur={e => updateQuizMeta('timePerQuestion', +e.target.value)} className="setting-input" />
        </label>
      </div>

      <div className="questions-list">
        {quiz.questions?.map((q, idx) => (
          <div key={q.id} className="question-item animate-fade-in">
            <div className="q-header">
              <span className="q-number">Q{idx + 1}</span>
              <p className="q-text">{q.question_text}</p>
              <span className="q-points-badge">{q.points || 10} pts</span>
              <div className="q-actions">
                <button className="q-action-btn" onClick={() => startEdit(q)}>✏️</button>
                <button className="q-action-btn" onClick={() => deleteQuestion(q.id)}>🗑️</button>
              </div>
            </div>
            <div className="q-options-grid">
              {q.options?.map((o, oi) => (
                <div key={o.id} className={`q-option ${o.is_correct ? 'q-option-correct' : ''}`}>
                  <span className="q-option-letter">{['A','B','C','D'][oi]}</span>
                  <span>{o.option_text}</span>
                  {o.is_correct && <span className="q-correct-badge">✓</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!showAddQ ? (
        <button className="add-q-btn" onClick={() => setShowAddQ(true)}>+ Add Question</button>
      ) : (
        <form onSubmit={addQuestion} className="q-form animate-slide-up">
          <h3>{editingQ ? 'Edit Question' : 'New Question'}</h3>
          <Input label="Question" type="textarea" value={qForm.questionText} onChange={e => setQForm(f => ({...f, questionText: e.target.value}))} placeholder="Type your question here..." />
          <div style={{display:'flex', gap:'12px', alignItems:'flex-end'}}>
            <div style={{flex: 1}}>
              <Input label="Points" type="number" value={qForm.points} onChange={e => setQForm(f => ({...f, points: +e.target.value || 10}))} />
            </div>
          </div>
          <div className="q-form-options">
            {qForm.options.map((opt, i) => (
              <div key={i} className="q-form-option">
                <label className="q-form-radio">
                  <input type="radio" name="correct" checked={opt.isCorrect} onChange={() => setQForm(f => ({...f, options: f.options.map((o,j)=>({...o, isCorrect: j===i}))}))} />
                  <span className="q-form-letter" style={{background: ['var(--option-a)','var(--option-b)','var(--option-c)','var(--option-d)'][i]}}>
                    {['A','B','C','D'][i]}
                  </span>
                </label>
                <input className="q-form-input" value={opt.optionText} onChange={e => setQForm(f => ({...f, options: f.options.map((o,j)=> j===i ? {...o, optionText: e.target.value} : o)}))} placeholder={`Option ${['A','B','C','D'][i]}`} />
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:'8px'}}>
            <Button type="submit" loading={saving}>{editingQ ? 'Update' : 'Add'} Question</Button>
            <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
