import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';

// --- Page & Layout Imports ---
import LoginPage from './pages/LoginPage';
import ForceChangePasswordPage from './pages/ForceChangePasswordPage';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Employments from './pages/Employments';
import Trainings from './pages/Trainings';
import Accounts from './pages/Accounts';
import Certificates from './pages/Certificates';
import Utilities from './pages/Utilities';
import AppLayout from './layouts/AppLayout';

// --- Role Constants ---
const ADMIN_ROLES = ['Super_Admin', 'Admin', 'PACD'];

// --- Wrapper & Route Components ---

const ProtectedRoute = ({ allowedRoles }) => {
    const { session, isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex h-screen items-center justify-center dark:bg-gray-900 dark:text-white">Loading session...</div>;
    }

    if (!session?.user) {
        return <Navigate to="/login" replace />;
    }
    
    if (session.user.force_password_change) {
        return <Navigate to="/force-change-password" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(session.user.role)) {
        return <Navigate to="/dashboard" replace />;
    }

    return <AppLayout />;
};

const LoginPageWrapper = () => {
    const { session, isLoading } = useAuth();
    if (isLoading) {
        return <div className="flex h-screen items-center justify-center dark:bg-gray-900 dark:text-white">Loading...</div>;
    }
    return session ? <Navigate to="/dashboard" /> : <LoginPage />;
};

const ForceChangePasswordWrapper = () => {
    const { session, isLoading, onPasswordChanged, logout } = useAuth();
    if (isLoading) {
        return <div className="flex h-screen items-center justify-center dark:bg-gray-900 dark:text-white">Loading...</div>;
    }
    if (!session?.user?.force_password_change) {
        return <Navigate to="/dashboard" />;
    }
    return <ForceChangePasswordPage user={session.user} onPasswordChanged={onPasswordChanged} onLogout={logout} />;
};


// --- Main App Component ---
const App = () => {
    // This component is now very simple and only defines the routes.
    // All loading and auth logic is handled by the wrappers above.
    return (
        <Routes>
            <Route path="/login" element={<LoginPageWrapper />} />
            <Route path="/force-change-password" element={<ForceChangePasswordWrapper />} />

            <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="employees" element={<Employees />} />
                <Route path="employments" element={<Employments />} />
                <Route path="trainings" element={<Trainings />} />
            </Route>
            
            <Route element={<ProtectedRoute allowedRoles={ADMIN_ROLES} />}>
                <Route path="accounts" element={<Accounts />} />
                <Route path="certificates" element={<Certificates />} />
                <Route path="utilities" element={<Utilities />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
};

// --- Final Exported Component ---
// This is what you import in index.js
const PSAHireTrack = () => {
    return (
        <Router>
            <ThemeProvider>
                <SettingsProvider>
                    <AuthProvider>
                        <App />
                    </AuthProvider>
                </SettingsProvider>
            </ThemeProvider>
        </Router>
    );
};

export default PSAHireTrack;