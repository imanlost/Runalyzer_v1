import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import L from 'leaflet';
// @ts-ignore
import JSZip from 'jszip';
// @ts-ignore
import FitParserModule from 'fit-file-parser';
// @ts-ignore
import { Buffer } from 'buffer';

// --- Global Types ---
declare global {
    interface Window {
        Buffer: any;
    }
}

// --- Polyfills ---
if (typeof window !== 'undefined') {
    window.Buffer = Buffer;
}

// --- IndexedDB Helpers ---
const DB_NAME = 'RunAlyzerDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (event: any) => resolve(event.target.result);
        request.onerror = (event: any) => reject(event.target.error);
    });
};

const saveSessionToDB = async (session: Session) => {
    try {
        const db = await openDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(session);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            request.onerror = () => reject(request.error);
        });
    } catch (e) { console.error("DB Save Error", e); }
};

const deleteSessionFromDB = async (id: string) => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const clearDB = async () => {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

const getAllSessionsFromDB = async (): Promise<Session[]> => {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        return [];
    }
};

// --- Types & Interfaces ---
interface UserProfile {
    age: number;
    weight: number; 
    height: number;
    gender: 'male' | 'female';
    restHr: number;
    maxHr: number;
}

interface TrackPoint {
  lat: number;
  lon: number;
  timestamp: string | number | Date; 
  hr: number;
  speed: number; 
  altitude: number; 
  cadence?: number;
  dist: number; 
}

interface Session {
  id: string;
  name: string;
  startTime: string;
  duration: number;
  distance: number;
  sport: string;
  avgHr: number;
  maxHr: number;
  calories: number;
  totalElevationGain: number; 
  avgCadence: number; 
  vam6min: number; 
  best20minSpeed: number; 
  acsmVo2Max: number; 
  trackPoints: TrackPoint[];
  trimp: number;
  climbScore: number;
}

interface Notification {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

interface DailyFitness {
    date: string;
    ctl: number; 
    atl: number; 
    tsb: number; 
    trimp: number; 
}

// --- Utils ---
const formatPace = (minPerKm: number) => {
    if (!isFinite(minPerKm) || isNaN(minPerKm) || minPerKm <= 0) return '--';
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}'${s < 10 ? '0' + s : s}''`;
};

const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
    return `${m}:${s < 10 ? '0'+s : s}`;
};

const generateSessionName = (sport: string, startTime: string, distanceMeters: number) => {
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

const isSameDay = (d1: Date, d2: Date) => {
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
};

const getMonthName = (date: Date) => {
    if (isNaN(date.getTime())) return 'Fecha Inválida';
    return date.toLocaleDateString('es-ES', { month: 'long' });
};

// --- Physiological Calculations ---

const calculateTRIMP = (trackPoints: TrackPoint[], maxHr: number, restHr: number): number => {
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

const calculateClimbScore = (gain: number, distanceMeters: number): number => {
    if (distanceMeters === 0) return 0;
    const gradient = (gain / distanceMeters) * 100; 
    return Math.round((gain * gradient) / 100); 
};

// --- Advanced Algorithm Helpers ---
const calculateSlidingWindowMaxSpeed = (trackPoints: TrackPoint[], windowSeconds: number): number => {
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
            // Cap at 25 km/h (approx 7 m/s) to avoid GPS spikes ruining VAM
            if (speedMps > maxSpeed && speedMps < 7.0) maxSpeed = speedMps;
        }
    }
    // Return in m/s
    return maxSpeed;
};

// --- VO2 MAX "GOLD STANDARD" IMPLEMENTATION ---
export const calculateACSMVo2 = (trackPoints: TrackPoint[], maxHr: number, restHr: number = 60): number => {
    // Requisitos mínimos: 5 minutos de datos
    if (!trackPoints || trackPoints.length < 300) return 0;

    const WINDOW_SEC = 300; // 5 minutos exactos para estado estable
    const MIN_SPEED_MPS = 2.2; // ~8 km/h (Umbral mínimo de carrera)
    const MAX_HR_STD_DEV = 5.0; // Desviación estándar máxima permitida (latidos)
    const MIN_INTENSITY = 0.65; // 65% FCR
    const MAX_INTENSITY = 0.92; // 92% FCR

    const times = trackPoints.map(p => new Date(p.timestamp).getTime() / 1000);
    const validSegments: number[] = [];
    const hrReserve = maxHr - restHr;

    // Iteramos saltando 30 segundos para eficiencia
    for (let i = 0; i < trackPoints.length; i += 30) {
        const startTime = times[i];
        
        // Encontrar índice final de la ventana
        let j = i;
        while(j < times.length && (times[j] - startTime) < WINDOW_SEC) {
            j++;
        }
        
        // Verificar si tenemos datos suficientes para la ventana
        if (j >= times.length) break;
        if ((times[j] - startTime) < (WINDOW_SEC - 10)) continue; // Brecha de tiempo demasiado grande (pausa)

        const segment = trackPoints.slice(i, j);
        const distDiff = segment[segment.length-1].dist - segment[0].dist;
        const timeDiff = times[j] - times[i];

        if (timeDiff <= 0 || distDiff <= 0) continue;

        // 1. Filtro de Velocidad Media
        const avgSpeed = distDiff / timeDiff; // m/s
        if (avgSpeed < MIN_SPEED_MPS) continue; // Caminando o parado

        // 2. Filtro de Estabilidad Cardíaca
        const hrs = segment.map(p => p.hr).filter(h => h > 0);
        if (hrs.length < 200) continue; // Pocos datos de pulso

        const avgHr = hrs.reduce((a,b) => a+b, 0) / hrs.length;
        
        // Cálculo de Desviación Estándar
        const variance = hrs.reduce((a,b) => a + Math.pow(b - avgHr, 2), 0) / hrs.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev > MAX_HR_STD_DEV) continue; // Pulso inestable (intervalos o terreno variable)

        // 3. Filtro de Intensidad (Zona Aeróbica Estable)
        const intensity = (avgHr - restHr) / hrReserve;
        if (intensity < MIN_INTENSITY || intensity > MAX_INTENSITY) continue;

        // 4. Filtro de Pendiente (Grade)
        const eleDiff = segment[segment.length-1].altitude - segment[0].altitude;
        let grade = eleDiff / distDiff;
        if (isNaN(grade)) grade = 0;

        // La fórmula ACSM para correr es válida para pendientes moderadas.
        // Descartamos pendientes extremas que alteran la economía de carrera.
        if (grade < -0.02 || grade > 0.06) continue; 

        // 5. Cálculo ACSM
        // VO2 (ml/kg/min) = 3.5 + 0.2*Speed(m/min) + 0.9*Speed(m/min)*Grade
        const speedMmin = avgSpeed * 60;
        const vo2Cost = 3.5 + (0.2 * speedMmin) + (0.9 * speedMmin * grade);
        
        // Extrapolación a Máximo
        const vo2MaxEst = vo2Cost / intensity;

        // Filtro de cordura (Rango humano atlético)
        if (vo2MaxEst > 25 && vo2MaxEst < 90) {
            validSegments.push(vo2MaxEst);
        }
    }

    if (validSegments.length === 0) return 0;
    
    // Retornamos el mejor segmento encontrado en la sesión
    return Math.max(...validSegments);
};

// --- GLOBAL VO2 MAX AGGREGATION ---
const calculateGlobalVo2Max = (sessions: Session[]): number => {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    // 1. Filtrar: Running/Trail, últimos 90 días, valor válido
    const validSessions = sessions.filter(s => {
        const isRunning = s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING';
        const age = now - new Date(s.startTime).getTime();
        return isRunning && age < NINETY_DAYS_MS && s.acsmVo2Max > 0;
    });

    if (validSessions.length === 0) return 0;

    // 2. Obtener valores y ordenar descendente (Mejores registros)
    const values = validSessions.map(s => ({
        vo2: s.acsmVo2Max,
        startTime: new Date(s.startTime).getTime()
    })).sort((a, b) => b.vo2 - a.vo2);

    // 3. Quedarse con los 5 mejores
    const top5 = values.slice(0, 5);
    
    if (top5.length === 0) return 0;

    // 4. Media Ponderada por Recencia
    let totalVo2 = 0;
    let totalWeight = 0;

    top5.forEach(v => {
        const age = now - v.startTime;
        let weight = 0;
        
        if (age <= TWO_WEEKS_MS) {
            weight = 1.0; // Peso completo para últimas 2 semanas
        } else {
            // Decaimiento lineal del peso desde día 14 (1.0) hasta día 90 (0.2)
            const progress = (age - TWO_WEEKS_MS) / (NINETY_DAYS_MS - TWO_WEEKS_MS);
            weight = Math.max(0.2, 1.0 - (progress * 0.8));
        }
        
        totalVo2 += v.vo2 * weight;
        totalWeight += weight;
    });

    return totalWeight > 0 ? (totalVo2 / totalWeight) : 0;
};

// Mock Data
const generateMockHistory = (): Session[] => {
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
    for(let j=0; j<count; j+=60) {
        points.push({lat:0, lon:0, timestamp: new Date(date.getTime() + j*1000).toISOString(), hr: avgHr, speed: avgSpeed, altitude: 100, dist: j*3});
    }

    sessions.push({
      id: `mock-${i}`, name: generateSessionName(sport, startTime, distMeters), startTime: startTime,
      duration: durationMins * 60, distance: distMeters, sport: sport, avgHr: Math.round(avgHr),
      maxHr: 190, calories: durationMins * 10,
      totalElevationGain: 150, avgCadence: 85, vam6min: 12, best20minSpeed: 11, acsmVo2Max: 45, trackPoints: points,
      trimp: Math.round(durationMins * (avgHr/190) * 1.5), 
      climbScore: 2
    });
  }
  return sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
};

// --- Parsers ---
const DEFAULT_MAX_HR = 190;
const DEFAULT_REST_HR = 60;

