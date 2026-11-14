# Analog FX: contexto completo para seguir en un chat nuevo

> **Para el asistente del chat nuevo:** lee este archivo entero antes de tocar nada. Resume todo lo hecho hasta la **v0.9.7** (13-nov-2026), las reglas que ha fijado el usuario y cómo probar. El usuario escribe en español, es exigente con el realismo y quiere que cada cambio se pruebe y se entregue empaquetado.

---

## 1. Qué es

- **Analog FX** es un plugin **UXP para Photoshop** (2024 / v25 o posterior).
- Da aspecto analógico (impresión, desgaste, agua) a capas planas.
- Trabaja en RGB, CMYK, Lab, Escala de grises y Duotono, en 8, 16 o 32 bits. Los documentos que no son RGB 8 bits se procesan en un documento temporal RGB 8.
- **Repositorio:** `https://github.com/IkerEker/analog-fx-plugin` (público, rama `main`).
- **Autor de los commits:** `IkerEker`, con el email del usuario.
- **Instalable actual:** `dist/AnalogFX_0.9.7.ccx`. Se instala con doble clic (Creative Cloud) y se abre en Photoshop desde **Plugins › Analog FX**.
- **Uso:**
  1. Arriba se elige el modo: **Letras** o **Imágenes**.
  2. Se elige técnica, variante, color e intensidad.
  3. Se pulsa **APLICAR**. Se crea la capa `Nombre · Analog` y el original queda oculto debajo.
  - Volver a aplicar sobre el resultado lo regenera desde el original.
  - Ctrl+Z deshace todo en un solo paso.

## 2. Descargables

| Qué | Dónde |
|---|---|
| Plugin instalable v0.8.7 | `dist/AnalogFX_0.9.7.ccx` en el repo, o descarga directa: https://github.com/IkerEker/analog-fx-plugin/raw/main/dist/AnalogFX_0.9.7.ccx |
| Código completo (zip) | https://github.com/IkerEker/analog-fx-plugin/archive/refs/heads/main.zip |
| Este documento | `CONTEXTO.md` en la raíz del repo |
| Historial de cambios | `README.md` (sección "Novedades" de cada versión) |

Solo se guarda en `dist/` el `.ccx` de la última versión; los antiguos se borran con `git rm`.

## 3. Estructura

```
plugin/manifest.json       id com.ikereker.analogfx, versión, panel (mín. 230×300)
plugin/index.html          panel: pestañas Letras/Imágenes, páginas, pie con APLICAR
plugin/styles.css          tema negro/blanco/verde; al final, bloques 0.8.3 y 0.8.7 de layout
plugin/js/engine.js        motor de LETRAS (módulos de efecto, color, tintas)
plugin/js/presets.js       técnicas/variantes/paletas de Letras + INTENSITY (qué escala la intensidad)
plugin/js/image.js         motor + presets de IMÁGENES (AFXImage)
plugin/js/main.js          UI y Photoshop (batchPlay, imaging, executeAsModal, suspendHistory)
plugin/textures/           26 texturas en gris (.bin + textures.json)
plugin/thumbs/             miniaturas: <tecnica>.jpg (letras) e img_<tecnica>.jpg (imágenes)
tools/build_textures.py    texturas desde textures-src/ según tools/textures_manifest.json
tools/build_thumbs.js      miniaturas de letras (usa make_sample.py "Aa")
tools/build_img_thumbs.js  miniaturas de imágenes (foto tools/photos/astronaut.png, NASA, dominio público)
tools/make_sample.py       texto de prueba -> tools/out/sample.rgba/.json  (uso: TEXTO TAMAÑO [HEXCOLOR])
tools/test-engine.js       hoja de todas las variantes de letras -> tools/out/v4_<tec>_<pal>.png (SEED=n)
tools/test-image.js        hoja de imágenes con la foto sintética (make_photo.py)
tools/dev/                 bancos de prueba (ver §8)
GOTAS/                     45 fotos de goteos reales (fuente)
BIBLIOTECA/goteos/         banco de 219 gotas reales clasificadas + guía (README.md)  ← REUTILIZABLE
plugin/drips/              banco ligero para el plugin (drips.bin + drips.json)
tools/build_drips.py       extrae/clasifica GOTAS/ -> BIBLIOTECA/goteos + plugin/drips
tools/package.sh           empaqueta dist/AnalogFX_<versión>.ccx
```

