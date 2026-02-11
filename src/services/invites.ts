import { Guild, TextChannel } from 'discord.js';
import { prisma } from '../database/client.js';
import { VoteType } from '@prisma/client';
import { LIMITS } from '../types/index.js';

export async function createTrackedInvite(
  guild: Guild,
  channelId: string,
  eventId: string,
  participantId: string
) {
  // Verificar si ya tiene un invite activo
  const existing = await prisma.invite.findFirst({
    where: {
      eventId,
      inviterId: participantId,
      used: false,
    },
  });

  if (existing) {
    return { code: existing.inviteCode, isNew: false };
  }

  // Crear invite de Discord
  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) {
    throw new Error('Canal no encontrado para crear invitación');
  }

  const invite = await channel.createInvite({
    maxAge: 0, // No expira
    maxUses: 0, // Sin límite de usos
    unique: true,
    reason: `Invite trackeado para concurso - Participante ${participantId}`,
  });

  await prisma.invite.create({
    data: {
      eventId,
      inviterId: participantId,
      inviteCode: invite.code,
    },
  });

  return { code: invite.code, isNew: true };
}

export async function trackInviteUse(inviteCode: string, invitedUserId: string) {
  const invite = await prisma.invite.findUnique({
    where: { inviteCode },
    include: { inviter: true },
  });

  if (!invite) return null;

  // Verificar que el invitado no sea el propio invitador
  if (invite.inviter.userId === invitedUserId) return null;

  // Verificar que este usuario no haya sido ya invitado por alguien
  const alreadyInvited = await prisma.invite.findFirst({
    where: {
      eventId: invite.eventId,
      invitedUserId,
      used: true,
    },
  });

  if (alreadyInvited) return null;

  // Marcar como usado
  await prisma.invite.update({
    where: { id: invite.id },
    data: {
      used: true,
      invitedUserId,
      joinedAt: new Date(),
    },
  });

  return invite;
}

export async function validateInvite(inviteId: string) {
  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    include: { inviter: true },
  });

  if (!invite || !invite.joinedAt || invite.validatedAt) return null;

  const hoursSinceJoin = (Date.now() - invite.joinedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceJoin < LIMITS.INVITE_VALIDATION_HOURS) return null;

  // Validar el invite y crear voto bonus
  await prisma.invite.update({
    where: { id: invite.id },
    data: { validatedAt: new Date() },
  });

  // Crear voto bonus automático
  await prisma.vote.create({
    data: {
      eventId: invite.eventId,
      voterId: invite.invitedUserId!, // El invitado "da" el voto automático
      candidateId: invite.inviterId,
      voteType: VoteType.INVITE_BONUS,
    },
  });

  return invite;
}

export async function getInvitesByParticipant(participantId: string) {
  return prisma.invite.findMany({
    where: { inviterId: participantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getValidInviteCount(participantId: string) {
  return prisma.invite.count({
    where: {
      inviterId: participantId,
      validatedAt: { not: null },
    },
  });
}

export async function getPendingValidations(eventId: string) {
  const cutoff = new Date(Date.now() - LIMITS.INVITE_VALIDATION_HOURS * 60 * 60 * 1000);
  return prisma.invite.findMany({
    where: {
      eventId,
      used: true,
      validatedAt: null,
      joinedAt: { lte: cutoff },
    },
  });
}

export async function findInviteByCode(code: string) {
  return prisma.invite.findUnique({
    where: { inviteCode: code },
    include: { inviter: true },
  });
}

export async function getAllTrackedInviteCodes(eventId: string) {
  const invites = await prisma.invite.findMany({
    where: { eventId },
    select: { inviteCode: true, inviterId: true },
  });
  return invites;
}
