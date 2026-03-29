
// @ts-ignore
import FitParserModule from 'fit-file-parser';
// @ts-ignore
import * as BufferModule from 'buffer';
import { Session, TrackPoint } from './types';
import { generateSessionName, calculateSlidingWindowMaxSpeed, calculateACSMVo2, calculateTRIMP, calculateClimbScore } from './utils';

// Robust Buffer Polyfill
const Buffer = BufferModule.Buffer || (BufferModule as any).default?.Buffer || (window as any).Buffer;

if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
}

const DEFAULT_MAX_HR = 190;
const DEFAULT_REST_HR = 60;

// Helper para calcular zancada si no existe sensor
const calculateStride = (speedMps: number, cadenceSpm: number): number => {
    if (speedMps > 0 && cadenceSpm > 0) {
        // Velocidad (m/s) / (Pasos por segundo) = Metros por paso
        return speedMps / (cadenceSpm / 60);
    }
    return 0;
};

export const parseCsv = (text: string, filename: string): Session => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) throw new Error("CSV vacío o inválido");
    const header = lines[0].toLowerCase().split(/[,;]/).map(h => h.trim().replace(/"/g, ''));
    const findCol = (possibleNames: string[]) => header.findIndex(h => possibleNames.some(name => h.includes(name)));
    const timeIdx = findCol(['timestamp', 'time', 'fecha', 'hora', 'date']);
    const latIdx = findCol(['lat', 'position_lat']);
    const lonIdx = findCol(['lon', 'long', 'position_long']);
    const hrIdx = findCol(['heart', 'hr', 'frecuencia', 'bpm']);
    const speedIdx = findCol(['speed', 'velocidad']);
    const altIdx = findCol(['alt', 'ele', 'height']);
    const distIdx = findCol(['dist']);
    const cadIdx = findCol(['cadence', 'cad', 'rpm', 'spm']); 

    if (timeIdx === -1) throw new Error("No se encontró columna de tiempo/fecha en el CSV");
    const trackPoints: TrackPoint[] = [];
    let startTimeStr = '';
    let maxHr = 0; let sumHr = 0; let validHrCount = 0; let cumDist = 0; let totalElevationGain = 0;
    let sumCad = 0; let countCad = 0; let sumStride = 0; let countStride = 0;

    // Control de última posición válida
    let lastLat = 0;
    let lastLon = 0;

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/[,;]/).map(c => c.trim().replace(/"/g, ''));
        if (cols.length < header.length) continue;
        const val = (idx: number) => idx !== -1 && cols[idx] ? parseFloat(cols[idx]) : 0;
        let timestamp = new Date().toISOString();
        const timeRaw = cols[timeIdx];
        if (timeRaw) {
             if (!isNaN(Number(timeRaw)) && timeRaw.length > 8) { timestamp = new Date(Number(timeRaw) * (timeRaw.length > 11 ? 1 : 1000)).toISOString(); } else { timestamp = new Date(timeRaw).toISOString(); }
        }
        if (i === 1) startTimeStr = timestamp;
        const hr = val(hrIdx); const speed = val(speedIdx); const dist = val(distIdx); const alt = val(altIdx);
        const cad = val(cadIdx);

        if (hr > 0) { if (hr > maxHr) maxHr = hr; sumHr += hr; validHrCount++; }
        if (cad > 0) { sumCad += cad; countCad++; }
        
        let stride = 0;
        const speedMps = speed > 20 ? speed / 3.6 : speed; 
        
        if (speedMps > 0 && cad > 0) {
             stride = calculateStride(speedMps, cad);
             if (stride > 0 && stride < 3) {
                sumStride += stride; countStride++;
             } else { stride = 0; }
        }

        if (dist === 0 && i > 1) { if (speedMps > 0) cumDist += speedMps; } else { cumDist = dist > 0 ? dist : cumDist; }
        
        // Lógica de elevación
        let currentAlt = alt;
        if (i > 1) {
             // Si alt es 0 pero teníamos elevación antes, mantener la anterior para evitar caídas a nivel del mar falsas
             if (currentAlt === 0 && trackPoints[trackPoints.length - 1].altitude > 0) currentAlt = trackPoints[trackPoints.length - 1].altitude;
             if (currentAlt > trackPoints[trackPoints.length - 1].altitude) { totalElevationGain += (currentAlt - trackPoints[trackPoints.length - 1].altitude); }
        }
        
        // Gestión robusta de coordenadas
        let currentLat = val(latIdx);
        let currentLon = val(lonIdx);

        if (currentLat !== 0 && currentLon !== 0) {
            lastLat = currentLat;
            lastLon = currentLon;
        } else if (lastLat !== 0 && lastLon !== 0) {
            // Relleno de huecos con la última conocida
            currentLat = lastLat;
            currentLon = lastLon;
        }

        trackPoints.push({ lat: currentLat, lon: currentLon, timestamp, hr, speed: speedMps * 3.6, altitude: currentAlt, dist: cumDist, cadence: cad, strideLength: stride });
    }
    const duration = trackPoints.length > 1 ? (new Date(trackPoints[trackPoints.length-1].timestamp).getTime() - new Date(startTimeStr).getTime()) / 1000 : 0;
    
    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
    let acsmVo2Max = calculateACSMVo2(trackPoints, maxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR);
    if (acsmVo2Max === 0 && vam6min > 0) acsmVo2Max = 3.5 * (vam6min * 3.6);

    return { 
        id: `csv-${new Date(startTimeStr).getTime()}`, 
        name: generateSessionName('ACTIVITY', startTimeStr, cumDist), 
        startTime: startTimeStr, 
        duration: duration, 
        distance: cumDist, 
        sport: 'ACTIVITY', 
        avgHr: validHrCount > 0 ? Math.round(sumHr / validHrCount) : 0, 
        maxHr: maxHr, 
        calories: 0, 
        totalElevationGain, 
        avgCadence: countCad > 0 ? Math.round(sumCad / countCad) : 0, 
        vam6min: vam6min, 
        best20minSpeed: best20minSpeed, 
        acsmVo2Max: acsmVo2Max, 
        trackPoints, 
        trimp: calculateTRIMP(trackPoints, maxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), 
        climbScore: calculateClimbScore(totalElevationGain, cumDist),
        avgStrideLength: countStride > 0 ? sumStride / countStride : 0
    };
};

export const parsePolarJson = (json: any, filename: string): Session => {
  try {
    const exercise = json.exercises?.[0] || json; 
    const startTime = exercise.startTime || new Date().toISOString();
    const samples = exercise.samples || {};
    const route = samples.recordedRoute || [];
    const heartRates = samples.heartRate || [];
    const speeds = samples.speed || []; 
    const altitudes = samples.altitude || [];
    const cadences = samples.cadence || []; 
    const trackPoints: TrackPoint[] = [];
    const len = Math.max(route.length, heartRates.length);
    let cumDist = 0; let sumHr = 0; let maxHr = 0; let totalAscent = 0;
    let sumCad = 0; let countCad = 0; let sumStride = 0; let countStride = 0;

    for (let i = 0; i < len; i++) {
        const routePt = route[i] || (i > 0 ? route[i-1] : { latitude: 0, longitude: 0, altitude: 0 });
        const hrVal = heartRates[i]?.value || heartRates[i] || 0;
        const speedVal = speeds[i]?.value || speeds[i] || 0; 
        const altVal = altitudes[i]?.value || altitudes[i] || routePt.altitude || 0;
        const cadVal = cadences[i]?.value || cadences[i] || 0;

        if (i > 0) cumDist += (speedVal / 3.6); 
        if (hrVal > 0) sumHr += hrVal;
        if (hrVal > maxHr) maxHr = hrVal;
        if (cadVal > 0) { sumCad += cadVal; countCad++; }
        
        let stride = 0;
        if (speedVal > 0 && cadVal > 0) {
            stride = calculateStride(speedVal / 3.6, cadVal);
            if (stride > 0 && stride < 3) {
                sumStride += stride; countStride++;
            } else { stride = 0; }
        }

        if (i > 0) { const prevAlt = trackPoints[i-1].altitude; if (altVal > prevAlt) totalAscent += (altVal - prevAlt); }
        
        // Polar suele tener rutas coherentes, pero por seguridad:
        const lat = routePt.latitude || 0;
        const lon = routePt.longitude || 0;

        trackPoints.push({ lat: lat, lon: lon, timestamp:  new Date(new Date(startTime).getTime() + i * 1000).toISOString(), hr: hrVal, speed: speedVal, altitude: altVal, dist: cumDist, cadence: cadVal, strideLength: stride });
    }
    if (trackPoints.length === 0) { return { id: `polar-stub`, name: 'Polar Import', startTime: new Date().toISOString(), duration: 0, distance: 0, sport: 'OTHER', avgHr: 0, maxHr: 0, calories: 0, totalElevationGain: 0, avgCadence: 0, vam6min: 0, best20minSpeed: 0, acsmVo2Max: 0, trackPoints: [], trimp: 0, climbScore: 0 }; }
    const sport = exercise.sport || 'RUNNING'; const distance = exercise.distance || cumDist; const finalMaxHr = exercise.heartRate?.maximum || maxHr;
    
    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
    let acsmVo2Max = calculateACSMVo2(trackPoints, finalMaxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR);
    if (acsmVo2Max === 0 && vam6min > 0) acsmVo2Max = 3.5 * (vam6min * 3.6);

    return { 
        id: `session-${sport}-${new Date(startTime).getTime()}`, 
        name: generateSessionName(sport, startTime, distance), 
        startTime: startTime, 
        duration: exercise.duration ? parseFloat(exercise.duration.replace('PT','').replace('S','')) : len, 
        distance: distance, 
        sport: sport, 
        avgHr: exercise.heartRate?.average || (len > 0 ? Math.round(sumHr/len) : 0), 
        maxHr: finalMaxHr, 
        calories: exercise.kiloCalories || 0, 
        totalElevationGain: totalAscent, 
        avgCadence: countCad > 0 ? Math.round(sumCad / countCad) : 0, 
        vam6min: vam6min, 
        best20minSpeed: best20minSpeed, 
        acsmVo2Max: acsmVo2Max, 
        trackPoints: trackPoints, 
        trimp: calculateTRIMP(trackPoints, finalMaxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), 
        climbScore: calculateClimbScore(totalAscent, distance),
        avgStrideLength: countStride > 0 ? sumStride / countStride : 0
    };
  } catch (err) { throw new Error("Formato JSON Polar no reconocido"); }
};

const GARMIN_EPOCH_OFFSET_MS = 631065600000;
const convertFitTimestamp = (ts: any): string => {
    try {
        if (!ts) return new Date().toISOString();
        if (ts instanceof Date) return ts.toISOString();
        if (typeof ts === 'string') return new Date(ts).toISOString();
        if (typeof ts === 'number') {
            if (ts < 1400000000) return new Date(ts * 1000 + GARMIN_EPOCH_OFFSET_MS).toISOString();
            if (ts > 1000000000000) return new Date(ts).toISOString(); 
            return new Date(ts * 1000).toISOString(); 
        }
        return new Date().toISOString();
    } catch (e) { return new Date().toISOString(); }
}

const findBestRecordArray = (obj: any): any[] => {
    let bestArray: any[] = [];
    let maxScore = 0;
    const traverse = (current: any, depth: number) => {
        if (depth > 10 || !current || typeof current !== 'object') return;
        if (Array.isArray(current)) {
            if (current.length > 0 && typeof current[0] === 'object') {
                let score = 0;
                const samples = [current[0], current[Math.floor(current.length/2)], current[current.length-1]];
                const validSamples = samples.filter(s => s && typeof s === 'object');
                const hasTimestamp = validSamples.some(s => 'timestamp' in s);
                const hasLat = validSamples.some(s => 'position_lat' in s || 'lat' in s || 'latitude' in s);
                if (hasTimestamp) score += 1000; if (hasLat) score += 500; score += current.length; 
                if (score > maxScore) { maxScore = score; bestArray = current; }
            }
            current.forEach(item => traverse(item, depth + 1));
        } else { Object.values(current).forEach(val => traverse(val, depth + 1)); }
    };
    traverse(obj, 0);
    return bestArray;
};

const getDistanceFromLatLonInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

const getCoord = (val: any) => {
    if (val === undefined || val === null) return null;
    // Conversión de semicírculos a grados (estándar FIT)
    // 2^31 = 2147483648
    // Si el valor es grande (entero de 32 bits), es un semicírculo.
    // Si es pequeño (ej. 40.5), ya son grados.
    if (Math.abs(val) > 180) return val * (180 / 2147483648);
    return val;
};

export const parseFitData = (arrayBuffer: ArrayBuffer, filename: string): Promise<Session> => {
    return new Promise((resolve, reject) => {
        try {
            const FitParserClass = (FitParserModule as any).default || FitParserModule;
            if (typeof FitParserClass !== 'function') { reject(new Error("La librería FitParser no se cargó correctamente.")); return; }
            if (!Buffer || typeof Buffer.from !== 'function') { reject(new Error("Librería Buffer no disponible.")); return; }
            const buffer = Buffer.from(arrayBuffer);
            const parser = new FitParserClass({ force: true, speedUnit: 'km/h', lengthUnit: 'm', temperatureUnit: 'celsius', mode: 'cascade' });
            parser.parse(buffer, (error: any, data: any) => {
                if (error) { if (!data) { reject(new Error(`Archivo ilegible: ${error.message || error}`)); return; } }
                if (!data) { reject(new Error("Archivo procesado pero resultado vacío")); return; }
                try {
                    let records = findBestRecordArray(data);
                    if (records.length === 0) { reject(new Error("No se encontraron registros de seguimiento válidos.")); return; }
                    let sessionData: any = null;
                    if (data.sessions && data.sessions.length > 0) sessionData = data.sessions[0];
                    else if (data.session && data.session.length > 0) sessionData = data.session[0];
                    else if (data.activity) {
                        if (data.activity.sessions && data.activity.sessions.length > 0) sessionData = data.activity.sessions[0];
                        else if (data.activity.session && data.activity.session.length > 0) sessionData = data.activity.session[0];
                        else sessionData = data.activity;
                    }
                    
                    const validRecords = records.map((r: any) => { 
                        // Uso de la nueva función getCoord más robusta
                        const lat = getCoord(r.position_lat) ?? getCoord(r.lat) ?? getCoord(r.latitude); 
                        const lon = getCoord(r.position_long) ?? getCoord(r.lon) ?? getCoord(r.longitude); 
                        let rawSpeed = r.enhanced_speed ?? r.speed ?? 0; 
                        if (rawSpeed > 200) rawSpeed = (rawSpeed / 1000) * 3.6; 
                        return { ...r, timestamp: convertFitTimestamp(r.timestamp), lat, lon, speed: rawSpeed }; 
                    }).filter(r => !isNaN(new Date(r.timestamp).getTime())).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    
                    if (validRecords.length === 0) { reject(new Error("Datos encontrados pero las fechas no son válidas.")); return; }
                    
                    let calculatedDist = 0; let maxHr = 0; let hrSum = 0; let hrCount = 0; let totalAscent = 0; let cadenceSum = 0; let cadenceCount = 0; 
                    let strideSum = 0; let strideCount = 0; let stanceSum = 0; let stanceCount = 0; let vertOscSum = 0; let vertOscCount = 0; let vertRatioSum = 0; let vertRatioCount = 0;

                    const trackPoints: TrackPoint[] = []; 
                    
                    // Variables para rellenar huecos de GPS
                    let lastValidLat: number | null = null;
                    let lastValidLon: number | null = null;

                    for (let i = 0; i < validRecords.length; i++) {
                        const curr = validRecords[i]; 
                        const prev = i > 0 ? validRecords[i-1] : null; 
                        let dist = curr.total_distance !== undefined ? curr.total_distance : curr.distance; 

                        // Gestión de Coordenadas: Evitar el salto a (0,0)
                        let lat = curr.lat;
                        let lon = curr.lon;

                        if (lat !== null && lon !== null && lat !== 0 && lon !== 0) {
                            lastValidLat = lat;
                            lastValidLon = lon;
                        } else {
                            // Si faltan coordenadas, usamos las últimas conocidas para mantener la línea
                            // CRÍTICO: Si nunca hubo coordenadas (inicio de sesión), mantenemos 0 para que se filtre después
                            if (lastValidLat !== null) lat = lastValidLat;
                            else lat = 0;
                            
                            if (lastValidLon !== null) lon = lastValidLon;
                            else lon = 0;
                        }

                        // Calcular distancia manual si falta
                        const hasCoords = lat !== 0 && lon !== 0 && prev && prev.lat && prev.lon; 
                        
                        // NOTA: Para cálculos de distancia incremental usamos los trackpoints procesados
                        const prevTp = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1] : null;

                        if ((dist === undefined || dist === null) && prevTp && lat !== 0 && prevTp.lat !== 0) {
                            calculatedDist += getDistanceFromLatLonInMeters(prevTp.lat, prevTp.lon, lat, lon);
                            dist = calculatedDist;
                        } else if (dist !== undefined && dist !== null) {
                            calculatedDist = dist;
                        } else {
                            dist = calculatedDist;
                        }

                        let speed = curr.speed; 
                        if ((speed === 0 || speed === undefined) && prevTp) { 
                            const t1 = new Date(prevTp.timestamp).getTime(); 
                            const t2 = new Date(curr.timestamp).getTime(); 
                            const deltaSec = (t2 - t1) / 1000; 
                            const deltaDist = dist - prevTp.dist; 
                            if (deltaSec > 0 && deltaDist >= 0) { 
                                const mps = deltaDist / deltaSec; 
                                speed = mps * 3.6; 
                                if (speed > 120) speed = prevTp.speed || 0; 
                            } 
                        }

                        const hr = curr.heart_rate || curr.heart_rate_bpm || 0; 
                        if (hr > 0) { if (hr > maxHr) maxHr = hr; hrSum += hr; hrCount++; }
                        
                        let alt = curr.enhanced_altitude ?? curr.altitude ?? 0; 
                        if (prevTp) { 
                            const prevAlt = prevTp.altitude; 
                            // Filtro básico de ruido de altitud
                            if (alt !== 0 && alt > prevAlt) { 
                                const diff = alt - prevAlt; 
                                if (diff < 50) totalAscent += diff; // Evitar saltos irreales de altitud
                            } 
                        }
                        
                        const cad = curr.cadence || 0; 
                        if (cad > 0) { cadenceSum += cad; cadenceCount++; }

                        let stride = curr.step_length ? curr.step_length / 1000 : 0; 
                        const stanceTime = curr.stance_time || 0; 
                        const vertOsc = curr.vertical_oscillation ? curr.vertical_oscillation / 10 : 0; 
                        const vertRatio = curr.vertical_ratio || 0; 

                        if (stride === 0 && speed > 0 && cad > 0) { stride = calculateStride(speed / 3.6, cad); }
                        if (stride > 0 && stride < 3) { strideSum += stride; strideCount++; }
                        if (stanceTime > 0) { stanceSum += stanceTime; stanceCount++; }
                        if (vertOsc > 0) { vertOscSum += vertOsc; vertOscCount++; }
                        if (vertRatio > 0) { vertRatioSum += vertRatio; vertRatioCount++; }

                        trackPoints.push({ 
                            lat: lat, 
                            lon: lon, 
                            timestamp: curr.timestamp, 
                            hr: hr, 
                            speed: speed || 0, 
                            altitude: alt, 
                            cadence: cad, 
                            dist: dist || 0,
                            strideLength: stride,
                            groundContactTime: stanceTime,
                            verticalOscillation: vertOsc,
                            verticalRatio: vertRatio
                        });
                    }
                    let sport = 'OTHER'; if (sessionData?.sport) sport = sessionData.sport.toUpperCase();
                    
                    let acsmVo2Max = calculateACSMVo2(trackPoints, maxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR);
                    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360); 
                    const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
                    if (acsmVo2Max === 0 && vam6min > 0) acsmVo2Max = 3.5 * (vam6min * 3.6);

                    const startTimeRaw = trackPoints[0].timestamp; 
                    const startTime = typeof startTimeRaw === 'string' ? startTimeRaw : new Date(startTimeRaw).toISOString();
                    const lastPoint = trackPoints[trackPoints.length - 1]; 
                    let totalDistance = sessionData?.total_distance || 0; 
                    if (totalDistance < 100 && lastPoint.dist > 100) totalDistance = lastPoint.dist;
                    
                    let duration = sessionData?.total_elapsed_time || 0; 
                    if (duration === 0) duration = (new Date(lastPoint.timestamp).getTime() - new Date(startTime).getTime()) / 1000;

                    let calculatedCalories = 0; if (sessionData) { if (sessionData.total_calories) calculatedCalories = sessionData.total_calories; else if (sessionData.calories) calculatedCalories = sessionData.calories; }
                    if (!calculatedCalories) { const laps = sessionData?.laps || sessionData?.lap || data.laps || data.lap; if (Array.isArray(laps) && laps.length > 0) { calculatedCalories = laps.reduce((acc: number, lap: any) => acc + (lap.total_calories || lap.calories || 0), 0); } }
                    if (!calculatedCalories && validRecords.length > 0) { const lastRec = validRecords[validRecords.length - 1]; if (lastRec.calories && typeof lastRec.calories === 'number' && lastRec.calories > 10) { calculatedCalories = lastRec.calories; } }
                    if (!calculatedCalories) { calculatedCalories = Math.round(duration / 60 * 10); }

                    const avgHr = sessionData?.avg_heart_rate || (hrCount > 0 ? Math.round(hrSum / hrCount) : 0); const finalMaxHr = sessionData?.max_heart_rate || maxHr;
                    const finalAscent = sessionData?.total_ascent ?? Math.round(totalAscent); const finalAvgCadence = sessionData?.avg_cadence ?? (cadenceCount > 0 ? Math.round(cadenceSum / cadenceCount) : 0);
                    
                    const avgStride = sessionData?.avg_step_length ? sessionData.avg_step_length / 1000 : (strideCount > 0 ? strideSum / strideCount : 0);
                    const avgStance = sessionData?.avg_stance_time || (stanceCount > 0 ? stanceSum / stanceCount : 0);
                    const avgVertOsc = sessionData?.avg_vertical_oscillation ? sessionData.avg_vertical_oscillation / 10 : (vertOscCount > 0 ? vertOscSum / vertOscCount : 0);
                    const avgVertRatio = sessionData?.avg_vertical_ratio || (vertRatioCount > 0 ? vertRatioSum / vertRatioCount : 0);

                    const session: Session = { 
                        id: `session-${sport}-${new Date(startTime).getTime()}`, 
                        name: generateSessionName(sport, startTime, totalDistance), 
                        startTime: startTime, 
                        duration: duration, 
                        distance: totalDistance, 
                        sport: sport, 
                        avgHr: avgHr, 
                        maxHr: finalMaxHr, 
                        calories: calculatedCalories || 0, 
                        totalElevationGain: finalAscent, 
                        avgCadence: finalAvgCadence, 
                        vam6min: vam6min || 0, 
                        best20minSpeed: best20minSpeed || 0, 
                        acsmVo2Max: acsmVo2Max || 0, 
                        trackPoints: trackPoints, 
                        trimp: calculateTRIMP(trackPoints, finalMaxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), 
                        climbScore: calculateClimbScore(finalAscent, totalDistance),
                        avgStrideLength: avgStride,
                        avgGroundContactTime: avgStance,
                        avgVerticalOscillation: avgVertOsc,
                        avgVerticalRatio: avgVertRatio
                    };
                    resolve(session);
                } catch (innerErr: any) { reject(new Error(`Estructura interna desconocida: ${innerErr.message}`)); }
            });
        } catch (outerErr: any) { reject(new Error(`Error inicial: ${outerErr.message}`)); }
    });
};