const parseCsv = (text: string, filename: string): Session => {
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
    if (timeIdx === -1) throw new Error("No se encontró columna de tiempo/fecha en el CSV");
    const trackPoints: TrackPoint[] = [];
    let startTimeStr = '';
    let maxHr = 0; let sumHr = 0; let validHrCount = 0; let cumDist = 0; let totalElevationGain = 0;
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
        if (hr > 0) { if (hr > maxHr) maxHr = hr; sumHr += hr; validHrCount++; }
        if (dist === 0 && i > 1) { if (speed > 0) cumDist += speed; } else { cumDist = dist > 0 ? dist : cumDist; }
        if (i > 1) {
            const prevAlt = trackPoints[trackPoints.length - 1].altitude;
            const diff = alt - prevAlt;
            if (diff > 0.3 && diff < 50) { // Filtro de ruido y picos irreales
                totalElevationGain += diff;
            }
        }
        trackPoints.push({ lat: val(latIdx), lon: val(lonIdx), timestamp, hr, speed, altitude: alt, dist: cumDist });
    }
    const duration = trackPoints.length > 1 ? (new Date(trackPoints[trackPoints.length-1].timestamp).getTime() - new Date(startTimeStr).getTime()) / 1000 : 0;
    
    // Calculate Advanced Metrics for CSV
    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
    // Use new ACSM calc
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
        avgCadence: 0, 
        vam6min: vam6min, 
        best20minSpeed: best20minSpeed, 
        acsmVo2Max: acsmVo2Max, 
        trackPoints, 
        trimp: calculateTRIMP(trackPoints, maxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), 
        climbScore: calculateClimbScore(totalElevationGain, cumDist) 
    };
};

const parsePolarJson = (json: any, filename: string): Session => {
  try {
    const exercise = json.exercises?.[0] || json; 
    const startTime = exercise.startTime || new Date().toISOString();
    const samples = exercise.samples || {};
    const route = samples.recordedRoute || [];
    const heartRates = samples.heartRate || [];
    const speeds = samples.speed || []; 
    const altitudes = samples.altitude || [];
    const trackPoints: TrackPoint[] = [];
    const len = Math.max(route.length, heartRates.length);
    let cumDist = 0; let sumHr = 0; let maxHr = 0; let totalAscent = 0;
    for (let i = 0; i < len; i++) {
        const routePt = route[i] || (i > 0 ? route[i-1] : { latitude: 0, longitude: 0, altitude: 0 });
        const hrVal = heartRates[i]?.value || heartRates[i] || 0;
        const speedVal = speeds[i]?.value || speeds[i] || 0;
        const altVal = altitudes[i]?.value || altitudes[i] || routePt.altitude || 0;
        if (i > 0) cumDist += (speedVal / 3.6); 
        if (hrVal > 0) sumHr += hrVal;
        if (hrVal > maxHr) maxHr = hrVal;
        if (i > 0) { 
            const prevAlt = trackPoints[i-1].altitude; 
            const diff = altVal - prevAlt;
            if (diff > 0.3 && diff < 50) totalAscent += diff; 
        }
        trackPoints.push({ lat: routePt.latitude || 0, lon: routePt.longitude || 0, timestamp:  new Date(new Date(startTime).getTime() + i * 1000).toISOString(), hr: hrVal, speed: speedVal, altitude: altVal, dist: cumDist });
    }
    if (trackPoints.length === 0) { return { id: `polar-stub`, name: 'Polar Import', startTime: new Date().toISOString(), duration: 0, distance: 0, sport: 'OTHER', avgHr: 0, maxHr: 0, calories: 0, totalElevationGain: 0, avgCadence: 0, vam6min: 0, best20minSpeed: 0, acsmVo2Max: 0, trackPoints: [], trimp: 0, climbScore: 0 }; }
    const sport = exercise.sport || 'RUNNING'; const distance = exercise.distance || cumDist; const finalMaxHr = exercise.heartRate?.maximum || maxHr;
    
    // Calculate Advanced Metrics for Polar
    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
    // Use new ACSM calc
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
        avgCadence: 0, 
        vam6min: vam6min, 
        best20minSpeed: best20minSpeed, 
        acsmVo2Max: acsmVo2Max, 
        trackPoints: trackPoints, 
        trimp: calculateTRIMP(trackPoints, finalMaxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), 
        climbScore: calculateClimbScore(totalAscent, distance) 
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

const parseFitData = (arrayBuffer: ArrayBuffer, filename: string): Promise<Session> => {
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
                    const getCoord = (val: any) => { if (val === undefined || val === null) return null; if (Math.abs(val) > 180) return val * (180 / 2147483648); return val; };
                    const validRecords = records.map((r: any) => { const lat = getCoord(r.position_lat) ?? getCoord(r.lat) ?? getCoord(r.latitude) ?? 0; const lon = getCoord(r.position_long) ?? getCoord(r.lon) ?? getCoord(r.longitude) ?? 0; let rawSpeed = r.enhanced_speed ?? r.speed ?? 0; if (rawSpeed > 200) rawSpeed = (rawSpeed / 1000) * 3.6; return { ...r, timestamp: convertFitTimestamp(r.timestamp), lat, lon, speed: rawSpeed }; }).filter(r => !isNaN(new Date(r.timestamp).getTime())).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    if (validRecords.length === 0) { reject(new Error("Datos encontrados pero las fechas no son válidas.")); return; }
                    let calculatedDist = 0; let maxHr = 0; let hrSum = 0; let hrCount = 0; let totalAscent = 0; let cadenceSum = 0; let cadenceCount = 0; const trackPoints: TrackPoint[] = []; const lastRec = validRecords[validRecords.length-1]; const fileHasZeroDistance = (!lastRec.distance && !lastRec.total_distance) || (lastRec.distance < 100 && lastRec.total_distance < 100); const forceRecalc = fileHasZeroDistance && validRecords.some(r => r.lat !== 0);
                    for (let i = 0; i < validRecords.length; i++) {
                        const curr = validRecords[i]; const prev = i > 0 ? validRecords[i-1] : null; let dist = curr.total_distance !== undefined ? curr.total_distance : curr.distance; const hasCoords = curr.lat !== 0 && curr.lon !== 0 && prev && prev.lat !== 0 && prev.lon !== 0;
                        if (forceRecalc && hasCoords) { calculatedDist += getDistanceFromLatLonInMeters(prev.lat, prev.lon, curr.lat, curr.lon); dist = calculatedDist; } else if ((dist === undefined || dist === null) && hasCoords) { calculatedDist += getDistanceFromLatLonInMeters(prev.lat, prev.lon, curr.lat, curr.lon); dist = calculatedDist; } else if (dist !== undefined && dist !== null) { calculatedDist = dist; } else { dist = calculatedDist; }
                        let speed = curr.speed; if ((speed === 0 || speed === undefined) && prev) { const t1 = new Date(prev.timestamp).getTime(); const t2 = new Date(curr.timestamp).getTime(); const deltaSec = (t2 - t1) / 1000; const deltaDist = dist - (trackPoints[i-1]?.dist || 0); if (deltaSec > 0 && deltaDist >= 0) { const mps = deltaDist / deltaSec; speed = mps * 3.6; if (speed > 120) speed = trackPoints[i-1]?.speed || 0; } }
                        const hr = curr.heart_rate || curr.heart_rate_bpm || 0; if (hr > 0) { if (hr > maxHr) maxHr = hr; hrSum += hr; hrCount++; }
                        let alt = curr.enhanced_altitude ?? curr.altitude ?? 0; 
                        if (prev) { 
                            const prevAlt = trackPoints[i-1].altitude; 
                            const diff = alt - prevAlt;
                            if (diff > 0.3 && diff < 30) { 
                                totalAscent += diff; 
                            } 
                        }
                        const cad = curr.cadence || 0; if (cad > 0) { cadenceSum += cad; cadenceCount++; }
                        trackPoints.push({ lat: curr.lat || 0, lon: curr.lon || 0, timestamp: curr.timestamp, hr: hr, speed: speed || 0, altitude: alt, cadence: cad, dist: dist || 0 });
                    }
                    let sport = 'OTHER'; if (sessionData?.sport) sport = sessionData.sport.toUpperCase();
                    
                    // Use new ACSM calc
                    let acsmVo2Max = calculateACSMVo2(trackPoints, maxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR);
                    const vam6min = calculateSlidingWindowMaxSpeed(trackPoints, 360); const best20minSpeed = calculateSlidingWindowMaxSpeed(trackPoints, 1200);
                    if (acsmVo2Max === 0 && vam6min > 0) acsmVo2Max = 3.5 * (vam6min * 3.6);

                    // Reordered to fix block-scoped variable 'duration' used before declaration
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
                    if (!calculatedCalories) { const findCaloriesRecursively = (obj: any): number | undefined => { if (!obj || typeof obj !== 'object') return undefined; if (obj.total_calories && Number(obj.total_calories) > 0) return Number(obj.total_calories); if (obj.calories && Number(obj.calories) > 0) return Number(obj.calories); for (const key of Object.keys(obj)) { if (key.toLowerCase().includes('calor') && typeof obj[key] === 'number' && obj[key] > 0) { return Number(obj[key]); } } for (const key in obj) { if (key === 'records' || key === 'points' || key === 'trackPoints' || Array.isArray(obj[key]) && obj[key].length > 100) continue; const result = findCaloriesRecursively(obj[key]); if (result) return result; } return undefined; }; const found = findCaloriesRecursively(data); if (found) calculatedCalories = found; }
                    if (!calculatedCalories) { calculatedCalories = Math.round(duration / 60 * 10); }

                    const avgHr = sessionData?.avg_heart_rate || (hrCount > 0 ? Math.round(hrSum / hrCount) : 0); const finalMaxHr = sessionData?.max_heart_rate || maxHr;
                    
                    // Mejorar detección de ascenso: Preferir valor de sesión si es > 0, si no, usar el calculado.
                    // Algunos dispositivos usan total_ascent, otros total_elevation_gain
                    const sessionAscent = sessionData?.total_ascent ?? sessionData?.total_elevation_gain ?? 0;
                    const finalAscent = (sessionAscent > 0) ? sessionAscent : Math.round(totalAscent);
                    
                    const finalAvgCadence = sessionData?.avg_cadence ?? (cadenceCount > 0 ? Math.round(cadenceSum / cadenceCount) : 0);
                    
                    const session: Session = { id: `session-${sport}-${new Date(startTime).getTime()}`, name: generateSessionName(sport, startTime, totalDistance), startTime: startTime, duration: duration, distance: totalDistance, sport: sport, avgHr: avgHr, maxHr: finalMaxHr, calories: calculatedCalories || 0, totalElevationGain: finalAscent, avgCadence: finalAvgCadence, vam6min: vam6min || 0, best20minSpeed: best20minSpeed || 0, acsmVo2Max: acsmVo2Max || 0, trackPoints: trackPoints, trimp: calculateTRIMP(trackPoints, finalMaxHr || DEFAULT_MAX_HR, DEFAULT_REST_HR), climbScore: calculateClimbScore(finalAscent, totalDistance) };
                    resolve(session);
                } catch (innerErr: any) { reject(new Error(`Estructura interna desconocida: ${innerErr.message}`)); }
            });
        } catch (outerErr: any) { reject(new Error(`Error inicial: ${outerErr.message}`)); }
    });
};

