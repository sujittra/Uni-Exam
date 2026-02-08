import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { loginStudent, loginTeacher, registerTeacher } from '../services/dataService';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [role, setRole] = useState<UserRole>(UserRole.STUDENT);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    
    try {
      if (role === UserRole.STUDENT) {
        const user = await loginStudent(identifier);
        if (user) onLogin(user);
        else setError('Student ID not found in roster. Please ask your teacher to import your data.');
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
            else setError('Invalid username or password.');
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
      <Card className="w-full max-w-md shadow-2xl border-t-4 border-t-purple-600">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-purple-900 mb-2">UniExam Pro</h1>
          <p className="text-gray-500">Secure Examination Portal</p>
        </div>

        <div className="flex bg-purple-100 p-1 rounded-lg mb-6">
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${role === UserRole.STUDENT ? 'bg-white text-purple-700 shadow-sm' : 'text-purple-400 hover:text-purple-600'}`}
            onClick={() => { setRole(UserRole.STUDENT); resetForm(); }}
          >
            Student
          </button>
          <button
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${role === UserRole.TEACHER ? 'bg-white text-purple-700 shadow-sm' : 'text-purple-400 hover:text-purple-600'}`}
            onClick={() => { setRole(UserRole.TEACHER); resetForm(); }}
          >
            Teacher
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {role === UserRole.TEACHER ? 'Username' : 'Student ID'}
            </label>
            <input
              type="text"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
              placeholder={role === UserRole.TEACHER ? 'Enter username' : 'Enter your Student ID'}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          {role === UserRole.TEACHER && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          )}

          {error && <p className="text-red-500 text-sm text-center bg-red-50 p-2 rounded border border-red-100">{error}</p>}
          {successMsg && <p className="text-green-600 text-sm text-center bg-green-50 p-2 rounded border border-green-100">{successMsg}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Processing...' : (isRegistering ? 'Register Account' : 'Login')}
          </Button>

          {role === UserRole.TEACHER && (
              <div className="text-center pt-2">
                  <button 
                    type="button" 
                    onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccessMsg(''); }}
                    className="text-sm text-purple-600 hover:underline"
                  >
                      {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
                  </button>
              </div>
          )}
        </form>
        
        <div className="mt-6 text-center text-xs text-gray-400">
          <p>Protected by Supabase Integration</p>
        </div>
      </Card>
    </div>
  );
};