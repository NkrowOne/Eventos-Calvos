import { prisma } from '../database/client.js';
import { EventPhase, ParticipantStatus } from '@prisma/client';
import { LIMITS } from '../types/index.js';

export async function getActiveEvent(guildId: string) {
  return prisma.event.findFirst({
    where: { guildId, active: true },
  });
}

export async function createEvent(data: {
  name: string;
  guildId: string;
  channelId: string;
  requiredTag?: string;
}) {
  // Desactivar cualquier evento anterior
  await prisma.event.updateMany({
    where: { guildId: data.guildId, active: true },
    data: { active: false },
  });

  return prisma.event.create({
    data: {
      name: data.name,
      guildId: data.guildId,
      channelId: data.channelId,
      requiredTag: data.requiredTag || null,
    },
  });
}

export async function registerParticipant(eventId: string, userId: string, displayName: string) {
  const existing = await prisma.participant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });

  if (existing) {
    return { success: false, reason: 'Ya estás inscrito en este evento.' };
  }

  const participant = await prisma.participant.create({
    data: {
      eventId,
      userId,
      displayName,
      currentName: displayName,
    },
  });

  return { success: true, participant };
}

export async function getParticipant(eventId: string, userId: string) {
  return prisma.participant.findUnique({
    where: { eventId_userId: { eventId, userId } },
  });
}

export async function getActiveParticipants(eventId: string) {
  return prisma.participant.findMany({
    where: {
      eventId,
      status: { in: [ParticipantStatus.ACTIVE, ParticipantStatus.WARNING] },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getFinalists(eventId: string) {
  return prisma.participant.findMany({
    where: { eventId, isFinalist: true },
  });
}

export async function updateEventPhase(eventId: string, phase: EventPhase) {
  return prisma.event.update({
    where: { id: eventId },
    data: { phase },
  });
}

export async function setEventMessageId(eventId: string, messageId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: { messageId },
  });
}

export async function setWarningChannel(eventId: string, channelId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: { warningChannelId: channelId },
  });
}

export async function setVotingChannel(eventId: string, channelId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: { votingChannelId: channelId },
  });
}

export async function warnParticipant(participantId: string, eventId: string, userId: string, reason: string) {
  const participant = await prisma.participant.update({
    where: { id: participantId },
    data: {
      status: ParticipantStatus.WARNING,
      warningCount: { increment: 1 },
    },
  });

  await logAudit(eventId, 'SYSTEM', 'WARNING', `Advertencia a <@${userId}>: ${reason}`);

  if (participant.warningCount >= LIMITS.MAX_WARNINGS) {
    await disqualifyParticipant(participantId, eventId, userId, 'Alcanzó el máximo de advertencias');
  }

  return participant;
}

export async function resolveWarning(participantId: string) {
  return prisma.participant.update({
    where: { id: participantId },
    data: { status: ParticipantStatus.ACTIVE },
  });
}

export async function disqualifyParticipant(participantId: string, eventId: string, userId: string, reason: string) {
  await prisma.participant.update({
    where: { id: participantId },
    data: { status: ParticipantStatus.DISQUALIFIED },
  });

  await logAudit(eventId, 'SYSTEM', 'DISQUALIFY', `Descalificado <@${userId}>: ${reason}`);
}

export async function updateParticipantName(participantId: string, newName: string) {
  return prisma.participant.update({
    where: { id: participantId },
    data: { currentName: newName },
  });
}

export async function setFinalists(eventId: string, participantIds: string[]) {
  // Reset all
  await prisma.participant.updateMany({
    where: { eventId },
    data: { isFinalist: false },
  });

  // Set new finalists
  await prisma.participant.updateMany({
    where: { id: { in: participantIds } },
    data: { isFinalist: true },
  });
}

export async function setWinners(eventId: string, firstId: string, secondId: string) {
  await prisma.participant.update({
    where: { id: firstId },
    data: { finalPosition: 1 },
  });
  await prisma.participant.update({
    where: { id: secondId },
    data: { finalPosition: 2 },
  });
  await updateEventPhase(eventId, EventPhase.CLOSED);
}

export async function getParticipantCount(eventId: string) {
  return prisma.participant.count({
    where: {
      eventId,
      status: { in: [ParticipantStatus.ACTIVE, ParticipantStatus.WARNING] },
    },
  });
}

export async function logAudit(eventId: string, userId: string, action: string, details?: string) {
  return prisma.auditLog.create({
    data: { eventId, userId, action, details },
  });
}
