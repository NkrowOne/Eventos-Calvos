import { Events, GuildMember, PartialGuildMember, TextChannel } from 'discord.js';
import { prisma } from '../database/client.js';
import { getActiveEvent, getParticipant, updateParticipantName } from '../services/contest.js';
import { checkTag } from '../services/requirements.js';
import { warnParticipant, resolveWarning } from '../services/contest.js';
import { createWarningEmbed } from '../utils/embeds.js';
import { ParticipantStatus } from '@prisma/client';

export const name = Events.GuildMemberUpdate;

export async function execute(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
  // Solo nos interesa si cambió el nickname o roles
  if (oldMember.displayName === newMember.displayName && oldMember.roles.cache.size === newMember.roles.cache.size) {
    return;
  }

  const event = await getActiveEvent(newMember.guild.id);
  if (!event) return;

  const participant = await getParticipant(event.id, newMember.id);
  if (!participant) return;
  if (participant.status === 'DISQUALIFIED' || participant.status === 'WITHDRAWN') return;

  // Actualizar nombre si cambió
  if (oldMember.displayName !== newMember.displayName) {
    await updateParticipantName(participant.id, newMember.displayName);
  }

  // Verificar tag si hay uno requerido
  if (event.requiredTag) {
    const check = checkTag(newMember, event.requiredTag);

    if (!check.passed && participant.status === ParticipantStatus.ACTIVE) {
      await warnParticipant(participant.id, event.id, newMember.id, check.reason!);

      // Enviar aviso al canal de advertencias
      if (event.warningChannelId) {
        const channel = newMember.guild.channels.cache.get(event.warningChannelId) as TextChannel;
        if (channel) {
          const embed = createWarningEmbed(newMember.id, check.reason!);
          await channel.send({ embeds: [embed] });
        }
      }
    } else if (check.passed && participant.status === ParticipantStatus.WARNING) {
      await resolveWarning(participant.id);
    }
  }
}
