const Quiz = require('../models/Quiz');
const Room = require('../models/Room');
const { calculateScore } = require('../utils/scoring');

function setupGameHandler(io, socket, activeRooms) {
  // ─── Start the quiz ───────────────────────────────────────────────
  socket.on('room:start', async ({ roomCode }) => {
    try {
      const activeRoom = activeRooms.get(roomCode);
      if (!activeRoom) return socket.emit('error', { message: 'Room not found' });
      if (activeRoom.hostId !== socket.userId) return socket.emit('error', { message: 'Only the host can start' });
      if (activeRoom.status !== 'waiting') return socket.emit('error', { message: 'Quiz already started' });
      if (activeRoom.participants.size === 0) return socket.emit('error', { message: 'No participants in room' });

      const quiz = await Quiz.findByIdWithQuestions(activeRoom.quizId);
      if (!quiz || !quiz.questions.length) return socket.emit('error', { message: 'Quiz has no questions' });

      activeRoom.quiz = quiz;
      activeRoom.status = 'starting';
      activeRoom.currentQuestionIndex = -1;
      activeRoom.phase = 'countdown';
      activeRoom.questionEnding = false;

      // FIX: snapshot the participant count at start time so late joiners
      // don't inflate the count and break the "all answered" early-end logic.
      activeRoom.activePlayerCount = activeRoom.participants.size;

      await Room.updateStatus(activeRoom.roomId, 'active');

      io.to(roomCode).emit('room:quizStarted', {
        totalQuestions: quiz.questions.length,
        countdown: 3,
      });

      // FIX: null-check the room inside the timeout — it may have been
      // deleted (e.g. host disconnected) during the 3.5 s countdown.
      activeRoom.countdownTimer = setTimeout(() => {
        const room = activeRooms.get(roomCode);
        if (!room || room.status === 'finished') return;
        room.status = 'active';
        room.phase = 'question';
        sendNextQuestion(io, roomCode, activeRooms);
      }, 3500);
    } catch (err) {
      console.error('room:start error:', err);
      socket.emit('error', { message: 'Failed to start quiz' });
    }
  });

  // ─── State recovery: client asks "where are we?" on mount ─────────
  socket.on('game:getState', ({ roomCode }) => {
    const activeRoom = activeRooms.get(roomCode);
    if (!activeRoom) return socket.emit('game:state', { phase: 'not_found' });

    if (activeRoom.status === 'waiting') {
      return socket.emit('game:state', { phase: 'waiting' });
    }

    if (activeRoom.status === 'starting' || activeRoom.phase === 'countdown') {
      return socket.emit('game:state', { phase: 'countdown', countdown: 3 });
    }

    if (activeRoom.status === 'finished') {
      return socket.emit('game:state', { phase: 'finished' });
    }

    const question = activeRoom.quiz?.questions?.[activeRoom.currentQuestionIndex];

    if (activeRoom.phase === 'leaderboard') {
      const leaderboard = buildLeaderboard(activeRoom);
      return socket.emit('game:state', {
        phase: 'leaderboard',
        leaderboard: stripUserIds(leaderboard.slice(0, 10)),
        index: activeRoom.currentQuestionIndex,
        total: activeRoom.quiz.questions.length,
      });
    }

    if (activeRoom.phase === 'reveal') {
      const correctOption = question?.options?.find(o => o.is_correct);
      return socket.emit('game:state', {
        phase: 'reveal',
        question: sanitizeQuestion(question),
        correctOptionId: correctOption ? correctOption.id : null,
        index: activeRoom.currentQuestionIndex,
        total: activeRoom.quiz.questions.length,
      });
    }

    if (!question) {
      return socket.emit('game:state', { phase: 'waiting' });
    }

    const elapsed = Date.now() - activeRoom.questionStartTime;
    const timeLimit = (question.time_limit || activeRoom.quiz.time_per_question) * 1000;
    const timeRemaining = Math.max(0, (timeLimit - elapsed) / 1000);

    const answerKey = buildAnswerKey(question.id, socket.userId);
    const existingAnswer = activeRoom.answers.get(answerKey);

    socket.emit('game:state', {
      phase: existingAnswer ? 'answered' : 'question',
      question: sanitizeQuestion(question),
      index: activeRoom.currentQuestionIndex,
      total: activeRoom.quiz.questions.length,
      timeLimit: timeLimit / 1000,
      timeRemaining,
      questionStartTime: activeRoom.questionStartTime,
      ...(existingAnswer ? {
        answerResult: {
          isCorrect: existingAnswer.isCorrect,
          pointsAwarded: existingAnswer.pointsAwarded,
          selectedOptionId: existingAnswer.optionId,
        }
      } : {}),
    });
  });

  // ─── Submit an answer ─────────────────────────────────────────────
  socket.on('question:answer', async ({ roomCode, questionId, optionId, optionIds, textAnswer }) => {
    try {
      const activeRoom = activeRooms.get(roomCode);
      if (!activeRoom || activeRoom.status !== 'active') return;
      if (activeRoom.phase !== 'question') return;

      const participant = activeRoom.participants.get(socket.userId);
      if (!participant) return;

      const answerKey = buildAnswerKey(questionId, socket.userId);

      // ATOMIC CHECK-AND-SET: Use a per-user lock to prevent race conditions
      // This ensures only one answer per question per user is processed
      const lockKey = `lock:${answerKey}`;
      if (activeRoom.answers.has(answerKey) || activeRoom.locks?.has(lockKey)) return;

      // Acquire lock immediately
      if (!activeRoom.locks) activeRoom.locks = new Map();
      activeRoom.locks.set(lockKey, true);

      try {
        // Double-check after acquiring lock (in case another request was in-flight)
        if (activeRoom.answers.has(answerKey)) return;

        const question = activeRoom.quiz.questions[activeRoom.currentQuestionIndex];
        if (!question || question.id !== questionId) return;

        const timeElapsed = Date.now() - activeRoom.questionStartTime;
        const timeLimit = (question.time_limit || activeRoom.quiz.time_per_question) * 1000;
        if (timeElapsed > timeLimit + 1500) return;

        const qType = question.question_type || 'single';
        let isCorrect = false;
        let selectedOptionId = optionId || null;
        let selectedOptionIds = optionIds || null;
        let answerText = textAnswer || null;

        if (qType === 'fill_blank') {
          // Compare against all accepted answers (case-insensitive, trimmed)
          const acceptedAnswers = (question.options || []).filter(o => o.is_correct).map(o => o.option_text.trim().toLowerCase());
          const userAnswer = (textAnswer || '').trim().toLowerCase();
          isCorrect = acceptedAnswers.includes(userAnswer);
        } else if (qType === 'multiple') {
          // Must select EXACTLY all correct options
          const correctIds = new Set(question.options.filter(o => o.is_correct).map(o => o.id));
          const selected = new Set(optionIds || []);
          isCorrect = correctIds.size === selected.size && [...correctIds].every(id => selected.has(id));
        } else {
          // Single choice
          const selectedOption = question.options.find(o => o.id === optionId);
          isCorrect = selectedOption ? selectedOption.is_correct : false;
        }

        const scoreResult = calculateScore(
          isCorrect,
          Math.min(timeElapsed, timeLimit),
          timeLimit,
          participant.streak,
          question.points || 10,
        );

        participant.score += scoreResult.points;
        participant.streak = scoreResult.streak;
        if (scoreResult.streak > participant.bestStreak) participant.bestStreak = scoreResult.streak;
        if (isCorrect) participant.correctCount++;
        participant.totalTimeMs += timeElapsed;
        participant.answerCount++;

        activeRoom.answers.set(answerKey, {
          userId: socket.userId,
          participantId: participant.id,
          questionId,
          optionId: selectedOptionId,
          optionIds: selectedOptionIds,
          textAnswer: answerText,
          isCorrect,
          timeTakenMs: timeElapsed,
          pointsAwarded: scoreResult.points,
        });

        socket.emit('question:answered', {
          submitted: true,
          selectedOptionId,
          selectedOptionIds,
          textAnswer: answerText,
          totalScore: participant.score,
        });

        const questionAnswerCount = countAnswersForQuestion(activeRoom, questionId);

        if (activeRoom.hostSocketId) {
          io.to(activeRoom.hostSocketId).emit('question:answerCount', {
            answered: questionAnswerCount,
            total: activeRoom.activePlayerCount,
          });
        }

        if (questionAnswerCount >= activeRoom.activePlayerCount) {
          clearTimeout(activeRoom.questionTimer);
          if (activeRoom.tickInterval) clearInterval(activeRoom.tickInterval);
          endQuestion(io, roomCode, activeRooms);
        }
      } finally {
        // Always release the lock after processing
        activeRoom.locks.delete(lockKey);
      }
    } catch (err) {
      console.error('question:answer error:', err);
    }
  });

  // ─── Host requests next question (skip ahead) ─────────────────────
  socket.on('question:next', ({ roomCode }) => {
    const activeRoom = activeRooms.get(roomCode);
    if (!activeRoom || activeRoom.hostId !== socket.userId) return;
    if (activeRoom.phase !== 'leaderboard') return;
    // Clear the auto-advance timer since host is manually advancing
    if (activeRoom.leaderboardTimer) { clearTimeout(activeRoom.leaderboardTimer); activeRoom.leaderboardTimer = null; }
    sendNextQuestion(io, roomCode, activeRooms);
  });

  // ─── Host ends the quiz (works from lobby OR during quiz) ─────────
  socket.on('room:end', async ({ roomCode }) => {
    const activeRoom = activeRooms.get(roomCode);
    if (!activeRoom || activeRoom.hostId !== socket.userId) return;
    if (activeRoom.leaderboardTimer) { clearTimeout(activeRoom.leaderboardTimer); activeRoom.leaderboardTimer = null; }
    await finishQuiz(io, roomCode, activeRooms);
  });
}


