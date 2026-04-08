import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Navbar.css';

export default function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to={isAuthenticated ? '/dashboard' : '/'} className="navbar-logo">
          <span className="logo-icon">◆</span>
          <span className="logo-text">Quizzit</span>
        </Link>

        <div className="navbar-right">
          {isAuthenticated ? (
            <>
              {user.role === 'student' && (
                <Link to="/join" className="nav-link">Join Quiz</Link>
              )}
              <div className="navbar-user">
                <div className="user-avatar" style={{ background: user.avatarColor || 'var(--purple)' }}>
                  {user.displayName?.charAt(0).toUpperCase()}
                </div>
                <div className="user-info">
                  <span className="user-name">{user.displayName}</span>
                  <span className="user-role">{user.role}</span>
                </div>
                <button onClick={handleLogout} className="nav-logout" title="Sign out">↗</button>
              </div>
            </>
          ) : (
            <div className="nav-auth-links">
              <Link to="/login" className="nav-link">Sign in</Link>
              <Link to="/register" className="nav-link nav-link-primary">Get Started</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
