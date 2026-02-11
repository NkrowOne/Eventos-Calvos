import { ButtonInteraction } from 'discord.js';
import { CUSTOM_IDS, EMOJIS } from '../types/index.js';
import { getActiveEvent } from '../services/contest.js';
import { voteInGroup, getCurrentRound } from '../services/voting.js';
import { prisma } from '../database/client.js';
import { EventPhase } from '@prisma/client';

export async function handleGroupVoteButton(interaction: ButtonInteraction) {
  const candidateId = interaction.customId.replace(CUSTOM_IDS.VOTE_GROUP_PREFIX, '');

  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  if (event.phase !== EventPhase.GROUP_STAGE) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No estamos en fase de votación por grupos.`, ephemeral: true });
    return;
  }

  // Encontrar el grupo al que pertenece este candidato en la ronda actual
  const round = await getCurrentRound(event.id);
  if (!round || round.status !== 'VOTING') {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay votación abierta.`, ephemeral: true });
    return;
  }

  // Buscar en qué grupo está el candidato
  const groupMember = await prisma.groupMember.findFirst({
    where: {
      participantId: candidateId,
      group: { roundId: round.id },
    },
    include: { group: true },
  });

  if (!groupMember) {
    await interaction.reply({ content: `${EMOJIS.CROSS} Candidato no encontrado en la ronda actual.`, ephemeral: true });
    return;
  }

  const result = await voteInGroup(event.id, groupMember.groupId, interaction.user.id, candidateId);

  if (!result.success) {
    await interaction.reply({ content: `${EMOJIS.CROSS} ${result.reason}`, ephemeral: true });
    return;
  }

  // Obtener nombre del candidato
  const candidate = await prisma.participant.findUnique({ where: { id: candidateId } });
  const candidateName = candidate?.currentName || candidate?.displayName || 'Desconocido';

  await interaction.reply({
    content: `${EMOJIS.CHECK} ¡Has votado por **${candidateName}** en el Grupo ${groupMember.group.groupNumber}!`,
    ephemeral: true,
  });
}
