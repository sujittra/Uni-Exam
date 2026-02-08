import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { loginStudent, loginTeacher, registerTeacher } from '../services/dataService';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [role, setRole] = useState<UserRole | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Form State
  const [identifier, setIdentifier] = useState(''); // StudentID or Teacher Name
  const [password, setPassword] = useState(''); // Only for teacher
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setIdentifier('');
    setPassword('');
    setError('');
    setSuccessMsg('');
    setIsRegistering(false);
  };

  const handleRoleSelect = (selectedRole: UserRole) => {
    setRole(selectedRole);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    
    try {
      if (role === UserRole.STUDENT) {
        const user = await loginStudent(identifier);
        if (user) onLogin(user);
        else setError('Student ID not found. Please contact your instructor.');
      } 
      else if (role === UserRole.TEACHER) {
        if (isRegistering) {
            await registerTeacher(identifier, password);
            setSuccessMsg('Registration successful! Please login.');
            setIsRegistering(false);
            setPassword('');
        } else {
            const user = await loginTeacher(identifier, password);
            if (user) onLogin(user);
            else setError('Invalid credentials.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'System error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-purple-50 p-4">
      <Card className="w-full max-w-md shadow-2xl border-t-8 border-t-purple-600 relative">
        <div className="text-center mb-8 pt-4">
          <h1 className="text-3xl font-extrabold text-purple-900 tracking-tight">UniExam Pro</h1>
          <p className="text-purple-400 font-medium">Secure Examination Portal</p>
        </div>

        {!role ? (
          <div className="space-y-4 animate-fade-in">
            <p className="text-center text-gray-500 mb-6">Please select your role to continue</p>
            
            <button 
              onClick={() => handleRoleSelect(UserRole.STUDENT)}
              className="w-full p-6 rounded-xl border-2 border-purple-100 hover:border-purple-500 bg-white hover:bg-purple-50 transition-all group text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xl group-hover:bg-purple-600 group-hover:text-white transition-colors">
                🎓
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-lg group-hover:text-purple-700">Student Login</h3>
                <p className="text-sm text-gray-400">Enter with your Student ID</p>
              </div>
            </button>

            <button 
              onClick={() => handleRoleSelect(UserRole.TEACHER)}
              className="w-full p-6 rounded-xl border-2 border-purple-100 hover:border-purple-500 bg-white hover:bg-purple-50 transition-all group text-left flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xl group-hover:bg-purple-600 group-hover:text-white transition-colors">
                👨‍🏫
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-lg group-hover:text-purple-700">Teacher Portal</h3>
                <p className="text-sm text-gray-400">Manage exams and students</p>
              </div>
            </button>
          </div>
        ) : (
          <div className="animate-fade-in">
             <button 
               onClick={() => setRole(null)} 
               className="mb-6 text-sm text-gray-400 hover:text-purple-600 flex items-center gap-1 transition-colors"
             >
               &larr; Back to Role Selection
             </button>

             <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
               {role === UserRole.STUDENT ? '🎓 Student Login' : '👨‍🏫 Teacher Access'}
             </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {role === UserRole.TEACHER ? 'Username' : 'Student ID'}
                </label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                  placeholder={role === UserRole.TEACHER ? 'Enter username' : 'Enter your Student ID'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>

              {role === UserRole.TEACHER && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 rounded">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}
              {successMsg && (
                <div className="bg-green-50 border-l-4 border-green-500 p-3 rounded">
                  <p className="text-green-700 text-sm">{successMsg}</p>
                </div>
              )}

              <Button type="submit" className="w-full py-3 text-lg shadow-purple-200" disabled={loading}>
                {loading ? 'Authenticating...' : (isRegistering ? 'Create Account' : 'Sign In')}
              </Button>

              {role === UserRole.TEACHER && (
                  <div className="text-center pt-2">
                      <button 
                        type="button" 
                        onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccessMsg(''); }}
                        className="text-sm font-medium text-purple-600 hover:text-purple-800 transition-colors"
                      >
                          {isRegistering ? 'Back to Login' : 'New Teacher? Register Here'}
                      </button>
                  </div>
              )}
            </form>
          </div>
        )}
        
        <div className="mt-8 text-center border-t border-purple-50 pt-4">
          <p className="text-xs text-purple-300 font-medium">Powered by UniExam Secure Engine</p>
        </div>
      </Card>
    </div>
  );
};