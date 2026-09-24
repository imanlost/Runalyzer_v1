
import { TrackPoint, Session, SessionSummary, AcwrResult, WeatherData, UserProfile } from './types';

export const formatPace = (minPerKm: number) => {
    if (!isFinite(minPerKm) || isNaN(minPerKm) || minPerKm <= 0) return '--';
    // Se redondea el total de segundos ANTES de descomponerlo: redondear solo la
    // parte decimal permitía que un ritmo de 3,9998 min (3 min 59,99 s) se pintara
    // como 3'60'' en lugar de 4'00''.
    const totalSeconds = Math.round(minPerKm * 60);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}'${s < 10 ? '0' + s : s}''`;
};

export const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
    return `${m}:${s < 10 ? '0'+s : s}`;
};

/**
 * Formatea un valor numérico para mostrarlo en la interfaz.
 * - Redondea a `decimals` decimales (0 por defecto, requisito del proyecto).
 * - Devuelve '--' si el valor no es un número finito (null, undefined, NaN,
 *   Infinity) o si llega ya como texto.
 * Para distancias en kilómetros se usa `formatMetric(km, 2)`, que es la única
 * excepción con 2 decimales.
 */
export const formatMetric = (value: unknown, decimals: number = 0): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return value.toFixed(decimals);
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

/**
 * Suaviza un stream de altitud con una media móvil centrada de 15 muestras.
 *
 * Se usa como paso previo tanto para el desnivel acumulado como para la
 * pendiente del GAP. En los extremos se replica el valor más cercano para que
 * la ventana tenga siempre 15 muestras y un pico aislado no pese de más. Los
 * huecos (0 o valores no finitos) no cuentan en la media y dejan la muestra
 * como ausente (NaN).
 */
export const smoothAltitudes = (altitudes: number[]): number[] => {
    const isValidAltitude = (alt: number) => typeof alt === 'number' && Number.isFinite(alt) && alt !== 0;

    const windowSize = 15;
    const half = Math.floor(windowSize / 2);
    const total = altitudes.length;

    // Con menos muestras que la ventana, la media móvil no aporta nada y los
    // bordes dominarían la señal (una rampa lineal se aplanaría y la pendiente
    // del GAP saldría corta). Se devuelve la señal tal cual, conservando los
    // huecos como NaN para que el desnivel los siga ignorando.
    if (total < windowSize) {
        return altitudes.map(a => isValidAltitude(a) ? a : NaN);
    }

    const smoothed: number[] = [];
    for (let i = 0; i < total; i++) {
        let sum = 0;
        let count = 0;
        for (let k = -half; k <= half; k++) {
            const j = Math.min(total - 1, Math.max(0, i + k));
            if (isValidAltitude(altitudes[j])) { sum += altitudes[j]; count++; }
        }
        smoothed.push(count > 0 ? sum / count : NaN);
    }
    return smoothed;
};

/**
 * Estima el desnivel positivo a partir del stream de altitud.
 *
 * IMPORTANTE: esto es solo un RESPALDO para fuentes que no traen un desnivel ya
 * calculado por el dispositivo (el `total_ascent` de la sesión FIT, el
 * `total_elevation_gain` de intervals.icu o su equivalente en CSV/Polar). Si la
 * fuente lo trae, ese valor manda y no se debe llamar a esta función.
 *
 * Por qué se suaviza antes de aplicar la histéresis:
 * - El altímetro oscila de forma natural (~30 cm entre muestras) y, si se suma
 *   cada incremento punto a punto, cada micro-oscilación cuenta como subida y
 *   el desnivel se dispara. Una media móvil centrada de 15 muestras elimina ese
 *   ruido de alta frecuencia sin desvirtuar las pendientes reales, que son
 *   mucho más lentas.
 * - Sobre la señal ya suavizada se aplica una histéresis de 0,5 m: solo se
 *   acumula el cambio cuando la altitud supera la referencia en 0,5 m o más; en
 *   los descensos la referencia baja igual, para no perder las subidas repetidas
 *   del terreno ondulado.
 * - La altitud 0 se trata como ausente (centinela habitual de los GPS) y no
 *   entra ni en la media ni en la histéresis.
 *
 * Es una aproximación: sin el dato del dispositivo no es posible reproducir el
 * desnivel del barómetro del reloj.
 */
