import React, { useState, useEffect, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import { FaFilePdf, FaArrowLeft, FaArrowRight } from 'react-icons/fa';
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
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 12;
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [isProgressComplete, setIsProgressComplete] = useState(false);
  const [savedFilePath, setSavedFilePath] = useState(null);

  useEffect(() => {
    const getSession = async () => {
      try {
        const state = await window.electronAPI.getLoginState();
        setSessionState(state);
        if (state?.user) {
            setEncodedBy(state.user.email_address || '');
            // Auto-fill transmitter name from session user
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
      showToast('Please select who the certificate is for (Participant/s or Resource Person/s) before importing.', 'error');
      return;
    }
    if (recipientType === 'Participant/s' && !certType) {
      showToast('Please select a certificate type (Participation or Completion) before importing.', 'error');
      return;
    }
    fileInputRef.current.click();
  };

  // Handle CSV File Upload and Parsing
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (selectedFile) {
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          // Validate required fields
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

          // Map CSV columns to the structure expected by the backend
          const formattedData = results.data.map((row, index) => {
            // Construct full name for the certificate display
            const fullName = [
              row['First Name'],
              row['Middle Initial'],
              row['Last Name'],
              row['Suffix']
            ].filter(Boolean).join(' ').trim();

            return {
              id: index, // Temporary ID for key
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
          setCurrentPage(1);
        },
        error: (error) => {
          console.error('Error parsing CSV:', error);
          showToast('Error parsing CSV file. Please check the format.', 'error');
        }
      });
    }
    e.target.value = null; // Reset input to allow re-uploading same file
  };

  // Handle Generate Button Click
  const handleGenerate = async () => {
    if (data.length === 0) {
      showToast('No data available. Please import a CSV file first.', 'error');
      return;
    }
    if (!recipientType) {
      showToast('Please select who the certificate is for.', 'error');
      return;
    }

    let finalCertType = '';
    if (recipientType === 'Participant/s') {
      if (!certType) {
        showToast('Please select a certificate type (Participation/Completion).', 'error');
        return;
      }
      finalCertType = certType;
    } else if (recipientType === 'Resource Person/s') {
      finalCertType = 'Appreciation';
    }

    // Validate that all records have required fields with actual values
    const requiredFields = recipientType === 'Resource Person/s' 
      ? ['first_name', 'last_name', 'trainingTitle', 'startDate', 'endDate', 'venue']
      : ['first_name', 'last_name', 'trainingTitle', 'startDate', 'endDate', 'hours', 'venue'];
    
    const invalidRecords = [];
    data.forEach((record, index) => {
      const missingFields = [];
      requiredFields.forEach(field => {
        const value = record[field];
        // Check if field is empty, undefined, null, or contains only whitespace
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          missingFields.push(field);
        }
      });
      if (missingFields.length > 0) {
        invalidRecords.push(`Row ${index + 1} (${record.name || 'N/A'}): Missing or empty ${missingFields.join(', ')}`);
      }
    });

    if (invalidRecords.length > 0) {
      showToast(`Validation failed:\n${invalidRecords.slice(0, 5).join('\n')}${invalidRecords.length > 5 ? '\n...' : ''}`, 'error');
      return;
    }

    if (!serverIp || !sessionState) {
        showToast('Server connection or session not available.', 'error');
        return;
    }

    setIsProgressComplete(false);
    setProgressMessage('Preparing certificate generation...');
    setSavedFilePath(null);
    setIsProgressModalOpen(true);
    setLoading(true);
    try {
      const payload = {
        certificates: data,
        transmitterName,
        encodedBy,
        certType: finalCertType
      };

      const API_PORT = 3001;
      const fullUrl = `http://${serverIp}:${API_PORT}/api/generate-batch-training-certificate`;

      const prepareResponse = await window.electronAPI.prepareDownload({
        url: fullUrl,
        payload: {
          headers: { 
              'Authorization': `Bearer ${sessionState.token}`,
          },
          body: payload
        },
        fileType: 'pdf'
      });

      if (!prepareResponse.success) {
          throw new Error(prepareResponse.message || 'Failed to prepare download');
      }

      setProgressMessage('Generating PDF... Please save the file.');

      const saveResult = await window.electronAPI.saveFile({
        downloadId: prepareResponse.downloadId,
        fileName: `Batch-Certificates-${Date.now()}.pdf`,
        fileType: 'pdf'
      });

      if (saveResult.status === 'completed') {
        setIsProgressComplete(true);
        setProgressMessage('Batch certificates generated and saved successfully!');
        setSavedFilePath(saveResult.path);
      } else if (saveResult.status === 'failed') {
        setIsProgressComplete(true);
        setProgressMessage(`Failed to save file: ${saveResult.message}`);
      }
    } catch (error) {
      console.error('Error generating certificates:', error);
      setIsProgressComplete(true);
      setProgressMessage(`Failed to generate certificates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCsvDownload = async (content, fileName) => {
    setIsProgressComplete(false);
    setProgressMessage('Preparing file...');
    setSavedFilePath(null);
    setIsProgressModalOpen(true);

    try {
      const result = await window.electronAPI.saveCsvFile({ content, fileName });

      if (result.status === 'completed') {
        setIsProgressComplete(true);
        setProgressMessage(result.message);
        setSavedFilePath(result.path);
      } else if (result.status === 'failed') {
        setIsProgressComplete(true);
        setProgressMessage(`Error: ${result.message}`);
        setSavedFilePath(null);
      } else {
        setIsProgressModalOpen(false);
      }
    } catch (err) {
      console.error('An unexpected error occurred during the download process:', err);
      setIsProgressComplete(true);
      setProgressMessage('An unexpected error occurred. Please check the console.');
    }
  };

  // Helper to download a CSV template
  const downloadTemplate = () => {
    if (!recipientType) {
      showToast('Please select who the certificate is for before downloading the template.', 'error');
      return;
    }

    let headers, example, fileName;

    if (recipientType === 'Resource Person/s') {
        headers = "First Name,Middle Initial,Last Name,Suffix,Training Title,Start Date,End Date,Venue\n";
        example = "Lanie,G.,Pagtud,,R Programming,2024-08-01,2024-08-01,PSA Conference Hall";
        fileName = "resource_person_template.csv";
    } else { // Default to participant, even if nothing is selected
        headers = "First Name,Middle Initial,Last Name,Suffix,Training Title,Start Date,End Date,Hours,Venue\n";
        example = "Sheminit,S.,Abon,,Data Privacy Act Training,2023-10-01,2023-10-02,16,PSA Headquarters";
        fileName = "participant_template.csv";
    }

    const csvContent = headers + example;
    handleCsvDownload(csvContent, fileName);
  };

  const totalItems = data.length;
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  const paginatedData = data.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, totalPages));
  const handlePreviousPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));

  return (
    <div>        <ToastContainer toasts={toasts} onClose={removeToast} />        <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">External Partners Certificate Generation</h1>
          
          {/* Button Bar */}
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {data.length > 0 && (
              <button
                onClick={handleGenerate}
                disabled={loading}
                title={loading ? 'Generating certificates...' : 'Generate certificates for selected trainings'}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white rounded-lg ${
                  loading ? 'bg-gray-400 cursor-not-allowed dark:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600'
                }`}
              >
                <FaFilePdf className="w-4 h-4" />{loading ? 'Generating...' : 'Generate Certificates'}
              </button>
            )}
            
            <div className="w-48">
              <SearchableDropdown
                id="recipientType"
                options={recipientTypeOptions}
                value={recipientType}
                onChange={(value) => { setRecipientType(value); setCertType(''); }}
                placeholder="Certificate for..."
                className="text-xs font-semibold"
              />
            </div>

            {recipientType === 'Participant/s' && (
              <div className="w-48">
                <SearchableDropdown
                  id="certType"
                  options={certTypeOptions}
                  value={certType}
                  onChange={setCertType}
                  placeholder="Select Type..."
                  className="text-xs font-semibold"
                />
              </div>
            )}

                <button 
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-900 dark:text-gray-100 bg-gray-400 rounded-lg hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-700"
            >
              <FiDownload className="w-4 h-4" />Download Template
            </button>
            
            <button 
              onClick={handleImportClick}
              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
            >
              <FiUpload className="w-4 h-4" />Import CSV
            </button>
            <input 
              type="file" 
              ref={fileInputRef}
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Preview Table */}
        <div className="overflow-x-auto bg-white h-[760px] rounded-lg shadow dark:bg-gray-800">
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
                      No data loaded. Please upload a CSV file.
                    </td>
                  </tr>
                ) : (
                  paginatedData.map((row) => (
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

      <div className="flex justify-between items-center mt-1">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Showing {totalItems > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0} to {Math.min(currentPage * rowsPerPage, totalItems)} of {totalItems} records
        </span>
        <div className="flex items-center space-x-2">
          <button onClick={handlePreviousPage} disabled={currentPage === 1} title={currentPage === 1 ? 'Already on first page' : 'Go to previous page'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"><FaArrowLeft className="w-4 h-4" />Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} title={currentPage >= totalPages ? 'Already on last page' : 'Go to next page'} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">Next<FaArrowRight className="w-4 h-4" /></button>
        </div>
      </div>

      <ProgressModal
        isOpen={isProgressModalOpen}
        onClose={() => setIsProgressModalOpen(false)}
        statusMessage={progressMessage}
        isComplete={isProgressComplete}
        filePath={savedFilePath}
      />

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
};

export default TempTrainingCertificates;