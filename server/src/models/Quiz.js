const db = require('../config/db');

class Quiz {
  static async create({ creatorId, title, description, timePerQuestion, shuffleQuestions }) {
    const result = await db.query(
      `INSERT INTO quizzes (creator_id, title, description, time_per_question, shuffle_questions)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [creatorId, title, description, timePerQuestion || 30, shuffleQuestions || false]
    );
    return result.rows[0];
  }

  static async findByCreator(creatorId) {
    const result = await db.query(
      `SELECT q.*, COUNT(qu.id)::int as question_count
       FROM quizzes q LEFT JOIN questions qu ON q.id = qu.quiz_id
       WHERE q.creator_id = $1 GROUP BY q.id ORDER BY q.created_at DESC`,
      [creatorId]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await db.query('SELECT * FROM quizzes WHERE id = $1', [id]);
    return result.rows[0];
  }

  static async findByIdWithQuestions(id) {
    const quizResult = await db.query('SELECT * FROM quizzes WHERE id = $1', [id]);
    if (!quizResult.rows[0]) return null;
    const quiz = quizResult.rows[0];

    const questionsResult = await db.query(
      `SELECT q.*,
              COALESCE(
                json_agg(
                  json_build_object('id', o.id, 'option_text', o.option_text, 'is_correct', o.is_correct, 'order_index', o.order_index)
                  ORDER BY o.order_index
                ) FILTER (WHERE o.id IS NOT NULL),
                '[]'::json
              ) as options
       FROM questions q LEFT JOIN options o ON q.id = o.question_id
       WHERE q.quiz_id = $1 GROUP BY q.id ORDER BY q.order_index`,
      [id]
    );
    quiz.questions = questionsResult.rows;
    return quiz;
  }

  static async update(id, { title, description, timePerQuestion, shuffleQuestions }) {
    const result = await db.query(
      `UPDATE quizzes SET title = COALESCE($1, title), description = COALESCE($2, description),
        time_per_question = COALESCE($3, time_per_question), shuffle_questions = COALESCE($4, shuffle_questions),
        updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *`,
      [title, description, timePerQuestion, shuffleQuestions, id]
    );
    return result.rows[0];
  }

  static async delete(id) {
    await db.query('DELETE FROM quizzes WHERE id = $1', [id]);
  }

  static async publish(id) {
    const result = await db.query(
      `UPDATE quizzes SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  }
}

module.exports = Quiz;
