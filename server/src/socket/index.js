const jwt = require('jsonwebtoken');
const { setupRoomHandler } = require('./roomHandler');
const { setupGameHandler } = require('./gameHandler');
const { createRoomStore } = require('./roomStore');

// Central store for live game state (Redis or In-Memory)
const store = createRoomStore(process.env.USE_REDIS_ROOM_STORE === 'true');

function setupSocket(io) {
  // JWT auth middleware — runs before every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      socket.userEmail = decoded.email;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.userId} (${socket.userRole})`);

    socket.currentRoomCode = null;

    // Passing 'store' as 'activeRooms' parameter to minimize diff in child handlers
    setupRoomHandler(io, socket, store);
    setupGameHandler(io, socket, store);

    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.userId}`);

      const roomCode = socket.currentRoomCode;
      if (!roomCode) return;

      try {
        const room = await store.getRoom(roomCode);
        if (!room) return;

        if (room.hostSocketId === socket.id) {
          await store.updateMeta(roomCode, { hostSocketId: null });
        }

        // NEVER delete participants from the Store on disconnect.
        // React StrictMode (and reconnects) cause spurious disconnects.
        // Just null the socketId so personal emits are skipped until reconnect.
        const participant = await store.getParticipant(roomCode, socket.userId);
        if (participant) {
          participant.socketId = null;
          await store.setParticipant(roomCode, socket.userId, participant);
        }
      } catch (err) {
        console.error('Error during disconnect cleanup:', err);
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  });
}

// Exporting store as activeRooms for backward compatibility if needed elsewhere
module.exports = { setupSocket, activeRooms: store };