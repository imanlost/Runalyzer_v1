/**
 * Mapas base SIN clave de API.
 *
 * La aplicación usaba los mapas ráster de CARTO (estilo Dark Matter). Desde
 * finales de agosto de 2026 CARTO exige una clave incluso para uso personal y
 * devuelve sus teselas con la marca de agua «API KEY REQUIRED» cuando no se
 * lleva. Estas dos capas la sustituyen y no piden registro ni clave:
 *
 *  - `oscuro`: Esri «World Dark Gray Canvas». Teselas propias hasta el nivel 16.
 *  - `ign`: MTN25 del Instituto Geográfico Nacional (WMTS público de España).
 *    Teselas propias hasta el nivel 17.
 *
 * Los zooms nativos están comprobados descargando teselas reales: por encima de
 * su nivel, el proveedor devuelve una imagen de relleno («Map data not yet
 * available» en Esri y una trama vacía en el IGN), de modo que Leaflet debe
 * escalar la última válida en vez de pedirla. Para eso existe `maxNativeZoom`.
 *
 * La atribución es OBLIGATORIA en los dos casos: es la contrapartida del uso
 * gratuito. Si se cambia de proveedor, hay que cambiarla también.
 */

export type BasemapKey = 'oscuro' | 'ign';

export interface Basemap {
    /** Nombre corto para el selector de la interfaz. */
    label: string;
    /** Plantilla de tesela de Leaflet. No añadir claves de API. */
    url: string;
    /** Crédito que debe quedar visible sobre el mapa. */
    attribution: string;
    /** Último nivel de zoom con teselas propias del proveedor. */
    maxNativeZoom: number;
}

export const BASEMAPS: Record<BasemapKey, Basemap> = {
    oscuro: {
        label: 'Oscuro',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, y la comunidad SIG',
        maxNativeZoom: 16,
    },
    ign: {
        label: 'Topo IGN',
        url: 'https://www.ign.es/wmts/mapa-raster?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=MTN&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
        attribution: '© IGN/CNIG · MTN25 (CC BY 4.0)',
        maxNativeZoom: 17,
    },
};

/** Orden del selector en la interfaz. */
export const BASEMAP_KEYS: BasemapKey[] = ['oscuro', 'ign'];

/** Opacidad de la capa base: el trazado tiene que leerse por encima. */
export const BASEMAP_OPACITY = 0.8;
