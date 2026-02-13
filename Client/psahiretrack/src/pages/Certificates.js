import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FaSort, FaSortUp, FaSortDown, FaExclamationTriangle } from 'react-icons/fa';
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
const Certificates = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const [employees, setEmployees] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [employments, setEmployments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
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

  const fetchData = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    setError(null);
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
      setError({ type: 'network', message: err.message || "An unexpected error occurred." });
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [serverIp]);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        setSessionState(state);
      } catch (err) {
        setError({ type: 'session', message: "Failed to retrieve session data. Please log in." });
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

  const handleOpenModal = (employee, mode) => {
    setSelectedEmployee(employee);
    setModalMode(mode);
    setIsModalOpen(true);
    setSelectedEmployments([]);
    setSelectedTrainings([]);
    setModalSearchTerm("");
    setError(null);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedEmployee(null);
    setModalMode(null);
    setSelectedEmployments([]);
    setSelectedTrainings([]);
    setModalSearchTerm("");
    setError(null);
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

  const fetchFile = async (endpointPath, payload, fileName, fileType = 'pdf') => {
    if (!serverIp) {
      setError({ type: 'download', message: 'Server IP is not available.' });
      return false;
    }
    setError(null);
    setIsProgressComplete(false);
    setProgress(0);
    setProgressMessage('Preparing your file, please wait...');
    setIsProgressModalOpen(true);

    try {
      const API_PORT = 3001;
      const fullUrl = `http://${serverIp}:${API_PORT}/api/${endpointPath}`;

      const finalFileName = `${fileName}.${fileType}`;
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
      
      setProgressMessage('Ready to save. Please choose a location.');

      const saveResult = await window.electronAPI.saveFile({
        downloadId: prepareResponse.downloadId,
        fileName: finalFileName,
        fileType: fileType
      });

      if (saveResult.status === 'completed') {
        setSavedFilePath(saveResult.path);
        return saveResult.message;
      } else if (saveResult.status === 'cancelled') {
        setIsProgressModalOpen(false);
        return false;
      } else {
        throw new Error(saveResult.message);
      }
    } catch (err) {
      console.error(`Error downloading file:`, err.message);
      setError({ type: 'download', message: err.message });
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

  const handleDownloadTraining = (record) => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { type: "Training", name: fullName, id: selectedEmployee.id, trainingTitle: record.trainingTitle, thours: record.hours, startDate: record.startDate, endDate: record.endDate, venue: record.venue };
    return fetchFile(apiEndpoints.Training.download, certificateData, `Certificate-Training-${selectedEmployee.lastName}`);
  };

  const handleDownloadSingleEmployment = (record) => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { type: "SingleEmployment", name: fullName, id: selectedEmployee.id, sex: selectedEmployee.sex, last_name: selectedEmployee.lastName, barangay: selectedEmployee.barangay, municipality: selectedEmployee.municipality, employee_id_str: selectedEmployee.id, position: record.position, project_name: record.project_name, contract_start_date: record.contract_start_date, contract_end_date: record.contract_end_date, performance_rating: record.performance_rating, remarks: record.remarks };
    return fetchFile(apiEndpoints.SingleEmployment.download, certificateData, `Certificate-Employment-${selectedEmployee.lastName}`);
  };

  const handleDownloadMultiEmployment = () => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { type: "MultiEmployment", name: fullName, id: selectedEmployee.id, lastName: selectedEmployee.lastName, sex: selectedEmployee.sex, barangay: selectedEmployee.barangay, municipality: selectedEmployee.municipality, employments: [...selectedEmployments].sort((a, b) => new Date(a.contract_start_date) - new Date(b.contract_start_date)) };
    return fetchFile(apiEndpoints.MultiEmployment.download, certificateData, `Certificate-Multi-Employment-${selectedEmployee.lastName}`);
  };

  const handleDownloadBatchTraining = () => {
    const fullName = `${selectedEmployee.firstName} ${selectedEmployee.middleInitial || ''} ${selectedEmployee.lastName}`.replace(/\s+/g, ' ').trim();
    const certificateData = { type: "BatchTraining", name: fullName, id: selectedEmployee.id, trainings: selectedTrainings.sort((a, b) => new Date(a.startDate) - new Date(b.startDate)) };
    return fetchFile(apiEndpoints.BatchTraining.download, certificateData, `Certificate-Batch-Training-${selectedEmployee.lastName}`);
  };


  const handleEmploymentDownloadAction = async () => {
    closeModal();
    let result = false;
    if (selectedEmployments.length === 1) {
      result = await handleDownloadSingleEmployment(selectedEmployments[0]);
    } else if (selectedEmployments.length > 1) {
      result = await handleDownloadMultiEmployment();
    }
    if (typeof result === 'string') {
      showCompletionModal(result);
    }
  };

  const handleTrainingDownloadAction = async () => {
    closeModal();
    let result = false;
    if (selectedTrainings.length === 1) {
      result = await handleDownloadTraining(selectedTrainings[0]);
    } else if (selectedTrainings.length > 1) {
      result = await handleDownloadBatchTraining();
    }
    if (typeof result === 'string') {
      showCompletionModal(result);
    }
  };

  const handleGenerateBatchByTitle = async (trainingTitle) => {
    const payload = { trainingTitle };
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
        'pdf'
      );
      
      if (typeof result === 'string') {
          setProgress(100);
          setIsProgressComplete(true);
          setProgressMessage(result);
      }
    } catch (error) {
        console.error('Download error:', error);
        setIsProgressModalOpen(false); 
    } finally {
        if (interval) {
          clearInterval(interval);
        }
    }
  };

  const handleClearGlobalSearch = () => {
    setGlobalSearchTerm('');
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

  if (error && error.type !== 'download') return <div className="p-8 text-center text-red-500">{error.message}</div>;

  return (
    <div>
      <div className="flex flex-col items-start justify-between gap-4 mb-6 md:flex-row md:items-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Generate Certificates</h1>
        <div className="flex items-center gap-4 w-full md:w-auto">
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
                        <button onClick={() => handleOpenModal(employee, 'Training')} className="px-4 py-2 font-semibold text-gray-800 bg-green-400 rounded-lg shadow-md hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed" disabled={employee.trainings.length === 0}>Training</button>
                        <button onClick={() => handleOpenModal(employee, 'Employment')} className="px-4 py-2 font-semibold text-gray-800 bg-red-400 rounded-lg shadow-md hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed" disabled={employee.employments.length === 0}>Employment</button>
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
                      <button onClick={() => handleGenerateBatchByTitle(training.title)} className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700">Download All</button>
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
          <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">
            Previous
          </button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">
            Next
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
                {modalMode === 'Training' && (filteredTrainings.length > 0 ? (filteredTrainings.map((record, index) => { const isSelected = selectedTrainings.some(item => item.trainingTitle === record.trainingTitle); return ( <li key={index} className={`rounded-lg shadow-sm transition-colors duration-200 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-900'}`}> <label className="flex items-center justify-between w-full p-4 cursor-pointer"> <span className="font-medium text-gray-900 dark:text-white">{record.trainingTitle}</span> <input type="checkbox" className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600" checked={isSelected} onChange={() => handleTrainingSelectionChange(record)} /> </label> </li> ); })) : <p className="py-8 text-center text-gray-500 dark:text-gray-400">No matching training records found.</p>)}
                {modalMode === 'Employment' && (filteredEmployments.length > 0 ? (filteredEmployments.map((record, index) => { const isSelected = selectedEmployments.some(item => item.project_name === record.project_name && item.position === record.position); return ( <li key={index} className={`rounded-lg shadow-sm transition-colors duration-200 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/50 ring-2 ring-blue-500' : 'bg-gray-50 dark:bg-gray-900'}`}> <label className="flex items-center justify-between w-full p-4 cursor-pointer"> <span className="font-medium text-gray-900 dark:text-white">{`${record.position} (${record.project_name})`}</span> <input type="checkbox" className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600" checked={isSelected} onChange={() => handleEmploymentSelectionChange(record)} /> </label> </li> ); })) : <p className="py-8 text-center text-gray-500 dark:text-gray-400">No matching employment records found.</p>)}
              </ul>
            </div>
            <div className="flex justify-end flex-shrink-0 p-4 space-x-4 bg-gray-50 border-t border-gray-200 dark:bg-gray-800/50 dark:border-gray-700">
              <button onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
              {modalMode === 'Training' && (
                <button onClick={handleTrainingDownloadAction} className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={selectedTrainings.length === 0}>Download Selected ({selectedTrainings.length})</button>
              )}
              {modalMode === 'Employment' && (
                <button onClick={handleEmploymentDownloadAction} className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed" disabled={selectedEmployments.length === 0}>Download Selected ({selectedEmployments.length})</button>
              )}
            </div>
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

      {error?.type === 'download' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-70">
          <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-gray-800 transform transition-all">
            <div className="text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full dark:bg-red-900/50"><FaExclamationTriangle className="w-6 h-6 text-red-600 dark:text-red-400" aria-hidden="true" /></div>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Generation Failed</h3>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300"><p>{error.message}</p></div>
            </div>
            <div className="mt-5 sm:mt-6">
              <button type="button" className="inline-flex justify-center w-full px-4 py-2 text-base font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500" onClick={() => setError(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Certificates;