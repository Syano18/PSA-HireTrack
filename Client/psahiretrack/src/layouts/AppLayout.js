import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // Import useTheme

// Import your existing components
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';

const AppLayout = () => {
    // Get session data and theme data directly from their respective hooks
    const { session, logout } = useAuth();
    const { isDarkMode, setIsDarkMode } = useTheme();

    return (
        <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <Sidebar 
                onLogout={logout} 
                user={session.user}
                isDarkMode={isDarkMode}
                setIsDarkMode={setIsDarkMode} 
            />
            <div className="flex-1 flex flex-col min-w-0">
                <Header user={session.user} />
                <main className="flex-1 px-4 pb-4 pt-2 flex flex-col min-h-0">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AppLayout;