// ═══════════════════════════════════════════════════════════════════════
// Key builder — separator "|" never appears in UUIDs
// ═══════════════════════════════════════════════════════════════════════
function buildAnswerKey(questionId, userId) {
  return `${questionId}|${userId}`;
}

function countAnswersForQuestion(activeRoom, questionId) {
  const prefix = questionId + '|';
  let count = 0;
  for (const key of activeRoom.answers.keys()) {
    if (key.startsWith(prefix)) count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════
// Strip correct-answer flags before broadcasting to clients
// ═══════════════════════════════════════════════════════════════════════
function sanitizeQuestion(question) {
  if (!question) return null;
  const qType = question.question_type || 'single';
  const base = {
    id: question.id,
    questionText: question.question_text,
    questionType: qType,
    points: question.points,
  };
  if (qType === 'fill_blank') {
    // Don't send accepted answers to client — they type their own
    base.options = [];
    base.acceptedCount = (question.options || []).filter(o => o.is_correct).length;
  } else {
    base.options = (question.options || []).map(o => ({
      id: o.id,
      optionText: o.option_text,
      orderIndex: o.order_index,
    }));
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// Build leaderboard — FIX: include userId so downstream lookups are
// keyed by identity, not by display name (which is not unique).
// ═══════════════════════════════════════════════════════════════════════
function buildLeaderboard(activeRoom) {
  return Array.from(activeRoom.participants.entries())
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([userId, p], i) => ({
      rank: i + 1,
      userId,            // internal — strip before sending to all clients
      displayName: p.displayName,
      avatarColor: p.avatarColor,
      score: p.score,
      streak: p.streak,
      socketId: p.socketId, // internal — used for personal emit
    }));
}

// Remove server-only fields before broadcasting
function stripUserIds(entries) {
  return entries.map(({ userId, socketId, ...rest }) => rest);
}

// ═══════════════════════════════════════════════════════════════════════
// Send the next question to all clients
// ═══════════════════════════════════════════════════════════════════════
async function sendNextQuestion(io, roomCode, activeRooms) {
  const activeRoom = activeRooms.get(roomCode);
  if (!activeRoom) return;

  if (activeRoom.tickInterval) clearInterval(activeRoom.tickInterval);

  activeRoom.currentQuestionIndex++;
  activeRoom.phase = 'question';
  activeRoom.questionEnding = false;

  if (activeRoom.currentQuestionIndex >= activeRoom.quiz.questions.length) {
    await finishQuiz(io, roomCode, activeRooms);
    return;
  }

  const question = activeRoom.quiz.questions[activeRoom.currentQuestionIndex];
  const timeLimit = (question.time_limit || activeRoom.quiz.time_per_question) * 1000;

  activeRoom.questionStartTime = Date.now();
  activeRoom.questionEndTime = activeRoom.questionStartTime + timeLimit;

  io.to(roomCode).emit('question:show', {
    question: sanitizeQuestion(question),
    index: activeRoom.currentQuestionIndex,
    total: activeRoom.quiz.questions.length,
    timeLimit: timeLimit / 1000,
    questionStartTime: activeRoom.questionStartTime,
  });

  // Server-driven time sync every 5 s so clients stay accurate
  activeRoom.tickInterval = setInterval(() => {
    const remaining = Math.max(0, (activeRoom.questionEndTime - Date.now()) / 1000);
    io.to(roomCode).emit('room:tickSync', {
      timeRemaining: remaining,
      questionIndex: activeRoom.currentQuestionIndex,
    });
    if (remaining <= 0) clearInterval(activeRoom.tickInterval);
  }, 5000);

  activeRoom.questionTimer = setTimeout(() => {
    if (activeRoom.tickInterval) clearInterval(activeRoom.tickInterval);
    endQuestion(io, roomCode, activeRooms);
  }, timeLimit);
}

// ═══════════════════════════════════════════════════════════════════════
// End the current question — reveal answer + show leaderboard
// ═══════════════════════════════════════════════════════════════════════
function endQuestion(io, roomCode, activeRooms) {
  const activeRoom = activeRooms.get(roomCode);
  if (!activeRoom) return;

  // Guard against double-execution (timer fires + all-answered race)
  if (activeRoom.questionEnding) return;
  activeRoom.questionEnding = true;

  activeRoom.phase = 'reveal';

  const question = activeRoom.quiz.questions[activeRoom.currentQuestionIndex];
  if (!question) return;

  const correctOption = question.options.find(o => o.is_correct);

  // Gather this question's answers using the safe prefix scan
  const questionAnswers = [];
  const prefix = question.id + '|';
  for (const [key, val] of activeRoom.answers) {
    if (key.startsWith(prefix)) questionAnswers.push(val);
  }

  const optionCounts = {};
  question.options.forEach(o => { optionCounts[o.id] = 0; });
  questionAnswers.forEach(a => {
    if (a.optionId && optionCounts[a.optionId] !== undefined) {
      optionCounts[a.optionId]++;
    }
  });

  const correctCount = questionAnswers.filter(a => a.isCorrect).length;
  const totalAnswered = questionAnswers.length;

  const qType = question.question_type || 'single';

  // Build reveal payload based on question type
  const revealData = {
    questionType: qType,
    stats: { optionCounts, correctCount, totalAnswered, totalPlayers: activeRoom.participants.size },
  };

  if (qType === 'fill_blank') {
    // Send all accepted answers so clients can display them
    revealData.acceptedAnswers = question.options.filter(o => o.is_correct).map(o => o.option_text);
    revealData.correctOptionId = null;
    revealData.correctOptionIds = null;
  } else if (qType === 'multiple') {
    revealData.correctOptionIds = question.options.filter(o => o.is_correct).map(o => o.id);
    revealData.correctOptionId = null;
  } else {
    revealData.correctOptionId = correctOption ? correctOption.id : null;
    revealData.correctOptionIds = null;
  }

  io.to(roomCode).emit('question:timeUp', revealData);

  // Now reveal each student's personal answer result
  for (const [userId, participant] of activeRoom.participants) {
    if (!participant.socketId) continue;
    const answer = questionAnswers.find(a => a.userId === userId);
    if (answer) {
      io.to(participant.socketId).emit('question:answerReveal', {
        isCorrect: answer.isCorrect,
        pointsAwarded: answer.pointsAwarded,
        selectedOptionId: answer.optionId,
        selectedOptionIds: answer.optionIds,
        textAnswer: answer.textAnswer,
        totalScore: participant.score,
        streak: participant.streak,
      });
    }
  }

  // FIX: build leaderboard with userId included so every lookup is by
  // identity, not by display name (display names are not unique).
  const leaderboard = buildLeaderboard(activeRoom);

  leaderboard.forEach(entry => {
    // Direct O(1) lookup by userId — no displayName comparison needed
    const answer = questionAnswers.find(a => a.userId === entry.userId);
    entry.isCorrect = answer ? answer.isCorrect : false;
  });

  setTimeout(() => {
    const room = activeRooms.get(roomCode);
    if (!room || room.status === 'finished') return;

    room.phase = 'leaderboard';

    // Broadcast — strip internal fields before sending to all clients
    io.to(roomCode).emit('question:results', {
      leaderboard: stripUserIds(leaderboard.slice(0, 10)),
    });

    // Send personal rank keyed by userId
    leaderboard.forEach(entry => {
      if (entry.socketId) {
        io.to(entry.socketId).emit('question:personalResult', {
          rank: entry.rank,
          totalScore: room.participants.get(entry.userId)?.score ?? 0,
          totalPlayers: leaderboard.length,
          isCorrect: entry.isCorrect,
        });
      }
    });

    // ── Auto-advance after 5 seconds on leaderboard ──
    room.leaderboardTimer = setTimeout(() => {
      const r = activeRooms.get(roomCode);
      if (!r || r.status === 'finished' || r.phase !== 'leaderboard') return;
      sendNextQuestion(io, roomCode, activeRooms);
    }, 5000);
  }, 2000);
}

// ═══════════════════════════════════════════════════════════════════════
// Finish the entire quiz — persist scores and broadcast results
// ═══════════════════════════════════════════════════════════════════════
async function finishQuiz(io, roomCode, activeRooms) {
  const activeRoom = activeRooms.get(roomCode);
  if (!activeRoom) return;
  if (activeRoom.status === 'finished') return;

  if (activeRoom.questionTimer)    clearTimeout(activeRoom.questionTimer);
  if (activeRoom.tickInterval)     clearInterval(activeRoom.tickInterval);
  if (activeRoom.countdownTimer)   clearTimeout(activeRoom.countdownTimer);
  if (activeRoom.leaderboardTimer) clearTimeout(activeRoom.leaderboardTimer);

  activeRoom.status = 'finished';
  activeRoom.phase = 'finished';

  try {
    // Only persist scores if the quiz actually ran (has answers/participants)
    if (activeRoom.quiz && activeRoom.participants.size > 0) {
      const answersByUser = new Map();
      for (const answer of activeRoom.answers.values()) {
        if (!answersByUser.has(answer.userId)) answersByUser.set(answer.userId, []);
        answersByUser.get(answer.userId).push(answer);
      }

      for (const [userId, p] of activeRoom.participants) {
        const avgTime = p.answerCount > 0 ? Math.round(p.totalTimeMs / p.answerCount) : 0;

        await Room.updateParticipantScore(p.id, {
          score: p.score,
          correctCount: p.correctCount,
          streak: p.streak,
          bestStreak: p.bestStreak,
          avgTimeMs: avgTime,
        });

        const userAnswers = answersByUser.get(userId) || [];
        for (const answer of userAnswers) {
          await Room.saveAnswer({
            roomId: activeRoom.roomId,
            participantId: p.id,
            questionId: answer.questionId,
            selectedOptionId: answer.optionId,
            selectedOptionIds: answer.optionIds || null,
            textAnswer: answer.textAnswer || null,
            isCorrect: answer.isCorrect,
            timeTakenMs: answer.timeTakenMs,
            pointsAwarded: answer.pointsAwarded,
          });
        }
      }

      await Room.updateRanks(activeRoom.roomId);
    }

    await Room.updateStatus(activeRoom.roomId, 'finished');
  } catch (err) {
    console.error('Failed to persist results:', err);
  }

  const finalLeaderboard = Array.from(activeRoom.participants.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      displayName: p.displayName,
      avatarColor: p.avatarColor,
      score: p.score,
      correctCount: p.correctCount,
      bestStreak: p.bestStreak,
    }));

  io.to(roomCode).emit('room:finished', {
    finalLeaderboard,
    topThree: finalLeaderboard.slice(0, 3),
    totalQuestions: activeRoom.quiz?.questions?.length || 0,
  });

  setTimeout(() => activeRooms.delete(roomCode), 60_000);
}

module.exports = { setupGameHandler };