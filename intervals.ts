import { Session, TrackPoint } from './types';
import { calculateTRIMP, calculateACSMVo2, calculateClimbScore, calculateAverageStrideLength } from './utils';

import { fetchWeatherForSession } from './utils';

// Helper to convert base64 for Basic Auth
const getAuthHeader = (apiKey: string) => {
    return 'Basic ' + btoa('API_KEY:' + apiKey);
};

export const fetchIntervalsActivities = async (athleteId: string, apiKey: string, oldestStr?: string, newestStr?: string): Promise<any[]> => {
    let url = `https://intervals.icu/api/v1/athlete/${athleteId}/activities`;
    const params = new URLSearchParams();
    if (oldestStr) params.append('oldest', oldestStr);
    if (newestStr) params.append('newest', newestStr);
    if (params.toString()) {
        url += '?' + params.toString();
    }

    const res = await fetch(url, {
        headers: {
            'Authorization': getAuthHeader(apiKey)
        }
    });

    if (!res.ok) {
        throw new Error(`Error intervalos: ${res.status} ${await res.text()}`);
    }

    return await res.json();
};

export const fetchIntervalsActivityStreams = async (activityId: string, apiKey: string): Promise<any> => {
    // type puede ser time, latlng, heartrate, velocity_smooth, altitude, cadence
    const url = `https://intervals.icu/api/v1/activity/${activityId}/streams?types=time,latlng,heartrate,velocity_smooth,altitude,cadence,distance`;
    
    const res = await fetch(url, {
        headers: {
            'Authorization': getAuthHeader(apiKey)
        }
    });

    if (!res.ok) {
        throw new Error(`Error streams: ${res.status}`);
    }

    return await res.json();
};

export const importFromIntervals = async (athleteId: string, apiKey: string, onProgress: (msg: string) => void, maxActivities: number = 10): Promise<Session[]> => {
    onProgress("Obteniendo lista de actividades desde Intervals.icu...");
    const activities = await fetchIntervalsActivities(athleteId, apiKey, '2010-01-01');
    const sessions: Session[] = [];

    // Importar solo las últimas N actividades (por defecto 10) para evitar duplicados masivos
    const toProcess = activities.slice(0, maxActivities);

    let count = 0;
    for (const act of toProcess) {
        count++;
        onProgress(`Descargando datos detallados... (${count}/${toProcess.length}) - ${act.name}`);
        
        try {
            const streams = await fetchIntervalsActivityStreams(act.id, apiKey);
            
            // Reconstruct trackpoints
            const trackPoints: TrackPoint[] = [];
            const timeStream = streams.find((s: any) => s.type === 'time')?.data || [];
            if (timeStream.length === 0) continue; // Skip activities without streams

            const latlngStreamObj = streams.find((s: any) => s.type === 'latlng');
            const latStream = latlngStreamObj?.data || [];
            const lonStream = latlngStreamObj?.data2 || [];
            const hrStream = streams.find((s: any) => s.type === 'heartrate')?.data || [];
            const speedStream = streams.find((s: any) => s.type === 'velocity_smooth')?.data || []; // m/s
            const altStream = streams.find((s: any) => s.type === 'altitude')?.data || [];
            const cadenceStream = streams.find((s: any) => s.type === 'cadence')?.data || [];
            const distStream = streams.find((s: any) => s.type === 'distance')?.data || [];

            const startTimeTimestamp = new Date(act.start_date_local).getTime();

            for (let i = 0; i < timeStream.length; i++) {
                const tp: TrackPoint = {
                    timestamp: startTimeTimestamp + timeStream[i] * 1000,
                    lat: latStream[i] || 0,
                    lon: lonStream[i] || 0,
                    hr: hrStream[i] || 0,
                    speed: (speedStream[i] || 0) * 3.6, // Convertir m/s → km/h (consistente con parsers.ts)
                    altitude: altStream[i] || 0,
                    dist: distStream[i] || 0,
                    cadence: cadenceStream[i] || 0
                };
                // Only push if valid coordinates
                if (tp.lat && tp.lon) {
                    trackPoints.push(tp);
                }
            }

            if (trackPoints.length === 0) continue;

            // Recalculate metrics
            const distance = act.distance || (trackPoints[trackPoints.length-1].dist - trackPoints[0].dist);
            const duration = act.moving_time || act.elapsed_time || timeStream[timeStream.length-1];
            
            let sport = 'ACTIVITY';
            if (act.type === 'Run') sport = 'RUNNING';
            else if (act.type === 'Ride') sport = 'CYCLING';
            else if (act.type === 'Swim') sport = 'SWIMMING';

            const validHrs = trackPoints.filter(p => p.hr > 0).map(p => p.hr);
            const avgHr = validHrs.length > 0 ? Math.round(validHrs.reduce((a,b)=>a+b,0)/validHrs.length) : Math.round(act.average_heartrate || 0);
            const maxHr = validHrs.length > 0 ? Math.max(...validHrs) : (act.max_heartrate || 0);

            const session: Session = {
                id: `intervals-${act.id}`,
                name: act.name,
                startTime: act.start_date_local,
                duration: duration,
                distance: distance,
                sport: sport,
                avgHr: avgHr,
                maxHr: maxHr,
                calories: Math.round(act.calories || Math.round((duration/60) * 12)),
                totalElevationGain: Math.round(act.total_elevation_gain || 0),
                avgCadence: act.average_cadence || 0,
                vam6min: 0, 
                best20minSpeed: 0,
                acsmVo2Max: 0,
                trimp: act.icu_training_load || 0,
                climbScore: 0,
                trackPoints: trackPoints,
                rpe: act.rpe
            };

            // Calculate extra metrics
            session.acsmVo2Max = calculateACSMVo2(trackPoints, maxHr || 190, 60);
            session.trimp = session.trimp || calculateTRIMP(trackPoints, maxHr || 190, 60);
            session.climbScore = calculateClimbScore(session.totalElevationGain, session.distance);

            // Fetch weather data for the session
            const validCoords = trackPoints.filter(p => p.lat !== 0 && p.lon !== 0);
            if (validCoords.length > 0) {
                const startLat = validCoords[0].lat;
                const startLon = validCoords[0].lon;
                const endTime = new Date(act.start_date_local).getTime() + duration * 1000;
                const ed = new Date(endTime);
                const pad2 = (n: number) => String(n).padStart(2, '0');
                const endTimeStr = `${ed.getFullYear()}-${pad2(ed.getMonth()+1)}-${pad2(ed.getDate())}T${pad2(ed.getHours())}:${pad2(ed.getMinutes())}:${pad2(ed.getSeconds())}`;
                try {
                    session.weather = await fetchWeatherForSession(startLat, startLon, act.start_date_local, endTimeStr);
                } catch (e) {
                    console.warn('Weather fetch failed for session', act.id, e);
                }
            }

            sessions.push(session);

        } catch (e: any) {
            console.error(`Error procesando actividad ${act.id}`, e);
        }
    }

    onProgress(`Completado. ${sessions.length} actividades procesadas.`);
    return sessions;
};
