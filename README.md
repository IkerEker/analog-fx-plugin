# Analog FX · plugin para Photoshop (UXP)

Transforma capas de **texto** y **formas** con aspecto analógico: desgaste, técnicas de impresión, copistería, humedad, goteo y acuarela.

**Versión 0.6**: requiere Photoshop 2024 (v25) o posterior. Funciona en RGB, CMYK, Lab, Escala de grises y Duotono, en 8, 16 o 32 bits.

## Novedades 0.6
- **Cada letra en su color:** todo lo que sale de una letra (corrido, humedad, gotas, salpicaduras) hereda el color de esa letra.
- **Humedad:** gotas localizadas con borde de agua definido. Donde tocan, la tinta se disuelve en una nube granulosa y diluida pegada a la letra, se lava por dentro y deja la marca del agua. Fuera, nítido.
- **Tinta corrida:** se escapa poco y de forma desigual por las fibras, pegada a cada letra, con línea de frente donde llega más lejos. Ya no es un halo.
- **Acuarelado rehecho:** charco con borde propio, aro fino y oscuro con interior más claro, pigmento que deriva a un lado, granulación del mismo color, floraciones y segunda veladura.
- **Xilografía** al estilo de los carteles grabados: líneas de talla que entran desde el lado de la luz, anchas en el borde y afiladas en punta, sombra negra y color plano desregistrado (dos tintas), o una sola tinta.
- **Sello gastado:** presión desigual del sello inclinado, borde cargado, centro pobre con poros del papel y diferencias entre letras.
- **Destrozado:** desconchones nítidos, grietas por zonas, cada letra con su daño y el texto pequeño protegido para que se lea.
- **Mimeógrafo:** casi plano, borde que se humedece y carga pigmento, y variaciones ligerísimas entre letras.
- **Tramas (Tritono, Flexografía):** lineatura real en líneas por pulgada, tono vivo bajo la trama, puntos irregulares, tritono con las tintas derivadas del color del texto, y flexografía con macizos sólidos, poros y halo.

## Novedades 0.5.1
- **Humedad rehecha**: la letra reacciona al agua donde cae la gota. La tinta se disuelve en el papel en una nube granulosa que sigue la fibra: densa junto a la letra, rellena los huecos y se para en el borde del agua, con su marca. El resto queda nítido.
- **Raíz de las gotas**: el goteo sale de la base formando un menisco cóncavo que se funde con la letra, sin pigmento duro en la unión.

## Novedades 0.5
- **Color por defecto:** todas las técnicas empiezan con el color del propio texto.
- **Xilografía rehecha:** tinta plana y cortes de gubia en cuña que entran desde el contorno, agrupados por zonas, con hojas de talla en el interior.
- **Linograbado:** tinta plana con borde limpio, huella del rodillo y pigmento acumulado en algunos tramos del borde.
- **Mimeógrafo:** punteado fibroso del esténcil, tinta que se abre y repinte de la hoja de al lado.
- **Fotocopia y láser:** trazos que engordan y se rompen, huecos de tóner, motas junto al negro y rayas finas verticales del tambor, sin bandas horizontales.
- **Goteo rehecho:** las gotas nacen de la base de cada letra, con largos muy distintos, raíz ancha, lágrima final más oscura y gotitas que se desprenden.
- **Acuarelado rehecho:** pigmento transparente con lavado suave, aro oscuro del borde, granulación y floraciones.
- **Texturas nuevas** (no tileables, convertidas en repetibles): goteo, tóner, fibra, floración, granulación, lavado y gubia.

## Novedades 0.4
- **Una ventana con dos páginas**
  - **Presets:** técnica, variante, color e intensidad.
  - **Ajustes detallados:** todos los parámetros. Se abre con **Ajustes detallados ›** y se vuelve con **‹ Presets**.
- **16 técnicas en 4 grupos**, todas sobre el motor de la 0.2:
  - **Desgaste:** Sello gastado, Tinta corrida y Destrozado.
  - **Impresión:** Offset · Tritono, Serigrafía, Risografía, Tipografía, Flexografía, Litografía, Xilografía, Linograbado y Mimeógrafo.
  - **Copistería:** Fotocopia, Láser roto e Inyección mala.
  - **Agua:** Humedad, Goteo y Acuarelado.
- **Módulos nuevos**
  - **Papel:** tinta que se escapa por las fibras, relieve y valles sin tinta.
  - **Tintas y trama:** de 1 a 3 tintas con mezcla sustractiva, semitono con roseta (45°, 75° y 15°), ganancia de punto, puntos donut y desregistro.
  - **Prensa · relieve:** borde cargado, halo aplastado y poca tinta en los macizos.
  - **Malla de serigrafía:** dentado, malla visible y huecos.
  - **Madera:** veta y restos de talla.
  - **Piedra litográfica:** grano, borde graso y velo de plancha.
  - **Acuarela:** aguada, granulación y floraciones.
  - **Humedad por zonas:** solo se moja una parte. El centro se lava y en el frente queda la marca del agua.
  - **Esténcil gastado**, **marcas del rodillo** y **líneas regulares de boquillas**.
- **Color:** cada técnica tiene 3 paletas. **Elegir color** despliega un editor de cada tinta: selector de Photoshop, hexadecimal o muestras.
- **Intensidad del efecto:** escala a la vez todos los daños de la técnica.
- **Texturas:** se han eliminado las repetidas. Se usan 26 en escala de grises, en cuatro familias: desgaste, aguada, grano y rodillo.

## Instalar
1. Descarga `dist/AnalogFX_0.6.0.ccx`.
2. Haz doble clic: Creative Cloud lo instala.
3. En Photoshop abre **Plugins › Analog FX**.

## Usar
1. Selecciona una capa de texto o forma.
2. Elige técnica y variante.
3. Elige el color.
4. Ajusta la intensidad.
5. Pulsa **APLICAR**.

Se crea la capa `Nombre · Analog` y el original queda oculto debajo. Si seleccionas el resultado y vuelves a aplicar, se regenera desde el original.

## Estructura
```
plugin/js/engine.js    motor (módulos de efecto + color + tintas)
plugin/js/presets.js   técnicas, variantes y paletas
plugin/js/main.js      panel y Photoshop (CMYK/Lab/grises vía documento temporal)
tools/textures_manifest.json   qué texturas usa el plugin
textures-src/OTRAS TEXTURAS/   texturas originales
```

Para cambiar las texturas, edita `tools/textures_manifest.json` y ejecuta, en este orden:
1. `python3 tools/build_textures.py`
2. `node tools/build_thumbs.js`
3. `tools/package.sh`
