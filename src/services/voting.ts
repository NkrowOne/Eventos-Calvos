import { prisma } from '../database/client.js';
import { VoteType, RoundStatus } from '@prisma/client';
import { LIMITS } from '../types/index.js';

// --- Helpers: Anti-repeat pairings ---

async function getPreviousPairings(eventId: string): Promise<Map<string, number>> {
  const pairings = new Map<string, number>();

  const previousRounds = await prisma.round.findMany({
    where: { eventId, status: 'COMPLETED' },
    include: {
      groups: {
        include: { members: true },
      },
    },
  });

  for (const round of previousRounds) {
    for (const group of round.groups) {
      const memberIds = group.members.map((m) => m.participantId);
      // For each pair in the group, increment their co-occurrence
      for (let i = 0; i < memberIds.length; i++) {
        for (let j = i + 1; j < memberIds.length; j++) {
          const key = [memberIds[i], memberIds[j]].sort().join(':');
          pairings.set(key, (pairings.get(key) || 0) + 1);
        }
      }
    }
  }

  return pairings;
}

// --- Rondas y Grupos ---

export async function createRound(eventId: string, advanceCount?: number, scheduledDate?: Date) {
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
      scheduledDate: scheduledDate || null,
    },
  });
}

export async function createGroups(
  roundId: string,
  eventId: string,
  participantIds: string[],
  targetGroupSize: number = LIMITS.GROUP_SIZE,
) {
  // 1. Get previous pairings to avoid repeats
  const previousPairings = await getPreviousPairings(eventId);

  // 2. Calculate equitable group sizes
  const count = participantIds.length;
  const numGroups = Math.ceil(count / targetGroupSize);
  // Distribute evenly: some groups get ceil(count/numGroups), others get floor
  const baseSize = Math.floor(count / numGroups);
  const extraGroups = count % numGroups; // this many groups get baseSize+1

  // 3. Build groups minimizing co-occurrences
  // Shuffle first, then use greedy assignment
  const shuffled = [...participantIds].sort(() => Math.random() - 0.5);
  const groups: string[][] = Array.from({ length: numGroups }, () => []);

  for (const pid of shuffled) {
    // Find the group with the least co-occurrence with this participant
    // that still has capacity
    let bestGroup = 0;
    let bestScore = Infinity;

    for (let g = 0; g < numGroups; g++) {
      const maxSize = g < extraGroups ? baseSize + 1 : baseSize;
      if (groups[g].length >= maxSize) continue;

      // Calculate co-occurrence score for this group
      let score = 0;
      for (const existingPid of groups[g]) {
        const key = [pid, existingPid].sort().join(':');
        score += previousPairings.get(key) || 0;
      }

      if (score < bestScore) {
        bestScore = score;
        bestGroup = g;
      }
    }

    groups[bestGroup].push(pid);
  }

  // 4. Create groups in DB
  const createdGroups = [];

  for (let i = 0; i < numGroups; i++) {
    const memberIds = groups[i];

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

    createdGroups.push(group);
  }

  return createdGroups;
}

export async function openVoting(roundId: string, votingEnd?: Date) {
  return prisma.round.update({
    where: { id: roundId },
    data: {
      status: RoundStatus.VOTING,
      votingStart: new Date(),
      votingEnd: votingEnd || null,
    },
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

  // Set votingEnd to now if it wasn't already set
  const updateData: { status: RoundStatus; votingEnd?: Date } = {
    status: RoundStatus.COMPLETED,
  };
  if (!round.votingEnd) {
    updateData.votingEnd = new Date();
  }

  await prisma.round.update({
    where: { id: roundId },
    data: updateData,
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

// --- Votacion en Grupos ---

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
    return { success: false, reason: 'Ese participante no esta en este grupo.' };
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

// --- Votacion Final ---

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
    return { success: false, reason: 'Los finalistas no pueden votar en la votacion final.' };
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
    return { success: false, reason: 'Ya has votado en la votacion final.' };
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
