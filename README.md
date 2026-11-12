# Analog FX · plugin para Photoshop (UXP)

Transforma capas de **texto** y **formas** con aspecto analógico: desgaste, técnicas de impresión, copistería, humedad, goteo y acuarela. Desde la 0.8 también **fotografías** (con o sin transparencia) con modelos de impresión de imagen.

**Versión 0.8.5**: requiere Photoshop 2024 (v25) o posterior. Funciona en RGB, CMYK, Lab, Escala de grises y Duotono, en 8, 16 o 32 bits.

## Novedades 0.8.5
- **Goteo absorbente:** unas tres veces más gotas de agua cayendo desde arriba (mordidas y regueros que cruzan).

## Novedades 0.8.4
- **Goteo absorbente:** las gotas que caen desde arriba son agua limpia. Al tocar la letra se comen casi el 100 % del pigmento; según bajan se cargan de la tinta que disuelven, comen cada vez menos y la dejan diluida y en estrías en su canal, hasta perderse.
  - **Mordidas:** muchas y cortas en el borde de arriba.
  - **Cruzan:** unas se pierden dentro de la letra y otras salen por abajo llevando tinta.
  - Sin manchas redondas.

## Novedades 0.8.3
- **Interfaz:**
  - Sin vista previa, en los dos modos.
  - El panel se ancla a la ventana y **APLICAR** queda siempre fijo abajo, aunque el panel sea muy pequeño.
  - Con anchura, las tarjetas se ponen en columnas; en ventanas bajas o estrechas, modo compacto.
- **Fotocopia punk:** sin bordes ni marcos, solo la imagen. Copia de copia conserva mejor el detalle.
- **Goteo absorbente:** muchas más gotas de agua que se comen el pigmento, más finas; algunas se agotan y se desvanecen al poco de tocar la letra.
- **Tinta corrida › Corrida a un lado rehecha:** es una pasada de dedo sobre la tinta fresca, en bandas, no en todas las letras. La tinta se transporta: los trazos gruesos dejan más borrón, densa junto a la letra y luego un rastro diluido con estrías. La letra pierde tinta en estrías por donde pasó el dedo.

## Novedades 0.8.2 (Imágenes)
- **Intensidad del efecto que recorre todo el rango:**
  - **0 %:** apenas se nota (trama finísima, sin defectos y casi la foto original).
  - **100 %:** el preset.
  - **200 %:** una locura (trama enorme, umbral quemado, desregistro grande, defectos a tope).
  - Entre medias cambia de forma gradual: finura de trama y grano, dureza del umbral, ganancia, desregistro, todos los defectos y cuánto queda de la foto original.
- **Preimpresión inteligente:** niveles automáticos (punto de luz y de sombra), contraste local para que el detalle sobreviva a la trama o al umbral, enfoque y compensación de la ganancia de punto.
- **Tramas más finas:** puntos redondos limpios en tramas gruesas, borde del punto irregular por la fibra, radios de desenfoque fraccionarios.
- **Por técnica:**
  - **Fotocopia:** umbral adaptativo (se lee el detalle en luces y sombras), tóner que salpica junto a los bordes y, a tope, la sombra del borde del original en el cristal.
  - **Periódico:** las luces pierden el punto, los medios engordan, la tinta se abre en el papel, el punto se corre y se dobla, y el papel tiene motas recicladas.
  - **Cuatricromía:** negro por GCR. En Vintage, el magenta y el amarillo se desvanecen antes. El cómic usa tintas planas Ben-Day (puntos iguales, pocos niveles) con contornos negros.
  - **Risografía:** el grano se abre en el papel, el desregistro es más grande y los macizos tienen poca carga.
  - **Serigrafía:** tintas opacas tiradas de la clara a la oscura, repartidas según la luz de la propia foto, con formas más gráficas cuanto más intensa y papel visible entre colores por el desregistro.
  - **Impresora rota:** gotitas de las cuatro tintas y pasadas del cabezal desalineadas.

## Novedades 0.8.1 (Letras)
- **Tinta corrida rehecha por capilaridad:** la tinta avanza por las fibras de celulosa que tocan la letra (red de fibras a tamaño real y distancia por dentro del papel). Ya no es un desenfoque.
  - **Por las fibras:** pelillos finos de largo muy distinto, agrupados por zonas, con la intensidad de la letra en la raíz.
  - **Corrida a un lado:** la tinta fresca arrastrada hacia un lado, con estrías del dedo y del papel. El arrastre levanta algo de tinta de la letra.
  - **Borde húmedo:** junto a la letra, su misma tinta; luego el tinte diluido y moteado, que se para en un borde fibroso y desigual.
