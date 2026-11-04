# Analog FX · plugin para Photoshop (UXP)

Transforma capas de **texto** y **formas sólidas** imitando técnicas de impresión reales, humedad, goteo y acuarela.

**Versión 0.3**: requiere Photoshop 2024 (v25) o posterior y un documento RGB de 8 bits.

## Técnicas

| Grupo | Técnica | Qué imita |
|---|---|---|
| Impresión | **Serigrafía** | Tinta plana y opaca, dentado de malla, rasqueta irregular, huecos, desregistro con 2 tintas |
| Impresión | **Offset · Tritono** | Trama de puntos a 45°/75°/15° (roseta), ganancia de punto, mono/duo/tritono |
| Impresión | **Risografía** | Grano del esténcil, trama gruesa, tintas transparentes superpuestas, desregistro de 1-3 mm |
| Impresión | **Tipografía** | Letterpress: tinta acumulada en el borde, halo aplastado, macizos con huecos, huella |
| Impresión | **Litografía** | Grano de piedra (lápiz litográfico), borde graso, reticulado de tusche, velo de plancha |
| Impresión | **Xilografía** | Veta de madera (o linóleo), marcas de gubia, restos de talla, presión desigual |
| Copistería | **Copistería** | Copia de copia, negros quemados, bandas, franjas desplazadas, rayas del tambor, tóner |
| Gotitas | **Humedad** | Impresión normal que se moja: la tinta se abre y se corre en algunas zonas |
| Gotitas | **Goteo** | La tinta gotea hacia abajo con hilos finos y gotas muy pequeñas |
| Acuarelado | **Acuarelado** | Aguada, pigmento en el borde, granulación, floraciones, frente de agua |

Cada técnica tiene 3 variantes rápidas y paletas de color típicas.

## Instalar
**Opción A: doble clic**
1. Descarga `dist/AnalogFX_0.3.0.ccx`.
2. Haz doble clic. Creative Cloud lo instala.
3. En Photoshop abre **Plugins › Analog FX**.

**Opción B: UXP Developer Tool**
1. En Photoshop activa **Preferencias › Plugins › Activar modo de desarrollador**.
2. En UXP Developer Tool pulsa **Add Plugin**, elige `plugin/manifest.json` y luego pulsa **Load**.

## Usar
**Página de presets**
1. Elige una técnica.
2. Elige una variante.
3. Elige los colores: una de las 3 paletas, o pulsa **Elegir colores** para cambiar cada tinta con el selector de Photoshop, el código hexadecimal o las muestras.
4. Ajusta la **Intensidad**.
5. Pulsa **APLICAR**.

**Ajustes avanzados**
- Contiene todas las opciones de la técnica, las texturas, el tamaño del efecto, la opacidad y la fusión.
- Desde ahí puedes **guardar tus propios presets**, que luego aparecen con ★ en la página de presets.

**Al aplicar**
- Se crea la capa `Nombre · Analog · Técnica` y el original queda oculto debajo.
- Si seleccionas el resultado y vuelves a aplicar, se regenera desde el original.
- El dado crea una variación nueva y el botón de flecha restablece la variante.

## Estructura
```
plugin/                 ← el plugin (lo que se instala)
  js/engine.js          motor: una función por técnica + mezcla sustractiva de tintas
  js/techniques.js      catálogo: parámetros, variantes y paletas de cada técnica
  js/main.js            panel (presets / avanzado) + Photoshop
  textures/  thumbs/    texturas optimizadas y miniaturas
textures-src/<familia>/ texturas originales (acuarela, humedad, granulado, moteado, piedra, gotas)
tools/                  build_textures.py, build_thumbs.js, test-engine.js, package.sh
```
Para añadir texturas: cópialas en `textures-src/<familia>/` y ejecuta, en este orden:
1. `python3 tools/build_textures.py`
2. `node tools/build_thumbs.js`
3. `tools/package.sh`
