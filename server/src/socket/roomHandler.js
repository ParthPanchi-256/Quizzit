const Room = require('../models/Room');
const Quiz = require('../models/Quiz');
const User = require('../models/User');

function setupRoomHandler(io, socket, store) {
  socket.on('room:join', async ({ roomCode }) => {
    try {
      const room = await Room.findByCode(roomCode);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.status === 'finished') return socket.emit('error', { message: 'Quiz has ended' });

      const user = await User.findById(socket.userId);
      if (!user) return socket.emit('error', { message: 'User not found' });

      // Always join the Socket.IO room (critical for reconnects & page navigation)
      socket.join(roomCode);
      socket.currentRoomCode = roomCode;

      // Initialize room in store if it doesn't exist yet
      const exists = await store.roomExists(roomCode);
      if (!exists) {
        await store.createRoom(roomCode, {
          roomCode,
          roomId: room.id,
          quizId: room.quiz_id,
          hostId: room.host_id,
          hostSocketId: null,
          status: room.status,
          activePlayerCount: 0,
          currentQuestionIndex: -1,
          questionStartTime: null,
          questionEndTime: null,
          questionEnding: false,
          phase: 'waiting',
        });
      }

      // Re-read meta for checks
      const activeRoom = await store.getRoom(roomCode);

      // Block joining as a NEW participant once the quiz is active.
      // But always allow reconnects (existing participant updating socketId).
      const existingParticipant = await store.getParticipant(roomCode, socket.userId);

      if (existingParticipant) {
        // Reconnection — just restore the socket reference
        existingParticipant.socketId = socket.id;
        await store.setParticipant(roomCode, socket.userId, existingParticipant);

        // If the quiz is already running, redirect them straight to the play page
        if (activeRoom.status === 'active' || activeRoom.status === 'starting') {
          socket.emit('room:lateJoin');
          return;
        }
      } else if (activeRoom.status === 'active' || activeRoom.status === 'starting') {
        // New player trying to join mid-quiz — block them
        return socket.emit('error', { message: 'Quiz is already in progress' });
      } else {
        // New player joining a waiting room
        const count = await Room.getParticipantCount(room.id);
        if (count >= room.max_participants) return socket.emit('error', { message: 'Room is full' });

        const participant = await Room.addParticipant({
          roomId: room.id,
          userId: socket.userId,
          displayName: user.display_name,
        });

        await store.setParticipant(roomCode, socket.userId, {
          id: participant.id,
          displayName: user.display_name,
          avatarColor: user.avatar_color,
          score: 0,
          streak: 0,
          bestStreak: 0,
          correctCount: 0,
          totalTimeMs: 0,
          answerCount: 0,
          socketId: socket.id,
        });
        
        // Also update leaderboard score init
        await store.updateLeaderboardScore(roomCode, socket.userId, 0);
      }

      const allParticipants = await store.getAllParticipants(roomCode);

      // Broadcast updated player list to everyone in the room
      io.to(roomCode).emit('room:playerJoined', {
        participant: {
          displayName: user.display_name,
          avatarColor: user.avatar_color,
        },
        totalPlayers: allParticipants.size,
        players: Array.from(allParticipants.values()).map(p => ({
          displayName: p.displayName,
          avatarColor: p.avatarColor,
        })),
      });

      socket.emit('room:joined', {
        roomCode,
        quizTitle: room.quiz_title,
        hostName: room.host_name,
        status: activeRoom.status,
        totalPlayers: allParticipants.size,
      });
    } catch (err) {
      console.error('room:join error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  socket.on('room:hostJoin', async ({ roomCode }) => {
    try {
      const room = await Room.findByCode(roomCode);
      if (!room) return socket.emit('error', { message: 'Room not found' });
      if (room.host_id !== socket.userId) return socket.emit('error', { message: 'Not authorized' });

      socket.join(roomCode);
      socket.currentRoomCode = roomCode;

      const exists = await store.roomExists(roomCode);
      if (!exists) {
        await store.createRoom(roomCode, {
          roomCode,
          roomId: room.id,
          quizId: room.quiz_id,
          hostId: room.host_id,
          hostSocketId: socket.id,
          status: room.status,
          activePlayerCount: 0,
          currentQuestionIndex: -1,
          questionStartTime: null,
          questionEndTime: null,
          questionEnding: false,
          phase: 'waiting',
        });
      }

      await store.updateMeta(roomCode, { hostSocketId: socket.id });

      const activeRoom = await store.getRoom(roomCode);
      const allParticipants = await store.getAllParticipants(roomCode);
      const participants = await Room.getParticipants(room.id);
      const quiz = await Quiz.findByIdWithQuestions(room.quiz_id);

      socket.emit('room:hostJoined', {
        roomCode,
        status: activeRoom.status,
        totalPlayers: allParticipants.size,
        players: Array.from(allParticipants.values()).map(p => ({
          displayName: p.displayName,
          avatarColor: p.avatarColor,
        })),
        dbParticipants: participants,
        quizTitle: room.quiz_title,
        quizDescription: room.quiz_description,
        questionCount: quiz?.questions?.length || 0,
        timePerQuestion: room.time_per_question,
      });
    } catch (err) {
      console.error('room:hostJoin error:', err);
      socket.emit('error', { message: 'Failed to join as host' });
    }
  });

  // Re-join socket.io room when LiveQuiz mounts (page navigation loses room membership)
  socket.on('room:rejoin', async ({ roomCode }) => {
    socket.join(roomCode);
    socket.currentRoomCode = roomCode;

    const activeRoom = await store.getRoom(roomCode);
    if (!activeRoom) return;

    // Restore socketId for the participant
    const participant = await store.getParticipant(roomCode, socket.userId);
    if (participant) {
      participant.socketId = socket.id;
      await store.setParticipant(roomCode, socket.userId, participant);
    }

    // Restore hostSocketId
    if (activeRoom.hostId === socket.userId) {
      await store.updateMeta(roomCode, { hostSocketId: socket.id });
    }
  });

  socket.on('room:leave', async ({ roomCode }) => {
    socket.leave(roomCode);
    socket.currentRoomCode = null;

    const participant = await store.getParticipant(roomCode, socket.userId);
    if (participant) {
      // Never delete — just null the socket
      participant.socketId = null;
      await store.setParticipant(roomCode, socket.userId, participant);
    }
  });
}

module.exports = { setupRoomHandler };