import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaExclamationTriangle, FaPlay, FaArrowLeft, FaCheck } from 'react-icons/fa';
import { FiX, FiSave } from 'react-icons/fi';
import { apiFetch } from '../components/API';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

const DEFAULT_CRITERIA = [
  {
    key: 'professionalism',
    label: 'Professionalism',
    description: 'The ability to conduct self in an excellent and competent manner expected of a person trained to do the job. Some of the central professional characteristics includes commitment and confidence, responsibility and dependability, honesty and ethics, and appearance.',
    notApplicable: true
  },
  {
    key: 'interpersonal',
    label: 'Interpersonal Skills',
    description: 'Skills we use every day when we communicate and interact with other people, both individually and in groups. It is sometimes referred to as social skills, people skills, soft skills, or life skills. The ability of an individual to effectively communicate and interact with co-workers, clients, and work well in a team to achieve desired/agreed results.',
    notApplicable: true
  },
  {
    key: 'organization',
    label: 'Organization Skills',
    description: 'The ability to set priorities and identify scope and allocate resources to meet individual, team or organisation targets and objectives. It is the ability of an individual to make use of their time, energy and resources available in an effective manner to achieve their goal.',
    notApplicable: true
  },
  {
    key: 'written_communication',
    label: 'Written Communication',
    description: 'Written communication skills are those necessary to get your point across in writing. While they share many of the same features as verbal communication skills, written communication relies on grammar, punctuation and word choice.',
    notApplicable: true
  },
  {
    key: 'oral_communication',
    label: 'Oral Communication',
    description: 'Transfer of information from sender to receiver by means of verbal and visual aid. Most of the times oral communication is effectively carried out with the help of non-verbal communication like body language and tone modulations.',
    notApplicable: true
  },
  {
    key: 'digital_literacy',
    label: 'Digital Literacy',
    description: 'Ability to operate standard personal computer/tablets and use computer software, applications and technology.',
    notApplicable: true
  }
];

