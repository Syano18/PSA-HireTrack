import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiPlus, FiX, FiSave } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaTrash, FaPencilAlt } from 'react-icons/fa';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';
import { auth } from '../firebase';
import { sendPasswordResetEmail } from 'firebase/auth';

const initialFormState = {
  first_name: '',
  middle_initial: '',
  last_name: '',
  suffix: '',
  email: '',
  role: 'User',
  opshub_role: 'Staff',
  position: '',
  salary: '',
  salary_grade: '',
  status: 'Active'
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

const SearchableDropdown = ({ options, value, onChange, placeholder, id, required, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);
  
    useClickOutside(dropdownRef, () => setIsOpen(false));
  
    const selectedOption = useMemo(() => {
      return options.find((option) => String(option.value) === String(value)) || null;
    }, [options, value]);
  
    const filteredOptions = useMemo(
      () =>
        options.filter((option) =>
          option.label.toLowerCase().includes(searchTerm.toLowerCase())
        ),
      [options, searchTerm]
    );
  
    const displayValue = isOpen ? searchTerm : selectedOption?.label || '';
  
    const handleSelectOption = (option) => {
      onChange(option.value);
      setSearchTerm(option.label);
      setIsOpen(false);
    };
  
    return (
      <div className="relative" ref={dropdownRef}>
        <input id={id} type="text" className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700/50" value={displayValue} onChange={(e) => { if (disabled) return; setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true); }} onFocus={() => { if (disabled) return; setIsOpen(true); setSearchTerm(''); }} placeholder={placeholder} required={required && !value} disabled={disabled} />
        {isOpen && !disabled && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-300 bg-white shadow-lg dark:bg-gray-700">
            {filteredOptions.length > 0 ? (
              <ul className="max-h-60 overflow-y-auto">
                {filteredOptions.map((option) => (
                  <li key={option.value} className={`cursor-pointer px-4 py-2 text-gray-800 dark:text-gray-200 hover:bg-blue-500 hover:text-white whitespace-normal break-words ${ String(option.value) === String(value) ? 'bg-blue-100 dark:bg-blue-600' : '' }`} onClick={() => handleSelectOption(option)}>
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-2 text-gray-500 dark:text-gray-400">No options found.</div>
            )}
          </div>
        )}
      </div>
    );
};

const Accounts = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { toasts, showToast, removeToast } = useToast();
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingUser, setEditingUser] = useState(null);
  const [originalFormData, setOriginalFormData] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [assignedFocalPersonIds, setAssignedFocalPersonIds] = useState(new Set());
  const [tempPassword, setTempPassword] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [showTempPasswordModal, setShowTempPasswordModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [tempPasswordModalTitle, setTempPasswordModalTitle] = useState(''); // <-- 1. ADDED STATE
  const [sessionState, setSessionState] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [filters, setFilters] = useState({ query: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 12;
  const firstNameRef = useRef(null);
  const middleInitialRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const roleRef = useRef(null);
  const opshubRoleRef = useRef(null);

  const handleCloseModal = useCallback(() => {
      setIsModalOpen(false);
      setFormData(initialFormState);
      setOriginalFormData(null);
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
          showToast("Authentication failed. Please log in again.", 'error');
          setIsLoading(false);
        }
      } catch (err) {
        showToast("Failed to retrieve session data.", 'error');
        setIsLoading(false);
      }
    };
    getSession();
  }, [showToast]);

  const fetchUsers = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('users', serverIp);
      setUsers(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, showToast]);

  const fetchAssignedFocalPersons = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('employments', serverIp);
      const ids = new Set(data.map(rec => rec.focal_person_id).filter(Boolean));
      setAssignedFocalPersonIds(ids);
    } catch (err) {
      console.error("Failed to fetch assigned focal persons:", err);
    }
  }, [serverIp]);

  useEffect(() => {
    if (sessionState && !isSettingsLoading) {
      fetchUsers();
      fetchAssignedFocalPersons();
      if (['Super_Admin', 'Admin', 'PACD'].includes(sessionState.user.role)) {
        fetchUsers();
      }
    }
  }, [sessionState, isSettingsLoading, fetchUsers, fetchAssignedFocalPersons]);

  const getAssignableRoles = useCallback(() => {
    if (!sessionState) return [];
    const { role } = sessionState.user;
    if (role === 'Super_Admin') return ['Super_Admin', 'Admin', 'Focal Person', 'PACD', 'User'];
    if (role === 'Admin') return ['Admin', 'Focal Person', 'PACD', 'User'];
    if (role === 'PACD') return ['User'];
    return [];
  }, [sessionState]);

  const roleOptions = useMemo(() => 
    getAssignableRoles().map(role => ({ value: role, label: role })),
  [getAssignableRoles]);

  const opshubRoleOptions = useMemo(() => [
    { value: 'Staff', label: 'Staff' },
    { value: 'Admin', label: 'Admin' }
  ], []);

  const statusOptions = useMemo(() => [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' }
  ], []);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const searchLower = filters.query.toLowerCase();
      const fullName = `${user.first_name || ''} ${user.middle_initial || ''} ${user.last_name || ''}`.toLowerCase();
      return filters.query === '' || fullName.includes(searchLower) || (user.email && user.email.toLowerCase().includes(searchLower));
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
    setOriginalFormData(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (user) => {
    setEditingUser(user);
    const formDataToUse = { ...user, password: '' };
    setFormData(formDataToUse);
    setOriginalFormData(formDataToUse);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (user) => {
    setUserToDelete(user);
  };

  const confirmDelete = async () => {
    if (!userToDelete || !sessionState) return;
    try {
      await apiFetch(`users/${userToDelete.id}`, serverIp, {
        method: 'DELETE',
        body: JSON.stringify({ actingUserId: sessionState.user.id })
      });
      setUserToDelete(null);
      fetchUsers();
      showToast('User deleted successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      setUserToDelete(null);
    }
  };

  const isFormValid = useMemo(() => {
    const requiredFields = ['first_name', 'middle_initial', 'last_name', 'email', 'role', 'opshub_role', 'status'];
    return requiredFields.every(field => formData[field] && String(formData[field]).trim() !== '');
  }, [formData]);

  const hasChanges = useMemo(() => {
      if (!editingUser || !originalFormData) {
          return false;
      }
      const fieldsToCompare = [
          'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 
          'role', 'opshub_role', 'position', 'salary', 'salary_grade', 'status'
      ];
      for (const key of fieldsToCompare) {
          const originalValue = originalFormData[key] ?? '';
          const currentValue = formData[key] ?? '';
          if (String(originalValue).trim() !== String(currentValue).trim()) {
              return true;
          }
      }
      return false;
  }, [formData, originalFormData, editingUser]);

  const handleFormSubmit = async (e) => {
      e.preventDefault();
      
      // Validation - Required fields
      if (!formData.first_name.trim()) {
        firstNameRef.current?.focus();
        firstNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!formData.middle_initial.trim()) {
        middleInitialRef.current?.focus();
        middleInitialRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!formData.last_name.trim()) {
        lastNameRef.current?.focus();
        lastNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!formData.email.trim()) {
        emailRef.current?.focus();
        emailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!formData.role) {
        roleRef.current?.focus();
        roleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!formData.opshub_role) {
        opshubRoleRef.current?.focus();
        opshubRoleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      
      const endpoint = editingUser ? `users/${editingUser.id}` : 'users';
      const method = editingUser ? 'PUT' : 'POST';
      const body = { ...formData, actingUserId: sessionState.user.id };

      try {
          const data = await apiFetch(endpoint, serverIp, {
              method,
              body: JSON.stringify(body)
          });
          
          if (method === 'POST') {
              setTempPassword(data.temporaryPassword || '');
              setResetLink(data.resetLink || '');
              
              // --- SEND FIREBASE EMAIL ---
              try {
                  await sendPasswordResetEmail(auth, formData.email);
                  setTempPasswordModalTitle('Account Created & Email Sent');
              } catch (emailErr) {
                  setTempPasswordModalTitle('Account Created (Email Failed)');
              }
              setShowTempPasswordModal(true);
          } else {
              showToast('User updated successfully.', 'success');
          }
          
          setIsModalOpen(false);
          fetchUsers();
      } catch (err) {
          let errorMessage = "An unknown error occurred.";
          try {
              const parsedError = JSON.parse(err.message);
              errorMessage = parsedError.error || parsedError.message || errorMessage;
          } catch (parseErr) {
              errorMessage = err.message || errorMessage;
          }
          showToast(errorMessage, 'error');
      }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
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

      <ToastContainer toasts={toasts} onClose={removeToast} />
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
      
      <div className="overflow-x-auto bg-white rounded-lg shadow h-[760px] dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('last_name')} className="flex items-center w-full uppercase">Account Name {getSortIcon('last_name')}</button>
              </th>
              <th className="px-5 py-3.5 font-semibold tracking-wider">
                <button onClick={() => requestSort('email')} className="flex items-center w-full uppercase">Email Address {getSortIcon('email')}</button>
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
                const isCurrentUser = sessionState.user.id === user.id;
                const canEdit = sessionState.user.id !== user.id && ((sessionState.user.role === 'Super_Admin') || (sessionState.user.role === 'Admin' && user.role !== 'Super_Admin') || (sessionState.user.role === 'PACD' && (user.role === 'User')));
                const canDelete = sessionState.user.id !== user.id && canEdit;

                  return (
                  <tr key={user.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                    <td className="px-5 py-4 font-medium text-gray-900 dark:text-white">{[user.first_name, user.middle_initial, user.last_name, user.suffix].filter(Boolean).join(' ')}</td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.email}</td>
                    <td className="px-5 py-4"><span className="relative inline-block px-3 py-1 font-semibold text-green-900 dark:text-green-200 leading-tight"><span aria-hidden className="absolute inset-0 bg-green-200 dark:bg-green-800 opacity-50 rounded-full"></span><span className="relative">{user.role}</span></span></td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.created_at ? format(parseISO(user.created_at), 'MMMM d, yyyy') : 'N/A'}</td>
                   <td className="px-5 py-4">
                      <div className="flex items-center space-x-4">
                          <button
                            onClick={() => handleEditClick(user)}
                            disabled={!canEdit}
                            title={isCurrentUser ? "You cannot edit your own account." : !canEdit ? "Insufficient permissions" : "Edit User"}
                            className={`p-1 rounded-lg transition-colors ${canEdit ? 'text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-900/20' : 'text-gray-400 cursor-not-allowed dark:text-gray-600'}`}
                          >
                            <FaPencilAlt className="w-4 h-4" />
                          </button>
                            
                              {canDelete ? (
                          <button 
                            onClick={() => handleDeleteClick(user)} 
                            disabled={assignedFocalPersonIds.has(user.id)}
                            title={assignedFocalPersonIds.has(user.id) ? "Cannot delete: Focal Person of an existing survey" : "Delete User"}
                            className={`font-medium transition-colors ${assignedFocalPersonIds.has(user.id) ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300'}`}
                          >
                            <FaTrash className="w-4 h-4" />
                          </button>
                      ) : (
                          <button title="You cannot delete your own account." className="font-medium transition-colors text-gray-400 cursor-not-allowed">
                              <FaTrash className="w-4 h-4" />
                          </button>
                      )}
                          
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
          <button onClick={handlePreviousPage} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} title={currentPage >= totalPages ? 'Already on last page' : 'Go to next page'} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Next</button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div ref={addEditModalRef} className="flex flex-col w-full max-w-lg max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingUser ? 'Edit User' : 'Add a New User'}</h2>
                </div>
                <form id="userForm" onSubmit={handleFormSubmit} className="flex-auto p-6 overflow-y-auto">
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-5">
                        <div>
                            <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name*</label>
                            <input ref={firstNameRef} type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="middle_initial" className="block text-sm font-medium text-gray-700 dark:text-gray-300">M.I.*</label>
                            <input ref={middleInitialRef} type="text" id="middle_initial" name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name*</label>
                            <input ref={lastNameRef} type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="suffix" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suffix</label>
                            <input type="text" id="suffix" name="suffix" value={formData.suffix || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address*</label>
                            <input ref={emailRef} type="email" id="email" name="email" value={formData.email} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="position" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Position</label>
                            <input type="text" id="position" name="position" value={formData.position || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="salary" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Salary</label>
                            <input type="number" id="salary" name="salary" value={formData.salary || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="salary_grade" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Salary Grade</label>
                            <input type="text" id="salary_grade" name="salary_grade" value={formData.salary_grade || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role*</label>
                            <SearchableDropdown id="role" options={roleOptions} value={formData.role} onChange={(value) => handleInputChange({ target: { name: 'role', value } })} placeholder="Select Role" required />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="opshub_role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">OpsHub Role*</label>
                            <SearchableDropdown id="opshub_role" options={opshubRoleOptions} value={formData.opshub_role} onChange={(value) => handleInputChange({ target: { name: 'opshub_role', value } })} placeholder="Select OpsHub Role" required />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status*</label>
                            <SearchableDropdown
                              id="status"
                              options={statusOptions}
                              value={formData.status || 'Active'}
                              onChange={(value) => handleInputChange({ target: { name: 'status', value } })}
                              placeholder="Select Status"
                              required
                            />
                        </div>
                    </div>
                </form>
                <div className="flex-shrink-0 flex justify-between items-center px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                    <div></div>
                    <div className="flex space-x-2">
                        <button type="button" onClick={handleCloseModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"><FiX className="w-4 h-4" />Cancel</button>
                        <button 
                          type="submit" 
                          form="userForm" 
                          disabled={editingUser ? !hasChanges : !isFormValid}
                          title={editingUser ? (!hasChanges ? 'No changes to save' : 'Save changes') : (!isFormValid ? 'Please fill all required fields' : 'Save new user')}
                          className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <FiSave className="w-4 h-4" />
                          Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Are you sure you want to delete user "{userToDelete.email}"? This cannot be undone.</p>
            <div className="flex justify-end mt-6 space-x-2">
              <button onClick={() => setUserToDelete(null)} className="flex items-center gap-2 px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 transition-colors"><FiX className="w-4 h-4" />Cancel</button>
              <button onClick={confirmDelete} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700 transition-colors"><FaTrash className="w-4 h-4" />Delete</button>
            </div>
          </div>
        </div>
      )}

      {showTempPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 text-center bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">{tempPasswordModalTitle}</h2> {/* <-- 3. USE DYNAMIC TITLE */}
            <p className="mt-2 text-gray-600 dark:text-gray-300">The user has been notified via email.</p>
            
            <div className="mt-4 space-y-4">
              {tempPassword && (
              <div className="flex items-center justify-center p-3 bg-gray-100 rounded-lg dark:bg-gray-700">
                <p className="mr-4 text-lg font-mono font-bold text-gray-800 dark:text-white">{tempPassword}</p>
                <button onClick={() => copyToClipboard(tempPassword)} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">{copySuccess || 'Copy'}</button>
              </div>
              )}

              {resetLink && (
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Or send them this Reset Link:</p>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={resetLink} className="w-full p-2 text-xs bg-gray-50 border border-gray-300 rounded dark:bg-gray-900 dark:border-gray-600 dark:text-gray-300" />
                    <button onClick={() => copyToClipboard(resetLink)} className="px-3 py-1 text-xs font-semibold text-gray-700 bg-gray-200 rounded hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Copy</button>
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => setShowTempPasswordModal(false)} className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-6 font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 transition-colors"><FiX className="w-4 h-4" />Close</button>
          </div>
        </div>
      )}
    </div>
  );
};


export default Accounts;