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

  // surveys currently missing evaluation criteria
  const [noCriteriaSurveys, setNoCriteriaSurveys] = useState([]);

  // State for the assignment modal
  const [assigningApplicant, setAssigningApplicant] = useState(null);
  const [interviewers, setInterviewers] = useState([]);
  const [selectedInterviewer, setSelectedInterviewer] = useState('');

  // State for Pre-Assessment Modal
  const [preAssessApplicant, setPreAssessApplicant] = useState(null);
  const [preAssessScores, setPreAssessScores] = useState({ educational_attainment: '', relevant_training: '', relevant_work_experience: '', written_examination: '' });
  // removed N/A option for written exam – score required when allowed
  const [preAssessError, setPreAssessError] = useState(null);
  const [preAssessSaving, setPreAssessSaving] = useState(false);
  const [preAssessConfirm, setPreAssessConfirm] = useState(false);
  const [preAssessAllowed, setPreAssessAllowed] = useState({});

  // State for Training Records sub-modal
  const [trainingRecords, setTrainingRecords] = useState(null); // null = closed, [] = open (empty), [...] = open with data
  const [trainingRecordsLoading, setTrainingRecordsLoading] = useState(false);

  // State for Employment Records sub-modal
  const [employmentRecords, setEmploymentRecords] = useState(null);
  const [employmentRecordsLoading, setEmploymentRecordsLoading] = useState(false);

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

  // State for Evaluation Criteria modal (survey-level)
  const [evalSurvey, setEvalSurvey] = useState('');
  const [evalCriteria, setEvalCriteria] = useState({ pre_assessment: [], interview: [] });
  const [evalSaveError, setEvalSaveError] = useState(null);
  const [evalSaving, setEvalSaving] = useState(false);
  const [isEvalModalOpen, setIsEvalModalOpen] = useState(false);
  const [isSurveyDropdownOpen, setIsSurveyDropdownOpen] = useState(false);

  // whether the save action has been confirmed by the user
  const [evalConfirm, setEvalConfirm] = useState(false);

  // list of surveys eligible for evaluation criteria (no criteria set yet)
  const [evalSurveyOptions, setEvalSurveyOptions] = useState([]);

  const INTERVIEW_CRITERIA = [
    { key: 'professionalism', label: 'Professionalism' },
    { key: 'interpersonal', label: 'Interpersonal Skills' },
    { key: 'organization', label: 'Organization Skills' },
    { key: 'written_communication', label: 'Written Communication', notApplicable: true },
    { key: 'oral_communication', label: 'Oral Communication' },
    { key: 'digital_literacy', label: 'Digital Literacy' },
  ];

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


  const loadSurveysWithoutCriteria = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('applicants/surveys/without-criteria', serverIp);
      const arr = Array.isArray(data) ? data.filter(Boolean) : [];
      setEvalSurveyOptions(arr);
      setNoCriteriaSurveys(arr);
    } catch (err) {
      console.error('Failed to load evaluation survey options:', err);
      setEvalSurveyOptions([]);
      setNoCriteriaSurveys([]);
      setError('Failed to load survey options.');
    }
  }, [serverIp]);

  useEffect(() => {
    if (!isSettingsLoading) {
      fetchApplicants();
      fetchInterviewers();
      loadSurveysWithoutCriteria();
    }
  }, [isSettingsLoading, fetchApplicants, fetchInterviewers, loadSurveysWithoutCriteria]);

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

  const handleOpenPreAssess = async (app) => {
    // don't open if survey lacks evaluation criteria
    if (app.survey_name && noCriteriaSurveys.includes(app.survey_name)) return;
    const saved = app.pre_assessment ? (typeof app.pre_assessment === 'string' ? JSON.parse(app.pre_assessment) : app.pre_assessment) : {};
    setPreAssessScores({
      educational_attainment: saved.educational_attainment ?? '',
      relevant_training: saved.relevant_training ?? '',
      relevant_work_experience: saved.relevant_work_experience ?? '',
      written_examination: saved.written_examination ?? '',
    });
    setPreAssessError(null);
    setPreAssessApplicant(app);

    // determine which fields are allowed per survey's evaluation criteria
    let allowed = {};
    PA_CRITERIA.concat({ key: 'written_examination', label: 'Written Examination' }).forEach(c => {
      allowed[c.key] = true; // default
    });
    if (app.survey_name) {
      try {
        const crit = await apiFetch(`applicants/surveys/${encodeURIComponent(app.survey_name)}/rating-criteria`, serverIp);
        const pre = Array.isArray(crit.pre_assessment) ? crit.pre_assessment : [];
        PA_CRITERIA.concat({ key: 'written_examination' }).forEach(c => {
          allowed[c.key] = pre.includes(c.key);
        });
      } catch (err) {
        // swallow; keep all allowed
      }
    }
    setPreAssessAllowed(allowed);
  };

  const handlePreAssessSubmit = (e) => {
    e.preventDefault();
    for (const c of PA_CRITERIA) {
      const val = parseFloat(preAssessScores[c.key]);
      if (preAssessScores[c.key] === '' || isNaN(val)) { setPreAssessError(`Please enter a score for ${c.label}.`); return; }
      if (val <= 0 || val > c.max) { setPreAssessError(`${c.label} score must be greater than 0 and at most ${c.max}.`); return; }
    }
    // written examination score is required only if the criterion is allowed
    if (preAssessAllowed.written_examination) {
      const val = parseFloat(preAssessScores.written_examination);
      if (preAssessScores.written_examination === '' || isNaN(val)) { setPreAssessError('Please enter a score for Written Examination.'); return; }
      if (val < 1 || val > PA_EXAM_MAX) { setPreAssessError(`Written Examination score must be between 1 and ${PA_EXAM_MAX}.`); return; }
    }
    setPreAssessError(null);
    setPreAssessConfirm(true);
  };


  const handleOpenEvalModal = async () => {
    setEvalSaveError(null);
    setEvalCriteria({ pre_assessment: [], interview: [] });
    setEvalSurvey('');
    setEvalConfirm(false);
    setIsEvalModalOpen(true);

    // load only surveys without existing criteria for the dropdown
    await loadSurveysWithoutCriteria();
  };

  const canSaveEval = evalSurvey && evalCriteria.pre_assessment.length > 0 && evalCriteria.interview.length > 0;

  // fetch criteria for selected survey
  useEffect(() => {
    if (!evalSurvey) return;
    const load = async () => {
      try {
        const data = await apiFetch(`applicants/surveys/${encodeURIComponent(evalSurvey)}/rating-criteria`, serverIp);
        const pre = Array.isArray(data.pre_assessment) ? data.pre_assessment : [];
        const inter = Array.isArray(data.interview) ? data.interview : [];
        setEvalCriteria({ pre_assessment: pre, interview: inter });
      } catch (err) {
        setEvalCriteria({ pre_assessment: [], interview: [] });
      }
    };
    load();
  }, [evalSurvey, serverIp]);

  // when the selected survey or criteria change, clear any prior confirmation flag
  // (no need to reference `evalConfirm` here, avoids eslint warning)
  useEffect(() => {
    setEvalConfirm(false);
  }, [evalSurvey, evalCriteria]);

  const handleSaveEvalCriteria = async (e) => {
    e.preventDefault();
    if (!evalSurvey) return;
    // first click just shows confirmation notice
    if (!evalConfirm) {
      setEvalConfirm(true);
      return;
    }

    setEvalSaving(true);
    setEvalSaveError(null);
    try {
      const payload = { rating_criteria: evalCriteria };
      await apiFetch(`applicants/surveys/${encodeURIComponent(evalSurvey)}/rating-criteria`, serverIp, { method: 'PUT', body: JSON.stringify(payload) });
      setIsEvalModalOpen(false);
      setSuccessMessage('Evaluation criteria saved.');
      // reload surveys without criteria so pre-assessment buttons update
      loadSurveysWithoutCriteria();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setEvalSaveError(err.message);
    } finally {
      setEvalSaving(false);
    }
  };

  const handleCancelEval = () => {
    setIsEvalModalOpen(false);
    setEvalConfirm(false);
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
          written_examination: preAssessAllowed.written_examination ? parseFloat(preAssessScores.written_examination) : null,
        }),
      });
      setPreAssessConfirm(false);
      setPreAssessApplicant(null);
      setTrainingRecords(null);
      setEmploymentRecords(null);
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

  const handleViewTrainingRecords = async () => {
    if (!preAssessApplicant) return;
    setTrainingRecordsLoading(true);
    setTrainingRecords([]);
    try {
      const params = new URLSearchParams({
        first_name: preAssessApplicant.first_name || '',
        last_name: preAssessApplicant.last_name || '',
      });
      const data = await apiFetch(`trainings/search?${params.toString()}`, serverIp);
      setTrainingRecords(data);
    } catch (err) {
      setTrainingRecords([]);
    } finally {
      setTrainingRecordsLoading(false);
    }
  };

  const handleViewEmploymentRecords = async () => {
    if (!preAssessApplicant) return;
    setEmploymentRecordsLoading(true);
    setEmploymentRecords([]);
    try {
      const params = new URLSearchParams({
        first_name: preAssessApplicant.first_name || '',
        last_name: preAssessApplicant.last_name || '',
      });
      const data = await apiFetch(`employments/search?${params.toString()}`, serverIp);
      setEmploymentRecords(data);
    } catch (err) {
      setEmploymentRecords([]);
    } finally {
      setEmploymentRecordsLoading(false);
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
          )}          {['Super_Admin', 'Admin', 'PACD'].includes(userRole) && (
            <button
              onClick={handleOpenEvalModal}
              className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-teal-600 rounded-lg shadow-md hover:bg-teal-700 transition-all"
            >
              Set Evaluation Criteria
            </button>
          )}          <button
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
                  <td className="px-5 py-4 text-gray-700 dark:text-gray-300 whitespace-normal break-words max-w-xs">{app.survey_name}</td>
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
                      {app.interview_status === 'Done Interview' ? (
                        <span className="font-medium text-teal-600 dark:text-teal-400 cursor-default" title="Interview completed">
                          Interviewed ✓
                        </span>
                      ) : (
                        <button 
                          onClick={() => handleAssignClick(app)} 
                          disabled={
                            // disable if already assigned & in progress/ transmitted
                            (app.interviewer && (app.interview_status === 'Ongoing Interview' || app.interview_status === 'Transmitted to Focal Person'))
                            // disable if no evaluation criteria exists for the survey
                            || (app.survey_name && noCriteriaSurveys.includes(app.survey_name))
                          }
                          className={`font-medium ${
                            (app.interviewer && (app.interview_status === 'Ongoing Interview' || app.interview_status === 'Transmitted to Focal Person'))
                              ? 'text-gray-400 cursor-not-allowed dark:text-gray-600'
                              : app.interviewer
                              ? 'text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300'
                              : 'text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300'}
                            ${app.survey_name && noCriteriaSurveys.includes(app.survey_name) ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={app.survey_name && noCriteriaSurveys.includes(app.survey_name) ? 'Survey has no evaluation criteria set' : undefined}
                        >
                          {app.interviewer ? 'Reassign' : 'Assign'}
                        </button>
                      )}
                      {(() => {
                        const pa = app.pre_assessment
                          ? (typeof app.pre_assessment === 'string' ? JSON.parse(app.pre_assessment) : app.pre_assessment)
                          : {};
                        const requiredFields = ['educational_attainment','relevant_training','relevant_work_experience','written_examination'];
                        const complete = requiredFields.every(f => {
                          if (f === 'written_examination') {
                            // treat null/undefined as OK (means exam not allowed);
                            // otherwise require non-empty value
                            return pa[f] === null || pa[f] === undefined || pa[f] !== '';
                          }
                          return pa[f] !== null && pa[f] !== undefined && pa[f] !== '';
                        });
                        if (complete) {
                          return (
                            <span className="font-medium text-green-600 dark:text-green-400 cursor-default" title="Pre-assessment already submitted">
                              Assessed ✓
                            </span>
                          );
                        }
                        return (
                          <>
                            {/* Pre-assessment disabled if survey has no evaluation criteria set */}
                            {(() => {
                              const disabled = app.survey_name && noCriteriaSurveys.includes(app.survey_name);
                              return (
                                <button
                                  onClick={() => handleOpenPreAssess(app)}
                                  disabled={disabled}
                                  className={`font-medium ${disabled
                                    ? 'text-gray-400 cursor-not-allowed dark:text-gray-600'
                                    : 'text-purple-600 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-300'}`}
                                  title={disabled ? 'Survey has no evaluation criteria set' : undefined}
                                >
                                  Pre-Assessment
                                </button>
                              );
                            })()}
                          </>
                        );
                      })()}
                      <button
                        onClick={() => handleDelete(app.id)}
                        disabled={app.interview_status === 'Ongoing Interview' || app.interview_status === 'Done Interview' || app.interview_status === 'Transmitted to Focal Person'}
                        className={`font-medium ${app.interview_status === 'Ongoing Interview' || app.interview_status === 'Done Interview' || app.interview_status === 'Transmitted to Focal Person'? 'text-gray-400 cursor-not-allowed dark:text-gray-600' : 'text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300'}`}
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
                <p className="mt-0.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {[preAssessApplicant.first_name, preAssessApplicant.middle_initial, preAssessApplicant.last_name, preAssessApplicant.suffix].filter(Boolean).join(' ')}
                </p>
                {preAssessApplicant.position && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium">Position:</span> {preAssessApplicant.position}
                  </p>
                )}
                {preAssessApplicant.survey_name && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium">Survey:</span> {preAssessApplicant.survey_name}
                  </p>
                )}
              </div>

              <form onSubmit={handlePreAssessSubmit} className="flex-1 overflow-y-auto">

                <div className="px-6 py-5 space-y-4">

                  {preAssessError && (
                    <div className="p-3 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-900/30 dark:text-red-400">{preAssessError}</div>
                  )}

                  {/* Fixed criteria */}
                  {PA_CRITERIA.map(c => {
                    const allowed = preAssessAllowed[c.key] ?? true;
                    return (
                    <div key={c.key} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className={`font-semibold text-sm ${allowed ? 'text-gray-800 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>{c.label}</p>
                          {c.key === 'educational_attainment' && preAssessApplicant.highest_grade_completed && (
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <span className="font-medium">Highest Grade Completed:</span> {preAssessApplicant.highest_grade_completed}
                            </p>
                          )}
                        </div>
                        <input
                          type={allowed ? 'number' : 'text'}
                          min={allowed ? 1 : undefined}
                          max={allowed ? 100 : undefined}
                          step={allowed ? '0.01' : undefined}
                          value={allowed ? preAssessScores[c.key] : 'N/A'}
                          onChange={e => {
                            if (!allowed) return;
                            let v = e.target.value;
                            if (v === '') return setPreAssessScores(prev => ({ ...prev, [c.key]: '' }));
                            let num = parseFloat(v);
                            if (!isNaN(num) && num >= 1 && num <= 100) {
                              setPreAssessScores(prev => ({ ...prev, [c.key]: v }));
                            }
                          }}
                          placeholder={allowed ? '1–100' : 'N/A'}
                          disabled={!allowed}
                          className={`w-28 px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-purple-500 ${!allowed ? 'opacity-50 cursor-not-allowed' : ''}`}
                        />
                      </div>
                      {c.key === 'relevant_training' && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={handleViewTrainingRecords}
                            disabled={trainingRecordsLoading || !allowed}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline disabled:opacity-50"
                          >
                            {trainingRecordsLoading ? 'Loading...' : 'View Training Record (HireTrack Database)'}
                          </button>
                        </div>
                      )}
                      {c.key === 'relevant_work_experience' && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={handleViewEmploymentRecords}
                            disabled={employmentRecordsLoading || !allowed}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline disabled:opacity-50"
                          >
                            {employmentRecordsLoading ? 'Loading...' : 'View Employment Record (HireTrack Database)'}
                          </button>
                        </div>
                      )}
                    </div>
                  )})}

                  {/* Written Examination */}
                  <div className="p-4 border rounded-lg border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-sm text-gray-800 dark:text-white">Written Examination</p>
                      </div>
                      <input
                        type="text"
                        value={preAssessScores.written_examination}
                        onChange={e => {
                          let v = e.target.value;
                          if (preAssessAllowed.written_examination === false) return;
                          if (v === '') return setPreAssessScores(prev => ({ ...prev, written_examination: '' }));
                          let num = parseFloat(v);
                          if (!isNaN(num) && num >= 1 && num <= 100) {
                            setPreAssessScores(prev => ({ ...prev, written_examination: v }));
                          }
                        }}
                        placeholder={preAssessAllowed.written_examination === false ? 'N/A' : '1–100'}
                        disabled={!preAssessAllowed.written_examination}
                        className="w-28 px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-purple-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                      />
                    </div>
                    {/* N/A option removed per updated requirements */}
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
                    <button type="button" onClick={() => { setPreAssessApplicant(null); setTrainingRecords(null); setEmploymentRecords(null); }} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Cancel</button>
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

      {/* Evaluation Criteria Modal */}
      {isEvalModalOpen && (() => {
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="flex flex-col w-full max-w-lg max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
              <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Set Evaluation Criteria</h2>
                {/* optional subtitle could go here, e.g. selected survey */}
                {evalSurvey && (
                  <p className="mt-0.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Survey: {evalSurvey}
                  </p>
                )}
              </div>
              <form onSubmit={handleSaveEvalCriteria} className="flex-1 overflow-y-auto">
                <div className="px-6 py-5 space-y-4">
                  {evalSaveError && (
                    <div className="p-3 text-sm text-red-700 bg-red-100 rounded-lg dark:bg-red-900/30 dark:text-red-400">{evalSaveError}</div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Survey Name</label>
                    {evalSurveyOptions.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">All surveys already have evaluation criteria.</p>
                    ) : (
                      <div className="relative mt-1">
                        <button
                          type="button"
                          onClick={() => setIsSurveyDropdownOpen(!isSurveyDropdownOpen)}
                          className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm min-h-[42px]"
                        >
                          <span className="block whitespace-normal break-words text-gray-900 dark:text-white">
                            {evalSurvey || "-- Select Survey --"}
                          </span>
                          <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                            <FaSort className="h-4 w-4 text-gray-400" aria-hidden="true" />
                          </span>
                        </button>
                        {isSurveyDropdownOpen && (
                          <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg mt-1 max-h-60 overflow-y-auto">
                            <div
                                onClick={() => { setEvalSurvey(""); setIsSurveyDropdownOpen(false); }}
                                className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600"
                            >
                                -- Select Survey --
                            </div>
                            {evalSurveyOptions.map((s) => (
                              <div
                                key={s}
                                onClick={() => { setEvalSurvey(s); setIsSurveyDropdownOpen(false); }}
                                className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-600 border-b border-gray-100 dark:border-gray-600 last:border-0"
                              >
                                <span className="block font-normal whitespace-normal break-words">{s}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {evalSurvey && (
                    <>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">Pre-Assessment Criteria</p>
                        <div className="mt-2 ml-4 space-y-1">
                          {PA_CRITERIA.concat({ key: 'written_examination', label: 'Written Examination' }).map(c => (
                            <label key={c.key} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={evalCriteria.pre_assessment.includes(c.key)}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setEvalCriteria(prev => {
                                    const arr = new Set(prev.pre_assessment);
                                    if (checked) arr.add(c.key);
                                    else arr.delete(c.key);
                                    return { ...prev, pre_assessment: Array.from(arr) };
                                  });
                                }}
                                className="form-checkbox h-4 w-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-800 dark:text-gray-200">{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                        <p className="font-semibold text-gray-800 dark:text-gray-200">Personal Interview Criteria</p>
                        <div className="mt-2 ml-4 space-y-1">
                          {INTERVIEW_CRITERIA.map(c => (
                            <label key={c.key} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={evalCriteria.interview.includes(c.key)}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setEvalCriteria(prev => {
                                    const arr = new Set(prev.interview);
                                    if (checked) arr.add(c.key); else arr.delete(c.key);
                                    return { ...prev, interview: Array.from(arr) };
                                  });
                                }}
                                className="form-checkbox h-4 w-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300">{c.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {evalConfirm ? (
                  <div className="flex-shrink-0 px-6 py-4 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-200 dark:border-amber-700">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">⚠ Once saved, this evaluation criteria cannot be edited.</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">Are you sure you want to save these criteria?</p>
                    <div className="flex justify-end gap-3">
                      <button type="button" onClick={() => setEvalConfirm(false)} disabled={evalSaving} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 disabled:opacity-50">Go Back</button>
                      <button type="submit" disabled={evalSaving} className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                        {evalSaving ? 'Saving...' : 'Confirm & Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-shrink-0 px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-2">
                    <button type="button" onClick={handleCancelEval} className="px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-600">Cancel</button>
                    <button type="submit" disabled={evalSaving || !canSaveEval} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{evalSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                )}
              </form>
            </div>
          </div>
        );
      })()}

      {/* Training Records Sub-Modal */}
      {trainingRecords !== null && (
        <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/70" style={{ zIndex: 60 }}>
          <div className="flex flex-col w-full max-w-2xl max-h-[80vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Training Records (HireTrack Database)</h3>
                {preAssessApplicant && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {[preAssessApplicant.first_name, preAssessApplicant.middle_initial, preAssessApplicant.last_name, preAssessApplicant.suffix].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setTrainingRecords(null)} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {trainingRecordsLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
              ) : trainingRecords.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">No training records found in HireTrack Database.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Training Title</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Start Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">End Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Hours</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Venue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingRecords.map(r => (
                      <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{r.training_title}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.start_date ? new Date(r.start_date).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.end_date ? new Date(r.end_date).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.hours}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.venue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex-shrink-0 flex justify-end px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <button type="button" onClick={() => setTrainingRecords(null)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Employment Records Sub-Modal */}
      {employmentRecords !== null && (
        <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/70" style={{ zIndex: 60 }}>
          <div className="flex flex-col w-full max-w-3xl max-h-[80vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Employment Records (HireTrack Database)</h3>
                {preAssessApplicant && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {[preAssessApplicant.first_name, preAssessApplicant.middle_initial, preAssessApplicant.last_name, preAssessApplicant.suffix].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setEmploymentRecords(null)} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {employmentRecordsLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
              ) : employmentRecords.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">No employment records found in HireTrack Database.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Position</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Survey</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Start Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">End Date</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Rating</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 uppercase text-xs">Focal Person</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employmentRecords.map(r => (
                      <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{r.position_title}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-normal break-words max-w-xs">{r.survey_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.contract_start_date || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.contract_end_date || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.rating || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.focal_person_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex-shrink-0 flex justify-end px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <button type="button" onClick={() => setEmploymentRecords(null)} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">Close</button>
            </div>
          </div>
        </div>
      )}

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