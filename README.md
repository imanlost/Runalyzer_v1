<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# RunAlyzer

Aplicacion web para analizar sesiones de entrenamiento importadas desde archivos `.fit`, `.json` y `.csv`.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

## Build

`npm run build`

## Desktop Deb

La rama `tauri-deb` anade empaquetado con Tauri para generar un instalador `.deb` de Ubuntu.

Comandos locales:

- `npm run tauri dev`
- `npm run tauri build`

GitHub Actions:

- el workflow [`.github/workflows/build-deb.yml`](/home/imanowl/runalyzerGitHub/.github/workflows/build-deb.yml) genera el `.deb`
- se puede lanzar manualmente con `workflow_dispatch`
- al crear un tag `v*` sube el `.deb` a GitHub Releases
