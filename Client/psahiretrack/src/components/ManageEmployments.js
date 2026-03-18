import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FiPlus, FiX, FiSave } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaPencilAlt, FaTrash } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import ToastContainer from './ToastContainer';
import useToast from '../hooks/useToast';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];

const ManageSurveys = ({ session }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const { toasts, showToast, removeToast } = useToast();
    const [surveys, setSurveys] = useState([]);
    const [focalPersons, setFocalPersons] = useState([]);
    const [availablePositions, setAvailablePositions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSurvey, setCurrentSurvey] = useState({ id: null, name: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [originalSurveyData, setOriginalSurveyData] = useState(null);
    const [surveyToDelete, setSurveyToDelete] = useState(null);
    const [nonDeletableSurveys, setNonDeletableSurveys] = useState(new Set());
    const rowsPerPage = 10;
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'ascending' });
    
    // State for rating criteria fields
    const [hiringDate, setHiringDate] = useState('');
    const [positionsToBeHired, setPositionsToBeHired] = useState([]);
    const [ratingCriteriaPositionToAdd, setRatingCriteriaPositionToAdd] = useState('');
    const [applicantsToHire, setApplicantsToHire] = useState('');

    // Refs for field-level validation
    const surveyNameRef = useRef(null);
    const hiringDateRef = useRef(null);
    const positionsDropdownRef = useRef(null);

    const canManage = useMemo(() => {
        return session && MANAGABLE_ROLES.includes(session.user?.role);
    }, [session]);

    const handleCloseModal = useCallback(() => {
        setIsModalOpen(false);
        setHiringDate('');
        setPositionsToBeHired([]);
        setRatingCriteriaPositionToAdd('');
        setApplicantsToHire('');
        setCurrentSurvey({ id: null, name: '' });
        setOriginalSurveyData(null);
    }, []);

    const fetchData = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        try {
            const [surveysData, focalPersonsData, positionsData] = await Promise.all([
                apiFetch('employments/surveys', serverIp),        // 3. PASS serverIp
                apiFetch('users?role=Focal Person', serverIp), // 3. PASS serverIp
                apiFetch('employments/positions', serverIp)
            ]);
            setSurveys(surveysData);
            setFocalPersons(focalPersonsData);
            setAvailablePositions(positionsData);
            
            // Fetch usage info for each survey
            const nonDeletable = new Set();
            for (const survey of surveysData) {
                try {
                    const usage = await apiFetch(`employments/surveys/${survey.id}/usage`, serverIp);
                    if (usage.count > 0) {
                        nonDeletable.add(survey.id);
                    }
                } catch (err) {
                    console.warn(`Could not check usage for survey ${survey.id}:`, err);
                }
            }
            setNonDeletableSurveys(nonDeletable);
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp, showToast]); // 4. ADD serverIp dependency

    useEffect(() => {
        // 5. UPDATE data fetch trigger
        if (!isSettingsLoading) {
            fetchData();
        }
    }, [isSettingsLoading, fetchData]);

    const focalPersonMap = useMemo(() => {
        if (!focalPersons.length) return new Map();
        return new Map(focalPersons.map(fp => [
            fp.id, 
            `${fp.first_name} ${fp.middle_initial || ''} ${fp.last_name} ${fp.suffix || ''}`.replace(/\s+/g, ' ').trim()
        ]));
    }, [focalPersons]);

    const surveysWithNames = useMemo(() => {
        return surveys.map(survey => ({
            ...survey,
            focalPersonName: focalPersonMap.get(survey.focal_person_id) || null
        }));
    }, [surveys, focalPersonMap]);

    const filteredSurveys = useMemo(() => {
        if (!searchQuery) return surveysWithNames;
        return surveysWithNames.filter(survey => {
            const searchLower = searchQuery.toLowerCase();
            const nameMatch = survey.name.toLowerCase().includes(searchLower);
            const focalMatch = survey.focalPersonName && survey.focalPersonName.toLowerCase().includes(searchLower);
            return nameMatch || focalMatch;
        });
    }, [surveysWithNames, searchQuery]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, sortConfig]);

    const sortedSurveys = useMemo(() => {
        let sortableItems = [...filteredSurveys];
        if (sortConfig.key) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredSurveys, sortConfig]);

    const totalPages = Math.ceil(sortedSurveys.length / rowsPerPage);
    const paginatedSurveys = useMemo(() => {
        const startIndex = (currentPage - 1) * rowsPerPage;
        return sortedSurveys.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedSurveys, currentPage]);

    const requestSort = (key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
        return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
    };

    const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
    const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

    const handleOpenModal = (survey = { id: null, name: '', contract_start_date: null, contract_end_date: null, focal_person_id: '' }) => {
        const formatForInput = (dateString) => {
            if (!dateString) return '';
            try {
                return format(parseISO(dateString), 'yyyy-MM-dd');
            } catch (error) {
                console.error("Failed to parse date:", dateString, error);
                return '';
            }
        };

        const formattedSurvey = {
            ...survey,
            contract_start_date: formatForInput(survey.contract_start_date),
            contract_end_date: formatForInput(survey.contract_end_date),
        };
        setCurrentSurvey(formattedSurvey);
        
        // Pre-populate hiring_date and positions if survey is in future and editing existing record
        if (survey.id) {
            // Check if start date is in future
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const startDate = parseISO(survey.contract_start_date);
            
            if (startDate >= today) {
                // Survey is still in future - pre-populate hiring data from Turso
                if (survey.hiring_date) {
                    setHiringDate(formatForInput(survey.hiring_date));
                } else {
                    setHiringDate('');
                }
                
                // Parse positions from Turso (stored as JSON array or space-separated string)
                if (survey.positions) {
                    try {
                        let posArray = typeof survey.positions === 'string' 
                            ? JSON.parse(survey.positions) 
                            : Array.isArray(survey.positions) 
                            ? survey.positions 
                            : [];
                        
                        // Handle both old format (array of strings) and new format (array of objects)
                        if (Array.isArray(posArray)) {
                            posArray = posArray.map(item => {
                                if (typeof item === 'string') {
                                    // Old format: convert to new format
                                    const matchedPos = availablePositions.find(p => p.position_title === item);
                                    return { position: item, position_id: matchedPos ? matchedPos.id : null, applicants_count: 0 };
                                }
                                return item;
                            });
                        }
                        setPositionsToBeHired(Array.isArray(posArray) ? posArray : []);
                    } catch (e) {
                        setPositionsToBeHired([]);
                    }
                } else {
                    setPositionsToBeHired([]);
                }
            } else {
                // Survey is now past - reset hiring fields (no editing needed for past surveys)
                setHiringDate('');
                setPositionsToBeHired(survey.positions ? (typeof survey.positions === 'string' ? JSON.parse(survey.positions) : survey.positions) : []);
            }
        } else {
            // New survey - reset hiring fields
            setHiringDate('');
            setPositionsToBeHired([]);
        }
        
        if (survey.id) {
            setOriginalSurveyData(formattedSurvey);
        } else {
            setOriginalSurveyData(null);
        }
        
        setRatingCriteriaPositionToAdd('');
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const { id, name, contract_start_date, contract_end_date } = currentSurvey;
        if (!name.trim()) {
            surveyNameRef.current?.focus();
            surveyNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Validate contract dates
        if (contract_start_date && contract_end_date) {
            try {
                const startDate = parseISO(contract_start_date);
                const endDate = parseISO(contract_end_date);
                
                if (endDate <= startDate) {
                    showToast('Contract End Date must be later than Contract Start Date.', 'error');
                    return;
                }
            } catch (e) {
                showToast('Invalid contract date format.', 'error');
                return;
            }
        }

        // Validate rating_criteria fields when start date is in future
        if (isStartDateInPast === false && !hiringDate) {
            showToast('Hiring End Date is required for future surveys.', 'error');
            hiringDateRef.current?.focus();
            hiringDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        if (isStartDateInPast === false && positionsToBeHired.length === 0) {
            showToast('At least one position with applicant count must be selected.', 'error');
            positionsDropdownRef.current?.focus();
            positionsDropdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Validate hiring date is not earlier than today and not later than contract start date
        if (isStartDateInPast === false && hiringDate) {
            try {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const hireDate = parseISO(hiringDate);
                const contractStartDate = parseISO(currentSurvey.contract_start_date);
                
                if (hireDate < today) {
                    showToast('Hiring date cannot be earlier than today.', 'error');
                    hiringDateRef.current?.focus();
                    hiringDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
                
                if (hireDate > contractStartDate) {
                    showToast('Hiring date cannot be later than the contract start date.', 'error');
                    hiringDateRef.current?.focus();
                    hiringDateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            } catch (e) {
                showToast('Invalid hiring date format.', 'error');
                return;
            }
        }

        const endpoint = id ? `employments/surveys/${id}` : 'employments/surveys';
        const method = id ? 'PUT' : 'POST';

        try {
            // Find the original survey data from the surveys array to preserve all fields
            const originalSurvey = id ? surveys.find(s => s.id === id) : null;

            // Prepare payload: merge original survey data with updated fields
            // Normally we remove rating_criteria - it's managed separately in the Applicants page
            const payload = {
                ...(originalSurvey || {}), // Preserve all original fields
                ...currentSurvey,          // Apply user edits
                actingUserId: session.user.id
            };
            
            // Check if end date is earlier than today and set rating_criteria to "Done"
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let isEndDateInPast = false;
            if (currentSurvey.contract_end_date) {
                try {
                    const endDate = parseISO(currentSurvey.contract_end_date);
                    isEndDateInPast = endDate < today;
                } catch (e) {
                    isEndDateInPast = false;
                }
            }

            if (isEndDateInPast) {
                payload.rating_criteria = "Done";
            } else {
                delete payload.rating_criteria;
            }

            // If start date is in future, send hiring date and positions separately (Turso only)
            if (isStartDateInPast === false && hiringDate && positionsToBeHired.length > 0) {
                payload.hiring_date = hiringDate;
                payload.positions = positionsToBeHired;
            }

            await apiFetch(endpoint, serverIp, {
                method,
                body: JSON.stringify(payload),
            });
            fetchData(); // Re-fetch all data
            handleCloseModal();
            showToast(currentSurvey.id ? 'Survey updated successfully.' : 'Survey added successfully.', 'success');
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
        if (!surveyToDelete || !session) return;
        try {
            await apiFetch(`employments/surveys/${surveyToDelete.id}`, serverIp, { // 3. PASS serverIp
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: session.user.id })
            });
            setSurveyToDelete(null);
            showToast('Survey deleted successfully.', 'success');
            fetchData(); // Re-fetch all data
        } catch (err) {
            showToast(err.message, 'error');
            setSurveyToDelete(null);
        }
    };

    const handleDeleteClick = (survey) => {
        setSurveyToDelete(survey);
    };

    // Determine if the contract start date is in the past, today, or future
    const isStartDateInPast = useMemo(() => {
        if (!currentSurvey.contract_start_date) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        try {
            const startDate = parseISO(currentSurvey.contract_start_date);
            return startDate < today;
        } catch (e) {
            return null;
        }
    }, [currentSurvey.contract_start_date]);

    const hasChanges = useMemo(() => {
        if (!currentSurvey.id || !originalSurveyData) {
            return false;
        }
    
        if (
            currentSurvey.name !== originalSurveyData.name ||
            currentSurvey.contract_start_date !== originalSurveyData.contract_start_date ||
            currentSurvey.contract_end_date !== originalSurveyData.contract_end_date ||
            String(currentSurvey.focal_person_id) !== String(originalSurveyData.focal_person_id)
        ) {
            return true;
        }
    
        if (isStartDateInPast === false) {
            if (hiringDate !== (originalSurveyData.hiring_date ? format(parseISO(originalSurveyData.hiring_date), 'yyyy-MM-dd') : '')) {
                return true;
            }
            
            const originalPositions = originalSurveyData.positions ? (typeof originalSurveyData.positions === 'string' ? JSON.parse(originalSurveyData.positions) : originalSurveyData.positions) : [];
            if (positionsToBeHired.length !== originalPositions.length) {
                return true;
            }
            
            const originalPositionsString = JSON.stringify(originalPositions.slice().sort((a,b) => a.position.localeCompare(b.position)));
            const currentPositionsString = JSON.stringify(positionsToBeHired.slice().sort((a,b) => a.position.localeCompare(b.position)));
    
            if (originalPositionsString !== currentPositionsString) {
                return true;
            }
        }
    
        return false;
    }, [currentSurvey, originalSurveyData, hiringDate, positionsToBeHired, isStartDateInPast]);

    const isSaveDisabled = useMemo(() => {
        if (currentSurvey.id) {
            return !hasChanges;
        }
    
        const { name, contract_start_date, contract_end_date, focal_person_id } = currentSurvey;
        if (!name?.trim() || !contract_start_date || !contract_end_date || !focal_person_id) {
            return true;
        }
    
        if (isStartDateInPast === false && (!hiringDate || positionsToBeHired.length === 0)) {
            return true;
        }
    
        return false;
    }, [currentSurvey, hasChanges, hiringDate, positionsToBeHired, isStartDateInPast]);

    const handleAddRatingCriteriaPosition = () => {
        if (ratingCriteriaPositionToAdd && !positionsToBeHired.some(pos => pos.position === ratingCriteriaPositionToAdd)) {
            const count = parseInt(applicantsToHire, 10) || 0;
            if (count <= 0) {
                showToast('Please enter a valid number of applicants to hire (greater than 0).', 'error');
                return;
            }
            const selectedPos = availablePositions.find(p => p.position_title === ratingCriteriaPositionToAdd);
            const position_id = selectedPos ? selectedPos.id : null;
            
            setPositionsToBeHired([...positionsToBeHired, { position: ratingCriteriaPositionToAdd, position_id, applicants_count: count }]);
            setRatingCriteriaPositionToAdd('');
            setApplicantsToHire('');
        }
    };

    const handleRemoveRatingCriteriaPosition = (positionToRemove) => {
        setPositionsToBeHired(positionsToBeHired.filter(pos => pos.position !== positionToRemove));
    };

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="mb-4 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Surveys</h1>
                <div className="w-full p-4 space-y-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow animate-pulse">
                    {[...Array(10)].map((_, i) => (
                        <div key={i} className="flex items-center justify-between pt-2">
                            <div className="h-3 bg-gray-300 rounded-full dark:bg-gray-600 w-1/2"></div>
                            <div className="h-4 bg-gray-300 rounded-full dark:bg-gray-700 w-20"></div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div>
            <ToastContainer toasts={toasts} onClose={removeToast} />
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Surveys</h1>
              <div className="flex items-center gap-4">
                  <div className="relative">
                      <input
                          type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..."
                          className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
                      />
                      {searchQuery && (
                          <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 transition-colors hover:text-gray-800 dark:hover:text-gray-200">
                              <FiX className="h-5 w-5" />
                          </button>
                      )}
                  </div>
                  {canManage && (
                      <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600">
                          <FiPlus className="w-4 h-4" />
                          Add Survey/Census
                      </button>
                  )}
              </div>
          </div>

          <div className="overflow-x-auto bg-white h-[680px] rounded-lg shadow dark:bg-gray-800">
              <table className="min-w-full text-sm leading-normal">
                  <thead>
                      <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                          <th className="px-5 py-3.5 text-left w-[300px]"><button onClick={() => requestSort('name')} className="font-semibold flex items-center uppercase">Survey/Census Name {getSortIcon('name')}</button></th>
                          <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('contract_start_date')} className="font-semibold flex items-center uppercase">Contract Start Date {getSortIcon('contract_start_date')}</button></th>
                          <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('contract_end_date')} className="font-semibold flex items-center uppercase">Contract End Date {getSortIcon('contract_end_date')}</button></th>
                          <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('focalPersonName')} className="font-semibold flex items-center uppercase">Focal Person {getSortIcon('focalPersonName')}</button></th>
                          {canManage && (
                              <th className="px-6 py-3.5 text-center text-sm font-semibold tracking-wider  uppercase">Actions</th>
                          )}
                      </tr>
                  </thead>
                  <tbody>
                      {paginatedSurveys.length > 0 ? paginatedSurveys.map(survey => (
                          <tr key={survey.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-200">
                              <td className="px-6 py-4 font-medium text-gray-800 dark:text-gray-200">{survey.name}</td>
                              <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{survey.contract_start_date ? format(parseISO(survey.contract_start_date), 'MM/dd/yyyy') : 'N/A'}</td>
                              <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{survey.contract_end_date ? format(parseISO(survey.contract_end_date), 'MM/dd/yyyy') : 'N/A'}</td>
                              <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{survey.focalPersonName || '(None)'}</td>
                              {canManage && (
                                  <td className="px-6 py-4 align-middle">
                                      <div className="flex items-center justify-center space-x-1">
                                          <button onClick={() => handleOpenModal(survey)} title="Edit Survey" className="p-1 rounded-lg transition-colors text-blue-600 hover:text-blue-900 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20"><FaPencilAlt className="w-4 h-4" /></button>
                                          {nonDeletableSurveys.has(survey.id) ? (
                                              <button disabled title="This survey is assigned to employees" className="p-1 rounded-lg transition-colors text-gray-400 cursor-not-allowed opacity-50"><FaTrash className="w-4 h-4" /></button>
                                          ) : (
                                              <button onClick={() => handleDeleteClick(survey)} title="Delete Survey" className="p-1 rounded-lg transition-colors text-red-600 hover:text-red-900 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/20"><FaTrash className="w-4 h-4" /></button>
                                          )}
                                      </div>
                                  </td>
                              )}
                          </tr>
                      )) : (
                          <tr>
                              <td colSpan={canManage ? 6 : 1} className="py-16 text-center text-gray-500 dark:text-gray-400">
                                  <h3 className="text-lg font-medium">No Records Found</h3>
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>

          {totalPages > 1 && (
              <div className="flex justify-between items-center mt-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">Showing {Math.min((currentPage - 1) * rowsPerPage + 1, sortedSurveys.length)} to {Math.min(currentPage * rowsPerPage, sortedSurveys.length)} of {sortedSurveys.length} records</span>
                  <div className="flex items-center space-x-2">
                      <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">Previous</button>
                      <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
                      <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
                  </div>
              </div>
          )}

          {isModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                  <div className="flex flex-col w-full max-w-md max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700"><h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentSurvey.id ? 'Edit' : 'Add'} Survey</h2></div>
                      <form id="surveyForm" onSubmit={handleSave} className="flex-auto p-6 overflow-y-auto space-y-4">
                          
                          <div>
                              <label htmlFor="survey-name-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Survey Name*</label>
                              <textarea
                                  ref={surveyNameRef}
                                  id="survey-name-input" value={currentSurvey.name}
                                  onChange={(e) => setCurrentSurvey({ ...currentSurvey, name: e.target.value })}
                                  className="block w-full p-2 mt-1 bg-white border-2 border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 resize-y"
                                  required rows="3"
                              />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label htmlFor="contract_start_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Contract Start Date*</label>
                              <input id="contract_start_date" type="date"
                                  value={currentSurvey.contract_start_date}
                                  onChange={(e) => setCurrentSurvey({ ...currentSurvey, contract_start_date: e.target.value })}
                                  required className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500" />
                          </div>

                          <div>
                              <label htmlFor="contract_end_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Contract End Date*</label>
                              <input id="contract_end_date" type="date"
                                  value={currentSurvey.contract_end_date}
                                  onChange={(e) => setCurrentSurvey({ ...currentSurvey, contract_end_date: e.target.value })}
                                  required className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500" />
                          </div>
                          </div>
                          <div>
                              <label htmlFor="focal_person_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Name of Focal Person*</label>
                              <select id="focal_person_id"
                                  value={currentSurvey.focal_person_id || ''}
                                  onChange={(e) => setCurrentSurvey({ ...currentSurvey, focal_person_id: e.target.value })}
                                  required className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500">
                                  <option value="" disabled>(None)</option>
                                  {focalPersons.filter(fp => fp.role === 'Focal Person').map(fp => (
                                      <option key={fp.id} value={fp.id}>{`${fp.first_name} ${fp.middle_initial} ${fp.last_name} ${fp.suffix || ''}`}</option>
                                  ))}
                              </select>
                          </div>

                          {/* Rating Criteria Section - Conditional based on start date */}
                          {isStartDateInPast === false && (
                              <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                                  {currentSurvey.id && hiringDate && (
                                      <div className="text-sm text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 p-2 rounded border-l-4 border-blue-500">
                                          📅 <strong>Current Hiring End Date:</strong> {format(parseISO(hiringDate), 'MMMM d, yyyy')}
                                          {positionsToBeHired.length > 0 && (
                                              <>
                                                  <br />
                                                  <strong>Positions:</strong> {positionsToBeHired.map(p => `${p.position} (${p.applicants_count})`).join(', ')}
                                              </>
                                          )}
                                          <br />
                                          <span className="text-xs text-blue-600 dark:text-blue-400">You can extend this date or update positions if needed</span>
                                      </div>
                                  )}
                                  <div>
                                      <label htmlFor="hiring_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                          {currentSurvey.id && hiringDate ? 'New Hiring End Date*' : 'Hiring End Date*'}
                                      </label>
                                      <input ref={hiringDateRef} id="hiring_date" type="date"
                                          value={hiringDate}
                                          onChange={(e) => setHiringDate(e.target.value)}
                                          className="block w-full p-2 mt-1 bg-white border-2 border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500" />
                                  </div>
                                  <div>
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          {currentSurvey.id && positionsToBeHired.length > 0 ? 'Update Positions to be Hired*' : 'Positions to be Hired*'}
                                      </label>
                                      {currentSurvey.id && positionsToBeHired.length > 0 && (
                                          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-2 rounded mb-2 border border-amber-200 dark:border-amber-800">
                                              ✓ Currently assigned: {positionsToBeHired.map(p => `${p.position} (${p.applicants_count})`).join(', ')}
                                          </div>
                                      )}
                                      <div className="space-y-2 mb-2">
                                          <select 
                                              ref={positionsDropdownRef}
                                              value={ratingCriteriaPositionToAdd} 
                                              onChange={(e) => setRatingCriteriaPositionToAdd(e.target.value)}
                                              className="w-full p-2 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                          >
                                              <option value="" disabled>Select a position...</option>
                                              {availablePositions.map(pos => (
                                                  <option key={pos.id} value={pos.position_title} disabled={positionsToBeHired.some(p => p.position === pos.position_title)}>
                                                      {pos.position_title}
                                                  </option>
                                              ))}
                                          </select>
                                          {ratingCriteriaPositionToAdd && (
                                              <div className="flex gap-2">
                                                  <input
                                                      type="number"
                                                      min="1"
                                                      value={applicantsToHire}
                                                      onChange={(e) => setApplicantsToHire(e.target.value)}
                                                      placeholder="No. of applicants"
                                                      className="flex-1 p-2 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                                      autoFocus
                                                  />
                                                  <button type="button" onClick={handleAddRatingCriteriaPosition} disabled={!applicantsToHire} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">Add</button>
                                              </div>
                                          )}
                                      </div>
                                      
                                      {positionsToBeHired.length > 0 && (
                                          <ul className="space-y-1 max-h-32 overflow-y-auto">
                                              {positionsToBeHired.map(pos => (
                                                  <li key={pos.position} className="flex justify-between items-center bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 text-sm">
                                                      <span className="text-gray-800 dark:text-gray-200"><strong>{pos.position}</strong> - {pos.applicants_count} applicant{pos.applicants_count !== 1 ? 's' : ''}</span>
                                                      <button type="button" onClick={() => handleRemoveRatingCriteriaPosition(pos.position)} className="text-red-500 hover:text-red-700"><FiX /></button>
                                                  </li>
                                              ))}
                                          </ul>
                                      )}
                                  </div>
                              </div>
                          )}

                          {/* Hiring Positions Section removed - positions are now captured in rating criteria */}
                      </form>
                      
                      <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                          <button type="button" onClick={handleCloseModal} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                              <FiX className="w-4 h-4" />Cancel
                          </button>
                          <button 
                            type="submit" 
                            form="surveyForm" 
                            disabled={isSaveDisabled}
                            title={isSaveDisabled ? (currentSurvey.id ? 'No changes have been made' : 'Please fill all required fields') : 'Save survey'}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                              <FiSave className="w-4 h-4" />Save
                          </button>
                      </div>
                  </div>
              </div>
          )}

          {surveyToDelete && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                  <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Confirm Deletion</h2>
                      <p className="mt-2 text-gray-600 dark:text-gray-300">Are you sure you want to delete this survey/census name? This action cannot be undone.</p>
                      <div className="flex justify-end mt-6 space-x-2">
                          <button onClick={() => setSurveyToDelete(null)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                          <button onClick={confirmDelete} className="px-4 py-2 font-semibold text-white bg-red-600 rounded-md shadow-sm hover:bg-red-700">Delete</button>
                      </div>
                  </div>
              </div>
          )}
          <ToastContainer toasts={toasts} onClose={removeToast} />
      </div>
  );
};

export default ManageSurveys;