import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import TextAnimator from './components/TextAnimator';

interface AnalysisResult {
  country: string;
  region_or_city: string;
  coordinates: string;
  confidence: string;
  reasoning: string;
  detailed_analysis?: {
    primary_coordinates: {
      lat: number | null;
      lng: number | null;
    };
    alternative_locations: Array<{
      lat: number | null;
      lng: number | null;
      location_name?: string;
      description?: string;
      probability?: string | number;
    }>;
    evidence: {
      signage: string;
      infrastructure: string;
      architecture: string;
      environment: string;
      cultural_elements: string;
      vehicles?: string;
    };
    methodology?: {
      key_indicators: string[];
      eliminated_regions: string[];
      limiting_factors: string[];
    };
    final_assessment: {
      most_probable_location: string;
      certainty_percentage: number;
      primary_landmark: string;
      verification_suggestions?: string[];
      osint_notes?: string;
    };
  };
  multi_image_analysis?: {
    total_images: number;
    analysis_type: string;
  };
  timestamp?: number;
}


function App() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<'ai' | 'lens'>('ai');

  // History & View State
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewCoordinates, setViewCoordinates] = useState<{ lat: number, lng: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showPasteHint, setShowPasteHint] = useState(false);

  // Load History
  useEffect(() => {
    const saved = localStorage.getItem('osint_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  // Update view coordinates
  useEffect(() => {
    const coords = analysis?.detailed_analysis?.primary_coordinates;
    if (coords && coords.lat !== null && coords.lng !== null) {
      setViewCoordinates({ lat: coords.lat, lng: coords.lng });
    }
  }, [analysis]);

  // Handle Paste
  const handlePaste = async (event: ClipboardEvent) => {
    event.preventDefault();
    const items = event.clipboardData?.items;

    if (!items) return;

    const newFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) newFiles.push(file);
      }
    }

    if (newFiles.length > 0) {
      addFiles(newFiles);
      setShowPasteHint(true);
      setTimeout(() => setShowPasteHint(false), 2000);
    }
  };

  // Handle Drag & Drop
  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);

    const files = Array.from(event.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      setError("Please drop image files only.");
      return;
    }

    addFiles(imageFiles);
  };

  // Global Event Listeners
  useEffect(() => {
    const handleGlobalPaste = (event: ClipboardEvent) => {
      // Allow paste globally on the page (not just when focused on upload area)
      // Only skip if user is typing in an input/textarea
      const activeElement = document.activeElement;
      const isTyping = activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement;

      if (!isTyping) {
        handlePaste(event);
      }
    };

    document.addEventListener('paste', handleGlobalPaste);

    return () => {
      document.removeEventListener('paste', handleGlobalPaste);
    };
  }, [selectedFiles]);

  // Helper to add files
  const addFiles = (files: File[]) => {
    // If in Lens mode, only allow 1 file (replace existing)
    if (analysisMode === 'lens') {
      const file = files[0];
      setSelectedFiles([file]);
      setPreviewUrls([URL.createObjectURL(file)]);
      setAnalysis(null);
      setError(null);
      return;
    }

    // AI Mode: Append files up to 10
    const currentCount = selectedFiles.length;
    const remainingSlots = 10 - currentCount;

    if (remainingSlots <= 0) {
      setError("Maximum 10 images allowed.");
      return;
    }

    const filesToAdd = files.slice(0, remainingSlots);
    const newFiles = [...selectedFiles, ...filesToAdd];

    setSelectedFiles(newFiles);
    const newUrls = [...previewUrls, ...filesToAdd.map(f => URL.createObjectURL(f))];
    setPreviewUrls(newUrls);

    if (files.length > remainingSlots) {
      setError(`Added ${remainingSlots} images. Maximum 10 images reached.`);
    } else {
      setError(null);
    }
    setAnalysis(null);
  };

  const removeImage = (index: number) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    const updatedUrls = previewUrls.filter((_, i) => i !== index);

    URL.revokeObjectURL(previewUrls[index]);
    setSelectedFiles(updatedFiles);
    setPreviewUrls(updatedUrls);
    setError(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(Array.from(event.target.files));
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnalyzeClick = async () => {
    if (selectedFiles.length === 0) {
      setError("Please select at least one image.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysis(null);

    const formData = new FormData();

    if (analysisMode === 'lens') {
      formData.append('image', selectedFiles[0]);
    } else {
      // AI Mode: Send all images
      // If only 1 image, backend handles it. If >1, backend handles it.
      if (selectedFiles.length === 1) {
        formData.append('image', selectedFiles[0]);
      } else {
        selectedFiles.forEach(file => formData.append('images', file));
      }
    }

    // Use relative paths for Vercel deployment
    const endpoint = analysisMode === 'lens'
      ? '/api/analyze-lens'
      : '/api/analyze';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Server error: ${response.statusText}`);
      }

      const data: AnalysisResult = await response.json();
      setAnalysis(data);
      saveToHistory(data);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const saveToHistory = (newAnalysis: AnalysisResult) => {
    const analysisWithTimestamp = { ...newAnalysis, timestamp: Date.now() };
    const updatedHistory = [analysisWithTimestamp, ...history].slice(0, 50);
    setHistory(updatedHistory);
    localStorage.setItem('osint_history', JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    if (window.confirm('Clear history?')) {
      setHistory([]);
      localStorage.removeItem('osint_history');
    }
  };

  const loadFromHistory = (item: AnalysisResult) => {
    setAnalysis(item);
    setShowHistory(false);
    setTimeout(() => {
      document.querySelector('.results-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const clearAll = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSelectedFiles([]);
    setPreviewUrls([]);
    setAnalysis(null);
    setError(null);
  };

  const switchMode = (mode: 'ai' | 'lens') => {
    clearAll();
    setAnalysisMode(mode);
  };

  // Map Helpers
  const openInGoogleMaps = (lat: number, lng: number) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
  };
  const openInGoogleStreetView = (lat: number, lng: number) => {
    window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`, '_blank');
  };
  const copyCoordinates = (lat: number, lng: number) => {
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    // Optional: Show a toast or feedback
  };

  return (
    <div className="app">
      {/* History Sidebar */}
      <div className={`history-sidebar ${showHistory ? 'open' : ''}`}>
        <div className="history-header">
          <h3>History</h3>
          <button onClick={() => setShowHistory(false)} className="close-history-btn">×</button>
        </div>
        <div className="history-list">
          {history.length === 0 ? (
            <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>No history.</div>
          ) : (
            history.map((item, index) => (
              <div key={index} className="history-item" onClick={() => loadFromHistory(item)}>
                <div className="history-item-header">
                  <span>{item.timestamp ? new Date(item.timestamp).toLocaleDateString() : ''}</span>
                  <span style={{ color: '#4facfe' }}>{item.confidence}</span>
                </div>
                <div className="history-location">{item.region_or_city}</div>
              </div>
            ))
          )}
        </div>
        {history.length > 0 && <button onClick={clearHistory} className="clear-history-btn">Clear History</button>}
      </div>

      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="header-brand">
            <div className="logo">
              <TextAnimator className="logo-text" trigger="hover" colors={['#667eea', '#4facfe']}>GeoSINT</TextAnimator>
              <span className="logo-badge">v2.7</span>
            </div>
          </div>
          <div className="header-actions">
            <button className="history-toggle-btn" onClick={() => setShowHistory(!showHistory)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">

          {/* Mode Selector */}
          <div className="mode-selector">
            <div className="mode-buttons">
              <button
                className={`mode-btn ${analysisMode === 'ai' ? 'active' : ''}`}
                onClick={() => switchMode('ai')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <div className="mode-info">
                  <span className="mode-title">AI Investigation</span>
                  <span className="mode-desc">Deep Analysis (1-10 Images)</span>
                </div>
              </button>

              <button
                className={`mode-btn ${analysisMode === 'lens' ? 'active' : ''}`}
                onClick={() => switchMode('lens')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <div className="mode-info">
                  <span className="mode-title">Google Lens</span>
                  <span className="mode-desc">Visual Web Search</span>
                </div>
              </button>
            </div>
          </div>

          {/* Unified Upload Area */}
          <div className="upload-section">
            {showPasteHint && (
              <div className="paste-notification">Image pasted!</div>
            )}

            <div
              className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={(e) => {
                // Only trigger click if not clicking on a remove button
                if (!(e.target as HTMLElement).closest('.remove-image-btn')) {
                  fileInputRef.current?.click();
                }
              }}
            >
              {selectedFiles.length === 0 ? (
                <div className="upload-placeholder">
                  <div className="upload-icon">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7,10 12,15 17,10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <h3>{analysisMode === 'ai' ? 'Drop images here' : 'Drop image for Lens'}</h3>
                  <p>{analysisMode === 'ai' ? 'Upload 1 or more images for Context + Detail analysis' : 'Find this image on the web'}</p>
                  <div className="upload-methods">
                    <span className="file-types">JPG, PNG, GIF • Max 10MB</span>
                    <div className="paste-hint">Ctrl+V to paste</div>
                  </div>
                </div>
              ) : (
                <div className="multi-preview-grid">
                  {previewUrls.map((url, index) => (
                    <div key={index} className="multi-preview-item" onClick={(e) => e.stopPropagation()}>
                      <img src={url} alt={`Preview ${index}`} className="multi-preview-image" />
                      <button onClick={() => removeImage(index)} className="remove-image-btn">×</button>
                    </div>
                  ))}
                  {analysisMode === 'ai' && selectedFiles.length < 10 && (
                    <div className="add-more-card" onClick={() => fileInputRef.current?.click()}>
                      <span>+ Add Image</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple={analysisMode === 'ai'}
              onChange={handleFileChange}
              className="file-input"
              style={{ display: 'none' }}
            />

            <div className="action-section">
              <button
                onClick={handleAnalyzeClick}
                disabled={selectedFiles.length === 0 || isLoading}
                className="analyze-btn"
              >
                {isLoading ? <div className="spinner"></div> : 'Analyze Evidence'}
              </button>
              {selectedFiles.length > 0 && (
                <button onClick={clearAll} className="clear-btn" style={{ marginLeft: '1rem' }}>Clear All</button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && <div className="error-card">{error}</div>}

          {/* Results */}
          {analysis && (
            <div className="results-section">
              <div className="results-header">
                <h3>Analysis Results</h3>
                <div className="confidence-badge">
                  <span className="confidence-label">Confidence</span>
                  <span className="confidence-value">{analysis.confidence}</span>
                </div>
              </div>

              <div className="location-grid">
                <div className="location-item">
                  <span className="label">Country</span>
                  <span className="value">{analysis.country}</span>
                </div>
                <div className="location-item">
                  <span className="label">Region</span>
                  <span className="value">{analysis.region_or_city}</span>
                </div>
                <div className="location-item">
                  <span className="label">Coordinates</span>
                  <span className="value coordinates">{analysis.coordinates}</span>
                </div>
              </div>

              {/* Map Visualization */}
              {viewCoordinates && (
                <div className="map-section">
                  <div className="map-header">
                    <h4>Location Visualization</h4>
                    <div className="map-actions">
                      <button onClick={() => openInGoogleMaps(viewCoordinates.lat, viewCoordinates.lng)} className="map-btn google-maps-btn">Google Maps</button>
                      <button onClick={() => openInGoogleStreetView(viewCoordinates.lat, viewCoordinates.lng)} className="map-btn street-view-btn">Street View</button>
                      <button onClick={() => copyCoordinates(viewCoordinates.lat, viewCoordinates.lng)} className="map-btn copy-btn" title="Copy Coordinates">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="map-container">
                    <iframe
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${viewCoordinates.lng - 0.01},${viewCoordinates.lat - 0.01},${viewCoordinates.lng + 0.01},${viewCoordinates.lat + 0.01}&layer=mapnik&marker=${viewCoordinates.lat},${viewCoordinates.lng}`}
                      width="100%"
                      height="400"
                      style={{ border: 0, borderRadius: '8px' }}
                      allowFullScreen
                    />
                  </div>
                </div>
              )}

              {/* Alternatives */}
              {analysis.detailed_analysis?.alternative_locations && analysis.detailed_analysis.alternative_locations.length > 0 && (
                <div className="alternatives-section">
                  <h4>Alternative Locations</h4>
                  <div className="alternatives-list">
                    {analysis.detailed_analysis.primary_coordinates && (
                      <div
                        className={`alt-location-item ${viewCoordinates?.lat === analysis.detailed_analysis.primary_coordinates.lat ? 'active' : ''}`}
                        onClick={() => setViewCoordinates(analysis.detailed_analysis!.primary_coordinates as { lat: number, lng: number })}
                      >
                        <div className="alt-info">
                          <strong>Primary Match</strong>
                          <span className="alt-coords">{analysis.detailed_analysis.primary_coordinates.lat?.toFixed(4)}, {analysis.detailed_analysis.primary_coordinates.lng?.toFixed(4)}</span>
                          {analysis.detailed_analysis.final_assessment?.certainty_percentage && (
                            <span className="alt-probability">{analysis.detailed_analysis.final_assessment.certainty_percentage}%</span>
                          )}
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.alternative_locations.map((alt, idx) => (
                      alt.lat && alt.lng && (
                        <div
                          key={idx}
                          className={`alt-location-item ${viewCoordinates?.lat === alt.lat ? 'active' : ''}`}
                          onClick={() => setViewCoordinates({ lat: alt.lat!, lng: alt.lng! })}
                        >
                          <div className="alt-info">
                            <strong>{alt.location_name || `Alternative ${idx + 1}`}</strong>
                            <span className="alt-coords">{alt.lat.toFixed(4)}, {alt.lng.toFixed(4)}</span>
                            {alt.probability && <span className="alt-probability">{alt.probability}%</span>}
                          </div>
                          {alt.description && <span className="alt-description">{alt.description}</span>}
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence Breakdown */}
              {analysis.detailed_analysis?.evidence && (
                <div className="evidence-section">
                  <h4>Evidence Analysis</h4>
                  <div className="evidence-grid">
                    {analysis.detailed_analysis.evidence.signage && analysis.detailed_analysis.evidence.signage !== "None visible" && (
                      <div className="evidence-item">
                        <div className="evidence-icon">📝</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Signage & Text</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.signage}</span>
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.evidence.infrastructure && (
                      <div className="evidence-item">
                        <div className="evidence-icon">🛣️</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Infrastructure</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.infrastructure}</span>
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.evidence.architecture && (
                      <div className="evidence-item">
                        <div className="evidence-icon">🏛️</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Architecture</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.architecture}</span>
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.evidence.environment && (
                      <div className="evidence-item">
                        <div className="evidence-icon">🌿</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Environment</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.environment}</span>
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.evidence.cultural_elements && (
                      <div className="evidence-item">
                        <div className="evidence-icon">🎭</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Cultural Elements</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.cultural_elements}</span>
                        </div>
                      </div>
                    )}
                    {analysis.detailed_analysis.evidence.vehicles && (
                      <div className="evidence-item">
                        <div className="evidence-icon">🚗</div>
                        <div className="evidence-content">
                          <span className="evidence-label">Vehicles</span>
                          <span className="evidence-value">{analysis.detailed_analysis.evidence.vehicles}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Methodology Section */}
              {analysis.detailed_analysis?.methodology && (
                <div className="methodology-section">
                  <h4>Analysis Methodology</h4>
                  <div className="methodology-grid">
                    {analysis.detailed_analysis.methodology.key_indicators && analysis.detailed_analysis.methodology.key_indicators.length > 0 && (
                      <div className="methodology-item key-indicators">
                        <span className="methodology-label">Key Indicators</span>
                        <ul className="methodology-list">
                          {analysis.detailed_analysis.methodology.key_indicators.map((indicator, idx) => (
                            <li key={idx}>{indicator}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.detailed_analysis.methodology.eliminated_regions && analysis.detailed_analysis.methodology.eliminated_regions.length > 0 && (
                      <div className="methodology-item eliminated">
                        <span className="methodology-label">Eliminated Regions</span>
                        <ul className="methodology-list">
                          {analysis.detailed_analysis.methodology.eliminated_regions.map((region, idx) => (
                            <li key={idx}>{region}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysis.detailed_analysis.methodology.limiting_factors && analysis.detailed_analysis.methodology.limiting_factors.length > 0 && (
                      <div className="methodology-item limiting">
                        <span className="methodology-label">Limiting Factors</span>
                        <ul className="methodology-list">
                          {analysis.detailed_analysis.methodology.limiting_factors.map((factor, idx) => (
                            <li key={idx}>{factor}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Reasoning */}
              <div className="reasoning-section">
                <h4>Analysis Summary</h4>
                <div className="reasoning-content">{analysis.reasoning}</div>

                {/* Final Assessment */}
                {analysis.detailed_analysis?.final_assessment && (
                  <div className="final-assessment">
                    <div className="assessment-header">
                      <span className="assessment-location">{analysis.detailed_analysis.final_assessment.most_probable_location}</span>
                      <span className="assessment-certainty">{analysis.detailed_analysis.final_assessment.certainty_percentage}% Certainty</span>
                    </div>
                    {analysis.detailed_analysis.final_assessment.primary_landmark && (
                      <div className="assessment-landmark">
                        <strong>Primary Landmark:</strong> {analysis.detailed_analysis.final_assessment.primary_landmark}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Verification Suggestions */}
              {analysis.detailed_analysis?.final_assessment?.verification_suggestions && analysis.detailed_analysis.final_assessment.verification_suggestions.length > 0 && (
                <div className="verification-section">
                  <h4>Verification Steps</h4>
                  <ul className="verification-list">
                    {analysis.detailed_analysis.final_assessment.verification_suggestions.map((suggestion, idx) => (
                      <li key={idx}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* OSINT Notes */}
              {analysis.detailed_analysis?.final_assessment?.osint_notes && (
                <div className="osint-notes-section">
                  <h4>OSINT Notes</h4>
                  <div className="osint-notes-content">{analysis.detailed_analysis.final_assessment.osint_notes}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;