const Quiz = require('../models/Quiz');
const Question = require('../models/Question');

exports.createQuiz = async (req, res, next) => {
  try {
    const { title, description, timePerQuestion, shuffleQuestions } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const quiz = await Quiz.create({ creatorId: req.user.id, title, description, timePerQuestion, shuffleQuestions });
    res.status(201).json({ quiz });
  } catch (err) { next(err); }
};

exports.getMyQuizzes = async (req, res, next) => {
  try {
    const quizzes = await Quiz.findByCreator(req.user.id);
    res.json({ quizzes });
  } catch (err) { next(err); }
};

exports.getQuiz = async (req, res, next) => {
  try {
    const quiz = await Quiz.findByIdWithQuestions(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (quiz.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    res.json({ quiz });
  } catch (err) { next(err); }
};

exports.updateQuiz = async (req, res, next) => {
  try {
    const existing = await Quiz.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quiz not found' });
    if (existing.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    const quiz = await Quiz.update(req.params.id, req.body);
    res.json({ quiz });
  } catch (err) { next(err); }
};

exports.deleteQuiz = async (req, res, next) => {
  try {
    const existing = await Quiz.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quiz not found' });
    if (existing.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    await Quiz.delete(req.params.id);
    res.json({ message: 'Quiz deleted' });
  } catch (err) { next(err); }
};

exports.addQuestion = async (req, res, next) => {
  try {
    const existing = await Quiz.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Quiz not found' });
    if (existing.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const { questionText, questionType, points, timeLimit, options } = req.body;
    const type = questionType || 'single';

    if (!questionText) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    if (type === 'fill_blank') {
      // Fill-in-the-blank: options are the accepted answers (each with isCorrect=true)
      if (!options || options.length < 1 || !options.some(o => o.optionText?.trim())) {
        return res.status(400).json({ error: 'At least one accepted answer is required' });
      }
    } else {
      // Single or Multiple choice
      if (!options || options.length < 2) {
        return res.status(400).json({ error: 'At least 2 options are required' });
      }
      const hasCorrect = options.some(o => o.isCorrect);
      if (!hasCorrect) return res.status(400).json({ error: 'At least one option must be correct' });

      if (type === 'multiple') {
        const correctCount = options.filter(o => o.isCorrect).length;
        if (correctCount < 2) return res.status(400).json({ error: 'Multiple choice needs at least 2 correct answers' });
      }
    }

    const orderIndex = await Question.getNextOrderIndex(req.params.id);
    const question = await Question.create({ quizId: req.params.id, orderIndex, questionText, questionType: type, points, timeLimit, options });
    res.status(201).json({ question });
  } catch (err) { next(err); }
};

exports.updateQuestion = async (req, res, next) => {
  try {
    const question = await Question.update(req.params.qid, req.body);
    if (!question) return res.status(404).json({ error: 'Question not found' });
    res.json({ question });
  } catch (err) { next(err); }
};

exports.deleteQuestion = async (req, res, next) => {
  try {
    await Question.delete(req.params.qid);
    res.json({ message: 'Question deleted' });
  } catch (err) { next(err); }
};

exports.publishQuiz = async (req, res, next) => {
  try {
    const quiz = await Quiz.findByIdWithQuestions(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (quiz.creator_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (!quiz.questions || quiz.questions.length === 0) return res.status(400).json({ error: 'Quiz must have at least one question' });
    const published = await Quiz.publish(req.params.id);
    res.json({ quiz: published });
  } catch (err) { next(err); }
};

/**
 * AI Import — create a full quiz with all questions in one request.
 * Called by the Python AI service after quiz generation.
 * Auto-publishes so it's immediately ready to host.
 */
exports.aiImport = async (req, res, next) => {
  try {
    const { title, description, timePerQuestion, questions } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!questions || !questions.length) return res.status(400).json({ error: 'At least one question is required' });

    // Create the quiz
    const quiz = await Quiz.create({
      creatorId: req.user.id,
      title,
      description: description || '',
      timePerQuestion: timePerQuestion || 30,
      shuffleQuestions: false,
    });

    // Add all questions
    const createdQuestions = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText || !q.options || !q.options.length) continue;
      const question = await Question.create({
        quizId: quiz.id,
        orderIndex: i,
        questionText: q.questionText,
        questionType: q.questionType || 'single',
        points: q.points || 10,
        timeLimit: q.timeLimit || null,
        options: q.options,
      });
      createdQuestions.push(question);
    }

    // Auto-publish
    const published = await Quiz.publish(quiz.id);

    res.status(201).json({
      quiz: { ...published, questions: createdQuestions },
      message: `Quiz created with ${createdQuestions.length} questions`,
    });
  } catch (err) { next(err); }
};
