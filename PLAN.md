# Plan: Bot Discord "Nombres Locos"

## Arquitectura

```
Discord Bot (discord.js v14)
├── Slash Commands
├── Button Interactions
├── Event Handlers
├── Cron Jobs (node-cron)
└── PostgreSQL (via Prisma ORM)
```

**Stack**: Node.js + TypeScript + discord.js v14 + Prisma + PostgreSQL
**Deploy**: Railway (bot process + PostgreSQL addon)

---

## Estructura del Proyecto

```
src/
├── index.ts                 # Entry point, client setup
├── config.ts                # Variables de entorno, constantes
├── database/
│   └── prisma/
│       └── schema.prisma    # Modelos de datos
├── commands/
│   ├── inscribirse.ts       # (admin) Publicar embed de inscripción
│   ├── invitar.ts           # /invitar - link trackeable
│   ├── ranking.ts           # /ranking - ver TOP actual
│   ├── estado.ts            # /estado - ver tu estado en el concurso
│   ├── admin/
│   │   ├── iniciar-fase.ts  # Avanzar fase del concurso
│   │   ├── cerrar-evento.ts # Cerrar inscripciones
│   │   ├── descalificar.ts  # Descalificar participante
│   │   ├── asignar-premio.ts# Asignar roles y marcar ganadores
│   │   └── config-evento.ts # Configurar canales, roles, tag requerido
│   └── mod/
│       └── revisar.ts       # Ver participantes con warnings
├── events/
│   ├── ready.ts             # Bot ready
│   ├── interactionCreate.ts # Router de interacciones
│   ├── guildMemberUpdate.ts # Detectar cambio de tag/nickname
│   └── guildMemberRemove.ts # Si un participante se va del server
├── services/
│   ├── contest.ts           # Lógica del concurso
│   ├── invites.ts           # Tracking de invitaciones
│   ├── voting.ts            # Sistema de votaciones
│   ├── requirements.ts      # Verificación de requisitos
│   └── scheduler.ts         # Cron jobs (recordatorios, verificaciones)
├── utils/
│   ├── embeds.ts            # Builders de embeds
│   ├── permissions.ts       # Guards de admin/mod/participante
│   └── constants.ts         # IDs, colores, textos
└── types/
    └── index.ts             # Tipos TypeScript
```

---

## Modelo de Datos (Prisma)

```prisma
model Event {
  id          String   @id @default(cuid())
  name        String   // "Nombres Locos"
  phase       Phase    @default(REGISTRATION)
  channelId   String   // Canal del evento
  warningChId String   // Canal de advertencias
  votingChId  String?  // Canal de votación (se crea en fase voting)
  messageId   String?  // Mensaje con botón de inscripción
  requiredTag String   // Tag del servidor requerido
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  participants Participant[]
  invites      Invite[]
  votes        Vote[]
}

enum Phase {
  REGISTRATION    // Inscripción abierta, invitaciones activas
  REVIEW          // Admin revisa TOP y selecciona finalistas
  BRIEFING        // Los 10 finalistas hacen su pitch
  FINAL_VOTING    // Votación final abierta
  CLOSED          // Evento cerrado, ganadores anunciados
}

model Participant {
  id            String   @id @default(cuid())
  eventId       String
  userId        String   // Discord user ID
  displayName   String   // Nombre con el que se inscribió
  currentName   String?  // Nombre actual (se actualiza si cambia)
  status        ParticipantStatus @default(ACTIVE)
  warningCount  Int      @default(0)
  isFinalist    Boolean  @default(false)
  finalPosition Int?     // Posición final (1, 2, null)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  event         Event    @relation(fields: [eventId], references: [id])
  invitesSent   Invite[] @relation("Inviter")
  votesReceived Vote[]   @relation("VotesReceived")
  votesGiven    Vote[]   @relation("VotesGiven")

  @@unique([eventId, userId])
}

enum ParticipantStatus {
  ACTIVE
  WARNING         // No cumple requisitos, en periodo de gracia
  DISQUALIFIED    // Descalificado por no corregir
  WITHDRAWN       // Se retiró voluntariamente
}

model Invite {
  id            String   @id @default(cuid())
  eventId       String
  inviterId     String   // Participant ID del que invita
  inviteCode    String   @unique // Código de invitación Discord
  invitedUserId String?  // Discord user ID del invitado (cuando se une)
  used          Boolean  @default(false)
  createdAt     DateTime @default(now())

  event         Event       @relation(fields: [eventId], references: [id])
  inviter       Participant @relation("Inviter", fields: [inviterId], references: [id])
}

model Vote {
  id          String   @id @default(cuid())
  eventId     String
  voterId     String   // Participant ID de quien vota
  candidateId String   // Participant ID del votado
  voteType    VoteType
  createdAt   DateTime @default(now())

  event       Event       @relation(fields: [eventId], references: [id])
  voter       Participant @relation("VotesGiven", fields: [voterId], references: [id])
  candidate   Participant @relation("VotesReceived", fields: [candidateId], references: [id])

  @@unique([eventId, voterId, voteType]) // Un voto por persona por tipo
}

enum VoteType {
  INVITE_BONUS  // Voto extra por invitación (automático)
  MEMBER_VOTE   // Voto manual del invitado por el invitador
  FINAL_VOTE    // Voto en la ronda final
}
```

