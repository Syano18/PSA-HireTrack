import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiPlus, FiDownload, FiSave, FiX, FiUpload } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaEye, FaPencilAlt, FaTrash } from 'react-icons/fa';
import ProgressModal from '../components/Progress';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const INITIAL_FORM_STATE = { employee_id: '', training_title_id: '', start_date: '', end_date: '', hours: '', venue: '' };
const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];

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
const formatDateForInput = (dateString) => {
    if (!dateString) return '';
    try {
        return format(parseISO(dateString), 'yyyy-MM-dd');
    } catch (error) {
        return '';
    }
};

const SearchableDropdown = ({ options, value, onChange, placeholder, id, required, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);
  
    useClickOutside(dropdownRef, () => setIsOpen(false));
  
    const selectedOption = useMemo(() => {
      return options.find((option) => option.value === value) || null;
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
        <input
          id={id}
          type="text"
          className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700/50"
          value={displayValue}
          onChange={(e) => {
            if (disabled) return;
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setIsOpen(true);
            setSearchTerm('');
          }}
          placeholder={placeholder}
          required={required && !value}
          disabled={disabled}
        />
  
        {isOpen && !disabled && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-300 bg-white shadow-lg dark:bg-gray-700">
            {filteredOptions.length > 0 ? (
              <ul className="max-h-60 overflow-y-auto">
                {filteredOptions.map((option) => (
                  <li
                    key={option.value}
                    className={`cursor-pointer px-4 py-2 text-gray-800 dark:text-gray-200 hover:bg-blue-500 hover:text-white whitespace-normal break-words ${
                      option.value === value ? 'bg-blue-100 dark:bg-blue-600' : ''
                    }`}
                    onClick={() => handleSelectOption(option)}
                  >
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-2 text-gray-500 dark:text-gray-400">
                No options found.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };


const Trainings = () => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings();
    const [trainings, setTrainings] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [trainingTitles, setTrainingTitles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toasts, showToast, removeToast } = useToast();
    const [filters, setFilters] = useState({ query: '' });
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedTrainings, setSelectedTrainings] = useState(new Set());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingTraining, setEditingTraining] = useState(null);
    const [viewingTraining, setViewingTraining] = useState(null);
    const [trainingToDelete, setTrainingToDelete] = useState(null);
    const [originalFormData, setOriginalFormData] = useState(null);

    const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
    const [progressMessage, setProgressMessage] = useState('');
    const [isProgressComplete, setIsProgressComplete] = useState(false);
    const [savedFilePath, setSavedFilePath] = useState(null);

    const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
    const [syncModalStep, setSyncModalStep] = useState('filter'); // 'filter', 'preview', or 'results'
    const [isSyncLoading, setIsSyncLoading] = useState(false);
    const [syncSelectedSurveyName, setSyncSelectedSurveyName] = useState('');
    const [syncSelectedPosition, setSyncSelectedPosition] = useState('');
    const [syncAvailableSurveys, setSyncAvailableSurveys] = useState([]);
    const [syncAvailablePositions, setSyncAvailablePositions] = useState([]);
    const [syncPendingCount, setSyncPendingCount] = useState(0);
    const [syncModalResults, setSyncModalResults] = useState(null);
    const [syncPreviewApplicants, setSyncPreviewApplicants] = useState([]);
    const [duplicateMarkers, setDuplicateMarkers] = useState(new Map());
    const [excludedApplicants, setExcludedApplicants] = useState(new Set());
    const [syncIsSurveyDropdownOpen, setSyncIsSurveyDropdownOpen] = useState(false);
    const [syncIsPositionDropdownOpen, setSyncIsPositionDropdownOpen] = useState(false);
    const [isCreatingNewTitle, setIsCreatingNewTitle] = useState(false);

    // Import states for sync modal
    const [importErrors, setImportErrors] = useState({});
    const [isImportLoading, setIsImportLoading] = useState(false);

    // Form state for adding new training within sync modal
    const [syncTrainingForm, setSyncTrainingForm] = useState({
        title: '',
        start_date: '',
        end_date: '',
        hours: '',
        venue: ''
    });

    const [sessionState, setSessionState] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'ascending' });
    const canManage = useMemo(() => sessionState && MANAGABLE_ROLES.includes(sessionState.user.role), [sessionState]);
    const canExport = useMemo(() => sessionState && sessionState.user.role === 'Super_Admin', [sessionState]);
    const rowsPerPage = 9;
    const viewModalRef = useRef(null);

    useClickOutside(viewModalRef, () => {
        if (viewingTraining) handleCloseViewModal();
    });

    const handleCloseAddEditModal = useCallback(() => {
        setIsModalOpen(false);
        setFormData(INITIAL_FORM_STATE);
        setOriginalFormData(null);
    }, []);

    const handleCloseViewModal = useCallback(() => {
        setViewingTraining(null);
    }, []);

    const fetchSyncFilterOptions = useCallback(async () => {
        if (!serverIp) return;
        try {
            const data = await apiFetch('trainings/sync-filter-options', serverIp);
            setSyncAvailableSurveys(data.surveys || []);
            setSyncAvailablePositions([]);
            setSyncPendingCount(data.pendingCount);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }, [serverIp, showToast]);

    const handleSyncClick = async () => {
        setIsSyncLoading(true);
        
        try {
            await fetchSyncFilterOptions();
            setSyncSelectedSurveyName('');
            setSyncSelectedPosition('');
            setSyncModalStep('filter');
            setSyncTrainingForm({ title: '', start_date: '', end_date: '', hours: '', venue: '' });
            setIsCreatingNewTitle(false);
            setIsSyncModalOpen(true);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsSyncLoading(false);
        }
    };

    const handleSyncSurveySelect = async (surveyName) => {
        setSyncSelectedSurveyName(surveyName);
        setSyncSelectedPosition('');
        setSyncIsSurveyDropdownOpen(false);
        
        if (surveyName) {
            try {
                const data = await apiFetch(`trainings/sync-filter-options?survey=${encodeURIComponent(surveyName)}`, serverIp);
                setSyncAvailablePositions(data.positions || []);
            } catch (err) {
                showToast(err.message, 'error');
            }
        }
    };

    const handleCloseSyncModal = useCallback(() => {
        setIsSyncModalOpen(false);
        setSyncModalStep('filter');
        setSyncSelectedSurveyName('');
        setSyncSelectedPosition('');
        setSyncModalResults(null);
        setSyncPreviewApplicants([]);
        setDuplicateMarkers(new Map());
        setExcludedApplicants(new Set());
        setSyncTrainingForm({ title: '', start_date: '', end_date: '', hours: '', venue: '' });
        setImportErrors({});
        setIsImportLoading(false);
        setIsCreatingNewTitle(false);
        setImportErrors({});
        setIsImportLoading(false);
    }, []);

    const handleSubmitImport = async () => {
        if (Object.keys(importErrors).length > 0) {
            showToast('Please fix all errors before importing.', 'error');
            return;
        }

        setIsImportLoading(true);
        try {
            // 1. Get the list of IDs only (backend expects an array of primitives, not objects)
            const applicantIds = syncPreviewApplicants
                .filter(app => !excludedApplicants.has(app.id))
                .map(app => app.id);

            // 2. Extract the specific ID from your form state
            // Verify if your state key is 'id' or 'trainingTitleId'
            const trainingTitleId = syncModalResults?.trainingTitleId || syncTrainingForm.id || syncTrainingForm.trainingTitleId;

            const result = await apiFetch('trainings/sync-finalize', serverIp, {
                method: 'POST',
                body: JSON.stringify({
                    actingUserId: sessionState.user.id,
                    applicantIds: applicantIds,     // Changed from 'applicants'
                    trainingTitleId: trainingTitleId // Changed from 'trainingData'
                })
            });

            showToast(result.message, 'success');
            setIsSyncModalOpen(false); // Close the modal after successful sync
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (err) {
            showToast(err.message || 'Failed to import trainings.', 'error');
        } finally {
            setIsImportLoading(false);
        }
    };

    const handleToggleExcludeApplicant = (id) => {
        setExcludedApplicants(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleConfirmSyncFilter = async (e) => {
        if (e) e.preventDefault();
        
        if (!syncSelectedSurveyName) {
            showToast('Please select a survey.', 'warning');
            return;
        }
        if (!syncSelectedPosition) {
            showToast('Please select a position.', 'warning');
            return;
        }
        
        // Validation based on mode
        if (isCreatingNewTitle && !syncTrainingForm.title.trim()) {
            showToast('Please enter a new training title.', 'warning');
            return;
        }
        if (!isCreatingNewTitle && !syncTrainingForm.id) {
            showToast('Please select an existing training title.', 'warning');
            return;
        }

        setIsSyncLoading(true);
        try {
            let trainingId = syncTrainingForm.id;

            // Step 1: Create the training title ONLY if creating new
            if (isCreatingNewTitle) {
                const trainingResult = await apiFetch('trainings/titles', serverIp, {
                    method: 'POST',
                    body: JSON.stringify({
                        ...syncTrainingForm,
                        actingUserId: sessionState?.user?.id
                    })
                });
                trainingId = trainingResult.id;
                // Update form state with the new ID so it persists
                setSyncTrainingForm(prev => ({ ...prev, id: trainingId }));
            }

            // Step 2: Use the new ID for bulk update and status change to 'Synced Trainings'
            const result = await apiFetch('trainings/sync-bulk-update', serverIp, {
                method: 'POST',
                body: JSON.stringify({
                    actingUserId: sessionState?.user?.id,
                    surveyName: syncSelectedSurveyName,
                    position: syncSelectedPosition,
                    trainingTitleId: trainingId
                })
            });

            // Step 3: Check for duplicates among the synced applicants
            const duplicateCheckResult = await apiFetch('employees/check-duplicates', serverIp, {
                method: 'POST',
                body: JSON.stringify({ actingUserId: sessionState.user.id })
            });

            const syncedApplicants = result.applicants || [];

            // Filter applicants: only those with "Hired" in assessment_remarks and not starting with "REPLACED"
            const filteredSyncedApplicants = syncedApplicants.filter(app => app.assessment_remarks === 'Hired');

            const duplicateMap = new Map();
            const duplicateIds = new Set();
        
            
            if (duplicateCheckResult.duplicateChecks && filteredSyncedApplicants.length > 0) {
                // Create a Set of IDs from our FILTERED list for quick lookup
                const filteredIds = new Set(filteredSyncedApplicants.map(a => a.id));
                
                duplicateCheckResult.duplicateChecks.forEach(check => {
                    // If the duplicate is one of our filtered applicants, add it to the map/set
                    if (check.duplicateStatus !== 'New Record' && filteredIds.has(check.id)) {
                        duplicateMap.set(check.id, check);
                        duplicateIds.add(check.id);
                    }
                });
            }

            setSyncPreviewApplicants(filteredSyncedApplicants);
            setDuplicateMarkers(duplicateMap);
            setExcludedApplicants(duplicateIds);
            setSyncModalResults(result);
            setSyncModalStep('preview');
            
            showToast(result.message || 'Applicants synced to training successfully!', 'success');
            await fetchData();
            await fetchSyncFilterOptions();
        } catch (err) {
            showToast(err.message || 'Failed to sync training applicants.', 'error');
        } finally {
            setIsSyncLoading(false);
        }
    };

    const fetchData = useCallback(async () => {
        if (!serverIp || !sessionState) return;
        setIsLoading(true);
        try {
            const requests = [apiFetch('trainings', serverIp)];
            if (MANAGABLE_ROLES.includes(sessionState.user.role)) {
                requests.push(apiFetch('employees', serverIp), apiFetch('trainings/titles', serverIp));
            }

            const [trainingsData, employeesData, titlesData] = await Promise.all(requests);

            setTrainings(trainingsData);
            if (employeesData) setEmployees(employeesData);
            if (titlesData) setTrainingTitles(titlesData);

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [sessionState, serverIp, showToast]);

    useEffect(() => {
        const getSession = async () => {
            try {
                const state = await window.electronAPI.getLoginState();
                if (state && state.token) {
                    setSessionState(state);
                } else {
                    throw new Error("Authentication failed. Please log in again.");
                }
            } catch (err) {
                showToast(err.message, 'error');
                setIsLoading(false);
            }
        };
        getSession();
    }, [showToast]);

    useEffect(() => {
        if (sessionState && !isSettingsLoading) {
            fetchData();
            fetchSyncFilterOptions();
        }
    }, [sessionState, isSettingsLoading, fetchData, fetchSyncFilterOptions]);

    const filteredAndSortedTrainings = useMemo(() => {
        let processedData = [...trainings];
        const query = filters.query.toLowerCase();

        if (query) {
            processedData = processedData.filter(rec => {
                const fullName = [rec.first_name, rec.middle_initial, rec.last_name, rec.suffix].filter(Boolean).join(' ').toLowerCase();
                const searchableString = `${fullName} ${rec.employee_identifier} ${rec.training_title} ${rec.venue}`.toLowerCase();
                return searchableString.includes(query);
            });
        }

        if (sortConfig.key) {
            processedData.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];
                
                if (sortConfig.key === 'employee_name') {
                    aValue = `${a.last_name} ${a.first_name}`.toLowerCase();
                    bValue = `${b.last_name} ${b.first_name}`.toLowerCase();
                } else if (typeof aValue === 'string') {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                }

                if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
                return 0;
            });
        }
        return processedData;
    }, [trainings, filters.query, sortConfig]);

    const employeeOptions = useMemo(() =>
        employees.map(emp => ({
            value: emp.id,
            label: `${emp.first_name} ${emp.middle_initial || ''} ${emp.last_name} ${emp.suffix || ''}`.replace(/\s+/g, ' ').trim()
        })).sort((a, b) => a.label.localeCompare(b.label)),
    [employees]);

    const trainingTitleOptions = useMemo(() =>
        trainingTitles.map(title => ({
            value: title.id,
            label: title.title
        })).sort((a, b) => a.label.localeCompare(b.label)),
    [trainingTitles]);

    const hasChanges = useMemo(() => {
        if (!editingTraining || !originalFormData) return true;
        return JSON.stringify(formData) !== JSON.stringify(originalFormData);
    }, [formData, originalFormData, editingTraining]);

    const isManualTrainingValid = useMemo(() => {
        const endDateStr = formData.end_date;
        if (!endDateStr) return true;
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const [year, month, day] = endDateStr.split('-').map(Number);
            const localEndDate = new Date(year, month - 1, day);
            return localEndDate <= today;
        } catch (e) {
            return false;
        }
    }, [formData.end_date]);

    const isTrainingEndDateValid = useMemo(() => {
        const endDateStr = syncTrainingForm.end_date;
        if (!endDateStr) {
            return true; // Allow if no end date is set
        }
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Normalize to start of day
            const [year, month, day] = endDateStr.split('-').map(Number);
            const localEndDate = new Date(year, month - 1, day);
            // Allow proceed only when end date is today or earlier
            return localEndDate <= today;
        } catch (e) {
            return false; // Invalid date format
        }
    }, [syncTrainingForm.end_date]);

    const isStartEndValid = useMemo(() => {
        const s = syncTrainingForm.start_date;
        const e = syncTrainingForm.end_date;
        if (!s || !e) return true; // not enough info yet
        try {
            const start = new Date(s);
            const end = new Date(e);
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
            return start <= end;
        } catch (err) {
            return false;
        }
    }, [syncTrainingForm.start_date, syncTrainingForm.end_date]);

    if (!sessionState || isLoading || isSettingsLoading) {
        return (
          <div className="p-4 sm:p-6 lg:p-8">
            <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Training Records</h1>
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
    const totalItems = filteredAndSortedTrainings.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const paginatedList = filteredAndSortedTrainings.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending'
            ? <FaSortUp className="inline-block ml-1 text-blue-500" />
            : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };
    
    const handleFilterChange = (e) => setFilters({ query: e.target.value });
    const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
    const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
    const handleAddClick = () => { 
        setEditingTraining(null); 
        setFormData(INITIAL_FORM_STATE); 
        setOriginalFormData(null);
        setIsModalOpen(true); 
    };
    const handleViewClick = (training) => setViewingTraining(training);
    
    const handleEditClick = (training) => {
        setEditingTraining(training);
        const initialData = {
            employee_id: training.employee_id,
            training_title_id: training.training_title_id,
            start_date: formatDateForInput(training.start_date),
            end_date: formatDateForInput(training.end_date),
            hours: training.hours,
            venue: training.venue
        };
        setFormData(initialData);
        setOriginalFormData(initialData);
        setIsModalOpen(true);
    };

    const handleDeleteClick = (training) => setTrainingToDelete(training);
    
    const handleFormSubmit = async (e) => {
        e.preventDefault();

        const endpoint = editingTraining ? `trainings/${editingTraining.id}` : 'trainings';
        const method = editingTraining ? 'PUT' : 'POST';
        const body = { ...formData, actingUserId: sessionState?.user?.id };

        try {
            await apiFetch(endpoint, serverIp, { method, body: JSON.stringify(body) });
            setIsModalOpen(false);
            fetchData();
            showToast(editingTraining ? 'Training record updated successfully.' : 'Training record assigned successfully.', 'success');
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
        if (!trainingToDelete) return;
        try {
            await apiFetch(`trainings/${trainingToDelete.id}`, serverIp, {
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: sessionState?.user?.id })
            });
            setTrainingToDelete(null);
            fetchData();
            showToast('Training record deleted successfully.', 'success');
        } catch (err) {
            showToast(err.message, 'error');
            setTrainingToDelete(null);
        }
    };
    
    const handleTitleChange = (titleId) => {
        const selectedTitle = trainingTitles.find(t => t.id === parseInt(titleId, 10));

        setFormData(prev => ({ ...prev, training_title_id: titleId }));

        if (selectedTitle) {
            setFormData(prev => ({
                ...prev,
                training_title_id: titleId,
                start_date: selectedTitle.start_date ? formatDateForInput(selectedTitle.start_date) : '',
                end_date: selectedTitle.end_date ? formatDateForInput(selectedTitle.end_date) : '',
                hours: selectedTitle.hours || '',
                venue: selectedTitle.venue || ''
            }));
        }
    };
    
    const handleSelectSingle = (trainingId) => {
        const newSelection = new Set(selectedTrainings);
        newSelection.has(trainingId) ? newSelection.delete(trainingId) : newSelection.add(trainingId);
        setSelectedTrainings(newSelection);
    };

    const handleSelectAll = (event) => {
        if (event.target.checked) {
            setSelectedTrainings(new Set(filteredAndSortedTrainings.map(rec => rec.id)));
        } else {
            setSelectedTrainings(new Set());
        }
    };

    const handleClearSearch = () => setFilters({ query: '' });

    const handleExportAll = () => {
        if (trainings.length === 0) return;
        const headers = ["employee_id", "fullname", "training_title"];
        const csvContent = [headers.join(','), ...trainings.map(item => {
            const fullName = [item.first_name, item.middle_initial, item.last_name, item.suffix].filter(Boolean).join(' ');
            const row = [item.employee_identifier, fullName, item.training_title];
            return row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',');
        })].join('\n');
        
        handleCsvDownload(csvContent, 'exported_training_records.csv');
    };

    const handleCsvDownload = async (content, fileName) => {
        setIsProgressComplete(false);
        setProgressMessage('Preparing file...');
        setSavedFilePath(null);
        setIsProgressModalOpen(true);

        try {
            const result = await window.electronAPI.saveCsvFile({ content, fileName });
            if (result.status === 'completed') {
                setIsProgressComplete(true);
                setProgressMessage(result.message);
                setSavedFilePath(result.path);
            } else if (result.status === 'failed') {
                setIsProgressComplete(true);
                setProgressMessage(`Error: ${result.message}`);
                setSavedFilePath(null);
            } else {
                setIsProgressModalOpen(false);
            }
        } catch (err) {
            console.error('An unexpected error occurred during the download process:', err);
            setIsProgressComplete(true);
            setProgressMessage('An unexpected error occurred. Please check the console.');
        }
    };



    return (
        <div>
            <ToastContainer toasts={toasts} onClose={removeToast} />
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Training Records</h1>
                <div className="relative">
                    <input
                        type="text"
                        name="query"
                        value={filters.query}
                        onChange={handleFilterChange}
                        placeholder="Search Records..."
                        className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {filters.query && (
                        <button onClick={handleClearSearch} type="button" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    )}
                </div>
            </div>
            
            {canManage && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                    <button onClick={handleAddClick} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"><FiPlus className="w-4 h-4" />Assign Training</button>
                    <div className="flex-grow" />
                    <button onClick={handleSyncClick} disabled={isSyncLoading || syncPendingCount === 0} title={syncPendingCount === 0 ? 'No assessed applicants available for training record assignment' : `${syncPendingCount} assessed applicant/s ready for training record assignment`} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"><FiDownload className="w-4 h-4" />{isSyncLoading ? 'Loading...' : `Assign Training to Hired (${syncPendingCount})`}</button>
                    {canExport && <button onClick={handleExportAll} title="Export all training records" className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 bg-yellow-400 rounded-lg hover:bg-yellow-500 dark:bg-yellow-600 dark:hover:bg-yellow-700">
                        <FiDownload className="w-4 h-4" />Export All
                    </button>}
                </div>
            )}
            
            <div className="overflow-x-auto bg-white h-[760px] rounded-lg shadow dark:bg-gray-800">
                <table className="min-w-full text-sm leading-normal">
                    <thead>
                        <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                            {canManage && (
                            <th className="w-12 px-5 py-3.5">
                                <input type="checkbox" onChange={handleSelectAll} checked={totalItems > 0 && selectedTrainings.size === totalItems} ref={el => { if (el) { el.indeterminate = selectedTrainings.size > 0 && selectedTrainings.size < totalItems; } }} />
                            </th>
                            )}
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('employee_name')} className="font-semibold flex items-center uppercase">Employee {getSortIcon('employee_name')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('training_title')} className="font-semibold flex items-center uppercase">Training Title {getSortIcon('training_title')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('start_date')} className="font-semibold flex items-center uppercase">Start Date {getSortIcon('start_date')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('end_date')} className="font-semibold flex items-center uppercase">End Date {getSortIcon('end_date')}</button></th>
                            <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('hours')} className="font-semibold flex items-center uppercase">Hours {getSortIcon('hours')}</button></th>
                            <th className="px-5 py-3.5 text-center tracking-wider font-semibold uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedList.length > 0 ? paginatedList.map(rec => {
                            const fullName = [rec.first_name, rec.middle_initial, rec.last_name, rec.suffix].filter(Boolean).join(' ');
                            return (
                                <tr key={rec.id} className="transition-colors duration-200 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    {canManage && (
                                    <td className="px-5 py-4 text-center"><input type="checkbox" checked={selectedTrainings.has(rec.id)} onChange={() => handleSelectSingle(rec.id)} /></td>
                                    )}
                                    <td className="px-5 py-4"><p className="font-medium text-gray-900 dark:text-white">{fullName}</p><p className="text-sm text-gray-500 dark:text-gray-400">{rec.employee_identifier}</p></td>
                                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{rec.training_title}</td>
                                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                                        {rec.start_date ? format(parseISO(rec.start_date), 'MM/dd/yyyy') : 'N/A'}
                                    </td>
                                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">
                                        {rec.end_date ? format(parseISO(rec.end_date), 'MM/dd/yyyy') : 'N/A'}
                                    </td>
                                    <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{rec.hours}</td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center justify-center space-x-1">
                                            <button onClick={() => handleViewClick(rec)} title="View Training Record" className="p-1 rounded-lg transition-colors text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700"><FaEye className="w-4 h-4" /></button>
                                            {canManage && <button onClick={() => handleEditClick(rec)} title="Edit Training Record" className="p-1 rounded-lg transition-colors text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-900/20"><FaPencilAlt className="w-4 h-4" /></button>}
                                            {canManage && <button onClick={() => handleDeleteClick(rec)} title="Delete Training Record" className="p-1 rounded-lg transition-colors text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-500 dark:hover:text-red-300 dark:hover:bg-red-900/20"><FaTrash className="w-4 h-4" /></button>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr><td colSpan="7" className="py-16 text-lg font-semibold text-center text-gray-500 dark:text-gray-400">No Records Found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            
            <div className="flex justify-between items-center mt-1">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                    Showing {totalItems > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0} to {Math.min(currentPage * rowsPerPage, totalItems)} of {totalItems} records
                </span>
                <div className="flex items-center space-x-2">
                    <button onClick={handlePreviousPage} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">Previous</button>
                    <span className="px-2 text-gray-700 dark:text-gray-300">{currentPage}</span>
                    <button onClick={handleNextPage} disabled={currentPage >= totalPages} title={currentPage >= totalPages ? 'Already on last page' : 'Go to next page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">Next</button>
                </div>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingTraining ? 'Edit Training Record' : 'Assign Training to Employee'}</h2>
                        </div>
                        <form onSubmit={handleFormSubmit} id="trainingForm" className="flex-auto p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Employee Name <span className="text-red-500">*</span></label>
                                <SearchableDropdown
                                    id="employee_id"
                                    options={employeeOptions}
                                    value={formData.employee_id}
                                    onChange={(value) => setFormData(prev => ({ ...prev, employee_id: value }))}
                                    placeholder="Search or Select Employee"
                                    required
                                    disabled={!!editingTraining}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Training Title <span className="text-red-500">*</span></label>
                                <SearchableDropdown
                                    id="training_title_id"
                                    options={trainingTitleOptions}
                                    value={formData.training_title_id}
                                    onChange={handleTitleChange}
                                    placeholder="Search or Select a Training Title"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
                                    <input
                                        type="date"
                                        value={formData.start_date}
                                        readOnly
                                        disabled
                                        className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date</label>
                                    <input
                                        type="date"
                                        value={formData.end_date}
                                        readOnly
                                        disabled
                                        className={`mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-500 dark:text-gray-400 cursor-not-allowed ${!isManualTrainingValid ? 'border-red-500 dark:border-red-500 text-red-500 dark:text-red-400' : ''}`}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Hours</label>
                                    <input
                                        type="text"
                                        value={formData.hours}
                                        readOnly
                                        disabled
                                        className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Venue</label>
                                    <input
                                        type="text"
                                        value={formData.venue}
                                        readOnly
                                        disabled
                                        className="mt-1 block w-full p-2 bg-gray-100 dark:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-500 dark:text-gray-400 cursor-not-allowed"
                                    />
                                </div>
                            </div>
                        </form>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                            <button type="button" onClick={handleCloseAddEditModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
                            <button type="submit" form="trainingForm" disabled={!formData.employee_id || !formData.training_title_id || (editingTraining && !hasChanges) || !isManualTrainingValid} title={!formData.employee_id || !formData.training_title_id ? 'Please select both employee and training title' : !isManualTrainingValid ? 'Cannot assign: Training end date is in the future' : (editingTraining && !hasChanges) ? 'No changes made' : ''} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"><FiSave className="w-4 h-4" />Save Record</button>
                        </div>
                    </div>
                </div>
            )}
            {trainingToDelete && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="z-50 w-full max-w-sm p-6 bg-white rounded-lg shadow-2xl dark:bg-gray-800">
                        <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-white">Confirm Deletion</h2>
                        <p className="mb-6 text-gray-600 dark:text-gray-300">Are you sure? This action cannot be undone.</p>
                        <div className="flex justify-end space-x-4">
                            <button onClick={() => setTrainingToDelete(null)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
                            <button onClick={confirmDelete} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"><FaTrash className="w-4 h-4" />Delete</button>
                        </div>
                    </div>
                </div>
            )}
            {viewingTraining && (
                <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black bg-opacity-50">
                    <div ref={viewModalRef} className="z-50 w-full max-w-lg p-6 bg-white rounded-lg shadow-2xl dark:bg-gray-800">
                        <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">Training Details</h2>
                        <div className="space-y-4 text-sm">
                            <div>
                                <label className="block font-medium text-gray-500 dark:text-gray-400">Employee Name</label>
                                <p className="text-gray-800 dark:text-white">{[viewingTraining.first_name, viewingTraining.middle_initial, viewingTraining.last_name, viewingTraining.suffix].filter(Boolean).join(' ')}</p>
                            </div>
                            <div>
                                <label className="block font-medium text-gray-500 dark:text-gray-400">Training Title</label>
                                <p className="text-gray-800 dark:text-white">{viewingTraining.training_title}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block font-medium text-gray-500 dark:text-gray-400">Start Date</label>
                                    <p className="text-gray-800 dark:text-white">
                                        {viewingTraining.start_date ? format(parseISO(viewingTraining.start_date), 'MMMM d, yyyy') : 'N/A'}
                                    </p>
                                </div>
                                <div>
                                    <label className="block font-medium text-gray-500 dark:text-gray-400">End Date</label>
                                      <p className="text-gray-800 dark:text-white">
                                        {viewingTraining.end_date ? format(parseISO(viewingTraining.end_date), 'MMMM d, yyyy') : 'N/A'}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <label className="block font-medium text-gray-500 dark:text-gray-400">Number of Hours</label>
                                <p className="text-gray-800 dark:text-white">{viewingTraining.hours}</p>
                            </div>
                            <div>
                                <label className="block font-medium text-gray-500 dark:text-gray-400">Venue / Location</label>
                                <p className="text-gray-800 dark:text-white">{viewingTraining.venue}</p>
                            </div>
                        </div>
                        <div className="flex justify-end mt-6">
                            <button type="button" onClick={handleCloseViewModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Close</button>
                        </div>
                    </div>
                </div>
            )}
            <ProgressModal
                isOpen={isProgressModalOpen}
                onClose={() => setIsProgressModalOpen(false)}
                statusMessage={progressMessage}
                isComplete={isProgressComplete}
                filePath={savedFilePath}
            />
            {isSyncModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-2xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Sync Training to Applicants</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select Survey, Position, and Training Title to assign to applicants</p>
                        </div>

                        {syncModalStep === 'filter' ? (
                            <form onSubmit={handleConfirmSyncFilter} className="flex flex-col min-h-0">
                                <div className="flex-auto p-6 overflow-y-auto space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Survey Name <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setSyncIsSurveyDropdownOpen(!syncIsSurveyDropdownOpen)}
                                                    className="w-full text-left px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                                                >
                                                    <span className="block whitespace-normal break-words">{syncSelectedSurveyName || 'Select a survey...'}</span>
                                                </button>
                                                {syncIsSurveyDropdownOpen && (
                                                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
                                                        {syncAvailableSurveys.length > 0 ? (
                                                            <ul className="max-h-60 overflow-y-auto">
                                                                {syncAvailableSurveys.map((survey) => (
                                                                    <li key={survey} className="cursor-pointer px-4 py-2 hover:bg-blue-500 hover:text-white text-gray-800 dark:text-gray-200 whitespace-normal break-words" onClick={() => handleSyncSurveySelect(survey)}>
                                                                        {survey}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : (
                                                            <div className="px-4 py-2 text-gray-500 dark:text-gray-400">No surveys found</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Position <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    disabled={!syncSelectedSurveyName}
                                                    onClick={() => setSyncIsPositionDropdownOpen(!syncIsPositionDropdownOpen)}
                                                    className="w-full text-left px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                                                >
                                                    <span className="block whitespace-normal break-words">{syncSelectedPosition || 'Select a position...'}</span>
                                                </button>
                                                {syncIsPositionDropdownOpen && (
                                                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
                                                        {syncAvailablePositions.length > 0 ? (
                                                            <ul className="max-h-60 overflow-y-auto">
                                                                {syncAvailablePositions.map((position) => (
                                                                    <li key={position} className="cursor-pointer px-4 py-2 hover:bg-blue-500 hover:text-white text-gray-800 dark:text-gray-200 whitespace-normal break-words" onClick={() => { setSyncSelectedPosition(position); setSyncIsPositionDropdownOpen(false); }}>
                                                                        {position}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : (
                                                            <div className="px-4 py-2 text-gray-500 dark:text-gray-400">No positions found</div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Training Information</h4>
                                        
                                        <div className="mb-4 flex items-center">
                                            <input 
                                                type="checkbox" 
                                                id="createNewTitle" 
                                                checked={isCreatingNewTitle} 
                                                onChange={(e) => {
                                                    setIsCreatingNewTitle(e.target.checked);
                                                    // Reset form when toggling
                                                    setSyncTrainingForm({ title: '', start_date: '', end_date: '', hours: '', venue: '' });
                                                }}
                                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                            <label htmlFor="createNewTitle" className="ml-2 text-sm font-medium text-gray-900 dark:text-gray-300">Create a new Training Title</label>
                                        </div>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Training Title <span className="text-red-500">*</span></label>
                                                {isCreatingNewTitle ? (
                                                    <textarea
                                                        type="text"
                                                        required
                                                        value={syncTrainingForm.title}
                                                        onChange={(e) => setSyncTrainingForm({ ...syncTrainingForm, title: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200"
                                                        placeholder="Enter new training title"
                                                    />
                                                ) : (
                                                    <SearchableDropdown
                                                        id="sync_training_title_id"
                                                        options={trainingTitleOptions}
                                                        value={syncTrainingForm.id}
                                                        onChange={(val) => {
                                                            const selected = trainingTitles.find(t => t.id === val);
                                                            if (selected) {
                                                                setSyncTrainingForm({
                                                                    id: selected.id,
                                                                    title: selected.title,
                                                                    start_date: formatDateForInput(selected.start_date),
                                                                    end_date: formatDateForInput(selected.end_date),
                                                                    hours: selected.hours || '',
                                                                    venue: selected.venue || ''
                                                                });
                                                            }
                                                        }}
                                                        placeholder="Select existing training..."
                                                        required
                                                    />
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date <span className="text-red-500">*</span></label>
                                                    <input
                                                        type="date"
                                                        value={syncTrainingForm.start_date}
                                                        onChange={(e) => setSyncTrainingForm({ ...syncTrainingForm, start_date: e.target.value })}
                                                        disabled={!isCreatingNewTitle}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date <span className="text-red-500">*</span></label>
                                                    <input
                                                        type="date"
                                                        value={syncTrainingForm.end_date}
                                                        onChange={(e) => setSyncTrainingForm({ ...syncTrainingForm, end_date: e.target.value })}
                                                        disabled={!isCreatingNewTitle}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Training Hours <span className="text-red-500">*</span></label>
                                                    <input
                                                        type="number"
                                                        value={syncTrainingForm.hours}
                                                        onChange={(e) => setSyncTrainingForm({ ...syncTrainingForm, hours: e.target.value })}
                                                        disabled={!isCreatingNewTitle}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        placeholder="0"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Venue <span className="text-red-500">*</span></label>
                                                    <textarea
                                                        type="text"
                                                        value={syncTrainingForm.venue}
                                                        onChange={(e) => setSyncTrainingForm({ ...syncTrainingForm, venue: e.target.value })}
                                                        disabled={!isCreatingNewTitle}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        placeholder="Enter venue"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                                    <button 
                                        type="button" 
                                        onClick={handleCloseSyncModal} 
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
                                    >
                                        <FiX className="w-4 h-4" />Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            !syncSelectedSurveyName ||
                                            !syncSelectedPosition ||
                                            isSyncLoading ||
                                            !isTrainingEndDateValid ||
                                            !isStartEndValid ||
                                            (isCreatingNewTitle
                                                ? !(syncTrainingForm.title && syncTrainingForm.start_date && syncTrainingForm.end_date && syncTrainingForm.hours && syncTrainingForm.venue)
                                                : !syncTrainingForm.id)
                                        }
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow"
                                        title={
                                            !syncSelectedSurveyName ? 'Please select a survey' :
                                            !syncSelectedPosition ? 'Please select a position' :
                                            (isCreatingNewTitle && !(syncTrainingForm.title && syncTrainingForm.start_date && syncTrainingForm.end_date && syncTrainingForm.hours && syncTrainingForm.venue)) ? 'Please fill all training fields (title, start date, end date, hours, venue)' :
                                            (isCreatingNewTitle && !isStartEndValid) ? 'Start date must be on or before end date' :
                                            !isCreatingNewTitle && !syncTrainingForm.id ? 'Please select an existing training' :
                                            !isTrainingEndDateValid ? 'Cannot proceed: Training end date must be today or earlier.' :
                                            isSyncLoading ? 'Processing...' :
                                            'Proceed to sync applicants'
                                        }
                                    >
                                        <FiDownload className="w-4 h-4" />{isSyncLoading ? 'Processing...' : 'Proceed'}
                                    </button>
                                </div>
                            </form>
                        ) : syncModalStep === 'preview' ? (
                            <div className="flex flex-col min-h-0">
                                <div className="flex-auto p-6 overflow-y-auto space-y-4">
                                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                        <p className="text-sm text-blue-800 dark:text-blue-300">
                                            Found <strong>{syncPreviewApplicants.length}</strong> applicant(s) synced for <strong>{syncSelectedSurveyName}</strong> — <strong>{syncSelectedPosition}</strong>.
                                            {duplicateMarkers.size > 0 && <span className="text-yellow-700 dark:text-yellow-400"> ⚠ <strong>{duplicateMarkers.size}</strong> possible duplicate(s) detected.</span>}
                                        </p>
                                        <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 italic">Status changed to 'Synced Trainings'. Please review and confirm.</p>
                                    </div>
                                    
                                    <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800">
                                                <tr>
                                                    <th className="px-3 py-3 text-left font-semibold text-gray-900 dark:text-white">Validation</th>
                                                    <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Name</th>
                                                    <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Survey</th>
                                                    <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Position</th>
                                                    <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Assessment Remarks</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                {syncPreviewApplicants.map((app) => {
                                                    const duplicate = duplicateMarkers.get(app.id);
                                                    const isExcluded = excludedApplicants.has(app.id);
                                                    return (
                                                        <React.Fragment key={app.id}>
                                                            <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${duplicate ? (isExcluded ? 'opacity-60 bg-gray-50 dark:bg-gray-800' : 'bg-yellow-50 dark:bg-yellow-900/10') : ''}`}>
                                                                <td className="px-3 py-3">
                                                                    {duplicate ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={!isExcluded}
                                                                                onChange={() => handleToggleExcludeApplicant(app.id)}
                                                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                                                                            />
                                                                            <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400">DUPLICATE</span>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                                                                            <FiDownload className="w-3 h-3" /> Valid
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="p-3">
                                                                    <div className="font-medium text-gray-900 dark:text-white">
                                                                        {[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}
                                                                    </div>
                                                                </td>
                                                                <td className="p-3 text-gray-600 dark:text-gray-400">{app.survey_name}</td>
                                                                <td className="p-3 text-gray-600 dark:text-gray-400">{app.position}</td>
                                                                <td className="p-3 text-gray-600 dark:text-gray-400">{app.assessment_remarks}</td>
                                                            </tr>
                                                            {duplicate && !isExcluded && (
                                                                <tr className="bg-yellow-50/30 dark:bg-yellow-900/5">
                                                                    <td colSpan="4" className="px-6 py-2">
                                                                        <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2">
                                                                            <span className="p-1 rounded-full bg-yellow-100 dark:bg-yellow-900 text-yellow-600">!</span>
                                                                            <span>Matches existing: <span className="font-semibold">{duplicate.duplicateMatch?.similarName || 'Database match'}</span></span>
                                                                            {duplicate.duplicateMatch?.existingEmployeeId && <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1 rounded">ID: {duplicate.duplicateMatch.existingEmployeeId}</span>}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                                    <button 
                                        type="button" 
                                        onClick={handleCloseSyncModal} 
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                                    >
                                        <FiX className="w-4 h-4" />Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSubmitImport}
                                        disabled={Object.keys(importErrors).length > 0 || isImportLoading}
                                        title={isImportLoading ? 'Importing records...' : Object.keys(importErrors).length > 0 ? 'Please fix all errors before importing' : 'Import selected records'}
                                        className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isImportLoading ? 'Importing...' : <><FiUpload className="w-4 h-4" />Import Records</>}
                                    </button>
                                </div>
                            </div>
                        ) : syncModalStep === 'results' && syncModalResults ? (
                            <>
                                <div className="flex-auto p-6 overflow-y-auto space-y-4">
                                    <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                        <p className="text-sm text-green-800 dark:text-green-300 font-medium">{syncModalResults.message}</p>
                                    </div>
                                </div>
                                <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                                    <button 
                                        type="button" 
                                        onClick={handleCloseSyncModal} 
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                                    >
                                        <FiX className="w-4 h-4" />Close
                                    </button>
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Trainings;