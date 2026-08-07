import React, { useState, useEffect, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import { FaFilePdf,  } from 'react-icons/fa';
import { FiDownload, FiUpload, FiX } from 'react-icons/fi';
import { useSettings } from '../context/SettingsContext';
import ProgressModal from '../components/Progress';
import ToastContainer from '../components/ToastContainer';
import useToast from '../hooks/useToast';

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

const SearchableDropdown = ({ options, value, onChange, placeholder, id, required, disabled = false, className = '' }) => {
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
        <input id={id} type="text" className={`w-full p-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-gray-700/50 ${className}`} value={displayValue} onChange={(e) => { if (disabled) return; setSearchTerm(e.target.value); if (!isOpen) setIsOpen(true); }} onFocus={() => { if (disabled) return; setIsOpen(true); setSearchTerm(''); }} placeholder={placeholder} required={required && !value} disabled={disabled} />
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

const TempTrainingCertificates = () => {
  const { serverIp } = useSettings();
  const { toasts, showToast, removeToast } = useToast();
  const [data, setData] = useState([]);
  const [recipientType, setRecipientType] = useState('');
  const [certType, setCertType] = useState('');
  const [transmitterName, setTransmitterName] = useState('');
  const [encodedBy, setEncodedBy] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState(null);
  const fileInputRef = useRef(null);

  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isProgressComplete, setIsProgressComplete] = useState(false);


  const [duplicateRecords, setDuplicateRecords] = useState([]);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = (JSON.parse(localStorage.getItem('loginState')) || null);
        setSessionState(state);
        if (state?.user) {
            setEncodedBy(state.user.email_address || '');
            const { first_name, middle_initial, last_name, suffix } = state.user;
            const fullName = [first_name, middle_initial, last_name, suffix].filter(Boolean).join(' ');
            setTransmitterName(fullName);
        }
      } catch (err) {
        console.error("Failed to get session", err);
      }
    };
    getSession();
  }, []);

  const recipientTypeOptions = useMemo(() => [
    { value: 'Participant/s', label: 'Participant/s' },
    { value: 'Resource Person/s', label: 'Resource Person/s' }
  ], []);

  const certTypeOptions = useMemo(() => [
      { value: 'Participation', label: 'Participation' },
      { value: 'Completion', label: 'Completion' }
  ], []);

  const handleImportClick = () => {
    if (!recipientType) {
      showToast('Please select who the certificate is for before importing.', 'error');
      return;
    }
    if (recipientType === 'Participant/s' && !certType) {
      showToast('Please select a certificate type before importing.', 'error');
      return;
    }
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (selectedFile) {
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          let requiredFields = ['First Name', 'Last Name', 'Training Title', 'Start Date', 'End Date', 'Hours', 'Venue'];
          if (recipientType === 'Resource Person/s') {
            requiredFields = requiredFields.filter(field => field !== 'Hours');
          }
          const validationErrors = [];

          results.data.forEach((row, index) => {
            const missing = requiredFields.filter(field => !row[field] || row[field].trim() === '');
            if (missing.length > 0) {
              validationErrors.push(`Row ${index + 2}: Missing ${missing.join(', ')}`);
            }
          });

          if (validationErrors.length > 0) {
            showToast(`Validation failed:\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? '\n...' : ''}`, 'error');
            setData([]);
            return;
          }

          const formattedData = results.data.map((row, index) => {
            const fullName = [
              row['First Name'],
              row['Middle Initial'],
              row['Last Name'],
              row['Suffix']
            ].filter(Boolean).join(' ').trim();

            return {
              id: index,
              name: fullName,
              first_name: row['First Name'] || '',
              middle_initial: row['Middle Initial'] || '',
              last_name: row['Last Name'] || '',
              suffix: row['Suffix'] || '',
              trainingTitle: row['Training Title'] || '',
              startDate: row['Start Date'] || '',
              endDate: row['End Date'] || '',
              hours: row['Hours'] || '',
              venue: row['Venue'] || ''
            };
          });
          setData(formattedData);
        },
        error: (error) => {
          console.error('Error parsing CSV:', error);
          showToast('Error parsing CSV file.', 'error');
        }
      });
    }
    e.target.value = null;
  };

  const handleGenerate = async () => {
    if (data.length === 0) {
      showToast('No data available.', 'error');
      return;
    }
    let finalCertType = recipientType === 'Resource Person/s' ? 'Appreciation' : certType;
    const requiredFields = recipientType === 'Resource Person/s' 
      ? ['first_name', 'last_name', 'trainingTitle', 'startDate', 'endDate', 'venue']
      : ['first_name', 'last_name', 'trainingTitle', 'startDate', 'endDate', 'hours', 'venue'];
    
    const invalidRecords = [];
    data.forEach((record, index) => {
      const missingFields = requiredFields.filter(field => !record[field] || (typeof record[field] === 'string' && record[field].trim() === ''));
      if (missingFields.length > 0) invalidRecords.push(`Row ${index + 1}: Missing ${missingFields.join(', ')}`);
    });

    if (invalidRecords.length > 0) {
      showToast(`Validation failed`, 'error');
      return;
    }

    setIsProgressComplete(false);
    setProgressMessage('Generating...');
    setIsProgressModalOpen(true);
    setLoading(true);
    try {
      const payload = { certificates: data, transmitterName, encodedBy, certType: finalCertType };
      
      const protocol = window.location.protocol;
      const port = protocol === 'https:' ? 443 : 80;
      const response = await fetch(`${protocol}//${serverIp}:${port}/api/generate-batch-training-certificate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionState.token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        if (errorData && errorData.error) {
            throw new Error(typeof errorData.error === 'object' ? JSON.stringify(errorData.error) : errorData.error);
        } else {
            throw new Error(`Server responded with ${response.status}`);
        }
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Batch-Certificates-${Date.now()}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setIsProgressModalOpen(false);
      showToast('Generated successfully', 'success');
    } catch (error) {
      console.error('Error generating certificates:', error);
      try {
        const parsedMessage = JSON.parse(error.message);
        if (parsedMessage.type === 'DUPLICATES') {
          setIsProgressModalOpen(false); // Hide progress modal
          setDuplicateRecords(parsedMessage.duplicates);
          setIsDuplicateModalOpen(true);
          return;
        }
      } catch(e) {
        // Not a JSON error, fallback to normal error handling
      }
      setIsProgressComplete(true);
      setProgressMessage(`Failed to generate certificates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCsvDownload = async (content, fileName) => {
    try {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('An unexpected error occurred during the download process:', err);
    }
  };

  const downloadTemplate = () => {
    if (!recipientType) {
      showToast('Select recipient type first', 'error');
      return;
    }
    const isRP = recipientType === 'Resource Person/s';
    const headers = isRP ? "First Name,Middle Initial,Last Name,Suffix,Training Title,Start Date,End Date,Venue\n" : "First Name,Middle Initial,Last Name,Suffix,Training Title,Start Date,End Date,Hours,Venue\n";
    const example = isRP ? "Lanie,G.,Pagtud,,R Programming,2024-08-01,2024-08-01,PSA Conference Hall" : "Sheminit,S.,Abon,,Data Privacy Act Training,2023-10-01,2023-10-02,16,PSA Headquarters";
    handleCsvDownload(headers + example, isRP ? "resource_person_template.csv" : "participant_template.csv");
  };

  return (
    <div className="flex-1 w-full flex flex-col min-h-0">        <ToastContainer toasts={toasts} onClose={removeToast} />        <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">External Partners Certificate Generation</h1>
          
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {data.length > 0 && (
              <button
                onClick={handleGenerate}
                disabled={loading}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg ${
                  loading ? 'bg-gray-400 cursor-not-allowed dark:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600'
                }`}
              >
                <FaFilePdf className="w-5 h-5" />{loading ? 'Generating...' : 'Confirm Generate'}
              </button>
            )}

            <button 
              onClick={() => setIsGenerateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
            >
              <FiUpload className="w-5 h-5" />Generate
            </button>

            <input 
              type="file" 
              ref={fileInputRef}
              accept=".csv"
              onChange={(e) => {
                handleFileChange(e);
                setIsGenerateModalOpen(false);
              }}
              className="hidden"
            />
          </div>
        </div>

        <div className="overflow-auto bg-white rounded-lg shadow flex-1 min-h-0 dark:bg-gray-800">
            <table className="min-w-full text-sm leading-normal table-fixed">
              <thead className="sticky top-0 border-b-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                <tr>
                  <th className="w-[20%] px-5 py-3.5 text-left font-semibold uppercase text-gray-500 dark:text-gray-300">Name</th>
                  <th className="w-[30%] px-5 py-3.5 text-left font-semibold uppercase text-gray-500 dark:text-gray-300">Training Title</th>
                  <th className="w-[15%] px-5 py-3.5 text-left font-semibold uppercase text-gray-500 dark:text-gray-300">Dates</th>
                  <th className="w-[10%] px-5 py-3.5 text-left font-semibold uppercase text-gray-500 dark:text-gray-300">Hours</th>
                  <th className="w-[25%] px-5 py-3.5 text-left font-semibold uppercase text-gray-500 dark:text-gray-300">Venue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {data.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-5 py-16 text-lg font-semibold text-center text-gray-500 dark:text-gray-400">
                      No data loaded.
                    </td>
                  </tr>
                ) : (
                  data.map((row) => (
                    <tr key={row.id} className="transition-colors duration-200 ease-in-out border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-5 py-4 break-words text-sm font-medium text-gray-900 dark:text-white">{row.name}</td>
                      <td className="px-5 py-4 break-words text-sm text-gray-700 dark:text-gray-300">{row.trainingTitle}</td>
                      <td className="px-5 py-4 break-words text-sm text-gray-700 dark:text-gray-300">
                        {row.startDate} {row.startDate !== row.endDate ? ` - ${row.endDate}` : ''}
                      </td>
                      <td className="px-5 py-4 break-words text-sm text-gray-700 dark:text-gray-300">{row.hours}</td>
                      <td className="px-5 py-4 break-words text-sm text-gray-700 dark:text-gray-300">{row.venue}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
        </div>

      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all duration-300 scale-100 opacity-100">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FiUpload className="text-blue-500" /> Import Certificates
              </h3>
              <button 
                onClick={() => setIsGenerateModalOpen(false)}
                className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Certificate For <span className="text-red-500">*</span>
                </label>
                <SearchableDropdown
                  id="recipientTypeModal"
                  options={recipientTypeOptions}
                  value={recipientType}
                  onChange={(value) => { setRecipientType(value); setCertType(''); }}
                  placeholder="Select Recipient Type..."
                  className="w-full text-sm"
                />
              </div>

              {recipientType === 'Participant/s' && (
                <div className="animate-fade-in-up">
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                    Certificate Type <span className="text-red-500">*</span>
                  </label>
                  <SearchableDropdown
                    id="certTypeModal"
                    options={certTypeOptions}
                    value={certType}
                    onChange={setCertType}
                    placeholder="Select Type..."
                    className="w-full text-sm"
                  />
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 justify-end items-center">
              <button 
                onClick={downloadTemplate}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
              >
                <FiDownload className="w-4 h-4" /> Template
              </button>
              <button 
                onClick={handleImportClick}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm hover:shadow transition-all"
              >
                <FiUpload className="w-4 h-4" /> Import CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <ProgressModal
        isOpen={isProgressModalOpen}
        onClose={() => setIsProgressModalOpen(false)}
        statusMessage={progressMessage}
        isComplete={isProgressComplete}
      />

      {isDuplicateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-[90%] max-w-2xl max-h-[90vh] flex flex-col">
            <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-2">Duplicate Certificates Found</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              The following records have already been generated. Please remove the found duplicates on the csv file and try again.
            </p>
            <div className="overflow-y-auto flex-grow mb-4 bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600">
              <table className="min-w-full text-sm text-left">
                <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Name</th>
                    <th className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">Training Title</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {duplicateRecords.map((rec, idx) => (
                    <tr key={idx} className="hover:bg-gray-100 dark:hover:bg-gray-600/50">
                      <td className="px-4 py-2 text-gray-900 dark:text-white break-words">{rec.name}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white break-words">{rec.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setIsDuplicateModalOpen(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};

export default TempTrainingCertificates;
