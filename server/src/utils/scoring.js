function calculateScore(isCorrect, timeElapsedMs, timeLimitMs, currentStreak, questionPoints) {
  if (!isCorrect) {
    return { points: 0, streak: 0, timePoints: 0, streakBonus: 0 };
  }

  const basePoints = questionPoints || 10;
  const timeFraction = Math.min(timeElapsedMs / timeLimitMs, 1);
  // Faster answers get up to 100% of base points; slowest answers get 50%
  const timeMultiplier = 1 - (timeFraction * 0.5);
  const timePoints = Math.round(basePoints * timeMultiplier);

  const newStreak = currentStreak + 1;
  // Streak bonus: +2 per streak level, capped at 10
  const streakBonus = Math.min(newStreak * 2, 10);
  const totalPoints = timePoints + streakBonus;

  return { points: totalPoints, streak: newStreak, timePoints, streakBonus };
}

module.exports = { calculateScore };
