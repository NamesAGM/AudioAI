import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Upload, Volume2, LogOut, Play, Pause, Download, Trash2, 
  RefreshCw, CheckCircle2, AlertCircle, Clock, VolumeX, SkipBack, SkipForward
} from 'lucide-react';

// Get backend API URL from environment variable
const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export default function Dashboard({ session, supabase, isSandboxMode, onSignOut }) {
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('en-US-AvaNeural');
  const [speed, setSpeed] = useState(1.0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  
  // Custom Audio Player State
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  const userName = session?.user?.user_metadata?.full_name || userEmail?.split('@')[0];

  // Fetch available voices and user conversion history on mount
  useEffect(() => {
    fetchVoices();
    fetchUserJobs();
  }, [userId]);

  // Set up polling for pending/processing jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => j.status === 'pending' || j.status === 'processing');
    
    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      fetchUserJobs();
    }, 3000);

    return () => clearInterval(interval);
  }, [jobs]);

  // Manage Audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  // Apply playback speed and volume to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted, audioUrl]);

  const fetchVoices = async () => {
    try {
      const res = await fetch(`${API_URL}/api/voices`);
      if (res.ok) {
        const data = await res.json();
        setVoices(data);
        // Set first voice as default
        if (data.length > 0) {
          // Prefer Edge TTS voices as primary/default for everyone
          const defaultVoice = data.find(v => v.provider === 'edge');
          if (defaultVoice) {
            setSelectedVoice(defaultVoice.id);
          } else {
            setSelectedVoice(data[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching voices:', err);
    }
  };

  const fetchUserJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/users/${userId}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
        
        // If our active job has finished processing, update activeJob state
        if (activeJob) {
          const updatedActive = data.find(j => j.id === activeJob.id);
          if (updatedActive && updatedActive.status !== activeJob.status) {
            setActiveJob(updatedActive);
            if (updatedActive.status === 'completed' && updatedActive.audio_url) {
              setAudioUrl(updatedActive.audio_url);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching jobs:', err);
    }
  };

  // Drag and Drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        selectFile(file);
      } else {
        alert("Only PDF files are supported");
      }
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      selectFile(e.target.files[0]);
    }
  };

  const selectFile = (selectedFile) => {
    setFile(selectedFile);
    // Create preview URL
    const url = URL.createObjectURL(selectedFile);
    setPdfPreviewUrl(url);
  };

  // Submit to Backend for conversion
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsSubmitting(true);
    const voiceObj = voices.find(v => v.id === selectedVoice) || {};

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);
    formData.append('voice_name', selectedVoice);
    formData.append('language_code', voiceObj.lang || 'en-US');
    formData.append('speaking_rate', speed.toString());
    formData.append('gender', voiceObj.gender || 'FEMALE');

    try {
      const res = await fetch(`${API_URL}/api/convert`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Conversion failed to start');
      }

      const job = await res.json();
      
      // Reset upload state
      setFile(null);
      setPdfPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Refresh jobs list
      await fetchUserJobs();
      
      // Auto-focus the new job
      const createdJob = {
        id: job.job_id,
        filename: job.filename,
        status: job.status,
        pdf_url: `/static/uploads/${job.job_id}.pdf`
      };
      setActiveJob(createdJob);
      setAudioUrl(null); // Wait for processing
      
    } catch (err) {
      alert(`Error starting conversion: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Audio Playback Triggers
  const handlePlayJob = (job) => {
    setActiveJob(job);
    if (job.status === 'completed' && job.audio_url) {
      setAudioUrl(job.audio_url);
      setIsPlaying(true);
      // If audio element exists, play it
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play().catch(e => console.warn(e));
        }
      }, 50);
    } else {
      setAudioUrl(null);
      setIsPlaying(false);
    }
    // Set PDF preview (either uploaded blob or hosted PDF url)
    setPdfPreviewUrl(job.pdf_url);
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => console.error(err));
    }
  };

  const handleTimeSeek = (e) => {
    const seekTime = parseFloat(e.target.value);
    setCurrentTime(seekTime);
    if (audioRef.current) {
      audioRef.current.currentTime = seekTime;
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return "00:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const skipTime = (seconds) => {
    if (audioRef.current) {
      let target = audioRef.current.currentTime + seconds;
      if (target < 0) target = 0;
      if (target > duration) target = duration;
      audioRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="glass-panel border-b border-slate-800/40 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-xl">
            <Volume2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-outfit text-xl font-bold text-white tracking-wide">
            Audio<span className="text-violet-400">AI</span> Studio
          </span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/50 border border-slate-800/40">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-semibold text-slate-300">Welcome, {userName}</span>
          </div>
          <button 
            onClick={onSignOut} 
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Studio Area */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Section: Creator Controls & History */}
        <section className="w-1/2 p-6 flex flex-col gap-6 overflow-y-auto border-r border-slate-800/40">
          
          {/* Uploader Card */}
          <div className="glass-panel p-6 rounded-2xl">
            <h2 className="text-lg font-bold text-white font-outfit mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-violet-400" />
              <span>Convert PDF to Speech</span>
            </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Drag & Drop File Zone */}
              <div 
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                  dragActive 
                    ? 'border-violet-500 bg-violet-600/5' 
                    : file 
                      ? 'border-emerald-600/50 bg-emerald-500/5' 
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/30'
                }`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf"
                  onChange={handleFileInput}
                />
                
                {file ? (
                  <div className="flex flex-col items-center">
                    <FileText className="w-10 h-10 text-emerald-400 mb-2" />
                    <span className="text-sm font-semibold text-white max-w-xs truncate mb-1">{file.name}</span>
                    <span className="text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    <button 
                      type="button"
                      onClick={() => { setFile(null); setPdfPreviewUrl(null); }}
                      className="mt-3 text-xs text-rose-400 hover:text-rose-300 font-semibold transition"
                    >
                      Remove file
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="w-10 h-10 text-slate-500 mb-3" />
                    <p className="text-sm text-slate-300 mb-1">
                      Drag and drop your PDF here, or{' '}
                      <button 
                        type="button" 
                        onClick={() => fileInputRef.current?.click()} 
                        className="text-violet-400 hover:text-violet-300 font-bold underline"
                      >
                        browse files
                      </button>
                    </p>
                    <p className="text-xs text-slate-500">Only selectable text PDFs supported. Max 20MB.</p>
                  </div>
                )}
              </div>

              {/* Voice and Speech Engine Configuration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Voice Profile</label>
                  <select 
                    className="w-full p-2.5 rounded-lg text-sm glass-input"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                  >
                    {voices.map(voice => (
                      <option key={voice.id} value={voice.id} className="bg-slate-950 text-white">
                        {voice.name} ({voice.provider.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Reading Speed ({speed}x)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.75"
                      max="1.5"
                      step="0.05"
                      className="flex-1 accent-violet-500 h-1 rounded-lg bg-slate-800"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              {/* Trigger Button */}
              <button
                type="submit"
                disabled={!file || isSubmitting}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-sm rounded-xl transition duration-200 shadow-lg shadow-violet-600/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Uploading and processing...</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4" />
                    <span>Convert to Audio Book</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* History / Conversion Queue */}
          <div className="flex-1 glass-panel p-6 rounded-2xl flex flex-col overflow-hidden min-h-[300px]">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <h2 className="text-lg font-bold text-white font-outfit">My Conversions</h2>
              <button 
                onClick={fetchUserJobs}
                className="p-1.5 hover:bg-slate-800/40 text-slate-400 hover:text-white rounded-lg transition"
                title="Refresh jobs status"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {jobs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 py-8">
                  <Clock className="w-8 h-8 text-slate-600" />
                  <p className="text-sm font-medium">No conversion jobs found.</p>
                  <p className="text-xs text-slate-600">Upload a PDF above to get started!</p>
                </div>
              ) : (
                jobs.map(job => {
                  const isActive = activeJob?.id === job.id;
                  
                  return (
                    <div 
                      key={job.id} 
                      onClick={() => handlePlayJob(job)}
                      className={`p-4 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                        isActive 
                          ? 'bg-violet-950/20 border-violet-500/50' 
                          : 'bg-slate-900/30 hover:bg-slate-900/50 border-slate-800/40 hover:border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Status Icon Indicator */}
                        <div>
                          {job.status === 'completed' && (
                            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                              <CheckCircle2 className="w-4.5 h-4.5" />
                            </div>
                          )}
                          {job.status === 'processing' && (
                            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                              <RefreshCw className="w-4.5 h-4.5 animate-spin" />
                            </div>
                          )}
                          {job.status === 'pending' && (
                            <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg">
                              <Clock className="w-4.5 h-4.5 animate-pulse" />
                            </div>
                          )}
                          {job.status === 'failed' && (
                            <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg" title={job.error_message}>
                              <AlertCircle className="w-4.5 h-4.5" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate" title={job.filename}>
                            {job.filename}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                            <span className="capitalize">{job.status}</span>
                            <span>•</span>
                            <span>{new Date(job.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action trigger */}
                      {job.status === 'completed' && (
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handlePlayJob(job)}
                            className="p-2 hover:bg-violet-600 text-slate-400 hover:text-white rounded-lg transition"
                          >
                            <Play className="w-4 h-4 fill-current" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Right Section: PDF Document Visualizer */}
        <section className="w-1/2 p-6 flex flex-col overflow-hidden bg-slate-950/20">
          <div className="flex-1 glass-panel rounded-2xl overflow-hidden flex flex-col">
            {/* Header bar */}
            <div className="bg-slate-950/50 border-b border-slate-800/40 px-5 py-3.5 flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-slate-300 font-outfit">Document Viewer</span>
              {activeJob && (
                <span className="text-xs text-slate-400 max-w-[200px] truncate" title={activeJob.filename}>
                  {activeJob.filename}
                </span>
              )}
            </div>

            {/* Embed container */}
            <div className="flex-1 bg-slate-950/50 relative">
              {pdfPreviewUrl ? (
                <object
                  data={pdfPreviewUrl}
                  type="application/pdf"
                  className="w-full h-full border-0"
                >
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-500">
                    <FileText className="w-12 h-12 mb-3 text-slate-600" />
                    <p className="text-sm font-semibold">PDF Viewer is blocked or not supported by your browser.</p>
                    <a 
                      href={pdfPreviewUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="mt-2 text-xs text-violet-400 underline font-bold"
                    >
                      Open PDF in a new tab
                    </a>
                  </div>
                </object>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                  <FileText className="w-16 h-16 text-slate-800 mb-4" />
                  <p className="text-sm font-semibold font-outfit text-slate-400">No document selected</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-[250px]">
                    Select a job in history or upload a new PDF to preview it here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Floating Audio Controller (Sticky Bottom) */}
      <footer className="glass-panel border-t border-slate-800/40 px-8 py-5 shrink-0 bg-slate-950/80 backdrop-blur-xl z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-6">
          {/* Audio Tag */}
          {audioUrl && (
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              autoPlay={isPlaying}
            />
          )}

          {/* Current Selection details */}
          <div className="w-1/4 min-w-0">
            {activeJob ? (
              <>
                <p className="text-sm font-bold text-white truncate" title={activeJob.filename}>
                  {activeJob.filename}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {activeJob.status === 'completed' ? 'Ready to stream' : `Status: ${activeJob.status}`}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-500">No active audio</p>
                <p className="text-xs text-slate-600">Select a file from conversions</p>
              </>
            )}
          </div>

          {/* Playback Controls & Progress */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <div className="flex items-center gap-4">
              {/* Skip Back 10s */}
              <button 
                onClick={() => skipTime(-10)} 
                disabled={!audioUrl}
                className="p-2 hover:bg-slate-800/50 text-slate-400 hover:text-white rounded-full transition disabled:opacity-40"
                title="Skip back 10 seconds"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              {/* Play / Pause Toggle */}
              <button 
                onClick={togglePlay}
                disabled={!audioUrl}
                className="p-3.5 bg-violet-600 hover:bg-violet-500 text-white rounded-full transition shadow-lg shadow-violet-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
              >
                {isPlaying ? <Pause className="w-5.5 h-5.5 fill-current" /> : <Play className="w-5.5 h-5.5 fill-current translate-x-[1px]" />}
              </button>

              {/* Skip Forward 10s */}
              <button 
                onClick={() => skipTime(10)} 
                disabled={!audioUrl}
                className="p-2 hover:bg-slate-800/50 text-slate-400 hover:text-white rounded-full transition disabled:opacity-40"
                title="Skip forward 10 seconds"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Time scrub progress bar */}
            <div className="w-full flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-400 w-10 text-right">{formatTime(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={duration || 0}
                value={currentTime}
                onChange={handleTimeSeek}
                disabled={!audioUrl}
                className="flex-1 h-1.5 rounded-full accent-violet-500 bg-slate-800 cursor-pointer disabled:opacity-40"
              />
              <span className="text-xs font-semibold text-slate-400 w-10">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Speed settings & Volume controls */}
          <div className="w-1/4 flex items-center justify-end gap-4">
            {/* Speed Multiplier selectors */}
            <div className="flex items-center gap-1.5">
              {[0.75, 1.0, 1.25, 1.5].map(v => (
                <button
                  key={v}
                  onClick={() => setPlaybackSpeed(v)}
                  disabled={!audioUrl}
                  className={`px-2 py-1 text-[10px] font-bold rounded transition border ${
                    playbackSpeed === v 
                      ? 'bg-violet-600 border-violet-500 text-white' 
                      : 'bg-transparent border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                  } disabled:opacity-40`}
                >
                  {v}x
                </button>
              ))}
            </div>

            {/* Download Link */}
            {audioUrl && (
              <a
                href={audioUrl}
                download={activeJob ? `${activeJob.filename.replace('.pdf', '')}.mp3` : 'audio.mp3'}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                title="Download MP3"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
