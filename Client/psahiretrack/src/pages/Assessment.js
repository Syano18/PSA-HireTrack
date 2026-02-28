import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FaSort, FaSortUp, FaSortDown, FaSync } from 'react-icons/fa';
import { apiFetch } from '../components/API';
import { useSettings } from '../context/SettingsContext';

const SCORE_KEYS = [
  { key: 'educational_attainment',   label: 'Educational Attainment',   short: 'Educ. Attain.' },
  { key: 'relevant_training',        label: 'Relevant Trainings',        short: 'Rel. Training' },
  { key: 'relevant_work_experience', label: 'Relevant Work Experience',  short: 'Rel. Work Exp.' },
  { key: 'written_examination',      label: 'Written Examination',       short: 'Written Exam' },
  { key: 'interview_average',        label: 'Personal Interview',        short: 'Interview' },
];

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

const Assessment = () => {
  const { serverIp, isLoading: isSettingsLoading } = useSettings();

  const [applicants, setApplicants]     = useState([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [error, setError]               = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [searchQuery, setSearchQuery]   = useState('');
  const [currentPage, setCurrentPage]   = useState(1);
  const rowsPerPage = 10;
  const [sortConfig, setSortConfig]     = useState({ key: 'last_name', direction: 'ascending' });
  const [filterSurvey, setFilterSurvey]   = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [weightWarning, setWeightWarning] = useState(null);

  // Dropdown options derived from fetched data
  const surveyOptions   = useMemo(() => [...new Set(applicants.map(a => a.survey_name).filter(Boolean))].sort(), [applicants]);
  const positionOptions = useMemo(() => [...new Set(applicants.map(a => a.position).filter(Boolean))].sort(), [applicants]);

  // Global percentage weights (one per score column, shared across all rows)
  const [weights, setWeights] = useState({
    educational_attainment:   '',
    relevant_training:        '',
    relevant_work_experience: '',
    written_examination:      '',
    interview_average:        '',
  });

  // Per-row editable fields: { [id]: { status, remarks } }
  const [rowData, setRowData]   = useState({});
  const [savingId, setSavingId] = useState(null);

  // ─── fetch ────────────────────────────────────────────────────────────────
  const fetchApplicants = useCallback(async () => {
    if (!serverIp) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch('applicants/for-assessment', serverIp);
      setApplicants(data);
      // Pre-fill rowData from dedicated assessment_status / assessment_remarks columns
      const initial = {};
      data.forEach(app => {
        initial[app.id] = {
          status:  app.assessment_status  || '',
          remarks: app.assessment_remarks || '',
        };
      });
      setRowData(initial);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [serverIp]);

  useEffect(() => {
    if (!isSettingsLoading) fetchApplicants();
  }, [isSettingsLoading, fetchApplicants]);

  // Set initial/default weights when dropdowns change
  useEffect(() => {
    const disableWeights = (filterSurvey === '' || filterPosition === '');
    setWeights(prev => {
      let changed = false;
      const updated = { ...prev };
      // Check if written exam is NA for all filtered applicants
      let writtenExamNA = false;
      if (!disableWeights) {
        const filtered = applicants.filter(app => {
          if (filterSurvey && app.survey_name !== filterSurvey) return false;
          if (filterPosition && app.position !== filterPosition) return false;
          return true;
        });
        writtenExamNA = filtered.length > 0 && filtered.every(app => {
          const pa = parsePA(app);
          const we = pa.written_examination;
          return we === 'N/A' || we === null || we === undefined || we === '';
        });
      }

      // Count how many fields to distribute
      const activeKeys = SCORE_KEYS.filter(({ key }) => disableWeights ? false : (key !== 'written_examination' || !writtenExamNA));
      const defaultWeight = activeKeys.length > 0 ? Math.floor(100 / activeKeys.length) : 0;
      SCORE_KEYS.forEach(({ key }) => {
        if (disableWeights) {
          if (updated[key] !== 0) {
            updated[key] = 0;
            changed = true;
          }
        } else if (key === 'written_examination' && writtenExamNA) {
          if (updated[key] !== 0) {
            updated[key] = 0;
            changed = true;
          }
        } else {
          if (!updated[key] || updated[key] === 0) {
            updated[key] = defaultWeight;
            changed = true;
          }
        }
      });
      return changed ? updated : prev;
    });
  }, [filterSurvey, filterPosition, applicants]);

  // Error detection for weights (only when dropdowns are not 'ALL')
  useEffect(() => {
    if (!weights) return;
    const disableWeights = (filterSurvey === '' || filterPosition === '');
    // Check if written exam is NA for all filtered applicants
    let writtenExamNA = false;
    if (!disableWeights) {
      const filtered = applicants.filter(app => {
        if (filterSurvey && app.survey_name !== filterSurvey) return false;
        if (filterPosition && app.position !== filterPosition) return false;
        return true;
      });
      writtenExamNA = filtered.length > 0 && filtered.every(app => {
        const pa = parsePA(app);
        const we = pa.written_examination;
        return we === 'N/A' || we === null || we === undefined || we === '';
      });
    }
    if (disableWeights) {
      setWeightWarning(null);
      return;
    }
    let warning = null;
    SCORE_KEYS.forEach(({ key, label }) => {
      if (key === 'written_examination' && writtenExamNA) return; // skip warning if all NA
      if (!weights[key] || parseFloat(weights[key]) <= 0) {
        warning = `${label.replace(/\.$/, '').replace(/\s+$/, '').replace(/\s+/g, ' ')} cannot be zero or negative.`;
      }
    });
    setWeightWarning(warning);
  }, [weights, filterSurvey, filterPosition, applicants]);

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
  // Step 1: apply dropdown filters
  const dropdownFiltered = useMemo(() => {
    return applicants.filter(app => {
      if (filterSurvey   && app.survey_name !== filterSurvey)   return false;
      if (filterPosition && app.position    !== filterPosition) return false;
      return true;
    });
  }, [applicants, filterSurvey, filterPosition]);

  // track written exam NA status among filtered items
  const writtenStatus = useMemo(() => {
    let hasNumber = false;
    let hasNA = false;
    dropdownFiltered.forEach(app => {
      const pa = parsePA(app);
      const we = pa.written_examination;
      if (we === 'N/A' || we === null || we === undefined || we === '') {
        hasNA = true;
      } else {
        hasNumber = true;
      }
    });
    return { hasNumber, hasNA };
  }, [dropdownFiltered]);

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
        if (av < bv) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (av > bv) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return arr;
  }, [filteredApplicants, sortConfig]);

  const totalPages  = Math.max(1, Math.ceil(sortedApplicants.length / rowsPerPage));
  const currentItems = sortedApplicants.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const requestSort = (key) => {
    setCurrentPage(1);
    setSortConfig(c => ({
      key,
      direction: c.key === key && c.direction === 'ascending' ? 'descending' : 'ascending',
    }));
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <FaSort className="inline-block ml-1 text-gray-400" />;
    return sortConfig.direction === 'ascending'
      ? <FaSortUp   className="inline-block ml-1 text-blue-500" />
      : <FaSortDown className="inline-block ml-1 text-blue-500" />;
  };

  // ─── save ─────────────────────────────────────────────────────────────────
  const handleSave = async (app) => {
    setSavingId(app.id);
    setError(null);
    try {
      const rd = rowData[app.id] || {};
      await apiFetch(`applicants/${app.id}/assessment`, serverIp, {
        method: 'PUT',
        body: JSON.stringify({
          assessment_status:  rd.status  || '',
          assessment_remarks: rd.remarks || '',
        }),
      });
      setSuccessMessage('Assessment saved successfully.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  // ─── weight sum ───────────────────────────────────────────────────────────
  const totalWeight = SCORE_KEYS.reduce((s, { key }) => s + (parseFloat((weights && weights[key]) ?? 0) || 0), 0);

  // ─── loading state ────────────────────────────────────────────────────────
  if (isLoading || isSettingsLoading) {
    return <div className="p-8 text-gray-500 dark:text-gray-400">Loading Assessment Records...</div>;
  }

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Success toast */}
      {successMessage && (
        <div className="fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 bg-green-600 text-white text-sm font-semibold rounded-lg shadow-lg">
          <span>✓</span> {successMessage}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">Assessment</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Survey/Census filter */}
          <select
            value={filterSurvey}
            onChange={e => { setFilterSurvey(e.target.value); setCurrentPage(1); }}
            className="py-2 pl-3 pr-8 text-sm border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Surveys</option>
            {surveyOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* Position filter */}
          <select
            value={filterPosition}
            onChange={e => { setFilterPosition(e.target.value); setCurrentPage(1); }}
            className="py-2 pl-3 pr-8 text-sm border rounded dark:bg-gray-900 dark:border-gray-600 dark:text-white focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Positions</option>
            {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={fetchApplicants}
            disabled={isLoading}
            title="Refresh"
            className="p-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <FaSync className={isLoading ? 'animate-spin' : ''} />
          </button>
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            placeholder="Search name..."
            className="w-52 py-2 pl-4 pr-10 border rounded dark:bg-gray-900 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {error && <div className="p-3 mb-4 text-center text-red-700 bg-red-100 rounded-lg">{error}</div>}

      {/* Weight warning */}
      {((totalWeight !== 100 && !(filterSurvey === '' || filterPosition === '')) || weightWarning) && (
        <div className="p-3 mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700">
          {weightWarning ? weightWarning :
          `Percentage weights must total 100% for an accurate grand total.`}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow dark:bg-gray-800">
        <table className="min-w-full text-sm leading-normal">
          <thead>
            {/* ── Row 1: Column headers ── */}
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
              {/* Fixed columns span both header rows */}
              <th rowSpan={2} className="px-8 py-3 text-left align-bottom border-r border-gray-200 dark:border-gray-700 min-w-[220px] max-w-[320px]">
                <button onClick={() => requestSort('last_name')} className="font-semibold flex items-center uppercase text-xs whitespace-nowrap">
                  Name {getSortIcon('last_name')}
                </button>
              </th>
              {/* Score criteria labels — weight inputs go in row 2 below */}
              {SCORE_KEYS.map(({ key, label, short }) => (
                <th key={key} className="px-2 py-2 text-center border-b border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 min-w-[60px] max-w-[80px]" title={label}>
                  <span className="font-semibold uppercase text-xs whitespace-nowrap">{short}</span>
                </th>
              ))}
              {/* Grand Total — label on top, weight total below */}
              <th className="px-4 py-2 text-center border-b border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 border-l border-gray-200 dark:border-gray-700">
                <span className="font-semibold uppercase text-xs whitespace-nowrap">Grand Total</span>
              </th>
              <th rowSpan={2} className="px-4 py-3 text-center align-bottom border-l border-gray-200 dark:border-gray-700">
                <span className="font-semibold uppercase text-xs whitespace-nowrap">Status</span>
              </th>
              <th rowSpan={2} className="px-4 py-3 text-center align-bottom">
                <span className="font-semibold uppercase text-xs">Action</span>
              </th>
            </tr>

            {/* ── Row 2: Weight % inputs (only under score + grand total columns) ── */}
            <tr className="border-b-2 border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20">
              {SCORE_KEYS.map(({ key }) => {
                const disableWeights = (filterSurvey === '' || filterPosition === '');
                const zeroOutWritten = (key === 'written_examination' && !writtenStatus.hasNumber && writtenStatus.hasNA && !disableWeights);
                return (
                  <td key={key} className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 leading-none">wt.%</span>
                      <input
                        type="number"
                        min={key === 'written_examination' ? 0 : 1}
                        max={99}
                        value={zeroOutWritten ? '0' : (weights && weights[key] != null ? weights[key] : '')}
                        onChange={e => {
                          if (disableWeights) return;
                          const value = e.target.value;
                          // Allow empty string, or a 1-2 digit number.
                          if (value === '' || /^\d{1,2}$/.test(value)) {
                            setWeights(prev => ({ ...prev, [key]: value }));
                          }
                        }}
                        disabled={disableWeights || (key === 'written_examination' && (writtenStatus.hasNumber && writtenStatus.hasNA)) || zeroOutWritten}
                        className="w-14 px-1 py-1 text-xs text-center border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                      />
                    </div>
                  </td>
                );
              })}
              <td className="px-4 py-2 text-center text-xs font-bold border-l border-gray-200 dark:border-gray-700">
                {(filterSurvey !== '' || filterPosition !== '') && writtenStatus.hasNumber && writtenStatus.hasNA && (
                  <span className="text-sm text-red-600 dark:text-red-400">Cannot compute total: mixed N/A in Written Exam</span>
                )}
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
                const rd = rowData[app.id] || { status: '', remarks: '' };

                return (
                  <tr key={app.id} className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    {/* Name */}
                    <td className="px-8 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap min-w-[220px] max-w-[320px]">
                      {[app.first_name, app.middle_initial, app.last_name, app.suffix].filter(Boolean).join(' ')}
                    </td>

                    {/* Score columns (narrow) */}
                    {SCORE_KEYS.map(({ key }) => {
                      const raw = pa[key];
                      const display = raw === 'N/A' ? 'N/A'
                        : (raw !== null && raw !== undefined && raw !== '') ? raw
                        : '—';
                      return (
                        <td key={key} className="px-2 py-3 text-center text-gray-800 dark:text-gray-200 min-w-[60px] max-w-[80px]">
                          {display}
                        </td>
                      );
                    })}

                    {/* Grand Total */}
                    <td className="px-4 py-3 text-center font-bold text-gray-900 dark:text-white">
                      {gt}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <select
                        value={rd.status}
                        onChange={e => setRowData(prev => ({
                          ...prev,
                          [app.id]: { ...prev[app.id], status: e.target.value },
                        }))}
                        className={`px-2 py-1 text-xs font-semibold border rounded focus:ring-2 focus:ring-blue-500 ${
                          rd.status === 'Hired'
                            ? 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700'
                            : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
                        }`}
                      >
                        <option value="">Blank</option>
                        <option value="Hired">Hired</option>
                      </select>
                    </td>

                    {/* Remarks */}
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={rd.remarks}
                        onChange={e => setRowData(prev => ({
                          ...prev,
                          [app.id]: { ...prev[app.id], remarks: e.target.value },
                        }))}
                        placeholder="Remarks..."
                        className="w-28 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500"
                      />
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleSave(app)}
                        disabled={savingId === app.id}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingId === app.id ? 'Saving...' : 'Save'}
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
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default Assessment;
