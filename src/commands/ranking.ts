import { SlashCommandBuilder } from 'discord.js';
import type { CommandInteraction } from '../types/index.js';
import { EMOJIS } from '../types/index.js';
import { createRankingEmbed } from '../utils/embeds.js';
import { getActiveEvent, getActiveParticipants, getFinalists } from '../services/contest.js';
import { getValidInviteCount } from '../services/invites.js';
import { getFinalResults, getCurrentRound, getGroupResults, getRoundGroupsWithVotes } from '../services/voting.js';
import { EventPhase } from '@prisma/client';

export const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Ver el ranking actual del concurso');

export async function execute(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No hay evento activo.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  switch (event.phase) {
    case EventPhase.REGISTRATION: {
      // Mostrar participantes inscritos y sus invitaciones válidas
      const participants = await getActiveParticipants(event.id);
      const entries = await Promise.all(
        participants.map(async (p, i) => {
          const validInvites = await getValidInviteCount(p.id);
          return {
            position: i + 1,
            displayName: p.currentName || p.displayName,
            userId: p.userId,
            votes: validInvites,
          };
        })
      );

      // Ordenar por invitaciones válidas
      entries.sort((a, b) => b.votes - a.votes);
      entries.forEach((e, i) => (e.position = i + 1));

      const embed = createRankingEmbed(
        `${EMOJIS.STAR} Ranking de Inscripción (por invitaciones)`,
        entries.slice(0, 20)
      );
      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case EventPhase.GROUP_STAGE: {
      const round = await getCurrentRound(event.id);
      if (!round) {
        await interaction.editReply('No hay ronda activa.');
        return;
      }

      const embeds = [];
      for (const group of round.groups) {
        const results = await getGroupResults(group.id);
        const entries = results.map((r, i) => ({
          position: i + 1,
          displayName: r.displayName,
          userId: r.userId,
          votes: r.votes,
        }));

        embeds.push(
          createRankingEmbed(
            `Ronda ${round.roundNumber} - Grupo ${group.groupNumber}`,
            entries
          )
        );
      }

      await interaction.editReply({ embeds: embeds.slice(0, 10) });
      break;
    }

    case EventPhase.BRIEFING: {
      const finalists = await getFinalists(event.id);
      const entries = await Promise.all(
        finalists.map(async (f, i) => {
          const validInvites = await getValidInviteCount(f.id);
          return {
            position: i + 1,
            displayName: f.currentName || f.displayName,
            userId: f.userId,
            votes: validInvites,
          };
        })
      );
      entries.sort((a, b) => b.votes - a.votes);
      entries.forEach((e, i) => (e.position = i + 1));

      const embed = createRankingEmbed(`${EMOJIS.CROWN} Finalistas`, entries);
      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case EventPhase.FINAL_VOTING:
    case EventPhase.CLOSED: {
      const results = await getFinalResults(event.id);
      const entries = results.map((r, i) => ({
        position: i + 1,
        displayName: `${r.displayName} (${r.finalVotes}v + ${r.inviteBonusVotes}b)`,
        userId: r.userId,
        votes: r.totalVotes,
      }));

      const title =
        event.phase === EventPhase.CLOSED
          ? `${EMOJIS.CROWN} Resultados Finales`
          : `${EMOJIS.VOTE} Votación Final en curso`;

      const embed = createRankingEmbed(title, entries);
      await interaction.editReply({ embeds: [embed] });
      break;
    }
  }
}