- **Xilografía › Contorno tallado rehecho:** una sola línea de gubia paralela al borde. Engorda del lado de la luz, se afila hasta desaparecer en el de sombra y se corta a tramos. Los bordes de la madera quedan nítidos.
- **Goteo en papel absorbente** (Papel absorbente e Infiltrado largo): agua que cae desde arriba sobre las letras y se come el pigmento. Deja canales lavados con los bordes más cargados y algunas manchas redondas donde cae la gota. Al salir de la letra sigue como una marca diluida. Se regula con el nuevo control **Agua que cae encima**.

## Novedades 0.8.0
- **Dos modos arriba del todo: Letras e Imágenes.** Letras queda exactamente igual.
- **Imágenes** (fotos con o sin alfa, también la capa de fondo): una página sencilla con técnica, variante, tintas, fondo e intensidad. La foto sigue siendo reconocible: no hay deformación interna, solo el modelo de impresión y sus defectos.
  - **Fotocopia punk:** Umbral duro · Copia de copia · Revista fotocopiada.
  - **Periódico:** Periódico · Puntos gordos · Trama de líneas.
  - **Duotono · Tritono:** Duotono · Tritono · Duotono sin trama.
  - **Cuatricromía:** Revista · Vintage desregistrado · Cómic.
  - **Risografía:** Grano 2 tintas · Trama 2 tintas · Una tinta.
  - **Serigrafía póster:** 2 tintas planas · 3 tintas planas · Silueta + negro.
  - **Tramado 1 bit:** Difusión · Ordenado (Bayer) · Mezzotinta.
  - **Impresora rota:** Boquillas obstruidas · Cartucho agotado · Láser rayado.
- **Fondo:** solo tinta (se multiplica sobre lo de debajo), papel blanco, papel crema o papel de periódico.
- **Ajustes** despliega los parámetros propios de cada técnica.

## Novedades 0.7.4
- **La tinta se extiende, no se superpone** (Humedad, Papel húmedo, Tinta corrida): la tinta de la propia letra avanza por el papel. Pegada al borde tiene la misma intensidad que la letra y se desvanece al alejarse, por zonas y por fibras.
- **Goteo en papel absorbente:**
  - La gota sale con la tinta de la letra.
  - Al caer se infiltra y se abre como una acuarela, más ancha, diluida y con algo de borde de pigmento.
  - La punta se desvanece y la raíz se apoya solo en tinta real, sin repisa.
- **Variantes revisadas para que sean efectos distintos:**
  - **Humedad:** Gotas secas (marcas).
  - **Serigrafía:** Malla gruesa.
  - **Acuarelado:** Pincel seco.

## Novedades 0.7.3
- **Humedad › Papel húmedo** (modo nuevo): todo el papel algo mojado. El borde de cada letra se abre poco, en un halo granuloso y desigual, con flecos que caen hacia abajo, zonas lavadas y grietas. Los otros modos de Humedad siguen igual.
- **Intensidad del efecto** en las dos páginas (presets y ajustes detallados). Escala todos los parámetros de daño de cada técnica, también los nuevos.
- **Variantes = efectos distintos, no niveles:**
  - **Sello:** Goma entintada · Sello inclinado · Tinta seca.
  - **Tinta corrida:** Por las fibras · Corrida a un lado · Borde húmedo.
  - **Destrozado:** Roto · Corrido y goteado · Rayado y arañado.
  - **Fotocopia:** Negros quemados · Rayas y tóner arrastrado · Copia de copia.
  - **Mimeógrafo:** Halo de aceite · Tambor sin tinta y repinte.
  - **Risografía:** se añade Trama riso.
  - **Litografía:** se añade Velo de plancha.
  - **Tipografía:** se añade Impresión hundida.

## Novedades 0.7.2
- **Goteo:** la gota sale de la letra opaca y del mismo color, empapada de su pintura, y según baja se infiltra en el papel y se vuelve más transparente. Solo nace en bases horizontales y sale directamente del borde de la letra: ya no hay franja de tinta acumulada a lo largo de la base (la base plana que sobresalía) ni rendijas en las curvas.

