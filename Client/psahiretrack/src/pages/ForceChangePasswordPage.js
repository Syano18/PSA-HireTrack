import React, { useState } from 'react';
import PSALogo from '../assets/logo.png';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const ForceChangePasswordPage = ({ user, onPasswordChanged, onLogout }) => {
  const { serverIp } = useSettings(); // 2. USE THE HOOK
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setIsChanging(true);

    try {
      // 3. PASS serverIp to the apiFetch call
      await apiFetch(`users/${user.id}/change-password`, serverIp, {
        method: 'PUT',
        body: JSON.stringify({ newPassword }),
        });
      
      onPasswordChanged();
    } catch (err) {
      console.error('Password change error:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-800">
      <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-700 rounded-2xl shadow-lg">
        <div className="text-center">
          <img src={PSALogo} alt="PSA Logo" className="w-16 h-16 mx-auto" />
          <h2 className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">
            Change Your Password
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            For your security, you must change your temporary password before you can proceed.
          </p>
        </div>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="text-center p-3 bg-red-100 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-600 dark:border-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-gray-600 dark:border-gray-500"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isChanging}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isChanging ? 'Saving...' : 'Set New Password'}
            </button>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForceChangePasswordPage;