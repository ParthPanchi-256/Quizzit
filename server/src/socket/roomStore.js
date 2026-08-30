const { getRedisClient } = require('../config/redis');

// Local timer map for both implementations
// Keys: roomCode, Values: { questionTimer, tickInterval, countdownTimer, leaderboardTimer }
const localTimers = new Map();

function getTimerStore(roomCode) {
  if (!localTimers.has(roomCode)) {
    localTimers.set(roomCode, {});
  }
  return localTimers.get(roomCode);
}

class InMemoryRoomStore {
  constructor() {
    this.rooms = new Map();
  }

  async createRoom(roomCode, initialData) {
    this.rooms.set(roomCode, {
      ...initialData,
      participants: new Map(),
      answers: new Map(),
      locks: new Map(),
      quiz: null
    });
  }

  async getRoom(roomCode) {
    const r = this.rooms.get(roomCode);
    if (!r) return null;
    // Return a copy of scalar fields to emulate Redis HGETALL
    return {
      roomId: r.roomId,
      quizId: r.quizId,
      hostId: r.hostId,
      hostSocketId: r.hostSocketId,
      status: r.status,
      phase: r.phase,
      currentQuestionIndex: r.currentQuestionIndex,
      questionStartTime: r.questionStartTime,
      questionEndTime: r.questionEndTime,
      questionEnding: r.questionEnding,
      activePlayerCount: r.activePlayerCount
    };
  }

  async roomExists(roomCode) {
    return this.rooms.has(roomCode);
  }

  async updateMeta(roomCode, partialMeta) {
    const room = this.rooms.get(roomCode);
    if (room) {
      Object.assign(room, partialMeta);
    }
  }

  async setParticipant(roomCode, userId, participantObj) {
    const room = this.rooms.get(roomCode);
    if (room) room.participants.set(userId, participantObj);
  }

  async getParticipant(roomCode, userId) {
    const room = this.rooms.get(roomCode);
    return room ? room.participants.get(userId) : null;
  }

  async getAllParticipants(roomCode) {
    const room = this.rooms.get(roomCode);
    return room ? room.participants : new Map();
  }

  async deleteParticipant(roomCode, userId) {
    const room = this.rooms.get(roomCode);
    if (room) room.participants.delete(userId);
  }

  async setAnswer(roomCode, questionId, userId, answerObj) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.answers.set(`${questionId}|${userId}`, answerObj);
    }
  }

  async getAnswer(roomCode, questionId, userId) {
    const room = this.rooms.get(roomCode);
    return room ? room.answers.get(`${questionId}|${userId}`) : null;
  }

  async getAnswersForQuestion(roomCode, questionId) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    const prefix = `${questionId}|`;
    const result = [];
    for (const [key, val] of room.answers.entries()) {
      if (key.startsWith(prefix)) result.push(val);
    }
    return result;
  }

  async countAnswersForQuestion(roomCode, questionId) {
    const answers = await this.getAnswersForQuestion(roomCode, questionId);
    return answers.length;
  }

  async acquireAnswerLock(roomCode, questionId, userId) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    const lockKey = `${questionId}|${userId}`;
    if (room.locks.has(lockKey)) return false;
    room.locks.set(lockKey, true);
    return true;
  }

  async releaseAnswerLock(roomCode, questionId, userId) {
    const room = this.rooms.get(roomCode);
    if (room) {
      room.locks.delete(`${questionId}|${userId}`);
    }
  }

  async setQuiz(roomCode, quizObject) {
    const room = this.rooms.get(roomCode);
    if (room) room.quiz = quizObject;
  }

  async getQuiz(roomCode) {
    const room = this.rooms.get(roomCode);
    return room ? room.quiz : null;
  }

  async updateLeaderboardScore(roomCode, userId, newScore) {
    // In-memory doesn't need a separate sorted set structure since we sort on demand
    // The participant's score is updated in `setParticipant`
  }

  async getLeaderboard(roomCode, limit) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    const sorted = Array.from(room.participants.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .map(([userId]) => userId);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  async deleteRoom(roomCode) {
    this.rooms.delete(roomCode);
    localTimers.delete(roomCode);
  }

  // Common timer methods
  setTimer(roomCode, key, handle) {
    getTimerStore(roomCode)[key] = handle;
  }
  getTimer(roomCode, key) {
    return getTimerStore(roomCode)[key];
  }
  clearTimer(roomCode, key) {
    const store = getTimerStore(roomCode);
    if (store[key]) {
      if (key === 'tickInterval') clearInterval(store[key]);
      else clearTimeout(store[key]);
      store[key] = null;
    }
  }
}


