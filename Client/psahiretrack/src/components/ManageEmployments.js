import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { parseISO, format } from 'date-fns';
import { FaSort, FaSortUp, FaSortDown, FaExclamationTriangle } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext'; // 1. IMPORT THE HOOK

const MANAGABLE_ROLES = ['Super_Admin', 'Admin', 'PACD'];

const ManageSurveys = ({ session }) => {
    const { serverIp, isLoading: isSettingsLoading } = useSettings(); // 2. USE THE HOOK
    const [surveys, setSurveys] = useState([]);
    const [focalPersons, setFocalPersons] = useState([]);
    const [availablePositions, setAvailablePositions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSurvey, setCurrentSurvey] = useState({ id: null, name: '' });
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [surveyToDelete, setSurveyToDelete] = useState(null);
    const rowsPerPage = 10;
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'ascending' });
    
    // State for hiring positions
    const [selectedHiringPositions, setSelectedHiringPositions] = useState([]);
    const [positionToAdd, setPositionToAdd] = useState('');

    const canManage = useMemo(() => {
        return session && MANAGABLE_ROLES.includes(session.user?.role);
    }, [session]);

    const fetchData = useCallback(async () => {
        if (!session?.token || !serverIp) return; // Wait for session and serverIp
        setIsLoading(true);
        setError(null);
        try {
            const [surveysData, focalPersonsData, positionsData] = await Promise.all([
                apiFetch('employments/surveys', serverIp),        // 3. PASS serverIp
                apiFetch('employments/focal-persons', serverIp), // 3. PASS serverIp
                apiFetch('employments/positions', serverIp)
            ]);
            setSurveys(surveysData);
            setFocalPersons(focalPersonsData);
            setAvailablePositions(positionsData);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [session, serverIp]); // 4. ADD serverIp dependency

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

    const handleOpenModal = (survey = { id: null, name: '', contract_start_date: null, contract_end_date: null, focal_person_id: '', hiring_end_date: '' }) => {
        const formatForInput = (dateString) => {
            if (!dateString) return '';
            try {
                return format(parseISO(dateString), 'yyyy-MM-dd');
            } catch (error) {
                console.error("Failed to parse date:", dateString, error);
                return '';
            }
        };

        setCurrentSurvey({
            ...survey,
            contract_start_date: formatForInput(survey.contract_start_date),
            contract_end_date: formatForInput(survey.contract_end_date),
            hiring_end_date: '', // Always empty initially as it's not stored locally
        });

        setIsModalOpen(true);
        setSelectedHiringPositions([]); // Reset hiring positions on open
        setPositionToAdd('');
        setError(null);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedHiringPositions([]);
        setCurrentSurvey({ id: null, name: '' });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const { id, name } = currentSurvey;
        if (!name.trim()) {
            setError("Survey name cannot be empty.");
            return;
        }

        if (isOngoingOrUpcoming && !currentSurvey.hiring_end_date) {
            setError("Hiring End Date is required for ongoing or upcoming surveys.");
            return;
        }

        const endpoint = id ? `employments/surveys/${id}` : 'employments/surveys';
        const method = id ? 'PUT' : 'POST';

        try {
            await apiFetch(endpoint, serverIp, { // 3. PASS serverIp
                method,
                body: JSON.stringify({ 
                    ...currentSurvey, 
                    hiring_positions: selectedHiringPositions, // Send selected positions
                    actingUserId: session.user.id 
                }),
            });
            fetchData(); // Re-fetch all data
            handleCloseModal();
            setSuccessMessage(currentSurvey.id ? 'Survey updated successfully.' : 'Survey added successfully.');
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

    const confirmDelete = async () => {
        if (!surveyToDelete || !session) return;
        try {
            await apiFetch(`employments/surveys/${surveyToDelete.id}`, serverIp, { // 3. PASS serverIp
                method: 'DELETE',
                body: JSON.stringify({ actingUserId: session.user.id })
            });
            setSurveyToDelete(null);
            setSuccessMessage('Survey deleted successfully.');
            setTimeout(() => setSuccessMessage(null), 3000);
            fetchData(); // Re-fetch all data
        } catch (err) {
            setError(err.message);
            setSurveyToDelete(null);
        }
    };

    const handleDeleteClick = (survey) => {
        setError(null);
        setSurveyToDelete(survey);
    };

    const handleAddPosition = () => {
        if (positionToAdd && !selectedHiringPositions.includes(parseInt(positionToAdd))) {
            setSelectedHiringPositions([...selectedHiringPositions, parseInt(positionToAdd)]);
            setPositionToAdd('');
        }
    };

    const handleRemovePosition = (idToRemove) => {
        setSelectedHiringPositions(selectedHiringPositions.filter(id => id !== idToRemove));
    };

    const isOngoingOrUpcoming = useMemo(() => {
        if (!currentSurvey.contract_end_date) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = parseISO(currentSurvey.contract_end_date);
        // If end date is today or in the future, it's ongoing or upcoming
        return endDate >= today;
    }, [currentSurvey.contract_end_date]);

    // 6. UPDATE initial loading condition
    if (isLoading || isSettingsLoading) {
        return (
            <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Surveys</h1>
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
            {successMessage && (
                <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
                    <span>✓</span> {successMessage}
                </div>
            )}
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Manage Surveys</h1>
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
                      <button onClick={() => handleOpenModal()} className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
                          <FiPlus />
                          Add New Survey/Census
                      </button>
                  )}
              </div>
          </div>

          {error && !isModalOpen && !surveyToDelete && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-70">
                  <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-gray-800">
                      <div className="text-center">
                          <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full dark:bg-red-900/50">
                              <FaExclamationTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                          </div>
                          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Error</h3>
                          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">{error}</div>
                      </div>
                      <div className="mt-5">
                          <button type="button" onClick={() => setError(null)} className="inline-flex justify-center w-full px-4 py-2 text-base font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">OK</button>
                      </div>
                  </div>
              </div>
          )}

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
                                  <td className="px-6 py-4 flex items-center justify-center space-x-3">
                                      <button onClick={() => handleOpenModal(survey)} className="font-medium text-blue-600 transition-colors hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Edit</button>
                                      <button onClick={() => handleDeleteClick(survey)} className="font-medium text-red-600 transition-colors hover:text-red-900 dark:text-red-400 dark:hover:text-red-300">Delete</button>
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
                      <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Previous</button>
                      <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
                      <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md disabled:opacity-50 transition-colors hover:bg-gray-50 dark:hover:bg-gray-600">Next</button>
                  </div>
              </div>
          )}

          {isModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
                  <div className="flex flex-col w-full max-w-md max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700"><h2 className="text-xl font-semibold text-gray-900 dark:text-white">{currentSurvey.id ? 'Edit' : 'Add'} Survey</h2></div>
                      <form id="surveyForm" onSubmit={handleSave} className="flex-auto p-6 overflow-y-auto space-y-4">
                          {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
                          
                          <div>
                              <label htmlFor="survey-name-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Survey Name*</label>
                              <textarea
                                  id="survey-name-input" value={currentSurvey.name}
                                  onChange={(e) => setCurrentSurvey({ ...currentSurvey, name: e.target.value })}
                                  className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500 resize-y"
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
                                  {focalPersons.map(fp => (
                                      <option key={fp.id} value={fp.id}>{`${fp.first_name} ${fp.middle_initial} ${fp.last_name} ${fp.suffix || ''}`}</option>
                                  ))}
                              </select>
                          </div>

                          {/* Hiring Positions Section - Only if active/upcoming */}
                          {isOngoingOrUpcoming && (
                              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                                  <div className="mb-4">
                                      <label htmlFor="hiring_end_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Hiring End Date*</label>
                                      <input id="hiring_end_date" type="date"
                                          value={currentSurvey.hiring_end_date || ''}
                                          onChange={(e) => setCurrentSurvey({ ...currentSurvey, hiring_end_date: e.target.value })}
                                          required
                                          className="block w-full p-2 mt-1 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500" />
                                  </div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Positions to Hire</label>
                                  <div className="flex gap-2 mb-2">
                                      <select 
                                          value={positionToAdd} 
                                          onChange={(e) => setPositionToAdd(e.target.value)}
                                          className="flex-1 p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                      >
                                          <option value="" disabled>Select a position...</option>
                                          {availablePositions.map(pos => (
                                              <option key={pos.id} value={pos.id} disabled={selectedHiringPositions.includes(pos.id)}>
                                                  {pos.position_title}
                                              </option>
                                          ))}
                                      </select>
                                      <button type="button" onClick={handleAddPosition} disabled={!positionToAdd} className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Add</button>
                                  </div>
                                  
                                  {selectedHiringPositions.length > 0 && (
                                      <ul className="space-y-1 max-h-32 overflow-y-auto">
                                          {selectedHiringPositions.map(posId => {
                                              const pos = availablePositions.find(p => p.id === posId);
                                              return (
                                                  <li key={posId} className="flex justify-between items-center bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 text-sm">
                                                      <span className="text-gray-800 dark:text-gray-200">{pos?.position_title}</span>
                                                      <button type="button" onClick={() => handleRemovePosition(posId)} className="text-red-500 hover:text-red-700"><FiX /></button>
                                                  </li>
                                              );
                                          })}
                                      </ul>
                                  )}
                              </div>
                          )}
                      </form>
                      
                      <div className="flex-shrink-0 flex justify-end px-6 py-4 space-x-2 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                          <button type="button" onClick={handleCloseModal} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 transition-colors">Cancel</button>
                          <button type="submit" form="surveyForm" className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 transition-colors">Save</button>
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
      </div>
  );
};

export default ManageSurveys;