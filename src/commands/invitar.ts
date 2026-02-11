import { SlashCommandBuilder } from 'discord.js';
import type { CommandInteraction } from '../types/index.js';
import { EMOJIS } from '../types/index.js';
import { canParticipate } from '../utils/permissions.js';
import { createInviteEmbed } from '../utils/embeds.js';
import { getActiveEvent, getParticipant } from '../services/contest.js';
import { createTrackedInvite, getInvitesByParticipant, getValidInviteCount } from '../services/invites.js';
import { EventPhase } from '@prisma/client';

export const data = new SlashCommandBuilder()
  .setName('invitar')
  .setDescription('Obtén tu enlace de invitación con tracking para el concurso');

export async function execute(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No hay evento activo en este momento.`,
      ephemeral: true,
    });
    return;
  }

  if (event.phase === EventPhase.CLOSED) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} El evento ya ha finalizado.`,
      ephemeral: true,
    });
    return;
  }

  const participant = await getParticipant(event.id, interaction.user.id);
  if (!participant) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Debes estar inscrito en el evento para usar este comando. ¡Inscríbete primero!`,
      ephemeral: true,
    });
    return;
  }

  if (participant.status === 'DISQUALIFIED') {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Has sido descalificado del evento.`,
      ephemeral: true,
    });
    return;
  }

  try {
    const { code } = await createTrackedInvite(
      interaction.guild!,
      event.channelId,
      event.id,
      participant.id
    );

    const inviteUrl = `https://discord.gg/${code}`;
    const validCount = await getValidInviteCount(participant.id);

    const embed = createInviteEmbed(inviteUrl, validCount);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('Error creando invitación:', error);
    await interaction.reply({
      content: `${EMOJIS.CROSS} Error al crear la invitación. Inténtalo de nuevo.`,
      ephemeral: true,
    });
  }
}
