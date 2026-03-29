
import { TrackPoint, Session, SessionSummary, AcwrResult } from './types';

export const formatPace = (minPerKm: number) => {
    if (!isFinite(minPerKm) || isNaN(minPerKm) || minPerKm <= 0) return '--';
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}'${s < 10 ? '0' + s : s}''`;
};

export const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
    return `${m}:${s < 10 ? '0'+s : s}`;
};

export const generateSessionName = (sport: string, startTime: string, distanceMeters: number) => {
    const d = new Date(startTime);
    const validDate = !isNaN(d.getTime()) ? d : new Date();
    const date = validDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const distStr = (distanceMeters / 1000).toFixed(2) + 'km';
    
    let sportName = sport;
    if (sport === 'RUNNING') sportName = 'Carrera';
    else if (sport === 'TRAIL_RUNNING') sportName = 'Trail';
    else if (sport === 'CYCLING') sportName = 'Ciclismo';
    else if (sport === 'MOUNTAIN_BIKING') sportName = 'BTT';
    else if (sport === 'SWIMMING') sportName = 'Natación';
    else if (sport === 'HIIT') sportName = 'HIIT';
    else if (sport === 'ACTIVITY' || sport === 'WALKING') sportName = 'Actividad';
    else if (sport === 'HIKING') sportName = 'Senderismo';

    return `${date} - ${sportName} - ${distStr}`;
};

export const isSameDay = (d1: Date, d2: Date) => {
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
};

export const getMonthName = (date: Date) => {
    if (isNaN(date.getTime())) return 'Fecha Inválida';
    return date.toLocaleDateString('es-ES', { month: 'long' });
};

