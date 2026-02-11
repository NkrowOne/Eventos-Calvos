import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { config } from './config.js';
import { prisma } from './database/client.js';

// Event imports
import * as readyEvent from './events/ready.js';
import * as interactionCreateEvent from './events/interactionCreate.js';
import * as guildMemberAddEvent from './events/guildMemberAdd.js';
import * as guildMemberUpdateEvent from './events/guildMemberUpdate.js';
import * as guildMemberRemoveEvent from './events/guildMemberRemove.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.GuildMember,
    Partials.Channel,
  ],
});

// Register events
client.once(readyEvent.name, (...args) => readyEvent.execute(...args as [Client<true>]));
client.on(interactionCreateEvent.name, interactionCreateEvent.execute);
client.on(guildMemberAddEvent.name, guildMemberAddEvent.execute);
client.on(guildMemberUpdateEvent.name, guildMemberUpdateEvent.execute);
client.on(guildMemberRemoveEvent.name, guildMemberRemoveEvent.execute);

// Graceful shutdown
async function shutdown() {
  console.log('[Bot] Apagando...');
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('[Bot] Unhandled rejection:', error);
});

// Login
console.log('[Bot] Iniciando...');
client.login(config.discord.token).catch((error) => {
  console.error('[Bot] Error al iniciar sesión:', error);
  process.exit(1);
});
