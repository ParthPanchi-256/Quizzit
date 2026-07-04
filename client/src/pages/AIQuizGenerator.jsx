import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import './AIQuizGenerator.css';

const AI_API = `http://${window.location.hostname}:8000`;
const PHASE_STEPS = ['analyzing', 'clarifying', 'searching', 'generating', 'verifying', 'done'];
const PHASE_LABELS = {
  uploading: 'Upload', analyzing: 'Analyze', clarifying: 'Configure',
  searching: 'Search', generating: 'Generate', verifying: 'Verify', done: 'Done', error: 'Error',
};

export default function AIQuizGenerator() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [phase, setPhase] = useState('uploading');
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [quiz, setQuiz] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [files, setFiles] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Start session ──────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!files.length && !prompt.trim()) {
      toast.error('Upload a file or enter a prompt');
      return;
    }
    setLoading(true);
    setMessages([]);
    setPhase('analyzing');

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      if (prompt.trim()) formData.append('prompt', prompt.trim());

      const res = await fetch(`${AI_API}/ai/sessions`, { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to start session');
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setMessages(data.messages || []);
      setPhase(data.phase);
      setWaitingForInput(data.waitingForInput);
      if (data.quiz) setQuiz(data.quiz);
    } catch (e) {
      toast.error(e.message);
      setPhase('uploading');
    } finally {
      setLoading(false);
    }
  }, [files, prompt, toast]);

  // ── Send message ───────────────────────────────────────────
  const sendMessage = useCallback(async (e) => {
    e?.preventDefault();
    if (!userInput.trim() || !sessionId || loading) return;

    const msg = userInput.trim();
    setUserInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    setWaitingForInput(false);

    try {
      const res = await fetch(`${AI_API}/ai/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      const data = await res.json();
      setMessages(data.messages || []);
      setPhase(data.phase);
      setWaitingForInput(data.waitingForInput);
      if (data.quiz) setQuiz(data.quiz);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [userInput, sessionId, loading, toast]);

  // ── Finalize (push to Quizzit) ─────────────────────────────
  const finalizeQuiz = useCallback(async () => {
    if (!sessionId || !quiz) return;
    setFinalizing(true);
    try {
      const res = await fetch(`${AI_API}/ai/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizzitToken: token }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Quiz created! Redirecting...');
        setTimeout(() => navigate(`/quiz/${data.quizId}/edit`), 1000);
      } else {
        toast.error(data.message || 'Failed to create quiz');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setFinalizing(false);
    }
  }, [sessionId, quiz, token, navigate, toast]);

  // ── File handling ──────────────────────────────────────────
  const handleFiles = (newFiles) => {
    const valid = Array.from(newFiles).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf', 'pptx', 'ppt', 'txt', 'md'].includes(ext);
    });
    setFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('aiq-drop-active');
    handleFiles(e.dataTransfer.files);
  };

  // ── Phase stepper ──────────────────────────────────────────
  const currentStep = PHASE_STEPS.indexOf(phase);

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div className="aiq-page">
      <div className="aiq-container">
        {/* ── Header ── */}
        <div className="aiq-header">
          <h1 className="aiq-title">✨ AI Quiz Generator</h1>
          <p className="aiq-subtitle">Upload content or describe your topic — AI will create the quiz for you</p>
        </div>

        {/* ── Phase Stepper ── */}
        {phase !== 'uploading' && (
          <div className="aiq-stepper">
            {PHASE_STEPS.map((step, i) => (
              <div key={step} className={`aiq-step ${i <= currentStep ? 'aiq-step-active' : ''} ${i === currentStep ? 'aiq-step-current' : ''}`}>
                <div className="aiq-step-dot">
                  {i < currentStep ? '✓' : i + 1}
                </div>
                <span className="aiq-step-label">{PHASE_LABELS[step]}</span>
              </div>
            ))}
          </div>
        )}

        <div className="aiq-main">
          {/* ═══ UPLOAD PHASE ═══ */}
          {phase === 'uploading' && (
            <div className="aiq-upload-section animate-fade-in">
              {/* Drop zone */}
              <div
                className="aiq-dropzone"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('aiq-drop-active'); }}
                onDragLeave={e => e.currentTarget.classList.remove('aiq-drop-active')}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" multiple accept=".pdf,.pptx,.ppt,.txt,.md"
                  style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                <div className="aiq-dropzone-icon">📄</div>
                <p className="aiq-dropzone-text">Drag & drop files here or <span className="aiq-dropzone-link">browse</span></p>
                <p className="aiq-dropzone-hint">PDF, PPTX, TXT • Max 10MB each</p>
              </div>

              {/* File chips */}
              {files.length > 0 && (
                <div className="aiq-file-list">
                  {files.map((f, i) => (
                    <div key={i} className="aiq-file-chip">
                      <span className="aiq-file-icon">
                        {f.name.endsWith('.pdf') ? '📕' : f.name.endsWith('.pptx') || f.name.endsWith('.ppt') ? '📊' : '📝'}
                      </span>
                      <span className="aiq-file-name">{f.name}</span>
                      <button className="aiq-file-remove" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Divider */}
              <div className="aiq-divider"><span>or enter a prompt</span></div>

              {/* Prompt input */}
              <textarea
                className="aiq-prompt-input"
                placeholder="Describe what you want the quiz about...&#10;&#10;Example: &quot;Create a quiz about the French Revolution covering causes, key events, and outcomes. Focus on AP History level.&quot;"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
              />

              <Button onClick={startSession} size="lg" disabled={loading || (!files.length && !prompt.trim())}>
                {loading ? 'Analyzing...' : '🚀 Generate Quiz'}
              </Button>
            </div>
          )}

          {/* ═══ CHAT PHASE ═══ */}
          {phase !== 'uploading' && (
            <div className="aiq-chat-section animate-fade-in">
              <div className="aiq-chat-messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`aiq-msg aiq-msg-${msg.role}`}>
                    {msg.role === 'assistant' && <div className="aiq-msg-avatar">🤖</div>}
                    <div className="aiq-msg-bubble">
                      <div className="aiq-msg-content" dangerouslySetInnerHTML={{
                        __html: msg.content
                          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                          .replace(/_(.*?)_/g, '<em>$1</em>')
                          .replace(/\n/g, '<br/>')
                      }} />
                    </div>
                    {msg.role === 'user' && <div className="aiq-msg-avatar aiq-msg-avatar-user">You</div>}
                  </div>
                ))}
                {loading && (
                  <div className="aiq-msg aiq-msg-assistant">
                    <div className="aiq-msg-avatar">🤖</div>
                    <div className="aiq-msg-bubble">
                      <div className="aiq-typing"><span /><span /><span /></div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input area — shown when waiting for input */}
              {waitingForInput && !loading && (
                <form className="aiq-chat-input" onSubmit={sendMessage}>
                  <input
                    type="text"
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    placeholder="Type your response..."
                    autoFocus
                  />
                  <button type="submit" disabled={!userInput.trim()}>Send</button>
                </form>
              )}

              {/* Done — show preview + create buttons */}
              {phase === 'done' && quiz && (
                <div className="aiq-done-actions">
                  <Button onClick={() => setShowPreview(!showPreview)} variant="secondary">
                    {showPreview ? 'Hide Preview' : `👀 Preview ${quiz.questions.length} Questions`}
                  </Button>
                  <Button onClick={finalizeQuiz} disabled={finalizing}>
                    {finalizing ? 'Creating...' : '🚀 Create & Edit Quiz'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ═══ QUIZ PREVIEW ═══ */}
          {showPreview && quiz && (
            <div className="aiq-preview animate-slide-up">
              <h3 className="aiq-preview-title">{quiz.title}</h3>
              <p className="aiq-preview-desc">{quiz.description}</p>

              <div className="aiq-preview-questions">
                {quiz.questions.map((q, qi) => (
                  <div key={qi} className="aiq-preview-q">
                    <div className="aiq-preview-q-header">
                      <span className="aiq-preview-q-num">Q{qi + 1}</span>
                      <span className="aiq-preview-q-type">{q.questionType}</span>
                      <span className="aiq-preview-q-pts">{q.points} pts</span>
                    </div>
                    <p className="aiq-preview-q-text">{q.questionText}</p>
                    <div className="aiq-preview-options">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={`aiq-preview-opt ${opt.isCorrect ? 'aiq-preview-correct' : ''}`}>
                          {opt.isCorrect ? '✓' : '○'} {opt.optionText}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
