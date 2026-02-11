import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { COLORS, EMOJIS, CUSTOM_IDS } from '../types/index.js';

export function createRegistrationEmbed(eventName: string, requiredTag: string | null) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJIS.FIRE} ${eventName} ${EMOJIS.FIRE}`)
    .setDescription(
      `**¡Bienvenido al concurso de Nombres Locos!**\n\n` +
      `Pon el nombre más divertido y creativo como tu nombre de usuario en el servidor. ` +
      `¡El mejor nombre se lleva premios!\n\n` +
      `${EMOJIS.TROPHY} **1er Lugar**: Tarjeta regalo de **25€** (Google Play, Apple, Spotify, Amazon o Netflix) + Rol exclusivo de ganador\n` +
      `${EMOJIS.MEDAL} **2do Lugar**: Tarjeta regalo de **5€**\n\n` +
      `**Cómo funciona:**\n` +
      `1. Pulsa el botón para inscribirte\n` +
      `2. Cambia tu nombre en el servidor al más divertido que se te ocurra\n` +
      `3. Usa \`/invitar\` para traer amigos y conseguir votos extra\n` +
      `4. Se votará por rondas hasta quedar un TOP 10\n` +
      `5. Los finalistas harán un briefing y se hará una votación final\n\n` +
      (requiredTag ? `${EMOJIS.WARNING} **Requisito**: Debes tener el tag del servidor equipado: \`${requiredTag}\`\n\n` : '') +
      `${EMOJIS.STAR} Cada persona que invites al servidor = **1 voto extra** en la votación final\n` +
      `${EMOJIS.WARNING} Los admins y moderadores no pueden participar`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp()
    .setFooter({ text: 'Nombres Locos • Pulsa el botón para inscribirte' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.REGISTER_BUTTON)
      .setLabel('Inscribirse')
      .setStyle(ButtonStyle.Success)
      .setEmoji(EMOJIS.CHECK)
  );

  return { embed, row };
}

export function createWarningEmbed(userId: string, reason: string) {
  return new EmbedBuilder()
    .setTitle(`${EMOJIS.WARNING} Advertencia`)
    .setDescription(
      `<@${userId}>, **no cumples los requisitos** del concurso:\n\n` +
      `**Motivo**: ${reason}\n\n` +
      `Tienes **24 horas** para solucionarlo o serás descalificado.\n` +
      `Si acumulas **3 advertencias**, serás descalificado automáticamente.`
    )
    .setColor(COLORS.WARNING)
    .setTimestamp();
}

export function createDisqualificationEmbed(userId: string, reason: string) {
  return new EmbedBuilder()
    .setTitle(`${EMOJIS.CROSS} Descalificación`)
    .setDescription(
      `<@${userId}> ha sido **descalificado** del concurso.\n\n` +
      `**Motivo**: ${reason}`
    )
    .setColor(COLORS.DANGER)
    .setTimestamp();
}

export function createGroupVotingEmbed(
  groupNumber: number,
  roundNumber: number,
  members: { participantId: string; userId: string; displayName: string }[]
) {
  const memberList = members
    .map((m, i) => `**${i + 1}.** ${m.displayName} (<@${m.userId}>)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJIS.VOTE} Ronda ${roundNumber} - Grupo ${groupNumber}`)
    .setDescription(
      `¡Vota por el nombre más divertido de este grupo!\n\n` +
      `${memberList}\n\n` +
      `Pulsa el botón con el número del participante por el que quieres votar.\n` +
      `${EMOJIS.WARNING} No puedes votarte a ti mismo.`
    )
    .setColor(COLORS.PRIMARY)
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (let i = 0; i < members.length; i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.VOTE_GROUP_PREFIX}${members[i].participantId}`)
        .setLabel(`${i + 1}. ${members[i].displayName.slice(0, 30)}`)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  rows.push(currentRow);

  return { embed, rows };
}

export function createFinalVotingEmbed(
  finalists: { participantId: string; userId: string; displayName: string }[]
) {
  const finalistList = finalists
    .map((f, i) => `**${i + 1}.** ${f.displayName} (<@${f.userId}>)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJIS.CROWN} VOTACIÓN FINAL - Nombres Locos`)
    .setDescription(
      `**¡Es hora de elegir al ganador!**\n\n` +
      `Estos son los 10 finalistas:\n\n` +
      `${finalistList}\n\n` +
      `${EMOJIS.VOTE} Vota por tu favorito pulsando el botón correspondiente.\n` +
      `${EMOJIS.CLOCK} La votación dura **24 horas**.\n` +
      `${EMOJIS.STAR} Los votos extra por invitaciones se sumarán al resultado final.`
    )
    .setColor(COLORS.GOLD)
    .setTimestamp();

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (let i = 0; i < finalists.length; i++) {
    if (i > 0 && i % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.VOTE_FINAL_PREFIX}${finalists[i].participantId}`)
        .setLabel(`${i + 1}. ${finalists[i].displayName.slice(0, 30)}`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  rows.push(currentRow);

  return { embed, rows };
}

