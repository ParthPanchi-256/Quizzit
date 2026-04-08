const jwt = require('jsonwebtoken');
const { setupRoomHandler } = require('./roomHandler');
const { setupGameHandler } = require('./gameHandler');

// In-memory active rooms store
const activeRooms = new Map();

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

    setupRoomHandler(io, socket, activeRooms);
    setupGameHandler(io, socket, activeRooms);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.userId}`);

      const roomCode = socket.currentRoomCode;
      if (!roomCode) return;

      const room = activeRooms.get(roomCode);
      if (!room) return;

      if (room.hostSocketId === socket.id) {
        room.hostSocketId = null;
      }

      // NEVER delete participants from the Map on disconnect.
      // React StrictMode (and reconnects) cause spurious disconnects.
      // Just null the socketId so personal emits are skipped until reconnect.
      if (room.participants.has(socket.userId)) {
        const participant = room.participants.get(socket.userId);
        if (participant) participant.socketId = null;
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
    });
  });
}

module.exports = { setupSocket, activeRooms };