import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Session, UserProfile, TrackPoint, DailyFitness } from './types';
import { Icons, getSportConfig } from './icons';
import { InfoTooltip, MetricCard } from './components';
import { calculateGlobalVo2Max, formatPace, formatTime, calculateIndividualizedK, calculateACWR } from './utils';
import { getAllSessionsFromDB, getFullSessionFromDB } from './db'; 

// --- COMPONENTES AUXILIARES PARA ANALYTICS ---

export const InjuryPreventionCard = ({ sessions }: { sessions: Session[] }) => {
    const acwr = calculateACWR(sessions);
    
    // Configuración visual según estado
    const statusConfig = {
        'OPTIMAL': { label: 'Zona Segura', color: 'text-green-500', bar: 'bg-green-500', msg: 'Carga balanceada.' },
        'CAUTION': { label: 'Precaución', color: 'text-yellow-500', bar: 'bg-yellow-500', msg: 'Riesgo moderado. Monitoriza fatiga.' },
        'DANGER': { label: 'Sobrecarga', color: 'text-red-500', bar: 'bg-red-500', msg: 'Alto riesgo (>1.5). Reduce volumen.' },
        'UNDEFINED': { label: 'Faltan Datos', color: 'text-gray-500', bar: 'bg-gray-500', msg: 'Se necesitan 4 semanas de sRPE.' }
    };
    
    const conf = statusConfig[acwr.status];
    
    // Posición del marcador en la barra (0.5 a 2.0)
    const markerPos = Math.max(0, Math.min(100, ((acwr.ratio - 0.5) / 1.5) * 100));

    return (
        <div className="glass-panel p-4 rounded-3xl flex flex-col justify-between">
            <h5 className="text-xs font-bold text-gray-400 uppercase mb-2 flex justify-between items-center">
                Prevención Lesiones <InfoTooltip type="acwr" />
            </h5>
            
            <div className="flex items-end justify-between mb-2">
                <div>
                    <span className={`text-2xl font-bold font-mono ${conf.color}`}>{acwr.ratio.toFixed(2)}</span>
                    <span className="text-[10px] text-gray-500 ml-1 font-bold uppercase">{conf.label}</span>
                </div>
                <div className="text-right">
                    <p className="text-[10px] text-gray-400">Aguda: <span className="text-white font-mono">{Math.round(acwr.acuteLoad)}</span></p>
                    <p className="text-[10px] text-gray-400">Crónica: <span className="text-white font-mono">{Math.round(acwr.chronicLoad)}</span></p>
                </div>
            </div>

            <div className="relative h-2 w-full bg-gray-800 rounded-full mb-2 overflow-hidden">
                {/* Zonas de fondo */}
                <div className="absolute left-0 top-0 h-full w-[20%] bg-red-900/30"></div> {/* < 0.8 */}
                <div className="absolute left-[20%] top-0 h-full w-[33%] bg-green-500/30"></div> {/* 0.8 - 1.3 */}
                <div className="absolute left-[53%] top-0 h-full w-[13%] bg-yellow-500/30"></div> {/* 1.3 - 1.5 */}
                <div className="absolute left-[66%] top-0 h-full w-[34%] bg-red-500/30"></div> {/* > 1.5 */}
                
                {/* Marcador */}
                {acwr.status !== 'UNDEFINED' && (
                    <div 
                        className={`absolute top-0 w-1 h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] transition-all duration-500`} 
                        style={{ left: `${markerPos}%` }}
                    ></div>
                )}
            </div>
            
            <p className="text-[9px] text-gray-500">{conf.msg}</p>
        </div>
    );
};