// --- Helper Components & Icons ---
const Icons = {
    Run: () => <i className="fa-solid fa-person-running text-[#34C759] text-xl"></i>,
    Bike: () => <i className="fa-solid fa-bicycle text-blue-500 text-xl"></i>,
    Swim: () => <i className="fa-solid fa-person-swimming text-cyan-500 text-xl"></i>,
    Clock: () => <i className="fa-regular fa-clock text-yellow-300"></i>,
    Flame: () => <i className="fa-solid fa-fire text-orange-400"></i>,
    Heart: () => <i className="fa-solid fa-heart text-red-500"></i>,
    Map: () => <i className="fa-solid fa-map-location-dot text-purple-400"></i>,
    Upload: () => <i className="fa-solid fa-cloud-arrow-up text-sky-400"></i>,
    Trophy: () => <i className="fa-solid fa-trophy text-yellow-500"></i>,
    Trend: () => <i className="fa-solid fa-arrow-trend-up text-emerald-400"></i>,
    Lungs: () => <i className="fa-solid fa-lungs text-pink-400"></i>,
    Warning: () => <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>,
    Trash: () => <i className="fa-solid fa-trash"></i>,
    Clear: () => <i className="fa-solid fa-eraser"></i>,
    Save: () => <i className="fa-solid fa-floppy-disk text-indigo-400"></i>,
    Download: () => <i className="fa-solid fa-file-export text-blue-400"></i>,
    Import: () => <i className="fa-solid fa-file-import text-green-400"></i>,
    Mountain: () => <i className="fa-solid fa-mountain text-emerald-400"></i>,
    Gauge: () => <i className="fa-solid fa-gauge-high text-red-400"></i>,
    Ruler: () => <i className="fa-solid fa-ruler text-blue-400"></i>,
    Search: () => <i className="fa-solid fa-magnifying-glass text-gray-400"></i>,
    Calendar: () => <i className="fa-solid fa-calendar-days text-blue-300"></i>,
    ChevronDown: () => <i className="fa-solid fa-chevron-down text-gray-400"></i>,
    ChevronRight: () => <i className="fa-solid fa-chevron-right text-gray-400"></i>,
    ChevronLeft: () => <i className="fa-solid fa-chevron-left text-gray-400"></i>,
    Info: () => <i className="fa-solid fa-circle-info text-blue-400"></i>,
    Stop: () => <i className="fa-solid fa-stop text-red-500"></i>,
    Folder: () => <i className="fa-solid fa-folder-open text-yellow-200"></i>,
    Check: () => <i className="fa-solid fa-check text-green-500"></i>,
    XMark: () => <i className="fa-solid fa-xmark text-gray-400"></i>,
    Pen: () => <i className="fa-solid fa-pen text-gray-400"></i>,
    User: () => <i className="fa-solid fa-user text-blue-400"></i>,
    Bolt: () => <i className="fa-solid fa-bolt text-yellow-400"></i>,
    Chart: () => <i className="fa-solid fa-chart-area text-purple-400"></i>,
    List: () => <i className="fa-solid fa-list text-gray-300"></i>,
    ListCheck: () => <i className="fa-solid fa-list-check text-teal-400"></i>,
    Flag: () => <i className="fa-solid fa-flag-checkered text-gray-100"></i>,
    Square: () => <i className="fa-regular fa-square text-gray-500"></i>,
    SquareCheck: () => <i className="fa-solid fa-square-check text-[#34C759]"></i>,
    Battery: () => <i className="fa-solid fa-battery-half text-green-400"></i>,
    Medal: () => <i className="fa-solid fa-medal text-yellow-300"></i>
}

const getSportConfig = (sport: string) => {
    switch (sport) {
        case 'RUNNING': return { icon: <Icons.Run />, color: 'text-[#34C759]' };
        case 'CYCLING': return { icon: <Icons.Bike />, color: 'text-blue-500' };
        case 'SWIMMING': return { icon: <Icons.Swim />, color: 'text-cyan-500' };
        case 'TRAIL_RUNNING': return { icon: <Icons.Mountain />, color: 'text-green-700' };
        case 'HIIT': return { icon: <Icons.Bolt />, color: 'text-orange-500' };
        case 'WALKING': return { icon: <Icons.User />, color: 'text-yellow-500' };
        case 'HIKING': return { icon: <Icons.Map />, color: 'text-brown-500' };
        default: return { icon: <Icons.Square />, color: 'text-gray-400' };
    }
};

const NotificationToast: React.FC<{ notification: Notification, onClose: () => void }> = ({ notification, onClose }) => {
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

// --- Updated Text Content ---
const TOOLTIP_CONTENT: Record<string, { title: string; content: string }> = {
    vam: {
        title: "VAM (Test Billat)",
        content: "Velocidad Aeróbica Máxima (6min). Predice VO2 Max y ritmos de series."
    },
    zones: {
        title: "Umbrales & Zonas",
        content: "Calculado con fórmula Karvonen (Frecuencia Cardíaca Reserva)."
    },
    vo2: {
        title: "VO2 Max Atleta",
        content: "Media ponderada de los 5 mejores picos de 5 minutos (estado estable) en los últimos 90 días."
    },
    trimp: {
        title: "TRIMP (Impulso de Entrenamiento)",
        content: "Cuantifica la carga total basada en duración e intensidad cardíaca."
    },
    riegel: {
        title: "Pronóstico (Riegel)",
        content: "Estimación basada en tus mejores marcas recientes y factor de fatiga."
    },
    polarized: {
        title: "Entrenamiento Polarizado (80/20)",
        content: "Distribución binaria: 80% Baja Intensidad (Z1-Z2) vs 20% Alta Intensidad (Z3-Z5)."
    },
    recovery: {
        title: "Tiempo de Recuperación",
        content: "Horas estimadas para supercompensación completa según carga TRIMP."
    },
    efficiency: {
        title: "Eficiencia Aeróbica",
        content: "Ratio: Velocidad / FC. Un número más alto indica mayor eficiencia (más velocidad a mismas pulsaciones)."
    },
    power: {
        title: "Potencia Estimada",
        content: "Vatios teóricos en llano según peso y velocidad (Coste Energético)."
    }
};

// --- New InfoTooltip Component (Replaces FormulaModal & InfoButton) ---
const InfoTooltip = ({ type }: { type: string }) => {
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
                    className="fixed z-[9999] w-48 p-3 bg-[#1C1C1E] border border-white/20 rounded-xl shadow-2xl backdrop-blur-md pointer-events-none animate-fade-in"
                    style={{ left: coords.x, top: coords.y, transform: 'translate(-50%, -100%) translateY(-10px)' }}
                >
                    <h5 className="text-[#34C759] font-bold text-[10px] uppercase mb-1">{data.title}</h5>
                    <p className="text-[10px] text-gray-300 leading-tight">{data.content}</p>
                    <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-[#1C1C1E] border-r border-b border-white/20 transform rotate-45"></div>
                </div>,
                document.body
            )}
        </>
    );
};

