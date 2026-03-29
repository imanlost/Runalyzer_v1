
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './icons';
import { UserProfile, Notification, Session } from './types';
import { isSameDay, getMonthName, FOSTER_SCALE } from './utils';

const TOOLTIP_CONTENT: Record<string, { title: string; content: string }> = {
    vam: {
        title: "VAM (Velocidad Aeróbica Máxima)",
        content: "La velocidad mínima a la que alcanzas tu consumo máximo de oxígeno (VO2máx). Es tu 'techo' aeróbico. Entrenar a esta intensidad o ligeramente por encima mejora la potencia aeróbica. Estimada aquí con el mejor promedio sostenido de 6 minutos."
    },
    zones: {
        title: "Umbrales & Zonas (Karvonen)",
        content: "Se usa la Frecuencia Cardíaca de Reserva (FCR = Máx - Reposo) para mayor precisión individual. Z2 construye base mitocondrial y densidad capilar. Z4 trabaja la tolerancia al lactato, donde la producción iguala a la eliminación."
    },
    vo2: {
        title: "VO2 Max: Fisiología vs Potencia",
        content: "Dos visiones: 1) Fisiológica (ACSM): Eficiencia interna basada en cuánto te cuesta cardíacamente mantener una velocidad estable. 2) Rendimiento (VAM): Potencia externa pura, basada en la velocidad máxima que eres capaz de sostener durante 6 minutos (Test Jack Daniels/RunSmart)."
    },
    trimp: {
        title: "TRIMP (Training Impulse)",
        content: "Cuantifica la carga interna. Basado en el modelo de Banister, usa una escala exponencial: un minuto a alta intensidad 'cuesta' fisiológicamente mucho más que uno a baja. Mide el estrés real aplicado al organismo."
    },
    riegel: {
        title: "Pronóstico & Fatiga (Riegel)",
        content: "Usa tus mejores marcas recientes para calcular tu 'factor de fatiga' (exponente k). Un corredor resistente pierde poca velocidad al aumentar la distancia. Predice marcas teóricas asumiendo un entrenamiento adecuado para esa distancia."
    },
    polarized: {
        title: "Entrenamiento Polarizado (80/20)",
        content: "Modelo de Seiler: 80% del volumen debe ser baja intensidad (Z1-Z2) para adaptaciones estructurales sin fatiga excesiva, y 20% alta intensidad (Z4-Z5) para potencia. Evita la 'zona gris' (Z3) que fatiga pero no adapta óptimamente."
    },
    recovery: {
        title: "Tiempo de Recuperación",
        content: "Estimación del tiempo necesario para la supercompensación completa (homeostasis restaurada y mejorada) basada en el estrés TRIMP de la última sesión. Ignorar esto aumenta el riesgo de sobreentrenamiento."
    },
    efficiency: {
        title: "Eficiencia Aeróbica (EF)",
        content: "Ratio entre Output (Velocidad) y Coste (Frecuencia Cardíaca). Si este número sube con el tiempo, significa que corres más rápido con las mismas pulsaciones, indicando una mejora en la economía de carrera."
    },
    power: {
        title: "Potencia Estimada (W)",
        content: "Cálculo teórico de vatios en llano. Asume un coste energético constante del running (~1 kcal/kg/km). Útil para gestionar el esfuerzo en terrenos variables donde el ritmo engaña."
    },
    stride: {
        title: "Longitud de Zancada",
        content: "Distancia entre dos impactos consecutivos del mismo pie (o paso a paso x2 según dispositivo). Al aumentar velocidad, aumenta la zancada, pero una zancada excesivamente larga (overstriding) frena el avance y aumenta riesgo de lesión."
    },
    gct: {
        title: "Tiempo de Contacto (GCT)",
        content: "Milisegundos que el pie pasa tocando el suelo. Corredores de élite suelen estar <200ms. Menor tiempo implica mayor rigidez del tendón (stiffness) y mejor retorno de energía elástica."
    },
    vertOsc: {
        title: "Oscilación Vertical",
        content: "Cuánto 'botas' hacia arriba al correr (cm). Moverse hacia arriba cuesta energía que no te lleva hacia adelante. Lo ideal es minimizarla, aunque cierta oscilación es necesaria para el vuelo."
    },
    vertRatio: {
        title: "Ratio Vertical",
        content: "Porcentaje de tu longitud de zancada que se gasta en subir hacia arriba. Es la medida definitiva de eficiencia mecánica. Un ratio bajo (<6%) indica una técnica muy eficiente."
    },
    rpe: {
        title: "Escala Foster (RPE)",
        content: "Percepción Subjetiva del Esfuerzo. Es crucial para calcular la Carga Interna (RPE x Duración). Espera 30 min tras el ejercicio para puntuarlo globalmente, no solo el final."
    },
    acwr: {
        title: "ACWR (Ratio Agudo:Crónico)",
        content: "Relación entre la carga de la última semana (fatiga) y la del último mes (fitness). Un valor entre 0.8 y 1.3 es óptimo ('Sweet Spot'). Por encima de 1.5, el riesgo de lesión aumenta drásticamente por sobrecarga."
    }
};

