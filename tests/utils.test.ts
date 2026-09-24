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
    calculateElevationGain,
    calculateSlidingWindowMaxSpeed,
    calculateGradeAdjustedPace,
} from '../utils.ts';

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

test('GAP a +5 % da 4:36/km con factor 1,301', () => {
    const gap = gapForGrade(0.05);
    assertClose(gap, 276.616, 0.01, 'GAP a +5 %');
    assert.equal(paceLabel(gap), '4:36');
    assertClose(360 / gap, 1.301443, 1e-5, 'factor a +5 %');
});

test('GAP a −5 % da 7:51/km con factor 0,763', () => {
    const gap = gapForGrade(-0.05);
    assertClose(gap, 471.972, 0.01, 'GAP a −5 %');
    assert.equal(paceLabel(gap), '7:51');
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
