import React, { useState,useEffect } from 'react';
import ToastContainer from './ToastContainer';
import useToast from '../hooks/useToast';

const BackRes = () => {
    const { toasts, showToast, removeToast } = useToast();
    const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
    // 1. Add state for permissions, loading, and errors
    const [canRestore, setCanRestore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // 2. Use your useEffect to fetch the session and set permissions
    useEffect(() => {
        const getSession = async () => {
            try {
                const state = (JSON.parse(localStorage.getItem('auth_session')) || null);
                if (state && state.user && state.user.role) {
                    const { role } = state.user;
                    // Set the permission based on the user's role
                    setCanRestore(['Super_Admin', 'Admin'].includes(role));
                } else {
                    showToast("Authentication failed. Please log in again.", 'error');
                }
            } catch (err) {
                showToast("Failed to retrieve session data.", 'error');
            } finally {
                setIsLoading(false); // Stop loading once done
            }
        };
        getSession();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleBackup = async () => {
        showToast('Database backup is managed by the server administrator in the browser deployment.', 'info');
    };

    const confirmRestore = async () => {
        setIsRestoreModalOpen(false);
        showToast('Database restore is managed by the server administrator in the browser deployment.', 'info');
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
                    <button onClick={handleBackup} className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600">
                        Backup Database
                    </button>
                {canRestore && (
                    <button onClick={() => setIsRestoreModalOpen(true)} title="Restore database from backup file (Super Admin / Admin only)" className="px-4 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600">
                        Restore from Backup
                    </button>
                )}
                </div>
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
            <ToastContainer toasts={toasts} onClose={removeToast} />
        </>
    );
};

export default BackRes;
