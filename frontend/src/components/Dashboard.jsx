import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, Upload, Volume2, LogOut, Play, Pause, Download, Trash2, 
  RefreshCw, CheckCircle2, AlertCircle, Clock, VolumeX, SkipBack, SkipForward,
  Send, MessageSquare, Bot, Sparkles, User, Volume1
} from 'lucide-react';

// Get backend API URL from environment variable, window override, or same-origin fallback
const rawBackend = import.meta.env.VITE_BACKEND_URL;
const API_URL = rawBackend || window?.__BACKEND_URL || window.location.origin || 'http://localhost:8000';
console.info('Using backend API_URL:', API_URL);

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
  
  // Tab control for right side (PDF Viewer vs Chat)
  const [rightTab, setRightTab] = useState('viewer');
  
  // AI Chat states
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isGeneratingAnswer, setIsGeneratingAnswer] = useState(false);
  const [readAloudAnswer, setReadAloudAnswer] = useState(true);
  const [aiStatus, setAiStatus] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [isPlayingQaAudio, setIsPlayingQaAudio] = useState(false);
  const [playingQaMsgIndex, setPlayingQaMsgIndex] = useState(null);
  
  const audioRef = useRef(null);
  const qaAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatBottomRef = useRef(null);

  const userId = session?.user?.id;
  const userEmail = session?.user?.email;
  const userName = session?.user?.user_metadata?.full_name || userEmail?.split('@')[0];

  // Fetch available voices and user conversion history on mount
  useEffect(() => {
    fetchVoices();
    fetchUserJobs();
    fetchAiStatus();
  }, [userId]);

  // Scroll to bottom of chat when new messages appear
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isGeneratingAnswer]);

  // Manage QA Audio player events
  useEffect(() => {
    const qaAudio = qaAudioRef.current;
    if (!qaAudio) return;

    const onPlay = () => setIsPlayingQaAudio(true);
    const onEnded = () => {
      setIsPlayingQaAudio(false);
      setPlayingQaMsgIndex(null);
    };
    const onPause = () => setIsPlayingQaAudio(false);

    qaAudio.addEventListener('play', onPlay);
    qaAudio.addEventListener('ended', onEnded);
    qaAudio.addEventListener('pause', onPause);

    return () => {
      qaAudio.removeEventListener('play', onPlay);
      qaAudio.removeEventListener('ended', onEnded);
      qaAudio.removeEventListener('pause', onPause);
    };
  }, [rightTab]);

  const fetchAiStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/ai/status`);
      if (res.ok) {
        const data = await res.json();
        setAiStatus(data);
        if (data.model) {
          setSelectedModel(data.model);
        }
      }
    } catch (err) {
      console.error('Error fetching AI status:', err);
    }
  };

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
              const fullAudioUrl = updatedActive.audio_url.startsWith('http')
                ? updatedActive.audio_url
                : `${API_URL}${updatedActive.audio_url}`;
              setAudioUrl(fullAudioUrl);
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching jobs from', API_URL, err);
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
        pdf_url: `${API_URL}/static/uploads/${job.job_id}.pdf`
      };
      setActiveJob(createdJob);
      setAudioUrl(null); // Wait for processing
      
    } catch (err) {
      alert(`Error starting conversion: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAskQuestion = async (textToSend = null) => {
    const text = textToSend || chatInput;
    if (!text.trim() || !activeJob || isGeneratingAnswer) return;

    // Stop any currently playing QA audio
    if (qaAudioRef.current) {
      qaAudioRef.current.pause();
    }

    const newMsgIndex = chatMessages.length + 1; // user msg + ai msg
    const userMessage = { sender: 'user', text };
    
    setChatMessages(prev => [...prev, userMessage]);
    if (!textToSend) setChatInput('');
    setIsGeneratingAnswer(true);

    const voiceObj = voices.find(v => v.id === selectedVoice) || {};

    try {
      const res = await fetch(`${API_URL}/api/jobs/${activeJob.id}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: text,
          voice_name: selectedVoice,
          language_code: voiceObj.lang || 'en-US',
          speaking_rate: speed,
          gender: voiceObj.gender || 'FEMALE',
          read_aloud: readAloudAnswer,
          model: selectedModel || undefined
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to get answer');
      }

      const data = await res.json();
      
      const aiMessage = { 
        sender: 'ai', 
        text: data.answer, 
        audioUrl: data.audio_url 
      };
      
      setChatMessages(prev => [...prev, aiMessage]);
      
      // Auto-play TTS if available and requested
      if (data.audio_url && readAloudAnswer && qaAudioRef.current) {
        const fullAudioUrl = data.audio_url.startsWith('http')
          ? data.audio_url
          : `${API_URL}${data.audio_url}`;
        
        setPlayingQaMsgIndex(newMsgIndex);
        qaAudioRef.current.src = fullAudioUrl;
        qaAudioRef.current.play().catch(e => console.warn('Autoplay blocked:', e));
      }

    } catch (err) {
      setChatMessages(prev => [...prev, { 
        sender: 'ai', 
        text: `Error: Could not retrieve answer. (${err.message})`,
        isError: true
      }]);
    } finally {
      setIsGeneratingAnswer(false);
    }
  };

  const handlePlayQaAudio = (msgIndex, audioUrl) => {
    if (!qaAudioRef.current || !audioUrl) return;

    const fullAudioUrl = audioUrl.startsWith('http')
      ? audioUrl
      : `${API_URL}${audioUrl}`;

    if (playingQaMsgIndex === msgIndex && isPlayingQaAudio) {
      qaAudioRef.current.pause();
      setIsPlayingQaAudio(false);
      setPlayingQaMsgIndex(null);
    } else {
      setPlayingQaMsgIndex(msgIndex);
      qaAudioRef.current.src = fullAudioUrl;
      qaAudioRef.current.play().catch(e => console.warn(e));
    }
  };

  // Audio Playback Triggers
  const handlePlayJob = (job) => {
    setActiveJob(job);
    
    // Stop QA audio if playing
    if (qaAudioRef.current) {
      qaAudioRef.current.pause();
      setIsPlayingQaAudio(false);
      setPlayingQaMsgIndex(null);
    }
    
    // Set up chat greeting for this specific file
    setChatMessages([
      { 
        sender: 'ai', 
        text: `Hi! I've loaded "${job.filename}". Ask me anything about this document!`,
        isGreeting: true 
      }
    ]);
    
    if (job.status === 'completed' && job.audio_url) {
      const fullAudioUrl = job.audio_url.startsWith('http')
        ? job.audio_url
        : `${API_URL}${job.audio_url}`;
      setAudioUrl(fullAudioUrl);
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
    const fullPdfUrl = job.pdf_url.startsWith('http')
      ? job.pdf_url
      : `${API_URL}${job.pdf_url}`;
    setPdfPreviewUrl(fullPdfUrl);
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
      <header className="glass-panel border-b border-slate-800/40 px-4 md:px-6 py-3.5 md:py-4 flex flex-col sm:flex-row gap-3 sm:gap-0 items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-xl">
            <Volume2 className="w-5 h-5 text-white" />
          </div>
          <span className="font-outfit text-xl font-bold text-white tracking-wide">
            Audio<span className="text-violet-400">AI</span> Studio
          </span>
        </div>
        
        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 w-full sm:w-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/50 border border-slate-800/40">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-semibold text-slate-300 truncate max-w-[120px] sm:max-w-none">Welcome, {userName}</span>
          </div>
          <button 
            onClick={onSignOut} 
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Studio Area */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden pb-48 lg:pb-0">
        {/* Left Section: Creator Controls & History */}
        <section className="w-full lg:w-1/2 p-4 md:p-6 flex flex-col gap-6 overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-800/40">
          
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <div className="flex items-center gap-3 h-10">
                    <input
                      type="range"
                      min="0.75"
                      max="1.5"
                      step="0.05"
                      className="flex-1 accent-violet-500 h-1 rounded-lg bg-slate-800 cursor-pointer"
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
        {/* Right Section: PDF Document Visualizer & AI Chat */}
        <section className="w-full lg:w-1/2 h-[450px] sm:h-[600px] lg:h-auto p-4 md:p-6 flex flex-col bg-slate-950/20">
          <div className="flex-1 glass-panel rounded-2xl overflow-hidden flex flex-col h-full">
            {/* Header bar with Tab selector */}
            <div className="bg-slate-950/50 border-b border-slate-800/40 px-5 py-2 flex items-center justify-between shrink-0">
              <div className="flex gap-2">
                <button
                  onClick={() => setRightTab('viewer')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-outfit transition cursor-pointer ${
                    rightTab === 'viewer'
                      ? 'bg-slate-800 text-white border border-slate-700/60'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    <span>Document Viewer</span>
                  </div>
                </button>
                <button
                  onClick={() => setRightTab('chat')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold font-outfit transition cursor-pointer ${
                    rightTab === 'chat'
                      ? 'bg-violet-600 text-white border border-violet-500/60'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat with PDF</span>
                    {aiStatus?.status && aiStatus?.status !== 'error' && aiStatus?.status !== 'offline' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    )}
                  </div>
                </button>
              </div>
              
              {activeJob && (
                <span className="text-xs text-slate-400 max-w-[150px] md:max-w-[200px] truncate" title={activeJob.filename}>
                  {activeJob.filename}
                </span>
              )}
            </div>

            {/* Embed container / Chat container */}
            <div className="flex-1 bg-slate-950/50 relative overflow-hidden flex flex-col">
              {rightTab === 'viewer' ? (
                // PDF Viewer Tab
                pdfPreviewUrl ? (
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
                )
              ) : (
                // AI Chat Tab
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  {/* Connection status banner */}
                  <div className="px-4 py-2 border-b border-slate-800/40 bg-slate-900/30 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-4 h-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-300">
                        {aiStatus?.status === 'connected' || aiStatus?.status === 'configured'
                          ? `AI Engine: ${aiStatus.provider.toUpperCase()} (${aiStatus.model || 'Active'})`
                          : aiStatus?.status === 'error'
                          ? `AI Configuration Error`
                          : aiStatus?.status === 'offline'
                          ? `Ollama Offline (Local Mode)`
                          : `Connecting to Cloud AI...`}
                      </span>
                    </div>
                    {chatMessages.length > 1 && (
                      <button 
                        onClick={() => setChatMessages([chatMessages[0]])} 
                        className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
                        title="Clear conversation history"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Messages container */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {!activeJob ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 text-center p-6">
                        <MessageSquare className="w-12 h-12 text-slate-800 mb-2" />
                        <p className="text-sm font-semibold text-slate-400 font-outfit">Chat is locked</p>
                        <p className="text-xs text-slate-600 max-w-[240px]">
                          Please select a completed PDF document from your conversions list to start asking questions.
                        </p>
                      </div>
                    ) : (
                      <>
                        {chatMessages.map((msg, index) => {
                          const isAi = msg.sender === 'ai';
                          const isPlayingThis = playingQaMsgIndex === index && isPlayingQaAudio;

                          return (
                            <div 
                              key={index}
                              className={`flex gap-3 ${isAi ? 'justify-start' : 'justify-end'}`}
                            >
                              {isAi && (
                                <div className="w-8 h-8 rounded-full bg-violet-600/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                                </div>
                              )}
                              
                              <div className="flex flex-col gap-1 max-w-[80%]">
                                <div 
                                  className={`p-3.5 rounded-2xl text-sm leading-relaxed ${
                                    isAi 
                                      ? msg.isError 
                                        ? 'bg-rose-950/20 border border-rose-500/30 text-rose-300'
                                        : 'bg-slate-900/40 border border-slate-800/60 text-slate-100' 
                                      : 'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-tr-none'
                                  }`}
                                >
                                  <p className="whitespace-pre-line font-outfit select-text">{msg.text}</p>
                                  
                                  {/* AI Play TTS button */}
                                  {isAi && msg.audioUrl && (
                                    <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center gap-2">
                                      <button
                                        onClick={() => handlePlayQaAudio(index, msg.audioUrl)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                          isPlayingThis
                                            ? 'bg-violet-600 text-white'
                                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white'
                                        }`}
                                      >
                                        <Volume2 className="w-3.5 h-3.5" />
                                        <span>{isPlayingThis ? 'Pause Voice' : 'Read Aloud'}</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-650 px-1 font-semibold">
                                  {isAi ? 'AI Assistant' : 'You'}
                                </span>
                              </div>

                              {!isAi && (
                                <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700/40 flex items-center justify-center shrink-0">
                                  <User className="w-3.5 h-3.5 text-slate-300" />
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Typing indicator */}
                        {isGeneratingAnswer && (
                          <div className="flex gap-3 justify-start">
                            <div className="w-8 h-8 rounded-full bg-violet-600/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                              <Sparkles className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
                            </div>
                            <div className="bg-slate-900/40 border border-slate-800/60 p-3.5 rounded-2xl flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                              <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                              <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                          </div>
                        )}
                        
                        <div ref={chatBottomRef} />
                      </>
                    )}
                  </div>

                  {/* Suggestions (visible when chat history contains only the greeting) */}
                  {activeJob && chatMessages.length === 1 && (
                    <div className="px-4 py-2.5 flex flex-wrap gap-2 shrink-0 border-t border-slate-800/20 bg-slate-950/20">
                      {[
                        "Summarize this document",
                        "What is this document about?",
                        "What are the main key points?"
                      ].map((sugg, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleAskQuestion(sugg)}
                          className="px-3 py-1.5 bg-slate-900/50 hover:bg-violet-950/20 border border-slate-800/40 hover:border-violet-500/30 rounded-xl text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer animate-fade-in"
                        >
                          {sugg}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Input Form */}
                  {activeJob && (
                    <div className="p-3.5 border-t border-slate-800/40 bg-slate-950/80 shrink-0 flex flex-col gap-2">
                      <form 
                        onSubmit={(e) => { e.preventDefault(); handleAskQuestion(); }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Ask a question about this PDF..."
                          disabled={isGeneratingAnswer}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm glass-input placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
                        />
                        <button
                          type="submit"
                          disabled={isGeneratingAnswer || !chatInput.trim()}
                          className="p-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl transition flex items-center justify-center cursor-pointer shadow-lg shadow-violet-600/10"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </form>
                      <div className="flex items-center justify-between gap-4 px-1 mt-1">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={readAloudAnswer}
                            onChange={(e) => setReadAloudAnswer(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-slate-800 text-violet-600 focus:ring-violet-500 bg-slate-900 accent-violet-600"
                          />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Auto-read answers aloud</span>
                        </label>
                        
                        {aiStatus?.models && aiStatus.models.length > 0 && (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">Model:</span>
                            <select
                              value={selectedModel}
                              onChange={(e) => setSelectedModel(e.target.value)}
                              className="text-[10px] font-semibold bg-slate-900/80 border border-slate-850 rounded px-2 py-0.5 text-slate-350 focus:outline-none focus:border-violet-500/40 cursor-pointer max-w-[155px] truncate"
                            >
                              {aiStatus.models.map((m) => {
                                const modelId = typeof m === 'string' ? m : m.id;
                                const modelName = typeof m === 'string' ? m : m.name;
                                return (
                                  <option key={modelId} value={modelId} className="bg-slate-950 text-white">
                                    {modelName}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Floating Audio Controller (Sticky/Fixed Bottom) */}
      <footer className="fixed lg:sticky bottom-0 left-0 right-0 glass-panel border-t border-slate-800/40 px-4 md:px-8 py-4 md:py-5 bg-slate-950/95 backdrop-blur-xl z-20">
        <div className="max-w-6xl mx-auto flex flex-col lg:flex-row items-center justify-between gap-4 lg:gap-6">
          {/* Audio Tag */}
          {audioUrl && (
            <audio 
              ref={audioRef} 
              src={audioUrl} 
              autoPlay={isPlaying}
              onCanPlay={() => {
                try {
                  if (audioRef.current) setDuration(audioRef.current.duration || 0);
                } catch (e) { console.warn('onCanPlay handler error', e); }
              }}
              onError={(e) => {
                console.error('Audio failed to load', audioUrl, e);
                // Friendly UI fallback for unsupported/missing sources
                alert('Audio failed to load. Check the backend is running and the audio file exists.');
                setAudioUrl(null);
                setIsPlaying(false);
              }}
            />
          )}

          {/* Q&A Audio element for Q&A TTS reading */}
          <audio 
            ref={qaAudioRef} 
            className="hidden" 
            onError={(e) => {
              console.error('QA audio failed to load', e);
              setIsPlayingQaAudio(false);
              setPlayingQaMsgIndex(null);
            }}
          />

          {/* Current Selection details */}
          <div className="w-full lg:w-1/4 min-w-0 text-center lg:text-left flex flex-col items-center lg:items-start">
            {activeJob ? (
              <>
                <p className="text-sm font-bold text-white truncate max-w-[280px] sm:max-w-md lg:max-w-xs" title={activeJob.filename}>
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
          <div className="w-full lg:flex-1 flex flex-col items-center gap-2">
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
          <div className="w-full lg:w-1/4 flex items-center justify-center lg:justify-end gap-3 md:gap-4 mt-1 lg:mt-0">
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
