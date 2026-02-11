import { Events, Interaction, ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { CUSTOM_IDS, EMOJIS } from '../types/index.js';
import { handleRegisterButton } from '../handlers/register.js';
import { handleGroupVoteButton } from '../handlers/groupVote.js';
import { handleFinalVoteButton } from '../handlers/finalVote.js';
import { handleInviterVoteButton } from '../handlers/inviterVote.js';

// Command imports
import * as eventoCmd from '../commands/evento.js';
import * as invitarCmd from '../commands/invitar.js';
import * as rankingCmd from '../commands/ranking.js';
import * as estadoCmd from '../commands/estado.js';

const commands = new Map<string, { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }>();
commands.set('evento', eventoCmd);
commands.set('invitar', invitarCmd);
commands.set('ranking', rankingCmd);
commands.set('estado', estadoCmd);

export const name = Events.InteractionCreate;

export async function execute(interaction: Interaction) {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error ejecutando comando ${interaction.commandName}:`, error);
      const reply = {
        content: `${EMOJIS.CROSS} Hubo un error al ejecutar este comando.`,
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  // Handle button interactions
  if (interaction.isButton()) {
    try {
      const customId = interaction.customId;

      if (customId === CUSTOM_IDS.REGISTER_BUTTON) {
        await handleRegisterButton(interaction);
      } else if (customId.startsWith(CUSTOM_IDS.VOTE_GROUP_PREFIX)) {
        await handleGroupVoteButton(interaction);
      } else if (customId.startsWith(CUSTOM_IDS.VOTE_FINAL_PREFIX)) {
        await handleFinalVoteButton(interaction);
      } else if (customId.startsWith(CUSTOM_IDS.VOTE_INVITER_PREFIX)) {
        await handleInviterVoteButton(interaction);
      }
    } catch (error) {
      console.error('Error en interacción de botón:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `${EMOJIS.CROSS} Error procesando tu acción.`,
            ephemeral: true,
          });
        }
      } catch {}
    }
  }
}
