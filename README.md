# Analog FX · plugin para Photoshop (UXP)

Da un aspecto analógico a capas planas (texto, formas y líneas): sello gastado, tinta corrida, goteo, serigrafía, xilografía, guache, fotocopia…

**Versión 0.2.1**: requiere Photoshop 2024 (v25) o posterior.

## Novedades 0.2.1
- Funciona en **todos los modos de color con capas**: RGB, **CMYK**, Lab, Escala de grises y Duotono, en 8, 16 o 32 bits.
  - En RGB de 8 bits se procesa directamente.
  - En el resto, el plugin copia la capa a un documento temporal RGB, aplica el efecto y devuelve el resultado a tu documento. Photoshop convierte los colores al modo del documento y cierra el temporal sin guardar.
- Mapa de bits y Color indexado no admiten capas: el panel avisa.

## Novedades 0.2
- Arreglada la vista previa (`encodeImageData...then is not a function`).
- **Borde húmedo** en *Tinta corrida*: el frente del agua avanza de forma irregular, con un anillo de pigmento atrapado y un halo diluido. El tono, la saturación y la luminosidad del borde son editables.
- Nuevo módulo **Impresión · fotocopia**: bandas de impresora (separación, grosor, ángulo), desplazamiento de franjas, rayas de tóner o cabezal, trama de semitono y doble impresión (fantasma con su propio tono).
- Nuevo módulo **Color y tono**: tono, saturación y luminosidad globales, variación de tono, saturación y densidad del pigmento según la textura, y acumulación en los bordes.
- **Gotas con bulbo** en *Goteo* y **gotas redondas con satélites** en *Salpicaduras*.
- **Fusión**: Auto, Multiplicar o Normal. Auto multiplica las tintas oscuras con el fondo, como la tinta real.
- Nuevos estilos: Acuarela, Tinta china, Risografía e Impresora mala. Más colores de tinta: sepia y rosa riso.

## Instalar

**Opción A: doble clic**
1. Descarga `dist/AnalogFX_0.2.1.ccx`.
2. Haz doble clic. Creative Cloud lo instala.
3. En Photoshop abre **Plugins › Analog FX**.

**Opción B: UXP Developer Tool** (si la opción A no funciona)
1. En Photoshop activa **Preferencias › Plugins › Activar modo de desarrollador** y reinicia Photoshop.
2. Instala **UXP Developer Tool** desde Creative Cloud y ábrela.
3. Pulsa **Add Plugin**, elige `plugin/manifest.json` y luego pulsa **Load**.

## Usar

1. Selecciona una capa de texto, forma o línea.
2. Elige un **estilo**, una **textura** y ajusta los módulos. La vista previa se actualiza al momento.
3. Pulsa **APLICAR**. Se crea la capa `Nombre · Analog` y el original queda oculto debajo, intacto.
4. Para retocar, selecciona el resultado, cambia ajustes y vuelve a aplicar: se regenera desde el original, sin acumular efectos.

- **Dado**: crea otra variación (otra semilla).
- **Flecha circular**: vuelve a los valores del estilo.
- **Doble clic en un número**: restablece ese valor.
- **Mantén pulsado "ver original"**: compara el antes y el después.

## Estructura

```
plugin/            ← el plugin (esto es lo que se instala)
  manifest.json
  index.html, styles.css
  js/engine.js     motor de efectos (JS puro)
  js/presets.js    estilos
  js/main.js       panel + Photoshop
  textures/        texturas optimizadas (1024 px, gris) + miniaturas
textures-src/      texturas originales
tools/             build_textures.py, package.sh, pruebas
dist/              .ccx listo para instalar
```

Para añadir texturas: cópialas a `textures-src/` (con nombres tipo `..._Pinceladas_Frias_7_...png`), ejecuta `python3 tools/build_textures.py` y después `tools/package.sh`.