export const InfoTooltip = ({ type }: { type: string }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const data = TOOLTIP_CONTENT[type];

    if (!data) return null;

    const handleMouseEnter = () => {
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setCoords({ x: rect.left + rect.width / 2, y: rect.top });
            setIsVisible(true);
        }
    };

    return (
        <>
            <button 
                ref={buttonRef}
                className="text-gray-500 hover:text-white transition-colors cursor-pointer text-xs ml-2"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setIsVisible(false)}
                onClick={(e) => { e.stopPropagation(); handleMouseEnter(); }} 
            >
                <Icons.Info />
            </button>
            {isVisible && createPortal(
                <div 
                    className="fixed z-[9999] w-64 p-4 bg-[#1C1C1E] border border-white/20 rounded-xl shadow-2xl backdrop-blur-md pointer-events-none animate-fade-in"
                    style={{ left: coords.x, top: coords.y, transform: 'translate(-50%, -100%) translateY(-10px)' }}
                >
                    <h5 className="text-[#34C759] font-bold text-xs uppercase mb-2 border-b border-white/10 pb-1">{data.title}</h5>
                    <p className="text-[11px] text-gray-300 leading-relaxed font-medium">{data.content}</p>
                    <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1C1C1E] border-r border-b border-white/20 transform rotate-45"></div>
                </div>,
                document.body
            )}
        </>
    );
};

