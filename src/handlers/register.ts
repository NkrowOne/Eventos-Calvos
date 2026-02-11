import { ButtonInteraction, GuildMember } from 'discord.js';
import { EMOJIS } from '../types/index.js';
import { canParticipate } from '../utils/permissions.js';
import { getActiveEvent, registerParticipant, getParticipant } from '../services/contest.js';
import { checkTag } from '../services/requirements.js';
import { EventPhase } from '@prisma/client';

export async function handleRegisterButton(interaction: ButtonInteraction) {
  const member = interaction.member as GuildMember;

  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No hay evento activo.`,
      ephemeral: true,
    });
    return;
  }

  if (event.phase !== EventPhase.REGISTRATION) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Las inscripciones están cerradas.`,
      ephemeral: true,
    });
    return;
  }

  // Verificar que no sea admin/mod
  if (!canParticipate(member)) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Los administradores y moderadores no pueden participar en el concurso.`,
      ephemeral: true,
    });
    return;
  }

  // Verificar si ya está inscrito
  const existing = await getParticipant(event.id, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `${EMOJIS.WARNING} Ya estás inscrito en el concurso con el nombre: **${existing.displayName}**`,
      ephemeral: true,
    });
    return;
  }

  // Verificar tag
  if (event.requiredTag) {
    const tagCheck = checkTag(member, event.requiredTag);
    if (!tagCheck.passed) {
      await interaction.reply({
        content: `${EMOJIS.CROSS} ${tagCheck.reason}\n\nEquipa el tag y vuelve a intentarlo.`,
        ephemeral: true,
      });
      return;
    }
  }

  // Registrar
  const result = await registerParticipant(event.id, interaction.user.id, member.displayName);

  if (!result.success) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} ${result.reason}`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content:
      `${EMOJIS.CHECK} **¡Te has inscrito en ${event.name}!**\n\n` +
      `Tu nombre inscrito: **${member.displayName}**\n\n` +
      `${EMOJIS.STAR} Usa \`/invitar\` para obtener un enlace de invitación y ganar votos extra.\n` +
      `${EMOJIS.PERSON} Usa \`/estado\` para ver tu estado en el concurso.\n` +
      `${EMOJIS.VOTE} Usa \`/ranking\` para ver el ranking actual.`,
    ephemeral: true,
  });
}
