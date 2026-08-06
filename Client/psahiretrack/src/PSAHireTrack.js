import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';
import { ClerkProvider } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

// --- Page & Layout Imports ---
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Employments from './pages/Employments';
import Trainings from './pages/Trainings';
import Accounts from './pages/Accounts';
import Applicants from './pages/Applicants';
import Assessment from './pages/Assessment';
import Certificates from './pages/Certificates';
import Utilities from './pages/Utilities';
import TempTrainingCertificates from './pages/TempTrainingCertificates';
import AppLayout from './layouts/AppLayout';
import Interview from './pages/Interview';

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


// --- Main App Component ---
const App = () => {
    // This component is now very simple and only defines the routes.
    // All loading and auth logic is handled by the wrappers above.
    return (
        <Routes>
            <Route path="/login" element={<LoginPageWrapper />} />

            <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="employees" element={<Employees />} />
                <Route path="employments" element={<Employments />} />
                <Route path="trainings" element={<Trainings />} />
                <Route path="temp-certificates" element={<TempTrainingCertificates />} />
                <Route path="certificates" element={<Certificates />} />
            </Route>
            
            <Route element={<ProtectedRoute allowedRoles={ADMIN_ROLES} />}>
                <Route path="accounts" element={<Accounts />} />
                <Route path="utilities" element={<Utilities />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['Super_Admin']} />}>
                <Route path="assessment" element={<Assessment />} />
                <Route path="interview" element={<Interview />} />
                <Route path="applicants" element={<Applicants />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
};

const ClerkWithRoutes = ({ children }) => {
    const navigate = useNavigate();
    return (
        <ClerkProvider 
            publishableKey={process.env.REACT_APP_CLERK_PUBLISHABLE_KEY} 
            telemetry={false}
            navigate={(to) => navigate(to)}
        >
            {children}
        </ClerkProvider>
    );
};

// --- Final Exported Component ---
// This is what you import in index.js
const PSAHireTrack = () => {
    return (
        <Router>
            <ClerkWithRoutes>
                <ThemeProvider>
                    <SettingsProvider>
                        <AuthProvider>
                            <App />
                        </AuthProvider>
                    </SettingsProvider>
                </ThemeProvider>
            </ClerkWithRoutes>
        </Router>
    );
};

export default PSAHireTrack;
