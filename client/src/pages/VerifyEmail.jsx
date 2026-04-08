import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import './Auth.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) { setStatus('error'); setMessage('No verification token provided'); return; }

    api.get(`/auth/verify-email?token=${token}`)
      .then(() => { setStatus('success'); setMessage('Email verified successfully!'); })
      .catch(err => { setStatus('error'); setMessage(err.response?.data?.error || 'Verification failed'); });
  }, [searchParams]);

  return (
    <div className="auth-page">
      <div className="auth-card animate-fade-in" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
          {status === 'verifying' ? '⏳' : status === 'success' ? '✅' : '❌'}
        </div>
        <h2 style={{ marginBottom: '0.5rem' }}>
          {status === 'verifying' ? 'Verifying...' : status === 'success' ? 'Verified!' : 'Verification Failed'}
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{message}</p>
        {status !== 'verifying' && (
          <Link to="/login" className="hero-btn hero-btn-primary" style={{ display: 'inline-block' }}>
            {status === 'success' ? 'Continue to Login' : 'Back to Login'}
          </Link>
        )}
      </div>
    </div>
  );
}