export const calculateTRIMP = (trackPoints: TrackPoint[], maxHr: number, restHr: number): number => {
    let trimp = 0;
    for (let i = 1; i < trackPoints.length; i++) {
        const p = trackPoints[i];
        const prev = trackPoints[i-1];
        const durationMin = (new Date(p.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 60000;
        
        if (durationMin > 0 && durationMin < 10 && p.hr > 0) { 
            let hr = p.hr;
            if (hr < restHr) hr = restHr;
            if (hr > maxHr) hr = maxHr;
            
            const hrr = (hr - restHr) / (maxHr - restHr);
            const segmentTrimp = durationMin * hrr * 0.64 * Math.exp(1.92 * hrr);
            trimp += segmentTrimp;
        }
    }
    return Math.round(trimp);
};

export const calculateClimbScore = (gain: number, distanceMeters: number): number => {
    if (distanceMeters === 0) return 0;
    const gradient = (gain / distanceMeters) * 100; 
    return Math.round((gain * gradient) / 100); 
};

export const calculateSlidingWindowMaxSpeed = (trackPoints: TrackPoint[], windowSeconds: number): number => {
    if (trackPoints.length < 2) return 0;
    const times = trackPoints.map(p => new Date(p.timestamp).getTime() / 1000);
    const dists = trackPoints.map(p => p.dist);
    let maxSpeed = 0;
    let left = 0;
    for (let right = 1; right < times.length; right++) {
        while (times[right] - times[left] > windowSeconds) left++;
        const duration = times[right] - times[left];
        if (duration >= windowSeconds * 0.9) {
            const distance = dists[right] - dists[left];
            const speedMps = distance / duration;
            if (speedMps > maxSpeed && speedMps < 7.0) maxSpeed = speedMps;
        }
    }
    return maxSpeed;
};

export const calculateACSMVo2 = (trackPoints: TrackPoint[], maxHr: number, restHr: number = 60): number => {
    if (!trackPoints || trackPoints.length < 300) return 0;

    const WINDOW_SEC = 300;
    const MIN_SPEED_MPS = 2.2; 
    const MAX_HR_STD_DEV = 5.0; 
    const MIN_INTENSITY = 0.65;
    const MAX_INTENSITY = 0.92;

    const times = trackPoints.map(p => new Date(p.timestamp).getTime() / 1000);
    const validSegments: number[] = [];
    const hrReserve = maxHr - restHr;

    for (let i = 0; i < trackPoints.length; i += 30) {
        const startTime = times[i];
        let j = i;
        while(j < times.length && (times[j] - startTime) < WINDOW_SEC) {
            j++;
        }
        
        if (j >= times.length) break;
        if ((times[j] - startTime) < (WINDOW_SEC - 10)) continue; 

        const segment = trackPoints.slice(i, j);
        const distDiff = segment[segment.length-1].dist - segment[0].dist;
        const timeDiff = times[j] - times[i];

        if (timeDiff <= 0 || distDiff <= 0) continue;

        const avgSpeed = distDiff / timeDiff; 
        if (avgSpeed < MIN_SPEED_MPS) continue; 

        const hrs = segment.map(p => p.hr).filter(h => h > 0);
        if (hrs.length < 200) continue; 

        const avgHr = hrs.reduce((a,b) => a+b, 0) / hrs.length;
        const variance = hrs.reduce((a,b) => a + Math.pow(b - avgHr, 2), 0) / hrs.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev > MAX_HR_STD_DEV) continue;

        const intensity = (avgHr - restHr) / hrReserve;
        if (intensity < MIN_INTENSITY || intensity > MAX_INTENSITY) continue;

        const eleDiff = segment[segment.length-1].altitude - segment[0].altitude;
        let grade = eleDiff / distDiff;
        if (isNaN(grade)) grade = 0;

        if (grade < -0.02 || grade > 0.06) continue; 

        const speedMmin = avgSpeed * 60;
        const vo2Cost = 3.5 + (0.2 * speedMmin) + (0.9 * speedMmin * grade);
        const vo2MaxEst = vo2Cost / intensity;

        if (vo2MaxEst > 25 && vo2MaxEst < 90) {
            validSegments.push(vo2MaxEst);
        }
    }

    if (validSegments.length === 0) return 0;
    return Math.max(...validSegments);
};

export const calculateGlobalVo2Max = (sessions: Session[]): { physiological: number, performance: number } => {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const validSessions = sessions.filter(s => {
        const isRunning = s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING';
        const age = now - new Date(s.startTime).getTime();
        return isRunning && age < NINETY_DAYS_MS;
    });

    if (validSessions.length === 0) return { physiological: 0, performance: 0 };

    const calcWeighted = (getter: (s: Session) => number) => {
        const values = validSessions
            .map(s => ({ val: getter(s), startTime: new Date(s.startTime).getTime() }))
            .filter(v => v.val > 0)
            .sort((a, b) => b.val - a.val)
            .slice(0, 5);

        if (values.length === 0) return 0;

        let totalVal = 0;
        let totalWeight = 0;

        values.forEach(v => {
            const age = now - v.startTime;
            let weight = 0;
            if (age <= TWO_WEEKS_MS) weight = 1.0; 
            else {
                const progress = (age - TWO_WEEKS_MS) / (NINETY_DAYS_MS - TWO_WEEKS_MS);
                weight = Math.max(0.2, 1.0 - (progress * 0.8));
            }
            totalVal += v.val * weight;
            totalWeight += weight;
        });
        return totalWeight > 0 ? (totalVal / totalWeight) : 0;
    };

    const physVo2 = calcWeighted(s => s.acsmVo2Max);

    const perfVo2 = calcWeighted(s => {
        if (!s.vam6min) return 0;
        const speedMmin = s.vam6min * 60; 
        return (0.2 * speedMmin) + 3.5;
    });

    return { physiological: physVo2, performance: perfVo2 };
};

export const calculateIndividualizedK = (sessions: Session[]): number => {
    const valid = sessions.filter(s => s.distance > 3000 && s.duration > 600); 
    if (valid.length < 2) return 1.06;
    
    const shortRuns = valid.filter(s => s.distance >= 3000 && s.distance <= 7000);
    const longRuns = valid.filter(s => s.distance >= 8000);
    
    if (shortRuns.length === 0 || longRuns.length === 0) return 1.06;

    const bestShort = shortRuns.reduce((prev, curr) => (curr.distance/curr.duration) > (prev.distance/prev.duration) ? curr : prev);
    const bestLong = longRuns.reduce((prev, curr) => (curr.distance/curr.duration) > (prev.distance/prev.duration) ? curr : prev);

    const t1 = bestShort.duration;
    const d1 = bestShort.distance;
    const t2 = bestLong.duration;
    const d2 = bestLong.distance;
    
    if (d2 <= d1) return 1.06;

    const k = Math.log(t2/t1) / Math.log(d2/d1);
    return Math.max(1.01, Math.min(1.2, k));
};

export const calculateAverageStrideLength = (trackPoints: TrackPoint[]): number => {
    let sum = 0;
    let count = 0;
    for (const p of trackPoints) {
        let stride = p.strideLength;
        // Si no tiene zancada nativa, calcularla al vuelo: m/s / (pasos/seg)
        if ((!stride || stride === 0) && p.cadence && p.cadence > 0 && p.speed > 0) {
             const speedMps = p.speed / 3.6; // Speed en TP suele ser km/h según parsers
             stride = speedMps / (p.cadence / 60);
        }
        
        if (stride && stride > 0.3 && stride < 3.0) { // Filtrar ruido
            sum += stride;
            count++;
        }
    }
    return count > 0 ? sum / count : 0;
};

// --- LOGICA DE CARGA INTERNA Y PREVENCION DE LESIONES ---

export const FOSTER_SCALE = [
    { val: 0, label: 'Reposo', color: '#60A5FA' }, // Blue 400
    { val: 1, label: 'Muy Suave', color: '#4ADE80' }, // Green 400
    { val: 2, label: 'Suave', color: '#A3E635' }, // Lime 400
    { val: 3, label: 'Moderado', color: '#FACC15' }, // Yellow 400
    { val: 4, label: 'Algo Duro', color: '#FBBF24' }, // Amber 400
    { val: 5, label: 'Duro', color: '#FB923C' }, // Orange 400
    { val: 6, label: 'Duro +', color: '#F97316' }, // Orange 500
    { val: 7, label: 'Muy Duro', color: '#EF4444' }, // Red 500
    { val: 8, label: 'Muy Duro +', color: '#DC2626' }, // Red 600
    { val: 9, label: 'Extremo', color: '#B91C1C' }, // Red 700
    { val: 10, label: 'Máximo', color: '#7F1D1D' }  // Red 900
];

export const calculateACWR = (sessions: SessionSummary[]): AcwrResult => {
    const now = new Date();
    // Normalizar a medianoche para evitar problemas con horas
    const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    let acuteSum = 0; // Suma de los últimos 7 días
    let chronicSum = 0; // Suma de los últimos 28 días

    const DAY_MS = 24 * 60 * 60 * 1000;

    sessions.forEach(s => {
        if (!s.internalLoad) return;
        
        const sessionDate = new Date(s.startTime);
        const sessionTs = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate()).getTime();
        const diffDays = (todayTs - sessionTs) / DAY_MS;

        if (diffDays >= 0 && diffDays < 7) {
            acuteSum += s.internalLoad;
        }
        
        if (diffDays >= 0 && diffDays < 28) {
            chronicSum += s.internalLoad;
        }
    });

    // Carga Crónica = Media semanal de los últimos 28 días (o carga diaria media x 7)
    // El método estándar para ACWR (Ratio) es comparar la carga aguda (7 días) con la media de las últimas 4 semanas.
    // Chronic Load (Weekly Average) = Sum(28 days) / 4
    const chronicLoad = chronicSum / 4;

    // Si no hay historial suficiente, ratio indefinido o 0
    if (chronicLoad === 0) return { acuteLoad: acuteSum, chronicLoad: 0, ratio: 0, status: 'UNDEFINED' };

    const ratio = acuteSum / chronicLoad;
    
    let status: 'OPTIMAL' | 'CAUTION' | 'DANGER' = 'OPTIMAL';
    if (ratio > 1.5) status = 'DANGER';
    else if (ratio > 1.3 || ratio < 0.8) status = 'CAUTION';
    
    return { acuteLoad: acuteSum, chronicLoad, ratio, status };
};

