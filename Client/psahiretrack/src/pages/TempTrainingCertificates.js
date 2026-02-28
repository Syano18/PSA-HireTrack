
import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { FaExclamationTriangle } from 'react-icons/fa';
import { useSettings } from '../context/SettingsContext';
import ProgressModal from '../components/Progress';

const TempTrainingCertificates = () => {
  const { serverIp } = useSettings();
  const [data, setData] = useState([]);
  const [recipientType, setRecipientType] = useState('');
  const [certType, setCertType] = useState('');
  const [transmitterName, setTransmitterName] = useState('');
  const [encodedBy, setEncodedBy] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState(null);
  const [error, setError] = useState(null);
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

  const handleImportClick = () => {
    setError(null);
    if (!recipientType) {
      setError('Please select who the certificate is for (Participant/s or Resource Person/s) before importing.');
      return;
    }
    if (recipientType === 'Participant/s' && !certType) {
      setError('Please select a certificate type (Participation or Completion) before importing.');
      return;
    }
    fileInputRef.current.click();
  };

  // Handle CSV File Upload and Parsing
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setError(null);

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
            setError(`Validation failed:\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? '\n...' : ''}`);
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
          setError('Error parsing CSV file. Please check the format.');
        }
      });
    }
    e.target.value = null; // Reset input to allow re-uploading same file
  };

  // Handle Generate Button Click
  const handleGenerate = async () => {
    setError(null);
    if (data.length === 0) {
      setError('No data available. Please import a CSV file first.');
      return;
    }
    if (!recipientType) {
      setError('Please select who the certificate is for.');
      return;
    }

    let finalCertType = '';
    if (recipientType === 'Participant/s') {
      if (!certType) {
        setError('Please select a certificate type (Participation/Completion).');
        return;
      }
      finalCertType = certType;
    } else if (recipientType === 'Resource Person/s') {
      finalCertType = 'Appreciation';
    }

    if (!serverIp || !sessionState) {
        setError('Server connection or session not available.');
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
      setError('Please select who the certificate is for before downloading the template.');
      return;
    }
    setError(null);

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
    <div>
        <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white">External Partners Certificate Generation</h1>
        </div>

        {/* Button Bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {data.length > 0 && (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={`px-4 py-2 font-semibold text-white rounded-lg shadow-md transition-colors ${
                loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {loading ? 'Generating...' : 'Generate Batch Certificates'}
            </button>
          )}

          <div className="flex-grow" />

          <select
            value={recipientType}
            onChange={(e) => {
              setRecipientType(e.target.value);
              setCertType(''); // Reset second dropdown
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="" disabled>Certificate for...</option>
            <option value="Participant/s">Participant/s</option>
            <option value="Resource Person/s">Resource Person/s</option>
          </select>

          {recipientType === 'Participant/s' && (
            <select
              value={certType}
              onChange={(e) => setCertType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="" disabled>Select Type...</option>
              <option value="Participation">Participation</option>
              <option value="Completion">Completion</option>
            </select>
          )}

          <button 
            onClick={downloadTemplate}
            className="px-4 py-2 font-semibold text-gray-800 bg-gray-300 rounded-lg shadow-md hover:bg-gray-400 dark:text-white dark:bg-gray-600 dark:hover:bg-gray-500"
          >
            Download Template
          </button>
          
          <button 
            onClick={handleImportClick}
            className="px-4 py-2 font-semibold text-white bg-green-600 rounded-lg shadow-md hover:bg-green-700"
          >
            Import CSV
          </button>
          <input 
            type="file" 
            ref={fileInputRef}
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
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
          <button onClick={handlePreviousPage} disabled={currentPage === 1} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Previous</button>
          <span className="text-gray-700 dark:text-gray-300 px-2">{currentPage}</span>
          <button onClick={handleNextPage} disabled={currentPage >= totalPages} className="px-4 py-2 text-sm bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded disabled:opacity-50">Next</button>
        </div>
      </div>

      <ProgressModal
        isOpen={isProgressModalOpen}
        onClose={() => setIsProgressModalOpen(false)}
        statusMessage={progressMessage}
        isComplete={isProgressComplete}
        filePath={savedFilePath}
      />

      {error && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black bg-opacity-70">
          <div className="w-full max-w-md p-6 bg-white rounded-lg shadow-xl dark:bg-gray-800 transform transition-all">
            <div className="text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full dark:bg-red-900/50">
                <FaExclamationTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">Error</h3>
              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{error}</div>
            </div>
            <div className="mt-5">
              <button type="button" onClick={() => setError(null)} className="inline-flex justify-center w-full px-4 py-2 text-base font-medium text-white bg-red-600 border border-transparent rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TempTrainingCertificates;