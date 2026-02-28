import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaSync, FaPaperPlane } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const Applicants = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const [applicants, setApplicants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;
  const [isSyncing, setIsSyncing] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);

  // State for the assignment modal
  const [assigningApplicant, setAssigningApplicant] = useState(null);
  const [interviewers, setInterviewers] = useState([]);
  const [selectedInterviewer, setSelectedInterviewer] = useState('');

  // State for Pre-Assessment Modal
  const [preAssessApplicant, setPreAssessApplicant] = useState(null);
  const [preAssessScores, setPreAssessScores] = useState({ educational_attainment: '', relevant_training: '', relevant_work_experience: '', written_examination: '' });
  const [preAssessNAExam, setPreAssessNAExam] = useState(false);
  const [preAssessError, setPreAssessError] = useState(null);
  const [preAssessSaving, setPreAssessSaving] = useState(false);
  const [preAssessConfirm, setPreAssessConfirm] = useState(false);

  const PA_CRITERIA = [
    { key: 'educational_attainment', label: 'Educational Attainment', max: 100 },
    { key: 'relevant_training', label: 'Relevant Training', max: 100 },
    { key: 'relevant_work_experience', label: 'Relevant Work Experience', max: 100 },
  ];
  const PA_EXAM_MAX = 100;

  // State for Transmit Modal
  const [isTransmitModalOpen, setIsTransmitModalOpen] = useState(false);
  const [transmitOptions, setTransmitOptions] = useState([]);
  const [selectedTransmitSurvey, setSelectedTransmitSurvey] = useState('');

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        if (state?.user) {
          setUserRole(state.user.role);
        }
      } catch (e) {
        console.error("Failed to get session:", e);
      }
    };
    getSession();
  }, []);

  const fetchApplicants = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('applicants', serverIp);
      setApplicants(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [serverIp]);

  const fetchInterviewers = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('employees/users-for-interview', serverIp);
      setInterviewers(data);
    } catch (err) {
      console.error("Failed to fetch interviewers:", err);
    }
  }, [serverIp]);

  useEffect(() => {
    if (!isSettingsLoading) {
      fetchApplicants();
      fetchInterviewers();
    }
  }, [isSettingsLoading, fetchApplicants, fetchInterviewers]);

  const filteredApplicants = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    if (!searchLower) {
      return applicants;
    }
    return applicants.filter(app => {
      const searchableString = `
        ${app.first_name || ''}
        ${app.middle_initial || ''}
        ${app.last_name || ''}
        ${app.email_address || ''}
        ${app.city_municipality || ''}
        ${app.barangay || ''}
        ${app.interviewer || ''}
        ${app.interview_status || ''}
      `.toLowerCase();
      return searchableString.includes(searchLower);
    });
  }, [applicants, searchQuery]);

  const sortedApplicants = useMemo(() => {
    let sortableApplicants = [...filteredApplicants];
    if (sortConfig.key) {
      sortableApplicants.sort((a, b) => {
        // Priority: Unassigned applicants first (unless sorting by interviewer column)
        if (sortConfig.key !== 'interviewer') {
            const aUnassigned = !a.interviewer;
            const bUnassigned = !b.interviewer;
            if (aUnassigned && !bUnassigned) return -1;
            if (!aUnassigned && bUnassigned) return 1;
        }

        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableApplicants;
  }, [filteredApplicants, sortConfig]);

  const totalPages = Math.ceil(sortedApplicants.length / rowsPerPage);
  const currentItems = sortedApplicants.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const requestSort = (key) => {
    setCurrentPage(1);
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  const handleAssignClick = (applicant) => {
    setAssigningApplicant(applicant);
    setSelectedInterviewer('');
    setError(null);
  };

  const handleSync = async () => {
    if (!serverIp) return;
    setIsSyncing(true);
    setError(null);
    try {
      await apiFetch('applicants/sync', serverIp, { method: 'POST' });
      await Promise.all([fetchApplicants(), fetchInterviewers()]);
      setSuccessMessage('Applicants synced successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmAssignment = async () => {
    if (!assigningApplicant || !selectedInterviewer) {
        setError("Please select an interviewer.");
        return;
    }
    
    try {
      await apiFetch(`applicants/${assigningApplicant.id}/assign`, serverIp, { method: 'PUT', body: JSON.stringify({ interviewer_id: selectedInterviewer }) });
      setAssigningApplicant(null);
      fetchApplicants();
      setSuccessMessage('Interviewer assigned successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this applicant?")) return;

    try {
      await apiFetch(`applicants/${id}`, serverIp, { method: 'DELETE' });
      setApplicants(prev => prev.filter(app => app.id !== id));
      setSuccessMessage('Applicant deleted successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleOpenPreAssess = (app) => {
    const saved = app.pre_assessment ? (typeof app.pre_assessment === 'string' ? JSON.parse(app.pre_assessment) : app.pre_assessment) : {};
    setPreAssessScores({
      educational_attainment: saved.educational_attainment ?? '',
      relevant_training: saved.relevant_training ?? '',
      relevant_work_experience: saved.relevant_work_experience ?? '',
      written_examination: saved.written_examination === 'N/A' ? '' : (saved.written_examination ?? ''),
    });
    setPreAssessNAExam(saved.written_examination === 'N/A');
    setPreAssessError(null);
    setPreAssessApplicant(app);
  };

  const handlePreAssessSubmit = (e) => {
    e.preventDefault();
    for (const c of PA_CRITERIA) {
      const val = parseFloat(preAssessScores[c.key]);
      if (preAssessScores[c.key] === '' || isNaN(val)) { setPreAssessError(`Please enter a score for ${c.label}.`); return; }
      if (val < 0 || val > c.max) { setPreAssessError(`${c.label} score must be between 0 and ${c.max}.`); return; }
    }
    if (!preAssessNAExam) {
      const val = parseFloat(preAssessScores.written_examination);
      if (preAssessScores.written_examination === '' || isNaN(val)) { setPreAssessError('Please enter a score for Written Examination or mark it N/A.'); return; }
      if (val < 0 || val > PA_EXAM_MAX) { setPreAssessError(`Written Examination score must be between 0 and ${PA_EXAM_MAX}.`); return; }
    }
    setPreAssessError(null);
    setPreAssessConfirm(true);
  };

  const handlePreAssessConfirm = async () => {
    setPreAssessSaving(true);
    setPreAssessError(null);
    try {
      await apiFetch(`applicants/${preAssessApplicant.id}/pre-assessment`, serverIp, {
        method: 'PUT',
        body: JSON.stringify({
          educational_attainment: parseFloat(preAssessScores.educational_attainment),
          relevant_training: parseFloat(preAssessScores.relevant_training),
          relevant_work_experience: parseFloat(preAssessScores.relevant_work_experience),
          written_examination: preAssessNAExam ? 'N/A' : parseFloat(preAssessScores.written_examination),
        }),
      });
      setPreAssessConfirm(false);
      setPreAssessApplicant(null);
      fetchApplicants();
      setSuccessMessage('Pre-assessment saved successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setPreAssessConfirm(false);
      setPreAssessError(err.message);
    } finally {
      setPreAssessSaving(false);
    }
  };

  const handleOpenTransmitModal = async () => {
    setIsTransmitModalOpen(true);
    setTransmitOptions([]);
    setSelectedTransmitSurvey('');
    setError(null);
    try {
        const data = await apiFetch('applicants/transmit-options', serverIp);
        setTransmitOptions(data);
    } catch (err) {
        setError("Failed to load survey options for transmission.");
    }
  };

  const handleTransmitSubmit = async () => {
    const selectedOption = transmitOptions.find(opt => opt.survey_name === selectedTransmitSurvey);
    if (!selectedOption || !selectedOption.focal_person_id) {
        setError("Invalid survey selection or no focal person assigned to this survey.");
        return;
    }

    try {
        await apiFetch('applicants/transmit', serverIp, {
            method: 'POST',
            body: JSON.stringify({ 
                survey_name: selectedOption.survey_name, 
                focal_id: selectedOption.focal_person_id 
            })
        });
        setIsTransmitModalOpen(false);
        fetchApplicants(); // Refresh list to remove transmitted applicants
        setSuccessMessage('Applicants transmitted to Focal Person successfully.');
        setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
        setError(err.message);
    }
  };

  if (isLoading || isSettingsLoading) {
    return <div className="p-8">Loading Applicants...</div>;
  }

  return (
    <div>
      {successMessage && (
        <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
          <span>✓</span> {successMessage}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Applicant's Registry</h1>
        <div className="flex items-center gap-2">
          {['Super_Admin', 'Admin', 'PACD'].includes(userRole) && (
            <button
              onClick={handleOpenTransmitModal}
              className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-green-600 rounded-lg shadow-md hover:bg-green-700 transition-all"
            >
              <FaPaperPlane /> Transmit to Focal Person
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing || isLoading}
            className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
            title="Sync Records"
          >
            <FaSync className={isSyncing || isLoading ? "animate-spin" : ""} />
          </button>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search applicants..."
            className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {error && <div className="p-3 mb-4 text-center text-red-700 bg-red-100 rounded-lg">{error}</div>}

      <div className="overflow-x-auto bg-white rounded-lg shadow dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase">Name {getSortIcon('last_name')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('email_address')} className="font-semibold flex items-center uppercase">Survey/Census {getSortIcon('email_address')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('interviewer')} className="font-semibold flex items-center uppercase">Interviewer {getSortIcon('interviewer')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('interview_status')} className="font-semibold flex items-center uppercase">Status {getSortIcon('interview_status')}</button></th>
              <th className="px-5 py-3.5 text-center font-semibold tracking-wider uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentItems.length > 0 ? (
              currentItems.map((app) => (
                <tr key={app.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-5 py-4">
                    <p className="font-medium text-gray-900 whitespace-no-wrap dark:text-white">{[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}</p>
                  </td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{app.survey_name}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{app.interviewer || 'Unassigned'}</td>
                  <td className="px-5 py-4">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      app.interview_status === 'Returned to PACD' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                      app.interview_status === 'Ongoing Interview' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                      app.interview_status === 'For Interview' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {app.interview_status || 'Unassigned'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <div className="flex items-center justify-center space-x-3">
                      {app.interview_status === 'Returned to PACD' ? (
                        <span className="font-medium text-teal-600 dark:text-teal-400 cursor-default" title="Interview completed">
                          Interviewed ✓
                        </span>
                      ) : (
                        <button 
                          onClick={() => handleAssignClick(app)} 
                          disabled={app.interviewer && app.interview_status === 'Ongoing Interview'}
                          className={`font-medium ${app.interviewer && app.interview_status === 'Ongoing Interview' ? 'text-gray-400 cursor-not-allowed dark:text-gray-600' : app.interviewer ? 'text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300' : 'text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300'}`}
                        >
                          {app.interviewer ? 'Reassign' : 'Assign'}
                        </button>
                      )}
                      {app.pre_assessment ? (
                        <span className="font-medium text-green-600 dark:text-green-400 cursor-default" title="Pre-assessment already submitted">
                          Assessed ✓
                        </span>
                      ) : (
                        <button onClick={() => handleOpenPreAssess(app)} className="font-medium text-purple-600 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300">
                          Pre-Assessment
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(app.id)}
                        disabled={app.interview_status === 'Ongoing Interview' || app.interview_status === 'Returned to PACD'}
                        className={`font-medium ${app.interview_status === 'Ongoing Interview' || app.interview_status === 'Returned to PACD' ? 'text-gray-400 cursor-not-allowed dark:text-gray-600' : 'text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300'}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="py-16 text-center text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Applicants Found</h3>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {Math.min((currentPage - 1) * rowsPerPage + 1, sortedApplicants.length)} to {Math.min(currentPage * rowsPerPage, sortedApplicants.length)} of {sortedApplicants.length} records
        </span>
        <div className="flex items-center space-x-2">
          <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Next</button>
        </div>
      </div>

      {/* Pre-Assessment Modal */}
      {preAssessApplicant && (() => {
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="flex flex-col w-full max-w-lg max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Pre-Assessment</h2>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  {[preAssessApplicant.first_name, preAssessApplicant.middle_initial, preAssessApplicant.last_name, preAssessApplicant.suffix].filter(Boolean).join(' ')}
                </p>
              </div>

              <form onSubmit={handlePreAssessSubmit} className="flex-1 overflow-y-auto">
                <div className="px-6 py-5 space-y-4">

                  {preAssessError && (
                    <div className="p-3 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-900/30 dark:text-red-400">{preAssessError}</div>
                  )}

                  {/* Fixed criteria */}
                  {PA_CRITERIA.map(c => (
                    <div key={c.key} className="flex items-center justify-between gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div>
                        <p className="font-semibold text-sm text-gray-800 dark:text-white">{c.label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Score (0 – 100)</p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={c.max}
                        step="0.01"
                        value={preAssessScores[c.key]}
                        onChange={e => setPreAssessScores(prev => ({ ...prev, [c.key]: e.target.value }))}
                        placeholder="0"
                        className="w-28 px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  ))}

                  {/* Written Examination */}
                  <div className={`p-4 border rounded-lg ${
                    preAssessNAExam
                      ? 'border-gray-200 dark:border-gray-700 opacity-60'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-sm text-gray-800 dark:text-white">Written Examination</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Score (0 – 100)</p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={PA_EXAM_MAX}
                        step="0.01"
                        value={preAssessScores.written_examination}
                        onChange={e => setPreAssessScores(prev => ({ ...prev, written_examination: e.target.value }))}
                        placeholder="0"
                        disabled={preAssessNAExam}
                        className="w-28 px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                      />
                    </div>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={preAssessNAExam}
                        onChange={e => {
                          setPreAssessNAExam(e.target.checked);
                          if (e.target.checked) setPreAssessScores(prev => ({ ...prev, written_examination: '' }));
                        }}
                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-300">Not Applicable</span>
                    </label>
                  </div>

                </div>

                {/* Footer */}
                {preAssessConfirm ? (
                  <div className="flex-shrink-0 px-6 py-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-700">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">⚠ Once saved, this pre-assessment cannot be edited.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">Are you sure you want to save these scores?</p>
                    <div className="flex justify-end gap-3">
                      <button type="button" onClick={() => setPreAssessConfirm(false)} disabled={preAssessSaving} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 disabled:opacity-50">Go Back</button>
                      <button type="button" onClick={handlePreAssessConfirm} disabled={preAssessSaving} className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
                        {preAssessSaving ? 'Saving...' : 'Confirm & Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-shrink-0 flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" onClick={() => setPreAssessApplicant(null)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
                    <button type="submit" disabled={preAssessSaving} className="px-5 py-2 text-sm font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      {preAssessSaving ? 'Saving...' : 'Save Assessment'}
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        );
      })()}

      {/* Assign for Interview Modal */}
      {assigningApplicant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Assign Interviewer</h2>
            <p className="mt-2 text-gray-600 dark:text-gray-300">
              Select an interviewer for <strong className="dark:text-white">{`${assigningApplicant.first_name} ${assigningApplicant.last_name}`}</strong>.
            </p>
            
            {error && <div className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</div>}

            <div className="mt-4">
                <label htmlFor="interviewer-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Interviewer</label>
                <select
                    id="interviewer-select"
                    value={selectedInterviewer}
                    onChange={(e) => setSelectedInterviewer(e.target.value)}
                    className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                    <option value="" disabled>-- Select an interviewer --</option>
                    {interviewers.map(user => (
                        <option key={user.id} value={user.id}>{user.full_name}</option>
                    ))}
                </select>
            </div>

            <div className="flex justify-end mt-6 space-x-2">
              <button 
                onClick={() => setAssigningApplicant(null)} 
                className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmAssignment} 
                className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50"
                disabled={!selectedInterviewer}
              >
                Confirm Assignment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transmit to Focal Person Modal */}
      {isTransmitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md p-6 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Transmit to Focal Person</h2>
            
            {error && <div className="mb-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</div>}

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select Survey to Submit</label>
                    <select
                        value={selectedTransmitSurvey}
                        onChange={(e) => setSelectedTransmitSurvey(e.target.value)}
                        className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="" disabled>-- Select Survey --</option>
                        {transmitOptions.map((opt, idx) => (
                            <option key={idx} value={opt.survey_name}>{opt.survey_name}</option>
                        ))}
                    </select>
                </div>

                {selectedTransmitSurvey && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md border border-gray-200 dark:border-gray-600">
                        <span className="block text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">Focal Person</span>
                        <span className="block text-lg font-medium text-gray-900 dark:text-white">
                            {transmitOptions.find(opt => opt.survey_name === selectedTransmitSurvey)?.focal_person_name || 'No Focal Person Assigned'}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex justify-end mt-6 space-x-2">
              <button onClick={() => setIsTransmitModalOpen(false)} className="px-4 py-2 font-semibold text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
              <button onClick={handleTransmitSubmit} disabled={!selectedTransmitSurvey} className="px-4 py-2 font-semibold text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50">Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Applicants;