const ProfileModal = ({ isOpen, onClose, profile, onSave }: any) => {
    const [localProfile, setLocalProfile] = useState(profile);
    useEffect(() => { setLocalProfile(profile) }, [profile, isOpen]);
    const handleChange = (field: string, val: any) => setLocalProfile((p: any) => ({ ...p, [field]: val }));
    
    // Zone Calc
    const fcr = localProfile.maxHr - localProfile.restHr;
    const z1 = Math.round(localProfile.restHr + (0.50 * fcr));
    const z2 = Math.round(localProfile.restHr + (0.60 * fcr));
    const z3 = Math.round(localProfile.restHr + (0.70 * fcr));
    const z4 = Math.round(localProfile.restHr + (0.80 * fcr));
    const z5 = Math.round(localProfile.restHr + (0.90 * fcr));

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-[#1C1C1E] border border-white/10 rounded-3xl p-6 max-w-md w-full relative shadow-2xl" onClick={e => e.stopPropagation()}>
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
                         <h4 className="text-sm font-semibold text-[#34C759] mb-3">Zonas Cardíacas (Karvonen)</h4>
                         <div className="grid grid-cols-2 gap-4 mb-4">
                            <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">FC Reposo</label><input type="number" value={localProfile.restHr} onChange={e => handleChange('restHr', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#34C759]" /></div>
                            <div><label className="text-xs text-gray-500 uppercase font-bold block mb-1">FC Máxima</label><input type="number" value={localProfile.maxHr} onChange={e => handleChange('maxHr', Number(e.target.value))} className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white outline-none focus:border-[#34C759]" /></div>
                        </div>
                        {/* Zone Table */}
                        <div className="bg-black/30 rounded-lg p-2 text-[10px]">
                            <div className="flex justify-between border-b border-white/5 pb-1 mb-1 font-bold text-gray-400"><span>Zona</span><span>Rango BPM</span><span>Intensidad</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-gray-400">Z1</span><span>{z1} - {z2}</span><span className="text-gray-500">Recuperación</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-blue-400">Z2</span><span>{z2} - {z3}</span><span className="text-blue-500">Aeróbico Base</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-green-400">Z3</span><span>{z3} - {z4}</span><span className="text-green-500">Ritmo Tempo</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-orange-400">Z4</span><span>{z4} - {z5}</span><span className="text-orange-500">Umbral</span></div>
                            <div className="flex justify-between py-0.5"><span className="text-red-400">Z5</span><span>&gt; {z5}</span><span className="text-red-500">VO2 Max</span></div>
                        </div>
                    </div>
                    <button onClick={() => onSave(localProfile)} className="w-full bg-[#007AFF] hover:bg-blue-600 text-white font-bold py-3 rounded-xl mt-4 transition-colors">Guardar Perfil</button>
                </div>
            </div>
        </div>
    );
};

const CalendarWidget = memo(({ sessions, selectedDate, onDateSelect }: { sessions: Session[], selectedDate: Date | null, onDateSelect: (d: Date | null) => void }) => {
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

const AdvancedAnalytics = ({ sessions, profile, onShowInfo }: { sessions: Session[], profile: UserProfile, onShowInfo: (t: string) => void }) => {
    const fcr = profile.maxHr - profile.restHr;
    const vt1_hr = Math.round(profile.restHr + (0.60 * fcr));
    const vt2_hr = Math.round(profile.restHr + (0.85 * fcr));
    
    const runSessions = sessions.filter(s => (s.sport === 'RUNNING' || s.sport === 'TRAIL_RUNNING') && s.distance > 0 && s.avgHr > 0);
    const last4Weeks = sessions.filter(s => (new Date().getTime() - new Date(s.startTime).getTime()) < 2419200000);
    
    // Metrics
    const maxVam = Math.max(...runSessions.map(s => s.vam6min || 0), 0);
    // Calcular VO2 Global usando la función ponderada
    const globalVo2Max = calculateGlobalVo2Max(sessions);
    
    const avgTrimp = last4Weeks.length > 0 ? Math.round(last4Weeks.reduce((a,b)=>a+(b.trimp||0),0) / last4Weeks.length) : 0;
    
    // Efficiency (Avg Speed m/s / Avg HR) * 1000 for readability
    const recentRuns = runSessions.slice(0, 10);
    const efficiency = recentRuns.length > 0 
        ? (recentRuns.reduce((acc, s) => acc + ((s.distance/s.duration) / s.avgHr), 0) / recentRuns.length * 10000).toFixed(1)
        : '--';

    // Power Estimate (Watts) = Weight * Speed(m/s) * 1.04 (Energy Cost Constant flat)
    const avgSpeedLastMonth = last4Weeks.filter(s=>s.sport==='RUNNING').reduce((acc, s) => acc + (s.distance/s.duration), 0) / (last4Weeks.filter(s=>s.sport==='RUNNING').length || 1);
    const estimatedPower = avgSpeedLastMonth > 0 ? Math.round(profile.weight * avgSpeedLastMonth * 1.04) : '--';

    const paceVam = maxVam > 0 ? formatPace(60 / maxVam) : '--';

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4 relative overflow-hidden">
             <div className="absolute right-0 top-0 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
             <div className="flex justify-between items-center mb-4 relative z-10"><h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Bolt /> <span className="ml-2">Analítica Avanzada de Rendimiento</span></h4></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10">
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-[#007AFF] uppercase tracking-wide mb-2 border-b border-[#007AFF]/30 pb-1 flex items-center justify-between">Umbrales <InfoTooltip type="zones" /></h5>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">VT1 (Aeróbico)</span><span className="text-lg font-mono font-bold">{vt1_hr} <span className="text-[10px] text-gray-500">bpm</span></span></div>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">VT2 (Anaeróbico)</span><span className="text-lg font-mono font-bold">{vt2_hr} <span className="text-[10px] text-gray-500">bpm</span></span></div>
                </div>
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-[#34C759] uppercase tracking-wide mb-2 border-b border-[#34C759]/30 pb-1 flex items-center justify-between">Potencia & Ritmo <InfoTooltip type="vam" /></h5>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">VAM (6 min)</span><div className="text-right"><p className="text-lg font-mono font-bold text-[#34C759]">{paceVam} <span className="text-[10px] text-gray-500">/km</span></p></div></div>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">Potencia Est.</span><div className="text-right"><p className="text-lg font-mono font-bold text-yellow-500">{estimatedPower} <span className="text-[10px] text-gray-500">w</span></p></div> <InfoTooltip type="power" /></div>
                </div>
                <div className="space-y-3">
                    <h5 className="text-xs font-bold text-purple-500 uppercase tracking-wide mb-2 border-b border-purple-500/30 pb-1 flex items-center justify-between">Carga & Eficiencia <InfoTooltip type="trimp" /></h5>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">TRIMP (4 sem)</span><span className="text-lg font-mono font-bold text-white">{avgTrimp}</span></div>
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg"><span className="text-xs text-gray-400">Eficiencia (Ratio)</span><span className="text-lg font-mono font-bold text-blue-300">{efficiency}</span> <InfoTooltip type="efficiency" /></div>
                </div>
                 <div className="space-y-3">
                    <h5 className="text-xs font-bold text-pink-500 uppercase tracking-wide mb-2 border-b border-pink-500/30 pb-1 flex items-center justify-between">VO2Max <InfoTooltip type="vo2" /></h5>
                    <div className="bg-white/5 p-2 rounded-lg h-full flex flex-col justify-center">
                        <p className="text-[10px] text-gray-400 mb-1">VO2 Max (Global)</p>
                        <p className="text-2xl font-bold font-mono text-pink-500">{globalVo2Max > 0 ? globalVo2Max.toFixed(1) : '--'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RecoveryAdvisor = ({ sessions, onShowInfo }: { sessions: Session[], onShowInfo: (t: string) => void }) => {
    if (sessions.length === 0) return null;
    const lastSession = sessions[0]; 
    const hoursSince = (new Date().getTime() - new Date(lastSession.startTime).getTime()) / 3600000;
    
    // Simple logic: Base 12h + (TRIMP * 0.2) hours
    let neededHours = 12 + ((lastSession.trimp || 50) * 0.25);
    if (neededHours > 72) neededHours = 72;
    
    const remaining = Math.max(0, Math.round(neededHours - hoursSince));
    const percentage = Math.max(0, Math.min(100, 100 - (remaining / neededHours * 100)));
    
    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-2 flex flex-col justify-between relative overflow-hidden">
            <div className="flex justify-between items-start mb-2 z-10">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Battery /> <span className="ml-2">Asesor de Recuperación</span></h4>
                <InfoTooltip type="recovery" />
            </div>
            <div className="z-10">
                <p className="text-3xl font-bold text-white mb-1">{remaining} <span className="text-sm font-normal text-gray-500">horas restantes</span></p>
                <div className="w-full bg-white/10 h-2 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full transition-all duration-1000 ${percentage < 30 ? 'bg-red-500' : (percentage < 70 ? 'bg-yellow-500' : 'bg-green-500')}`} style={{ width: `${percentage}%` }}></div>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">{percentage === 100 ? 'Listo para entrenar fuerte.' : 'Se recomienda entrenamiento suave o descanso.'}</p>
            </div>
        </div>
    );
};

const IntensityDistribution = ({ sessions, profile, onShowInfo }: { sessions: Session[], profile: UserProfile, onShowInfo: (t: string) => void }) => {
    // Determine zones
    const fcr = profile.maxHr - profile.restHr;
    const z2_limit = profile.restHr + (0.70 * fcr); // Top of Z2
    
    // Analyze all trackpoints from last 30 days
    let low = 0, high = 0;
    const recent = sessions.filter(s => (new Date().getTime() - new Date(s.startTime).getTime()) < 2592000000); // 30d
    
    recent.forEach(s => {
        s.trackPoints.forEach(p => {
            if (p.hr > 0) {
                // Strictly polarized: Z1+Z2 is Low, Z3+Z4+Z5 is High
                if (p.hr <= z2_limit) low++;
                else high++;
            }
        });
    });
    
    const total = low + high || 1;
    const pLow = Math.round(low/total*100);
    const pHigh = Math.round(high/total*100);

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-2 flex flex-col relative">
             <div className="flex justify-between items-start mb-4">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Chart /> <span className="ml-2">Distribución (80/20)</span></h4>
                <InfoTooltip type="polarized" />
            </div>
            <div className="flex-1 flex items-end space-x-2 px-4">
                <div className="flex-1 flex flex-col items-center">
                    <div className="w-full bg-green-500/80 rounded-t-lg transition-all relative group" style={{ height: `${Math.max(10, pLow)}%` }}>
                        <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-green-400">{pLow}%</span>
                    </div>
                    <span className="text-[10px] text-gray-500 mt-2 font-bold uppercase">Baja (Z1-Z2)</span>
                </div>
                <div className="flex-1 flex flex-col items-center">
                    <div className="w-full bg-red-500/80 rounded-t-lg transition-all relative" style={{ height: `${Math.max(10, pHigh)}%` }}>
                         <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-bold text-red-400">{pHigh}%</span>
                    </div>
                    <span className="text-[10px] text-gray-500 mt-2 font-bold uppercase">Alta (Z3+)</span>
                </div>
            </div>
        </div>
    );
};

const GlobalHeatmap = memo(({ sessions }: { sessions: Session[] }) => {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        if (!mapRef.current) {
            mapRef.current = L.map(containerRef.current, { zoomControl: true, attributionControl: false }).setView([40, -3], 5);
            // Using CartoDB Dark Matter for better heatmap visibility
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '', subdomains: 'abcd', maxZoom: 19
            }).addTo(mapRef.current);
        }

        const validSessions = sessions.filter(s => s.trackPoints.length > 0);
        if (validSessions.length === 0) return;

        // Render all tracks with low opacity
        const layerGroup = L.layerGroup().addTo(mapRef.current);
        
        // Calculate bounds to center map
        const bounds = L.latLngBounds([]);
        let hasValidPoints = false;
        
        validSessions.forEach(s => {
            // Sampling points to improve performance for global heatmap
            // FIX: Filter 0,0 points aggressively to prevent "rays" to Null Island
            const points = s.trackPoints
                .filter((_, i) => i % 5 === 0 && _.lat && _.lon && Math.abs(_.lat) > 0.1 && Math.abs(_.lon) > 0.1)
                .map(p => [p.lat, p.lon] as [number, number]);
                
            if (points.length > 0) {
                const poly = L.polyline(points, { 
                    color: '#39FF14', // Neon Green / Fluorescent
                    weight: 2, 
                    opacity: 0.3 
                });

                poly.bindTooltip(`${s.name} (${new Date(s.startTime).toLocaleDateString()})`, {
                    sticky: true,
                    direction: 'top',
                    className: 'bg-black text-white border-0'
                });

                poly.addTo(layerGroup);
                
                // Add track bounds to global bounds
                bounds.extend(poly.getBounds());
                hasValidPoints = true;
            }
        });

        if (hasValidPoints && bounds.isValid()) {
            mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [sessions]);

    return <div ref={containerRef} className="w-full h-[600px] rounded-3xl overflow-hidden border border-white/10 shadow-2xl z-0" />;
});

const PersonalRecords = ({ sessions }: { sessions: Session[] }) => {
    // Simple PR estimator based on actual sessions average speed
    // Ideally requires sliding window on trackpoints, simplified here for performance
    const getBest = (distKm: number) => {
        const matches = sessions.filter(s => s.sport === 'RUNNING' && s.distance >= distKm * 1000);
        if (matches.length === 0) return null;
        // Sort by speed (distance/duration) descending
        const best = matches.sort((a,b) => (b.distance/b.duration) - (a.distance/a.duration))[0];
        // Calculate estimated time for exactly that distance at that average pace
        const speed = best.distance / best.duration;
        const timeSec = (distKm * 1000) / speed;
        return { time: timeSec, date: best.startTime };
    };

    const prs = [
        { label: '1 km', data: getBest(1) },
        { label: '5 km', data: getBest(5) },
        { label: '10 km', data: getBest(10) },
        { label: '21 km', data: getBest(21.097) }
    ];

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4">
            <h4 className="text-sm font-semibold text-gray-400 flex items-center mb-4"><Icons.Medal /> <span className="ml-2">Mejores Marcas (Estimadas)</span></h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {prs.map(pr => (
                    <div key={pr.label} className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <p className="text-xs text-gray-500 uppercase font-bold mb-1">{pr.label}</p>
                        {pr.data ? (
                            <>
                                <p className="text-xl font-bold font-mono text-white">{formatTime(pr.data.time)}</p>
                                <p className="text-[9px] text-gray-600 mt-1">{new Date(pr.data.date).toLocaleDateString()}</p>
                            </>
                        ) : <p className="text-sm text-gray-600">--:--</p>}
                    </div>
                ))}
            </div>
        </div>
    );
};

const FitnessTrendChart = memo(({ sessions }: { sessions: Session[] }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [showInfo, setShowInfo] = useState(false);

    const trendData = useMemo(() => {
        if (sessions.length === 0) return [];
        const sorted = [...sessions].sort((a,b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        const start = new Date(sorted[0].startTime);
        const end = new Date();
        const daily: DailyFitness[] = [];
        let ctl = 0;
        let atl = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dayStr = d.toISOString().split('T')[0];
            const daysSessions = sorted.filter(s => s.startTime.startsWith(dayStr));
            const dayTrimp = daysSessions.reduce((sum, s) => sum + (s.trimp || 0), 0);
            ctl = ctl + (dayTrimp - ctl) * (1/42);
            atl = atl + (dayTrimp - atl) * (1/7);
            daily.push({ date: dayStr, ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(ctl - atl), trimp: dayTrimp });
        }
        return daily;
    }, [sessions]);

    if (trendData.length < 10) return null;

    const dataSlice = trendData.slice(-90);
    const current = dataSlice[dataSlice.length-1];
    const prevMonth = dataSlice.length > 30 ? dataSlice[dataSlice.length-30] : dataSlice[0];

    const ctlTrend = current.ctl - prevMonth.ctl;
    const trendIcon = ctlTrend > 1 ? <Icons.Trend /> : (ctlTrend < -1 ? <span className="rotate-180 inline-block"><Icons.Trend /></span> : <span>=</span>);
    const trendColor = ctlTrend > 1 ? "text-green-500" : (ctlTrend < -1 ? "text-red-500" : "text-gray-500");

    const getTrainingStatus = (tsb: number, ctlTrend: number) => {
        if (tsb < -30) return { label: "Sobrecarga", color: "text-red-500", desc: "Riesgo alto de lesión. Descansa." };
        if (tsb < -10) return { label: "Productivo", color: "text-green-500", desc: "Construyendo forma eficazmente." };
        if (tsb < 5) return { label: "Mantenimiento", color: "text-yellow-500", desc: "Carga estable." };
        if (tsb < 25) return { label: "En Forma", color: "text-blue-500", desc: "Listo para competir." };
        return { label: "Recuperación", color: "text-purple-500", desc: "Pérdida de forma por descanso." };
    };

    const status = getTrainingStatus(current.tsb, ctlTrend);

    const width = 1000; 
    const height = 400;
    const padding = 30; 

    // --- ZEPP STYLE SCALING LOGIC ---
    const avgCTL = dataSlice.reduce((sum, d) => sum + d.ctl, 0) / dataSlice.length;
    const effectiveValues = dataSlice.flatMap(d => [d.ctl, d.atl, avgCTL + d.tsb]);
    const maxData = Math.max(...effectiveValues);
    const minData = Math.min(...effectiveValues);
    const range = (maxData - minData) || 10;
    const maxVal = maxData + (range * 0.05); 
    const minVal = minData - (range * 0.50);
    const finalRange = maxVal - minVal;

    const getX = (i: number) => (i / (dataSlice.length - 1)) * width;
    const getY = (val: number) => height - padding - (((val - minVal) / finalRange) * (height - (padding * 2)));
    const zeroY = getY(avgCTL);

    const pathCTL = dataSlice.map((d, i) => `${getX(i)},${getY(d.ctl)}`).join(' L');
    const pathATL = dataSlice.map((d, i) => `${getX(i)},${getY(d.atl)}`).join(' L');

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4 flex flex-col relative overflow-hidden group">
            <div className="flex justify-between items-start mb-4 z-20">
                <div className="flex space-x-8">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Chart /> <span className="ml-2">Evolución de Forma</span></h4>
                        <div className="flex space-x-4 text-xs font-mono mt-1">
                            <span className="text-blue-500 font-bold">Fitness: {current.ctl}</span>
                            <span className="text-pink-500 font-bold">Fatiga: {current.atl}</span>
                            <span className={current.tsb >= 0 ? "text-green-500 font-bold" : "text-red-500 font-bold"}>Forma: {current.tsb}</span>
                        </div>
                    </div>
                    <div className="hidden md:block pl-6 border-l border-white/10">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Estado Actual</p>
                        <p className={`text-xl font-bold ${status.color}`}>{status.label}</p>
                        <p className="text-[10px] text-gray-400">{status.desc}</p>
                    </div>
                    <div className="hidden md:block pl-6 border-l border-white/10">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Tendencia (30d)</p>
                        <p className={`text-xl font-bold ${trendColor} flex items-center`}>{trendIcon} <span className="ml-2">{Math.abs(ctlTrend)} pts</span></p>
                    </div>
                </div>
                <InfoTooltip type="trimp" />
            </div>

            <div className="flex-1 relative w-full z-10 cursor-crosshair h-64">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="4,4" />
                    {dataSlice.map((d, i) => {
                        const barX = getX(i);
                        const barTopY = getY(avgCTL + d.tsb);
                        const barH = Math.abs(barTopY - zeroY);
                        const finalH = Math.max(2, barH);
                        const startY = d.tsb >= 0 ? barTopY : zeroY;
                        return (<rect key={i} x={barX - (width/dataSlice.length)/2 * 0.9} y={startY} width={(width/dataSlice.length) * 0.9} height={finalH} fill={d.tsb >= 0 ? '#34C759' : '#FF3B30'} opacity={hoverIndex === i ? 1 : 0.6} rx="2" />);
                    })}
                    <path d={`M${pathCTL}`} fill="none" stroke="#007AFF" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <path d={`M${pathATL}`} fill="none" stroke="#FF2D55" strokeWidth="1.5" strokeDasharray="4,4" vectorEffect="non-scaling-stroke" />
                    {hoverIndex !== null && (<line x1={getX(hoverIndex)} y1={padding} x2={getX(hoverIndex)} y2={height - padding} stroke="white" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />)}
                    {dataSlice.map((_, i) => (<rect key={`touch-${i}`} x={getX(i) - (width/dataSlice.length)/2} y={0} width={width/dataSlice.length} height={height} fill="transparent" onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)} />))}
                </svg>
                {hoverIndex !== null && trendData[trendData.length - 90 + hoverIndex] && (
                    <div className="absolute top-0 pointer-events-none bg-black/80 backdrop-blur border border-white/20 p-2 rounded-lg shadow-xl text-[10px] space-y-1 z-30 whitespace-nowrap" style={{ left: `${(hoverIndex / (dataSlice.length - 1)) * 100}%`, transform: `translateX(${hoverIndex > dataSlice.length / 2 ? '-100%' : '0'}) translateX(${hoverIndex > dataSlice.length / 2 ? '-10px' : '10px'})` }}>
                        <p className="text-gray-400 font-bold border-b border-white/10 pb-1 mb-1">{new Date(dataSlice[hoverIndex].date).toLocaleDateString()}</p>
                        <p className="text-blue-400 font-bold">Fitness: {dataSlice[hoverIndex].ctl}</p>
                        <p className="text-pink-400 font-bold">Fatiga: {dataSlice[hoverIndex].atl}</p>
                        <p className={dataSlice[hoverIndex].tsb >= 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>Forma: {dataSlice[hoverIndex].tsb}</p>
                    </div>
                )}
            </div>
            <div className="flex justify-between text-[9px] text-gray-500 mt-2 border-t border-white/5 pt-2"><span>Hace 90 días</span><span>Hoy</span></div>
        </div>
    );
});

const calculateIndividualizedK = (sessions: Session[]): number => {
    const valid = sessions.filter(s => s.distance > 3000 && s.duration > 600); // >3km, >10min
    if (valid.length < 2) return 1.06;
    
    // Find best performance (max speed) for roughly 5k (3-7k) and 10k+ (8k+)
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
    // Clamp reasonable values for humans
    return Math.max(1.01, Math.min(1.2, k));
};

const RacePredictor = ({ sessions, onShowInfo }: { sessions: Session[], onShowInfo: (t:string) => void }) => {
    const runSessions = useMemo(() => sessions.filter(s => s.sport === 'RUNNING' && s.distance > 0), [sessions]);
    const k = useMemo(() => calculateIndividualizedK(runSessions), [runSessions]);
    if (runSessions.length === 0) return null;
    const bestSession = runSessions.reduce((prev, current) => (current.distance / current.duration) > (prev.distance / prev.duration) ? current : prev);
    
    const predict = (targetDistKm: number) => {
        const baseDistKm = bestSession.distance / 1000; 
        const baseTimeSec = bestSession.duration;
        const predictedTimeSec = baseTimeSec * Math.pow((targetDistKm / baseDistKm), k);
        const h = Math.floor(predictedTimeSec / 3600); const m = Math.floor((predictedTimeSec % 3600) / 60);
        const paceSec = predictedTimeSec / targetDistKm;
        return {
            timeStr: `${h > 0 ? h + 'h ' : ''}${m}m`,
            paceStr: formatPace(paceSec / 60)
        };
    };

    return (
        <div className="glass-panel p-5 rounded-3xl col-span-2 md:col-span-4">
            <div className="flex justify-between items-center mb-4 relative z-10">
                <h4 className="text-sm font-semibold text-gray-400 flex items-center"><Icons.Trophy /> <span className="ml-2">Pronóstico Individualizado</span></h4>
                <div className="flex items-center space-x-2">
                    <span className="text-[10px] bg-white/10 px-2 py-1 rounded text-gray-400">Factor Fatiga (k): <span className="text-white font-mono font-bold">{k.toFixed(3)}</span></span>
                    <InfoTooltip type="riegel" />
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{ l: '5K', d: 5, c: 'from-green-400 to-green-600' }, { l: '10K', d: 10, c: 'from-blue-400 to-blue-600' }, { l: 'Media', d: 21.097, c: 'from-purple-400 to-purple-600' }, { l: 'Maratón', d: 42.195, c: 'from-orange-400 to-orange-600' }].map(race => { 
                const result = predict(race.d);
                return (
                    <div key={race.l} className={`relative overflow-hidden rounded-2xl p-4 bg-gradient-to-br ${race.c} shadow-lg group`}>
                        <div className="absolute right-0 top-0 p-3 opacity-20 transform group-hover:scale-110 transition-transform"><Icons.Run /></div>
                        <p className="text-white/80 text-xs font-bold uppercase">{race.l}</p>
                        <p className="text-white text-xl font-bold font-mono mt-1">{result.timeStr}</p>
                        <p className="text-white/70 text-xs font-mono font-bold">{result.paceStr} /km</p>
                    </div>
                ); 
            })}</div>
        </div>
    );
};

