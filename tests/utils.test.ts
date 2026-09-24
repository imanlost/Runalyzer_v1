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
import { formatMetric, calculateElevationGain } from '../utils.ts';

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

test('calculateElevationGain ignora las oscilaciones del altímetro por debajo de 1 m', () => {
    // Ruido de ±0.3 m alrededor de una altitud fija no debe acumular nada
    assert.equal(calculateElevationGain([100, 100.3, 99.8, 100.2, 99.9, 100.1]), 0);
    // Los huecos de altitud (0) se ignoran como dato ausente
    assert.equal(calculateElevationGain([0, 0, 0]), 0);
    // Un tramo inicial a 0 no debe contar como subida hasta el primer dato real
    assert.equal(calculateElevationGain([0, 0, 100, 100.4]), 0);
});

test('calculateElevationGain acumula el desnivel neto real', () => {
    // Subida gradual de 0 a 10 m en pasos de 0.5 m: debe dar 10, no 0 ni más
    const climb = Array.from({ length: 21 }, (_, i) => 100 + i * 0.5);
    assert.equal(calculateElevationGain(climb), 10);
    // Subida y bajada: solo cuenta la parte positiva
    assert.equal(calculateElevationGain([100, 105, 95]), 5);
    // Terreno ondulado: se cuentan las dos subidas reales separadas por un descenso
    assert.equal(calculateElevationGain([100, 105, 95, 100]), 10);
});