export const AdvancedAnalytics = ({ sessions, profile, onShowInfo }: { sessions: Session[], profile: UserProfile, onShowInfo: (t: string) => void }) => {
    let vt1_hr, vt2_hr;

    if (profile.customZones) {
        // En perfil manual, VT1 suele ser el tope de Z2, VT2 el tope de Z4
        vt1_hr = profile.customZones.z2;
        vt2_hr = profile.customZones.z4;
    } else {
        const fcr = profile.maxHr - profile.restHr;
        vt1_hr = Math.round(profile.restHr + (0.60 * fcr));
        vt2_hr = Math.round(profile.restHr + (0.85 * fcr));
    }
    
    const runSessions = sessions.filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0 && s.avgHr > 0);
    const last4Weeks = sessions.filter(s => (new Date().getTime() - new Date(s.startTime).getTime()) < 2419200000);
    
    const maxVam = Math.max(...runSessions.map(s => s.vam6min || 0), 0);
    const vo2Data = calculateGlobalVo2Max(sessions);
    const avgTrimp = last4Weeks.length > 0 ? Math.round(last4Weeks.reduce((a,b)=>a+(b.trimp||0),0) / last4Weeks.length) : 0;
    
    const recentRuns = runSessions.slice(0, 10);
    const efficiency = recentRuns.length > 0 
        ? (recentRuns.reduce((acc, s) => acc + ((s.distance/s.duration) / s.avgHr), 0) / recentRuns.length * 10000).toFixed(1)
        : '--';

    const avgSpeedLastMonth = last4Weeks.filter(s=>s.sport==='RUNNING').reduce((acc, s) => acc + (s.distance/s.duration), 0) / (last4Weeks.filter(s=>s.sport==='RUNNING').length || 1);
    const estimatedPower = avgSpeedLastMonth > 0 ? Math.round(profile.weight * avgSpeedLastMonth * 1.04) : '--';
    const paceVam = maxVam > 0 ? formatPace(60 / maxVam) : '--';
    
    const hasStride = recentRuns.some(s => s.avgStrideLength && s.avgStrideLength > 0);
    const hasSensors = recentRuns.some(s => s.avgGroundContactTime && s.avgGroundContactTime > 0);
    
    const avgStride = hasStride ? recentRuns.reduce((acc,s) => acc + (s.avgStrideLength || 0), 0) / recentRuns.filter(s=>s.avgStrideLength).length : 0;
    const avgGCT = hasSensors ? recentRuns.reduce((acc,s) => acc + (s.avgGroundContactTime || 0), 0) / recentRuns.filter(s=>s.avgGroundContactTime).length : 0;

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4 relative overflow-hidden">
             <div className="absolute right-0 top-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
             <div className="flex justify-between items-center mb-4 relative z-10"><h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Bolt /> <span className="ml-2">Analítica Avanzada de Rendimiento</span></h4></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 relative z-10">
                <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-[#007AFF] uppercase tracking-wide mb-2 border-b border-[#007AFF]/30 pb-1 flex items-center justify-between">Umbrales <InfoTooltip type="zones" /></h5>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">{profile.customZones ? 'Z2 Max' : 'VT1 (Aeróbico)'}</span><span className="text-lg font-mono font-bold">{vt1_hr} <span className="text-[10px] text-gray-500">bpm</span></span></div>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">{profile.customZones ? 'Z4 Max' : 'VT2 (Anaeróbico)'}</span><span className="text-lg font-mono font-bold">{vt2_hr} <span className="text-[10px] text-gray-500">bpm</span></span></div>
                </div>
                <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-[#34C759] uppercase tracking-wide mb-2 border-b border-[#34C759]/30 pb-1 flex items-center justify-between">Potencia & Ritmo <InfoTooltip type="vam" /></h5>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">VAM (6 min)</span><div className="text-right"><p className="text-lg font-mono font-bold text-[#34C759]">{paceVam} <span className="text-[10px] text-gray-500">/km</span></p></div></div>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Potencia Est.</span><div className="text-right"><p className="text-lg font-mono font-bold text-yellow-500">{estimatedPower} <span className="text-[10px] text-gray-500">w</span></p></div> <InfoTooltip type="power" /></div>
                </div>
                <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-purple-500 uppercase tracking-wide mb-2 border-b border-purple-500/30 pb-1 flex items-center justify-between">Carga & Eficiencia <InfoTooltip type="trimp" /></h5>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">TRIMP (4 sem)</span><span className="text-lg font-mono font-bold text-white">{avgTrimp} <span className="text-[9px] text-gray-500 font-sans font-normal">pts</span></span></div>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Eficiencia (Ratio)</span><span className="text-lg font-mono font-bold text-blue-300">{efficiency}</span> <InfoTooltip type="efficiency" /></div>
                </div>
                {hasStride && (
                     <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                        <h5 className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-2 border-b border-orange-400/30 pb-1 flex items-center justify-between">Técnica (Media) <InfoTooltip type="stride" /></h5>
                        <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Zancada</span><span className="text-lg font-mono font-bold text-white">{avgStride.toFixed(2)} <span className="text-[9px] text-gray-500 font-sans font-normal">m</span></span></div>
                        {hasSensors ? (
                            <div className="flex justify-between items-center"><span className="text-xs text-gray-400">GCT</span><span className="text-lg font-mono font-bold text-orange-300">{Math.round(avgGCT)} <span className="text-[9px] text-gray-500 font-sans font-normal">ms</span></span> <InfoTooltip type="gct" /></div>
                        ) : (
                            <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Cadencia</span><span className="text-lg font-mono font-bold text-orange-300">{Math.round(recentRuns[0]?.avgCadence || 0)} <span className="text-[9px] text-gray-500 font-sans font-normal">spm</span></span></div>
                        )}
                    </div>
                )}
                 <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-pink-500 uppercase tracking-wide mb-2 border-b border-pink-500/30 pb-1 flex items-center justify-between">VO2 Max (Global) <InfoTooltip type="vo2" /></h5>
                    <div className="flex flex-col justify-center space-y-2 h-full">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400">Fisiológico (ACSM)</span>
                            <span className="text-lg font-bold font-mono text-pink-500">
                                {vo2Data.physiological > 0 ? vo2Data.physiological.toFixed(1) : '--'}
                                <span className="text-[9px] text-gray-500 font-sans font-normal ml-1">ml/kg/min</span>
                            </span>
                        </div>
                        <div className="w-full h-px bg-white/10"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-gray-400">Rendimiento (VAM)</span>
                            <span className="text-lg font-bold font-mono text-pink-400">
                                {vo2Data.performance > 0 ? vo2Data.performance.toFixed(1) : '--'}
                                <span className="text-[9px] text-gray-500 font-sans font-normal ml-1">ml/kg/min</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const TrendAnalysis = memo(({ sessions, profile }: { sessions: Session[], profile: UserProfile }) => {
    const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['trimp', 'efficiency', 'vo2Acsm']);
    const [hoverData, setHoverData] = useState<any | null>(null);

    const metricsConfig: Record<string, { label: string, color: string, unit: string }> = {
        trimp: { label: 'Carga (TRIMP)', color: '#A855F7', unit: 'pts' }, 
        efficiency: { label: 'Eficiencia (EF)', color: '#3B82F6', unit: 'm/min/bpm' }, 
        vo2Acsm: { label: 'VO2 Max (Fisiológico)', color: '#EC4899', unit: 'ml/kg' }, 
        vo2Vam: { label: 'VO2 Max (Rendimiento)', color: '#10B981', unit: 'ml/kg' }, 
        power: { label: 'Potencia Est.', color: '#EAB308', unit: 'w' },
        stride: { label: 'Zancada', color: '#F97316', unit: 'm' },
        gct: { label: 'GCT', color: '#14B8A6', unit: 'ms' }
    };

    const chartData = useMemo(() => {
        const valid = sessions
            .filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0 && s.avgHr > 0)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()); 

        return valid.map(s => {
            const speedMmin = (s.distance / s.duration) * 60;
            const ef = s.avgHr > 0 ? (speedMmin / s.avgHr) : 0;
            let vo2Vam = 0;
            if (s.vam6min) vo2Vam = 3.5 + 0.2 * (s.vam6min * 60);
            
            const power = s.distance > 0 ? (profile.weight * (s.distance/s.duration) * 1.04) : 0;

            return {
                date: new Date(s.startTime).toLocaleDateString(),
                timestamp: new Date(s.startTime).getTime(),
                trimp: s.trimp || 0,
                efficiency: parseFloat(ef.toFixed(2)),
                vo2Acsm: parseFloat((s.acsmVo2Max || 0).toFixed(2)),
                vo2Vam: parseFloat(vo2Vam.toFixed(1)),
                power: Math.round(power),
                stride: parseFloat((s.avgStrideLength || 0).toFixed(2)),
                gct: Math.round(s.avgGroundContactTime || 0)
            };
        }).slice(-30); 
    }, [sessions, profile]);

    if (chartData.length < 2) return (
        <div className="glass-panel p-10 rounded-3xl col-span-2 md:col-span-4 flex flex-col items-center justify-center text-gray-500">
            <Icons.Chart />
            <p className="mt-2 text-sm">Necesitas al menos 2 sesiones de carrera con datos de pulso para ver tendencias.</p>
        </div>
    );

    const toggleMetric = (key: string) => {
        setSelectedMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    };

    const width = 1000;
    const height = 400;
    const padding = 20;

    const renderLine = (metricKey: string) => {
        const config = metricsConfig[metricKey];
        if (!config) return null;

        const values = chartData.map(d => (d as any)[metricKey]);
        const validValues = values.filter(v => v > 0);
        if (validValues.length === 0) return null;

        const min = Math.min(...validValues);
        const max = Math.max(...validValues);
        const range = max - min || 1; 

        const points = chartData.map((d, i) => {
            const val = (d as any)[metricKey];
            if (val === 0) return null; 
            const x = (i / (chartData.length - 1)) * width;
            const y = height - padding - (((val - min) / range) * (height - padding * 2));
            return `${x},${y}`;
        }).filter(p => p !== null).join(' L'); 

        return (
            <path 
                key={metricKey} 
                d={`M${points}`} 
                fill="none" 
                stroke={config.color} 
                strokeWidth="3" 
                strokeLinecap="round" 
                vectorEffect="non-scaling-stroke"
                className="opacity-80 hover:opacity-100 transition-opacity"
            />
        );
    };

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
                <div>
                    <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Trend /> <span className="ml-2">Tendencias y Correlaciones</span></h4>
                    <p className="text-[10px] text-gray-500 mt-1">Evolución de las últimas 30 sesiones. Gráficas normalizadas.</p>
                </div>
                <div className="flex flex-wrap gap-2 mt-4 md:mt-0">
                    {Object.keys(metricsConfig).map(key => {
                        if (key === 'stride' || key === 'gct') {
                             if (!chartData.some(d => (d as any)[key] > 0)) return null;
                        }
                        return (
                            <button 
                                key={key} 
                                onClick={() => toggleMetric(key)}
                                className={`flex items-center px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${selectedMetrics.includes(key) ? 'bg-white/10 text-white' : 'bg-transparent text-gray-500 border-gray-700 opacity-50'}`}
                                style={{ borderColor: selectedMetrics.includes(key) ? metricsConfig[key].color : 'transparent' }}
                            >
                                <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: metricsConfig[key].color }}></div>
                                {metricsConfig[key].label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="relative w-full h-80 cursor-crosshair">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <line x1="0" y1={padding} x2={width} y2={padding} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                    <line x1="0" y1={height/2} x2={width} y2={height/2} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                    <line x1="0" y1={height-padding} x2={width} y2={height-padding} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />

                    {selectedMetrics.map(key => renderLine(key))}

                    {chartData.map((d, i) => {
                        const x = (i / (chartData.length - 1)) * width;
                        return (
                            <rect 
                                key={i}
                                x={x - (width/chartData.length)/2}
                                y={0}
                                width={width/chartData.length}
                                height={height}
                                fill="transparent"
                                onMouseEnter={(e) => setHoverData({ x: e.clientX, y: e.clientY, data: d })}
                                onMouseLeave={() => setHoverData(null)}
                            />
                        );
                    })}
                    
                    {hoverData && (
                        <line 
                            x1={(chartData.findIndex(d => d.timestamp === hoverData.data.timestamp) / (chartData.length - 1)) * width} 
                            y1={0} 
                            x2={(chartData.findIndex(d => d.timestamp === hoverData.data.timestamp) / (chartData.length - 1)) * width} 
                            y2={height} 
                            stroke="white" 
                            strokeWidth="1" 
                            strokeDasharray="2,2" 
                            opacity="0.3" 
                        />
                    )}
                </svg>

                {hoverData && createPortal(
                    <div 
                        className="fixed z-[9999] bg-[#1C1C1E]/95 backdrop-blur border border-white/20 p-3 rounded-xl shadow-2xl pointer-events-none transform -translate-x-1/2 -translate-y-full min-w-[150px]" 
                        style={{ left: hoverData.x, top: hoverData.y - 20 }}
                    >
                        <p className="text-xs text-gray-300 font-bold border-b border-white/10 pb-1 mb-2">{hoverData.data.date}</p>
                        <div className="space-y-1">
                            {selectedMetrics.map(key => {
                                 const val = hoverData.data[key];
                                 if (val === 0 && (key === 'stride' || key === 'gct')) return null;
                                 return (
                                    <div key={key} className="flex justify-between items-center text-[10px]">
                                        <span className="flex items-center text-gray-400">
                                            <div className="w-1.5 h-1.5 rounded-full mr-2" style={{ backgroundColor: metricsConfig[key].color }}></div>
                                            {metricsConfig[key].label}
                                        </span>
                                        <span className="font-mono font-bold text-white ml-3">
                                            {val} <span className="text-gray-600 font-normal">{metricsConfig[key].unit}</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>,
                    document.body
                )}
            </div>
            
            <div className="flex justify-between mt-2 text-[9px] text-gray-500 font-mono uppercase border-b border-white/5 pb-4">
                <span>{chartData[0].date}</span>
                <span>{chartData[chartData.length - 1].date}</span>
            </div>

            <div className="mt-6 pt-2">
                <h5 className="text-xs font-bold text-gray-300 uppercase mb-4 flex items-center border-b border-white/10 pb-2">
                    <Icons.Info /> <span className="ml-2">Guía de Interpretación Técnica</span>
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-[11px] text-gray-400">
                    <div className="space-y-2">
                        <p><strong className="text-blue-400">Eficiencia (EF):</strong> Velocidad/Pulsaciones. Si sube, corres más rápido al mismo pulso.</p>
                        <p><strong className="text-purple-400">Carga (TRIMP):</strong> Estrés acumulado. Si sube mucho sin descanso, riesgo de lesión.</p>
                    </div>
                    <div className="space-y-2">
                         <p><strong className="text-green-400">Pico de Forma:</strong> Cuando la Eficiencia sube y la Carga se estabiliza o baja.</p>
                         <p><strong className="text-red-400">Desacople:</strong> Cuando la eficiencia cae en picado a mitad de gráfica para la misma velocidad.</p>
                    </div>
                </div>
            </div>
        </div>
    );
});

export const RecoveryAdvisor = ({ sessions, onShowInfo }: { sessions: Session[], onShowInfo: (t: string) => void }) => {
    const lastSession = sessions[0];
    if (!lastSession) return null;
    
    // Simple recovery model: 1 TRIMP ~ 6 mins recovery (arbitrary but standard approximation range)
    // Full recovery time hours = TRIMP / 10
    const hoursNeeded = (lastSession.trimp || 0) / 8; 
    const hoursPassed = (new Date().getTime() - new Date(lastSession.startTime).getTime()) / 3600000;
    const remaining = Math.max(0, hoursNeeded - hoursPassed);
    const percent = Math.min(100, Math.max(0, (hoursPassed / hoursNeeded) * 100));

    return (
        <div className="glass-panel p-4 rounded-3xl">
            <h5 className="text-xs font-bold text-blue-400 uppercase mb-2 flex justify-between">Recuperación <InfoTooltip type="recovery" /></h5>
            <div className="text-center py-2">
                <p className="text-2xl font-bold font-mono text-white">{remaining > 0 ? `${Math.ceil(remaining)}h` : 'Lista'}</p>
                <p className="text-[10px] text-gray-500">{remaining > 0 ? 'Para recuperación completa' : 'Estás listo para entrenar'}</p>
            </div>
            <div className="h-1.5 w-full bg-white/10 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${remaining > 0 ? 'bg-blue-500' : 'bg-green-500'}`} style={{ width: `${percent}%` }}></div>
            </div>
        </div>
    );
};

export const IntensityDistribution = ({ sessions, profile, onShowInfo }: { sessions: Session[], profile: UserProfile, onShowInfo: (t: string) => void }) => {
    let z1End, z3End;

    if (profile.customZones) {
        // En polarizado 3 zonas:
        // Baja = Z1 + Z2
        // Media (Gris) = Z3
        // Alta = Z4 + Z5
        z1End = profile.customZones.z2; 
        z3End = profile.customZones.z3; // El final de la zona gris (Z3) es el inicio de la alta
    } else {
        const fcr = profile.maxHr - profile.restHr;
        z1End = Math.round(profile.restHr + 0.60 * fcr);
        z3End = Math.round(profile.restHr + 0.80 * fcr); 
    }
    
    // Estado para manejar la carga de datos completos si faltan trackpoints
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);

    // Cargar datos completos para las últimas 20 sesiones si es necesario
    useEffect(() => {
        const top20 = sessions.slice(0, 20);
        const needsLoading = top20.some(s => !s.trackPoints);
        
        if (needsLoading) {
            setLoading(true);
            const promises = top20.map(s => getFullSessionFromDB(s.id));
            Promise.all(promises).then(results => {
                const validResults = results.filter((s): s is Session => !!s);
                setFullData(validResults);
                setLoading(false);
            }).catch(() => setLoading(false));
        } else {
            setFullData(top20);
        }
    }, [sessions]);

    let low = 0, mid = 0, high = 0;
    
    // Usar fullData para cálculos
    fullData.forEach(s => {
        if (s.trackPoints) {
            s.trackPoints.forEach(p => {
                 if (p.hr > 0) {
                     if (p.hr <= z1End) low++;
                     else if (p.hr <= z3End) mid++;
                     else high++;
                 }
            });
        }
    });
    
    const total = low + mid + high || 1;
    const pLow = total > 0 ? Math.round((low/total)*100) : 0;
    const pMid = total > 0 ? Math.round((mid/total)*100) : 0;
    const pHigh = total > 0 ? Math.round((high/total)*100) : 0;

    return (
        <div className="glass-panel p-4 rounded-3xl relative">
            <h5 className="text-xs font-bold text-purple-400 uppercase mb-2 flex justify-between">Polarización (Últ 20) <InfoTooltip type="polarized" /></h5>
            {loading ? (
                <div className="h-20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500"></div>
                </div>
            ) : (
                <div className="flex justify-between items-end h-20 px-2 space-x-2">
                    <div className="w-1/3 flex flex-col items-center h-full justify-end">
                        <span className="text-[10px] text-green-400 font-bold mb-1">{pLow}%</span>
                        <div className="w-full bg-green-500/20 rounded-t-lg relative" style={{ height: `${Math.max(4, pLow)}%` }}><div className="absolute bottom-0 w-full bg-green-500 rounded-t-lg" style={{ height: '4px' }}></div></div>
                        <span className="text-[9px] text-gray-500 mt-1">Baja</span>
                    </div>
                     <div className="w-1/3 flex flex-col items-center h-full justify-end">
                        <span className="text-[10px] text-yellow-400 font-bold mb-1">{pMid}%</span>
                        <div className="w-full bg-yellow-500/20 rounded-t-lg relative" style={{ height: `${Math.max(4, pMid)}%` }}><div className="absolute bottom-0 w-full bg-yellow-500 rounded-t-lg" style={{ height: '4px' }}></div></div>
                        <span className="text-[9px] text-gray-500 mt-1">Zona Gris</span>
                    </div>
                     <div className="w-1/3 flex flex-col items-center h-full justify-end">
                        <span className="text-[10px] text-red-400 font-bold mb-1">{pHigh}%</span>
                        <div className="w-full bg-red-500/20 rounded-t-lg relative" style={{ height: `${Math.max(4, pHigh)}%` }}><div className="absolute bottom-0 w-full bg-red-500 rounded-t-lg" style={{ height: '4px' }}></div></div>
                        <span className="text-[9px] text-gray-500 mt-1">Alta</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export const GlobalHeatmap = ({ sessions }: { sessions: Session[] }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);

    // Estrategia de Carga Asíncrona para Heatmap
    // Como las sesiones iniciales son 'SessionSummary' (sin trackPoints),
    // si detectamos que faltan datos, pedimos a la DB las sesiones completas SOLO para el heatmap.
    useEffect(() => {
        const needsLoading = sessions.some(s => !s.trackPoints || s.trackPoints.length === 0);
        
        if (needsLoading && !loading && fullData.length === 0) {
            setLoading(true);
            // Pequeño timeout para no bloquear el render inicial de la UI
            setTimeout(() => {
                getAllSessionsFromDB().then(data => {
                    setFullData(data);
                    setLoading(false);
                }).catch(e => {
                    console.error("Error cargando heatmap", e);
                    setLoading(false);
                });
            }, 100);
        } else if (!needsLoading) {
            setFullData(sessions);
        }
    }, [sessions]);

    useEffect(() => {
        if (!mapRef.current) return;
        
        // Inicializar mapa si no existe
        if (!leafletMap.current) {
            leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([40.4168, -3.7038], 5);
             L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { opacity: 0.8 }).addTo(leafletMap.current);
        }

        const map = leafletMap.current;
        const dataToRender = fullData.length > 0 ? fullData : sessions;
        const validSessions = dataToRender.filter(s => s.trackPoints && s.trackPoints.length > 0);
        
        // Limpiar capas previas
        map.eachLayer(layer => {
            if (layer instanceof L.Polyline) map.removeLayer(layer);
        });
        
        const bounds = L.latLngBounds([]);
        let hasLayer = false;

        validSessions.forEach(s => {
             // FILTRO CRÍTICO: Eliminamos coordenadas (0,0) antes de pintar
             const latlngs = s.trackPoints
                .filter(p => p.lat !== 0 && p.lon !== 0)
                .map(p => [p.lat, p.lon] as [number, number]);
             
             if (latlngs.length > 0) {
                 L.polyline(latlngs, { color: '#34C759', weight: 1.5, opacity: 0.25 }).addTo(map);
                 bounds.extend(latlngs);
                 hasLayer = true;
             }
        });
        
        if (hasLayer && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }

        return () => {
             if (leafletMap.current) {
                 leafletMap.current.remove();
                 leafletMap.current = null;
             }
        }
    }, [fullData, sessions]);

    return (
        <div className="col-span-4 h-[800px] glass-panel rounded-3xl overflow-hidden relative group">
            <div ref={mapRef} className="w-full h-full bg-[#1C1C1E]"></div>
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-white border border-white/10 pointer-events-none">
                {loading ? 'Cargando datos GPS completos...' : `Heatmap Global (${fullData.length || sessions.length} actividades)`}
            </div>
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
                     <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#34C759]"></div>
                </div>
            )}
        </div>
    );
};

export const PersonalRecords = ({ sessions }: { sessions: Session[] }) => {
    const findBest = (minDist: number, maxDist: number) => {
        const candidates = sessions.filter(s => s.distance >= minDist && s.distance <= maxDist && s.sport === 'RUNNING');
        if (candidates.length === 0) return null;
        return candidates.sort((a,b) => (b.distance/b.duration) - (a.distance/a.duration))[0];
    };

    const prs = [
        { name: '1K', session: findBest(950, 1050) },
        { name: '5K', session: findBest(4900, 5100) },
        { name: '10K', session: findBest(9900, 10100) },
        { name: '21K', session: findBest(20900, 21200) },
        { name: '42K', session: findBest(42000, 42500) },
    ].filter(p => p.session);

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4">
             <h4 className="text-sm font-semibold text-gray-400 mb-4 flex items-center"><Icons.Trophy /> <span className="ml-2">Mejores Marcas (Estimadas)</span></h4>
             <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                 {prs.map(pr => (
                     <div key={pr.name} className="bg-white/5 p-3 rounded-xl border border-white/5">
                         <p className="text-xs text-[#34C759] font-bold">{pr.name}</p>
                         <p className="text-lg font-mono font-bold text-white mt-1">{formatTime(pr.session!.duration)}</p>
                         <p className="text-[10px] text-gray-500">{new Date(pr.session!.startTime).toLocaleDateString()}</p>
                     </div>
                 ))}
                 {prs.length === 0 && <p className="text-gray-500 text-xs">No se han detectado distancias estándar.</p>}
             </div>
        </div>
    );
};

export const FitnessTrendChart = ({ sessions }: { sessions: Session[] }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const dailyData: DailyFitness[] = [];
    const now = new Date();
    const days = 90;
    
    const sorted = [...sessions].sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    let ctl = 0, atl = 0;
    const trimpMap = new Map<string, number>();
    sorted.forEach(s => {
        const k = new Date(s.startTime).toLocaleDateString();
        trimpMap.set(k, (trimpMap.get(k)||0) + (s.trimp || 0));
    });

    const start = new Date();
    start.setDate(start.getDate() - days);

    for (let i = 0; i < days; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const k = d.toLocaleDateString();
        const trimp = trimpMap.get(k) || 0;
        
        ctl = ctl + (trimp - ctl) / 42;
        atl = atl + (trimp - atl) / 7;
        const tsb = ctl - atl;
        
        dailyData.push({ date: k, ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(tsb), trimp });
    }

    const width = 800;
    const height = 200;
    const padding = 20;
    
    const maxVal = Math.max(...dailyData.map(d => Math.max(d.ctl, d.atl))) || 1;
    const minTsb = Math.min(...dailyData.map(d => d.tsb), 0);
    const maxTsb = Math.max(...dailyData.map(d => d.tsb), 0);
    const tsbRange = Math.max(10, maxTsb - minTsb);

    const getX = (i: number) => (i / (days-1)) * width;
    const getY = (val: number) => height - padding - (val/maxVal) * (height - padding*2);
    
    const zeroY = height - padding - ((0 - minTsb)/tsbRange) * (height/2);

    const pathCtl = dailyData.map((d, i) => `${getX(i)},${getY(d.ctl)}`).join(' L');
    const pathAtl = dailyData.map((d, i) => `${getX(i)},${getY(d.atl)}`).join(' L');

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-4 relative group">
             <h4 className="text-sm font-semibold text-gray-400 mb-4 flex items-center"><Icons.Chart /> <span className="ml-2">Forma Física (PMC)</span></h4>
             <div className="relative h-64 w-full">
                 <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                     <path d={`M${pathCtl}`} fill="none" stroke="#3B82F6" strokeWidth="2" />
                     <path d={`M${pathAtl}`} fill="none" stroke="#EC4899" strokeWidth="2" strokeDasharray="4,4" />
                     {dailyData.map((d, i) => {
                         const barH = Math.abs((d.tsb/tsbRange) * (height/2));
                         // Calcular posición Y base para TSB (zona media)
                         const baseY = height/2 + height/4; // Ajuste visual
                         return (
                            <rect 
                                key={i} 
                                x={getX(i) - (width/days)/2} 
                                y={d.tsb >= 0 ? baseY - barH : baseY}
                                width={width/days} 
                                height={Math.max(2, barH)}
                                fill={d.tsb >= 0 ? '#34C759' : '#EF4444'}
                                opacity={hoverIndex === i ? 1 : 0.4}
                            />
                         );
                     })}
                     {hoverIndex !== null && (
                         <line x1={getX(hoverIndex)} y1={0} x2={getX(hoverIndex)} y2={height} stroke="white" strokeDasharray="2,2" opacity="0.5" />
                     )}
                     {/* Overlay para eventos del ratón */}
                     {dailyData.map((_, i) => (
                         <rect 
                            key={`touch-${i}`}
                            x={getX(i) - (width/days)/2}
                            y={0}
                            width={width/days}
                            height={height}
                            fill="transparent"
                            onMouseEnter={() => setHoverIndex(i)}
                            onMouseLeave={() => setHoverIndex(null)}
                         />
                     ))}
                 </svg>
                 
                 {hoverIndex !== null && (
                    <div 
                        className="absolute bg-black/90 p-2 rounded border border-white/20 text-[10px] pointer-events-none z-10 top-0"
                        style={{ left: `${(hoverIndex/days)*100}%`, transform: 'translateX(-50%)' }}
                    >
                        <p className="font-bold text-gray-300 border-b border-white/10 pb-1 mb-1">{dailyData[hoverIndex].date}</p>
                        <p className="text-blue-400">Fitness: {dailyData[hoverIndex].ctl}</p>
                        <p className="text-pink-400">Fatiga: {dailyData[hoverIndex].atl}</p>
                        <p className={dailyData[hoverIndex].tsb >= 0 ? 'text-green-400' : 'text-red-400'}>Forma: {dailyData[hoverIndex].tsb}</p>
                    </div>
                 )}

                 <div className="flex justify-end space-x-4 text-[10px] mt-2">
                     <span className="text-blue-500 font-bold">Fitness (CTL)</span>
                     <span className="text-pink-500 font-bold">Fatiga (ATL)</span>
                     <span className="text-gray-400 font-bold">Forma (TSB)</span>
                 </div>
             </div>
        </div>
    );
};

export const RacePredictor = ({ sessions, onShowInfo }: { sessions: Session[], onShowInfo: (t: string) => void }) => {
    const running = sessions.filter(s => s.sport === 'RUNNING');
    if (running.length === 0) return null;
    
    const k = calculateIndividualizedK(sessions);
    
    const bestRun = running.reduce((prev, curr) => 
        (curr.distance > 3000 && curr.distance/curr.duration > prev.distance/prev.duration) ? curr : prev
    , running[0]);
    
    if (bestRun.distance < 3000) return <div className="glass-panel p-5 rounded-3xl text-gray-500 text-xs">Se necesitan carreras de +3km para predecir.</div>;

    const predict = (dist: number) => {
        const t1 = bestRun.duration;
        const d1 = bestRun.distance;
        const d2 = dist;
        const t2 = t1 * Math.pow((d2/d1), k);
        // Ritmo
        const paceSec = t2 / (d2/1000);
        return { time: formatTime(t2), pace: formatPace(paceSec/60) };
    };

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4">
             <div className="flex justify-between items-center mb-4">
                 <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Flag /> <span className="ml-2">Predicción de Carrera</span></h4>
                 <div className="text-[10px] text-gray-500 bg-white/5 px-2 py-1 rounded">Basado en tu mejor {Math.round(bestRun.distance/1000)}k (Fatiga k={(k-1).toFixed(3)})</div>
             </div>
             <div className="grid grid-cols-4 gap-2">
                 {[{d: 5000, l: '5K'}, {d: 10000, l: '10K'}, {d: 21097, l: 'Media'}, {d: 42195, l: 'Maratón'}].map(item => {
                     const p = predict(item.d);
                     return (
                         <div key={item.l} className="bg-white/5 p-2 rounded-lg text-center border border-white/5">
                             <div className="text-[10px] text-gray-400 font-bold uppercase">{item.l}</div>
                             <div className="text-sm font-mono font-bold text-white mt-1">{p.time}</div>
                             <div className="text-[10px] font-mono text-[#34C759]">{p.pace} /km</div>
                         </div>
                     );
                 })}
             </div>
        </div>
    );
};

export const WeeklyVolumeChart = ({ sessions }: { sessions: Session[] }) => {
    const [hoverData, setHoverData] = useState<{x: number, y: number, dist: number, dur: number, label: string} | null>(null);

    // Agrupar por semanas
    const weeks: Record<string, {dist: number, dur: number, label: string, ts: number}> = {};
    const sorted = [...sessions].sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    sorted.forEach(s => {
        const d = new Date(s.startTime);
        const monday = new Date(d);
        monday.setDate(d.getDate() - d.getDay() + 1); 
        monday.setHours(0,0,0,0);
        const k = monday.toISOString();
        if (!weeks[k]) weeks[k] = { dist: 0, dur: 0, label: `${monday.getDate()}/${monday.getMonth()+1}`, ts: monday.getTime() };
        weeks[k].dist += s.distance/1000;
        weeks[k].dur += s.duration/3600;
    });

    const data = Object.values(weeks).sort((a,b) => a.ts - b.ts).slice(-12);
    if (data.length < 2) return null;

    const maxDist = Math.max(...data.map(d => d.dist)) || 10;
    const maxDur = Math.max(...data.map(d => d.dur)) || 1;

    // SVG coordinates
    const pointsDist = data.map((d, i) => `${(i/(data.length-1))*100},${100 - (d.dist/maxDist)*100}`).join(' L');
    const pointsDur = data.map((d, i) => `${(i/(data.length-1))*100},${100 - (d.dur/maxDur)*100}`).join(' L');

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-4 relative group">
            <div className="flex justify-between mb-4">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Chart /> <span className="ml-2">Volumen Semanal</span></h4>
                <div className="flex space-x-3 text-[10px]">
                    <span className="text-[#34C759] font-bold">● Distancia (km)</span>
                    <span className="text-[#007AFF] font-bold">● Tiempo (h)</span>
                </div>
            </div>
            
            <div className="h-40 w-full relative cursor-crosshair">
                {/* Ejes Y */}
                <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[9px] text-[#34C759] font-mono pointer-events-none z-0">
                    <span>{Math.round(maxDist)}km</span>
                    <span>0km</span>
                </div>
                <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between text-[9px] text-[#007AFF] font-mono pointer-events-none z-0">
                    <span>{maxDur.toFixed(1)}h</span>
                    <span>0h</span>
                </div>

                <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible z-10" preserveAspectRatio="none">
                    <path d={`M${pointsDist}`} fill="none" stroke="#34C759" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <path d={`M${pointsDur}`} fill="none" stroke="#007AFF" strokeWidth="2" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                    
                    {/* Interaction Rects */}
                    {data.map((d, i) => (
                        <rect 
                            key={i}
                            x={(i/(data.length-1))*100 - 2}
                            y={0}
                            width={4}
                            height={100}
                            fill="transparent"
                            onMouseMove={(e) => setHoverData({ x: e.clientX, y: e.clientY, dist: d.dist, dur: d.dur, label: d.label })}
                            onMouseLeave={() => setHoverData(null)}
                        />
                    ))}
                </svg>

                {/* Eje X Etiquetas */}
                <div className="absolute -bottom-4 left-0 right-0 flex justify-between text-[8px] text-gray-500">
                    {data.map((d,i) => <span key={i}>{d.label}</span>)}
                </div>
            </div>

            {hoverData && createPortal(
                <div 
                    className="fixed z-[9999] bg-[#1C1C1E] border border-white/20 p-2 rounded-lg shadow-xl pointer-events-none text-xs" 
                    style={{ left: hoverData.x, top: hoverData.y - 50, transform: 'translateX(-50%)' }}
                >
                    <p className="font-bold text-gray-400 mb-1 border-b border-white/10 pb-1">Semana {hoverData.label}</p>
                    <p className="text-[#34C759] font-mono">{hoverData.dist.toFixed(1)} km</p>
                    <p className="text-[#007AFF] font-mono">{hoverData.dur.toFixed(1)} h</p>
                </div>,
                document.body
            )}
        </div>
    );
};

export const AggregatedStats = ({ sessions }: { sessions: Session[] }) => {
    const totalDist = sessions.reduce((a,b) => a + b.distance, 0) / 1000;
    const totalTime = sessions.reduce((a,b) => a + b.duration, 0);
    const totalSessions = sessions.length;
    const totalElev = sessions.reduce((a,b) => a + b.totalElevationGain, 0);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Total Distancia" value={totalDist.toFixed(1)} unit="km" colorClass="text-blue-400" icon={<Icons.Map />} />
            <MetricCard label="Total Tiempo" value={formatTime(totalTime)} unit="" colorClass="text-yellow-400" icon={<Icons.Clock />} />
            <MetricCard label="Sesiones" value={totalSessions} unit="" colorClass="text-[#34C759]" icon={<Icons.ListCheck />} />
            <MetricCard label="Desnivel +" value={totalElev} unit="m" colorClass="text-purple-400" icon={<Icons.Mountain />} />
        </div>
    );
};

export const RecentActivitiesList = ({ sessions, onSelectSession }: { sessions: Session[], onSelectSession: (id: string) => void }) => {
    const recent = sessions.slice(0, 5);
    return (
        <div className="glass-panel p-5 rounded-3xl">
            <h4 className="text-sm font-semibold text-gray-400 mb-4 flex items-center"><Icons.List /> <span className="ml-2">Actividad Reciente</span></h4>
            <div className="space-y-2">
                {recent.map(s => {
                    const conf = getSportConfig(s.sport);
                    return (
                        <div key={s.id} onClick={() => onSelectSession(s.id)} className="flex items-center p-3 hover:bg-white/5 rounded-xl cursor-pointer transition-colors border border-transparent hover:border-white/5">
                            <div className={`w-8 h-8 rounded flex items-center justify-center text-lg ${conf.color} bg-white/5 mr-3`}>{conf.icon}</div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-white truncate">{s.name}</p>
                                <p className="text-[10px] text-gray-500">{new Date(s.startTime).toLocaleDateString()} • {formatTime(s.duration)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs font-mono font-bold text-[#34C759]">{(s.distance/1000).toFixed(2)} km</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const MapComponent = ({ trackPoints, currentIndex }: { trackPoints: TrackPoint[], currentIndex: number }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const polylineRef = useRef<L.Polyline | null>(null);
    const markerRef = useRef<L.CircleMarker | null>(null);

    useEffect(() => {
        if (!mapRef.current) return;
        
        // Init Map
        if (!leafletMap.current) {
            leafletMap.current = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([0, 0], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { opacity: 0.8 }).addTo(leafletMap.current);
        }
        
        const map = leafletMap.current;
        
        // FILTRO CRÍTICO: Filtrar cualquier punto 0,0 para evitar líneas al Golfo de Guinea
        const latlngs = trackPoints
            .filter(p => p.lat !== 0 && p.lon !== 0)
            .map(p => [p.lat, p.lon] as [number, number]);

        if (polylineRef.current) map.removeLayer(polylineRef.current);
        polylineRef.current = L.polyline(latlngs, { color: '#34C759', weight: 3 }).addTo(map);
        
        if (latlngs.length > 0) map.fitBounds(polylineRef.current.getBounds(), { padding: [50,50] });
        
        if (!markerRef.current) {
            markerRef.current = L.circleMarker([0,0], { radius: 6, color: 'white', fillColor: '#34C759', fillOpacity: 1 }).addTo(map);
        }

        return () => {
             // Limpieza opcional en modo vista única, pero importante si cambia mucho
             if (leafletMap.current) {
                 leafletMap.current.remove();
                 leafletMap.current = null;
                 markerRef.current = null;
                 polylineRef.current = null;
             }
        }
    }, [trackPoints]); // Re-crear si cambian los puntos (cambio de sesión)

    useEffect(() => {
        if (markerRef.current && leafletMap.current && trackPoints[currentIndex]) {
            const p = trackPoints[currentIndex];
            if (p.lat !== 0 && p.lon !== 0) markerRef.current.setLatLng([p.lat, p.lon]);
        }
    }, [currentIndex, trackPoints]);

    return <div ref={mapRef} className="w-full h-full bg-[#1C1C1E]" />;
};

export const ElevationChart = ({ trackPoints, currentIndex }: { trackPoints: TrackPoint[], currentIndex: number }) => {
    // Filtrar ceros absolutos que suelen ser errores de inicialización del GPS
    const validAlts = trackPoints.map(p => p.altitude).filter(a => a > 0);
    
    // Si no hay datos válidos, defaults seguros
    const minAlt = validAlts.length > 0 ? Math.min(...validAlts) : 0;
    const maxAlt = validAlts.length > 0 ? Math.max(...validAlts) : 100;
    
    // Padding del 10% para que la gráfica no toque los bordes
    const padding = (maxAlt - minAlt) * 0.1;
    const chartMin = Math.max(0, minAlt - padding);
    const chartMax = maxAlt + padding;
    const range = chartMax - chartMin || 1;
    
    const width = 600;
    const height = 100;
    
    const skip = Math.ceil(trackPoints.length / width);
    
    // Generar puntos SVG, tratando los 0s puntuales como el mínimo válido para no romper la gráfica
    const points = trackPoints.filter((_, i) => i % skip === 0).map((p, i, arr) => {
        const x = (i / (arr.length - 1)) * width;
        const effectiveAlt = p.altitude === 0 ? minAlt : p.altitude;
        const y = height - ((effectiveAlt - chartMin) / range) * height;
        return `${x},${y}`;
    }).join(' L');

    const currentX = (currentIndex / (trackPoints.length - 1)) * 100;

    return (
        <div className="w-full h-full relative">
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full">
                <defs>
                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#34C759" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#34C759" stopOpacity="0.05" />
                    </linearGradient>
                </defs>
                <path d={`M0,${height} L${points} L${width},${height} Z`} fill="url(#elevationGradient)" stroke="none" />
                <path d={`M${points}`} fill="none" stroke="#34C759" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="absolute top-0 bottom-0 w-px bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" style={{ left: `${currentX}%` }}></div>
            <div className="absolute top-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1 rounded font-mono">{Math.round(maxAlt)}m</div>
            <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1 rounded font-mono">{Math.round(minAlt)}m</div>
        </div>
    );
};

export const ZoneDistributionChart = ({ trackPoints, maxHr, restHr, customZones }: { trackPoints: TrackPoint[], maxHr: number, restHr: number, customZones?: { z1: number; z2: number; z3: number; z4: number; } }) => {
    // Definir los límites de las zonas
    let zones;

    if (customZones) {
        zones = [
            { l: 'Z1', min: 0, max: customZones.z1, c: '#9CA3AF' },
            { l: 'Z2', min: customZones.z1, max: customZones.z2, c: '#3B82F6' },
            { l: 'Z3', min: customZones.z2, max: customZones.z3, c: '#34C759' },
            { l: 'Z4', min: customZones.z3, max: customZones.z4, c: '#F59E0B' },
            { l: 'Z5', min: customZones.z4, max: 250, c: '#EF4444' }, // Z5 hasta 250bpm
        ];
    } else {
        const fcr = maxHr - restHr;
        zones = [
            { l: 'Z1', min: 0, max: restHr + 0.60 * fcr, c: '#9CA3AF' },
            { l: 'Z2', min: restHr + 0.60 * fcr, max: restHr + 0.70 * fcr, c: '#3B82F6' },
            { l: 'Z3', min: restHr + 0.70 * fcr, max: restHr + 0.80 * fcr, c: '#34C759' },
            { l: 'Z4', min: restHr + 0.80 * fcr, max: restHr + 0.90 * fcr, c: '#F59E0B' },
            { l: 'Z5', min: restHr + 0.90 * fcr, max: 250, c: '#EF4444' },
        ];
    }
    
    const counts = [0,0,0,0,0];
    let total = 0;
    
    trackPoints.forEach(p => {
        if (p.hr > 0) {
            let idx = -1;
            if (p.hr <= zones[0].max) idx = 0;
            else if (p.hr <= zones[1].max) idx = 1;
            else if (p.hr <= zones[2].max) idx = 2;
            else if (p.hr <= zones[3].max) idx = 3;
            else idx = 4;
            
            if (idx !== -1) {
                counts[idx]++;
                total++;
            }
        }
    });

    return (
        <div className="w-full h-full flex items-end space-x-1 px-4 pb-2 pt-4 bg-black/20 rounded-xl">
            {zones.map((z, i) => {
                const heightPercent = total > 0 ? (counts[i] / total) * 100 : 0;
                return (
                    <div key={z.l} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                        <div className="w-full rounded-t-sm transition-all relative hover:opacity-80" style={{ height: `${heightPercent}%`, backgroundColor: z.c }}>
                             {heightPercent > 0 && (
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] text-white opacity-0 group-hover:opacity-100 bg-black p-1 rounded whitespace-nowrap z-10">
                                    {Math.round(heightPercent)}% ({formatTime(counts[i])})
                                </div>
                             )}
                        </div>
                        <span className="text-[9px] text-gray-500 mt-1 font-bold">{z.l}</span>
                    </div>
                );
            })}
        </div>
    );
};