const WeeklyVolumeChart = memo(({ sessions }: { sessions: Session[] }) => {
    const [hoverData, setHoverData] = useState<{x: number, y: number, dist: number, dur: number, label: string} | null>(null);

    const weeklyData = useMemo(() => {
        const groups: Record<string, { dist: number; duration: number; label: string; sortTime: number }> = {};
        sessions.forEach(s => {
            const date = new Date(s.startTime); const day = date.getDay(); const diff = date.getDate() - day + (day === 0 ? -6 : 1); const monday = new Date(date.setDate(diff)); monday.setHours(0,0,0,0);
            const key = monday.toISOString().split('T')[0];
            if (!groups[key]) { const label = monday.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); groups[key] = { dist: 0, duration: 0, label, sortTime: monday.getTime() }; }
            groups[key].dist += s.distance / 1000; groups[key].duration += s.duration / 3600; 
        });
        let arr = Object.values(groups).sort((a, b) => a.sortTime - b.sortTime);
        if (arr.length >= 6) arr = arr.slice(-24);
        return arr;
    }, [sessions]);
    
    if (weeklyData.length === 0) return (<div className="glass-panel p-4 rounded-3xl col-span-2 md:col-span-4 flex items-center justify-center text-gray-500 text-xs h-40">Sin datos suficientes</div>);
    
    const maxDist = Math.max(...weeklyData.map(d => d.dist), 10); const maxDur = Math.max(...weeklyData.map(d => d.duration), 1);
    const pointsDist = weeklyData.map((d, i) => { const x = (i / (weeklyData.length - 1)) * 100; const y = 100 - (d.dist / maxDist) * 100; return `${x},${y}`; }).join(' ');
    const pointsDur = weeklyData.map((d, i) => { const x = (i / (weeklyData.length - 1)) * 100; const y = 100 - (d.duration / maxDur) * 100; return `${x},${y}`; }).join(' ');
    
    return (
        <div className="glass-panel p-4 rounded-3xl col-span-2 md:col-span-4 flex flex-col h-40 relative group">
            <div className="flex justify-between items-center mb-2"><h4 className="text-sm font-semibold text-gray-400">Evolución Semanal</h4><div className="flex space-x-3 text-[10px] font-bold"><span className="text-[#34C759] flex items-center"><div className="w-2 h-2 rounded-full bg-[#34C759] mr-1"></div> Km</span><span className="text-[#007AFF] flex items-center"><div className="w-2 h-2 rounded-full bg-[#007AFF] mr-1"></div> Horas</span></div></div>
            <div className="flex-1 relative w-full cursor-crosshair">
                <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[9px] text-[#34C759]/70 font-mono z-10 pointer-events-none"><span>{maxDist.toFixed(0)} km</span><span>{(maxDist/2).toFixed(0)} km</span><span>0 km</span></div>
                <div className="absolute right-0 top-0 bottom-6 flex flex-col justify-between text-[9px] text-[#007AFF]/70 font-mono text-right z-10 pointer-events-none"><span>{maxDur.toFixed(1)} h</span><span>{(maxDur/2).toFixed(1)} h</span><span>0 h</span></div>
                <div className="absolute inset-0 mx-10 mb-4">
                    <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                        <line x1="0" y1="0" x2="100" y2="0" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="2,2" /><line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="2,2" /><line x1="0" y1="100" x2="100" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                        <path d={`M${pointsDur.split(' ')[0]} L${pointsDur}`} fill="none" stroke="#007AFF" strokeWidth="1.5" strokeOpacity="0.8" vectorEffect="non-scaling-stroke" /><defs><linearGradient id="gradBlue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style={{stopColor:'#007AFF', stopOpacity:0.2}} /><stop offset="100%" style={{stopColor:'#007AFF', stopOpacity:0}} /></linearGradient></defs><path d={`M0,100 ${pointsDur} L100,100 Z`} fill="url(#gradBlue)" stroke="none" />
                        <path d={`M${pointsDist.split(' ')[0]} L${pointsDist}`} fill="none" stroke="#34C759" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                        {weeklyData.map((d, i) => (
                            <rect key={i} x={(i / (weeklyData.length - 1)) * 100 - 2} y="0" width="4" height="100" fill="transparent"
                                onMouseMove={(e) => {
                                    // Use fixed coordinates based on viewport for better reliability
                                    setHoverData({ x: e.clientX, y: e.clientY, dist: d.dist, dur: d.duration, label: d.label });
                                }}
                                onMouseLeave={() => setHoverData(null)}
                            />
                        ))}
                    </svg>
                </div>
                <div className="absolute bottom-0 left-10 right-10 flex justify-between px-1">{weeklyData.map((d, i) => (<span key={i} className="text-[8px] text-gray-500 font-mono text-center" style={{ width: `${100/weeklyData.length}%` }}>{d.label.split(' ')[0]}</span>))}</div>
            </div>
            {hoverData && createPortal(
                <div className="fixed z-[9999] bg-[#1C1C1E]/95 backdrop-blur border border-white/20 p-2 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full" style={{ left: hoverData.x, top: hoverData.y - 40 }}>
                    <p className="text-[10px] text-gray-400 font-bold border-b border-white/10 pb-1 mb-1">{hoverData.label}</p>
                    <p className="text-xs font-mono text-[#34C759] font-bold">{hoverData.dist.toFixed(1)} km</p>
                    <p className="text-xs font-mono text-[#007AFF] font-bold">{hoverData.dur.toFixed(1)} h</p>
                </div>,
                document.body
            )}
        </div>
    );
});

const SummaryItem = ({ label, value, unit, color }: any) => (
    <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col justify-center">
        <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">{label}</p>
        <p className={`text-xl font-bold font-mono ${color || 'text-white'}`}>{value} <span className="text-[10px] text-gray-500 font-sans font-normal ml-0.5">{unit}</span></p>
    </div>
);

const MetricCard = ({ label, value, unit, colorClass, icon }: any) => (
    <div className="glass-panel p-3 rounded-2xl flex items-center justify-between">
        <div>
            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${colorClass}`}>{value} <span className="text-xs text-gray-500 ml-1">{unit}</span></p>
        </div>
        <div className={`text-2xl opacity-20 ${colorClass}`}>{icon}</div>
    </div>
);

const AggregatedStats = ({ sessions }: { sessions: Session[] }) => {
    const totalDist = sessions.reduce((acc, s) => acc + s.distance, 0) / 1000;
    const totalTime = sessions.reduce((acc, s) => acc + s.duration, 0);
    const totalCals = sessions.reduce((acc, s) => acc + s.calories, 0);
    const totalElev = sessions.reduce((acc, s) => acc + s.totalElevationGain, 0);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="glass-panel p-4 rounded-3xl relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-30 transform group-hover:scale-110 transition-transform"><Icons.Ruler /></div>
                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Distancia Total</p>
                <p className="text-3xl font-bold text-white font-mono">{totalDist.toFixed(1)} <span className="text-sm text-gray-500">km</span></p>
            </div>
             <div className="glass-panel p-4 rounded-3xl relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-30 transform group-hover:scale-110 transition-transform"><Icons.Clock /></div>
                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Tiempo Total</p>
                <p className="text-3xl font-bold text-white font-mono">{(totalTime/3600).toFixed(1)} <span className="text-sm text-gray-500">h</span></p>
            </div>
             <div className="glass-panel p-4 rounded-3xl relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-30 transform group-hover:scale-110 transition-transform"><Icons.Flame /></div>
                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Calorías</p>
                <p className="text-3xl font-bold text-white font-mono">{(totalCals/1000).toFixed(1)} <span className="text-sm text-gray-500">k</span></p>
            </div>
             <div className="glass-panel p-4 rounded-3xl relative overflow-hidden group">
                <div className="absolute right-0 top-0 p-4 opacity-30 transform group-hover:scale-110 transition-transform"><Icons.Mountain /></div>
                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Desnivel</p>
                <p className="text-3xl font-bold text-white font-mono">{totalElev.toLocaleString()} <span className="text-sm text-gray-500">m</span></p>
            </div>
        </div>
    );
};

const RecentActivitiesList = ({ sessions, onSelectSession }: { sessions: Session[], onSelectSession: (id: string) => void }) => {
    return (
        <div className="glass-panel p-5 rounded-3xl">
             <h4 className="text-sm font-semibold text-gray-400 flex items-center mb-4"><Icons.ListCheck /> <span className="ml-2">Actividad Reciente</span></h4>
             <div className="space-y-3">
                {sessions.slice(0, 5).map(session => {
                     const sportConfig = getSportConfig(session.sport);
                     return (
                        <div key={session.id} onClick={() => onSelectSession(session.id)} className="flex items-center justify-between p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group border border-transparent hover:border-white/10">
                            <div className="flex items-center space-x-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center bg-black/30 ${sportConfig.color}`}>{sportConfig.icon}</div>
                                <div>
                                    <p className="font-bold text-sm text-white group-hover:text-[#34C759] transition-colors">{session.name}</p>
                                    <p className="text-xs text-gray-500">{new Date(session.startTime).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="font-mono text-sm font-bold text-white">{(session.distance/1000).toFixed(2)} km</p>
                                <p className="font-mono text-xs text-gray-500">{formatTime(session.duration)}</p>
                            </div>
                        </div>
                     );
                })}
             </div>
        </div>
    );
};

