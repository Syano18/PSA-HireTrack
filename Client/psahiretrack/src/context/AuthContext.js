import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const checkSession = useCallback(async () => {
        try {
            const savedState = await window.electronAPI.getLoginState();
            setSession(savedState && savedState.user ? savedState : null);
        } catch (error) {
            console.error("Failed to get session state:", error);
            setSession(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        checkSession();
        const removeListener = window.electronAPI.onLoginStateChange(checkSession);
        return () => removeListener();
    }, [checkSession]);

    const { signOut } = useClerkAuth();

    const handleLogout = async () => {
        await window.electronAPI.clearLoginState();
        // Fire and forget signOut so it clears tokens, but immediately reboot before it can hijack the URL
        signOut().catch(() => {});
        window.electronAPI.restartApp();
    };

    const value = {
        session,
        isLoading,
        logout: handleLogout,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to easily access auth context
export const useAuth = () => {
    return useContext(AuthContext);
};