**Versión:** está en `plugin/manifest.json` (`"version"`), en `plugin/index.html` (badge `vX.Y.Z`) y en `README.md` (línea "Versión" y ruta del .ccx). Se cambia en los tres sitios.

## 4. Reglas del usuario (obligatorias)

1. **Toda técnica tiene siempre el deslizador "Intensidad del efecto"**, en Letras y en Imágenes, y debe cambiar MUCHO:
   - **0 %:** apenas se nota.
   - **100 %:** el preset.
   - **200 %:** una locura, con gradación continua entre medias.
2. **Las variantes (sub-efectos) son efectos distintos, nunca niveles de intensidad.**
3. **El color por defecto es el de la propia capa o texto.** Todo lo que sale de una letra (corrido, gotas, salpicaduras) hereda el color de esa letra.
4. **La tinta que se corre empieza con la misma intensidad que la letra y se desvanece.** Nunca son manchas superpuestas.
5. **Gotas:**
   - Salen de la letra sin repisa ni base plana, en su color.
   - En papel absorbente se infiltran, se abren como acuarela y se vuelven transparentes. El tramo opaco sin infiltrar es corto y las gotas no son largas.
6. **Agua que cae desde arriba (goteo absorbente):**
   - Agua limpia: encima del papel no se ve.
   - Al tocar la letra se come casi el 100 % del pigmento; según baja se carga de la tinta disuelta, come menos y la deja en su canal, hasta perderse.
   - Hay dos tipos: **mordidas** (muchas, cortas, en el borde de arriba) y **cruzan** (canales largos y finos).
   - Muchas, finas y sin manchas redondas.
7. **Imágenes:** muy reconocibles y sin deformación interna. Las técnicas son modelos de impresión claramente distintos entre sí. **Nada de bordes ni marcos** (se quitó el marco de la fotocopia).
8. **Interfaz:**
   - Moderna: negro, blanco y verde.
   - Ligera y adaptable a cualquier tamaño de panel.
   - **APLICAR siempre fijo y visible abajo**, aunque el panel sea pequeño.
   - **Sin vista previa** (se quitó en los dos modos porque no servía; los nodos siguen ocultos en `#previewHolder` y `renderPreview` sale por `NO_PREVIEW = true`).
9. **Ctrl+Z deshace todo de una vez.**
10. Cuando pide "piensa mucho / infórmate", quiere investigación real (búsquedas), probar y mirar los resultados antes de entregar.
11. Si dice "espera, te doy más correcciones", se apuntan y se hacen todas juntas cuando diga "corrige".

## 5. Modo LETRAS: técnicas (presets.js)

- **Desgaste:**
  - **Sello gastado:** Goma entintada · Sello inclinado · Tinta seca.
  - **Tinta corrida:** Por las fibras · Corrida a un lado · Borde húmedo.
  - **Destrozado:** Roto · Corrido y goteado · Rayado y arañado.
- **Impresión:**
  - Offset · Tritono, Serigrafía (incluye Malla gruesa), Risografía (+ Trama riso), Tipografía (+ Impresión hundida), Flexografía, Litografía (+ Velo de plancha), Linograbado.
  - **Xilografía:** Siguiendo el trazo · Contorno tallado · Rayado horizontal.
  - **Mimeógrafo:** Halo de aceite · Tambor sin tinta y repinte.
- **Copistería:**
  - **Fotocopia:** Negros quemados · Rayas y tóner arrastrado · Copia de copia.
  - Láser roto, Inyección mala.
- **Agua:**
  - **Humedad:** Gotas secas · Papel húmedo · … El usuario dijo que Humedad está **perfecta: no tocar**.
  - **Goteo:** Papel absorbente (`fino`) · Infiltrado largo (`largo`) · Chorreado.
  - **Acuarelado:** incluye Pincel seco.

### Estado de lo último trabajado (motor de letras)

- **Tinta corrida** (módulo `wick` en engine.js, etapa "1b2b"):
  - Capilaridad: `fiberNet` (red de fibras a 300 ppp) + `geodesic` (distancia por dentro del papel).
  - **Modos:**
    - `fiber`: pelillos.
    - `wet`: borde húmedo diluido que se para en un frente fibroso.
    - `smear`: corrida a un lado. Pasadas de dedo en bandas que transportan la tinta (densa junto a la letra y rastro diluido con estrías), y la letra se aclara donde pasa el dedo.
  - En la 0.8.7 se hizo más contenida, porque el usuario dijo "sigue siendo demasiado". **Puede pedir más ajustes.**
  - Parámetros: `amount`, `reach`, `front`, `drag`, `dir`.
