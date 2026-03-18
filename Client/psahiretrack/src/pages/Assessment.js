import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FaSync, FaComments, FaFilePdf, FaSort, FaRedo } from 'react-icons/fa';
import { FiX, FiSave } from 'react-icons/fi';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';
import { jsPDF } from 'jspdf';

const SCORE_KEYS = [
  { key: 'educational_attainment',   label: 'Educational Attainment',   short: 'Educ. Attain.' },
  { key: 'relevant_training',        label: 'Relevant Trainings',        short: 'Rel. Training' },
  { key: 'relevant_work_experience', label: 'Relevant Work Experience',  short: 'Rel. Work Exp.' },
  { key: 'written_examination',      label: 'Written Examination',       short: 'Written Exam' },
  { key: 'interview_average',        label: 'Personal Interview',        short: 'Interview' },
];

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

const SearchableDropdown = ({ options, value, onChange, placeholder, id, required, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);
  
    useClickOutside(dropdownRef, () => setIsOpen(false));
  
    const selectedOption = useMemo(() => {
      return options.find((option) => String(option.value) === String(value)) || null;
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
        <input id={id} type="text" className="mt-1 block w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700/50" value={displayValue} onChange={(e) => { if (disabled) return; setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true); }} onFocus={() => { if (disabled) return; setIsOpen(true); setSearchTerm(''); }} placeholder={placeholder} required={required && !value} disabled={disabled} />
        {isOpen && !disabled && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-300 bg-white shadow-lg dark:bg-gray-700">
            {filteredOptions.length > 0 ? (
              <ul className="max-h-60 overflow-y-auto">
                {filteredOptions.map((option) => (
                  <li key={option.value} className={`cursor-pointer px-4 py-2 text-gray-800 dark:text-gray-200 hover:bg-blue-500 hover:text-white whitespace-normal break-words ${ String(option.value) === String(value) ? 'bg-blue-100 dark:bg-blue-600' : '' }`} onClick={() => handleSelectOption(option)}>
                    {option.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-2 text-gray-500 dark:text-gray-400">No options found.</div>
            )}
          </div>
        )}
      </div>
    );
};

const parsePA = (app) => {
  if (!app || !app.pre_assessment) return {};
  try {
    const parsed = typeof app.pre_assessment === 'string'
      ? JSON.parse(app.pre_assessment)
      : app.pre_assessment;
    return parsed || {};
  } catch (err) {
    return {};
  }
};

const parseInterviewRating = (app) => {
  if (!app || !app.interview_rating) return {};
  try {
    const parsed = typeof app.interview_rating === 'string'
      ? JSON.parse(app.interview_rating)
      : app.interview_rating;
    return parsed || {};
  } catch (err) {
    return {};
  }
};

const parseWeightedScores = (app) => {
  if (!app || !app.weighted_scores) return {};
  try {
    const parsed = typeof app.weighted_scores === 'string'
      ? JSON.parse(app.weighted_scores)
      : app.weighted_scores;
    return parsed || {};
  } catch (err) {
    return {};
  }
};

// Helper function to parse survey positions JSON and get target count for a position
const getTargetHiringCount = (positionsJson, position) => {
  if (!positionsJson) return 0;
  try {
    const positions = typeof positionsJson === 'string' 
      ? JSON.parse(positionsJson) 
      : positionsJson;
    
    if (!Array.isArray(positions)) return 0;
    
    // Check if it's new format with objects
    const positionObj = positions.find(p => 
      (typeof p === 'object' && p.position === position)
    );
    
    if (positionObj && typeof positionObj === 'object') {
      return positionObj.applicants_count || 0;
    }
    
    // If no match found, return 0
    return 0;
  } catch (err) {
    return 0;
  }
};

// Helper function to check if a date is earlier than today
const isHiringEnded = (someDate) => {
  if (!someDate) return false;
  try {
    const d = new Date(someDate);
    const today = new Date();
    // Set time to midnight for accurate date comparison
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return d < today;
  } catch (err) {
    return false;
  }
};

const Assessment = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();
  const { toasts, showToast, removeToast } = useToast();

  const [applicants, setApplicants]     = useState([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [searchQuery, setSearchQuery]   = useState('');
  const [currentPage, setCurrentPage]   = useState(1);
  const rowsPerPage = 10;
  const [sortConfig, setSortConfig]     = useState({ key: 'last_name', direction: 'ascending' });
  const [filterSurvey, setFilterSurvey]   = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [isSurveyDropdownOpen, setIsSurveyDropdownOpen] = useState(false);
  const [isPositionDropdownOpen, setIsPositionDropdownOpen] = useState(false);
  const lastWarnedFiltersRef = useRef(null);
  const lastMixedWrittenExamRef = useRef(null);

  // Filter for applicants who have been transmitted to a focal person to populate dropdowns
  const transmittedApplicants = useMemo(() => {
    return applicants.filter(app => 
      app.focal_id != null && 
      ['Transmitted to Focal Person', 'Assessed', 'Synced Employees', 'Synced Trainings'].includes(app.interview_status)
    );
  }, [applicants]);

  // Dropdown options derived from fetched data
  const surveyOptions = useMemo(() => [...new Set(transmittedApplicants.map(a => a.survey_name).filter(Boolean))].sort(), [transmittedApplicants]);
  const positionOptions = useMemo(() => {
    if (!filterSurvey) return [...new Set(transmittedApplicants.map(a => a.position).filter(Boolean))].sort();
    return [...new Set(transmittedApplicants.filter(a => a.survey_name === filterSurvey).map(a => a.position).filter(Boolean))].sort();
  }, [transmittedApplicants, filterSurvey]);

  // Global percentage weights (one per score column, shared across all rows)
  const [weights, setWeights] = useState({
    educational_attainment:   '',
    relevant_training:        '',
    relevant_work_experience: '',
    written_examination:      '',
    interview_average:        '',
  });
  const [weightsSaved, setWeightsSaved] = useState(false); // Track if current weights are saved
  const [showWeightConfirmation, setShowWeightConfirmation] = useState(false); // Track if confirmation dialog is open

  // Per-row editable fields: { [id]: { status, remarks } }
  const [rowData, setRowData]   = useState({});

  // Remarks modal states
  const [editingRemarksId, setEditingRemarksId] = useState(null);
  const [editingRemarksText, setEditingRemarksText] = useState('');

  // Replace modal states
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replacingAppId, setReplacingAppId] = useState(null);
  const [selectedReplacementId, setSelectedReplacementId] = useState('');
  const [selectedReplacementName, setSelectedReplacementName] = useState('');
  const [replacementRemarks, setReplacementRemarks] = useState('');
  const [isReplacingId, setIsReplacingId] = useState(null);

  // Confirmation dialog for Generate Assessment Report
  const [showGenerateConfirmation, setShowGenerateConfirmation] = useState(false);

  // Assessment Report states
  const [userRole, setUserRole] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedAssistantFocalPerson, setSelectedAssistantFocalPerson] = useState('');

  // Hiring tracking states
  const [targetHiringCount, setTargetHiringCount] = useState(0);
  const [currentHiredCount, setCurrentHiredCount] = useState(0);
  const [hiringEnded, setHiringEnded] = useState(false);

  const isReadOnly = useMemo(() => ['Admin', 'PACD'].includes(userRole), [userRole]);

  useEffect(() => {
    const getSession = async () => {
        try {
            const state = await window.electronAPI.getLoginState();
            if (state?.user?.role) {
                setUserRole(state.user.role);
            }
        } catch (err) {
            showToast('Could not retrieve user session.', 'error');
        }
    };
    getSession();
  }, [showToast]);

  // Reset position filter when survey filter changes
  useEffect(() => {
    setFilterPosition('');
  }, [filterSurvey]);

  // ─── fetch ────────────────────────────────────────────────────────────────
  const fetchApplicants = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    try {
      const data = await apiFetch('applicants/for-assessment', serverIp);
      setApplicants(data);
      // Pre-fill rowData from dedicated assessment_remarks columns
      const initial = {};
      data.forEach(app => {
        initial[app.id] = {
          checked: app.assessment_remarks === 'Hired',
          remarks: app.assessment_remarks === 'Hired' ? '' : (app.assessment_remarks || ''),
        };
      });
      setRowData(initial);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [serverIp, showToast]);

  useEffect(() => {
    if (!isSettingsLoading) fetchApplicants();
  }, [isSettingsLoading, fetchApplicants]);

  // ─── fetch users for Assistant Focal Person dropdown ────────────────────
  const fetchUsers = useCallback(async () => {
    if (!serverIp) return;
    try {
      const data = await apiFetch('employments/focal-persons', serverIp);
      setUsers(data);
    } catch (err) {
      showToast('Failed to fetch users: ' + err.message, 'error');
    }
  }, [serverIp, showToast]);

  useEffect(() => {
    if (!isSettingsLoading) {
      fetchUsers();
    }
  }, [isSettingsLoading, fetchUsers]);

  // ─── load saved weights when survey/position filters change ────────────────
  useEffect(() => {
    const loadSavedWeights = async () => {
      if (filterSurvey === '' || filterPosition === '' || !serverIp) {
        setWeightsSaved(false);
        return;
      }
      try {
        const data = await apiFetch(`applicants/weights/${encodeURIComponent(filterSurvey)}/${encodeURIComponent(filterPosition)}`, serverIp);
        if (data) {
          // Weights were found, use them
          setWeights({
            educational_attainment:   data.educational_attainment || '',
            relevant_training:        data.relevant_training || '',
            relevant_work_experience: data.relevant_work_experience || '',
            written_examination:      data.written_examination || '',
            interview_average:        data.interview_average || '',
          });
          setWeightsSaved(true);
        } else {
          setWeightsSaved(false);
        }
        // If no saved weights (data is null), the default initialization effect will handle it
      } catch (err) {
        showToast('Error loading saved weights: ' + err.message, 'error');
        setWeightsSaved(false);
      }
    };
    loadSavedWeights();
  }, [filterSurvey, filterPosition, serverIp, showToast]);

  // Derived: Check if all filtered applicants have been transmitted to Focal
  const allTransmittedToFocal = useMemo(() => {
    const disabled = filterSurvey === '' || filterPosition === '';
    if (disabled) return false; // Do not allow if filters are not set
    const filtered = applicants.filter(app => {
      if (filterSurvey && app.survey_name !== filterSurvey) return false;
      if (filterPosition && app.position !== filterPosition) return false;
      return true;
    });
    // Check if all filtered applicants have been transmitted to Focal
    // This requires both focal_id to be set AND interview_status to be "Transmitted to Focal Person" or "Assessed"
    return filtered.length > 0 && filtered.every(app => 
      app.focal_id != null && app.focal_id !== '' && ['Transmitted to Focal Person', 'Assessed', 'Synced Employees', 'Synced Trainings'].includes(app.interview_status)
    );
  }, [filterSurvey, filterPosition, applicants]);

  const allAssessed = useMemo(() => {
    const disabled = filterSurvey === '' || filterPosition === '';
    if (disabled) return false;
    const filtered = applicants.filter(app => {
      if (filterSurvey && app.survey_name !== filterSurvey) return false;
      if (filterPosition && app.position !== filterPosition) return false;
      return true;
    });
    return filtered.length > 0 && filtered.every(app => ['Assessed', 'Synced Employees', 'Synced Trainings'].includes(app.interview_status));
  }, [filterSurvey, filterPosition, applicants]);

  // Applicants who are already transmitted to focal or already assessed
  const dropdownFiltered = useMemo(() => {
    return applicants.filter(app => {
      // Show applicants transmitted to focal or those already assessed
      if (app.focal_id == null || !['Transmitted to Focal Person', 'Assessed', 'Synced Employees', 'Synced Trainings'].includes(app.interview_status)) return false; 
      
      if (filterSurvey   && app.survey_name !== filterSurvey)   return false;
      if (filterPosition && app.position    !== filterPosition) return false;
      return true;
    });
  }, [applicants, filterSurvey, filterPosition]);

  // track weight NA status among filtered items
  const weightStatus = useMemo(() => {
    const status = {};
    SCORE_KEYS.forEach(({ key }) => {
      let hasNumber = false;
      let hasNA = false;
      dropdownFiltered.forEach(app => {
        const pa = parsePA(app);
        const val = pa[key];
        if (val === 'N/A' || val === null || val === undefined || val === '' || val === '--') {
          hasNA = true;
        } else {
          hasNumber = true;
        }
      });
      status[key] = { hasNumber, hasNA };
    });
    return status;
  }, [dropdownFiltered]);

  // Set initial/default weights when dropdowns change
  useEffect(() => {
    const disableWeights = (filterSurvey === '' || filterPosition === '' || !allTransmittedToFocal);
    setWeights(prev => {
      let changed = false;
      const updated = { ...prev };

      SCORE_KEYS.forEach(({ key }) => {
        const isNA = weightStatus[key]?.hasNA && !weightStatus[key]?.hasNumber;
        if (disableWeights || isNA) {
          if (updated[key] !== 0) {
            updated[key] = 0;
            changed = true;
          }
        } else {
          // Default all to 0 as requested: "autoadjust the default value of weighs must be zero regardless of status"
          if (!updated[key] || updated[key] === '') {
            updated[key] = 0;
            changed = true;
          }
        }
      });
      return changed ? updated : prev;
    });
  }, [filterSurvey, filterPosition, applicants, weightStatus, allTransmittedToFocal]);

  // Force weights to be disabled/zeroed when not all transmitted
  useEffect(() => {
    const disableWeights = (filterSurvey === '' || filterPosition === '' || !allTransmittedToFocal);
    if (disableWeights) {
      setWeights({
        educational_attainment:   0,
        relevant_training:        0,
        relevant_work_experience: 0,
        written_examination:      0,
        interview_average:        0,
      });
    }
  }, [filterSurvey, filterPosition, allTransmittedToFocal]);

  // ─── grand total ──────────────────────────────────────────────────────────
  const computeGrandTotal = useCallback((pa) => {
    if (!pa || !weights) return '0.00';
    let total = 0;
    SCORE_KEYS.forEach(({ key }) => {
      const raw = pa[key];
      if (raw === 'N/A' || raw === null || raw === undefined || raw === '') return;
      const score = parseFloat(raw);
      if (isNaN(score)) return;
      const w = parseFloat(weights[key]) || 0;
      total += (score * w) / 100;
    });
    return total.toFixed(2);
  }, [weights]);

  // ─── filter / sort / paginate ─────────────────────────────────────────────
  // Show transmission warning toast when not all applicants are transmitted
  useEffect(() => {
    const currentFilterKey = `${filterSurvey}|${filterPosition}`;
    
    if (filterSurvey !== '' && filterPosition !== '' && !allTransmittedToFocal) {
      // Only show toast if this is a new filter combination
      if (lastWarnedFiltersRef.current !== currentFilterKey) {
        showToast('Not all applicants under this survey and position have been transmitted to Focal.', 'warning');
        lastWarnedFiltersRef.current = currentFilterKey;
      }
    } else {
      // Clear warning ref if conditions change
      lastWarnedFiltersRef.current = null;
    }
  }, [filterSurvey, filterPosition, allTransmittedToFocal, showToast]);

  // Show toast error when mixed N/A in Written Exam
  useEffect(() => {
    const currentFilterKey = `${filterSurvey}|${filterPosition}`;
    
    if (filterSurvey !== '' && filterPosition !== '' && weightStatus.written_examination?.hasNumber && weightStatus.written_examination?.hasNA) {
      // Only show toast if this is a new filter combination
      if (lastMixedWrittenExamRef.current !== currentFilterKey) {
        showToast('Check the Written Exam scores for mixed number and N/A values.', 'error');
        lastMixedWrittenExamRef.current = currentFilterKey;
      }
    } else {
      // Clear error ref if conditions change
      lastMixedWrittenExamRef.current = null;
    }
  }, [filterSurvey, filterPosition, weightStatus, showToast]);

  // Check if grand_total exists in filtered applicants
  const hasGrandTotal = useMemo(() => {
    return dropdownFiltered.length > 0 && dropdownFiltered.some(app => app.grand_total != null && app.grand_total !== '');
  }, [dropdownFiltered]);

  // Auto-sort by grand_total (descending) if grand_total exists
  useEffect(() => {
    if (hasGrandTotal && sortConfig.key !== 'grand_total') {
      setSortConfig({ key: 'grand_total', direction: 'descending' });
    } else if (!hasGrandTotal && sortConfig.key === 'grand_total') {
      setSortConfig({ key: 'last_name', direction: 'ascending' });
    }
  }, [hasGrandTotal, sortConfig.key]);

  // Step 2: search only within dropdown-filtered results
  const filteredApplicants = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return dropdownFiltered;
    return dropdownFiltered.filter(app =>
      `${app.first_name || ''} ${app.middle_initial || ''} ${app.last_name || ''} ${app.suffix || ''}`
        .toLowerCase().includes(q)
    );
  }, [dropdownFiltered, searchQuery]);

  const sortedApplicants = useMemo(() => {
    const arr = [...filteredApplicants];
    if (sortConfig.key) {
      arr.sort((a, b) => {
        let av = a[sortConfig.key], bv = b[sortConfig.key];
        if (av == null) return 1;
        if (bv == null) return -1;
        
        // Handle numeric comparison for grand_total
        if (sortConfig.key === 'grand_total') {
          av = parseFloat(av) || 0;
          bv = parseFloat(bv) || 0;
        }
        
        if (av < bv) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (av > bv) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return arr;
  }, [filteredApplicants, sortConfig]);

  const totalPages  = Math.max(1, Math.ceil(sortedApplicants.length / rowsPerPage));
  const currentItems = sortedApplicants.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  // ─── save ─────────────────────────────────────────────────────────────────
  const handleReplace = (app) => {
    setReplacingAppId(app.id);
    setSelectedReplacementId('');
    setSelectedReplacementName('');
    setReplacementRemarks('');
    setShowReplaceModal(true);
  };

  const performReplacement = async () => {
    if (!selectedReplacementId || !replacementRemarks.trim() || !selectedReplacementName.trim()) {
      showToast('Both replacement applicant and remarks are required.', 'error');
      return;
    }

    setIsReplacingId(replacingAppId);
    try {
      // Ensure we properly handle number types since strictly comparing selectedReplacementId string to app.id (which might be number) using === fails
      const originalAppStrId = String(replacingAppId);
      const replacementAppStrId = String(selectedReplacementId);

      // We intentionally do NOT compute or send grand_total or assistant_id

      // Use the selectedReplacementName that was captured when the dropdown was changed
      // This ensures the replacement name is always captured correctly
      const finalReplacementName = selectedReplacementName.trim();

      // Update the original applicant: set remarks with REPLACED marker and replacement name
      await apiFetch(`applicants/${replacingAppId}/assessment`, serverIp, {
        method: 'PUT',
        body: JSON.stringify({
          assessment_remarks: `REPLACED: ${replacementRemarks} - Replaced by ${finalReplacementName}`,
        }),
      });

      // Update the replacement applicant: set remarks to "Hired" and save their calculated grand total
      await apiFetch(`applicants/${selectedReplacementId}/assessment`, serverIp, {
        method: 'PUT',
        body: JSON.stringify({
          assessment_remarks: 'Hired',
        }),
      });

      // Update local applicants state so grand totals and remarks are preserved before re-fetch
      setApplicants(prev => prev.map(app => {
        if (String(app.id) === originalAppStrId) {
          return { 
            ...app, 
            assessment_remarks: `REPLACED: ${replacementRemarks} - Replaced by ${finalReplacementName}` 
          };
        }
        if (String(app.id) === replacementAppStrId) {
          return { 
            ...app, 
            assessment_remarks: 'Hired',
          };
        }
        return app;
      }));

      // Update local row data
      setRowData(prev => ({
        ...prev,
        [replacingAppId]: { 
          ...prev[replacingAppId],
          checked: false, 
          remarks: `REPLACED: ${replacementRemarks} - Replaced by ${finalReplacementName}` 
        },
        [selectedReplacementId]: { 
          ...prev[selectedReplacementId],
          checked: true, 
          remarks: 'Hired' 
        },
      }));

      showToast(`Applicant replaced successfully.`, 'success');
      setTimeout(() => {
        fetchApplicants();
      }, 2000);
      
      setShowReplaceModal(false);
      setReplacingAppId(null);
      setSelectedReplacementId('');
      setSelectedReplacementName('');
      setReplacementRemarks('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsReplacingId(null);
    }
  };

  // ─── save weights ─────────────────────────────────────────────────────────
  const handleSaveWeights = () => {
    if (filterSurvey === '' || filterPosition === '') {
      showToast('Please select both survey and position', 'error');
      return;
    }
    if (totalWeight !== 100) {
      showToast('Weights must total exactly 100% to save.', 'error');
      return;
    }
    // Show confirmation dialog
    setShowWeightConfirmation(true);
  };

  // Perform the actual weight save
  const performSaveWeights = async () => {
    setShowWeightConfirmation(false);
    try {
      // Calculate grand totals for all filtered applicants
      const applicantTotals = dropdownFiltered
        .filter(app => app.survey_name === filterSurvey && app.position === filterPosition)
        .map(app => {
          const pa = parsePA(app);
          const gt = computeGrandTotal(pa);
          return {
            id: app.id,
            grand_total: parseFloat(gt),
          };
        });

      await apiFetch('applicants/weights', serverIp, {
        method: 'POST',
        body: JSON.stringify({
          survey_name: filterSurvey,
          position: filterPosition,
          educational_attainment:   parseFloat(weights.educational_attainment) || 0,
          relevant_training:        parseFloat(weights.relevant_training) || 0,
          relevant_work_experience: parseFloat(weights.relevant_work_experience) || 0,
          written_examination:      parseFloat(weights.written_examination) || 0,
          interview_average:        parseFloat(weights.interview_average) || 0,
          applicant_totals: applicantTotals,
        }),
      });
      setWeightsSaved(true);
      showToast('Weights and grand totals saved for this survey and position.', 'success');
      setTimeout(() => {
        fetchApplicants();
      }, 2000);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // ─── weight sum ───────────────────────────────────────────────────────────
  const totalWeight = SCORE_KEYS.reduce((s, { key }) => s + (parseFloat((weights && weights[key]) ?? 0) || 0), 0);

  // Check if PDF export is enabled (only needs survey and position selected)
  const canExportPDF = useMemo(() => {
    if (filterSurvey === '' || filterPosition === '') return false;
    return true;
  }, [filterSurvey, filterPosition]);

  // Calculate hired applicants count (excluding those marked as REPLACED) and update tracking
  useEffect(() => {
    if (filterSurvey === '' || filterPosition === '') {
      setCurrentHiredCount(0);
      setTargetHiringCount(0);
      setHiringEnded(false);
      return;
    }

    // Get first applicant's hiring end date and survey positions
    let hiringEndDate = null;
    let positionsJson = null;
    
    const filtered = dropdownFiltered.filter(app => 
      app.survey_name === filterSurvey && app.position === filterPosition
    );

    if (filtered.length > 0) {
      hiringEndDate = filtered[0].hiring_date;
      positionsJson = filtered[0].positions;
    }

    // Count hired applicants (excluding replaced ones)
    const hiredCount = filtered.filter(app => {
      return rowData[app.id]?.checked === true;
    }).length;

    // Get target hiring count from survey positions JSON
    const targetCount = getTargetHiringCount(positionsJson, filterPosition);

    // Check if hiring period has ended (using survey.hiring_date)
    const hasEnded = isHiringEnded(hiringEndDate);

    setCurrentHiredCount(hiredCount);
    setTargetHiringCount(targetCount);
    setHiringEnded(hasEnded);
  }, [filterSurvey, filterPosition, dropdownFiltered, rowData]);

  // Check if conditions are met to generate assessment report
  const canGenerateAssessmentReport = useMemo(() => {
    // For Admin/PACD, they can only generate if the report is already assessed.
    if (['Admin', 'PACD'].includes(userRole)) {
        return filterSurvey !== '' && filterPosition !== '' && allAssessed;
    }

    // Condition 1: Must be same as Pre-Assessment (survey and position selected)
    if (!canExportPDF) return false;
    
    // Condition 2: Weights must be saved
    if (!weightsSaved) return false;
  
    // Condition 3: All applicants must be transmitted to focal
    if (!allTransmittedToFocal) return false;
  
    // Condition 4: Number of applicants hired must be equal to the set applicants to be hired
    if (currentHiredCount !== targetHiringCount || targetHiringCount === 0) return false;
  
    return true;
  }, [userRole, filterSurvey, filterPosition, allAssessed, canExportPDF, weightsSaved, allTransmittedToFocal, currentHiredCount, targetHiringCount]);

  const currentFocalId = useMemo(() => {
    if (!filterSurvey) return null;
    const app = applicants.find(a => a.survey_name === filterSurvey && a.focal_id);
    return app ? app.focal_id : null;
  }, [filterSurvey, applicants]);

  const assistantFocalPersonOptions = useMemo(() => 
    users
      .filter(user => user.id !== currentFocalId)
      .map(user => {
        const name = [user.first_name, user.middle_initial, user.last_name, user.suffix].filter(Boolean).join(' ');
        return { value: user.id, label: name };
    }).sort((a, b) => a.label.localeCompare(b.label)),
  [users, currentFocalId]);

  const replacementApplicantOptions = useMemo(() => 
    applicants
        .filter(app => app.survey_name === filterSurvey && app.position === filterPosition && !rowData[app.id]?.checked && !rowData[app.id]?.remarks?.startsWith('REPLACED:') && app.id !== replacingAppId)
        .map(app => ({ value: app.id, label: [app.first_name, app.middle_initial, app.last_name].filter(part => part && part !== '?').join(' ') }))
        .sort((a, b) => a.label.localeCompare(b.label)),
  [applicants, filterSurvey, filterPosition, rowData, replacingAppId]);

  // Export to PDF
  const handleExportPDF = useCallback(async () => {
    // Check if all applicants for this survey and position are transmitted to focal
    const allApplicantsForSurveyPosition = applicants.filter(app => 
      app.survey_name === filterSurvey && app.position === filterPosition
    );
    const allTransmitted = allApplicantsForSurveyPosition.every(app => 
      app.focal_id != null && app.focal_id !== '' && app.interview_status === 'Transmitted to Focal Person'
    );
    if (!allTransmitted) {
      showToast('All applicants for this survey and position must be transmitted to focal person before generating the report.', 'error');
      return;
    }

    const filtered = sortedApplicants;

    if (filtered.length === 0) {
      showToast('No applicants to export.', 'error');
      return;
    }

    try {
      // Create landscape PDF with custom size (8.5x13 inches = 215.9x330.2mm)
      const pdf = new jsPDF('landscape', 'mm', [330.2, 215.9]);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;

      // Set Times New Roman font
      pdf.setFont('times');

      // Title
      const titleStartY = 12;
      pdf.setFontSize(14);
      const titleText = `Pre-Assessment Report - ${filterSurvey}`;
      const titleLines = pdf.splitTextToSize(titleText, pageWidth - 2 * margin);
      pdf.text(titleLines, margin, titleStartY);

      // Calculate Y position for the position text, accounting for wrapped title lines.
      const positionY = titleStartY + (titleLines.length * 7); // Approx. 5mm per 14pt line
      pdf.setFontSize(11);
      pdf.text(`Position: ${filterPosition}`, margin, positionY);

      // Prepare table data (without Survey and Position columns)
      const tableHeaders = [
        'Full Name',
        'Phone Number',
        `Educational Attainment\n(${weights.educational_attainment !== '' ? weights.educational_attainment + '%' : 'N/A'})`,
        `Relevant Trainings\n(${weights.relevant_training !== '' ? weights.relevant_training + '%' : 'N/A'})`,
        `Relevant Work Experience\n(${weights.relevant_work_experience !== '' ? weights.relevant_work_experience + '%' : 'N/A'})`,
        `Written Examination\n(${weights.written_examination !== '' ? weights.written_examination + '%' : 'N/A'})`,
        `Personal Interview\n(${weights.interview_average !== '' ? weights.interview_average + '%' : 'N/A'})`,
        'Total Rating\n(100%)',
        'Interviewer\'s Remarks'
      ];
      const tableData = filtered.map(app => {
        const weightedScores = parseWeightedScores(app);
        const interviewData = parseInterviewRating(app);
        const fullName = [app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ');
        const phone = app.phone_number || 'N/A';
        const ea = weightedScores.educational_attainment != null ? weightedScores.educational_attainment.toFixed(2) + '%' : 'N/A';
        const rt = weightedScores.relevant_training != null ? weightedScores.relevant_training.toFixed(2) + '%' : 'N/A';
        const rwe = weightedScores.relevant_work_experience != null ? weightedScores.relevant_work_experience.toFixed(2) + '%' : 'N/A';
        const we = weightedScores.written_examination != null ? weightedScores.written_examination.toFixed(2) + '%' : 'N/A';
        const pi = weightedScores.interview_average != null ? weightedScores.interview_average.toFixed(2) + '%' : 'N/A';
        const gt = app.grand_total ? parseFloat(app.grand_total).toFixed(2) + '%' : '0.00%';
        const remarks = interviewData.remarks || '';

        return [fullName, phone, ea, rt, rwe, we, pi, gt, remarks];
      });

      // Draw table manually
      const availableWidth = pageWidth - (2 * margin);
      // Use the same table layout proportions as the Final Assessment report
      const colWidths = [
        availableWidth * 0.1842, // Full Name
        availableWidth * 0.0921, // Phone Number
        availableWidth * 0.0921, // Educational Attainment
        availableWidth * 0.0921, // Relevant Trainings
        availableWidth * 0.0921, // Relevant Work Experience
        availableWidth * 0.0921, // Written Examination
        availableWidth * 0.0921, // Personal Interview
        availableWidth * 0.0921, // Grand Total
        availableWidth * 0.1711, // Interviewers Remarks
      ];
      const rowHeight = 5.5; // match final report
      const headerHeight = 11; // match final report
      let yPos = positionY + 2; // Start table below the position text with a small gap.
      let xPos = margin;

      // Draw header with dark gray background and white text
      pdf.setFontSize(9);
      pdf.setFont('times', 'bold');
      
      xPos = margin;
      tableHeaders.forEach((header, col) => {
        // Set fill and text colors for each header cell
        pdf.setFillColor(100, 100, 100); // Dark gray background
        pdf.setTextColor(255, 255, 255); // White text
        pdf.rect(xPos, yPos, colWidths[col], headerHeight, 'FD');
        
        // Split long header text into multiple lines (use same sizing as final report)
        const splitText = pdf.splitTextToSize(header, colWidths[col] - 2);
        const lineHeight = 3.2;
        const totalTextHeight = splitText.length * lineHeight;
        const startY = yPos + (headerHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);

        splitText.forEach((line, index) => {
          pdf.text(line, xPos + colWidths[col] / 2, startY + (index * lineHeight), { 
            maxWidth: colWidths[col] - 2,
            align: 'center',
            baseline: 'middle'
          });
        });
        
        xPos += colWidths[col];
      });

      yPos += headerHeight;
      pdf.setTextColor(0, 0, 0); // Reset text color to black for body

      // Draw rows (match final report font size)
      pdf.setFont('times', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(0, 0, 0);
      tableData.forEach((row, rowIndex) => {
        // Check if we need a new page (leave space for header + 3 rows minimum)
        if (yPos + rowHeight > pageHeight - 15) {
          pdf.addPage('landscape');
          yPos = margin + 5;
          
          // Redraw header on new page
          pdf.setFontSize(9);
          pdf.setFont('times', 'bold');
          
          xPos = margin;
          tableHeaders.forEach((header, col) => {
            // Set fill and text colors for each header cell
            pdf.setFillColor(100, 100, 100); // Dark gray background
            pdf.setTextColor(255, 255, 255); // White text
            pdf.rect(xPos, yPos, colWidths[col], headerHeight, 'FD');
            
            // Split long header text into multiple lines (match final report)
            const splitText = pdf.splitTextToSize(header, colWidths[col] - 2);
            const lineHeight = 3.2;
            const totalTextHeight = splitText.length * lineHeight;
            const startY = yPos + (headerHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);

            splitText.forEach((line, index) => {
              pdf.text(line, xPos + colWidths[col] / 2, startY + (index * lineHeight), {
                maxWidth: colWidths[col] - 2,
                align: 'center',
                baseline: 'middle'
              });
            });
            
            xPos += colWidths[col];
          });
          
          yPos += headerHeight;
          pdf.setFont('times', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(0, 0, 0);
        }

        // Alternate row colors
        if (rowIndex % 2 === 1) {
          pdf.setFillColor(240, 240, 240);
          xPos = margin;
          colWidths.forEach(width => {
            pdf.rect(xPos, yPos, width, rowHeight, 'F');
            xPos += width;
          });
        }

        // Draw row data with center alignment for numeric columns
        xPos = margin;
        let maxWrappedHeight = rowHeight;
        
        // Pre-calculate max height needed for wrapped text (checks all columns now)
        row.forEach((cell, col) => {
          const wrappedText = pdf.splitTextToSize(String(cell), colWidths[col] - 2);
          const wrappedHeight = (wrappedText.length * 3.5) + 2; // 3.5mm per line + 2mm padding (match final report)
          if (wrappedHeight > maxWrappedHeight) {
            maxWrappedHeight = wrappedHeight;
          }
        });
        
        const currentRowHeight = maxWrappedHeight;
        
        // Ensure the row fits on the current page, if not, add a new page
        if (yPos + currentRowHeight > pageHeight - 15) {
          pdf.addPage('landscape');
          yPos = margin + 5;
          
          // Redraw header on new page
          pdf.setFontSize(9);
          pdf.setFont('times', 'bold');
          
          xPos = margin;
          tableHeaders.forEach((header, col) => {
            pdf.setFillColor(100, 100, 100);
            pdf.setTextColor(255, 255, 255);
            pdf.rect(xPos, yPos, colWidths[col], headerHeight, 'FD');
            const splitText = pdf.splitTextToSize(header, colWidths[col] - 2);
            const lineHeight = 3.2;
            const totalTextHeight = splitText.length * lineHeight;
            const startY = yPos + (headerHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);
            splitText.forEach((line, index) => {
              pdf.text(line, xPos + colWidths[col] / 2, startY + (index * lineHeight), { 
                maxWidth: colWidths[col] - 2,
                align: 'center',
                baseline: 'middle'
              });
            });
            xPos += colWidths[col];
          });
          
          yPos += headerHeight;
          pdf.setFont('times', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(0, 0, 0);
        }

        row.forEach((cell, col) => {
          // Special styling for Grand Total column (index 7)
          if (col === 7) {
            pdf.setFillColor(255, 250, 205); // Light yellow background
            pdf.rect(xPos, yPos, colWidths[col], currentRowHeight, 'F');
            pdf.setFont('times', 'bold');
          }
          
          // Handle remarks column with text wrapping (index 8)
          if (col === 8) {
            const wrappedText = pdf.splitTextToSize(String(cell), colWidths[col] - 2);
            const lineHeight = 3.5; // mm per line used for body rows (match final report)
            const totalTextHeight = wrappedText.length * lineHeight;
            const startY = yPos + (currentRowHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);
            wrappedText.forEach((line, index) => {
              pdf.text(line, xPos + 1, startY + (index * lineHeight), { 
                maxWidth: colWidths[col] - 2,
                align: 'left',
                baseline: 'middle'
              });
            });
          } else {
            // Better vertical centering: handle wrapped text for all non-remarks columns
            const wrappedText = pdf.splitTextToSize(String(cell), colWidths[col] - 2);
            const lineHeight = 3.5; // mm per line used for body rows (match final report)
            const totalTextHeight = wrappedText.length * lineHeight;
            const startY = yPos + (currentRowHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);

            const isNumericCol = col >= 2;
            const align = isNumericCol ? 'center' : 'left';
            const startX = isNumericCol ? xPos + colWidths[col] / 2 : xPos + 1;

            wrappedText.forEach((line, idx) => {
              pdf.text(line, startX, startY + (idx * lineHeight), {
                maxWidth: colWidths[col] - 2,
                align: align,
                baseline: 'middle'
              });
            });
          }
          
          // Reset font for non-Grand Total columns
          if (col === 7) {
            pdf.setFont('times', 'normal');
          }
          
          pdf.rect(xPos, yPos, colWidths[col], currentRowHeight);
          xPos += colWidths[col];
        });

        yPos += currentRowHeight;
      });

      // Add page numbers
      const pageCount = pdf.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setFont('times', 'normal');
        pdf.text(
          `Page ${i} of ${pageCount}`,
          pageWidth / 2,
          pageHeight - 7,
          { align: 'center' },
        );
      }

      // Generate PDF blob and open with system default PDF reader
      const pdfBlob = pdf.output('blob');
      
      // Convert blob to base64 for Electron IPC
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const fileName = `${filterSurvey}_${filterPosition}_Assessment.pdf`;
        
        try {
          // Try to use Electron API to open with system default PDF reader
          if (window.electronAPI && window.electronAPI.savePDF) {
            await window.electronAPI.savePDF(base64Data, fileName);
            showToast('PDF exported and opened successfully.', 'success');
          } else {
            // Fallback: Use browser download
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const link = document.createElement('a');
            link.href = pdfUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('PDF exported successfully.', 'success');
          }
        } catch (err) {
          showToast('Error opening PDF: ' + err.message, 'error');
        }
      };
      reader.readAsDataURL(pdfBlob);
    } catch (err) {
      showToast('Error generating PDF: ' + err.message, 'error');
    }
  }, [filterSurvey, filterPosition, weights, applicants, showToast, sortedApplicants]);

  const generateAssessmentReportPDF = useCallback(async (assistantFocalPersonName) => {
    const filtered = dropdownFiltered
      .filter(app => app.survey_name === filterSurvey && app.position === filterPosition)
      .sort((a, b) => parseFloat(b.grand_total || 0) - parseFloat(a.grand_total || 0));

    if (filtered.length === 0) {
      showToast('No applicants to export.', 'error');
      return;
    }

    try {
      const pdf = new jsPDF('landscape', 'mm', [330.2, 215.9]);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;

      pdf.setFont('times');

      // ── Header with Logo and Title ──
      let yPos = 6;
      
      // Logo
      try {
        const logoImg = require('../assets/logo.png');
        pdf.addImage(logoImg, 'PNG', margin, yPos, 15, 15);
      } catch (err) {
        console.warn('Logo not found, continuing without it');
      }

      // Header Text (left-aligned next to logo)
      const headerX = margin + 17;
      pdf.setFontSize(11);
      pdf.setFont('times', 'normal');
      pdf.text('Republic of the Philippines', headerX, yPos + 5.5, { align: 'left' });
      pdf.text('PHILIPPINE STATISTICS AUTHORITY', headerX, yPos + 9.5, { align: 'left' });
      pdf.text('KALINGA', headerX, yPos + 13.5, { align: 'left' });

      yPos += 25;

      // ── Report Title ──
      const centerX = pageWidth / 2;
      pdf.setFontSize(12);
      pdf.setFont('times', 'bold');
      pdf.text('SUMMARY LIST OF APPLICANTS', centerX, yPos, { align: 'center' });

      yPos += 5;

      // ── Survey Name ──
      pdf.setFontSize(10);
      pdf.text(filterSurvey, centerX, yPos, { align: 'center' });

      yPos += 5;

      // ── Position ──
      pdf.setFontSize(9);
      pdf.setFont('times', 'normal');
      pdf.underline = true;
      pdf.text(`Position: ${filterPosition}`, margin, yPos);
      pdf.underline = false;

      yPos += 2;

      // ── Table Setup ──
      const availableWidth = pageWidth - (2 * margin);
      const colWidths = {
        name: availableWidth * 0.14,
        age: availableWidth * 0.07,
        sex: availableWidth * 0.07,
        address: availableWidth * 0.16,
        ea: availableWidth * 0.07,
        rt: availableWidth * 0.07,
        rwe: availableWidth * 0.07,
        we: availableWidth * 0.07,
        pi: availableWidth * 0.07,
        totalScore: availableWidth * 0.07,
        remarks: availableWidth * 0.13,
      };

      const headerHeight = 11;
      const rowHeight = 5.5;

      // ── Table Header ──
      pdf.setFontSize(9);
      pdf.setFont('times', 'bold');
      pdf.setFillColor(100, 100, 100);
      pdf.setTextColor(255, 255, 255);

      const headers = [
        { label: 'Name of Applicant', width: colWidths.name },
        { label: 'Age', width: colWidths.age },
        { label: 'Sex', width: colWidths.sex },
        { label: 'Present Address', width: colWidths.address },
        { label: `Educational Attainment\n(${weights.educational_attainment !== '' ? weights.educational_attainment + '%' : 'N/A'})`, width: colWidths.ea },
        { label: `Relevant Trainings\n(${weights.relevant_training !== '' ? weights.relevant_training + '%' : 'N/A'})`, width: colWidths.rt },
        { label: `Relevant Work Experience\n(${weights.relevant_work_experience !== '' ? weights.relevant_work_experience + '%' : 'N/A'})`, width: colWidths.rwe },
        { label: `Written Examination\n(${weights.written_examination !== '' ? weights.written_examination + '%' : 'N/A'})`, width: colWidths.we },
        { label: `Personal Interview\n(${weights.interview_average !== '' ? weights.interview_average + '%' : 'N/A'})`, width: colWidths.pi },
        { label: 'Total Rating\n(100%)', width: colWidths.totalScore },
        { label: 'Remarks', width: colWidths.remarks },
      ];

      let xPos = margin;
      pdf.setFontSize(9);
      pdf.setFont('times', 'bold');
      
      headers.forEach(header => {
        pdf.setFillColor(100, 100, 100);
        pdf.setTextColor(255, 255, 255);
        pdf.rect(xPos, yPos, header.width, headerHeight, 'FD');
        const splitText = pdf.splitTextToSize(header.label, header.width - 1);
        // Improved line height and vertical alignment for wrapped text
        const lineHeight = 3.2;
        const totalTextHeight = splitText.length * lineHeight;
        const startY = yPos + (headerHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);
        
        splitText.forEach((line, index) => {
          pdf.text(line, xPos + header.width / 2, startY + (index * lineHeight), {
            align: 'center',
            maxWidth: header.width - 1,
            baseline: 'middle'
          });
        });
        xPos += header.width;
      });

      yPos += headerHeight;
      pdf.setTextColor(0, 0, 0);
      pdf.setFont('times', 'normal');

      // ── Table Rows ──
      filtered.forEach((app, rowIndex) => {
        // Row data
        const weightedScores = parseWeightedScores(app);
        const fullName = [app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ');
        
        // Calculate age
        let age = '—';
        if (app.date_of_birth) {
          const dob = new Date(app.date_of_birth);
          const today = new Date();
          age = Math.floor((today - dob) / (365.25 * 24 * 60 * 60 * 1000));
        }

        const sex = app.sex || '—';
        const address = [app.barangay, app.city_municipality, 'Kalinga'].filter(Boolean).join(', ') || '—';
        
        const ea = weightedScores.educational_attainment != null ? weightedScores.educational_attainment.toFixed(2) + '%' : 'N/A';
        const rt = weightedScores.relevant_training != null ? weightedScores.relevant_training.toFixed(2) + '%' : 'N/A';
        const rwe = weightedScores.relevant_work_experience != null ? weightedScores.relevant_work_experience.toFixed(2) + '%' : 'N/A';
        const we = weightedScores.written_examination != null ? weightedScores.written_examination.toFixed(2) + '%' : 'N/A';
        const pi = weightedScores.interview_average != null ? weightedScores.interview_average.toFixed(2) + '%' : 'N/A';
        const totalScore = app.grand_total ? parseFloat(app.grand_total).toFixed(2) + '%' : '0.00%';
        
        const remarks = rowData[app.id]?.remarks || app.assessment_remarks || '';

        const pdfRowData = [
          { text: fullName, align: 'left' },
          { text: String(age), align: 'center' },
          { text: sex, align: 'center' },
          { text: address, align: 'left' },
          { text: ea, align: 'center' },
          { text: rt, align: 'center' },
          { text: rwe, align: 'center' },
          { text: we, align: 'center' },
          { text: pi, align: 'center' },
          { text: totalScore, align: 'center' },
          { text: remarks, align: 'left' },
        ];

        // Pre-calculate max height needed for wrapped text in this row
        let maxRowHeight = rowHeight;
        pdfRowData.forEach((cell, colIndex) => {
          const colWidth = headers[colIndex].width;
          const wrappedText = pdf.splitTextToSize(cell.text, colWidth - 2);
          const wrappedHeight = (wrappedText.length * 3.5) + 2; // ~3.5mm per line for 9pt font
          if (wrappedHeight > maxRowHeight) {
            maxRowHeight = wrappedHeight;
          }
        });

        const currentRowHeight = maxRowHeight;

        // Check if need new page based on calculated height
        if (yPos + currentRowHeight > pageHeight - 35) { // Leave space for signatories
          pdf.addPage('landscape');
          yPos = margin;

          // Redraw header on new page
          pdf.setFontSize(9);
          pdf.setFont('times', 'bold');

          xPos = margin;
          headers.forEach(header => {
            pdf.setFillColor(100, 100, 100);
            pdf.setTextColor(255, 255, 255);
            pdf.rect(xPos, yPos, header.width, headerHeight, 'FD');
            const splitText = pdf.splitTextToSize(header.label, header.width - 1);
            const lineHeight = 3.2;
            const totalTextHeight = splitText.length * lineHeight;
            const startY = yPos + (headerHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);
            splitText.forEach((line, index) => {
              pdf.text(line, xPos + header.width / 2, startY + (index * lineHeight), {
                align: 'center',
                maxWidth: header.width - 1,
                baseline: 'middle'
              });
            });
            xPos += header.width;
          });

          yPos += headerHeight;
          pdf.setTextColor(0, 0, 0);
          pdf.setFont('times', 'normal');
        }

        // Alternate row colors
        if (rowIndex % 2 === 1) {
          pdf.setFillColor(240, 240, 240);
          xPos = margin;
          let totalTableWidth = 0;
          headers.forEach(header => {
            totalTableWidth += header.width;
          });
          pdf.rect(xPos, yPos, totalTableWidth, currentRowHeight, 'F');
        }

        xPos = margin;
        pdf.setFontSize(9);
        pdfRowData.forEach((cell, colIndex) => {
          const colWidth = headers[colIndex].width;

          // Better vertical centering: split text into wrapped lines and center the block
          const wrappedText = pdf.splitTextToSize(cell.text, colWidth - 2);
          const lineHeight = 3.5; // mm per line for body rows
          const totalTextHeight = wrappedText.length * lineHeight;
          const startY = yPos + (currentRowHeight / 2) - (totalTextHeight / 2) + (lineHeight / 2);

          wrappedText.forEach((line, index) => {
            let textX;
            if (cell.align === 'left') {
              textX = xPos + 1; // Left padding
            } else {
              textX = xPos + colWidth / 2; // Center
            }
            pdf.text(line, textX, startY + (index * lineHeight), {
              align: cell.align,
              maxWidth: colWidth - 2,
              baseline: 'middle'
            });
          });

          pdf.rect(xPos, yPos, colWidth, currentRowHeight);
          xPos += colWidth;
        });

        yPos += currentRowHeight;
      });

      // ── Signatories ──
      yPos += 15;

      const signatoryY = yPos;
      const sigWidth = 70;
      const sigSpacing = (pageWidth - (3 * sigWidth)) / 4;

      pdf.setFontSize(10);
      pdf.setFont('times', 'normal');

      // Get focal person name from focal_id by looking up in users array
      let focalPersonName = 'Focal Person';
      if (filtered.length > 0 && filtered[0].focal_id) {
        const focalUser = users.find(u => u.id === filtered[0].focal_id);
        if (focalUser) {
          focalPersonName = [focalUser.first_name, focalUser.middle_initial, focalUser.last_name, focalUser.suffix].filter(Boolean).join(' ');
        }
      }
      
      // Signatory 1: Focal Person
      let sigX = sigSpacing + sigWidth / 2;
      pdf.text('________________________________', sigX, signatoryY + 8, { align: 'center' });
      pdf.setFont('times', 'bold');
      pdf.text(focalPersonName.toUpperCase(), sigX, signatoryY + 12, { align: 'center', maxWidth: sigWidth - 2 });
      pdf.setFont('times', 'normal');
      pdf.text('Focal Person', sigX, signatoryY + 16, { align: 'center', maxWidth: sigWidth - 2 });

      // Signatory 2: Assistant Focal Person
      sigX += sigSpacing + sigWidth;
      pdf.text('________________________________', sigX, signatoryY + 8, { align: 'center' });
      pdf.setFont('times', 'bold');
      pdf.text(assistantFocalPersonName.toUpperCase(), sigX, signatoryY + 12, { align: 'center', maxWidth: sigWidth - 2 });
      pdf.setFont('times', 'normal');
      pdf.text('Assistant Focal Person', sigX, signatoryY + 16, { align: 'center', maxWidth: sigWidth - 2 });

      // Signatory 3: Chief Statistical Specialist
      sigX += sigSpacing + sigWidth;
      pdf.text('________________________________', sigX, signatoryY + 8, { align: 'center' });
      pdf.setFont('times', 'bold');
      pdf.text('MARIBEL M. DALAYDAY', sigX, signatoryY + 12, { align: 'center', maxWidth: sigWidth - 2 });
      pdf.setFont('times', 'normal');
      pdf.text('Chief Statistical Specialist', sigX, signatoryY + 16, { align: 'center', maxWidth: sigWidth - 2 });

      // Add page numbers
      const pageCount = pdf.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.setFont('times', 'normal');
        pdf.text(
          `Page ${i} of ${pageCount}`,
          pageWidth / 2,
          pageHeight - 7,
          { align: 'center' },
        );
      }

      // Generate and save PDF
      const pdfBlob = pdf.output('blob');
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const fileName = `${filterSurvey}_${filterPosition}_Assessment_Report.pdf`;

        try {
          if (window.electronAPI && window.electronAPI.savePDF) {
            await window.electronAPI.savePDF(base64Data, fileName, 'Assessment Report');
            showToast('Assessment Report generated and opened successfully.', 'success');
          } else {
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const link = document.createElement('a');
            link.href = pdfUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Assessment Report generated successfully.', 'success');
          }
        } catch (err) {
          showToast('Error opening PDF: ' + err.message, 'error');
        }
      };
      reader.readAsDataURL(pdfBlob);
    } catch (err) {
      showToast('Error generating Assessment Report: ' + err.message, 'error');
    }
  }, [filterSurvey, filterPosition, dropdownFiltered, weights, users, rowData, showToast]);

  // ─── Handle Generate Assessment Report (shows modal) ─────────────────────────────────────────────
  const handleGenerateAssessmentReport = useCallback(async () => {
    if (!filterSurvey || !filterPosition) {
      showToast('Please select survey and position', 'error');
      return;
    }

    // Auto-populate logic
    const filtered = dropdownFiltered.filter(app => app.survey_name === filterSurvey && app.position === filterPosition);
    const existingAssistant = filtered.find(app => app.assistant_id);
    if (existingAssistant && existingAssistant.assistant_id) {
        setSelectedAssistantFocalPerson(existingAssistant.assistant_id);
    } else {
        setSelectedAssistantFocalPerson('');
    }

    // Show confirmation dialog first
    setShowGenerateConfirmation(true);
  }, [filterSurvey, filterPosition, showToast, dropdownFiltered]);

  const performGenerateAssessmentReport = useCallback(async (assistantFocalPersonId) => {
    setShowGenerateConfirmation(false);

    const assistantUser = users.find(u => u.id === assistantFocalPersonId);
    const assistantFocalPersonName = assistantUser 
        ? [assistantUser.first_name, assistantUser.middle_initial, assistantUser.last_name, assistantUser.suffix].filter(Boolean).join(' ') 
        : '';

    // If user is Admin or PACD, skip saving and just generate the report.
    if (['Admin', 'PACD'].includes(userRole)) {
        generateAssessmentReportPDF(assistantFocalPersonName);
        showToast('Assessment Report generated.', 'success');
        return;
    }

    // Save all status and remarks before generating report
    const filtered = dropdownFiltered.filter(app => app.survey_name === filterSurvey && app.position === filterPosition);
    try {
      for (const app of filtered) {
        const rd = rowData[app.id] || {};
        
        // Ensure 'Hired' status is preserved if checked, otherwise use remarks
        const remarksToSave = rd.checked ? 'Hired' : (rd.remarks || '');
        
        // Save assessment data (only remarks and assistant assignment). Do NOT save grand_total here.
        await apiFetch(`applicants/${app.id}/assessment`, serverIp, {
          method: 'PUT',
          body: JSON.stringify({
            assessment_remarks: remarksToSave,
            assistant_id:       assistantFocalPersonId || null
          }),
        });

        // Set interview_status to "Assessed" only if they haven't proceeded to syncing yet
        if (app.interview_status === 'Transmitted to Focal Person') {
          await apiFetch(`applicants/${app.id}/interview-status`, serverIp, {
            method: 'PUT',
            body: JSON.stringify({
              interview_status: 'Assessed',
            }),
          });
        }
      }
    } catch (err) {
      showToast('Error saving assessment data: ' + err.message, 'error');
      return;
    }

    // Generate the assessment report PDF
    generateAssessmentReportPDF(assistantFocalPersonName);

    // Refresh the table after report generation
    fetchApplicants();
  }, [filterSurvey, filterPosition, dropdownFiltered, rowData, showToast, serverIp, generateAssessmentReportPDF, fetchApplicants, users, userRole]);

  if (isLoading || isSettingsLoading) {
    return <div className="p-8 text-gray-500 dark:text-gray-400">Loading Assessment Records...</div>;
  }

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div>
      <ToastContainer toasts={toasts} onClose={removeToast} />

      {/* Page header */}
      <div className="flex flex-col gap-3 mb-4">
        {/* Title, Search bar, Hiring Progress, and Contract Status row */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Applicants' Evaluation</h1>
          <div className="flex items-center gap-6">
            {/* Hiring Progress */}
            {filterSurvey !== '' && filterPosition !== '' && (
              <>
                <div className="text-right">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400">Target Hires</h3>
                  <p className={`text-sm font-semibold ${currentHiredCount === targetHiringCount && targetHiringCount > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                    {currentHiredCount} of {targetHiringCount}
                  </p>
                </div>
                <div className="h-8 w-px bg-gray-300 dark:bg-gray-600"></div>
                {/* Hiring Status */}
                <div className="text-right">
                  <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400">Hiring Status</h3>
                  <p className={`text-sm font-semibold ${hiringEnded ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {hiringEnded ? 'Ended' : 'Ongoing'}
                  </p>
                </div>
              </>
            )}
            <input
              type="text"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Search name..."
              className="w-52 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
        
        {/* Controls row */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          {/* Left controls */}
          <div className="flex items-center gap-3">
            {/* Survey/Census filter */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setIsSurveyDropdownOpen(!isSurveyDropdownOpen); setIsPositionDropdownOpen(false); }}
                className="w-96 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <span className="block whitespace-normal break-words text-gray-900 dark:text-white">
                  {filterSurvey || "Select Survey"}
                </span>
                <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <FaSort className="h-4 w-4 text-gray-400" aria-hidden="true" />
                </span>
              </button>
              {isSurveyDropdownOpen && (
                <div className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-lg absolute top-full mt-1 max-h-60 overflow-y-auto z-10">
                  <div
                      onClick={() => { setFilterSurvey(""); setIsSurveyDropdownOpen(false); setCurrentPage(1); }}
                      className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-700"
                  >
                      -- Clear Selection --
                  </div>
                  {surveyOptions.map((s) => (
                    <div
                      key={s}
                      onClick={() => { setFilterSurvey(s); setIsSurveyDropdownOpen(false); setCurrentPage(1); }}
                      className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      <span className="block font-normal whitespace-normal break-words">{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Position filter */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { setIsPositionDropdownOpen(!isPositionDropdownOpen); setIsSurveyDropdownOpen(false); }}
                className="w-64 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-sm pl-3 pr-10 py-2 text-left cursor-default focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              >
                <span className="block whitespace-normal break-words text-gray-900 dark:text-white">
                  {filterPosition || "Select Position"}
                </span>
                <span className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <FaSort className="h-4 w-4 text-gray-400" aria-hidden="true" />
                </span>
              </button>
              {isPositionDropdownOpen && (
                <div className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-lg absolute top-full mt-1 max-h-60 overflow-y-auto z-10">
                  <div
                      onClick={() => { setFilterPosition(""); setIsPositionDropdownOpen(false); setCurrentPage(1); }}
                      className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-700"
                  >
                      -- Clear Selection --
                  </div>
                  {positionOptions.map((p) => (
                    <div
                      key={p}
                      onClick={() => { setFilterPosition(p); setIsPositionDropdownOpen(false); setCurrentPage(1); }}
                      className="cursor-pointer select-none relative py-2 pl-3 pr-4 text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-700 last:border-0"
                    >
                      <span className="block font-normal whitespace-normal break-words">{p}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={fetchApplicants}
              disabled={isLoading}
              title={isLoading ? 'Refreshing assessment data...' : 'Refresh assessment data'}
              className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <FaSync className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3 flex-wrap">
            {!isReadOnly && (
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleSaveWeights}
                  disabled={filterSurvey === '' || filterPosition === '' || weightsSaved || !allTransmittedToFocal || !hiringEnded}
                  title={
                    filterSurvey === '' || filterPosition === '' ? 'Select both survey and position' 
                    : !allTransmittedToFocal ? 'All applicants must be transmitted to focal person'
                    : !hiringEnded ? 'Hiring is still ongoing'
                    : weightsSaved ? 'Weights already saved for this survey and position'
                    : 'Save current weights for this survey and position'
                  }
                  className="px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-700 dark:hover:bg-blue-600"
                >
                  Save Weights
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={!canExportPDF || !allTransmittedToFocal || !weightsSaved || allAssessed || !hiringEnded}
                  title={
                    filterSurvey === '' || filterPosition === '' ? 'Select both survey and position'
                    : !weightsSaved ? 'Save weights first before generating pre-assessment report'
                    : !allTransmittedToFocal ? 'All applicants must be Transmitted to Focal or Assessed'
                    : !hiringEnded ? 'Hiring is still ongoing'
                    : allAssessed ? 'Pre-Assessment Report is unavailable after Final Assessment generation'
                    : 'Export assessment data to PDF'
                  }
                  className="px-3 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-700 dark:hover:bg-red-600 flex items-center gap-2"
                >
                  <FaFilePdf className="w-4 h-4" /> Pre-Assessment Report
                </button>
              </div>
            )}
              <button
                onClick={handleGenerateAssessmentReport}
                disabled={!canGenerateAssessmentReport}
                title={
                  !canExportPDF 
                    ? 'Select both survey and position' 
                    : !allTransmittedToFocal
                      ? 'All applicants must be Transmitted to Focal or Assessed'
                      :isReadOnly
                        ? 'Ask the focal to provide assessment first'
                        : !weightsSaved
                          ? 'Save weights first before generating report'
                          : targetHiringCount === 0 
                            ? `Target hiring count not set for: ${filterPosition}`
                            : currentHiredCount !== targetHiringCount 
                              ? `Hired applicants (${currentHiredCount}) must equal target (${targetHiringCount})`
                              : 'Generate Final Assessment Report'
                }
                className="px-3 py-2 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-green-700 dark:hover:bg-green-600 flex items-center gap-2"
              >
                <FaFilePdf className="w-4 h-4" /> Final Assessment Report
              </button>
            </div>
        </div>
      </div>



      {/* Weight Confirmation Dialog */}
      {showWeightConfirmation && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black bg-opacity-50 dark:bg-opacity-70">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Confirm Weight Save</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              You are about to save the weights for <strong>{filterSurvey}</strong> / <strong>{filterPosition}</strong>.
            </p>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                <strong>⚠️ Important:</strong> Once saved, these weights <strong className="underline">CANNOT be edited</strong>. You will only be able to view them. Are you sure you want to proceed?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowWeightConfirmation(false)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                <FiX className="w-4 h-4" />Cancel
              </button>
              <button
                onClick={performSaveWeights}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                <FiSave className="w-4 h-4" />Save & Lock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Assessment Confirmation */}
      {showGenerateConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[999]">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Confirm Generate Assessment Report</h2>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                <strong>⚠️ Important:</strong> Once you proceed, status and remarks <strong className="underline">CANNOT be edited</strong>. All current data will be locked. Are you sure you want to continue?
              </p>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Select Assistant Focal Person <span className="text-red-600">*</span>
              </label>
              <SearchableDropdown
                id="assistant-focal-person-select"
                options={assistantFocalPersonOptions}
                value={selectedAssistantFocalPerson}
                onChange={setSelectedAssistantFocalPerson}
                placeholder="Search or Select Assistant Focal Person"
                required
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowGenerateConfirmation(false);
                  setSelectedAssistantFocalPerson('');
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                <FiX className="w-4 h-4" />Cancel
              </button>
              <button
                onClick={() => {
                  if (selectedAssistantFocalPerson) {
                    performGenerateAssessmentReport(selectedAssistantFocalPerson); // Now passing ID
                    setSelectedAssistantFocalPerson('');
                  }
                }}
                disabled={!selectedAssistantFocalPerson}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-green-700 dark:hover:bg-green-600"
              >
                <FaFilePdf className="w-4 h-4" />Generate Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remarks Edit Modal */}
      {editingRemarksId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[999]">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Edit Remarks</h2>
            <textarea
              value={editingRemarksText}
              onChange={e => setEditingRemarksText(e.target.value)}
              placeholder="Enter your remarks here..."
              className="w-full h-48 px-4 py-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setEditingRemarksId(null)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                <FiX className="w-4 h-4" />Cancel
              </button>
              <button
                onClick={() => {
                  setRowData(prev => ({
                    ...prev,
                    [editingRemarksId]: { ...prev[editingRemarksId], remarks: editingRemarksText },
                  }));
                  setEditingRemarksId(null);
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
              >
                <FiSave className="w-4 h-4" />Save Remarks
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Modal */}
      {showReplaceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[999]">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Replace Hired Applicant</h2>
            
            {/* Replacement Applicant Dropdown */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Select Replacement Applicant <span className="text-red-600">*</span>
              </label>
              <SearchableDropdown
                  id="replacement-applicant-select"
                  options={replacementApplicantOptions}
                  value={selectedReplacementId}
                  onChange={(value) => {
                  setSelectedReplacementId(value);
                  // Capture the selected applicant's name when the dropdown changes
                  const selectedApp = applicants.find(a => String(a.id) === String(value));
                  if (selectedApp) {
                    const name = [selectedApp.first_name, selectedApp.middle_initial, selectedApp.last_name].filter(part => part && part !== '?').join(' ');
                    setSelectedReplacementName(name);
                  } else {
                    setSelectedReplacementName('');
                  }
                }}
                  placeholder="Search or Select an Applicant"
                  required
              />
            </div>

            {/* Remarks Field */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Remarks <span className="text-red-600">*</span>
              </label>
              <textarea
                value={replacementRemarks}
                onChange={e => setReplacementRemarks(e.target.value)}
                placeholder="Enter remarks for the replacement..."
                className="w-full h-40 px-4 py-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowReplaceModal(false);
                  setReplacingAppId(null);
                  setSelectedReplacementId('');
                  setSelectedReplacementName('');
                  setReplacementRemarks('');
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                <FiX className="w-4 h-4" />Cancel
              </button>
              <button
                onClick={performReplacement}
                disabled={!selectedReplacementId || !replacementRemarks.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-orange-700 dark:hover:bg-orange-600"
                title={!selectedReplacementId || !replacementRemarks.trim() ? 'Select assessment and add remarks' : 'Replace assessment data'}
              >
                <FaRedo className="w-4 h-4" />Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Show table only if both Survey and Position are selected */}
      {filterSurvey === '' || filterPosition === '' ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-lg shadow dark:bg-gray-800">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">Select Survey and Position</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-4">Please select both <strong>Survey Name</strong> and <strong>Position</strong> from the dropdowns above to view assessment records.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto bg-white rounded-lg shadow dark:bg-gray-800">
            <table className="min-w-full text-sm leading-normal table-fixed">
          <thead>
            {/* ── Row 1: Column headers ── */}
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              {/* Fixed columns span both header rows */}
              <th rowSpan={2} className="px-8 py-3 text-left align-bottom border-r border-gray-200 dark:border-gray-700 min-w-[220px] max-w-[320px]">
                <span className="font-semibold uppercase text-xs whitespace-nowrap">Name of Applicant</span>
              </th>
              {/* Score criteria labels — weight inputs go in row 2 below */}
              {SCORE_KEYS.map(({ key, label, short }) => (
                <th key={key} className="px-2 py-2 text-center border-b border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 min-w-[60px] max-w-[80px]" title={label}>
                  <span className="font-semibold uppercase text-xs block leading-tight">{short}</span>
                </th>
              ))}
              {/* Grand Total — label on top, weight total below */}
              <th className="px-4 py-2 text-center border-b border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 border-l border-gray-200 dark:border-gray-700">
                <span className="font-semibold uppercase text-xs block leading-tight">Grand Total</span>
              </th>
              <th rowSpan={2} className="px-4 py-3 text-center align-bottom border-l border-gray-200 dark:border-gray-700 min-w-[80px]">
                <span className="font-semibold uppercase text-xs whitespace-nowrap">Status</span>
              </th>
              <th rowSpan={2} className="px-4 py-3 text-left align-bottom">
                <span className="font-semibold uppercase text-xs">Remarks</span>
              </th>
              <th rowSpan={2} className="px-4 py-3 text-center align-bottom">
                <span className="font-semibold uppercase text-xs">Action</span>
              </th>
            </tr>

            {/* ── Row 2: Weight % inputs (only under score + grand total columns) ── */}
            <tr className="border-b-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20">
              {SCORE_KEYS.map(({ key }) => {
                const disableWeights = (filterSurvey === '' || filterPosition === '' || !allTransmittedToFocal);
                const isNA = weightStatus[key]?.hasNA && !weightStatus[key]?.hasNumber;
                const hasMixed = weightStatus[key]?.hasNumber && weightStatus[key]?.hasNA;
                
                return (
                  <td key={key} className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-none">wt.%</span>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={isNA ? '0' : (weights && weights[key] != null ? weights[key] : '')}
                        onChange={e => {
                          if (disableWeights || isReadOnly) return;
                          const value = e.target.value;
                          // Allow empty string, or a 1-2 digit number.
                          if (value === '' || /^\d{1,2}$/.test(value)) {
                            setWeights(prev => ({ ...prev, [key]: value }));
                            setWeightsSaved(false);
                          }
                        }}
                        disabled={disableWeights || hasMixed || isNA || weightsSaved || isReadOnly}
                        className="w-14 px-1 py-1 text-xs text-center border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                      />
                    </div>
                  </td>
                );
              })}
              <td className="px-4 py-2 text-center text-xs font-bold border-l border-gray-200 dark:border-gray-700">
                <span className={totalWeight === 100 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                  Total: {totalWeight}%
                </span>
              </td>
            </tr>
          </thead>

          <tbody>
            {currentItems.length > 0 ? (
              currentItems.map(app => {
                const pa = parsePA(app);
                const gt = computeGrandTotal(pa);

                return (
                  <tr key={app.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    {/* Name */}
                    <td className="px-8 py-3 font-medium text-gray-900 dark:text-white break-words min-w-[220px] max-w-[320px]">
                      {[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}
                    </td>

                    {/* Score columns (narrow) */}
                    {SCORE_KEYS.map(({ key }) => {
                      const weightedScores = parseWeightedScores(app);
                      const weightedValue = weightedScores[key];
                      
                      // Display weighted score if available, otherwise display pre-assessment score
                      let display;
                      if (weightedValue !== null && weightedValue !== undefined) {
                        display = weightedValue.toFixed(2);
                      } else {
                        const raw = pa[key];
                        display = raw === 'N/A' ? 'N/A'
                          : (raw !== null && raw !== undefined && raw !== '') ? raw
                          : '—';
                      }
                      
                      const interviewRemarks = key === 'interview_average' ? parseInterviewRating(app).remarks : null;
                      return (
                        <td key={key} className="px-2 py-3 text-center text-gray-800 dark:text-gray-200 break-words min-w-[60px] max-w-[80px]">
                          <div className="relative group flex flex-col items-center justify-center gap-1">
                            <div className="flex items-center gap-1">
                              <span className={weightedValue !== null && weightedValue !== undefined ? 'text-blue-600 dark:text-blue-400 font-semibold' : ''}>
                                {display}
                              </span>
                              {interviewRemarks && (
                                <FaComments className="w-3 h-3 text-blue-500 dark:text-blue-400 cursor-help" />
                              )}
                            </div>
                            {interviewRemarks && (
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-50 bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900 text-xs rounded-lg px-3 py-2 whitespace-normal break-words w-64 shadow-lg">
                                <div className="font-semibold mb-1">Interviewer's Remarks:</div>
                                <div>{interviewRemarks}</div>
                                <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-200"></div>
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    {/* Grand Total */}
                    <td className="px-4 py-3 text-center font-bold text-gray-900 dark:text-white break-words">
                      {gt}
                    </td>

                    {/* Status - Text or Checkbox display */}
                    <td className="px-4 py-3 text-center break-words">
                      <div className="flex items-center justify-center">
                        {['Assessed', 'Synced Employees', 'Synced Trainings'].includes(app.interview_status) ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                              app.assessment_remarks === 'Hired'
                                ? 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30'
                                : app.assessment_remarks?.startsWith('REPLACED')
                                ? 'text-orange-700 bg-orange-100 dark:text-orange-300 dark:bg-orange-900/30'
                                : 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30'
                            }`}>
                              {app.assessment_remarks === 'Hired' 
                                ? 'Hired' 
                                : app.assessment_remarks?.startsWith('REPLACED') 
                                ? 'Replaced' 
                                : 'Not Hired'}
                            </span>
                          </div>
                        ) : !weightsSaved ? (
                          <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                            rowData[app.id]?.checked 
                              ? 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30' 
                              : 'text-gray-500 bg-gray-100 dark:text-gray-400 dark:bg-gray-800'
                          }`}>
                            {rowData[app.id]?.checked ? 'Hired' : 'Not Hired'}
                          </span>
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              checked={rowData[app.id]?.checked || false}
                              onChange={e => {
                                const checked = e.target.checked;
                                setRowData(prev => ({
                                  ...prev,
                                  [app.id]: { 
                                    ...prev[app.id], 
                                    checked,
                                    remarks: checked ? 'Hired' : '' 
                                  },
                                }));
                              }}
                              disabled={isReadOnly}
                              className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                            />
                            {rowData[app.id]?.checked && (
                              <span className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-tight">
                                Hired
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Remarks - Add/Edit Button */}
                    <td className="px-4 py-3 break-words">
                      <button
                        onClick={() => {
                          setEditingRemarksId(app.id);
                          setEditingRemarksText(rowData[app.id]?.remarks || '');
                        }}
                        disabled={
                          (app.assessment_remarks != null) || rowData[app.id]?.checked || !weightsSaved || isReadOnly
                        }
                        title={
                          (app.assessment_remarks != null)
                            ? 'Remarks cannot be edited once saved in the database' 
                            : rowData[app.id]?.checked
                            ? 'Remarks are set to "Hired" when selected'
                            : !weightsSaved
                            ? 'Save weights first to enable remarks'
                            : 'Edit or add remarks for this applicant'
                        }
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:text-gray-400 dark:disabled:text-gray-600"
                      >
                        {(app.assessment_remarks != null)
                          ? 'Remarks Saved' 
                          : (rowData[app.id]?.remarks && rowData[app.id].remarks !== '') 
                            ? 'Edit Remarks' 
                            : 'Add Remarks'}
                      </button>
                    </td>

                    {/* Action - Replace Button */}
                    <td className="px-4 py-3 text-center break-words">
                      <button
                        onClick={() => handleReplace(app)}
                        disabled={isReplacingId === app.id || app.assessment_remarks !== 'Hired'}
                        title={isReplacingId === app.id ? 'Replacement in progress...' : (app.assessment_remarks !== 'Hired' ? 'Status must be Hired to replace' : 'Replace this applicant')}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isReplacingId === app.id ? 'Replacing...' : 'Replace'}
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} className="py-16 text-center text-gray-500 dark:text-gray-400">
                  <h3 className="text-lg font-medium">No Assessment Records Found</h3>
                  <p className="text-sm mt-1">Applicants transmitted to focal persons will appear here.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {sortedApplicants.length === 0 ? 0 : Math.min((currentPage - 1) * rowsPerPage + 1, sortedApplicants.length)} to {Math.min(currentPage * rowsPerPage, sortedApplicants.length)} of {sortedApplicants.length} records
        </span>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
            disabled={currentPage === 1}
            title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
            disabled={currentPage === totalPages}
            title={currentPage === totalPages ? 'Already on last page' : 'Go to next page'}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
        </>
      )}

</div>
  );
};

export default Assessment;
