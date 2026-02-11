import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { checkAllParticipants } from './requirements.js';
import { getPendingValidations, validateInvite } from './invites.js';
import { prisma } from '../database/client.js';
import { createWarningEmbed } from '../utils/embeds.js';

export function startScheduler(client: Client) {
  // Verificar requisitos cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Scheduler] Verificando requisitos de participantes...');
    try {
      for (const guild of client.guilds.cache.values()) {
        const result = await checkAllParticipants(guild);
        if (!result) continue;

        // Enviar warnings al canal de advertencias
        if (result.warnings.length > 0) {
          const event = await prisma.event.findFirst({
            where: { guildId: guild.id, active: true },
          });

          if (event?.warningChannelId) {
            const channel = guild.channels.cache.get(event.warningChannelId) as TextChannel;
            if (channel) {
              for (const warning of result.warnings) {
                const embed = createWarningEmbed(warning.userId, warning.reason);
                await channel.send({ embeds: [embed] });
              }
            }
          }
        }

        if (result.warnings.length > 0 || result.resolved.length > 0) {
          console.log(`[Scheduler] ${guild.name}: ${result.warnings.length} warnings, ${result.resolved.length} resolved`);
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error verificando requisitos:', error);
    }
  });

  // Validar invitaciones pendientes cada 15 minutos
  cron.schedule('*/15 * * * *', async () => {
    console.log('[Scheduler] Validando invitaciones pendientes...');
    try {
      for (const guild of client.guilds.cache.values()) {
        const event = await prisma.event.findFirst({
          where: { guildId: guild.id, active: true },
        });
        if (!event) continue;

        const pending = await getPendingValidations(event.id);
        for (const invite of pending) {
          // Verificar que el invitado sigue en el servidor
          try {
            await guild.members.fetch(invite.invitedUserId!);
            await validateInvite(invite.id);
            console.log(`[Scheduler] Invitación ${invite.inviteCode} validada`);
          } catch {
            // El invitado se fue, no validar
            console.log(`[Scheduler] Invitado ${invite.invitedUserId} ya no está en el servidor`);
          }
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error validando invitaciones:', error);
    }
  });

  console.log('[Scheduler] Tareas programadas iniciadas');
}
