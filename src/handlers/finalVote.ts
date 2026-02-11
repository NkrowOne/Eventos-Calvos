import { ButtonInteraction } from 'discord.js';
import { CUSTOM_IDS, EMOJIS } from '../types/index.js';
import { getActiveEvent } from '../services/contest.js';
import { voteFinal } from '../services/voting.js';
import { prisma } from '../database/client.js';
import { EventPhase } from '@prisma/client';

export async function handleFinalVoteButton(interaction: ButtonInteraction) {
  const candidateId = interaction.customId.replace(CUSTOM_IDS.VOTE_FINAL_PREFIX, '');

  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  if (event.phase !== EventPhase.FINAL_VOTING) {
    await interaction.reply({ content: `${EMOJIS.CROSS} La votación final no está abierta.`, ephemeral: true });
    return;
  }

  const result = await voteFinal(event.id, interaction.user.id, candidateId);

  if (!result.success) {
    await interaction.reply({ content: `${EMOJIS.CROSS} ${result.reason}`, ephemeral: true });
    return;
  }

  const candidate = await prisma.participant.findUnique({ where: { id: candidateId } });
  const candidateName = candidate?.currentName || candidate?.displayName || 'Desconocido';

  await interaction.reply({
    content: `${EMOJIS.CHECK} ¡Has votado por **${candidateName}** en la votación final! Gracias por participar.`,
    ephemeral: true,
  });
}
