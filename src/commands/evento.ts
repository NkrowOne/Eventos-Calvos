import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
} from 'discord.js';
import type { CommandInteraction } from '../types/index.js';
import { COLORS, EMOJIS, LIMITS } from '../types/index.js';
import { isAdmin, isAdminOrMod } from '../utils/permissions.js';
import {
  createRegistrationEmbed,
  createGroupVotingEmbed,
  createFinalVotingEmbed,
  createRankingEmbed,
  createWinnerEmbed,
  createDisqualificationEmbed,
} from '../utils/embeds.js';
import {
  createEvent,
  getActiveEvent,
  setEventMessageId,
  setWarningChannel,
  setVotingChannel,
  updateEventPhase,
  getActiveParticipants,
  getFinalists,
  disqualifyParticipant,
  getParticipant,
  setFinalists,
  setWinners,
  logAudit,
  getParticipantCount,
} from '../services/contest.js';
import {
  createRound,
  createGroups,
  openVoting,
  closeRound,
  getCurrentRound,
  getAdvancedParticipants,
  getFinalResults,
} from '../services/voting.js';
import { EventPhase } from '@prisma/client';
import { EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('evento')
  .setDescription('Gestión del evento Nombres Locos')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((sub) =>
    sub
      .setName('crear')
      .setDescription('Crear un nuevo evento')
      .addStringOption((opt) =>
        opt.setName('nombre').setDescription('Nombre del evento').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('descripcion').setDescription('Descripción del evento').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('tag').setDescription('Tag del servidor requerido (ej: CALVOS)').setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('cierre-inscripcion').setDescription('Fecha cierre inscripciones (YYYY-MM-DD HH:MM)').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('publicar')
      .setDescription('Publicar el embed de inscripción en el canal actual')
  )
  .addSubcommand((sub) =>
    sub
      .setName('config')
      .setDescription('Configurar canales del evento')
      .addChannelOption((opt) =>
        opt
          .setName('canal-avisos')
          .setDescription('Canal para advertencias')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('canal-votacion')
          .setDescription('Canal para votaciones')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName('tag').setDescription('Cambiar el tag requerido').setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('fase')
      .setDescription('Gestionar fases del concurso')
      .addStringOption((opt) =>
        opt
          .setName('accion')
          .setDescription('Acción a realizar')
          .setRequired(true)
          .addChoices(
            { name: 'Crear ronda de grupos', value: 'crear_ronda' },
            { name: 'Abrir votación de ronda', value: 'abrir_votacion' },
            { name: 'Cerrar ronda y avanzar', value: 'cerrar_ronda' },
            { name: 'Iniciar briefing', value: 'briefing' },
            { name: 'Abrir votación final', value: 'votacion_final' },
            { name: 'Cerrar votación final', value: 'cerrar_final' }
          )
      )
      .addIntegerOption((opt) =>
        opt
          .setName('avanzan')
          .setDescription('Cuántos avanzan por grupo (default: 3)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(10)
      )
      .addIntegerOption((opt) =>
        opt
          .setName('tamano-grupo')
          .setDescription('Tamaño de cada grupo (default: 10)')
          .setRequired(false)
          .setMinValue(3)
          .setMaxValue(20)
      )
      .addStringOption((opt) =>
        opt.setName('fecha-ronda').setDescription('Día programado para la ronda (YYYY-MM-DD)').setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt.setName('duracion-horas').setDescription('Duración de votación en horas (default: 24)').setRequired(false).setMinValue(1).setMaxValue(168)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('descalificar')
      .setDescription('Descalificar a un participante')
      .addUserOption((opt) =>
        opt.setName('usuario').setDescription('Usuario a descalificar').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('motivo').setDescription('Motivo de la descalificación').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName('info').setDescription('Ver información del evento activo')
  );

export async function execute(interaction: CommandInteraction) {
  const member = interaction.member as any;

  if (!isAdminOrMod(member)) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} No tienes permisos para gestionar eventos.`,
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'crear':
      await handleCrear(interaction);
      break;
    case 'publicar':
      await handlePublicar(interaction);
      break;
    case 'config':
      await handleConfig(interaction);
      break;
    case 'fase':
      await handleFase(interaction);
      break;
    case 'descalificar':
      await handleDescalificar(interaction);
      break;
    case 'info':
      await handleInfo(interaction);
      break;
  }
}

async function handleCrear(interaction: CommandInteraction) {
  const nombre = interaction.options.getString('nombre', true);
  const descripcion = interaction.options.getString('descripcion');
  const tag = interaction.options.getString('tag');
  const cierreStr = interaction.options.getString('cierre-inscripcion');

  let registrationEnd: Date | undefined;
  if (cierreStr) {
    registrationEnd = new Date(cierreStr);
    if (isNaN(registrationEnd.getTime())) {
      await interaction.reply({ content: `${EMOJIS.CROSS} Formato de fecha inválido. Usa: YYYY-MM-DD HH:MM`, ephemeral: true });
      return;
    }
  }

  const event = await createEvent({
    name: nombre,
    guildId: interaction.guildId!,
    channelId: interaction.channelId,
    requiredTag: tag || undefined,
    description: descripcion || undefined,
    registrationEnd,
  });

  await logAudit(event.id, interaction.user.id, 'CREATE_EVENT', `Evento creado: ${nombre}`);

  const { config: appConfig } = await import('../config.js');
  const webUrl = appConfig.web.publicUrl;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${EMOJIS.CHECK} Evento creado`)
        .setDescription(
          `**${nombre}** ha sido creado.\n\n` +
          (descripcion ? `${descripcion}\n\n` : '') +
          `Usa \`/evento config\` para configurar canales.\n` +
          `Usa \`/evento publicar\` en el canal deseado para publicar la inscripción.\n\n` +
          (tag ? `${EMOJIS.WARNING} Tag requerido: \`${tag}\`\n` : '') +
          (registrationEnd ? `${EMOJIS.CALENDAR} Cierre inscripciones: <t:${Math.floor(registrationEnd.getTime() / 1000)}:F>\n` : '') +
          `${EMOJIS.GLOBE} Panel web: ${webUrl}`
        )
        .setColor(COLORS.SUCCESS),
    ],
    ephemeral: true,
  });
}

async function handlePublicar(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  if (event.phase !== EventPhase.REGISTRATION) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Solo se puede publicar en fase de inscripción.`,
      ephemeral: true,
    });
    return;
  }

  const { config: appCfg } = await import('../config.js');
  const { embed, row } = createRegistrationEmbed(event.name, event.requiredTag, {
    registrationEnd: event.registrationEnd,
    webUrl: appCfg.web.publicUrl,
  });
  const message = await (interaction.channel as TextChannel).send({
    embeds: [embed],
    components: [row],
  });

  await setEventMessageId(event.id, message.id);
  await logAudit(event.id, interaction.user.id, 'PUBLISH_EVENT', `Publicado en #${(interaction.channel as TextChannel).name}`);

  await interaction.reply({
    content: `${EMOJIS.CHECK} Evento publicado en este canal.`,
    ephemeral: true,
  });
}

async function handleConfig(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  const warningChannel = interaction.options.getChannel('canal-avisos');
  const votingChannel = interaction.options.getChannel('canal-votacion');
  const tag = interaction.options.getString('tag');

  const changes: string[] = [];

  if (warningChannel) {
    await setWarningChannel(event.id, warningChannel.id);
    changes.push(`Canal de avisos: <#${warningChannel.id}>`);
  }

  if (votingChannel) {
    await setVotingChannel(event.id, votingChannel.id);
    changes.push(`Canal de votación: <#${votingChannel.id}>`);
  }

  if (tag) {
    const { prisma } = await import('../database/client.js');
    await prisma.event.update({ where: { id: event.id }, data: { requiredTag: tag } });
    changes.push(`Tag requerido: \`${tag}\``);
  }

  if (changes.length === 0) {
    await interaction.reply({ content: 'No se han especificado cambios.', ephemeral: true });
    return;
  }

  await logAudit(event.id, interaction.user.id, 'CONFIG_EVENT', changes.join(', '));

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${EMOJIS.CHECK} Configuración actualizada`)
        .setDescription(changes.join('\n'))
        .setColor(COLORS.SUCCESS),
    ],
    ephemeral: true,
  });
}

async function handleFase(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  if (!isAdmin(interaction.member as any)) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Solo los administradores pueden gestionar las fases.`,
      ephemeral: true,
    });
    return;
  }

  const accion = interaction.options.getString('accion', true);
  const advanceCount = interaction.options.getInteger('avanzan') ?? LIMITS.ADVANCE_PER_GROUP;
  const groupSize = interaction.options.getInteger('tamano-grupo') ?? LIMITS.GROUP_SIZE;
  const fechaRondaStr = interaction.options.getString('fecha-ronda');
  const duracionHoras = interaction.options.getInteger('duracion-horas') ?? 24;

  await interaction.deferReply({ ephemeral: true });

  switch (accion) {
    case 'crear_ronda': {
      if (event.phase === EventPhase.REGISTRATION) {
        await updateEventPhase(event.id, EventPhase.GROUP_STAGE);
      }

      if (event.phase !== EventPhase.REGISTRATION && event.phase !== EventPhase.GROUP_STAGE) {
        await interaction.editReply(`${EMOJIS.CROSS} No se puede crear rondas en esta fase.`);
        return;
      }

      // Obtener participantes que avanzan de la ronda anterior, o todos si es la primera
      const currentRound = await getCurrentRound(event.id);
      let participantIds: string[];

      if (currentRound && currentRound.status === 'COMPLETED') {
        const advanced = await getAdvancedParticipants(currentRound.id);
        participantIds = advanced.map((p) => p.id);
      } else if (currentRound && currentRound.status !== 'COMPLETED') {
        await interaction.editReply(`${EMOJIS.CROSS} Cierra la ronda actual antes de crear una nueva.`);
        return;
      } else {
        const participants = await getActiveParticipants(event.id);
        participantIds = participants.map((p) => p.id);
      }

      if (participantIds.length <= 10) {
        // Ya tenemos 10 o menos, pasar directamente a finalistas
        await setFinalists(event.id, participantIds);
        await updateEventPhase(event.id, EventPhase.BRIEFING);
        await interaction.editReply(
          `${EMOJIS.CROWN} Solo quedan ${participantIds.length} participantes. Se han establecido como finalistas directamente. Fase: **BRIEFING**`
        );
        return;
      }

      const scheduledDate = fechaRondaStr ? new Date(fechaRondaStr) : undefined;
      const round = await createRound(event.id, advanceCount, scheduledDate);
      const groups = await createGroups(round.id, event.id, participantIds, groupSize);

      await logAudit(
        event.id,
        interaction.user.id,
        'CREATE_ROUND',
        `Ronda ${round.roundNumber}: ${groups.length} grupos de ~${groupSize}, avanzan ${advanceCount} por grupo`
      );

      await interaction.editReply(
        `${EMOJIS.CHECK} **Ronda ${round.roundNumber}** creada:\n` +
        `• ${participantIds.length} participantes en ${groups.length} grupos\n` +
        `• Avanzan ${advanceCount} por grupo\n` +
        `• Usa \`/evento fase accion:Abrir votación de ronda\` para comenzar`
      );
      break;
    }

    case 'abrir_votacion': {
      const round = await getCurrentRound(event.id);
      if (!round || round.status !== 'CREATED') {
        await interaction.editReply(`${EMOJIS.CROSS} No hay ronda pendiente de abrir.`);
        return;
      }

      if (!event.votingChannelId) {
        await interaction.editReply(`${EMOJIS.CROSS} Configura un canal de votación primero con \`/evento config\`.`);
        return;
      }

      const votingEndDate = new Date(Date.now() + duracionHoras * 60 * 60 * 1000);
      await openVoting(round.id, votingEndDate);
      await updateEventPhase(event.id, EventPhase.GROUP_STAGE);

      const channel = interaction.guild!.channels.cache.get(event.votingChannelId) as TextChannel;
      if (!channel) {
        await interaction.editReply(`${EMOJIS.CROSS} No se encuentra el canal de votación.`);
        return;
      }

      // Publicar embed de votación por cada grupo
      for (const group of round.groups) {
        const members = group.members.map((m) => ({
          participantId: m.participantId,
          userId: m.participant.userId,
          displayName: m.participant.currentName || m.participant.displayName,
        }));

        const { embed, rows } = createGroupVotingEmbed(group.groupNumber, round.roundNumber, members);
        const msg = await channel.send({ embeds: [embed], components: rows });

        // Guardar messageId del grupo
        const { prisma } = await import('../database/client.js');
        await prisma.group.update({
          where: { id: group.id },
          data: { messageId: msg.id },
        });
      }

      await logAudit(event.id, interaction.user.id, 'OPEN_VOTING', `Ronda ${round.roundNumber}`);
      await interaction.editReply(`${EMOJIS.VOTE} Votación de la Ronda ${round.roundNumber} abierta en <#${event.votingChannelId}>.`);
      break;
    }

    case 'cerrar_ronda': {
      const round = await getCurrentRound(event.id);
      if (!round || round.status !== 'VOTING') {
        await interaction.editReply(`${EMOJIS.CROSS} No hay ronda con votación abierta.`);
        return;
      }

      const advancedIds = await closeRound(round.id);

      // Publicar resultados
      if (event.votingChannelId) {
        const channel = interaction.guild!.channels.cache.get(event.votingChannelId) as TextChannel;
        if (channel) {
          const { getGroupResults } = await import('../services/voting.js');

          for (const group of round.groups) {
            const results = await getGroupResults(group.id);
            const entries = results.map((r, i) => ({
              position: i + 1,
              displayName: `${r.advanced ? EMOJIS.CHECK : EMOJIS.CROSS} ${r.displayName}`,
              userId: r.userId,
              votes: r.votes,
            }));

            const embed = createRankingEmbed(
              `Resultados Ronda ${round.roundNumber} - Grupo ${group.groupNumber}`,
              entries
            );
            await channel.send({ embeds: [embed] });
          }
        }
      }

      await logAudit(
        event.id,
        interaction.user.id,
        'CLOSE_ROUND',
        `Ronda ${round.roundNumber} cerrada. ${advancedIds.length} participantes avanzan.`
      );

      await interaction.editReply(
        `${EMOJIS.CHECK} Ronda ${round.roundNumber} cerrada.\n` +
        `• **${advancedIds.length}** participantes avanzan.\n` +
        (advancedIds.length <= 10
          ? `• ${EMOJIS.CROWN} ¡Suficientes para la final! Usa \`/evento fase accion:Iniciar briefing\``
          : `• Crea otra ronda con \`/evento fase accion:Crear ronda de grupos\``)
      );
      break;
    }

    case 'briefing': {
      // Establecer finalistas con los que quedan
      const lastRound = await getCurrentRound(event.id);
      let finalistIds: string[];

      if (lastRound) {
        const advanced = await getAdvancedParticipants(lastRound.id);
        finalistIds = advanced.map((p) => p.id);
      } else {
        const participants = await getActiveParticipants(event.id);
        finalistIds = participants.map((p) => p.id);
      }

      if (finalistIds.length === 0) {
        await interaction.editReply(`${EMOJIS.CROSS} No hay participantes para la final.`);
        return;
      }

      await setFinalists(event.id, finalistIds);
      await updateEventPhase(event.id, EventPhase.BRIEFING);

      const finalists = await getFinalists(event.id);
      const finalistList = finalists
        .map((f, i) => `${i + 1}. **${f.currentName || f.displayName}** (<@${f.userId}>)`)
        .join('\n');

      if (event.votingChannelId) {
        const channel = interaction.guild!.channels.cache.get(event.votingChannelId) as TextChannel;
        if (channel) {
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`${EMOJIS.CROWN} ¡FINALISTAS DE NOMBRES LOCOS!`)
                .setDescription(
                  `Estos son los **${finalists.length} finalistas**:\n\n${finalistList}\n\n` +
                  `Ahora cada finalista hará un **briefing** explicando por qué debe ganar. ¡Estad atentos!`
                )
                .setColor(COLORS.GOLD),
            ],
          });
        }
      }

      await logAudit(event.id, interaction.user.id, 'START_BRIEFING', `${finalists.length} finalistas`);
      await interaction.editReply(
        `${EMOJIS.CHECK} Fase de **Briefing** iniciada con **${finalists.length}** finalistas.\n` +
        `Cuando los finalistas terminen, usa \`/evento fase accion:Abrir votación final\``
      );
      break;
    }

    case 'votacion_final': {
      if (event.phase !== EventPhase.BRIEFING) {
        await interaction.editReply(`${EMOJIS.CROSS} Debes estar en fase de Briefing para abrir la votación final.`);
        return;
      }

      if (!event.votingChannelId) {
        await interaction.editReply(`${EMOJIS.CROSS} Configura un canal de votación primero.`);
        return;
      }

      const finalists = await getFinalists(event.id);
      if (finalists.length === 0) {
        await interaction.editReply(`${EMOJIS.CROSS} No hay finalistas establecidos.`);
        return;
      }

      const finalStart = new Date();
      const finalEnd = new Date(finalStart.getTime() + 24 * 60 * 60 * 1000);
      const { prisma: db } = await import('../database/client.js');
      await db.event.update({
        where: { id: event.id },
        data: { phase: EventPhase.FINAL_VOTING, finalVotingStart: finalStart, finalVotingEnd: finalEnd },
      });

      const channel = interaction.guild!.channels.cache.get(event.votingChannelId) as TextChannel;
      if (channel) {
        const finalistData = finalists.map((f) => ({
          participantId: f.id,
          userId: f.userId,
          displayName: f.currentName || f.displayName,
        }));

        const { embed, rows } = createFinalVotingEmbed(finalistData);
        await channel.send({ embeds: [embed], components: rows });
      }

      const endTimestamp = Math.floor(finalEnd.getTime() / 1000);
      await logAudit(event.id, interaction.user.id, 'OPEN_FINAL_VOTING', `Cierra: ${finalEnd.toISOString()}`);
      await interaction.editReply(
        `${EMOJIS.VOTE} **Votación final abierta** en <#${event.votingChannelId}>.\n` +
        `${EMOJIS.CLOCK} Cierra automáticamente: <t:${endTimestamp}:F> (<t:${endTimestamp}:R>)\n` +
        `Puedes cerrar manualmente con \`/evento fase accion:Cerrar votación final\``
      );
      break;
    }

    case 'cerrar_final': {
      if (event.phase !== EventPhase.FINAL_VOTING) {
        await interaction.editReply(`${EMOJIS.CROSS} No estamos en fase de votación final.`);
        return;
      }

      const results = await getFinalResults(event.id);

      if (results.length < 2) {
        await interaction.editReply(`${EMOJIS.CROSS} Se necesitan al menos 2 finalistas con resultados.`);
        return;
      }

      const first = results[0];
      const second = results[1];

      await setWinners(event.id, first.participantId, second.participantId);

      // Publicar resultados
      if (event.votingChannelId) {
        const channel = interaction.guild!.channels.cache.get(event.votingChannelId) as TextChannel;
        if (channel) {
          // Embed de ganadores
          const winnerEmbed = createWinnerEmbed(
            { displayName: first.displayName, userId: first.userId, votes: first.totalVotes },
            { displayName: second.displayName, userId: second.userId, votes: second.totalVotes }
          );
          await channel.send({ embeds: [winnerEmbed] });

          // Ranking completo
          const allEntries = results.map((r, i) => ({
            position: i + 1,
            displayName: r.displayName,
            userId: r.userId,
            votes: r.totalVotes,
          }));
          const rankingEmbed = createRankingEmbed(
            `${EMOJIS.VOTE} Resultados Finales Detallados`,
            allEntries
          );
          await channel.send({ embeds: [rankingEmbed] });

          // Desglose de votos
          const breakdownLines = results.map(
            (r) =>
              `**${r.displayName}**: ${r.finalVotes} votos directos + ${r.inviteBonusVotes} bonus invitación = **${r.totalVotes} total**`
          );
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`${EMOJIS.STAR} Desglose de Votos`)
                .setDescription(breakdownLines.join('\n'))
                .setColor(COLORS.INFO),
            ],
          });
        }
      }

      await logAudit(
        event.id,
        interaction.user.id,
        'CLOSE_FINAL',
        `Ganador: ${first.displayName} (${first.totalVotes}v), 2do: ${second.displayName} (${second.totalVotes}v)`
      );

      await interaction.editReply(
        `${EMOJIS.CROWN} **¡Concurso finalizado!**\n\n` +
        `${EMOJIS.TROPHY} 1er lugar: **${first.displayName}** — ${first.totalVotes} votos\n` +
        `${EMOJIS.MEDAL} 2do lugar: **${second.displayName}** — ${second.totalVotes} votos\n\n` +
        `Recuerda asignar los premios y roles manualmente.`
      );
      break;
    }
  }
}

