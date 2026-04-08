const Room = require('../models/Room');
const Quiz = require('../models/Quiz');
const User = require('../models/User');

function setupRoomHandler(io, socket, activeRooms) {
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

      // Initialize in-memory room if it doesn't exist yet
      if (!activeRooms.has(roomCode)) {
        activeRooms.set(roomCode, {
          roomCode,
          roomId: room.id,
          quizId: room.quiz_id,
          hostId: room.host_id,
          hostSocketId: null,
          status: room.status,
          participants: new Map(),
          activePlayerCount: 0,
          currentQuestionIndex: -1,
          questionTimer: null,
          questionStartTime: null,
          questionEndTime: null,
          questionEnding: false,
          answers: new Map(),
          quiz: null,
          phase: 'waiting',
          tickInterval: null,
          countdownTimer: null,
        });
      }

      const activeRoom = activeRooms.get(roomCode);

      // Block joining as a NEW participant once the quiz is active.
      // But always allow reconnects (existing participant updating socketId).
      const existingParticipant = activeRoom.participants.get(socket.userId);

      if (existingParticipant) {
        // Reconnection — just restore the socket reference
        existingParticipant.socketId = socket.id;
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

        activeRoom.participants.set(socket.userId, {
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
      }

      // Broadcast updated player list to everyone in the room
      io.to(roomCode).emit('room:playerJoined', {
        participant: {
          displayName: user.display_name,
          avatarColor: user.avatar_color,
        },
        totalPlayers: activeRoom.participants.size,
        players: Array.from(activeRoom.participants.values()).map(p => ({
          displayName: p.displayName,
          avatarColor: p.avatarColor,
        })),
      });

      socket.emit('room:joined', {
        roomCode,
        quizTitle: room.quiz_title,
        hostName: room.host_name,
        status: activeRoom.status,
        totalPlayers: activeRoom.participants.size,
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

      if (!activeRooms.has(roomCode)) {
        activeRooms.set(roomCode, {
          roomCode,
          roomId: room.id,
          quizId: room.quiz_id,
          hostId: room.host_id,
          hostSocketId: socket.id,
          status: room.status,
          participants: new Map(),
          activePlayerCount: 0,
          currentQuestionIndex: -1,
          questionTimer: null,
          questionStartTime: null,
          questionEndTime: null,
          questionEnding: false,
          answers: new Map(),
          quiz: null,
          phase: 'waiting',
          tickInterval: null,
          countdownTimer: null,
        });
      }

      const activeRoom = activeRooms.get(roomCode);
      activeRoom.hostSocketId = socket.id;

      const participants = await Room.getParticipants(room.id);

      socket.emit('room:hostJoined', {
        roomCode,
        status: activeRoom.status,
        totalPlayers: activeRoom.participants.size,
        players: Array.from(activeRoom.participants.values()).map(p => ({
          displayName: p.displayName,
          avatarColor: p.avatarColor,
        })),
        dbParticipants: participants,
      });
    } catch (err) {
      console.error('room:hostJoin error:', err);
      socket.emit('error', { message: 'Failed to join as host' });
    }
  });

  // Re-join socket.io room when LiveQuiz mounts (page navigation loses room membership)
  socket.on('room:rejoin', ({ roomCode }) => {
    socket.join(roomCode);
    socket.currentRoomCode = roomCode;

    const activeRoom = activeRooms.get(roomCode);
    if (!activeRoom) return;

    // Restore socketId for the participant
    const participant = activeRoom.participants.get(socket.userId);
    if (participant) participant.socketId = socket.id;

    // Restore hostSocketId
    if (activeRoom.hostId === socket.userId) {
      activeRoom.hostSocketId = socket.id;
    }
  });

  socket.on('room:leave', ({ roomCode }) => {
    socket.leave(roomCode);
    socket.currentRoomCode = null;

    const activeRoom = activeRooms.get(roomCode);
    if (!activeRoom) return;

    if (activeRoom.participants.has(socket.userId)) {
      // Never delete — just null the socket
      const p = activeRoom.participants.get(socket.userId);
      if (p) p.socketId = null;
    }
  });
}

module.exports = { setupRoomHandler };