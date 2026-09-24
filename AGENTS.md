# Runalyzer

Aplicación para analizar actividades deportivas (running/ciclismo) a partir de datos de
intervals.icu. Versión de escritorio con envoltorio Tauri.

## Stack

- Vite + React + TypeScript.
- Tauri para la versión de escritorio (`src-tauri/`).
- Datos desde la API REST de intervals.icu.

## Comandos

| Para qué | Comando |
|---|---|
| Arrancar en desarrollo | `npm run dev` |
| Compilar | `npm run build` |
| Previsualizar el build | `npm run preview` |
| Comprobar tipos | `npm run lint` (`tsc --noEmit`) |
| Banco de pruebas del motor | `npm test` |
| Tauri | `npm run tauri <build\|dev>` |

## Estructura

- `src/` — código de la aplicación.
- `src-tauri/` — backend y configuración del escritorio.
- `dist/` — artefacto generado.

## Convenciones del proyecto

- **Los números de la interfaz van SIN decimales** por defecto: formatear siempre con el helper
  `formatMetric` de `utils.ts` (0 decimales). Excepciones: la distancia en km (2 decimales) y los
  valores donde el decimal informa (eficiencia, VO2max, potencia, ratio ACWR), que usan 1 o 2.
  No volver a formatear a mano con `toFixed` ni con `Math.round` suelto en las vistas.
- **Estilos**: Tailwind con las mismas clases que ya usa la aplicación, incluidas las de alfa
  (`bg-white/5`, `border-white/10`), que son el lenguaje visual vigente. Los estilos inline
  (`style={{ ... }}`) se reservan para lo que Tailwind no cubre: coordenadas de SVG y valores
  calculados en tiempo de ejecución.
- **Los cálculos fisiológicos viven en `utils.ts` como funciones puras** (GAP, eficiencia aeróbica,
  decoupling, umbral, zonas de ritmo, potencia y VO2max). Cada una lleva su caso de prueba con
  valores numéricos conocidos en `tests/utils.test.ts`. No se meten fórmulas dentro de los
  componentes de la interfaz.
- **API del tiempo**: el campo `endTime` va en hora local y **sin** la `Z` final.
- **Release por tag `v*`** en el repositorio.
- Commits en español con formato `tipo: descripción` (`feat:`, `fix:`, `docs:`, `chore:`).

## No tocar

- `node_modules/` y `dist/` — artefactos generados.
- Credenciales o claves de API: no imprimirlas en la salida.

## Antes de dar algo por terminado

- `npm run lint` sin errores, `npm test` en verde y `npm run build` correcto.
- Si toca cálculos o gráficas: comprobar los números redondeados, no solo que compile.
- Commit hecho (o dicho claramente si no lo está).
