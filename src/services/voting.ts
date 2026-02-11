import { prisma } from '../database/client.js';
import { VoteType, RoundStatus } from '@prisma/client';
import { LIMITS } from '../types/index.js';

// --- Rondas y Grupos ---

export async function createRound(eventId: string, advanceCount?: number) {
  const lastRound = await prisma.round.findFirst({
    where: { eventId },
    orderBy: { roundNumber: 'desc' },
  });

  const roundNumber = (lastRound?.roundNumber ?? 0) + 1;

  return prisma.round.create({
    data: {
      eventId,
      roundNumber,
      advanceCount: advanceCount ?? LIMITS.ADVANCE_PER_GROUP,
    },
  });
}

export async function createGroups(roundId: string, participantIds: string[], groupSize: number = LIMITS.GROUP_SIZE) {
  // Mezclar participantes aleatoriamente
  const shuffled = [...participantIds].sort(() => Math.random() - 0.5);

  const groupCount = Math.ceil(shuffled.length / groupSize);
  const groups = [];

  for (let i = 0; i < groupCount; i++) {
    const start = i * groupSize;
    const end = Math.min(start + groupSize, shuffled.length);
    const memberIds = shuffled.slice(start, end);

    const group = await prisma.group.create({
      data: {
        roundId,
        groupNumber: i + 1,
        members: {
          create: memberIds.map((pid) => ({
            participantId: pid,
          })),
        },
      },
      include: { members: true },
    });

    groups.push(group);
  }

  return groups;
}

export async function openVoting(roundId: string) {
  return prisma.round.update({
    where: { id: roundId },
    data: { status: RoundStatus.VOTING },
  });
}

export async function closeRound(roundId: string) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: {
      groups: {
        include: {
          members: { include: { participant: true } },
          votes: true,
        },
      },
    },
  });

  if (!round) throw new Error('Ronda no encontrada');

  const advancedParticipantIds: string[] = [];

  for (const group of round.groups) {
    // Contar votos por candidato en este grupo
    const voteCounts = new Map<string, number>();
    for (const member of group.members) {
      voteCounts.set(member.participantId, 0);
    }
    for (const vote of group.votes) {
      voteCounts.set(vote.candidateId, (voteCounts.get(vote.candidateId) ?? 0) + 1);
    }

    // Ordenar por votos (descendente)
    const sorted = [...voteCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Los top N avanzan
    const advancing = sorted.slice(0, round.advanceCount).map(([pid]) => pid);

    for (const pid of advancing) {
      await prisma.groupMember.updateMany({
        where: { groupId: group.id, participantId: pid },
        data: { advanced: true },
      });
      advancedParticipantIds.push(pid);
    }
  }

  await prisma.round.update({
    where: { id: roundId },
    data: { status: RoundStatus.COMPLETED },
  });

  return advancedParticipantIds;
}

export async function getCurrentRound(eventId: string) {
  return prisma.round.findFirst({
    where: {
      eventId,
      status: { in: [RoundStatus.CREATED, RoundStatus.VOTING] },
    },
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
}

export async function getAdvancedParticipants(roundId: string) {
  const members = await prisma.groupMember.findMany({
    where: { group: { roundId }, advanced: true },
    include: { participant: true },
  });
  return members.map((m) => m.participant);
}

// --- Votación en Grupos ---

export async function voteInGroup(eventId: string, groupId: string, voterId: string, candidateId: string) {
  // Verificar que no se autovote
  const candidate = await prisma.participant.findUnique({ where: { id: candidateId } });
  if (candidate?.userId === voterId) {
    return { success: false, reason: 'No puedes votarte a ti mismo.' };
  }

  // Verificar que el candidato pertenece al grupo
  const isMember = await prisma.groupMember.findFirst({
    where: { groupId, participantId: candidateId },
  });
  if (!isMember) {
    return { success: false, reason: 'Ese participante no está en este grupo.' };
  }

  // Verificar voto existente en este grupo
  const existing = await prisma.vote.findUnique({
    where: {
      eventId_voterId_groupId_voteType: {
        eventId,
        voterId,
        groupId,
        voteType: VoteType.GROUP_VOTE,
      },
    },
  });

  if (existing) {
    return { success: false, reason: 'Ya has votado en este grupo.' };
  }

  await prisma.vote.create({
    data: {
      eventId,
      voterId,
      candidateId,
      groupId,
      voteType: VoteType.GROUP_VOTE,
    },
  });

  return { success: true };
}

// --- Votación Final ---

export async function voteFinal(eventId: string, voterId: string, candidateId: string) {
  // Verificar que el candidato es finalista
  const candidate = await prisma.participant.findUnique({ where: { id: candidateId } });
  if (!candidate?.isFinalist) {
    return { success: false, reason: 'Ese participante no es finalista.' };
  }

  // Verificar que el votante no es finalista
  const voterAsParticipant = await prisma.participant.findUnique({
    where: { eventId_userId: { eventId, userId: voterId } },
  });
  if (voterAsParticipant?.isFinalist) {
    return { success: false, reason: 'Los finalistas no pueden votar en la votación final.' };
  }

  // Verificar voto existente
  const existing = await prisma.vote.findFirst({
    where: {
      eventId,
      voterId,
      voteType: VoteType.FINAL_VOTE,
    },
  });

  if (existing) {
    return { success: false, reason: 'Ya has votado en la votación final.' };
  }

  await prisma.vote.create({
    data: {
      eventId,
      voterId,
      candidateId,
      voteType: VoteType.FINAL_VOTE,
    },
  });

  return { success: true };
}

// --- Conteo ---

export async function getFinalResults(eventId: string) {
  const finalists = await prisma.participant.findMany({
    where: { eventId, isFinalist: true },
    include: {
      votesReceived: {
        where: {
          voteType: { in: [VoteType.FINAL_VOTE, VoteType.INVITE_BONUS] },
        },
      },
    },
  });

  const results = finalists.map((f) => ({
    participantId: f.id,
    userId: f.userId,
    displayName: f.currentName || f.displayName,
    finalVotes: f.votesReceived.filter((v) => v.voteType === VoteType.FINAL_VOTE).length,
    inviteBonusVotes: f.votesReceived.filter((v) => v.voteType === VoteType.INVITE_BONUS).length,
    totalVotes: f.votesReceived.length,
  }));

  return results.sort((a, b) => b.totalVotes - a.totalVotes);
}

export async function getGroupResults(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { include: { participant: true } },
      votes: true,
    },
  });

  if (!group) return [];

  const voteCounts = new Map<string, number>();
  for (const member of group.members) {
    voteCounts.set(member.participantId, 0);
  }
  for (const vote of group.votes) {
    voteCounts.set(vote.candidateId, (voteCounts.get(vote.candidateId) ?? 0) + 1);
  }

  return group.members
    .map((m) => ({
      participantId: m.participantId,
      userId: m.participant.userId,
      displayName: m.participant.currentName || m.participant.displayName,
      votes: voteCounts.get(m.participantId) ?? 0,
      advanced: m.advanced,
    }))
    .sort((a, b) => b.votes - a.votes);
}

export async function getRoundGroupsWithVotes(roundId: string) {
  return prisma.group.findMany({
    where: { roundId },
    include: {
      members: { include: { participant: true } },
      votes: true,
    },
    orderBy: { groupNumber: 'asc' },
  });
}
