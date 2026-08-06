import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FiPlus, FiX, FiSave } from 'react-icons/fi';
import { FaSort, FaSortUp, FaSortDown, FaPencilAlt, FaTrash } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import ToastContainer from './ToastContainer';
import useToast from '../hooks/useToast';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];

const ManagePositions = ({ session }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const { toasts, showToast, removeToast } = useToast();
    const [positions, setPositions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentPosition, setCurrentPosition] = useState({ id: null, position_title: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [originalPositionData, setOriginalPositionData] = useState(null);

    const [sortConfig, setSortConfig] = useState({ key: 'position_title', direction: 'ascending' });
    
    const [positionToDelete, setPositionToDelete] = useState(null);
    const [nonDeletablePositions, setNonDeletablePositions] = useState(new Set());

    const canManage = useMemo(() => {
        return session && MANAGABLE_ROLES.includes(session.user?.role);
    }, [session]);

    const fetchPositions = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        try {
            const data = await apiFetch('employments/positions', serverIp); // 3. PASS serverIp
            setPositions(data);
            
            // Fetch usage info for each position
            const nonDeletable = new Set();
            for (const position of data) {
                try {
                    const usage = await apiFetch(`employments/positions/${position.id}/usage`, serverIp);
                    if (usage.count > 0) {
                        nonDeletable.add(position.id);
                    }
                } catch (err) {
                    console.warn(`Could not check usage for position ${position.id}:`, err);
                }
            }
            setNonDeletablePositions(nonDeletable);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp, showToast]); // 4. ADD serverIp dependency

    useEffect(() => {
        // 5. UPDATE data fetch trigger
        if (session?.token && !isSettingsLoading) {
            fetchPositions();
        }
    }, [fetchPositions, session?.token, isSettingsLoading]);

    const filteredPositions = useMemo(() => {
        if (!searchQuery) return positions;
        return positions.filter(pos =>
            pos.position_title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [positions, searchQuery]);

    const sortedPositions = useMemo(() => {
        let sortableItems = [...filteredPositions];
        if (sortConfig.key) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredPositions, sortConfig]);



    const requestSort = (key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };



    const handleOpenModal = (position = { id: null, position_title: '' }) => {
        setCurrentPosition(position);
        if (position.id) {
            setOriginalPositionData(position);
        } else {
            setOriginalPositionData(null);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentPosition({ id: null, position_title: '' });
        setOriginalPositionData(null);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const { id, position_title } = currentPosition;
        if (!position_title.trim()) {
            showToast("Position Title cannot be empty.", 'error');
            return;
        }
        if (!canManage) {
            showToast("You do not have permission to save positions.", 'error');
            return;
        }

        const endpoint = id ? `employments/positions/${id}` : 'employments/positions';
        const method = id ? 'PUT' : 'POST';

        try {
            await apiFetch(endpoint, serverIp, { // 3. PASS serverIp
                method,
                body: JSON.stringify({
                    position_title,
                    actingUserId: session.user.id
                }),
            });
            fetchPositions();
            handleCloseModal();
            showToast(id ? 'Position updated successfully.' : 'Position added successfully.', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    const confirmDelete = async () => {
        if (!positionToDelete || !session || !canManage) return;
        try {
            await apiFetch(`employments/positions/${positionToDelete.id}`, serverIp, { // 3. PASS serverIp
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: session.user.id })
            });
            showToast('Position deleted successfully.', 'success');
            fetchPositions();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setPositionToDelete(null);
        }
    };

    const handleDeleteClick = (position) => {
        setPositionToDelete(position);
    };

    const hasChanges = useMemo(() => {
        if (!currentPosition.id || !originalPositionData) return false;
        return currentPosition.position_title !== originalPositionData.position_title;
    }, [currentPosition, originalPositionData]);

    const isSaveDisabled = useMemo(() => {
        const { position_title } = currentPosition;
        const requiredFilled = position_title?.trim();

        if (currentPosition.id) {
            return !hasChanges || !requiredFilled;
        }
        return !requiredFilled;
    }, [currentPosition, hasChanges]);

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="mb-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Positions</h1>
                <div className="w-full p-4 space-y-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow animate-pulse">
                    {[...Array(10)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between pt-2">
                            <div className="h-3 bg-gray-300 rounded-full dark:bg-gray-600 w-1/2"></div>
                            <div className="h-4 bg-gray-300 rounded-full dark:bg-gray-700 w-20"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Positions</h1>
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <input
                            type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..."
                            className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200">
                                <FiX className="h-5 w-5" />
                            </button>
                        )}
                    </div>
                    {canManage && (
                        <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600">
                            <FiPlus className="w-5 h-5" />
                            Add Position Title
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-auto bg-white rounded-lg shadow flex-1 min-h-0 dark:bg-gray-800">
                <table className="min-w-full text-sm leading-normal">
                    <thead>
                        <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                            <th className="px-6 py-3.5 font-semibold">
                                <button onClick={() => requestSort('position_title')} className="flex items-center w-full uppercase">
                                    Position Title {getSortIcon('position_title')}
                                </button>
                            </th>
                            {canManage && (
                                <th className="px-6 py-3.5 text-right text-sm font-semibold tracking-wider uppercase">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedPositions.length > 0 ? sortedPositions.map(pos => (
                            <tr key={pos.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                                <td className="px-6 py-4 font-medium text-gray-800 whitespace-nowrap dark:text-gray-200">{pos.position_title}</td>
                                {canManage && (
                                    <td className="px-6 py-4 align-middle">
                                        <div className="flex items-center justify-end space-x-1">
                                            <button onClick={() => handleOpenModal(pos)} title="Edit Position" className="p-1 rounded-lg transition-colors text-blue-600 hover:text-blue-900 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20"><FaPencilAlt className="w-4 h-4" /></button>
                                            {nonDeletablePositions.has(pos.id) ? (
                                                <button disabled title="This position is assigned to employees" className="p-1 rounded-lg transition-colors text-gray-400 cursor-not-allowed opacity-50"><FaTrash className="w-4 h-4" /></button>
                                            ) : (
                                                <button onClick={() => handleDeleteClick(pos)} title="Delete Position" className="p-1 rounded-lg transition-colors text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"><FaTrash className="w-4 h-4" /></button>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={canManage ? 2 : 1} className="py-16 text-center text-gray-500 dark:text-gray-400">
                                    <h3 className="text-lg font-medium">No Records Found</h3>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex justify-end items-center mt-2 px-2 flex-shrink-0">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Total Records: {sortedPositions.length}
                </span>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-md max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentPosition.id ? 'Edit' : 'Add'} Position</h2>
                        </div>
                        <form id="positionForm" onSubmit={handleSave} className="flex-auto p-6 overflow-y-auto">
                            <label htmlFor="position-title-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Position Title*</label>
                            <input
                                id="position-title-input" type="text" value={currentPosition.position_title}
                                onChange={(e) => setCurrentPosition({ ...currentPosition, position_title: e.target.value })}
                                className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                        </form>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                            <button type="button" onClick={handleCloseModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                                <FiX className="w-4 h-4" />Cancel
                            </button>
                            <button 
                                type="submit" 
                                form="positionForm" 
                                disabled={isSaveDisabled}
                                title={isSaveDisabled ? (currentPosition.id ? 'No changes made or missing fields' : 'Please fill all required fields') : 'Save position'}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <FiSave className="w-4 h-4" />Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {positionToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
                        <p className="mt-2 text-gray-600 dark:text-gray-300">
                            Are you sure you want to delete this position? This action cannot be undone.
                        </p>
                        <div className="flex justify-end mt-6 space-x-2">
                            <button onClick={() => setPositionToDelete(null)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}
            <ToastContainer toasts={toasts} onClose={removeToast} />
        </div>
    );
};

export default ManagePositions;
