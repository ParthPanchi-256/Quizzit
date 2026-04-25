import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { ToastProvider } from './components/ui/Toast';
import Navbar from './components/layout/Navbar';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import Dashboard from './pages/Dashboard';
import QuizBuilder from './pages/QuizBuilder';
import AIQuizGenerator from './pages/AIQuizGenerator';
import HostRoom from './pages/HostRoom';
import JoinRoom from './pages/JoinRoom';
import Lobby from './pages/Lobby';
import LiveQuiz from './pages/LiveQuiz';
import Results from './pages/Results';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<><Navbar /><Landing /></>} />
      <Route path="/login" element={<><Navbar /><Login /></>} />
      <Route path="/register" element={<><Navbar /><Register /></>} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      <Route path="/dashboard" element={<ProtectedRoute><Navbar /><Dashboard /></ProtectedRoute>} />

      <Route path="/quiz/ai-generate" element={<ProtectedRoute roles={['educator']}><Navbar /><AIQuizGenerator /></ProtectedRoute>} />
      <Route path="/quiz/:id/edit" element={<ProtectedRoute roles={['educator']}><Navbar /><QuizBuilder /></ProtectedRoute>} />
      <Route path="/quiz/:id/host" element={<ProtectedRoute roles={['educator']}><Navbar /><HostRoom /></ProtectedRoute>} />

      <Route path="/join" element={<ProtectedRoute><Navbar /><JoinRoom /></ProtectedRoute>} />

      {/* Room pages — no Navbar for immersive experience */}
      <Route path="/room/:code/lobby" element={<ProtectedRoute><Lobby /></ProtectedRoute>} />
      <Route path="/room/:code/host" element={<ProtectedRoute roles={['educator']}><Lobby /></ProtectedRoute>} />
      <Route path="/room/:code/play" element={<ProtectedRoute><LiveQuiz /></ProtectedRoute>} />
      <Route path="/room/:code/results" element={<ProtectedRoute><Results /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
