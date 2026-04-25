function calculateScore(isCorrect, timeElapsedMs, timeLimitMs, currentStreak, questionPoints) {
  if (!isCorrect) {
    return { points: 0, streak: 0, timePoints: 0, streakBonus: 0 };
  }

  const maxPoints = questionPoints || 10;
  const timeFraction = Math.min(timeElapsedMs / timeLimitMs, 1);
  // Faster answers get up to 100% of max points; slowest get 50%
  const timeMultiplier = 1 - (timeFraction * 0.5);
  const timePoints = Math.round(maxPoints * timeMultiplier);

  const newStreak = currentStreak + 1;
  // Streak bonus: small percentage boost — +4% per streak level, capped at +20%
  const streakPercent = Math.min(newStreak * 0.04, 0.20);
  const streakBonus = Math.round(timePoints * streakPercent);

  // Total can NEVER exceed the question's assigned points
  const totalPoints = Math.min(timePoints + streakBonus, maxPoints);

  return { points: totalPoints, streak: newStreak, timePoints, streakBonus };
}

module.exports = { calculateScore };
