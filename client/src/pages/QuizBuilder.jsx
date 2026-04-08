import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import api from '../services/api';
import './QuizBuilder.css';

const QUESTION_TYPES = [
  { value: 'single', label: '⚡ Single Choice', desc: 'One correct answer' },
  { value: 'multiple', label: '☑️ Multiple Choice', desc: 'Multiple correct answers' },
  { value: 'fill_blank', label: '✏️ Fill in the Blank', desc: 'Type the answer' },
];

export default function QuizBuilder() {
  const { id } = useParams();
  const [quiz, setQuiz] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddQ, setShowAddQ] = useState(false);
  const [editingQ, setEditingQ] = useState(null);
  const [qForm, setQForm] = useState(makeDefaultForm('single'));
  const navigate = useNavigate();
  const toast = useToast();

  function makeDefaultForm(type) {
    if (type === 'fill_blank') {
      return {
        questionText: '',
        questionType: 'fill_blank',
        points: 10,
        options: [{ optionText: '', isCorrect: true }],
      };
    }
    return {
      questionText: '',
      questionType: type || 'single',
      points: 10,
      options: [
        { optionText: '', isCorrect: type === 'single' },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
        { optionText: '', isCorrect: false },
      ],
    };
  }

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
    setQForm(makeDefaultForm('single'));
    setEditingQ(null);
    setShowAddQ(false);
  };

  const switchType = (type) => {
    setQForm(prev => {
      const form = makeDefaultForm(type);
      form.questionText = prev.questionText;
      form.points = prev.points;
      return form;
    });
  };

  const addQuestion = async (e) => {
    e.preventDefault();
    if (!qForm.questionText.trim()) return toast.error('Question text required');

    const type = qForm.questionType;

    if (type === 'fill_blank') {
      const filled = qForm.options.filter(o => o.optionText.trim());
      if (filled.length < 1) return toast.error('Add at least one accepted answer');
    } else {
      const filledOpts = qForm.options.filter(o => o.optionText.trim());
      if (filledOpts.length < 2) return toast.error('At least 2 options required');
      if (!filledOpts.some(o => o.isCorrect)) return toast.error('Mark a correct answer');
      if (type === 'multiple' && filledOpts.filter(o => o.isCorrect).length < 2) return toast.error('Mark at least 2 correct answers');
    }

    const pts = Math.max(1, parseInt(qForm.points) || 10);
    const options = type === 'fill_blank'
      ? qForm.options.filter(o => o.optionText.trim()).map(o => ({ optionText: o.optionText.trim(), isCorrect: true }))
      : qForm.options.filter(o => o.optionText.trim());

    setSaving(true);
    try {
      if (editingQ) {
        await api.put(`/quizzes/${id}/questions/${editingQ}`, { questionText: qForm.questionText, questionType: type, points: pts, options });
        toast.success('Question updated');
      } else {
        await api.post(`/quizzes/${id}/questions`, { questionText: qForm.questionText, questionType: type, points: pts, options });
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
    const type = q.question_type || 'single';
    setEditingQ(q.id);
    if (type === 'fill_blank') {
      setQForm({
        questionText: q.question_text,
        questionType: 'fill_blank',
        points: q.points || 10,
        options: (q.options || []).map(o => ({ optionText: o.option_text, isCorrect: true })),
      });
    } else {
      const opts = (q.options || []).map(o => ({ optionText: o.option_text, isCorrect: o.is_correct }));
      while (opts.length < 4) opts.push({ optionText: '', isCorrect: false });
      setQForm({
        questionText: q.question_text,
        questionType: type,
        points: q.points || 10,
        options: opts,
      });
    }
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

  const TYPE_LABEL = { single: '⚡ Single', multiple: '☑️ Multi', fill_blank: '✏️ Fill' };

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

      {/* ─── Question List ──────────────────────── */}
      <div className="questions-list">
        {quiz.questions?.map((q, idx) => {
          const type = q.question_type || 'single';
          return (
            <div key={q.id} className="question-item animate-fade-in">
              <div className="q-header">
                <span className="q-number">Q{idx + 1}</span>
                <span className={`q-type-badge q-type-${type}`}>{TYPE_LABEL[type]}</span>
                <p className="q-text">{q.question_text}</p>
                <span className="q-points-badge">{q.points || 10} pts</span>
                <div className="q-actions">
                  <button className="q-action-btn" onClick={() => startEdit(q)}>✏️</button>
                  <button className="q-action-btn" onClick={() => deleteQuestion(q.id)}>🗑️</button>
                </div>
              </div>
              {type === 'fill_blank' ? (
                <div className="q-accepted-answers">
                  <span className="q-accepted-label">Accepted:</span>
                  {q.options?.map((o, i) => (
                    <span key={i} className="q-accepted-chip">{o.option_text}</span>
                  ))}
                </div>
              ) : (
                <div className="q-options-grid">
                  {q.options?.map((o, oi) => (
                    <div key={o.id} className={`q-option ${o.is_correct ? 'q-option-correct' : ''}`}>
                      <span className="q-option-letter">{['A','B','C','D'][oi]}</span>
                      <span>{o.option_text}</span>
                      {o.is_correct && <span className="q-correct-badge">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Add / Edit Question Form ──────────── */}
      {!showAddQ ? (
        <button className="add-q-btn" onClick={() => setShowAddQ(true)}>+ Add Question</button>
      ) : (
        <form onSubmit={addQuestion} className="q-form animate-slide-up">
          <h3>{editingQ ? 'Edit Question' : 'New Question'}</h3>

          {/* Type selector */}
          <div className="q-type-selector">
            {QUESTION_TYPES.map(t => (
              <button key={t.value} type="button"
                className={`q-type-btn ${qForm.questionType === t.value ? 'q-type-btn-active' : ''}`}
                onClick={() => switchType(t.value)}>
                <span className="q-type-btn-label">{t.label}</span>
                <span className="q-type-btn-desc">{t.desc}</span>
              </button>
            ))}
          </div>

          <Input label="Question" type="textarea" value={qForm.questionText} onChange={e => setQForm(f => ({...f, questionText: e.target.value}))} placeholder="Type your question here..." />

          <div style={{display:'flex', gap:'12px', alignItems:'flex-end'}}>
            <div style={{flex: 1}}>
              <Input label="Points" type="number" value={qForm.points} onChange={e => setQForm(f => ({...f, points: +e.target.value || 10}))} />
            </div>
          </div>

          {/* ─── Fill in the Blank: accepted answers ─── */}
          {qForm.questionType === 'fill_blank' && (
            <div className="q-fill-section">
              <label className="q-fill-label">Accepted Answers <span className="q-fill-hint">(case-insensitive matching)</span></label>
              {qForm.options.map((opt, i) => (
                <div key={i} className="q-fill-row">
                  <input className="q-form-input" value={opt.optionText} onChange={e => setQForm(f => ({...f, options: f.options.map((o,j)=> j===i ? {...o, optionText: e.target.value} : o)}))} placeholder={`Answer ${i + 1}`} />
                  {qForm.options.length > 1 && (
                    <button type="button" className="q-fill-remove" onClick={() => setQForm(f => ({...f, options: f.options.filter((_,j) => j !== i)}))}>✕</button>
                  )}
                </div>
              ))}
              <button type="button" className="q-fill-add" onClick={() => setQForm(f => ({...f, options: [...f.options, {optionText:'', isCorrect:true}]}))}>+ Add accepted answer</button>
            </div>
          )}

          {/* ─── Single / Multiple Choice: options ─── */}
          {qForm.questionType !== 'fill_blank' && (
            <div className="q-form-options">
              {qForm.options.map((opt, i) => (
                <div key={i} className="q-form-option">
                  <label className="q-form-radio">
                    {qForm.questionType === 'multiple' ? (
                      <input type="checkbox" checked={opt.isCorrect} onChange={() => setQForm(f => ({...f, options: f.options.map((o,j)=> j===i ? {...o, isCorrect: !o.isCorrect} : o)}))} />
                    ) : (
                      <input type="radio" name="correct" checked={opt.isCorrect} onChange={() => setQForm(f => ({...f, options: f.options.map((o,j)=>({...o, isCorrect: j===i}))}))} />
                    )}
                    <span className="q-form-letter" style={{background: ['var(--option-a)','var(--option-b)','var(--option-c)','var(--option-d)'][i]}}>
                      {['A','B','C','D'][i]}
                    </span>
                  </label>
                  <input className="q-form-input" value={opt.optionText} onChange={e => setQForm(f => ({...f, options: f.options.map((o,j)=> j===i ? {...o, optionText: e.target.value} : o)}))} placeholder={`Option ${['A','B','C','D'][i]}`} />
                </div>
              ))}
            </div>
          )}

          <div style={{display:'flex',gap:'8px'}}>
            <Button type="submit" loading={saving}>{editingQ ? 'Update' : 'Add'} Question</Button>
            <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
