import React, { createContext, useState, useEffect, useContext } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";

// TODO: Replace with your actual Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCMoofIzlep61HniypQb3x1Hd1a2adwNhg",
  authDomain: "logbook-cred.firebaseapp.com",
  projectId: "logbook-cred",
  storageBucket: "logbook-cred.firebasestorage.app",
  messagingSenderId: "602025460910",
  appId: "1:602025460910:web:2a9f3ed064cf367d17d93f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [session, setSession] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    // Helper to fetch user details (Role & Status) from Google Sheet
    const fetchUserDetails = async (email) => {
        try {
            // Call the secure handler in main.js
            const result = await window.electronAPI.fetchUserDetails(email);
            return result;
        } catch (error) {
            console.error("Failed to fetch details via Electron:", error);
            return { role: 'User', status: 'Active' };
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                // User is signed in.
                const token = await firebaseUser.getIdToken();
                const { role, status } = await fetchUserDetails(firebaseUser.email);

                if (status === 'Inactive') {
                    await signOut(auth);
                    setSession(null);
                    window.electronAPI.clearLoginState();
                } else {
                    const user = {
                        id: firebaseUser.uid,
                        email: firebaseUser.email,
                        username: firebaseUser.email, // Map email to username for compatibility
                        role: role
                    };
                    const sessionData = { user, token };
                    setSession(sessionData);
                    window.electronAPI.setLoginState(sessionData);
                }
            } else {
                setSession(null);
                window.electronAPI.clearLoginState();
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const login = async (email, password) => {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            
            // Check status immediately upon login attempt for better UX
            const { status } = await fetchUserDetails(userCredential.user.email);
            
            if (status === 'Inactive') {
                await signOut(auth);
                return { error: 'Account is Inactive. Please contact your administrator.' };
            }

            return { success: true };
        } catch (error) {
            let errorMessage = error.message;
            if (error.code === 'auth/invalid-credential') {
                errorMessage = 'Invalid email or password.';
            } else if (error.code === 'auth/user-disabled') {
                errorMessage = 'Account is disabled.';
            }
            return { error: errorMessage };
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed", error);
        }
    };

    const value = {
        session,
        isLoading,
        login,
        logout,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Custom hook to easily access auth context
export const useAuth = () => {
    return useContext(AuthContext);
};