class RedisRoomStore {
  constructor() {
    this.redis = getRedisClient();
    this.TTL = 86400; // 24 hours safety net
  }

  _roomKey(roomCode, suffix) {
    return `quizzit:room:${roomCode}:${suffix}`;
  }

  async createRoom(roomCode, initialData) {
    const metaKey = this._roomKey(roomCode, 'meta');
    
    const formattedData = {};
    for (const [k, v] of Object.entries(initialData)) {
      if (v === null || v === undefined) continue;
      formattedData[k] = typeof v === 'boolean' ? (v ? '1' : '0') : v.toString();
    }
    
    await this.redis.multi()
      .hset(metaKey, formattedData)
      .expire(metaKey, this.TTL)
      .sadd('quizzit:rooms:active', roomCode)
      .exec();
  }

  async getRoom(roomCode) {
    const metaKey = this._roomKey(roomCode, 'meta');
    const raw = await this.redis.hgetall(metaKey);
    if (Object.keys(raw).length === 0) return null;
    
    return {
      roomId: parseInt(raw.roomId, 10),
      quizId: parseInt(raw.quizId, 10),
      hostId: parseInt(raw.hostId, 10),
      hostSocketId: raw.hostSocketId || null,
      status: raw.status,
      phase: raw.phase,
      currentQuestionIndex: parseInt(raw.currentQuestionIndex || '-1', 10),
      questionStartTime: raw.questionStartTime ? parseInt(raw.questionStartTime, 10) : null,
      questionEndTime: raw.questionEndTime ? parseInt(raw.questionEndTime, 10) : null,
      questionEnding: raw.questionEnding === '1',
      activePlayerCount: parseInt(raw.activePlayerCount || '0', 10),
    };
  }

  async roomExists(roomCode) {
    return await this.redis.exists(this._roomKey(roomCode, 'meta')) > 0;
  }

  async updateMeta(roomCode, partialMeta) {
    const metaKey = this._roomKey(roomCode, 'meta');
    const formattedData = {};
    for (const [k, v] of Object.entries(partialMeta)) {
      if (v === null) {
        await this.redis.hdel(metaKey, k);
        continue;
      }
      formattedData[k] = typeof v === 'boolean' ? (v ? '1' : '0') : v.toString();
    }
    if (Object.keys(formattedData).length > 0) {
      await this.redis.hset(metaKey, formattedData);
    }
    await this.redis.expire(metaKey, this.TTL);
  }

  async setParticipant(roomCode, userId, participantObj) {
    const key = this._roomKey(roomCode, 'participants');
    await this.redis.hset(key, userId.toString(), JSON.stringify(participantObj));
    await this.redis.expire(key, this.TTL);
  }

  async getParticipant(roomCode, userId) {
    const raw = await this.redis.hget(this._roomKey(roomCode, 'participants'), userId.toString());
    return raw ? JSON.parse(raw) : null;
  }

  async getAllParticipants(roomCode) {
    const raw = await this.redis.hgetall(this._roomKey(roomCode, 'participants'));
    const map = new Map();
    for (const [userId, jsonStr] of Object.entries(raw)) {
      map.set(parseInt(userId, 10), JSON.parse(jsonStr));
    }
    return map;
  }

  async deleteParticipant(roomCode, userId) {
    await this.redis.hdel(this._roomKey(roomCode, 'participants'), userId.toString());
  }

