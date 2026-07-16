# 🏃 RunAlyzer

**Plataforma de análisis de rendimiento para corredores** — importa, visualiza y analiza tus entrenamientos con métricas avanzadas de fisiología del ejercicio.

[![Deploy to Vercel](https://github.com/imanlost/Runalyzer_v1/actions/workflows/deploy-vercel.yml/badge.svg)](https://github.com/imanlost/Runalyzer_v1/actions/workflows/deploy-vercel.yml)
[![Version](https://img.shields.io/badge/version-0.1.12-blue)](https://github.com/imanlost/Runalyzer_v1/releases)

---

## ✨ Funcionalidades

### 📥 Importación de sesiones
| Formato | Fuente |
|---------|--------|
| `.fit` | Relojes Garmin, Suunto, Polar, COROS... |
| `.csv` | Exportaciones genéricas (columnas: timestamp, hr, speed, dist, alt, cadence...) |
| `.json` | Polar Flow (formato JSON de exportación) |
| 🔗 Intervals.icu | Sincronización directa vía API (streams completos: HR, velocidad, altitud, cadencia, coordenadas) |

### 📊 Dashboard de análisis
- **VO₂max** — fisiológico (ACSM) y de rendimiento (VAM 6 min)
- **TRIMP** — Training Impulse (carga de entrenamiento basada en FC)
- **Climb Score** — puntuación de desnivel acumulado
- **CTL / ATL / TSB** — modelo de Fitness-Fatiga (Banister)
- **ACWR** — Acute:Chronic Workload Ratio (prevención de lesiones)
- **Predictor de marcas** — basado en factor de fatiga individualizado (Riegel modificado)
- **Eficiencia de carrera** — relación velocidad / frecuencia cardíaca
- **Potencia estimada** — vatios teóricos en llano

### 🗺️ Visualización interactiva
- **Mapa Leaflet** con reproducción de ruta (playback punto a punto)
- **Barra de desplazamiento** (scrubber) para seguir ritmo, FC y altitud en tiempo real
- **Gráfico de elevación** con perfil de altimetría
- **Distribución de zonas** de frecuencia cardíaca (5 zonas personalizables)
- **Heatmap global** de todas las rutas

### 📈 Análisis avanzado
- **Tendencias de fitness** (CTL/ATL/TSB a lo largo del tiempo)
- **Asesor de recuperación** — recomendaciones según TSB y carga aguda
- **Distribución de intensidad** — % en cada zona de entrenamiento
- **Récords personales** — mejores marcas por distancia detectadas automáticamente
- **Volumen semanal** — gráfico de barras por semana
- **Estadísticas agregadas** — totales, promedios y tendencias

### 🌤️ Meteorología
- Datos históricos de **Open-Meteo** (temperatura, sensación térmica, humedad, viento, precipitación)
- Se cargan automáticamente al importar una sesión con coordenadas GPS
- Alertas visuales por calor (>25 °C) y viento fuerte

### 🖥️ Multi-plataforma
- **Web app** (Vercel) — accesible desde cualquier navegador
- **Desktop app** (Tauri v2) — paquete `.deb` para Linux, datos locales con IndexedDB
- Interfaz responsive, modo oscuro

---

## 🚀 Quick Start

### Desarrollo local

```bash
# Clonar
git clone https://github.com/imanlost/Runalyzer_v1.git
cd Runalyzer_v1

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev        # → http://localhost:5173
```

### Producción

```bash
npm run build      # → dist/
npm run preview    # Previsualizar build
```

### Desktop (Tauri)

```bash
npm run tauri dev      # Modo desarrollo con hot reload
npm run tauri build    # Generar .deb
```

---

## 🏗️ Arquitectura

```
Runalyzer_v1/
├── index.tsx           # Entry point + App principal + Sidebar
├── analytics.tsx       # Componentes de análisis (gráficos, mapas, dashboards)
├── components.tsx      # Componentes UI reutilizables (MetricCard, Modal, etc.)
├── icons.tsx           # Iconos Lucide + configuración por deporte
├── types.ts            # Interfaces TypeScript (Session, TrackPoint, UserProfile...)
├── utils.ts            # Cálculos fisiológicos (TRIMP, VO2max, ACWR, ACWR...)
├── parsers.ts           # Parsers de archivos (.fit, .csv, Polar JSON)
├── intervals.ts        # Integración con API de Intervals.icu
├── db.ts               # Persistencia en IndexedDB
├── vite.config.ts      # Configuración de Vite + Tailwind
├── index.html          # Shell HTML
└── src-tauri/          # App de escritorio Tauri (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
```

### Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + TypeScript |
| Bundler | Vite 6 |
| Estilos | Tailwind CSS 4 |
| Mapas | Leaflet |
| Desktop | Tauri 2 (Rust) |
| Datos | IndexedDB (local), API Intervals.icu |
| Meteorología | Open-Meteo Archive API |
| CI/CD | GitHub Actions → Vercel (web) + build-deb (desktop) |
| IA | Gemini (análisis de ineficiencias en gráfica HR/Speed) |

---

## 📐 Métricas implementadas

### Fisiológicas
- **VO₂max (ACSM)** — ecuación metabólica del ACSM con grado de pendiente: `VO₂ = 3.5 + 0.2·v + 0.9·v·g`
- **VO₂max (VAM)** — mejor velocidad media en ventana de 6 minutos (test de Jack Daniels)
- **TRIMP** — Training Impulse de Banister con ponderación exponencial por zonas de FC
- **Eficiencia de carrera** — velocidad (m/min) / FC media

### Carga y fatiga
- **CTL** — Chronic Training Load (media exponencial 42 días)
- **ATL** — Acute Training Load (media exponencial 7 días)
- **TSB** — Training Stress Balance (CTL - ATL)
- **ACWR** — Acute:Chronic Workload Ratio (>1.5 = riesgo alto)
- **sRPE** — carga interna subjetiva (RPE × duración) según escala de Foster

### Rendimiento
- **Factor k individualizado** — exponente de fatiga de Riegel calculado con marcas reales del atleta
- **Predictor de marcas** — proyección a cualquier distancia basada en k individual
- **VAM** — Velocidad Aeróbica Máxima (mejor ventana deslizante de 6 min)
- **Climb Score** — desnivel positivo acumulado / distancia

### Biomecánicas (según dispositivo)
- Longitud de zancada (m)
- Tiempo de contacto con el suelo (ms)
- Oscilación vertical (mm)
- Ratio vertical (%)

---

## 🔧 Configuración

### Perfil de atleta
En la app: icono de usuario → Perfil del Atleta
- Edad, peso, altura, sexo
- FC reposo y FC máxima
- Zonas de entrenamiento personalizadas (5 zonas)
- API Key y Athlete ID de Intervals.icu (para sincronización)

### Variables de entorno
```bash
# Intervals.icu (configurable desde UI, se guarda en IndexedDB)
# No requiere variables de entorno para funcionamiento básico
```

---

## 📦 Deploy

### Web (Vercel)
Push a `main` dispara automáticamente el workflow `deploy-vercel.yml`:
```yaml
npm ci → npm run build → vercel deploy --prod
```

### Desktop (.deb)
Push de un tag `v*` dispara `build-deb.yml` que genera el `.deb` y lo adjunta al release.

---

## 🤝 Contribuir

1. Fork del repo
2. Crea tu rama: `git checkout -b feat/mi-mejora`
3. Commit: `git commit -m "feat: descripción"`
4. Push: `git push origin feat/mi-mejora`
5. Abre un Pull Request

### Convenciones de commit
- `fix:` — corrección de bug
- `feat:` — nueva funcionalidad
- `refactor:` — mejora de código sin cambiar comportamiento
- `docs:` — documentación

---

## 📄 Licencia

MIT © 2025-2026 imanlost
