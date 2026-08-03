import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaEye, FaPencilAlt, FaStar, FaTrash, FaArrowRight, FaCheck, FaArrowLeft } from 'react-icons/fa';
import { FiPlus, FiDownload, FiX, FiSave, FiUpload } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import ProgressModal from '../components/Progress';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const INITIAL_FORM_STATE = {
  employee_id: '',
  position_id: '',
  survey_id: '',
  focal_person_id: '',
  contract_start_date: '',
  contract_end_date: ''
};

const RATING_CRITERIA = [
  {
    key: 'timeliness',
    label: 'Timeliness',
    description: 'Measures the ability to complete and submit assigned work outputs on time without compromising set deadlines.',
  },
  {
    key: 'quality',
    label: 'Quality',
    description: 'Measures the accuracy, completeness, and reliability of work outputs relative to the expected standards.',
  },
  {
    key: 'quantity',
    label: 'Quantity',
    description: 'Measures the volume of work accomplished against the target number of outputs within the contract period.',
  },
];

const SCORE_DESCRIPTIONS = {
  1: { label: 'Poor',               desc: 'Performance was consistently below expectations and/or reasonable progress towards critical goals was not achieved.' },
  2: { label: 'Unsatisfactory',     desc: 'Performance failed to meet expectations, and/or one or more of the most critical goals were not met.' },
  3: { label: 'Satisfactory',       desc: 'Performance met expectations in terms of quality of work, efficiency, and timeliness.' },
  4: { label: 'Very Satisfactory',  desc: 'Performance exceeded expectations. All goals, objectives and targets were achieved above the established standards.' },
  5: { label: 'Outstanding',        desc: 'Performance represents an extraordinary level of achievement and commitment in terms of quantity, quality, and time. Employees at this performance level should have demonstrated exceptional job mastery in all major areas of resposibility' },
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

const SearchableDropdown = ({ options, value, onChange, placeholder, id, required }) => {
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
        className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
        value={displayValue}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
          setSearchTerm('');
        }}
        placeholder={placeholder}
        required={required && !value}
      />

      {isOpen && (
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


const formatDateForExport = (dateString) => {
    if (!dateString) return '';
    try {
        const date = parseISO(dateString);
        return format(date, 'yyyy-MM-dd');
    } catch (error) {
        return '';
    }
};

const formatDateForInput = (dateString) => {
  if (!dateString) return '';
  try {
      return format(parseISO(dateString), 'yyyy-MM-dd');
  } catch (error) {
      return '';
  }
};

const Employments = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { toasts, showToast, removeToast } = useToast();
  const [employments, setEmployments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [focalPersons, setFocalPersons] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({ query: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [editingRecord, setEditingRecord] = useState(null);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [recordToDelete, setRecordToDelete] = useState(null);
  const [originalFormData, setOriginalFormData] = useState(null);

  const [selectedRecords, setSelectedRecords] = useState(new Set());

  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isProgressComplete, setIsProgressComplete] = useState(false);
  const [savedFilePath, setSavedFilePath] = useState(null);

  const [isBatchEditModalOpen, setIsBatchEditModalOpen] = useState(false);
  const [batchEditFormData, setBatchEditFormData] = useState({ contract_start_date: '', contract_end_date: '' });

  // Sync Modal States
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncModalStep, setSyncModalStep] = useState('filter');
  const [isSyncLoading, setIsSyncLoading] = useState(false);
  const [syncSelectedSurveyName, setSyncSelectedSurveyName] = useState('');
  const [syncSelectedPosition, setSyncSelectedPosition] = useState('');
  const [syncAvailableSurveys, setSyncAvailableSurveys] = useState([]);
  const [syncAvailablePositions, setSyncAvailablePositions] = useState([]);
  const [syncPendingCount, setSyncPendingCount] = useState(0);
  const [syncPreviewApplicants, setSyncPreviewApplicants] = useState([]);
  const [excludedApplicants, setExcludedApplicants] = useState(new Set());
  const [syncIsSurveyDropdownOpen, setSyncIsSurveyDropdownOpen] = useState(false);
  const [syncIsPositionDropdownOpen, setSyncIsPositionDropdownOpen] = useState(false);

  const [sessionState, setSessionState] = useState(null);
  const [userPermissions, setUserPermissions] = useState({
    canManage: false,
    isSuperAdmin: false,
    isFocalPerson: false,
    isHrDesignate: false,
    canDelete: false,
  });

  const [focalPersonView, setFocalPersonView] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'ascending' });
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [ratingRecord, setRatingRecord] = useState(null);
  const [ratingCriteria, setRatingCriteria] = useState({ timeliness: '', quality: '', quantity: '' });
  const [ratingRemarks, setRatingRemarks] = useState('');
  const [isRatingConfirmOpen, setIsRatingConfirmOpen] = useState(false);
  
  const viewModalRef = useRef(null);
  const employeeDropdownRef = useRef(null);
  const positionDropdownRef = useRef(null);
  const surveyDropdownRef = useRef(null);

  const computedAverage = useMemo(() => {
    const scores = Object.values(ratingCriteria).map(v => parseInt(v)).filter(v => !isNaN(v));
    if (scores.length < 3) return null;
    return (scores.reduce((a, b) => a + b, 0) / 3);
  }, [ratingCriteria]);

  const ratingScoreOptions = useMemo(() => 
    [1, 2, 3, 4, 5].map(score => ({
        value: score,
        label: `${score} — ${SCORE_DESCRIPTIONS[score].label}`
    })),
  []);

  const computedRating = useMemo(() => {
    if (computedAverage === null) return '';
    if (computedAverage >= 4.5) return 'Outstanding';
    if (computedAverage >= 3.5) return 'Very Satisfactory';
    if (computedAverage >= 2.5) return 'Satisfactory';
    if (computedAverage >= 1.5) return 'Unsatisfactory';
    return 'Poor';
  }, [computedAverage]);

  const computedRatingColor = useMemo(() => {
    const map = {
      'Outstanding':       'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700',
      'Very Satisfactory': 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700',
      'Satisfactory':      'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700',
      'Unsatisfactory':    'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700',
      'Poor':              'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700',
    };
    return computedRating ? map[computedRating] : 'text-gray-400 bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700';
  }, [computedRating]);

  const isSyncSurveyContractEnded = useMemo(() => {
    if (!syncSelectedSurveyName || !surveys.length) {
        return true;
    }
    const selectedSurvey = surveys.find(s => s.name === syncSelectedSurveyName);
    if (!selectedSurvey || !selectedSurvey.contract_end_date) {
        return true;
    }
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let dateStr = selectedSurvey.contract_end_date;
        if (typeof dateStr === 'string' && dateStr.includes('T')) {
            dateStr = dateStr.split('T')[0];
        }
        const [year, month, day] = dateStr.split('-').map(Number);
        const localContractEndDate = new Date(year, month - 1, day);
        return localContractEndDate <= today;
    } catch (e) {
        return false;
    }
  }, [syncSelectedSurveyName, surveys]);

  useClickOutside(viewModalRef, () => {
      if (viewingRecord) handleCloseViewModal();
  });

  const handleCloseAddEditModal = useCallback(() => {
      setIsModalOpen(false);
      setFormData(INITIAL_FORM_STATE);
      setOriginalFormData(null);
  }, []);

  const handleCloseViewModal = useCallback(() => {
      setViewingRecord(null);
  }, []);

  const handleCloseBatchEditModal = useCallback(() => {
      setIsBatchEditModalOpen(false);
  }, []);

  const fetchData = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const [empData, posData, fpData, recordsData, surveysData] = await Promise.all([
        apiFetch('employees', serverIp),
        apiFetch('employments/positions', serverIp),
        apiFetch('employments/focal-persons', serverIp),
        apiFetch('employments', serverIp),
        apiFetch('employments/surveys', serverIp)
      ]);

      setEmployees(empData);
      setPositions(posData);
      setFocalPersons(fpData);
      setEmployments(recordsData);
      setSurveys(surveysData);
    } catch (err) {
      showToast("Failed to fetch data. Please check server connection.", 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, showToast]); // 4. ADD serverIp dependency

  const fetchSyncFilterOptions = useCallback(async () => {
    if (!serverIp) return;
    try {
        const data = await apiFetch('employments/sync-filter-options', serverIp);
        setSyncAvailableSurveys(data.surveys || []);
        setSyncAvailablePositions([]);
        setSyncPendingCount(data.pendingCount || 0);
    } catch (err) {
        showToast(err.message, 'error');
    }
  }, [serverIp, showToast]);

  const focalPersonMap = useMemo(() => {
      if (!focalPersons.length) return new Map();
      return new Map(focalPersons.map(fp => [
          fp.id,
          `${fp.first_name} ${fp.middle_initial || ''} ${fp.last_name} ${fp.suffix || ''}`.replace(/\s+/g, ' ').trim()
      ]));
  }, [focalPersons]);

  const employmentsWithNames = useMemo(() => {
      return employments.map(emp => ({
          ...emp,
          focal_person_name: emp.focal_person_name || focalPersonMap.get(emp.focal_person_id)
      }));
  }, [employments, focalPersonMap]);

  // --- SESSION & PERMISSIONS ---
  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        if (state && state.token) {
          setSessionState(state);
          const { role } = state.user;
          setUserPermissions({
            canManage: ['Super_Admin', 'Admin'].includes(role),
            isSuperAdmin: role === 'Super_Admin',
            isFocalPerson: role === 'Focal Person',
            isHrDesignate: role === 'PACD',
            canDelete: ['Super_Admin', 'Admin', 'PACD'].includes(role)
          });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 5. UPDATE data fetch trigger
    if (sessionState && !isSettingsLoading) {
      fetchData();
      fetchSyncFilterOptions();
    }
  }, [sessionState, isSettingsLoading, fetchData, fetchSyncFilterOptions]);


  const accessibleEmployments = useMemo(() => {
    if (!sessionState) return [];
    const { role } = sessionState.user;
    if (['Super_Admin', 'Admin', 'PACD', 'Focal Person', 'User'].includes(role)) {
      return employmentsWithNames;
    }
    return [];
  }, [employmentsWithNames, sessionState]);

  const spreadsheetList = useMemo(() => {
    let dataToShow = accessibleEmployments;
    const { user } = sessionState || {};

    if (userPermissions.isFocalPerson && focalPersonView === 'assigned') {
      dataToShow = dataToShow.filter(rec => rec.focal_person_id === user.id && !rec.rating);
    }

    const query = filters.query.toLowerCase();
    if (query) {
      dataToShow = dataToShow.filter(rec => {
        const fullName = [rec.first_name, rec.middle_initial, rec.last_name, rec.suffix].filter(Boolean).join(' ').toLowerCase();
        const searchableString = `${fullName} ${rec.emp_id_str} ${rec.position_title} ${rec.survey_name}`.toLowerCase();
        return searchableString.includes(query);
      });
    }

    return [...dataToShow].sort((a, b) => {
      if (a[sortConfig.key] < b[sortConfig.key]) {
        return sortConfig.direction === 'ascending' ? -1 : 1;
      }
      if (a[sortConfig.key] > b[sortConfig.key]) {
        return sortConfig.direction === 'ascending' ? 1 : -1;
      }
      return 0;
    });
  }, [accessibleEmployments, filters.query, sortConfig, userPermissions.isFocalPerson, focalPersonView, sessionState]);

  // --- MEMOIZED OPTIONS FOR SEARCHABLE DROPDOWNS ---
  const employeeOptions = useMemo(() =>
    employees.map(emp => ({
      value: emp.id,
      label: `${emp.first_name} ${emp.middle_initial || ''} ${emp.last_name} ${emp.suffix || ''}`.replace(/\s+/g, ' ').trim()
    })).sort((a, b) => a.label.localeCompare(b.label)),
  [employees]);

  const positionOptions = useMemo(() =>
    positions.map(pos => ({
      value: pos.id,
      label: pos.position_title
    })).sort((a, b) => a.label.localeCompare(b.label)),
  [positions]);

  const surveyOptions = useMemo(() =>
    surveys.map(survey => ({
      value: survey.id,
      label: survey.name
    })).sort((a, b) => a.label.localeCompare(b.label)),
  [surveys]);

  // --- END OF MEMOIZED OPTIONS ---


  const rowsPerPage = 9;
  const totalItems = spreadsheetList.length;
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  const paginatedSpreadsheetList = spreadsheetList.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [focalPersonView, filters.query]);

  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
    
  // THIS FUNCTION IS NO LONGER NEEDED, LOGIC WILL BE MOVED INLINE
  // const handleSurveyChange = (e) => { ... };

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

  const handleFilterChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleSelectSingle = (recordId) => { const newSelection = new Set(selectedRecords); newSelection.has(recordId) ? newSelection.delete(recordId) : newSelection.add(recordId); setSelectedRecords(newSelection); };
  const handleBatchEditClick = () => {
    if (selectedRecords.size === 0) return;

    const selectedItems = employments.filter(emp => selectedRecords.has(emp.id));
    if (selectedItems.length === 0) return;

    const firstSurveyId = selectedItems[0].survey_id;
    const allHaveSameSurvey = selectedItems.every(item => item.survey_id === firstSurveyId);

    if (!allHaveSameSurvey) {
      showToast("Batch edit is only allowed for employment records under the same survey.", 'error');
      return;
    }

    setBatchEditFormData({ contract_start_date: '', contract_end_date: '' });
    setIsBatchEditModalOpen(true);
  };

  const handleBatchEditInputChange = (e) => {
    setBatchEditFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleBatchUpdateSubmit = async (e) => {
    e.preventDefault();

    const filledUpdates = Object.entries(batchEditFormData).reduce((acc, [key, value]) => {
      if (value) {
        acc[key] = value;
      }
      return acc;
    }, {});

    if (Object.keys(filledUpdates).length === 0) {
        showToast("Please enter at least one date to update.", 'error');
        return;
    }
    
    const { contract_start_date, contract_end_date } = filledUpdates;
    if (contract_start_date && contract_end_date && new Date(contract_end_date) < new Date(contract_start_date)) {
        showToast('End date cannot be earlier than the start date.', 'error');
        return;
    }
    const payload = {
      ids: Array.from(selectedRecords),
      updates: filledUpdates,
      actingUserId: sessionState?.user?.id
    };

    try {
      await apiFetch('employments/batch-update', serverIp, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setIsBatchEditModalOpen(false);
      fetchData();
      setSelectedRecords(new Set());
      showToast('Employment records updated successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleProvideRatingClick = (rec) => {
    setRatingRecord(rec);
    setRatingCriteria({ timeliness: '', quality: '', quantity: '' });
    setRatingRemarks(rec.remarks || '');
    setIsRatingConfirmOpen(false);
    setIsRatingModalOpen(true);
  };

  const handleRatingSubmit = (e) => {
    e.preventDefault();
    if (!computedRating) return;
    setIsRatingConfirmOpen(true);
  };

  const handleRatingConfirm = async () => {
    try {
      const fullRating = `${computedAverage.toFixed(2)} — ${computedRating}`;
      // Include core employment fields so Super_Admin can perform a rating update
      // without the server requiring a full-record edit payload.
      const payload = {
        rating: fullRating,
        remarks: ratingRemarks,
        actingUserId: sessionState?.user?.id,
        // required fields for full edit validation on the server
        employee_id: ratingRecord.employee_id,
        position_id: ratingRecord.position_id,
        survey_id: ratingRecord.survey_id,
        contract_start_date: ratingRecord.contract_start_date,
        contract_end_date: ratingRecord.contract_end_date,
        focal_person_id: ratingRecord.focal_person_id,
      };

      await apiFetch(`employments/${ratingRecord.id}`, serverIp, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setIsRatingConfirmOpen(false);
      setIsRatingModalOpen(false);
      fetchData();
      showToast('Performance rating saved successfully.', 'success');
    } catch (err) {
      setIsRatingConfirmOpen(false);
      showToast(err.message, 'error');
    }
  };

  const handleAddClick = () => { 
      setEditingRecord(null); 
      setFormData(INITIAL_FORM_STATE); 
      setOriginalFormData(null);
      setIsModalOpen(true); 
  };
  
  const handleEditClick = (record) => {
      setEditingRecord(record);
      const formValues = {
        employee_id: record.employee_id ?? '',
        position_id: record.position_id ?? '',
        survey_id: record.survey_id ?? '',
        focal_person_id: record.focal_person_id ?? '',
        contract_start_date: formatDateForInput(record.contract_start_date),
        contract_end_date: formatDateForInput(record.contract_end_date)
      };
      setFormData(formValues);
      setOriginalFormData(formValues);
      setIsModalOpen(true);
  };

  const handleViewClick = (record) => setViewingRecord(record);
  const handleDeleteClick = (record) => setRecordToDelete(record);
  const handleClearSearch = () => { setFilters(prevFilters => ({ ...prevFilters, query: '' })); setCurrentPage(1); };
  const handleSelectAll = (event) => {
    if (event.target.checked) {
      const allRecordIds = spreadsheetList.map(rec => rec.id);
      setSelectedRecords(new Set(allRecordIds));
    } else {
      setSelectedRecords(new Set());
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    
    // Validation - Required fields
    if (!formData.employee_id) {
      employeeDropdownRef.current?.focus();
      employeeDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.position_id) {
      positionDropdownRef.current?.focus();
      positionDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.survey_id) {
      surveyDropdownRef.current?.focus();
      surveyDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (formData.contract_start_date && formData.contract_end_date && new Date(formData.contract_end_date) < new Date(formData.contract_start_date)) {
      showToast('End date cannot be earlier than the start date.', 'error');
      return;
    }
    
    const body = { ...formData, actingUserId: sessionState?.user?.id };
    const endpoint = editingRecord ? `employments/${editingRecord.id}` : 'employments';
    const method = editingRecord ? 'PUT' : 'POST';

    try {
      await apiFetch(endpoint, serverIp, { // 3. PASS serverIp
        method,
        body: JSON.stringify(body)
      });
      handleCloseAddEditModal();
      fetchData();
      showToast(editingRecord ? 'Employment record updated successfully.' : 'Employment record added successfully.', 'success');
    } catch (err) {
          try {
              const parsedError = JSON.parse(err.message);
              showToast(parsedError.error || parsedError.message || "An unknown error occurred.", 'error');
          } catch (e) {
              showToast(err.message, 'error');
          }
        }
    };

  const hasChanges = useMemo(() => {
      if (!editingRecord || !originalFormData) return true;
      return JSON.stringify(formData) !== JSON.stringify(originalFormData);
  }, [formData, originalFormData, editingRecord]);

  const confirmDelete = async () => {
    if (!recordToDelete || !sessionState) return;
    try {
      await apiFetch(`employments/${recordToDelete.id}`, serverIp, { // 3. PASS serverIp
        method: 'DELETE',
        body: JSON.stringify({ actingUserId: sessionState.user.id })
      });
      setRecordToDelete(null);
      fetchData();
      showToast('Employment record deleted successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      setRecordToDelete(null);
    }
  };

  const handleSyncClick = async () => {
    setIsSyncLoading(true);
    try {
        await fetchSyncFilterOptions();
        setSyncSelectedSurveyName('');
        setSyncSelectedPosition('');
        setSyncModalStep('filter');
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
            const data = await apiFetch(`employments/sync-filter-options?survey=${encodeURIComponent(surveyName)}`, serverIp);
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
    setSyncPreviewApplicants([]);
    setExcludedApplicants(new Set());
  }, []);

  const handleConfirmSyncFilter = async (e) => {
    if (e) e.preventDefault();
    if (!syncSelectedSurveyName || !syncSelectedPosition) {
        showToast('Please select a survey and position.', 'warning');
        return;
    }
    setIsSyncLoading(true);
    try {
        const results = await apiFetch('employments/sync-preview', serverIp, {
            method: 'POST',
            body: JSON.stringify({ surveyName: syncSelectedSurveyName, position: syncSelectedPosition })
        });
        setSyncPreviewApplicants(results);
        setSyncModalStep('preview');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setIsSyncLoading(false);
    }
  };

  const handleConfirmSync = async () => {
    setIsSyncLoading(true);
    try {
        const applicantIds = syncPreviewApplicants.filter(app => !excludedApplicants.has(app.id)).map(app => app.id);
        const result = await apiFetch('employments/sync-finalize', serverIp, {
            method: 'POST',
            body: JSON.stringify({ applicantIds, actingUserId: sessionState?.user?.id })
        });
        showToast(result.message, 'success');
        handleCloseSyncModal();
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        setIsSyncLoading(false);
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

  const handleExportAll = () => {
    if (employmentsWithNames.length === 0) return;
    const dataToExport = employmentsWithNames;
    const headers = ["employee_id", "fullname", "position_title", "survey_name", "focal_person_name", "contract_start_date", "contract_end_date", "rating", "remarks"];
    const csvContent = [headers.join(','), ...dataToExport.map(item => {
      const fullName = [item.first_name, item.middle_initial, item.last_name, item.suffix].filter(Boolean).join(' ');
      const row = [item.emp_id_str, fullName, item.position_title, item.survey_name, item.focal_person_name, formatDateForExport(item.contract_start_date), formatDateForExport(item.contract_end_date), item.rating, item.remarks];
      return row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(',');
    })].join('\n');
    const fileName = `all_employment_records_${new Date().toISOString().split('T')[0]}.csv`;
    handleCsvDownload(csvContent, fileName);
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

  // 6. UPDATE initial loading condition
  if (!sessionState || isLoading || isSettingsLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Employee Records</h1>
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
      <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Employment Records</h1>
        <div className="flex items-center gap-4">
          {userPermissions.isFocalPerson && (
            <div className="flex items-center border rounded-lg p-0.5 bg-gray-100 dark:bg-gray-700">
              <button onClick={() => setFocalPersonView('all')} className={`px-3 py-1 text-sm rounded-md ${focalPersonView === 'all' ? 'bg-white dark:bg-gray-900 text-blue-600 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                All Records
              </button>
              <button onClick={() => setFocalPersonView('assigned')} className={`px-3 py-1 text-sm rounded-md ${focalPersonView === 'assigned' ? 'bg-white dark:bg-gray-900 text-blue-600 shadow' : 'text-gray-600 dark:text-gray-300'}`}>
                Assigned
              </button>
            </div>
          )}
          <div className="relative">
            <input type="text" name="query" value={filters.query} onChange={handleFilterChange} placeholder="Search Records..." className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
            {filters.query && (
              <button onClick={handleClearSearch} type="button" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Clear search">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(userPermissions.canManage || userPermissions.isHrDesignate) && (
          <>
            <button onClick={handleAddClick} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"><FiPlus className="w-4 h-4" />Add Employment Record</button>
          </>
        )}
        <div className="flex-grow" />
        {(userPermissions.canManage || userPermissions.isHrDesignate) && (
          <>
            <button
              onClick={handleSyncClick}
              disabled={isSyncLoading || syncPendingCount === 0}
              title={
                syncPendingCount === 0
                  ? 'No applicants ready for employment sync'
                  : `${syncPendingCount} applicants ready for employment sync`
              }
              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiDownload className="w-4 h-4" />{isSyncLoading ? 'Loading...' : `Assign Employment to Hired (${syncPendingCount})`}
            </button>
            <button onClick={handleBatchEditClick} disabled={selectedRecords.size <= 1} title={selectedRecords.size <= 1 ? 'Select at least 2 records to batch edit' : `Batch edit ${selectedRecords.size} records`} className="px-3 py-2 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed">Batch Edit ({selectedRecords.size})</button>
          </>
        )}
        {userPermissions.canManage && (
            <button onClick={handleExportAll} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 bg-yellow-400 rounded-lg hover:bg-yellow-500 dark:bg-yellow-600 dark:hover:bg-yellow-700"><FiDownload className="w-4 h-4" />Export All</button>
        )}
      </div>

      <div className="overflow-x-auto bg-white h-[760px] rounded-lg shadow dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              {(userPermissions.canManage || userPermissions.isHrDesignate) && (
              <th className="w-12 px-5 py-3.5 text-left"><input type="checkbox" onChange={handleSelectAll} checked={spreadsheetList.length > 0 && selectedRecords.size === spreadsheetList.length} ref={el => { if (el) { el.indeterminate = selectedRecords.size > 0 && selectedRecords.size < spreadsheetList.length; } }} /></th>
              )}
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase">Employee {getSortIcon('last_name')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('position_title')} className="font-semibold flex items-center uppercase">Position {getSortIcon('position_title')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('survey_name')} className="font-semibold flex items-center uppercase">Survey {getSortIcon('survey_name')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('rating')} className="font-semibold flex items-center uppercase">Rating {getSortIcon('rating')}</button></th>
              <th className="px-5 py-3.5 text-center tracking-wider font-semibold uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedSpreadsheetList.length > 0 ? paginatedSpreadsheetList.map(rec => {
              const fullName = [rec.first_name, rec.middle_initial, rec.last_name, rec.suffix].filter(Boolean).join(' ');
              return (
                <tr key={rec.id} className="transition-colors duration-200 ease-in-out border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  {(userPermissions.canManage || userPermissions.isHrDesignate) && (
                  <td className="px-5 py-4 text-center"><input type="checkbox" checked={selectedRecords.has(rec.id)} onChange={() => handleSelectSingle(rec.id)} /></td>
                  )}
                  <td className="px-5 py-4"><p className="font-medium text-gray-900 dark:text-white whitespace-no-wrap">{fullName}</p><p className="text-sm text-gray-500 dark:text-gray-400">{rec.emp_id_str}</p></td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{rec.position_title}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{rec.survey_name}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{rec.rating || 'N/A'}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center space-x-1">
                      <button onClick={() => handleViewClick(rec)} title="View Employment Record" className="p-1 rounded-lg transition-colors text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700"><FaEye className="w-4 h-4" /></button>
                      {(userPermissions.canManage || userPermissions.isHrDesignate) && (
                        <button
                          onClick={() => handleEditClick(rec)}
                          disabled={!!rec.rating}
                          title={!!rec.rating ? "Cannot edit: Record has a rating" : "Edit Employment Record"}
                          className={`p-1 rounded-lg transition-colors ${!!rec.rating ? 'text-gray-400 cursor-not-allowed opacity-50' : 'text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50 dark:hover:text-indigo-300 dark:hover:bg-indigo-900/20'}`}
                        >
                          <FaPencilAlt className="w-4 h-4" />
                        </button>
                      )}
                      {((userPermissions.canManage) || (userPermissions.isFocalPerson && rec.focal_person_id === sessionState?.user?.id && !rec.rating)) && (!rec.remarks || !rec.remarks.startsWith('REPLACED')) && <button onClick={() => handleProvideRatingClick(rec)} title={rec.rating ? "Edit Rating" : "Provide Rating"} className="p-1 rounded-lg transition-colors text-green-600 hover:text-green-800 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-200 dark:hover:bg-green-900/20"><FaStar className="w-4 h-4" /></button>}
                      {userPermissions.canDelete && (
                        <button
                          onClick={() => handleDeleteClick(rec)}
                          disabled={!!rec.rating}
                          title={!!rec.rating ? "Cannot delete: Record has a rating" : "Delete Employment Record"}
                          className={`p-1 rounded-lg transition-colors ${!!rec.rating ? 'text-gray-400 cursor-not-allowed opacity-50' : 'text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-500 dark:hover:text-red-300 dark:hover:bg-red-900/20'}`}
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      )}
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
          <button onClick={handlePreviousPage} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} title={currentPage >= totalPages ? 'Already on last page' : 'Go to next page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingRecord ? 'Edit' : 'Add New'} Employment Record</h2>
            </div>
            <form onSubmit={handleFormSubmit} id="employmentForm" className="flex-auto p-6">
              <div className="grid grid-cols-1 gap-y-4">
                <div>
                  <label htmlFor="employee_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Employee <span className="text-red-500">*</span></label>
                  <SearchableDropdown
                    id="employee_id"
                    options={employeeOptions}
                    value={formData.employee_id}
                    onChange={(value) => setFormData(prev => ({ ...prev, employee_id: value }))}
                    placeholder="Search or Select Employee"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="position_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Position Title <span className="text-red-500">*</span></label>
                  <SearchableDropdown
                    id="position_id"
                    options={positionOptions}
                    value={formData.position_id}
                    onChange={(value) => setFormData(prev => ({ ...prev, position_id: value }))}
                    placeholder="Search or Select Position"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="survey_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name of Census/Survey <span className="text-red-500">*</span></label>
                  <SearchableDropdown
                    id="survey_id"
                    options={surveyOptions}
                    value={formData.survey_id}
                    onChange={(value) => {
                      // This is the logic from your old handleSurveyChange
                      const selectedSurvey = surveys.find(s => s.id === parseInt(value));
                      if (selectedSurvey) {
                        setFormData(prev => ({
                          ...prev,
                          survey_id: value,
                          focal_person_id: selectedSurvey.focal_person_id || '',
                          contract_start_date: formatDateForInput(selectedSurvey.contract_start_date) || prev.contract_start_date,
                          contract_end_date: formatDateForInput(selectedSurvey.contract_end_date) || prev.contract_end_date
                        }));
                      } else {
                        setFormData(prev => ({
                          ...prev,
                          survey_id: '',
                          focal_person_id: '',
                        }));
                      }
                    }}
                    placeholder="Search or Select Survey"
                    required
                  />
                </div>

              </div>
            </form>
            <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={handleCloseAddEditModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
              <button 
                  type="submit" 
                  form="employmentForm" 
                  disabled={!formData.employee_id || !formData.position_id || !formData.survey_id || (editingRecord && !hasChanges)}
                  title={!formData.employee_id || !formData.position_id || !formData.survey_id ? 'Please fill in all required fields' : (editingRecord && !hasChanges) ? 'No changes made' : 'Save record'}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                  <FiSave className="w-4 h-4" />Save Record
              </button>
            </div>
          </div>
        </div>
      )}

      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="flex flex-col w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-visible">
                <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Sync Applicants to Employment</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select Survey and Position to create employment records for hired applicants.</p>
                </div>

                {syncModalStep === 'filter' ? (
                    <form onSubmit={handleConfirmSyncFilter} className="flex flex-col flex-1 min-h-0">
                      <div className="flex-auto h-[200px] p-6 overflow-visible space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Survey Name <span className="text-red-500">*</span></label>
                                    <div className="relative">
                                        <button type="button" onClick={() => setSyncIsSurveyDropdownOpen(!syncIsSurveyDropdownOpen)} className="w-full text-left px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200">
                                            <span className="block whitespace-normal break-words">{syncSelectedSurveyName || 'Select a survey...'}</span>
                                        </button>
                                        {syncIsSurveyDropdownOpen && (
                                            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
                                                {syncAvailableSurveys.length > 0 ? (
                                                    <ul className="max-h-60 overflow-y-auto">
                                                        {syncAvailableSurveys.map((survey) => (
                                                            <li key={survey} className="cursor-pointer px-4 py-2 hover:bg-blue-500 hover:text-white text-gray-800 dark:text-gray-200 whitespace-normal break-words" onClick={() => handleSyncSurveySelect(survey)}>{survey}</li>
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
                                        <button type="button" disabled={!syncSelectedSurveyName} onClick={() => setSyncIsPositionDropdownOpen(!syncIsPositionDropdownOpen)} className="w-full text-left px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-700/50 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all duration-200">
                                            <span className="block whitespace-normal break-words">{syncSelectedPosition || 'Select a position...'}</span>
                                        </button>
                                        {syncIsPositionDropdownOpen && (
                                            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-lg">
                                                {syncAvailablePositions.length > 0 ? (
                                                    <ul className="max-h-60 overflow-y-auto">
                                                        {syncAvailablePositions.map((position) => (
                                                            <li key={position} className="cursor-pointer px-4 py-2 hover:bg-blue-500 hover:text-white text-gray-800 dark:text-gray-200 whitespace-normal break-words" onClick={() => { setSyncSelectedPosition(position); setSyncIsPositionDropdownOpen(false); }}>{position}</li>
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
                        </div>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <button type="button" onClick={handleCloseSyncModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"><FiX className="w-4 h-4" />Cancel</button>
                            <button
                                type="submit" 
                                disabled={!syncSelectedSurveyName || !syncSelectedPosition || isSyncLoading || !isSyncSurveyContractEnded}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow"
                                title={
                                    !syncSelectedSurveyName ? 'Please select a survey' :
                                    !syncSelectedPosition ? 'Please select a position' :
                                    !isSyncSurveyContractEnded ? 'Cannot sync: The contract for this survey has not yet ended.' :
                                    isSyncLoading ? 'Processing...' :
                                    'Proceed to sync applicants'
                                }
                            >{isSyncLoading ? 'Processing...' : <><FaArrowRight className="w-4 h-4" />Proceed</>}</button>
                        </div>
                    </form>
                ) : (
                    <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex-auto p-6 overflow-y-auto space-y-4">
                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                <p className="text-sm text-blue-800 dark:text-blue-300">Found <strong>{syncPreviewApplicants.length}</strong> applicant(s) ready for employment sync.</p>
                                <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 italic">Status will be changed to 'Synced Employments'.</p>
                            </div>
                            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            <th className="px-3 py-3 text-left font-semibold text-gray-900 dark:text-white">Include</th>
                                            <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Name</th>
                                            <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Survey</th>
                                            <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Position</th>
                                            <th className="p-3 text-left font-semibold text-gray-900 dark:text-white">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {syncPreviewApplicants.map((app) => {
                                            const isDuplicate = app.isDuplicate;
                                            const isExcluded = excludedApplicants.has(app.id);
                                            return (
                                                <React.Fragment key={app.id}>
                                                    <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${isDuplicate ? (isExcluded ? 'opacity-60 bg-gray-50 dark:bg-gray-800' : 'bg-yellow-50 dark:bg-yellow-900/10') : ''}`}>
                                                        <td className="px-3 py-3">
                                                            {isDuplicate ? (
                                                                <div className="flex items-center gap-2">
                                                                    <input type="checkbox" checked={!isExcluded} onChange={() => handleToggleExcludeApplicant(app.id)} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" />
                                                                    <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400">DUPLICATE</span>
                                                                </div>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400"><FiDownload className="w-3 h-3" /> Valid</span>
                                                            )}
                                                        </td>
                                                        <td className="p-3"><div className="font-medium text-gray-900 dark:text-white">{[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}</div></td>
                                                        <td className="p-3 text-gray-600 dark:text-gray-400">{app.survey_name}</td>
                                                        <td className="p-3 text-gray-600 dark:text-gray-400">{app.position_title}</td>
                                                        <td className="p-3 text-gray-600 dark:text-gray-400">{app.assessment_remarks}</td>
                                                    </tr>
                                                    {isDuplicate && !isExcluded && (
                                                        <tr className="bg-yellow-50/30 dark:bg-yellow-900/5"><td colSpan="5" className="px-6 py-2"><div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2"><span className="p-1 rounded-full bg-yellow-100 dark:bg-yellow-900 text-yellow-600">!</span><span>Employment record already exists for this survey and position.</span></div></td></tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <button type="button" onClick={handleCloseSyncModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
                            <button type="button" onClick={handleConfirmSync} disabled={isSyncLoading} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">{isSyncLoading ? 'Syncing...' : <><FiUpload className="w-4 h-4" />Import Records</>}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      )}

      {viewingRecord && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div ref={viewModalRef} className="z-50 w-full max-w-2xl p-6 bg-white rounded-lg shadow-2xl dark:bg-gray-800">
            <h2 className="mb-6 text-2xl font-bold">Employment Record Details</h2>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm md:grid-cols-2">
              <div>
                  <label className="block font-medium text-gray-500">Employee Name</label>
                  <p>{[viewingRecord.first_name, viewingRecord.middle_initial, viewingRecord.last_name, viewingRecord.suffix].filter(Boolean).join(' ')}</p>
              </div>
              <div><label className="block font-medium text-gray-500">Position Title</label><p>{viewingRecord.position_title}</p></div>
              <div className="md:col-span-2"><label className="block font-medium text-gray-500">Name of Census/Survey</label><p>{viewingRecord.survey_name || 'N/A'}</p></div>
              <div><label className="block font-medium text-gray-500">Contract Start Date</label><p>{viewingRecord.contract_start_date ? format(parseISO( viewingRecord.contract_start_date), 'MMMM d, yyyy') : 'N/A'}</p></div>
              <div><label className="block font-medium text-gray-500">Contract End Date</label><p>{viewingRecord.contract_end_date ? format(parseISO(viewingRecord.contract_end_date), 'MMMM d, yyyy') : 'N/A'}</p></div>
              <div><label className="block font-medium text-gray-500">Focal Person</label><p>{viewingRecord.focal_person_name || 'N/A'}</p></div>
              <div><label className="block font-medium text-gray-500">Performance Rating</label><p>{viewingRecord.rating || 'N/A'}</p></div>
              <div className="md:col-span-2"><label className="block font-medium text-gray-500">Remarks</label><p className="whitespace-pre-wrap">{viewingRecord.remarks || 'N/A'}</p></div>
            </div>
            <div className="flex justify-end mt-6">
              <button type="button" onClick={() => setViewingRecord(null)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Close</button>
            </div>
          </div>
        </div>
      )}
      {recordToDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50">
          <div className="z-50 w-full max-w-sm p-6 bg-white rounded-lg shadow-2xl dark:bg-gray-800">
            <h2 className="mb-4 text-xl font-bold">Confirm Deletion</h2>
            <p className="mb-6">Are you sure you want to delete this record? This cannot be undone.</p>
            <div className="flex justify-end space-x-4">
              <button onClick={() => setRecordToDelete(null)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
              <button onClick={confirmDelete} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"><FaTrash className="w-4 h-4" />Delete</button>
            </div>
          </div>
        </div>
      )}
      {isBatchEditModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
        <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-lg shadow-xl">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Batch Update Contract for {selectedRecords.size} Records
            </h2>
          </div>
          <form onSubmit={handleBatchUpdateSubmit} id="batchEditForm">
            <div className="p-6 space-y-4">
              
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Set new contract dates below. These dates will be applied to all selected employment records.
              </p>

              <div>
                <label htmlFor="batch_contract_start_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  New Contract Start Date <span className="text-red-500">*</span>
                </label>
                <input
                  id="batch_contract_start_date"
                  type="date"
                  name="contract_start_date"
                  value={batchEditFormData.contract_start_date}
                  onChange={handleBatchEditInputChange}
                  className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500"
                />
              </div>

              <div>
                <label htmlFor="batch_contract_end_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  New Contract End Date <span className="text-red-500">*</span>
                </label>
                <input
                  id="batch_contract_end_date"
                  type="date"
                  name="contract_end_date"
                  value={batchEditFormData.contract_end_date}
                  onChange={handleBatchEditInputChange}
                  className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500"
                />
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={handleCloseBatchEditModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
                <FiX className="w-4 h-4" />Cancel
              </button>
              <button type="submit" form="batchEditForm" className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600">
                <FiSave className="w-4 h-4" />Apply Changes
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
      {/* ─── Provide Rating Modal ─── */}
      {isRatingModalOpen && ratingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/60">
          <div className="flex flex-col w-full max-w-5xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl">
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-xl">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Performance Rating</h2>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                {[ratingRecord.first_name, ratingRecord.middle_initial, ratingRecord.last_name, ratingRecord.suffix].filter(Boolean).join(' ')} &mdash; {ratingRecord.position_title}
              </p>
            </div>

            <form onSubmit={handleRatingSubmit} className="flex-1">
              <div className="flex gap-0 divide-x divide-gray-200 dark:divide-gray-700">
                {/* ── Left column: criteria + result + remarks ── */}
                <div className="flex-1 px-6 py-5 space-y-2">

                {/* Criteria */}
                {RATING_CRITERIA.map(criterion => (
                  <div key={criterion.key} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">{criterion.label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{criterion.description}</p>
                      </div>
                      <div className="text-sm w-[300px]">
                      <SearchableDropdown
                        id={`rating-${criterion.key}`}
                        options={ratingScoreOptions}
                        value={ratingCriteria[criterion.key]}
                        onChange={value => setRatingCriteria(prev => ({ ...prev, [criterion.key]: value }))}
                        placeholder="Select score..."
                        required
                      />
                      </div>
                    </div>
                    {/* Score description hint */}
                    {ratingCriteria[criterion.key] && (
                      <p className="text-xs italic text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-1.5">
                        {SCORE_DESCRIPTIONS[parseInt(ratingCriteria[criterion.key])].desc}
                      </p>
                    )}
                  </div>
                ))}

                {/* Overall rating preview */}
                <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${computedRatingColor}`}>
                  <span className="text-sm font-semibold">Overall Performance Rating:</span>
                  <span className="text-base font-bold">
                    {computedRating
                      ? `${computedAverage.toFixed(2)} — ${computedRating}`
                      : ''}
                  </span>
                </div>

                {/* Remarks */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Commendations / Remarks</label>
                  <textarea
                    rows={3}
                    value={ratingRemarks}
                    onChange={e => setRatingRemarks(e.target.value)}
                    placeholder="Optional but recommended to help justify the rating."
                    className="w-full p-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                </div>{/* end left column */}

                {/* ── Right column: score card ── */}
                <div className="flex-shrink-0 px-6 py-5 w-[400px]">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Score Card</p>
                  <div className="space-y-3">
                    {[5,4,3,2,1].map(score => (
                      <div key={score} className={`rounded-lg border p-3 ${
                        score === 5 ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700' :
                        score === 4 ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700' :
                        score === 3 ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700' :
                        score === 2 ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-700' :
                                      'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-lg font-black ${
                            score === 5 ? 'text-emerald-600 dark:text-emerald-400' :
                            score === 4 ? 'text-blue-600 dark:text-blue-400' :
                            score === 3 ? 'text-yellow-600 dark:text-yellow-400' :
                            score === 2 ? 'text-orange-600 dark:text-orange-400' :
                                          'text-red-600 dark:text-red-400'
                          }`}>{score}</span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-white">{SCORE_DESCRIPTIONS[score].label}</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{SCORE_DESCRIPTIONS[score].desc}</p>
                      </div>
                    ))}
                  </div>
                </div>{/* end right column */}
              </div>{/* end two-column */}

              {/* Footer */}
              <div className="flex-shrink-0 flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-xl">
                <button type="button" onClick={() => setIsRatingModalOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
                <button type="submit" disabled={!computedRating} title={!computedRating ? 'Select a rating option' : 'Submit rating'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"><FaStar className="w-4 h-4" />Submit Rating</button>
              </div>
            </form>

            {/* Confirmation overlay */}
            {isRatingConfirmOpen && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-xl">
                <div className="w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 mx-4">
                  <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-900/40">
                    <span className="text-2xl">&#9888;&#65039;</span>
                  </div>
                  <h3 className="text-center text-base font-bold text-gray-900 dark:text-white mb-2">Confirm Submission</h3>
                  <p className="text-sm text-center text-gray-600 dark:text-gray-300 mb-1">
                    You are about to submit a rating of
                  </p>
                  <p className={`text-center text-base font-bold mb-3 ${computedRatingColor} rounded-lg px-3 py-1.5 border`}>
                    {computedAverage?.toFixed(2)} &mdash; {computedRating}
                  </p>
                  <p className="text-xs text-center text-red-600 dark:text-red-400 font-semibold mb-5">
                    &#128274; This rating cannot be changed once saved. Are you sure?
                  </p>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setIsRatingConfirmOpen(false)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"><FaArrowLeft className="w-4 h-4" />Go Back</button>
                    <button type="button" onClick={handleRatingConfirm} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700"><FaCheck className="w-4 h-4" />Yes, Submit</button>
                  </div>
                </div>
              </div>
            )}
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
    </div>
  );
};

export default Employments;