export const RpeInputWidget = ({ sessionEndTime, currentRpe, onSave }: { sessionEndTime: string, currentRpe?: number, onSave: (rpe: number) => void }) => {
    const [selected, setSelected] = useState<number | undefined>(currentRpe);
    const endTime = new Date(sessionEndTime).getTime();
    const now = new Date().getTime();
    const diffMins = (now - endTime) / 60000;
    const isTooSoon = diffMins < 30;

    return (
        <div className="glass-panel p-4 rounded-3xl mt-4 border border-white/10">
            <div className="flex justify-between items-start mb-3">
                <div>
                    <h5 className="text-sm font-bold text-white flex items-center">
                        <Icons.Brain /> <span className="ml-2">Percepción del Esfuerzo (RPE)</span>
                        <InfoTooltip type="rpe" />
                    </h5>
                    {isTooSoon && !currentRpe && (
                        <p className="text-[10px] text-yellow-500 mt-1 flex items-center">
                            <Icons.Clock /> <span className="ml-1">Sesión recién terminada. Se recomienda esperar 30m para una valoración objetiva.</span>
                        </p>
                    )}
                </div>
                {selected !== undefined && (
                    <div className="text-xs bg-white/10 px-2 py-1 rounded text-gray-300 font-mono">
                        Carga sRPE: <span className="text-white font-bold">{selected}</span>
                    </div>
                )}
            </div>
            
            <div className="grid grid-cols-11 gap-1">
                {FOSTER_SCALE.map((level) => {
                    const isSelected = selected === level.val;
                    return (
                        <div key={level.val} className="flex flex-col items-center group">
                            <button
                                onClick={() => { setSelected(level.val); onSave(level.val); }}
                                className={`w-full h-10 rounded-lg text-sm font-bold transition-all duration-200 border relative overflow-hidden ${isSelected ? 'scale-110 z-10 shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-105'}`}
                                style={{ 
                                    backgroundColor: isSelected ? level.color : 'transparent',
                                    borderColor: level.color,
                                    color: isSelected ? 'black' : 'white'
                                }}
                            >
                                {level.val}
                            </button>
                            <span className={`text-[8px] mt-1 text-center font-medium transition-opacity ${isSelected ? 'opacity-100 text-white' : 'opacity-0 group-hover:opacity-100 text-gray-500'}`}>
                                {level.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const NotificationToast: React.FC<{ notification: Notification, onClose: () => void }> = ({ notification, onClose }) => {
    useEffect(() => { const timer = setTimeout(onClose, 5000); return () => clearTimeout(timer); }, [onClose]);
    const colors = { success: 'bg-green-500/10 border-green-500 text-green-500', error: 'bg-red-500/10 border-red-500 text-red-500', info: 'bg-blue-500/10 border-blue-500 text-blue-500' };
    return (
        <div className={`flex items-center p-4 mb-3 rounded-xl border backdrop-blur-md shadow-2xl transition-all animate-fade-in ${colors[notification.type]}`}>
            <div className="mr-3 text-xl">{notification.type === 'success' && <Icons.Check />}{notification.type === 'error' && <Icons.Warning />}{notification.type === 'info' && <Icons.Info />}</div>
            <div className="flex-1 text-sm font-medium pr-4 break-words max-w-xs">{notification.message}</div>
            <button onClick={onClose} className="opacity-60 hover:opacity-100"><Icons.XMark /></button>
        </div>
    );
};

export const SummaryItem = ({ label, value, unit, color }: any) => (
    <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col justify-center">
        <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">{label}</p>
        <p className={`text-xl font-bold font-mono ${color || 'text-white'}`}>{value} <span className="text-[10px] text-gray-500 font-sans font-normal ml-0.5">{unit}</span></p>
    </div>
);

export const MetricCard = ({ label, value, unit, colorClass, icon }: any) => (
    <div className="glass-panel p-3 rounded-2xl flex items-center justify-between">
        <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${colorClass}`}>{value} <span className="text-xs text-gray-500 ml-1">{unit}</span></p>
        </div>
        <div className={`text-2xl opacity-20 ${colorClass}`}>{icon}</div>
    </div>
);

export const ProfileModal = ({ isOpen, onClose, profile, onSave }: any) => {
    const [localProfile, setLocalProfile] = useState(profile);
    const [useCustom, setUseCustom] = useState(false);
    const [manualZones, setManualZones] = useState({ z1: 0, z2: 0, z3: 0, z4: 0 });

    useEffect(() => { 
        if (isOpen) {
            setLocalProfile(profile);
            if (profile.customZones) {
                setUseCustom(true);
                setManualZones(profile.customZones);
            } else {
                setUseCustom(false);
                // Pre-poblar con cálculo Karvonen para facilitar edición
                const fcr = profile.maxHr - profile.restHr;
                setManualZones({
                    z1: Math.round(profile.restHr + (0.60 * fcr)),
                    z2: Math.round(profile.restHr + (0.70 * fcr)),
                    z3: Math.round(profile.restHr + (0.80 * fcr)),
                    z4: Math.round(profile.restHr + (0.90 * fcr))
                });
            }
        }
    }, [profile, isOpen]);

    const handleChange = (field: string, val: any) => setLocalProfile((p: any) => ({ ...p, [field]: val }));
    
    // Cálculo de zonas para mostrar
    let z1Lim, z2Lim, z3Lim, z4Lim;
    
    if (useCustom) {
        z1Lim = manualZones.z1;
        z2Lim = manualZones.z2;
        z3Lim = manualZones.z3;
        z4Lim = manualZones.z4;
    } else {
        const fcr = localProfile.maxHr - localProfile.restHr;
        z1Lim = Math.round(localProfile.restHr + (0.60 * fcr));
        z2Lim = Math.round(localProfile.restHr + (0.70 * fcr));
        z3Lim = Math.round(localProfile.restHr + (0.80 * fcr));
        z4Lim = Math.round(localProfile.restHr + (0.90 * fcr));
    }

    const handleSave = () => {
        const finalProfile = { ...localProfile };
        if (useCustom) {
            finalProfile.customZones = manualZones;
        } else {
            delete finalProfile.customZones;
        }
        onSave(finalProfile);
    };

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 max-w-md w-full relative shadow-2xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white"><Icons.XMark /></button>
                <div className="flex items-center space-x-3 mb-6"><div className="w-10 h-10 rounded-full bg-[#007AFF] flex items-center justify-center text-white"><Icons.User /></div><h3 className="text-xl font-bold text-white">Perfil del Atleta</h3></div>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">Edad</label><input type="number" value={localProfile.age} onChange={e => handleChange('age', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#007AFF]" /></div>
                        <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">Peso (kg)</label><input type="number" value={localProfile.weight} onChange={e => handleChange('weight', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#007AFF]" /></div>
                    </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">Altura (cm)</label><input type="number" value={localProfile.height} onChange={e => handleChange('height', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#007AFF]" /></div>
                        <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">Sexo</label><select value={localProfile.gender} onChange={e => handleChange('gender', e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#007AFF]"><option value="male">Hombre</option><option value="female">Mujer</option></select></div>
                    </div>
                    <div className="pt-4 border-t border-white/10">
                         <div className="flex justify-between items-center mb-3">
                             <h4 className="text-sm font-semibold text-[#34C759]">Zonas Cardíacas</h4>
                             <button 
                                onClick={() => setUseCustom(!useCustom)}
                                className={`text-[10px] px-2 py-1 rounded-full border transition-all ${useCustom ? 'bg-[#34C759] text-black border-[#34C759]' : 'bg-transparent text-gray-400 border-gray-600'}`}
                             >
                                {useCustom ? 'Modo Manual' : 'Auto (Karvonen)'}
                             </button>
                         </div>
                         
                         <div className="grid grid-cols-2 gap-4 mb-4">
                            <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">FC Reposo</label><input type="number" value={localProfile.restHr} onChange={e => handleChange('restHr', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#34C759]" disabled={useCustom} /></div>
                            <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">FC Máxima</label><input type="number" value={localProfile.maxHr} onChange={e => handleChange('maxHr', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#34C759]" /></div>
                        </div>

                        {/* Custom Zone Inputs */}
                        {useCustom && (
                            <div className="grid grid-cols-2 gap-2 mb-4 animate-fade-in">
                                <div><label className="text-[10px] text-gray-500 font-bold block">Límite Superior Z1</label><input type="number" value={manualZones.z1} onChange={e => setManualZones({...manualZones, z1: Number(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded p-1.5 text-sm text-gray-300 focus:border-[#34C759] outline-none" /></div>
                                <div><label className="text-[10px] text-gray-500 font-bold block">Límite Superior Z2</label><input type="number" value={manualZones.z2} onChange={e => setManualZones({...manualZones, z2: Number(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded p-1.5 text-sm text-blue-300 focus:border-blue-500 outline-none" /></div>
                                <div><label className="text-[10px] text-gray-500 font-bold block">Límite Superior Z3</label><input type="number" value={manualZones.z3} onChange={e => setManualZones({...manualZones, z3: Number(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded p-1.5 text-sm text-green-300 focus:border-green-500 outline-none" /></div>
                                <div><label className="text-[10px] text-gray-500 font-bold block">Límite Superior Z4</label><input type="number" value={manualZones.z4} onChange={e => setManualZones({...manualZones, z4: Number(e.target.value)})} className="w-full bg-white/5 border border-white/10 rounded p-1.5 text-sm text-orange-300 focus:border-orange-500 outline-none" /></div>
                            </div>
                        )}

                        {/* Zone Table Preview */}
                        <div className="bg-black/30 rounded-lg p-2 text-[10px]">
                            <div className="flex justify-between border-b border-white/5 pb-1 mb-1 font-bold text-gray-400"><span>Zona</span><span>Rango BPM</span><span>Intensidad</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-gray-400">Z1</span><span>0 - {z1Lim}</span><span className="text-gray-500">Recuperación</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-blue-400">Z2</span><span>{z1Lim} - {z2Lim}</span><span className="text-blue-500">Aeróbico Base</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-green-400">Z3</span><span>{z2Lim} - {z3Lim}</span><span className="text-green-500">Ritmo Tempo</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-orange-400">Z4</span><span>{z3Lim} - {z4Lim}</span><span className="text-orange-500">Umbral</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-red-400">Z5</span><span>&gt; {z4Lim}</span><span className="text-red-500">VO2 Max</span></div>
                        </div>
                    </div>
                    <button onClick={handleSave} className="w-full bg-[#007AFF] hover:bg-blue-600 text-white font-bold py-3 rounded-xl mt-4 transition-colors">Guardar Perfil</button>
                </div>
            </div>
        </div>
    );
};

export const CalendarWidget = React.memo(({ sessions, selectedDate, onDateSelect }: { sessions: Session[], selectedDate: Date | null, onDateSelect: (d: Date | null) => void }) => {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay(); 
    const startOffset = firstDay === 0 ? 6 : firstDay - 1; 
    const days = [];
    for (let i = 0; i < startOffset; i++) days.push(<div key={`empty-${i}`} className="h-6 w-6"></div>);
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
        const hasSession = sessions.some(s => isSameDay(new Date(s.startTime), date));
        const isSelected = selectedDate && isSameDay(selectedDate, date);
        const isToday = isSameDay(new Date(), date);
        days.push(<div key={i} onClick={() => onDateSelect(isSelected ? null : date)} className={`h-7 w-7 flex items-center justify-center rounded-full text-xs cursor-pointer transition-all relative ${isSelected ? 'bg-white text-black font-bold' : 'hover:bg-white/10 text-gray-300'} ${isToday && !isSelected ? 'border border-[#34C759] text-[#34C759]' : ''}`}>{i}{hasSession && !isSelected && (<div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-[#34C759]"></div>)}</div>);
    }
    const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    return (
        <div className="p-4 bg-[#1C1C1E] rounded-2xl border border-white/5 mb-4 select-none">
            <div className="flex justify-between items-center mb-3 text-sm font-semibold text-white"><button onClick={prevMonth} className="p-1 hover:text-[#34C759]"><Icons.ChevronLeft /></button><span>{currentMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}</span><button onClick={nextMonth} className="p-1 hover:text-[#34C759]"><Icons.ChevronRight /></button></div>
            <div className="grid grid-cols-7 gap-1 text-[10px] text-gray-500 font-bold text-center mb-2"><div>L</div><div>M</div><div>X</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
            <div className="grid grid-cols-7 gap-1 place-items-center">{days}</div>
            {selectedDate && (<div className="mt-3 text-center"><button onClick={() => onDateSelect(null)} className="text-[10px] text-[#34C759] hover:underline">Limpiar filtro ({selectedDate.toLocaleDateString()})</button></div>)}
        </div>
    );
});