const MapComponent = memo(({ trackPoints, currentIndex }: { trackPoints: TrackPoint[], currentIndex: number }) => {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const polylineRef = useRef<L.Polyline | null>(null);
    const markerRef = useRef<L.CircleMarker | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        if (!mapRef.current) {
            mapRef.current = L.map(containerRef.current, { zoomControl: false, attributionControl: false }).setView([0,0], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(mapRef.current);
        }
        return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    }, []);

    useEffect(() => {
        if (!mapRef.current) return;
        const validPoints = trackPoints.filter(p => p.lat !== 0 && p.lon !== 0);
        if (validPoints.length === 0) return;

        const latlngs = validPoints.map(p => [p.lat, p.lon] as [number, number]);
        if (polylineRef.current) polylineRef.current.remove();
        polylineRef.current = L.polyline(latlngs, { color: '#34C759', weight: 4 }).addTo(mapRef.current);
        
        const bounds = L.latLngBounds(latlngs);
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });

        if (!markerRef.current) {
            markerRef.current = L.circleMarker(latlngs[0], { radius: 6, color: 'white', fillColor: '#007AFF', fillOpacity: 1 }).addTo(mapRef.current);
        }
    }, [trackPoints]);

    useEffect(() => {
        if (!markerRef.current || !trackPoints[currentIndex]) return;
        const p = trackPoints[currentIndex];
        if (p.lat !== 0) markerRef.current.setLatLng([p.lat, p.lon]);
    }, [currentIndex, trackPoints]);

    return <div ref={containerRef} className="w-full h-full bg-[#1C1C1E]" />;
});

