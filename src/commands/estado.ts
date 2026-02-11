import { SlashCommandBuilder } from 'discord.js';
import type { CommandInteraction } from '../types/index.js';
import { EMOJIS } from '../types/index.js';
import { createStatusEmbed } from '../utils/embeds.js';
import { getActiveEvent, getParticipant } from '../services/contest.js';
import { getInvitesByParticipant, getValidInviteCount } from '../services/invites.js';

export const data = new SlashCommandBuilder()
  .setName('estado')
  .setDescription('Ver tu estado en el concurso');

export async function execute(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No hay evento activo.`,
      ephemeral: true,
    });
    return;
  }

  const participant = await getParticipant(event.id, interaction.user.id);
  if (!participant) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No estás inscrito en el evento.`,
      ephemeral: true,
    });
    return;
  }

  const allInvites = await getInvitesByParticipant(participant.id);
  const validInvites = await getValidInviteCount(participant.id);

  const embed = createStatusEmbed({
    displayName: participant.currentName || participant.displayName,
    status: participant.status,
    warnings: participant.warningCount,
    inviteCount: allInvites.length,
    validInvites,
    isFinalist: participant.isFinalist,
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