async function handleDescalificar(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('usuario', true);
  const motivo = interaction.options.getString('motivo', true);

  const participant = await getParticipant(event.id, targetUser.id);
  if (!participant) {
    await interaction.reply({
      content: `${EMOJIS.CROSS} Ese usuario no está inscrito en el evento.`,
      ephemeral: true,
    });
    return;
  }

  await disqualifyParticipant(participant.id, event.id, targetUser.id, motivo);
  await logAudit(event.id, interaction.user.id, 'DISQUALIFY', `${targetUser.tag}: ${motivo}`);

  // Notificar en canal de avisos
  if (event.warningChannelId) {
    const channel = interaction.guild!.channels.cache.get(event.warningChannelId) as TextChannel;
    if (channel) {
      const embed = createDisqualificationEmbed(targetUser.id, motivo);
      await channel.send({ embeds: [embed] });
    }
  }

  await interaction.reply({
    content: `${EMOJIS.CHECK} **${targetUser.displayName}** ha sido descalificado. Motivo: ${motivo}`,
    ephemeral: true,
  });
}

async function handleInfo(interaction: CommandInteraction) {
  const event = await getActiveEvent(interaction.guildId!);
  if (!event) {
    await interaction.reply({ content: `${EMOJIS.CROSS} No hay evento activo.`, ephemeral: true });
    return;
  }

  const participantCount = await getParticipantCount(event.id);
  const finalists = await getFinalists(event.id);
  const currentRound = await getCurrentRound(event.id);

  const phaseNames: Record<string, string> = {
    REGISTRATION: 'Inscripción abierta',
    GROUP_STAGE: 'Rondas por grupos',
    BRIEFING: 'Briefing de finalistas',
    FINAL_VOTING: 'Votación final (24h)',
    CLOSED: 'Finalizado',
  };

  const { config: appConfig } = await import('../config.js');
  const fmt = (d: Date | null) => d ? `<t:${Math.floor(d.getTime() / 1000)}:F>` : 'No establecida';

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJIS.STAR} ${event.name}`)
    .setDescription(
      (event.description ? `${event.description}\n\n` : '') +
      `**Fase**: ${phaseNames[event.phase]}\n` +
      `**Participantes activos**: ${participantCount}\n` +
      `**Finalistas**: ${finalists.length}\n` +
      (event.requiredTag ? `**Tag requerido**: \`${event.requiredTag}\`\n` : '') +
      `\n${EMOJIS.CALENDAR} **Fechas:**\n` +
      `Cierre inscripciones: ${fmt(event.registrationEnd)}\n` +
      (event.finalVotingStart ? `Votación final: ${fmt(event.finalVotingStart)} → ${fmt(event.finalVotingEnd)}\n` : '') +
      `\n**Canales:**\n` +
      (event.warningChannelId ? `Avisos: <#${event.warningChannelId}>\n` : '⚠️ Sin canal de avisos\n') +
      (event.votingChannelId ? `Votación: <#${event.votingChannelId}>\n` : '⚠️ Sin canal de votación\n') +
      (currentRound ? `\n**Ronda actual**: ${currentRound.roundNumber} (${currentRound.status})` : '') +
      `\n\n${EMOJIS.GLOBE} **Panel web**: ${appConfig.web.publicUrl}`
    )
    .setColor(COLORS.INFO)
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
