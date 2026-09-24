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
import { formatMetric } from '../utils.ts';

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
