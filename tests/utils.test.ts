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
import { formatMetric, calculateElevationGain, calculateSlidingWindowMaxSpeed } from '../utils.ts';

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


