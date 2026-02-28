import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import { FiPlus } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import ProgressModal from '../components/Progress';
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

const parseCSV = (text) => {
  const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      if (values[j]) {
        obj[headers[j]] = values[j].replace(/"/g, '').trim();
      }
    }
    if (Object.keys(obj).length > 0 && obj[headers[0]]) {
      data.push(obj);
    }
  }
  return data;
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
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(initialFormState);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);
  const [viewingEmployee, setViewingEmployee] = useState(null);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [csvData, setCsvData] = useState([]);
  const [importResults, setImportResults] = useState(null);
  const [preImportErrors, setPreImportErrors] = useState([]);
  const fileInputRef = useRef(null);
  const [sortConfig, setSortConfig] = useState({ key: 'employee_id', direction: 'ascending' });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const rowsPerPage = 9;
  const [sessionState, setSessionState] = useState(null);
  const [userPermissions, setUserPermissions] = useState({ canManage: false });
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isProgressComplete, setIsProgressComplete] = useState(false);
  const [savedFilePath, setSavedFilePath] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const viewModalRef = useRef(null);

  useClickOutside(viewModalRef, () => {
      if (viewingEmployee) handleCloseViewModal();
  });

  const handleCloseAddEditModal = useCallback(() => {
      setIsModalOpen(false);
      setError(null);
      setFormData(initialFormState);
  }, []);

  const handleCloseViewModal = useCallback(() => {
      setViewingEmployee(null);
  }, []);

  const handleCloseImportModal = useCallback(() => {
      setIsImportModalOpen(false);
      setImportResults(null);
      setCsvData([]);
  }, []);

  const fetchEmployees = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('employees', serverIp);
      setEmployees(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [serverIp]);

  const fetchMunicipalities = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('municipalities', serverIp);
      setMunicipalities(data);
    } catch (err) {
      console.error("Failed to fetch municipalities:", err);
      setError("Could not load location data.");
    }
  }, [serverIp]);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        if (state && state.user) {
          setSessionState(state);
          setUserPermissions({
            canManage: ['Super_Admin', 'Admin', 'PACD'].includes(state.user.role)
          });
        } else {
          setError("Authentication failed. Please log in again.");
          setIsLoading(false);
        }
      } catch (err) {
        setError("Failed to retrieve session data.");
        setIsLoading(false);
      }
    };
    getSession();
  }, []);

  useEffect(() => {
    if (sessionState && !isSettingsLoading) { 
      fetchEmployees();
      fetchMunicipalities();
    }
  }, [sessionState, isSettingsLoading, fetchEmployees, fetchMunicipalities]);
  
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
      `.toLowerCase();
      return searchableString.includes(searchLower);
    });
  }, [employeesWithAge, searchQuery]);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

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
  
  const totalPages = Math.ceil(sortedEmployees.length / rowsPerPage);
  const indexOfLastItem = currentPage * rowsPerPage;
  const indexOfFirstItem = indexOfLastItem - rowsPerPage;
  const currentItems = sortedEmployees.slice(indexOfFirstItem, indexOfLastItem);
  
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

  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
  
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };
  
  const requestSort = (key) => {
    setCurrentPage(1);
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

  const handleDownloadTemplate = () => {
    const headers = ["first_name", "middle_initial", "last_name", "suffix", "email", "phone_number", "date_of_birth", "sex", "tin_no", "barangay", "city", "highest_grade_completed"];
    const exampleData = `"Bonifacio","G.","Calizar","Jr","angelicademunyo@example.com","9179836137","1990-05-15","Male","123-456-789","Bulanao","Tabuk City","Bachelor of Computer Sayang"`;
    const content = headers.join(',') + "\n" + exampleData;
    
    handleCsvDownload(content, 'template_employee_records_template.csv');
  };

  const handleImportClick = () => {
    setImportResults(null);
    setPreImportErrors([]);
    fileInputRef.current.click();
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const parsedData = parseCSV(text);
        const errors = [];
        const requiredFields = ['first_name', 'middle_initial', 'last_name', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
        parsedData.forEach((row, index) => {
          const missingFields = requiredFields.filter(field => !row[field] || row[field].trim() === '');
          if (missingFields.length > 0) {
            errors.push(`Row ${index + 2}: Missing required fields: ${missingFields.join(', ')}.`);
          }
        });
        setPreImportErrors(errors);
        setCsvData(parsedData);
        setIsImportModalOpen(true);
      };
      reader.readAsText(file);
    }
    event.target.value = null;
  };

  const handleIdExport = (newlyImported) => {
    const headers = ["employee_id", "full_name", "status"];
    const csvContent = [
      headers.join(','),
      ...newlyImported.map(emp => `"${emp.employee_id}","${emp.full_name}","${emp.status || 'New Record'}"`)
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `newly_imported_employee_ids_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleConfirmImport = async (ignoreWarnings = false, recordsToSkip = new Map()) => {
    const shouldIgnore = ignoreWarnings === true;
    if (csvData.length === 0 || !sessionState) return;
    
    let dataToSend = csvData;
    let skippedRecords = [];
    
    if (!shouldIgnore) {
        setError(null);
        setImportResults({ status: 'importing', message: 'Importing, please wait...' });
    } else {
        // Filter out records marked to skip (duplicates)
        dataToSend = [];
        csvData.forEach((row, index) => {
            if (recordsToSkip.has(index)) {
                skippedRecords.push({
                    employee_id: recordsToSkip.get(index) || 'SKIPPED',
                    full_name: `${row.first_name} ${row.middle_initial || ''} ${row.last_name} ${row.suffix || ''}`.trim(),
                    status: 'Skipped (Duplicate)'
                });
            } else {
                dataToSend.push(row);
            }
        });

        if (dataToSend.length === 0) {
            handleIdExport(skippedRecords);
            setImportResults({ status: 'success', message: 'All records were marked as duplicates and skipped. Export generated.' });
            return;
        }
    }
    try {
        const result = await apiFetch('employees/import', serverIp, { // 3. PASS serverIp
            method: 'POST',
            body: JSON.stringify({ actingUserId: sessionState.user.id, employees: dataToSend, ignoreWarnings: shouldIgnore })
        });
        
        // Combine server results with client-skipped records for the report
        const combinedResults = result.newlyImported ? [...result.newlyImported, ...skippedRecords] : skippedRecords;

        if (combinedResults.length > 0) {
            handleIdExport(combinedResults);
            result.message = `${result.message} A reference file with their new IDs has been downloaded.`;
        }
        setImportResults({ status: result.errors ? 'partial' : 'success', ...result });
        fetchEmployees();

    } catch (err) {
        const errorPayload = { status: 'error', message: 'An unknown error occurred.', errors: [] };
        // Prefer the structured payload attached by apiFetch (err.data)
        const structured = err.data || (() => { try { return JSON.parse(err.message); } catch { return null; } })();
        if (structured) {
            if (structured.errors && structured.errors.length > 0) {
                errorPayload.message = 'Please fix the following errors in your file:';
                errorPayload.errors = structured.errors;
            } else {
                errorPayload.message = structured.message || structured.error || err.message;
            }
        } else {
            errorPayload.message = err.message;
        }
        setImportResults(errorPayload);
    }
  };

  const handleProceedAsDuplicates = () => {
    const fuzzyMap = new Map();
    if (importResults && importResults.warnings) {
        importResults.warnings.forEach(w => {
            if (typeof w === 'object') fuzzyMap.set(w.index, w.existingEmployeeId);
        });
    }
    handleConfirmImport(true, fuzzyMap);
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
    setSelectedMunicipalityId('');
    setError(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (employee) => {
    const dob = employee.date_of_birth ? employee.date_of_birth.substring(0, 10) : '';
    setEditingEmployee(employee);
    setFormData({ ...employee, date_of_birth: dob });
    const selectedMun = municipalities.find(m => m.name === employee.city);
    setSelectedMunicipalityId(selectedMun ? selectedMun.id : '');
    setError(null);
    setIsModalOpen(true);
  };

  const handleViewClick = (employee) => {
    setViewingEmployee(employee);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
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
      setSuccessMessage('Employee deleted successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
      setEmployeeToDelete(null);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const phoneRegex = /^9\d{9}$/;
    if (formData.phone_number && !phoneRegex.test(formData.phone_number)) {
      setError('Invalid phone number. It must be 10 digits and start with 9 (e.g., 9171234567).');
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
      setSuccessMessage(method === 'PUT' ? 'Employee updated successfully.' : 'Employee added successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
            try {
                const parsedError = JSON.parse(err.message);
                setError(parsedError.error || parsedError.message || "An unknown error occurred.");
            } catch (e) {
                setError(err.message);
            }
        }
    };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allFilteredIds = sortedEmployees.map(emp => emp.id);
      setSelectedEmployees(new Set(allFilteredIds));
    } else {
      setSelectedEmployees(new Set());
    }
  };

  const handleSelectSingle = (employeeId) => {
    const newSelection = new Set(selectedEmployees);
    if (newSelection.has(employeeId)) {
      newSelection.delete(employeeId);
    } else {
      newSelection.add(employeeId);
    }
    setSelectedEmployees(newSelection);
  };

  const handleClearSelection = () => {
    setSelectedEmployees(new Set());
  };

  const handleExportSelected = () => {
    if (selectedEmployees.size === 0) return;
    const dataToExport = employees.filter(emp => selectedEmployees.has(emp.id));
    const headers = ["employee_id", "first_name", "middle_initial", "last_name", "suffix", "email", "phone_number", "date_of_birth", "sex", "tin_no", "barangay", "city", "highest_grade_completed"];
    const csvContent = [
      headers.join(','),
      ...dataToExport.map(item => {
        const BDate = formatDateForExport(item.date_of_birth);
        const row = [item.employee_id, item.first_name, item.middle_initial, item.last_name, item.suffix, item.email, item.phone_number, BDate, item.sex, item.tin_no, item.barangay, item.city, item.highest_grade_completed];
        return row.map(val => `"${val || ''}"`).join(',');
      })
    ].join('\n');
    
    const fileName = `exported_employee_records_${new Date().toISOString().split('T')[0]}.csv`;
    handleCsvDownload(csvContent, fileName);
  };

  return (
    <div>
      {successMessage && (
        <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
          <span>✓</span> {successMessage}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
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
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".csv" />
            <button onClick={handleAddClick} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700"><FiPlus />Add New Employee Record</button>
            <div className="flex-grow" />
            <button onClick={handleDownloadTemplate} className="px-4 py-2 font-semibold text-white bg-gray-500 rounded-lg shadow-md hover:bg-gray-600">Download Template</button>
            <button onClick={handleImportClick} className="px-4 py-2 font-semibold text-white bg-green-600 rounded-lg shadow-md hover:bg-green-700">Import CSV</button>
            <button onClick={handleExportSelected} disabled={selectedEmployees.size === 0} className="px-4 py-2 font-semibold text-gray-800 bg-yellow-400 rounded-lg shadow-md hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed">
              Export Selected ({selectedEmployees.size})
            </button>
            {selectedEmployees.size > 0 && (
              <button onClick={handleClearSelection} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-lg shadow-md hover:bg-red-700">
                Clear Selection
              </button>
            )}
          </>
        )}
      </div>

      {error && !isModalOpen && !employeeToDelete && !viewingEmployee && !isImportModalOpen && <div className="p-3 mb-4 text-center text-red-700 bg-red-100 rounded-lg">{error}</div>}

      <div className="overflow-x-auto bg-white rounded-lg shadow h-[760px] dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              {userPermissions.canManage && (
                <th className="w-12 px-5 py-3.5">
                  <input type="checkbox" onChange={handleSelectAll} checked={sortedEmployees.length > 0 && selectedEmployees.size === sortedEmployees.length} ref={el => el && (el.indeterminate = selectedEmployees.size > 0 && selectedEmployees.size < sortedEmployees.length)} className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500" />
                </th>
              )}
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
            {currentItems.length > 0 ? (
              currentItems.map((emp) => (
                <tr key={emp.id} className={`transition-colors duration-200 ease-in-out border-b border-gray-200 dark:border-gray-700 ${selectedEmployees.has(emp.id) ? 'bg-blue-50 dark:bg-blue-900/50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  {userPermissions.canManage && (
                    <td className="px-5 py-4"><input type="checkbox" checked={selectedEmployees.has(emp.id)} onChange={() => handleSelectSingle(emp.id)} className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500" /></td>
                  )}
                  <td className="px-5 py-4 font-medium text-gray-900 dark:text-white">
                    <p className="font-medium text-gray-900 whitespace-no-wrap dark:text-white">{[emp.first_name, emp.middle_initial, emp.last_name, emp.suffix].filter(Boolean).join(' ')}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{emp.employee_id}</p>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{calculateAge(emp.date_of_birth)}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{emp.phone_number}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{emp.highest_grade_completed}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center space-x-3">
                      <button onClick={() => handleViewClick(emp)} className="font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">View</button>
                      {userPermissions.canManage && <>
                        <button onClick={() => handleEditClick(emp)} className="font-medium text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Edit</button>
                        <button onClick={() => handleDeleteClick(emp)} className="font-medium text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={userPermissions.canManage ? 7 : 6} className="py-16 text-center text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Records Found</h3>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="flex justify-between items-center mt-1">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {Math.min((currentPage - 1) * rowsPerPage + 1, filteredEmployees.length)} to {Math.min(currentPage * rowsPerPage, filteredEmployees.length)} of {filteredEmployees.length} records
        </span>
        <div className="flex items-center space-x-2">
          <button 
            onClick={handlePreviousPage} 
            disabled={currentPage === 1} 
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-gray-700 dark:text-gray-300 px-2">
            {currentPage}
          </span>
          <button 
            onClick={handleNextPage} 
            disabled={currentPage === totalPages} 
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="flex flex-col w-full max-w-3xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingEmployee ? 'Edit Employee' : 'Add New Employee Record'}</h2>
            </div>
            <form id="addEditForm" onSubmit={handleFormSubmit} className="flex-auto p-6 overflow-y-auto">
              {error && <div className="mb-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</div>}
              <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-6">
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name*</label><input type="text" name="first_name" value={formData.first_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Middle Initial*</label><input type="text" name="middle_initial" value={formData.middle_initial} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name*</label><input type="text" name="last_name" value={formData.last_name} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-1"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Suffix</label><input type="text" name="suffix" value={formData.suffix} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address (e.g. angelicademunyo@gmial.com)</label><input type="email" name="email" value={formData.email} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number (e.g. 9179836137)</label><input type="tel" name="phone_number" value={formData.phone_number} onChange={handleInputChange} pattern="^9\d{9}$" maxLength="10" title="Must be 10 digits starting with 9" className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Date of Birth*</label><input type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sex*</label><select name="sex" value={formData.sex} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"><option value="" hidden></option><option value="Male">Male</option><option value="Female">Female</option></select></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">TIN (e.g. 123-456-789)</label><input type="text" name="tin_no" value={formData.tin_no} onChange={handleInputChange} className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">City/Municipality*</label><select name="city" value={formData.city} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"><option value="" hidden></option>{municipalities.map(mun => (<option key={mun.id} value={mun.name}>{mun.name}</option>))}</select></div>
                <div className="sm:col-span-3"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Barangay*</label><select name="barangay" value={formData.barangay} onChange={handleInputChange} disabled={!formData.city} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"><option value="" hidden></option>{barangays.map(bgy => (<option key={bgy.id} value={bgy.name}>{bgy.name}</option>))}</select></div>
                <div className="sm:col-span-6"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Highest Grade Completed (Specify Course if College Graduate)*</label><input type="text" name="highest_grade_completed" value={formData.highest_grade_completed} onChange={handleInputChange} required className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" /></div>
              </div>
            </form>
            <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
              <button type="button" onClick={handleCloseAddEditModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
              <button type="submit" form="addEditForm" className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700">Save</button>
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
              <button onClick={() => setEmployeeToDelete(null)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700">Delete</button>
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
              <button type="button" onClick={handleCloseViewModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Close</button>
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
      {isImportModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="z-50 w-full max-w-4xl rounded-lg bg-white p-6 shadow-2xl dark:bg-gray-800">
            <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-white">Confirm Import</h2>
            {importResults ? (
              <div>
                {importResults.status === 'importing' && <div className="p-3 text-blue-800 bg-blue-100 rounded-lg">{importResults.message}</div>}
                {importResults.status === 'success' && <div className="p-3 text-green-800 bg-green-100 rounded-lg">{importResults.message}</div>}
                {importResults.status === 'partial' && <div className="p-3 text-yellow-800 bg-yellow-100 rounded-lg">{importResults.message}</div>}
                {importResults.status === 'warning' && (
                  <div className="p-3 text-yellow-800 bg-yellow-100 rounded-lg">
                    <strong className="block mb-2">{importResults.message}</strong>
                    {importResults.warnings && importResults.warnings.length > 0 && (
                      <ul className="pl-5 text-sm list-disc max-h-48 overflow-y-auto">
                        {importResults.warnings.map((warn, index) => <li key={index}>{warn.message || warn}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {importResults.status === 'error' && (
                  <div className="p-3 text-red-800 bg-red-100 rounded-lg">
                    <strong className="block mb-2">{importResults.message}</strong>
                    {importResults.errors && importResults.errors.length > 0 && (
                      <ul className="pl-5 text-sm list-disc max-h-48 overflow-y-auto">
                        {importResults.errors.map((error, index) => <li key={index}>{error}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  {importResults.status === 'warning' ? (
                    <>
                      <button
                        type="button" onClick={() => setIsImportModalOpen(false)}
                        className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="button" onClick={handleProceedAsDuplicates}
                        className="rounded-lg bg-yellow-500 px-4 py-2 font-semibold text-white hover:bg-yellow-600"
                      >
                        Duplicate
                      </button>
                      <button
                        type="button" onClick={() => handleConfirmImport(true)}
                        className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
                      >
                        New Employee
                      </button>
                    </>
                  ) : (
                    <button
                      type="button" onClick={() => setIsImportModalOpen(false)}
                      className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                    >
                      Close
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {preImportErrors.length > 0 ? (
                  <div>
                    <div className="p-3 mb-4 text-red-800 bg-red-100 rounded-lg">
                      <strong className="block mb-2">Errors detected in CSV file:</strong>
                      <ul className="pl-5 text-sm list-disc max-h-48 overflow-y-auto">
                        {preImportErrors.map((error, index) => <li key={index}>{error}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="mb-4 text-gray-700 dark:text-gray-300">
                    Found {csvData.length} records to import. Please review the first few rows below before confirming.
                  </p>
                )}
                <div className="max-h-64 overflow-auto rounded-lg border border-gray-300 dark:border-gray-600">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900">
                      <tr>
                        {csvData.length > 0 && Object.keys(csvData[0]).map(header => (
                          <th key={header} className="p-2 text-left font-semibold">{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {csvData.slice(0, 5).map((row, index) => (
                        <tr key={index}>
                          {Object.values(row).map((val, i) => (
                            <td key={i} className="whitespace-nowrap p-2">{val}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvData.length > 5 && (
                  <p className="mt-2 text-xs text-gray-500">
                    ...and {csvData.length - 5} more rows.
                  </p>
                )}
                <div className="mt-6 flex justify-end space-x-4">
                  <button
                    type="button" onClick={handleCloseImportModal}
                    className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleConfirmImport(false)}
                    className="px-4 py-2 font-semibold text-white bg-green-600 rounded-lg disabled:opacity-50"
                    disabled={preImportErrors.length > 0 || csvData.length === 0}
                  >
                    Confirm Import
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Employees;