export const calculateElevationGain = (altitudes: number[], threshold: number = 0.5): number => {
    // 1) Suavizado con media móvil centrada de 15 muestras (helper compartido
    //    con el cálculo de pendiente del GAP).
    const smoothed = smoothAltitudes(altitudes);

    // 2) Histéresis de `threshold` sobre la señal suavizada.
    let gain = 0;
    let ref: number | null = null;
    for (const alt of smoothed) {
        if (!Number.isFinite(alt)) continue;
        if (ref === null) { ref = alt; continue; }
        if (alt >= ref + threshold) {
            gain += alt - ref;
            ref = alt;
        } else if (alt <= ref - threshold) {
            ref = alt;
        }
    }
    return gain;
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
        // Se exige la ventana COMPLETA, con una tolerancia de 3 s para relojes
        // que no muestrean exactamente a 1 Hz: un hueco de muestreo obligaría a
        // descartar la mejor ventana y devolvería VAM 0 sin avisar. La ventana
        // aceptada es de `windowSeconds - 3` (357 s para 6 min). El sesgo que se
        // elimina al no aceptar el 90 % (324 s) era del 10 %; con 3 s es < 1,5 %.
        if (duration >= windowSeconds - 3) {
            const distance = dists[right] - dists[left];
            const speedMps = distance / duration;
            if (speedMps > maxSpeed && speedMps < 7.0) maxSpeed = speedMps;
        }
    }
    return maxSpeed;
};

// --- MOTOR DE CÁLCULO FISIOLÓGICO ---
// Todas las funciones de esta sección son puras: reciben arrays y números y
// devuelven números (o estructuras simples), sin depender del DOM ni de React.

/**
 * Factor de coste energético de correr en pendiente según Minetti et al. (2002):
 *   Cr(i) = 155,4·i^5 − 30,4·i^4 − 43,3·i^3 + 46,3·i^2 + 19,5·i + 3,6  (J/kg/m)
 * con i = pendiente en fracción (positiva = subida). Devuelve Cr(i)/Cr(0),
 * de forma que en llano vale 1.
 *
 * Origen y límite del modelo: está calibrado con medidas de consumo de oxígeno
 * en cinta rodante en un rango aproximado de −20 % a +20 %. En pendientes
 * superiores al 10 % subestima el coste real (el gesto cambia, aparece más
 * trabajo excéntrico y la cinta no reproduce bien el terreno), así que por
 * encima de ese rango el dato es orientativo, no una equivalencia exacta.
 */
export const minettiCostFactor = (grade: number): number => {
    if (!Number.isFinite(grade)) return 1;
    const i = grade;
    const cr = 155.4 * Math.pow(i, 5)
        - 30.4 * Math.pow(i, 4)
        - 43.3 * Math.pow(i, 3)
        + 46.3 * Math.pow(i, 2)
        + 19.5 * i
        + 3.6;
    // Cr(0) = 3,6 J/kg/m
    return cr / 3.6;
};

/**
 * Ritmo ajustado por pendiente (GAP) en segundos por kilómetro.
 *
 * La pendiente no se calcula punto a punto (el ruido del GPS dispararía el
 * factor) sino sobre la altitud ya suavizada con la media móvil de 15 muestras
 * y sobre ventanas de 200 m de distancia. Cada ventana se convierte a "tiempo
 * equivalente en llano" dividiendo su tiempo real por el factor de Minetti, y
 * el GAP final es el tiempo equivalente total entre la distancia total.
 *
 * El factor se recorta por abajo en 0,70 porque en bajadas fuertes el modelo
 * sobrestima el ahorro (correr cuesta abajo también cuesta) y sin ese suelo el
 * ritmo ajustado sale irreal.
 *
 * @param altitudes altitud en metros (0 = dato ausente, como en el resto de la app)
 * @param distances distancia acumulada en metros
 * @param times     instantes en segundos (solo se usan diferencias)
 * @returns segundos por kilómetro ajustados; 0 si no hay datos suficientes
 */
export const calculateGradeAdjustedPace = (altitudes: number[], distances: number[], times: number[]): number => {
    const n = Math.min(altitudes.length, distances.length, times.length);
    if (n < 2) return 0;

    const smoothed = smoothAltitudes(altitudes);
    const WINDOW_METERS = 200;
    const FACTOR_FLOOR = 0.70;

    let adjustedTime = 0; // segundos equivalentes en llano
    let totalDistance = 0; // metros

    let start = 0;
    while (start < n - 1) {
        let end = start + 1;
        while (end < n - 1 && distances[end] - distances[start] < WINDOW_METERS) end++;

        const dd = distances[end] - distances[start];
        const dt = times[end] - times[start];
        const a0 = smoothed[start];
        const a1 = smoothed[end];

        if (dd > 0 && dt > 0 && Number.isFinite(a0) && Number.isFinite(a1)) {
            const grade = (a1 - a0) / dd;
            const factor = Math.max(FACTOR_FLOOR, minettiCostFactor(grade));
            adjustedTime += dt / factor;
            totalDistance += dd;
        }

        start = end;
    }

    if (totalDistance <= 0) return 0;
    return (adjustedTime / totalDistance) * 1000;
};