## Novedades 0.7.1
- **Xilografía a dos tintas:** letra de color con las líneas de talla en negro y la sombra (como en los carteles). Con tintas oscuras se usa una sola plancha.
- **Ctrl+Z:** el efecto entero (capa nueva, original oculto) es un solo paso de historial, también en CMYK, Lab y 16/32 bits.
- **Mimeógrafo:** halo de aceite de la tinta grasa, punteado del esténcil, zonas del tambor con poca tinta, repinte y variación entre letras.
- **Humedad:** gotas sueltas de tamaños muy variados, irregulares y algo alargadas, sobre todo encima de la tinta, con salpicaduras alrededor de las grandes.
- **Goteo:**
  - Las gotas se dibujan antes que el papel, así que su borde es igual que el de la letra.
  - Dos variantes con **papel absorbente:** la gota se infiltra, se abre por la fibra y pierde el brillo.
- **Acuarelado:** sin líneas rectas ni manchas blancas rectas (la carga y el pincel seco son ahora campos orgánicos).

## Novedades 0.7
- **Base común:**
  - Texturas sin repetición (muestreo estocástico con conservación del contraste).
  - Grano del papel, la fibra y el tóner a tamaño físico (300 ppp), sin depender del tamaño de la letra.
  - Ganancia de punto óptica: la tinta parece metida en el papel, no encima.
- **Acuarelado nuevo, sin las rayas radiales:**
  - Densidad en tres capas: grano del papel, flujo turbulento y dispersión.
  - Veladuras con su borde de secado y granulación en los valles del papel.
  - Aro de pigmento más marcado en las letras más diluidas.
  - Pincel seco en algunos finales y floraciones en algunas letras.
- **Humedad:**
  - La tinta corrida avanza en dedos por la fibra.
  - El tinte se queda atrás, dejando una franja de agua sin color.
  - El centro de la gota se lava y el papel mojado se abomba muy ligeramente.
- **Goteo:**
  - Menos gotas, con cuello y barriga, y algunas que se paran sin lágrima.
  - Brillo en la lágrima y tramo fino más transparente.
- **Detalles de impresión:**
  - Offset: corrido del punto (slur), doble impresión y motas de suciedad (hickeys).
  - Serigrafía: cresta de la rasqueta.
  - Tipografía: sombra del hundimiento.
  - Sello: marca del canto del sello.
  - Fotocopia: tóner arrastrado.
  - Xilografía: mezcla de cortes en V (afilados) y en U (redondeados).
  - Destrozado: zonas grandes muy rotas y el resto casi intacto.
- **Risografía:** con el color del texto usa el color de cada letra (ya no sale azul).

## Novedades 0.6.1
- **Xilografía** con tres variantes:
  - **Siguiendo el trazo:** el motor entiende la dirección de cada trazo de cada letra y talla líneas largas y finas que lo cruzan, afiladas en punta. Cambian de dirección con la letra.
  - **Contorno tallado:** líneas que siguen el contorno de la letra, troceadas.
  - **Rayado horizontal:** como en la 0.6.
- **Humedad:** mucha menos superficie mojada por defecto. Donde está seco la letra no se corre (deformación mínima). Donde cae el agua, la tinta sale de la letra hacia fuera con más fuerza.
- **Acuarelado pintado a mano:**
  - Cada letra con su carga, deriva y floraciones.
  - Vetas de pigmento a lo largo de la dirección del trazo.
  - Bordes rectos y cortantes, sin redondear.
  - Aro seco fino, línea de secado donde el pigmento se acumuló y granulación sutil.

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
1. Descarga `dist/AnalogFX_0.8.5.ccx`.
2. Haz doble clic: Creative Cloud lo instala.
3. En Photoshop abre **Plugins › Analog FX**.

## Usar
Arriba elige **Letras** (texto y formas) o **Imágenes** (fotos).
1. Selecciona una capa de texto, forma o imagen.
2. Elige técnica y variante.
3. Elige el color.
4. Ajusta la intensidad.
5. Pulsa **APLICAR**.

Arriba eliges el modo; abajo, **APLICAR** siempre está visible. Se crea la capa `Nombre · Analog` y el original queda oculto debajo. Si seleccionas el resultado y vuelves a aplicar, se regenera desde el original.

## Estructura
```
plugin/js/engine.js    motor (módulos de efecto + color + tintas)
plugin/js/presets.js   técnicas, variantes y paletas
plugin/js/image.js     motor del modo Imágenes (tramas, separación, defectos)
plugin/js/main.js      panel y Photoshop (CMYK/Lab/grises vía documento temporal)
tools/textures_manifest.json   qué texturas usa el plugin
textures-src/OTRAS TEXTURAS/   texturas originales
```

Para cambiar las texturas, edita `tools/textures_manifest.json` y ejecuta, en este orden:
1. `python3 tools/build_textures.py`
2. `node tools/build_thumbs.js` (y `node tools/build_img_thumbs.js` para las de Imágenes, con la foto de `tools/photos/`)
3. `tools/package.sh`
