# Uptime Kuma

[Uptime Kuma](https://uptime.kuma.pet/) vigila sus sitios web y servicios
(HTTP, puerto TCP, ping, DNS, contenedores Docker…). Esta integración lleva sus
monitores a Gladys: cada uno se convierte en un dispositivo que indica si el
servicio está en servicio, su tiempo de respuesta y, para un sitio HTTPS, los
días que quedan antes de que caduque su certificado. Las escenas pueden
reaccionar cuando **cualquier** servicio se cae o vuelve, sin una escena por
dispositivo, y un widget del panel lo resume todo.

Probada con servidores reales de Uptime Kuma 1.23.17 y 2.5.6 (Docker); todavía
no en todas las instalaciones: sus comentarios son bienvenidos en
[las issues](https://github.com/guim31/gladys-uptime-kuma/issues).

## Lo que necesita

- Gladys Assistant 5.1.0 o posterior.
- Uptime Kuma 1.23 o 2.x, accesible desde la máquina de Gladys (en la red
  local, o en Internet por HTTPS).
- Una clave API de Uptime Kuma (o su autenticación desactivada).

La integración solo lee: pausar o reanudar un monitor se hace en Uptime Kuma
(haría falta su contraseña de administrador, que Gladys no pide).

## Primeros pasos

### 1. Crear una clave API

En Uptime Kuma, abra **Ajustes → Claves API**, haga clic en **Añadir clave
API**, dele un nombre (por ejemplo `Gladys`) y ninguna fecha de caducidad, y
después **Generar**. Copie la clave (empieza por `uk`): Uptime Kuma solo la
muestra una vez.

En cuanto existe una clave, Uptime Kuma pide una clave en `/metrics` en lugar
de su contraseña: las herramientas que lo leen con la contraseña
(Prometheus…) también necesitan una clave.

### 2. Configurar la integración

En Gladys, **Integraciones → Uptime Kuma → Configuración**:

- **Dirección de Uptime Kuma**: la dirección con la que abre Uptime Kuma,
  puerto incluido, por ejemplo `http://192.168.1.2:3001` o
  `https://status.example.com`. También vale una URL copiada del navegador
  (`…/dashboard/3`).
- **Clave API**: la clave del paso 1.
- **Nombre (opcional)**: se muestra en los mensajes y en el widget en lugar
  de la dirección.
- Se puede añadir un **segundo Uptime Kuma**, por ejemplo en un servidor
  alquilado que vigila su casa desde fuera.
- **Intervalo de actualización**: 30 segundos por defecto (de 15 segundos a
  5 minutos).
- **Aviso de certificado**: los días restantes a partir de los cuales se
  activa «El certificado caduca pronto» (14 por defecto).
- **Aceptar certificados autofirmados**: solo para una dirección `https://`
  cuyo certificado tampoco reconoce su navegador.
- **Idioma de los nombres**: el idioma de los nombres de las funciones y de
  los resultados de escena (francés por defecto).

Guarde y haga clic en **Probar la conexión**: cada Uptime Kuma responde con su
versión y su número de monitores.

### 3. Añadir los monitores

Abra la pestaña **Descubrir**: allí se proponen todos los monitores de Uptime
Kuma. Añada los que quiera ver en Gladys; no se añade nada en su lugar. Un
monitor creado más tarde en Uptime Kuma aparece allí en la lectura siguiente.

## El dispositivo de cada monitor

| Función                               | Valor                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------- |
| En servicio                           | Encendido cuando el servicio funciona, Apagado cuando está caído       |
| Tiempo de respuesta                   | La última comprobación, en milisegundos (no en los monitores de grupo) |
| Días hasta que caduque el certificado | Para los monitores de un sitio `https://`; negativo una vez caducado   |

Mientras Uptime Kuma reintenta una comprobación fallida («pendiente») o un
monitor está en mantenimiento, se mantiene el último valor: solo cuentan «en
servicio» y «caído». Mientras un monitor está caído, su tiempo de respuesta
conserva su último valor. Un monitor en pausa no envía nada.

Un tiempo de respuesta cambia en cada comprobación: se envía a Gladys como
mucho una vez por minuto y por monitor, para que un centenar de monitores se
quede muy por debajo de los 300 valores por minuto que Gladys acepta.

## Panel

Añada el widget **Uptime Kuma** a un panel. Muestra:

- el número de servicios **caídos** (en rojo si hay alguno) y **en
  servicio**;
- el **certificado** que caduca primero, en días (naranja a partir del umbral
  de aviso);
- una fila por monitor, los problemas primero: caído, pendiente,
  mantenimiento, en pausa, y después el tiempo de respuesta de los servicios en
  servicio — diez filas como máximo, y después el número de los demás;
- un Uptime Kuma que no responde;
- un botón **Actualizar** que vuelve a leer Uptime Kuma.

Por defecto, el widget muestra todos los monitores salvo los grupos (repiten
sus miembros). En su configuración, **Monitores** lo limita a los dispositivos
elegidos (solo se pueden elegir los dispositivos añadidos a Gladys, grupos
incluidos).

## Escenas

### Disparadores

Valen para todos los monitores, añadidos a Gladys o no. Deje **Monitores**
vacío para reaccionar a cualquiera, o elija algunos.

- **Un servicio se cae**: un monitor pasa de en servicio (o mantenimiento) a
  caído, una vez agotados los reintentos de Uptime Kuma. Variables: nombre del
  monitor, tipo de monitor, URL o host, nombre del Uptime Kuma.
- **Un servicio vuelve**: un monitor caído vuelve a estar en servicio.
  Variables: las mismas, más la duración de la caída en minutos y el tiempo de
  respuesta.
- **El certificado caduca pronto**: el certificado de un monitor alcanza el
  número de días restantes elegido en la configuración. Una vez por
  certificado; de nuevo tras una renovación. Variables: nombre del monitor,
  tipo, URL, días restantes, nombre del Uptime Kuma.
- **Uptime Kuma ya no responde**: el propio Uptime Kuma ha dejado de responder
  (dos lecturas seguidas), así que ya no se vigila nada. Variables: nombre del
  Uptime Kuma, error.

Un cambio ocurrido durante un reinicio de Gladys o de la integración se
anuncia igualmente, una vez. Un monitor que ya está caído en el primer inicio
de la integración no anuncia nada.

Un monitor de grupo se cae con sus miembros: elija los monitores en el filtro
para evitar dos mensajes por una sola caída.

### Acciones

- **Estado de un servicio**: lee un monitor para las acciones siguientes de la
  escena: en servicio (sí/no), el estado en palabras («En servicio», «Caído»,
  «Pendiente», «Mantenimiento», «En pausa»), el nombre del monitor, el tiempo
  de respuesta y los días hasta que caduque el certificado.
- **Contar los servicios caídos**: el número de servicios caídos, en servicio
  y en total (sin grupos), y los nombres de los caídos, para un mensaje.

Ambas vuelven a leer Uptime Kuma cuando la última lectura tiene más de
15 segundos.

### Ideas de escenas

- **Alerta en cada caída**: disparador «Un servicio se cae» (Monitores vacío)
  → enviar un mensaje «⚠️ … está caído», insertando las variables «Nombre del
  monitor» y «URL o host». Una segunda escena con «Un servicio vuelve» envía
  «✅ … ha vuelto tras … min» con «Duración de la caída (minutos)».
- **Informe matinal**: cada día a las 8:00 → «Contar los servicios caídos» →
  enviar un mensaje «… servicio(s) caído(s): …» con «Servicios caídos» y
  «Nombres de los servicios caídos».
- **Renovar a tiempo**: disparador «El certificado caduca pronto» → enviar un
  mensaje con «Nombre del monitor» y «Días restantes».
- **El router de internet se ha caído**: disparador «Un servicio se cae» en el
  monitor de su router → encender una luz en rojo.

## Solución de problemas

- **«Clave de API rechazada»**: compruebe la clave (empieza por `uk`) y que
  está activa en Ajustes → Claves API. Uptime Kuma también rechaza con el
  mismo error más allá de 60 peticiones de API por minuto, compartidas entre
  todas las herramientas que leen sus métricas: alargue el intervalo de
  actualización si otra herramienta también lo lee.
- **«Se necesita una clave de API»**: la autenticación de Uptime Kuma está
  activa y no hay ninguna clave configurada.
- **«No responde»**: compruebe la dirección y el puerto (3001 por defecto)
  desde la máquina de Gladys. `localhost` es el propio contenedor de la
  integración: use la dirección IP de la máquina en la que funciona Uptime
  Kuma.
- **«Certificado rechazado»**: el certificado HTTPS es autofirmado o ha
  caducado; marque «Aceptar certificados autofirmados», o use la dirección
  `http://` en la red local.
- **«No hay ningún Uptime Kuma en esta dirección»**: la dirección lleva a otro
  servicio, o Uptime Kuma 2 todavía espera la elección de su base de datos.
- **Falta un monitor en la pestaña Descubrir**: está en pausa en Uptime Kuma.
- **Un dispositivo se propone de nuevo tras pasar a Uptime Kuma 2**: los
  dispositivos añadidos con 1.x conservan su identidad; un monitor renombrado
  durante la actualización no se puede reconocer y se propone como un
  dispositivo nuevo.

## Límites

- Solo lectura: los monitores se pausan, se reanudan y se modifican en Uptime
  Kuma.
- Uptime Kuma se lee al intervalo de actualización: una caída más corta puede
  pasar desapercibida, y la duración de una caída se conoce con esa precisión.
- Con Uptime Kuma 1.x, los monitores no tienen identificador en las métricas:
  un monitor renombrado en Uptime Kuma 1.x se convierte en un dispositivo
  nuevo. Con 2.x, renombrar no tiene consecuencias.
- No se usan las etiquetas de Uptime Kuma, los porcentajes de disponibilidad
  ni las páginas de estado.
- Uptime Kuma responde como máximo a 60 peticiones de API por minuto; dos
  instancias leídas cada 15 segundos usan 8.
