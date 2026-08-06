import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const checkSession = useCallback(async () => {
        try {
            const savedState = localStorage.getItem('loginState');
            const parsedState = savedState ? JSON.parse(savedState) : null;
            setSession(parsedState && parsedState.user ? parsedState : null);
        } catch (error) {
            console.error("Failed to get session state:", error);
            setSession(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
        
        // Listen for storage events (cross-tab sync)
        const handleStorageChange = (e) => {
            if (e.key === 'loginState') {
                checkSession();
            }
        };
        window.addEventListener('storage', handleStorageChange);
        
        return () => window.removeEventListener('storage', handleStorageChange);
    }, [checkSession]);

    const setLoginState = (data) => {
        localStorage.setItem('loginState', JSON.stringify(data));
        setSession(data);
    };

    const { signOut } = useClerkAuth();

    const handleLogout = async () => {
        localStorage.removeItem('loginState');
        try { await signOut(); } catch (e) {}
        window.location.reload();
    };

    const value = {
        session,
        isLoading,
        logout: handleLogout,
        setLoginState,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to easily access auth context
export const useAuth = () => {
    return useContext(AuthContext);
};
