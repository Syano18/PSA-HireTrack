import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FiX } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const actionBadgeStyles = {
    CREATE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    UPDATE: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    UPDATE_BATCH: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
    DELETE: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    IMPORT: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    RESET_PASSWORD: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
    DEFAULT: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const AuditTrail = ({ session }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const [logs, setLogs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 8;
    const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'descending' });

    const fetchLogs = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        setError(null);
        try {
            const data = await apiFetch('audit', serverIp); // 3. PASS serverIp
            setLogs(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp]); // 4. ADD serverIp dependency

    useEffect(() => {
        // 5. UPDATE data fetch trigger
        if (!isSettingsLoading) {
            fetchLogs();
        }
    }, [isSettingsLoading, fetchLogs]);

    const filteredLogs = useMemo(() => {
        if (!searchQuery) return logs;
        const searchLower = searchQuery.toLowerCase();
        return logs.filter(log =>
            log.user_name?.toLowerCase().includes(searchLower) ||
            log.action?.toLowerCase().includes(searchLower) ||
            log.entity?.toLowerCase().includes(searchLower) ||
            log.new_data?.toLowerCase().includes(searchLower) ||
            log.old_data?.toLowerCase().includes(searchLower)
        );
    }, [logs, searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, sortConfig]);

    const sortedLogs = useMemo(() => {
        let sortableItems = [...filteredLogs];
        if (sortConfig.key) {
            sortableItems.sort((a, b) => {
                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];
                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [filteredLogs, sortConfig]);

    const totalPages = Math.ceil(sortedLogs.length / rowsPerPage);
    const paginatedLogs = useMemo(() => {
        const startIndex = (currentPage - 1) * rowsPerPage;
        return sortedLogs.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedLogs, currentPage]);

    const requestSort = (key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending'
            ? <FaSortUp className="inline-block ml-1 text-blue-500" />
            : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };

    const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
    const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

    const renderLogDetails = (log) => {
        const formatData = (log, className) => {
            try {
                const data = log.action === 'CREATE' || log.action === 'IMPORT' ? log.new_data : log.old_data;
                if (!data) return null;
                
                const obj = JSON.parse(data);
                let ignoredKeys = ['id', 'created_at', 'updated_at', 'actingUserId'];

                const canViewPassword = ['Super_Admin', 'Admin'].includes(session.user.role);
                if (log.entity === 'user' && log.action === 'CREATE' && !canViewPassword) {
                    ignoredKeys.push('temporaryPassword');
                }

                const details = Object.entries(obj)
                    .filter(([key]) => !ignoredKeys.includes(key))
                    .map(([key, value]) => {
                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        return <li key={key} className={className}>{`${label}: ${value || 'N/A'}`}</li>;
                    });
                return <ul className="list-disc list-inside text-xs">{details}</ul>;
            } catch (e) {
                return <span className="text-xs text-gray-500">Invalid data format.</span>;
            }
        };

        const computeDiff = (oldData, newData) => {
            try {
                const oldObj = oldData ? JSON.parse(oldData) : {};
                const newObj = newData ? JSON.parse(newData) : {};
                const diffs = [];
                const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

                keys.forEach(key => {
                    if (['id', 'created_at', 'updated_at', 'actingUserId'].includes(key)) return;
                    
                    const oldVal = oldObj[key] ?? '';
                    const newVal = newObj[key] ?? '';
                    const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                    if (String(oldVal) !== String(newVal)) {
                        diffs.push(<li key={key} className="text-yellow-700 dark:text-yellow-400">{`${label}: "${oldVal}" → "${newVal}"`}</li>);
                    }
                });
                return (
                    <div>
                        <h5 className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Changes:</h5>
                        <ul className="list-disc list-inside text-xs">{diffs.length > 0 ? diffs : <li className="text-gray-500">No tracked fields changed</li>}</ul>
                    </div>
                );
            } catch (e) {
                return <span className="text-xs text-gray-500">Could not compute changes.</span>;
            }
        };

        switch (log.action) {
            case 'CREATE':
                return formatData(log, 'text-green-700 dark:text-green-400');
            case 'DELETE':
                return formatData(log, 'text-red-700 dark:text-red-400');
            case 'UPDATE':
                return computeDiff(log.old_data, log.new_data);
            case 'IMPORT':
                return formatData(log, 'text-blue-700 dark:text-blue-400');
            case 'UPDATE_BATCH': {
                try {
                    const { changes, affected_ids } = JSON.parse(log.new_data);
                    return (
                        <div className="text-xs text-purple-700 dark:text-purple-400">
                            <div className="mb-1"><strong className="font-semibold">Changes Applied:</strong>
                                <ul className="list-disc list-inside pl-2">
                                    {Object.entries(changes).map(([key, value]) => {
                                        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                        return <li key={key}>{`${label}: "${value}"`}</li>;
                                    })}
                                </ul>
                            </div>
                            <div><strong className="font-semibold">Affected Records:</strong> {affected_ids?.length || 0}</div>
                        </div>
                    );
                } catch (e) {
                    return <span className="text-xs text-gray-500">Invalid batch update data.</span>;
                }
            }
            case 'RESET_PASSWORD': {
                try {
                    if (!log.new_data) return null;
                    const obj = JSON.parse(log.new_data);
                    const canViewPassword = ['Super_Admin', 'Admin'].includes(session.user.role);
                    return (
                        <ul className="list-disc list-inside text-xs text-blue-700 dark:text-blue-400">
                            <li>User: {obj.targetUser || 'N/A'}</li>
                            <li>Username: {obj.username || 'N/A'}</li>
                            {canViewPassword && (
                                <li>Temporary Password: {obj.temporaryPassword || 'N/A'}</li>
                            )}
                        </ul>
                    );
                } catch (e) {
                    return <span className="text-xs text-gray-500">Invalid data.</span>;
                }
            }
            default:
                return null;
        }
    };

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading Audit Trail...</div>;
    }
    if (error) {
        return <div className="p-8 text-center text-red-500">Error: {error}</div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">System Audit Trail</h1>
                <div className="relative">
                    <input
                        type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search logs..."
                        className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 flex items-center pr-3">
                            <FiX className="h-5 w-5 text-gray-500" />
                        </button>
                    )}
                </div>
            </div>

            <div className="overflow-x-auto bg-white h-[760px] rounded-lg shadow dark:bg-gray-800">
                <table className="min-w-full text-sm leading-normal">
                    <thead>
                        <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                            <th className="p-3 text-left font-semibold"><button onClick={() => requestSort('created_at')} className="flex items-center w-full uppercase">Timestamp {getSortIcon('created_at')}</button></th>
                            <th className="p-3 text-left font-semibold"><button onClick={() => requestSort('user_name')} className="flex items-center w-full uppercase">User {getSortIcon('user_name')}</button></th>
                            <th className="p-3 text-left font-semibold"><button onClick={() => requestSort('action')} className="flex items-center w-full uppercase">Action {getSortIcon('action')}</button></th>
                            <th className="p-3 text-left font-semibold"><button onClick={() => requestSort('entity')} className="flex items-center w-full uppercase">Category {getSortIcon('entity')}</button></th>
                            <th className="p-3 text-left font-semibold uppercase">Details</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                        {paginatedLogs.map(log => (
                            <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="p-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                                    {log.created_at ? format(parseISO(log.created_at), 'MM/dd/yyyy, h:mm:ss a') : 'N/A'}
                                </td>
                                <td className="p-3 text-gray-800 dark:text-gray-200">
                                    {log.user_name || 'System'}
                                    <span className="block text-xs text-gray-500">{log.user_role}</span>
                                </td>
                                <td className="p-3">
                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${actionBadgeStyles[log.action] || actionBadgeStyles.DEFAULT}`}>
                                        {log.action}
                                    </span>
                                </td>
                                <td className="p-3 text-gray-700 dark:text-gray-300">{log.entity}</td>
                                <td className="p-3 text-gray-700 dark:text-gray-300">
                                    {renderLogDetails(log)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                 {paginatedLogs.length === 0 && (
                    <div className="p-16 text-center text-gray-500 dark:text-gray-400">
                        <h3 className="text-lg font-medium">No Audit Logs Found</h3>
                        <p className="mt-1 text-sm">No records match your current search criteria.</p>
                    </div>
                )}
            </div>

            {totalPages > 1 && (
                <div className="flex justify-between items-center mt-4">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                        Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex items-center space-x-2">
                        <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 ... disabled:opacity-50">Previous</button>
                        <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 ... disabled:opacity-50">Next</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AuditTrail;