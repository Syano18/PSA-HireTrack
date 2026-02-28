import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown } from 'react-icons/fa';
import { FiX } from 'react-icons/fi';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

const Interview = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { session } = useAuth();
  const [assignedApplicants, setAssignedApplicants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'last_name', direction: 'ascending' });
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApplicant, setSelectedApplicant] = useState(null);
  const [employmentHistory, setEmploymentHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [interviewForm, setInterviewForm] = useState({
    professionalism: '',
    interpersonal: '',
    organization: '',
    written_communication: '',
    oral_communication: '',
    digital_literacy: '',
    remarks: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [interviewConfirm, setInterviewConfirm] = useState(false);
  const [successMessage, setSuccessMessage] = useState(null);

  const CRITERIA = [
    {
      key: 'professionalism',
      label: 'Professionalism',
      description: 'The ability to conduct self in an excellent and competent manner expected of a person trained to do the job. Some of the central professional characteristics includes commitment and confidence, responsibility and dependability, honesty and ethics, and appearance.'
    },
    {
      key: 'interpersonal',
      label: 'Interpersonal Skills',
      description: 'Skills we use every day when we communicate and interact with other people, both individually and in groups. It is sometimes referred to as social skills, people skills, soft skills, or life skills. The ability of an individual to effectively communicate and interact with co-workers, clients, and work well in a team to achieve desired/agreed results.'
    },
    {
      key: 'organization',
      label: 'Organization Skills',
      description: 'The ability to set priorities and identify scope and allocate resources to meet individual, team or organisation targets and objectives. It is the ability of an individual to make use of their time, energy and resources available in an effective manner to achieve their goal.'
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
      description: 'Transfer of information from sender to receiver by means of verbal and visual aid. Most of the times oral communication is effectively carried out with the help of non-verbal communication like body language and tone modulations.'
    },
    {
      key: 'digital_literacy',
      label: 'Digital Literacy',
      description: 'Ability to operate standard personal computer/tablets and use computer software, applications and technology.'
    }
  ];

  const computedAverage = useMemo(() => {
    const scores = CRITERIA
      .filter(c => interviewForm[c.key] !== 'N/A' && interviewForm[c.key] !== '')
      .map(c => parseFloat(interviewForm[c.key]))
      .filter(v => !isNaN(v));
    if (scores.length === 0) return null;
    return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewForm]);

  const fetchAssignedApplicants = useCallback(async () => {
    if (!serverIp || !session?.token) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('applicants/assigned-to-me', serverIp);
      setAssignedApplicants(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, session]);

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
    setIsModalOpen(true);
    setInterviewForm({ professionalism: '', interpersonal: '', organization: '', written_communication: '', oral_communication: '', digital_literacy: '', remarks: '' });
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
    } finally {
        setHistoryLoading(false);
    }
  };

  const handleSaveInterview = () => {
    if (!selectedApplicant) return;
    setSaveError(null);
    setInterviewConfirm(true);
  };

  const handleConfirmSaveInterview = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
        await apiFetch(`applicants/${selectedApplicant.id}/interview-result`, serverIp, {
            method: 'PUT',
            body: JSON.stringify({
                professionalism: interviewForm.professionalism,
                interpersonal: interviewForm.interpersonal,
                organization: interviewForm.organization,
                written_communication: interviewForm.written_communication,
                oral_communication: interviewForm.oral_communication,
                digital_literacy: interviewForm.digital_literacy,
                average_score: computedAverage,
                remarks: interviewForm.remarks,
                interview_status: 'Returned to PACD',
            }),
        });
        setInterviewConfirm(false);
        setIsModalOpen(false);
        fetchAssignedApplicants();
        setSuccessMessage('Interview results saved successfully.');
        setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
        setInterviewConfirm(false);
        setSaveError(err.message);
    } finally {
        setIsSaving(false);
    }
  };

  if (isLoading || isSettingsLoading) {
    return <div className="p-8">Loading Assigned Applicants...</div>;
  }

  return (
    <div>
      {successMessage && (
        <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
          <span>✓</span> {successMessage}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">My Interviews</h1>
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search applicants..." className="w-64 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" />
      </div>

      {error && <div className="p-3 mb-4 text-center text-red-700 bg-red-100 rounded-lg">{error}</div>}

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
                    <button onClick={() => handleProceedInterview(app)} className="font-medium text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300">Proceed for Interview</button>
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
        <span className="text-sm text-gray-700 dark:text-gray-300">Showing {Math.min((currentPage - 1) * rowsPerPage + 1, sortedApplicants.length)} to {Math.min(currentPage * rowsPerPage, sortedApplicants.length)} of {sortedApplicants.length} records</span>
        <div className="flex items-center space-x-2">
          <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Next</button>
        </div>
      </div>

      {/* Interview Modal */}
      {isModalOpen && selectedApplicant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl flex flex-col">
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
                    {/* Interview Criteria Section */}
                    <div className="mb-8">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">Interview Assessment</h3>
                        <div className="space-y-4">
                          {CRITERIA.map(criterion => (
                            <div key={criterion.key} className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-700/30 dark:border-gray-600">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{criterion.label}</p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{criterion.description}</p>
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-2">
                                  {criterion.notApplicable && (
                                    <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                      <input type="checkbox" checked={interviewForm[criterion.key] === 'N/A'} onChange={e => setInterviewForm(p => ({ ...p, [criterion.key]: e.target.checked ? 'N/A' : '' }))} className="w-4 h-4" />
                                      N/A
                                    </label>
                                  )}
                                  {interviewForm[criterion.key] !== 'N/A' && (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min="1"
                                        max="100"
                                        value={interviewForm[criterion.key]}
                                        onChange={e => {
                                          let v = e.target.value;
                                          if (v !== '' && (parseInt(v) < 1 || parseInt(v) > 100)) return;
                                          setInterviewForm(p => ({ ...p, [criterion.key]: v }));
                                        }}
                                        placeholder="1–100"
                                        className="w-20 text-center p-2 text-sm border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                                      />
                                      <span className="text-xs text-gray-500 dark:text-gray-400">/100</span>
                                    </div>
                                  )}
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

                    {/* Employment History Section */}
                    <div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Previous Employment History (Source: HireTrack Database)</h3>
                        {historyLoading ? (
                            <p className="text-gray-500 dark:text-gray-400">Loading history...</p>
                        ) : employmentHistory.length > 0 ? (
                            <div className="overflow-x-auto border rounded-lg dark:border-gray-700">
                                <table className="min-w-full text-sm text-left">
                                    <thead className="bg-gray-50 dark:bg-gray-900">
                                        <tr>
                                            <th className="px-4 py-2 font-medium text-gray-900 dark:text-white">Position</th>
                                            <th className="px-4 py-2 font-medium text-gray-900 dark:text-white">Project/Survey</th>
                                            <th className="px-4 py-2 font-medium text-gray-900 dark:text-white">Duration</th>
                                            <th className="px-4 py-2 font-medium text-gray-900 dark:text-white">Rating</th>
                                            <th className="px-4 py-2 font-medium text-gray-900 dark:text-white">Remarks</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {employmentHistory.map((emp) => (
                                            <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{emp.position_title}</td>
                                                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{emp.survey_name}</td>
                                                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{emp.contract_start_date} - {emp.contract_end_date}</td>
                                                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{emp.rating || 'N/A'}</td>
                                                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{emp.remarks || 'N/A'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-gray-500 dark:text-gray-400 italic">No previous employment records found.</p>
                        )}
                    </div>
                </div>
                
                {interviewConfirm ? (
                  <div className="p-6 border-t border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">⚠ Once saved, this interview rating cannot be edited.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">Are you sure you want to save and mark this interview as complete?</p>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setInterviewConfirm(false)} disabled={isSaving} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">Go Back</button>
                      <button onClick={handleConfirmSaveInterview} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Saving...' : 'Confirm & Save'}</button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 border-t border-gray-200 dark:border-gray-700">
                    {saveError && <div className="mb-3 p-3 text-sm text-red-700 bg-red-100 rounded-lg">{saveError}</div>}
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">Close</button>
                        <button onClick={handleSaveInterview} disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{isSaving ? 'Saving...' : 'Save Interview'}</button>
                    </div>
                  </div>
                )}
            </div>
        </div>
      )}
    </div>
  );
};

export default Interview;