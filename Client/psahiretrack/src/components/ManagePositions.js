import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { FaSort, FaSortUp, FaSortDown, FaExclamationTriangle } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];

const ManagePositions = ({ session }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const [positions, setPositions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentPosition, setCurrentPosition] = useState({ id: null, position_title: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 10;
    const [sortConfig, setSortConfig] = useState({ key: 'position_title', direction: 'ascending' });
    
    const [positionToDelete, setPositionToDelete] = useState(null);

    const canManage = useMemo(() => {
        return session && MANAGABLE_ROLES.includes(session.user?.role);
    }, [session]);

    const fetchPositions = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        setError(null);
        try {
            const data = await apiFetch('employments/positions', serverIp); // 3. PASS serverIp
            setPositions(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp]); // 4. ADD serverIp dependency

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

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, sortConfig]);

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

    const totalPages = Math.ceil(sortedPositions.length / rowsPerPage);
    const paginatedPositions = useMemo(() => {
        const startIndex = (currentPage - 1) * rowsPerPage;
        return sortedPositions.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedPositions, currentPage]);

    const requestSort = (key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };

    const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
    const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

    const handleOpenModal = (position = { id: null, position_title: '' }) => {
        setCurrentPosition(position);
        setIsModalOpen(true);
        setError(null);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentPosition({ id: null, position_title: '' });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const { id, position_title } = currentPosition;
        if (!position_title.trim()) {
            setError("Position Title cannot be empty.");
            return;
        }
        if (!canManage) {
            setError("You do not have permission to save positions.");
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
            setSuccessMessage(id ? 'Position updated successfully.' : 'Position added successfully.');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err.message);
        }
    };

    const confirmDelete = async () => {
        if (!positionToDelete || !session || !canManage) return;
        try {
            await apiFetch(`employments/positions/${positionToDelete.id}`, serverIp, { // 3. PASS serverIp
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: session.user.id })
            });
            setSuccessMessage('Position deleted successfully.');
            setTimeout(() => setSuccessMessage(null), 3000);
            fetchPositions();
        } catch (err) {
            setError(err.message);
        } finally {
            setPositionToDelete(null);
        }
    };

    const handleDeleteClick = (position) => {
        setError(null);
        setPositionToDelete(position);
    };

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Positions</h1>
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
        <div>
            {successMessage && (
                <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
                    <span>✓</span> {successMessage}
                </div>
            )}
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Positions</h1>
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
                        <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                            <FiPlus />
                            Add New Position Title
                        </button>
                    )}
                </div>
            </div>

            {error && !isModalOpen && !positionToDelete && (
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

            <div className="overflow-x-auto bg-white h-[680px] rounded-lg shadow dark:bg-gray-800">
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
                        {paginatedPositions.length > 0 ? paginatedPositions.map(pos => (
                            <tr key={pos.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                                <td className="px-6 py-4 font-medium text-gray-800 whitespace-nowrap dark:text-gray-200">{pos.position_title}</td>
                                {canManage && (
                                    <td className="px-6 py-4 flex items-center justify-end space-x-3">
                                        <button onClick={() => handleOpenModal(pos)} className="font-medium text-blue-600 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Edit</button>
                                        <button onClick={() => handleDeleteClick(pos)} className="font-medium text-red-600 transition-colors hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>
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

            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-1">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Showing {Math.min((currentPage - 1) * rowsPerPage + 1, sortedPositions.length)} to {Math.min(currentPage * rowsPerPage, sortedPositions.length)} of {sortedPositions.length} records
                    </span>
                    <div className="flex items-center space-x-2">
                        <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Previous</button>
                        <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
                        <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Next</button>
                    </div>
                </div>
            )}

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-md max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentPosition.id ? 'Edit' : 'Add'} Position</h2>
                        </div>
                        <form id="positionForm" onSubmit={handleSave} className="flex-auto p-6 overflow-y-auto">
                            {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
                            <label htmlFor="position-title-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Position Title*</label>
                            <input
                                id="position-title-input" type="text" value={currentPosition.position_title}
                                onChange={(e) => setCurrentPosition({ ...currentPosition, position_title: e.target.value })}
                                className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500"
                                required
                            />
                        </form>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <button type="button" onClick={handleCloseModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 transition-colors">Cancel</button>
                            <button type="submit" form="positionForm" className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 transition-colors">Save</button>
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
        </div>
    );
};

export default ManagePositions;