import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiPlus } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import ProgressModal from '../components/Progress';
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
const parseCSV = (text) => {
    const lines = text.split(/\r\n|\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = headers.reduce((acc, header, index) => {
            if (values[index]) acc[header] = values[index].replace(/"/g, '').trim();
            return acc;
        }, {});
        return Object.keys(obj).length > 0 && obj[headers[0]] ? obj : null;
    }).filter(Boolean);
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
                    className={`cursor-pointer px-4 py-2 text-gray-800 dark:text-gray-200 hover:bg-blue-500 hover:text-white ${
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
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({ query: '' });
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedTrainings, setSelectedTrainings] = useState(new Set());
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [formData, setFormData] = useState(INITIAL_FORM_STATE);
    const [editingTraining, setEditingTraining] = useState(null);
    const [viewingTraining, setViewingTraining] = useState(null);
    const [trainingToDelete, setTrainingToDelete] = useState(null);
    const [csvData, setCsvData] = useState([]);
    const [importResults, setImportResults] = useState(null);
    const fileInputRef = useRef(null);

    const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
    const [progressMessage, setProgressMessage] = useState('');
    const [isProgressComplete, setIsProgressComplete] = useState(false);
    const [savedFilePath, setSavedFilePath] = useState(null);

    const [sessionState, setSessionState] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'id', direction: 'ascending' });
    const canManage = useMemo(() => sessionState && MANAGABLE_ROLES.includes(sessionState.user.role), [sessionState]);
    const rowsPerPage = 9;
    const viewModalRef = useRef(null);

    useClickOutside(viewModalRef, () => {
        if (viewingTraining) handleCloseViewModal();
    });

    const handleCloseAddEditModal = useCallback(() => {
        setIsModalOpen(false);
        setError(null);
        setFormData(INITIAL_FORM_STATE);
    }, []);

    const handleCloseViewModal = useCallback(() => {
        setViewingTraining(null);
    }, []);

    const handleCloseImportModal = useCallback(() => {
        setIsImportModalOpen(false);
        setImportResults(null);
        setCsvData([]);
    }, []);

    const fetchData = useCallback(async () => {
        if (!serverIp || !sessionState) return;
        setIsLoading(true);
        setError(null);
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
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [sessionState, serverIp]);

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
                setError(err.message);
                setIsLoading(false);
            }
        };
        getSession();
    }, []);

    useEffect(() => {
        if (sessionState && !isSettingsLoading) {
            fetchData();
        }
    }, [sessionState, isSettingsLoading, fetchData]);

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
    const handleInputChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleAddClick = () => { setEditingTraining(null); setFormData(INITIAL_FORM_STATE); setError(null); setIsModalOpen(true); };
    const handleViewClick = (training) => setViewingTraining(training);
    
    const handleEditClick = (training) => {
        setEditingTraining(training);
        setFormData({
            employee_id: training.employee_id,
            training_title_id: training.training_title_id,
            start_date: formatDateForInput(training.start_date),
            end_date: formatDateForInput(training.end_date),
            hours: training.hours,
            venue: training.venue
        });
        setError(null);
        setIsModalOpen(true);
    };

    const handleDeleteClick = (training) => setTrainingToDelete(training);
    
    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        if (new Date(formData.end_date) < new Date(formData.start_date)) {
            setError('End date cannot be earlier than the start date.');
            return;
        }

        const endpoint = editingTraining ? `trainings/${editingTraining.id}` : 'trainings';
        const method = editingTraining ? 'PUT' : 'POST';
        const body = { ...formData, actingUserId: sessionState?.user?.id };

        try {
            await apiFetch(endpoint, serverIp, { method, body: JSON.stringify(body) }); // 3. PASS serverIp
            setIsModalOpen(false);
            fetchData();
        } catch (err) {
            try {
                const parsedError = JSON.parse(err.message);
                setError(parsedError.error || parsedError.message || "An unknown error occurred.");
            } catch (e) {
                setError(err.message);
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
        } catch (err) {
            setError(err.message);
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

    const handleConfirmImport = async () => {
        if (csvData.length === 0) return;
        setImportResults({ status: 'importing', message: 'Importing, please wait...' });
        try {
            const result = await apiFetch('trainings/import', serverIp, {
                method: 'POST',
                body: JSON.stringify({ actingUserId: sessionState?.user?.id, trainings: csvData })
            });
            setImportResults({ status: 'success', ...result });
            fetchData();
        } catch (err) {
            let finalMessage = 'Import failed due to an unknown error.';
            let finalErrors = [];

            try {
                const parsedError = JSON.parse(err.message);
                finalErrors = parsedError.errors || [];

                if (finalErrors.length > 0) {
                    finalMessage = "Please fix the following errors found in your file:";
                } else {
                    finalMessage = parsedError.message || finalMessage;
                }
            } catch (e) {
                finalMessage = err.message || finalMessage;
            }

            setImportResults({
                status: 'error',
                message: finalMessage,
                errors: finalErrors
            });
        }
    };

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const parsedData = parseCSV(e.target.result);
            if (parsedData.length === 0) {
                setError('The selected CSV file is empty or could not be read.');
                return;
            }
            setError(null);
            setCsvData(parsedData);
            setImportResults(null);
            setIsImportModalOpen(true);
        };
        reader.readAsText(file);
        event.target.value = null;
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

    const handleClearSelection = () => setSelectedTrainings(new Set());
    const handleClearSearch = () => setFilters({ query: '' });

    const handleExportSelected = () => {
        if (selectedTrainings.size === 0) return;
        const dataToExport = trainings.filter(t => selectedTrainings.has(t.id));

        const headers = ["employee_id", "fullname", "training_title"];
        const csvContent = [headers.join(','), ...dataToExport.map(item => {
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

    const handleDownloadTemplate = () => {
        const headers = ["employee_id", "training_title"];
        const exampleData = `"PSAKLG-25-0001","Data Processing Using CSPro"`;
        const content = headers.join(',') + "\n" + exampleData;
        handleCsvDownload(content, 'template_training_records.csv');
    };

    return (
        <div>
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
                    <button onClick={handleAddClick} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700"><FiPlus />Add New Training Record</button>
                    <div className="flex-grow" />
                    <button onClick={handleDownloadTemplate} className="px-4 py-2 font-semibold text-white bg-gray-500 rounded-lg shadow-md hover:bg-gray-600">Download Template</button>
                    <button onClick={() => fileInputRef.current.click()} className="px-4 py-2 font-semibold text-white bg-green-600 rounded-lg shadow-md hover:bg-green-700">Import CSV</button>
                    <button onClick={handleExportSelected} disabled={selectedTrainings.size === 0} className="px-4 py-2 font-semibold text-gray-800 bg-yellow-400 rounded-lg shadow-md hover:bg-yellow-500 disabled:opacity-50">
                        Export Selected ({selectedTrainings.size})
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".csv" />
                    {selectedTrainings.size > 0 && (
                        <button onClick={handleClearSelection} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-lg shadow-md hover:bg-red-700">Clear Selection</button>
                    )}
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
                                        <div className="flex items-center justify-center space-x-3">
                                            <button onClick={() => handleViewClick(rec)} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white">View</button>
                                            {canManage && <button onClick={() => handleEditClick(rec)} className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300">Edit</button>}
                                            {canManage && <button onClick={() => handleDeleteClick(rec)} className="text-red-600 hover:text-red-900 dark:text-red-500 dark:hover:text-red-300">Delete</button>}
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
                    <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Previous</button>
                    <span className="px-2">{currentPage}</span>
                    <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Next</button>
                </div>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                    <div className="flex flex-col w-full max-w-xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{editingTraining ? 'Edit Training Record' : 'Add New Training Record'}</h2>
                        </div>
                        <form onSubmit={handleFormSubmit} id="trainingForm" className="flex-auto p-6 overflow-y-auto space-y-4">
                            {error && <div className="p-3 text-red-800 bg-red-100 dark:bg-red-900/50 dark:text-red-300 rounded-lg">{typeof error === 'object' ? error.title : error}</div>}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Employee Name*</label>
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
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Training Title*</label>
                                <SearchableDropdown
                                    id="training_title_id"
                                    options={trainingTitleOptions}
                                    value={formData.training_title_id}
                                    onChange={handleTitleChange}
                                    placeholder="Search or Select a Training Title"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date*</label>
                                    <input type="date" name="start_date" value={formData.start_date} onChange={handleInputChange} required 
                                          disabled
                                          className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">End Date*</label>
                                    <input type="date" name="end_date" value={formData.end_date} onChange={handleInputChange} required 
                                          disabled
                                          className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Duration (hours)*</label>
                                <input type="number" name="hours" value={formData.hours} onChange={handleInputChange} required 
                                        disabled
                                        className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Venue*</label>
                                <input type="text" name="venue" value={formData.venue} onChange={handleInputChange} required 
                                        disabled
                                        className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" />
                            </div>
                        </form>
                        <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                            <button type="button" onClick={handleCloseAddEditModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm">Cancel</button>
                            <button type="submit" form="trainingForm" className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm">Save Record</button>
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
                            <button onClick={() => setTrainingToDelete(null)} className="px-4 py-2 font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 rounded-lg">Cancel</button>
                            <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700">Delete</button>
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
                            <button type="button" onClick={handleCloseViewModal} className="px-4 py-2 font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 rounded-lg">Close</button>
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
                <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black bg-opacity-50">
                    <div className="z-50 w-full max-w-4xl p-6 bg-white rounded-lg shadow-2xl dark:bg-gray-800">
                        <h2 className="mb-4 text-2xl font-bold text-gray-900 dark:text-white">{importResults ? 'Import Results' : 'Confirm Import'}</h2>
                        {importResults ? (
                            <div>
                                {importResults.status === 'success' && <div className="p-3 text-green-800 bg-green-100 dark:bg-green-900/50 dark:text-green-300 rounded-lg">{importResults.message}</div>}
                                {importResults.status === 'error' && (
                                    <div className="p-3 text-red-800 bg-red-100 dark:bg-red-900/50 dark:text-red-300 rounded-lg">
                                        <strong>{importResults.message}</strong>
                                        {importResults.errors && importResults.errors.length > 0 && <ul className="pl-5 mt-2 text-sm list-disc">{importResults.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                                    </div>
                                )}
                                <div className="flex justify-end mt-4"><button onClick={() => setIsImportModalOpen(false)} className="px-4 py-2 font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 rounded-lg">Close</button></div>
                            </div>
                        ) : (
                            <>
                                <p className="mb-4 text-gray-700 dark:text-gray-300">Found {csvData.length} valid records. Please review the first few rows.</p>
                                <div className="overflow-auto border rounded-lg max-h-64 border-gray-200 dark:border-gray-700">
                                    <table className="min-w-full text-sm">
                                        <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900">
                                            <tr>{csvData.length > 0 && Object.keys(csvData[0]).map(h => <th key={h} className="p-2 font-semibold text-left text-gray-600 dark:text-gray-300">{h}</th>)}</tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                            {csvData.slice(0, 5).map((row, i) => (<tr key={i}>{Object.values(row).map((val, j) => <td key={j} className="p-2 whitespace-nowrap">{val}</td>)}</tr>))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-end mt-6 space-x-4">
                                    <button onClick={handleCloseImportModal} className="px-4 py-2 font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500 rounded-lg">Cancel</button>
                                    <button onClick={handleConfirmImport} className="px-4 py-2 font-semibold text-white bg-green-600 rounded-lg">Confirm Import</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Trainings;