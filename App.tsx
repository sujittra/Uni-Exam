import React, { useState } from 'react';
import { User, UserRole } from './types';
import { loadSession, saveSession, clearSession } from './services/session';
import { Login } from './pages/Login';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { StudentExam } from './pages/StudentExam';

const App: React.FC = () => {
  // Seeded from sessionStorage so a refresh doesn't drop the user back on the login screen.
  // Tab-scoped: closing the tab or the browser still signs them out.
  const [currentUser, setCurrentUser] = useState<User | null>(loadSession);

  const handleLogin = (user: User) => {
    saveSession(user);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
  };

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  if (currentUser.role === UserRole.TEACHER) {
    return <TeacherDashboard user={currentUser} onLogout={handleLogout} />;
  }

  if (currentUser.role === UserRole.STUDENT) {
    return <StudentExam user={currentUser} onLogout={handleLogout} />;
  }

  return <div>Error: Unknown Role</div>;
};

export default App;
