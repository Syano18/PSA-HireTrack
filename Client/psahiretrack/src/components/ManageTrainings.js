import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { FiPlus, FiX, FiSave } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaPencilAlt, FaTrash } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import ToastContainer from './ToastContainer';
import useToast from '../hooks/useToast';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];
const INITIAL_FORM_STATE = { id: null, title: '', start_date: '', end_date: '', hours: '', venue: '' };

const ManageTrainings = ({ session }) => {
    const location = useLocation();
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const { toasts, showToast, removeToast } = useToast();
    const [titles, setTitles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentTraining, setCurrentTraining] = useState(INITIAL_FORM_STATE);
    const [searchQuery, setSearchQuery] = useState('');
    const [originalTrainingData, setOriginalTrainingData] = useState(null);

    useEffect(() => {
        if (location.state?.filterSurvey && location.state?.filterPosition) {
            setCurrentTraining(prev => ({
                ...prev,
                title: `${location.state.filterSurvey} - ${location.state.filterPosition}`
            }));
            setIsModalOpen(true);
        }
    }, [location.state]);

    const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'ascending' });
    const [titleToDelete, setTitleToDelete] = useState(null);
    const [nonDeletableTitles, setNonDeletableTitles] = useState(new Set());

    const canManage = useMemo(() => {
        return session && MANAGABLE_ROLES.includes(session.user?.role);
    }, [session]);

    const fetchTitles = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        try {
            const data = await apiFetch('trainings/titles', serverIp); // 3. PASS serverIp
            setTitles(data);
            
            // Fetch usage info for each title
            const nonDeletable = new Set();
            for (const title of data) {
                try {
                    const usage = await apiFetch(`trainings/titles/${title.id}/usage`, serverIp);
                    if (usage.count > 0) {
                        nonDeletable.add(title.id);
                    }
                } catch (err) {
                    console.warn(`Could not check usage for title ${title.id}:`, err);
                }
            }
            setNonDeletableTitles(nonDeletable);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp, showToast]); // 4. ADD serverIp dependency

    useEffect(() => {
        // 5. UPDATE data fetch trigger
        if (session?.token && !isSettingsLoading) {
            fetchTitles();
        }
    }, [fetchTitles, session?.token, isSettingsLoading]);

    const filteredTitles = useMemo(() => {
        if (!searchQuery) return titles;
        return titles.filter(title =>
            title.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [titles, searchQuery]);



    const sortedTitles = useMemo(() => {
        let sortableItems = [...filteredTitles];
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
    }, [filteredTitles, sortConfig]);

    const requestSort = (key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };

    const handleOpenModal = (training = INITIAL_FORM_STATE) => {
        const formatForInput = (dateString) => {
            if (!dateString) return '';
            try {
                return format(parseISO(dateString), 'yyyy-MM-dd');
            } catch (error) {
                return '';
            }
        };
        
        const formattedTraining = {
            ...training,
            start_date: formatForInput(training.start_date),
            end_date: formatForInput(training.end_date)
        };
        setCurrentTraining(formattedTraining);

        if (training.id) {
            setOriginalTrainingData(formattedTraining);
        } else {
            setOriginalTrainingData(null);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setCurrentTraining(INITIAL_FORM_STATE);
        setOriginalTrainingData(null);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!currentTraining.title.trim()) {
            showToast("Title cannot be empty.", 'error');
            return;
        }
        if (!canManage) {
            showToast("You do not have permission.", 'error');
            return;
        }

        const endpoint = currentTraining.id ? `trainings/titles/${currentTraining.id}` : 'trainings/titles';
        const method = currentTraining.id ? 'PUT' : 'POST';

        try {
            await apiFetch(endpoint, serverIp, { // 3. PASS serverIp
                method,
                body: JSON.stringify({ ...currentTraining, actingUserId: session.user.id }),
            });
            fetchTitles();
            handleCloseModal();
            showToast(currentTraining.id ? 'Training title updated successfully.' : 'Training title added successfully.', 'success');
        } catch (err) {
            try {
                const parsedError = JSON.parse(err.message);
                showToast(parsedError.error || parsedError.message || "An unknown error occurred.", 'error');
            } catch (e) {
                showToast(err.message, 'error');
            }
        }
    };

    const confirmDelete = async () => {
        if (!titleToDelete || !session || !canManage) return;
        try {
            await apiFetch(`trainings/titles/${titleToDelete.id}`, serverIp, { // 3. PASS serverIp
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: session.user.id })
            });
            showToast('Training title deleted successfully.', 'success');
            fetchTitles();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setTitleToDelete(null);
        }
    };

    const handleDeleteClick = (title) => {
        setTitleToDelete(title);
    };

    const hasChanges = useMemo(() => {
        if (!currentTraining.id || !originalTrainingData) return false;
        
        return (
            currentTraining.title !== originalTrainingData.title ||
            currentTraining.start_date !== originalTrainingData.start_date ||
            currentTraining.end_date !== originalTrainingData.end_date ||
            String(currentTraining.hours) !== String(originalTrainingData.hours) ||
            currentTraining.venue !== originalTrainingData.venue
        );
    }, [currentTraining, originalTrainingData]);

    const isSaveDisabled = useMemo(() => {
        const { title, start_date, end_date, hours, venue } = currentTraining;
        const requiredFilled = title?.trim() && start_date && end_date && hours && venue?.trim();

        if (currentTraining.id) {
            return !hasChanges || !requiredFilled;
        }
        
        return !requiredFilled;
    }, [currentTraining, hasChanges]);

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="mb-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Training Titles</h1>
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
            <ToastContainer toasts={toasts} onClose={removeToast} />
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Training Titles</h1>
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
                            Add Training Title
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-auto bg-white rounded-lg shadow flex-1 min-h-0 dark:bg-gray-800">
                <table className="min-w-full text-sm leading-normal">
                    <thead>
                        <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                            <th className="px-5 py-3.5 text-left w-[300px]">
                                <button onClick={() => requestSort('title')} className="flex items-center w-full uppercase">
                                    Title {getSortIcon('title')}
                                </button>
                            </th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('start_date')} className="flex items-center w-full uppercase">Training Start Date {getSortIcon('start_date')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('end_date')} className="flex items-center w-full uppercase">Training End Date {getSortIcon('end_date')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('hours')} className="flex items-center w-full uppercase">Duration {getSortIcon('hours')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('venue')} className="flex items-center w-full uppercase">Venue {getSortIcon('venue')}</button></th>
                            {canManage && (
                                <th className="px-6 py-3.5 text-center text-sm font-semibold tracking-wider uppercase">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedTitles.length > 0 ? sortedTitles.map(title => (
                            <tr key={title.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                                <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{title.title}</td>
                                <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{title.start_date ? format(parseISO(title.start_date), 'MM/dd/yyyy') : ''}</td>
                                <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{title.end_date ? format(parseISO(title.end_date), 'MM/dd/yyyy') : ''}</td>
                                <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{title.hours}</td>
                                <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{title.venue}</td>
                                {canManage && (
                                    <td className="px-6 py-4 align-middle">
                                        <div className="flex items-center justify-center space-x-1">
                                            <button onClick={() => handleOpenModal(title)} title="Edit Training Title" className="p-1 rounded-lg transition-colors text-blue-600 hover:text-blue-900 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20"><FaPencilAlt className="w-4 h-4" /></button>
                                            {nonDeletableTitles.has(title.id) ? (
                                                <button disabled title="This training title is assigned to employees" className="p-1 rounded-lg transition-colors text-gray-400 cursor-not-allowed opacity-50"><FaTrash className="w-4 h-4" /></button>
                                            ) : (
                                                <button onClick={() => handleDeleteClick(title)} title="Delete Training Title" className="p-1 rounded-lg transition-colors text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"><FaTrash className="w-4 h-4" /></button>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={canManage ? 6 : 1} className="py-16 text-center text-gray-500 dark:text-gray-400">
                                    <h3 className="text-lg font-medium">No Records Found</h3>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex justify-end items-center mt-2 px-2 flex-shrink-0">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Total Records: {sortedTitles.length}
                </span>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-md max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentTraining.id ? 'Edit' : 'Add'} Training Title</h2>
                        </div>
                        <form id="titleForm" onSubmit={handleSave} className="flex-auto p-6 overflow-y-auto space-y-4">
                            <div>
                                <label htmlFor="title-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Training Title*</label>
                                <textarea
                                    id="title-input"
                                    value={currentTraining.title}
                                    onChange={(e) => setCurrentTraining({ ...currentTraining, title: e.target.value })}
                                    className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    rows="3"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Training Start Date*</label>
                                    <input type="date" value={currentTraining.start_date} onChange={(e) => setCurrentTraining({ ...currentTraining, start_date: e.target.value })} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Training End Date*</label>
                                    <input type="date" value={currentTraining.end_date} onChange={(e) => setCurrentTraining({ ...currentTraining, end_date: e.target.value })} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Duration (hours)*</label>
                                <input type="number" value={currentTraining.hours} onChange={(e) => setCurrentTraining({ ...currentTraining, hours: e.target.value })} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Venue*</label>
                                <textarea type="text" value={currentTraining.venue} onChange={(e) => setCurrentTraining({ ...currentTraining, venue: e.target.value })} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                        </form>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <button type="button" onClick={handleCloseModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                            <button 
                                type="submit" 
                                form="titleForm" 
                                disabled={isSaveDisabled}
                                title={isSaveDisabled ? (currentTraining.id ? 'No changes made or missing fields' : 'Please fill all required fields') : 'Save training title'}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <FiSave className="w-4 h-4" />Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {titleToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
                        <p className="mt-2 text-gray-600 dark:text-gray-300">
                            Are you sure you want to delete this title? This action cannot be undone.
                        </p>
                        <div className="flex justify-end mt-6 space-x-2">
                            <button onClick={() => setTitleToDelete(null)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700">Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ManageTrainings;
