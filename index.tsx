import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Session, SessionSummary, UserProfile, Notification } from './types';
import { Icons, getSportConfig } from './icons';
import { isSameDay, getMonthName, calculateTRIMP, calculateACSMVo2, calculateClimbScore, generateMockHistory, formatTime, formatPace, calculateAverageStrideLength, getWindDirectionLabel, fetchWeatherForSession } from './utils';
import { getAllSessionSummaries, getFullSessionFromDB, saveSessionToDB, deleteSessionFromDB, clearDB } from './db';
import { parseCsv, parseFitData, parsePolarJson } from './parsers';
import { importFromIntervals } from './intervals';
import { CalendarWidget, NotificationToast, ProfileModal, SummaryItem, MetricCard, RpeInputWidget } from './components';
import { 
    AdvancedAnalytics, 
    TrendAnalysis, 
    RecoveryAdvisor, 
    IntensityDistribution, 
    GlobalHeatmap, 
    PersonalRecords, 
    FitnessTrendChart, 
    RacePredictor, 
    WeeklyVolumeChart, 
    AggregatedStats, 
    RecentActivitiesList, 
    MapComponent, 
    ElevationChart, 
    ZoneDistributionChart,
    InjuryPreventionCard
} from './analytics';

const Sidebar = ({ sessions, view, setView, selectedSessionId, handleSelectSession, setPlaybackIndex, searchQuery, setSearchQuery, selectedDate, setSelectedDate, expandedGroups, toggleGroup, exportDatabase, clearAllSessions, handleDataLoaded, deleteSession, addNotification, openProfile, isSelectionMode, toggleSelectionMode, selectedIds, toggleSelection, deleteSelected, syncIntervals, syncCount, setSyncCount }: any) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const files: File[] = Array.from(e.target.files);
        let loaded: Session[] = [];
        addNotification({ type: 'info', message: `Procesando ${files.length} archivos...` });

        for (const file of files) {
            try {
                if (file.name.endsWith('.fit')) {
                    const buffer = await file.arrayBuffer();
                    const session = await parseFitData(buffer, file.name);
                    loaded.push(session);
                } else if (file.name.endsWith('.json')) {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    if (Array.isArray(json)) loaded = loaded.concat(json); 
                    else loaded.push(parsePolarJson(json, file.name));
                } else if (file.name.endsWith('.csv')) {
                    const text = await file.text();
                    loaded.push(parseCsv(text, file.name));
                }
            } catch (err: any) {
                console.error(err);
                addNotification({ type: 'error', message: `Error en ${file.name}: ${err.message}` });
            }
        }
        handleDataLoaded(loaded);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const filteredSessions = sessions.filter((s: SessionSummary) => {
        if (selectedDate && !isSameDay(new Date(s.startTime), selectedDate)) return false;
        if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) && !s.sport.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const groupedSessions = useMemo(() => {
        const groups: Record<string, Record<string, SessionSummary[]>> = {};
        filteredSessions.forEach((s: SessionSummary) => {
            const d = new Date(s.startTime);
            const year = d.getFullYear().toString();
            const month = `${year}-${d.getMonth()}`;
            if (!groups[year]) groups[year] = {};
            if (!groups[year][month]) groups[year][month] = [];
            groups[year][month].push(s);
        });
        return groups;
    }, [filteredSessions]);

    return (
        <aside className="w-80 bg-[#1C1C1E]/95 backdrop-blur border-r border-white/10 flex flex-col z-20 transition-all duration-300">
            <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[#34C759] to-blue-500 cursor-pointer" onClick={() => setView('dashboard')}>RunAlyzer</h1>
                    <div className="flex space-x-2">
                         <button onClick={openProfile} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"><Icons.User /></button>
                         <button onClick={exportDatabase} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"><Icons.Download /></button>
                    </div>
                </div>
                
                <div 
                    className="border-2 border-dashed border-white/10 rounded-xl p-4 text-center hover:border-[#34C759] hover:bg-white/5 transition-all cursor-pointer mb-4 group"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Icons.Upload />
                    <p className="text-xs text-gray-400 mt-2 group-hover:text-[#34C759]">Importar (.fit, .json, .csv)</p>
                    <input type="file" multiple ref={fileInputRef} className="hidden" accept=".fit,.json,.csv" onChange={handleFileUpload} />
                </div>
                
                <button 
                    onClick={syncIntervals}
                    className="w-full bg-[#007AFF]/20 hover:bg-[#007AFF] text-[#007AFF] hover:text-white border border-[#007AFF]/50 rounded-xl p-3 flex items-center justify-center transition-all mb-1 text-sm font-bold group"
                >
                    <Icons.Refresh />
                    <span className="ml-2 group-hover:text-white">Sincronizar Intervals</span>
                </button>
                <div className="flex items-center justify-center mb-4 space-x-2">
                    <span className="text-[10px] text-gray-500">Últimas</span>
                    <select 
                        value={syncCount} 
                        onChange={e => setSyncCount(Number(e.target.value))}
                        className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 outline-none"
                    >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                    </select>
                    <span className="text-[10px] text-gray-500">actividades</span>
                </div>

                 <div className="relative">
                    <input type="text" placeholder="Buscar..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-lg py-2 pl-9 pr-2 text-sm text-gray-300 focus:border-[#34C759] outline-none" />
                    <div className="absolute left-3 top-2.5 text-gray-500 text-xs"><Icons.Search /></div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
                <CalendarWidget sessions={sessions} selectedDate={selectedDate} onDateSelect={setSelectedDate} />
                
                <div className="mb-2 px-2 flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500 uppercase">Historial</span>
                    <button onClick={toggleSelectionMode} className={`text-xs p-1 rounded ${isSelectionMode ? 'text-[#34C759] bg-white/10' : 'text-gray-500 hover:text-white'}`}>
                        {isSelectionMode ? 'Cancelar' : 'Seleccionar'}
                    </button>
                </div>

                {Object.keys(groupedSessions).sort((a,b) => Number(b)-Number(a)).map(year => (
                    <div key={year} className="mb-2">
                        <div onClick={() => toggleGroup(year)} className="flex items-center px-3 py-2 text-xs font-bold text-gray-400 cursor-pointer hover:text-white">
                            <span className="mr-2 text-[10px]">{expandedGroups.has(year) ? <Icons.ChevronDown /> : <Icons.ChevronRight />}</span>
                            {year}
                        </div>
                        {expandedGroups.has(year) && Object.keys(groupedSessions[year]).sort((a,b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(monthKey => {
                            const monthDate = new Date(parseInt(year), parseInt(monthKey.split('-')[1]));
                            return (
                                <div key={monthKey} className="ml-2 mb-1 border-l border-white/10 pl-2">
                                     <div onClick={() => toggleGroup(monthKey)} className="flex items-center px-2 py-1.5 text-[11px] font-bold text-gray-500 cursor-pointer hover:text-white">
                                        <span className="mr-2 text-[8px]">{expandedGroups.has(monthKey) ? <Icons.ChevronDown /> : <Icons.ChevronRight />}</span>
                                        {getMonthName(monthDate).toUpperCase()} <span className="ml-1 opacity-50">({groupedSessions[year][monthKey].length})</span>
                                    </div>
                                    {expandedGroups.has(monthKey) && (
                                        <div className="space-y-1 mt-1">
                                            {groupedSessions[year][monthKey].map(session => {
                                                const isActive = selectedSessionId === session.id;
                                                const sportConfig = getSportConfig(session.sport);
                                                const isSelected = selectedIds.has(session.id);
                                                return (
                                                    <div 
                                                        key={session.id} 
                                                        onClick={() => {
                                                            if (isSelectionMode) toggleSelection(session.id);
                                                            else {
                                                                handleSelectSession(session.id);
                                                            }
                                                        }} 
                                                        className={`flex items-center p-2 rounded-lg cursor-pointer transition-all border ${isActive ? 'bg-white/10 border-[#34C759]/50' : 'hover:bg-white/5 border-transparent'}`}
                                                    >
                                                        {isSelectionMode ? (
                                                            <div className={`mr-3 ${isSelected ? 'text-[#34C759]' : 'text-gray-600'}`}>{isSelected ? <Icons.SquareCheck /> : <Icons.Square />}</div>
                                                        ) : (
                                                            <div className={`text-lg mr-3 ${isActive ? 'text-[#34C759]' : 'text-gray-500'}`}>{sportConfig.icon}</div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <p className={`text-xs font-medium truncate ${isActive ? 'text-white' : 'text-gray-300'}`}>{session.name}</p>
                                                            <p className="text-[10px] text-gray-500 font-mono">{(session.distance/1000).toFixed(2)}km • {formatTime(session.duration)}</p>
                                                        </div>
                                                        {!isSelectionMode && (
                                                            <button onClick={(e) => deleteSession(e, session.id)} className="ml-2 opacity-0 group-hover:opacity-100 hover:text-red-500 text-gray-600 transition-opacity"><Icons.Trash /></button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            
            <div className="p-4 border-t border-white/10 bg-[#1C1C1E]">
                {isSelectionMode && selectedIds.size > 0 ? (
                    <button onClick={deleteSelected} className="w-full bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center">
                        <span className="mr-2"><Icons.Trash /></span> Eliminar ({selectedIds.size})
                    </button>
                ) : (
                    <button onClick={clearAllSessions} className="w-full text-gray-600 hover:text-red-500 text-xs flex items-center justify-center py-2 transition-colors">
                        <span className="mr-2"><Icons.Clear /></span> Borrar Historial
                    </button>
                )}
            </div>
        </aside>
    );
};

const App = () => {
    // sessions ahora almacena solo SessionSummary (ligero)
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    // selectedSession almacena la sesión completa (pesada) solo cuando se selecciona
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    
    const [view, setView] = useState<'dashboard' | 'session'>('dashboard');
    const [dashboardTab, setDashboardTab] = useState<'overview' | 'physiology' | 'heatmap' | 'trends'>('overview');
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [playbackIndex, setPlaybackIndex] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editSport, setEditSport] = useState('');
    const [showProfile, setShowProfile] = useState(false);
    const [userProfile, setUserProfile] = useState<UserProfile>({
        age: 30, weight: 70, height: 175, gender: 'male', restHr: 60, maxHr: 190
    });
    
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [syncCount, setSyncCount] = useState(10);

    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedIds(new Set());
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const deleteSelected = async () => {
        if (confirm(`¿Eliminar ${selectedIds.size} sesiones seleccionadas?`)) {
            for (const id of selectedIds) {
                await deleteSessionFromDB(id);
            }
            setSessions(prev => prev.filter(s => !selectedIds.has(s.id)));
            if (selectedSessionId && selectedIds.has(selectedSessionId)) {
                setSelectedSessionId(null);
                setSelectedSession(null);
                setView('dashboard');
            }
            addNotification({ type: 'success', message: `${selectedIds.size} sesiones eliminadas.` });
            setSelectedIds(new Set());
            setIsSelectionMode(false);
        }
    };

    const handleShowInfo = (tab: string) => {};

    // Carga inicial optimizada: Solo resúmenes
    useEffect(() => {
        const savedProfile = localStorage.getItem('runalyzer_profile');
        if (savedProfile) setUserProfile(JSON.parse(savedProfile));

        const init = async () => {
            // CAMBIO CLAVE: Usamos getAllSessionSummaries en lugar de getAllSessionsFromDB
            const storedSummaries = await getAllSessionSummaries();
            
            if (storedSummaries.length > 0) {
                setSessions(storedSummaries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
                const now = new Date();
                const year = now.getFullYear().toString();
                const month = `${year}-${now.getMonth()}`;
                setExpandedGroups(new Set([year, month]));
                
                if (!savedProfile) {
                    const maxObserved = Math.max(...storedSummaries.map(s => s.maxHr));
                    if (maxObserved > 150) setUserProfile(p => ({...p, maxHr: maxObserved}));
                }
            } else {
                const mocks = generateMockHistory();
                setSessions(mocks); // Mocks son Session[], que cumple SessionSummary
                mocks.forEach(m => saveSessionToDB(m));
                const now = new Date();
                const year = now.getFullYear().toString();
                const month = `${year}-${now.getMonth()}`;
                setExpandedGroups(new Set([year, month]));
            }
        };
        init();
    }, []);
    
    // Cargar sesión completa solo bajo demanda
    const handleSelectSession = async (id: string) => {
        setSelectedSessionId(id);
        // Mostrar indicador de carga si fuera necesario, o limpiar sesión anterior
        setSelectedSession(null); 
        setView('session');
        setPlaybackIndex(0);
        
        try {
            const fullSession = await getFullSessionFromDB(id);
            if (fullSession) {
                // Normalizar datos antiguos que puedan tener decimales
                if (fullSession.totalElevationGain && fullSession.totalElevationGain !== Math.round(fullSession.totalElevationGain)) {
                    fullSession.totalElevationGain = Math.round(fullSession.totalElevationGain);
                    saveSessionToDB(fullSession).catch(() => {});
                }
                setSelectedSession(fullSession);
                
                // Cargar meteorología bajo demanda si la sesión no la tiene
                if (!fullSession.weather && fullSession.trackPoints && fullSession.trackPoints.length > 0) {
                    const validCoords = fullSession.trackPoints.filter(p => p.lat !== 0 && p.lon !== 0);
                    if (validCoords.length > 0 && fullSession.distance > 0) {
                        const endTime = new Date(fullSession.startTime).getTime() + fullSession.duration * 1000;
                        console.log('[Weather] Fetching for session:', fullSession.name, 'coords:', validCoords[0].lat, validCoords[0].lon);
                        fetchWeatherForSession(
                            validCoords[0].lat, 
                            validCoords[0].lon, 
                            fullSession.startTime, 
                            (() => { const ed = new Date(endTime); const p = (n: number) => String(n).padStart(2,'0'); return `${ed.getFullYear()}-${p(ed.getMonth()+1)}-${p(ed.getDate())}T${p(ed.getHours())}:${p(ed.getMinutes())}:${p(ed.getSeconds())}`; })()
                        ).then(weather => {
                            console.log('[Weather] Result:', weather);
                            if (weather) {
                                const updated = { ...fullSession, weather };
                                setSelectedSession(updated);
                                saveSessionToDB(updated).catch(() => {});
                            } else {
                                setSelectedSession({ ...fullSession, weather: undefined as any });
                            }
                        }).catch(e => {
                            console.error('[Weather] Fetch error:', e);
                            setSelectedSession({ ...fullSession, weather: undefined as any });
                        });
                    } else {
                        console.log('[Weather] No valid GPS coords in session:', fullSession.name);
                    }
                }
            } else {
                addNotification({ type: 'error', message: 'Error cargando detalles de la sesión.' });
            }
        } catch (e) {
            console.error("Error loading full session", e);
        }
    };

    const updateSessionRpe = async (rpe: number) => {
        if (!selectedSession) return;
        
        const durationMin = selectedSession.duration / 60;
        const internalLoad = Math.round(rpe * durationMin);
        
        const updatedSession: Session = {
            ...selectedSession,
            rpe: rpe,
            internalLoad: internalLoad
        };
        
        // Actualizar UI
        setSelectedSession(updatedSession);
        setSessions(prev => prev.map(s => s.id === updatedSession.id ? updatedSession : s));
        
        // Guardar en BD
        await saveSessionToDB(updatedSession);
        addNotification({ type: 'success', message: `RPE registrado. Carga Interna: ${internalLoad} UAC` });
    };

    const saveProfile = (newProfile: UserProfile) => { setUserProfile(newProfile); localStorage.setItem('runalyzer_profile', JSON.stringify(newProfile)); setShowProfile(false); addNotification({ type: 'success', message: 'Perfil actualizado.' }); };
    const addNotification = (n: Omit<Notification, 'id'>) => { const id = Math.random().toString(36).substring(7); setNotifications(prev => [...prev, { ...n, id }]); };
    const removeNotification = (id: string) => { setNotifications(prev => prev.filter(n => n.id !== id)); };
    
    const updateSession = async () => { 
        if (!selectedSession) return; 
        const updatedSession = { ...selectedSession, name: editName, sport: editSport }; 
        
        // Actualizar estado local (completo y resumen)
        setSelectedSession(updatedSession);
        setSessions(prev => prev.map(item => item.id === selectedSession.id ? updatedSession : item)); 
        
        await saveSessionToDB(updatedSession); 
        setIsEditing(false); 
        addNotification({ type: 'success', message: 'Sesión actualizada correctamente.' }); 
    };

    const handleDataLoaded = async (newSessions: Session[]) => { 
        const existingIds = new Set(sessions.map(s => s.id)); 
        const uniqueSessions = newSessions.filter(s => !existingIds.has(s.id)); 
        const duplicatesCount = newSessions.length - uniqueSessions.length; 
        
        if (uniqueSessions.length === 0) { 
            addNotification({ type: 'info', message: duplicatesCount > 0 ? `Se ignoraron ${duplicatesCount} archivo(s) duplicado(s).` : 'No se encontraron sesiones nuevas.' }); 
            return; 
        } 
        
        for (const s of uniqueSessions) await saveSessionToDB(s); 
        
        // Al añadir, solo guardamos en RAM la parte ligera para no bloquear
        const newSummaries: SessionSummary[] = uniqueSessions.map(({ trackPoints, ...rest }) => rest);
        
        setSessions(prev => { 
            return [...prev, ...newSummaries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()); 
        }); 
        
        const newGroups = new Set(expandedGroups); 
        uniqueSessions.forEach(s => { const d = new Date(s.startTime); newGroups.add(d.getFullYear().toString()); newGroups.add(`${d.getFullYear()}-${d.getMonth()}`); }); 
        setExpandedGroups(newGroups); 
        addNotification({ type: 'success', message: `Importadas ${uniqueSessions.length} sesiones.` + (duplicatesCount > 0 ? ` (${duplicatesCount} duplicados ignorados)` : '') }); 
    };

    const syncIntervals = async () => {
        if (!userProfile.intervalsApiKey || !userProfile.intervalsAthleteId) {
            addNotification({ type: 'error', message: 'Configura API Key y Athlete ID de Intervals.icu en tu Perfil primero.' });
            setShowProfile(true);
            return;
        }
        
        try {
            const addedSessions = await importFromIntervals(
                userProfile.intervalsAthleteId, 
                userProfile.intervalsApiKey,
                (msg) => addNotification({ type: 'info', message: msg }),
                syncCount
            );
            
            if (addedSessions.length > 0) {
                await handleDataLoaded(addedSessions);
            }
        } catch (error: any) {
            addNotification({ type: 'error', message: `Error sincronizando Intervals: ${error.message}` });
        }
    };

    const deleteSession = async (e: React.MouseEvent, id: string) => { e.stopPropagation(); if (confirm('¿Seguro que quieres borrar esta sesión?')) { await deleteSessionFromDB(id); setSessions(prev => prev.filter(s => s.id !== id)); if (selectedSessionId === id) { setSelectedSessionId(null); setSelectedSession(null); setView('dashboard'); } addNotification({ type: 'success', message: 'Sesión eliminada correctamente.' }); } };
    const clearAllSessions = async () => { if (confirm('¿BORRAR TODO EL HISTORIAL? Esta acción no se puede deshacer.')) { await clearDB(); setSessions([]); setSelectedSession(null); setView('dashboard'); addNotification({ type: 'success', message: 'Base de datos vaciada.' }); } };
    
    const exportDatabase = async () => { 
        addNotification({ type: 'info', message: 'Preparando backup completo...' });
        import('./db').then(async ({ getAllSessionsFromDB }) => {
             const allSessions = await getAllSessionsFromDB();
             const json = JSON.stringify(allSessions, null, 2); 
             const blob = new Blob([json], { type: 'application/json' }); 
             const url = URL.createObjectURL(blob); 
             const a = document.createElement('a'); 
             a.href = url; 
             a.download = `runalyzer-backup-${new Date().toISOString().split('T')[0]}.json`; 
             a.click(); 
             addNotification({ type: 'success', message: 'Backup descargado.' }); 
        });
    };
    
    const toggleGroup = (key: string) => { const newSet = new Set(expandedGroups); if (newSet.has(key)) newSet.delete(key); else newSet.add(key); setExpandedGroups(newSet); };

    const renderDashboard = () => (
        <div className="space-y-6 pb-10">
            <div className="flex space-x-2 bg-white/5 p-1 rounded-xl w-fit mb-4">
                <button onClick={() => setDashboardTab('overview')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'overview' ? 'bg-[#34C759] text-black' : 'text-gray-400 hover:text-white'}`}><Icons.List /> <span className="ml-1">Resumen</span></button>
                <button onClick={() => setDashboardTab('physiology')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'physiology' ? 'bg-[#007AFF] text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Chart /> <span className="ml-1">Fisiología</span></button>
                <button onClick={() => setDashboardTab('trends')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'trends' ? 'bg-purple-500 text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Trend /> <span className="ml-1">Tendencias</span></button>
                <button onClick={() => setDashboardTab('heatmap')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'heatmap' ? 'bg-pink-500 text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Map /> <span className="ml-1">Mapa de Calor</span></button>
            </div>

            {dashboardTab === 'overview' && (
                <>
                    <AggregatedStats sessions={sessions as any} />
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6"><WeeklyVolumeChart sessions={sessions as any} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><RacePredictor sessions={sessions as any} onShowInfo={() => handleShowInfo('riegel')} /></div>
                    {sessions.length > 0 && (<div className="mt-4"><RecentActivitiesList sessions={sessions as any} onSelectSession={handleSelectSession} /></div>)}
                </>
            )}
            {dashboardTab === 'physiology' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <RecoveryAdvisor sessions={sessions as any} onShowInfo={() => handleShowInfo('recovery')} />
                        <IntensityDistribution sessions={sessions as any} profile={userProfile} onShowInfo={() => handleShowInfo('polarized')} />
                        <InjuryPreventionCard sessions={sessions as any} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><AdvancedAnalytics sessions={sessions as any} profile={userProfile} onShowInfo={handleShowInfo} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><PersonalRecords sessions={sessions as any} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><FitnessTrendChart sessions={sessions as any} /></div>
                </>
            )}
            {dashboardTab === 'trends' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <TrendAnalysis sessions={sessions as any} profile={userProfile} />
                </div>
            )}
            {dashboardTab === 'heatmap' && (
                 <GlobalHeatmap sessions={sessions as any} />
            )}
        </div>
    );

    const renderSession = () => {
        if (!selectedSession) return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#34C759] mx-auto mb-4"></div>
                    <p className="text-gray-400">Cargando datos de alta precisión...</p>
                </div>
            </div>
        );

        const currentSession = selectedSession;
        const trackPoint = currentSession.trackPoints[Math.floor(playbackIndex)] || currentSession.trackPoints[0];
        const displaySport = isEditing ? editSport : currentSession.sport;
        const sportConfig = getSportConfig(displaySport);

        return (
            <div className="space-y-6 pb-10 h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex-1">
                        {isEditing ? (
                            <div className="flex flex-col space-y-2 md:flex-row md:space-y-0 md:space-x-2 items-start md:items-center">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-white/10 ${sportConfig.color} transition-all duration-300`}>
                                    {sportConfig.icon}
                                </div>
                                <input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-white/10 text-white text-xl font-bold rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-[#34C759] w-full md:w-auto" />
                                <select value={editSport} onChange={(e) => setEditSport(e.target.value)} className="bg-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#34C759]">
                                    <option value="RUNNING">Carrera</option><option value="TRAIL_RUNNING">Trail</option><option value="CYCLING">Ciclismo</option><option value="MOUNTAIN_BIKING">BTT</option><option value="SWIMMING">Natación</option><option value="HIIT">HIIT</option><option value="WALKING">Caminar</option><option value="HIKING">Senderismo</option><option value="ACTIVITY">Actividad</option>
                                </select>
                                <div className="flex space-x-2 mt-2 md:mt-0">
                                    <button onClick={updateSession} className="bg-[#34C759] text-black px-3 py-1 rounded-lg text-xs font-bold hover:opacity-90"><Icons.Check /></button>
                                    <button onClick={() => setIsEditing(false)} className="bg-white/10 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-white/20"><Icons.XMark /></button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl bg-white/5 mr-4 ${sportConfig.color}`}>
                                    {sportConfig.icon}
                                </div>
                                <div>
                                    <h2 className="text-2xl font-bold text-white flex items-center group">{currentSession.name}<button onClick={() => { setEditName(currentSession.name); setEditSport(currentSession.sport); setIsEditing(true); }} className="ml-3 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-[#34C759] transition-all text-sm"><Icons.Pen /></button></h2>
                                    <p className="text-gray-500 text-sm flex items-center mt-1"><Icons.Calendar /> <span className="ml-2">{new Date(currentSession.startTime).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}</span></p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                {/* WIDGET DE RPE AÑADIDO AQUÍ */}
                <RpeInputWidget 
                    sessionEndTime={currentSession.startTime} // Usamos StartTime + Duration aprox, o StartTime si no hay duración
                    currentRpe={currentSession.rpe}
                    onSave={updateSessionRpe}
                />

                <div className="glass-panel p-4 rounded-3xl mt-4">
                     <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        <SummaryItem label="Tiempo" value={formatTime(currentSession.duration)} unit="" />
                        <SummaryItem label="Distancia" value={(currentSession.distance/1000).toFixed(2)} unit="km" />
                        <SummaryItem label="Ritmo" value={formatPace((1000/(currentSession.distance/currentSession.duration))/60)} unit="/km" />
                        <SummaryItem label="FC Media" value={currentSession.avgHr} unit="bpm" />
                        <SummaryItem label="Calorías" value={currentSession.calories} unit="kcal" />
                        <SummaryItem label="Desnivel +" value={Math.round(currentSession.totalElevationGain)} unit="m" />
                        <SummaryItem label="Carga" value={currentSession.trimp || '-'} unit="TRIMP" color="text-purple-400" />
                        <SummaryItem label="Climb Score" value={currentSession.climbScore || '-'} unit="" color="text-yellow-400" />
                     </div>
                </div>
                {currentSession.weather && (
                <div className="glass-panel p-4 rounded-3xl mt-4 border border-white/10">
                    <h4 className="text-xs font-semibold text-gray-400 mb-3 flex items-center">
                        <svg className="w-4 h-4 mr-1.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>
                        Meteorología: {currentSession.weather.weatherDescription}
                    </h4>
                    <div className="grid grid-cols-4 md:grid-cols-6 gap-3 text-center">
                        <div className="bg-white/5 rounded-xl p-2">
                            <p className="text-[10px] text-gray-500">Temp</p>
                            <p className="text-sm font-bold text-white">{currentSession.weather.temperature}°C</p>
                            <p className="text-[9px] text-gray-600">Sens. {currentSession.weather.feelsLike}°C</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2">
                            <p className="text-[10px] text-gray-500">Humedad</p>
                            <p className="text-sm font-bold text-blue-300">{currentSession.weather.humidity}%</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2">
                            <p className="text-[10px] text-gray-500">Viento</p>
                            <p className="text-sm font-bold text-cyan-300">{currentSession.weather.windSpeed} km/h</p>
                            <p className="text-[9px] text-gray-600">{getWindDirectionLabel(currentSession.weather.windDirection)}</p>
                        </div>
                        <div className="bg-white/5 rounded-xl p-2">
                            <p className="text-[10px] text-gray-500">Lluvia</p>
                            <p className="text-sm font-bold text-blue-400">{currentSession.weather.precipitation} mm</p>
                        </div>
                        {currentSession.weather.temperature > 25 && (
                        <div className="bg-amber-500/10 rounded-xl p-2 border border-amber-500/20 col-span-2">
                            <p className="text-[10px] text-amber-400">⚠ Calor: el ritmo puede estar penalizado ~2-3% por encima de 25°C</p>
                        </div>
                        )}
                        {currentSession.weather.windSpeed > 20 && (
                        <div className="bg-cyan-500/10 rounded-xl p-2 border border-cyan-500/20 col-span-2">
                            <p className="text-[10px] text-cyan-400">💨 Viento fuerte: pudo afectar al ritmo según dirección</p>
                        </div>
                        )}
                    </div>
                </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 mt-4 h-[450px]">
                    <div className="lg:col-span-2 relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl h-full">
                        <MapComponent trackPoints={currentSession.trackPoints} currentIndex={Math.floor(playbackIndex)} />
                        <div className="absolute top-4 left-4 right-4 flex justify-between pointer-events-none">
                            <div className="bg-black/60 backdrop-blur-md rounded-xl p-3 flex space-x-6 text-white border border-white/5">
                                <div><p className="text-[10px] text-gray-400 uppercase font-bold">Tiempo Actual</p><p className="font-mono text-xl">{formatTime(trackPoint ? (new Date(trackPoint.timestamp).getTime() - new Date(currentSession.startTime).getTime())/1000 : 0)}</p></div>
                                <div><p className="text-[10px] text-gray-400 uppercase font-bold">Distancia</p><p className="font-mono text-xl">{trackPoint ? (trackPoint.dist / 1000).toFixed(2) : '0.00'} <span className="text-xs text-gray-500">km</span></p></div>
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-1 h-full flex flex-col space-y-4">
                        <div className="flex-1 flex flex-col glass-panel rounded-3xl p-4 overflow-hidden relative">
                             <div className="flex-1 min-h-0">
                                 <ElevationChart trackPoints={currentSession.trackPoints} currentIndex={Math.floor(playbackIndex)} />
                             </div>
                             <div className="mt-2 px-2">
                                <input type="range" min="0" max={currentSession.trackPoints.length - 1} value={playbackIndex} onChange={(e) => setPlaybackIndex(Number(e.target.value))} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
                             </div>
                        </div>
                        <div className="h-32">
                             <ZoneDistributionChart trackPoints={currentSession.trackPoints} maxHr={userProfile.maxHr} restHr={userProfile.restHr} customZones={userProfile.customZones} />
                        </div>
                        <div className="grid grid-cols-2 gap-4 h-24">
                             <MetricCard label="Frecuencia" value={trackPoint?.hr || '--'} unit="bpm" colorClass="text-rose-500" icon={<Icons.Heart />} />
                             <MetricCard label="Ritmo" value={trackPoint?.speed ? formatPace((1000/trackPoint.speed)/60 * 3.6) : '--'} unit="/km" colorClass="text-green-500" icon={<Icons.Run />} />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen bg-black text-white font-sans overflow-hidden selection:bg-[#34C759] selection:text-black">
            <Sidebar 
                sessions={sessions} view={view} setView={setView} selectedSessionId={selectedSessionId} handleSelectSession={handleSelectSession} setSelectedSessionId={setSelectedSessionId}
                setPlaybackIndex={setPlaybackIndex} searchQuery={searchQuery} setSearchQuery={setSearchQuery} selectedDate={selectedDate}
                setSelectedDate={setSelectedDate} expandedGroups={expandedGroups} toggleGroup={toggleGroup} exportDatabase={exportDatabase}
                clearAllSessions={clearAllSessions} handleDataLoaded={handleDataLoaded} deleteSession={deleteSession} addNotification={addNotification}
                openProfile={() => setShowProfile(true)}
                isSelectionMode={isSelectionMode} toggleSelectionMode={toggleSelectionMode} selectedIds={selectedIds} toggleSelection={toggleSelection} deleteSelected={deleteSelected}
                syncIntervals={syncIntervals}
                syncCount={syncCount}
                setSyncCount={setSyncCount}
            />
            <main className="flex-1 h-full overflow-y-auto relative scrollbar-hide">
                <div className="max-w-7xl mx-auto p-8 pt-12">
                    {view === 'dashboard' ? renderDashboard() : renderSession()}
                </div>
            </main>
            <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
                {notifications.map(n => (<NotificationToast key={n.id} notification={n} onClose={() => removeNotification(n.id)} />))}
            </div>
            <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} profile={userProfile} onSave={saveProfile} />
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);