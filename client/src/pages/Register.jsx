import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import './Auth.css';

export default function Register() {
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '', confirmPassword: '', role: 'student' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const update = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.email) errs.email = 'Required';
    if (!form.username) errs.username = 'Required';
    if (form.username && form.username.length < 3) errs.username = 'Min 3 characters';
    if (!form.displayName) errs.displayName = 'Required';
    if (!form.password) errs.password = 'Required';
    else if (form.password.length < 8) errs.password = 'Min 8 characters';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'Passwords don\'t match';
    if (Object.keys(errs).length) return setErrors(errs);

    setLoading(true);
    try {
      const data = await register(form);
      toast.success(data.message || 'Account created!');
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed';
      toast.error(msg);
      setErrors({ general: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide animate-fade-in">
        <div className="auth-header">
          <Link to="/" className="auth-logo"><span className="logo-icon">◆</span> Quizzit</Link>
          <h1>Create your account</h1>
          <p>Join as an educator or student</p>
        </div>

        <div className="role-toggle">
          <button className={`role-btn ${form.role === 'student' ? 'role-active' : ''}`} type="button" onClick={() => setForm(f => ({ ...f, role: 'student' }))}>
            <span className="role-emoji">🎓</span> Student
          </button>
          <button className={`role-btn ${form.role === 'educator' ? 'role-active' : ''}`} type="button" onClick={() => setForm(f => ({ ...f, role: 'educator' }))}>
            <span className="role-emoji">📚</span> Educator
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-form-grid">
            <Input label="Display Name" value={form.displayName} onChange={update('displayName')} placeholder="John Doe" error={errors.displayName} />
            <Input label="Username" value={form.username} onChange={update('username')} placeholder="johndoe" error={errors.username} />
          </div>
          <Input label="Email" type="email" value={form.email} onChange={update('email')} placeholder="you@example.com" error={errors.email} />
          <div className="auth-form-grid">
            <Input label="Password" type="password" value={form.password} onChange={update('password')} placeholder="••••••••" error={errors.password} />
            <Input label="Confirm Password" type="password" value={form.confirmPassword} onChange={update('confirmPassword')} placeholder="••••••••" error={errors.confirmPassword} />
          </div>
          {errors.general && <div className="auth-error">{errors.general}</div>}
          <Button type="submit" loading={loading} fullWidth size="lg">Create Account</Button>
        </form>

        <div className="auth-footer">
          <p>Already have an account? <Link to="/login">Sign in</Link></p>
        </div>
      </div>
    </div>
  );
}