interface EfficiencySegment {
    startTime: number; // instante de inicio del tramo
    time: number;      // instante de cierre del tramo
    distance: number;  // metros del tramo
    duration: number;  // segundos del tramo
    hr: number;        // FC al inicio del tramo
}

/**
 * Construye los tramos válidos para el cálculo de eficiencia a partir de los
 * arrays crudos. Un tramo es válido si su duración y distancia son positivas
 * (velocidad > 0) y su FC es distinta de cero. Si se pasa la altitud, también
 * se descartan los tramos con pendiente fuera de −2 % y +2 %, porque en
 * pendiente la relación velocidad/FC deja de ser comparable entre sesiones.
 *
 * La FC del tramo se toma en su instante inicial: así el tramo que cruza el
 * corte entre mitades conserva el estado de la mitad a la que pertenece por su
 * velocidad y no arrastra la FC de la mitad siguiente.
 */
const buildEfficiencySegments = (
    distances: number[],
    times: number[],
    heartrates: number[],
    altitudes?: number[]
): EfficiencySegment[] => {
    const n = Math.min(distances.length, times.length, heartrates.length, altitudes ? altitudes.length : Infinity);
    const useGrade = !!altitudes && altitudes.length >= n;
    const segments: EfficiencySegment[] = [];

    for (let i = 1; i < n; i++) {
        const duration = times[i] - times[i - 1];
        const distance = distances[i] - distances[i - 1];
        const hr = heartrates[i - 1];
        if (!(duration > 0) || !(distance > 0) || !(hr > 0)) continue;
        if (useGrade) {
            const grade = (altitudes![i] - altitudes![i - 1]) / distance;
            if (grade < -0.02 || grade > 0.02) continue;
        }
        segments.push({ startTime: times[i - 1], time: times[i], distance, duration, hr });
    }

    return segments;
};

/** Eficiencia aeróbica (m/min/bpm) de un conjunto de tramos ya filtrados. */
const efficiencyFromSegments = (segments: EfficiencySegment[]): number => {
    if (segments.length === 0) return 0;
    let totalDistance = 0;
    let totalDuration = 0;
    let totalHr = 0;
    for (const s of segments) {
        totalDistance += s.distance;
        totalDuration += s.duration;
        totalHr += s.hr;
    }
    if (!(totalDuration > 0)) return 0;
    const speedMmin = (totalDistance / totalDuration) * 60;
    const avgHr = totalHr / segments.length;
    return avgHr > 0 ? speedMmin / avgHr : 0;
};

/**
 * Eficiencia aeróbica: velocidad media en m/min dividida por la FC media
 * (m/min/bpm). Aplica los filtros de velocidad cero/FC cero y, si se pasa la
 * altitud, descarta los tramos con pendiente fuera de −2 % / +2 %.
 */
export const calculateEfficiencyFactor = (
    distances: number[],
    times: number[],
    heartrates: number[],
    altitudes?: number[]
): number => {
    return efficiencyFromSegments(buildEfficiencySegments(distances, times, heartrates, altitudes));
};

/**
 * Decoupling cardíaco: porcentaje de pérdida de eficiencia entre la primera y
 * la segunda mitad de la sesión, partidas por tiempo:
 *   (EF1 − EF2) / EF1 × 100
 * Un valor positivo indica deriva (la FC sube o la velocidad baja en la segunda
 * mitad). Devuelve 0 si no hay datos suficientes.
 */
export const calculateDecoupling = (
    altitudes: number[],
    distances: number[],
    times: number[],
    heartrates: number[]
): number => {
    const n = Math.min(altitudes.length, distances.length, times.length, heartrates.length);
    if (n < 2) return 0;

    const segments = buildEfficiencySegments(distances, times, heartrates, altitudes);
    if (segments.length === 0) return 0;

    // Cada tramo se asigna a una mitad por su punto medio temporal, no por su
    // instante de cierre: el tramo que cruza el corte no debe caer entero en la
    // segunda mitad, porque desequilibraría la comparación (con 200 muestras de
    // 1 s y velocidades constantes por mitad, el corte cae justo entre ambas).
    const midTime = (times[0] + times[n - 1]) / 2;
    const firstHalf = segments.filter(s => (s.startTime + s.time) / 2 <= midTime);
    const secondHalf = segments.filter(s => (s.startTime + s.time) / 2 > midTime);

    const ef1 = efficiencyFromSegments(firstHalf);
    const ef2 = efficiencyFromSegments(secondHalf);
    if (!(ef1 > 0)) return 0;
    return ((ef1 - ef2) / ef1) * 100;
};

