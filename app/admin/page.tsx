'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldAlert,
  Play,
  Pause,
  RotateCcw,
  Square,
  Users,
  Heart,
  History,
  Trophy,
  Sliders,
  HelpCircle,
  Undo2,
  Edit,
  Save,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  Maximize2,
  LogOut,
  PlusCircle,
  Lock,
  FolderKanban,
  Gamepad2,
} from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'teams' | 'games' | 'projects' | 'puzzles' | 'audit' | 'leaderboard'>('overview');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [preflight, setPreflight] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modals / forms
  const [selectedTeam, setSelectedTeam] = useState<any | null>(null);
  const [lifelineModalTeam, setLifelineModalTeam] = useState<any | null>(null);
  const [isRegisteringTeam, setIsRegisteringTeam] = useState(false);
  const [registerTeam, setRegisterTeam] = useState({ name: '', loginId: '', password: '', projectId: '', members: ['', '', ''] });
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ loginId: string; password: string } | null>(null);
  const [credentialCopyMessage, setCredentialCopyMessage] = useState('');
  const [teamEditError, setTeamEditError] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [enabledGames, setEnabledGames] = useState<any[]>([]);
  const [gameLibrary, setGameLibrary] = useState<any[]>([]);
  const [availableGameCatalog, setAvailableGameCatalog] = useState<any[]>([]);
  const [gameLibraryLoading, setGameLibraryLoading] = useState(false);
  const [gameLibraryError, setGameLibraryError] = useState<string | null>(null);
  const [projectHints, setProjectHints] = useState<{ gameId: string; clueText: string }[]>([]);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [isProjectFormOpen, setIsProjectFormOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', description: '', snakeHint: '', pongHint: '', memoryHint: '' });
  const [projectError, setProjectError] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);

  // Leaderboard data
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [isFullScreenLeaderboard, setIsFullScreenLeaderboard] = useState(false);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [puzzles, setPuzzles] = useState<any[]>([]);
  const [puzzleEditorOpen, setPuzzleEditorOpen] = useState(false);
  const [selectedPuzzle, setSelectedPuzzle] = useState<any | null>(null);
  const [puzzleForm, setPuzzleForm] = useState({
    questionText: '',
    imageUrl: '',
    options: ['', '', '', ''],
    correctAnswer: '',
    enabled: true,
  });

  // Fetch admin data
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/overview');
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return;
      }
      const json = await res.json();
      if (res.ok) {
        setData(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchPreflight = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/preflight');
      const json = await res.json();
      if (res.ok) setPreflight(json);
    } catch (error) {
      console.error('Pre-flight check failed:', error);
    }
  }, []);

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const json = await res.json();
      if (res.ok && json.leaderboard) {
        setLeaderboardData(json.leaderboard);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Fetch audit logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit?limit=60');
      const json = await res.json();
      if (res.ok && json.logs) {
        setAuditLogs(json.logs);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/projects');
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return;
      }
      const json = await res.json();
      if (res.ok) {
        setProjects(json.projects || []);
        setEnabledGames(json.games || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [router]);

  const fetchGameLibrary = useCallback(async () => {
    setGameLibraryLoading(true);
    try {
      const res = await fetch('/api/admin/games');
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load game library.');
      setGameLibrary(json.games || []);
      setAvailableGameCatalog(json.catalog || []);
      setGameLibraryError(null);
    } catch (error) {
      setGameLibraryError(error instanceof Error ? error.message : 'Failed to load game library.');
    } finally {
      setGameLibraryLoading(false);
    }
  }, [router]);

  const handleAddCatalogGame = async (gameKey: string) => {
    setGameLibraryError(null);
    try {
      const res = await fetch('/api/admin/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add game.');
      await Promise.all([fetchGameLibrary(), fetchProjects(), fetchAuditLogs()]);
    } catch (error) {
      setGameLibraryError(error instanceof Error ? error.message : 'Failed to add game.');
    }
  };

  const handleToggleGame = async (game: any) => {
    setGameLibraryError(null);
    try {
      const res = await fetch('/api/admin/games/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_enabled',
          gameId: game.id,
          enabled: !game.enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update game.');
      await Promise.all([fetchGameLibrary(), fetchProjects(), fetchAuditLogs()]);
    } catch (error) {
      setGameLibraryError(error instanceof Error ? error.message : 'Failed to update game.');
    }
  };

  const fetchPuzzles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/puzzles');
      const json = await res.json();
      if (res.ok) setPuzzles(json.questions || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const savePuzzle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const res = await fetch('/api/admin/puzzles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: selectedPuzzle ? 'update' : 'create',
        questionId: selectedPuzzle?.id,
        ...puzzleForm,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || 'Failed to save recovery puzzle.');
      return;
    }
    setPuzzleEditorOpen(false);
    setSelectedPuzzle(null);
    setPuzzleForm({ questionText: '', imageUrl: '', options: ['', '', '', ''], correctAnswer: '', enabled: true });
    fetchPuzzles();
  };

  const handleSaveProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProject(true);
    setProjectError(null);
    try {
      const res = await fetch('/api/admin/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: selectedProject ? 'update' : 'create',
          ...(selectedProject ? { projectId: selectedProject.id } : {}),
          ...projectForm,
          hints: projectHints,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setProjectError(json.error || 'Failed to save project.');
        return;
      }
      setSelectedProject(null);
      setIsProjectFormOpen(false);
      setProjectForm({ name: '', description: '', snakeHint: '', pongHint: '', memoryHint: '' });
      fetchProjects();
      fetchAuditLogs();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Failed to save project.');
    } finally {
      setSavingProject(false);
    }
  };

  const handleRegisterTeam = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const members = registerTeam.members.map((member) => member.trim());
    if (members.length !== 3 || members.some((member) => !member)) {
      setRegisterError('Enter all 3 member names before registering the team.');
      return;
    }

    setRegistering(true);
    setRegisterError(null);
    try {
      const res = await fetch('/api/admin/teams/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: registerTeam.name.trim(),
          loginId: registerTeam.loginId.trim(),
          password: registerTeam.password,
          projectId: registerTeam.projectId || null,
          members,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRegisterError(json.error || 'Failed to register team.');
        return;
      }

      setCreatedCredentials(json.credentials);
      setCredentialCopyMessage('');
      setIsRegisteringTeam(false);
      setRegisterTeam({ name: '', loginId: '', password: '', projectId: '', members: ['', '', ''] });
      fetchData();
      fetchProjects();
      fetchAuditLogs();
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : 'Failed to register team.');
    } finally {
      setRegistering(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchLeaderboard();
    fetchAuditLogs();
    fetchProjects();
    fetchGameLibrary();
    fetchPuzzles();
    fetchPreflight();
    // Live polling every 3s
    const timer = setInterval(() => {
      fetchData();
      fetchLeaderboard();
      fetchProjects();
      fetchGameLibrary();
      fetchPuzzles();
      fetchPreflight();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchData, fetchLeaderboard, fetchAuditLogs, fetchProjects, fetchGameLibrary, fetchPuzzles, fetchPreflight]);

  // Event control handler
  const handleEventAction = async (action: 'start' | 'pause' | 'resume' | 'end' | 'reset' | 'reset_data') => {
    if (action === 'reset' && !confirm('WARNING: Are you sure you want to RESET the event state to Ready?')) {
      return;
    }
    if (action === 'reset_data' && !confirm(
      'PERMANENTLY clear all assignments, game sessions, scores, lifeline events, recovery puzzle attempts, and clue unlocks? Teams, projects, games, clues, questions, and audit history will be preserved.'
    )) {
      return;
    }
    try {
      const res = await fetch('/api/admin/event/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionMessage(`Event status updated: ${action.toUpperCase()}`);
        fetchData();
        fetchAuditLogs();
        fetchLeaderboard();
        fetchPuzzles();
      } else {
        alert(json.error || 'Failed to update event');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Revert lifeline
  const handleRevertLifeline = async (teamId: string, teamName: string) => {
    if (!confirm(`Revert the last lifeline deduction for ${teamName}? This will restore the lifeline and un-skip any matching game.`)) {
      return;
    }
    try {
      const res = await fetch('/api/admin/lifelines/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert_last', teamId }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionMessage(json.message);
        fetchData();
        fetchAuditLogs();
      } else {
        alert(json.error || 'Failed to revert lifeline');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Execute single-click audit undo
  const handleUndoAudit = async (logId: string) => {
    if (!confirm('Execute single-click UNDO for this action?')) return;
    try {
      const res = await fetch('/api/admin/audit/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId }),
      });
      const json = await res.json();
      if (res.ok) {
        setActionMessage(`UNDO SUCCESS: ${json.message}`);
        fetchData();
        fetchAuditLogs();
        fetchLeaderboard();
      } else {
        alert(json.error || 'Failed to execute undo');
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Format time
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-retro-bg flex items-center justify-center font-pixel text-retro-cyan text-sm">
        BOOTING ADMIN HQ TERMINAL...
      </div>
    );
  }

  const { eventState, teams } = data;

  const filteredTeams = teams.filter((t: any) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.loginId.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="min-h-screen bg-retro-bg text-gray-100 flex flex-col font-mono">
      {/* Scanline background texture */}
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-40 opacity-30" />

      {/* ADMIN HEADER */}
      <header className="bg-[#0b0c16] border-b border-retro-cyan/40 px-4 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-3.5 h-3.5 rounded-sm bg-retro-magenta shadow-neon-magenta animate-pulse" />
            <span className="font-pixel text-xs sm:text-sm text-retro-cyan tracking-wider">
              ROBOVERSE HQ // ADMIN CONTROL
            </span>
          </div>
          <span className="text-[10px] font-pixel text-retro-yellow bg-retro-yellow/10 px-2 py-0.5 rounded border border-retro-yellow/30">
            MASTER OVERRIDE ACTIVE
          </span>
        </div>

        {/* Global Event Control Buttons */}
        <div className="flex items-center space-x-2">
          {eventState.status === 'ready' && (
            <button
              onClick={() => handleEventAction('start')}
              className="px-3 py-1.5 bg-retro-green text-retro-bg font-pixel text-[10px] rounded hover:bg-white font-bold flex items-center gap-1.5 shadow-neon-green"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> START EVENT
            </button>
          )}

          {eventState.status === 'running' && (
            <button
              onClick={() => handleEventAction('pause')}
              className="px-3 py-1.5 bg-retro-amber text-retro-bg font-pixel text-[10px] rounded hover:bg-white font-bold flex items-center gap-1.5 shadow-neon-yellow"
            >
              <Pause className="w-3.5 h-3.5 fill-current" /> PAUSE EVENT
            </button>
          )}

          {eventState.status === 'paused' && (
            <button
              onClick={() => handleEventAction('resume')}
              className="px-3 py-1.5 bg-retro-cyan text-retro-bg font-pixel text-[10px] rounded hover:bg-white font-bold flex items-center gap-1.5 shadow-neon-cyan animate-pulse"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> RESUME EVENT
            </button>
          )}

          {eventState.status !== 'ended' && (
            <button
              onClick={() => handleEventAction('end')}
              className="px-2.5 py-1.5 bg-retro-card border border-retro-red/60 text-retro-red font-pixel text-[10px] rounded hover:bg-retro-red/20 flex items-center gap-1"
            >
              <Square className="w-3 h-3 fill-current" /> END
            </button>
          )}

          <button
            onClick={() => handleEventAction('reset')}
            className="px-2 py-1.5 bg-retro-card border border-retro-border text-retro-muted font-pixel text-[10px] rounded hover:text-white"
            title="Reset Event to Ready"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            onClick={() => handleEventAction('reset_data')}
            className="px-2 py-1.5 bg-retro-card border border-retro-red/60 text-retro-red font-pixel text-[9px] rounded hover:bg-retro-red/20"
            title="Clear competition data while preserving teams, projects, games, clues, questions, and audit history"
          >
            RESET DATA
          </button>

          <button
            onClick={handleLogout}
            className="p-1.5 text-retro-muted hover:text-retro-red rounded border border-retro-border"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* EVENT STATUS BAR */}
      <div className="bg-[#0e1122] border-b border-retro-border px-4 py-2 flex flex-wrap items-center justify-between text-xs gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              setRegisterError(null);
              setIsRegisteringTeam(true);
            }}
            className="px-3 py-2 bg-retro-cyan text-retro-bg font-pixel text-[10px] rounded font-bold flex items-center gap-2"
          >
            <PlusCircle className="w-4 h-4" /> REGISTER TEAM
          </button>

          <div>
            <span className="text-retro-muted">STATUS: </span>
            <span className={`font-pixel font-bold uppercase ${
              eventState.isRunning ? 'text-retro-green' : eventState.isPaused ? 'text-retro-red animate-pulse' : 'text-retro-yellow'
            }`}>
              {eventState.status}
            </span>
          </div>
          <div>
            <span className="text-retro-muted">CLOCK: </span>
            <span className="font-pixel text-white font-bold text-sm tracking-wider">
              {formatTime(eventState.remainingSeconds)}
            </span>
          </div>
          <div>
            <span className="text-retro-muted">SLOT: </span>
            <span className="font-pixel text-retro-yellow font-bold">
              {eventState.currentSlot} / 4 (45m slots)
            </span>
          </div>
        </div>

        {actionMessage && (
          <div className="text-[11px] font-pixel text-retro-green animate-bounce">
            ✓ {actionMessage}
          </div>
        )}
      </div>

      {eventState.status === 'ready' && (
        <section className={`border-b px-4 py-3 ${preflight?.canStart ? 'border-retro-green/40 bg-retro-green/5' : 'border-retro-amber/40 bg-retro-amber/5'}`}>
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <strong className={`font-pixel ${preflight?.canStart ? 'text-retro-green' : 'text-retro-amber'}`}>
              EVENT PRE-FLIGHT: {preflight?.canStart ? 'READY' : 'ACTION REQUIRED'}
            </strong>
            <span>{preflight?.teamsCount ?? '—'} active teams</span>
            <span>{preflight?.enabledGamesCount ?? '—'} / 6–10 enabled games</span>
            <span>{preflight?.recoveryQuestionsReady ? 'Recovery question ready' : 'Valid recovery question missing'}</span>
            {(preflight?.missingProjects?.length > 0) && (
              <span className="text-retro-red">{preflight.missingProjects.length} teams need projects</span>
            )}
            {(preflight?.missingHints?.length > 0) && (
              <span className="text-retro-red">{preflight.missingHints.length} teams need game clues</span>
            )}
            {preflight && !preflight.canStart && preflight.missingProjects?.length === 0 && preflight.missingHints?.length === 0 && (
              <span className="text-retro-red">Check game count and supported games.</span>
            )}
          </div>
        </section>
      )}

      {/* TABS NAVIGATION */}
      <nav className="bg-[#090b14] border-b border-retro-border px-4 flex space-x-1 overflow-x-auto text-xs">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'overview'
              ? 'border-retro-cyan text-retro-cyan bg-retro-cyan/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <Users className="w-4 h-4" /> 25 TEAMS OVERVIEW
        </button>

        <button
          onClick={() => setActiveTab('games')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'games'
              ? 'border-retro-cyan text-retro-cyan bg-retro-cyan/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <Gamepad2 className="w-4 h-4" /> GAME LIBRARY
        </button>

        <button
          onClick={() => setActiveTab('projects')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'projects'
              ? 'border-retro-magenta text-retro-magenta bg-retro-magenta/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <FolderKanban className="w-4 h-4" /> PROJECTS
        </button>

        <button
          onClick={() => setActiveTab('puzzles')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'puzzles'
              ? 'border-retro-magenta text-retro-magenta bg-retro-magenta/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <HelpCircle className="w-4 h-4" /> RECOVERY PUZZLES
        </button>

        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'leaderboard'
              ? 'border-retro-yellow text-retro-yellow bg-retro-yellow/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4" /> VENUE LEADERBOARD
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`py-3 px-4 font-pixel text-[11px] border-b-2 flex items-center gap-2 transition-all ${
            activeTab === 'audit'
              ? 'border-retro-magenta text-retro-magenta bg-retro-magenta/10 font-bold'
              : 'border-transparent text-retro-muted hover:text-white'
          }`}
        >
          <History className="w-4 h-4" /> AUDIT LOG &amp; UNDO
        </button>
      </nav>

      {/* TAB CONTENT */}
      <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
        {/* 1. OVERVIEW GRID TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-retro-card p-3 rounded border border-retro-border">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <Search className="w-4 h-4 text-retro-muted" />
                <input
                  type="text"
                  placeholder="Search by team name or login ID (e.g. team07)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-retro-cyan w-full font-mono"
                />
              </div>

            </div>

            {/* Teams Table */}
            <div className="bg-retro-card border border-retro-border rounded-lg overflow-x-auto shadow-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#080912] text-retro-muted font-pixel text-[10px] border-b border-retro-border">
                  <tr>
                    <th className="p-3">LOGIN / ID</th>
                    <th className="p-3">TEAM NAME &amp; MEMBERS</th>
                    <th className="p-3">LIFELINES</th>
                    <th className="p-3">CLUE GAMES</th>
                    <th className="p-3 text-right">QUICK ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-retro-border/40 font-mono">
                  {filteredTeams.map((team: any) => (
                      <tr
                        key={team.id}
                        className="hover:bg-retro-bg/60 transition-colors"
                      >
                        {/* ID */}
                        <td className="p-3 font-pixel text-retro-cyan text-[11px]">
                          {team.loginId.toUpperCase()}
                          {!team.active && (
                            <span className="block text-[8px] text-retro-red">[INACTIVE]</span>
                          )}
                        </td>

                        {/* Name & Members */}
                        <td className="p-3">
                          <div className="font-bold text-white text-sm">{team.name}</div>
                          <div className="text-[10px] text-retro-muted truncate max-w-xs mt-0.5">
                            {team.members.join(', ')}
                          </div>
                          <div className="text-[10px] text-retro-magenta mt-1">
                            PROJECT: {team.projectName || 'UNASSIGNED'}
                          </div>
                        </td>

                        {/* Lifelines */}
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <Heart
                              className={`w-4 h-4 fill-current ${
                                team.lifelines.remaining > 0
                                  ? 'text-retro-red'
                                  : 'text-retro-amber'
                              }`}
                            />
                            <span
                              className={`font-pixel text-xs font-bold ${
                                team.lifelines.remaining > 0 ? 'text-white' : 'text-retro-amber'
                              }`}
                            >
                              {team.lifelines.remaining} / 1
                            </span>
                            {team.lifelines.remaining === 0 && (
                              <span className="text-[8px] font-pixel text-retro-amber">USED</span>
                            )}
                          </div>
                        </td>

                        {/* Games Completed */}
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            {team.games.map((g: any, i: number) => (
                              <span
                                key={i}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-pixel ${
                                  g.status === 'completed'
                                    || g.status === 'COMPLETED_NORMAL'
                                    || g.status === 'COMPLETED_WITH_LIFELINE'
                                    ? 'bg-retro-green/20 text-retro-green border border-retro-green/40'
                                    : g.status === 'skipped'
                                      || g.status === 'SKIPPED_AFTER_RECOVERY'
                                      || g.status === 'SKIPPED_WITHOUT_LIFELINE'
                                    ? 'bg-retro-amber/20 text-retro-amber border border-retro-amber/40'
                                    : g.status === 'available'
                                      || g.status === 'NOT_STARTED'
                                      || g.status === 'IN_PROGRESS'
                                      || g.status === 'FIRST_ATTEMPT_FAILED'
                                      || g.status === 'SECOND_ATTEMPT_IN_PROGRESS'
                                    ? 'bg-retro-cyan/20 text-retro-cyan border border-retro-cyan/40'
                                    : 'bg-retro-border text-retro-muted'
                                }`}
                                title={`${g.title}: ${g.status}`}
                              >
                                G{i + 1}
                              </span>
                            ))}
                            <span className="text-[10px] text-retro-muted ml-1">
                              ({team.completedGamesCount}/3)
                            </span>
                          </div>
                        </td>

                        {/* Quick Actions */}
                        <td className="p-3 text-right space-x-1.5">
                          {/* Revert lifeline button (1-click) */}
                          <button
                            onClick={() => handleRevertLifeline(team.id, team.name)}
                            className="px-2 py-1 bg-retro-card border border-retro-magenta text-retro-magenta hover:bg-retro-magenta/20 font-pixel text-[9px] rounded"
                            title="Revert misclick / restore lifeline"
                          >
                            REVERT LIFE
                          </button>

                          {/* Edit Team */}
                          <button
                            onClick={() => setSelectedTeam(team)}
                            className="px-2 py-1 bg-retro-card border border-retro-border text-retro-muted hover:text-white font-pixel text-[9px] rounded"
                          >
                            EDIT
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'games' && (
          <section className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-pixel text-sm text-retro-cyan">PLAYABLE GAME LIBRARY</h2>
                <p className="mt-1 text-xs text-retro-muted">
                  {gameLibrary.filter((game) => game.enabled).length} enabled · enable 6–10 games before event start
                </p>
              </div>
              <button
                type="button"
                onClick={fetchGameLibrary}
                className="rounded border border-retro-border px-3 py-2 font-pixel text-[10px] text-retro-muted hover:text-white"
              >
                REFRESH
              </button>
            </div>

            {gameLibraryError && (
              <div className="rounded border border-retro-red/60 bg-retro-red/10 p-3 text-xs text-retro-red" role="alert">
                {gameLibraryError}
              </div>
            )}

            {gameLibraryLoading && gameLibrary.length === 0 ? (
              <p className="text-sm text-retro-muted">Loading game library…</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {gameLibrary.map((game) => (
                  <article key={game.id} className="flex items-center justify-between gap-4 rounded-lg border border-retro-border bg-retro-card p-4">
                    <div className="min-w-0">
                      <h3 className="font-pixel text-xs text-white">{game.title}</h3>
                      <p className="mt-1 font-mono text-[10px] text-retro-muted">
                        {game.game_key} · minimum {game.min_seconds}s · project clue per assignment
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleGame(game)}
                      disabled={data?.eventState?.status !== 'ready' || Boolean(data?.eventState?.started_at)}
                      className={`shrink-0 rounded border px-3 py-2 font-pixel text-[9px] disabled:opacity-40 ${
                        game.enabled
                          ? 'border-retro-green/60 text-retro-green'
                          : 'border-retro-border text-retro-muted'
                      }`}
                    >
                      {game.enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </article>
                ))}
              </div>
            )}

            {availableGameCatalog.length > 0 && (
              <div className="rounded-lg border border-retro-border bg-retro-card p-4">
                <h3 className="mb-3 font-pixel text-xs text-retro-magenta">ADD SUPPORTED GAMES</h3>
                <div className="flex flex-wrap gap-2">
                  {availableGameCatalog.map((entry) => (
                    <button
                      key={entry.gameKey}
                      type="button"
                      onClick={() => void handleAddCatalogGame(entry.gameKey)}
                      disabled={data?.eventState?.status !== 'ready' || Boolean(data?.eventState?.started_at)}
                      className="rounded border border-retro-magenta/60 px-3 py-2 text-left text-xs text-retro-magenta hover:bg-retro-magenta/10 disabled:opacity-40"
                    >
                      <span className="block font-pixel text-[9px]">{entry.title}</span>
                      <span className="mt-1 block text-[10px] text-retro-muted">{entry.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'projects' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-pixel text-sm text-retro-magenta">PROJECT INTEL</h2>
                <p className="text-xs text-retro-muted mt-1">
                  {projects.length} / 10 projects · projects may be shared
                </p>
              </div>
              <button
                type="button"
                disabled={projects.length >= 10}
                onClick={() => {
                  setSelectedProject(null);
                  setProjectForm({ name: '', description: '', snakeHint: '', pongHint: '', memoryHint: '' });
                  setProjectHints(enabledGames.map((game) => ({ gameId: game.id, clueText: '' })));
                  setProjectError(null);
                  setIsProjectFormOpen(true);
                }}
                className="px-4 py-2 bg-retro-magenta text-white font-pixel text-[10px] rounded font-bold disabled:opacity-40"
              >
                <PlusCircle className="inline w-4 h-4 mr-2" /> ADD PROJECT
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="bg-retro-card border border-retro-border rounded-lg p-6 text-center text-sm text-retro-muted">
                No projects have been added yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {projects.map((project) => (
                  <article key={project.id} className="bg-retro-card border border-retro-border rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-pixel text-xs text-retro-cyan break-words">{project.name}</h3>
                        <p className="text-xs text-retro-muted mt-2 whitespace-pre-wrap">{project.description}</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-mono text-retro-yellow">
                        {(project.teams || []).length
                          ? (project.teams as any[]).map((team: any) => team.name).join(', ')
                          : 'UNASSIGNED'}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                      {(project.hints || []).map((hint: any) => (
                        <p key={hint.id} className="p-2 bg-retro-bg rounded text-gray-300">
                          <b className="text-retro-cyan">{hint.game?.title || 'GAME'}:</b> {hint.clue_text}
                        </p>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProject(project);
                        setProjectForm({
                          name: project.name,
                          description: project.description,
                          snakeHint: '',
                          pongHint: '',
                          memoryHint: '',
                        });
                        const hintByGame = new Map<string, string>(
                          (project.hints || []).map((hint: any) => [hint.game_id, hint.clue_text])
                        );
                        setProjectHints(enabledGames.map((game) => ({
                          gameId: game.id,
                          clueText: hintByGame.get(game.id) || '',
                        })));
                        setProjectError(null);
                        setIsProjectFormOpen(true);
                      }}
                      className="mt-4 px-3 py-2 border border-retro-border text-retro-muted hover:text-white font-pixel text-[10px] rounded"
                    >
                      EDIT PROJECT
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === 'puzzles' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-pixel text-sm text-retro-magenta">RECOVERY PUZZLE LIBRARY</h2>
                <p className="text-xs text-retro-muted mt-1">Manage component questions and inspect team responses.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPuzzle(null);
                  setPuzzleForm({ questionText: '', imageUrl: '', options: ['', '', '', ''], correctAnswer: '', enabled: true });
                  setPuzzleEditorOpen(true);
                }}
                className="px-4 py-2 bg-retro-magenta text-white font-pixel text-[10px] rounded"
              >
                <PlusCircle className="inline w-4 h-4 mr-2" /> ADD QUESTION
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {puzzles.map((question) => (
                <article key={question.id} className="bg-retro-card border border-retro-border rounded-lg p-4">
                  <div className="flex gap-3">
                    <img
                      src={question.image_url}
                      alt="Component recovery question"
                      className="w-28 h-20 object-contain border border-retro-border rounded bg-retro-bg"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-pixel text-[11px] text-white">{question.question_text}</h3>
                      <p className="text-[10px] text-retro-muted mt-2">
                        Status: {question.enabled ? 'ENABLED' : 'DISABLED'}
                      </p>
                      <p className="text-[10px] text-retro-green mt-1">
                        Correct answer: {question.correct_answer}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {question.options.map((option: any) => (
                      <span key={option.id} className="px-2 py-1 bg-retro-bg border border-retro-border rounded text-[10px] text-gray-300">
                        {option.option_text}
                      </span>
                    ))}
                  </div>
                  {(question.puzzles || []).map((puzzle: any) => (
                    <div key={puzzle.id} className="mt-3 p-2 border border-retro-border rounded text-[10px] text-retro-muted">
                      <b className="text-retro-cyan">{puzzle.team.name}</b> · {puzzle.team_game.game.title} · {puzzle.status}
                      <div className="mt-1">
                        {(puzzle.attempts || []).map((attempt: any) => (
                          <span key={attempt.id} className={attempt.is_correct ? 'text-retro-green mr-2' : 'text-retro-red mr-2'}>
                            {attempt.selected_answer} [{attempt.is_correct ? 'correct' : 'wrong'}]
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPuzzle(question);
                        setPuzzleForm({
                          questionText: question.question_text,
                          imageUrl: question.image_url,
                          options: question.options.map((option: any) => option.option_text),
                          correctAnswer: question.correct_answer,
                          enabled: question.enabled,
                        });
                        setPuzzleEditorOpen(true);
                      }}
                      className="px-3 py-1.5 border border-retro-border text-[10px] font-pixel text-retro-muted hover:text-white rounded"
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('Delete this component question?')) return;
                        const res = await fetch('/api/admin/puzzles', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'delete', questionId: question.id }),
                        });
                        if (!res.ok) {
                          const json = await res.json();
                          alert(json.error || 'Could not delete question.');
                          return;
                        }
                        fetchPuzzles();
                      }}
                      className="px-3 py-1.5 border border-retro-red/40 text-[10px] font-pixel text-retro-red rounded"
                    >
                      DELETE
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 2. LEADERBOARD TAB (Projector View) */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-pixel text-sm text-retro-yellow">
                  LIVE VENUE RANKINGS · 25 TEAMS
                </h3>
                <p className="text-xs text-retro-muted mt-1">
                  Ranked by completed challenges, then lifelines.
                </p>
              </div>

              <button
                onClick={() => setIsFullScreenLeaderboard(true)}
                className="px-4 py-2 bg-retro-yellow text-black font-pixel text-xs rounded font-bold shadow-neon-yellow flex items-center gap-2 hover:bg-white transition-all"
              >
                <Maximize2 className="w-4 h-4" /> FULL SCREEN PROJECTOR MODE
              </button>
            </div>

            {/* Leaderboard Table */}
            <div className="bg-retro-card border-2 border-retro-yellow/40 rounded-lg overflow-hidden shadow-neon-yellow">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090b14] text-retro-yellow font-pixel text-[11px] border-b border-retro-yellow/30">
                  <tr>
                    <th className="p-4 w-20">RANK</th>
                    <th className="p-4">TEAM NAME</th>
                    <th className="p-4">CHALLENGES CLEARED</th>
                    <th className="p-4">POINTS</th>
                    <th className="p-4">LIFELINE</th>
                    <th className="p-4 text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-retro-border/30">
                  {leaderboardData.map((item: any) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-retro-bg/60 transition-all ${
                        item.rank === 1
                          ? 'bg-retro-yellow/10 font-bold'
                          : item.rank <= 3
                          ? 'bg-retro-cyan/5'
                          : ''
                      }`}
                    >
                      <td className="p-4 font-pixel text-sm">
                        {item.rank === 1 ? '🥇 #1' : item.rank === 2 ? '🥈 #2' : item.rank === 3 ? '🥉 #3' : `#${item.rank}`}
                      </td>
                      <td className="p-4 font-bold text-white text-sm">
                        {item.name}
                        <span className="text-[10px] text-retro-cyan font-pixel ml-2">
                          [{item.loginId.toUpperCase()}]
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-pixel text-retro-green text-sm font-bold">
                          {item.completedGames} / 3
                        </span>
                      </td>
                      <td className="p-4 font-pixel text-retro-red text-sm">
                        {item.totalPoints}
                      </td>
                      <td className="p-4 font-pixel text-retro-red text-sm">
                        {item.lifelineUsed ? 'USED' : 'AVAILABLE'}
                      </td>
                      <td className="p-4 text-right font-pixel text-[10px]">
                        {item.completedAt ? (
                          <span className="text-retro-green">COMPLETED {new Date(item.completedAt).toLocaleTimeString()}</span>
                        ) : (
                          <span className="text-retro-cyan">IN PROGRESS</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. AUDIT LOG TAB */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-pixel text-sm text-retro-magenta">
                  AUDIT LOG &amp; INSTANT ROLLBACK
                </h3>
                <p className="text-xs text-retro-muted mt-1">
                  Every admin action and fair-play event is permanently logged with before/after state snapshots.
                </p>
              </div>

              <button
                onClick={fetchAuditLogs}
                className="px-3 py-1.5 bg-retro-card border border-retro-border text-retro-muted hover:text-white font-pixel text-[10px] rounded"
              >
                REFRESH LOGS
              </button>
            </div>

            <div className="bg-retro-card border border-retro-border rounded-lg overflow-x-auto shadow-lg">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#080912] text-retro-muted font-pixel text-[10px] border-b border-retro-border">
                  <tr>
                    <th className="p-3">TIME</th>
                    <th className="p-3">ACTOR</th>
                    <th className="p-3">ACTION</th>
                    <th className="p-3">TARGET TEAM</th>
                    <th className="p-3">DETAILS</th>
                    <th className="p-3 text-right">ROLLBACK</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-retro-border/30">
                  {auditLogs.map((log: any) => (
                    <tr key={log.id} className="hover:bg-retro-bg/60">
                      <td className="p-3 text-[11px] text-retro-muted whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-pixel text-[10px] text-retro-cyan">
                        {log.actor}
                      </td>
                      <td className="p-3 font-pixel text-[10px] text-retro-yellow">
                        {log.action}
                      </td>
                      <td className="p-3 text-white">
                        {log.team ? `${log.team.name} (${log.team.login_id})` : '-'}
                      </td>
                      <td className="p-3 text-[11px] text-gray-400 max-w-xs truncate">
                        {log.after || log.before || '-'}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleUndoAudit(log.id)}
                          className="px-2.5 py-1 bg-retro-card border border-retro-magenta text-retro-magenta hover:bg-retro-magenta/20 font-pixel text-[9px] rounded flex items-center gap-1 ml-auto"
                        >
                          <Undo2 className="w-3 h-3" /> UNDO
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* FULL SCREEN LEADERBOARD MODAL FOR VENUE PROJECTOR */}
      {isFullScreenLeaderboard && (
        <div className="fixed inset-0 z-50 bg-[#06070e] text-white p-6 flex flex-col justify-between overflow-y-auto select-none">
          {/* Projector Header */}
          <div className="flex items-center justify-between pb-4 border-b-2 border-retro-cyan">
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-sm bg-retro-cyan shadow-neon-cyan" />
              <h1 className="font-pixel text-xl sm:text-2xl text-retro-cyan tracking-wider">
                ROBOVERSE · LIVE VENUE LEADERBOARD
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right font-pixel text-xs">
                <span className="text-retro-muted block">TIME REMAINING:</span>
                <span className="text-retro-yellow text-lg">
                  {formatTime(eventState.remainingSeconds)}
                </span>
              </div>
              <button
                onClick={() => setIsFullScreenLeaderboard(false)}
                className="px-4 py-2 bg-retro-card border border-retro-red text-retro-red font-pixel text-xs rounded hover:bg-retro-red/20"
              >
                EXIT FULL SCREEN
              </button>
            </div>
          </div>

          {/* Projector 25-Team Ranking Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 my-4 flex-1">
            {leaderboardData.map((t: any) => (
              <div
                key={t.id}
                className={`p-3 rounded border flex items-center justify-between transition-all ${
                  t.rank === 1
                    ? 'bg-retro-yellow/15 border-retro-yellow shadow-neon-yellow scale-[1.02]'
                    : t.rank === 2
                    ? 'bg-retro-cyan/15 border-retro-cyan shadow-neon-cyan'
                    : t.rank === 3
                    ? 'bg-retro-magenta/15 border-retro-magenta shadow-neon-magenta'
                    : t.lifelineUsed
                    ? 'bg-retro-card border-retro-amber/40'
                    : 'bg-retro-card border-retro-border'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-pixel text-sm w-8 text-retro-muted">
                    {t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : `#${t.rank}`}
                  </span>
                  <div>
                    <h4 className="font-pixel text-xs text-white truncate max-w-[150px]">
                      {t.name}
                    </h4>
                    <span className="text-[9px] font-pixel text-retro-cyan">
                      {t.loginId.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-right">
                  <div>
                    <span className="text-[9px] font-pixel text-retro-muted block">GAMES</span>
                    <span className="font-pixel text-xs text-retro-green font-bold">
                      {t.completedGames}/3
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer Ticker */}
          <div className="border-t border-retro-border pt-3 flex items-center justify-between text-[10px] font-pixel text-retro-muted">
            <span>25 TEAMS · 100 COMPETITORS · RETRO MINI-GAMES &amp; ROBOTICS CLUES</span>
            <span className="animate-pulse text-retro-green">● LIVE SERVER SYNC ACTIVE</span>
          </div>
        </div>
      )}

      {puzzleEditorOpen && (
        <div className="fixed inset-0 z-[55] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={savePuzzle}
            className="bg-retro-card border-2 border-retro-magenta shadow-neon-magenta p-5 rounded-lg max-w-xl w-full max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-pixel text-xs text-retro-magenta mb-4">
              {selectedPuzzle ? 'EDIT RECOVERY QUESTION' : 'ADD RECOVERY QUESTION'}
            </h3>
            <div className="space-y-3 text-xs">
              <label className="block text-retro-muted">
                Question
                <input
                  required
                  value={puzzleForm.questionText}
                  onChange={(event) => setPuzzleForm({ ...puzzleForm, questionText: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Component image URL
                <input
                  required
                  value={puzzleForm.imageUrl}
                  onChange={(event) => setPuzzleForm({ ...puzzleForm, imageUrl: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Upload/replace image
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append('file', file);
                    const res = await fetch('/api/admin/puzzles/upload', { method: 'POST', body: form });
                    const json = await res.json();
                    if (!res.ok) {
                      alert(json.error || 'Failed to upload image.');
                      return;
                    }
                    setPuzzleForm((current) => ({ ...current, imageUrl: json.imageUrl }));
                  }}
                  className="mt-1 w-full text-xs text-white"
                />
              </label>
              {puzzleForm.options.map((option, index) => (
                <label key={index} className="block text-retro-muted">
                  Answer choice {index + 1}
                  <input
                    required
                    value={option}
                    onChange={(event) => {
                      const options = [...puzzleForm.options];
                      options[index] = event.target.value;
                      setPuzzleForm({ ...puzzleForm, options });
                    }}
                    className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                  />
                </label>
              ))}
              <label className="block text-retro-muted">
                Correct answer
                <input
                  required
                  list="puzzle-correct-options"
                  value={puzzleForm.correctAnswer}
                  onChange={(event) => setPuzzleForm({ ...puzzleForm, correctAnswer: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
                <datalist id="puzzle-correct-options">
                  {puzzleForm.options.map((option, index) => (
                    <option key={index} value={option} />
                  ))}
                </datalist>
              </label>
              <label className="flex items-center gap-2 text-retro-muted">
                <input
                  type="checkbox"
                  checked={puzzleForm.enabled}
                  onChange={(event) => setPuzzleForm({ ...puzzleForm, enabled: event.target.checked })}
                />
                Enabled
              </label>
              <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 py-2 bg-retro-magenta text-white font-pixel text-[10px] rounded">
                  SAVE QUESTION
                </button>
                <button
                  type="button"
                  onClick={() => setPuzzleEditorOpen(false)}
                  className="px-4 py-2 bg-retro-border text-retro-muted font-pixel text-[10px] rounded"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {isProjectFormOpen && (
        <div className="fixed inset-0 z-[55] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProject}
            className="bg-retro-card border-2 border-retro-magenta shadow-neon-magenta p-5 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-pixel text-xs text-retro-magenta mb-4">
              {selectedProject ? 'EDIT PROJECT' : 'ADD PROJECT'}
            </h3>
            <div className="space-y-3 text-xs font-mono">
              <label className="block text-retro-muted">
                Project Name
                <input
                  required
                  maxLength={100}
                  value={projectForm.name}
                  onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Project Description
                <textarea
                  required
                  maxLength={5000}
                  rows={3}
                  value={projectForm.description}
                  onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              {enabledGames.map((game) => (
                <label key={game.id} className="block text-retro-muted">
                  {game.title} clue
                  <textarea
                    required
                    maxLength={2000}
                    rows={2}
                    value={projectHints.find((hint) => hint.gameId === game.id)?.clueText || ''}
                    onChange={(event) => {
                      const clueText = event.target.value;
                      setProjectHints((current) =>
                        current.some((hint) => hint.gameId === game.id)
                          ? current.map((hint) => hint.gameId === game.id ? { ...hint, clueText } : hint)
                          : [...current, { gameId: game.id, clueText }]
                      );
                    }}
                    className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                  />
                </label>
              ))}
              {projectError && <p role="alert" className="text-retro-red">{projectError}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingProject}
                  className="flex-1 py-2 bg-retro-magenta text-white font-pixel text-[10px] rounded font-bold disabled:opacity-50"
                >
                  {savingProject ? 'SAVING...' : selectedProject ? 'SAVE PROJECT' : 'CREATE PROJECT'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsProjectFormOpen(false)}
                  className="px-4 py-2 bg-retro-border text-retro-muted font-pixel text-[10px] rounded"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TEAM EDIT MODAL */}
      {selectedTeam && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-retro-card border-2 border-retro-border shadow-xl p-5 rounded-lg max-w-md w-full">
            <h3 className="font-pixel text-xs text-white mb-4">
              EDIT TEAM: {selectedTeam.loginId.toUpperCase()}
            </h3>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="text-retro-muted block mb-1">Team Name:</label>
                <input
                  id="edit-team-name"
                  type="text"
                  defaultValue={selectedTeam.name}
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-white"
                />
              </div>

              {[0, 1, 2].map((index) => (
                <div key={index}>
                  <label className="text-retro-muted block mb-1">Member {index + 1} Name:</label>
                  <input
                    id={`edit-team-member-${index + 1}`}
                    type="text"
                    required
                    defaultValue={selectedTeam.members[index] || ''}
                    className="w-full bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-white"
                  />
                </div>
              ))}

              <div>
                <label className="text-retro-muted block mb-1">Reset Password:</label>
                <input
                  id="edit-team-pass"
                  type="password"
                  placeholder="Leave blank to keep current"
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-white"
                />
              </div>

              <div>
                <label className="text-retro-muted block mb-1">Status:</label>
                <select
                  id="edit-team-active"
                  defaultValue={selectedTeam.active ? 'true' : 'false'}
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-white"
                >
                  <option value="true">Active (Can Log In)</option>
                  <option value="false">Deactivated (Locked Out)</option>
                </select>
              </div>

              <div>
                <label className="text-retro-muted block mb-1">Assigned Project:</label>
                <select
                  id="edit-team-project"
                  defaultValue={selectedTeam.projectId || ''}
                  className="w-full bg-retro-bg border border-retro-border rounded px-3 py-1.5 text-white"
                >
                  <option value="">Unassigned</option>
                  {projects
                    .filter((project) => !project.team || project.team.id === selectedTeam.id)
                    .map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                </select>
              </div>

              {teamEditError && <p role="alert" className="text-retro-red">{teamEditError}</p>}

              <div className="flex gap-2 pt-3">
                <button
                  onClick={async () => {
                    const name = (document.getElementById('edit-team-name') as HTMLInputElement)?.value.trim();
                    const pass = (document.getElementById('edit-team-pass') as HTMLInputElement)?.value;
                    const active = (document.getElementById('edit-team-active') as HTMLSelectElement)?.value === 'true';
                    const projectId = (document.getElementById('edit-team-project') as HTMLSelectElement)?.value || null;
                    const members = [1, 2, 3].map((index) =>
                      (document.getElementById(`edit-team-member-${index}`) as HTMLInputElement)?.value.trim() || ''
                    );
                    if (members.some((member) => !member)) {
                      setTeamEditError('Enter all 3 member names before saving.');
                      return;
                    }

                    setTeamEditError(null);
                    try {
                      const res = await fetch('/api/admin/teams/manage', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'update_info',
                        teamId: selectedTeam.id,
                        name,
                        active,
                        projectId,
                        members,
                        password: pass || undefined,
                      }),
                      });
                      const json = await res.json();
                      if (!res.ok) {
                        setTeamEditError(json.error || 'Failed to update team.');
                        return;
                      }
                      setSelectedTeam(null);
                      fetchData();
                      fetchProjects();
                      fetchAuditLogs();
                    } catch (error) {
                      setTeamEditError(error instanceof Error ? error.message : 'Failed to update team.');
                    }
                  }}
                  className="flex-1 py-2 bg-retro-cyan text-retro-bg font-pixel text-[10px] rounded font-bold"
                >
                  SAVE CHANGES
                </button>
                <button
                  onClick={() => setSelectedTeam(null)}
                  className="px-4 py-2 bg-retro-border text-retro-muted font-pixel text-[10px] rounded"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isRegisteringTeam && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRegisterTeam}
            className="bg-retro-card border-2 border-retro-cyan shadow-neon-cyan p-5 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-pixel text-xs text-retro-cyan mb-4">REGISTER TEAM</h3>
            <div className="space-y-3 text-xs font-mono">
              <label className="block text-retro-muted">
                Team Name
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={50}
                  value={registerTeam.name}
                  onChange={(event) => setRegisterTeam({ ...registerTeam, name: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Login ID
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={30}
                  value={registerTeam.loginId}
                  onChange={(event) => setRegisterTeam({ ...registerTeam, loginId: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Password
                <input
                  type="password"
                  required
                  minLength={6}
                  maxLength={100}
                  value={registerTeam.password}
                  onChange={(event) => setRegisterTeam({ ...registerTeam, password: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                />
              </label>
              <label className="block text-retro-muted">
                Assigned Project <span className="text-[10px]">(optional)</span>
                <select
                  value={registerTeam.projectId}
                  onChange={(event) => setRegisterTeam({ ...registerTeam, projectId: event.target.value })}
                  className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                >
                  <option value="">Unassigned</option>
                  {projects.filter((project) => !project.team).map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
              {[0, 1, 2].map((index) => (
                <label key={index} className="block text-retro-muted">
                  Member {index + 1} Name
                  <input
                    type="text"
                    required
                    value={registerTeam.members[index]}
                    onChange={(event) => {
                      const members = [...registerTeam.members];
                      members[index] = event.target.value;
                      setRegisterTeam({ ...registerTeam, members });
                    }}
                    className="mt-1 w-full bg-retro-bg border border-retro-border rounded px-3 py-2 text-white"
                  />
                </label>
              ))}
              {registerError && <p role="alert" className="text-retro-red">{registerError}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={registering}
                  className="flex-1 py-2 bg-retro-cyan text-retro-bg font-pixel text-[10px] rounded font-bold disabled:opacity-50"
                >
                  {registering ? 'REGISTERING...' : 'CREATE TEAM'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsRegisteringTeam(false)}
                  className="px-4 py-2 bg-retro-border text-retro-muted font-pixel text-[10px] rounded"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {createdCredentials && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-retro-card border-2 border-retro-green shadow-neon-green p-5 rounded-lg max-w-md w-full">
            <h3 className="font-pixel text-xs text-retro-green mb-2">TEAM REGISTERED</h3>
            <p className="text-xs text-retro-muted mb-4">
              Copy these credentials now. The password will not be shown again after closing this dialog.
            </p>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-white">Login ID: <span className="select-all text-retro-cyan">{createdCredentials.loginId}</span></p>
              <p className="text-white">Password: <span className="select-all text-retro-yellow">{createdCredentials.password}</span></p>
            </div>
            {credentialCopyMessage && <p role="status" className="text-xs text-retro-muted mt-3">{credentialCopyMessage}</p>}
            <div className="flex gap-2 mt-5">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `Login ID: ${createdCredentials.loginId}\nPassword: ${createdCredentials.password}`
                    );
                    setCredentialCopyMessage('Credentials copied.');
                  } catch {
                    setCredentialCopyMessage('Copy was unavailable; select and copy the credentials above.');
                  }
                }}
                className="flex-1 py-2 bg-retro-green text-retro-bg font-pixel text-[10px] rounded font-bold"
              >
                COPY CREDENTIALS
              </button>
              <button
                onClick={() => setCreatedCredentials(null)}
                className="px-4 py-2 bg-retro-border text-retro-muted font-pixel text-[10px] rounded"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