const Interview = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { session } = useAuth();
  const { toasts, showToast, removeToast } = useToast();
  const [assignedApplicants, setAssignedApplicants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState(null);
  const [employmentHistory, setEmploymentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // criteria used for current interview; may be filtered from defaults depending on survey
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [interviewForm, setInterviewForm] = useState({});

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [interviewConfirm, setInterviewConfirm] = useState(false);




  const computedAverage = useMemo(() => {
    // Only average enabled criteria (those that aren't marked as N/A)
    const scores = criteria
      .filter(c => c.enabled && interviewForm[c.key] !== 'N/A' && interviewForm[c.key] !== '')
      .map(c => parseFloat(interviewForm[c.key]))
      .filter(v => !isNaN(v));
    if (scores.length === 0) return null;
    return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
  }, [interviewForm, criteria]);

  const isFormValid = useMemo(() => {
    // each enabled criterion must have a score between 1 and 100
    for (const criterion of criteria) {
      if (criterion.enabled === false) continue; // skip disabled
      const val = interviewForm[criterion.key];

      if (val === '' || val === undefined || val === null || val === 'N/A') {
        return false; // must have a value
      }

      const numVal = parseFloat(val);
      if (isNaN(numVal) || numVal < 1 || numVal > 100) {
        return false; // must be a number in range
      }
    }
    return true; // all valid
  }, [interviewForm, criteria]);

  const fetchAssignedApplicants = useCallback(async () => {
    if (!serverIp || !session?.token) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('applicants/assigned-to-me', serverIp);
      // ensure we only keep those with the statuses the interviewer cares about
      const filtered = Array.isArray(data)
        ? data.filter(a => a.interview_status === 'For Interview' || a.interview_status === 'Ongoing Interview')
        : [];
      setAssignedApplicants(filtered);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, session, showToast]);

  useEffect(() => {
    if (!isSettingsLoading && session) {
      fetchAssignedApplicants();
    }
  }, [isSettingsLoading, session, fetchAssignedApplicants]);

  const filteredApplicants = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    if (!searchLower) return assignedApplicants;
    return assignedApplicants.filter(app => 
      `${app.first_name || ''} ${app.last_name || ''} ${app.survey_name || ''}`.toLowerCase().includes(searchLower)
    );
  }, [assignedApplicants, searchQuery]);

  const sortedApplicants = useMemo(() => {
    let sortableApplicants = [...filteredApplicants];
    if (sortConfig.key) {
      sortableApplicants.sort((a, b) => {
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
    setSortConfig(current => ({ key, direction: current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending' ? <FaSortUp className="inline-block ml-1 text-blue-500" /> : <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  const handleProceedInterview = async (applicant) => {
    setSelectedApplicant(applicant);
    // Default: all criteria enabled until we confirm otherwise
    let list = DEFAULT_CRITERIA.map(c => ({ ...c, enabled: true }));
    
    if (applicant.survey_name) {
      try {
        const crit = await apiFetch(`applicants/surveys/${encodeURIComponent(applicant.survey_name)}/rating-criteria`, serverIp);
        
        // Check if we got a valid response with interview criteria
        if (crit && Array.isArray(crit.interview) && crit.interview.length > 0) {
          // Survey HAS configured criteria - only enable those in the list
          const allowed = new Set(crit.interview);
          list = DEFAULT_CRITERIA.map(c => ({ ...c, enabled: allowed.has(c.key) }));
          console.log(`Rating criteria loaded for survey "${applicant.survey_name}":`, crit.interview);
        } else {
          // Survey criteria not yet configured or empty - enable all
          console.warn(`No interview criteria configured for survey "${applicant.survey_name}", enabling all criteria`);
          list = DEFAULT_CRITERIA.map(c => ({ ...c, enabled: true }));
        }
      } catch (e) {
        // If fetch fails, enable all as fallback
        console.warn(`Could not fetch rating criteria for survey "${applicant.survey_name}":`, e.message);
        list = DEFAULT_CRITERIA.map(c => ({ ...c, enabled: true }));
      }
    }
    setCriteria(list);

    // set initial form values; disabled items start as 'N/A'
    const initialForm = { remarks: '' };
    list.forEach(c => { initialForm[c.key] = c.enabled ? '' : 'N/A'; });
    setInterviewForm(initialForm);

    setIsModalOpen(true);
    setSaveError(null);
    setEmploymentHistory([]);
    setHistoryLoading(true);
    try {
        // Mark as Ongoing Interview
        await apiFetch(`applicants/${applicant.id}/interview-status`, serverIp, {
            method: 'PUT',
            body: JSON.stringify({ interview_status: 'Ongoing Interview' }),
        });
        const query = new URLSearchParams({
            first_name: applicant.first_name,
            last_name: applicant.last_name
        }).toString();
        const data = await apiFetch(`employments/history?${query}`, serverIp);
        setEmploymentHistory(data);
    } catch (err) {
        console.error("Failed to fetch history:", err);
        setSaveError(err.message);
        setTimeout(() => setSaveError(null), 3000);
    } finally {
        setHistoryLoading(false);
    }
  };

  // validate interview scores, returns error message or null
  const validateInterview = () => {
    // each enabled criterion must have a score between 1 and 100
    for (const criterion of criteria) {
      if (criterion.enabled === false) continue; // disabled fields are shown as N/A and not required
      const key = criterion.key;
      const label = criterion.label;
      const val = interviewForm[key];

      if (val === '' || val === undefined || val === null) {
        return `${label} is required and must be between 1 and 100.`;
      }
      if (val === 'N/A') {
        // shouldn't happen for enabled fields, treat as missing
        return `${label} is required and must be between 1 and 100.`;
      }

      // ensure numeric and within range
      if (isNaN(parseFloat(val)) || parseFloat(val) < 1 || parseFloat(val) > 100) {
        return `${label} must be between 1 and 100.`;
      }
    }
    return null;
  };

  const handleSaveInterview = () => {
    if (!selectedApplicant) return;
    setSaveError(null);
    const err = validateInterview();
    if (err) {
      setSaveError(err);
      setTimeout(() => setSaveError(null), 3000);
      setInterviewConfirm(false);
      return;
    }
    setInterviewConfirm(true);
  };

  // Helper function to format numbers to 2 decimal places
  const formatTo2Decimals = (num) => {
    if (num === null || num === undefined) return null;
    return parseFloat(parseFloat(num).toFixed(2));
  };

  const handleConfirmSaveInterview = async () => {
    // run validator again in case handleSaveInterview didn't run (or data changed)
    const err = validateInterview();
    if (err) {
      setSaveError(err);
      setTimeout(() => setSaveError(null), 3000);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const normalize = (val) => {
      if (val === '' || val === undefined || val === null) return 'N/A';
      // Format numeric values to 2 decimal places
      if (!isNaN(val) && val !== '') {
        return formatTo2Decimals(val).toFixed(2);
      }
      return val;
    };
    try {
        // build payload based on ENABLED criteria only (don't save disabled criteria)
        const payload = { average_score: computedAverage, remarks: interviewForm.remarks, interview_status: 'Done Interview' };
        criteria.forEach(c => {
          // Only include criteria that are enabled for this survey
          if (c.enabled) {
            payload[c.key] = normalize(interviewForm[c.key]);
          }
        });
        await apiFetch(`applicants/${selectedApplicant.id}/interview-result`, serverIp, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setInterviewConfirm(false);
        setIsModalOpen(false);
        fetchAssignedApplicants();
        showToast('Interview results saved successfully.', 'success');
    } catch (err) {
        setInterviewConfirm(false);
        showToast(err.message, 'error');
    } finally {
        setIsSaving(false);
    }
  };

  if (isLoading || isSettingsLoading) {
    return <div className="p-8">Loading Assigned Applicants...</div>;
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Assigned Interviews</h1>
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search applicants..." className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
      </div>


      <div className="overflow-x-auto bg-white rounded-lg shadow dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            <tr className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase">Name {getSortIcon('last_name')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('survey_name')} className="font-semibold flex items-center uppercase">Survey/Census {getSortIcon('survey_name')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('phone_number')} className="font-semibold flex items-center uppercase">Phone {getSortIcon('phone_number')}</button></th>
              <th className="px-5 py-3.5 text-left"><button onClick={() => requestSort('city_municipality')} className="font-semibold flex items-center uppercase">Location {getSortIcon('city_municipality')}</button></th>
              <th className="px-5 py-3.5 text-center font-semibold tracking-wider uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentItems.length > 0 ? (
              currentItems.map((app) => (
                <tr key={app.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-5 py-4"><p className="font-medium text-gray-900 whitespace-no-wrap dark:text-white">{[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}</p></td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{app.survey_name}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{app.phone_number}</td>
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300">{[app.barangay, app.city_municipality].filter(Boolean).join(', ')}</td>
                  <td className="px-5 py-4 text-center">
                    <button onClick={() => handleProceedInterview(app)} title="Proceed for Interview" className="p-1 rounded-lg transition-colors text-blue-600 hover:text-blue-900 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20"><FaPlay className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan="5" className="py-16 text-center text-gray-500 dark:text-gray-400"><h3 className="text-lg font-medium">No Applicants Assigned to You</h3></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4">
        <span className="text-sm text-gray-700 dark:text-gray-300">Showing {sortedApplicants.length === 0 ? 0 : Math.min((currentPage - 1) * rowsPerPage + 1, sortedApplicants.length)} to {Math.min(currentPage * rowsPerPage, sortedApplicants.length)} of {sortedApplicants.length} records</span>
        <div className="flex items-center space-x-2">
          <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} title={currentPage === totalPages ? 'Already on last page' : 'Go to next page'} className="px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50">Next</button>
        </div>
      </div>

      {/* Interview Modal */}
      {isModalOpen && selectedApplicant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-6xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col">
                <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Interview</p>
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            {selectedApplicant.first_name} {selectedApplicant.last_name}
                        </h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {selectedApplicant.position && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                    {selectedApplicant.position}
                                </span>
                            )}
                            {selectedApplicant.survey_name && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                                    {selectedApplicant.survey_name}
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        <FiX className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="p-6 overflow-y-auto">
                    <div className="flex gap-6">
                    {/* LEFT COLUMN: Score Cards + Remarks */}
                    <div className="w-[500px] flex-shrink-0">
                    {/* Interview Criteria Section */}
                    <div className="mb-8">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">Interview Assessment</h3>
                        <div className="space-y-4">
                          {criteria.map(criterion => (
                            <div key={criterion.key} className={`border rounded-lg p-4 ${criterion.enabled ? 'bg-gray-50 dark:bg-gray-700/30 dark:border-gray-600' : 'bg-gray-100 dark:bg-gray-700/10 dark:border-gray-600 opacity-60'}`}>
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{criterion.label}</p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{criterion.description}</p>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-2">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type={criterion.enabled ? 'number' : 'text'}
                                      min={criterion.enabled ? 1 : undefined}
                                      max={criterion.enabled ? 100 : undefined}
                                      step={criterion.enabled ? '1' : undefined}
                                      disabled={!criterion.enabled}
                                      value={criterion.enabled ? interviewForm[criterion.key] : 'N/A'}
                                      onChange={e => {
                                        if (!criterion.enabled) return;
                                        let v = e.target.value;
                                        if (v !== '' && (parseInt(v) < 1 || parseInt(v) > 100)) return;
                                        if (v !== '') {
                                          // Limit to 2 decimal places
                                          let num = parseFloat(v);
                                          if (!isNaN(num)) {
                                            const limited = Math.round(num * 100) / 100;
                                            setInterviewForm(p => ({ ...p, [criterion.key]: limited.toString() }));
                                            return;
                                          }
                                        }
                                        setInterviewForm(p => ({ ...p, [criterion.key]: v }));
                                      }}
                                      placeholder={criterion.enabled ? '1–100' : 'N/A'}
                                      className="w-20 text-center p-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    />
                                    <span className="text-xs text-gray-500 dark:text-gray-400"></span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Average Score Preview */}
                        <div className={`mt-4 rounded-lg border px-4 py-3 flex items-center justify-between ${
                          computedAverage === null ? 'bg-gray-50 border-gray-200 dark:bg-gray-900/30 dark:border-gray-700 text-gray-400' :
                          parseFloat(computedAverage) >= 85 ? 'bg-green-50 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300' :
                          parseFloat(computedAverage) >= 70 ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300' :
                          parseFloat(computedAverage) >= 50 ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-300' :
                          'bg-red-50 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300'
                        }`}>
                          <span className="text-sm font-semibold">Average Score</span>
                          <span className="text-base font-bold">
                            {computedAverage !== null ? `${computedAverage} / 100` : 'Enter scores above'}
                          </span>
                        </div>
                    </div>

                    {/* Interviewer Remarks Section */}
                    <div className="mb-8">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Interviewer Remarks</h3>
                        <textarea rows="3" value={interviewForm.remarks} onChange={e => setInterviewForm(p => ({ ...p, remarks: e.target.value }))} className="block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" placeholder="General observations..."></textarea>
                    </div>
                    </div>{/* end left column */}

                    {/* Divider */}
                    <div className="flex-shrink-0 w-px bg-gray-200 dark:bg-gray-700 self-stretch"></div>

                    {/* RIGHT COLUMN: Employment History */}
                    <div className="flex-1 min-w-0">
                    {/* Employment History Section */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Previous Employment History <span className="text-xs font-normal text-gray-500 dark:text-gray-400">(HireTrack Database)</span></h3>
                        {historyLoading ? (
                            <p className="text-gray-500 dark:text-gray-400">Loading history...</p>
                        ) : employmentHistory.length > 0 ? (
                            <div className="space-y-3">
                                {employmentHistory.map((emp) => (
                                    <div key={emp.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-3 text-sm">
                                        <p className="font-semibold text-gray-900 dark:text-white">{emp.position_title}</p>
                                        {emp.survey_name && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{emp.survey_name}</p>}
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{emp.contract_start_date} – {emp.contract_end_date}</p>
                                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                            <span className="text-xs text-gray-600 dark:text-gray-300"><span className="font-medium">Rating:</span> {emp.rating || 'N/A'}</span>
                                            {emp.remarks && <span className="text-xs text-gray-600 dark:text-gray-300"><span className="font-medium">Remarks:</span> {emp.remarks}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500 dark:text-gray-400 italic">No previous employment records found.</p>
                        )}
                    </div>
                    </div>{/* end right column */}
                    </div>{/* end flex row */}
                </div>
                
                {interviewConfirm ? (
                  <div className="p-6 border-t border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">⚠ Once saved, this interview rating cannot be edited.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">Are you sure you want to save and mark this interview as complete?</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setInterviewConfirm(false)} disabled={isSaving} title={isSaving ? 'Saving - please wait' : 'Go back and edit'} className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"><FaArrowLeft className="w-4 h-4" />Go Back</button>
                      <button onClick={handleConfirmSaveInterview} disabled={isSaving} title={isSaving ? 'Saving interview...' : 'Confirm and save interview'} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Saving...' : <><FaCheck className="w-4 h-4" />Confirm & Save</>}</button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"><FiX className="w-4 h-4" />Close</button>
                        <button onClick={handleSaveInterview} disabled={isSaving || !isFormValid} title={isSaving ? 'Saving interview...' : !isFormValid ? 'Please fill all required score fields with valid scores (1-100).' : 'Save interview assessment'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">{isSaving ? 'Saving...' : <><FiSave className="w-4 h-4" />Save Interview</>}</button>
                    </div>
                  </div>
                )}
            </div>
        </div>
      )}
      
      {saveError && (
        <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-red-600 text-white text-sm font-semibold rounded-lg shadow-lg">
          <FaExclamationTriangle className="w-5 h-5" /> {saveError}
        </div>
      )}
    </div>
  );
};

export default Interview;
