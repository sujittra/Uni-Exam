import React, { useState } from 'react';
import { User, UserRole } from './types';
import { Login } from './pages/Login';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { StudentExam } from './pages/StudentExam';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
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