export function createRankingEmbed(
  title: string,
  entries: { position: number; displayName: string; userId: string; votes: number }[]
) {
  const list = entries
    .map((e) => {
      const medal =
        e.position === 1 ? EMOJIS.TROPHY :
        e.position === 2 ? EMOJIS.MEDAL :
        e.position === 3 ? EMOJIS.STAR : `**${e.position}.**`;
      return `${medal} ${e.displayName} (<@${e.userId}>) — ${e.votes} votos`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(list || 'No hay datos todavía.')
    .setColor(COLORS.GOLD)
    .setTimestamp();
}

export function createInviteEmbed(inviteUrl: string, inviteCount: number) {
  return new EmbedBuilder()
    .setTitle(`${EMOJIS.LINK} Tu enlace de invitación`)
    .setDescription(
      `Comparte este enlace para invitar gente al servidor:\n\n` +
      `**${inviteUrl}**\n\n` +
      `${EMOJIS.STAR} Cada persona que se una por tu enlace = **1 voto extra** en la final.\n` +
      `${EMOJIS.PERSON} Invitaciones válidas hasta ahora: **${inviteCount}**`
    )
    .setColor(COLORS.INFO)
    .setTimestamp();
}

export function createStatusEmbed(data: {
  displayName: string;
  status: string;
  warnings: number;
  inviteCount: number;
  validInvites: number;
  isFinalist: boolean;
}) {
  const statusText =
    data.status === 'ACTIVE' ? `${EMOJIS.CHECK} Activo` :
    data.status === 'WARNING' ? `${EMOJIS.WARNING} En advertencia` :
    data.status === 'DISQUALIFIED' ? `${EMOJIS.CROSS} Descalificado` :
    `Retirado`;

  return new EmbedBuilder()
    .setTitle(`${EMOJIS.PERSON} Tu estado en el concurso`)
    .setDescription(
      `**Nombre inscrito**: ${data.displayName}\n` +
      `**Estado**: ${statusText}\n` +
      `**Advertencias**: ${data.warnings}/3\n` +
      `**Invitaciones enviadas**: ${data.inviteCount}\n` +
      `**Invitaciones válidas** (votos extra): ${data.validInvites}\n` +
      (data.isFinalist ? `\n${EMOJIS.CROWN} **¡Eres finalista!**` : '')
    )
    .setColor(data.status === 'ACTIVE' ? COLORS.SUCCESS : COLORS.WARNING)
    .setTimestamp();
}

export function createWinnerEmbed(
  first: { displayName: string; userId: string; votes: number },
  second: { displayName: string; userId: string; votes: number }
) {
  return new EmbedBuilder()
    .setTitle(`${EMOJIS.CROWN} ¡GANADORES DE NOMBRES LOCOS! ${EMOJIS.CROWN}`)
    .setDescription(
      `**¡El concurso ha terminado!**\n\n` +
      `${EMOJIS.TROPHY} **1er Lugar**: ${first.displayName} (<@${first.userId}>) — ${first.votes} votos\n` +
      `Premio: Tarjeta regalo de **25€** + Rol de ganador\n\n` +
      `${EMOJIS.MEDAL} **2do Lugar**: ${second.displayName} (<@${second.userId}>) — ${second.votes} votos\n` +
      `Premio: Tarjeta regalo de **5€**\n\n` +
      `¡Felicidades a los ganadores! ${EMOJIS.FIRE}`
    )
    .setColor(COLORS.GOLD)
    .setTimestamp();
}

export function createInviterVoteEmbed(inviterUserId: string, inviterName: string) {
  const embed = new EmbedBuilder()
    .setTitle(`${EMOJIS.STAR} ¡Bienvenido al servidor!`)
    .setDescription(
      `Has sido invitado por **${inviterName}** (<@${inviterUserId}>), ` +
      `que está participando en el concurso **Nombres Locos**.\n\n` +
      `Si quieres, puedes darle un voto extra pulsando el botón de abajo. ¡Esto es totalmente opcional!`
    )
    .setColor(COLORS.INFO);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_IDS.VOTE_INVITER_PREFIX}${inviterUserId}`)
      .setLabel(`Votar por ${inviterName.slice(0, 30)}`)
      .setStyle(ButtonStyle.Success)
      .setEmoji(EMOJIS.STAR)
  );

  return { embed, row };
}
