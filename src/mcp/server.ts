import dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const LOG_FILE = path.join(process.cwd(), 'logs', 'bot.log');

const server = new McpServer({
  name: 'eventos-calvos',
  version: '2.0.0',
});

// Tool: get_event_status
server.tool('get_event_status', 'Obtener estado completo del evento activo', {}, async () => {
  const event = await prisma.event.findFirst({
    where: { active: true },
    include: {
      _count: {
        select: {
          participants: true,
          invites: true,
          votes: true,
          rounds: true,
        },
      },
    },
  });

  if (!event) {
    return { content: [{ type: 'text' as const, text: 'No hay evento activo.' }] };
  }

  const activeParticipants = await prisma.participant.count({
    where: { eventId: event.id, status: { in: ['ACTIVE', 'WARNING'] } },
  });

  const currentRound = await prisma.round.findFirst({
    where: { eventId: event.id, status: { in: ['CREATED', 'VOTING'] } },
    include: { _count: { select: { groups: true } } },
    orderBy: { roundNumber: 'desc' },
  });

  const finalists = await prisma.participant.count({
    where: { eventId: event.id, isFinalist: true },
  });

  const result = {
    evento: {
      id: event.id,
      nombre: event.name,
      descripcion: event.description,
      fase: event.phase,
      tagRequerido: event.requiredTag,
      fechas: {
        cierreInscripcion: event.registrationEnd,
        finBriefing: event.briefingEnd,
        inicioVotacionFinal: event.finalVotingStart,
        finVotacionFinal: event.finalVotingEnd,
        creado: event.createdAt,
      },
      conteos: {
        participantesTotal: event._count.participants,
        participantesActivos: activeParticipants,
        invitaciones: event._count.invites,
        votos: event._count.votes,
        rondas: event._count.rounds,
        finalistas: finalists,
      },
      rondaActual: currentRound ? {
        numero: currentRound.roundNumber,
        estado: currentRound.status,
        grupos: currentRound._count.groups,
        fechaProgramada: currentRound.scheduledDate,
        finVotacion: currentRound.votingEnd,
      } : null,
    },
  };

  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
});

// Tool: list_participants
server.tool('list_participants', 'Listar participantes del evento', {
  status: z.string().optional().describe('Filtrar por estado: ACTIVE, WARNING, DISQUALIFIED, WITHDRAWN'),
}, async ({ status }) => {
  const event = await prisma.event.findFirst({ where: { active: true } });
  if (!event) {
    return { content: [{ type: 'text' as const, text: 'No hay evento activo.' }] };
  }

  const where: any = { eventId: event.id };
  if (status) where.status = status;

  const participants = await prisma.participant.findMany({
    where,
    include: {
      _count: {
        select: {
          invitesSent: true,
          votesReceived: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const result = participants.map(p => ({
    id: p.id,
    discordId: p.userId,
    nombreInscrito: p.displayName,
    nombreActual: p.currentName,
    estado: p.status,
    advertencias: p.warningCount,
    esFinalista: p.isFinalist,
    posicionFinal: p.finalPosition,
    invitacionesEnviadas: p._count.invitesSent,
    votosRecibidos: p._count.votesReceived,
    inscritoEn: p.createdAt,
  }));

  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
});

// Tool: get_voting_results
server.tool('get_voting_results', 'Obtener resultados de votación actuales', {}, async () => {
  const event = await prisma.event.findFirst({ where: { active: true } });
  if (!event) {
    return { content: [{ type: 'text' as const, text: 'No hay evento activo.' }] };
  }

  if (event.phase === 'FINAL_VOTING' || event.phase === 'CLOSED') {
    const finalists = await prisma.participant.findMany({
      where: { eventId: event.id, isFinalist: true },
      include: { votesReceived: { where: { voteType: { in: ['FINAL_VOTE', 'INVITE_BONUS'] } } } },
    });
    const results = finalists.map(f => ({
      nombre: f.currentName || f.displayName,
      votosDirectos: f.votesReceived.filter(v => v.voteType === 'FINAL_VOTE').length,
      bonusInvitacion: f.votesReceived.filter(v => v.voteType === 'INVITE_BONUS').length,
      total: f.votesReceived.length,
      posicion: f.finalPosition,
    })).sort((a, b) => b.total - a.total);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ fase: event.phase, resultados: results }, null, 2) }] };
  }

  // Group stage
  const currentRound = await prisma.round.findFirst({
    where: { eventId: event.id, status: { in: ['CREATED', 'VOTING', 'COMPLETED'] } },
    include: {
      groups: {
        include: {
          members: { include: { participant: true } },
          votes: true,
        },
      },
    },
    orderBy: { roundNumber: 'desc' },
  });

  if (!currentRound) {
    return { content: [{ type: 'text' as const, text: 'No hay rondas.' }] };
  }

  const groupResults = currentRound.groups.map(g => {
    const counts = new Map<string, number>();
    g.members.forEach(m => counts.set(m.participantId, 0));
    g.votes.forEach(v => counts.set(v.candidateId, (counts.get(v.candidateId) ?? 0) + 1));
    return {
      grupo: g.groupNumber,
      miembros: g.members.map(m => ({
        nombre: m.participant.currentName || m.participant.displayName,
        votos: counts.get(m.participantId) ?? 0,
        avanza: m.advanced,
      })).sort((a, b) => b.votos - a.votos),
    };
  });

  return { content: [{ type: 'text' as const, text: JSON.stringify({ fase: event.phase, ronda: currentRound.roundNumber, estado: currentRound.status, grupos: groupResults }, null, 2) }] };
});

