import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import './LiveQuiz.css';

const OPTION_COLORS = ['var(--option-a)', 'var(--option-b)', 'var(--option-c)', 'var(--option-d)'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export default function LiveQuiz() {
  const { code } = useParams();
  const { socket } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isHost = user?.role === 'educator';

  const [phase, setPhase] = useState('waiting');
  const [question, setQuestion] = useState(null);
  const [qIndex, setQIndex] = useState(0);
  const [totalQ, setTotalQ] = useState(0);
  const [timeLimit, setTimeLimit] = useState(30);
  const [timeLeft, setTimeLeft] = useState(30);
  const [selectedOption, setSelectedOption] = useState(null);
  const [answerResult, setAnswerResult] = useState(null);
  const [correctOptionId, setCorrectOptionId] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [personalResult, setPersonalResult] = useState(null);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [totalScore, setTotalScore] = useState(0);
  const [countdownNum, setCountdownNum] = useState(3);
  const [stats, setStats] = useState(null);

  const timerRef = useRef(null);
  const questionEndTimeRef = useRef(null);
  const mountedRef = useRef(true);
  const joinedRef = useRef(false);

  const phaseRef = useRef(phase);
  const qIndexRef = useRef(qIndex);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { qIndexRef.current = qIndex; }, [qIndex]);

  // ─── Timer logic ──────────────────────────────────────────────────
  const startTimer = useCallback((durationSec, endTimeMs) => {
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    const endTime = endTimeMs || (Date.now() + durationSec * 1000);
    questionEndTimeRef.current = endTime;

    const tick = () => {
      if (!mountedRef.current) return;
      const remaining = Math.max(0, (endTime - Date.now()) / 1000);
      setTimeLeft(remaining);
      if (remaining > 0) {
        timerRef.current = requestAnimationFrame(tick);
      }
    };
    timerRef.current = requestAnimationFrame(tick);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { cancelAnimationFrame(timerRef.current); timerRef.current = null; }
  }, []);

  // ─── Join socket room + request state on mount ────────────────────
  useEffect(() => {
    if (!socket || joinedRef.current) return;
    joinedRef.current = true;

    // Re-join the Socket.IO room (navigating from Lobby drops room membership)
    socket.emit('room:rejoin', { roomCode: code });

    // Then ask the server where we are
    const timeout = setTimeout(() => {
      socket.emit('game:getState', { roomCode: code });
    }, 400);

    return () => clearTimeout(timeout);
  }, [socket, code]);

  // ─── Socket event listeners (registered ONCE) ─────────────────────
  useEffect(() => {
    if (!socket) return;
    mountedRef.current = true;

    const handleState = (data) => {
      if (!mountedRef.current) return;
      switch (data.phase) {
        case 'countdown':
          setPhase('countdown');
          setCountdownNum(data.countdown || 3);
          break;
        case 'question':
          setQuestion(data.question);
          setQIndex(data.index);
          setTotalQ(data.total);
          setTimeLimit(data.timeLimit);
          setSelectedOption(null);
          setAnswerResult(null);
          setCorrectOptionId(null);
          setPhase('question');
          startTimer(data.timeRemaining);
          break;
        case 'answered':
          setQuestion(data.question);
          setQIndex(data.index);
          setTotalQ(data.total);
          setTimeLimit(data.timeLimit);
          setSelectedOption(data.answerResult?.selectedOptionId || null);
          setAnswerResult(data.answerResult || null);
          setCorrectOptionId(null);
          setPhase('answered');
          startTimer(data.timeRemaining);
          break;
        case 'reveal':
          setQuestion(data.question);
          setQIndex(data.index);
          setTotalQ(data.total);
          setCorrectOptionId(data.correctOptionId);
          setPhase('reveal');
          setTimeLeft(0);
          break;
        case 'leaderboard':
          setLeaderboard(data.leaderboard || []);
          setQIndex(data.index);
          setTotalQ(data.total);
          setPhase('leaderboard');
          break;
        case 'finished':
          navigate(`/room/${code}/results`, { replace: true });
          break;
        default:
          setPhase('waiting');
          break;
      }
    };

    const handleQuestionShow = (data) => {
      if (!mountedRef.current) return;
      stopTimer();
      setQuestion(data.question);
      setQIndex(data.index);
      setTotalQ(data.total);
      setTimeLimit(data.timeLimit);
      setTimeLeft(data.timeLimit);
      setSelectedOption(null);
      setAnswerResult(null);
      setCorrectOptionId(null);
      setPersonalResult(null);
      setStats(null);
      setPhase('question');
      setAnswerCount({ answered: 0, total: 0 });

      const endTimeMs = data.questionStartTime
        ? data.questionStartTime + data.timeLimit * 1000
        : Date.now() + data.timeLimit * 1000;
      startTimer(data.timeLimit, endTimeMs);
    };

    const handleAnswered = (data) => {
      if (!mountedRef.current) return;
      setAnswerResult(data);
      setTotalScore(data.totalScore);
      setPhase('answered');
    };

    const handleAnswerCount = (data) => {
      if (!mountedRef.current) return;
      setAnswerCount(data);
    };

    const handleTimeUp = (data) => {
      if (!mountedRef.current) return;
      stopTimer();
      setTimeLeft(0);
      setCorrectOptionId(data.correctOptionId);
      if (data.stats) setStats(data.stats);
      setPhase('reveal');
    };

    const handleResults = (data) => {
      if (!mountedRef.current) return;
      setLeaderboard(data.leaderboard);
      setPhase('leaderboard');
    };

    const handlePersonalResult = (data) => {
      if (!mountedRef.current) return;
      setPersonalResult(data);
    };

    const handleFinished = (data) => {
      if (!mountedRef.current) return;
      stopTimer();
      navigate(`/room/${code}/results`, { state: data, replace: true });
    };

    const handleTickSync = (data) => {
      if (!mountedRef.current) return;
      const cp = phaseRef.current;
      const ci = qIndexRef.current;
      if (data.questionIndex === ci && (cp === 'question' || cp === 'answered')) {
        questionEndTimeRef.current = Date.now() + data.timeRemaining * 1000;
      }
    };

    const handleQuizStarted = (data) => {
      if (!mountedRef.current) return;
      setTotalQ(data.totalQuestions);
      setPhase('countdown');
      setCountdownNum(data.countdown || 3);
    };

    socket.on('game:state', handleState);
    socket.on('question:show', handleQuestionShow);
    socket.on('question:answered', handleAnswered);
    socket.on('question:answerCount', handleAnswerCount);
    socket.on('question:timeUp', handleTimeUp);
    socket.on('question:results', handleResults);
    socket.on('question:personalResult', handlePersonalResult);
    socket.on('room:finished', handleFinished);
    socket.on('room:tickSync', handleTickSync);
    socket.on('room:quizStarted', handleQuizStarted);

    return () => {
      mountedRef.current = false;
      stopTimer();
      socket.off('game:state', handleState);
      socket.off('question:show', handleQuestionShow);
      socket.off('question:answered', handleAnswered);
      socket.off('question:answerCount', handleAnswerCount);
      socket.off('question:timeUp', handleTimeUp);
      socket.off('question:results', handleResults);
      socket.off('question:personalResult', handlePersonalResult);
      socket.off('room:finished', handleFinished);
      socket.off('room:tickSync', handleTickSync);
      socket.off('room:quizStarted', handleQuizStarted);
    };
  }, [socket, code, navigate, startTimer, stopTimer]);

  // ─── Countdown auto-advance ───────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown' || countdownNum <= 0) return;
    const interval = setInterval(() => {
      setCountdownNum(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, countdownNum]);

  // ─── Actions ──────────────────────────────────────────────────────
  const submitAnswer = (optionId) => {
    if (isHost || selectedOption || phase !== 'question' || !question) return;
    setSelectedOption(optionId);
    socket.emit('question:answer', { roomCode: code, questionId: question.id, optionId });
  };

  const nextQuestion = () => socket.emit('question:next', { roomCode: code });
  const endQuiz = () => socket.emit('room:end', { roomCode: code });

  // ─── Derived ──────────────────────────────────────────────────────
  const timerPercent = timeLimit > 0 ? (timeLeft / timeLimit) * 100 : 0;
  const timerColor = timerPercent > 50 ? 'var(--green)' : timerPercent > 20 ? 'var(--amber)' : 'var(--red)';

  // ═════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════

  if (phase === 'waiting') {
    return (
      <div className="live-quiz-page">
        <div className="lq-waiting-screen">
          <div className="lq-waiting-spinner" />
          <h2>Preparing your quiz...</h2>
          <p>Hang tight — questions are loading</p>
        </div>
      </div>
    );
  }

  if (phase === 'countdown') {
    return (
      <div className="live-quiz-page">
        <div className="lq-countdown-screen">
          {countdownNum > 0 ? (
            <>
              <div className="lq-countdown-number" key={countdownNum}>{countdownNum}</div>
              <p className="lq-countdown-text">Get Ready!</p>
            </>
          ) : (
            <>
              <div className="lq-countdown-go">GO!</div>
              <p className="lq-countdown-text">Here comes the first question...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="live-quiz-page">
      {/* Timer bar */}
      <div className="timer-bar-container">
        <div className="timer-bar" style={{ width: `${timerPercent}%`, background: timerColor }} />
      </div>

      {/* Header */}
      <div className="lq-header">
        <div className="lq-progress">Q{qIndex + 1}/{totalQ}</div>
        <div className={`lq-timer ${timeLeft <= 5 && timeLeft > 0 ? 'lq-timer-danger' : ''}`}>
          {Math.ceil(timeLeft)}s
        </div>
        {isHost ? (
          <div className="lq-score lq-host-badge">👨‍🏫 Host</div>
        ) : (
          <div className="lq-score">{totalScore} pts</div>
        )}
      </div>

      {/* Main content */}
      <div className="lq-content">
        {(phase === 'question' || phase === 'answered' || phase === 'reveal') && question && (
          <>
            <div className="lq-question animate-fade-in" key={question.id}>
              <h2>{question.questionText}</h2>
              {question.points && <span className="lq-question-points">{question.points} pts</span>}
            </div>

            {/* HOST VIEW: read-only options + answer count */}
            {isHost ? (
              <div className="lq-host-view">
                <div className="lq-options-grid">
                  {question.options.map((opt, i) => {
                    let cls = 'lq-option lq-option-host';
                    if (phase === 'reveal') {
                      if (opt.id === correctOptionId) cls += ' lq-option-correct';
                    }
                    return (
                      <div key={opt.id} className={cls} style={{ '--opt-color': OPTION_COLORS[i] }}>
                        <span className="lq-option-letter">{OPTION_LETTERS[i]}</span>
                        <span className="lq-option-text">{opt.optionText}</span>
                        {phase === 'reveal' && stats?.optionCounts && (
                          <span className="lq-option-count">{stats.optionCounts[opt.id] || 0}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="lq-host-bar">
                  <span>{answerCount.answered}/{answerCount.total} answered</span>
                </div>
              </div>
            ) : (
              /* STUDENT VIEW: clickable options */
              <>
                <div className="lq-options-grid">
                  {question.options.map((opt, i) => {
                    let cls = 'lq-option';
                    if (selectedOption === opt.id) cls += ' lq-option-selected';
                    if (phase === 'reveal') {
                      if (opt.id === correctOptionId) cls += ' lq-option-correct';
                      else if (selectedOption === opt.id && opt.id !== correctOptionId) cls += ' lq-option-wrong';
                    }
                    if (selectedOption && selectedOption !== opt.id && phase === 'question') cls += ' lq-option-dimmed';

                    return (
                      <button key={opt.id} className={cls} onClick={() => submitAnswer(opt.id)}
                        disabled={!!selectedOption || phase !== 'question'}
                        style={{ '--opt-color': OPTION_COLORS[i] }}>
                        <span className="lq-option-letter">{OPTION_LETTERS[i]}</span>
                        <span className="lq-option-text">{opt.optionText}</span>
                      </button>
                    );
                  })}
                </div>

                {phase === 'answered' && answerResult && (
                  <div className={`lq-feedback animate-scale-in ${answerResult.isCorrect ? 'feedback-correct' : 'feedback-wrong'}`}>
                    <span className="feedback-icon">{answerResult.isCorrect ? '✓' : '✕'}</span>
                    <span>{answerResult.isCorrect ? `+${answerResult.pointsAwarded} points` : 'Wrong answer'}</span>
                    {answerResult.streakBonus > 0 && <span className="streak-badge">🔥 +{answerResult.streakBonus} streak</span>}
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
              {leaderboard.map((p, i) => (
                <div key={i} className="lb-row" style={{ animationDelay: `${i * 0.08}s` }}>
                  <span className="lb-rank" style={{
                    color: i === 0 ? 'var(--amber)' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--text-muted)'
                  }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                  <div className="lb-avatar" style={{ background: p.avatarColor || 'var(--purple)' }}>
                    {p.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <span className="lb-name">{p.displayName}</span>
                  <span className="lb-score">{p.score}</span>
                </div>
              ))}
            </div>

            {!isHost && personalResult && (
              <div className="lb-personal">
                You're #{personalResult.rank} of {personalResult.totalPlayers} • {personalResult.totalScore} points
              </div>
            )}

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
