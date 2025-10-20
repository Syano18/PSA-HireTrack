import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const initialFormState = {
  first_name: '',
  middle_initial: '',
  last_name: '',
  suffix: '',
  username: '',
  password: '',
  role: 'User'
};
const useClickOutside = (ref, handler) => {
  useEffect(() => {
    const listener = (event) => {
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      handler(event);
    };
    document.addEventListener('mousedown', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
    };
  }, [ref, handler]);
};
const Accounts = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingUser, setEditingUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [tempPassword, setTempPassword] = useState('');
  const [showTempPasswordModal, setShowTempPasswordModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [sessionState, setSessionState] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [filters, setFilters] = useState({ query: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 12;

  const handleCloseModal = useCallback(() => {
      setIsModalOpen(false);
      setError(null);
      setFormData(initialFormState);
  }, []);
  const addEditModalRef = useRef(null);
  useClickOutside(addEditModalRef, () => { 
      if(isModalOpen) {
          handleCloseModal();
      }
  });

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        if (state?.token) {
          setSessionState(state);
          setCanManage(['Super_Admin', 'Admin', 'PACD'].includes(state.user.role));
        } else {
          setError({ type: 'auth', message: "Authentication failed. Please log in again." });
          setIsLoading(false);
        }
      } catch (err) {
        setError({ type: 'session', message: "Failed to retrieve session data." });
        setIsLoading(false);
      }
    };
    getSession();
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!serverIp) return; // Wait for serverIp
    setIsLoading(true);
    try {
      const data = await apiFetch('users', serverIp); // 3. PASS serverIp
      setUsers(data);
    } catch (err) {
      setError({ type: 'api', message: err.message });
    } finally {
      setIsLoading(false);
    }
  }, [serverIp]); // 4. ADD serverIp dependency

  useEffect(() => {
    // 5. UPDATE data fetch trigger
    if (sessionState && !isSettingsLoading) {
      fetchUsers();
    }
  }, [sessionState, isSettingsLoading, fetchUsers]);

  const getAssignableRoles = useCallback(() => {
    if (!sessionState) return [];
    const { role } = sessionState.user;
    if (role === 'Super_Admin') return ['Super_Admin', 'Admin', 'Focal Person', 'PACD', 'User'];
    if (role === 'Admin') return ['Admin', 'Focal Person', 'PACD', 'User'];
    if (role === 'PACD') return ['User'];
    return [];
  }, [sessionState]);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const searchLower = filters.query.toLowerCase();
      const fullName = `${user.first_name || ''} ${user.middle_initial || ''} ${user.last_name || ''}`.toLowerCase();
      return filters.query === '' || fullName.includes(searchLower) || (user.username && user.username.toLowerCase().includes(searchLower));
    });
  }, [users, filters.query]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.query]);

  const sortedUsers = useMemo(() => {
    let sortableUsers = [...filteredUsers];
    if (sortConfig.key) {
      sortableUsers.sort((a, b) => {
        const aValue = a[sortConfig.key] || '';
        const bValue = b[sortConfig.key] || '';
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableUsers;
  }, [filteredUsers, sortConfig]);

  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return sortedUsers.slice(startIndex, startIndex + rowsPerPage);
  }, [sortedUsers, currentPage]);

  const totalPages = Math.ceil(sortedUsers.length / rowsPerPage);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({ ...prevState, [name]: value }));
  };

  const handleAddClick = () => {
    setEditingUser(null);
    setFormData({ ...initialFormState, role: getAssignableRoles()[0] || 'User' });
    setError(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (user) => {
    setEditingUser(user);
    setFormData({ ...user, password: '' });
    setError(null);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (user) => {
    setUserToDelete(user);
    setError(null);
  };

   const confirmDelete = async () => {
    if (!userToDelete || !sessionState) return;
    try {
      await apiFetch(`users/${userToDelete.id}`, serverIp, { // 3. PASS serverIp
        method: 'DELETE',
        body: JSON.stringify({ actingUserId: sessionState.user.id })
      });
      setUserToDelete(null);
      fetchUsers();
    } catch (err) {
      setError({ type: 'delete', message: err.message });
      setUserToDelete(null);
    }
  };

  const handleFormSubmit = async (e) => {
      e.preventDefault();
      setError(null);
      const endpoint = editingUser ? `users/${editingUser.id}` : 'users';
      const method = editingUser ? 'PUT' : 'POST';
      const body = { ...formData, actingUserId: sessionState.user.id };

      try {
          const data = await apiFetch(endpoint, serverIp, { // 3. PASS serverIp
              method,
              body: JSON.stringify(body)
          });
          
          setIsModalOpen(false);
          
          if (method === 'POST' && data.temporaryPassword) {
              setTempPassword(data.temporaryPassword);
              setShowTempPasswordModal(true);
          }
          
          fetchUsers();
      } catch (err) {
          let errorMessage = "An unknown error occurred.";
          try {
              const parsedError = JSON.parse(err.message);
              errorMessage = parsedError.error || parsedError.message || errorMessage;
          } catch (parseErr) {
              errorMessage = err.message || errorMessage;
          }
          setError({ type: 'form', message: errorMessage });
      }
  };

  const handlePasswordReset = async () => {
    if (!editingUser || !sessionState) return;
    setError(null);
    try {
      const data = await apiFetch(`users/${editingUser.id}/reset-password`, serverIp, { // 3. PASS serverIp
        method: 'POST'
      });
      setTempPassword(data.temporaryPassword);
      setShowTempPasswordModal(true);
      setIsModalOpen(false);
    } catch (err) {
      setError({ type: 'password_reset', message: err.message });
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(tempPassword).then(() => {
      setCopySuccess('Copied!');
      setTimeout(() => setCopySuccess(''), 2000);
    }, () => {
      setCopySuccess('Failed to copy.');
    });
  };

  const handleFilterChange = (e) => setFilters(prev => ({ ...prev, query: e.target.value }));

  const handleClearSearch = () => setFilters(prev => ({ ...prev, query: '' }));

  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));

  const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  const requestSort = (key) => {
    setCurrentPage(1);
    const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  // 6. UPDATE initial loading condition
  if (!sessionState || isLoading || isSettingsLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">User Accounts</h1>
        <div className="w-full p-4 space-y-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow animate-pulse">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center justify-between pt-2">
              <div className="flex items-center">
                <div className="w-5 h-5 mr-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
                <div>
                  <div className="h-2.5 bg-gray-300 rounded-full dark:bg-gray-600 w-24 mb-2.5"></div>
                  <div className="w-32 h-2 bg-gray-200 rounded-full dark:bg-gray-700"></div>
                </div>
              </div>
              <div className="h-2.5 bg-gray-300 rounded-full dark:bg-gray-700 w-12"></div>
              <div className="hidden h-2.5 bg-gray-300 rounded-full dark:bg-gray-700 md:block w-20"></div>
              <div className="hidden h-2.5 bg-gray-300 rounded-full dark:bg-gray-700 lg:block w-24"></div>
            </div>
          ))}
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ... All your JSX ... */}
      {/* NOTE: No changes are needed in the JSX, only in the logic above. */}
      {/* The full JSX is omitted here for brevity but is included in the copy-paste block. */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">User Accounts</h1>
        <div className="relative">
          <input type="text" value={filters.query} onChange={handleFilterChange} placeholder="Search..." className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
          {filters.query && (
            <button onClick={handleClearSearch} aria-label="Clear search" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200">
              <FiX className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {canManage && (
          <button onClick={handleAddClick} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
            <FiPlus />Add New User
          </button>
        )}
      </div>
      {error && !isModalOpen && !userToDelete && <div className="mb-4 text-center p-3 bg-red-100 text-red-700 rounded-lg">{error.message}</div>}
      
      <div className="overflow-x-auto bg-white rounded-lg shadow h-[760px] dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('last_name')} className="flex items-center w-full uppercase">Account Name {getSortIcon('last_name')}</button>
              </th>
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('username')} className="flex items-center w-full uppercase">Username {getSortIcon('username')}</button>
              </th>
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('role')} className="flex items-center w-full uppercase">Role {getSortIcon('role')}</button>
              </th>
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('created_at')} className="flex items-center w-full uppercase">Date Registered {getSortIcon('created_at')}</button>
              </th>
              <th className="px-5 py-3.5 text-left font-semibold tracking-wider uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedUsers.length > 0 ? (
              paginatedUsers.map((user) => {
                const canEdit = (sessionState.user.role === 'Super_Admin') || (sessionState.user.role === 'Admin' && user.role !== 'Super_Admin') || (sessionState.user.role === 'PACD' && (user.role === 'User'));
                const canDelete = sessionState.user.id !== user.id && canEdit;
                return (
                  <tr key={user.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                    <td className="px-5 py-4 font-medium text-gray-900 dark:text-white">{[user.first_name, user.middle_initial, user.last_name, user.suffix].filter(Boolean).join(' ')}</td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.username}</td>
                    <td className="px-5 py-4"><span className="relative inline-block px-3 py-1 font-semibold text-green-900 leading-tight"><span aria-hidden className="absolute inset-0 bg-green-200 opacity-50 rounded-full"></span><span className="relative">{user.role}</span></span></td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.created_at ? format(parseISO(user.created_at), 'MMMM d, yyyy') : 'N/A'}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center space-x-4">
                        {canEdit && <button onClick={() => handleEditClick(user)} className="font-medium text-blue-600 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Edit</button>}
                        {canDelete && <button onClick={() => handleDeleteClick(user)} className="font-medium text-red-600 transition-colors hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>}
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="5" className="py-16 text-center text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Records Found</h3>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-1">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {Math.min((currentPage - 1) * rowsPerPage + 1, sortedUsers.length)} to {Math.min(currentPage * rowsPerPage, sortedUsers.length)} of {sortedUsers.length} Users
        </span>
        <div className="flex items-center space-x-2">
          <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Next</button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div ref={addEditModalRef} className="flex flex-col w-full max-w-lg max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingUser ? 'Edit User' : 'Add a New User'}</h2>
                </div>
                <form id="userForm" onSubmit={handleFormSubmit} className="flex-auto p-6 overflow-y-auto">
                    {error?.type === 'form' && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error.message}</div>}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5">
                        <div>
                            <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name*</label>
                            <input type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="middle_initial" className="block text-sm font-medium text-gray-700 dark:text-gray-300">M.I.*</label>
                            <input type="text" id="middle_initial" name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name*</label>
                            <input type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="suffix" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suffix</label>
                            <input type="text" id="suffix" name="suffix" value={formData.suffix || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username*</label>
                            <input type="text" id="username" name="username" value={formData.username} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role*</label>
                            <select id="role" name="role" value={formData.role} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500">
                                {getAssignableRoles().map(role => (<option key={role} value={role}>{role}</option>))}
                            </select>
                        </div>
                    </div>
                </form>
                <div className="flex-shrink-0 flex justify-between items-center px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                    <div>{editingUser && <button type="button" onClick={handlePasswordReset} className="px-4 py-2 font-semibold text-white bg-yellow-500 rounded-md shadow-sm hover:bg-yellow-600 transition-colors">Reset Password</button>}</div>
                    <div className="flex space-x-2">
                        <button type="button" onClick={handleCloseModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 transition-colors">Cancel</button>
                        <button type="submit" form="userForm" className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 transition-colors">Save</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Are you sure you want to delete user "{userToDelete.username}"? This cannot be undone.</p>
            {error?.type === 'delete' && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg">{error.message}</div>}
            <div className="flex justify-end mt-6 space-x-2">
              <button onClick={() => setUserToDelete(null)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showTempPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 text-center bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Account Created Successfully</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Please provide the user with their new temporary password:</p>
            {error?.type === 'password_reset' && <div className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg">{error.message}</div>}
            <div className="flex items-center justify-center p-3 mt-4 bg-gray-100 rounded-lg dark:bg-gray-700">
              <p className="mr-4 text-lg font-mono font-bold text-gray-800 dark:text-white">{tempPassword}</p>
              <button onClick={copyToClipboard} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">{copySuccess || 'Copy'}</button>
            </div>
            <button onClick={() => setShowTempPasswordModal(false)} className="w-full px-4 py-2 mt-6 font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Accounts;