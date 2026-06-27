
export interface UserProfile {
    age: number;
    weight: number; 
    height: number;
    gender: 'male' | 'female';
    restHr: number;
    maxHr: number;
    intervalsApiKey?: string;
    intervalsAthleteId?: string;
    // Zonas personalizadas: guarda el límite SUPERIOR de cada zona
    customZones?: {
        z1: number; // Final de Z1
        z2: number; // Final de Z2
        z3: number; // Final de Z3
        z4: number; // Final de Z4
        // Z5 es automáticamente desde z4 hasta maxHr
    };
}

export interface WeatherData {
    temperature: number;        // °C media durante la actividad
    feelsLike: number;          // Sensación térmica (°C)
    humidity: number;           // % humedad relativa
    windSpeed: number;          // km/h
    windDirection: number;      // grados (0=N, 90=E, 180=S, 270=O)
    precipitation: number;      // mm
    weatherCode: number;        // Código WMO
    weatherDescription: string; // Ej: "Parcialmente nublado"
}

export interface TrackPoint {
  lat: number;
  lon: number;
  timestamp: string | number | Date; 
  hr: number;
  speed: number; 
  altitude: number; 
  cadence?: number;
  dist: number;
  // Dinámicas de carrera
  strideLength?: number; // Metros
  groundContactTime?: number; // ms
  verticalOscillation?: number; // mm
  verticalRatio?: number; // %
}

// Interfaz ligera para listas y dashboards
export interface SessionSummary {
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
  trimp: number;
  climbScore: number;
  avgStrideLength?: number;
  avgGroundContactTime?: number;
  avgVerticalOscillation?: number;
  avgVerticalRatio?: number;
  // Métricas de Carga Subjetiva
  rpe?: number; // Escala 0-10 (Borg CR10 / Foster)
  internalLoad?: number; // sRPE (RPE * Duración en min) - Unidades Arbitrarias de Carga (UAC)
  // Meteorología
  weather?: WeatherData;
}

// Interfaz completa que extiende el resumen e incluye los datos pesados
export interface Session extends SessionSummary {
  trackPoints: TrackPoint[];
}

export interface Notification {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

export interface DailyFitness {
    date: string;
    ctl: number; 
    atl: number; 
    tsb: number; 
    trimp: number; 
}

export interface AcwrResult {
    acuteLoad: number;
    chronicLoad: number;
    ratio: number;
    status: 'OPTIMAL' | 'CAUTION' | 'DANGER' | 'UNDEFINED';
}