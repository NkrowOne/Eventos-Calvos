import { Guild, GuildMember } from 'discord.js';
import { prisma } from '../database/client.js';
import { ParticipantStatus } from '@prisma/client';
import { warnParticipant, resolveWarning, disqualifyParticipant } from './contest.js';
import { LIMITS } from '../types/index.js';

export interface RequirementCheck {
  passed: boolean;
  reason?: string;
}

export function checkTag(member: GuildMember, requiredTag: string | null): RequirementCheck {
  if (!requiredTag) return { passed: true };

  // El tag del clan/servidor se puede verificar de varias formas
  // Discord tiene el concepto de "clan tag" en el perfil
  // También se puede verificar si tiene un rol específico que represente el tag
  // Por ahora verificamos si su display name contiene el tag
  const hasTag = member.displayName.includes(requiredTag) ||
    member.user.globalName?.includes(requiredTag) ||
    false;

  if (!hasTag) {
    return {
      passed: false,
      reason: `No tienes el tag del servidor equipado: \`${requiredTag}\``,
    };
  }

  return { passed: true };
}

export async function checkAllParticipants(guild: Guild) {
  const event = await prisma.event.findFirst({
    where: { guildId: guild.id, active: true },
  });

  if (!event || !event.requiredTag) return;

  const participants = await prisma.participant.findMany({
    where: {
      eventId: event.id,
      status: { in: [ParticipantStatus.ACTIVE, ParticipantStatus.WARNING] },
    },
  });

  const warnings: { userId: string; reason: string }[] = [];
  const resolved: string[] = [];

  for (const participant of participants) {
    try {
      const member = await guild.members.fetch(participant.userId);
      const check = checkTag(member, event.requiredTag);

      if (!check.passed && participant.status === ParticipantStatus.ACTIVE) {
        await warnParticipant(participant.id, event.id, participant.userId, check.reason!);
        warnings.push({ userId: participant.userId, reason: check.reason! });
      } else if (check.passed && participant.status === ParticipantStatus.WARNING) {
        await resolveWarning(participant.id);
        resolved.push(participant.userId);
      }

      // Actualizar nombre actual
      if (member.displayName !== participant.currentName) {
        await prisma.participant.update({
          where: { id: participant.id },
          data: { currentName: member.displayName },
        });
      }
    } catch {
      // Member left the server or can't be fetched
      if (participant.status !== ParticipantStatus.DISQUALIFIED) {
        await disqualifyParticipant(
          participant.id,
          event.id,
          participant.userId,
          'Ya no está en el servidor'
        );
      }
    }
  }

  return { warnings, resolved };
}
