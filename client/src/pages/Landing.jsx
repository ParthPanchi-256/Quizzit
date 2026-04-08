import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Landing.css';

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-bg-shapes">
          <div className="shape shape-1" /><div className="shape shape-2" /><div className="shape shape-3" />
        </div>
        <div className="hero-content">
          <div className="hero-badge">🎯 Live Interactive Quizzes</div>
          <h1 className="hero-title">
            Make Learning<br /><span className="hero-highlight">Unforgettable</span>
          </h1>
          <p className="hero-subtitle">
            Create and host live quizzes that engage your students in real-time.
            Watch them compete, learn, and have fun — all at once.
          </p>
          <div className="hero-actions">
            {isAuthenticated ? (
              <Link to="/dashboard" className="hero-btn hero-btn-primary">Go to Dashboard →</Link>
            ) : (
              <>
                <Link to="/register" className="hero-btn hero-btn-primary">Start for Free</Link>
                <Link to="/login" className="hero-btn hero-btn-secondary">Sign In</Link>
              </>
            )}
          </div>
          <div className="hero-stats">
            <div className="stat"><span className="stat-value">400+</span><span className="stat-label">Players per room</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-value">Live</span><span className="stat-label">Real-time scoring</span></div>
            <div className="stat-divider" />
            <div className="stat"><span className="stat-value">∞</span><span className="stat-label">Quizzes to create</span></div>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="page-container">
          <h2 className="section-title">How It Works</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon" style={{background: 'var(--purple-glow)', color: 'var(--purple)'}}>✎</div>
              <h3>Create</h3>
              <p>Build engaging MCQ quizzes with our intuitive quiz builder. Set time limits, add questions, and publish when ready.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: 'rgba(34,211,238,0.1)', color: 'var(--cyan)'}}>⚡</div>
              <h3>Host Live</h3>
              <p>Launch a live room with a unique code. Students join from any device — no app download needed.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon" style={{background: 'rgba(245,158,11,0.1)', color: 'var(--amber)'}}>🏆</div>
              <h3>Compete</h3>
              <p>Students answer in real-time with live leaderboards. Speed and accuracy earn bonus points and streaks.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="page-container">
          <div className="footer-content">
            <div className="footer-logo"><span className="logo-icon">◆</span> Quizzit</div>
            <p className="footer-text">Making learning interactive, one quiz at a time.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
