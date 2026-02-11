import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from '../config.js';
import { prisma } from '../database/client.js';
import { readLogs } from '../utils/logger.js';

const app = express();
app.use(cors());
app.use(express.json());

// Determine static dir
const isDev = config.nodeEnv !== 'production';
const publicDir = isDev
  ? path.join(process.cwd(), 'src', 'web', 'public')
  : path.join(process.cwd(), 'dist', 'web', 'public');
app.use(express.static(publicDir));

// Admin auth middleware
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.query.token || req.headers['x-admin-token'];
  if (token !== config.web.adminToken) {
    res.status(403).json({ error: 'Token de admin inválido' });
    return;
  }
  next();
}

// ==================== PUBLIC API ====================

// GET /api/event - Current active event
app.get('/api/event', async (_req, res) => {
  try {
    const event = await prisma.event.findFirst({
      where: { active: true },
      include: {
        _count: {
          select: {
            participants: { where: { status: { in: ['ACTIVE', 'WARNING'] } } },
            invites: { where: { used: true } },
            votes: true,
          },
        },
      },
    });
    if (!event) {
      res.json({ event: null });
      return;
    }

    // Calculate time remaining for current phase
    let countdown = null;
    const now = new Date();
    if (event.phase === 'REGISTRATION' && event.registrationEnd) {
      countdown = { label: 'Cierre de inscripciones', target: event.registrationEnd.toISOString(), remaining: event.registrationEnd.getTime() - now.getTime() };
    } else if (event.phase === 'BRIEFING' && event.briefingEnd) {
      countdown = { label: 'Fin del briefing', target: event.briefingEnd.toISOString(), remaining: event.briefingEnd.getTime() - now.getTime() };
    } else if (event.phase === 'FINAL_VOTING' && event.finalVotingEnd) {
      countdown = { label: 'Fin de la votación', target: event.finalVotingEnd.toISOString(), remaining: event.finalVotingEnd.getTime() - now.getTime() };
    }

    // Get current round info
    const currentRound = await prisma.round.findFirst({
      where: { eventId: event.id, status: { in: ['CREATED', 'VOTING'] } },
      include: { _count: { select: { groups: true } } },
      orderBy: { roundNumber: 'desc' },
    });

    res.json({
      event: {
        id: event.id,
        name: event.name,
        description: event.description,
        phase: event.phase,
        requiredTag: event.requiredTag,
        registrationEnd: event.registrationEnd,
        briefingEnd: event.briefingEnd,
        finalVotingStart: event.finalVotingStart,
        finalVotingEnd: event.finalVotingEnd,
        createdAt: event.createdAt,
        participantCount: event._count.participants,
        inviteCount: event._count.invites,
        totalVotes: event._count.votes,
        countdown,
        currentRound: currentRound ? {
          number: currentRound.roundNumber,
          status: currentRound.status,
          groups: currentRound._count.groups,
          scheduledDate: currentRound.scheduledDate,
          votingEnd: currentRound.votingEnd,
        } : null,
      },
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/ranking - Public ranking
app.get('/api/ranking', async (_req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ ranking: [] }); return; }

    if (event.phase === 'FINAL_VOTING' || event.phase === 'CLOSED') {
      // Final results
      const finalists = await prisma.participant.findMany({
        where: { eventId: event.id, isFinalist: true },
        include: {
          votesReceived: { where: { voteType: { in: ['FINAL_VOTE', 'INVITE_BONUS'] } } },
          _count: { select: { invitesSent: { where: { validatedAt: { not: null } } } } },
        },
      });
      const ranking = finalists
        .map(f => ({
          displayName: f.currentName || f.displayName,
          finalVotes: f.votesReceived.filter(v => v.voteType === 'FINAL_VOTE').length,
          inviteBonus: f.votesReceived.filter(v => v.voteType === 'INVITE_BONUS').length,
          totalVotes: f.votesReceived.length,
          isFinalist: true,
          position: f.finalPosition,
        }))
        .sort((a, b) => b.totalVotes - a.totalVotes);
      res.json({ ranking, phase: event.phase });
    } else {
      // Show participants by invite count
      const participants = await prisma.participant.findMany({
        where: { eventId: event.id, status: { in: ['ACTIVE', 'WARNING'] } },
        include: { _count: { select: { invitesSent: { where: { validatedAt: { not: null } } } } } },
      });
      const ranking = participants
        .map(p => ({
          displayName: p.currentName || p.displayName,
          inviteCount: p._count.invitesSent,
          isFinalist: p.isFinalist,
        }))
        .sort((a, b) => b.inviteCount - a.inviteCount);
      res.json({ ranking, phase: event.phase });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/rounds - Public rounds info
app.get('/api/rounds', async (_req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ rounds: [] }); return; }
    const rounds = await prisma.round.findMany({
      where: { eventId: event.id },
      include: {
        groups: {
          include: {
            members: { include: { participant: true } },
            _count: { select: { votes: true } },
          },
          orderBy: { groupNumber: 'asc' },
        },
      },
      orderBy: { roundNumber: 'asc' },
    });

    const result = rounds.map(r => ({
      number: r.roundNumber,
      status: r.status,
      scheduledDate: r.scheduledDate,
      votingStart: r.votingStart,
      votingEnd: r.votingEnd,
      groups: r.groups.map(g => ({
        number: g.groupNumber,
        totalVotes: g._count.votes,
        members: g.members.map(m => ({
          displayName: m.participant.currentName || m.participant.displayName,
          advanced: m.advanced,
        })),
      })),
    }));
    res.json({ rounds: result });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/health - Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

// ==================== ADMIN API ====================

// GET /api/admin/participants
app.get('/api/admin/participants', requireAdmin, async (req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ participants: [] }); return; }
    const participants = await prisma.participant.findMany({
      where: { eventId: event.id },
      include: {
        _count: {
          select: {
            invitesSent: true,
            votesReceived: true,
            groupMembers: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({
      participants: participants.map(p => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        currentName: p.currentName,
        status: p.status,
        warningCount: p.warningCount,
        isFinalist: p.isFinalist,
        finalPosition: p.finalPosition,
        invitesSent: p._count.invitesSent,
        votesReceived: p._count.votesReceived,
        groupsParticipated: p._count.groupMembers,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/admin/invites
app.get('/api/admin/invites', requireAdmin, async (req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ invites: [] }); return; }
    const invites = await prisma.invite.findMany({
      where: { eventId: event.id },
      include: { inviter: { select: { displayName: true, userId: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      invites: invites.map(i => ({
        id: i.id,
        code: i.inviteCode,
        inviter: i.inviter.displayName,
        inviterUserId: i.inviter.userId,
        invitedUserId: i.invitedUserId,
        used: i.used,
        joinedAt: i.joinedAt,
        validatedAt: i.validatedAt,
        createdAt: i.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/admin/audit
app.get('/api/admin/audit', requireAdmin, async (req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ logs: [] }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await prisma.auditLog.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/admin/logs - Bot log file
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;
    const logLines = readLogs(lines);
    res.json({ logs: logLines });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/admin/stats
app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const event = await prisma.event.findFirst({ where: { active: true } });
    if (!event) { res.json({ stats: null }); return; }
    const [totalParticipants, activeParticipants, warned, disqualified, totalInvites, validInvites, totalVotes, rounds] = await Promise.all([
      prisma.participant.count({ where: { eventId: event.id } }),
      prisma.participant.count({ where: { eventId: event.id, status: 'ACTIVE' } }),
      prisma.participant.count({ where: { eventId: event.id, status: 'WARNING' } }),
      prisma.participant.count({ where: { eventId: event.id, status: 'DISQUALIFIED' } }),
      prisma.invite.count({ where: { eventId: event.id } }),
      prisma.invite.count({ where: { eventId: event.id, validatedAt: { not: null } } }),
      prisma.vote.count({ where: { eventId: event.id } }),
      prisma.round.count({ where: { eventId: event.id } }),
    ]);
    res.json({
      stats: {
        totalParticipants, activeParticipants, warned, disqualified,
        totalInvites, validInvites, totalVotes, rounds,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Serve admin page
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

export function startWebServer() {
  app.listen(config.web.port, () => {
    console.log(`[Web] Servidor web en http://localhost:${config.web.port}`);
    console.log(`[Web] URL pública: ${config.web.publicUrl}`);
  });
  return app;
}
