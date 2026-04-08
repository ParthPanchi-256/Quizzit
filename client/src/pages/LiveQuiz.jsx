import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import './LiveQuiz.css';

const OPTION_COLORS = ['var(--option-a)', 'var(--option-b)', 'var(--option-c)', 'var(--option-d)'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function LiveQuiz() {
  const { code } = useParams();
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHost = user?.role === 'educator';

  const [phase, setPhase] = useState('waiting');
  const [question, setQuestion] = useState(null);
  const [shuffledOptions, setShuffledOptions] = useState([]);
  const [qIndex, setQIndex] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [timeLimit, setTimeLimit] = useState(30);
  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedOption, setSelectedOption] = useState(null);
  const [selectedOptions, setSelectedOptions] = useState(new Set());
  const [textAnswer, setTextAnswer] = useState('');
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [answerResult, setAnswerResult] = useState(null);
  const [correctOptionId, setCorrectOptionId] = useState(null);
  const [correctOptionIds, setCorrectOptionIds] = useState(null);
  const [acceptedAnswers, setAcceptedAnswers] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [personalResult, setPersonalResult] = useState(null);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [totalScore, setTotalScore] = useState(0);
  const [countdownNum, setCountdownNum] = useState(3);
  const [stats, setStats] = useState(null);
  const [rankDelta, setRankDelta] = useState(0); // +1 = moved up, -1 = moved down

  const timerRef = useRef(null);
  const questionEndTimeRef = useRef(null);
  const mountedRef = useRef(true);
  const joinedRef = useRef(false);
  const phaseRef = useRef(phase);
  const qIndexRef = useRef(qIndex);
  const prevRankRef = useRef(null);
  const myRowRef = useRef(null);
  const rankArrowTimerRef = useRef(null);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { qIndexRef.current = qIndex; }, [qIndex]);

  // Track rank changes & auto-scroll
  useEffect(() => {
    if (!personalResult?.rank) return;
    const currentRank = personalResult.rank;
    if (prevRankRef.current !== null && prevRankRef.current !== currentRank) {
      const delta = prevRankRef.current - currentRank; // positive = moved up
      setRankDelta(delta > 0 ? 1 : -1);
      if (rankArrowTimerRef.current) clearTimeout(rankArrowTimerRef.current);
      rankArrowTimerRef.current = setTimeout(() => setRankDelta(0), 1500);
    }
    prevRankRef.current = currentRank;
    // Auto-scroll player's row into view
    setTimeout(() => {
      myRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, [personalResult?.rank]);

  const startTimer = useCallback((durationSec, endTimeMs) => {
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    const endTime = endTimeMs || (Date.now() + durationSec * 1000);
    questionEndTimeRef.current = endTime;
    const tick = () => {
      if (!mountedRef.current) return;
      const remaining = Math.max(0, (endTime - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining > 0) timerRef.current = requestAnimationFrame(tick);
    };
    timerRef.current = requestAnimationFrame(tick);
  }, []);
  const stopTimer = useCallback(() => {
    if (timerRef.current) { cancelAnimationFrame(timerRef.current); timerRef.current = null; }
  }, []);

  // ─── Reset question-level state ───────────────────────────────────
  const resetQuestionState = useCallback(() => {
    setSelectedOption(null);
    setSelectedOptions(new Set());
    setTextAnswer('');
    setAnswerSubmitted(false);
    setAnswerResult(null);
    setCorrectOptionId(null);
    setCorrectOptionIds(null);
    setAcceptedAnswers(null);
    setPersonalResult(null);
    setStats(null);
    setAnswerCount({ answered: 0, total: 0 });
  }, []);

  // ─── Join + state recovery ────────────────────────────────────────
  useEffect(() => {
    if (!socket || joinedRef.current) return;
    joinedRef.current = true;
    socket.emit('room:rejoin', { roomCode: code });
    const t = setTimeout(() => socket.emit('game:getState', { roomCode: code }), 400);
    return () => clearTimeout(t);
  }, [socket, code]);

  // ─── Socket listeners ─────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    mountedRef.current = true;

    const handleState = (data) => {
      if (!mountedRef.current) return;
      switch (data.phase) {
        case 'countdown': setPhase('countdown'); setCountdownNum(data.countdown || 3); break;
        case 'question':
          setQuestion(data.question);
          setShuffledOptions(isHost ? data.question.options : shuffleArray(data.question.options));
          setQIndex(data.index); setTotalQ(data.total); setTimeLimit(data.timeLimit);
          resetQuestionState();
          setPhase('question'); startTimer(data.timeRemaining); break;
        case 'answered':
          setQuestion(data.question);
          setShuffledOptions(isHost ? data.question.options : shuffleArray(data.question.options));
          setQIndex(data.index); setTotalQ(data.total); setTimeLimit(data.timeLimit);
          setAnswerSubmitted(true);
          if (data.answerResult?.selectedOptionId) setSelectedOption(data.answerResult.selectedOptionId);
          if (data.answerResult?.selectedOptionIds) setSelectedOptions(new Set(data.answerResult.selectedOptionIds));
          setPhase('answered'); startTimer(data.timeRemaining); break;
        case 'reveal':
          setQuestion(data.question);
          if (data.question) setShuffledOptions(isHost ? data.question.options : shuffleArray(data.question.options));
          setQIndex(data.index); setTotalQ(data.total);
          setCorrectOptionId(data.correctOptionId); setCorrectOptionIds(data.correctOptionIds);
          setPhase('reveal'); setTimeLeft(0); break;
        case 'leaderboard': setLeaderboard(data.leaderboard || []); setQIndex(data.index); setTotalQ(data.total); setPhase('leaderboard'); break;
        case 'finished': navigate(`/room/${code}/results`, { replace: true }); break;
        default: setPhase('waiting'); break;
      }
    };

    const handleQuestionShow = (data) => {
      if (!mountedRef.current) return;
      stopTimer();
      setQuestion(data.question);
      setShuffledOptions(isHost ? data.question.options : shuffleArray(data.question.options));
      setQIndex(data.index); setTotalQ(data.total);
      setTimeLimit(data.timeLimit); setTimeLeft(data.timeLimit);
      resetQuestionState();
      setPhase('question');
      const endTimeMs = data.questionStartTime ? data.questionStartTime + data.timeLimit * 1000 : Date.now() + data.timeLimit * 1000;
      startTimer(data.timeLimit, endTimeMs);
    };

    const handleAnswered = (data) => {
      if (!mountedRef.current) return;
      setAnswerSubmitted(true);
      if (data.selectedOptionId) setSelectedOption(data.selectedOptionId);
      if (data.selectedOptionIds) setSelectedOptions(new Set(data.selectedOptionIds));
      setTotalScore(data.totalScore);
      setPhase('answered');
    };
    const handleAnswerCount = (data) => { if (mountedRef.current) setAnswerCount(data); };

    const handleTimeUp = (data) => {
      if (!mountedRef.current) return;
      stopTimer(); setTimeLeft(0);
      setCorrectOptionId(data.correctOptionId || null);
      setCorrectOptionIds(data.correctOptionIds || null);
      setAcceptedAnswers(data.acceptedAnswers || null);
      if (data.stats) setStats(data.stats);
      setPhase('reveal');
    };

    const handleAnswerReveal = (data) => {
      if (!mountedRef.current) return;
      setAnswerResult(data); setTotalScore(data.totalScore);
    };
    const handleResults = (data) => { if (mountedRef.current) { setLeaderboard(data.leaderboard); setPhase('leaderboard'); } };
    const handlePersonalResult = (data) => { if (mountedRef.current) setPersonalResult(data); };
    const handleFinished = (data) => { if (!mountedRef.current) return; stopTimer(); navigate(`/room/${code}/results`, { state: data, replace: true }); };

    const handleTickSync = (data) => {
      if (!mountedRef.current) return;
      if (data.questionIndex === qIndexRef.current && (phaseRef.current === 'question' || phaseRef.current === 'answered'))
        questionEndTimeRef.current = Date.now() + data.timeRemaining * 1000;
    };
    const handleQuizStarted = (data) => { if (mountedRef.current) { setTotalQ(data.totalQuestions); setPhase('countdown'); setCountdownNum(data.countdown || 3); } };

    socket.on('game:state', handleState);
    socket.on('question:show', handleQuestionShow);
    socket.on('question:answered', handleAnswered);
    socket.on('question:answerCount', handleAnswerCount);
    socket.on('question:timeUp', handleTimeUp);
    socket.on('question:answerReveal', handleAnswerReveal);
    socket.on('question:results', handleResults);
    socket.on('question:personalResult', handlePersonalResult);
    socket.on('room:finished', handleFinished);
    socket.on('room:tickSync', handleTickSync);
    socket.on('room:quizStarted', handleQuizStarted);

    return () => {
      mountedRef.current = false; stopTimer();
      socket.off('game:state', handleState); socket.off('question:show', handleQuestionShow);
      socket.off('question:answered', handleAnswered); socket.off('question:answerCount', handleAnswerCount);
      socket.off('question:timeUp', handleTimeUp); socket.off('question:answerReveal', handleAnswerReveal);
      socket.off('question:results', handleResults); socket.off('question:personalResult', handlePersonalResult);
      socket.off('room:finished', handleFinished); socket.off('room:tickSync', handleTickSync);
      socket.off('room:quizStarted', handleQuizStarted);
    };
  }, [socket, code, navigate, startTimer, stopTimer, isHost, resetQuestionState]);

  // Countdown
  useEffect(() => {
    if (phase !== 'countdown' || countdownNum <= 0) return;
    const i = setInterval(() => setCountdownNum(p => { if (p <= 1) { clearInterval(i); return 0; } return p - 1; }), 1000);
    return () => clearInterval(i);
  }, [phase, countdownNum]);

  // ─── Actions ──────────────────────────────────────────────────────
  const submitSingle = (optionId) => {
    if (isHost || answerSubmitted || phase !== 'question' || !question) return;
    setSelectedOption(optionId);
    setAnswerSubmitted(true);
    socket.emit('question:answer', { roomCode: code, questionId: question.id, optionId });
  };

  const toggleMultiple = (optionId) => {
    if (isHost || answerSubmitted || phase !== 'question') return;
    setSelectedOptions(prev => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId); else next.add(optionId);
      return next;
    });
  };

  const submitMultiple = () => {
    if (isHost || answerSubmitted || phase !== 'question' || selectedOptions.size === 0 || !question) return;
    setAnswerSubmitted(true);
    socket.emit('question:answer', { roomCode: code, questionId: question.id, optionIds: [...selectedOptions] });
  };

  const submitFillBlank = (e) => {
    e?.preventDefault();
    if (isHost || answerSubmitted || phase !== 'question' || !textAnswer.trim() || !question) return;
    setAnswerSubmitted(true);
    socket.emit('question:answer', { roomCode: code, questionId: question.id, textAnswer: textAnswer.trim() });
  };

  const nextQuestion = () => socket.emit('question:next', { roomCode: code });
  const endQuiz = () => socket.emit('room:end', { roomCode: code });

  const timerPercent = timeLimit > 0 ? (timeLeft / timeLimit) * 100 : 0;
  const timerColor = timerPercent > 50 ? 'var(--green)' : timerPercent > 20 ? 'var(--amber)' : 'var(--red)';
  const displayOptions = shuffledOptions.length > 0 ? shuffledOptions : (question?.options || []);
  const qType = question?.questionType || 'single';

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  if (phase === 'waiting') return (
    <div className="live-quiz-page"><div className="lq-waiting-screen">
      <div className="lq-waiting-spinner" /><h2>Preparing your quiz...</h2><p>Hang tight — questions are loading</p>
    </div></div>
  );

  if (phase === 'countdown') return (
    <div className="live-quiz-page"><div className="lq-countdown-screen">
      {countdownNum > 0 ? (<><div className="lq-countdown-number" key={countdownNum}>{countdownNum}</div><p className="lq-countdown-text">Get Ready!</p></>) :
      (<><div className="lq-countdown-go">GO!</div><p className="lq-countdown-text">Here comes the first question...</p></>)}
    </div></div>
  );

  return (
    <div className="live-quiz-page">
      <div className="timer-bar-container"><div className="timer-bar" style={{ width: `${timerPercent}%`, background: timerColor }} /></div>

      <div className="lq-header">
        <div className="lq-progress">Q{qIndex + 1}/{totalQ}</div>
        <div className={`lq-timer ${timeLeft <= 5 && timeLeft > 0 ? 'lq-timer-danger' : ''}`}>{Math.ceil(timeLeft)}s</div>
        {isHost ? <div className="lq-score lq-host-badge">👨‍🏫 Host</div> : <div className="lq-score">{totalScore} pts</div>}
      </div>

      <div className="lq-content">
        {(phase === 'question' || phase === 'answered' || phase === 'reveal') && question && (
          <>
            <div className="lq-question animate-fade-in" key={question.id}>
              <h2>{question.questionText}</h2>
              <div className="lq-question-meta">
                {question.points && <span className="lq-question-points">{question.points} pts</span>}
                {qType === 'multiple' && <span className="lq-question-type-hint">Select all correct answers</span>}
                {qType === 'fill_blank' && <span className="lq-question-type-hint">Type your answer</span>}
              </div>
            </div>

            {/* ═══ HOST VIEW ═══ */}
            {isHost ? (
              <div className="lq-host-view">
                {qType === 'fill_blank' ? (
                  <div className="lq-fill-host">
                    <div className="lq-fill-host-label">Students are typing their answers...</div>
                    {phase === 'reveal' && acceptedAnswers && (
                      <div className="lq-fill-accepted">
                        <span className="lq-fill-accepted-label">Accepted answers:</span>
                        {acceptedAnswers.map((a, i) => <span key={i} className="lq-fill-chip">{a}</span>)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="lq-options-grid">
                    {displayOptions.map((opt, i) => {
                      let cls = 'lq-option lq-option-host';
                      if (phase === 'reveal') {
                        if (qType === 'multiple' && correctOptionIds?.includes(opt.id)) cls += ' lq-option-correct';
                        else if (qType === 'single' && opt.id === correctOptionId) cls += ' lq-option-correct';
                      }
                      return (
                        <div key={opt.id} className={cls} style={{ '--opt-color': OPTION_COLORS[i] }}>
                          <span className="lq-option-letter">{OPTION_LETTERS[i]}</span>
                          <span className="lq-option-text">{opt.optionText}</span>
                          {phase === 'reveal' && stats?.optionCounts && <span className="lq-option-count">{stats.optionCounts[opt.id] || 0}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="lq-host-bar"><span>{answerCount.answered}/{answerCount.total} answered</span></div>
              </div>
            ) : (
              /* ═══ STUDENT VIEW ═══ */
              <>
                {/* ── Fill in the Blank ── */}
                {qType === 'fill_blank' && (
                  <div className="lq-fill-section">
                    {phase === 'question' && !answerSubmitted ? (
                      <form onSubmit={submitFillBlank} className="lq-fill-form">
                        <input type="text" className="lq-fill-input" value={textAnswer}
                          onChange={e => setTextAnswer(e.target.value)} placeholder="Type your answer..."
                          autoFocus autoComplete="off" />
                        <button type="submit" className="btn btn-primary btn-lg lq-fill-submit"
                          disabled={!textAnswer.trim()}>Submit</button>
                      </form>
                    ) : (
                      <div className="lq-fill-submitted">
                        {answerSubmitted && <p className="lq-fill-your-answer">Your answer: <strong>{answerResult?.textAnswer || textAnswer}</strong></p>}
                      </div>
                    )}
                    {phase === 'reveal' && acceptedAnswers && (
                      <div className="lq-fill-accepted">
                        <span className="lq-fill-accepted-label">Accepted:</span>
                        {acceptedAnswers.map((a, i) => <span key={i} className="lq-fill-chip">{a}</span>)}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Multiple Choice ── */}
                {qType === 'multiple' && (
                  <>
                    <div className="lq-options-grid">
                      {displayOptions.map((opt, i) => {
                        let cls = 'lq-option';
                        const isSelected = selectedOptions.has(opt.id);
                        if (isSelected) cls += ' lq-option-selected';
                        if (phase === 'reveal') {
                          if (correctOptionIds?.includes(opt.id)) cls += ' lq-option-correct';
                          else if (isSelected) cls += ' lq-option-wrong';
                        }
                        return (
                          <button key={opt.id} className={cls} onClick={() => toggleMultiple(opt.id)}
                            disabled={answerSubmitted || phase !== 'question'}
                            style={{ '--opt-color': OPTION_COLORS[i] }}>
                            <span className="lq-option-check">{isSelected ? '☑' : '☐'}</span>
                            <span className="lq-option-text">{opt.optionText}</span>
                          </button>
                        );
                      })}
                    </div>
                    {phase === 'question' && !answerSubmitted && selectedOptions.size > 0 && (
                      <button className="btn btn-primary btn-lg lq-multi-submit" onClick={submitMultiple}>
                        Submit ({selectedOptions.size} selected)
                      </button>
                    )}
                  </>
                )}

                {/* ── Single Choice ── */}
                {qType === 'single' && (
                  <div className="lq-options-grid">
                    {displayOptions.map((opt, i) => {
                      let cls = 'lq-option';
                      if (selectedOption === opt.id) cls += ' lq-option-selected';
                      if (phase === 'reveal') {
                        if (opt.id === correctOptionId) cls += ' lq-option-correct';
                        else if (selectedOption === opt.id && opt.id !== correctOptionId) cls += ' lq-option-wrong';
                      }
                      if (selectedOption && selectedOption !== opt.id && phase === 'question') cls += ' lq-option-dimmed';
                      return (
                        <button key={opt.id} className={cls} onClick={() => submitSingle(opt.id)}
                          disabled={answerSubmitted || phase !== 'question'}
                          style={{ '--opt-color': OPTION_COLORS[i] }}>
                          <span className="lq-option-letter">{OPTION_LETTERS[i]}</span>
                          <span className="lq-option-text">{opt.optionText}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Feedback ── */}
                {phase === 'answered' && (
                  <div className="lq-feedback animate-scale-in feedback-waiting">
                    <span className="feedback-icon">⏳</span>
                    <span>Answer locked in! Waiting for time to end...</span>
                  </div>
                )}
                {phase === 'reveal' && answerResult && (
                  <div className={`lq-feedback animate-scale-in ${answerResult.isCorrect ? 'feedback-correct' : 'feedback-wrong'}`}>
                    <span className="feedback-icon">{answerResult.isCorrect ? '✓' : '✕'}</span>
                    <span>{answerResult.isCorrect ? `+${answerResult.pointsAwarded} points` : 'Wrong answer'}</span>
                    {answerResult.streak > 1 && <span className="streak-badge">🔥 {answerResult.streak} streak</span>}
                  </div>
                )}
                {phase === 'reveal' && !answerResult && !answerSubmitted && (
                  <div className="lq-feedback animate-scale-in feedback-wrong">
                    <span className="feedback-icon">⏰</span><span>Time's up! No answer submitted.</span>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {phase === 'leaderboard' && (
          <div className="lq-leaderboard animate-slide-up">
            <h2 className="lb-title">Leaderboard</h2>
            <div className="lb-list">
              {leaderboard.map((p, i) => {
                const isMe = !isHost && personalResult && (i + 1) === personalResult.rank;
                const rankEmoji = i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
                return (
                  <div
                    key={i}
                    ref={isMe ? myRowRef : null}
                    className={`lb-row ${isMe ? 'lb-row-me' : ''}`}
                    style={{ animationDelay: `${i * 0.08}s` }}
                  >
                    {/* Rank badge */}
                    <div className={`lb-rank-badge ${i < 3 ? 'lb-rank-top3' : ''}`} style={{
                      '--rank-color': i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : 'var(--purple)'
                    }}>
                      {rankEmoji || `#${i + 1}`}
                    </div>

                    {/* Rank change arrow (only for the current player) */}
                    {isMe && rankDelta !== 0 && (
                      <span className={`lb-rank-arrow ${rankDelta > 0 ? 'lb-arrow-up' : 'lb-arrow-down'}`}>
                        {rankDelta > 0 ? '↑' : '↓'}
                      </span>
                    )}

                    <div className="lb-avatar" style={{ background: p.avatarColor || 'var(--purple)' }}>
                      {p.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <span className={`lb-name ${isMe ? 'lb-name-me' : ''}`}>
                      {p.displayName}{isMe && ' (You)'}
                    </span>
                    <span className={`lb-score ${isMe ? 'lb-score-me' : ''}`}>{p.score}</span>
                  </div>
                );
              })}
            </div>

            {isHost && (
              <div className="lq-host-actions">
                <button className="btn btn-primary btn-lg" onClick={nextQuestion}>Next Question →</button>
                <button className="btn btn-ghost btn-sm" onClick={endQuiz} style={{color:'var(--red)', marginTop:'0.5rem'}}>End Quiz</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
