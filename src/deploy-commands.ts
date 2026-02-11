import { REST, Routes } from 'discord.js';
import { config } from './config.js';

// Command data imports
import { data as eventoData } from './commands/evento.js';
import { data as invitarData } from './commands/invitar.js';
import { data as rankingData } from './commands/ranking.js';
import { data as estadoData } from './commands/estado.js';

const commands = [
  eventoData.toJSON(),
  invitarData.toJSON(),
  rankingData.toJSON(),
  estadoData.toJSON(),
];

const rest = new REST().setToken(config.discord.token);

async function deployCommands() {
  try {
    console.log(`Registrando ${commands.length} comandos...`);

    const data = await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands }
    );

    console.log(`${(data as any[]).length} comandos registrados correctamente.`);
  } catch (error) {
    console.error('Error registrando comandos:', error);
    process.exit(1);
  }
}

deployCommands();