const ElevationChart = memo(({ trackPoints, currentIndex }: { trackPoints: TrackPoint[], currentIndex: number }) => {
    if (!trackPoints || trackPoints.length === 0) return null;
    const data = trackPoints.filter((_, i) => i % Math.ceil(trackPoints.length / 200) === 0);
    const minEle = Math.min(...data.map(p => p.altitude));
    const maxEle = Math.max(...data.map(p => p.altitude));
    const range = maxEle - minEle || 10;
    const points = data.map((p, i) => `${(i / (data.length - 1)) * 100},${100 - ((p.altitude - minEle) / range) * 100}`).join(' ');
    const currentX = (currentIndex / (trackPoints.length - 1)) * 100;

    return (
        <div className="w-full h-full relative">
            <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
                 <defs><linearGradient id="gradEle" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style={{stopColor:'#34C759', stopOpacity:0.4}} /><stop offset="100%" style={{stopColor:'#34C759', stopOpacity:0}} /></linearGradient></defs>
                 <path d={`M0,100 ${points} L100,100 Z`} fill="url(#gradEle)" />
                 <path d={`M${points.split(' ')[0]} L${points}`} fill="none" stroke="#34C759" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                 <line x1={currentX} y1="0" x2={currentX} y2="100" stroke="white" strokeWidth="1" strokeDasharray="2,2" vectorEffect="non-scaling-stroke" />
            </svg>
             <div className="absolute top-2 right-2 text-[10px] text-gray-500 bg-black/50 px-1 rounded">Min: {Math.round(minEle)}m | Max: {Math.round(maxEle)}m</div>
        </div>
    );
});

const ZoneDistributionChart = ({ trackPoints, maxHr, restHr }: { trackPoints: TrackPoint[], maxHr: number, restHr: number }) => {
    const fcr = maxHr - restHr;
    const zones = [
        { name: 'Z1', min: restHr + 0.50 * fcr, color: 'bg-gray-500' },
        { name: 'Z2', min: restHr + 0.60 * fcr, color: 'bg-blue-500' },
        { name: 'Z3', min: restHr + 0.70 * fcr, color: 'bg-green-500' },
        { name: 'Z4', min: restHr + 0.80 * fcr, color: 'bg-orange-500' },
        { name: 'Z5', min: restHr + 0.90 * fcr, color: 'bg-red-500' }
    ];
    
    const dist = [0, 0, 0, 0, 0];
    let total = 0;
    trackPoints.forEach(p => {
        if (p.hr > 0) {
            total++;
            if (p.hr < zones[1].min) dist[0]++;
            else if (p.hr < zones[2].min) dist[1]++;
            else if (p.hr < zones[3].min) dist[2]++;
            else if (p.hr < zones[4].min) dist[3]++;
            else dist[4]++;
        }
    });

    return (
        <div className="flex h-full items-end space-x-1 glass-panel p-2 rounded-xl">
            {dist.map((count, i) => (
                <div key={i} className="flex-1 flex flex-col items-center group relative">
                    <div className={`w-full rounded-t ${zones[i].color} opacity-80 group-hover:opacity-100 transition-all`} style={{ height: `${total > 0 ? (count / total) * 100 : 0}%` }}></div>
                    <span className="text-[9px] text-gray-500 mt-1 font-bold">{zones[i].name}</span>
                    <div className="absolute -top-6 bg-black text-xs px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">{total > 0 ? Math.round(count/total*100) : 0}%</div>
                </div>
            ))}
        </div>
    );
};

