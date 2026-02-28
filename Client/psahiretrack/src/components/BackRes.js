import React, { useState,useEffect } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';

const BackRes = () => {
    const [feedback, setFeedback] = useState({ message: '', type: 'info' });
    const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
    // 1. Add state for permissions, loading, and errors
    const [canRestore, setCanRestore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // 2. Use your useEffect to fetch the session and set permissions
    useEffect(() => {
        const getSession = async () => {
            try {
                const state = await window.electronAPI.getLoginState();
                if (state && state.user && state.user.role) {
                    const { role } = state.user;
                    // Set the permission based on the user's role
                    setCanRestore(['Super_Admin', 'Admin'].includes(role));
                } else {
                    setError("Authentication failed. Please log in again.");
                }
            } catch (err) {
                setError("Failed to retrieve session data.");
            } finally {
                setIsLoading(false); // Stop loading once done
            }
        };
        getSession();
    }, []);

    const handleBackup = async () => {
        setFeedback({ message: 'Starting encrypted backup... Please wait.', type: 'info' });
        try {
            const result = await window.electronAPI.backupDatabase();
            setFeedback({ message: result.message, type: result.success ? 'success' : 'error' });
        } catch (err) {
            setFeedback({ message: `An unexpected error occurred: ${err.message}`, type: 'error' });
        }
    };

    const confirmRestore = async () => {
        setIsRestoreModalOpen(false);
        setFeedback({ message: 'Starting restore... This may take a moment.', type: 'info' });
        try {
            const result = await window.electronAPI.restoreDatabase();
            if (result.success) {
                setFeedback({ message: "Restore complete. The application will now refresh.", type: 'success' });
                setTimeout(() => window.location.reload(), 2000);
            } else {
                setFeedback({ message: result.message, type: 'error' });
            }
        } catch (err) {
            setFeedback({ message: `An unexpected error occurred: ${err.message}`, type: 'error' });
        }
    };

    const getFeedbackColor = () => {
        switch (feedback.type) {
            case 'success': return 'text-green-600 dark:text-green-400';
            case 'error': return 'text-red-600 dark:text-red-400';
            default: return 'text-gray-600 dark:text-gray-400';
        }
    };

    if (isLoading) {
        return (
            <div className="mt-8 p-6">
                <p className="text-gray-600 dark:text-gray-400">Loading permissions...</p>
            </div>
        );
    }



    return (
        <>
            <div className="mt-8 p-6 border-t dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Database Management</h2>
                <div className="flex flex-col sm:flex-row gap-4">
                    <button onClick={handleBackup} className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700">
                        Backup Database
                    </button>
                {canRestore && (
                    <button onClick={() => setIsRestoreModalOpen(true)} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-lg shadow-md hover:bg-red-700">
                        Restore from Backup
                    </button>
                )}
                </div>
                {feedback.message && (
                    <p className={`mt-4 text-sm font-medium ${getFeedbackColor()}`}>
                        {feedback.message}
                    </p>
                )}
            </div>

            {isRestoreModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Restore</h2>
                        <p className="mt-2 text-red-600 dark:text-red-400">
                            <strong>WARNING:</strong> This will overwrite the current database. This action cannot be undone.
                        </p>
                        <div className="flex justify-end mt-6 space-x-2">
                            <button onClick={() => setIsRestoreModalOpen(false)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                            <button onClick={confirmRestore} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700">Yes, Restore</button>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-70">
                    <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-gray-800">
                        <div className="text-center">
                            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full dark:bg-red-900/50">
                                <FaExclamationTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                            </div>
                            <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Error</h3>
                            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{error}</div>
                        </div>
                        <div className="mt-5">
                            <button type="button" onClick={() => setError(null)} className="inline-flex justify-center w-full px-4 py-2 text-base font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">OK</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default BackRes;