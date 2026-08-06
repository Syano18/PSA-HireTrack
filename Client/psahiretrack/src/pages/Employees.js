import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaEye, FaPencilAlt, FaTrash, FaArrowRight } from 'react-icons/fa';
import { FiPlus, FiDownload, FiUpload, FiSave, FiX } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const calculateAge = (dobString) => {
  if (!dobString) return 'N/A';
  try {
    const birthDate = parseISO(dobString);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
  } catch (error) {
    return 'N/A';
  }
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

const formatDateForExport = (dateString) => {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'yyyy-MM-dd');
  } catch (error) {
    return '';
  }
};

const initialFormState = {
  employee_id: '',
  first_name: '',
  middle_initial: '',
  last_name: '',
  suffix: '',
  email: '',
  phone_number: '',
  date_of_birth: '',
  sex: '',
  tin_no: '',
  barangay: '',
  city: '',
  highest_grade_completed: ''
};

const Employees = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { toasts, showToast, removeToast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [originalFormData, setOriginalFormData] = useState(null);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [municipalityBarangayMap, setMunicipalityBarangayMap] = useState({});
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'employee_id', direction: 'ascending' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sessionState, setSessionState] = useState(null);
  const [userPermissions, setUserPermissions] = useState({ canManage: false });
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncModalStep, setSyncModalStep] = useState('filter'); // 'filter', 'preview', or 'results'
  const [syncPreviewApplicants, setSyncPreviewApplicants] = useState([]);
  const [allAssessedApplicants, setAllAssessedApplicants] = useState([]);
  const [syncSelectedSurveyName, setSyncSelectedSurveyName] = useState('');
  const [syncSelectedPosition, setSyncSelectedPosition] = useState('');
  const [assessedApplicantsCount, setAssessedApplicantsCount] = useState(0);
  const [syncResults, setSyncResults] = useState(null);
  const [isSyncLoading, setIsSyncLoading] = useState(false);
  const [duplicateMarkers, setDuplicateMarkers] = useState(new Set());
  const [excludedApplicants, setExcludedApplicants] = useState(new Set());
  const [syncIsSurveyDropdownOpen, setSyncIsSurveyDropdownOpen] = useState(false);
  const [syncIsPositionDropdownOpen, setSyncIsPositionDropdownOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importData, setImportData] = useState([]);
  const [importErrors, setImportErrors] = useState({});
  const [importDuplicateMarkers, setImportDuplicateMarkers] = useState({});
  const [excludedImportRows, setExcludedImportRows] = useState(new Set());
  const [isImportLoading, setIsImportLoading] = useState(false);
  const [showSaveButtonTooltip, setShowSaveButtonTooltip] = useState(false);
  const [employeesWithRecords, setEmployeesWithRecords] = useState(new Set());
  const [surveys, setSurveys] = useState([]);
  const [trainingTitles, setTrainingTitles] = useState([]);
  const viewModalRef = useRef(null);
  const firstNameRef = useRef(null);
  const middleInitialRef = useRef(null);
  const lastNameRef = useRef(null);
  const dateOfBirthRef = useRef(null);
  const sexRef = useRef(null);
  const cityRef = useRef(null);
  const barangayRef = useRef(null);
  const highestGradeRef = useRef(null);

  useClickOutside(viewModalRef, () => {
      if (viewingEmployee) handleCloseViewModal();
  });

  const handleCloseAddEditModal = useCallback(() => {
      setIsModalOpen(false);
      setFormData(initialFormState);
      setOriginalFormData(null);
      setShowSaveButtonTooltip(false);
  }, []);

  const handleCloseViewModal = useCallback(() => {
      setViewingEmployee(null);
  }, []);

  const fetchEmployees = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('employees', serverIp);
      setEmployees(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, showToast]);

  const fetchAssessedApplicants = useCallback(async () => {
    if (!serverIp || !sessionState) return;

    if (!['Super_Admin', 'Admin', 'PACD'].includes(sessionState.user.role)) {
      setAssessedApplicantsCount(0);
      return;
    }

    try {
      const data = await apiFetch('applicants/assessed', serverIp);
      // Filter for eligible applicants
      const eligibleData = data.filter(app => app.assessment_remarks === 'Hired' || (app.assessment_remarks && app.assessment_remarks.startsWith('REPLACED')));
      setAssessedApplicantsCount(eligibleData.length);
    } catch (err) {
      setAssessedApplicantsCount(0);
    }
  }, [serverIp, sessionState]);

  const fetchRelatedRecords = useCallback(async () => {
    if (!serverIp) return;
    try {
      const [trainingsData, employmentsData] = await Promise.all([
        apiFetch('trainings', serverIp),
        apiFetch('employments', serverIp)
      ]);
      
      const ids = new Set();
      if (Array.isArray(trainingsData)) {
        trainingsData.forEach(t => { if (t.employee_id) ids.add(t.employee_id); });
      }
      if (Array.isArray(employmentsData)) {
        employmentsData.forEach(e => { if (e.employee_id) ids.add(e.employee_id); });
      }
      setEmployeesWithRecords(ids);
    } catch (err) {
      console.error("Failed to fetch related records for constraints:", err);
    }
  }, [serverIp]);

  const fetchMunicipalities = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('municipalities', serverIp);
      setMunicipalities(data);
    } catch (err) {
      console.error("Failed to fetch municipalities:", err);
      showToast("Could not load location data.", 'error');
    }
  }, [serverIp, showToast]);

  const fetchSurveys = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('employments/surveys', serverIp);
      setSurveys(data);
    } catch (err) {
      console.error("Failed to fetch surveys:", err);
    }
  }, [serverIp]);

  const fetchTrainingTitles = useCallback(async () => {
    if (!serverIp) return;
    try {
        const data = await apiFetch('trainings/titles', serverIp);
        setTrainingTitles(data);
    } catch (err) {
        console.error("Failed to fetch training titles:", err);
    }
  }, [serverIp]);

  const fetchAllBarangaysData = useCallback(async (municiPalities) => {
    if (!serverIp || !municiPalities || municiPalities.length === 0) return;
    try {
      const barangayMap = {};
      for (const municipality of municiPalities) {
        const barangayData = await apiFetch(`barangays/${municipality.id}`, serverIp);
        barangayMap[municipality.name] = barangayData.map(b => b.name.toLowerCase());
      }
      setMunicipalityBarangayMap(barangayMap);
    } catch (err) {
      console.error("Failed to fetch barangays:", err);
    }
  }, [serverIp]);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = (JSON.parse(localStorage.getItem('loginState')) || null);
        if (state && state.user) {
          setSessionState(state);
          setUserPermissions({
            canManage: ['Super_Admin', 'Admin', 'PACD'].includes(state.user.role)
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
    if (sessionState && !isSettingsLoading) { 
      fetchEmployees();
      fetchMunicipalities();
      fetchAssessedApplicants();
      fetchRelatedRecords();
      fetchSurveys();
      fetchTrainingTitles();
    }
  }, [sessionState, isSettingsLoading, fetchEmployees, fetchMunicipalities, fetchAssessedApplicants, fetchRelatedRecords, fetchSurveys, fetchTrainingTitles]);

  useEffect(() => {
    if (municipalities.length > 0) {
      fetchAllBarangaysData(municipalities);
    }
  }, [municipalities, fetchAllBarangaysData]);
  
  useEffect(() => {
    if (selectedMunicipalityId && serverIp) {
      const fetchBarangays = async () => {
        try {
          const data = await apiFetch(`barangays/${selectedMunicipalityId}`, serverIp);
          setBarangays(data);
        } catch (err) {
          console.error("Failed to fetch barangays for form:", err);
        }
      };
      fetchBarangays();
    } else {
      setBarangays([]);
    }
  }, [selectedMunicipalityId, serverIp]);

  const employeesWithAge = useMemo(() => {
    return employees.map(emp => ({
    ...emp,
    age: calculateAge(emp.date_of_birth)
  }));
  }, [employees]);
  
  const filteredEmployees = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    if (!searchLower) {
      return employeesWithAge;
    }
    return employeesWithAge.filter(emp => {
      const searchableString = `
        ${emp.first_name || ''}
        ${emp.middle_initial || ''}
        ${emp.last_name || ''}
        ${emp.suffix || ''}
        ${emp.employee_id || ''}
        ${emp.city || ''}
        ${emp.barangay || ''}
        ${emp.age || ''}
        ${emp.highest_grade_completed || ''}
      `.toLowerCase();
      return searchableString.includes(searchLower);
    });
  }, [employeesWithAge, searchQuery]);
  

  const sortedEmployees = useMemo(() => {
    let sortableEmployees = [...filteredEmployees];
    if (sortConfig.key) {
      sortableEmployees.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (sortConfig.key === 'age') {
          aValue = calculateAge(a.date_of_birth);
          bValue = calculateAge(b.date_of_birth);
        }
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableEmployees;
  }, [filteredEmployees, sortConfig]);

  const sexOptions = useMemo(() => [
    { value: 'Male', label: 'Male' }, 
    { value: 'Female', label: 'Female' }
  ], []);

  const municipalityOptions = useMemo(() => 
    municipalities.map(mun => ({ value: mun.name, label: mun.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
  [municipalities]);

  const barangayOptions = useMemo(() => 
    barangays.map(bgy => ({ value: bgy.name, label: bgy.name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
  [barangays]);

  const syncUniqueSurveyNames = useMemo(() => {
    return [...new Set(allAssessedApplicants.map(a => a.survey_name).filter(Boolean))].sort();
  }, [allAssessedApplicants]);

  const syncAvailablePositions = useMemo(() => {
    return [...new Set(
      allAssessedApplicants
        .filter(a => !syncSelectedSurveyName || a.survey_name === syncSelectedSurveyName)
        .map(a => a.position)
        .filter(Boolean)
    )].sort();
  }, [allAssessedApplicants, syncSelectedSurveyName]);

  const syncFilteredCount = useMemo(() => {
    if (!syncSelectedSurveyName || !syncSelectedPosition) return 0;
    return allAssessedApplicants.filter(a =>
      a.survey_name === syncSelectedSurveyName && a.position === syncSelectedPosition
    ).length;
  }, [allAssessedApplicants, syncSelectedSurveyName, syncSelectedPosition]);

  const isTrainingNotStarted = useMemo(() => {
    if (!syncSelectedSurveyName || !syncSelectedPosition || !allAssessedApplicants.length) {
        return false;
    }
    
    const relevantApplicants = allAssessedApplicants.filter(a => 
        a.survey_name === syncSelectedSurveyName && a.position === syncSelectedPosition
    );

    if (relevantApplicants.length === 0) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day for comparison
    
    return relevantApplicants.some(app => {
        if (!app.training_title_id) return false;
        const training = trainingTitles.find(t => t.id === app.training_title_id);
        if (!training || !training.start_date) return false;
        
        let dateStr = training.start_date;
        if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];
        const [year, month, day] = dateStr.split('-').map(Number);
        const startDate = new Date(year, month - 1, day);
        
        return startDate > today;
    });
  }, [syncSelectedSurveyName, syncSelectedPosition, allAssessedApplicants, trainingTitles]);
  
  const isHiringOngoing = useMemo(() => {
    if (!syncSelectedSurveyName || !surveys.length) return false;
    const survey = surveys.find(s => s.name === syncSelectedSurveyName);
    if (!survey || !survey.hiring_date) return false;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const hDate = parseISO(survey.hiring_date);
      return hDate >= today;
    } catch (e) {
      return false;
    }
  }, [syncSelectedSurveyName, surveys]);


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


  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };
  
  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <FaSort className="inline-block ml-1 text-gray-400" />;
    }
    return sortConfig.direction === 'ascending' ?
      <FaSortUp className="inline-block ml-1 text-blue-500" /> :
      <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  const handleCsvDownload = async (content, fileName) => {
    try {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('File downloaded successfully.', 'success');
    } catch (err) {
      console.error('An unexpected error occurred during the download process:', err);
      showToast('Failed to save file. Please try again.', 'error');
    }
  };

  const handleDownloadTemplate = () => {
    const headers = ["first_name", "middle_initial", "last_name", "suffix", "email", "phone_number", "date_of_birth", "sex", "tin_no", "city", "barangay", "highest_grade_completed"];
    const exampleData = `"Juan","M.","Dela Cruz","Sr.","juan.delacruz@email.com","9175551234","1985-06-15","Male","123-456-789","City of Tabuk","Bulanao","Bachelor of Science in Information Technology"`;
    const content = headers.join(',') + "\n" + exampleData;
    
    handleCsvDownload(content, 'employee_records_template.csv');
  };

  // Helper: Levenshtein Distance for Fuzzy Matching
  const levenshtein = (a, b) => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
      }
    }
    return matrix[b.length][a.length];
  };

  // Validate date format (YYYY-MM-DD or M/D/YYYY or MM/DD/YYYY or D-M-YYYY)
  // Accepts Excel serial (5 digits), common numeric formats, and falls back
  // to native Date parsing for forgiving input handling.
  const isValidDateFormat = (dateString) => {
    if (!dateString || String(dateString).trim() === '') return false;
    const dateStr = String(dateString).trim();

    // Excel serial number format (e.g., 43831)
    if (/^\d{5}$/.test(dateStr)) {
      const serial = parseInt(dateStr, 10);
      return serial >= 1 && serial <= 60000; // reasonable Excel range
    }

    // Pattern: digit(1-4) / or - digit(1-2) / or - digit(1-4)
    const dateRegex = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/;
    const match = dateRegex.exec(dateStr);
    if (match) {
      const [, part1, part2, part3] = match;
      const num1 = parseInt(part1, 10);
      const num2 = parseInt(part2, 10);
      const num3 = parseInt(part3, 10);

      let month, day, year;
      // YYYY-MM-DD
      if (part1.length === 4 && (part1[0] === '1' || part1[0] === '2')) {
        year = num1; month = num2; day = num3;
      }
      // MM/DD/YYYY or DD/MM/YYYY (try MM/DD first)
      else if (part3.length === 4 && (part3[0] === '1' || part3[0] === '2')) {
        month = num1; day = num2; year = num3;
        if (month > 12) {
          month = num2; day = num1; // treat as DD/MM/YYYY
        }
      } else {
        return false;
      }

      if (month < 1 || month > 12) return false;
      if (day < 1 || day > 31) return false;
      if (year < 1900 || year > 2100) return false;

      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const maxDay = month === 2 && isLeapYear ? 29 : daysInMonth[month - 1];
      return day <= maxDay;
    }

    return false;
  };

  const normalizeName = (row) => {
    const normalized = { ...row };
    
    // Convert first name to uppercase
    if (normalized.first_name) {
      normalized.first_name = normalized.first_name.trim().toUpperCase();
    }
    
    // Convert last name to uppercase
    if (normalized.last_name) {
      normalized.last_name = normalized.last_name.trim().toUpperCase();
    }
    
    // Convert suffix to uppercase
    if (normalized.suffix) {
      normalized.suffix = normalized.suffix.trim().toUpperCase();
    }
    
    // Normalize middle initial
    if (normalized.middle_initial) {
      let middle = normalized.middle_initial.trim().toUpperCase();
      
      // If it's more than 2 characters OR doesn't end with a period, fix it
      // Requirement: If more than 2 characters get only the first character. All middle initial must end with period
      if (middle.length > 2) {
        middle = middle.charAt(0);
      } else if (middle.length > 0) {
        if (!middle.endsWith('.')) {
          middle = middle.charAt(0);
        }
      }

      if (middle && !middle.endsWith('.')) {
        middle = middle + '.';
      }
      normalized.middle_initial = middle;
    }
    
    return normalized;
  };

  // Validate and parse CSV file
  const handleImportFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.trim().split('\n');
        if (lines.length < 2) {
          showToast('CSV file must contain headers and at least one data row.', 'error');
          return;
        }

        // Parse headers
        const headerLine = lines[0];
        const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        
        // Parse data rows
        const rows = [];
        const rowErrors = {};

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue; // Skip empty lines

          // Parse CSV with proper quote handling
          const values = [];
          let current = '';
          let inQuotes = false;
          for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
              if (line[j + 1] === '"') {
                current += '"';
                j++;
              } else {
                inQuotes = !inQuotes;
              }
            } else if (char === ',' && !inQuotes) {
              values.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current);

          const rowData = {};
          headers.forEach((header, idx) => {
            rowData[header] = values[idx] ? values[idx].trim() : '';
          });

          const rowErrorList = [];

          // Validate required fields
          const requiredFields = ['first_name', 'last_name', 'date_of_birth', 'sex', 'city', 'barangay', 'highest_grade_completed'];
          requiredFields.forEach(field => {
            if (!rowData[field] || String(rowData[field]).trim() === '') {
              rowErrorList.push(`Missing required field: ${field}`);
            }
          });

          // Validate date format
          if (rowData.date_of_birth && !isValidDateFormat(rowData.date_of_birth)) {
            rowErrorList.push(`Invalid date format for date_of_birth. Expected: MM/DD/YYYY`);
          }

          // Validate barangay exists in city
          if (rowData.city && rowData.barangay) {
            const cityName = rowData.city.trim();
            const barangayName = rowData.barangay.trim().toLowerCase();
            const validBarangays = municipalityBarangayMap[cityName];
            
            if (validBarangays) {
              if (!validBarangays.includes(barangayName)) {
                rowErrorList.push(`Barangay "${rowData.barangay}" does not exist in "${cityName}"`);
              }
            } else {
              rowErrorList.push(`City "${cityName}" not found in database`);
            }
          }

          if (rowErrorList.length > 0) {
            rowErrors[i - 1] = rowErrorList;
          }

          // Normalize names before adding to rows
          const normalizedRowData = normalizeName(rowData);
          rows.push(normalizedRowData);
        }

        // Check for duplicates in existing employees
        const duplicateMarkers = {};
        const csvDuplicates = {}; // Track duplicates within the CSV
        const seenInCsv = new Map(); // Map of first+last+dob to row index

        if (employees.length > 0) {
          const dbNames = employees.map(emp => ({
            first: (emp.first_name || '').trim().toLowerCase(),
            last: (emp.last_name || '').trim().toLowerCase(),
            fullName: `${emp.first_name} ${emp.last_name}`,
            employee_id: emp.employee_id,
            dob: emp.date_of_birth
          }));

          for (let i = 0; i < rows.length; i++) {
            const rowData = rows[i];
            let duplicateStatus = 'New Record';
            let duplicateMatch = null;

            // Check 0: Duplicate within the CSV itself
            const csvKey = `${rowData.first_name}|${rowData.last_name}|${rowData.date_of_birth}`;
            if (seenInCsv.has(csvKey)) {
              const firstRowIndex = seenInCsv.get(csvKey);
              duplicateStatus = 'CSV Duplicate';
              duplicateMatch = {
                type: 'csv_duplicate',
                message: `Duplicate found in row ${firstRowIndex + 2} of the same CSV`
              };
              // Mark both this row and the first occurrence
              if (!csvDuplicates[firstRowIndex]) {
                csvDuplicates[firstRowIndex] = {
                  duplicateStatus: 'CSV Duplicate',
                  duplicateMatch: {
                    type: 'csv_duplicate',
                    message: `Duplicate found in row ${i + 2} of the same CSV`
                  }
                };
              }
            } else {
              seenInCsv.set(csvKey, i);
            }

            // Only check database if not already a CSV duplicate
            if (duplicateStatus === 'New Record') {
              // Check 1: Exact duplicate (first_name + last_name + DOB)
              const currentDob = rowData.date_of_birth;
              const exactMatch = employees.find(emp =>
                emp.first_name === rowData.first_name &&
                emp.last_name === rowData.last_name &&
                emp.date_of_birth === currentDob
              );

              if (exactMatch) {
                duplicateStatus = 'Exact Duplicate';
                duplicateMatch = {
                  type: 'exact',
                  existingEmployeeId: exactMatch.employee_id,
                  message: `Match found: ${exactMatch.employee_id}`
                };
              } else if (rowData.first_name && rowData.last_name) {
                // Check 2: Fuzzy matching for similar names
                const currentFirst = rowData.first_name.trim().toLowerCase();
                const currentLast = rowData.last_name.trim().toLowerCase();

                for (const dbEmp of dbNames) {
                  if (Math.abs(currentFirst.length - dbEmp.first.length) > 2 || Math.abs(currentLast.length - dbEmp.last.length) > 2) continue;

                  const distFirst = levenshtein(currentFirst, dbEmp.first);
                  const distLast = levenshtein(currentLast, dbEmp.last);
                  const threshold = (currentFirst.length > 3 && currentLast.length > 3) ? 1 : 0;

                  if (distFirst <= threshold && distLast <= threshold) {
                    duplicateStatus = 'Possible Duplicate';
                    duplicateMatch = {
                      type: 'fuzzy',
                      existingEmployeeId: dbEmp.employee_id,
                      similarName: dbEmp.fullName,
                      message: `Similar to: ${dbEmp.fullName} (${dbEmp.employee_id})`
                    };
                    break;
                  }
                }
              }
            }

            if (duplicateStatus !== 'New Record') {
              duplicateMarkers[i] = {
                duplicateStatus,
                duplicateMatch
              };
            }
          }
        }

        // Merge CSV duplicates with database duplicates
        const allMarkers = { ...duplicateMarkers, ...csvDuplicates };

        // Detect and exclude template example row
        const templateRow = {
          first_name: 'JUAN',
          middle_initial: 'M.',
          last_name: 'DELA CRUZ',
          suffix: 'Sr.',
          email: 'juan.delacruz@email.com',
          phone_number: '9175551234',
          date_of_birth: '1985-06-15',
          sex: 'Male',
          tin_no: '123-456-789',
          city: 'Tabuk City',
          barangay: 'Bulanao',
          highest_grade_completed: 'Bachelor of Science in Information Technology'
        };

        const templateMarkers = {};
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const isTemplate = Object.keys(templateRow).every(key => 
            String(row[key] || '').trim() === String(templateRow[key]).trim()
          );
          if (isTemplate) {
            templateMarkers[i] = {
              duplicateStatus: 'Template Example',
              duplicateMatch: {
                type: 'template',
                message: 'This is the template example row and will be excluded from import'
              }
            };
          }
        }

        // Merge all markers: duplicates (CSV + Database) + template
        const finalMarkers = { ...allMarkers, ...templateMarkers };

        setImportData(rows);
        setImportErrors(rowErrors);
        setImportDuplicateMarkers(finalMarkers);
        setExcludedImportRows(new Set(Object.keys(finalMarkers).map(Number)));
        setIsImportModalOpen(true);

        // Helper to process server validation errors
        const processServerErrors = (errorsList, currentErrors) => {
          const newErrors = { ...currentErrors };
          errorsList.forEach(errStr => {
            const m = errStr.match(/^Row\s+(\d+):\s*(.*)$/);
            if (m) {
              const serverIndex = parseInt(m[1], 10) - 2;
              if (!newErrors[serverIndex]) newErrors[serverIndex] = [];
              
              const serverMsg = m[2];
              const existingErrors = newErrors[serverIndex];
              const isDateRedundant = existingErrors.some(e => e.includes('Invalid date format')) && serverMsg.includes('Invalid or missing date_of_birth');
              const isLocationRedundant = existingErrors.some(e => e.includes('does not exist in') || e.includes('not found in database')) && (serverMsg.includes('not found in') || serverMsg.includes('not found.'));

              if (!isDateRedundant && !isLocationRedundant) {
                newErrors[serverIndex].push(serverMsg);
              }
            }
          });
          return newErrors;
        };

        // Helper to process server validation warnings
        const processServerWarnings = (warningsList, currentMarkers, currentExcluded) => {
          const newMarkers = { ...currentMarkers };
          const newExcluded = new Set(currentExcluded);
          warningsList.forEach(warn => {
            const originalIndex = warn.index;
            newMarkers[originalIndex] = {
              duplicateStatus: 'Potential Database Match',
              duplicateMatch: {
                type: 'similar',
                similarName: warn.message,
                existingEmployeeId: warn.existingEmployeeId
              }
            };
            newExcluded.add(originalIndex);
          });
          return { newMarkers, newExcluded };
        };

        // Run server-side validation in background and merge results into the review table
        (async () => {
          if (!(sessionState && sessionState.user && sessionState.user.id)) return;
          try {
            const validateResult = await apiFetch('employees/validate-import', serverIp, {
              method: 'POST',
              body: JSON.stringify({ actingUserId: sessionState.user.id, employees: rows })
            });

            // Map server errors to the importErrors state (successful response with status field)
            if (validateResult.status === 'error' && validateResult.errors) {
              setImportErrors(processServerErrors(validateResult.errors, rowErrors));
            }

            // Map server warnings to duplicate markers
            if (validateResult.status === 'warning' && validateResult.warnings) {
              const { newMarkers, newExcluded } = processServerWarnings(validateResult.warnings, finalMarkers, Object.keys(finalMarkers).map(Number));
              setImportDuplicateMarkers(newMarkers);
              setExcludedImportRows(newExcluded);
            }
          } catch (e) {
            // apiFetch throws for non-2xx responses; inspect e.data for structured payload
            console.debug('validate-import error object:', e);

            if (e && e.data) {
              // Map errors
              if (Array.isArray(e.data.errors) && e.data.errors.length > 0) {
                setImportErrors(processServerErrors(e.data.errors, rowErrors));
              }

              // Map warnings
              if (Array.isArray(e.data.warnings) && e.data.warnings.length > 0) {
                const { newMarkers, newExcluded } = processServerWarnings(e.data.warnings, finalMarkers, Object.keys(finalMarkers).map(Number));
                setImportDuplicateMarkers(newMarkers);
                setExcludedImportRows(newExcluded);
              }
            } else if (e && typeof e.message === 'string') {
              // Fallback: sometimes the thrown error message contains JSON
              try {
                const parsed = JSON.parse(e.message);
                console.debug('Parsed error.message JSON:', parsed);
                if (parsed.errors && Array.isArray(parsed.errors)) {
                  setImportErrors(processServerErrors(parsed.errors, rowErrors));
                }
                if (parsed.warnings && Array.isArray(parsed.warnings)) {
                  const { newMarkers, newExcluded } = processServerWarnings(parsed.warnings, finalMarkers, Object.keys(finalMarkers).map(Number));
                  setImportDuplicateMarkers(newMarkers);
                  setExcludedImportRows(newExcluded);
                }
              } catch (parseErr) {
                console.error('Could not parse validate-import error message as JSON:', parseErr, e.message);
              }
            } else {
              console.error('Validation request failed (no payload):', e);
            }
          }
        })();
      } catch (err) {
        showToast('Failed to parse CSV file. Please ensure it is properly formatted.', 'error');
      }
    };

    reader.readAsText(file);
    event.target.value = ''; // Reset file input
  };

  // Close import modal
  const handleCloseImportModal = () => {
    setIsImportModalOpen(false);
    setImportData([]);
    setImportErrors({});
    setImportDuplicateMarkers({});
    setExcludedImportRows(new Set());
  };

  // Toggle exclude/include for import row with duplicate
  const handleToggleExcludeImportRow = (rowIndex) => {
    const newExcluded = new Set(excludedImportRows);
    if (newExcluded.has(rowIndex)) {
      newExcluded.delete(rowIndex);
    } else {
      newExcluded.add(rowIndex);
    }
    setExcludedImportRows(newExcluded);
  };

  // Submit import
  const handleSubmitImport = async () => {
    if (Object.keys(importErrors).length > 0) {
      showToast('Please fix all errors before importing.', 'error');
      return;
    }

    setIsImportLoading(true);
    let filterIndexToOriginalIndex = [];
    try {
      // Create mapping from filtered index to original importData index
      filterIndexToOriginalIndex = [];
      importData.forEach((_, index) => {
        if (!excludedImportRows.has(index)) {
          filterIndexToOriginalIndex.push(index);
        }
      });

      // Filter out excluded rows with duplicates
      let filteredImportData = importData.filter((_, index) => !excludedImportRows.has(index));

      // Normalize names (uppercase, fix middle initial)
      filteredImportData = filteredImportData.map(row => normalizeName(row));

      const result = await apiFetch('employees/import', serverIp, {
        method: 'POST',
        body: JSON.stringify({
          actingUserId: sessionState.user.id,
          employees: filteredImportData,
          ignoreWarnings: false
        })
      });

      // If the server returns warnings, we can also display them in the table
      if (result.status === 'warning') {
        showToast('Potential duplicates found in database. Please review the highlighted rows.', 'warning');
        const newDuplicateMarkers = { ...importDuplicateMarkers };
        const newExcluded = new Set(excludedImportRows);

        if (result.warnings && result.warnings.length > 0) {
          result.warnings.forEach(warn => {
            const originalIndex = filterIndexToOriginalIndex[warn.index];
            if (originalIndex !== undefined) {
              newDuplicateMarkers[originalIndex] = {
                duplicateStatus: 'Potential Database Match',
                duplicateMatch: {
                  type: 'similar',
                  similarName: 'Server Sync Warning: ' + warn.message,
                  existingEmployeeId: warn.existingEmployeeId
                }
              };
              newExcluded.add(originalIndex);
            }
          });
        }
        setImportDuplicateMarkers(newDuplicateMarkers);
        setExcludedImportRows(newExcluded);
        setIsImportLoading(false);
        return;
      }

      showToast(result.message || 'Import completed successfully!', 'success');
      fetchEmployees();
      handleCloseImportModal();
    } catch (err) {
      if (err.data && err.data.errors && err.data.errors.length > 0) {
        showToast('Server returned errors. Please fix the highlighted rows in your CSV.', 'error');
        
        // Map server errors back to their original row indices
        const newImportErrors = { ...importErrors };
        let hasUnmappedErrors = false;
        
        err.data.errors.forEach(serverError => {
          const match = serverError.match(/^Row (\d+):\s*(.*)$/);
          if (match) {
            const serverRowNum = parseInt(match[1], 10);
            const serverIndex = serverRowNum - 2; // Server uses i+2 based on filtered array
            const originalIndex = filterIndexToOriginalIndex[serverIndex];
            
            if (originalIndex !== undefined) {
              if (!newImportErrors[originalIndex]) {
                newImportErrors[originalIndex] = [];
              }
              newImportErrors[originalIndex].push(`Server Action Required: ${match[2]}`);
            } else {
              hasUnmappedErrors = true;
            }
          } else {
            hasUnmappedErrors = true;
          }
        });
        
        setImportErrors(newImportErrors);
        
        if (hasUnmappedErrors) {
          showToast(err.message || 'Failed to import employees.', 'error');
        }
      } else {
        showToast(err.message || 'Failed to import employees.', 'error');
      }
    } finally {
      setIsImportLoading(false);
    }
  };

  const handleSyncClick = async () => {
    setIsSyncLoading(true);
    setSyncResults(null);
    
    try {
      // Fetch all assessed applicants for filter dropdowns
      let applicants = await apiFetch('applicants/assessed', serverIp);
      
      // Normalize names (uppercase, fix middle initial)
      applicants = applicants.map(app => normalizeName(app));
      
      // Filter for eligible remarks
      applicants = applicants.filter(app => app.assessment_remarks === 'Hired' || app.assessment_remarks.startsWith('REPLACED'));
      
      setAllAssessedApplicants(applicants);
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

  const handleProceedFromFilter = async () => {
    if (!syncSelectedSurveyName || !syncSelectedPosition) return;

    setIsSyncLoading(true);
    setSyncResults(null);

    try {
      // Filter applicants by selected survey name and position
      const filtered = allAssessedApplicants.filter(app =>
        app.survey_name === syncSelectedSurveyName && app.position === syncSelectedPosition
      );

      setSyncPreviewApplicants(filtered);

      // Check for potential duplicates across all assessed applicants
      const duplicateCheckResult = await apiFetch('employees/check-duplicates', serverIp, {
        method: 'POST',
        body: JSON.stringify({ actingUserId: sessionState.user.id })
      });

      const duplicateMap = new Map();
      const duplicateIds = new Set();
      const filteredIds = new Set(filtered.map(a => a.id));
      if (duplicateCheckResult.duplicateChecks) {
        duplicateCheckResult.duplicateChecks.forEach(check => {
          if (check.duplicateStatus !== 'New Record' && filteredIds.has(check.id)) {
            duplicateMap.set(check.id, check);
            duplicateIds.add(check.id);
          }
        });
      }
      setDuplicateMarkers(duplicateMap);
      setExcludedApplicants(duplicateIds);

      setSyncModalStep('preview');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleConfirmSyncFromPreview = async () => {
    setIsSyncLoading(true);

    try {
      // Also exclude applicants outside the current filtered set
      const filteredIds = new Set(syncPreviewApplicants.map(a => a.id));
      const nonFilteredIds = allAssessedApplicants.filter(a => !filteredIds.has(a.id)).map(a => a.id);
      const finalExcludedIds = [...new Set([...excludedApplicants, ...nonFilteredIds])];

      const result = await apiFetch('employees/sync-hired-applicants', serverIp, {
        method: 'POST',
        body: JSON.stringify({ actingUserId: sessionState.user.id, ignoreWarnings: true, excludedApplicantIds: finalExcludedIds })
      });

      // Update applicant interview status from Assessed to Synced Employees for INCLUDED applicants
      const syncedApplicantIds = syncPreviewApplicants
        .filter(app => !excludedApplicants.has(app.id))
        .map(app => app.id);

      if (syncedApplicantIds.length > 0) {
        try {
          await apiFetch('applicants/update-interview-status', serverIp, {
            method: 'POST',
            body: JSON.stringify({ applicantIds: syncedApplicantIds, newStatus: 'Synced Employees', actingUserId: sessionState.user.id })
          });
        } catch (statusErr) {
          console.error('Failed to update applicant interview status:', statusErr);
        }
      }

      // Also set excluded applicants to 'Synced Employees' (do not mark as Excluded from Sync)
      const excludedApplicantIds = syncPreviewApplicants
        .filter(app => excludedApplicants.has(app.id))
        .map(app => app.id);

      if (excludedApplicantIds.length > 0) {
        try {
          await apiFetch('applicants/update-interview-status', serverIp, {
            method: 'POST',
            body: JSON.stringify({ applicantIds: excludedApplicantIds, newStatus: 'Synced Employees', actingUserId: sessionState.user.id })
          });
        } catch (statusErr) {
          console.error('Failed to update excluded applicants interview status:', statusErr);
        }
      }

      // Link excluded duplicates to existing employees
      const linksToCreate = [];
      syncPreviewApplicants.forEach(app => {
          if (excludedApplicants.has(app.id)) {
              const duplicate = duplicateMarkers.get(app.id);
              if (duplicate && duplicate.duplicateMatch && duplicate.duplicateMatch.existingId) {
                  linksToCreate.push({
                      applicantId: app.id,
                      employeeId: duplicate.duplicateMatch.existingId
                  });
              }
          }
      });
      if (linksToCreate.length > 0) {
            try {
              await apiFetch('employees/link-profile-entries', serverIp, {
                  method: 'POST',
                  body: JSON.stringify({ links: linksToCreate, actingUserId: sessionState.user.id })
              });
            } catch (linkErr) { console.error('Failed to link profile entries:', linkErr); }
      }

      showToast(result.message || 'Sync completed successfully!', 'success');
      await fetchEmployees();
      await fetchAssessedApplicants();
      handleCloseSyncModal();
    } catch (err) {
      const errorPayload = { status: 'error', message: 'An unknown error occurred.', errors: [] };
      const structured = err.data || (() => { try { return JSON.parse(err.message); } catch { return null; } })();
      if (structured) {
        if (structured.errors && structured.errors.length > 0) {
          errorPayload.message = 'Please fix the following errors:';
          errorPayload.errors = structured.errors;
        } else {
          errorPayload.message = structured.message || structured.error || err.message;
        }
      } else {
        errorPayload.message = err.message;
      }
      showToast(errorPayload.message, 'error');
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleConfirmSync = async (ignoreWarnings = false) => {
    setIsSyncLoading(true);
    
    try {
      // Also exclude applicants outside the current filtered set
      const filteredIds = new Set(syncPreviewApplicants.map(a => a.id));
      const nonFilteredIds = allAssessedApplicants.filter(a => !filteredIds.has(a.id)).map(a => a.id);
      const finalExcludedIds = [...new Set([...excludedApplicants, ...nonFilteredIds])];

      const result = await apiFetch('employees/sync-hired-applicants', serverIp, {
        method: 'POST',
        body: JSON.stringify({ actingUserId: sessionState.user.id, ignoreWarnings, excludedApplicantIds: finalExcludedIds })
      });
      
      // Update applicant interview status from Assessed to 'Synced Employees' for INCLUDED applicants
      const syncedApplicantIds = syncPreviewApplicants
        .filter(app => !excludedApplicants.has(app.id))
        .map(app => app.id);

      if (syncedApplicantIds.length > 0) {
        try {
          await apiFetch('applicants/update-interview-status', serverIp, {
            method: 'POST',
            body: JSON.stringify({ applicantIds: syncedApplicantIds, newStatus: 'Synced Employees', actingUserId: sessionState.user.id })
          });
        } catch (statusErr) {
          console.error('Failed to update applicant interview status:', statusErr);
        }
      }

      // Also set excluded preview applicants to 'Synced Employees' (do not mark as Excluded from Sync)
      const excludedApplicantIds = syncPreviewApplicants
        .filter(app => excludedApplicants.has(app.id))
        .map(app => app.id);
      
      if (excludedApplicantIds.length > 0) {
        try {
          await apiFetch('applicants/update-interview-status', serverIp, {
            method: 'POST',
            body: JSON.stringify({ applicantIds: excludedApplicantIds, newStatus: 'Synced Employees', actingUserId: sessionState.user.id })
          });
        } catch (statusErr) {
          console.error('Failed to update excluded applicants interview status:', statusErr);
        }
      }

      // Link excluded duplicates to existing employees
      const linksToCreate = [];
      syncPreviewApplicants.forEach(app => {
          if (excludedApplicants.has(app.id)) {
              const duplicate = duplicateMarkers.get(app.id);
              if (duplicate && duplicate.duplicateMatch && duplicate.duplicateMatch.existingId) {
                  linksToCreate.push({
                      applicantId: app.id,
                      employeeId: duplicate.duplicateMatch.existingId
                  });
              }
          }
      });
      if (linksToCreate.length > 0) {
           try {
              await apiFetch('employees/link-profile-entries', serverIp, {
                  method: 'POST',
                  body: JSON.stringify({ links: linksToCreate, actingUserId: sessionState.user.id })
              });
           } catch (linkErr) { console.error('Failed to link profile entries:', linkErr); }
      }
      
      showToast(result.message || 'Sync completed successfully!', 'success');
      await fetchEmployees();
      await fetchAssessedApplicants();
      handleCloseSyncModal();
    } catch (err) {
      const errorPayload = { status: 'error', message: 'An unknown error occurred.', errors: [] };
      const structured = err.data || (() => { try { return JSON.parse(err.message); } catch { return null; } })();
      if (structured) {
        if (structured.errors && structured.errors.length > 0) {
          errorPayload.message = 'Please fix the following errors:';
          errorPayload.errors = structured.errors;
        } else {
          errorPayload.message = structured.message || structured.error || err.message;
        }
      } else {
        errorPayload.message = err.message;
      }
      showToast(errorPayload.message, 'error');
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleProceedAsSyncDuplicates = () => {
    handleConfirmSync(true);
  };

  const handleToggleExcludeApplicant = (applicantId) => {
    const newExcluded = new Set(excludedApplicants);
    if (newExcluded.has(applicantId)) {
      newExcluded.delete(applicantId);
    } else {
      newExcluded.add(applicantId);
    }
    setExcludedApplicants(newExcluded);
  };

  const handleCloseSyncModal = () => {
    setIsSyncModalOpen(false);
    setSyncResults(null);
    setSyncPreviewApplicants([]);
    setAllAssessedApplicants([]);
    setSyncSelectedSurveyName('');
    setSyncSelectedPosition('');
    setSyncIsSurveyDropdownOpen(false);
    setSyncIsPositionDropdownOpen(false);
    setSyncModalStep('filter');
    setDuplicateMarkers(new Map());
    setExcludedApplicants(new Set());
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === 'city') {
      const selectedMun = municipalities.find(m => m.name === value);
      setSelectedMunicipalityId(selectedMun ? selectedMun.id : '');
      setFormData(prevState => ({ ...prevState, city: value, barangay: '' }));
    } else {
      setFormData(prevState => ({ ...prevState, [name]: value }));
    }
  };

  const handleAddClick = () => {
    setEditingEmployee(null);
    setFormData(initialFormState);
    setOriginalFormData(null);
    setSelectedMunicipalityId('');
    setIsModalOpen(true);
  };

  const handleEditClick = (employee) => {
    const dob = employee.date_of_birth ? employee.date_of_birth.substring(0, 10) : '';
    const formDataToUse = { ...employee, date_of_birth: dob };
    setEditingEmployee(employee);
    setFormData(formDataToUse);
    setOriginalFormData(formDataToUse);
    const selectedMun = municipalities.find(m => m.name === employee.city);
    setSelectedMunicipalityId(selectedMun ? selectedMun.id : '');
    setIsModalOpen(true);
  };

  const handleViewClick = (employee) => {
    setViewingEmployee(employee);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  const handleExportAll = () => {
    const headers = ["employee_id", "first_name", "middle_initial", "last_name", "suffix", "email", "phone_number", "date_of_birth", "sex", "tin_no", "barangay", "city", "highest_grade_completed"];
    const csvContent = [
      headers.join(','),
      ...sortedEmployees.map(item => {
        const BDate = formatDateForExport(item.date_of_birth);
        const row = [item.employee_id, item.first_name, item.middle_initial, item.last_name, item.suffix, item.email, item.phone_number, BDate, item.sex, item.tin_no, item.barangay, item.city, item.highest_grade_completed];
        return row.map(val => `"${val || ''}"`).join(',');
      })
    ].join('\n');
    
    const fileName = `exported_employee_records_${new Date().toISOString().split('T')[0]}.csv`;
    handleCsvDownload(csvContent, fileName);
  };

  const handleDeleteClick = (employee) => {
    setEmployeeToDelete(employee);
  };

  const confirmDelete = async () => {
    if (!employeeToDelete || !sessionState) return;
    try {
      await apiFetch(`employees/${employeeToDelete.id}`, serverIp, {
        method: 'DELETE',
        body: JSON.stringify({ actingUserId: sessionState.user.id })
      });
      setEmployeeToDelete(null);
      fetchEmployees();
      showToast('Employee deleted successfully.', 'success');
    } catch (err) {
      let errorMessage = 'An unexpected error occurred while deleting the employee.';
      let errorDetails = '';
      
      // Extract error message from various possible sources
      if (err.data) {
        if (typeof err.data === 'string') {
          errorMessage = err.data;
        } else if (err.data.message) {
          errorMessage = err.data.message;
        } else if (err.data.error) {
          errorMessage = err.data.error;
        } else if (err.data.errors && Array.isArray(err.data.errors)) {
          errorMessage = err.data.errors.join(', ');
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      // Try to parse as JSON if it's a string
      if (typeof errorMessage === 'string') {
        try {
          const parsed = JSON.parse(errorMessage);
          if (parsed.message) errorMessage = parsed.message;
          if (parsed.error) errorMessage = parsed.error;
          if (parsed.errors && Array.isArray(parsed.errors)) {
            errorMessage = parsed.errors.join(', ');
          }
        } catch {
          // Not JSON, use as is
        }
      }
      
      // Provide specific user-friendly messages for common error types
      const lowerMessage = errorMessage.toLowerCase();
      
      if (lowerMessage.includes('permission denied') || lowerMessage.includes('not authorized')) {
        errorMessage = 'You do not have permission to delete employees. Please contact your administrator.';
      } else if (lowerMessage.includes('restricted')) {
        errorMessage = 'This employee cannot be deleted because they have associated training and employment records. Please remove all related training and employment records first, then try deleting the employee again.\n\nIf you need assistance, contact your administrator.';
      } else if (lowerMessage.includes('not found') || lowerMessage.includes('does not exist')) {
        errorMessage = 'Employee not found. The employee may have already been deleted or the record may be corrupted.';
      } else if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
        errorMessage = 'Network error occurred. Please check your internet connection and try again.';
      } else if (lowerMessage.includes('timeout')) {
        errorMessage = 'Request timed out. Please try again.';
      } else if (lowerMessage.includes('server') || lowerMessage.includes('internal')) {
        errorMessage = 'Server error occurred. Please try again later or contact your administrator.';
      } 
      
      showToast(errorMessage + errorDetails, 'error');
      setEmployeeToDelete(null);
    }
  };

  // Check if all required fields for employee form are filled
  const isFormValid = () => {
    const requiredFields = ['first_name', 'last_name', 'date_of_birth', 'sex', 'city', 'barangay', 'highest_grade_completed'];
    return requiredFields.every(field => formData[field] && String(formData[field]).trim() !== '');
  };

  // Check if form data has changed (for edit mode)
  const hasFormDataChanged = () => {
    // In add mode (originalFormData is null), allow saving if form is valid
    if (originalFormData === null) return true;
    
    // In edit mode, check if any field has changed
    const fieldsToCheck = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
    return fieldsToCheck.some(field => formData[field] !== originalFormData[field]);
  };

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
    if (!formData.date_of_birth) {
      dateOfBirthRef.current?.focus();
      dateOfBirthRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.sex) {
      sexRef.current?.focus();
      sexRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.city) {
      cityRef.current?.focus();
      cityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.barangay) {
      barangayRef.current?.focus();
      barangayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!formData.highest_grade_completed.trim()) {
      highestGradeRef.current?.focus();
      highestGradeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    
    const phoneRegex = /^9\d{9}$/;
    if (formData.phone_number && !phoneRegex.test(formData.phone_number)) {
      showToast('Invalid phone number. It must be 10 digits and start with 9 (e.g., 9171234567).', 'error');
      return;
    }

    const endpoint = editingEmployee ? `employees/${editingEmployee.id}` : 'employees';
    const method = editingEmployee ? 'PUT' : 'POST';
    const body = { ...formData, actingUserId: sessionState?.user?.id };

    try {
      await apiFetch(endpoint, serverIp, {
        method,
        body: JSON.stringify(body)
      });
      handleCloseAddEditModal();
      fetchEmployees();
      showToast(method === 'PUT' ? 'Employee updated successfully.' : 'Employee added successfully.', 'success');
    } catch (err) {
      try {
        const parsedError = JSON.parse(err.message);
        showToast(parsedError.error || parsedError.message || 'An unknown error occurred.', 'error');
      } catch (e) {
        showToast(err.message, 'error');
      }
    }
  };



  return (
    <div className="flex-1 w-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Employee Records</h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search Records..."
              className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                aria-label="Clear search"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {userPermissions.canManage && (
          <>
            <button onClick={handleAddClick} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"><FiPlus className="w-5 h-5" />Add New Employee</button>
            <div className="flex-grow" />
            <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100 bg-gray-400 rounded-lg hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-700"><FiDownload className="w-5 h-5" />Download Template</button>
            <label className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 cursor-pointer">
              <FiUpload className="w-5 h-5" />
              Import CSV
              <input type="file" accept=".csv" onChange={handleImportFileSelect} className="hidden" />
            </label>
            <button onClick={handleSyncClick} disabled={isSyncLoading || assessedApplicantsCount === 0} title={assessedApplicantsCount === 0 ? 'No assessed applicants available' : `${assessedApplicantsCount} assessed applicants ready to sync`} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"><FiDownload className="w-5 h-5" />{isSyncLoading ? 'Syncing...' : `Sync Hired Applicants (${assessedApplicantsCount})`}</button>
            {['Super_Admin', 'Admin'].includes(sessionState?.user?.role) && (
              <button onClick={handleExportAll} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-gray-100 bg-yellow-400 rounded-lg hover:bg-yellow-500 dark:bg-yellow-600 dark:hover:bg-yellow-700"><FiDownload className="w-5 h-5" />Export</button>
            )}
          </>
        )}
      </div>

      <div className="overflow-auto bg-white rounded-lg shadow flex-1 min-h-0 dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              <th className="px-5 py-3.5 text-left">
                <button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase">Employee Name {getSortIcon('last_name')}</button>
              </th>
              <th className="px-5 py-3.5 text-left">
                <button onClick={() => requestSort('age')} className="font-semibold flex items-center uppercase">Age {getSortIcon('age')}</button>
              </th>
              <th className="px-5 py-3.5 text-left">
                <button onClick={() => requestSort('phone_number')} className="font-semibold flex items-center uppercase">Contact {getSortIcon('phone_number')}</button>
              </th>
              <th className="px-5 py-3.5 text-left">
                <button onClick={() => requestSort('highest_grade_completed')} className="font-semibold flex items-center uppercase">Education {getSortIcon('highest_grade_completed')}</button>
              </th>
              <th className="px-5 py-3.5 text-center font-semibold tracking-wider uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedEmployees.length > 0 ? (
              sortedEmployees.map((emp) => (
                <tr key={emp.id} className="transition-colors duration-200 ease-in-out border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-5 py-4 font-medium text-gray-900 dark:text-white">
                    <p className="font-medium text-gray-900 whitespace-no-wrap dark:text-white">{[emp.first_name, emp.middle_initial, emp.last_name, emp.suffix].filter(Boolean).join(' ')}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{emp.employee_id}</p>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{calculateAge(emp.date_of_birth)}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{emp.phone_number}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{emp.highest_grade_completed}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center space-x-1">
                      <button onClick={() => handleViewClick(emp)} title="View Employee" className="p-1 rounded-lg transition-colors text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700"><FaEye className="w-4 h-4" /></button>
                      {userPermissions.canManage && <>
                        <button onClick={() => handleEditClick(emp)} title="Edit Employee" className="p-1 rounded-lg transition-colors text-blue-600 hover:text-blue-900 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20"><FaPencilAlt className="w-4 h-4" /></button>
                        <button 
                          onClick={() => handleDeleteClick(emp)} 
                          disabled={employeesWithRecords.has(emp.id)}
                          title={employeesWithRecords.has(emp.id) ? "Cannot delete: Employee has associated training or employment records" : "Delete Employee"}
                          className={`p-1 rounded-lg transition-colors ${employeesWithRecords.has(emp.id) ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20'}`}
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-16 text-center text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Records Found</h3>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="flex justify-end items-center mt-2 px-2 flex-shrink-0">
        <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
          Total Records: {filteredEmployees.length}
        </span>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="flex flex-col w-full max-w-3xl bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700 rounded-t-lg">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingEmployee ? 'Edit Employee' : 'Add New Employee Record'}</h2>
            </div>
            <form id="addEditForm" onSubmit={handleFormSubmit} className="flex-auto p-6">
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-6">
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name <span className="text-red-500">*</span></label><input ref={firstNameRef} type="text" name="first_name" value={formData.first_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Middle Initial</label><input ref={middleInitialRef} type="text" name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name <span className="text-red-500">*</span></label><input ref={lastNameRef} type="text" name="last_name" value={formData.last_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suffix</label><input type="text" name="suffix" value={formData.suffix} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address (e.g. juandelacruz@gmail.com)</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number (e.g. 9179836137)</label><input type="tel" name="phone_number" value={formData.phone_number} onChange={handleInputChange} pattern="^9\d{9}$" maxLength="10" title="Must be 10 digits starting with 9" className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Date of Birth <span className="text-red-500">*</span></label><input ref={dateOfBirthRef} type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sex <span className="text-red-500">*</span></label>
                  <SearchableDropdown id="sex" options={sexOptions} value={formData.sex} onChange={(value) => handleInputChange({ target: { name: 'sex', value } })} placeholder="Select Sex" required />
                </div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">TIN (e.g. 123-456-789)</label><input type="text" name="tin_no" value={formData.tin_no} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">City/Municipality <span className="text-red-500">*</span></label>
                  <SearchableDropdown id="city" options={municipalityOptions} value={formData.city} onChange={(value) => handleInputChange({ target: { name: 'city', value } })} placeholder="Select City/Municipality" required />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Barangay <span className="text-red-500">*</span></label>
                  <SearchableDropdown id="barangay" options={barangayOptions} value={formData.barangay} onChange={(value) => handleInputChange({ target: { name: 'barangay', value } })} placeholder="Select Barangay" required disabled={!formData.city} />
                </div>
                <div className="sm:col-span-6"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Highest Grade Completed (Specify Course if College Graduate) <span className="text-red-500">*</span></label><input ref={highestGradeRef} type="text" name="highest_grade_completed" value={formData.highest_grade_completed} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
              </div>
            </form>
            <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
              <button type="button" onClick={handleCloseAddEditModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
              <div className="relative" onMouseEnter={() => (!isFormValid() || !hasFormDataChanged()) && setShowSaveButtonTooltip(true)} onMouseLeave={() => setShowSaveButtonTooltip(false)}>
                <button 
                  type="submit" 
                  form="addEditForm" 
                  disabled={!isFormValid() || !hasFormDataChanged()}
                  title={!isFormValid() ? 'Please fill in all required fields' : !hasFormDataChanged() ? 'No changes made to save' : 'Save employee record'}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                    (isFormValid() && hasFormDataChanged())
                      ? 'text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 cursor-pointer' 
                      : 'text-white bg-blue-400 dark:bg-blue-800 cursor-not-allowed opacity-60'
                  }`}
                >
                  <FiSave className="w-4 h-4" />Save Record
                </button>
                {showSaveButtonTooltip && (!isFormValid() || !hasFormDataChanged()) && (
                  <div className="absolute top-full right-0 mt-2 px-3 py-2 text-sm text-white bg-gray-900 rounded-md whitespace-nowrap z-10 pointer-events-none">
                    {!isFormValid() ? 'Please fill in all required fields' : 'No changes made to save'}
                    <div className="absolute bottom-full right-3 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900"></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {employeeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">Are you sure you want to delete this employee? This action cannot be undone.</p>
            <div className="flex justify-end mt-6 space-x-2">
              <button onClick={() => setEmployeeToDelete(null)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Cancel</button>
              <button onClick={confirmDelete} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"><FaTrash className="w-4 h-4" />Delete</button>
            </div>
          </div>
        </div>
      )}

      {viewingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div ref={viewModalRef} className="w-full max-w-2xl p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="pb-4 text-2xl font-bold text-gray-900 border-b border-gray-200 dark:text-white dark:border-gray-700">Employee Details</h2>
            <div className="grid grid-cols-1 gap-y-4 gap-x-8 mt-6 text-sm md:grid-cols-2">
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Full Name</label><p className="text-gray-900 dark:text-white">{[viewingEmployee.first_name, viewingEmployee.middle_initial, viewingEmployee.last_name, viewingEmployee.suffix].filter(Boolean).join(' ')}</p></div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Employee ID</label><p className="text-gray-900 dark:text-white">{viewingEmployee.employee_id}</p></div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Email Address</label><p className="text-gray-900 dark:text-white">{viewingEmployee.email || 'N/A'}</p></div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Phone Number</label><p className="text-gray-900 dark:text-white">{viewingEmployee.phone_number || 'N/A'}</p></div>
              <div>
                <label className="block font-medium text-gray-500 dark:text-gray-400">Date of Birth</label>
                <p className="text-gray-900 dark:text-white">
                  {viewingEmployee.date_of_birth 
                    ? format(parseISO(viewingEmployee.date_of_birth), 'MMMM d, yyyy') 
                    : 'N/A'}
                </p>
              </div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Age</label><p className="text-gray-900 dark:text-white">{calculateAge(viewingEmployee.date_of_birth)}</p></div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">Sex</label><p className="text-gray-900 dark:text-white">{viewingEmployee.sex}</p></div>
              <div><label className="block font-medium text-gray-500 dark:text-gray-400">TIN No.</label><p className="text-gray-900 dark:text-white">{viewingEmployee.tin_no || 'N/A'}</p></div>
              <div className="md:col-span-2"><label className="block font-medium text-gray-500 dark:text-gray-400">Address</label><p className="text-gray-900 dark:text-white">{[viewingEmployee.barangay, viewingEmployee.city].filter(Boolean).join(', ') || 'N/A'}</p></div>
              <div className="md:col-span-2"><label className="block font-medium text-gray-500 dark:text-gray-400">Highest Grade Completed</label><p className="text-gray-900 dark:text-white">{viewingEmployee.highest_grade_completed || 'N/A'}</p></div>
            </div>
            <div className="flex justify-end mt-6">
              <button type="button" onClick={handleCloseViewModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Close</button>
            </div>
          </div>
        </div>
      )}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="z-50 w-full max-w-4xl rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white flex-shrink-0">Sync Hired Applicants</h2>
            {syncModalStep === 'filter' ? (
              <div className="flex flex-col flex-1 min-h-0">
                <p className="mb-5 text-gray-700 dark:text-gray-300">
                  Select a <strong>Survey Name</strong> and <strong>Position</strong> to filter assessed applicants before syncing.
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Survey Name <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setSyncIsSurveyDropdownOpen(!syncIsSurveyDropdownOpen)}
                        className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm min-h-[42px]"
                      >
                        <span className="block whitespace-normal break-words text-gray-900 dark:text-white">
                          {syncSelectedSurveyName || "-- Select Survey Name --"}
                        </span>
                        <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                          <FaSort className="h-4 w-4 text-gray-400" aria-hidden="true" />
                        </span>
                      </button>
                      {syncIsSurveyDropdownOpen && (
                        <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg mt-1 max-h-60 overflow-y-auto z-10">
                          <div
                            onClick={() => { setSyncSelectedSurveyName(''); setSyncIsSurveyDropdownOpen(false); setSyncSelectedPosition(''); }}
                            className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600"
                          >
                            -- Select Survey Name --
                          </div>
                          {syncUniqueSurveyNames.map((name) => (
                            <div
                              key={name}
                              onClick={() => { setSyncSelectedSurveyName(name); setSyncIsSurveyDropdownOpen(false); setSyncSelectedPosition(''); }}
                              className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600 last:border-0"
                            >
                              <span className="block font-normal whitespace-normal break-words">{name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Position <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => !syncSelectedSurveyName || setSyncIsPositionDropdownOpen(!syncIsPositionDropdownOpen)}
                        disabled={!syncSelectedSurveyName}
                        title={!syncSelectedSurveyName ? 'Select a survey first' : 'Select a position'}
                        className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500 sm:text-sm min-h-[42px] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="block whitespace-normal break-words text-gray-900 dark:text-white">
                          {syncSelectedPosition || "-- Select Position --"}
                        </span>
                        <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                          <FaSort className="h-4 w-4 text-gray-400" aria-hidden="true" />
                        </span>
                      </button>
                      {syncIsPositionDropdownOpen && syncSelectedSurveyName && (
                        <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg mt-1 max-h-60 overflow-y-auto z-10">
                          <div
                            onClick={() => { setSyncSelectedPosition(''); setSyncIsPositionDropdownOpen(false); }}
                            className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600"
                          >
                            -- Select Position --
                          </div>
                          {syncAvailablePositions.map((pos) => (
                            <div
                              key={pos}
                              onClick={() => { setSyncSelectedPosition(pos); setSyncIsPositionDropdownOpen(false); }}
                              className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600 last:border-0"
                            >
                              <span className="block font-normal whitespace-normal break-words">{pos}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {syncSelectedSurveyName && syncSelectedPosition && (
                  <div className={`mb-5 p-3 rounded-lg border ${syncFilteredCount > 0 ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
                    <p className={`text-sm ${syncFilteredCount > 0 ? 'text-blue-800 dark:text-blue-300' : 'text-yellow-800 dark:text-yellow-300'}`}>
                      {syncFilteredCount > 0
                        ? <><strong>{syncFilteredCount}</strong> applicant(s) found for <strong>{syncSelectedSurveyName}</strong> — <strong>{syncSelectedPosition}</strong>.</>
                        : <>No applicants found for the selected survey and position.</>
                      }
                    </p>
                  </div>
                )}
                <div className="mt-auto pt-4 flex justify-end gap-2">
                  <button
                    type="button" onClick={handleCloseSyncModal}
                    className="flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                  >
                    <FiX className="w-4 h-4" />Cancel
                  </button>
                  <button
                    type="button" onClick={handleProceedFromFilter}
                    disabled={!syncSelectedSurveyName || !syncSelectedPosition || syncFilteredCount === 0 || isSyncLoading || isTrainingNotStarted || isHiringOngoing}
                    title={
                      isSyncLoading ? 'Loading...' : 
                      !syncSelectedSurveyName ? 'Select a survey' : 
                      !syncSelectedPosition ? 'Select a position' : 
                      syncFilteredCount === 0 ? 'No applicants match the selected criteria' : 
                      isTrainingNotStarted ? 'Cannot sync: The training for these applicants has not yet started.' : 
                      isHiringOngoing ? 'Cannot sync: Hiring process is still ongoing for this survey.' :
                      'Proceed to next step'
                    }
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSyncLoading ? 'Loading...' : <><FaArrowRight className="w-4 h-4" />Proceed</>}
                  </button>
                </div>
              </div>
            ) : syncModalStep === 'preview' ? (
              <div className="flex flex-col flex-1 min-h-0">
                <p className="mb-4 text-gray-700 dark:text-gray-300 flex-shrink-0">
                  Found <strong>{syncPreviewApplicants.length}</strong> assessed applicant(s) for <strong>{syncSelectedSurveyName}</strong> — <strong>{syncSelectedPosition}</strong>.
                  {duplicateMarkers.size > 0 && <span className="text-yellow-700 dark:text-yellow-400"> ⚠ <strong>{duplicateMarkers.size}</strong> possible duplicate(s) are initially excluded.</span>}
                  {' '}Review below and click "Proceed Sync" to continue.
                </p>
                <div className="flex-1 overflow-auto rounded-lg border border-gray-300 dark:border-gray-600 mb-4">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900">
                      <tr>
                        <th className="p-3 text-center font-semibold w-12">Include</th>
                        <th className="p-3 text-left font-semibold">Name</th>
                        <th className="p-3 text-left font-semibold">Phone no.</th>
                        <th className="p-3 text-left font-semibold">Educational Attainment</th>
                        <th className="p-3 text-center font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {syncPreviewApplicants.map((app, index) => {
                        const duplicate = duplicateMarkers.get(app.id);
                        const isExcluded = excludedApplicants.has(app.id);
                        return (
                          <React.Fragment key={index}>
                            <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${duplicate && isExcluded ? 'opacity-50 bg-gray-100 dark:bg-gray-700' : duplicate ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}`}>
                              <td className="p-3 text-center">
                                {duplicate ? (
                                  <input
                                    type="checkbox"
                                    checked={!isExcluded}
                                    onChange={() => handleToggleExcludeApplicant(app.id)}
                                    className="w-4 h-4 text-yellow-600 bg-gray-100 border-yellow-300 rounded focus:ring-yellow-500 cursor-pointer"
                                    title={isExcluded ? 'Click to include this applicant in sync' : 'Click to exclude this applicant from sync'}
                                  />
                                ) : (
                                  <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">✓</span>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span className={isExcluded && duplicate ? 'line-through text-gray-500 dark:text-gray-400' : ''}>{[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}</span>
                                  {duplicate && (
                                    <span className="inline-block px-2 py-0.5 text-xs font-bold rounded bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                                      ⚠ {duplicate.duplicateStatus}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3">{app.phone_number || 'N/A'}</td>
                              <td className="p-3">{app.highest_grade_completed || 'N/A'}</td>
                              <td className="p-3 text-center">
                                {isExcluded && duplicate ? (
                                  <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-200">Excluded</span>
                                ) : duplicate ? (
                                  <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Potential Duplicate</span>
                                ) : (
                                  <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Assessed</span>
                                )}
                              </td>
                            </tr>
                            {duplicate && !isExcluded && (
                              <tr className="bg-yellow-50/50 dark:bg-yellow-900/10 border-b border-gray-200 dark:border-gray-700">
                                <td colSpan="5" className="p-3">
                                  <div className="text-sm text-gray-700 dark:text-gray-400">
                                    <div className="flex items-start gap-3">
                                      <div className="text-yellow-600 dark:text-yellow-400 font-bold mt-0.5">ℹ</div>
                                      <div className="flex-1">
                                        <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">
                                          Possible match with existing employee:
                                        </p>
                                        <p className="text-gray-700 dark:text-gray-400 mb-2">
                                          <span className="font-medium">{duplicate.duplicateMatch.type === 'exact' ? 'Exact Match' : 'Similar Name'}:</span>{' '}
                                          {duplicate.duplicateMatch.similarName || 'Name match detected'} 
                                          {duplicate.duplicateMatch.existingEmployeeId && (
                                            <span className="ml-2 font-mono text-xs bg-gray-300 dark:bg-gray-600 px-2 py-1 rounded">
                                              ID: {duplicate.duplicateMatch.existingEmployeeId}
                                            </span>
                                          )}
                                        </p>
                                      </div>
                                    </div>
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
                <div className="mt-auto pt-4 flex justify-end gap-2">
                  <button
                    type="button" onClick={handleCloseSyncModal}
                    className="flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                  >
                    <FiX className="w-4 h-4" />Cancel
                  </button>
                  <button
                    type="button" onClick={handleConfirmSyncFromPreview}
                    disabled={isSyncLoading}
                    title={isSyncLoading ? 'Syncing data...' : 'Confirm and proceed with sync'}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSyncLoading ? 'Syncing...' : <><FiDownload className="w-4 h-4" />Proceed Sync</>}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0">
                {syncResults && (
                  <>
                    <div className="flex-1 overflow-y-auto">
                    {syncResults.status === 'success' && <div className="p-3 text-green-800 bg-green-100 rounded-lg mb-4">{syncResults.message}</div>}
                    {syncResults.status === 'warning' && (
                      <div className="p-3 text-yellow-800 bg-yellow-100 rounded-lg mb-4">
                        <strong className="block mb-2">{syncResults.message}</strong>
                        {syncResults.warnings && syncResults.warnings.length > 0 && (
                          <ul className="pl-5 text-sm list-disc max-h-48 overflow-y-auto">
                            {syncResults.warnings.map((warn, index) => <li key={index}>{warn.message || warn}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    {syncResults.status === 'error' && (
                      <div className="p-3 text-red-800 bg-red-100 rounded-lg mb-4">
                        <strong className="block mb-2">{syncResults.message}</strong>
                        {syncResults.errors && syncResults.errors.length > 0 && (
                          <ul className="pl-5 text-sm list-disc max-h-48 overflow-y-auto">
                            {syncResults.errors.map((error, index) => <li key={index}>{error}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    </div>
                    <div className="mt-auto pt-4 flex justify-end gap-2">
                      {syncResults.status === 'warning' ? (
                        <>
                          <button
                            type="button" onClick={handleCloseSyncModal}
                            className="flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                          >
                            <FiX className="w-4 h-4" />Cancel
                          </button>
                          <button
                            type="button" onClick={handleProceedAsSyncDuplicates}
                            disabled={isSyncLoading}
                            title={isSyncLoading ? 'Syncing data...' : 'Proceed with sync despite warnings'}
                            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSyncLoading ? 'Syncing...' : <><FaArrowRight className="w-4 h-4" />Proceed Anyway</>}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button" onClick={handleCloseSyncModal}
                          className="flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                        >
                          <FiX className="w-4 h-4" />Close
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="z-50 w-full max-w-5xl rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white">Import Employee Records</h2>
            
            {importData.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">No data loaded. Please select a CSV file.</p>
              </div>
            ) : (
              <div>
                <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>{importData.length}</strong> records found. 
                    {Object.keys(importErrors).length > 0 && <span className="text-red-600 dark:text-red-400"> ⚠ <strong>{Object.keys(importErrors).length}</strong> record(s) have errors that must be fixed.</span>}
                    {Object.keys(importDuplicateMarkers).length > 0 && <span className="text-yellow-700 dark:text-yellow-400"> ⚠ <strong>{Object.keys(importDuplicateMarkers).length}</strong> possible duplicate(s) detected (currently excluded).</span>}
                  </p>
                </div>

                <div className="max-h-96 overflow-auto rounded-lg border border-gray-300 dark:border-gray-600 mb-4">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900">
                      <tr>
                        <th className="p-3 text-center font-semibold w-12">Status</th>
                        <th className="p-3 text-left font-semibold">First Name</th>
                        <th className="p-3 text-left font-semibold">Last Name</th>
                        <th className="p-3 text-left font-semibold">DOB</th>
                        <th className="p-3 text-left font-semibold">Sex</th>
                        <th className="p-3 text-left font-semibold">City</th>
                        <th className="p-3 text-left font-semibold">Barangay</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {importData.map((row, index) => {
                        const hasErrors = importErrors[index];
                        const duplicate = importDuplicateMarkers[index];
                        const isExcluded = excludedImportRows.has(index);
                        const hasIssues = hasErrors || duplicate;
                        
                        return (
                          <React.Fragment key={index}>
                            <tr className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${hasErrors ? 'bg-red-50 dark:bg-red-900/20' : duplicate ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''} ${isExcluded && hasIssues ? 'opacity-50' : ''}`}>
                              <td className="p-3 text-center">
                                {hasIssues ? (
                                  <input
                                    type="checkbox"
                                    checked={!isExcluded}
                                    onChange={() => handleToggleExcludeImportRow(index)}
                                    className={`w-4 h-4 rounded focus:ring-2 ${hasErrors ? 'text-red-600 border-red-300 focus:ring-red-500' : 'text-yellow-600 border-yellow-300 focus:ring-yellow-500'} bg-gray-100 cursor-pointer`}
                                    title={hasErrors ? 'Error: Cannot include without fixing CSV' : isExcluded ? 'Click to include this record' : 'Click to exclude this record'}
                                    disabled={hasErrors}
                                  />
                                ) : (
                                  <span className="inline-block px-2 py-1 text-xs font-bold rounded bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200">✓ OK</span>
                                )}
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-900 dark:text-white">{row.first_name || '—'}</span>
                                  {duplicate && (
                                    <span className="inline-block px-2 py-0.5 text-xs font-bold rounded bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200 whitespace-nowrap">
                                      ⚠ {duplicate.duplicateStatus}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3">
                                <span className="text-gray-900 dark:text-white">{row.last_name || '—'}</span>
                              </td>
                              <td className="p-3">
                                <span className={`${row.date_of_birth ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {row.date_of_birth || '—'}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`${row.sex ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {row.sex || '—'}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`${row.city ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {row.city || '—'}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`${row.barangay ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                  {row.barangay || '—'}
                                </span>
                              </td>
                            </tr>
                            {hasErrors && (
                              <tr className="bg-red-50/50 dark:bg-red-900/10 border-b border-gray-200 dark:border-gray-700">
                                <td colSpan="7" className="p-3">
                                  <div className="text-sm text-red-700 dark:text-red-400">
                                    <div className="flex items-start gap-2">
                                      <div className="font-bold mt-0.5 flex-shrink-0">✗</div>
                                      <div className="flex-1">
                                        <p className="font-semibold mb-2">Row {index + 2} - Fix in CSV file:</p>
                                        <ul className="list-disc pl-5 space-y-0.5">
                                          {hasErrors.map((err, errIdx) => (
                                            <li key={errIdx} className="text-xs">{err}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {duplicate && !hasErrors && !isExcluded && (
                              <tr className="bg-yellow-50/50 dark:bg-yellow-900/10 border-b border-gray-200 dark:border-gray-700">
                                <td colSpan="7" className="p-3">
                                  <div className="text-sm text-gray-700 dark:text-gray-400">
                                    <div className="flex items-start gap-3">
                                      <div className="text-yellow-600 dark:text-yellow-400 font-bold mt-0.5 flex-shrink-0">ℹ</div>
                                      <div className="flex-1">
                                        <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1">
                                          Possible match with existing employee:
                                        </p>
                                        <p className="text-gray-700 dark:text-gray-400 mb-2">
                                          <span className="font-medium">{duplicate.duplicateMatch.type === 'exact' ? 'Exact Match' : 'Similar Name'}:</span>{' '}
                                          {duplicate.duplicateMatch.similarName || 'Name match detected'} 
                                          {duplicate.duplicateMatch.existingEmployeeId && (
                                            <span className="ml-2 font-mono text-xs bg-gray-300 dark:bg-gray-600 px-2 py-1 rounded">
                                              ID: {duplicate.duplicateMatch.existingEmployeeId}
                                            </span>
                                          )}
                                        </p>
                                        <p className="text-yellow-700 dark:text-yellow-400 text-xs">
                                          ⚠ Currently excluded from import. Check the checkbox above to include it anyway.
                                        </p>
                                      </div>
                                    </div>
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

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCloseImportModal}
                    className="flex items-center gap-2 rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
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
            )}
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};


export default Employees;
