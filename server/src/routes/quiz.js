const router = require('express').Router();
const ctrl = require('../controllers/quizController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.post('/', authorize('educator'), ctrl.createQuiz);
router.get('/', authorize('educator'), ctrl.getMyQuizzes);
router.post('/ai-import', authorize('educator'), ctrl.aiImport);
router.get('/:id', ctrl.getQuiz);
router.put('/:id', authorize('educator'), ctrl.updateQuiz);
router.delete('/:id', authorize('educator'), ctrl.deleteQuiz);
router.post('/:id/questions', authorize('educator'), ctrl.addQuestion);
router.put('/:id/questions/:qid', authorize('educator'), ctrl.updateQuestion);
router.delete('/:id/questions/:qid', authorize('educator'), ctrl.deleteQuestion);
router.put('/:id/publish', authorize('educator'), ctrl.publishQuiz);

module.exports = router;