- **Xilografía › Contorno tallado:** una línea de gubia paralela al borde, más ancha del lado de la luz y afilada en el de sombra, a tramos, con bordes nítidos. Pendiente de la opinión del usuario.
- **Goteo absorbente:**
  - `dripsFromLetters` + bloque de absorción (`Lref = U*(0.05+0.35*length)`).
  - `waterRuns`: agua desde arriba, `nr = runs*(cols/U)*32`, 60 % mordidas.
  - Presets: `fino` (length 0.22, runs 0.5) y `largo` (length 0.45, runs 0.55).
  - Control UI: `drip.runs` = "Agua que cae encima".

### Gotas reales (v0.8.8)

Todas las gotas salen del banco `plugin/drips`. El motor usa `prepareDrips`, `pickDrip` y `stampDrip`, y el panel lo carga con `getDrips()` en `main.js`.

- **Clases por variante:**
  - Chorreado: lágrima 55 %, fina 30 %, serpenteante 15 %.
  - Absorbente: fina 60 %, lágrima 40 %.
  - Con `drip.dry`, también entran gotas secas.
- **Gotitas desprendidas:** son de la clase `suelta`.
- Si el banco no carga, el motor vuelve a las gotas dibujadas.
- Para probar sin el banco: `NODRIPS=1 node tools/test-engine.js goteo`.

### En curso (sin empaquetar; el usuario pidió no enviar el .ccx todavía)

- Imágenes › Fotocopia punk: el umbral se compara con ruido de tóner (`tgrain`): blancos y negros nítidos, medios tonos en grano fino; nitidez fina antes del umbral.
- Imágenes, regla del usuario: **el deslizador de intensidad NO debe cambiar el tamaño de la trama o del grano**, sino añadir textura. Por eso `lineK` vale 0,35 por defecto, el factor de `px` se ha reducido y `pressTexture()` se aplica por tinta en Cuatricromía y Duotono/Tritono.
- Serigrafía póster: `keep = 0` (nunca mezcla con la foto); la intensidad es el nivel de detalle (`simp` de S·0,0005 a S·0,009).
- Periódico (las tres variantes): `lineK 0.35`, así la intensidad cambia poco el tamaño del punto o de la línea. A cambio añade textura de rotativa que crece con `e`: tinta irregular, bandas, zonas sin tinta, traspaso del dorso, velo, motas con anillo y arañazos.
- Copia de copia: `smear` (franjas movidas con estela horizontal) y `blots` (borrones grises).
- Las tres fotocopias se diferencian así:
  - **Umbral duro:** negros macizos, más contraste y poco grano.
  - **Copia de copia:** grano, movido y borrones.
  - **Revista fotocopiada:** trama fina de 125 líneas con puntos rotos y engordados (`rag 0.55`).

### Cambios de la 0.9.7

- Varias variantes viven en la misma línea de `presets.js`: edítalas por el objeto `{ id: ..., name: ... }` con conteo de llaves, nunca sustituyendo la línea entera.
- `margin()` suma `U*0.5` para el desvanecido de borde.
- Fotocopia: el umbral mezcla el original para conservar esquinas.
- Negativo: raíces en su propia capa, difuminadas según la distancia, más nudos.
- Suminagashi: líneas finas con corriente de baja frecuencia.

### Cambios de la 0.9.6

- **En vivo** (`state.live`, clave `afx.live`, botón `#btnLive`): `schedulePreview` llama a `scheduleLive()`, que espera 450 ms y ejecuta `applyEffect(true)`.
  - Solo reacciona si el usuario tocó el panel en los últimos 2,5 s.
  - Si ya hay una aplicación en marcha, marca `livePending` y repite al acabar.
  - Prueba: `tools/dev/ui_live.js`.

### Cambios de la 0.9.5

- Al final de `render()` hay un desvanecido global junto al borde del lienzo, salvo en la letra original. Garantiza que ningún efecto marque la caja de la capa.
- `stamp`: `double` y `dry`.
- `aqua.mode`: `flat` · `dry` · `wet`.
- `soak.mode`: `bleed` (dendritas) y `rings` (suminagashi).
- Módulo `scratch`.
- `tangle`: `curl` y `len`.
- El usuario quiere variantes **muy diferenciadas**, nunca parecidas.
- Para hacer commit: usar `git -c user.name=IkerEker -c user.email=…` en una llamada aparte (un plugin de privacidad bloquea mezclarlo con otros comandos).

### Cambios de la 0.9.4

