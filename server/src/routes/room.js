const router = require('express').Router();
const ctrl = require('../controllers/roomController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.post('/', authorize('educator'), ctrl.createRoom);
router.get('/my-rooms', authorize('educator'), ctrl.getMyRooms);
router.get('/my-attempts', ctrl.getMyAttempts);
router.get('/:code', ctrl.getRoomByCode);
router.post('/:code/join', ctrl.joinRoom);
router.get('/:code/results', ctrl.getResults);
router.get('/:code/my-answers', ctrl.getMyAnswers);

module.exports = router;
