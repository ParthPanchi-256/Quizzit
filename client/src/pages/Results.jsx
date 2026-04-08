import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import Button from '../components/ui/Button';
import './Results.css';

export default function Results() {
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(location.state || null);
  const [loading, setLoading] = useState(!location.state);

  useEffect(() => {
    if (!data) {
      api.get(`/rooms/${code}/results`)
        .then(r => {
          const d = r.data;
          // Map snake_case DB fields to camelCase used in component
          const mapped = d.participants.map(p => ({
            displayName: p.display_name || p.displayName || p.username || 'Unknown',
            avatarColor: p.avatar_color || p.avatarColor || 'var(--purple)',
            score: p.score || 0,
            correctCount: p.correct_count ?? p.correctCount ?? 0,
            bestStreak: p.best_streak ?? p.bestStreak ?? 0,
            rank: p.rank,
          }));
          const sorted = mapped.sort((a, b) => b.score - a.score);
          setData({
            finalLeaderboard: sorted.map((p, i) => ({ ...p, rank: i + 1 })),
            topThree: sorted.slice(0, 3).map((p, i) => ({ ...p, rank: i + 1 })),
            totalQuestions: null, room: d.room,
          });
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [code, data]);

  if (loading) return <div className="results-page"><p style={{ color: 'var(--text-muted)' }}>Loading results...</p></div>;
  if (!data) return <div className="results-page"><p>No results found</p></div>;

  const { finalLeaderboard = [], topThree = [] } = data;
  const podiumOrder = topThree.length >= 3 ? [topThree[1], topThree[0], topThree[2]] : topThree;

  return (
    <div className="results-page">
      <div className="results-content animate-fade-in">
        <h1 className="results-title">🏆 Final Results</h1>

        {topThree.length > 0 && (
          <div className="podium-section">
            <div className="podium">
              {podiumOrder.map((p, i) => {
                const position = topThree.length >= 3 ? [2, 1, 3][i] : i + 1;
                const heights = { 1: 160, 2: 120, 3: 90 };
                const colors = { 1: '#fbbf24', 2: '#94a3b8', 3: '#cd7f32' };
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
                return (
                  <div key={i} className="podium-place" style={{ '--podium-height': `${heights[position]}px` }}>
                    <div className="podium-player animate-scale-in" style={{ animationDelay: `${i * 0.2 + 0.3}s` }}>
                      <div className="podium-avatar" style={{ background: p.avatarColor || 'var(--purple)', borderColor: colors[position] }}>
                        {p.displayName.charAt(0).toUpperCase()}
                      </div>
                      <span className="podium-name">{p.displayName}</span>
                      <span className="podium-score">{p.score} pts</span>
                    </div>
                    <div className="podium-bar" style={{ background: `linear-gradient(to top, ${colors[position]}22, ${colors[position]}66)`, borderColor: colors[position] }}>
                      <span className="podium-medal">{medals[position]}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="results-leaderboard">
          <h3>Full Leaderboard</h3>
          <div className="results-lb-list">
            {finalLeaderboard.map((p, i) => (
              <div key={i} className="results-lb-row" style={{ animationDelay: `${i * 0.04}s` }}>
                <span className="results-lb-rank">{i + 1}</span>
                <div className="results-lb-avatar" style={{ background: p.avatarColor || 'var(--purple)' }}>
                  {p.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="results-lb-info">
                  <span className="results-lb-name">{p.displayName}</span>
                  <span className="results-lb-stats">{p.correctCount || 0} correct • {p.bestStreak || 0} streak</span>
                </div>
                <span className="results-lb-score">{p.score}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="results-actions">
          <Button onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
        </div>
      </div>
    </div>
  );
}
