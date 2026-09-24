import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { Session, UserProfile, TrackPoint, DailyFitness } from './types';
import { Icons, getSportConfig } from './icons';
import { InfoTooltip, MetricCard } from './components';
import { calculateGlobalVo2Max, formatPace, formatTime, formatMetric, calculateIndividualizedK, calculateACWR, getWeekStartMonday, smoothAltitudes, getMonthName, calculateEfficiencyFactor, estimateVentilatoryThresholds, estimatePower } from './utils';
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
            
            <div className="flex items-end justify-between mb-2 gap-2">
                <div className="min-w-0">
                    <span className={`text-2xl font-bold font-mono ${conf.color} whitespace-nowrap`}>{acwr.ratio.toFixed(2)}</span>
                    <span className="text-[10px] text-gray-500 ml-1 font-bold uppercase">{conf.label}</span>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-400 whitespace-nowrap">Aguda: <span className="text-white font-mono">{formatMetric(acwr.acuteLoad)}</span></p>
                    <p className="text-[10px] text-gray-400 whitespace-nowrap">Crónica: <span className="text-white font-mono">{formatMetric(acwr.chronicLoad)}</span></p>
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
    // Umbrales ventilatorios estimados por el motor: zonas propias (topes de Z2 y
    // Z4) si existen, o Karvonen (60 % y 85 % de la reserva cardíaca) si no.
    const vt = estimateVentilatoryThresholds(profile);
    
    const runSessions = sessions.filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0 && s.avgHr > 0);
    const last4Weeks = sessions.filter(s => (new Date().getTime() - new Date(s.startTime).getTime()) < 2419200000);
    
    const maxVam = Math.max(...runSessions.map(s => s.vam6min || 0), 0);
    const vo2Data = calculateGlobalVo2Max(sessions);
    const avgTrimp = last4Weeks.length > 0 ? Math.round(last4Weeks.reduce((a,b)=>a+(b.trimp||0),0) / last4Weeks.length) : 0;
    
    const recentRuns = runSessions.slice(0, 10);
    const efficiency = formatMetric(
        recentRuns.length > 0
            ? (recentRuns.reduce((acc, s) => acc + ((s.distance/s.duration) / s.avgHr), 0) / recentRuns.length * 10000)
            : null
    );

    const runsLastMonth = last4Weeks.filter(s=>s.sport==='RUNNING');
    const avgSpeedLastMonth = runsLastMonth.reduce((acc, s) => acc + (s.distance/s.duration), 0) / (runsLastMonth.length || 1);
    // Pendiente media de esas sesiones: la potencia estimada la usa para no
    // quedarse corta en cuesta (sin pendiente el modelo es el de siempre).
    const totalDistLastMonth = runsLastMonth.reduce((acc, s) => acc + s.distance, 0);
    const avgGradeLastMonth = totalDistLastMonth > 0 ? runsLastMonth.reduce((acc, s) => acc + s.totalElevationGain, 0) / totalDistLastMonth : 0;
    const estimatedPower = avgSpeedLastMonth > 0 ? formatMetric(estimatePower(profile.weight, avgSpeedLastMonth, avgGradeLastMonth)) : '--';
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
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">{profile.customZones ? 'Z2 Max' : 'VT1 (Aeróbico)'}</span>
                        <span className="text-right">
                            <span className="text-lg font-mono font-bold">{formatMetric(vt.vt1Hr)} <span className="text-[10px] text-gray-500">bpm</span></span>
                            <span className="block text-[9px] text-gray-500">estimación · {vt.source === 'customZones' ? 'zonas propias' : 'Karvonen'}</span>
                        </span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-400">{profile.customZones ? 'Z4 Max' : 'VT2 (Anaeróbico)'}</span>
                        <span className="text-right">
                            <span className="text-lg font-mono font-bold">{formatMetric(vt.vt2Hr)} <span className="text-[10px] text-gray-500">bpm</span></span>
                            <span className="block text-[9px] text-gray-500">estimación · {vt.source === 'customZones' ? 'zonas propias' : 'Karvonen'}</span>
                        </span>
                    </div>
                </div>
                <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-[#34C759] uppercase tracking-wide mb-2 border-b border-[#34C759]/30 pb-1 flex items-center justify-between">Potencia & Ritmo <InfoTooltip type="vam" /></h5>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">VAM (6 min)</span><div className="text-right"><p className="text-lg font-mono font-bold text-[#34C759]">{paceVam} <span className="text-[10px] text-gray-500">/km</span></p></div></div>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Potencia Est.</span><div className="text-right"><p className="text-lg font-mono font-bold text-yellow-500">{estimatedPower} <span className="text-[10px] text-gray-500">w</span></p><p className="text-[9px] text-gray-500">estimación</p></div> <InfoTooltip type="power" /></div>
                </div>
                <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                    <h5 className="text-xs font-bold text-purple-500 uppercase tracking-wide mb-2 border-b border-purple-500/30 pb-1 flex items-center justify-between">Carga & Eficiencia <InfoTooltip type="trimp" /></h5>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">TRIMP (4 sem)</span><span className="text-lg font-mono font-bold text-white">{formatMetric(avgTrimp)} <span className="text-[9px] text-gray-500 font-sans font-normal">pts</span></span></div>
                    <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Eficiencia (Ratio)</span><span className="text-lg font-mono font-bold text-blue-300">{efficiency}</span> <InfoTooltip type="efficiency" /></div>
                </div>
                {hasStride && (
                     <div className="space-y-3 bg-white/5 p-3 rounded-2xl border border-white/5">
                        <h5 className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-2 border-b border-orange-400/30 pb-1 flex items-center justify-between">Técnica (Media) <InfoTooltip type="stride" /></h5>
                        <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Zancada</span><span className="text-lg font-mono font-bold text-white">{avgStride.toFixed(2)} <span className="text-[9px] text-gray-500 font-sans font-normal">m</span></span></div>
                        {hasSensors ? (
                            <div className="flex justify-between items-center"><span className="text-xs text-gray-400">GCT</span><span className="text-lg font-mono font-bold text-orange-300">{Math.round(avgGCT)} <span className="text-[9px] text-gray-500 font-sans font-normal">ms</span></span> <InfoTooltip type="gct" /></div>
                        ) : (
                            <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Cadencia</span><span className="text-lg font-mono font-bold text-orange-300">{formatMetric(recentRuns[0]?.avgCadence || 0)} <span className="text-[9px] text-gray-500 font-sans font-normal">spm</span></span></div>
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
            
            const grade = s.distance > 0 ? s.totalElevationGain / s.distance : 0;
            const power = s.distance > 0 ? estimatePower(profile.weight, s.distance/s.duration, grade) : 0;

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
                                            {formatMetric(val)} <span className="text-gray-600 font-normal">{metricsConfig[key].unit}</span>
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
    const hasCustomZones = !!profile.customZones;
    let lowEnd: number, highStart: number;

    if (profile.customZones) {
        // En polarizado 3 zonas:
        // Baja = Z1 + Z2
        // Media (Gris) = Z3
        // Alta = Z4 + Z5
        lowEnd = profile.customZones.z2;
        highStart = profile.customZones.z3; // El final de la zona gris (Z3) es el inicio de la alta
    } else {
        // Estimación por el método de Karvonen (60 % y 80 % de la reserva cardíaca).
        const fcr = profile.maxHr - profile.restHr;
        lowEnd = Math.round(profile.restHr + 0.60 * fcr);
        highStart = Math.round(profile.restHr + 0.80 * fcr);
    }

    // Estado para manejar la carga de datos completos si faltan trackpoints
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);

    // Solo interesan las sesiones de las últimas 8 semanas.
    const recent = useMemo(() => {
        const since = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000;
        return sessions.filter(s => new Date(s.startTime).getTime() >= since);
    }, [sessions]);

    useEffect(() => {
        if (recent.length === 0) { setFullData([]); return; }
        const needsLoading = recent.some(s => !s.trackPoints || s.trackPoints.length === 0);
        if (needsLoading) {
            setLoading(true);
            Promise.all(recent.map(s => getFullSessionFromDB(s.id))).then(results => {
                setFullData(results.filter((s): s is Session => !!s));
                setLoading(false);
            }).catch(() => setLoading(false));
        } else {
            setFullData(recent as Session[]);
        }
    }, [recent]);

    // Ventanas semanales (lunes a domingo) de las últimas 8 semanas con el
    // TIEMPO acumulado en cada zona. Se construyen siempre las 8 semanas para
    // que la gráfica tenga una barra por semana aunque alguna esté vacía.
    const weeks = useMemo(() => {
        const buckets = new Map<string, { low: number; mid: number; high: number }>();
        fullData.forEach(s => {
            const pts = s.trackPoints;
            if (!pts || pts.length < 2) return;
            const monday = getWeekStartMonday(new Date(s.startTime));
            const k = monday.toISOString();
            if (!buckets.has(k)) buckets.set(k, { low: 0, mid: 0, high: 0 });
            const bucket = buckets.get(k)!;
            for (let i = 0; i < pts.length - 1; i++) {
                const hr = pts[i].hr;
                if (!(hr > 0)) continue;
                const dt = (new Date(pts[i + 1].timestamp).getTime() - new Date(pts[i].timestamp).getTime()) / 1000;
                if (!(dt > 0) || dt > 60) continue; // descarta huecos de GPS
                if (hr <= lowEnd) bucket.low += dt;
                else if (hr <= highStart) bucket.mid += dt;
                else bucket.high += dt;
            }
        });

        const thisMonday = getWeekStartMonday(new Date());
        const result: { key: string; label: string; total: number; low: number; mid: number; high: number }[] = [];
        for (let i = 7; i >= 0; i--) {
            const monday = new Date(thisMonday);
            monday.setDate(monday.getDate() - i * 7);
            const k = monday.toISOString();
            const b = buckets.get(k);
            const low = b?.low || 0, mid = b?.mid || 0, high = b?.high || 0;
            const total = low + mid + high;
            result.push({
                key: k,
                label: `${monday.getDate()}/${monday.getMonth()+1}`,
                total,
                low: total > 0 ? (low / total) * 100 : 0,
                mid: total > 0 ? (mid / total) * 100 : 0,
                high: total > 0 ? (high / total) * 100 : 0,
            });
        }
        return result;
    }, [fullData, lowEnd, highStart]);

    return (
        <div className="glass-panel p-4 rounded-3xl relative">
            <h5 className="text-xs font-bold text-purple-400 uppercase mb-2 flex justify-between">Polarización (8 sem) <InfoTooltip type="polarized" /></h5>
            <p className="text-[9px] text-gray-500 mb-3">Porcentaje de TIEMPO por semana · {hasCustomZones ? 'zonas personalizadas' : 'estimación por el método de Karvonen'}</p>
            {loading ? (
                <div className="h-20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500"></div>
                </div>
            ) : (
                <>
                    <div className="flex items-end h-24 px-1 space-x-1">
                        {weeks.map(w => (
                            <div key={w.key} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                                <div className="w-full h-full flex flex-col justify-end rounded-t-md overflow-hidden bg-white/5">
                                    <div style={{ height: `${w.high}%`, backgroundColor: '#EF4444' }}></div>
                                    <div style={{ height: `${w.mid}%`, backgroundColor: '#FACC15' }}></div>
                                    <div style={{ height: `${w.low}%`, backgroundColor: '#34C759' }}></div>
                                </div>
                                <span className="text-[8px] text-gray-500 mt-1">{w.label}</span>
                                <div className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full hidden group-hover:block bg-[#1C1C1E] border border-white/20 rounded-lg p-2 text-[9px] whitespace-nowrap z-20">
                                    <p className="text-gray-400 font-bold mb-1">Semana {w.label}</p>
                                    <p className="text-green-400">Baja: {Math.round(w.low)}%</p>
                                    <p className="text-yellow-400">Gris: {Math.round(w.mid)}%</p>
                                    <p className="text-red-400">Alta: {Math.round(w.high)}%</p>
                                    <p className="text-gray-500">{Math.round(w.total / 60)} min</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-center space-x-3 text-[9px] mt-2">
                        <span className="text-green-400">● Baja</span>
                        <span className="text-yellow-400">● Zona gris</span>
                        <span className="text-red-400">● Alta</span>
                    </div>
                </>
            )}
        </div>
    );
};

export const GlobalHeatmap = ({ sessions }: { sessions: Session[] }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<L.Map | null>(null);
    const polyRefs = useRef<Map<string, L.Polyline>>(new Map());
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Filtros
    const [showFilters, setShowFilters] = useState(false);
    const [minDist, setMinDist] = useState(0);
    const [maxDist, setMaxDist] = useState(50);
    const [minElev, setMinElev] = useState(0);
    const [maxElev, setMaxElev] = useState(3000);
    const [activeFilter, setActiveFilter] = useState(false);

    const filteredSessions = useMemo(() => {
        if (!activeFilter) return null;
        return (fullData.length > 0 ? fullData : sessions).filter(s => {
            const distKm = s.distance / 1000;
            return distKm >= minDist && distKm <= maxDist 
                && s.totalElevationGain >= minElev 
                && s.totalElevationGain <= maxElev;
        });
    }, [fullData, sessions, activeFilter, minDist, maxDist, minElev, maxElev]);

    // Estrategia de Carga Asincrona para Heatmap
    useEffect(() => {
        const needsLoading = sessions.some(s => !s.trackPoints || s.trackPoints.length === 0);
        
        if (needsLoading && !loading && fullData.length === 0) {
            setLoading(true);
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
        polyRefs.current.clear();
        
        const bounds = L.latLngBounds([]);
        let hasLayer = false;
        const filterIds = new Set(filteredSessions?.map(s => s.id) || []);

        validSessions.forEach(s => {
             const latlngs = s.trackPoints
                .filter(p => p.lat !== 0 && p.lon !== 0)
                .map(p => [p.lat, p.lon] as [number, number]);
             
             if (latlngs.length > 0) {
                 const isFiltered = effectiveFilter && !filterIds.has(s.id);
                 const color = effectiveFilter 
                     ? (isFiltered ? '#1a1a2e' : '#34C759') 
                     : '#34C759';
                 const opacity = effectiveFilter
                     ? (isFiltered ? 1.0 : 0.55)
                     : 0.85;
                 const weight = effectiveFilter && !isFiltered ? 3 : 1.5;
                 
                 const poly = L.polyline(latlngs, { color, weight, opacity }).addTo(map);
                 
                 // Click en ruta → info
                 poly.on('click', () => {
                     const distKm = formatMetric(s.distance / 1000, 2);
                     const elevM = formatMetric(s.totalElevationGain);
                     const name = s.name || 'Sin nombre';
                     const date = new Date(s.startTime).toLocaleDateString('es-ES');
                     poly.bindPopup(`
                         <div style="font-family:system-ui;color:#e0e0e0;min-width:180px;background:#1a1a2e;padding:12px;border-radius:8px;border:1px solid #2a2a4a">
                             <b style="color:#34C759">${name}</b><br/>
                             <span style="font-size:11px;color:#888">📅 ${date}</span><br/>
                             <span style="font-size:13px">📏 ${distKm} km | ⛰ ${elevM} m D+</span><br/>
                             ${s.weather ? `<span style="font-size:12px;color:#4fc3f7">🌡 ${s.weather.temperature}°C | ${s.weather.weatherDescription}</span>` : ''}
                         </div>
                     `, { className: 'dark-popup' }).openPopup();
                 });
                 
                 if (!isFiltered || !effectiveFilter) {
                     bounds.extend(latlngs);
                     hasLayer = true;
                 }
                 polyRefs.current.set(s.id, poly);
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
    }, [fullData, sessions, activeFilter, filteredSessions]);

    const matchedCount = filteredSessions?.length || 0;
    const totalCount = (fullData.length > 0 ? fullData : sessions).filter(s => s.trackPoints && s.trackPoints.length > 0).length;
    const effectiveFilter = activeFilter && matchedCount > 0; // Si el filtro no encuentra nada, mostramos todo

    return (
        <div className="col-span-4 h-[800px] rounded-3xl overflow-hidden relative group border border-white/5" style={{background: '#121214'}}>
            <div ref={mapRef} className="w-full h-full bg-[#1C1C1E]"></div>
            <div style={{
                position: 'absolute', top: '16px', left: '16px', zIndex: 1000,
                background: '#000', padding: '4px 12px', borderRadius: '9999px',
                fontSize: '12px', fontWeight: 700, color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none'
            }}>
                {loading ? 'Cargando datos GPS...' 
                    : effectiveFilter ? `${matchedCount} de ${totalCount} rutas` 
                    : activeFilter ? `⚠ 0 coincidencias — mostrando ${totalCount} rutas`
                    : `Heatmap Global (${totalCount} actividades)`}
            </div>
            
            {/* Botón de filtros — 100% inline, sin Tailwind */}
            <button 
                onClick={() => setShowFilters(!showFilters)}
                style={{
                    position: 'absolute', top: '16px', right: '16px', zIndex: 1000,
                    padding: '8px 14px', borderRadius: '9999px',
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    border: activeFilter ? '1px solid #34C759' : '1px solid rgba(255,255,255,0.1)',
                    background: activeFilter ? '#34C759' : '#000',
                    color: activeFilter ? '#000' : '#9ca3af',
                    transition: 'all 0.15s'
                }}
            >
                🔍 Filtrar rutas
            </button>
            
            {/* Panel de filtros — 100% inline, sin Tailwind */}
            {showFilters && (
            <div style={{
                position: 'absolute', top: '64px', right: '16px', zIndex: 1000,
                background: '#121214', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '16px', padding: '20px', width: '288px',
                boxShadow: '0 0 40px rgba(0,0,0,0.95)'
            }}>
                <div className="flex justify-between items-center mb-4">
                    <h4 className="text-sm font-bold text-white">Filtrar Rutas</h4>
                    <button onClick={() => { setShowFilters(false); setActiveFilter(false); }} className="text-gray-500 hover:text-white text-lg">&times;</button>
                </div>
                
                {/* Distancia */}
                <div className="mb-4">
                    <label className="text-[10px] text-gray-400 uppercase font-bold mb-1 block">Distancia (km)</label>
                    <div className="flex space-x-2 items-center">
                        <input type="number" value={minDist} onChange={e => setMinDist(Number(e.target.value))} 
                            className="w-16 bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white text-center" 
                            placeholder="Min" />
                        <span className="text-gray-500 text-xs">a</span>
                        <input type="number" value={maxDist} onChange={e => setMaxDist(Number(e.target.value))} 
                            className="w-16 bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white text-center" 
                            placeholder="Max" />
                    </div>
                </div>
                
                {/* Desnivel */}
                <div className="mb-4">
                    <label className="text-[10px] text-gray-400 uppercase font-bold mb-1 block">Desnivel positivo (m)</label>
                    <div className="flex space-x-2 items-center">
                        <input type="number" value={minElev} onChange={e => setMinElev(Number(e.target.value))} 
                            className="w-16 bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white text-center" 
                            placeholder="Min" />
                        <span className="text-gray-500 text-xs">a</span>
                        <input type="number" value={maxElev} onChange={e => setMaxElev(Number(e.target.value))} 
                            className="w-16 bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white text-center" 
                            placeholder="Max" />
                    </div>
                </div>
                
                {/* Quick presets */}
                <div className="mb-4">
                    <label className="text-[10px] text-gray-400 uppercase font-bold mb-1.5 block">Rápidos</label>
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { label: '5K', minD: 4.5, maxD: 5.5 },
                            { label: '7K', minD: 6.5, maxD: 7.5 },
                            { label: '10K', minD: 9, maxD: 11 },
                            { label: '+500m D+', minD: 0, maxD: 50, minE: 500, maxE: 3000 },
                        ].map(preset => (
                            <button key={preset.label}
                                onClick={() => {
                                    setMinDist(preset.minD);
                                    setMaxDist(preset.maxD);
                                    if (preset.minE !== undefined) setMinElev(preset.minE);
                                    if (preset.maxE !== undefined) setMaxElev(preset.maxE);
                                    setActiveFilter(true);
                                }}
                                className="px-2.5 py-1 text-[10px] rounded-full bg-white/5 hover:bg-[#34C759]/20 hover:text-[#34C759] text-gray-400 border border-white/5 transition-all"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="flex space-x-2">
                    <button 
                        onClick={() => setActiveFilter(true)}
                        className="flex-1 py-2 rounded-xl bg-[#34C759] text-black text-xs font-bold hover:bg-[#2db14e] transition-colors"
                    >
                        Aplicar filtro
                    </button>
                    <button 
                        onClick={() => { setActiveFilter(false); setMinDist(0); setMaxDist(50); setMinElev(0); setMaxElev(3000); }}
                        className="py-2 px-3 rounded-xl bg-white/10 text-gray-400 text-xs hover:text-white transition-colors"
                    >
                        Limpiar
                    </button>
                </div>
                
                {activeFilter && (
                    <p className={`text-[10px] mt-2 text-center ${matchedCount > 0 ? 'text-[#34C759]' : 'text-amber-400'}`}>
                        {matchedCount > 0 
                            ? `${matchedCount} ruta${matchedCount !== 1 ? 's' : ''} encontrada${matchedCount !== 1 ? 's' : ''}`
                            : 'Ninguna ruta coincide — prueba otros valores'}
                    </p>
                )}
            </div>
            )}
            
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

    // Clave de día ISO local (año-mes-día) construida a mano: no depende del
    // idioma del sistema como toLocaleDateString().
    const localDateKey = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const sorted = [...sessions].sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    const trimpMap = new Map<string, number>();
    sorted.forEach(s => {
        const k = localDateKey(new Date(s.startTime));
        trimpMap.set(k, (trimpMap.get(k)||0) + (s.trimp || 0));
    });

    // El PMC arranca desde el primer día con historial: el CTL necesita ~42 días
    // para estabilizarse y calcularlo desde el inicio de la ventana pintada
    // infravaloraba toda la parte izquierda de la gráfica.
    const fullDailyData: DailyFitness[] = [];
    if (sorted.length > 0) {
        let ctl = 0, atl = 0;
        const firstDay = new Date(sorted[0].startTime);
        firstDay.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const d = new Date(firstDay); d.getTime() <= today.getTime(); d.setDate(d.getDate() + 1)) {
            const k = localDateKey(d);
            const trimp = trimpMap.get(k) || 0;
            ctl = ctl + (trimp - ctl) / 42;
            atl = atl + (trimp - atl) / 7;
            fullDailyData.push({ date: k, ctl, atl, tsb: ctl - atl, trimp });
        }
    }

    // Solo se pintan los últimos 90 días; el resto se usa para estabilizar el PMC.
    const dailyData = fullDailyData.slice(-90);
    const days = dailyData.length;

    const width = 800;
    const height = 200;
    const padding = 20;

    if (days < 2) {
        return (
            <div className="glass-panel p-10 rounded-3xl col-span-4 flex flex-col items-center justify-center text-gray-500">
                <Icons.Chart />
                <p className="mt-2 text-sm">Necesitas más de un día de historial para ver la forma física.</p>
            </div>
        );
    }

    const maxVal = Math.max(...dailyData.map(d => Math.max(d.ctl, d.atl))) || 1;
    const minTsb = Math.min(...dailyData.map(d => d.tsb), 0);
    const maxTsb = Math.max(...dailyData.map(d => d.tsb), 0);
    const tsbRange = Math.max(10, maxTsb - minTsb);

    const getX = (i: number) => (i / (days-1)) * width;
    const getY = (val: number) => height - padding - (val/maxVal) * (height - padding*2);

    const pathCtl = dailyData.map((d, i) => `${getX(i)},${getY(d.ctl)}`).join(' L');
    const pathAtl = dailyData.map((d, i) => `${getX(i)},${getY(d.atl)}`).join(' L');

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-4 relative group">
             <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 gap-1">
                 <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Chart /> <span className="ml-2">Forma Física (PMC)</span></h4>
                 <p className="text-[10px] text-gray-500">Calculado desde el primer día con historial · se pintan los últimos 90 días</p>
             </div>
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
                        <p className="text-blue-400">Fitness: {formatMetric(dailyData[hoverIndex].ctl)}</p>
                        <p className="text-pink-400">Fatiga: {formatMetric(dailyData[hoverIndex].atl)}</p>
                        <p className={dailyData[hoverIndex].tsb >= 0 ? 'text-green-400' : 'text-red-400'}>Forma: {formatMetric(dailyData[hoverIndex].tsb)}</p>
                    </div>
                 )}

                 </div>

                 {/* Leyenda fuera del contenedor de altura fija: dentro se salía 2 px de la tarjeta */}
                 <div className="flex justify-end space-x-4 text-[10px] mt-2">
                 <span className="text-blue-500 font-bold">Fitness (CTL)</span>
                 <span className="text-pink-500 font-bold">Fatiga (ATL)</span>
                 <span className="text-gray-400 font-bold">Forma (TSB)</span>
                 </div>
                 </div>
    );
};

/**
 * Ritmo a pulso fijo: por cada mes natural, el ritmo medio ponderado por tiempo
 * de los tramos llanos (pendiente entre −2 % y +2 % sobre la altitud suavizada)
 * con FC entre 145 y 155 lpm. Es el indicador honesto de progreso aeróbico: a la
 * misma FC, si el ritmo baja (más rápido), la forma mejora.
 */
export const PaceAtFixedHrChart = ({ sessions }: { sessions: Session[] }) => {
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);

    const runSessions = useMemo(
        () => sessions.filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0),
        [sessions]
    );

    useEffect(() => {
        if (runSessions.length === 0) { setFullData([]); return; }
        const needsLoading = runSessions.some(s => !s.trackPoints || s.trackPoints.length === 0);
        if (needsLoading) {
            setLoading(true);
            Promise.all(runSessions.map(s => getFullSessionFromDB(s.id))).then(results => {
                setFullData(results.filter((s): s is Session => !!s));
                setLoading(false);
            }).catch(() => setLoading(false));
        } else {
            setFullData(runSessions as Session[]);
        }
    }, [runSessions]);

    const months = useMemo(() => {
        const acc = new Map<string, { ts: number; label: string; time: number; dist: number; hrTime: number }>();

        fullData.forEach(s => {
            const pts = s.trackPoints;
            if (!pts || pts.length < 2) return;
            const smoothed = smoothAltitudes(pts.map(p => p.altitude));
            const start = new Date(s.startTime);
            const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
            if (!acc.has(key)) {
                acc.set(key, {
                    ts: new Date(start.getFullYear(), start.getMonth(), 1).getTime(),
                    label: `${getMonthName(start).slice(0, 3).toUpperCase()} ${String(start.getFullYear()).slice(2)}`,
                    time: 0, dist: 0, hrTime: 0
                });
            }
            const bucket = acc.get(key)!;
            for (let i = 1; i < pts.length; i++) {
                const hr = pts[i].hr;
                // Banda de 140-165 lpm (referencia 150): con 145-155 el filtro dejaba fuera
                // casi todo el entrenamiento real (medido: 2 min en un rodaje de 41 min, porque
                // sus rodajes viven entre 150 y 168 lpm). La banda es fija, así que el sesgo
                // que introduce es constante entre meses y la tendencia sigue siendo comparable.
                if (!(hr >= 140 && hr <= 165)) continue;
                const dt = (new Date(pts[i].timestamp).getTime() - new Date(pts[i - 1].timestamp).getTime()) / 1000;
                if (!(dt > 0) || dt > 60) continue; // descarta puntos parados y huecos de GPS
                const dd = pts[i].dist - pts[i - 1].dist;
                if (!(dd > 0)) continue;
                const a0 = smoothed[i - 1], a1 = smoothed[i];
                if (!Number.isFinite(a0) || !Number.isFinite(a1)) continue;
                const grade = (a1 - a0) / dd;
                if (grade < -0.02 || grade > 0.02) continue;
                bucket.time += dt;
                bucket.dist += dd;
                bucket.hrTime += hr * dt;
            }
        });

        // Solo se pintan los meses con al menos 5 minutos de muestra válida. Con menos, el
        // promedio mensual es ruido; el listón estaba en 20 minutos y dejaba el gráfico vacío.
        return [...acc.values()]
            .filter(m => m.time >= 5 * 60 && m.dist > 0)
            .sort((a, b) => a.ts - b.ts)
            .map(m => ({
                ts: m.ts,
                label: m.label,
                paceSecKm: (m.time / m.dist) * 1000,
                minutes: m.time / 60,
                hr: m.hrTime / m.time,
            }));
    }, [fullData]);

    const colW = 76;
    const chartW = Math.max(360, months.length * colW);
    const height = 220;
    const topPad = 30;
    const bottomPad = 70;

    let content: React.ReactNode;
    if (loading) {
        content = (
            <div className="h-40 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#34C759]"></div>
            </div>
        );
    } else if (months.length === 0) {
        content = <p className="text-gray-500 text-xs py-8 text-center">Aún no hay meses con al menos 20 minutos de tramos llanos entre 145 y 155 lpm.</p>;
    } else {
        const paces = months.map(m => m.paceSecKm);
        const minPace = Math.min(...paces);
        const maxPace = Math.max(...paces);
        const range = Math.max(10, maxPace - minPace);
        const xOf = (i: number) => months.length === 1 ? chartW / 2 : topPad + (i / (months.length - 1)) * (chartW - topPad * 2);
        // Eje invertido: menos segundos/km (más rápido) van más arriba.
        const yOf = (pace: number) => topPad + ((pace - minPace) / range) * (height - topPad - bottomPad);

        content = (
            <div className="overflow-x-auto">
                <div className="relative" style={{ width: `${chartW}px`, height: `${height}px` }}>
                    <svg viewBox={`0 0 ${chartW} ${height}`} width={chartW} height={height} className="absolute inset-0">
                        <line x1={0} y1={topPad} x2={chartW} y2={topPad} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                        <line x1={0} y1={height - bottomPad} x2={chartW} y2={height - bottomPad} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                        <polyline points={months.map((m, i) => `${xOf(i)},${yOf(m.paceSecKm)}`).join(' ')} fill="none" stroke="#34C759" strokeWidth="2" />
                    </svg>
                    {months.map((m, i) => (
                        <div
                            key={m.ts}
                            className="absolute -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `${xOf(i)}px`, top: `${yOf(m.paceSecKm)}px` }}
                            title={`${m.label}: ${formatPace(m.paceSecKm / 60)} · FC media ${Math.round(m.hr)} lpm · ${Math.round(m.minutes)} min`}
                        >
                            <div className="w-2.5 h-2.5 rounded-full bg-[#34C759] border border-black shadow-[0_0_8px_rgba(52,199,89,0.8)]"></div>
                            <div className="absolute left-1/2 top-3 -translate-x-1/2 text-center whitespace-nowrap">
                                <p className="text-[10px] font-mono font-bold text-white">{formatPace(m.paceSecKm / 60)}</p>
                                <p className="text-[8px] text-gray-500">{Math.round(m.minutes)} min</p>
                                <p className="text-[8px] text-gray-500 uppercase">{m.label}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-4 relative">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 gap-1">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Run /> <span className="ml-2">Ritmo a pulso fijo</span></h4>
                <p className="text-[10px] text-gray-500">ritmo a 150 lpm en llano · tramos con pendiente entre −2 % y +2 %</p>
            </div>
            {content}
        </div>
    );
};

/**
 * Eficiencia aeróbica normalizada (m/min/bpm) calculada SOLO sobre tramos llanos
 * (el motor descarta las pendientes fuera de −2 %/+2 %) y descartando las sesiones
 * con menos de 30 minutos de tramos válidos. Se superpone una media móvil de 5
 * sesiones para que la tendencia no la marque una salida suelta.
 */
export const NormalizedEfficiencyChart = ({ sessions }: { sessions: Session[] }) => {
    const [fullData, setFullData] = useState<Session[]>([]);
    const [loading, setLoading] = useState(false);
    const [hover, setHover] = useState<{ x: number; y: number; index: number } | null>(null);

    const runSessions = useMemo(
        () => sessions
            .filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
        [sessions]
    );

    useEffect(() => {
        if (runSessions.length === 0) { setFullData([]); return; }
        const needsLoading = runSessions.some(s => !s.trackPoints || s.trackPoints.length === 0);
        if (needsLoading) {
            setLoading(true);
            Promise.all(runSessions.map(s => getFullSessionFromDB(s.id))).then(results => {
                setFullData(results.filter((s): s is Session => !!s));
                setLoading(false);
            }).catch(() => setLoading(false));
        } else {
            setFullData(runSessions as Session[]);
        }
    }, [runSessions]);

    const points = useMemo(() => {
        const list: { ts: number; date: string; ef: number }[] = [];
        fullData.forEach(s => {
            const pts = s.trackPoints;
            if (!pts || pts.length < 2) return;
            const distances = pts.map(p => p.dist);
            const times = pts.map(p => new Date(p.timestamp).getTime() / 1000);
            const heartrates = pts.map(p => p.hr);
            const altitudes = pts.map(p => p.altitude);

            const ef = calculateEfficiencyFactor(distances, times, heartrates, altitudes);
            if (!(ef > 0)) return;

            // Tiempo válido con el mismo criterio que usa el motor: tramos con
            // distancia y duración positivas, FC > 0 y pendiente entre −2 %/+2 %.
            let validSeconds = 0;
            for (let i = 1; i < pts.length; i++) {
                const dt = times[i] - times[i - 1];
                const dd = distances[i] - distances[i - 1];
                const hr = heartrates[i - 1];
                if (!(dt > 0) || !(dd > 0) || !(hr > 0)) continue;
                const grade = (altitudes[i] - altitudes[i - 1]) / dd;
                if (grade < -0.02 || grade > 0.02) continue;
                validSeconds += dt;
            }
            if (validSeconds < 30 * 60) return;

            list.push({
                ts: new Date(s.startTime).getTime(),
                date: new Date(s.startTime).toLocaleDateString('es-ES'),
                ef,
            });
        });
        list.sort((a, b) => a.ts - b.ts);
        return list;
    }, [fullData]);

    // Media móvil de 5 sesiones (incluida la actual).
    const withMa = points.map((p, i) => {
        const from = Math.max(0, i - 4);
        const window = points.slice(from, i + 1);
        return { ...p, ma: window.reduce((a, w) => a + w.ef, 0) / window.length };
    });

    const width = 1000;
    const height = 260;
    const padding = 30;

    let content: React.ReactNode;
    if (loading) {
        content = (
            <div className="h-40 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            </div>
        );
    } else if (withMa.length === 0) {
        content = <p className="text-gray-500 text-xs py-8 text-center">Aún no hay sesiones de carrera con 30 minutos o más de tramos llanos válidos.</p>;
    } else {
        const n = withMa.length;
        const values = withMa.flatMap(p => [p.ef, p.ma]);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = Math.max(0.01, maxVal - minVal);
        const getX = (i: number) => n === 1 ? width / 2 : (i / (n - 1)) * width;
        const getY = (v: number) => height - padding - ((v - minVal) / range) * (height - padding * 2);
        const pathEf = withMa.map((p, i) => `${getX(i)},${getY(p.ef)}`).join(' L');
        const pathMa = withMa.map((p, i) => `${getX(i)},${getY(p.ma)}`).join(' L');

        content = (
            <div className="relative w-full h-64">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <line x1={0} y1={padding} x2={width} y2={padding} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                    <line x1={0} y1={height/2} x2={width} y2={height/2} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                    <line x1={0} y1={height-padding} x2={width} y2={height-padding} stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
                    <path d={`M${pathEf}`} fill="none" stroke="#3B82F6" strokeWidth="1.5" opacity="0.45" vectorEffect="non-scaling-stroke" />
                    <path d={`M${pathMa}`} fill="none" stroke="#A855F7" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                    {hover && (
                        <line x1={getX(hover.index)} y1={0} x2={getX(hover.index)} y2={height} stroke="white" strokeDasharray="2,2" opacity="0.4" vectorEffect="non-scaling-stroke" />
                    )}
                    {withMa.map((_, i) => (
                        <rect
                            key={i}
                            x={getX(i) - (width/n)/2}
                            y={0}
                            width={width/n}
                            height={height}
                            fill="transparent"
                            onMouseEnter={(e) => setHover({ x: e.clientX, y: e.clientY, index: i })}
                            onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, index: i })}
                            onMouseLeave={() => setHover(null)}
                        />
                    ))}
                </svg>
                {withMa.map((p, i) => (
                    <div
                        key={p.ts}
                        className="absolute w-1.5 h-1.5 rounded-full bg-[#3B82F6] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ left: `${(getX(i)/width)*100}%`, top: `${(getY(p.ef)/height)*100}%` }}
                    />
                ))}
                {hover && createPortal(
                    <div
                        className="fixed z-[9999] bg-[#1C1C1E]/95 backdrop-blur border border-white/20 p-2.5 rounded-xl shadow-2xl pointer-events-none text-[10px] min-w-[150px]"
                        style={{ left: hover.x, top: hover.y - 20, transform: 'translateX(-50%)' }}
                    >
                        <p className="font-bold text-gray-300 border-b border-white/10 pb-1 mb-1">{withMa[hover.index].date}</p>
                        <p className="text-blue-400">Eficiencia: {withMa[hover.index].ef.toFixed(2)} <span className="text-gray-600">m/min/bpm</span></p>
                        <p className="text-purple-400">Media 5: {withMa[hover.index].ma.toFixed(2)} <span className="text-gray-600">m/min/bpm</span></p>
                    </div>,
                    document.body
                )}
            </div>
        );
    }

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-4 relative">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 gap-1">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Trend /> <span className="ml-2">Eficiencia Normalizada</span></h4>
                <p className="text-[10px] text-gray-500">solo tramos llanos · sesiones con ≥30 min válidos · media móvil de 5 sesiones</p>
            </div>
            {content}
            <div className="flex justify-end space-x-4 text-[10px] mt-2">
                <span className="text-blue-500 font-bold">● Eficiencia por sesión</span>
                <span className="text-purple-400 font-bold">● Media móvil (5)</span>
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
                 <div className="text-[10px] text-gray-500 bg-white/5 px-2 py-1 rounded">Basado en tu mejor {formatMetric(bestRun.distance/1000)}k (Fatiga k={(k-1).toFixed(3)})</div>
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
        // El domingo (getDay() === 0) cae en la semana del lunes anterior; antes
        // se le sumaba un día de más y su volumen pasaba a la semana siguiente.
        const monday = getWeekStartMonday(d);
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
                    <span>{formatMetric(maxDist)}km</span>
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
                    <p className="text-[#34C759] font-mono">{formatMetric(hoverData.dist)} km</p>
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
    // El total de desnivel acumula TODAS las sesiones de la base de datos, sin ningún filtro.
    // Es, por tanto, un total histórico: si en el futuro se añade un filtro por fechas,
    // hay que recalcularlo sobre el subconjunto filtrado en lugar de reutilizar este valor.
    const totalElev = sessions.reduce((a,b) => a + b.totalElevationGain, 0);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Total Distancia" value={formatMetric(totalDist)} unit="km" colorClass="text-blue-400" icon={<Icons.Map />} />
            <MetricCard label="Total Tiempo" value={formatTime(totalTime)} unit="" colorClass="text-yellow-400" icon={<Icons.Clock />} />
            <MetricCard label="Sesiones" value={formatMetric(totalSessions)} unit="" colorClass="text-[#34C759]" icon={<Icons.ListCheck />} />
            <MetricCard label="Desnivel +" value={formatMetric(totalElev)} unit="m" colorClass="text-purple-400" icon={<Icons.Mountain />} />
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
                                <p className="text-xs font-mono font-bold text-[#34C759]">{formatMetric(s.distance/1000, 2)} km</p>
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
            <div className="absolute top-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1 rounded font-mono">{formatMetric(maxAlt)}m</div>
            <div className="absolute bottom-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1 rounded font-mono">{formatMetric(minAlt)}m</div>
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