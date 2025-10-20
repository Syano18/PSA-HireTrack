import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';

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

    const handleLogout = async () => {
        await window.electronAPI.clearLoginState();
        setSession(null);
    };

    const handlePasswordChanged = async () => {
        const updatedUser = { ...session.user, force_password_change: 0 };
        const newSessionState = { ...session, user: updatedUser };
        setSession(newSessionState);
        await window.electronAPI.setLoginState(newSessionState);
    };

    const value = {
        session,
        isLoading,
        logout: handleLogout,
        onPasswordChanged: handlePasswordChanged,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to easily access auth context
export const useAuth = () => {
    return useContext(AuthContext);
};