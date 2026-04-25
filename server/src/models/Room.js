const db = require('../config/db');

class Room {
  static async create({ quizId, hostId, roomCode, scheduledStart, maxParticipants }) {
    const result = await db.query(
      `INSERT INTO quiz_rooms (quiz_id, host_id, room_code, scheduled_start, max_participants)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [quizId, hostId, roomCode, scheduledStart, maxParticipants || 400]
    );
    return result.rows[0];
  }

  static async findByCode(code) {
    const result = await db.query(
      `SELECT qr.*, q.title as quiz_title, q.description as quiz_description, q.time_per_question,
              u.display_name as host_name, u.avatar_color as host_avatar_color
       FROM quiz_rooms qr JOIN quizzes q ON qr.quiz_id = q.id JOIN users u ON qr.host_id = u.id
       WHERE qr.room_code = $1`,
      [code]
    );
    return result.rows[0];
  }

  static async findByHost(hostId) {
    const result = await db.query(
      `SELECT qr.*, q.title as quiz_title, COUNT(rp.id)::int as participant_count
       FROM quiz_rooms qr JOIN quizzes q ON qr.quiz_id = q.id
       LEFT JOIN room_participants rp ON qr.id = rp.room_id
       WHERE qr.host_id = $1 GROUP BY qr.id, q.title ORDER BY qr.created_at DESC`,
      [hostId]
    );
    return result.rows;
  }

  static async addParticipant({ roomId, userId, displayName }) {
    const result = await db.query(
      `INSERT INTO room_participants (room_id, user_id, display_name)
       VALUES ($1, $2, $3) ON CONFLICT (room_id, user_id) DO UPDATE SET display_name = $3, joined_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [roomId, userId, displayName]
    );
    return result.rows[0];
  }

  static async getParticipants(roomId) {
    const result = await db.query(
      `SELECT rp.*, u.username, u.avatar_color
       FROM room_participants rp JOIN users u ON rp.user_id = u.id
       WHERE rp.room_id = $1 ORDER BY rp.score DESC, rp.joined_at ASC`,
      [roomId]
    );
    return result.rows;
  }

  static async getParticipantCount(roomId) {
    const result = await db.query('SELECT COUNT(*)::int as count FROM room_participants WHERE room_id = $1', [roomId]);
    return result.rows[0].count;
  }

  static async updateStatus(id, status) {
    const startedAt = status === 'active' ? new Date() : null;
    const endedAt = status === 'finished' ? new Date() : null;
    const result = await db.query(
      `UPDATE quiz_rooms SET status = $1, started_at = COALESCE($2, started_at), ended_at = COALESCE($3, ended_at) WHERE id = $4 RETURNING *`,
      [status, startedAt, endedAt, id]
    );
    return result.rows[0];
  }

  static async saveAnswer({ roomId, participantId, questionId, selectedOptionId, selectedOptionIds, textAnswer, isCorrect, timeTakenMs, pointsAwarded }) {
    const result = await db.query(
      `INSERT INTO answers (room_id, participant_id, question_id, selected_option_id, selected_option_ids, text_answer, is_correct, time_taken_ms, points_awarded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (participant_id, question_id) DO NOTHING RETURNING *`,
      [roomId, participantId, questionId, selectedOptionId, selectedOptionIds || null, textAnswer || null, isCorrect, timeTakenMs, pointsAwarded]
    );
    return result.rows[0];
  }

  static async updateParticipantScore(participantId, { score, correctCount, streak, bestStreak, avgTimeMs }) {
    await db.query(
      `UPDATE room_participants SET score = $1, correct_count = $2, streak = $3, best_streak = $4, avg_time_ms = $5 WHERE id = $6`,
      [score, correctCount, streak, bestStreak, avgTimeMs, participantId]
    );
  }

  static async updateRanks(roomId) {
    await db.query(
      `UPDATE room_participants SET rank = sub.rank
       FROM (SELECT id, RANK() OVER (ORDER BY score DESC) as rank FROM room_participants WHERE room_id = $1) sub
       WHERE room_participants.id = sub.id`,
      [roomId]
    );
  }

  static async getResults(roomCode) {
    const room = await Room.findByCode(roomCode);
    if (!room) return null;
    const participants = await db.query(
      `SELECT rp.display_name, rp.score, rp.rank, rp.correct_count, rp.best_streak, rp.avg_time_ms, u.avatar_color, u.username
       FROM room_participants rp JOIN users u ON rp.user_id = u.id
       WHERE rp.room_id = $1 ORDER BY rp.score DESC`,
      [room.id]
    );
    return { room, participants: participants.rows };
  }

  static async findByStudent(userId) {
    const result = await db.query(
      `SELECT qr.room_code, qr.status, qr.ended_at,
              q.title AS quiz_title, q.description AS quiz_description,
              rp.score, rp.rank, rp.correct_count, rp.best_streak, rp.avg_time_ms,
              u.display_name AS host_name,
              (SELECT COUNT(*)::int FROM room_participants WHERE room_id = qr.id) AS total_players,
              (SELECT COUNT(*)::int FROM questions WHERE quiz_id = q.id) AS total_questions
       FROM room_participants rp
         JOIN quiz_rooms qr ON rp.room_id = qr.id
         JOIN quizzes q ON qr.quiz_id = q.id
         JOIN users u ON qr.host_id = u.id
       WHERE rp.user_id = $1 AND qr.status = 'finished'
       ORDER BY qr.ended_at DESC`,
      [userId]
    );
    return result.rows;
  }

  static async getStudentAnswers(roomCode, userId) {
    const result = await db.query(
      `SELECT qs.question_text, qs.question_type, qs.points, qs.order_index,
              a.is_correct, a.time_taken_ms, a.points_awarded,
              a.selected_option_id, a.selected_option_ids, a.text_answer,
              (SELECT json_agg(
                json_build_object(
                  'id', o.id, 'option_text', o.option_text,
                  'is_correct', o.is_correct, 'order_index', o.order_index
                ) ORDER BY o.order_index
              ) FROM options o WHERE o.question_id = qs.id
              ) AS options
       FROM answers a
         JOIN room_participants rp ON a.participant_id = rp.id
         JOIN questions qs ON a.question_id = qs.id
       WHERE rp.room_id = (SELECT id FROM quiz_rooms WHERE room_code = $1)
         AND rp.user_id = $2
       ORDER BY qs.order_index`,
      [roomCode, userId]
    );
    return result.rows;
  }
}

module.exports = Room;
