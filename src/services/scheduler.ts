import cron from 'node-cron';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { checkAllParticipants } from './requirements.js';
import { getPendingValidations, validateInvite } from './invites.js';
import { prisma } from '../database/client.js';
import { createWarningEmbed, createWinnerEmbed, createRankingEmbed } from '../utils/embeds.js';
import { log } from '../utils/logger.js';
import { EventPhase, RoundStatus } from '@prisma/client';
import { COLORS, EMOJIS } from '../types/index.js';
import { closeRound } from './voting.js';
import { getFinalResults } from './voting.js';
import { setFinalists, setWinners, logAudit } from './contest.js';

export function startScheduler(client: Client) {
  // Verificar requisitos cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    log('INFO', 'Scheduler', 'Verificando requisitos...');
    try {
      for (const guild of client.guilds.cache.values()) {
        const result = await checkAllParticipants(guild);
        if (!result) continue;

        if (result.warnings.length > 0) {
          const event = await prisma.event.findFirst({
            where: { guildId: guild.id, active: true },
          });
          if (event?.warningChannelId) {
            const channel = guild.channels.cache.get(event.warningChannelId) as TextChannel;
            if (channel) {
              for (const w of result.warnings) {
                await channel.send({ embeds: [createWarningEmbed(w.userId, w.reason)] });
              }
            }
          }
        }

        if (result.warnings.length > 0 || result.resolved.length > 0) {
          log('INFO', 'Scheduler', `${guild.name}: ${result.warnings.length} warnings, ${result.resolved.length} resolved`);
        }
      }
    } catch (error) {
      log('ERROR', 'Scheduler', 'Error verificando requisitos', error);
    }
  });

  // Validar invitaciones cada 15 minutos
  cron.schedule('*/15 * * * *', async () => {
    log('DEBUG', 'Scheduler', 'Validando invitaciones...');
    try {
      for (const guild of client.guilds.cache.values()) {
        const event = await prisma.event.findFirst({ where: { guildId: guild.id, active: true } });
        if (!event) continue;

        const pending = await getPendingValidations(event.id);
        for (const invite of pending) {
          try {
            await guild.members.fetch(invite.invitedUserId!);
            await validateInvite(invite.id);
            log('INFO', 'Scheduler', `Invitación ${invite.inviteCode} validada`);
          } catch {
            log('DEBUG', 'Scheduler', `Invitado ${invite.invitedUserId} no está en el servidor`);
          }
        }
      }
    } catch (error) {
      log('ERROR', 'Scheduler', 'Error validando invitaciones', error);
    }
  });

  // Auto-transiciones por fecha cada 2 minutos
  cron.schedule('*/2 * * * *', async () => {
    try {
      const events = await prisma.event.findMany({ where: { active: true } });
      const now = new Date();

      for (const event of events) {
        // Cierre automático de inscripciones
        if (event.phase === EventPhase.REGISTRATION && event.registrationEnd && now >= event.registrationEnd) {
          await prisma.event.update({ where: { id: event.id }, data: { phase: EventPhase.GROUP_STAGE } });
          await logAudit(event.id, 'SYSTEM', 'AUTO_CLOSE_REGISTRATION', 'Inscripciones cerradas por fecha');
          log('INFO', 'Scheduler', `${event.name}: inscripciones cerradas automáticamente`);
          await notifyChannel(client, event, `${EMOJIS.CLOCK} **Las inscripciones se han cerrado.**\nComienzan las rondas por grupos.`);
        }

        // Cierre automático de votación final
        if (event.phase === EventPhase.FINAL_VOTING && event.finalVotingEnd && now >= event.finalVotingEnd) {
          log('INFO', 'Scheduler', `${event.name}: votación final cerrada automáticamente`);
          const results = await getFinalResults(event.id);

          if (results.length >= 2) {
            const first = results[0];
            const second = results[1];
            await setWinners(event.id, first.participantId, second.participantId);
            await logAudit(event.id, 'SYSTEM', 'AUTO_CLOSE_FINAL',
              `1ro: ${first.displayName} (${first.totalVotes}v), 2do: ${second.displayName} (${second.totalVotes}v)`);

            const guild = client.guilds.cache.get(event.guildId);
            if (guild && event.votingChannelId) {
              const channel = guild.channels.cache.get(event.votingChannelId) as TextChannel;
              if (channel) {
                await channel.send({ embeds: [createWinnerEmbed(
                  { displayName: first.displayName, userId: first.userId, votes: first.totalVotes },
                  { displayName: second.displayName, userId: second.userId, votes: second.totalVotes },
                )] });

                const entries = results.map((r, i) => ({
                  position: i + 1, displayName: r.displayName, userId: r.userId, votes: r.totalVotes,
                }));
                await channel.send({ embeds: [createRankingEmbed(`${EMOJIS.VOTE} Resultados Finales`, entries)] });

                const breakdown = results.map(r =>
                  `**${r.displayName}**: ${r.finalVotes}v + ${r.inviteBonusVotes}b = **${r.totalVotes}**`);
                await channel.send({ embeds: [new EmbedBuilder()
                  .setTitle(`${EMOJIS.STAR} Desglose de Votos`)
                  .setDescription(breakdown.join('\n'))
                  .setColor(COLORS.INFO)] });
              }
            }
          }
        }

        // Cierre automático de rondas con votingEnd
        if (event.phase === EventPhase.GROUP_STAGE) {
          const expiredRound = await prisma.round.findFirst({
            where: { eventId: event.id, status: RoundStatus.VOTING, votingEnd: { not: null, lte: now } },
          });

          if (expiredRound) {
            log('INFO', 'Scheduler', `Ronda ${expiredRound.roundNumber} cerrada por fecha`);
            const advancedIds = await closeRound(expiredRound.id);
            await logAudit(event.id, 'SYSTEM', 'AUTO_CLOSE_ROUND',
              `Ronda ${expiredRound.roundNumber}: ${advancedIds.length} avanzan`);

            if (advancedIds.length <= 10) {
              await setFinalists(event.id, advancedIds);
              await logAudit(event.id, 'SYSTEM', 'AUTO_FINALISTS', `${advancedIds.length} finalistas`);
            }

            await notifyChannel(client, event,
              `${EMOJIS.CLOCK} **Ronda ${expiredRound.roundNumber} cerrada automáticamente.**\n` +
              `${advancedIds.length} participantes avanzan.` +
              (advancedIds.length <= 10 ? `\n${EMOJIS.CROWN} ¡Son los finalistas!` : ''));
          }
        }
      }
    } catch (error) {
      log('ERROR', 'Scheduler', 'Error en auto-transiciones', error);
    }
  });

  log('INFO', 'Scheduler', 'Tareas programadas iniciadas');
}

async function notifyChannel(client: Client, event: any, message: string) {
  const guild = client.guilds.cache.get(event.guildId);
  if (!guild) return;
  const channelId = event.votingChannelId || event.channelId;
  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) return;
  await channel.send({
    embeds: [new EmbedBuilder()
      .setDescription(message)
      .setColor(COLORS.PRIMARY)
      .setTimestamp()],
  });
}