- `makeGrid` refleja las coordenadas fuera de rango (antes leía basura: cortaba el acuarelado en textos anchos). Prueba de cortes: renderizar todas las técnicas con un texto ancho y comparar la tinta de la mitad izquierda y la derecha.

### Cambios de la 0.9.3

- Fusiones: `serigrafia` (malla · hundida · flexo) y `lino` (lino · aceite · tambor). `flexo`, `tipografia` y `mimeo` ya no existen.
- `tangle` rehecho: solo hilos (parámetro `hang` para los que cuelgan).
- Módulo `laser {mode: drum|fuser|empty}`.
- `copy` más fuerte; la salida de fotocopia usa `hard 0.6`.
- Regla del usuario: **ningún efecto puede marcar la caja de la capa** (todo se apaga antes del margen).

### Cambios de la 0.9.2

- El halo del Negativo usa `fiberNet` + `geodesic` (infiltración real), igual que la tinta corrida.

### Cambios de la 0.9.1

- Técnicas propias en Agua:
  - `negativo`: `soak.mode='resist'` con `hair`, `roots`, `smoke`, `gloss`.
  - `sobreagua`: `soak.mode='water'` con `film`, `crust`, `bubbles`.
- Goteo: `fino` · `largo` · `lavado` (`soak.mode='runs'`). Chorreado eliminado por petición del usuario.
- `glitch`: modos `collage` · `drag` · `double`.
- Talla suelta: bloque rectangular (dilatación y cierre con `maxFilter`).

### Nuevo en 0.9.0

- **Xilografía `garabato`:** `engrave.mode = 'scribble'`, función `engraveScribble`. Parámetros: `width` (franja), `length` (densidad de garabatos), `grain`, `blocks` (tacos).
- **Módulo `soak`** (Humedad), con cuatro modos:
  - `paper`: Papel empapado. Usa además `wick` con `cover`.
  - `water`: Sobre agua.
  - `resist`: Negativo.
  - `runs`: Lavado vertical.
- **Técnica `marana`** (Desgaste): módulo `tangle {amount, comb}`.
- **Técnica `loca`** (Copistería): módulo `glitch {mode: collage|drag, amount}`.
- Todos estos módulos son nuevos y el usuario aún no los ha revisado. Es probable que pida ajustes.

## 6. Modo IMÁGENES (image.js)

**API:** `AFXImage = { DEFAULTS, TECHS, PARAMS, PAPERS, byId, build(tech, variant, paletteIdx), applyIntensity(p, I), render(px, w, h, comps, p) -> {rgba, blend} }`.

- **`applyIntensity(p, I)`:** I va de 0 a 2 (el deslizador), y `e = I/2`. Escala los defectos con `(2e)^1.5`, la finura de trama (`lines` ×2,5 más fina o más gruesa), `px`, `gain`, `clarity` y `detail`, y fija `keep` (mezcla con la foto original cuando la intensidad es baja). `main.js` (`imgParams`) la llama.
- **Preimpresión:** niveles automáticos (percentiles), claridad (contraste local), enfoque y compensación de ganancia en `amScreen`.
- **Composición:**
  - Tintas transparentes multiplicativas, u opacas en Serigrafía (`opaque: true`).
  - Fondo: `ink` (solo tinta → fusión multiplicar), `white`, `cream` o `news` (papel con textura y motas).

**Técnicas (todas con 3 variantes):**

| Técnica | Variantes |
|---|---|
| Fotocopia punk | Umbral duro · Copia de copia · Revista fotocopiada (umbral adaptativo, tóner que salpica, **sin marco**) |
| Periódico | Periódico · Puntos gordos · Trama de líneas (pérdida de punto en luces, slur, doble) |
| Duotono · Tritono | Duotono · Tritono · Duotono sin trama |
| Cuatricromía | Revista · Vintage desregistrado · Cómic (Ben-Day + contornos) |
| Risografía | Grano 2 tintas · Trama 2 tintas · Una tinta |
| Serigrafía póster | 2 tintas planas (naranja+negro) · 3 tintas planas · Silueta + negro |
| Tramado 1 bit | Atkinson · Bayer · Mezzotinta |
| Impresora rota | Boquillas obstruidas · Cartucho agotado · Láser rayado |

**Rendimiento** con una foto de 3000×2000: entre 1,5 y 8 s según la técnica (Cuatricromía es la más lenta).

## 7. Detalles técnicos de Photoshop (main.js)

