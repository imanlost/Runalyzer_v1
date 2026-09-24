// Test unitario mínimo de las utilidades de cálculo.
//
// El proyecto no tiene framework de test instalado, así que este fichero usa el
// runner nativo de Node (`node:test`) y no se añade ninguna dependencia.
// El código es TypeScript; para ejecutarlo sin instalar nada se puede bundlear
// con esbuild (ya presente como dependencia de Vite) y lanzar Node:
//
//   npx esbuild tests/utils.test.ts --bundle --platform=node --format=esm \
//     --outfile=/tmp/runalyzer-tests.mjs && node --test /tmp/runalyzer-tests.mjs
//
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    formatMetric,
    formatPace,
    calculateElevationGain,
    calculateSlidingWindowMaxSpeed,
    calculateGradeAdjustedPace,
    calculateEfficiencyFactor,
    calculateDecoupling,
    detectThresholdPace,
    paceZonesFromThreshold,
    estimateVentilatoryThresholds,
    estimatePower,
    calculateACSMVo2,
} from '../utils.ts';
import type { ThresholdSession } from '../utils.ts';

// --- Utilidades de los tests ---

// Ritmo en formato m:ss truncando los segundos (276,6 s → 4:36). Es el mismo
// criterio con el que el encargo expresó los valores esperados.
const paceLabel = (secondsPerKm: number) => {
    const total = Math.floor(secondsPerKm);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' + s : s}`;
};

