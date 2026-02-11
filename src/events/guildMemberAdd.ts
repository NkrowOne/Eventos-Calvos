import { Events, GuildMember, TextChannel, Collection, Invite } from 'discord.js';
import { getActiveEvent } from '../services/contest.js';
import { getAllTrackedInviteCodes, trackInviteUse, findInviteByCode } from '../services/invites.js';
import { createInviterVoteEmbed } from '../utils/embeds.js';

// Cache de invitaciones para detectar cuál se usó
const inviteCache = new Map<string, Collection<string, Invite>>();

export function updateInviteCache(guildId: string, invites: Collection<string, Invite>) {
  inviteCache.set(guildId, invites);
}

export const name = Events.GuildMemberAdd;

export async function execute(member: GuildMember) {
  if (member.user.bot) return;

  const event = await getActiveEvent(member.guild.id);
  if (!event) return;

  try {
    // Obtener invitaciones actuales y compararlas con el cache
    const currentInvites = await member.guild.invites.fetch();
    const cachedInvites = inviteCache.get(member.guild.id);

    let usedInviteCode: string | null = null;

    if (cachedInvites) {
      // Buscar qué invitación incrementó su uso
      const trackedCodes = await getAllTrackedInviteCodes(event.id);
      const trackedCodeSet = new Set(trackedCodes.map((t) => t.inviteCode));

      for (const [code, invite] of currentInvites) {
        if (!trackedCodeSet.has(code)) continue;

        const cached = cachedInvites.get(code);
        if (cached && invite.uses !== null && cached.uses !== null && invite.uses > cached.uses) {
          usedInviteCode = code;
          break;
        }
      }
    }

    // Actualizar cache
    inviteCache.set(member.guild.id, currentInvites);

    if (!usedInviteCode) return;

    // Trackear el uso de la invitación
    const invite = await trackInviteUse(usedInviteCode, member.id);
    if (!invite) return;

    // Enviar DM al nuevo miembro ofreciendo votar por quien lo invitó
    try {
      const inviterData = invite.inviter;
      const inviterMember = await member.guild.members.fetch(inviterData.userId);
      const inviterName = inviterMember.displayName;

      const { embed, row } = createInviterVoteEmbed(inviterData.userId, inviterName);

      await member.send({ embeds: [embed], components: [row] });
    } catch {
      // No se pudo enviar DM, no pasa nada
      console.log(`[Invite] No se pudo enviar DM a ${member.user.tag}`);
    }

    console.log(`[Invite] ${member.user.tag} invitado por participante ${invite.inviterId} (código: ${usedInviteCode})`);
  } catch (error) {
    console.error('[Invite] Error procesando nuevo miembro:', error);
  }
}
