import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiPlus, FiX, FiSave, FiLock, FiUser, FiUsers } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaPencilAlt } from 'react-icons/fa';
import { useUser } from '@clerk/clerk-react';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

const initialFormState = {
  first_name: '',
  middle_initial: '',
  last_name: '',
  suffix: '',
  email: '',
  role: '',
  status: ''
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

const ProfileView = ({ sessionState, serverIp }) => {
    const { toasts, showToast, removeToast } = useToast();
    const { user: clerkUser } = useUser();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isChanging, setIsChanging] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [localProfilePic, setLocalProfilePic] = useState(null);
    const fileInputRef = useRef(null);
    
    const user = sessionState?.user;

    useEffect(() => {
        if (user?.email_address && serverIp) {
            const fetchPic = async () => {
                try {
                    const response = await apiFetch(`users/profile-picture/${user.email_address}`, serverIp);
                    if (response.base64Data) {
                        setLocalProfilePic(response.base64Data);
                    }
                } catch (err) {
                    console.log('No profile picture found or error fetching:', err);
                }
            };
            fetchPic();
        }
    }, [user?.email_address, serverIp]);

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            showToast("Passwords do not match.", 'error');
            return;
        }
        setIsChanging(true);
        try {
            await apiFetch(`users/${user.id}/change-password`, serverIp, {
                method: 'PUT',
                body: JSON.stringify({ newPassword })
            });
            showToast("Password changed successfully.", 'success');
            setNewPassword('');
            setConfirmPassword('');
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
        setIsChanging(false);
    };

    const handleProfileImageChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingImage(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                try {
                    const base64Data = reader.result;
                    const response = await apiFetch(`users/profile-picture`, serverIp, {
                        method: 'POST',
                        body: JSON.stringify({ email: user.email_address, base64Data })
                    });
                    if (response.message) {
                        setLocalProfilePic(base64Data);
                        showToast("Profile picture updated successfully.", 'success');
                    } else {
                        throw new Error(response.error || 'Failed to save');
                    }
                } catch (saveErr) {
                    console.error('Failed to update profile picture', saveErr);
                    showToast("Failed to update profile picture.", 'error');
                } finally {
                    setIsUploadingImage(false);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                }
            };
            reader.onerror = (error) => {
                console.error('Failed to read file', error);
                showToast("Failed to read profile picture file.", 'error');
                setIsUploadingImage(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            };
        } catch (err) {
            console.error('Failed to update profile picture', err);
            showToast("Failed to update profile picture.", 'error');
            setIsUploadingImage(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    if (!user) return null;

    return (
        <div className="animate-fadeIn w-full space-y-4 xl:space-y-6 pb-6 xl:pb-12">
            <ToastContainer toasts={toasts} onClose={removeToast} />
            
            {/* Header / Banner Area */}
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Blue Banner */}
                <div className="h-20 sm:h-24 xl:h-32 bg-blue-600 w-full relative">
                    <div className="absolute bottom-1 sm:bottom-2 left-[100px] sm:left-[130px] xl:left-[172px] pr-4 max-w-full">
                        <h2 className="text-lg sm:text-xl xl:text-[1.7rem] font-extrabold text-white drop-shadow-md tracking-wide truncate">
                            {user.first_name} {user.middle_initial ? user.middle_initial + '.' : ''} {user.last_name}
                        </h2>
                    </div>
                </div>
                
                {/* Content over banner */}
                <div className="relative px-4 xl:px-6 pb-4 xl:pb-6">
                    {/* Profile Picture & Info */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between">
                        <div className="flex items-start gap-3 sm:gap-4 xl:gap-5">
                            <div 
                                className="-mt-10 sm:-mt-12 xl:-mt-16 w-20 h-20 sm:w-24 sm:h-24 xl:w-32 xl:h-32 rounded-xl bg-white p-1 shadow border border-gray-200 relative z-10 overflow-hidden shrink-0 cursor-pointer group"
                                onClick={() => fileInputRef.current?.click()}
                                title="Change Profile Picture"
                            >
                                {localProfilePic || clerkUser?.imageUrl ? (
                                    <img src={localProfilePic || clerkUser.imageUrl} className="w-full h-full rounded-lg object-cover group-hover:opacity-75 transition-opacity" alt="Profile" />
                                ) : (
                                    <div className="w-full h-full rounded-lg bg-gray-100 flex items-center justify-center text-gray-800 text-2xl sm:text-3xl xl:text-5xl font-bold group-hover:opacity-75 transition-opacity">
                                        {user.first_name?.charAt(0)}{user.last_name?.charAt(0)}
                                    </div>
                                )}
                                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg m-1">
                                    <span className="text-white text-[10px] sm:text-xs xl:text-sm font-semibold">{isUploadingImage ? 'Uploading...' : 'Change'}</span>
                                </div>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    ref={fileInputRef} 
                                    className="hidden" 
                                    onChange={handleProfileImageChange} 
                                    disabled={isUploadingImage}
                                />
                            </div>
                            <div className="pt-1 xl:pt-1">
                                {user.email_address ? (
                                    <p className="text-sm xl:text-[1.05rem] font-medium text-gray-600 dark:text-gray-400 tracking-wide truncate max-w-[200px] sm:max-w-xs md:max-w-md xl:max-w-lg">
                                        {user.email_address}
                                    </p>
                                ) : (
                                    <p className="text-xs xl:text-sm italic text-gray-400">No email provided</p>
                                )}
                            </div>
                        </div>
                        
                        {/* Badge */}
                        <div className="pt-3 sm:pt-2 flex-shrink-0">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 xl:px-3 xl:py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[10px] xl:text-xs font-semibold whitespace-nowrap dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                {user.role} Access
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Security Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 xl:p-6">
                <div className="flex items-center gap-2 mb-4 xl:mb-6">
                    <FiLock className="text-gray-400 w-4 h-4 xl:w-4 xl:h-4" />
                    <h3 className="text-[10px] xl:text-xs font-bold uppercase tracking-wider text-gray-400">Security Settings</h3>
                </div>
                
                <form onSubmit={handlePasswordChange} className="max-w-md space-y-3 xl:space-y-4">
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Current Password</label>
                        <input type="password" required className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">New Password</label>
                        <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-400 mb-1">Confirm New Password</label>
                        <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm" />
                    </div>
                    
                    <div className="flex items-center gap-3 pt-2">
                        <button type="button" onClick={() => { setNewPassword(''); setConfirmPassword(''); }} className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={isChanging} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50">
                            {isChanging ? 'Updating...' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
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


  const [tempPassword, setTempPassword] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [showTempPasswordModal, setShowTempPasswordModal] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const [copySuccess, setCopySuccess] = useState('');
  const [tempPasswordModalTitle, setTempPasswordModalTitle] = useState(''); // <-- 1. ADDED STATE
  const { session: sessionState } = useAuth();
  const canManage = sessionState?.user?.role === 'Super_Admin' || sessionState?.user?.role === 'Admin';
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [filters, setFilters] = useState({ query: '' });
  const firstNameRef = useRef(null);
  const middleInitialRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const roleRef = useRef(null);

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

  // useEffect for getting session removed, using useAuth hook instead

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



  useEffect(() => {
    if (sessionState && !isSettingsLoading) {
      if (['Super_Admin', 'Admin'].includes(sessionState.user.role)) {
        fetchUsers();
      } else {
        setIsLoading(false);
      }
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

  const roleOptions = useMemo(() => 
    getAssignableRoles().map(role => ({ value: role, label: role })),
  [getAssignableRoles]);


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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({ ...prevState, [name]: value }));
  };

  const handleAddClick = () => {
    setEditingUser(null);
    setFormData(initialFormState);
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


  const isFormValid = useMemo(() => {
    const requiredFields = ['first_name', 'middle_initial', 'last_name', 'email', 'role', 'status'];
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
              
              // --- CLERK EMAIL NOTIFICATION ---
              // With Clerk, emails are either sent automatically on user creation or via a backend-generated link.
              // For now, we rely on the backend passing back the reset link if needed.
              setTempPasswordModalTitle('Account Created Successfully');
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

  const requestSort = (key) => {
    const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  if (!sessionState || isLoading || isSettingsLoading) {
    return (
      <div>
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
    <div className="animate-fadeIn flex-1 flex flex-col min-h-0 w-full">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      {/* Header and Tabs */}
      <div className="mb-1 flex flex-col gap-2 flex-shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Accounts</h1>
        {canManage && (
          <div className="inline-flex bg-gray-100 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 rounded-lg p-1 self-start">
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'profile'
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              <FiUser className="w-4 h-4" />
              My Profile
            </button>
            <button
              onClick={() => setActiveTab('manage')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'manage'
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              <FiUsers className="w-4 h-4" />
              Manage Users
            </button>
          </div>
        )}
      </div>

      {activeTab === 'profile' ? (
        <ProfileView sessionState={sessionState} serverIp={serverIp} />
      ) : (
        <div className="flex-1 flex flex-col min-h-0 w-full">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 flex-shrink-0">
            <div className="relative">
              <input type="text" value={filters.query} onChange={handleFilterChange} placeholder="Search users..." className="w-full sm:w-80 py-2 pl-4 pr-10 border rounded-lg dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
              {filters.query && (
                <button onClick={handleClearSearch} aria-label="Clear search" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200">
                  <FiX className="w-5 h-5" />
                </button>
              )}
            </div>
            {canManage && (
              <button onClick={handleAddClick} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                <FiPlus />Add New User
              </button>
            )}
          </div>
          
          <div className="overflow-auto bg-white rounded-lg shadow flex-1 min-h-0 dark:bg-gray-800">
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
              <th className="px-5 py-3.5 text-center font-semibold tracking-wider uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.length > 0 ? (
              sortedUsers.map((user) => {
                const isCurrentUser = sessionState.user.id === user.id;
                const canEdit = sessionState.user.id !== user.id && ((sessionState.user.role === 'Super_Admin') || (sessionState.user.role === 'Admin' && user.role !== 'Super_Admin') || (sessionState.user.role === 'PACD' && (user.role === 'User')));

                  return (
                  <tr key={user.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                    <td className="px-5 py-4 font-medium text-gray-900 dark:text-white">{[user.first_name, user.middle_initial, user.last_name, user.suffix].filter(Boolean).join(' ')}</td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.email}</td>
                    <td className="px-5 py-4"><span className="relative inline-block px-3 py-1 font-semibold text-green-900 dark:text-green-200 leading-tight"><span aria-hidden className="absolute inset-0 bg-green-200 dark:bg-green-800 opacity-50 rounded-full"></span><span className="relative">{user.role}</span></span></td>
                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{user.created_at ? format(parseISO(user.created_at), 'MMMM d, yyyy') : 'N/A'}</td>
                   <td className="px-5 py-4">
                      <div className="flex items-center justify-center space-x-4">
                          <button
                            onClick={() => handleEditClick(user)}
                            disabled={!canEdit}
                            title={isCurrentUser ? "You cannot edit your own account." : !canEdit ? "Insufficient permissions" : "Edit User"}
                            className={`p-1 rounded-lg transition-colors ${canEdit ? 'text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-900/20' : 'text-gray-400 cursor-not-allowed dark:text-gray-600'}`}
                          >
                            <FaPencilAlt className="w-4 h-4" />
                          </button>
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

      <div className="flex justify-end items-center mt-2 px-2 flex-shrink-0">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Total Records: {sortedUsers.length}
        </span>
      </div>
      </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 p-4 bg-black/60 overflow-y-auto flex items-start justify-center">
          <div ref={addEditModalRef} className="flex flex-col w-full max-w-3xl bg-white dark:bg-gray-800 rounded-lg shadow-xl relative my-auto">
                <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingUser ? 'Edit User' : 'Add a New User'}</h2>
                </div>
                <form id="userForm" onSubmit={handleFormSubmit} className="flex-auto p-6 overflow-visible">
                    
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-5">
                        <div className="md:col-span-4">
                            <label htmlFor="first_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name*</label>
                            <input ref={firstNameRef} type="text" id="first_name" name="first_name" value={formData.first_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="middle_initial" className="block text-sm font-medium text-gray-700 dark:text-gray-300">M.I.*</label>
                            <input ref={middleInitialRef} type="text" id="middle_initial" name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-4">
                            <label htmlFor="last_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name*</label>
                            <input ref={lastNameRef} type="text" id="last_name" name="last_name" value={formData.last_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="suffix" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suffix</label>
                            <input type="text" id="suffix" name="suffix" value={formData.suffix || ''} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-12">
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address*</label>
                            <input ref={emailRef} type="email" id="email" name="email" value={formData.email} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div className="md:col-span-6">
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Role*</label>
                            <SearchableDropdown id="role" options={roleOptions} value={formData.role} onChange={(value) => handleInputChange({ target: { name: 'role', value } })} placeholder="Select Role" required />
                        </div>
                        <div className="md:col-span-6">
                            <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status*</label>
                            <SearchableDropdown
                              id="status"
                              options={statusOptions}
                              value={formData.status || ''}
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
