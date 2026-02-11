import { ButtonInteraction } from 'discord.js';
import { CUSTOM_IDS, EMOJIS } from '../types/index.js';
import { getActiveEvent, getParticipant } from '../services/contest.js';
import { prisma } from '../database/client.js';
import { VoteType } from '@prisma/client';

export async function handleInviterVoteButton(interaction: ButtonInteraction) {
  const inviterUserId = interaction.customId.replace(CUSTOM_IDS.VOTE_INVITER_PREFIX, '');

  // Este botón puede llegar por DM, necesitamos encontrar el evento
  // Buscamos el evento activo basándonos en la invitación
  const invite = await prisma.invite.findFirst({
    where: {
      invitedUserId: interaction.user.id,
      used: true,
      inviter: { userId: inviterUserId },
    },
    include: { inviter: true, event: true },
  });

  if (!invite) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No se encontró tu invitación. Puede que ya hayas votado o la invitación no sea válida.`,
      ephemeral: true,
    });
    return;
  }

  // Verificar que no haya votado ya
  const existingVote = await prisma.vote.findFirst({
    where: {
      eventId: invite.eventId,
      voterId: interaction.user.id,
      candidateId: invite.inviterId,
      voteType: VoteType.INVITE_BONUS,
    },
  });

  if (existingVote) {
    await interaction.reply({
      content: `${EMOJIS.WARNING} Ya has votado por esta persona. ¡Gracias igualmente!`,
      ephemeral: true,
    });
    return;
  }

  // Este es un voto manual del invitado (diferente del automático que se da tras 24h)
  // Creamos el voto bonus inmediatamente como agradecimiento
  await prisma.vote.create({
    data: {
      eventId: invite.eventId,
      voterId: interaction.user.id,
      candidateId: invite.inviterId,
      voteType: VoteType.INVITE_BONUS,
    },
  });

  const inviterName = invite.inviter.currentName || invite.inviter.displayName;

  await interaction.reply({
    content: `${EMOJIS.CHECK} ¡Has votado por **${inviterName}**! Gracias por tu apoyo.`,
    ephemeral: true,
  });
}