---

## Fases del Concurso

### Fase 1: REGISTRATION (Inscripción)
1. Admin usa `/config-evento` para establecer tag requerido, canales, etc.
2. Admin publica embed con botón "Inscribirse" en canal de eventos
3. Al pulsar el botón:
   - Verifica que NO sea admin/mod
   - Verifica que tenga el tag del servidor equipado
   - Registra su display name actual
   - Confirma inscripción con embed efímero
4. `/invitar` disponible: genera invite trackeable del servidor
5. Cuando alguien se une por invite trackeado:
   - Se marca la invitación como usada
   - Se crea un INVITE_BONUS vote automático para el invitador
   - Se notifica al invitado que puede votar por el invitador (botón)
6. Cron job periódico verifica:
   - Participantes que quitaron el tag → warning en canal de advertencias
   - Participantes con warning que corrigen → se resuelve el warning
   - Participantes con 3+ warnings → descalificación automática

### Fase 2: REVIEW (Selección de Finalistas)
1. Admin cierra inscripciones
2. Se genera ranking por votos de invitación acumulados
3. Admin revisa y selecciona TOP 10 finalistas
   - Puede considerar votos + creatividad del nombre
4. Se anuncia a los finalistas

### Fase 3: BRIEFING (Presentación)
1. Los 10 finalistas tienen un canal/hilo temporal
2. Cada uno postea su "pitch" (por qué debe ganar)
3. Se puede hacer en texto o voice (a decisión del admin)

### Fase 4: FINAL_VOTING (Votación Final)
1. Se abre votación a TODOS los miembros del servidor (no solo participantes)
2. Cada miembro puede votar por 1 finalista
3. Los votos INVITE_BONUS se suman al conteo final
4. Duración configurable (ej: 48h)
5. Al cerrar: se calcula ranking final

### Fase 5: CLOSED
1. Se anuncian ganadores
2. Se asigna rol de ganador al 1er lugar
3. Se anuncian premios
4. Datos persisten en BD para historial

---

## Comandos

| Comando | Quién | Descripción |
|---------|-------|-------------|
| `/evento publicar` | Admin | Publica embed de inscripción con botón |
| `/evento config` | Admin | Configura tag, canales, roles |
| `/evento fase` | Admin | Avanza a la siguiente fase |
| `/evento cerrar` | Admin | Cierra el evento |
| `/evento descalificar @user` | Admin/Mod | Descalifica participante |
| `/invitar` | Participante | Genera invite link trackeado |
| `/ranking` | Todos | Muestra TOP 10 actual |
| `/estado` | Participante | Muestra tu estado, invites, votos |
| `/votar` | Todos (fase final) | Vota por un finalista |

---

## Cosas que faltan en el brief y propongo

1. **Periodo de gracia para warnings**: 24h para recuperar el tag antes de descalificación.
2. **Límite de warnings**: 3 warnings = descalificación automática.
3. **Anti-abuse invitaciones**: Un usuario solo puede ser "invitado" una vez.
   Las invitaciones deben ser de cuentas nuevas en el servidor (no cuentas alt).
   Mínimo de permanencia: el invitado debe quedarse 24h para que cuente.
4. **Duración de votación final**: Configurada por admin (default 48h).
5. **Quién vota en la final**: Todos los miembros del servidor, no solo participantes.
   Esto maximiza engagement. Cada miembro = 1 voto.
6. **Empates**: Si hay empate en posición 1 o 2, se resuelve con votación
   relámpago de 24h entre los empatados.
7. **Cambio de nombre durante concurso**: Se permite cambiar el nombre divertido
   pero se registra el historial. El último nombre es el que compite.
8. **Canal de advertencias**: Canal específico donde se mencionan a los que
   pierden el tag y se les da instrucciones para recuperar su estado.
9. **Logs de auditoría**: Todas las acciones admin quedan registradas.
10. **Persistencia ante reinicios**: Todo en PostgreSQL, el bot recupera estado al reiniciar.

---

## Archivos a Crear (Orden de Implementación)

1. `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`
2. `prisma/schema.prisma` → modelo de datos
3. `Dockerfile`, `railway.toml` → deploy config
4. `src/config.ts` → variables de entorno
5. `src/index.ts` → client setup, login
6. `src/database/client.ts` → Prisma client singleton
7. `src/types/index.ts` → tipos compartidos
8. `src/utils/` → embeds, permisos, constantes
9. `src/events/` → handlers de eventos Discord
10. `src/commands/` → slash commands
11. `src/services/` → lógica de negocio
12. `src/deploy-commands.ts` → script para registrar commands