const Sidebar = ({ sessions, view, setView, selectedSessionId, setSelectedSessionId, setPlaybackIndex, searchQuery, setSearchQuery, selectedDate, setSelectedDate, expandedGroups, toggleGroup, exportDatabase, clearAllSessions, handleDataLoaded, deleteSession, addNotification, openProfile, isSelectionMode, toggleSelectionMode, selectedIds, toggleSelection, deleteSelected }: any) => {
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
                    if (Array.isArray(json)) loaded = loaded.concat(json); // Restore backup
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

    const filteredSessions = sessions.filter((s: Session) => {
        if (selectedDate && !isSameDay(new Date(s.startTime), selectedDate)) return false;
        if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) && !s.sport.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
    });

    const groupedSessions = useMemo(() => {
        const groups: Record<string, Record<string, Session[]>> = {};
        filteredSessions.forEach((s: Session) => {
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
                                                                setSelectedSessionId(session.id);
                                                                setPlaybackIndex(0);
                                                                setView('session');
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
    const [sessions, setSessions] = useState<Session[]>([]);
    const [view, setView] = useState<'dashboard' | 'session'>('dashboard');
    const [dashboardTab, setDashboardTab] = useState<'overview' | 'physiology' | 'heatmap'>('overview');
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
    
    // Multi-selection state
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
                setView('dashboard');
            }
            addNotification({ type: 'success', message: `${selectedIds.size} sesiones eliminadas.` });
            setSelectedIds(new Set());
            setIsSelectionMode(false);
        }
    };

    const handleShowInfo = (tab: string) => {
        // No-op due to new Tooltip system
    };

    useEffect(() => {
        const savedProfile = localStorage.getItem('runalyzer_profile');
        if (savedProfile) setUserProfile(JSON.parse(savedProfile));

        const init = async () => {
            const stored = await getAllSessionsFromDB();
            if (stored.length > 0) {
                // Aggressively patch missing data
                const patched = stored.map(s => {
                    let updated = { ...s };
                    const hasPoints = s.trackPoints && s.trackPoints.length > 0;
                    let modified = false;

                    // Recalculate TRIMP if missing
                    if (s.trimp === undefined && hasPoints) {
                         updated.trimp = calculateTRIMP(s.trackPoints, s.maxHr || 190, 60);
                         modified = true;
                    }
                    
                    // Recalculate VO2 if missing or 0
                    if ((!s.acsmVo2Max || s.acsmVo2Max === 0) && hasPoints) {
                         let val = calculateACSMVo2(s.trackPoints, s.maxHr || 190);
                         if (val === 0 && s.vam6min > 0) val = 3.5 * (s.vam6min * 3.6); // Fallback
                         updated.acsmVo2Max = val;
                         modified = true;
                    }

                    // Recalculate Elevation if 0 and points exist
                    if ((!s.totalElevationGain || s.totalElevationGain === 0) && hasPoints) {
                         let gain = 0;
                         for(let i=1; i<s.trackPoints.length; i++) {
                             const diff = s.trackPoints[i].altitude - s.trackPoints[i-1].altitude;
                             if (diff > 0.3 && diff < 30) gain += diff; 
                         }
                         updated.totalElevationGain = Math.round(gain);
                         updated.climbScore = calculateClimbScore(updated.totalElevationGain, s.distance);
                         modified = true;
                    }
                    
                    // Update Climb Score
                    if (s.climbScore === undefined) {
                        updated.climbScore = calculateClimbScore(updated.totalElevationGain, s.distance);
                        modified = true;
                    }
                    
                    return updated;
                });

                setSessions(patched.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
                const now = new Date();
                const year = now.getFullYear().toString();
                const month = `${year}-${now.getMonth()}`;
                setExpandedGroups(new Set([year, month]));
                
                if (!savedProfile) {
                    const maxObserved = Math.max(...stored.map(s => s.maxHr));
                    if (maxObserved > 150) setUserProfile(p => ({...p, maxHr: maxObserved}));
                }
            } else {
                const mocks = generateMockHistory();
                setSessions(mocks);
                mocks.forEach(m => saveSessionToDB(m));
                 const now = new Date();
                const year = now.getFullYear().toString();
                const month = `${year}-${now.getMonth()}`;
                setExpandedGroups(new Set([year, month]));
            }
        };
        init();
    }, []);
    
    const saveProfile = (newProfile: UserProfile) => { setUserProfile(newProfile); localStorage.setItem('runalyzer_profile', JSON.stringify(newProfile)); setShowProfile(false); addNotification({ type: 'success', message: 'Perfil actualizado. Métricas recalculadas.' }); };
    const addNotification = (n: Omit<Notification, 'id'>) => { const id = Math.random().toString(36).substring(7); setNotifications(prev => [...prev, { ...n, id }]); };
    const removeNotification = (id: string) => { setNotifications(prev => prev.filter(n => n.id !== id)); };
    const updateSession = async () => { if (!selectedSessionId) return; const s = sessions.find(sess => sess.id === selectedSessionId); if (!s) return; const updatedSession = { ...s, name: editName, sport: editSport }; setSessions(prev => prev.map(item => item.id === selectedSessionId ? updatedSession : item)); await saveSessionToDB(updatedSession); setIsEditing(false); addNotification({ type: 'success', message: 'Sesión actualizada correctamente.' }); };
    const handleDataLoaded = async (newSessions: Session[]) => { 
        const existingIds = new Set(sessions.map(s => s.id)); 
        const uniqueSessions = newSessions.filter(s => !existingIds.has(s.id)); 
        const duplicatesCount = newSessions.length - uniqueSessions.length; 
        
        if (uniqueSessions.length === 0) { 
            addNotification({ type: 'info', message: duplicatesCount > 0 ? `Se ignoraron ${duplicatesCount} archivo(s) duplicado(s).` : 'No se encontraron sesiones nuevas.' }); 
            return; 
        } 

        // Patch sessions immediately before saving and adding to state
        const patchedSessions = uniqueSessions.map(s => {
            let updated = { ...s };
            const hasPoints = s.trackPoints && s.trackPoints.length > 0;
            
            if ((!s.totalElevationGain || s.totalElevationGain === 0) && hasPoints) {
                let gain = 0;
                for(let i=1; i<s.trackPoints.length; i++) {
                    const diff = s.trackPoints[i].altitude - s.trackPoints[i-1].altitude;
                    if (diff > 0.3 && diff < 30) gain += diff;
                }
                updated.totalElevationGain = Math.round(gain);
                updated.climbScore = calculateClimbScore(updated.totalElevationGain, s.distance);
            }
            return updated;
        });

        for (const s of patchedSessions) await saveSessionToDB(s); 
        
        setSessions(prev => { 
            return [...prev, ...patchedSessions].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()); 
        }); 
        
        const newGroups = new Set(expandedGroups); 
        patchedSessions.forEach(s => { 
            const d = new Date(s.startTime); 
            newGroups.add(d.getFullYear().toString()); 
            newGroups.add(`${d.getFullYear()}-${d.getMonth()}`); 
        }); 
        setExpandedGroups(newGroups); 
        addNotification({ type: 'success', message: `Importadas ${patchedSessions.length} sesiones.` + (duplicatesCount > 0 ? ` (${duplicatesCount} duplicados ignorados)` : '') }); 
    };
    const deleteSession = async (e: React.MouseEvent, id: string) => { e.stopPropagation(); if (confirm('¿Seguro que quieres borrar esta sesión?')) { await deleteSessionFromDB(id); setSessions(prev => prev.filter(s => s.id !== id)); if (selectedSessionId === id) { setSelectedSessionId(null); setView('dashboard'); } addNotification({ type: 'success', message: 'Sesión eliminada correctamente.' }); } };
    const clearAllSessions = async () => { if (confirm('¿BORRAR TODO EL HISTORIAL? Esta acción no se puede deshacer.')) { await clearDB(); setSessions([]); setView('dashboard'); addNotification({ type: 'success', message: 'Base de datos vaciada.' }); } };
    const exportDatabase = async () => { const json = JSON.stringify(sessions, null, 2); const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `runalyzer-backup-${new Date().toISOString().split('T')[0]}.json`; a.click(); addNotification({ type: 'success', message: 'Backup descargado.' }); };
    const toggleGroup = (key: string) => { const newSet = new Set(expandedGroups); if (newSet.has(key)) newSet.delete(key); else newSet.add(key); setExpandedGroups(newSet); };
    const currentSession = useMemo(() => sessions.find(s => s.id === selectedSessionId), [sessions, selectedSessionId]);

    const renderDashboard = () => (
        <div className="space-y-6 pb-10">
            <div className="flex space-x-2 bg-white/5 p-1 rounded-xl w-fit mb-4">
                <button onClick={() => setDashboardTab('overview')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'overview' ? 'bg-[#34C759] text-black' : 'text-gray-400 hover:text-white'}`}><Icons.List /> <span className="ml-1">Resumen</span></button>
                <button onClick={() => setDashboardTab('physiology')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'physiology' ? 'bg-[#007AFF] text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Chart /> <span className="ml-1">Fisiología</span></button>
                <button onClick={() => setDashboardTab('heatmap')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${dashboardTab === 'heatmap' ? 'bg-pink-500 text-white' : 'text-gray-400 hover:text-white'}`}><Icons.Map /> <span className="ml-1">Mapa de Calor</span></button>
            </div>
            {dashboardTab === 'overview' && (
                <>
                    <AggregatedStats sessions={sessions} />
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6"><WeeklyVolumeChart sessions={sessions} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><RacePredictor sessions={sessions} onShowInfo={() => handleShowInfo('riegel')} /></div>
                    {sessions.length > 0 && (<div className="mt-4"><RecentActivitiesList sessions={sessions} onSelectSession={(id) => { setSelectedSessionId(id); setView('session'); }} /></div>)}
                </>
            )}
            {dashboardTab === 'physiology' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <RecoveryAdvisor sessions={sessions} onShowInfo={() => handleShowInfo('recovery')} />
                        <IntensityDistribution sessions={sessions} profile={userProfile} onShowInfo={() => handleShowInfo('polarized')} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><AdvancedAnalytics sessions={sessions} profile={userProfile} onShowInfo={handleShowInfo} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><PersonalRecords sessions={sessions} /></div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4"><FitnessTrendChart sessions={sessions} /></div>
                </>
            )}
            {dashboardTab === 'heatmap' && (
                <GlobalHeatmap sessions={sessions} />
            )}
        </div>
    );

    const renderSession = () => {
        if (!currentSession) return <div>Selecciona una sesión</div>;
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
                                    <h2 className="text-2xl font-bold text-white flex items-center group">{currentSession.name}<button onClick={() => setIsEditing(true)} className="ml-3 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-[#34C759] transition-all text-sm"><Icons.Pen /></button></h2>
                                    <p className="text-gray-500 text-sm flex items-center mt-1"><Icons.Calendar /> <span className="ml-2">{new Date(currentSession.startTime).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}</span></p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="glass-panel p-4 rounded-3xl">
                     <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        <SummaryItem label="Tiempo" value={formatTime(currentSession.duration)} unit="" />
                        <SummaryItem label="Distancia" value={(currentSession.distance/1000).toFixed(2)} unit="km" />
                        <SummaryItem label="Ritmo" value={formatPace((1000/(currentSession.distance/currentSession.duration))/60)} unit="/km" />
                        <SummaryItem label="FC Media" value={currentSession.avgHr} unit="bpm" />
                        <SummaryItem label="Calorías" value={currentSession.calories} unit="kcal" />
                        <SummaryItem label="Desnivel +" value={currentSession.totalElevationGain} unit="m" />
                        <SummaryItem label="Carga" value={currentSession.trimp || '-'} unit="TRIMP" color="text-purple-400" />
                        <SummaryItem label="Climb Score" value={currentSession.climbScore || '-'} unit="" color="text-yellow-400" />
                     </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 h-[450px]">
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
                             <ZoneDistributionChart trackPoints={currentSession.trackPoints} maxHr={userProfile.maxHr} restHr={userProfile.restHr} />
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
                sessions={sessions} view={view} setView={setView} selectedSessionId={selectedSessionId} setSelectedSessionId={setSelectedSessionId}
                setPlaybackIndex={setPlaybackIndex} searchQuery={searchQuery} setSearchQuery={setSearchQuery} selectedDate={selectedDate}
                setSelectedDate={setSelectedDate} expandedGroups={expandedGroups} toggleGroup={toggleGroup} exportDatabase={exportDatabase}
                clearAllSessions={clearAllSessions} handleDataLoaded={handleDataLoaded} deleteSession={deleteSession} addNotification={addNotification}
                openProfile={() => setShowProfile(true)}
                isSelectionMode={isSelectionMode} toggleSelectionMode={toggleSelectionMode} selectedIds={selectedIds} toggleSelection={toggleSelection} deleteSelected={deleteSelected}
            />
            <main className="flex-1 h-full overflow-y-auto relative scrollbar-hide">
                <div className="max-w-7xl mx-auto p-8 pt-12">
                    {view === 'dashboard' ? renderDashboard() : renderSession()}
                </div>
            </main>
            <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
                {notifications.map(n => (<NotificationToast key={n.id} notification={n} onClose={() => removeNotification(n.id)} />))}
            </div>
            {/* FormulaModal no longer used, kept out of render or removed */}
            <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} profile={userProfile} onSave={saveProfile} />
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