export const generateMockHistory = (): Session[] => {
  const sessions: Session[] = [];
  const now = new Date();
  for (let i = 0; i < 180; i++) { 
    const date = new Date(now);
    date.setDate(date.getDate() - i); 
    if (Math.random() > 0.7) continue; 

    const durationMins = 30 + Math.random() * 60;
    const avgSpeed = 10 + Math.random() * 4; 
    const distance = (avgSpeed * durationMins) / 60;
    const sport = i % 4 === 0 ? 'CYCLING' : 'RUNNING';
    const startTime = date.toISOString();
    const distMeters = distance * 1000;
    const points: TrackPoint[] = [];
    
    const count = Math.floor(durationMins * 60);
    const avgHr = 140 + Math.random() * 20;
    const avgCad = sport === 'RUNNING' ? 160 + Math.random() * 20 : 0;

    for(let j=0; j<count; j+=60) {
        points.push({lat:0, lon:0, timestamp: new Date(date.getTime() + j*1000).toISOString(), hr: avgHr, speed: avgSpeed, altitude: 100, dist: j*3, cadence: avgCad});
    }

    // Mock RPE data
    const mockRpe = Math.floor(Math.random() * 6) + 2; // 2 to 7
    const mockLoad = mockRpe * durationMins;

    sessions.push({
      id: `mock-${i}`, name: generateSessionName(sport, startTime, distMeters), startTime: startTime,
      duration: durationMins * 60, distance: distMeters, sport: sport, avgHr: Math.round(avgHr),
      maxHr: 190, calories: durationMins * 10,
      totalElevationGain: 150, avgCadence: Math.round(avgCad), vam6min: 12, best20minSpeed: 11, acsmVo2Max: 45, trackPoints: points,
      trimp: Math.round(durationMins * (avgHr/190) * 1.5), 
      climbScore: 2,
      rpe: mockRpe,
      internalLoad: Math.round(mockLoad)
    });
  }
  return sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
};