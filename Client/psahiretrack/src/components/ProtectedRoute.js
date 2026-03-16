import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AppLayout from '../layouts/AppLayout'; // ✅ Import the AppLayout we just created

const ProtectedRoute = ({ allowedRoles }) => {
    const { session, isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex h-screen items-center justify-center">Loading session...</div>;
    }

    if (!session?.user) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(session.user.role)) {
        return <Navigate to="/dashboard" replace />;
    }

    // ✅ The ProtectedRoute now renders the AppLayout, which contains the Outlet
    return <AppLayout />;
};

export default ProtectedRoute;