/**
 * Estructura mínima de una sesión para detectar el umbral. Es una interfaz
 * propia y ligera (no el `Session` completo) para poder probar la función sola:
 * basta con el deporte, la fecha y los arrays de tiempo y distancia.
 */
export interface ThresholdSession {
    sport: string;              // 'RUNNING' o 'TRAIL_RUNNING' para que cuente
    date: string | number;      // fecha de inicio (ISO o epoch en ms)
    times: number[];            // instantes en segundos (relativos o absolutos)
    distances: number[];        // distancia acumulada en metros
}

/**
 * Umbral funcional estimado a partir de las sesiones de carrera de los últimos
 * 90 días. Busca en cada sesión el mejor esfuerzo sostenido de 20 minutos con
 * una ventana deslizante sobre tiempo y la distancia acumulada, con 5 s de
 * tolerancia de muestreo, y devuelve la media de los 3 mejores valores (m/s).
 *
 * @param now instante de referencia en milisegundos (por defecto, ahora);
 *            se expone para poder testear la ventana de 90 días sin depender
 *            del reloj real.
 */
export const detectThresholdPace = (sessions: ThresholdSession[], now: number = Date.now()): number => {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const WINDOW_SEC = 1200;
    const TOLERANCE_SEC = 5;

    const bestSpeeds: number[] = [];

    for (const session of sessions) {
        const isRunning = session.sport === 'RUNNING' || session.sport === 'TRAIL_RUNNING';
        if (!isRunning) continue;
        const sessionTime = new Date(session.date).getTime();
        if (!Number.isFinite(sessionTime) || now - sessionTime > NINETY_DAYS_MS) continue;

        const times = session.times;
        const dists = session.distances;
        const count = Math.min(times.length, dists.length);
        if (count < 2) continue;

        let maxSpeed = 0;
        let left = 0;
        for (let right = 1; right < count; right++) {
            while (times[right] - times[left] > WINDOW_SEC) left++;
            const duration = times[right] - times[left];
            if (duration >= WINDOW_SEC - TOLERANCE_SEC) {
                const distance = dists[right] - dists[left];
                const speedMps = distance / duration;
                if (speedMps > maxSpeed) maxSpeed = speedMps;
            }
        }
        if (maxSpeed > 0) bestSpeeds.push(maxSpeed);
    }

    if (bestSpeeds.length === 0) return 0;
    bestSpeeds.sort((a, b) => b - a);
    const top = bestSpeeds.slice(0, 3);
    return top.reduce((a, b) => a + b, 0) / top.length;
};

/**
 * Fronteras de las 6 zonas de ritmo derivadas de la velocidad de umbral, con
 * los mismos porcentajes que usa intervals.icu (77,5 % · 87,7 % · 94,3 % ·
 * 100 % · 103,4 % · 111,5 %). Devuelve los segundos por kilómetro de cada
 * frontera, de la más lenta a la más rápida.
 */
export const paceZonesFromThreshold = (thresholdSpeedMps: number): number[] => {
    const PERCENTAGES = [0.775, 0.877, 0.943, 1.0, 1.034, 1.115];
    if (!(thresholdSpeedMps > 0)) return [0, 0, 0, 0, 0, 0];
    return PERCENTAGES.map(pct => 1000 / (thresholdSpeedMps * pct));
};

export interface VentilatoryThresholds {
    vt1Hr: number;
    vt2Hr: number;
    source: 'customZones' | 'karvonen';
}

/**
 * Umbrales ventilatorios ESTIMADOS. No son una medición de laboratorio:
 * - Si el perfil tiene zonas personalizadas, se toman los topes de Z2 y Z4.
 * - Si no, se aplica Karvonen (60 % y 85 % de la reserva cardíaca).
 * El campo `source` permite a la interfaz etiquetarlos como estimación y
 * saber de dónde salen. No modifica ningún número respecto al cálculo previo.
 */
