# OGN Album - Producción final

Esta versión ya viene conectada al API de producción:

`https://script.google.com/macros/s/AKfycbzlMlnCIvUU6xwCTxBuogTqPsF1689oYIl-RV8PFDex9xu7v2oQ81kyiHl8TaFj2YNgrA/exec`

## Qué hace esta versión final
- usa directamente el endpoint de producción
- carga la colección del usuario desde Google Sheets
- guarda el usuario en `localStorage`
- si el usuario ya entró antes, **se carga automáticamente al volver a abrir la app**
- también soporta precarga por URL:
  - `?email=correo@empresa.com&name=Nombre%20Apellido`
- el admin ya apunta a producción y **se autoactualiza al abrir**

## Archivos
- `album.html`
- `styles.css`
- `app.js`
- `admin.html`
- `Code.gs`
- `README.md`

## Lógica de autoload del usuario
1. primero revisa si viene `email` y `name` en la URL
2. si no vienen, revisa `localStorage`
3. si encuentra datos válidos, carga automáticamente la colección en producción

## Consideración crítica
Esto mejora mucho la experiencia porque evita pedir el correo cada vez.
Pero no sustituye autenticación real.

Si alguien comparte un navegador o modifica la URL con otro correo, puede cargar otra colección si el backend no valida identidad.

Para una versión corporativa más robusta, el siguiente paso correcto sería integrar autenticación real con Google Workspace o una validación server-side más estricta.
