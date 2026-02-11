import { Client, Events } from 'discord.js';
import { startScheduler } from '../services/scheduler.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client: Client<true>) {
  console.log(`[Bot] Conectado como ${client.user.tag}`);
  console.log(`[Bot] En ${client.guilds.cache.size} servidor(es)`);

  // Iniciar tareas programadas
  startScheduler(client);

  // Cachear invitaciones existentes para tracking
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.invites.fetch();
      console.log(`[Bot] Invitaciones cacheadas para ${guild.name}`);
    } catch (error) {
      console.error(`[Bot] Error cacheando invitaciones de ${guild.name}:`, error);
    }
  }
}
