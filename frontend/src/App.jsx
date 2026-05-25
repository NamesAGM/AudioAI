import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Dashboard from './components/Dashboard';
import { AudioLines, LogIn, UserPlus, ShieldAlert, Sparkles, User, KeyRound, Mail } from 'lucide-react';

// Utility to generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Attempt to initialize Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let isSandboxMode = true;

if (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'your-supabase-url') {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    isSandboxMode = false;
  } catch (error) {
    console.warn('Supabase initialization failed, falling back to Sandbox Mode:', error);
  }
}

// Generate a stable sandbox user ID (stored in localStorage to persist across sessions)
const SANDBOX_USER_ID_KEY = 'audioai_sandbox_user_id';
function getSandboxUserId() {
  let userId = localStorage.getItem(SANDBOX_USER_ID_KEY);
  if (!userId) {
    userId = generateUUID();
    localStorage.setItem(SANDBOX_USER_ID_KEY, userId);
  }
  return userId;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isSandboxMode) {
      // Auto-login sandbox session with proper UUID
      setSession({
        user: {
          id: getSandboxUserId(),
          email: 'sandbox@audioai.dev',
          user_metadata: { full_name: 'Sandbox Developer' }
        }
      });
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    if (isSandboxMode) {
      // Local Sandbox mock auth
      setTimeout(() => {
        setSession({
          user: {
            id: 'sandbox-user-id-12345',
            email: email || 'sandbox@audioai.dev',
            user_metadata: { full_name: fullName || 'Sandbox User' }
          }
        });
        setLoading(false);
      }, 500);
      return;
    }

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            }
          }
        });
        if (error) throw error;
        
        // Supabase sometimes requires email confirmation before session creation
        if (data.session) {
          setSession(data.session);
        } else {
          setSuccessMsg('Registration successful! Please check your email to verify your account.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (error) {
      setErrorMsg(error.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (isSandboxMode) {
      setSession(null);
      return;
    }
    await supabase.auth.signOut();
  };

  // If user is authenticated, render the Dashboard
  if (session) {
    return (
      <div className="relative min-h-screen flex flex-col">
        {/* Sandbox banner if applicable */}
        {isSandboxMode && (
          <div className="bg-violet-950/80 border-b border-violet-800/40 text-violet-200 text-xs py-1.5 px-4 flex items-center justify-center gap-2 backdrop-blur-sm z-50">
            <ShieldAlert className="w-3.5 h-3.5 text-violet-400" />
            <span><strong>Sandbox Mode Active</strong>: Converting locally using free Edge-TTS fallback. SQLite database and local folder file storage enabled.</span>
          </div>
        )}
        <Dashboard 
          session={session} 
          supabase={supabase} 
          isSandboxMode={isSandboxMode} 
          onSignOut={handleSignOut} 
        />
      </div>
    );
  }

  // Otherwise, render the Login/Signup Screen
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {/* Background Decorative Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-violet-600/10 blur-3xl pointer-events-none"></div>
      
      {/* Logo/Brand */}
      <div className="flex items-center gap-2.5 mb-8 animate-fade-in">
        <div className="p-2.5 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-2xl shadow-lg shadow-violet-500/20">
          <AudioLines className="w-8 h-8 text-white" />
        </div>
        <span className="text-3xl font-extrabold tracking-tight text-white font-outfit bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
          Audio<span className="text-violet-400">AI</span>
        </span>
      </div>

      {/* Auth Card */}
      <div className="w-full max-w-md glass-panel p-8 rounded-3xl animate-scale-up">
        <h2 className="text-2xl font-bold font-outfit text-white mb-2 text-center">
          {authMode === 'login' ? 'Welcome Back' : 'Create an Account'}
        </h2>
        <p className="text-slate-400 text-sm text-center mb-6">
          {authMode === 'login' 
            ? 'Transform your documents into natural-sounding speech.' 
            : 'Sign up to start converting PDFs to audio books.'}
        </p>

        {errorMsg && (
          <div className="mb-4 p-3.5 bg-rose-950/40 border border-rose-800/40 text-rose-200 rounded-xl text-xs flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3.5 bg-emerald-950/40 border border-emerald-800/40 text-emerald-200 rounded-xl text-xs flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {authMode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Full Name</label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-sm glass-input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm glass-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm glass-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 mt-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-violet-600/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? 'Processing...' : authMode === 'login' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-800/40 text-center">
          <button
            type="button"
            className="text-xs text-violet-400 hover:text-violet-300 font-medium transition-all"
            onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
          >
            {authMode === 'login' 
              ? "Don't have an account? Sign Up" 
              : "Already have an account? Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}
