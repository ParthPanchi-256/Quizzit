const Quiz = require('../models/Quiz');
const Room = require('../models/Room');
const { calculateScore } = require('../utils/scoring');

function setupGameHandler(io, socket, store) {
  // ─── Start the quiz ───────────────────────────────────────────────
  socket.on('room:start', async ({ roomCode }) => {
    try {
      const activeRoom = await store.getRoom(roomCode);
      if (!activeRoom) return socket.emit('error', { message: 'Room not found' });
      if (activeRoom.hostId !== socket.userId) return socket.emit('error', { message: 'Only the host can start' });
      if (activeRoom.status !== 'waiting') return socket.emit('error', { message: 'Quiz already started' });

      const allParticipants = await store.getAllParticipants(roomCode);
      if (allParticipants.size === 0) return socket.emit('error', { message: 'No participants in room' });

      const quiz = await Quiz.findByIdWithQuestions(activeRoom.quizId);
      if (!quiz || !quiz.questions.length) return socket.emit('error', { message: 'Quiz has no questions' });

      await store.setQuiz(roomCode, quiz);
      
      await store.updateMeta(roomCode, {
        status: 'starting',
        currentQuestionIndex: -1,
        phase: 'countdown',
        questionEnding: false,
        activePlayerCount: allParticipants.size,
      });

      await Room.updateStatus(activeRoom.roomId, 'active');

      io.to(roomCode).emit('room:quizStarted', {
        totalQuestions: quiz.questions.length,
        countdown: 3,
      });

      const timer = setTimeout(async () => {
        const room = await store.getRoom(roomCode);
        if (!room || room.status === 'finished') return;
        
        await store.updateMeta(roomCode, {
          status: 'active',
          phase: 'question',
        });
        
        await sendNextQuestion(io, roomCode, store);
      }, 3500);
      
      store.setTimer(roomCode, 'countdownTimer', timer);
    } catch (err) {
      console.error('room:start error:', err);
      socket.emit('error', { message: 'Failed to start quiz' });
    }
  });

  // ─── State recovery: client asks "where are we?" on mount ─────────
  socket.on('game:getState', async ({ roomCode }) => {
    const activeRoom = await store.getRoom(roomCode);
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

    const quiz = await store.getQuiz(roomCode);
    const question = quiz?.questions?.[activeRoom.currentQuestionIndex];

    if (activeRoom.phase === 'leaderboard') {
      const leaderboard = await buildLeaderboard(store, roomCode);
      return socket.emit('game:state', {
        phase: 'leaderboard',
        leaderboard: stripUserIds(leaderboard.slice(0, 10)),
        index: activeRoom.currentQuestionIndex,
        total: quiz.questions.length,
      });
    }

    if (activeRoom.phase === 'reveal') {
      const correctOption = question?.options?.find(o => o.is_correct);
      return socket.emit('game:state', {
        phase: 'reveal',
        question: sanitizeQuestion(question),
        correctOptionId: correctOption ? correctOption.id : null,
        index: activeRoom.currentQuestionIndex,
        total: quiz.questions.length,
      });
    }

    if (!question) {
      return socket.emit('game:state', { phase: 'waiting' });
    }

    const elapsed = Date.now() - activeRoom.questionStartTime;
    const timeLimit = (question.time_limit || quiz.time_per_question) * 1000;
    const timeRemaining = Math.max(0, (timeLimit - elapsed) / 1000);

    const existingAnswer = await store.getAnswer(roomCode, question.id, socket.userId);

    socket.emit('game:state', {
      phase: existingAnswer ? 'answered' : 'question',
      question: sanitizeQuestion(question),
      index: activeRoom.currentQuestionIndex,
      total: quiz.questions.length,
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
      const activeRoom = await store.getRoom(roomCode);
      if (!activeRoom || activeRoom.status !== 'active') return;
      if (activeRoom.phase !== 'question') return;

      const participant = await store.getParticipant(roomCode, socket.userId);
      if (!participant) return;

      // ATOMIC CHECK-AND-SET: Acquire Redis lock (or local equivalent)
      const lockAcquired = await store.acquireAnswerLock(roomCode, questionId, socket.userId);
      if (!lockAcquired) return;

      try {
        // Double-check just in case
        const existingAnswer = await store.getAnswer(roomCode, questionId, socket.userId);
        if (existingAnswer) return;

        const quiz = await store.getQuiz(roomCode);
        const question = quiz.questions[activeRoom.currentQuestionIndex];
        if (!question || question.id !== questionId) return;

        const timeElapsed = Date.now() - activeRoom.questionStartTime;
        const timeLimit = (question.time_limit || quiz.time_per_question) * 1000;
        if (timeElapsed > timeLimit + 1500) return;

        const qType = question.question_type || 'single';
        let isCorrect = false;
        let selectedOptionId = optionId || null;
        let selectedOptionIds = optionIds || null;
        let answerText = textAnswer || null;

        if (qType === 'fill_blank') {
          const acceptedAnswers = (question.options || []).filter(o => o.is_correct).map(o => o.option_text.trim().toLowerCase());
          const userAnswer = (textAnswer || '').trim().toLowerCase();
          isCorrect = acceptedAnswers.includes(userAnswer);
        } else if (qType === 'multiple') {
          const correctIds = new Set(question.options.filter(o => o.is_correct).map(o => o.id));
          const selected = new Set(optionIds || []);
          isCorrect = correctIds.size === selected.size && [...correctIds].every(id => selected.has(id));
        } else {
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

        await store.setParticipant(roomCode, socket.userId, participant);
        await store.updateLeaderboardScore(roomCode, socket.userId, participant.score);

        await store.setAnswer(roomCode, questionId, socket.userId, {
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

        const questionAnswerCount = await store.countAnswersForQuestion(roomCode, questionId);

        if (activeRoom.hostSocketId) {
          io.to(activeRoom.hostSocketId).emit('question:answerCount', {
            answered: questionAnswerCount,
            total: activeRoom.activePlayerCount,
          });
        }

        if (questionAnswerCount >= activeRoom.activePlayerCount) {
          store.clearTimer(roomCode, 'questionTimer');
          store.clearTimer(roomCode, 'tickInterval');
          await endQuestion(io, roomCode, store);
        }
      } finally {
        await store.releaseAnswerLock(roomCode, questionId, socket.userId);
      }
    } catch (err) {
      console.error('question:answer error:', err);
    }
  });

  // ─── Host requests next question (skip ahead) ─────────────────────
  socket.on('question:next', async ({ roomCode }) => {
    const activeRoom = await store.getRoom(roomCode);
    if (!activeRoom || activeRoom.hostId !== socket.userId) return;
    if (activeRoom.phase !== 'leaderboard') return;
    
    store.clearTimer(roomCode, 'leaderboardTimer');
    await sendNextQuestion(io, roomCode, store);
  });

  // ─── Host ends the quiz (works from lobby OR during quiz) ─────────
  socket.on('room:end', async ({ roomCode }) => {
    const activeRoom = await store.getRoom(roomCode);
    if (!activeRoom || activeRoom.hostId !== socket.userId) return;
    
    store.clearTimer(roomCode, 'leaderboardTimer');
    await finishQuiz(io, roomCode, store);
  });
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
// Build leaderboard using the store
// ═══════════════════════════════════════════════════════════════════════
async function buildLeaderboard(store, roomCode) {
  const sortedUserIds = await store.getLeaderboard(roomCode); // already sorted desc
  const allParticipants = await store.getAllParticipants(roomCode);
  
  const leaderboard = [];
  for (let i = 0; i < sortedUserIds.length; i++) {
    const userId = sortedUserIds[i];
    const p = allParticipants.get(userId);
    if (p) {
      leaderboard.push({
        rank: i + 1,
        userId,            // internal
        displayName: p.displayName,
        avatarColor: p.avatarColor,
        score: p.score,
        streak: p.streak,
        socketId: p.socketId, // internal
      });
    }
  }
  return leaderboard;
}

// Remove server-only fields before broadcasting
function stripUserIds(entries) {
  return entries.map(({ userId, socketId, ...rest }) => rest);
}

// ═══════════════════════════════════════════════════════════════════════
// Send the next question to all clients
// ═══════════════════════════════════════════════════════════════════════
async function sendNextQuestion(io, roomCode, store) {
  const activeRoom = await store.getRoom(roomCode);
  if (!activeRoom) return;

  store.clearTimer(roomCode, 'tickInterval');
  
  const quiz = await store.getQuiz(roomCode);
  const nextIndex = activeRoom.currentQuestionIndex + 1;

  if (nextIndex >= quiz.questions.length) {
    await finishQuiz(io, roomCode, store);
    return;
  }

  const question = quiz.questions[nextIndex];
  const timeLimit = (question.time_limit || quiz.time_per_question) * 1000;
  
  const questionStartTime = Date.now();
  const questionEndTime = questionStartTime + timeLimit;

  await store.updateMeta(roomCode, {
    currentQuestionIndex: nextIndex,
    phase: 'question',
    questionEnding: false,
    questionStartTime,
    questionEndTime,
  });

  io.to(roomCode).emit('question:show', {
    question: sanitizeQuestion(question),
    index: nextIndex,
    total: quiz.questions.length,
    timeLimit: timeLimit / 1000,
    questionStartTime,
  });

  const tickInterval = setInterval(async () => {
    // Re-fetch to ensure room hasn't finished
    const r = await store.getRoom(roomCode);
    if (!r) return store.clearTimer(roomCode, 'tickInterval');
    
    const remaining = Math.max(0, (r.questionEndTime - Date.now()) / 1000);
    io.to(roomCode).emit('room:tickSync', {
      timeRemaining: remaining,
      questionIndex: nextIndex,
    });
    if (remaining <= 0) store.clearTimer(roomCode, 'tickInterval');
  }, 5000);
  store.setTimer(roomCode, 'tickInterval', tickInterval);

  const questionTimer = setTimeout(async () => {
    store.clearTimer(roomCode, 'tickInterval');
    await endQuestion(io, roomCode, store);
  }, timeLimit);
  store.setTimer(roomCode, 'questionTimer', questionTimer);
}

// ═══════════════════════════════════════════════════════════════════════
// End the current question — reveal answer + show leaderboard
// ═══════════════════════════════════════════════════════════════════════
async function endQuestion(io, roomCode, store) {
  const activeRoom = await store.getRoom(roomCode);
  if (!activeRoom) return;

  // Guard against double-execution
  if (activeRoom.questionEnding) return;
  await store.updateMeta(roomCode, { questionEnding: true, phase: 'reveal' });

  const quiz = await store.getQuiz(roomCode);
  const question = quiz.questions[activeRoom.currentQuestionIndex];
  if (!question) return;

  const correctOption = question.options.find(o => o.is_correct);

  const questionAnswers = await store.getAnswersForQuestion(roomCode, question.id);

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
  const revealData = {
    questionType: qType,
    stats: { optionCounts, correctCount, totalAnswered, totalPlayers: activeRoom.activePlayerCount },
  };

  if (qType === 'fill_blank') {
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

  const allParticipants = await store.getAllParticipants(roomCode);

  for (const [userId, participant] of allParticipants) {
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

  const leaderboard = await buildLeaderboard(store, roomCode);

  leaderboard.forEach(entry => {
    const answer = questionAnswers.find(a => a.userId === entry.userId);
    entry.isCorrect = answer ? answer.isCorrect : false;
  });

  setTimeout(async () => {
    const room = await store.getRoom(roomCode);
    if (!room || room.status === 'finished') return;

    await store.updateMeta(roomCode, { phase: 'leaderboard' });

    io.to(roomCode).emit('question:results', {
      leaderboard: stripUserIds(leaderboard.slice(0, 10)),
    });

    leaderboard.forEach(entry => {
      if (entry.socketId) {
        io.to(entry.socketId).emit('question:personalResult', {
          rank: entry.rank,
          totalScore: allParticipants.get(entry.userId)?.score ?? 0,
          totalPlayers: leaderboard.length,
          isCorrect: entry.isCorrect,
        });
      }
    });

    const leaderboardTimer = setTimeout(async () => {
      const r = await store.getRoom(roomCode);
      if (!r || r.status === 'finished' || r.phase !== 'leaderboard') return;
      await sendNextQuestion(io, roomCode, store);
    }, 5000);
    store.setTimer(roomCode, 'leaderboardTimer', leaderboardTimer);
  }, 2000);
}

// ═══════════════════════════════════════════════════════════════════════
// Finish the entire quiz — persist scores and broadcast results
// ═══════════════════════════════════════════════════════════════════════
async function finishQuiz(io, roomCode, store) {
  const activeRoom = await store.getRoom(roomCode);
  if (!activeRoom) return;
  if (activeRoom.status === 'finished') return;

  store.clearTimer(roomCode, 'questionTimer');
  store.clearTimer(roomCode, 'tickInterval');
  store.clearTimer(roomCode, 'countdownTimer');
  store.clearTimer(roomCode, 'leaderboardTimer');

  await store.updateMeta(roomCode, { status: 'finished', phase: 'finished' });

  const allParticipants = await store.getAllParticipants(roomCode);
  const quiz = await store.getQuiz(roomCode);

  try {
    if (quiz && allParticipants.size > 0) {
      // Reconstruct answersByUser
      const answersByUser = new Map();
      const questionAnswersPromises = quiz.questions.map(q => store.getAnswersForQuestion(roomCode, q.id));
      const allAnswersGroups = await Promise.all(questionAnswersPromises);
      
      allAnswersGroups.flat().forEach(answer => {
        if (!answersByUser.has(answer.userId)) answersByUser.set(answer.userId, []);
        answersByUser.get(answer.userId).push(answer);
      });

      for (const [userId, p] of allParticipants) {
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

  const finalLeaderboard = Array.from(allParticipants.values())
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
    totalQuestions: quiz?.questions?.length || 0,
  });

  const cleanupTimer = setTimeout(async () => {
    await store.deleteRoom(roomCode);
  }, 60_000);
  store.setTimer(roomCode, 'cleanupTimer', cleanupTimer);
}

module.exports = { setupGameHandler };