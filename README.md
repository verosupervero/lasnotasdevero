## Las notas de Vero

Repositorio

Para correr local, usar el .bat

## Artículos destacados

La portada reúne los artículos de `posts`, `estudios` y `devocionales`.
El campo opcional `featured` indica prioridad editorial: `1` para el destacado
principal, `2` para las tarjetas secundarias y `0` para artículos normales.
Si falta, equivale a `0`; no hace falta modificar los artículos existentes.

En el front matter TOML del sitio:

```toml
featured = 2
```

En YAML, si un artículo usa ese formato:

```yaml
featured: 1
```

El principal es el artículo más reciente con `featured = 1`, o con `2` si no
hay ninguno con `1`; sin destacados, se usa el artículo más reciente. Hasta
tres tarjetas secundarias se eligen primero entre los artículos con `2` y
luego entre los restantes con `1`, por fecha dentro de cada grupo. Los
últimos artículos se muestran por fecha, excluyendo los ya visibles en los
destacados. El archivo `/articulos/` reúne todas las publicaciones por fecha.