// Tool: get_audit_log
server.tool('get_audit_log', 'Obtener log de auditoría', {
  limit: z.number().optional().default(50).describe('Número de entradas'),
}, async ({ limit }) => {
  const event = await prisma.event.findFirst({ where: { active: true } });
  if (!event) {
    return { content: [{ type: 'text' as const, text: 'No hay evento activo.' }] };
  }
  const logs = await prisma.auditLog.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
  return { content: [{ type: 'text' as const, text: JSON.stringify(logs, null, 2) }] };
});

// Tool: get_invites_report
server.tool('get_invites_report', 'Obtener reporte de invitaciones', {}, async () => {
  const event = await prisma.event.findFirst({ where: { active: true } });
  if (!event) {
    return { content: [{ type: 'text' as const, text: 'No hay evento activo.' }] };
  }
  const invites = await prisma.invite.findMany({
    where: { eventId: event.id },
    include: { inviter: { select: { displayName: true, userId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const result = invites.map(i => ({
    codigo: i.inviteCode,
    invitador: i.inviter.displayName,
    invitadorDiscordId: i.inviter.userId,
    invitadoId: i.invitedUserId,
    usado: i.used,
    seUnio: i.joinedAt,
    validado: i.validatedAt,
    creado: i.createdAt,
  }));
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
});

// Tool: read_bot_logs
server.tool('read_bot_logs', 'Leer logs del bot', {
  lines: z.number().optional().default(100).describe('Número de líneas'),
}, async ({ lines }) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { content: [{ type: 'text' as const, text: 'No hay archivo de logs.' }] };
    }
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);
    const result = allLines.slice(-lines).join('\n');
    return { content: [{ type: 'text' as const, text: result || 'Logs vacíos.' }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: `Error leyendo logs: ${error}` }] };
  }
});

// Tool: get_system_health
server.tool('get_system_health', 'Obtener estado del sistema', {}, async () => {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }
  const result = {
    baseDatos: dbStatus,
    uptime: `${Math.floor(process.uptime())}s`,
    memoria: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heap: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    },
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
});

// Tool: execute_query (READ-ONLY)
server.tool('execute_query', 'Ejecutar consulta SQL de solo lectura', {
  query: z.string().describe('Consulta SQL (solo SELECT)'),
}, async ({ query }) => {
  const trimmed = query.trim();
  if (!trimmed.toUpperCase().startsWith('SELECT')) {
    return { content: [{ type: 'text' as const, text: 'Error: Solo se permiten consultas SELECT.' }] };
  }
  try {
    const result = await prisma.$queryRawUnsafe(trimmed);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { content: [{ type: 'text' as const, text: `Error SQL: ${error}` }] };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
