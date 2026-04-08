const Room = require('../models/Room');
const Quiz = require('../models/Quiz');
const { generateRoomCode } = require('../utils/pinGenerator');

exports.createRoom = async (req, res, next) => {
  try {
    const { quizId, scheduledStart, maxParticipants } = req.body;
    if (!quizId) return res.status(400).json({ error: 'Quiz ID is required' });

    const quiz = await Quiz.findByIdWithQuestions(quizId);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (quiz.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (quiz.status !== 'published') return res.status(400).json({ error: 'Quiz must be published first' });
    if (!quiz.questions || quiz.questions.length === 0) return res.status(400).json({ error: 'Quiz has no questions' });

    const roomCode = generateRoomCode();
    const room = await Room.create({ quizId, hostId: req.user.id, roomCode, scheduledStart, maxParticipants });
    res.status(201).json({ room });
  } catch (err) { next(err); }
};

exports.getMyRooms = async (req, res, next) => {
  try {
    const rooms = await Room.findByHost(req.user.id);
    res.json({ rooms });
  } catch (err) { next(err); }
};

exports.getRoomByCode = async (req, res, next) => {
  try {
    const room = await Room.findByCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const participantCount = await Room.getParticipantCount(room.id);
    res.json({ room: { ...room, participantCount } });
  } catch (err) { next(err); }
};

exports.joinRoom = async (req, res, next) => {
  try {
    const room = await Room.findByCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status === 'finished') return res.status(400).json({ error: 'This quiz has already ended' });

    const count = await Room.getParticipantCount(room.id);
    if (count >= room.max_participants) return res.status(400).json({ error: 'Room is full' });

    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    const participant = await Room.addParticipant({ roomId: room.id, userId: req.user.id, displayName: user.display_name });
    res.json({ participant, room: { id: room.id, roomCode: room.room_code, quizTitle: room.quiz_title, hostName: room.host_name, status: room.status } });
  } catch (err) { next(err); }
};

exports.getResults = async (req, res, next) => {
  try {
    const results = await Room.getResults(req.params.code);
    if (!results) return res.status(404).json({ error: 'Room not found' });
    res.json(results);
  } catch (err) { next(err); }
};