const assertClose = (actual: number, expected: number, tolerance: number, message: string) => {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: esperaba ${expected}, obtuve ${actual}`);
};

// --- Formato y desnivel (tests previos) ---

test('formatMetric redondea a 0 decimales por defecto', () => {
    assert.equal(formatMetric(59233.491416000004), '59233');
    assert.equal(formatMetric(1234.56), '1235');
    assert.equal(formatMetric(0), '0');
    assert.equal(formatMetric(-12.4), '-12');
});

test('formatMetric respeta el número de decimales pedido', () => {
    assert.equal(formatMetric(12.345, 2), '12.35');
    assert.equal(formatMetric(12345.6789, 2), '12345.68');
});

test('formatMetric es tolerante a valores inválidos o no numéricos', () => {
    assert.equal(formatMetric(null), '--');
    assert.equal(formatMetric(undefined), '--');
    assert.equal(formatMetric(NaN), '--');
    assert.equal(formatMetric(Infinity), '--');
    assert.equal(formatMetric('123'), '--');
    assert.equal(formatMetric({}), '--');
});

test('formatPace redondea el total de segundos antes de descomponerlo', () => {
    // 3,9998 min = 239,988 s → 240 s = 4'00'' (antes salía 3'60'').
    assert.equal(formatPace(3.9998), "4'00''");
    // 4,4586 min = 267,516 s → 268 s = 4'28''.
    assert.equal(formatPace(4.4586), "4'28''");
    // El caso normal no cambia.
    assert.equal(formatPace(6), "6'00''");
    assert.equal(formatPace(4.5), "4'30''");
    // Un ritmo inválido sigue devolviendo el marcador.
    assert.equal(formatPace(0), '--');
    assert.equal(formatPace(-1), '--');
    assert.equal(formatPace(NaN), '--');
});

test('calculateElevationGain suaviza el ruido del altímetro y da 0 en terreno llano', () => {
    // Ruido de ±0.3 m alrededor de una altitud fija no debe acumular nada
    assert.equal(calculateElevationGain([100, 100.3, 99.8, 100.2, 99.9, 100.1]), 0);
    // Los huecos de altitud (0) se ignoran como dato ausente
    assert.equal(calculateElevationGain([0, 0, 0]), 0);
    // Un tramo inicial a 0 no debe contar como subida hasta el primer dato real
    assert.equal(calculateElevationGain([0, 0, 100, 100.4]), 0);
});

test('calculateElevationGain ignora un pico aislado gracias al suavizado de 15 muestras', () => {
    // Un único pico de +5 m se reparte entre las 15 muestras de la media móvil
    // (aporta 5/15 ≈ 0.33 m) y queda por debajo de la histéresis de 0,5 m.
    const spike = Array.from({ length: 20 }, (_, i) => (i === 10 ? 105 : 100));
    assert.equal(calculateElevationGain(spike), 0);
});

test('calculateElevationGain acumula el desnivel neto real descartando el ruido', () => {
    // Subida neta de 10 m a lo largo de 201 muestras con ruido de ±0.4 m.
    // El cálculo punto a punto infla el desnivel (~49 m); con el suavizado
    // previo + histéresis de 0,5 m queda pegado al neto real.
    const noisyClimb = Array.from({ length: 201 }, (_, i) => 100 + i * 0.05 + 0.4 * Math.sin(i * 2.1));
    let pointToPoint = 0;
    for (let i = 1; i < noisyClimb.length; i++) {
        if (noisyClimb[i] > noisyClimb[i - 1]) pointToPoint += noisyClimb[i] - noisyClimb[i - 1];
    }
    const gain = calculateElevationGain(noisyClimb);
    assert.ok(gain > 9 && gain < 10.5, `esperaba ~10 m, obtuve ${gain}`);
    assert.ok(gain < pointToPoint / 2, `el suavizado debería bajar de ${pointToPoint}, obtuve ${gain}`);
});

test('calculateSlidingWindowMaxSpeed exige la ventana con solo 3 s de tolerancia', () => {
    // Los primeros 324 s a 5 m/s y el resto hasta 360 s a 0.5 m/s.
    // La ventana de 324 s daría 5 m/s, pero la de 360 s da 4.55 m/s.
    const trackPoints = Array.from({ length: 361 }, (_, t) => ({
        lat: 0, lon: 0, timestamp: new Date(t * 1000).toISOString(), hr: 0,
        speed: 0, altitude: 0, dist: t <= 324 ? t * 5 : 324 * 5 + (t - 324) * 0.5, cadence: 0
    }));
    const speed = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    assert.ok(speed > 4.5 && speed < 4.6, `esperaba ~4.55 m/s, obtuve ${speed}`);
});

test('calculateSlidingWindowMaxSpeed tolera relojes que no muestrean a 1 Hz', () => {
    // Muestreo a 1,3 s: ninguna ventana alcanza los 360 s exactos; la mayor
    // dentro del límite dura 358,8 s (>= 357 s). Sin la tolerancia de 3 s la
    // VAM sería 0 en silencio.
    const trackPoints = Array.from({ length: 350 }, (_, i) => {
        const t = i * 1.3;
        return {
            lat: 0, lon: 0, timestamp: new Date(t * 1000).toISOString(), hr: 0,
            speed: 5, altitude: 0, dist: 5 * t, cadence: 0
        };
    });
    const speed = calculateSlidingWindowMaxSpeed(trackPoints, 360);
    assert.ok(speed > 4.9 && speed < 5.1, `esperaba ~5 m/s, obtuve ${speed}`);
});

// --- TAREA 1: ritmo ajustado por pendiente (GAP) ---
//
// Caso base: 11 muestras cada 100 m (0 a 1000 m) y 36 s por cada 100 m, es
// decir 6:00/km reales. La altitud sube o baja de forma lineal con la pendiente
// pedida. El factor de Minetti esperado se obtiene de Cr(i)/Cr(0).
const gapDistances = Array.from({ length: 11 }, (_, i) => i * 100);
const gapTimes = gapDistances.map(d => (d / 100) * 36);
const gapForGrade = (grade: number) => {
    const altitudes = gapDistances.map(d => 100 + d * grade);
    return calculateGradeAdjustedPace(altitudes, gapDistances, gapTimes);
};

test('GAP en llano no cambia el ritmo y deja el factor en 1', () => {
    const gap = gapForGrade(0);
    assertClose(gap, 360, 0.01, 'GAP a 0 %');
    assert.equal(paceLabel(gap), '6:00');
    assertClose(360 / gap, 1.0, 1e-9, 'factor a 0 %');
});

test('GAP a +5 % da 276,62 s/km (tolerancia 0,5 s)', () => {
    const gap = gapForGrade(0.05);
    // Se comprueba el número que devuelve la función sin truncarlo a m:ss; la
    // presentación la resuelve formatPace. Tolerancia de ±0,5 s.
    assertClose(gap, 276.62, 0.5, 'GAP a +5 %');
    assertClose(360 / gap, 1.301443, 1e-5, 'factor a +5 %');
});

test('GAP a −5 % da 471,97 s/km (tolerancia 0,5 s)', () => {
    const gap = gapForGrade(-0.05);
    assertClose(gap, 471.97, 0.5, 'GAP a −5 %');
    assertClose(360 / gap, 0.762757, 1e-5, 'factor a −5 %');
});

test('GAP a +10,8 % da 3:29/km con factor 1,719', () => {
    const gap = gapForGrade(0.108);
    assertClose(gap, 209.382, 0.01, 'GAP a +10,8 %');
    assert.equal(paceLabel(gap), '3:29');
    assertClose(360 / gap, 1.719345, 1e-5, 'factor a +10,8 %');
});

test('GAP a −15 % recorta el factor al suelo 0,70 y da 8:34/km', () => {
    const gap = gapForGrade(-0.15);
    // Sin suelo, el modelo de Minetti daría un factor de 0,510 y un GAP irreal.
    assertClose(360 / gap, 0.70, 1e-9, 'factor recortado a −15 %');
    assertClose(gap, 514.286, 0.01, 'GAP a −15 %');
    assert.equal(paceLabel(gap), '8:34');
});

test('GAP tolera huecos de altitud (0) sin romper el cálculo', () => {
    // Con un hueco en una muestra, la ventana que lo toca se descarta y el resto
    // se sigue acumulando: el GAP no debe salir 0 ni NaN.
    const altitudes = gapDistances.map(d => 100 + d * 0.05);
    altitudes[5] = 0;
    const gap = calculateGradeAdjustedPace(altitudes, gapDistances, gapTimes);
    assert.ok(Number.isFinite(gap) && gap > 0, `esperaba un GAP finito, obtuve ${gap}`);
});

// --- TAREA 2: eficiencia aeróbica y decoupling ---
//
// 200 muestras a 1 s, altitud y pendiente 0.
const efTimes = Array.from({ length: 200 }, (_, i) => i);
const efConstantHr = (hr: number) => new Array(200).fill(hr);
const efConstantDist = (speed: number) => efTimes.map(t => t * speed);
// Distancia de la sesión mixta: primera mitad a 3,0 m/s y segunda a 2,7 m/s.
const mixedDist = efTimes.map(t => (t < 100 ? t * 3.0 : 300 + (t - 100) * 2.7));

test('calculateEfficiencyFactor da 1,20 m/min/bpm con velocidad y FC constantes', () => {
    const ef = calculateEfficiencyFactor(efConstantDist(3.0), efTimes, efConstantHr(150));
    assertClose(ef, 1.20, 1e-9, 'EF constante');
});

test('calculateDecoupling da 10,0 % si la velocidad cae un 10 % con la misma FC', () => {
    const decoupling = calculateDecoupling(
        new Array(200).fill(0), mixedDist, efTimes, efConstantHr(150)
    );
    assertClose(decoupling, 10.0, 1e-9, 'decoupling con FC constante');
});

test('calculateDecoupling da 0,0 % si la FC cae en la misma proporción que la velocidad', () => {
    const hr = efTimes.map(t => (t < 100 ? 150 : 135));
    const decoupling = calculateDecoupling(new Array(200).fill(0), mixedDist, efTimes, hr);
    assertClose(decoupling, 0.0, 1e-9, 'decoupling de control');
});

test('calculateEfficiencyFactor descarta una sesión con pendiente al 5 %', () => {
    // Altitud coherente con la pendiente: todos los tramos quedan fuera de
    // −2 %/+2 %, así que no hay ningún tramo válido y la EF es 0.
    const altitudes = efTimes.map(t => 100 + t * 3.0 * 0.05);
    const ef = calculateEfficiencyFactor(efConstantDist(3.0), efTimes, efConstantHr(150), altitudes);
    assert.equal(ef, 0);
});

test('calculateEfficiencyFactor descarta los puntos con velocidad o FC cero', () => {
    // Media sesión parada (velocidad 0) y la otra con FC 0: no debe quedar
    // ningún tramo válido.
    const dist = efTimes.map(t => (t < 100 ? 0 : (t - 100) * 3.0));
    const ef = calculateEfficiencyFactor(dist, efTimes, new Array(200).fill(0));
    assert.equal(ef, 0);
});

// --- TAREA 3: umbral y zonas propias ---
//
// Tres sesiones de 25 min (1500 muestras a 1 s) a 3,738 m/s constante.
const thresholdTimes = Array.from({ length: 1501 }, (_, i) => i);
const thresholdDistances = thresholdTimes.map(t => t * 3.738);
const thresholdSession = (daysAgo: number, now: number): ThresholdSession => ({
    sport: 'RUNNING',
    date: now - daysAgo * 24 * 60 * 60 * 1000,
    times: thresholdTimes,
    distances: thresholdDistances,
});

test('detectThresholdPace promedia los 3 mejores esfuerzos de 20 min en m/s', () => {
    const now = new Date('2024-06-01T12:00:00Z').getTime();
    const threshold = detectThresholdPace(
        [thresholdSession(1, now), thresholdSession(10, now), thresholdSession(20, now)],
        now
    );
    assertClose(threshold, 3.738, 1e-6, 'umbral de 20 min');
});

test('detectThresholdPace ignora las sesiones fuera de los últimos 90 días', () => {
    const now = new Date('2024-06-01T12:00:00Z').getTime();
    const threshold = detectThresholdPace([thresholdSession(120, now)], now);
    assert.equal(threshold, 0);
});

test('detectThresholdPace no deja que un parón entre en la mejor ventana de 20 min', () => {
    // 20 min corriendo + 60 s parado + 20 min corriendo. La mejor ventana es
    // una de las dos partes limpias (3,738 m/s); si el parón se colara, la
    // media bajaría a ~3,55 m/s.
    const times: number[] = [];
    const distances: number[] = [];
    let dist = 0;
    for (let t = 0; t <= 2460; t++) {
        times.push(t);
        distances.push(dist);
        if (t < 1200 || t >= 1260) dist += 3.738;
    }
    const now = new Date('2024-06-01T12:00:00Z').getTime();
    const session: ThresholdSession = {
        sport: 'RUNNING',
        date: now - 2 * 24 * 60 * 60 * 1000,
        times,
        distances,
    };
    const threshold = detectThresholdPace([session], now);
    assertClose(threshold, 3.738, 1e-6, 'umbral con parón');
    assert.ok(threshold > 3.6, `el parón no debe entrar en la ventana; obtuve ${threshold}`);
});

test('paceZonesFromThreshold usa los porcentajes de intervals.icu', () => {
    const zones = paceZonesFromThreshold(3.738);
    // Fronteras en s/km: 345,19 · 305,04 · 283,69 · 267,52 · 258,73 · 239,93
    assert.deepEqual(zones.map(paceLabel), ['5:45', '5:05', '4:43', '4:27', '4:18', '3:59']);
    assertClose(zones[0], 1000 / (3.738 * 0.775), 1e-9, 'Z1');
    assertClose(zones[3], 1000 / 3.738, 1e-9, 'umbral');
    assertClose(zones[5], 1000 / (3.738 * 1.115), 1e-9, 'Z6');
});

// --- TAREA 4: honestidad de VO2max y umbrales ventilatorios ---

test('estimateVentilatoryThresholds etiqueta el origen y no cambia los números', () => {
    // Sin zonas personalizadas: Karvonen (60 % y 85 % de la reserva cardíaca).
    const karvonen = estimateVentilatoryThresholds({ restHr: 45, maxHr: 190, customZones: undefined });
    assert.equal(karvonen.source, 'karvonen');
    assert.equal(karvonen.vt1Hr, Math.round(45 + 0.60 * (190 - 45)));
    assert.equal(karvonen.vt2Hr, Math.round(45 + 0.85 * (190 - 45)));
    assert.equal(karvonen.vt1Hr, 132);
    assert.equal(karvonen.vt2Hr, 168);

    // Con zonas personalizadas: topes de Z2 y Z4.
    const custom = estimateVentilatoryThresholds({
        restHr: 45,
        maxHr: 190,
        customZones: { z1: 120, z2: 140, z3: 155, z4: 170 },
    });
    assert.equal(custom.source, 'customZones');
    assert.equal(custom.vt1Hr, 140);
    assert.equal(custom.vt2Hr, 170);
});

test('calculateACSMVo2 usa la FC de reposo recibida (no la fija a 60)', () => {
    // 400 s a 3 m/s y FC 170 constante: con una FC de reposo menor la
    // intensidad relativa sube y el VO2max estimado baja. Si la función
    // ignorase `restHr`, ambos valores serían idénticos.
    const points = Array.from({ length: 400 }, (_, t) => ({
        lat: 0, lon: 0, timestamp: new Date(t * 1000).toISOString(), hr: 170,
        speed: 3.0 * 3.6, altitude: 100, dist: t * 3.0, cadence: 0
    }));
    const with45 = calculateACSMVo2(points, 190, 45);
    const with60 = calculateACSMVo2(points, 190, 60);
    assert.ok(with45 > 0 && with60 > 0, `esperaba VO2max positivos, obtuve ${with45} y ${with60}`);
    assert.ok(with45 < with60, `con restHr 45 debería salir menor que con 60: ${with45} vs ${with60}`);
});

// --- TAREA 5: potencia estimada con pendiente ---

test('estimatePower mantiene la escala en llano y sube con la pendiente', () => {
    const flat = estimatePower(78, 3.0, 0);
    const uphill = estimatePower(78, 3.0, 0.05);
    // 78 × 3,0 × 1,04 = 243,36 W → 243 W sin decimales.
    assertClose(flat, 243.36, 1e-9, 'potencia en llano');
    assert.equal(formatMetric(flat), '243');
    // Con el factor de Minetti a +5 % (1,301): 316,7 W → 317 W.
    assertClose(uphill, flat * 1.301443, 1e-3, 'potencia a +5 %');
    assert.equal(formatMetric(uphill), '317');
});