  async setAnswer(roomCode, questionId, userId, answerObj) {
    const key = this._roomKey(roomCode, 'answers');
    await this.redis.hset(key, `${questionId}|${userId}`, JSON.stringify(answerObj));
    await this.redis.expire(key, this.TTL);
  }

  async getAnswer(roomCode, questionId, userId) {
    const raw = await this.redis.hget(this._roomKey(roomCode, 'answers'), `${questionId}|${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async getAnswersForQuestion(roomCode, questionId) {
    const raw = await this.redis.hgetall(this._roomKey(roomCode, 'answers'));
    const result = [];
    const prefix = `${questionId}|`;
    for (const [field, jsonStr] of Object.entries(raw)) {
      if (field.startsWith(prefix)) result.push(JSON.parse(jsonStr));
    }
    return result;
  }

  async countAnswersForQuestion(roomCode, questionId) {
    // Basic approach: fetch all and count. Fine for typical room sizes.
    const answers = await this.getAnswersForQuestion(roomCode, questionId);
    return answers.length;
  }

  async acquireAnswerLock(roomCode, questionId, userId) {
    const lockKey = `quizzit:room:${roomCode}:lock:${questionId}:${userId}`;
    const acquired = await this.redis.set(lockKey, '1', 'NX', 'PX', 5000);
    return acquired === 'OK';
  }

  async releaseAnswerLock(roomCode, questionId, userId) {
    const lockKey = `quizzit:room:${roomCode}:lock:${questionId}:${userId}`;
    await this.redis.del(lockKey);
  }

  async setQuiz(roomCode, quizObject) {
    const key = this._roomKey(roomCode, 'quiz');
    // Quiz gets a smaller TTL (4 hours)
    await this.redis.set(key, JSON.stringify(quizObject), 'EX', 14400);
  }

  async getQuiz(roomCode) {
    const raw = await this.redis.get(this._roomKey(roomCode, 'quiz'));
    return raw ? JSON.parse(raw) : null;
  }

  async updateLeaderboardScore(roomCode, userId, newScore) {
    const key = this._roomKey(roomCode, 'leaderboard');
    await this.redis.zadd(key, newScore, userId.toString());
    await this.redis.expire(key, this.TTL);
  }

  async getLeaderboard(roomCode, limit) {
    const key = this._roomKey(roomCode, 'leaderboard');
    // Returns array of [member, score, member, score...]
    const args = limit ? [key, '+inf', '-inf', 'LIMIT', 0, limit] : [key, '+inf', '-inf'];
    const raw = await this.redis.zrevrangebyscore(...args);
    // Just return the sorted userIds, let caller fetch details if needed
    return raw.map(id => parseInt(id, 10));
  }

  async deleteRoom(roomCode) {
    // Delete all room keys using a pipeline
    const keys = [
      this._roomKey(roomCode, 'meta'),
      this._roomKey(roomCode, 'participants'),
      this._roomKey(roomCode, 'answers'),
      this._roomKey(roomCode, 'quiz'),
      this._roomKey(roomCode, 'leaderboard')
    ];
    
    // Attempt to clear any stray locks by pattern matching if needed, 
    // but PX 5000 handles them organically so it's not strictly necessary.

    await this.redis.multi()
      .del(...keys)
      .srem('quizzit:rooms:active', roomCode)
      .exec();

    localTimers.delete(roomCode);
  }

  // Timers are local-only
  setTimer(roomCode, key, handle) {
    getTimerStore(roomCode)[key] = handle;
  }
  getTimer(roomCode, key) {
    return getTimerStore(roomCode)[key];
  }
  clearTimer(roomCode, key) {
    const store = getTimerStore(roomCode);
    if (store[key]) {
      if (key === 'tickInterval') clearInterval(store[key]);
      else clearTimeout(store[key]);
      store[key] = null;
    }
  }
}

function createRoomStore(useRedis) {
  if (useRedis) {
    console.log('Using RedisRoomStore for game state');
    return new RedisRoomStore();
  } else {
    console.log('Using InMemoryRoomStore for game state');
    return new InMemoryRoomStore();
  }
}

module.exports = { createRoomStore };
