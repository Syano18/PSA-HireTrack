import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FaSort, FaSortUp, FaSortDown, FaSearch, FaCertificate, FaFilePdf, FaDownload, FaTimes, FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import { FiX, FiSave } from 'react-icons/fi';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import ProgressModal from '../components/Progress';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const apiEndpoints = {
  Training: { download: 'generate-certificate' },
  SingleEmployment: { download: 'generate-employment-certificate' },
  MultiEmployment: { download: 'generate-multi-employment-certificate' },
  BatchTraining: { download: 'generate-batch-training-certificate' },
  ByTrainingTitle: { download: 'generate-certificates-by-training' }
};

// Helper function to parse comma or semicolon separated data
const parseEmploymentData = (data) => {
  if (!data) return [];
  const items = data.split(/[;,]/).map(item => item.trim()).filter(Boolean);
  return items.length > 0 ? items : [data];
};

const Certificates = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { toasts, showToast, removeToast } = useToast();
  const [employees, setEmployees] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [employments, setEmployments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState('employee');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployments, setSelectedEmployments] = useState([]);
  const [selectedTrainings, setSelectedTrainings] = useState([]);
  const [modalSearchTerm, setModalSearchTerm] = useState("");
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [isProgressComplete, setIsProgressComplete] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'ascending' });
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [sessionState, setSessionState] = useState(null);
  const [savedFilePath, setSavedFilePath] = useState(null);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [validationInput, setValidationInput] = useState('');
  const [validationResult, setValidationResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [generatedCerts, setGeneratedCerts] = useState([]);
  const [hoveredGeneratedTraining, setHoveredGeneratedTraining] = useState(null);
  const [generatedTitlesList, setGeneratedTitlesList] = useState([]);

  const fetchGeneratedTitles = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('batch-generated-titles', serverIp);
      setGeneratedTitlesList(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast('Could not fetch generated titles: ' + err.message, 'error');
    }
  }, [serverIp, showToast]);

  const fetchData = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const [employeesData, trainingsData, employmentsData] = await Promise.all([
        apiFetch('employees', serverIp),
        apiFetch('trainings', serverIp),
        apiFetch('employments', serverIp)
      ]);

      setEmployees(employeesData);
      setTrainings(trainingsData);
      setEmployments(employmentsData);
    } catch (err) {
      showToast(err.message || "An unexpected error occurred.", 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, showToast]);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        setSessionState(state);
      } catch (err) {
        showToast("Failed to retrieve session data. Please log in.", 'error');
        setIsLoading(false);
      }
    };
    getSession();
  }, [showToast]);

  useEffect(() => {
    if (sessionState && !isSettingsLoading) {
      fetchData();
      fetchGeneratedTitles();
    }
  }, [sessionState, isSettingsLoading, fetchData, fetchGeneratedTitles]);

  const masterEmployeeList = useMemo(() => {
    if (employees.length === 0) return [];
    const employeeMap = new Map();
    employees.forEach(emp => {
      employeeMap.set(emp.employee_id, {
        id: emp.employee_id, firstName: emp.first_name, lastName: emp.last_name, middleInitial: emp.middle_initial, suffix: emp.suffix,
        sex: emp.sex, barangay: emp.barangay, municipality: emp.city,
        trainings: [], employments: [],
      });
    });
    trainings.forEach(training => {
      const employeeId = training.employee_identifier;
      if (employeeMap.has(employeeId)) {
        employeeMap.get(employeeId).trainings.push({
          trainingTitle: training.training_title, hours: training.hours, startDate: training.start_date,
          endDate: training.end_date, venue: training.venue,
        });
      }
    });
    employments.forEach(employment => {
      const employeeId = employment.emp_id_str;
      if (employeeMap.has(employeeId)) {
        if (employment.remarks && employment.remarks.startsWith('REPLACED')) return;
        employeeMap.get(employeeId).employments.push({
          position: employment.position_title, project_name: employment.survey_name,
          contract_start_date: employment.contract_start_date, contract_end_date: employment.contract_end_date,
          performance_rating: employment.rating, remarks: employment.remarks,
        });
      }
    });
    return Array.from(employeeMap.values());
  }, [employees, trainings, employments]);

  const searchedEmployees = useMemo(() => {
    if (!globalSearchTerm) return masterEmployeeList;
    return masterEmployeeList.filter(employee =>
      `${employee.firstName} ${employee.lastName}`.toLowerCase().includes(globalSearchTerm.toLowerCase())
    );
  }, [masterEmployeeList, globalSearchTerm]);

  const sortedData = useMemo(() => {
    let sortableItems = [...searchedEmployees];
    if (sortConfig.key) {
      sortableItems.sort((a, b) => {
        const keyA = a[sortConfig.key] || ''; const keyB = b[sortConfig.key] || '';
        if (keyA.toLowerCase() < keyB.toLowerCase()) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (keyA.toLowerCase() > keyB.toLowerCase()) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [searchedEmployees, sortConfig]);

  const trainingTitleList = useMemo(() => {
    const trainingMap = new Map();
    trainings.forEach(training => {
      const title = training.training_title;
      if (!trainingMap.has(title)) {
        trainingMap.set(title, {
          title: title,
          participants: new Set(),
          startDate: new Date(training.start_date),
          endDate: new Date(training.end_date),
        });
      }
      const entry = trainingMap.get(title);
      entry.participants.add(training.employee_identifier);
      const currentStartDate = new Date(training.start_date);
      const currentEndDate = new Date(training.end_date);
      if (currentStartDate < entry.startDate) entry.startDate = currentStartDate;
      if (currentEndDate > entry.endDate) entry.endDate = currentEndDate;
    });

    return Array.from(trainingMap.values()).map(t => ({
      ...t,
      participantCount: t.participants.size
    }))
      .filter(t => t.participantCount > 1)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [trainings]);

  const searchedTrainingTitles = useMemo(() => {
    if (!globalSearchTerm) return trainingTitleList;
    return trainingTitleList.filter(training =>
      training.title.toLowerCase().includes(globalSearchTerm.toLowerCase())
    );
  }, [trainingTitleList, globalSearchTerm]);


  const totalItems = viewMode === 'employee' ? sortedData.length : searchedTrainingTitles.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const currentEmployeeItems = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const currentTrainingItems = searchedTrainingTitles.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [globalSearchTerm, viewMode]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1" /> : <FaSortDown className="inline-block ml-1" />;
  };

  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  const handleOpenModal = async (employee, mode) => {
    setSelectedEmployee(employee);
    setModalMode(mode);
    setIsModalOpen(true);
    setSelectedEmployments([]);
    setSelectedTrainings([]);
    setModalSearchTerm("");
    setGeneratedCerts([]);
    const fullName = `${employee.firstName} ${employee.middleInitial || ''} ${employee.lastName} ${employee.suffix || ''}`.replace(/\s+/g, ' ').trim();
    try {
      const data = await apiFetch(`check-generated?recipient_name=${encodeURIComponent(fullName)}`, serverIp);
      setGeneratedCerts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Could not fetch generated certificates:', err.message);
      setGeneratedCerts([]);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedEmployee(null);
    setModalMode(null);
    setSelectedEmployments([]);
    setSelectedTrainings([]);
    setModalSearchTerm("");
  };

  const filteredTrainings = useMemo(() => {
    if (!selectedEmployee) return [];
    return selectedEmployee.trainings.filter(training =>
      training.trainingTitle.toLowerCase().includes(modalSearchTerm.toLowerCase())
    );
  }, [selectedEmployee, modalSearchTerm]);

  const filteredEmployments = useMemo(() => {
    if (!selectedEmployee) return [];
    return selectedEmployee.employments.filter(employment =>
      employment.position.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
      employment.project_name.toLowerCase().includes(modalSearchTerm.toLowerCase())
    );
  }, [selectedEmployee, modalSearchTerm]);

  const handleTrainingSelectionChange = (trainingRecord) => {
    setSelectedTrainings(prev =>
      prev.some(item => item.trainingTitle === trainingRecord.trainingTitle)
        ? prev.filter(item => item.trainingTitle !== trainingRecord.trainingTitle)
        : [...prev, trainingRecord]
    );
  };

  const handleEmploymentSelectionChange = (employmentRecord) => {
    setSelectedEmployments(prev => prev.some(item => item.project_name === employmentRecord.project_name && item.position === employmentRecord.position)
      ? prev.filter(item => !(item.project_name === employmentRecord.project_name && item.position === employmentRecord.position))
      : [...prev, employmentRecord]
    );
  };

  // Returns the matching cert object if a training certificate has already been generated, or null otherwise.
  const isTrainingGenerated = useCallback((training) => {
    return generatedCerts.find(cert => {
      if (cert.type !== 'training' || cert.details?.source !== 'employee') return false;
      const storedTitles = (cert.details.training_title || '').split(', ').map(t => t.trim());
      if (!storedTitles.includes(training.trainingTitle)) return false;
      const storedHours = String(cert.details.training_hours || '').split(', ').map(h => h.trim());
      return storedHours.includes(String(training.hours || '').trim());
    }) || null;
  }, [generatedCerts]);

  // Returns the matching cert object if a single employment certificate has already been generated, or null otherwise.
  const isEmploymentGenerated = useCallback((employment) => {
    return generatedCerts.find(cert =>
      cert.type === 'employment' &&
      cert.details?.source === 'employee' &&
      cert.details?.employment_titles === employment.project_name &&
      cert.details?.position === employment.position &&
      (cert.details?.performance_rating || '') === (employment.performance_rating || '')
    ) || null;
  }, [generatedCerts]);

  // Returns the matching cert object if this exact combination of employments was already issued as a combined cert.
  const isMultiEmploymentGenerated = useCallback((employments) => {
    if (!employments || employments.length < 2) return null;
    const comboKey = employments.map(e => `${e.position}||${e.project_name}`).sort().join(',');
    return generatedCerts.find(cert =>
      cert.type === 'employment' &&
      cert.details?.source === 'multi-employee' &&
      cert.details?.combo_key === comboKey
    ) || null;
  }, [generatedCerts]);

  const fetchFile = async (endpointPath, payload, fileName, fileType = 'pdf', certificationType = 'training') => {
    if (!serverIp) {
      showToast('Server IP is not available.', 'error');
      return false;
    }
    setIsProgressComplete(false);
    setProgress(0);
    setProgressMessage('Preparing your file, please wait...');
    setIsProgressModalOpen(true);

    try {
      const API_PORT = 3001;
      const fullUrl = `http://${serverIp}:${API_PORT}/api/${endpointPath}`;

      const prepareResponse = await window.electronAPI.prepareDownload({
        url: fullUrl,
        payload: {
          headers: { 'Authorization': `Bearer ${sessionState.token}` },
          body: payload
        },
        fileType: fileType
      });

      if (!prepareResponse.success) {
        throw new Error(prepareResponse.message || 'Failed to prepare file for download.');
      }
      
      setProgressMessage('Saving certificate to local folder...');

      // Use auto-save instead of manual file dialog
      const saveResult = await window.electronAPI.autoSaveCertificate({
        downloadId: prepareResponse.downloadId,
        fileName: fileName,
        certificateType: certificationType
      });

      if (saveResult.status === 'completed') {
        setSavedFilePath(saveResult.path);
        
        // Close the progress modal immediately without showing completion buttons
        setIsProgressModalOpen(false);
        
        // Auto-open the certificate file
        setTimeout(() => {
          window.electronAPI.openFile(saveResult.path);
        }, 500);
        
        return saveResult.message;
      } else {
        throw new Error(saveResult.message);
      }
    } catch (err) {
      console.error(`Error downloading file:`, err.message);
      showToast(err.message, 'error');
      setIsProgressModalOpen(false);
      return false;
    }
  };
  
  const showCompletionModal = (message) => {
    setProgress(100);
    setIsProgressComplete(true);
    setProgressMessage(message);
    setIsProgressModalOpen(true);
  };

  const closeProgressModal = () => {
    setIsProgressModalOpen(false);
    setSavedFilePath(null);
  };

  // Validation function to check required fields
  const validateCertificateData = (type, employee, records) => {
    const errors = [];

    // Validate employee data
    if (!employee?.firstName || !employee?.lastName) {
      errors.push('Employee name (first and last) is required');
    }

    if (type === 'Training') {
      if (!Array.isArray(records) || records.length === 0) {
        errors.push('At least one training record is required');
        return errors;
      }

      records.forEach((record, index) => {
        const recordErrors = [];
        if (!record.trainingTitle || (typeof record.trainingTitle === 'string' && record.trainingTitle.trim() === '')) {
          recordErrors.push('Training Title');
        }
        if (!record.startDate || (typeof record.startDate === 'string' && record.startDate.trim() === '')) {
          recordErrors.push('Start Date');
        }
        if (!record.endDate || (typeof record.endDate === 'string' && record.endDate.trim() === '')) {
          recordErrors.push('End Date');
        }
        if (!record.hours || (typeof record.hours === 'string' && record.hours.trim() === '')) {
          recordErrors.push('Hours');
        }
        if (!record.venue || (typeof record.venue === 'string' && record.venue.trim() === '')) {
          recordErrors.push('Venue');
        }

        if (recordErrors.length > 0) {
          errors.push(`Training ${index + 1}: Missing or empty ${recordErrors.join(', ')}`);
        }
      });
    } else if (type === 'Employment') {
      if (!Array.isArray(records) || records.length === 0) {
        errors.push('At least one employment record is required');
        return errors;
      }

      records.forEach((record, index) => {
        const recordErrors = [];
        if (!record.position || (typeof record.position === 'string' && record.position.trim() === '')) {
          recordErrors.push('Position');
        }
        if (!record.project_name || (typeof record.project_name === 'string' && record.project_name.trim() === '')) {
          recordErrors.push('Project Name');
        }
        if (!record.contract_start_date || (typeof record.contract_start_date === 'string' && record.contract_start_date.trim() === '')) {
          recordErrors.push('Start Date');
        }
        if (!record.contract_end_date || (typeof record.contract_end_date === 'string' && record.contract_end_date.trim() === '')) {
          recordErrors.push('End Date');
        }

        if (recordErrors.length > 0) {
          errors.push(`Employment ${index + 1}: Missing or empty ${recordErrors.join(', ')}`);
        }
      });
    }

    return errors;
  };

  const handleDownloadTraining = (record, transmitterName, encodedBy) => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { 
      type: "Training", 
      name: fullName, 
      id: selectedEmployee.id, 
      first_name: selectedEmployee.firstName,
      middle_initial: selectedEmployee.middleInitial,
      last_name: selectedEmployee.lastName,
      suffix: selectedEmployee.suffix,
      trainingTitle: record.trainingTitle, thours: record.hours, startDate: record.startDate, endDate: record.endDate, venue: record.venue,
      transmitterName,
      encodedBy
    };
    return fetchFile(apiEndpoints.Training.download, certificateData, `Certificate-Training-${selectedEmployee.lastName}`, 'pdf', 'training');
  };

  const handleDownloadSingleEmployment = (record, withReference = false, transmitterName = '', encodedBy = '') => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { 
      type: "SingleEmployment", 
      name: fullName, 
      id: selectedEmployee.id, 
      sex: selectedEmployee.sex, 
      first_name: selectedEmployee.firstName,
      middle_initial: selectedEmployee.middleInitial,
      last_name: selectedEmployee.lastName,
      suffix: selectedEmployee.suffix,
      barangay: selectedEmployee.barangay, 
      municipality: selectedEmployee.municipality, 
      employee_id_str: selectedEmployee.id, 
      position: record.position, 
      project_name: record.project_name, 
      contract_start_date: record.contract_start_date, 
      contract_end_date: record.contract_end_date, 
      performance_rating: record.performance_rating, 
      remarks: record.remarks,
      withReference,
      transmitterName,
      encodedBy
    };
    return fetchFile(apiEndpoints.SingleEmployment.download, certificateData, `Certificate-Employment-${selectedEmployee.lastName}`, 'pdf', 'employment');
  };

  const handleDownloadMultiEmployment = (withReference = false, transmitterName = '', encodedBy = '') => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { 
      type: "MultiEmployment", 
      name: fullName, 
      id: selectedEmployee.id, 
      first_name: selectedEmployee.firstName,
      middle_initial: selectedEmployee.middleInitial,
      last_name: selectedEmployee.lastName,
      suffix: selectedEmployee.suffix,
      lastName: selectedEmployee.lastName, 
      sex: selectedEmployee.sex, 
      barangay: selectedEmployee.barangay, 
      municipality: selectedEmployee.municipality, 
      employments: [...selectedEmployments].sort((a, b) => new Date(a.contract_start_date) - new Date(b.contract_start_date)),
      withReference,
      transmitterName,
      encodedBy
    };
    return fetchFile(apiEndpoints.MultiEmployment.download, certificateData, `Certificate-Multi-Employment-${selectedEmployee.lastName}`, 'pdf', 'employment');
  };

  const handleDownloadBatchTraining = (transmitterName, encodedBy) => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { 
      type: "BatchTraining", 
      name: fullName, 
      id: selectedEmployee.id, 
      first_name: selectedEmployee.firstName,
      middle_initial: selectedEmployee.middleInitial,
      last_name: selectedEmployee.lastName,
      suffix: selectedEmployee.suffix,
      trainings: selectedTrainings.sort((a, b) => new Date(a.startDate) - new Date(b.startDate)),
      transmitterName,
      encodedBy
    };
    return fetchFile(apiEndpoints.BatchTraining.download, certificateData, `Certificate-Batch-Training-${selectedEmployee.lastName}`, 'pdf', 'training');
  };


  const handleEmploymentDownloadAction = () => {
    executeEmploymentDownload(true);
  };

  const executeEmploymentDownload = async (withReference) => {
    // Validate employment records before generating certificate
    const validationErrors = validateCertificateData('Employment', selectedEmployee, selectedEmployments);
    if (validationErrors.length > 0) {
      showToast(`Certificate cannot be generated: ${validationErrors.join(' | ')}`, 'error');
      return;
    }

    closeModal();
    const transmitterName = `${sessionState.user.first_name} ${sessionState.user.middle_initial} ${sessionState.user.last_name}`;
    const encodedBy = sessionState.user.email_address;
    let result = false;
    if (selectedEmployments.length === 1) {
      result = await handleDownloadSingleEmployment(selectedEmployments[0], withReference, transmitterName, encodedBy);
    } else if (selectedEmployments.length > 1) {
      result = await handleDownloadMultiEmployment(withReference, transmitterName, encodedBy);
    }
    if (typeof result === 'string') {
      // Download complete, PDF opens automatically
    }
  };

  const handleTrainingDownloadAction = async () => {
    // Validate training records before generating certificate
    const validationErrors = validateCertificateData('Training', selectedEmployee, selectedTrainings);
    if (validationErrors.length > 0) {
      showToast(`Certificate cannot be generated: ${validationErrors.join(' | ')}`, 'error');
      return;
    }

    closeModal();
    const transmitterName = `${sessionState.user.first_name} ${sessionState.user.middle_initial} ${sessionState.user.last_name}`;
    const encodedBy = sessionState.user.email_address;
    let result = false;
    if (selectedTrainings.length === 1) {
      result = await handleDownloadTraining(selectedTrainings[0], transmitterName, encodedBy);
    } else if (selectedTrainings.length > 1) {
      result = await handleDownloadBatchTraining(transmitterName, encodedBy);
    }
    if (typeof result === 'string') {
      // Download complete, PDF opens automatically
    }
  };

  const handleGenerateBatchByTitle = async (trainingTitle) => {
    // Validate that trainingTitle is not empty
    if (!trainingTitle || (typeof trainingTitle === 'string' && trainingTitle.trim() === '')) {
      showToast('Training title is required and cannot be empty', 'error');
      return;
    }

    const transmitterName = `${sessionState.user.first_name} ${sessionState.user.middle_initial} ${sessionState.user.last_name}`;
    const encodedBy = sessionState.user.email_address;
    const payload = { trainingTitle, transmitterName, encodedBy };
    const endpointPath = apiEndpoints.ByTrainingTitle.download;
    let interval = null; 

    try {
      setIsProgressComplete(false);
      setProgress(0);
      setProgressMessage(`Generating certificates for "${trainingTitle}"... This may take a moment.`);
      setIsProgressModalOpen(true);
      
      interval = setInterval(() => {
          setProgress(prev => {
              if (prev >= 95) {
                  clearInterval(interval);
                  return prev;
              }
              return prev + 5;
          });
      }, 400);

      const result = await fetchFile(
        endpointPath, 
        payload, 
        `Printable Certificates - ${trainingTitle}`, 
        'pdf',
        'training'
      );
      
      if (typeof result === 'string') {
          setProgress(100);
          setIsProgressComplete(true);
          setProgressMessage(result);
          fetchGeneratedTitles(); // refresh so button is disabled immediately
      }
    } catch (error) {
        console.error('Download error:', error);
        setIsProgressComplete(true);
        setProgressMessage(`Error: ${error.message}`);
    } finally {
        if (interval) {
          clearInterval(interval);
        }
    }
  };

  const handleClearGlobalSearch = () => {
    setGlobalSearchTerm('');
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // Try to parse a formatted date string like "January 5, 2026" back to YYYY-MM-DD
  const parseDateToInput = (formatted) => {
    if (!formatted) return '';
    const d = new Date(formatted);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return '';
  };

  // Extract start/end from stored training_dates like "January 1, 2026 - January 5, 2026"
  const splitTrainingDates = (datesStr) => {
    if (!datesStr) return { startDate: '', endDate: '' };
    const sep = datesStr.includes(' - ') ? ' - ' : null;
    if (sep) {
      const [a, b] = datesStr.split(sep);
      return { startDate: parseDateToInput(a), endDate: parseDateToInput(b) };
    }
    const d = parseDateToInput(datesStr);
    return { startDate: d, endDate: d };
  };

  // ─── Validation modal ─────────────────────────────────────────────────────
  const handleOpenValidationModal = () => {
    setIsValidationModalOpen(true);
    setValidationInput('');
    setValidationResult(null);
  };

  const handleValidate = async (e) => {
    e.preventDefault();
    if (!validationInput.trim()) return;
    setIsValidating(true);
    setValidationResult(null);
    try {
      const data = await apiFetch(`validate-certificate/${encodeURIComponent(validationInput.trim())}`, serverIp);
      setValidationResult(data);
    } catch (err) {
      setValidationResult({ valid: false, message: "Error connecting to server." });
    } finally {
      setIsValidating(false);
    }
  };

  // ─── Edit & Regenerate ────────────────────────────────────────────────────
  const handleOpenEdit = () => {
    if (!validationResult?.valid || !validationResult.data) return;
    const d    = validationResult.data;
    const type = d.certificate_type;

    if (type === 'training') {
      const { startDate, endDate } = splitTrainingDates(d.training_dates);
      setEditFormData({
        certType      : 'Participation',
        name          : d.recipient_name || '',
        trainingTitle : d.training_title  || '',
        startDate,
        endDate,
        thours        : d.training_hours  || '',
        venue         : '',
        refNumber     : d.reference_number,
        certificateType: type,
      });
    } else {
      // Match against masterEmployeeList (already has barangay + municipality correctly aliased)
      const match = masterEmployeeList.find(e => {
        const full = `${e.firstName} ${e.middleInitial || ''} ${e.lastName} ${e.suffix || ''}`.replace(/\s+/g, ' ').trim();
        return full === d.recipient_name;
      });
      setEditFormData({
        name              : d.recipient_name    || '',
        first_name        : match?.firstName    || '',
        middle_initial    : match?.middleInitial || '',
        last_name         : match?.lastName     || '',
        suffix            : match?.suffix       || '',
        sex               : match?.sex          || 'Male',
        barangay          : match?.barangay     || '',
        municipality      : match?.municipality || '',
        position          : d.position              || '',
        project_name      : d.employment_titles     || '',
        contract_duration : d.contract_duration     || '',
        performance_rating: d.performance_rating    || '',
        remarks           : d.remarks               || '',
        refNumber         : d.reference_number,
        certificateType   : type,
      });
    }
    setIsEditModalOpen(true);
  };

  const handleEditChange = (field, value) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleRegenerateSubmit = async (e) => {
    e.preventDefault();
    const type     = editFormData.certificateType;
    const endpoint = type === 'training'
      ? 'regenerate-training-certificate'
      : 'regenerate-employment-certificate';

    setIsEditModalOpen(false);

    const result = await fetchFile(
      endpoint,
      editFormData,
      `Certificate-Regenerated-${editFormData.last_name || editFormData.name || editFormData.refNumber}`
    );

    if (result) {
      // Refresh the validation result to reflect the updated data
      if (validationResult?.data?.reference_number) {
        try {
          const updated = await apiFetch(
            `validate-certificate/${encodeURIComponent(validationResult.data.reference_number)}`,
            serverIp
          );
          setValidationResult(updated);
        } catch (_) { /* non-critical */ }
      }
      showCompletionModal('Certificate regenerated and saved successfully!');
    }
  };

  if (isLoading || isSettingsLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-white">Generate Certificates</h1>
        <div className="w-full p-4 space-y-4 border border-gray-200 rounded-lg shadow animate-pulse dark:border-gray-700">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <div className="h-2.5 bg-gray-300 rounded-full dark:bg-gray-600 w-24 mb-2.5"></div>
                <div className="w-32 h-2 bg-gray-200 rounded-full dark:bg-gray-700"></div>
              </div>
              <div className="h-2.5 bg-gray-300 rounded-full dark:bg-gray-700 w-12"></div>
            </div>
          ))}
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col items-start justify-between gap-4 mb-6 md:flex-row md:items-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Generate Certificates</h1>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative">
            <button onClick={handleOpenValidationModal} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm">
              <FaCertificate /> Validate Certificate
            </button>
            {isValidationModalOpen && (
              <>
                {/* Backdrop — click outside to close */}
                <div className="fixed inset-0 z-[69]" onClick={() => setIsValidationModalOpen(false)} />
                {/* Dropdown panel */}
                <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] w-[500px] max-h-[calc(100vh-80px)] bg-white rounded-xl shadow-2xl dark:bg-gray-800 flex flex-col border border-gray-200 dark:border-gray-700">

                  {/* Header */}
                  <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <FaCertificate className="text-indigo-500" /> Validate Certificate
                    </h2>
                    <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Verify the authenticity of a certificate issued by PSA Kalinga.</p>
                  </div>

                  {/* Search bar */}
                  <div className="px-5 pt-4 pb-2 flex-shrink-0">
                    <form onSubmit={handleValidate} className="relative">
                      <input type="text" value={validationInput} onChange={(e) => setValidationInput(e.target.value)} placeholder="Enter Reference Number (e.g., 26CAR32-001)" className="w-full pl-3 pr-10 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                      <button type="submit" disabled={isValidating || !validationInput.trim()} title={isValidating ? 'Validating...' : !validationInput.trim() ? 'Enter employee name to validate' : 'Validate'} className="absolute right-2 top-2 p-1 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50">
                        {isValidating ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <FaSearch className="w-3.5 h-3.5" />}
                      </button>
                    </form>
                  </div>

                  {/* Result area */}
                  <div className="px-5 pb-3 space-y-3 flex-1 overflow-y-auto">
                    {validationResult && (
                      <div className={`rounded-lg overflow-hidden border-2 ${validationResult.valid ? 'border-green-500' : 'border-red-500'}`}>
                        <div className={`h-1 ${validationResult.valid ? 'bg-green-500' : 'bg-red-500'}`} />
                        <div className="p-4 bg-white dark:bg-gray-800">
                          {/* Status + source badges */}
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs tracking-wider border-[1.5px] ${validationResult.valid ? 'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-700' : 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700'}`}>
                              {validationResult.valid ? '✓ RECORD FOUND' : '✗ UNVERIFIED'}
                            </span>
                            {validationResult.valid && validationResult.data && (
                              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${
                                validationResult.data.source === 'external_partner'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-700'
                                  : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700'
                              }`}>
                                {validationResult.data.source === 'external_partner' ? '📂 External Partners' : '🏢 Employee'}
                              </span>
                            )}
                          </div>

                          {/* Failure reason */}
                          {!validationResult.valid && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-900 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
                              {validationResult.message || 'No record matches this reference number.'}
                            </div>
                          )}

                          {/* Details */}
                          {validationResult.valid && validationResult.data && (
                            <>
                              <div className="mb-3">
                                <div className="text-base font-bold text-slate-800 dark:text-white">{validationResult.data.recipient_name}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                  {validationResult.data.certificate_type ? validationResult.data.certificate_type.charAt(0).toUpperCase() + validationResult.data.certificate_type.slice(1) : ''} Certificate Holder
                                </div>
                              </div>
                              <div className="border-t border-slate-100 dark:border-gray-700">
                                {[
                                  { label: 'Reference No.', value: validationResult.data.reference_number },
                                  { label: 'Document Type', value: validationResult.data.certificate_type ? validationResult.data.certificate_type.charAt(0).toUpperCase() + validationResult.data.certificate_type.slice(1) + ' Certificate' : '' },
                                  ...(validationResult.data.certificate_type === 'training' ? [
                                    { label: 'Training Title', value: validationResult.data.training_title },
                                    { label: 'Dates', value: validationResult.data.training_dates },
                                    ...(validationResult.data.training_hours ? [{ label: 'Hours', value: `${validationResult.data.training_hours} hour(s)` }] : []),
                                  ] : []),
                                ].map(({ label, value }) => value ? (
                                  <div key={label} className="flex gap-2 py-2 border-b border-slate-100 dark:border-gray-700">
                                    <span className="min-w-[120px] text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider flex-shrink-0 pt-px">{label}</span>
                                    <span className="text-slate-800 dark:text-slate-200 text-sm leading-relaxed">{value}</span>
                                  </div>
                                ) : null)}

                                {/* Multiple Employments - Numbered Cards */}
                                {validationResult.data.certificate_type === 'employment' && validationResult.data.position && (
                                  <div className="mt-4 space-y-3">
                                    {parseEmploymentData(validationResult.data.position).map((position, idx) => (
                                      <div key={idx} className="bg-slate-50 dark:bg-gray-900/30 border border-slate-200 dark:border-gray-700 rounded-lg p-3">
                                        <div className="font-bold text-slate-800 dark:text-white text-sm mb-2 pb-2 border-b border-slate-200 dark:border-gray-700">
                                          📋 Employment Record #{idx + 1}
                                        </div>
                                        <div className="space-y-2 text-sm">
                                          <div className="flex gap-2">
                                            <span className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider flex-shrink-0 min-w-[90px]">Position</span>
                                            <span className="text-slate-800 dark:text-slate-200">{position}</span>
                                          </div>
                                          {parseEmploymentData(validationResult.data.employment_titles)[idx] && (
                                            <div className="flex gap-2">
                                              <span className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider flex-shrink-0 min-w-[90px]">Project</span>
                                              <span className="text-slate-800 dark:text-slate-200">{parseEmploymentData(validationResult.data.employment_titles)[idx]}</span>
                                            </div>
                                          )}
                                          {parseEmploymentData(validationResult.data.contract_duration)[idx] && (
                                            <div className="flex gap-2">
                                              <span className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider flex-shrink-0 min-w-[90px]">Duration</span>
                                              <span className="text-slate-800 dark:text-slate-200">{parseEmploymentData(validationResult.data.contract_duration)[idx]}</span>
                                            </div>
                                          )}
                                          {validationResult.data.performance_rating && (
                                            <div className="flex gap-2">
                                              <span className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider flex-shrink-0 min-w-[90px]">Performance</span>
                                              <span className="text-slate-800 dark:text-slate-200">{validationResult.data.performance_rating}</span>
                                            </div>
                                          )}
                                          {validationResult.data.remarks && (
                                            <div className="flex gap-2">
                                              <span className="text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider flex-shrink-0 min-w-[90px]">Commendation</span>
                                              <span className="text-slate-800 dark:text-slate-200">{validationResult.data.remarks}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Verification Note */}
                              <div className="mt-4 p-3 bg-amber-50 border border-amber-300 rounded-lg flex gap-3 dark:bg-amber-900/20 dark:border-amber-700">
                                <span className="text-lg flex-shrink-0">⚠️</span>
                                <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                                  <strong className="block mb-1 text-amber-950 dark:text-amber-100">Important Verification Step</strong>
                                  Please compare the details displayed above with the information printed on the physical certificate. If any details do not match, the certificate may have been tampered.
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center flex-shrink-0">
                    {validationResult?.valid && validationResult.data?.source === 'external_partner' ? (
                      <button onClick={handleOpenEdit} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400 shadow-sm">
                        ✏️ Edit &amp; Regenerate
                      </button>
                    ) : <span />}
                    <button onClick={() => setIsValidationModalOpen(false)} className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Close</button>
                  </div>

                </div>
              </>
            )}
          </div>
          <div className="flex items-center border rounded-lg p-0.5 bg-gray-100 dark:bg-gray-700">
            <button onClick={() => setViewMode('employee')} className={`px-3 py-1 text-sm rounded-md ${viewMode === 'employee' ? 'bg-white dark:bg-gray-900 text-blue-600 shadow' : 'text-gray-600 dark:text-gray-300'}`}>By Employee</button>
            <button onClick={() => setViewMode('training')} className={`px-3 py-1 text-sm rounded-md ${viewMode === 'training' ? 'bg-white dark:bg-gray-900 text-blue-600 shadow' : 'text-gray-600 dark:text-gray-300'}`}>By Training Title</button>
          </div>
          <div className="relative w-full md:w-64">
            <input type="text" value={globalSearchTerm} onChange={(e) => setGlobalSearchTerm(e.target.value)} placeholder={viewMode === 'employee' ? "Search Employees..." : "Search Trainings..."} className="w-full py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
            {globalSearchTerm && (
              <button onClick={handleClearGlobalSearch} type="button" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" aria-label="Clear search">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {viewMode === 'employee' ? (
        <div className="overflow-x-auto bg-white h-[800px] rounded-lg shadow dark:bg-gray-800">
          <table className="min-w-full leading-normal">
            <thead>
              <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                <th className="px-5 py-3.5 text-left">
                  <button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase">Employee Name {getSortIcon('last_name')}</button>
                </th>
                <th className="px-5 py-3.5 text-left font-semibold uppercase">No. Training Records</th>
                <th className="px-5 py-3.5 text-left font-semibold uppercase">No. Employment Records</th>
                <th className="px-5 py-3.5 text-center font-semibold tracking-wider uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentEmployeeItems.length > 0 ? (
                currentEmployeeItems.map((employee) => (
                  <tr key={employee.id} className="transition-colors duration-200 ease-in-out hover:bg-gray-100 dark:hover:bg-gray-700">
                    <td className="px-5 py-4 text-m border-b border-gray-200 dark:border-gray-700">
                      <p className="font-medium text-gray-900 whitespace-no-wrap dark:text-white">{`${employee.firstName} ${employee.middleInitial || ''} ${employee.lastName} ${employee.suffix || ''}`.trim()}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{employee.id}</p>
                    </td>
                    <td className="px-5 py-4 text-sm text-center border-b border-gray-200 dark:border-gray-700"><p className="text-gray-900 whitespace-no-wrap dark:text-gray-300">{employee.trainings.length}</p></td>
                    <td className="px-5 py-4 text-sm text-center border-b border-gray-200 dark:border-gray-700"><p className="text-gray-900 whitespace-no-wrap dark:text-gray-300">{employee.employments.length}</p></td>
                    <td className="px-5 py-4 text-sm text-center border-b border-gray-200 dark:border-gray-700">
                      <div className="flex justify-center space-x-2">
                        <button onClick={() => handleOpenModal(employee, 'Training')} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed" disabled={employee.trainings.length === 0} title={employee.trainings.length === 0 ? 'No training records available' : 'Generate training certificate'}><FaFilePdf className="w-4 h-4" />Training</button>
                        <button onClick={() => handleOpenModal(employee, 'Employment')} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 dark:bg-orange-700 dark:hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed" disabled={employee.employments.length === 0} title={employee.employments.length === 0 ? 'No employment records available' : 'Generate employment certificate'}><FaFilePdf className="w-4 h-4" />Employment</button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" className="py-12 text-center text-lg font-semibold text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Records Found</h3>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white h-[800px] rounded-lg shadow dark:bg-gray-800">
          <table className="min-w-full leading-normal">
            <thead>
              <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                <th className="px-5 py-3 text-sm font-semibold tracking-wider text-left text-gray-600 uppercase border-b-2 border-gray-200 cursor-pointer dark:bg-gray-900/50 dark:text-gray-300 dark:border-gray-700">Training Title</th>
                <th className="px-5 py-3 text-sm font-semibold tracking-wider text-left text-gray-600 uppercase border-b-2 border-gray-200 cursor-pointer dark:bg-gray-900/50 dark:text-gray-300 dark:border-gray-700">Participants</th>
                <th className="px-5 py-3 text-sm font-semibold tracking-wider text-left text-gray-600 uppercase border-b-2 border-gray-200 cursor-pointer dark:bg-gray-900/50 dark:text-gray-300 dark:border-gray-700">Date Range</th>
                <th className="px-5 py-3 text-sm font-semibold tracking-wider text-left text-gray-600 uppercase border-b-2 border-gray-200 cursor-pointer dark:bg-gray-900/50 dark:text-gray-300 dark:border-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentTrainingItems.length > 0 ? (
                currentTrainingItems.map((training) => (
                  <tr key={training.title} className="transition-colors duration-200 ease-in-out hover:bg-gray-100 dark:hover:bg-gray-700">
                    <td className="px-5 py-4 font-medium text-gray-900 border-b border-gray-200 dark:text-white dark:border-gray-700">{training.title}</td>
                    <td className="px-5 py-4 text-center border-b border-gray-200 dark:border-gray-700">{training.participantCount}</td>
                    <td className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">{`${training.startDate.toLocaleDateString()} - ${training.endDate.toLocaleDateString()}`}</td>
                    <td className="px-5 py-4 text-center border-b border-gray-200 dark:border-gray-700">
                      {generatedTitlesList.includes(training.title) ? (
                        <span title="Certificates for this training have already been generated." className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-400 bg-gray-200 rounded-lg cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"><FaFilePdf className="w-4 h-4" />Generated</span>
                      ) : (
                        <button onClick={() => handleGenerateBatchByTitle(training.title)} className="inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 transition-colors"><FaDownload className="w-4 h-4" />Download</button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" className="py-12 text-center text-gray-500 dark:text-gray-400">No trainings found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-center mt-1">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0} to {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems} records
        </span>
        <div className="flex items-center space-x-2">
          <button onClick={handlePreviousPage} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
            <FaArrowLeft className="w-4 h-4" />Previous
          </button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} title={currentPage >= totalPages ? 'Already on last page' : 'Go to next page'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Next<FaArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isModalOpen && selectedEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60">
          <div className="flex flex-col w-full max-w-2xl h-full max-h-[85vh] bg-white rounded-lg shadow-xl dark:bg-gray-800">
            <div className="flex-shrink-0 p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">{`Select ${modalMode} Records for`}</h3>
              <p className="mt-1 text-xl font-semibold text-blue-600 dark:text-blue-400">{`${selectedEmployee.firstName} ${selectedEmployee.lastName}`}</p>
              <div className="mt-4"><input type="text" value={modalSearchTerm} onChange={(e) => setModalSearchTerm(e.target.value)} placeholder={`Search ${modalMode} records...`} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-900 dark:border-gray-600 dark:text-white" /></div>
            </div>
            <div className="flex-auto overflow-y-auto">
              <ul className="p-6 space-y-3">
                {modalMode === 'Training' && (filteredTrainings.length > 0 ? (filteredTrainings.map((record, index) => { const isSelected = selectedTrainings.some(item => item.trainingTitle === record.trainingTitle); const alreadyGenerated = isTrainingGenerated(record); return ( <li key={index} onMouseEnter={() => alreadyGenerated && setHoveredGeneratedTraining(alreadyGenerated)} onMouseLeave={() => alreadyGenerated && setHoveredGeneratedTraining(null)} className={`rounded-lg shadow-sm transition-colors duration-200 ${alreadyGenerated ? 'opacity-60 bg-gray-100 dark:bg-gray-900/60' : isSelected ? 'bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-900'}`}> <label className={`flex items-center justify-between w-full p-4 ${alreadyGenerated ? 'cursor-not-allowed' : 'cursor-pointer'}`}> <div className="flex flex-col gap-0.5"><span className="font-medium text-gray-900 dark:text-white whitespace-normal break-words">{record.trainingTitle}</span></div> <input type="checkbox" className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 disabled:opacity-50" checked={isSelected} onChange={() => handleTrainingSelectionChange(record)} disabled={alreadyGenerated} /> </label> </li> ); })) : <p className="py-8 text-center text-gray-500 dark:text-gray-400">No matching training records found.</p>)}
                {modalMode === 'Employment' && (filteredEmployments.length > 0 ? (filteredEmployments.map((record, index) => { const isSelected = selectedEmployments.some(item => item.project_name === record.project_name && item.position === record.position); return ( <li key={index} className={`rounded-lg shadow-sm transition-colors duration-200 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-900'}`}> <label className="flex items-center justify-between w-full p-4 cursor-pointer"> <div className="flex flex-col gap-0.5"><span className="font-medium text-gray-900 dark:text-white whitespace-normal break-words">{`${record.position} (${record.project_name})`}</span></div> <input type="checkbox" className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600" checked={isSelected} onChange={() => handleEmploymentSelectionChange(record)} /> </label> </li> ); })) : <p className="py-8 text-center text-gray-500 dark:text-gray-400">No matching employment records found.</p>)}
              </ul>
            </div>
            {(() => {
              const multiIssuedCert = modalMode === 'Employment' && selectedEmployments.length > 1 ? isMultiEmploymentGenerated(selectedEmployments) : null;
              return (
                <div className="flex items-center justify-between flex-shrink-0 p-4 gap-4 bg-gray-50 border-t border-gray-200 dark:bg-gray-800/50 dark:border-gray-700">
                  {/* Left: info message */}
                  <div className="flex-1 text-xs text-amber-600 dark:text-amber-400 font-semibold">
                    {modalMode === 'Training' && hoveredGeneratedTraining && (
                      <span>✓ Certificate already issued — Ref: {hoveredGeneratedTraining.reference_number} — {hoveredGeneratedTraining.issued_at ? new Date(hoveredGeneratedTraining.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</span>
                    )}
                    {modalMode === 'Employment' && selectedEmployments.length === 1 && (() => { const sc = isEmploymentGenerated(selectedEmployments[0]); return sc ? <span>✓ Certificate already issued &mdash; Ref: {sc.reference_number} &mdash; {sc.issued_at ? new Date(sc.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</span> : null; })()}
                    {multiIssuedCert && (
                      <span>✓ Certificate already issued &mdash; Ref: {multiIssuedCert.reference_number} &mdash; {multiIssuedCert.issued_at ? new Date(multiIssuedCert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</span>
                    )}
                  </div>
                  {/* Right: Cancel + action button */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button onClick={closeModal} className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"><FaTimes className="w-4 h-4" />Cancel</button>
                    {modalMode === 'Training' && (
                      <button onClick={handleTrainingDownloadAction} className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={selectedTrainings.length === 0} title={selectedTrainings.length === 0 ? 'Select training records to download' : `Download ${selectedTrainings.length} certificate(s)`}><FaDownload className="w-4 h-4" />Download ({selectedTrainings.length})</button>
                    )}
                    {modalMode === 'Employment' && (
                      <button onClick={handleEmploymentDownloadAction} className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" disabled={selectedEmployments.length === 0 || (selectedEmployments.length === 1 && !!isEmploymentGenerated(selectedEmployments[0])) || !!multiIssuedCert} title={selectedEmployments.length === 0 ? 'Select employment records to download' : (selectedEmployments.length === 1 && isEmploymentGenerated(selectedEmployments[0])) ? 'This certificate has already been generated' : multiIssuedCert ? 'Cannot download multiple issued certificates' : `Download ${selectedEmployments.length} certificate(s)`}>
                        <FaDownload className="w-4 h-4" />Download ({selectedEmployments.length})
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ─── Edit & Regenerate Modal ─── */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl dark:bg-gray-800 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                ✏️ Edit Certificate & Regenerate
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Correct any misspelled entries below. The same reference number will be kept and the digital logbook will be updated.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleRegenerateSubmit} className="overflow-y-auto flex-1">
              <div className="p-5 space-y-4">

                {/* ----- TRAINING FIELDS ----- */}
                {editFormData.certificateType === 'training' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Recipient Name</label>
                        <input type="text" value={editFormData.name} onChange={e => handleEditChange('name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" required />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Training Title</label>
                        <input type="text" value={editFormData.trainingTitle} onChange={e => handleEditChange('trainingTitle', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" required />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Start Date</label>
                        <input type="date" value={editFormData.startDate} onChange={e => handleEditChange('startDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">End Date</label>
                        <input type="date" value={editFormData.endDate} onChange={e => handleEditChange('endDate', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Hours</label>
                        <input type="text" value={editFormData.thours} onChange={e => handleEditChange('thours', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Certificate Type</label>
                        <select value={editFormData.certType} onChange={e => handleEditChange('certType', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400">
                          <option value="Participation">Participation</option>
                          <option value="Completion">Completion</option>
                          <option value="Appreciation">Appreciation</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Venue</label>
                        <input type="text" value={editFormData.venue} onChange={e => handleEditChange('venue', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                    </div>
                  </>
                )}

                {/* ----- EMPLOYMENT FIELDS ----- */}
                {editFormData.certificateType === 'employment' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">First Name</label>
                        <input type="text" value={editFormData.first_name} onChange={e => handleEditChange('first_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Last Name</label>
                        <input type="text" value={editFormData.last_name} onChange={e => handleEditChange('last_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Barangay</label>
                        <input type="text" value={editFormData.barangay} onChange={e => handleEditChange('barangay', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Municipality</label>
                        <input type="text" value={editFormData.municipality} onChange={e => handleEditChange('municipality', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Position</label>
                        <input type="text" value={editFormData.position} onChange={e => handleEditChange('position', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Project/Assignment</label>
                        <input type="text" value={editFormData.project_name} onChange={e => handleEditChange('project_name', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Duration</label>
                        <input type="text" value={editFormData.contract_duration} onChange={e => handleEditChange('contract_duration', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Performance Rating</label>
                        <input type="text" value={editFormData.performance_rating} onChange={e => handleEditChange('performance_rating', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Notes / Commendations</label>
                        <textarea rows={2} value={editFormData.remarks} onChange={e => handleEditChange('remarks', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-amber-400 resize-none" />
                      </div>
                    </div>
                  </>
                )}

                <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                  Reference No.: <strong>{editFormData.refNumber}</strong> will be preserved. No new logbook entry will be created.
                </p>
              </div>

              {/* Footer */}
              <div className="px-5 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
                  <FiX className="w-4 h-4" />Cancel
                </button>
                <button type="submit" className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700">
                  <FiSave className="w-4 h-4" />Save &amp; Regenerate PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ProgressModal
        isOpen={isProgressModalOpen}
        onClose={closeProgressModal}
        progress={progress}
        statusMessage={progressMessage}
        isComplete={isProgressComplete}
        filePath={savedFilePath}
      />

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};

export default Certificates;