export const estimateVentilatoryThresholds = (
    profile: Pick<UserProfile, 'restHr' | 'maxHr' | 'customZones'>
): VentilatoryThresholds => {
    if (profile.customZones) {
        return { vt1Hr: profile.customZones.z2, vt2Hr: profile.customZones.z4, source: 'customZones' };
    }
    const fcr = profile.maxHr - profile.restHr;
    return {
        vt1Hr: Math.round(profile.restHr + 0.60 * fcr),
        vt2Hr: Math.round(profile.restHr + 0.85 * fcr),
        source: 'karvonen'
    };
};

/**
 * Potencia de carrera ESTIMADA (W). Sin potenciómetro no es una medida, solo
 * un modelo. Mantiene la escala clásica peso × velocidad × 1,04 y le añade el
 * factor de coste de Minetti, de modo que en llano (grade = 0) el valor no
 * cambia y en subida deja de quedarse corto.
 *
 * @param weightKg peso del corredor en kg
 * @param speedMps velocidad en m/s
 * @param grade pendiente en fracción (por defecto 0 = llano)
 */
export const estimatePower = (weightKg: number, speedMps: number, grade: number = 0): number => {
    if (!(weightKg > 0) || !(speedMps > 0)) return 0;
    return weightKg * speedMps * 1.04 * minettiCostFactor(grade);
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

// --- METEOROLOGÍA ---

const WMO_CODES: Record<number, string> = {
    0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
    45: 'Niebla', 48: 'Niebla con escarcha',
    51: 'Llovizna ligera', 53: 'Llovizna moderada', 55: 'Llovizna densa',
    61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia fuerte',
    71: 'Nieve ligera', 73: 'Nieve moderada', 75: 'Nieve fuerte',
    80: 'Chubascos ligeros', 81: 'Chubascos moderados', 82: 'Chubascos violentos',
    95: 'Tormenta', 96: 'Tormenta con granizo ligero', 99: 'Tormenta con granizo fuerte'
};

const WIND_DIRECTIONS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

export const fetchWeatherForSession = async (lat: number, lon: number, startTime: string, endTime: string): Promise<WeatherData | null> => {
    try {
        const startDate = startTime.substring(0, 10);
        const endDate = endTime.substring(0, 10);
        
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,precipitation,weather_code&timezone=Europe%2FMadrid`;
        
        const resp = await fetch(url);
        if (!resp.ok) {
            console.warn('[Weather] Response not OK:', resp.status, await resp.text().catch(() => ''));
            return null;
        }
        
        const data = await resp.json();
        const hourly = data.hourly;
        if (!hourly || !hourly.time) {
            console.warn('[Weather] No hourly data in response');
            return null;
        }
        
        // Encontrar las horas que caen dentro de la actividad
        const activityStart = new Date(startTime);
        const activityEnd = new Date(endTime);
        
        
        let sumTemp = 0, sumFeels = 0, sumHum = 0, sumWind = 0, sumWindDir = 0, sumPrecip = 0;
        let lastCode = 0;
        let count = 0;
        
        for (let i = 0; i < hourly.time.length; i++) {
            const hTime = new Date(hourly.time[i]);
            if (hTime >= activityStart && hTime <= activityEnd) {
                sumTemp += hourly.temperature_2m[i] || 0;
                sumFeels += hourly.apparent_temperature[i] || 0;
                sumHum += hourly.relative_humidity_2m[i] || 0;
                sumWind += hourly.wind_speed_10m[i] || 0;
                sumWindDir += hourly.wind_direction_10m[i] || 0;
                sumPrecip += hourly.precipitation[i] || 0;
                lastCode = hourly.weather_code[i] || 0;
                count++;
            }
        }
        
        if (count === 0) return null;
        
        const avgWindDir = sumWindDir / count;
        const dirIndex = Math.round(avgWindDir / 22.5) % 16;
        
        const result = {
            temperature: Math.round(sumTemp / count * 10) / 10,
            feelsLike: Math.round(sumFeels / count * 10) / 10,
            humidity: Math.round(sumHum / count),
            windSpeed: Math.round(sumWind / count * 10) / 10,
            windDirection: Math.round(avgWindDir),
            precipitation: Math.round(sumPrecip * 10) / 10,
            weatherCode: lastCode,
            weatherDescription: WMO_CODES[lastCode] || 'Desconocido'
        };
        return result;
    } catch (e) {
        console.error('[Weather] EXCEPTION:', e);
        return null;
    }
};

export const getWindDirectionLabel = (degrees: number): string => {
    const index = Math.round(degrees / 22.5) % 16;
    return WIND_DIRECTIONS[index] || 'N';
};