- Todas las llamadas a `imaging` (getPixels, putPixels, etc.) se envuelven en `Promise.resolve`, porque pueden devolver valores síncronos.
- **CMYK, Lab y 16/32 bits:**
  1. Se calcula en un documento temporal RGB 8 bits, **antes** de `suspendHistory`.
  2. El resultado se duplica de vuelta al documento original.
  3. Todo queda dentro de una sola suspensión de historial.
- **Modo Imágenes:**
  - Admite también la capa de fondo.
  - El proceso: rasterizar → `grabPixels` → `IM.render` → `putPixels` con los mismos límites.
- **Estado guardado** en `localStorage` con claves `afx.*`:
  - Letras: `state`.
  - Imágenes: `img.tech`, `img.variant`, `img.palette`, `img.paper`, `img.intensity`, `img.over`.
  - Modo: `mode`.
- **Panel adaptable:** `fitPanel()` pone las clases `body.compact` (alto < 640 o ancho < 250) y `body.tiny` (alto < 430).

## 8. Cómo probar (el contenedor es efímero; todo lo necesario está en el repo)

**Letras:**
```bash
python3 tools/make_sample.py "Lorem ipsum" 200 8a1f45
SEED=5 node tools/test-engine.js corrida,goteo,xilografia
```
La salida va a `tools/out/v4_<tec>_<pal>.png` y a un `.ppm` por variante.

**Imágenes con fotos reales:**
- No hay internet general; npm y PyPI sí funcionan.
- Fotos de dominio público:
  - Paquetes `@stdlib/datasets-img-*`, por ejemplo `npm pack @stdlib/datasets-img-nagasaki-boats`.
  - La rueda de `scikit-image`: `pip download scikit-image --no-deps --only-binary=:all:` y luego descomprimir `skimage/data/*` (astronaut, chelsea, coffee, rocket, motorcycle_left…).
- Para usar el banco:
  1. Convertir cada foto a RGBA crudo: `ffmpeg -i foto.png -vf scale=720:-2 -pix_fmt rgba -f rawvideo tools/dev/work/ph/<nombre>.rgba`.
  2. Anotar `[w,h]` en `tools/dev/work/ph/dims.json`.
  3. Ejecutar `node tools/dev/img_bench.js tecnicas variantes|all intensidades fotos salida.png`, por ejemplo `node tools/dev/img_bench.js news,cmyk all 0,0.5,1,1.5,2 astronaut hoja.png`. Las variables `TW` y `COLS` controlan el tamaño de la hoja.

**Interfaz (Playwright + Photoshop simulado):**
```bash
python3 -m http.server 8765 --directory plugin &
node tools/dev/ui_layout.js tools/dev
```
- `ui_layout.js`: prueba varios tamaños y comprueba que APLICAR es visible.
- `ui_apply.js`: aplica y comprueba que el botón no se corta.
- `ui_images.js`: recorre todas las técnicas de imagen.
- `mock_cmyk.js`: simula un documento CMYK.

**Comprobar la sintaxis:**
```bash
node --check plugin/js/*.js
```

## 9. Flujo de entrega (cada cambio)

1. Implementar, probar y **mirar las imágenes**.
2. Si cambia el aspecto, regenerar las miniaturas: `node tools/build_thumbs.js` (Letras) o `node tools/build_img_thumbs.js` (Imágenes). Ojo: `build_thumbs` sobrescribe `tools/out/sample.*`, así que después hay que volver a ejecutar `make_sample.py`.
3. Subir la versión en `manifest.json`, `index.html` y `README.md`, y añadir "Novedades X.Y.Z" al README.
4. `git rm` del `.ccx` anterior y luego `bash tools/package.sh`.
5. Commit con `-c user.name=IkerEker -c user.email=<email del usuario>` y push a `origin main`.
6. Enviar al usuario el `.ccx` y muestras visuales. Responder en español, de forma concisa: qué cambió, qué se probó y qué no (no se prueba en Photoshop real, solo en el navegador con el Photoshop simulado).

## 10. Pendiente / siguiente

- El usuario dijo: "antes de corregirte esto de letras, que ya te lo corregiré". Puede traer correcciones de **Tinta corrida** (sobre todo Corrida a un lado), **Contorno tallado** y **Goteo**. Su última captura era de la v0.8.4; conviene que revise con la **v0.8.7**.
- Esperar sus comentarios del modo **Imágenes v0.8.2+** (intensidad 0–200 %, preimpresión).
- Nada de esto se ha probado en Photoshop real. Lo que vea el usuario en sus capturas manda.
