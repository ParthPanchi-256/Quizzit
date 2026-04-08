const db = require('../config/db');

class Question {
  static async create({ quizId, orderIndex, questionText, questionType, points, timeLimit, options }) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const qResult = await client.query(
        `INSERT INTO questions (quiz_id, order_index, question_text, question_type, points, time_limit)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [quizId, orderIndex, questionText, questionType || 'single', points || 10, timeLimit]
      );
      const question = qResult.rows[0];

      const optionRows = [];
      for (let i = 0; i < options.length; i++) {
        const oResult = await client.query(
          `INSERT INTO options (question_id, option_text, is_correct, order_index)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [question.id, options[i].optionText, options[i].isCorrect, i]
        );
        optionRows.push(oResult.rows[0]);
      }
      question.options = optionRows;
      await client.query('COMMIT');
      return question;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async update(id, { questionText, questionType, points, timeLimit, options }) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE questions SET question_text = COALESCE($1, question_text), question_type = COALESCE($2, question_type), points = COALESCE($3, points), time_limit = $4 WHERE id = $5`,
        [questionText, questionType, points, timeLimit, id]
      );

      if (options) {
        await client.query('DELETE FROM options WHERE question_id = $1', [id]);
        for (let i = 0; i < options.length; i++) {
          await client.query(
            `INSERT INTO options (question_id, option_text, is_correct, order_index) VALUES ($1, $2, $3, $4)`,
            [id, options[i].optionText, options[i].isCorrect, i]
          );
        }
      }
      await client.query('COMMIT');

      const result = await db.query(
        `SELECT q.*, json_agg(json_build_object('id', o.id, 'option_text', o.option_text, 'is_correct', o.is_correct, 'order_index', o.order_index) ORDER BY o.order_index) as options
         FROM questions q LEFT JOIN options o ON q.id = o.question_id WHERE q.id = $1 GROUP BY q.id`,
        [id]
      );
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async delete(id) {
    await db.query('DELETE FROM questions WHERE id = $1', [id]);
  }

  static async getNextOrderIndex(quizId) {
    const result = await db.query(
      'SELECT COALESCE(MAX(order_index), -1) + 1 as next_index FROM questions WHERE quiz_id = $1',
      [quizId]
    );
    return result.rows[0].next_index;
  }
}

module.exports = Question;
