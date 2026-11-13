# Banco de goteos reales (reutilizable)

Gotas de pintura **reales** extraídas una a una de las 45 fotos de `GOTAS/`, que muestran goteos grises o blancos sobre fondo negro. Este banco es la fuente de gotas para **cualquier proyecto o conversación** que necesite gotas: este plugin, NEONIZADOR, PAPELATOR, etc. No hay que volver a dibujar gotas a mano: se cogen de aquí.

## Qué hay

| Ruta | Qué es |
|---|---|
| `<clase>/goteo_NNN.png` | Cada gota recortada en RGBA, a resolución completa. **A** = máscara suave de la pintura; **RGB** = su sombreado original en gris (brillos, volumen, grietas). |
| `catalogo.json` | Una entrada por gota: `id`, `clase`, `archivo`, `origen` (foto y caja de recorte) y medidas. |
| `CATALOGO.md` | Resumen por clases (se genera solo). |
| `hojas/<clase>.png` | Hoja de contactos de cada clase, para revisar a ojo. |
| `../../plugin/drips/drips.bin + drips.json` | Versión ligera para el plugin (alto máximo 320 px; máscara y sombreado de 8 bits). |

**Orientación:** la **raíz** (por donde la gota se une a la letra o la forma) es el **borde de arriba** del PNG. Las excepciones son `suelta` e `impacto`, que no cuelgan.

## Clases (219 gotas)

| Clase | Nº | Qué es | Para qué usarla |
|---|---|---|---|
| `lagrima` | 65 | Cuelga y acaba en un bulbo o lágrima. Pintura espesa. | Chorreo de pintura o tinta fresca, goteo brillante. |
| `fina` | 40 | Cuelga recta y estrecha, sin bulbo marcado. | Tinta líquida, papel absorbente, goteos largos. |
| `serpenteante` | 89 | Cuelga y ondula de lado a lado. | Goteo sobre superficie irregular, variedad. |
| `seca` | 14 | Pintura seca o agrietada, con grietas o grumos en la superficie. | Goteo viejo, destrozado, pintura reseca. |
| `impacto` | 3 | Gota que cae: cabeza ancha arriba (donde golpea) y cola que chorrea. | Gotas que caen sobre una superficie y escurren. |
| `suelta` | 8 | Gota desprendida y corta (lágrimas y bolitas). | Gotitas que se desprenden de la punta de un goteo. |

### Medidas en `catalogo.json`

Todas están en píxeles de la foto original.

- **`largo`:** filas con pintura.
- **`ancho_raiz`, `ancho_medio`, `ancho_bulbo`:** anchura en la raíz, en el tramo medio y en el bulbo.
- **`bulbo`:** ancho del bulbo dividido por el ancho del tramo medio.
- **`cabeza`:** ancho arriba dividido por el ancho del tramo medio.
- **`ondulacion`:** desviación del eje respecto a una recta, dividida por el largo. **`ondulacion_px`** es esa misma desviación en píxeles.
- **`grietas`:** fracción del interior con líneas oscuras finas.
- **`huecos`:** filas vacías a lo largo de la gota.
- **`cuelga`:** si toca el borde superior de la foto, es decir, si tiene raíz.

## Cómo se usa bien (lo que hace Analog FX)

1. **Elegir por clase** según el efecto y, dentro de la clase, por proporción: escoger la gota cuyo `largo / ancho_medio` se parezca más a la gota que quieres dibujar, con algo de azar entre las 4 mejores.
2. **Escalar casi uniforme:**
   - El ancho medio de la gota pasa a ser el ancho que quieres en la raíz.
   - El largo se ajusta al deseado, con una deformación máxima de ×0,7 a ×1,4 respecto a la escala uniforme. Así la gota no se estira hasta parecer falsa.
3. **Colocar la raíz 1 px dentro de la forma** y, por encima de la raíz, repetir la fila de la raíz. Así se funde con la letra.
4. **Mantener un menisco** (filete cóncavo) dibujado en la unión, para que no haya repisa ni base plana.
5. **Voltear en horizontal al azar** para duplicar la variedad.
6. **Usar la máscara (A) como cobertura de tinta del color de la letra.** El sombreado (RGB) sirve para:
   - Poner brillos en la pintura brillante: aclarar donde el sombreado es mayor de 0,86.
   - Acumular pigmento donde la gota es más oscura o espesa.
7. **Filtrar las gotas para colgar** (lo hace `prepareDrips` en `plugin/js/engine.js`):
   - Solo `cuelga`.
   - Sin huecos: `huecos / largo < 0,02`.
   - Rectas en la caja: ancho de la caja ≤ 3 × ancho medio + 14 px; en `serpenteante`, ≤ 7 × ancho medio + 30 px. Así quedan fuera los recortes con dos gotas o con gotas inclinadas.
   - Las de clase `suelta` se usan aparte, como gotitas que se desprenden.

Código de referencia en `plugin/js/engine.js`:
- **`prepareDrips(index, buf)`:** carga el banco y lo indexa por clase.
- **`pickDrip(lib, pesos, proporción, R)`:** elige una gota.
- **`stampDrip(gota, cx, y0, anchoRaíz, largo, voltear, put)`:** la estampa.

## Regenerar

```bash
python3 tools/build_drips.py
```

El resultado es determinista. Tarda unos 40 s y no necesita scipy, solo numpy y Pillow.

- **Para añadir fotos:** mételas en `GOTAS/` (gotas claras sobre fondo negro puro) y vuelve a ejecutar.
- **Para cambiar la clasificación:** ajusta `clasificar()` en `tools/build_drips.py`. Revisa las hojas `hojas/*.png` antes de dar el resultado por bueno.
